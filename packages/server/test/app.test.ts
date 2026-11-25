import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import type { ServerMsg } from "@squad/shared";
import { buildApp } from "../src/app.ts";
import { UpdateNotice } from "../src/updateCheck.ts";
import { ClaudeLogin } from "../src/claudeLogin.ts";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Store } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { PlanUsageTracker } from "../src/planUsage.ts";
import { fakeFactory, tick } from "./fakeQuery.ts";
import { FakePluginSource } from "../src/plugins/fakeSource.ts";
import { PluginService, kitPlugin } from "../src/plugins/service.ts";
import { createSignIn, type SignIn } from "../src/signin/index.ts";
import { signedInCookie } from "./signinHelper.ts";
import { hashId } from "../src/signin/sessions.ts";
import { ConnectorService } from "../src/connectors/service.ts";
import type { ConnectorTemplate } from "../src/connectors/template.ts";

const hashOf = (c: Record<string, string>): string => hashId(Object.values(c)[0]!);

let app: FastifyInstance, store: Store, sup: Supervisor, f: ReturnType<typeof fakeFactory>, plan: PlanUsageTracker;
let port: number, projectId: string, agentId: string, folder: string;
let plugins: PluginService;
let signin: SignIn, cookies: Record<string, string>;
let update: UpdateNotice;
let login: ClaudeLogin, loginInput: string[];
let connectors: ConnectorService;
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
  plugins = new PluginService(new FakePluginSource({ delayMs: 0 }), store, kitPlugin(join(import.meta.dirname, "../../../kit")));
  signin = createSignIn(store, { dev: false });
  update = new UpdateNotice();
  loginInput = [];
  login = new ClaudeLogin({
    finished: async () => {},
    signOut: async () => {},
    spawn: () => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true,
        stdin: { write: (s: string) => loginInput.push(s), end: () => {} },
      });
      setImmediate(() => child.stdout.write("visit:\nhttps://claude.ai/oauth/authorize?x\nPaste code here if prompted > "));
      return child;
    },
  });
  const tpl = (id: "github" | "gitlab"): ConnectorTemplate => ({
    id, label: id === "github" ? "GitHub" : "GitLab", defaultHost: `${id}.com`, cli: { bin: id, label: id, installUrl: "x" },
    available: async () => true, accounts: async () => [],
    signInPlan: () => ({ kind: "device", args: [], env: {} }),
    parseDevice: (o) => (o.includes("CODE") ? { code: "CODE-1", url: "https://example.com/device" } : null),
    afterSignIn: async () => {}, signOut: async () => {},
  });
  connectors = new ConnectorService({
    store, templates: { github: tpl("github"), gitlab: tpl("gitlab") },
    spawn: () => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true, stdin: { write: () => true, end: () => {} },
      });
      setImmediate(() => child.stdout.write("CODE"));
      return child;
    },
  });
  app = buildApp({ store, supervisor: sup, signin, plan, plugins, update, login, connectors });
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = (app.server.address() as { port: number }).port;
  cookies = signedInCookie(signin, port);
});
afterEach(async () => {
  open.splice(0).forEach((w) => w.close());
  await app.close();
  plan.dispose();
});

