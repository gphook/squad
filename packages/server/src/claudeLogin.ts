import { EventEmitter } from "node:events";
import { execFile, spawn as nodeSpawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { LoginMethod, LoginState } from "@squad/shared";
import { cliPath } from "./auth.ts";

const TIMEOUT_MS = 10 * 60_000;
const PROMPT = /Paste code here/i;
const LINK = /https:\/\/\S+/;
const SUCCESS = /success|logged in|signed in/i;

/** The bits of a child process ClaudeLogin uses, so tests can fake one. */
export interface LoginChild {
  stdout: Readable;
  stderr: Readable;
  stdin: { write(s: string): unknown; end(): unknown };
  kill(): unknown;
  on(event: "exit", fn: (code: number | null, signal: string | null) => void): unknown;
  on(event: "error", fn: (err: Error) => void): unknown;
}

export interface ClaudeLoginDeps {
  spawn?: (args: string[]) => LoginChild;
  /** Called once the CLI exits on its own (signed in or not): recheck the account. */
  finished: () => Promise<unknown>;
  /** Runs `claude auth logout`. */
  signOut?: () => Promise<unknown>;
  timeoutMs?: number;
}

const defaultSignOut = () =>
  new Promise<void>((resolve, reject) =>
    execFile(cliPath(), ["auth", "logout"], { timeout: 15_000 }, (err) => (err ? reject(err) : resolve())));

function defaultSpawn(args: string[]): LoginChild {
  // BROWSER: the CLI mustn't open a browser itself; the page opens the link in the user's own tab.
  const child = nodeSpawn(cliPath(), args, { stdio: "pipe", env: { ...process.env, BROWSER: "true" } });
  child.stdin.on("error", () => {}); // a code written as the CLI exits (EPIPE) mustn't take the server down
  return child;
}

/** Drives `claude auth login` for the web page: its link out, a pasted code in. Event: "change"(LoginState). */
export class ClaudeLogin extends EventEmitter {
  private state: LoginState = { phase: "idle" };
  private child: LoginChild | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly spawnChild: (args: string[]) => LoginChild;

  constructor(private deps: ClaudeLoginDeps) {
    super();
    this.spawnChild = deps.spawn ?? defaultSpawn;
  }

  get current(): LoginState {
    return this.state;
  }

  start(method: LoginMethod): void {
    this.stop();
    let child: LoginChild;
    try {
      child = this.spawnChild(["auth", "login", `--${method}`]);
    } catch (err) {
      return this.set({ phase: "failed", message: `Couldn't run Claude Code: ${(err as Error).message}` });
    }
    this.child = child;
    this.set({ phase: "starting" });
    let lastLine = "";
    const mine = () => this.child === child;
    const read = (chunk: Buffer | string) => {
      if (!mine()) return;
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        const l = line.trim();
        if (l && !PROMPT.test(l)) lastLine = l;
      }
      const url = text.match(LINK)?.[0];
      if (url && this.state.phase === "starting") this.set({ phase: "waiting", url });
      else if (this.state.phase === "verifying" && !SUCCESS.test(text) && (PROMPT.test(text) || text.trim())) {
        // A complaint about the code (with or without a fresh prompt): the CLI is still waiting for one.
        // A code it rejects outright ends the CLI instead, and the exit reports that.
        this.set({ phase: "waiting", url: this.state.url, error: lastLine || "That code didn't work. Try again." });
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", (err) => {
      if (!mine()) return;
      this.clear();
      this.set({ phase: "failed", message: `Couldn't run Claude Code: ${err.message}` });
    });
    child.on("exit", (code) => {
      if (!mine()) return;
      this.clear();
      this.set(code === 0 ? { phase: "idle" } : { phase: "failed", message: lastLine || `Sign-in didn't finish (exit code ${code}).` });
      void this.deps.finished();
    });
    this.timer = setTimeout(() => {
      if (!mine()) return;
      this.stop();
      this.set({ phase: "failed", message: "Sign-in timed out. Try again." });
    }, this.deps.timeoutMs ?? TIMEOUT_MS);
  }

  submitCode(code: string): void {
    if (this.state.phase !== "waiting" || !this.child) return;
    this.child.stdin.write(`${code.trim()}\n`);
    this.set({ phase: "verifying", url: this.state.url });
  }

  /** Stops a running sign-in, or dismisses a failed one. */
  cancel(): void {
    if (this.state.phase === "idle") return;
    this.stop();
    this.set({ phase: "idle" });
  }

  /** Signs out of Claude (stopping any sign-in), then rechecks the account. */
  async signOut(): Promise<void> {
    this.cancel();
    try {
      await (this.deps.signOut ?? defaultSignOut)();
    } catch (err) {
      this.set({ phase: "failed", message: `Couldn't sign out: ${(err as Error).message}` });
    }
    await this.deps.finished();
  }

  /** Kills the running CLI (if any) without reporting it. */
  private stop(): void {
    const child = this.child;
    this.clear();
    child?.kill();
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.child = null;
  }

  private set(next: LoginState): void {
    this.state = next;
    this.emit("change", next);
  }
}
