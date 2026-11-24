import { EventEmitter } from "node:events";
import { statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  McpServerConfig, Options, PermissionResult, PermissionUpdate, Query, SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  SHELL_CONTEXT_CAP, SQUAD_TOOL_NAMES, SQUAD_TOOL_PREFIX, agentShellPrompt, appendShellOutput, bashContextBlock, errorMessage,
  parseShellInput,
  type Agent, type AgentEvent, type AgentState, type ShellChunk, type AgentStatus, type Approval, type ApprovalDecision, type AskQuestion, type QuestionAnswers, type Project, type SlashCommandInfo,
} from "@squad/shared";
import { AsyncQueue } from "./inputQueue.ts";
import { buildLaunchPrompt } from "./launchPrompt.ts";
import { normalise, summariseTool, type SdkMsg } from "./normalise.ts";
import { runShell } from "./shellCommand.ts";
import { userShell } from "./shells/adapters.ts";
import type { SkillInfo } from "./skillsList.ts";
import type { LaunchPlugins } from "./plugins/service.ts";

const SKILLS_TIMEOUT_MS = 10_000;

export type QueryFactory = (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;

/** A turn's end, with the session's running per-model usage totals. */
export interface TurnResult {
  sessionId: string;
  modelUsage: SdkMsg["modelUsage"];
  resumed: boolean;
}

export interface RunnerDeps {
  queryFactory: QueryFactory;
  mcpServer: McpServerConfig;
  kitPluginPath: string;
  /** This squadmate's plugins besides squad-kit, worked out at each launch. */
  launchPlugins?: () => Promise<LaunchPlugins>;
  shareDir: string;
  /** Resolves true when nobody is signed in to Claude, so a launch would only fail. */
  signedOut?: () => Promise<boolean>;
  /** Runs `$ cmd`; tests swap in a fake. */
  runShell?: typeof runShell;
}

interface Pending {
  approval: Approval;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  resolve: (r: PermissionResult) => void;
}

type ShellEvent = Extract<AgentEvent, { kind: "shell" }>;
/** How often a running `$ cmd`'s output is sent to the page. */
const SHELL_FLUSH_MS = 50;

export const NOT_SIGNED_IN = "Not signed in to Claude: click the account in the top bar";
const DENY_MESSAGE = "Denied by user in Squad";
const SKIP_MESSAGE = "The user skipped these questions in Squad. Ask them in chat instead, as a normal message.";
const ASK_TOOL = "AskUserQuestion";

/** AskUserQuestion's questions, kept to the fields the page shows; undefined when the input isn't usable. */
export function askQuestions(input: Record<string, unknown>): AskQuestion[] | undefined {
  const raw = input.questions;
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const qs = raw.filter((q) => q && typeof q === "object" && typeof q.question === "string").map((q) => ({
    question: q.question as string,
    header: str(q.header),
    multiSelect: q.multiSelect === true,
    options: (Array.isArray(q.options) ? q.options : [])
      .filter((o: any) => o && typeof o.label === "string")
      .map((o: any) => ({ label: o.label as string, description: str(o.description) })),
  }));
  return qs.length ? qs : undefined;
}
/** Squad's own tools only touch Squad state and the share folder, so they never need approval. */
export const SQUAD_TOOLS = SQUAD_TOOL_NAMES.map((t) => `${SQUAD_TOOL_PREFIX}${t}`);

function userMessage(text: string, images: string[] = []): SDKUserMessage {
  const content = images.length
    ? [
        { type: "text" as const, text },
        ...images.map((url) => {
          const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
          return { type: "image" as const, source: { type: "base64" as const, media_type: m?.[1] ?? "image/png", data: m?.[2] ?? "" } };
        }),
      ]
    : text;
  return { type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" } as SDKUserMessage;
}

/**
 * One agent's Claude Code session. Events: "status"(AgentState) "event"(AgentEvent)
 * "approval"(Approval) "approvalResolved"(id) "session"(sessionId)
 * "result"({ sessionId, modelUsage, resumed }) "rateLimit"(rate_limit_info) "commands"(SlashCommandInfo[]).
 */
export class AgentRunner extends EventEmitter {
  state: AgentState;
  private query: Query | null = null;
  private input: AsyncQueue<SDKUserMessage> | null = null;
  private pending = new Map<string, Pending>();
  private stopping = false;
  /** The session id this launch resumed, to tell a resumed session's first turn from a new one. */
  private resumedFrom: string | null = null;
  /** The Claude Code process id; its cross-session socket is named after it (`uds:…/<pid>.sock`). */
  sessionPid: number | null = null;
  /** True while a launch is checking whether it can start, so a second click doesn't start a second session. */
  private launching = false;
  /** `$ cmd` commands still running, by id, so they can be killed. */
  private shells = new Map<string, { kill(force?: boolean): void }>();
  /** Finished `$ cmd` blocks the squadmate hasn't seen yet. */
  private shellContext: string[] = [];
  /** Running and undelivered `$ cmd` blocks as the pane shows them, for a page that (re)subscribes. */
  private snapshots = new Map<string, ShellEvent>();
  /** The session's `/` commands, as last announced; kept after a stop so the picker still has them. */
  private sessionCommands: SlashCommandInfo[] = [];
  /** Bumped when queued output is dropped (Clear); a command started before then never queues its output. */
  private shellGeneration = 0;

  constructor(
    private project: Project,
    private agent: Agent,
    private team: Agent[],
    private deps: RunnerDeps,
  ) {
    super();
    this.state = { agentId: agent.id, status: "stopped" };
  }

  /** Called by the supervisor when the agent or project is edited; applies at next launch. */
  update(project: Project, agent: Agent, team: Agent[]): void {
    this.project = project;
    this.agent = agent;
    this.team = team;
  }

  pendingApprovals(): Approval[] {
    return [...this.pending.values()].map((p) => p.approval);
  }

  get commands(): SlashCommandInfo[] {
    return this.sessionCommands;
  }

  private setCommands(list: unknown): void {
    if (!Array.isArray(list)) return;
    this.sessionCommands = (list as SlashCommandInfo[]).map(({ name, description, argumentHint, aliases }) =>
      ({ name, description: description ?? "", argumentHint: argumentHint ?? "", ...(aliases?.length ? { aliases } : {}) }));
    this.emit("commands", this.sessionCommands);
  }

  /** The session's skills, reloaded from disk so ones added since launch show too. */
  async skills(): Promise<SkillInfo[]> {
    const q = this.query;
    if (!q) throw new Error(`${this.agent.name} isn't running`);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("no answer from the session")), SKILLS_TIMEOUT_MS);
    });
    try {
      return (await Promise.race([q.reloadSkills(), timeout])).skills as SkillInfo[];
    } finally {
      clearTimeout(timer);
    }
  }

  /** The plugins this session launched with; null while stopped. */
  launchedPlugins: LaunchPlugins | null = null;

  get running(): boolean {
    return this.query !== null;
  }

  /** The live query, for reading plan usage; null unless the session is up. */
  get usageSource(): Query | null {
    return this.state.status === "stopped" || this.state.status === "error" ? null : this.query;
  }

  private setStatus(status: AgentStatus, error?: string): void {
    const next: AgentState = { agentId: this.agent.id, status };
    if (error) next.error = error;
    // A reading belongs to a live session: drop it once the session is gone.
    const live = status !== "stopped" && status !== "error";
    if (live && this.state.contextPct !== undefined) next.contextPct = this.state.contextPct;
    this.state = next;
    this.emit("status", this.state);
  }

  /** `shellContext`: `$ cmd` output to put in the launch prompt (a summon delivers it this way). */
  async launch(opts: { shellContext?: string[] } = {}): Promise<void> {
    if (this.query || this.launching) return;
    this.launching = true;
    try {
      await this.start(opts);
    } finally {
      this.launching = false;
    }
  }

  private async start(opts: { shellContext?: string[] }): Promise<void> {
    let isDir = false;
    try {
      isDir = statSync(this.agent.folder).isDirectory();
    } catch {}
    if (!isDir) {
      this.setStatus("error", `Folder not found: ${this.agent.folder}`);
      return;
    }
    if (await this.deps.signedOut?.()) {
      this.setStatus("error", NOT_SIGNED_IN);
      return;
    }
    let plugins: LaunchPlugins = { paths: [], off: [] };
    if (this.deps.launchPlugins) {
      try {
        plugins = await this.deps.launchPlugins();
      } catch (e) {
        this.emit("event", { kind: "command_output", text: `Plugins couldn't be loaded: ${errorMessage(e)}`, notice: true });
      }
    }
    this.stopping = false;
    this.input = new AsyncQueue<SDKUserMessage>();
    const options: Options = {
      cwd: this.agent.folder,
      permissionMode: this.project.permissionMode,
      systemPrompt: {
        type: "preset", preset: "claude_code",
        append: buildLaunchPrompt(this.project, this.agent, this.team, this.deps.shareDir, opts.shellContext),
      },
      extraArgs: { name: this.agent.name },
      additionalDirectories: [this.deps.shareDir],
      mcpServers: { squad: this.deps.mcpServer },
      allowedTools: SQUAD_TOOLS,
      plugins: [{ type: "local", path: this.deps.kitPluginPath }, ...plugins.paths.map((path) => ({ type: "local" as const, path }))],
      includePartialMessages: true,
      canUseTool: (toolName, input, opts) => this.askUser(toolName, input, opts.suggestions, opts.signal),
    };
    if (plugins.off.length) options.settings = { enabledPlugins: Object.fromEntries(plugins.off.map((id) => [id, false])) };
    this.launchedPlugins = plugins;
    if (this.agent.sessionId) options.resume = this.agent.sessionId;
    this.resumedFrom = this.agent.sessionId;
    if (this.agent.model) options.model = this.agent.model;
    if (this.agent.effort) options.effort = this.agent.effort;
    const q = this.deps.queryFactory({ prompt: this.input, options });
    this.query = q;
    this.setStatus("starting");
    // Ready once Claude Code has started. Its first system message only comes with the first prompt, so waiting for
    // that left summoned squadmates "starting" until a summon timed out.
    q.initializationResult().then(
      (init) => {
        if (this.query !== q) return;
        const pid = (init as { pid?: unknown } | undefined)?.pid;
        this.setCommands((init as { commands?: unknown } | undefined)?.commands);
        if (typeof pid === "number") this.sessionPid = pid;
        if (this.state.status === "starting") this.setStatus("idle");
      },
      () => {}, // a failed start ends the session, which consume() reports
    );
    void this.consume(q);
  }

  private async consume(q: Query): Promise<void> {
    let failure: string | undefined;
    try {
      for await (const m of q) {
        if (this.query !== q) break; // stopped or replaced: ignore anything the old session still sends
        this.handle(m as SdkMsg);
      }
    } catch (e) {
      failure = errorMessage(e);
    }
    if (this.query !== q) return; // a newer session replaced this one
    this.query = null;
    this.launchedPlugins = null;
    this.input = null;
    this.sessionPid = null;
    this.denyAll();
    if (this.stopping) this.setStatus("stopped");
    else this.setStatus("error", failure ?? "Session ended");
  }

  private handle(m: SdkMsg): void {
    if (m.type === "system" && m.subtype === "init") {
      if (m.session_id) this.emit("session", m.session_id);
      if (this.state.status === "starting") this.setStatus("idle");
    } else if (m.type === "system" && m.subtype === "commands_changed") {
      this.setCommands((m as { commands?: unknown }).commands);
    } else if (m.type === "command_lifecycle" && m.state === "started" && this.state.status === "idle") {
      this.setStatus("working");
    }
    for (const ev of normalise(m)) this.emit("event", ev);
    if (m.type === "rate_limit_event") this.emit("rateLimit", m.rate_limit_info);
    if (m.type === "system" && m.subtype === "compact_boundary") void this.refreshContext();
    if (m.type === "result") {
      const sessionId = m.session_id ?? "";
      const result: TurnResult = { sessionId, modelUsage: m.modelUsage, resumed: sessionId === this.resumedFrom };
      this.emit("result", result);
      if (this.pending.size === 0) this.setStatus("idle");
      void this.refreshContext();
    }
  }

  private async refreshContext(): Promise<void> {
    try {
      const q = this.query;
      const u = await q?.getContextUsage({ detail: "summary" });
      // The session may have stopped or been replaced while the reading was in flight.
      if (q && q === this.query && u && typeof u.percentage === "number") {
        this.state = { ...this.state, contextPct: Math.round(u.percentage) };
        this.emit("status", this.state);
      }
    } catch {}
  }

  private askUser(
    toolName: string, input: Record<string, unknown>, suggestions: PermissionUpdate[] | undefined, signal: AbortSignal,
  ): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const approval: Approval = {
        id: randomUUID(), agentId: this.agent.id, toolName, input,
        summary: summariseTool(toolName, input), canAlways: Boolean(suggestions?.length),
      };
      const questions = toolName === ASK_TOOL ? askQuestions(input) : undefined;
      if (questions) approval.questions = questions;
      this.pending.set(approval.id, { approval, input, suggestions, resolve });
      signal.addEventListener("abort", () => this.resolveApproval(approval.id, "deny"), { once: true });
      this.setStatus("awaiting");
      this.emit("approval", approval);
    });
  }

  private resolveApproval(id: string, decision: ApprovalDecision, answers?: QuestionAnswers): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    const asking = Boolean(p.approval.questions);
    if (asking && decision !== "deny" && answers && Object.keys(answers).length) {
      p.resolve({ behavior: "allow", updatedInput: { ...p.input, answers } });
    } else if (decision === "deny" || asking) p.resolve({ behavior: "deny", message: asking ? SKIP_MESSAGE : DENY_MESSAGE });
    else if (decision === "always") p.resolve({ behavior: "allow", updatedInput: p.input, updatedPermissions: p.suggestions ?? [] });
    else p.resolve({ behavior: "allow", updatedInput: p.input });
    this.emit("approvalResolved", id);
    return true;
  }

  /** `answers` answers an AskUserQuestion approval; without them, that approval is skipped. */
  answer(approvalId: string, decision: ApprovalDecision, answers?: QuestionAnswers): void {
    if (this.resolveApproval(approvalId, decision, answers) && this.pending.size === 0 && this.state.status === "awaiting") {
      this.setStatus("working");
    }
  }

  private denyAll(): void {
    for (const id of [...this.pending.keys()]) this.resolveApproval(id, "deny");
  }

  /** A message from the user. `$ cmd` runs here; `!cmd` asks the squadmate to run it. */
  async send(text: string, images: string[] = []): Promise<void> {
    const shell = parseShellInput(text);
    if (shell?.mode === "run") {
      this.runShellCommand(shell.command);
      return;
    }
    if (!this.query) await this.launch();
    if (!this.input) return;
    const body = shell ? agentShellPrompt(shell.command) : text;
    // A slash command must start the message to work, so queued output waits for the next one.
    const context = body.startsWith("/") ? [] : this.takeShellContext();
    this.input.push(userMessage(context.length ? `${context.join("\n")}\n\n${body}` : body, images));
    this.emit("event", { kind: "user_text", text, ...(images.length ? { images } : {}) });
    if (this.state.status !== "awaiting") this.setStatus("working");
  }

  /** Runs a `$ cmd` in the squadmate's folder, streaming it as shell events; returns its id. */
  runShellCommand(command: string): string {
    const id = randomUUID();
    const generation = this.shellGeneration;
    // Only the tail of each stream reaches the squadmate, so only the tail is kept.
    const out = { stdout: "", stderr: "" };
    const omitted = { stdout: 0, stderr: 0 };
    // Output is batched so a fast command sends a few events a second, not one per chunk.
    let pending: ShellChunk[] = [];
    let timer: NodeJS.Timeout | null = null;
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      for (const c of pending) this.emit("event", { kind: "shell_output", id, stream: c.stream, text: c.text });
      pending = [];
    };
    let ended = false;
    const shell = userShell();
    const start: ShellEvent = { kind: "shell", id, command, chunks: [], running: true, code: null, signal: null, shellName: shell.name };
    this.snapshots.set(id, start);
    this.emit("event", start);
    const handle = (this.deps.runShell ?? runShell)(command, this.agent.folder, {
      onChunk: (stream, text) => {
        const all = out[stream] + text;
        const drop = Math.max(0, all.length - SHELL_CONTEXT_CAP);
        out[stream] = all.slice(drop);
        omitted[stream] += drop;
        const snap = this.snapshots.get(id);
        if (snap) this.snapshots.set(id, { ...snap, chunks: appendShellOutput(snap.chunks, stream, text) });
        pending = appendShellOutput(pending, stream, text);
        timer ??= setTimeout(flush, SHELL_FLUSH_MS);
      },
      onEnd: (code, signal) => {
        ended = true;
        flush();
        this.shells.delete(id);
        if (generation === this.shellGeneration) {
          this.shellContext.push(bashContextBlock({ command, ...out, code, signal, omitted }));
          const snap = this.snapshots.get(id);
          if (snap) this.snapshots.set(id, { ...snap, running: false, code, signal });
        } else {
          this.snapshots.delete(id); // cleared or delivered while it ran: nothing left to show or hand over
        }
        this.emit("event", { kind: "shell_end", id, code, signal });
      },
    }, shell);
    if (!ended) this.shells.set(id, handle);
    return id;
  }

  killShell(id: string): void {
    this.shells.get(id)?.kill();
  }

  /** `force` kills at once rather than after a grace period, for when Squad is shutting down. */
  killAllShells(force = false): void {
    for (const h of this.shells.values()) h.kill(force);
  }

  /** Running and undelivered `$ cmd` blocks, for a page that subscribes after they started. */
  shellSnapshots(): AgentEvent[] {
    return [...this.snapshots.values()];
  }

  /** Finished `$ cmd` blocks not yet delivered, which are now the caller's to deliver. */
  takeShellContext(): string[] {
    const blocks = this.shellContext;
    this.shellContext = [];
    this.forgetFinishedSnapshots();
    return blocks;
  }

  /** Drops undelivered output, including that of commands still running. */
  discardShellContext(): void {
    this.shellContext = [];
    this.shellGeneration++;
    this.snapshots.clear();
  }

  private forgetFinishedSnapshots(): void {
    for (const [id, e] of this.snapshots) if (!e.running) this.snapshots.delete(id);
  }

  async compact(): Promise<void> {
    if (!this.input) return;
    this.input.push(userMessage("/compact"));
    this.setStatus("working");
  }

  async interrupt(): Promise<void> {
    await this.query?.interrupt();
  }

  async stop(): Promise<void> {
    const q = this.query;
    if (!q) return;
    this.stopping = true;
    this.query = null;
    this.launchedPlugins = null;
    this.sessionPid = null;
    this.denyAll();
    this.input?.end();
    this.input = null;
    q.close();
    this.setStatus("stopped");
  }

  /** Resolves once the session has left "starting", whether it came up, failed or was stopped. */
  waitUntilStarted(timeoutMs: number): Promise<AgentStatus> {
    if (this.state.status !== "starting") return Promise.resolve(this.state.status);
    return new Promise((resolve) => {
      const onStatus = (s: AgentState) => {
        if (s.status === "starting") return;
        clearTimeout(timer);
        this.off("status", onStatus);
        resolve(s.status);
      };
      const timer = setTimeout(() => {
        this.off("status", onStatus);
        resolve(this.state.status);
      }, timeoutMs);
      this.on("status", onStatus);
    });
  }

  waitUntilReady(timeoutMs: number): Promise<AgentStatus> {
    const ready = (s: AgentStatus) => s !== "starting" && s !== "stopped";
    if (ready(this.state.status)) return Promise.resolve(this.state.status);
    return new Promise((resolve) => {
      const onStatus = (s: AgentState) => {
        if (!ready(s.status)) return;
        clearTimeout(timer);
        this.off("status", onStatus);
        resolve(s.status);
      };
      const timer = setTimeout(() => {
        this.off("status", onStatus);
        resolve(this.state.status);
      }, timeoutMs);
      this.on("status", onStatus);
    });
  }
}
