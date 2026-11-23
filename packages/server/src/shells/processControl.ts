import type { ChildProcess } from "node:child_process";

/** How a `$ cmd`'s process is started and stopped, per OS. */
export interface ProcessControl {
  /** Spawn in its own process group. */
  detached: boolean;
  /** Stop the command and everything it started: politely, or at once when `force`. */
  kill(child: ChildProcess, force: boolean): void;
}

/** Linux and macOS: the command leads its own process group, and Kill signals the whole group. */
export const posixControl: ProcessControl = {
  detached: true,
  kill(child, force) {
    try {
      if (child.pid) process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
    } catch {} // already gone
  },
};

/** Null where `$ cmd` isn't supported yet (Windows needs its own, e.g. taskkill /T). */
export function processControlFor(platform: NodeJS.Platform = process.platform): ProcessControl | null {
  return platform === "linux" || platform === "darwin" ? posixControl : null;
}
