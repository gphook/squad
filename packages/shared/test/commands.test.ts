import { describe, it, expect } from "vitest";
import { parseSlashCommand, routeCommand, SQUAD_COMMANDS, UNAVAILABLE_COMMANDS, type SlashCommandInfo } from "../src/commands.ts";

const cmd = (name: string, aliases?: string[]): SlashCommandInfo => ({ name, description: "", argumentHint: "", ...(aliases ? { aliases } : {}) });

describe("parseSlashCommand", () => {
  it("reads a bare command", () => {
    expect(parseSlashCommand("/clear")).toEqual({ name: "clear", args: "" });
  });
  it("lowercases the name and keeps the arguments", () => {
    expect(parseSlashCommand("/Code-Review high")).toEqual({ name: "code-review", args: "high" });
  });
  it("accepts plugin-scoped names", () => {
    expect(parseSlashCommand("/plugin:skill x")?.name).toBe("plugin:skill");
  });
  it("ignores leading and trailing whitespace", () => {
    expect(parseSlashCommand("  /context \n")).toEqual({ name: "context", args: "" });
  });
  it("is not a command unless the message starts with one", () => {
    expect(parseSlashCommand("hello /clear")).toBeNull();
    expect(parseSlashCommand("/")).toBeNull();
  });
  it("treats a message starting with a path as a message", () => {
    expect(parseSlashCommand("/home/me/notes.txt is broken")).toBeNull();
  });
});

describe("routeCommand", () => {
  it("runs /clear as Squad's Clear", () => {
    expect(routeCommand("clear", [])).toEqual({ kind: "clear" });
  });
  it("runs /exit and /quit as Stop", () => {
    expect(routeCommand("exit", [])).toEqual({ kind: "stop" });
    expect(routeCommand("quit", [])).toEqual({ kind: "stop" });
  });
  it("answers /model with a pointer to the squadmate's settings", () => {
    const r = routeCommand("model", []);
    expect(r.kind).toBe("notice");
    expect(r.kind === "notice" && r.text).toContain("squadmate's settings");
  });
  it("names the command in the notice", () => {
    const r = routeCommand("plugin", []);
    expect(r.kind === "notice" && r.text).toMatch(/^\/plugin isn't/);
  });
  it("sends anything else to the SDK", () => {
    expect(routeCommand("context", [])).toEqual({ kind: "sdk" });
    expect(routeCommand("usage", [])).toEqual({ kind: "sdk" });
  });
  it("resolves the SDK's aliases first", () => {
    expect(routeCommand("new", [cmd("clear", ["reset", "new"])])).toEqual({ kind: "clear" });
    const r = routeCommand("settings", [cmd("config", ["settings"])]);
    expect(r.kind === "notice" && r.text).toMatch(/^\/config /);
  });
});

describe("command lists", () => {
  it("Squad's own commands are clear and exit", () => {
    expect(SQUAD_COMMANDS.map((c) => c.name)).toEqual(["clear", "exit"]);
    expect(SQUAD_COMMANDS[1].aliases).toEqual(["quit"]);
  });
  it("lists the commands Squad can't run", () => {
    expect(Object.keys(UNAVAILABLE_COMMANDS).sort()).toEqual(["config", "model", "plugin", "resume", "skills"]);
  });
});
