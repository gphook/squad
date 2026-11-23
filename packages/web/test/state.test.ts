import { describe, it, expect } from "vitest";
import type { Agent, AgentEvent } from "@squad/shared";
import { currentLayout, emptyState, forProject, reduce } from "../src/lib/reducer.ts";

const agent: Agent = { id: "a", projectId: "p", name: "starfade", role: "", folder: "/f", model: null, sessionId: null };
const project = { id: "p", name: "P", rules: "", permissionMode: "default" as const, layout: { mode: "focussed" as const, slots: {}, main: null } };
const subscribed = () =>
  reduce({ ...emptyState(), projects: [project], projectId: "p" }, {
    t: "state", projectId: "p", agents: [agent], states: [{ agentId: "a", status: "idle" }],
    approvals: [{ id: "ap", agentId: "a", toolName: "Bash", input: {}, summary: "ls", canAlways: false }], messages: [], shares: [],
  });

describe("reduce", () => {
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
    const s = reduce(subscribed(), { t: "layout", projectId: "p", layout: { mode: "tiled", slots: { "1": "a" }, main: null } });
    expect(s.projects[0].layout.mode).toBe("tiled");
    expect(currentLayout(s).mode).toBe("tiled");
  });
  it("gives a default layout when no project is selected", () => {
    expect(currentLayout(emptyState())).toEqual({ mode: "focussed", slots: {}, main: null });
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
