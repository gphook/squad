import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { errorMessage } from "@squad/shared";
import { userShell, type ResolvedShell } from "./shells/adapters.ts";
import { processControlFor, type ProcessControl } from "./shells/processControl.ts";

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

/**
 * Runs a `$ cmd` the user typed, in `cwd`, without stdin. onEnd fires exactly once.
 * `shell` says how to invoke the command; `control` how to start and stop the process on this OS.
 */
export function runShell(
  command: string, cwd: string, h: ShellHandlers,
  shell: ResolvedShell = userShell(), control: ProcessControl | null = processControlFor(),
): { kill(force?: boolean): void } {
  let ended = false;
  const end = (code: number | null, signal: string | null) => {
    if (ended) return;
    ended = true;
    h.onEnd(code, signal);
  };
  if (!control) {
    h.onChunk("stderr", `$ commands aren't supported on ${process.platform} yet`);
    end(null, null);
    return { kill() {} };
  }
  if (!isDir(cwd)) {
    h.onChunk("stderr", `Folder not found: ${cwd}`);
    end(null, null);
    return { kill() {} };
  }

  const child = spawn(shell.path, shell.adapter.argv(command), {
    cwd, stdio: ["ignore", "pipe", "pipe"], detached: control.detached,
  });
  child.stdout.setEncoding("utf8").on("data", (t: string) => h.onChunk("stdout", t));
  child.stderr.setEncoding("utf8").on("data", (t: string) => h.onChunk("stderr", t));
  child.on("error", (e) => {
    h.onChunk("stderr", errorMessage(e));
    end(null, null);
  });
  child.on("close", (code, signal) => end(code, signal));

  return {
    /** SIGTERM with a SIGKILL 5 s later, or SIGKILL at once when `force` (e.g. Squad is shutting down). */
    kill(force = false) {
      if (ended) return;
      control.kill(child, force);
      if (!force) setTimeout(() => { if (!ended) control.kill(child, true); }, KILL_GRACE_MS).unref();
    },
  };
}
