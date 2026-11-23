import {
  MAX_EVENTS, defaultLayout,
  type Agent, type AgentEvent, type AgentState, type Approval, type Layout, type LoggedMessage, type Project,
  type PlanUsage, type ServerMsg, type SharedFile,
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

function addEvent(list: AgentEvent[] = [], ev: AgentEvent): AgentEvent[] {
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
