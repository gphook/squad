import { describe, it, expect } from "vitest";
import fx from "./fixtures/sdk-messages.json" with { type: "json" };
import { agentShellPrompt, bashContextBlock } from "@squad/shared";
import { historyEvents, normalise, parsePeerMessage, peerAddress, renamePeers, summariseTool } from "../src/normalise.ts";

const n = (m: unknown) => normalise(m as never);

describe("normalise", () => {
  it("maps stream text deltas to text_delta", () => {
    const m = { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "he" } } };
    expect(n(m)).toEqual([{ kind: "text_delta", text: "he" }]);
  });
  it("maps assistant text blocks to assistant_text", () => {
    expect(n(fx.assistantText)).toEqual([{ kind: "assistant_text", text: "ok" }]);
  });
  it("adds peer_out for a SendMessage tool call", () => {
    const ev = n(fx.assistantSend);
    expect(ev).toContainEqual({ kind: "peer_out", to: "squad-spike-b", text: "ping" });
    expect(ev.find((e) => e.kind === "tool_use")).toMatchObject({ name: "SendMessage", summary: "squad-spike-b: ping" });
  });
  it("adds show for a squad_show tool call", () => {
    const m = { type: "assistant", message: { content: [
      { type: "tool_use", id: "t1", name: "mcp__squad__squad_show", input: { target: "captures/a.png", caption: "HUD" } },
    ] } };
    expect(n(m)).toContainEqual({ kind: "show", target: "captures/a.png", caption: "HUD" });
  });
  it("maps tool results, including image blocks as data URLs", () => {
    expect(n(fx.userToolResult)[0]).toMatchObject({ kind: "tool_result", toolUseId: "toolu_01G7cfXCFaKuB8K1G6x4sDWg", isError: false });
    const img = { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
    ] }] } };
    expect(n(img)[0]).toMatchObject({ images: ["data:image/png;base64,AAA"] });
  });
  it("maps a plain user message to user_text and a cross-session message to peer_in", () => {
    expect(n({ type: "user", message: { content: "hello" } })).toEqual([{ kind: "user_text", text: "hello" }]);
    const peer = '<cross-session-message from="uds:/x.sock" from-name="sf-modeller">\nready\n</cross-session-message>';
    expect(n({ type: "user", message: { content: peer } })).toEqual([{ kind: "peer_in", from: "sf-modeller", text: "ready" }]);
  });
  it("ignores synthetic user messages such as loaded skills and compaction summaries", () => {
    expect(n({ type: "user", isSynthetic: true, message: { content: "Base directory for this skill: /x" } })).toEqual([]);
  });
  it("ignores meta and compact-summary user messages read back from session history", () => {
    expect(n({ type: "user", isMeta: true, message: { content: "Base directory for this skill: /x" } })).toEqual([]);
    expect(n({ type: "user", isCompactSummary: true, message: { content: "This session is being continued" } })).toEqual([]);
  });
  it("shows a slash command as the command and drops its local output", () => {
    expect(n({ type: "user", message: { content: "<command-name>/compact</command-name>\n<command-message>compact</command-message>" } }))
      .toEqual([{ kind: "user_text", text: "/compact" }]);
    expect(n({ type: "user", message: { content: "<local-command-stdout>Compacted </local-command-stdout>" } })).toEqual([]);
  });
  it("ignores messages from a subagent inside the agent's session", () => {
    expect(n({ type: "assistant", parent_tool_use_id: "toolu_x", message: { content: [{ type: "text", text: "sub" }] } })).toEqual([]);
  });
  it("ignores replayed user messages", () => {
    expect(n({ type: "user", isReplay: true, message: { content: "<local-command-stdout>Compacted </local-command-stdout>" } })).toEqual([]);
  });
  it("maps compact_boundary and result", () => {
    expect(n(fx.compactBoundary)).toEqual([{ kind: "compacted" }]);
    expect(n(fx.result)).toEqual([{ kind: "turn_end", ok: true }]);
    expect(n({ type: "result", subtype: "error_during_execution", is_error: true })).toEqual([
      { kind: "turn_end", ok: false, error: "error_during_execution" },
    ]);
  });
  it("ignores other message types", () => {
    expect(n(fx.init)).toEqual([]);
    expect(n(fx.commandStarted)).toEqual([]);
  });
});

