import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, StoreError } from "../src/store.ts";

let store: Store;
beforeEach(() => {
  store = new Store(join(mkdtempSync(join(tmpdir(), "squad-store-")), "squad.db"));
});

const newProject = (name = "Starfade") =>
  store.saveProject({ name, rules: "be nice", permissionMode: "default" });
const newAgent = (projectId: string, name: string) =>
  store.saveAgent({ projectId, name, role: "role", folder: "/tmp", model: null });

describe("Store", () => {
  it("round-trips a project with its default layout", () => {
    const p = newProject();
    expect(store.getProject(p.id)).toEqual({
      id: p.id, name: "Starfade", rules: "be nice", permissionMode: "default",
      layout: { mode: "focussed", slots: {}, main: null },
    });
    store.saveLayout(p.id, { mode: "tiled", slots: { "1": "a" }, main: "a" });
    expect(store.getProject(p.id)!.layout).toEqual({ mode: "tiled", slots: { "1": "a" }, main: "a" });
  });

  it("rejects a duplicate agent name within a project", () => {
    const p = newProject();
    newAgent(p.id, "starfade");
    expect(() => newAgent(p.id, "starfade")).toThrow(StoreError);
  });

  it("allows the same agent name in another project", () => {
    newAgent(newProject("A").id, "starfade");
    expect(() => newAgent(newProject("B").id, "starfade")).not.toThrow();
  });

  it("deleteProject removes its agents, messages and shares", () => {
    const p = newProject();
    const a = newAgent(p.id, "starfade");
    store.addMessage({ projectId: p.id, from: "a", to: "b", text: "hi", at: 1, external: false });
    store.addShare({ projectId: p.id, fromAgent: "starfade", to: ["b"], note: "", path: "/x", size: 1, at: 1 });
    store.deleteProject(p.id);
    expect(store.getAgent(a.id)).toBeNull();
    expect(store.listMessages(p.id)).toEqual([]);
    expect(store.listShares(p.id)).toEqual([]);
  });

  it("setSessionId(null) clears the session", () => {
    const a = newAgent(newProject().id, "starfade");
    store.setSessionId(a.id, "s1");
    expect(store.getAgent(a.id)!.sessionId).toBe("s1");
    store.setSessionId(a.id, null);
    expect(store.getAgent(a.id)!.sessionId).toBeNull();
  });

  it("renaming an agent carries its earlier shares to the new name", () => {
    const p = newProject();
    const a = newAgent(p.id, "old");
    store.addShare({ projectId: p.id, fromAgent: "old", to: [], note: "", path: "/1", size: 1, at: 1 });
    store.saveAgent({ id: a.id, projectId: p.id, name: "new", role: "role", folder: "/tmp", model: null });
    expect(store.sharesFrom(p.id, "new").map((s) => s.path)).toEqual(["/1"]);
  });

  it("sharesFrom returns only that sender's shares", () => {
    const p = newProject();
    store.addShare({ projectId: p.id, fromAgent: "a", to: ["b"], note: "", path: "/1", size: 1, at: 1 });
    store.addShare({ projectId: p.id, fromAgent: "b", to: ["a"], note: "", path: "/2", size: 1, at: 2 });
    expect(store.sharesFrom(p.id, "a").map((s) => s.path)).toEqual(["/1"]);
  });
});

