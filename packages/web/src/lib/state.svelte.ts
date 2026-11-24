import type { Agent, AgentAction, ClientMsg, Layout, SessionStatus } from "@squad/shared";
import { currentLayout, emptyState, forProject, reduce, withLayout, type UiState } from "./reducer.ts";
import { connect } from "./ws.ts";
import { fetchSession } from "./signin.ts";

const LAST_PROJECT = "squad.lastProject";

/** Server data lives in `s` (changed only by the reducer); the rest is view state. */
export const ui: {
  s: UiState;
  connected: boolean;
  /** Null until /api/session has answered. */
  session: SessionStatus | null;
  /** True while /api/session can't be reached and start() is retrying. */
  unreachable: boolean;
  view: "chat" | "messages" | "shares" | "usage" | "plugins" | "signin";
  focus: string | null;
  viewer: string | null;
  /** The squadmate picked in the Plugins view; `/plugin` sets it to the squadmate it was typed in. */
  pluginMate: string | null;
} = $state({ s: emptyState(), connected: false, session: null, unreachable: false, view: "chat", focus: null, viewer: null, pluginMate: null });

let conn: ReturnType<typeof connect> | null = null;

function remembered(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT);
  } catch {
    return null;
  }
}

/** Loads the session status and, when signed in, connects the WebSocket. Retries with backoff while Squad is unreachable. */
export async function start(): Promise<void> {
  let delay = 1000;
  for (;;) {
    try {
      ui.session = await fetchSession();
      ui.unreachable = false;
      break;
    } catch {
      ui.unreachable = true;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 10_000);
    }
  }
  if (ui.session.signedIn) connectSocket();
}

/** Called once the sign-in screen has signed in: show the app and connect. */
export function signedIn(): void {
  ui.session = { setupNeeded: false, setupGrant: false, ...ui.session, signedIn: true };
  connectSocket();
}

/** This browser's session is gone (revoked, expired or signed out): show the sign-in screen. */
export function signedOutHere(): void {
  conn?.stop();
  conn = null;
  ui.connected = false;
  ui.view = "chat";
  ui.session = { setupNeeded: false, setupGrant: false, ...ui.session, signedIn: false };
}

function connectSocket(): void {
  if (conn) return;
  conn = connect({
    onMsg: (m) => {
      ui.s = reduce(ui.s, m);
      if (m.t === "ui.open") {
        ui.view = m.view;
        ui.pluginMate = m.agentId;
      }
      if (m.t === "projects" && !ui.s.projectId && m.projects.length) {
        const last = remembered();
        selectProject(m.projects.find((p) => p.id === last)?.id ?? m.projects[0].id);
      }
    },
    onOpen: () => {
      ui.connected = true;
      if (ui.s.projectId) send({ t: "subscribe", projectId: ui.s.projectId });
    },
    onDown: () => (ui.connected = false),
    onUnauthorized: signedOutHere,
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
