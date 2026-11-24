import { spawn } from "node:child_process";

export interface ExecResult { code: number; stdout: string; stderr: string }

/** Runs a CLI to completion. Rejects when it can't start (a missing binary rejects with `code: "ENOENT"`). */
export interface CliExec {
  run(bin: string, args: string[], opts?: { env?: NodeJS.ProcessEnv; stdin?: string; timeoutMs?: number }): Promise<ExecResult>;
}

export const realExec: CliExec = {
  run(bin, args, opts = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { env: opts.env ?? process.env, stdio: "pipe", timeout: opts.timeoutMs ?? 30_000 });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.stdin.on("error", () => {});
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
      child.stdin.end(opts.stdin ?? "");
    });
  },
};

export const isMissing = (err: unknown) => (err as { code?: string })?.code === "ENOENT";

/** The last non-blank line of a CLI's output, for an error message. */
export function lastLine(...texts: string[]): string {
  return texts.join("\n").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? "";
}
