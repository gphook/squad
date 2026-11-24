import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { ClientMsg, ServerMsg } from "@squad/shared";

// The page's connection: capture what it sends, and feed it server messages.
const sent: ClientMsg[] = [];
let deliver: (m: ServerMsg) => void = () => {};
vi.mock("../src/lib/ws.ts", () => ({
  connect: (h: { onMsg: (m: ServerMsg) => void }) => { deliver = h.onMsg; return { send: (m: ClientMsg) => sent.push(m) }; },
}));

const { start, ui } = await import("../src/lib/state.svelte.ts");
const { default: PluginsView } = await import("../src/components/PluginsView.svelte");
const { default: DiscoverTab } = await import("../src/components/plugins/DiscoverTab.svelte");

const project = { id: "p", name: "P", rules: "", permissionMode: "default" as const, layout: { slots: {}, maximised: null }, activities: [] };
const agent = { id: "a", projectId: "p", name: "starfade", role: "", folder: "/f", model: null, effort: null, sessionId: null };
const snapshot: ServerMsg = { t: "plugins", projectId: "p", installed: [], marketplaces: [], switches: [], available: 3 };
const feed = (m: ServerMsg) => { deliver(m); flushSync(); };
const unrelated = () => {
  for (let i = 0; i < 5; i++) feed({ t: "agent.event", agentId: "a", event: { kind: "text_delta", text: "x" } });
};

let cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  sent.length = 0;
  start();
  feed({ t: "projects", projects: [project] });
  feed({ t: "state", projectId: "p", agents: [agent], states: [], approvals: [], messages: [], shares: [] });
  sent.length = 0;
});
afterEach(() => { for (const c of cleanup) c(); cleanup = []; document.body.innerHTML = ""; vi.useRealTimers(); });

function render(Component: never) {
  const target = document.createElement("div");
  document.body.append(target);
  const app = mount(Component, { target, props: {} });
  cleanup.push(() => unmount(app));
  flushSync();
}
const count = (t: string) => sent.filter((m) => m.t === t).length;

describe("Plugins view requests", () => {
  it("asks for the plugins once, not again for every message the page receives", () => {
    render(PluginsView as never);
    expect(count("plugins.get")).toBe(1);
    feed(snapshot);
    unrelated();
    expect(count("plugins.get")).toBe(1);
  });

  it("searches once per change of query, not again when results or other messages arrive", () => {
    feed(snapshot);
    render(DiscoverTab as never);
    vi.advanceTimersByTime(300);
    expect(count("plugins.search")).toBe(1);
    feed({ t: "plugins.results", query: "", marketplace: null, total: 0, items: [] });
    unrelated();
    vi.advanceTimersByTime(300);
    expect(count("plugins.search")).toBe(1);
  });

  it("ignores search results for a query that's no longer in the box", () => {
    feed(snapshot);
    render(DiscoverTab as never);
    feed({ t: "plugins.results", query: "fr", marketplace: null, total: 1,
      items: [{ id: "stale@m", name: "stale", marketplace: "m", description: "old answer" }] });
    expect(document.body.textContent).not.toContain("stale");
  });

  it("keeps an error on screen while other messages arrive", () => {
    feed(snapshot);
    render(DiscoverTab as never);
    feed({ t: "plugins.error", action: "plugins.install", message: "No room" });
    unrelated();
    expect(document.body.textContent).toContain("No room");
    expect(ui.s.pluginError).not.toBeNull();
  });
});

describe("Restart banner", () => {
  const ben = { ...agent, id: "b", name: "Ben" };
  const ana = { ...agent, id: "a", name: "Ana" };
  const setUp = () => {
    feed({ t: "state", projectId: "p", agents: [ana, ben], states: [{ agentId: "a", status: "idle" }, { agentId: "b", status: "working" }], approvals: [], messages: [], shares: [] });
    feed(snapshot);
    render(PluginsView as never);
    sent.length = 0;
  };
  const banner = () => document.querySelector('[aria-label="Restart to apply"]');
  const button = (label: string) =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label)!;
  const click = (label: string) => { button(label).click(); flushSync(); };
  const restarts = () => sent.filter((m) => m.t === "agent.action" && m.action === "restart").map((m) => (m as { agentId: string }).agentId);

  it("shows nothing when no running squadmate needs a restart", () => {
    setUp();
    feed({ t: "plugins.restart", projectId: "p", agents: [] });
    expect(banner()).toBeNull();
  });

  it("names who needs a restart, marking the working ones", () => {
    setUp();
    feed({ t: "plugins.restart", projectId: "p", agents: [{ agentId: "a", name: "Ana" }, { agentId: "b", name: "Ben" }] });
    expect(banner()?.textContent).toContain("Restart to apply plugin changes:");
    expect(banner()?.textContent).toContain("Ben (working)");
    expect(banner()?.textContent).not.toContain("Ana (working)");
  });

  it("restarts an idle squadmate at once, and asks first for a working one", () => {
    setUp();
    feed({ t: "plugins.restart", projectId: "p", agents: [{ agentId: "a", name: "Ana" }, { agentId: "b", name: "Ben" }] });
    click("Restart Ana");
    expect(restarts()).toEqual(["a"]);
    click("Restart Ben");
    expect(restarts()).toEqual(["a"]);
    expect(banner()?.textContent).toContain("Ben is working. Restarting stops what it's doing.");
    click("Restart anyway");
    expect(restarts()).toEqual(["a", "b"]);
  });

  it("Restart all restarts idle ones at once and asks once for the working ones", () => {
    setUp();
    feed({ t: "plugins.restart", projectId: "p", agents: [{ agentId: "a", name: "Ana" }, { agentId: "b", name: "Ben" }] });
    click("Restart all");
    expect(restarts()).toEqual(["a"]);
    expect(banner()?.textContent).toContain("Ben is working. Restarting stops what it's doing.");
    click("Cancel");
    expect(restarts()).toEqual(["a"]);
  });
});
