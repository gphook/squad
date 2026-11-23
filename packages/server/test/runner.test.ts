import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentStatus, Project } from "@squad/shared";
import { AgentRunner } from "../src/runner.ts";
import { fakeFactory, tick, type FakeQuery } from "./fakeQuery.ts";

const project: Project = { id: "p", name: "P", rules: "", permissionMode: "default", layout: { mode: "focussed", slots: {}, main: null } };
let folder: string;
let agent: Agent;
let f: ReturnType<typeof fakeFactory>;
let runner: AgentRunner;
let statuses: AgentStatus[];

const make = (a: Agent) => {
  const r = new AgentRunner(project, a, [a], {
    queryFactory: f.factory, mcpServer: { type: "sdk", name: "squad" } as any, radioPluginPath: "/radio", shareDir: "/share",
  });
  r.on("status", (s) => { if (statuses.at(-1) !== s.status) statuses.push(s.status); });
  return r;
};
const q = (): FakeQuery => f.queries[0];
const init = async () => { q().emit({ type: "system", subtype: "init", session_id: "s1" }); await tick(); };
const askTool = () => q().options.canUseTool("Bash", { command: "make test" }, {
  signal: new AbortController().signal, suggestions: [{ type: "addRules" }], toolUseID: "t1",
});

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "squad-agent-"));
  agent = { id: "a1", projectId: "p", name: "starfade", role: "code", folder, model: null, sessionId: null };
  f = fakeFactory();
  statuses = [];
  runner = make(agent);
});

describe("AgentRunner", () => {
  it("goes stopped → starting → idle → working → idle for a send", async () => {
    await runner.launch();
    await init();
    await runner.send("hi");
    q().emit({ type: "result", subtype: "success", is_error: false });
    await tick();
    expect(statuses).toEqual(["starting", "idle", "working", "idle"]);
    expect(q().inputs[0].message.content).toBe("hi");
  });

  it("emits the session id on init", async () => {
    let sid = "";
    runner.on("session", (s) => (sid = s));
    await runner.launch();
    await init();
    expect(sid).toBe("s1");
  });

  it("launches first when sending to a stopped agent", async () => {
    await runner.send("hi");
    expect(f.queries).toHaveLength(1);
    expect(q().inputs).toHaveLength(1);
  });

  it("creates one query when launched twice", async () => {
    await runner.launch();
    await runner.launch();
    expect(f.queries).toHaveLength(1);
  });

  it("passes the agent's options and never the agents option", async () => {
    runner = make({ ...agent, sessionId: "old", model: "opus" });
    await runner.launch();
    const o = q().options;
    expect(o.extraArgs).toEqual({ name: "starfade" });
    expect(o.resume).toBe("old");
    expect(o.model).toBe("opus");
    expect(o.cwd).toBe(folder);
    expect(o.additionalDirectories).toEqual(["/share"]);
    expect(o.permissionMode).toBe("default");
    expect(o.systemPrompt).toMatchObject({ type: "preset", preset: "claude_code" });
    expect(o).not.toHaveProperty("agents");
    expect(o.allowedTools).toEqual(["mcp__squad__squad_team", "mcp__squad__squad_summon", "mcp__squad__squad_share", "mcp__squad__squad_show"]);
  });

  it("surfaces a tool approval and resolves 'always' with the suggested permissions", async () => {
    await runner.launch();
    await init();
    const approvals: any[] = [];
    runner.on("approval", (a) => approvals.push(a));
    const decision = askTool();
    await tick();
    expect(runner.state.status).toBe("awaiting");
    expect(approvals[0]).toMatchObject({ agentId: "a1", toolName: "Bash", summary: "make test", canAlways: true });
    runner.answer(approvals[0].id, "always");
    expect(await decision).toEqual({ behavior: "allow", updatedInput: { command: "make test" }, updatedPermissions: [{ type: "addRules" }] });
    expect(runner.state.status).toBe("working");
    expect(runner.pendingApprovals()).toEqual([]);
  });

  it("denies pending approvals when stopped", async () => {
    await runner.launch();
    await init();
    const resolved: string[] = [];
    runner.on("approvalResolved", (id) => resolved.push(id));
    const decision = askTool();
    await tick();
    const id = runner.pendingApprovals()[0].id;
    await runner.stop();
    expect(await decision).toMatchObject({ behavior: "deny" });
    expect(resolved).toEqual([id]);
    expect(runner.state.status).toBe("stopped");
    expect(q().closed).toBe(true);
  });

  it("ignores messages the old session sends after stop", async () => {
    await runner.launch();
    await init();
    q().emit({ type: "result", subtype: "success", is_error: false });
    await runner.stop();
    await tick(); await tick();
    expect(runner.state.status).toBe("stopped");
  });

  it("goes to error when the folder does not exist", async () => {
    runner = make({ ...agent, folder: "/nope" });
    await runner.launch();
    expect(runner.state).toMatchObject({ status: "error", error: "Folder not found: /nope" });
    expect(f.queries).toHaveLength(0);
  });

  it("goes to working when woken by a peer message", async () => {
    await runner.launch();
    await init();
    q().emit({ type: "command_lifecycle", state: "started" });
    await tick();
    expect(runner.state.status).toBe("working");
  });

  it("goes to error when the session ends unexpectedly", async () => {
    await runner.launch();
    await init();
    q().end();
    await tick();
    expect(runner.state.status).toBe("error");
  });

  it("refreshes context usage after a turn", async () => {
    await runner.launch();
    await init();
    q().emit({ type: "result", subtype: "success", is_error: false });
    await tick(); await tick();
    expect(runner.state.contextPct).toBe(41);
  });

  it("sends /compact and interrupts", async () => {
    await runner.launch();
    await init();
    await runner.compact();
    await runner.interrupt();
    expect(q().inputs.at(-1).message.content).toBe("/compact");
    expect(q().interrupted).toBe(1);
  });

  it("sends images as base64 content blocks", async () => {
    await runner.send("look", ["data:image/png;base64,AAA"]);
    expect(q().inputs[0].message.content).toEqual([
      { type: "text", text: "look" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
    ]);
  });

  it("waitUntilReady resolves once the agent is idle", async () => {
    await runner.launch();
    const ready = runner.waitUntilReady(1000);
    await init();
    expect(await ready).toBe("idle");
  });
});

describe("AgentRunner usage", () => {
  it("emits the session's model usage on result, flagged when the session was resumed", async () => {
    const seen: unknown[] = [];
    const r = make({ ...agent, sessionId: "old" });
    r.on("result", (info) => seen.push(info));
    await r.launch();
    q().emit({ type: "result", subtype: "success", session_id: "old", modelUsage: { m: { outputTokens: 1 } } });
    q().emit({ type: "result", subtype: "success", session_id: "new", modelUsage: {} });
    await tick();
    expect(seen).toEqual([
      { sessionId: "old", modelUsage: { m: { outputTokens: 1 } }, resumed: true },
      { sessionId: "new", modelUsage: {}, resumed: false },
    ]);
  });

  it("forwards rate_limit_event info", async () => {
    const seen: unknown[] = [];
    runner.on("rateLimit", (info) => seen.push(info));
    await runner.launch();
    q().emit({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour" } });
    await tick();
    expect(seen).toEqual([{ status: "allowed", rateLimitType: "five_hour" }]);
  });

  it("exposes its query as a usage source only while running", async () => {
    expect(runner.usageSource).toBeNull();
    await runner.launch();
    expect(runner.usageSource).not.toBeNull();
  });
});
