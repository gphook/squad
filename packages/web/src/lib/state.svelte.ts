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
  /** The page was opened from a setup link that had expired or was already used (/?setup=expired). */
  setupExpired: boolean;
  /** Bumped when the server says the passkey or session lists changed; an open Sign-in view refetches. */
  signinVersion: number;
  view: "chat" | "messages" | "shares" | "usage" | "plugins" | "signin";
  focus: string | null;
  viewer: string | null;
  /** The squadmate picked in the Plugins view; `/plugin` sets it to the squadmate it was typed in. */
  pluginMate: string | null;
} = $state({
  s: emptyState(), connected: false, session: null, unreachable: false, setupExpired: false, signinVersion: 0,
  view: "chat", focus: null, viewer: null, pluginMate: null,
});

let conn: ReturnType<typeof connect> | null = null;

function remembered(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT);
  } catch {
    return null;
  }
}

/** Retry delays while Squad can't be reached: 1 s, doubling, at most 10 s. */
export const nextDelay = (delay: number): number => Math.min(delay * 2, 10_000);

let starting: Promise<void> | null = null;

/**
 * Loads the session status and, when signed in, connects the WebSocket. Retries with backoff while Squad is
 * unreachable. Calls made while one is running share it.
 */
export function start(): Promise<void> {
  starting ??= run().finally(() => (starting = null));
  return starting;
}

async function run(): Promise<void> {
  // A failed setup link lands on /?setup=expired: remember it, then tidy the address bar, whatever screen shows.
  const params = new URLSearchParams(location.search);
  if (params.get("setup") === "expired") {
    ui.setupExpired = true;
    params.delete("setup");
    const query = params.toString();
    history.replaceState(null, "", location.pathname + (query ? `?${query}` : "") + location.hash);
  }
  let delay = 1000;
  for (;;) {
    try {
      ui.session = await fetchSession();
      ui.unreachable = false;
      break;
    } catch {
      ui.unreachable = true;
      await new Promise((r) => setTimeout(r, delay));
      delay = nextDelay(delay);
    }
  }
  if (ui.session.signedIn) connectSocket();
}

const SIGNED_OUT: SessionStatus = { signedIn: false, setupNeeded: false, setupGrant: false };

/** Bumped on every sign-in or sign-out, so a late /api/session answer can't undo a newer change. */
let sessionEpoch = 0;

/** Called once the sign-in screen has signed in: show the app and connect. Signing in ends any setup. */
export function signedIn(): void {
  sessionEpoch++;
  ui.session = { signedIn: true, setupNeeded: false, setupGrant: false };
  ui.setupExpired = false;
  connectSocket();
  tabs?.postMessage("signed-in");
}

/**
 * Tabs of this browser share one cookie: when one signs in, the others leave their sign-in screen. Also checks again
 * when a signed-out tab comes back into view, in case another browser window signed in meanwhile.
 */
const tabs: BroadcastChannel | null = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("squad-signin");
const recheckIfSignedOut = (): void => {
  if (ui.session && !ui.session.signedIn) void start();
};
tabs?.addEventListener("message", recheckIfSignedOut);
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") recheckIfSignedOut();
  });
}

/**
 * This browser's session is gone (revoked, expired or signed out): show the sign-in screen at once, then ask the
 * server whether setup is needed now, since the flags seen before signing in are stale.
 */
export function signedOutHere(): void {
  conn?.stop();
  conn = null;
  ui.connected = false;
  ui.view = "chat";
  ui.session = SIGNED_OUT;
  const epoch = ++sessionEpoch;
  fetchSession().then(
    (status) => {
      if (epoch !== sessionEpoch) return;
      ui.session = status;
      if (status.signedIn) connectSocket();
    },
    () => {}, // unreachable: keep the plain Sign in screen
  );
}

function connectSocket(): void {
  if (conn) return;
  conn = connect({
    onMsg: (m) => {
      ui.s = reduce(ui.s, m);
      if (m.t === "signin.changed") ui.signinVersion++;
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
