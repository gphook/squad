import { describe, it, expect } from "vitest";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, type ChildProcess } from "node:child_process";
import { runShell } from "../src/shellCommand.ts";
import { resolveShell, type ResolvedShell } from "../src/shells/adapters.ts";
import { posixControl, type ProcessControl } from "../src/shells/processControl.ts";

type Chunk = { stream: "stdout" | "stderr"; text: string };

function run(
  command: string, cwd = mkdtempSync(join(tmpdir(), "squad-shell-")),
  shell: ResolvedShell = resolveShell("/bin/sh"), control: ProcessControl | null = posixControl,
) {
  const chunks: Chunk[] = [];
  let ends = 0;
  let kill!: (force?: boolean) => void;
  const done = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    const handle = runShell(command, cwd, {
      onChunk: (stream, text) => chunks.push({ stream, text }),
      onEnd: (code, signal) => { ends++; resolve({ code, signal }); },
    }, shell, control);
    kill = handle.kill;
  });
  const text = (s: Chunk["stream"]) => chunks.filter((c) => c.stream === s).map((c) => c.text).join("");
  return { done, text, kill: (force?: boolean) => kill(force), ends: () => ends, cwd };
}

describe("runShell", () => {
  it("streams stdout and stderr and reports the exit code", async () => {
    const r = run("printf out; printf err >&2; exit 3");
    expect(await r.done).toEqual({ code: 3, signal: null });
    expect(r.text("stdout")).toBe("out");
    expect(r.text("stderr")).toBe("err");
  });

  it("runs in the given folder", async () => {
    const r = run("pwd");
    await r.done;
    expect(realpathSync(r.text("stdout").trim())).toBe(realpathSync(r.cwd));
  });

  it("kill stops a long command", async () => {
    const r = run("sleep 30");
    setTimeout(() => r.kill(), 50);
    expect(await r.done).toEqual({ code: null, signal: "SIGTERM" });
  });

  it("kill(true) sends SIGKILL straight away", async () => {
    const r = run("trap '' TERM; sleep 30");
    setTimeout(() => r.kill(true), 50);
    expect(await r.done).toEqual({ code: null, signal: "SIGKILL" });
  });

  it("ends with an error, once, when the folder is missing", async () => {
    const r = run("ls", "/nonexistent/squad-folder");
    expect(await r.done).toEqual({ code: null, signal: null });
    expect(r.text("stderr")).toContain("/nonexistent/squad-folder");
    await new Promise((res) => setTimeout(res, 50));
    expect(r.ends()).toBe(1);
  });

  it("gives the command no stdin", async () => {
    expect(await run("cat").done).toEqual({ code: 0, signal: null });
  });

  it("keeps multi-byte characters split across chunks intact", async () => {
    const r = run(`node -e "process.stdout.write(Buffer.from([0xe2, 0x82])); setTimeout(() => process.stdout.write(Buffer.from([0xac])), 30)"`);
    await r.done;
    expect(r.text("stdout")).toBe("€");
  });

  it("says so, once, on a platform with no process control", async () => {
    const r = run("ls", undefined, undefined, null);
    expect(await r.done).toEqual({ code: null, signal: null });
    expect(r.text("stderr")).toContain("aren't supported");
    await new Promise((res) => setTimeout(res, 50));
    expect(r.ends()).toBe(1);
  });

  it("ends with an error when the shell program is missing", async () => {
    const r = run("ls", undefined, { ...resolveShell("/bin/zsh"), path: "/nope/zsh" });
    expect(await r.done).toEqual({ code: null, signal: null });
    expect(r.text("stderr")).toMatch(/ENOENT|nope/);
    await new Promise((res) => setTimeout(res, 50));
    expect(r.ends()).toBe(1);
  });

  it("kills through the process control, forced or not", async () => {
    const calls: boolean[] = [];
    const control: ProcessControl = { detached: true, kill: (c: ChildProcess, force) => { calls.push(force); posixControl.kill(c, true); } };
    const r = run("sleep 30", undefined, undefined, control);
    setTimeout(() => r.kill(), 50);
    await r.done;
    expect(calls[0]).toBe(false);
    const r2 = run("sleep 30", undefined, undefined, control);
    setTimeout(() => r2.kill(true), 50);
    await r2.done;
    expect(calls.at(-1)).toBe(true);
  });

  const pwsh = (() => { try { return execFileSync("sh", ["-c", "command -v pwsh"]).toString().trim(); } catch { return ""; } })();
  it.skipIf(!pwsh)("runs PowerShell commands through the pwsh adapter", async () => {
    const r = run("Write-Output hi", undefined, { ...resolveShell("/usr/bin/pwsh"), path: pwsh });
    await r.done;
    expect(r.text("stdout").trim()).toBe("hi");
  });
});
