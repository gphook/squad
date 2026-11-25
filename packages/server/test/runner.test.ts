import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentShellPrompt, bashContextBlock, type Agent, type AgentEvent, type AgentStatus, type Project } from "@squad/shared";
import type { ShellHandlers } from "../src/shellCommand.ts";
import { AgentRunner } from "../src/runner.ts";
import { fakeFactory, tick, type FakeQuery } from "./fakeQuery.ts";

const project: Project = { id: "p", name: "P", rules: "", permissionMode: "default", layout: { slots: {}, maximised: null }, activities: [] };
let folder: string;
let agent: Agent;
let f: ReturnType<typeof fakeFactory>;
let runner: AgentRunner;
let statuses: AgentStatus[];

const make = (a: Agent) => {
  const r = new AgentRunner(project, a, [a], {
    queryFactory: f.factory, mcpServer: { type: "sdk", name: "squad" } as any, kitPluginPath: "/kit", shareDir: "/share",
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
  agent = { id: "a1", projectId: "p", name: "starfade", role: "code", folder, model: null, effort: null, sessionId: null };
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

  it("passes the squadmate's effort when it has one", async () => {
    runner = make({ ...agent, effort: "low" });
    await runner.launch();
    expect(q().options.effort).toBe("low");
  });

  it("leaves effort to the default when none is set", async () => {
    await runner.launch();
    expect(q().options).not.toHaveProperty("effort");
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

  describe("AskUserQuestion", () => {
    const questions = [
      { question: "Which colour?", header: "Colour", multiSelect: false, options: [{ label: "Red", description: "warm" }, { label: "Blue", description: "cool" }] },
    ];
    const ask = (ctl = new AbortController()) =>
      q().options.canUseTool("AskUserQuestion", { questions }, { signal: ctl.signal, suggestions: [], toolUseID: "t2" });

    it("sends the questions and resolves with the user's answers", async () => {
      await runner.launch();
      await init();
      const approvals: any[] = [];
      runner.on("approval", (a) => approvals.push(a));
      const decision = ask();
      await tick();
      expect(approvals[0]).toMatchObject({ toolName: "AskUserQuestion", questions });
      runner.answer(approvals[0].id, "allow", { answers: { "Which colour?": "Blue" } });
      expect(await decision).toEqual({ behavior: "allow", updatedInput: { questions, answers: { "Which colour?": "Blue" } } });
      expect(runner.state.status).toBe("working");
    });

    it("keeps option previews and returns the user's notes as annotations", async () => {
      await runner.launch();
      await init();
      const withPreview = [{ ...questions[0], options: [{ label: "Red", description: "", preview: "#f00" }, { label: "Blue", description: "" }] }];
      const decision = q().options.canUseTool("AskUserQuestion", { questions: withPreview }, { signal: new AbortController().signal, suggestions: [], toolUseID: "t3" });
      await tick();
      const a = runner.pendingApprovals()[0];
      expect(a.questions?.[0].options).toEqual([{ label: "Red", description: "", preview: "#f00" }, { label: "Blue", description: "" }]);
      const annotations = { "Which colour?": { notes: "brighter", preview: "#f00" } };
      runner.answer(a.id, "allow", { answers: { "Which colour?": "Red" }, annotations });
      expect(await decision).toEqual({
        behavior: "allow", updatedInput: { questions: withPreview, answers: { "Which colour?": "Red" }, annotations },
      });
    });

    it("tells the squadmate to ask in chat when the user skips, or allows with no answers", async () => {
      await runner.launch();
      await init();
      const first = ask();
      await tick();
      runner.answer(runner.pendingApprovals()[0].id, "deny");
      expect(await first).toMatchObject({ behavior: "deny", message: expect.stringContaining("Ask them in chat") });
      const second = ask();
      await tick();
      runner.answer(runner.pendingApprovals()[0].id, "allow");
      expect(await second).toMatchObject({ behavior: "deny", message: expect.stringContaining("Ask them in chat") });
    });

    it("drops the questions when the tool call is aborted", async () => {
      await runner.launch();
      await init();
      const ctl = new AbortController();
      const decision = ask(ctl);
      await tick();
      ctl.abort();
      expect(await decision).toMatchObject({ behavior: "deny" });
      expect(runner.pendingApprovals()).toEqual([]);
    });

    it("keeps unusable input as a plain approval", async () => {
      await runner.launch();
      await init();
      void q().options.canUseTool("AskUserQuestion", { questions: "nope" }, { signal: new AbortController().signal, toolUseID: "t3" });
      await tick();
      expect(runner.pendingApprovals()[0].questions).toBeUndefined();
    });
  });

  describe("ExitPlanMode", () => {
    const input = { plan: "# Plan\n\n1. Do it" };
    const exit = (i: Record<string, unknown> = input, ctl = new AbortController()) =>
      q().options.canUseTool("ExitPlanMode", i, { signal: ctl.signal, suggestions: [], toolUseID: "p1" });

    it("sends the plan and lets the squadmate go ahead on Approve", async () => {
      await runner.launch();
      await init();
      const decision = exit();
      await tick();
      const a = runner.pendingApprovals()[0];
      expect(a).toMatchObject({ toolName: "ExitPlanMode", plan: "# Plan\n\n1. Do it" });
      runner.answer(a.id, "allow");
      expect(await decision).toEqual({ behavior: "allow", updatedInput: input });
    });

    it("sends Keep planning's feedback back as the deny message", async () => {
      await runner.launch();
      await init();
      const first = exit();
      await tick();
      runner.answer(runner.pendingApprovals()[0].id, "deny", { feedback: "  Add tests first.  " });
      const r = await first;
      expect(r).toMatchObject({ behavior: "deny", message: expect.stringContaining("keep planning") });
      expect((r as { message: string }).message).toMatch(/Their feedback:\n\nAdd tests first\.$/);
      const second = exit();
      await tick();
      runner.answer(runner.pendingApprovals()[0].id, "deny");
      expect(await second).toEqual({ behavior: "deny", message: expect.not.stringContaining("feedback") });
    });

    it("keeps a call without a plan as a plain approval", async () => {
      await runner.launch();
      await init();
      void exit({});
      await tick();
      expect(runner.pendingApprovals()[0].plan).toBeUndefined();
    });
  });

  it("declares no dialog kinds and leaves an undeclared dialog unanswered", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runner.launch();
    expect(q().options).not.toHaveProperty("supportedDialogKinds");
    const result = await q().options.onUserDialog({ dialogKind: "refusal_fallback_prompt", payload: { model: "x" } }, { signal: new AbortController().signal });
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("refusal_fallback_prompt"));
    warn.mockRestore();
  });

  describe("MCP elicitation", () => {
    const form = {
      serverName: "linear", message: "Pick a team", mode: "form" as const,
      requestedSchema: { type: "object", required: ["team"], properties: { team: { type: "string", enum: ["eng", "ops"] }, notify: { type: "boolean" } } },
    };
    const elicit = (req: any = form, ctl = new AbortController()) => q().options.onElicitation(req, { signal: ctl.signal, requestId: "r1" });

    it("shows the form and accepts with the user's content", async () => {
      await runner.launch();
      await init();
      const result = elicit();
      await tick();
      const a = runner.pendingApprovals()[0];
      expect(a.elicitation).toMatchObject({ serverName: "linear", mode: "form", fields: [{ name: "team", type: "choice", required: true }, { name: "notify", type: "boolean" }] });
      expect(runner.state.status).toBe("awaiting");
      runner.answer(a.id, "allow", { content: { team: "eng", notify: true, extra: "x" } });
      expect(await result).toEqual({ action: "accept", content: { team: "eng", notify: true } });
    });

    it("declines on deny or a missing required field, and cancels on abort", async () => {
      await runner.launch();
      await init();
      const denied = elicit();
      await tick();
      runner.answer(runner.pendingApprovals()[0].id, "deny");
      expect(await denied).toEqual({ action: "decline" });
      const missing = elicit();
      await tick();
      runner.answer(runner.pendingApprovals()[0].id, "allow", { content: { team: "nope" } });
      expect(await missing).toEqual({ action: "decline" });
      const ctl = new AbortController();
      const aborted = elicit(form, ctl);
      await tick();
      ctl.abort();
      expect(await aborted).toEqual({ action: "cancel" });
    });

    it("accepts a url request without content and drops non-http links", async () => {
      await runner.launch();
      await init();
      const ok = elicit({ serverName: "gh", message: "Sign in", mode: "url", url: "https://example.com/auth" });
      await tick();
      const a = runner.pendingApprovals()[0];
      expect(a.elicitation).toMatchObject({ mode: "url", url: "https://example.com/auth" });
      runner.answer(a.id, "allow");
      expect(await ok).toEqual({ action: "accept" });
      void elicit({ serverName: "gh", message: "x", mode: "url", url: "javascript:alert(1)" });
      await tick();
      expect(runner.pendingApprovals()[0].elicitation?.url).toBeUndefined();
    });
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

  it("is ready once Claude Code has started, before any prompt", async () => {
    await runner.launch();
    expect(runner.state.status).toBe("starting");
    q().initialize();
    await tick();
    expect(runner.state.status).toBe("idle");
  });

  it("knows its Claude Code process id once started", async () => {
    await runner.launch();
    expect(runner.sessionPid).toBeNull();
    q().initialize({ pid: 4242 });
    await tick();
    expect(runner.sessionPid).toBe(4242);
    await runner.stop();
    expect(runner.sessionPid).toBeNull();
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

  it("asks for the summary context reading, not the full token count", async () => {
    await runner.launch();
    await init();
    q().emit({ type: "result", subtype: "success", is_error: false });
    await tick(); await tick();
    expect(q().contextCalls).toEqual([{ detail: "summary" }]);
  });

  it("refreshes context usage after a compaction", async () => {
    await runner.launch();
    await init();
    q().emit({ type: "system", subtype: "compact_boundary" });
    await tick(); await tick();
    expect(runner.state.contextPct).toBe(41);
  });

  it("drops the context reading when stopped, so a relaunch starts without one", async () => {
    await runner.launch();
    await init();
    q().emit({ type: "result", subtype: "success", is_error: false });
    await tick(); await tick();
    await runner.stop();
    expect(runner.state.contextPct).toBeUndefined();
  });

  it("ignores a context reading that lands after the stop", async () => {
    await runner.launch();
    await init();
    let release!: () => void;
    q().contextGate = new Promise((r) => (release = r));
    q().emit({ type: "result", subtype: "success", is_error: false });
    await tick();
    await runner.stop();
    release();
    await tick(); await tick();
    expect(runner.state.contextPct).toBeUndefined();
  });

  it("drops the context reading when the session errors", async () => {
    await runner.launch();
    await init();
    q().emit({ type: "result", subtype: "success", is_error: false });
    await tick(); await tick();
    q().end();
    await tick();
    expect(runner.state.status).toBe("error");
    expect(runner.state.contextPct).toBeUndefined();
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

describe("AgentRunner shell commands", () => {
  let shells: { command: string; cwd: string; h: ShellHandlers; killed: boolean; forced: boolean; shellName?: string }[];
  let events: AgentEvent[];
  beforeEach(() => {
    shells = [];
    events = [];
    runner = new AgentRunner(project, agent, [agent], {
      queryFactory: f.factory, mcpServer: { type: "sdk", name: "squad" } as any, kitPluginPath: "/kit", shareDir: "/share",
      runShell: (command, cwd, h, shell) => {
        const s = { command, cwd, h, killed: false, forced: false, shellName: shell?.name };
        shells.push(s);
        return { kill: (force?: boolean) => { s.killed = true; s.forced = Boolean(force); } };
      },
    });
    runner.on("event", (e: AgentEvent) => events.push(e));
  });
  const finish = (i: number, out: string, code = 0) => { shells[i].h.onChunk("stdout", out); shells[i].h.onEnd(code, null); };
  const block = (command: string, stdout: string) => bashContextBlock({ command, stdout, stderr: "", code: 0, signal: null });

  it("runs $ cmd in the folder without starting a session, streaming its events", async () => {
    await runner.send("$ ls");
    expect(f.queries).toHaveLength(0);
    expect(shells[0]).toMatchObject({ command: "ls", cwd: folder });
    finish(0, "a\n");
    const id = (events[0] as { id: string }).id;
    expect(events).toEqual([
      { kind: "shell", id, command: "ls", chunks: [], running: true, code: null, signal: null, shellName: expect.any(String) },
      { kind: "shell_output", id, stream: "stdout", text: "a\n" },
      { kind: "shell_end", id, code: 0, signal: null },
    ]);
  });

  it("hands a finished $ cmd to the squadmate with the user's next message, once", async () => {
    await runner.send("$ ls");
    finish(0, "a\n");
    await runner.send("hi");
    await init();
    expect(q().inputs.at(-1).message.content).toBe(`${block("ls", "a\n")}\n\nhi`);
    expect(events.at(-1)).toEqual({ kind: "user_text", text: "hi" });
    await runner.send("again");
    await tick();
    expect(q().inputs.at(-1).message.content).toBe("again");
  });

  it("holds a still-running command until it finishes", async () => {
    await runner.send("$ make");
    await runner.send("hi");
    await init();
    expect(q().inputs.at(-1).message.content).toBe("hi");
    finish(0, "done");
    await runner.send("next");
    await tick();
    expect(q().inputs.at(-1).message.content).toBe(`${block("make", "done")}\n\nnext`);
  });

  it("asks the squadmate to run !cmd, showing what the user typed", async () => {
    await runner.send("!ls");
    await init();
    expect(q().inputs.at(-1).message.content).toBe(agentShellPrompt("ls"));
    expect(events.at(-1)).toEqual({ kind: "user_text", text: "!ls" });
  });

  it("kills a shell by id, and all of them", async () => {
    await runner.send("$ a");
    await runner.send("$ b");
    runner.killShell((events[0] as { id: string }).id);
    expect(shells.map((s) => s.killed)).toEqual([true, false]);
    runner.killAllShells();
    expect(shells[1].killed).toBe(true);
  });

  it("takeShellContext returns and clears; discardShellContext drops", async () => {
    await runner.send("$ ls");
    finish(0, "a");
    expect(runner.takeShellContext()).toEqual([block("ls", "a")]);
    expect(runner.takeShellContext()).toEqual([]);
    await runner.send("$ pwd");
    finish(1, "/x");
    runner.discardShellContext();
    expect(runner.takeShellContext()).toEqual([]);
  });

  it("names the user's shell on the block and runs the command with it", async () => {
    const saved = process.env.SHELL;
    process.env.SHELL = "/bin/zsh";
    try {
      await runner.send("$ ls");
    } finally {
      process.env.SHELL = saved;
    }
    expect(events[0]).toMatchObject({ kind: "shell", shellName: "zsh" });
    expect(shells[0].shellName).toBe("zsh");
  });

  it("kills at once when asked to force", async () => {
    await runner.send("$ a");
    runner.killAllShells(true);
    expect(shells[0].forced).toBe(true);
  });

  it("keeps a snapshot of running and undelivered blocks for a reloaded page", async () => {
    await runner.send("$ ls");
    shells[0].h.onChunk("stdout", "a");
    const id = (events[0] as { id: string }).id;
    expect(runner.shellSnapshots()).toEqual([
      { kind: "shell", id, command: "ls", chunks: [{ stream: "stdout", text: "a" }], running: true, code: null, signal: null, shellName: expect.any(String) },
    ]);
    shells[0].h.onEnd(0, null);
    await runner.send("$ make");
    expect(runner.shellSnapshots().map((e) => (e as { running: boolean }).running)).toEqual([false, true]);
    runner.takeShellContext();
    expect(runner.shellSnapshots().map((e) => (e as { command: string }).command)).toEqual(["make"]);
  });

  it("drops output from a command that ends after its context was discarded", async () => {
    await runner.send("$ make");
    runner.discardShellContext();
    finish(0, "late");
    expect(runner.takeShellContext()).toEqual([]);
    expect(runner.shellSnapshots()).toEqual([]);
  });

  it("holds queued output back from a slash command", async () => {
    await runner.send("$ ls");
    finish(0, "a\n");
    await runner.send("/compact");
    await init();
    expect(q().inputs.at(-1).message.content).toBe("/compact");
    await runner.send("hi");
    await tick();
    expect(q().inputs.at(-1).message.content).toBe(`${block("ls", "a\n")}\n\nhi`);
  });

  it("batches fast output into fewer events", async () => {
    await runner.send("$ yes");
    shells[0].h.onChunk("stdout", "a");
    shells[0].h.onChunk("stdout", "b");
    shells[0].h.onChunk("stderr", "e");
    await new Promise((r) => setTimeout(r, 120));
    expect(events.filter((e) => e.kind === "shell_output")).toEqual([
      { kind: "shell_output", id: (events[0] as { id: string }).id, stream: "stdout", text: "ab" },
      { kind: "shell_output", id: (events[0] as { id: string }).id, stream: "stderr", text: "e" },
    ]);
  });

  it("puts shell context given at launch into the launch prompt", async () => {
    await runner.launch({ shellContext: [block("ls", "a")] });
    expect(q().options.systemPrompt.append).toContain(block("ls", "a"));
  });
});

describe("command list", () => {
  const context = { name: "context", description: "Show context usage", argumentHint: "" };
  it("keeps the session's commands from init, and announces them", async () => {
    const seen: unknown[] = [];
    runner.on("commands", (c) => seen.push(c));
    await runner.launch();
    q().initialize({ commands: [context] });
    await tick();
    expect(runner.commands).toEqual([context]);
    expect(seen).toEqual([[context]]);
  });
  it("replaces them on commands_changed and keeps them after stop", async () => {
    await runner.launch();
    q().initialize({ commands: [context] });
    await tick();
    const usage = { name: "usage", description: "u", argumentHint: "", aliases: ["cost"] };
    q().emit({ type: "system", subtype: "commands_changed", commands: [context, usage] });
    await tick();
    expect(runner.commands).toEqual([context, usage]);
    await runner.stop();
    expect(runner.commands).toEqual([context, usage]);
  });
});

describe("AgentRunner plugins", () => {
  const withPlugins = (launchPlugins: () => Promise<{ paths: string[]; off: string[] }>) => new AgentRunner(project, agent, [agent], {
    queryFactory: f.factory, mcpServer: { type: "sdk", name: "squad" } as any, kitPluginPath: "/kit", shareDir: "/share", launchPlugins,
  });

  it("loads switched-on plugins beside squad-kit and switches others off", async () => {
    const r = withPlugins(async () => ({ paths: ["/p/x"], off: ["y@m"] }));
    await r.launch();
    expect(q().options.plugins).toEqual([{ type: "local", path: "/kit" }, { type: "local", path: "/p/x" }]);
    expect(q().options.settings).toEqual({ enabledPlugins: { "y@m": false } });
    expect(r.launchedPlugins).toEqual({ paths: ["/p/x"], off: ["y@m"] });
    await r.stop();
    expect(r.launchedPlugins).toBeNull();
  });

  it("passes no settings when nothing is switched off", async () => {
    await withPlugins(async () => ({ paths: [], off: [] })).launch();
    expect(q().options).not.toHaveProperty("settings");
  });

  it("still launches with squad-kit when the plugins can't be worked out, and says so", async () => {
    const r = withPlugins(() => Promise.reject(new Error("boom")));
    const events: AgentEvent[] = [];
    r.on("event", (e) => events.push(e));
    await r.launch();
    expect(q().options.plugins).toEqual([{ type: "local", path: "/kit" }]);
    expect(events).toContainEqual({ kind: "command_output", text: "Plugins couldn't be loaded: boom", notice: true });
    expect(r.launchedPlugins).toEqual({ paths: [], off: [] });
  });
});
