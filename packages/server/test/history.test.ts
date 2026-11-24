import { describe, it, expect } from "vitest";
import { withCommandOutput } from "../src/history.ts";

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