describe("peerAddress", () => {
  // The shape Claude Code actually delivers: a harness (isMeta) user message.
  const delivered = {
    type: "user", isMeta: true,
    message: { content: 'Another Claude session sent a message: <cross-session-message from="uds:/run/user/1000/cc-socks/574797.sock" from-name="starfade" from-mode="prompting">one word?</cross-session-message>' },
  };
  it("reads the sender's name and session address, even from a harness message", () => {
    expect(peerAddress(delivered)).toEqual({ name: "starfade", address: "uds:/run/user/1000/cc-socks/574797.sock" });
  });
  it("is null without both, or for other messages", () => {
    expect(peerAddress({ type: "user", message: { content: '<cross-session-message from-name="x">hi</cross-session-message>' } })).toBeNull();
    expect(peerAddress({ type: "user", message: { content: "hello" } })).toBeNull();
    expect(peerAddress({ type: "assistant" })).toBeNull();
  });
});

describe("parsePeerMessage", () => {
  it("parses the probe message", () => {
    const t = '<cross-session-message from="uds:/run/user/1000/cc-socks/55521.sock" from-name="squad-probe" from-mode="prompting">\npong\n</cross-session-message>';
    expect(parsePeerMessage(t)).toEqual({ from: "squad-probe", body: "pong" });
  });
  it("returns null for ordinary text", () => {
    expect(parsePeerMessage("hi")).toBeNull();
  });
});

describe("summariseTool", () => {
  it("summarises common tools", () => {
    expect(summariseTool("Bash", { command: "make test" })).toBe("make test");
    expect(summariseTool("Edit", { file_path: "scenes/hud.tscn" })).toBe("scenes/hud.tscn");
    expect(summariseTool("Glob", { pattern: "*" })).toBe("Glob");
    expect(summariseTool("Bash", { command: "x".repeat(200) })).toHaveLength(80);
  });
});

describe("normalise shell commands", () => {
  const user = (text: string) => ({ type: "user", message: { role: "user", content: text } });
  it("turns delivered $ cmd output back into shell blocks, then the message", () => {
    const block = bashContextBlock({ command: "ls", stdout: "a", stderr: "e", code: 0, signal: null });
    const ev = n(user(`${block}\n\nhi`));
    expect(ev).toEqual([
      { kind: "shell", id: expect.any(String), command: "ls", chunks: [{ stream: "stdout", text: "a" }, { stream: "stderr", text: "e" }], running: false, code: null, signal: null },
      { kind: "user_text", text: "hi" },
    ]);
  });
  it("leaves out empty streams and gives each block its own id", () => {
    const block = bashContextBlock({ command: "true", stdout: "", stderr: "", code: 0, signal: null });
    const [a] = n(user(block)), [b] = n(user(block));
    expect(a).toMatchObject({ kind: "shell", chunks: [] });
    expect((a as { id: string }).id).not.toBe((b as { id: string }).id);
    expect(n(user(block))).toHaveLength(1);
  });
  it("shows an !cmd request as the user typed it", () => {
    expect(n(user(agentShellPrompt("ls")))).toEqual([{ kind: "user_text", text: "!ls" }]);
  });
});

describe("squadmate addresses shown as names", () => {
  const ADDR = "uds:/run/user/1000/cc-socks/590830.sock";
  const delivered = {
    type: "user", isMeta: true,
    message: { content: `Another Claude session sent a message: <cross-session-message from="${ADDR}" from-name="starfade" from-mode="prompting">one word?</cross-session-message>` },
  };
  const reply = { type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "SendMessage", input: { to: ADDR, message: "Received." } }] } };

  it("renamePeers rewrites a reply's recipient and its tool summary", () => {
    const names = new Map([[ADDR, "starfade"]]);
    expect(renamePeers(n(reply), names)).toEqual([
      { kind: "tool_use", id: "t", name: "SendMessage", summary: "starfade: Received.", input: { to: ADDR, message: "Received." } },
      { kind: "peer_out", to: "starfade", text: "Received." },
    ]);
    expect(renamePeers(n(reply), new Map())).toEqual(n(reply));
  });

  it("history names a reply's recipient from the address in the same transcript", () => {
    expect(historyEvents([delivered, reply]).find((e) => e.kind === "peer_out")).toEqual({ kind: "peer_out", to: "starfade", text: "Received." });
  });
});
