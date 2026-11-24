import { describe, it, expect } from "vitest";
import type { Agent, AgentEvent } from "@squad/shared";
import { currentLayout, emptyState, forProject, reduce } from "../src/lib/reducer.ts";

const agent: Agent = { id: "a", projectId: "p", name: "starfade", role: "", folder: "/f", model: null, effort: null, sessionId: null };
const project = { id: "p", name: "P", rules: "", permissionMode: "default" as const, layout: { slots: {}, maximised: null }, activities: [] };
const subscribed = () =>
  reduce({ ...emptyState(), projects: [project], projectId: "p" }, {
    t: "state", projectId: "p", agents: [agent], states: [{ agentId: "a", status: "idle" }],
    approvals: [{ id: "ap", agentId: "a", toolName: "Bash", input: {}, summary: "ls", canAlways: false }], messages: [], shares: [],
  });

describe("reduce", () => {
  const snapshot = (projectId: string) => ({ t: "plugins" as const, projectId, installed: [], marketplaces: [], switches: [], available: 30 });
  it("keeps the plugins snapshot for the current project only, and forgets it for another project", () => {
    let s = reduce(subscribed(), snapshot("other"));
    expect(s.plugins).toBeNull();
    s = reduce(s, snapshot("p"));
    expect(s.plugins).toMatchObject({ available: 30 });
    expect(forProject(s, "q").plugins).toBeNull();
  });
  it("keeps who needs a restart for the current project only", () => {
    const agents = [{ agentId: "a", name: "Ana" }];
    let s = reduce(subscribed(), { t: "plugins.restart", projectId: "other", agents });
    expect(s.pluginRestarts).toEqual([]);
    s = reduce(s, { t: "plugins.restart", projectId: "p", agents });
    expect(s.pluginRestarts).toEqual(agents);
    expect(forProject(s, "q").pluginRestarts).toEqual([]);
  });
  it("keeps search results, details and the last plugin error", () => {
    let s = reduce(subscribed(), { t: "plugins.results", query: "co", marketplace: null, total: 1, items: [] });
    expect(s.pluginResults).toMatchObject({ query: "co", total: 1 });
    s = reduce(s, { t: "plugins.error", action: "marketplace.add", message: "nope" });
    expect(s.pluginError).toEqual({ action: "marketplace.add", message: "nope" });
    s = reduce(s, snapshot("p"));
    expect(s.pluginError).toBeNull();
  });
  it("keeps each squadmate's commands, and forgets them for another project", () => {
    const c = { name: "context", description: "Show context usage", argumentHint: "" };
    const s = reduce(subscribed(), { t: "agent.commands", agentId: "a", commands: [c] });
    expect(s.commands.a).toEqual([c]);
    expect(forProject(s, "q").commands).toEqual({});
  });
  it("replaces project data on state", () => {
    const s = subscribed();
    expect(s.agents).toEqual([agent]);
    expect(s.states.a.status).toBe("idle");
    expect(s.approvals).toHaveLength(1);
  });
  it("ignores state for another project", () => {
    const s = reduce({ ...emptyState(), projectId: "other" }, {
      t: "state", projectId: "p", agents: [agent], states: [], approvals: [], messages: [], shares: [],
    });
    expect(s.agents).toEqual([]);
  });
  it("appends text deltas and replaces them with the following assistant_text", () => {
    let s = subscribed();
    s = reduce(s, { t: "agent.event", agentId: "a", event: { kind: "text_delta", text: "he" } });
    s = reduce(s, { t: "agent.event", agentId: "a", event: { kind: "text_delta", text: "llo" } });
    expect(s.events.a).toEqual([{ kind: "text_delta", text: "hello" }]);
    s = reduce(s, { t: "agent.event", agentId: "a", event: { kind: "assistant_text", text: "hello" } });
    expect(s.events.a).toEqual([{ kind: "assistant_text", text: "hello" }]);
  });
  it("removes a resolved approval", () => {
    expect(reduce(subscribed(), { t: "approval.resolved", approvalId: "ap" }).approvals).toEqual([]);
  });
  it("sets events from history", () => {
    const s = reduce(subscribed(), { t: "agent.history", agentId: "a", events: [{ kind: "user_text", text: "hi" }] });
    expect(s.events.a).toEqual([{ kind: "user_text", text: "hi" }]);
  });
  it("keeps layout on the project and reads it back for the current project", () => {
    const s = reduce(subscribed(), { t: "layout", projectId: "p", layout: { slots: { "1": "a" }, maximised: "a" } });
    expect(s.projects[0].layout.maximised).toBe("a");
    expect(currentLayout(s).maximised).toBe("a");
  });
  it("reads the layout without squadmates that no longer exist", () => {
    const s = reduce(subscribed(), { t: "layout", projectId: "p", layout: { slots: { "1": "a", "2": "gone" }, maximised: "gone" } });
    expect(currentLayout(s)).toEqual({ slots: { "1": "a" }, maximised: null });
  });
  it("a cleared conversation replaces the squadmate's messages with a marker", () => {
    let s = reduce(subscribed(), { t: "agent.event", agentId: "a", event: { kind: "user_text", text: "hi" } });
    s = reduce(s, { t: "agent.event", agentId: "a", event: { kind: "assistant_text", text: "hello" } });
    s = reduce(s, { t: "agent.event", agentId: "a", event: { kind: "cleared" } });
    expect(s.events.a).toEqual([{ kind: "cleared" }]);
  });
  it("gives a default layout when no project is selected", () => {
    expect(currentLayout(emptyState())).toEqual({ slots: {}, maximised: null });
  });
});

