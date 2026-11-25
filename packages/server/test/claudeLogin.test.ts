import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { ClaudeLogin, type LoginChild } from "../src/claudeLogin.ts";
import type { LoginState } from "@squad/shared";

class FakeChild extends EventEmitter implements LoginChild {
  stdout = new PassThrough();
  stderr = new PassThrough();
  written: string[] = [];
  killed = false;
  stdin = { write: (s: string) => { this.written.push(s); return true; }, end: () => {} };
  kill() { this.killed = true; this.emit("exit", null, "SIGTERM"); return true; }
  exit(code: number) { this.emit("exit", code, null); }
}

const URL = "https://claude.ai/oauth/authorize?abc123";
const PRINTED = `Opening browser to sign in…\nIf the browser didn't open, visit:\n${URL}\nPaste code here if prompted > `;
const tick = () => new Promise((r) => setImmediate(r));

function setup(timeoutMs = 60_000) {
  const children: FakeChild[] = [];
  const args: string[][] = [];
  const finished = vi.fn(async () => {});
  const signOut = vi.fn(async () => {});
  const login = new ClaudeLogin({
    signOut,
    spawn: (a) => { args.push(a); const c = new FakeChild(); children.push(c); return c; },
    finished,
    timeoutMs,
  });
  const states: LoginState[] = [];
  login.on("change", (s: LoginState) => states.push(s));
  return { login, children, args, finished, signOut, states };
}

describe("ClaudeLogin", () => {
  it("runs the chosen sign-in and reports the link it prints", async () => {
    const { login, children, args } = setup();
    login.start("console");
    expect(args[0]).toEqual(["auth", "login", "--console"]);
    expect(login.current).toEqual({ phase: "starting" });
    children[0].stdout.write(PRINTED);
    await tick();
    expect(login.current).toEqual({ phase: "waiting", url: URL });
  });

  it("passes a pasted code to the CLI and finishes when it exits 0", async () => {
    const { login, children, finished } = setup();
    login.start("console");
    children[0].stdout.write(PRINTED);
    await tick();
    login.submitCode("  the-code#state \n");
    expect(children[0].written).toEqual(["the-code#state\n"]);
    expect(login.current).toEqual({ phase: "verifying", url: URL });
    children[0].exit(0);
    await tick();
    expect(finished).toHaveBeenCalledOnce();
    expect(login.current).toEqual({ phase: "idle" });
  });

  it("finishes without a code when the browser completes it", async () => {
    const { login, children, finished } = setup();
    login.start("console");
    children[0].stdout.write(PRINTED);
    await tick();
    children[0].exit(0);
    await tick();
    expect(finished).toHaveBeenCalledOnce();
    expect(login.current).toEqual({ phase: "idle" });
  });

  it("asks again when the CLI prompts for another code", async () => {
    const { login, children } = setup();
    login.start("console");
    children[0].stdout.write(PRINTED);
    await tick();
    login.submitCode("wrong");
    children[0].stdout.write("Invalid code\nPaste code here if prompted > ");
    await tick();
    expect(login.current).toEqual({ phase: "waiting", url: URL, error: "Invalid code" });
  });

  it("asks again when the CLI complains about the code without prompting", async () => {
    const { login, children } = setup();
    login.start("console");
    children[0].stdout.write(PRINTED);
    await tick();
    login.submitCode("no-hash");
    children[0].stdout.write("That doesn't look like the full code. Copy all of it, including the # in the middle.\n");
    await tick();
    expect(login.current).toEqual({
      phase: "waiting", url: URL, error: "That doesn't look like the full code. Copy all of it, including the # in the middle.",
    });
  });

  it("keeps verifying through a success message", async () => {
    const { login, children } = setup();
    login.start("console");
    children[0].stdout.write(PRINTED);
    await tick();
    login.submitCode("good#code");
    children[0].stdout.write("Login successful.\n");
    await tick();
    expect(login.current.phase).toBe("verifying");
  });

  it("fails with the CLI's last words when it exits non-zero", async () => {
    const { login, children, finished } = setup();
    login.start("console");
    children[0].stdout.write(PRINTED);
    children[0].stderr.write("OAuth error: bad request\n");
    await tick();
    children[0].exit(1);
    await tick();
    expect(login.current).toEqual({ phase: "failed", message: "OAuth error: bad request" });
    expect(finished).toHaveBeenCalledOnce(); // recheck anyway: something may have changed
  });

  it("fails when the CLI can't be run", async () => {
    const { login, children } = setup();
    login.start("console");
    children[0].emit("error", new Error("spawn claude ENOENT"));
    await tick();
    expect(login.current).toEqual({ phase: "failed", message: "Couldn't run Claude Code: spawn claude ENOENT" });
  });

  it("cancel kills the CLI and goes back to idle", async () => {
    const { login, children, finished } = setup();
    login.start("console");
    children[0].stdout.write(PRINTED);
    await tick();
    login.cancel();
    await tick();
    expect(children[0].killed).toBe(true);
    expect(login.current).toEqual({ phase: "idle" });
    expect(finished).not.toHaveBeenCalled();
  });

  it("runs one sign-in at a time: a new start replaces the old one", async () => {
    const { login, children } = setup();
    login.start("console");
    login.start("console");
    expect(children[0].killed).toBe(true);
    expect(children).toHaveLength(2);
    children[1].stdout.write(PRINTED);
    await tick();
    expect(login.current).toEqual({ phase: "waiting", url: URL });
  });

  it("gives up after the timeout", async () => {
    vi.useFakeTimers();
    try {
      const { login, children } = setup(1000);
      login.start("console");
      vi.advanceTimersByTime(1001);
      expect(children[0].killed).toBe(true);
      expect(login.current).toEqual({ phase: "failed", message: "Sign-in timed out. Try again." });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a code when nothing is waiting for one", () => {
    const { login, states } = setup();
    login.submitCode("x");
    expect(states).toEqual([]);
  });

  it("cancel dismisses a failed sign-in", async () => {
    const { login, children } = setup();
    login.start("console");
    children[0].exit(1);
    await tick();
    login.cancel();
    expect(login.current).toEqual({ phase: "idle" });
  });

  it("signs out, stopping any sign-in first, then rechecks", async () => {
    const { login, children, signOut, finished } = setup();
    login.start("console");
    await login.signOut();
    expect(children[0].killed).toBe(true);
    expect(signOut).toHaveBeenCalledOnce();
    expect(finished).toHaveBeenCalledOnce();
    expect(login.current).toEqual({ phase: "idle" });
  });
});
