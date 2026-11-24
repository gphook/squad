import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import type { ServerMsg } from "@squad/shared";
import { buildApp } from "../src/app.ts";
import { Store } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { PlanUsageTracker } from "../src/planUsage.ts";
import { fakeFactory, tick } from "./fakeQuery.ts";
import { FakePluginSource } from "../src/plugins/fakeSource.ts";
import { PluginService, kitPlugin } from "../src/plugins/service.ts";

const KEY = "k".repeat(64);
let app: FastifyInstance, store: Store, sup: Supervisor, f: ReturnType<typeof fakeFactory>, plan: PlanUsageTracker;
let port: number, projectId: string, agentId: string, folder: string;
const open: WebSocket[] = [];

beforeEach(async () => {
  process.env.SQUAD_HOME = mkdtempSync(join(tmpdir(), "squad-home-"));
  store = new Store(join(process.env.SQUAD_HOME, "squad.db"));
  f = fakeFactory();
  sup = new Supervisor(store, f.factory, "/kit");
  folder = mkdtempSync(join(tmpdir(), "squad-agent-"));
  writeFileSync(join(folder, "a.png"), "png");
  symlinkSync("/etc/hostname", join(folder, "link"));
  projectId = store.saveProject({ name: "P", rules: "", permissionMode: "default" }).id;
  agentId = store.saveAgent({ projectId, name: "starfade", role: "r", folder, model: null }).id;
  plan = new PlanUsageTracker({ queryFactory: f.factory, source: () => null, probeCwd: process.env.SQUAD_HOME });
  const plugins = new PluginService(new FakePluginSource({ delayMs: 0 }), store, kitPlugin(join(import.meta.dirname, "../../../kit")));
  app = buildApp({ store, supervisor: sup, key: KEY, plan, plugins });
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = (app.server.address() as { port: number }).port;
});
afterEach(async () => {
  open.splice(0).forEach((w) => w.close());
  await app.close();
  plan.dispose();
});