describe("usage plan", () => {
  const plan = { available: true, fiveHour: { pct: 10, resetsAt: 1 }, perModel: [], fetchedAt: 1, stale: false };
  it("reducer stores usage.plan", () => {
    expect(reduce(emptyState(), { t: "usage.plan", plan }).plan).toEqual(plan);
  });
  it("switching project keeps the plan and the project list but drops project data", () => {
    const s = forProject({ ...subscribed(), plan }, "q");
    expect(s).toMatchObject({ plan, projects: [project], projectId: "q", agents: [] });
  });
});

describe("shell blocks", () => {
  const ev = (event: AgentEvent) => ({ t: "agent.event" as const, agentId: "a", event });
  const start = (id = "s1"): AgentEvent => ({ kind: "shell", id, command: "ls", chunks: [], running: true, code: null, signal: null });

  it("folds streamed output and the end into the shell event", () => {
    let s = reduce(subscribed(), ev(start()));
    s = reduce(s, ev({ kind: "shell_output", id: "s1", stream: "stdout", text: "a" }));
    s = reduce(s, ev({ kind: "shell_output", id: "s1", stream: "stdout", text: "b" }));
    s = reduce(s, ev({ kind: "shell_output", id: "s1", stream: "stderr", text: "e" }));
    s = reduce(s, ev({ kind: "shell_end", id: "s1", code: 2, signal: null }));
    expect(s.events.a).toEqual([{
      kind: "shell", id: "s1", command: "ls", running: false, code: 2, signal: null,
      chunks: [{ stream: "stdout", text: "ab" }, { stream: "stderr", text: "e" }],
    }]);
  });

  it("finds its block behind later events", () => {
    let s = reduce(subscribed(), ev(start()));
    s = reduce(s, ev({ kind: "assistant_text", text: "hi" }));
    s = reduce(s, ev({ kind: "shell_output", id: "s1", stream: "stdout", text: "a" }));
    expect(s.events.a[0]).toMatchObject({ chunks: [{ stream: "stdout", text: "a" }] });
    expect(s.events.a).toHaveLength(2);
  });

  it("keeps live blocks when history arrives, without duplicating ones history includes", () => {
    let s = reduce(subscribed(), ev(start("live")));
    s = reduce(s, ev(start("both")));
    s = reduce(s, { t: "agent.history", agentId: "a", events: [{ kind: "user_text", text: "old" }, start("both")] });
    expect(s.events.a.map((e) => (e.kind === "shell" ? e.id : e.kind))).toEqual(["user_text", "both", "live"]);
  });

  it("drops output for an unknown block", () => {
    const s = reduce(subscribed(), ev({ kind: "shell_output", id: "nope", stream: "stdout", text: "a" }));
    expect(s.events.a ?? []).toEqual([]);
  });

  it("keeps the newest 200,000 characters of a block", () => {
    let s = reduce(subscribed(), ev(start()));
    s = reduce(s, ev({ kind: "shell_output", id: "s1", stream: "stderr", text: "e".repeat(100_000) }));
    s = reduce(s, ev({ kind: "shell_output", id: "s1", stream: "stdout", text: "o".repeat(150_000) }));
    const block = s.events.a[0] as Extract<AgentEvent, { kind: "shell" }>;
    expect(block.chunks[0]).toEqual({ stream: "stdout", text: "[… earlier output trimmed]\n" });
    expect(block.chunks.slice(1).reduce((n, c) => n + c.text.length, 0)).toBe(200_000);
    expect(block.chunks.at(-1)).toEqual({ stream: "stdout", text: "o".repeat(150_000) });
  });
});
