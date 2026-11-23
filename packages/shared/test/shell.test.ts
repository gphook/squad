import { describe, it, expect } from "vitest";
import {
  SHELL_CONTEXT_CAP, agentShellPrompt, bashContextBlock, keepTail, parseAgentShellPrompt, parseBashContext,
  parseClientMsg, parseShellInput, type ShellResult,
} from "../src/index.ts";

const result = (over: Partial<ShellResult> = {}): ShellResult =>
  ({ command: "ls", stdout: "a\n", stderr: "", code: 0, signal: null, ...over });

describe("parseShellInput", () => {
  it("reads $ cmd as Squad running it", () => {
    expect(parseShellInput("$ npm test")).toEqual({ mode: "run", command: "npm test" });
    expect(parseShellInput("  $\tls -la ")).toEqual({ mode: "run", command: "ls -la" });
  });

  it("reads !cmd as the squadmate running it", () => {
    expect(parseShellInput("!ls")).toEqual({ mode: "agent", command: "ls" });
    expect(parseShellInput("! git status")).toEqual({ mode: "agent", command: "git status" });
    expect(parseShellInput("!run x")).toEqual({ mode: "agent", command: "run x" });
  });

  it("leaves everything else as ordinary text", () => {
    for (const t of ["!", "!  ", "$", "$  ", "$5 budget", "$HOME/x", "hello !ls", "hi $ ls"]) {
      expect(parseShellInput(t), t).toBeNull();
    }
  });
});

describe("agentShellPrompt", () => {
  it("round-trips through parseAgentShellPrompt", () => {
    expect(agentShellPrompt("ls")).toBe(
      "Run this shell command with your Bash tool, exactly as written, and show me its output.\n\n```sh\nls\n```",
    );
    expect(parseAgentShellPrompt(agentShellPrompt("echo a\nb"))).toBe("echo a\nb");
    expect(parseAgentShellPrompt("hi")).toBeNull();
  });
});

describe("bashContextBlock", () => {
  it("writes the CLI's block format", () => {
    expect(bashContextBlock(result())).toBe(
      "<bash-input>ls</bash-input>\n<bash-stdout>a\n</bash-stdout>\n<bash-stderr></bash-stderr>",
    );
  });

  it("notes a non-zero exit or a signal in stderr", () => {
    expect(bashContextBlock(result({ code: 2 }))).toContain("<bash-stderr>\nExit code 2</bash-stderr>");
    expect(bashContextBlock(result({ code: null, signal: "SIGTERM", stderr: "x" })))
      .toContain("<bash-stderr>x\nKilled by SIGTERM</bash-stderr>");
  });

  it("keeps the last 30,000 characters of a stream", () => {
    expect(SHELL_CONTEXT_CAP).toBe(30_000);
    const block = bashContextBlock(result({ stdout: "y".repeat(5) + "x".repeat(30_000) }));
    expect(block).toContain(`<bash-stdout>[… 5 earlier characters]\n${"x".repeat(30_000)}</bash-stdout>`);
  });

  it("counts characters dropped while buffering", () => {
    const block = bashContextBlock(result({ stdout: "x".repeat(30_000), omitted: { stdout: 7, stderr: 0 } }));
    expect(block).toContain("<bash-stdout>[… 7 earlier characters]\n");
  });

  it("keepTail leaves short text alone", () => {
    expect(keepTail("abc", 5)).toBe("abc");
    expect(keepTail("abcdef", 2)).toBe("[… 4 earlier characters]\nef");
    expect(keepTail("ab", 5, 3)).toBe("[… 3 earlier characters]\nab");
  });
});

describe("parseBashContext", () => {
  it("round-trips blocks, even when they contain the tags, and returns the rest", () => {
    const block = bashContextBlock(result({ command: 'echo "</bash-input>"', stdout: "</bash-stdout>x" }));
    expect(parseBashContext(`${block}\n\nhello`)).toEqual({
      shells: [{ command: 'echo "</bash-input>"', stdout: "</bash-stdout>x", stderr: "" }],
      rest: "hello",
    });
  });

  it("reads consecutive blocks", () => {
    const two = `${bashContextBlock(result())}\n${bashContextBlock(result({ command: "pwd", stdout: "/x" }))}`;
    expect(parseBashContext(two)?.shells.map((s) => s.command)).toEqual(["ls", "pwd"]);
    expect(parseBashContext(two)?.rest).toBe("");
  });

  it("is null for ordinary text", () => {
    expect(parseBashContext("hello")).toBeNull();
  });
});

describe("agent.shellKill", () => {
  it("is a valid client message", () => {
    expect(parseClientMsg(JSON.stringify({ t: "agent.shellKill", agentId: "a", id: "s" })))
      .toEqual({ t: "agent.shellKill", agentId: "a", id: "s" });
  });
});