describe("Store usage", () => {
  const H = 3600_000;
  const now = new Date(2026, 10, 23, 12, 0, 0).getTime();
  const row = (model: string, cost: number, output = 10) =>
    ({ model, cost, input: 1, output, cacheRead: 100, cacheWrite: 50 });
  const localDay = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  it("records one row per model and reports per-agent window shares", () => {
    const p = newProject();
    const a1 = newAgent(p.id, "a1");
    const a2 = newAgent(p.id, "a2");
    store.addUsageTurn({ projectId: p.id, agentId: a1.id, at: now - H, rows: [row("opus", 2), row("haiku", 1)] });
    store.addUsageTurn({ projectId: p.id, agentId: a2.id, at: now - 2 * H, rows: [row("opus", 1)] });
    const r = store.usageReport({ projectId: p.id, days: 30, now });
    expect(r.windows.map((w) => [w.agentName, w.turns, w.cost, w.share5h, w.share7d])).toEqual([
      ["a1", 1, 3, 0.75, 0.75], ["a2", 1, 1, 0.25, 0.25],
    ]);
    expect(r.windows[0]).toMatchObject({ input: 2, output: 20, cacheRead: 200, cacheWrite: 100, projectName: "Starfade" });
  });

  it("turns older than 5h count only toward the 7d share", () => {
    const p = newProject();
    const a1 = newAgent(p.id, "a1");
    const a2 = newAgent(p.id, "a2");
    store.addUsageTurn({ projectId: p.id, agentId: a1.id, at: now - H, rows: [row("opus", 1)] });
    store.addUsageTurn({ projectId: p.id, agentId: a2.id, at: now - 6 * H, rows: [row("opus", 3)] });
    const byName = Object.fromEntries(store.usageReport({ projectId: p.id, days: 30, now }).windows.map((w) => [w.agentName, w]));
    expect(byName.a1).toMatchObject({ share5h: 1, share7d: 0.25 });
    expect(byName.a2).toMatchObject({ share5h: 0, share7d: 0.75 });
  });

  it("daily buckets by local day and agent", () => {
    const p = newProject();
    const a1 = newAgent(p.id, "a1");
    store.addUsageTurn({ projectId: p.id, agentId: a1.id, at: now - H, rows: [row("opus", 1)] });
    store.addUsageTurn({ projectId: p.id, agentId: a1.id, at: now - 2 * H, rows: [row("opus", 2)] });
    store.addUsageTurn({ projectId: p.id, agentId: a1.id, at: now - 30 * H, rows: [row("opus", 4)] });
    store.addUsageTurn({ projectId: p.id, agentId: a1.id, at: now - 40 * 24 * H, rows: [row("opus", 8)] });
    const r = store.usageReport({ projectId: p.id, days: 30, now });
    expect(r.daily).toEqual([
      { day: localDay(now - 30 * H), agentId: a1.id, agentName: "a1", cost: 4, tokens: 161 },
      { day: localDay(now), agentId: a1.id, agentName: "a1", cost: 3, tokens: 322 },
    ]);
    expect(r.byModel).toEqual([{ model: "opus", cost: 7, input: 3, output: 30, cacheRead: 300, cacheWrite: 150 }]);
  });

  it("top groups a multi-model turn into one row and sorts by cost", () => {
    const p = newProject();
    const a1 = newAgent(p.id, "a1");
    store.addUsageTurn({ projectId: p.id, agentId: a1.id, at: now - H, rows: [row("opus", 2), row("haiku", 0.5)] });
    store.addUsageTurn({ projectId: p.id, agentId: a1.id, at: now - 2 * H, rows: [row("opus", 5)] });
    const top = store.usageReport({ projectId: p.id, days: 30, now }).top;
    expect(top.map((t) => [t.cost, t.model, t.output])).toEqual([[5, "opus", 10], [2.5, "opus", 20]]);
    expect(top[1]).toMatchObject({ at: now - H, agentName: "a1", projectName: "Starfade" });
  });

  it("projectId null reports across projects; a projectId filters", () => {
    const p1 = newProject("One");
    const p2 = newProject("Two");
    store.addUsageTurn({ projectId: p1.id, agentId: newAgent(p1.id, "a").id, at: now - H, rows: [row("opus", 1)] });
    store.addUsageTurn({ projectId: p2.id, agentId: newAgent(p2.id, "b").id, at: now - H, rows: [row("opus", 1)] });
    expect(store.usageReport({ projectId: p1.id, days: 7, now }).windows.map((w) => w.agentName)).toEqual(["a"]);
    expect(store.usageReport({ projectId: null, days: 7, now }).windows.map((w) => w.agentName).sort()).toEqual(["a", "b"]);
  });

  it("usage history survives agent and project delete, under the snapshot name", () => {
    const p = newProject();
    const a = newAgent(p.id, "old-name");
    store.addUsageTurn({ projectId: p.id, agentId: a.id, at: now - H, rows: [row("opus", 1)] });
    store.saveAgent({ id: a.id, projectId: p.id, name: "new-name", role: "r", folder: "/tmp", model: null });
    store.deleteProject(p.id);
    const r = store.usageReport({ projectId: null, days: 7, now });
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0]).toMatchObject({ agentId: a.id, agentName: "old-name", projectName: "Starfade" });
  });

  it("stores a usage baseline per agent and session", () => {
    const p = newProject();
    const a = newAgent(p.id, "a");
    expect(store.getUsageBaseline(a.id)).toBeNull();
    store.setUsageBaseline(a.id, "s1", { opus: row("opus", 1) });
    store.setUsageBaseline(a.id, "s1", { opus: row("opus", 2) });
    expect(store.getUsageBaseline(a.id)).toEqual({ sessionId: "s1", totals: { opus: row("opus", 2) } });
  });
});

describe("Store usage shares", () => {
  it("project-scoped shares are of all Squad usage, not just the project's", () => {
    const now = Date.now();
    const p1 = store.saveProject({ name: "One", rules: "", permissionMode: "default" });
    const p2 = store.saveProject({ name: "Two", rules: "", permissionMode: "default" });
    const r = (cost: number) => [{ model: "opus", cost, input: 0, output: 1, cacheRead: 0, cacheWrite: 0 }];
    store.addUsageTurn({ projectId: p1.id, agentId: store.saveAgent({ projectId: p1.id, name: "a", role: "", folder: "/tmp", model: null }).id, at: now - 1000, rows: r(1) });
    store.addUsageTurn({ projectId: p2.id, agentId: store.saveAgent({ projectId: p2.id, name: "b", role: "", folder: "/tmp", model: null }).id, at: now - 1000, rows: r(3) });
    expect(store.usageReport({ projectId: p1.id, days: 7, now }).windows[0]).toMatchObject({ share5h: 0.25, share7d: 0.25 });
  });
});
