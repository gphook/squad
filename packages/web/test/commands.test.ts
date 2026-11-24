import { describe, it, expect } from "vitest";
import type { SlashCommandInfo } from "@squad/shared";
import { completion, isWholeCommand, matchCommands, pickerQuery } from "../src/lib/commands.ts";

const cmd = (name: string, aliases?: string[]): SlashCommandInfo => ({ name, description: "", argumentHint: "", ...(aliases ? { aliases } : {}) });

describe("pickerQuery", () => {
  it("is what follows the / while the command name is being typed", () => {
    expect(pickerQuery("/")).toBe("");
    expect(pickerQuery("/con")).toBe("con");
  });
  it("closes at the first space, so arguments and paths followed by text are left alone", () => {
    expect(pickerQuery("/con ")).toBeNull();
    expect(pickerQuery("/home/me x")).toBeNull();
  });
  it("is null for an ordinary or multi-line message", () => {
    expect(pickerQuery("hi")).toBeNull();
    expect(pickerQuery("/a\nb")).toBeNull();
  });
});

describe("matchCommands", () => {
  const list = [cmd("usage", ["cost"]), cmd("context"), cmd("code-review"), cmd("compact")];
  it("puts name or alias prefix matches first, alphabetically", () => {
    expect(matchCommands(list, "co").map((c) => c.name)).toEqual(["code-review", "compact", "context", "usage"]);
  });
  it("then matches inside names", () => {
    expect(matchCommands(list, "view").map((c) => c.name)).toEqual(["code-review"]);
  });
  it("ignores case", () => {
    expect(matchCommands(list, "CON").map((c) => c.name)).toEqual(["context"]);
  });
  it("lists the first few alphabetically for an empty query", () => {
    expect(matchCommands(list, "", 2).map((c) => c.name)).toEqual(["code-review", "compact"]);
  });
});

describe("completion", () => {
  it("fills in the command and a space for its arguments", () => {
    expect(completion(cmd("context"))).toBe("/context ");
  });
});

describe("isWholeCommand", () => {
  const list = [cmd("clear", ["reset"]), cmd("plugin-authoring")];
  it("is true for a command typed in full, or its alias, so Enter runs it", () => {
    expect(isWholeCommand("clear", list)).toBe(true);
    expect(isWholeCommand("RESET", list)).toBe(true);
  });
  it("is true for a command Squad handles itself, though the session doesn't list it", () => {
    expect(isWholeCommand("plugin", list)).toBe(true);
    expect(isWholeCommand("skills", list)).toBe(true);
    expect(isWholeCommand("resume", list)).toBe(true);
  });
  it("is false for built-in object keys", () => {
    expect(isWholeCommand("constructor", list)).toBe(false);
  });
  it("is false for a partial name, so Enter completes it", () => {
    expect(isWholeCommand("cle", list)).toBe(false);
  });
});
