import { EventEmitter } from "node:events";
import { copyFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import {
  errorMessage, firstLine, isExternalUrl, parseSlashCommand, routeCommand, shareFileName, SQUAD_COMMANDS, isUnavailableCommand,
  type SlashCommandInfo,
  type AgentAction, type AgentEvent, type AgentState, type AuthStatus, type Approval, type ApprovalDecision, type LoggedMessage, type SharedFile,
} from "@squad/shared";
import { shareDir } from "./paths.ts";
import { renamePeers } from "./normalise.ts";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { AgentRunner, type QueryFactory, type TurnResult } from "./runner.ts";
import { resolveInside } from "./safePath.ts";
import { formatSkills } from "./skillsList.ts";
import { createSquadTools } from "./squadTools.ts";
import { turnRows } from "./turnUsage.ts";
import type { Store } from "./store.ts";

const SUMMON_TIMEOUT_MS = 60_000;
const PEER_MATCH_WINDOW_MS = 60_000;

/**
 * Owns every AgentRunner. Events, each with projectId first:
 * "status"(p, AgentState) "event"(p, agentId, AgentEvent) "approval"(p, Approval) "approvalResolved"(p, id)
 * "message"(p, LoggedMessage) "share"(p, SharedFile) "shareRemoved"(p, id)
 * "usage"(p) after a turn's usage is stored, "turnEnd"() after any turn, "rateLimit"(rate_limit_info),
 * "commands"(p, agentId, SlashCommandInfo[]) when a squadmate's command list changes.
 */
export interface AuthSource {
  current: AuthStatus | null;
  refresh(): Promise<AuthStatus>;
}

/** A Claude Code cross-session address, e.g. `uds:/run/user/1000/cc-socks/574797.sock`, and the pid in it. */
const SOCKET_PID_RE = /^uds:.*\/(\d+)\.sock$/;

export class Supervisor extends EventEmitter {
  private auth: AuthSource | null = null;
  private runners = new Map<string, AgentRunner>();
  private recentOutbound: { to: string; from: string; at: number }[] = [];

  constructor(
    private store: Store,
    private queryFactory: QueryFactory,
    private kitPluginPath: string,
  ) {
    super();
  }

  /** Where the Claude account is read from; launches are refused while it says signed out. */
  setAuth(auth: AuthSource): void {
    this.auth = auth;
  }

  /** Signed out, checked again first: the cached status may predate a sign-in in a terminal. */
  private async isSignedOut(): Promise<boolean> {
    if (this.auth?.current?.state !== "signedOut") return false;
    return (await this.auth.refresh()).state === "signedOut";
  }

  /** The runner for an agent, created on first use and refreshed with current store data. */
  runner(agentId: string): AgentRunner {
    const agent = this.store.getAgent(agentId);
    if (!agent) throw new Error(`Unknown agent ${agentId}`);
    const project = this.store.getProject(agent.projectId)!;
    const team = this.store.listAgents(project.id);
    let r = this.runners.get(agentId);
    if (r) {
      if (!r.running) r.update(project, agent, team);
      return r;
    }
    const pid = project.id;
    const nameOf = () => this.store.getAgent(agentId)?.name ?? agent.name; // follows renames
    r = new AgentRunner(project, agent, team, {
      queryFactory: this.queryFactory,
      mcpServer: createSquadTools(this, pid, nameOf),
      kitPluginPath: this.kitPluginPath,
      shareDir: shareDir(pid),
      signedOut: () => this.isSignedOut(),
    });
    r.on("status", (s: AgentState) => {
      this.emit("status", pid, s);
      // A failed start may mean the sign-in expired; check so the top bar says so.
      if (s.status === "error") void this.auth?.refresh();
    });
    r.on("approval", (a: Approval) => this.emit("approval", pid, a));
    r.on("approvalResolved", (id: string) => this.emit("approvalResolved", pid, id));
    r.on("session", (sid: string) => this.store.setSessionId(agentId, sid));
    r.on("event", (ev: AgentEvent) => this.onEvent(pid, agentId, nameOf, ev));
    r.on("result", (res: TurnResult) => this.recordUsage(pid, agentId, res));
    r.on("rateLimit", (info: unknown) => this.emit("rateLimit", info));
    r.on("commands", () => this.emit("commands", pid, agentId, this.commands(agentId)));
    this.runners.set(agentId, r);
    return r;
  }

  /** Stores this turn's usage, worked out from the session's running totals and the stored baseline. */
  private recordUsage(projectId: string, agentId: string, res: TurnResult): void {
    try {
      const baseline = this.store.getUsageBaseline(agentId);
      const prev = baseline?.sessionId === res.sessionId ? baseline.totals : res.resumed ? null : {};
      const { rows, totals } = turnRows(res.modelUsage, prev);
      this.store.setUsageBaseline(agentId, res.sessionId, totals);
      if (rows.length) {
        this.store.addUsageTurn({ projectId, agentId, at: Date.now(), rows });
        this.emit("usage", projectId);
      }
    } catch (e) {
      // Usage accounting must never take an agent's session down.
      console.error(`Squad: couldn't record usage for agent ${agentId}: ${errorMessage(e)}`);
    }
    this.emit("turnEnd");
  }

  /** A running agent's query, to read plan usage without starting a session. */
  usageSource(): Query | null {
    for (const r of this.runners.values()) if (r.usageSource) return r.usageSource;
    return null;
  }

  /** `nameOf` is a lookup, called only for peer messages so streamed tokens don't each query the store. */
  private onEvent(projectId: string, agentId: string, nameOf: () => string, raw: AgentEvent): void {
    const mayName = raw.kind === "peer_out" || (raw.kind === "tool_use" && raw.name === "SendMessage");
    const ev = mayName ? renamePeers([raw], (address) => this.squadmateAt(projectId, address))[0] : raw;
    this.emit("event", projectId, agentId, ev);
    if (ev.kind !== "peer_out" && ev.kind !== "peer_in") return;
    const agentName = nameOf();
    if (ev.kind === "peer_out") {
      const to = ev.to; // already a name when the address is known (renamePeers above)
      this.logMessage({ projectId, from: agentName, to, text: ev.text, at: Date.now(), external: false });
      this.recentOutbound.push({ from: agentName, to, at: Date.now() });
      const target = this.store.getAgentByName(projectId, to);
      if (target) this.emit("event", projectId, target.id, { kind: "peer_in", from: agentName, text: ev.text });
    } else if (ev.kind === "peer_in") {
      const now = Date.now();
      this.recentOutbound = this.recentOutbound.filter((o) => now - o.at < PEER_MATCH_WINDOW_MS);
      const matched = this.recentOutbound.some((o) => o.from === ev.from && o.to === agentName);
      if (!matched) this.logMessage({ projectId, from: ev.from, to: agentName, text: ev.text, at: now, external: true });
    }
  }

  /** The squadmate whose Claude Code session owns this cross-session address (its socket is named after its pid). */
  private squadmateAt(projectId: string, address: string): string | undefined {
    const pid = Number(SOCKET_PID_RE.exec(address)?.[1]);
    if (!pid) return undefined;
    return this.store.listAgents(projectId).find((a) => this.runners.get(a.id)?.sessionPid === pid)?.name;
  }

  private logMessage(m: Omit<LoggedMessage, "id">): void {
    this.emit("message", m.projectId, this.store.addMessage(m));
  }

  states(projectId: string): AgentState[] {
    return this.store.listAgents(projectId).map((a) => this.runners.get(a.id)?.state ?? { agentId: a.id, status: "stopped" });
  }

  pendingApprovals(projectId: string): Approval[] {
    const ids = new Set(this.store.listAgents(projectId).map((a) => a.id));
    return [...this.runners.entries()].filter(([id]) => ids.has(id)).flatMap(([, r]) => r.pendingApprovals());
  }

  answer(approvalId: string, decision: ApprovalDecision): void {
    for (const r of this.runners.values()) {
      if (r.pendingApprovals().some((a) => a.id === approvalId)) return r.answer(approvalId, decision);
    }
  }

  /** What the picker offers: Squad's own commands, then the session's, without the ones Squad won't run. */
  commands(agentId: string): SlashCommandInfo[] {
    const own = new Set(SQUAD_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]));
    const session = (this.runners.get(agentId)?.commands ?? []).filter((c) => !own.has(c.name) && !isUnavailableCommand(c.name));
    return [...SQUAD_COMMANDS, ...session];
  }

  /** Lists the squadmate's skills in its pane, launching it first if it's stopped (as any message would). */
  private async showSkills(r: AgentRunner, show: (ev: AgentEvent) => void): Promise<void> {
    if (!r.running) {
      await r.launch();
      await r.waitUntilStarted(SUMMON_TIMEOUT_MS);
      // A failed launch shows in the status; a Stop or Clear while starting means the list isn't wanted.
      if (!r.running || r.state.status === "error") return;
    }
    try {
      show({ kind: "command_output", text: formatSkills(await r.skills()) });
    } catch (e) {
      show({ kind: "command_output", text: `\`/skills\` couldn't list skills: ${errorMessage(e)}`, notice: true });
    }
  }

  /** A message from the user. `/` commands Squad owns run here, so the session never changes behind its back. */
  async send(agentId: string, text: string, images?: string[]): Promise<void> {
    const r = this.runner(agentId);
    const cmd = images?.length ? null : parseSlashCommand(text);
    const route = cmd ? routeCommand(cmd.name, r.commands) : { kind: "sdk" as const };
    const show = (ev: AgentEvent) => this.emit("event", this.store.getAgent(agentId)!.projectId, agentId, ev);
    switch (route.kind) {
      case "sdk":
        return r.send(text, images);
      case "clear":
        return this.action(agentId, "clear");
      case "stop":
        show({ kind: "user_text", text });
        if (r.running) await r.stop();
        return;
      case "plugins": // the page that typed it opens the Plugins view (see app.ts)
        show({ kind: "user_text", text });
        show({ kind: "command_output", text: `Opened Plugins for ${this.store.getAgent(agentId)!.name}.`, notice: true });
        return;
      case "skills":
        show({ kind: "user_text", text });
        return this.showSkills(r, show);
      case "notice":
        show({ kind: "user_text", text });
        show({ kind: "command_output", text: route.text, notice: true });
        return;
    }
  }

  async action(agentId: string, action: AgentAction): Promise<void> {
    const r = this.runner(agentId);
    switch (action) {
      case "launch": return r.launch();
      case "stop": return r.stop();
      case "interrupt": return r.interrupt();
      case "compact": return r.compact();
      case "clear": {
        await r.stop();
        r.killAllShells();
        r.discardShellContext();
        const agent = this.store.getAgent(agentId)!;
        this.store.setSessionId(agentId, null);
        for (const s of this.store.sharesFrom(agent.projectId, agent.name)) await this.removeShare(s.id);
        this.runner(agentId); // refresh with the cleared session id
        this.emit("event", agent.projectId, agentId, { kind: "cleared" } satisfies AgentEvent);
        return;
      }
    }
  }

  shellSnapshots(agentId: string): AgentEvent[] {
    return this.runners.get(agentId)?.shellSnapshots() ?? [];
  }

  killShell(agentId: string, id: string): void {
    this.runners.get(agentId)?.killShell(id);
  }

  /** Clears every squadmate in the project (as Clear does), and the project's message log. */
  async clearAll(projectId: string): Promise<void> {
    await Promise.all(this.store.listAgents(projectId).map((a) => this.action(a.id, "clear")));
    this.store.deleteMessages(projectId);
  }

  /** Forget an agent's runner (after it is deleted). */
  async forget(agentId: string): Promise<void> {
    this.runners.get(agentId)?.killAllShells();
    await this.runners.get(agentId)?.stop();
    this.runners.delete(agentId);
  }

  teamSummary(projectId: string, callerName: string): string {
    const states = new Map(this.states(projectId).map((s) => [s.agentId, s.status]));
    const activities = this.store.getProject(projectId)?.activities ?? [];
    return this.store.listAgents(projectId)
      .map((a) => {
        const owns = activities.filter((x) => x.ownerId === a.id).map((x) => x.name);
        const ownsText = owns.length ? ` — owns: ${owns.join(", ")}` : "";
        return `- ${a.name}${a.name === callerName ? " (you)" : ""}: ${firstLine(a.role)}${ownsText} — ${states.get(a.id)}`;
      })
      .join("\n");
  }

  async summon(projectId: string, callerName: string, targetName: string): Promise<string> {
    if (targetName === callerName) return `You are ${callerName}`;
    const target = this.store.getAgentByName(projectId, targetName);
    if (!target) return `No agent named ${targetName} in this project`;
    const r = this.runner(target.id);
    if (r.running) return `${targetName} is already running (${r.state.status})`;
    // Output from the user's `$ cmd`s would otherwise wait for their next message.
    await r.launch({ shellContext: r.takeShellContext() });
    const status = await r.waitUntilReady(SUMMON_TIMEOUT_MS);
    if (status === "error") return `${targetName} failed to start: ${r.state.error ?? "unknown error"}`;
    return `${targetName} is running; message it with SendMessage to "${targetName}"`;
  }

  async share(
    projectId: string, fromName: string, input: { path?: string; text?: string; to: string[]; note: string },
  ): Promise<SharedFile> {
    const meta = { from: fromName, to: input.to, note: input.note };
    if (input.path) {
      const dir = shareDir(projectId);
      const owner = this.store.getAgentByName(projectId, fromName);
      const src = resolveInside(owner ? [owner.folder, dir] : [dir], input.path, owner?.folder ?? dir);
      if (!src || !statSync(src).isFile()) throw new Error("Path not allowed");
      return this.recordShare(projectId, basename(src), (dest) => copyFileSync(src, dest), meta);
    }
    if (input.text !== undefined) {
      return this.recordShare(projectId, "message.md", (dest) => writeFileSync(dest, input.text!), meta);
    }
    throw new Error("Give either path or text");
  }

  /** A file the user dropped into the Shared files panel. */
  async shareUpload(projectId: string, filename: string, data: Buffer, to: string[], note: string): Promise<SharedFile> {
    return this.recordShare(projectId, basename(filename), (dest) => writeFileSync(dest, data), { from: "user", to, note });
  }

  /** Writes a file into the share folder as `<id>-<name>`, records it and announces it. */
  private recordShare(
    projectId: string, name: string, write: (dest: string) => void, meta: { from: string; to: string[]; note: string },
  ): SharedFile {
    const id = randomUUID();
    const dest = join(shareDir(projectId), shareFileName(id, name));
    write(dest);
    const s = this.store.addShare({
      id, projectId, fromAgent: meta.from, to: meta.to, note: meta.note, path: dest, size: statSync(dest).size, at: Date.now(),
    });
    this.emit("share", projectId, s);
    return s;
  }

  async removeShare(shareId: string): Promise<void> {
    const s = this.store.removeShare(shareId);
    if (!s) return;
    if (resolveInside([shareDir(s.projectId)], s.path)) rmSync(s.path, { force: true });
    this.emit("shareRemoved", s.projectId, shareId);
  }

  /** Roots an agent's files may be served from: every agent folder in the project plus its share folder. */
  fileRoots(projectId: string): string[] {
    return [...this.store.listAgents(projectId).map((a) => a.folder), shareDir(projectId)];
  }

  canShow(projectId: string, agentName: string, target: string): boolean {
    if (isExternalUrl(target)) return true;
    const agent = this.store.getAgentByName(projectId, agentName);
    return resolveInside(this.fileRoots(projectId), target, agent?.folder) !== null;
  }

  async stopAll(): Promise<void> {
    // Commands run in their own process group, so nothing else stops them when Squad exits.
    for (const r of this.runners.values()) r.killAllShells(true);
    await Promise.all([...this.runners.values()].map((r) => r.stop()));
  }
}
