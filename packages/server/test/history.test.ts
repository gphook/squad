import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandOutputLines, withCommandOutput } from "../src/history.ts";

const out = (uuid: string, parentUuid: string, text: string) =>
  ({ type: "system", subtype: "local_command", uuid, parentUuid, content: `<local-command-stdout>${text}</local-command-stdout>` });

describe("withCommandOutput", () => {
  const cmd = { type: "user", uuid: "u1", message: { content: "<command-name>/context</command-name>" } };
  it("fills in the content getSessionMessages strips from a command's output", () => {
    const msgs = [cmd, { type: "system", uuid: "s1" }, { type: "user", uuid: "u2", message: { content: "hi" } }];
    expect(withCommandOutput(msgs, [out("s1", "u1", "ctx")])).toEqual([cmd, out("s1", "u1", "ctx"), msgs[2]]);
  });
  it("adds output it left out because nothing followed it yet", () => {
    expect(withCommandOutput([cmd], [out("s1", "u1", "ctx")])).toEqual([cmd, out("s1", "u1", "ctx")]);
  });
  it("leaves out output from a branch the conversation doesn't include", () => {
    expect(withCommandOutput([cmd], [out("s9", "elsewhere", "x")])).toEqual([cmd]);
  });
  it("adds output that follows other added output", () => {
    expect(withCommandOutput([cmd], [out("s1", "u1", "a"), out("s2", "s1", "b")])).toEqual([cmd, out("s1", "u1", "a"), out("s2", "s1", "b")]);
  });
});

describe("commandOutputLines", () => {
  const lines = [
    { type: "user", uuid: "u1", message: { content: "<command-name>/context</command-name>" } },
    { type: "system", subtype: "local_command", uuid: "s1", parentUuid: "u1", content: "<local-command-stdout>ctx</local-command-stdout>" },
  ];
  const setup = (dirName: string) => {
    const config = mkdtempSync(join(tmpdir(), "squad-claude-config-"));
    mkdirSync(join(config, "projects", dirName), { recursive: true });
    writeFileSync(join(config, "projects", dirName, "sid.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    process.env.CLAUDE_CONFIG_DIR = config;
  };
  it("reads the output lines from the session file in the folder's project directory", async () => {
    setup("-work-my-repo");
    expect(await commandOutputLines("sid", "/work/my.repo")).toEqual([lines[1]]);
  });
  it("finds the session file in another project directory", async () => {
    setup("-somewhere-else");
    expect(await commandOutputLines("sid", "/work/my.repo")).toEqual([lines[1]]);
  });
  it("is empty when there's no session file", async () => {
    setup("-work-my-repo");
    expect(await commandOutputLines("other", "/work/my.repo")).toEqual([]);
  });
});
