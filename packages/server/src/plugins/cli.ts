import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** Runs `claude <args>`; resolves stdout, rejects with a message fit to show the user. */
export type ClaudeRunner = (args: string[], opts: { cwd?: string; timeoutMs: number }) => Promise<string>;

/** The Claude Code binary bundled with the Agent SDK: the one squadmates run. Null when it can't be found. */
export function bundledClaudePath(): string | null {
  try {
    const pkg = createRequire(import.meta.url).resolve(
      `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`,
    );
    const bin = join(dirname(pkg), process.platform === "win32" ? "claude.exe" : "claude");
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

/** Why a `claude plugin` call failed: the JSON result's message, else the last stderr line, else a generic line. */
export function failureMessage(args: string[], stdout: string, stderr: string): string {
  for (const line of stdout.trim().split("\n").reverse()) {
    try {
      const r = JSON.parse(line) as { outcome?: string; message?: string };
      if (r && typeof r.message === "string" && r.outcome !== "ok") return r.message;
    } catch {}
  }
  const last = stderr.trim().split("\n").filter((l) => l.trim()).pop();
  return last?.trim() || `claude ${args.slice(0, 2).join(" ")} failed.`;
}

export const runClaude: ClaudeRunner = (args, opts) => {
  const bin = bundledClaudePath();
  if (!bin) return Promise.reject(new Error("Squad couldn't find Claude Code's binary."));
  return new Promise((resolve, reject) => {
    execFile(
      bin, args,
      { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: "1" } },
      (err, stdout, stderr) => {
        if (err && (err as { killed?: boolean }).killed) {
          return reject(new Error(`Claude Code took too long (claude ${args.slice(0, 2).join(" ")}).`));
        }
        if (err) return reject(new Error(failureMessage(args, stdout, stderr)));
        resolve(stdout);
      },
    );
  });
};
