import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { errorMessage } from "@squad/shared";

export interface ShellHandlers {
  onChunk(stream: "stdout" | "stderr", text: string): void;
  onEnd(code: number | null, signal: string | null): void;
}

const KILL_GRACE_MS = 5_000;

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Runs a `$ cmd` the user typed, in `cwd`, without stdin. onEnd fires exactly once. */
export function runShell(
  command: string, cwd: string, h: ShellHandlers, shell = process.env.SHELL || "/bin/sh",
): { kill(): void } {
  let ended = false;
  const end = (code: number | null, signal: string | null) => {
    if (ended) return;
    ended = true;
    h.onEnd(code, signal);
  };
  if (!isDir(cwd)) {
    h.onChunk("stderr", `Folder not found: ${cwd}`);
    end(null, null);
    return { kill() {} };
  }

  // Its own process group, so Kill reaches everything the command started, not just the shell.
  const child = spawn(shell, ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const signalGroup = (sig: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, sig);
    } catch {} // already gone
  };
  child.stdout.setEncoding("utf8").on("data", (t: string) => h.onChunk("stdout", t));
  child.stderr.setEncoding("utf8").on("data", (t: string) => h.onChunk("stderr", t));
  child.on("error", (e) => {
    h.onChunk("stderr", errorMessage(e));
    end(null, null);
  });
  child.on("close", (code, signal) => end(code, signal));

  return {
    kill() {
      if (ended) return;
      signalGroup("SIGTERM");
      setTimeout(() => { if (!ended) signalGroup("SIGKILL"); }, KILL_GRACE_MS).unref();
    },
  };
}
