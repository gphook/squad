import {
  MAX_EVENTS, defaultLayout,
  type Agent, type AgentEvent, type AgentState, type Approval, type Layout, type LoggedMessage, type Project,
  type AuthStatus, type ModelOption, type PlanUsage, type ServerMsg, type SharedFile, appendShellOutput,
} from "@squad/shared";
import { pruneLayout } from "./layout.ts";

export interface UiState {
  projects: Project[];
  projectId: string | null;
  agents: Agent[];
  states: Record<string, AgentState>;
  events: Record<string, AgentEvent[]>;
  approvals: Approval[];
  messages: LoggedMessage[];
  shares: SharedFile[];
  /** Account-wide plan limits: kept when the project changes. */
  plan: PlanUsage | null;
  /** The account's models: undefined until asked for, null when they couldn't be loaded. */
  models: ModelOption[] | null | undefined;
  /** The Claude account squadmates run on; null until the server says. */
  auth: AuthStatus | null;
  error: string | null;
}

export function emptyState(): UiState {
  return {
    projects: [], projectId: null, agents: [], states: {}, events: {},
    approvals: [], messages: [], shares: [], plan: null, models: undefined, auth: null, error: null,
  };
}

/** Fresh state for another project, keeping what isn't tied to a project. */
export function forProject(s: UiState, projectId: string): UiState {
  return { ...emptyState(), projects: s.projects, plan: s.plan, models: s.models, auth: s.auth, projectId };
}

type ShellEvent = Extract<AgentEvent, { kind: "shell" }>;

/** Streams a `$ cmd`'s output and end into its shell event; anything for an unknown block is dropped. */
function foldShell(list: AgentEvent[], ev: Extract<AgentEvent, { kind: "shell_output" | "shell_end" }>): AgentEvent[] {
  const i = list.findLastIndex((e) => e.kind === "shell" && e.id === ev.id);
  if (i < 0) return list;
  const block = list[i] as ShellEvent;
  const next: ShellEvent = ev.kind === "shell_output"
    ? { ...block, chunks: appendShellOutput(block.chunks, ev.stream, ev.text) }
    : { ...block, running: false, code: ev.code, signal: ev.signal };
  return list.with(i, next);
}

function addEvent(list: AgentEvent[] = [], ev: AgentEvent): AgentEvent[] {
  if (ev.kind === "shell_output" || ev.kind === "shell_end") return foldShell(list, ev);
  if (ev.kind === "cleared") return [ev]; // the old conversation is gone from the squadmate; so it goes from view
  const last = list.at(-1);
  if (ev.kind === "text_delta" && last?.kind === "text_delta") {
    return [...list.slice(0, -1), { kind: "text_delta", text: last.text + ev.text }];
  }
  if (ev.kind === "assistant_text" && last?.kind === "text_delta") return [...list.slice(0, -1), ev];
  const next = [...list, ev];
  return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
}

/**
 * The layout lives on its project; this reads it for the selected one, without tiles of squadmates that no longer
 * exist (so nothing built on it saves a deleted squadmate back, or treats one as maximised).
 */
export function currentLayout(s: UiState): Layout {
  const layout = s.projects.find((p) => p.id === s.projectId)?.layout ?? defaultLayout();
  return pruneLayout(layout, s.agents.map((a) => a.id));
}

export function withLayout(s: UiState, projectId: string, layout: Layout): UiState {
  return { ...s, projects: s.projects.map((p) => (p.id === projectId ? { ...p, layout } : p)) };
}

export function reduce(s: UiState, m: ServerMsg): UiState {
  switch (m.t) {
    case "projects":
      return { ...s, projects: m.projects };
    case "state":
      if (m.projectId !== s.projectId) return s;
      return {
        ...s,
        agents: m.agents,
        states: Object.fromEntries(m.states.map((st) => [st.agentId, st])),
        approvals: m.approvals,
        messages: m.messages,
        shares: m.shares,
      };
    case "agent.status":
      return { ...s, states: { ...s.states, [m.state.agentId]: m.state } };
    case "agent.event":
      return { ...s, events: { ...s.events, [m.agentId]: addEvent(s.events[m.agentId], m.event) } };
    case "agent.history": {
      // `$ cmd` blocks that arrived live while history loaded are kept unless history has them too.
      const incoming = m.events.filter((e) => e.kind !== "text_delta");
      const have = new Set(incoming.flatMap((e) => (e.kind === "shell" ? [e.id] : [])));
      const live = (s.events[m.agentId] ?? []).filter((e) => e.kind === "shell" && !e.id.startsWith("hist-") && !have.has(e.id));
      return { ...s, events: { ...s.events, [m.agentId]: [...incoming, ...live] } };
    }
    case "approval.request":
      return s.approvals.some((a) => a.id === m.approval.id) ? s : { ...s, approvals: [...s.approvals, m.approval] };
    case "approval.resolved":
      return { ...s, approvals: s.approvals.filter((a) => a.id !== m.approvalId) };
    case "message.logged":
      return { ...s, messages: [...s.messages, m.message] };
    case "share.added":
      return { ...s, shares: [...s.shares, m.share] };
    case "share.removed":
      return { ...s, shares: s.shares.filter((x) => x.id !== m.shareId) };
    case "layout":
      return withLayout(s, m.projectId, m.layout);
    case "auth":
      return { ...s, auth: m.status };
    case "models":
      return { ...s, models: m.models };
    case "usage.plan":
      return { ...s, plan: m.plan };
    case "error":
      return { ...s, error: m.message };
  }
}