function connect(origin: string | null = `http://127.0.0.1:${port}`, path = "/ws"): Promise<{ ws: WebSocket; msgs: ServerMsg[]; next: (t: string) => Promise<ServerMsg> }> {
  return new Promise((resolve, reject) => {
    const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { ...(origin ? { origin } : {}), cookie } });
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
const host = () => ({ host: `localhost:${port}` });
const files = (path: string, extra = "") =>
  app.inject({ url: `/files?project=${projectId}&agent=${agentId}&path=${encodeURIComponent(path)}${extra}`, cookies, headers: host() });

describe("auth", () => {
  it("rejects requests without a session", async () => {
    expect((await app.inject({ url: "/files?project=x&path=y", headers: host() })).statusCode).toBe(401);
  });
  it("refuses a WebSocket without a session", async () => {
    cookies = {};
    await expect(connect()).rejects.toThrow("HTTP 401");
  });
  it("refuses an upgrade to /ws/ without a session", async () => {
    cookies = {};
    await expect(connect(undefined, "/ws/")).rejects.toThrow("HTTP 401");
  });
  it("refuses a WebSocket with no Origin", async () => {
    await expect(connect(null)).rejects.toThrow("HTTP 403");
  });
  it("rejects a WebSocket from a foreign origin", async () => {
    await expect(connect("https://evil.example")).rejects.toThrow("HTTP 403");
  });
  const closed = (ws: WebSocket) => new Promise<{ code: number; reason: string }>((r) => ws.on("close", (code, reason) => r({ code, reason: String(reason) })));
  const revokeVia = (callerCookies: Record<string, string>, method: "DELETE" | "POST", url: string) =>
    app.inject({ method, url, cookies: callerCookies, headers: { ...host(), origin: `http://localhost:${port}` } });
  it("revoking a session closes its open WebSocket with 4401", async () => {
    const a = signedInCookie(signin, port), b = signedInCookie(signin, port);
    const hashA = hashOf(a);
    cookies = a;
    const ca = await connect();
    cookies = b;
    const cb = await connect();
    const gone = closed(ca.ws);
    expect((await revokeVia(b, "DELETE", `/api/signin/sessions/${hashA}`)).statusCode).toBe(204);
    expect(await gone).toEqual({ code: 4401, reason: "Signed out" });
    expect(cb.ws.readyState).toBe(1);
  });
  it("tells open pages when the sign-in lists change", async () => {
    cookies = signedInCookie(signin, port);
    const c = await connect();
    signedInCookie(signin, port); // another browser signs in
    expect(await c.next("signin.changed")).toEqual({ t: "signin.changed" });
  });
  it("sign out everywhere closes every socket and the caller's cookie is cleared", async () => {
    const a = signedInCookie(signin, port), b = signedInCookie(signin, port);
    cookies = a;
    const ca = await connect();
    cookies = b;
    const cb = await connect();
    const gones = [closed(ca.ws), closed(cb.ws)];
    const r = await revokeVia(b, "POST", "/api/signin/sign-out-everywhere");
    expect(r.statusCode).toBe(204);
    expect(String(r.headers["set-cookie"])).toContain("Max-Age=0");
    expect((await Promise.all(gones)).map((g) => g.code)).toEqual([4401, 4401]);
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
    const r = await app.inject({ url: "/files?project=..%2F..%2F..%2F..%2Fusr&path=share", cookies, headers: host() });
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

  it("reports a failed refresh as such, not as the change that succeeded", async () => {
    const c = await connect();
    send(c.ws, { t: "subscribe", projectId });
    await c.next("state");
    const id = "superpowers@claude-plugins-official";
    vi.spyOn(plugins, "snapshot").mockRejectedValueOnce(new Error("CLI timed out"));
    send(c.ws, { t: "plugins.switch", projectId, pluginId: id, agentId: null, enabled: false });
    expect(await c.next("plugins.error")).toEqual({ t: "plugins.error", action: "plugins.get", message: "CLI timed out" });
    expect(store.listPluginSwitches(projectId)).toEqual([{ pluginId: id, agentId: null, enabled: false }]);
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

  it("tells the project's pages who needs a restart after a switch", async () => {
    const c = await connect();
    send(c.ws, { t: "subscribe", projectId });
    await c.next("state");
    send(c.ws, { t: "plugins.switch", projectId, pluginId: "superpowers@claude-plugins-official", agentId: null, enabled: false });
    expect(await c.next("plugins.restart")).toEqual({ t: "plugins.restart", projectId, agents: [] });
  });

  it("tells every open project's pages after an install", async () => {
    const otherId = store.saveProject({ name: "Q", rules: "", permissionMode: "default" }).id;
    const c1 = await connect(), c2 = await connect();
    send(c1.ws, { t: "subscribe", projectId }); await c1.next("state");
    send(c2.ws, { t: "subscribe", projectId: otherId }); await c2.next("state");
    send(c1.ws, { t: "plugins.install", projectId, pluginId: "frontend-design@claude-plugins-official", agentId: null });
    expect(await c2.next("plugins.restart")).toEqual({ t: "plugins.restart", projectId: otherId, agents: [] });
  });

  it("tells the project's pages when a squadmate starts or stops", async () => {
    const c = await connect();
    send(c.ws, { t: "subscribe", projectId });
    await c.next("state");
    sup.emit("pluginsChanged", projectId);
    expect(await c.next("plugins.restart")).toEqual({ t: "plugins.restart", projectId, agents: [] });
  });

  it("says who needs a restart when the Plugins view asks", async () => {
    const c = await connect();
    send(c.ws, { t: "plugins.get", projectId });
    expect(await c.next("plugins.restart")).toEqual({ t: "plugins.restart", projectId, agents: [] });
  });

  it("re-reads the installed plugins when the Plugins view asks", async () => {
    const spy = vi.spyOn(plugins, "refresh");
    const c = await connect();
    send(c.ws, { t: "plugins.get", projectId });
    await c.next("plugins");
    expect(spy).toHaveBeenCalledOnce();
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

  it("passes AskUserQuestion answers from the page to the squadmate", async () => {
    await sup.action(agentId, "launch");
    f.queries[0].emit({ type: "system", subtype: "init", session_id: "s" });
    await tick();
    const questions = [{ question: "Q?", header: "H", multiSelect: true, options: [{ label: "A", description: "", preview: "```\nA\n```" }] }];
    const decision = f.queries[0].options.canUseTool("AskUserQuestion", { questions }, { signal: new AbortController().signal });
    const c = await connect();
    send(c.ws, { t: "subscribe", projectId });
    const state = (await c.next("state")) as Extract<ServerMsg, { t: "state" }>;
    expect(state.approvals[0].questions).toEqual(questions);
    const annotations = { "Q?": { notes: "keep it small", preview: "```\nA\n```" } };
    send(c.ws, { t: "approval.answer", approvalId: state.approvals[0].id, decision: "allow", answers: { "Q?": "A, mine" }, annotations });
    expect(await decision).toEqual({ behavior: "allow", updatedInput: { questions, answers: { "Q?": "A, mine" }, annotations } });
  });

  it("passes Keep planning's feedback from the page to the squadmate", async () => {
    await sup.action(agentId, "launch");
    f.queries[0].emit({ type: "system", subtype: "init", session_id: "s" });
    await tick();
    const decision = f.queries[0].options.canUseTool("ExitPlanMode", { plan: "Do it" }, { signal: new AbortController().signal });
    const c = await connect();
    send(c.ws, { t: "subscribe", projectId });
    const state = (await c.next("state")) as Extract<ServerMsg, { t: "state" }>;
    expect(state.approvals[0].plan).toBe("Do it");
    send(c.ws, { t: "approval.answer", approvalId: state.approvals[0].id, decision: "deny", feedback: "Smaller steps" });
    expect(await decision).toMatchObject({ behavior: "deny", message: expect.stringContaining("Smaller steps") });
  });

  it("passes an MCP elicitation's form content from the page to the server", async () => {
    await sup.action(agentId, "launch");
    f.queries[0].emit({ type: "system", subtype: "init", session_id: "s" });
    await tick();
    const result = f.queries[0].options.onElicitation(
      { serverName: "s", message: "Name?", requestedSchema: { type: "object", properties: { name: { type: "string" } } } },
      { signal: new AbortController().signal, requestId: "r" },
    );
    const c = await connect();
    send(c.ws, { t: "subscribe", projectId });
    const state = (await c.next("state")) as Extract<ServerMsg, { t: "state" }>;
    expect(state.approvals[0].elicitation).toMatchObject({ mode: "form", fields: [{ name: "name", type: "string" }] });
    send(c.ws, { t: "approval.answer", approvalId: state.approvals[0].id, decision: "allow", content: { name: "Ada" } });
    expect(await result).toEqual({ action: "accept", content: { name: "Ada" } });
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

  it("tells open and newly opened pages about a newer version", async () => {
    const c = await connect();
    update.set({ latest: "9.0.0", current: "0.1.0" });
    expect(await c.next("update")).toEqual({ t: "update", latest: "9.0.0", current: "0.1.0" });
    const late = await connect();
    expect(await late.next("update")).toEqual({ t: "update", latest: "9.0.0", current: "0.1.0" });
  });

  it("answers auth.check, as unknown without a tracker", async () => {
    const c = await connect();
    send(c.ws, { t: "auth.check" });
    expect(await c.next("auth")).toMatchObject({ status: { state: "unknown" } });
  });

  it("refuses a claude.ai or SSO sign-in: only Console is offered (#43)", async () => {
    const c = await connect();
    for (const method of ["claudeai", "sso"]) {
      send(c.ws, { t: "auth.login", method });
      await c.next("error");
    }
    expect(loginInput).toEqual([]);
    expect(c.msgs.some((m) => m.t === "auth.login" && m.login.phase !== "idle")).toBe(false);
  });

  it("runs a Claude sign-in for every page: the link out, a pasted code in", async () => {
    const a = await connect();
    const b = await connect();
    send(a.ws, { t: "auth.login", method: "console" });
    const waiting = (m: ServerMsg) => m.t === "auth.login" && m.login.phase === "waiting";
    const nextWaiting = async (c: Awaited<ReturnType<typeof connect>>) => {
      while (!c.msgs.some(waiting)) await tick();
      return c.msgs.find(waiting);
    };
    expect(await nextWaiting(b)).toEqual({ t: "auth.login", login: { phase: "waiting", url: "https://claude.ai/oauth/authorize?x" } });
    send(b.ws, { t: "auth.code", code: "abc" });
    while (!loginInput.length) await tick();
    expect(loginInput).toEqual(["abc\n"]);
    const late = await connect();
    expect(await late.next("auth.login")).toEqual({ t: "auth.login", login: { phase: "verifying", url: "https://claude.ai/oauth/authorize?x" } });
    send(a.ws, { t: "auth.cancel" });
    while (!a.msgs.some((m) => m.t === "auth.login" && m.login.phase === "idle")) await tick();
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
  const usage = (qs: string, c: Record<string, string> = cookies) => app.inject({ url: `/api/usage?${qs}`, cookies: c, headers: host() });

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

  it("requires a session", async () => {
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

describe("connectors", () => {
  it("lists connectors on request and broadcasts an added one to every page", async () => {
    const [c1, c2] = [await connect(), await connect()];
    send(c1.ws, { t: "connectors.get" });
    expect(await c1.next("connectors")).toEqual({ t: "connectors", connectors: [] });
    send(c1.ws, { t: "connector.add", template: "github", name: "Acme", host: "github.acme.com" });
    for (const c of [c1, c2]) {
      expect(await c.next("connectors")).toMatchObject({ connectors: [{ name: "Acme", host: "github.acme.com", state: "signed-out" }] });
    }
  });

  it("tells a newly connected page the sign-in state even when idle, so a stale one clears", async () => {
    const c = await connect();
    expect(await c.next("connector.login")).toEqual({ t: "connector.login", login: { phase: "idle" } });
  });

  it("answers a bad host with connector.error", async () => {
    const c = await connect();
    send(c.ws, { t: "connector.add", template: "gitlab", name: "", host: "https://gitlab.com" });
    expect(await c.next("connector.error")).toMatchObject({ message: expect.stringContaining("isn't a hostname") });
  });

  it("broadcasts a running sign-in, and sends it to a page that connects mid-way", async () => {
    const c1 = await connect();
    const made = await connectors.add("github", "", "github.com");
    send(c1.ws, { t: "connector.login", id: made.id });
    const waiting = { t: "connector.login", login: { phase: "waiting", id: made.id, code: "CODE-1", url: "https://example.com/device" } };
    await vi.waitFor(async () => expect(connectors.login.phase).toBe("waiting"));
    const c2 = await connect();
    expect(await c2.next("connector.login")).toEqual(waiting);
    send(c1.ws, { t: "connector.cancel" });
    expect(await c2.next("connector.login")).toEqual({ t: "connector.login", login: { phase: "idle" } });
  });

  it("adds a connector hint to a marketplace add that failed to authenticate", async () => {
    await connectors.add("github", "Acme", "github.acme.com");
    vi.spyOn(plugins, "addMarketplace").mockRejectedValue(new Error("fatal: Authentication failed for 'https://github.acme.com/a/b.git/'"));
    const c = await connect();
    send(c.ws, { t: "subscribe", projectId });
    await c.next("state");
    send(c.ws, { t: "marketplace.add", source: "https://github.acme.com/a/b.git" });
    expect(await c.next("plugins.error")).toMatchObject({
      action: "marketplace.add",
      message: "fatal: Authentication failed for 'https://github.acme.com/a/b.git/' Sign in to Acme (github.acme.com) under Connectors, then try again.",
    });
  });
});
