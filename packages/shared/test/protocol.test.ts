import { describe, it, expect } from "vitest";
import { parseClientMsg, SLOT_ORDER } from "../src/index.ts";

describe("parseClientMsg", () => {
  it("accepts an effort level on agent.save, and models.get", () => {
    const agent = { projectId: "p", name: "a", role: "", folder: "/tmp", model: null };
    expect(parseClientMsg(JSON.stringify({ t: "agent.save", agent: { ...agent, effort: "low" } }))).toMatchObject({ agent: { effort: "low" } });
    expect(parseClientMsg(JSON.stringify({ t: "agent.save", agent: { ...agent, effort: "turbo" } }))).toHaveProperty("error");
    expect(parseClientMsg(JSON.stringify({ t: "models.get" }))).toEqual({ t: "models.get" });
  });
  it("accepts project.save with or without activities, and rejects a blank activity name", () => {
    const base = { t: "project.save", project: { name: "P", rules: "", permissionMode: "default" } };
    expect(parseClientMsg(JSON.stringify(base))).not.toHaveProperty("error");
    const act = { name: "UI", ownerId: null, reviewerIds: [], description: "" };
    expect(parseClientMsg(JSON.stringify({ ...base, project: { ...base.project, activities: [act] } })))
      .toMatchObject({ project: { activities: [act] } });
    expect(parseClientMsg(JSON.stringify({ ...base, project: { ...base.project, activities: [{ ...act, name: "  " }] } })))
      .toHaveProperty("error");
  });
  it("accepts agent.save with owns", () => {
    const m = parseClientMsg(JSON.stringify({
      t: "agent.save", agent: { projectId: "p", name: "a", role: "", folder: "/tmp", model: null },
      owns: { activityIds: ["x"], newActivities: ["Shaders"] },
    }));
    expect(m).toMatchObject({ owns: { activityIds: ["x"], newActivities: ["Shaders"] } });
  });
  it("accepts a valid agent.send", () => {
    const m = parseClientMsg(JSON.stringify({ t: "agent.send", agentId: "a1", text: "hi" }));
    expect(m).toEqual({ t: "agent.send", agentId: "a1", text: "hi" });
  });
  it("accepts the restart action", () => {
    expect(parseClientMsg(JSON.stringify({ t: "agent.action", agentId: "a", action: "restart" }))).toMatchObject({ action: "restart" });
  });
  it("rejects malformed JSON", () => {
    expect(parseClientMsg("{nope")).toHaveProperty("error");
  });
  it("rejects an unknown message type", () => {
    expect(parseClientMsg(JSON.stringify({ t: "agent.explode" }))).toHaveProperty("error");
  });
  it("rejects an agent name with spaces and capitals", () => {
    const m = parseClientMsg(JSON.stringify({
      t: "agent.save",
      agent: { projectId: "p", name: "Bad Name", role: "r", folder: "/tmp", model: null },
    }));
    expect(m).toHaveProperty("error");
  });
});

describe("SLOT_ORDER", () => {
  it("is 1-9 then 0", () => {
    expect(SLOT_ORDER).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]);
  });
});

describe("layout.save", () => {
  it("accepts a layout with only some slots filled", () => {
    const m = parseClientMsg(JSON.stringify({
      t: "layout.save", projectId: "p", layout: { slots: { "1": "a", "0": "b" }, maximised: "b" },
    }));
    expect(m).not.toHaveProperty("error");
  });
  it("rejects the old mode-based layout", () => {
    const m = parseClientMsg(JSON.stringify({ t: "layout.save", projectId: "p", layout: { mode: "tiled", slots: {}, main: null } }));
    expect(m).toHaveProperty("error");
  });
});

describe("plugin messages", () => {
  it("accepts a plugins.switch that returns a squadmate to following the project", () => {
    const m = { t: "plugins.switch", projectId: "p", pluginId: "x@m", agentId: "a", enabled: null };
    expect(parseClientMsg(JSON.stringify(m))).toEqual(m);
  });
  it("rejects a plugins.switch without a plugin", () => {
    expect(parseClientMsg(JSON.stringify({ t: "plugins.switch", projectId: "p", agentId: null, enabled: true }))).toHaveProperty("error");
  });
  it("accepts the other plugin and marketplace messages", () => {
    for (const m of [
      { t: "plugins.get", projectId: "p" }, { t: "plugins.search", query: "", marketplace: null },
      { t: "plugins.install", projectId: "p", pluginId: "x@m", agentId: null }, { t: "plugins.uninstall", pluginId: "x@m" },
      { t: "plugins.update", pluginId: "x@m" }, { t: "plugins.details", pluginId: "x@m" },
      { t: "marketplace.add", source: "a/b" }, { t: "marketplace.remove", name: "b" }, { t: "marketplace.update", name: "b" },
    ]) expect(parseClientMsg(JSON.stringify(m))).toEqual(m);
  });
});
