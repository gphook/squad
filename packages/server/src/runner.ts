import { EventEmitter } from "node:events";
import { statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  McpServerConfig, Options, PermissionResult, PermissionUpdate, Query, SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  SQUAD_TOOL_NAMES, SQUAD_TOOL_PREFIX, errorMessage,
  type Agent, type AgentState, type AgentStatus, type Approval, type ApprovalDecision, type Project,
} from "@squad/shared";
import { AsyncQueue } from "./inputQueue.ts";
import { buildLaunchPrompt } from "./launchPrompt.ts";
import { normalise, summariseTool, type SdkMsg } from "./normalise.ts";

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
  shareDir: string;
}

interface Pending {
  approval: Approval;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  resolve: (r: PermissionResult) => void;
}

const DENY_MESSAGE = "Denied by user in Squad";
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
 * "result"({ sessionId, modelUsage, resumed }) "rateLimit"(rate_limit_info).
 */
export class AgentRunner extends EventEmitter {
  state: AgentState;
  private query: Query | null = null;
  private input: AsyncQueue<SDKUserMessage> | null = null;
  private pending = new Map<string, Pending>();
  private stopping = false;
  /** The session id this launch resumed, to tell a resumed session's first turn from a new one. */
  private resumedFrom: string | null = null;

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

  async launch(): Promise<void> {
    if (this.query) return;
    let isDir = false;
    try {
      isDir = statSync(this.agent.folder).isDirectory();
    } catch {}
    if (!isDir) {
      this.setStatus("error", `Folder not found: ${this.agent.folder}`);
      return;
    }
    this.stopping = false;
    this.input = new AsyncQueue<SDKUserMessage>();
    const options: Options = {
      cwd: this.agent.folder,
      permissionMode: this.project.permissionMode,
      systemPrompt: {
        type: "preset", preset: "claude_code",
        append: buildLaunchPrompt(this.project, this.agent, this.team, this.deps.shareDir),
      },
      extraArgs: { name: this.agent.name },
      additionalDirectories: [this.deps.shareDir],
      mcpServers: { squad: this.deps.mcpServer },
      allowedTools: SQUAD_TOOLS,
      plugins: [{ type: "local", path: this.deps.kitPluginPath }],
      includePartialMessages: true,
      canUseTool: (toolName, input, opts) => this.askUser(toolName, input, opts.suggestions, opts.signal),
    };
    if (this.agent.sessionId) options.resume = this.agent.sessionId;
    this.resumedFrom = this.agent.sessionId;
    if (this.agent.model) options.model = this.agent.model;
    this.query = this.deps.queryFactory({ prompt: this.input, options });
    this.setStatus("starting");
    void this.consume(this.query);
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
    this.input = null;
    this.denyAll();
    if (this.stopping) this.setStatus("stopped");
    else this.setStatus("error", failure ?? "Session ended");
  }

  private handle(m: SdkMsg): void {
    if (m.type === "system" && m.subtype === "init") {
      if (m.session_id) this.emit("session", m.session_id);
      if (this.state.status === "starting") this.setStatus("idle");
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
      this.pending.set(approval.id, { approval, input, suggestions, resolve });
      signal.addEventListener("abort", () => this.resolveApproval(approval.id, "deny"), { once: true });
      this.setStatus("awaiting");
      this.emit("approval", approval);
    });
  }

  private resolveApproval(id: string, decision: ApprovalDecision): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    if (decision === "deny") p.resolve({ behavior: "deny", message: DENY_MESSAGE });
    else if (decision === "always") p.resolve({ behavior: "allow", updatedInput: p.input, updatedPermissions: p.suggestions ?? [] });
    else p.resolve({ behavior: "allow", updatedInput: p.input });
    this.emit("approvalResolved", id);
    return true;
  }

  answer(approvalId: string, decision: ApprovalDecision): void {
    if (this.resolveApproval(approvalId, decision) && this.pending.size === 0 && this.state.status === "awaiting") {
      this.setStatus("working");
    }
  }

  private denyAll(): void {
    for (const id of [...this.pending.keys()]) this.resolveApproval(id, "deny");
  }

  async send(text: string, images: string[] = []): Promise<void> {
    if (!this.query) await this.launch();
    if (!this.input) return;
    this.input.push(userMessage(text, images));
    this.emit("event", { kind: "user_text", text, ...(images.length ? { images } : {}) });
    if (this.state.status !== "awaiting") this.setStatus("working");
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
    this.denyAll();
    this.input?.end();
    this.input = null;
    q.close();
    this.setStatus("stopped");
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
