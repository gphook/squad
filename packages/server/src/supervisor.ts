import { EventEmitter } from "node:events";
import { copyFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import {
  errorMessage, firstLine, isExternalUrl, shareFileName,
  type AgentAction, type AgentEvent, type AgentState, type Approval, type ApprovalDecision, type LoggedMessage, type SharedFile,
} from "@squad/shared";
import { shareDir } from "./paths.ts";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { AgentRunner, type QueryFactory, type TurnResult } from "./runner.ts";
import { resolveInside } from "./safePath.ts";
import { createSquadTools } from "./squadTools.ts";
import { turnRows } from "./turnUsage.ts";
import type { Store } from "./store.ts";

const SUMMON_TIMEOUT_MS = 60_000;
const PEER_MATCH_WINDOW_MS = 60_000;

/**
 * Owns every AgentRunner. Events, each with projectId first:
 * "status"(p, AgentState) "event"(p, agentId, AgentEvent) "approval"(p, Approval) "approvalResolved"(p, id)
 * "message"(p, LoggedMessage) "share"(p, SharedFile) "shareRemoved"(p, id)
 * "usage"(p) after a turn's usage is stored, "turnEnd"() after any turn, "rateLimit"(rate_limit_info).
 */
export class Supervisor extends EventEmitter {
  private runners = new Map<string, AgentRunner>();
  private recentOutbound: { to: string; from: string; at: number }[] = [];

  constructor(
    private store: Store,
    private queryFactory: QueryFactory,
    private kitPluginPath: string,
  ) {
    super();
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
    });
    r.on("status", (s: AgentState) => this.emit("status", pid, s));
    r.on("approval", (a: Approval) => this.emit("approval", pid, a));
    r.on("approvalResolved", (id: string) => this.emit("approvalResolved", pid, id));
    r.on("session", (sid: string) => this.store.setSessionId(agentId, sid));
    r.on("event", (ev: AgentEvent) => this.onEvent(pid, agentId, nameOf, ev));
    r.on("result", (res: TurnResult) => this.recordUsage(pid, agentId, res));
    r.on("rateLimit", (info: unknown) => this.emit("rateLimit", info));
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
  private onEvent(projectId: string, agentId: string, nameOf: () => string, ev: AgentEvent): void {
    this.emit("event", projectId, agentId, ev);
    if (ev.kind !== "peer_out" && ev.kind !== "peer_in") return;
    const agentName = nameOf();
    if (ev.kind === "peer_out") {
      this.logMessage({ projectId, from: agentName, to: ev.to, text: ev.text, at: Date.now(), external: false });
      this.recentOutbound.push({ from: agentName, to: ev.to, at: Date.now() });
      const target = this.store.getAgentByName(projectId, ev.to);
      if (target) this.emit("event", projectId, target.id, { kind: "peer_in", from: agentName, text: ev.text });
    } else if (ev.kind === "peer_in") {
      const now = Date.now();
      this.recentOutbound = this.recentOutbound.filter((o) => now - o.at < PEER_MATCH_WINDOW_MS);
      const matched = this.recentOutbound.some((o) => o.from === ev.from && o.to === agentName);
      if (!matched) this.logMessage({ projectId, from: ev.from, to: agentName, text: ev.text, at: now, external: true });
    }
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

  async send(agentId: string, text: string, images?: string[]): Promise<void> {
    await this.runner(agentId).send(text, images);
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
