import type { Agent, AgentAction, ClientMsg, Layout } from "@squad/shared";
import { currentLayout, emptyState, forProject, reduce, withLayout, type UiState } from "./reducer.ts";
import { connect } from "./ws.ts";

const LAST_PROJECT = "squad.lastProject";

/** Server data lives in `s` (changed only by the reducer); the rest is view state. */
export const ui: {
  s: UiState;
  connected: boolean;
  keyExpired: boolean;
  view: "chat" | "messages" | "shares" | "usage";
  focus: string | null;
  viewer: string | null;
} = $state({ s: emptyState(), connected: false, keyExpired: false, view: "chat", focus: null, viewer: null });

let conn: ReturnType<typeof connect> | null = null;

function remembered(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT);
  } catch {
    return null;
  }
}

export function start(): void {
  conn = connect({
    onMsg: (m) => {
      ui.s = reduce(ui.s, m);
      if (m.t === "projects" && !ui.s.projectId && m.projects.length) {
        const last = remembered();
        selectProject(m.projects.find((p) => p.id === last)?.id ?? m.projects[0].id);
      }
    },
    onOpen: () => {
      ui.connected = true;
      ui.keyExpired = false;
      if (ui.s.projectId) send({ t: "subscribe", projectId: ui.s.projectId });
    },
    onDown: () => (ui.connected = false),
    onUnauthorized: () => (ui.keyExpired = true),
  });
}

export function send(m: ClientMsg): void {
  conn?.send(m);
}

export function selectProject(id: string): void {
  ui.s = forProject(ui.s, id);
  ui.focus = null;
  try {
    localStorage.setItem(LAST_PROJECT, id);
  } catch {
    // private mode or storage disabled: the project just isn't remembered
  }
  send({ t: "subscribe", projectId: id });
}

export const layout = (): Layout => currentLayout(ui.s);

/** Applies a layout change locally right away and saves it on the server. */
export function saveLayout(next: Layout): void {
  const projectId = ui.s.projectId;
  if (!projectId) return;
  ui.s = withLayout(ui.s, projectId, next);
  send({ t: "layout.save", projectId, layout: next });
}

/** Runs an agent action, asking first for Clear because it can't be undone. */
export function agentAction(agent: Agent, action: AgentAction): void {
  if (action === "clear" && !confirm(`Clear ${agent.name}? This starts a fresh conversation and deletes files it shared.`)) return;
  send({ t: "agent.action", agentId: agent.id, action });
}

export const agentById = (id: string | null): Agent | undefined => ui.s.agents.find((a) => a.id === id);
export const approvalsFor = (agentId: string) => ui.s.approvals.filter((a) => a.agentId === agentId);
