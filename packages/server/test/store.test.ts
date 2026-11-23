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
      layout: { slots: {}, maximised: null }, activities: [],
    });
    store.saveLayout(p.id, { slots: { "1": "a" }, maximised: "a" });
    expect(store.getProject(p.id)!.layout).toEqual({ slots: { "1": "a" }, maximised: "a" });
  });

  it("reads a layout saved by an older Squad in the new shape", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "squad-layout-")), "squad.db");
    const first = new Store(path);
    const p = first.saveProject({ name: "Old", rules: "", permissionMode: "default" });
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path);
    db.prepare("UPDATE projects SET layout = ? WHERE id = ?").run(JSON.stringify({ mode: "focussed", slots: { "1": "a" }, main: "a" }), p.id);
    db.close();
    expect(new Store(path).getProject(p.id)!.layout).toEqual({ slots: { "1": "a" }, maximised: "a" });
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

describe("Store activities", () => {
  const act = (name: string, ownerId: string | null = null, reviewerIds: string[] = [], id?: string) =>
    ({ ...(id ? { id } : {}), name, ownerId, reviewerIds, description: "" });
  const save = (p: { id: string; name: string }, activities?: ReturnType<typeof act>[]) =>
    store.saveProject({ id: p.id, name: p.name, rules: "", permissionMode: "default", ...(activities ? { activities } : {}) });

  it("saves activities in order and replaces the list on the next save", () => {
    const p = newProject();
    const a = newAgent(p.id, "starfade");
    const saved = save(p, [act("Game code", a.id), act("UI"), act("Shaders")]).activities;
    expect(saved.map((x) => [x.name, x.ownerId])).toEqual([["Game code", a.id], ["UI", null], ["Shaders", null]]);
    const [g, , s] = saved;
    const again = save(p, [act("Shader work", null, [], s.id), act("Game code", a.id, [], g.id)]).activities;
    expect(again.map((x) => [x.id, x.name])).toEqual([[s.id, "Shader work"], [g.id, "Game code"]]);
    expect(store.getProject(p.id)!.activities).toEqual(again);
  });

  it("leaves activities alone when a save doesn't mention them", () => {
    const p = newProject();
    save(p, [act("UI")]);
    save(p);
    expect(store.getProject(p.id)!.activities.map((x) => x.name)).toEqual(["UI"]);
  });

  it("rejects duplicate names, ignoring case and spaces, but allows a swap", () => {
    const p = newProject();
    expect(() => save(p, [act("UI"), act(" ui ")])).toThrow(StoreError);
    const [x, y] = save(p, [act("A"), act("B")]).activities;
    expect(save(p, [act("B", null, [], x.id), act("A", null, [], y.id)]).activities.map((z) => z.name)).toEqual(["B", "A"]);
  });

  it("drops owners and reviewers from other projects, and an owner listed as reviewer", () => {
    const p = newProject();
    const other = newProject("Other");
    const a = newAgent(p.id, "a");
    const b = newAgent(p.id, "b");
    const outsider = newAgent(other.id, "x");
    const [one, two] = save(p, [act("One", outsider.id, [outsider.id, b.id]), act("Two", a.id, [a.id, b.id])]).activities;
    expect([one.ownerId, one.reviewerIds]).toEqual([null, [b.id]]);
    expect([two.ownerId, two.reviewerIds]).toEqual([a.id, [b.id]]);
  });

  it("setOwnership claims unowned activities, never another's, creates new ones and releases unlisted ones", () => {
    const p = newProject();
    const a = newAgent(p.id, "a");
    const b = newAgent(p.id, "b");
    const [free, taken] = save(p, [act("Free"), act("Taken", b.id)]).activities;
    store.setOwnership(a.id, { activityIds: [free.id, taken.id], newActivities: ["Shaders", " ", "free"] });
    const owners = () => Object.fromEntries(store.getProject(p.id)!.activities.map((x) => [x.name, x.ownerId]));
    expect(owners()).toEqual({ Free: a.id, Taken: b.id, Shaders: a.id });
    store.setOwnership(a.id, { activityIds: [free.id], newActivities: [] });
    expect(owners()).toEqual({ Free: a.id, Taken: b.id, Shaders: null });
  });

  it("setOwnership claims an unowned activity typed by name, but not another's", () => {
    const p = newProject();
    const a = newAgent(p.id, "a");
    const b = newAgent(p.id, "b");
    save(p, [act("Levels"), act("UI", b.id)]);
    store.setOwnership(a.id, { activityIds: [], newActivities: [" levels ", "ui"] });
    expect(store.getProject(p.id)!.activities.map((x) => [x.name, x.ownerId])).toEqual([["Levels", a.id], ["UI", b.id]]);
  });

  it("deleting a squadmate leaves its activities unowned and removes it as a reviewer", () => {
    const p = newProject();
    const a = newAgent(p.id, "a");
    const b = newAgent(p.id, "b");
    save(p, [act("Mine", a.id, [b.id]), act("Reviewed", b.id, [a.id]), act("Other", b.id)]);
    store.deleteAgent(a.id);
    expect(store.getProject(p.id)!.activities.map((x) => [x.name, x.ownerId, x.reviewerIds]))
      .toEqual([["Mine", null, [b.id]], ["Reviewed", b.id, []], ["Other", b.id, []]]);
  });
});

describe("Store effort", () => {
  it("round-trips a squadmate's effort, defaulting to null", () => {
    const p = newProject();
    const a = store.saveAgent({ projectId: p.id, name: "a", role: "", folder: "/tmp", model: "haiku", effort: "low" });
    expect(store.getAgent(a.id)).toMatchObject({ model: "haiku", effort: "low" });
    expect(newAgent(p.id, "b").effort).toBeNull();
  });

  it("adds the effort column to an older database and keeps its squadmates", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const path = join(mkdtempSync(join(tmpdir(), "squad-old-")), "squad.db");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, rules TEXT NOT NULL, permission_mode TEXT NOT NULL, layout TEXT NOT NULL);
      CREATE TABLE agents (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL, role TEXT NOT NULL, folder TEXT NOT NULL, model TEXT, session_id TEXT, UNIQUE(project_id, name));
      INSERT INTO projects VALUES ('p', 'Starfade', '', 'default', '{"mode":"focussed","slots":{},"main":null}');
      INSERT INTO agents VALUES ('a', 'p', 'starfade', 'code', '/tmp', NULL, 's1');`);
    old.close();
    const reopened = new Store(path);
    expect(reopened.listAgents("p")).toEqual([
      { id: "a", projectId: "p", name: "starfade", role: "code", folder: "/tmp", model: null, effort: null, sessionId: "s1" },
    ]);
  });
});
