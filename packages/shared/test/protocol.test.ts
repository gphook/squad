import { describe, it, expect } from "vitest";
import { parseClientMsg, SLOT_ORDER } from "../src/index.ts";

describe("parseClientMsg", () => {
  it("accepts a valid agent.send", () => {
    const m = parseClientMsg(JSON.stringify({ t: "agent.send", agentId: "a1", text: "hi" }));
    expect(m).toEqual({ t: "agent.send", agentId: "a1", text: "hi" });
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
      t: "layout.save", projectId: "p", layout: { mode: "tiled", slots: { "1": "a", "0": "b" }, main: null },
    }));
    expect(m).not.toHaveProperty("error");
  });
});
