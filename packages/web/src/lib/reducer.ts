import {
  MAX_EVENTS, defaultLayout,
  type Agent, type AgentEvent, type AgentState, type Approval, type Layout, type LoggedMessage, type Project,
  type PlanUsage, type ServerMsg, type SharedFile, type ShellChunk,
} from "@squad/shared";

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
  error: string | null;
}

export function emptyState(): UiState {
  return {
    projects: [], projectId: null, agents: [], states: {}, events: {},
    approvals: [], messages: [], shares: [], plan: null, error: null,
  };
}

/** Fresh state for another project, keeping what isn't tied to a project. */
export function forProject(s: UiState, projectId: string): UiState {
  return { ...emptyState(), projects: s.projects, plan: s.plan, projectId };
}

type ShellEvent = Extract<AgentEvent, { kind: "shell" }>;

/** Output kept per `$ cmd` block in the browser; older output is trimmed. */
export const SHELL_UI_CAP = 200_000;
const TRIMMED = "[… earlier output trimmed]\n";

function appendOutput(chunks: ShellChunk[], stream: ShellChunk["stream"], text: string): ShellChunk[] {
  const last = chunks.at(-1);
  let next = last?.stream === stream ? [...chunks.slice(0, -1), { stream, text: last.text + text }] : [...chunks, { stream, text }];
  if (next[0]?.text === TRIMMED) next = next.slice(1);
  let total = next.reduce((n, c) => n + c.text.length, 0);
  if (total <= SHELL_UI_CAP) return next;
  while (total > SHELL_UI_CAP) {
    const over = total - SHELL_UI_CAP;
    if (next[0].text.length <= over) {
      total -= next[0].text.length;
      next = next.slice(1);
    } else {
      next = [{ ...next[0], text: next[0].text.slice(over) }, ...next.slice(1)];
      total -= over;
    }
  }
  return [{ stream: "stdout", text: TRIMMED }, ...next];
}

/** Streams a `$ cmd`'s output and end into its shell event; anything for an unknown block is dropped. */
function foldShell(list: AgentEvent[], ev: Extract<AgentEvent, { kind: "shell_output" | "shell_end" }>): AgentEvent[] {
  const i = list.findLastIndex((e) => e.kind === "shell" && e.id === ev.id);
  if (i < 0) return list;
  const block = list[i] as ShellEvent;
  const next: ShellEvent = ev.kind === "shell_output"
    ? { ...block, chunks: appendOutput(block.chunks, ev.stream, ev.text) }
    : { ...block, running: false, code: ev.code, signal: ev.signal };
  return list.with(i, next);
}

function addEvent(list: AgentEvent[] = [], ev: AgentEvent): AgentEvent[] {
  if (ev.kind === "shell_output" || ev.kind === "shell_end") return foldShell(list, ev);
  const last = list.at(-1);
  if (ev.kind === "text_delta" && last?.kind === "text_delta") {
    return [...list.slice(0, -1), { kind: "text_delta", text: last.text + ev.text }];
  }
  if (ev.kind === "assistant_text" && last?.kind === "text_delta") return [...list.slice(0, -1), ev];
  const next = [...list, ev];
  return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
}

/** The layout lives on its project; this reads it for the selected one. */
export function currentLayout(s: UiState): Layout {
  return s.projects.find((p) => p.id === s.projectId)?.layout ?? defaultLayout();
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
    case "agent.history":
      return { ...s, events: { ...s.events, [m.agentId]: m.events.filter((e) => e.kind !== "text_delta") } };
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
    case "usage.plan":
      return { ...s, plan: m.plan };
    case "error":
      return { ...s, error: m.message };
  }
}
