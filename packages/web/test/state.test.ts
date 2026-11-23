import { describe, it, expect } from "vitest";
import type { Agent } from "@squad/shared";
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
