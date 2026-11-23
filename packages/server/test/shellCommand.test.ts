import { describe, it, expect } from "vitest";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShell } from "../src/shellCommand.ts";

type Chunk = { stream: "stdout" | "stderr"; text: string };

function run(command: string, cwd = mkdtempSync(join(tmpdir(), "squad-shell-"))) {
  const chunks: Chunk[] = [];
  let ends = 0;
  let kill!: (force?: boolean) => void;
  const done = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    const handle = runShell(command, cwd, {
      onChunk: (stream, text) => chunks.push({ stream, text }),
      onEnd: (code, signal) => { ends++; resolve({ code, signal }); },
    }, "/bin/sh");
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
});