function connect(origin = `http://127.0.0.1:${port}`): Promise<{ ws: WebSocket; msgs: ServerMsg[]; next: (t: string) => Promise<ServerMsg> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?key=${KEY}`, { headers: { origin } });
    open.push(ws);
    const msgs: ServerMsg[] = [];
    const waiters: [string, (m: ServerMsg) => void][] = [];
    ws.on("message", (d) => {
      const m = JSON.parse(String(d)) as ServerMsg;
      msgs.push(m);
      const i = waiters.findIndex(([t]) => t === m.t);
      if (i >= 0) waiters.splice(i, 1)[0][1](m);
    });
    const next = (t: string) => {
      const seen = msgs.find((m) => m.t === t);
      if (seen) { msgs.splice(msgs.indexOf(seen), 1); return Promise.resolve(seen); }
      return new Promise<ServerMsg>((r) => waiters.push([t, (m) => { msgs.splice(msgs.indexOf(m), 1); r(m); }]));
    };
    ws.on("open", () => resolve({ ws, msgs, next }));
    ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on("error", reject);
  });
}
const send = (ws: WebSocket, m: object) => ws.send(JSON.stringify(m));
const files = (path: string, extra = "") =>
  app.inject({ url: `/files?project=${projectId}&agent=${agentId}&path=${encodeURIComponent(path)}${extra}`, cookies: { squad_key: KEY } });

describe("auth", () => {
  it("rejects requests without the key", async () => {
    expect((await app.inject({ url: "/files?project=x&path=y" })).statusCode).toBe(401);
  });
  it("sets the key cookie when the key is in the URL", async () => {
    const r = await app.inject({ url: `/api/ping?key=${KEY}` });
    expect(r.headers["set-cookie"]).toContain(`squad_key=${KEY}`);
  });
  it("rejects a WebSocket from a foreign origin", async () => {
    await expect(connect("https://evil.example")).rejects.toThrow("HTTP 403");
  });
});

describe("/files", () => {
  it("serves a file in an agent folder", async () => {
    const r = await files("a.png");
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("image/png");
    expect(r.body).toBe("png");
  });
  it("refuses ../ traversal and symlinks pointing outside", async () => {
    expect((await files("../../etc/passwd")).statusCode).toBe(403);
    expect((await files("link")).statusCode).toBe(403);
  });
  it("sandboxes every served file so an SVG or HTML can't run script on the Squad origin", async () => {
    writeFileSync(join(folder, "x.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const csp = String((await files("x.svg")).headers["content-security-policy"]);
    expect(csp).toContain("sandbox");
    expect(csp).toContain("default-src 'none'");
  });
  it("returns 404 for an unknown project id instead of creating folders", async () => {
    const r = await app.inject({ url: "/files?project=..%2F..%2F..%2F..%2Fusr&path=share", cookies: { squad_key: KEY } });
    expect(r.statusCode).toBe(404);
  });
  it("sends an attachment header for download=1", async () => {
    expect((await files("a.png", "&download=1")).headers["content-disposition"]).toBe('attachment; filename="a.png"');
  });
});

describe("websocket", () => {
  it("sends projects on connect and state on subscribe", async () => {
    const c = await connect();
    expect(await c.next("projects")).toMatchObject({ projects: [{ id: projectId }] });
    send(c.ws, { t: "subscribe", projectId });
    expect(await c.next("state")).toMatchObject({ projectId, agents: [{ id: agentId }], states: [{ status: "stopped" }] });
  });

  it("sends each squadmate's commands on subscribe", async () => {
    const c = await connect();
    send(c.ws, { t: "subscribe", projectId });
    expect(await c.next("agent.commands")).toMatchObject({ agentId, commands: [{ name: "clear" }, { name: "exit" }, { name: "plugin" }, { name: "skills" }] });
  });

  it("answers plugins.get, and shows a switch flipped on one page to another page on the project", async () => {
    const c1 = await connect(), c2 = await connect();
    for (const c of [c1, c2]) { send(c.ws, { t: "subscribe", projectId }); await c.next("state"); }
    send(c1.ws, { t: "plugins.get", projectId });
    const first = (await c1.next("plugins")) as Extract<ServerMsg, { t: "plugins" }>;
    const id = first.installed[1].id;
    c2.msgs.length = 0;
    send(c1.ws, { t: "plugins.switch", projectId, pluginId: id, agentId: null, enabled: false });
    const seen = (await c2.next("plugins")) as Extract<ServerMsg, { t: "plugins" }>;
    expect(seen.switches).toEqual([{ pluginId: id, agentId: null, enabled: false }]);
  });

  it("answers a bad marketplace source with plugins.error and adds nothing", async () => {
    const c = await connect();
    send(c.ws, { t: "subscribe", projectId });
    await c.next("state");
    send(c.ws, { t: "marketplace.add", source: "hello" });
    expect(await c.next("plugins.error")).toMatchObject({ action: "marketplace.add", message: expect.stringContaining('"hello"') });
    send(c.ws, { t: "plugins.get", projectId });
    expect(((await c.next("plugins")) as Extract<ServerMsg, { t: "plugins" }>).marketplaces).toHaveLength(3);
  });

  it("answers plugins.search only to the page that asked", async () => {
    const c = await connect();
    send(c.ws, { t: "plugins.search", query: "front", marketplace: null });
    expect(await c.next("plugins.results")).toMatchObject({ query: "front", items: [{ name: "frontend-design" }] });
  });

  it("opens the Plugins view on the page that typed /plugin, with that squadmate picked", async () => {
    const c1 = await connect(), c2 = await connect();
    for (const c of [c1, c2]) { send(c.ws, { t: "subscribe", projectId }); await c.next("state"); }
    send(c1.ws, { t: "agent.send", agentId, text: "/plugin" });
    expect(await c1.next("ui.open")).toEqual({ t: "ui.open", view: "plugins", agentId });
    await tick();
    expect(c2.msgs.some((m) => m.t === "ui.open")).toBe(false);
  });

  it("broadcasts status when a message is sent to an agent", async () => {
    const c = await connect();
    send(c.ws, { t: "subscribe", projectId });
    await c.next("state");
    send(c.ws, { t: "agent.send", agentId, text: "hi" });
    expect(await c.next("agent.status")).toMatchObject({ state: { agentId, status: "starting" } });
  });

  it("re-sends a pending approval to a newly connected socket, which can answer it", async () => {
    await sup.action(agentId, "launch");
    f.queries[0].emit({ type: "system", subtype: "init", session_id: "s" });
    await tick();
    const decision = f.queries[0].options.canUseTool("Bash", { command: "ls" }, { signal: new AbortController().signal });
    await tick();
    const c = await connect();
    send(c.ws, { t: "subscribe", projectId });
    const state = (await c.next("state")) as Extract<ServerMsg, { t: "state" }>;
    expect(state.approvals).toHaveLength(1);
    send(c.ws, { t: "approval.answer", approvalId: state.approvals[0].id, decision: "allow" });
    expect(await decision).toMatchObject({ behavior: "allow" });
  });

  it("sends running $ cmd blocks on subscribe, even for a squadmate with no session", async () => {
    await sup.send(agentId, "$ sleep 30");
    const c = await connect();
    send(c.ws, { t: "subscribe", projectId });
    const h = (await c.next("agent.history")) as Extract<ServerMsg, { t: "agent.history" }>;
    expect(h).toMatchObject({ agentId, events: [{ kind: "shell", command: "sleep 30", running: true }] });
    sup.runner(agentId).killAllShells(true);
  });

  it("saves activities and ownership, broadcasting projects", async () => {
    const c = await connect();
    await c.next("projects");
    send(c.ws, { t: "subscribe", projectId });
    await c.next("state");
    send(c.ws, { t: "project.save", project: { id: projectId, name: "P", rules: "", permissionMode: "default",
      activities: [{ name: "Free", ownerId: null, reviewerIds: [], description: "" }, { name: "Taken", ownerId: agentId, reviewerIds: [], description: "" }] } });
    const saved = (await c.next("projects")) as Extract<ServerMsg, { t: "projects" }>;
    const acts = saved.projects.find((p) => p.id === projectId)!.activities;
    expect(acts.map((a) => a.name)).toEqual(["Free", "Taken"]);
    send(c.ws, { t: "agent.save", agent: { projectId, name: "fresh", role: "", folder, model: null },
      owns: { activityIds: acts.map((a) => a.id), newActivities: [] } });
    const after = (await c.next("projects")) as Extract<ServerMsg, { t: "projects" }>;
    const fresh = store.getAgentByName(projectId, "fresh")!;
    expect(after.projects.find((p) => p.id === projectId)!.activities.map((a) => a.ownerId)).toEqual([fresh.id, agentId]);
  });

  it("answers models.get from the model catalog, or null without one", async () => {
    const c = await connect();
    send(c.ws, { t: "models.get" });
    expect(await c.next("models")).toMatchObject({ models: null });
  });

  it("answers auth.check, as unknown without a tracker", async () => {
    const c = await connect();
    send(c.ws, { t: "auth.check" });
    expect(await c.next("auth")).toMatchObject({ status: { state: "unknown" } });
  });

  it("saves and broadcasts a layout in the current shape, whatever the page sent", async () => {
    const c = await connect();
    send(c.ws, { t: "subscribe", projectId });
    await c.next("state");
    send(c.ws, { t: "layout.save", projectId, layout: { slots: { "1": agentId }, maximised: "not-a-tile" } });
    expect(await c.next("layout")).toMatchObject({ layout: { slots: { "1": agentId }, maximised: null } });
    expect(store.getProject(projectId)!.layout.maximised).toBeNull();
  });

  it("project.clearAll clears the project and sends everyone the emptied state", async () => {
    store.addMessage({ projectId, from: "starfade", to: "x", text: "hi", at: 1, external: false });
    const c = await connect();
    send(c.ws, { t: "subscribe", projectId });
    await c.next("state");
    send(c.ws, { t: "project.clearAll", projectId });
    expect(await c.next("state")).toMatchObject({ projectId, messages: [] });
  });

  it("passes agent.shellKill to the supervisor", async () => {
    const calls: string[][] = [];
    sup.killShell = (agentId: string, id: string) => { calls.push([agentId, id]); };
    const c = await connect();
    send(c.ws, { t: "agent.shellKill", agentId, id: "s1" });
    send(c.ws, { t: "subscribe", projectId });
    await c.next("state");
    expect(calls).toEqual([[agentId, "s1"]]);
  });

  it("reports a duplicate agent name as an error", async () => {
    const c = await connect();
    send(c.ws, { t: "agent.save", agent: { projectId, name: "starfade", role: "", folder, model: null } });
    expect(await c.next("error")).toMatchObject({ message: "Agent name already used in this project" });
  });

  it("creates a folder with git init when asked", async () => {
    const c = await connect();
    send(c.ws, { t: "subscribe", projectId });
    await c.next("state");
    const dir = join(mkdtempSync(join(tmpdir(), "squad-new-")), "repo");
    send(c.ws, { t: "agent.save", agent: { projectId, name: "fresh", role: "", folder: dir, model: null }, createFolder: true });
    await c.next("state");
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(dir, ".git"))).toBe(true);
  });
});

describe("usage", () => {
  const rateLimit = { unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: 1800000000 } } };
  const usage = (qs: string, cookies: Record<string, string> = { squad_key: KEY }) => app.inject({ url: `/api/usage?${qs}`, cookies });

  it("GET /api/usage returns the report for a project", async () => {
    store.addUsageTurn({ projectId, agentId, at: Date.now() - 1000, rows: [{ model: "opus", input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5 }] });
    const r = await usage(`projectId=${projectId}&days=30`);
    expect(r.statusCode).toBe(200);
    expect(r.json().windows).toMatchObject([{ agentName: "starfade", cost: 0.5, share7d: 1 }]);
    expect((await usage("projectId=&days=7")).json().windows).toHaveLength(1);
  });

  it("rejects days outside 7/30/90", async () => {
    expect((await usage(`projectId=${projectId}&days=5`)).statusCode).toBe(400);
  });

  it("requires the session key", async () => {
    expect((await usage("days=7", {})).statusCode).toBe(401);
  });

  it("broadcasts usage.plan to all clients on change, including rate limits from agents", async () => {
    plan.refresh = async () => null; // only the rate-limit change should broadcast here
    const [c1, c2] = [await connect(), await connect()];
    sup.emit("rateLimit", rateLimit);
    const [m1, m2] = await Promise.all([c1.next("usage.plan"), c2.next("usage.plan")]);
    expect(m1).toEqual(m2);
    expect(m1).toMatchObject({ plan: { available: true, fiveHour: { pct: 50, resetsAt: 1800000000000 } } });
  });

  it("sends the current plan on connect", async () => {
    plan.refresh = async () => null;
    plan.applyRateLimit(rateLimit);
    const c = await connect();
    expect(await c.next("usage.plan")).toMatchObject({ plan: { fiveHour: { pct: 50 } } });
  });

  it("polls only while a client is connected", async () => {
    const calls: boolean[] = [];
    plan.setPolling = (on: boolean) => { calls.push(on); };
    const c = await connect();
    c.ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toEqual([true, false]);
  });
});

describe("usage freshness", () => {
  it("refreshes the plan when the first browser connects", async () => {
    let refreshes = 0;
    plan.refresh = async () => { refreshes++; return null; };
    await connect();
    await connect();
    expect(refreshes).toBe(1);
  });

  it("a malformed rate-limit event is ignored", () => {
    expect(() => sup.emit("rateLimit", undefined)).not.toThrow();
  });
});
