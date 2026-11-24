import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { openBrowser, parseStartupArgs, startupMessage, startupPlan } from "../src/signin/startup.ts";

const base = { noOpen: false, resetSignIn: false, dev: false };

describe("parseStartupArgs", () => {
  it("reads flags and env", () => {
    expect(parseStartupArgs([], {})).toEqual(base);
    expect(parseStartupArgs(["--no-open", "--reset-sign-in"], {})).toEqual({ noOpen: true, resetSignIn: true, dev: false });
    expect(parseStartupArgs([], { SQUAD_NO_OPEN: "1", SQUAD_DEV: "1" })).toEqual({ noOpen: true, resetSignIn: false, dev: true });
  });
});

describe("startupPlan", () => {
  it("mints with no passkeys or on reset, never otherwise", () => {
    expect(startupPlan(base, 0).mintCode).toBe(true);
    expect(startupPlan(base, 2).mintCode).toBe(false);
    expect(startupPlan({ ...base, resetSignIn: true }, 2).mintCode).toBe(true);
    expect(startupPlan({ ...base, resetSignIn: true, dev: true }, 2)).toEqual({ mintCode: true, open: false });
    expect(startupPlan({ ...base, resetSignIn: true, noOpen: true }, 2)).toEqual({ mintCode: true, open: false });
  });
  it("opens unless --no-open or dev", () => {
    expect(startupPlan(base, 0).open).toBe(true);
    expect(startupPlan({ ...base, noOpen: true }, 0).open).toBe(false);
    expect(startupPlan({ ...base, dev: true }, 0).open).toBe(false);
  });
});

describe("startupMessage", () => {
  it("never includes the code when the browser opened", () => {
    expect(startupMessage(7340, "SECRET", true)).not.toContain("SECRET");
    expect(startupMessage(7340, "SECRET", true)).toBe("Squad: opened http://localhost:7340/ in your browser to set up sign-in.");
  });
  it("prints the link when not opened", () => {
    expect(startupMessage(7340, "abc", false)).toBe("Squad: set up sign-in at http://localhost:7340/setup?code=abc  (single use, expires in 10 minutes)");
  });
  it("prints the plain URL with no code", () => {
    expect(startupMessage(7340, null, false)).toBe("Squad: http://localhost:7340/");
  });
});

describe("openBrowser", () => {
  type Fake = EventEmitter & { unref(): void; unrefCalled: boolean };
  const make = (emit?: [string, ...unknown[]]) => {
    const calls: unknown[][] = [];
    const child = new EventEmitter() as Fake;
    child.unrefCalled = false;
    child.unref = () => { child.unrefCalled = true; };
    const spawnFn = ((...args: unknown[]) => {
      calls.push(args);
      if (emit) queueMicrotask(() => child.emit(...emit));
      return child;
    }) as never;
    return { spawnFn, calls, child };
  };

  it("spawns the opener detached with the url", async () => {
    const f = make(["exit", 0]);
    await openBrowser("http://x/", f.spawnFn, "linux");
    expect(f.calls[0]).toEqual(["xdg-open", ["http://x/"], { detached: true, stdio: "ignore" }]);
    const m = make(["exit", 0]);
    await openBrowser("http://x/", m.spawnFn, "darwin");
    expect(m.calls[0]![0]).toBe("open");
  });
  it("resolves true on exit 0", async () => {
    expect(await openBrowser("http://x/", make(["exit", 0]).spawnFn, "linux")).toBe(true);
  });
  it("resolves false on a non-zero exit", async () => {
    expect(await openBrowser("http://x/", make(["exit", 3]).spawnFn, "linux")).toBe(false);
  });
  it("resolves false when the spawn errors", async () => {
    expect(await openBrowser("http://x/", make(["error", new Error("ENOENT")]).spawnFn, "linux")).toBe(false);
  });
  it("resolves false when spawn throws synchronously", async () => {
    const spawnFn = (() => { throw new Error("boom"); }) as never;
    expect(await openBrowser("http://x/", spawnFn, "linux")).toBe(false);
  });
  it("resolves false without spawning on an unsupported platform", async () => {
    const f = make();
    expect(await openBrowser("http://x/", f.spawnFn, "win32")).toBe(false);
    expect(f.calls).toHaveLength(0);
  });
  it("counts a still-running opener as opened after 5 s and unrefs it", async () => {
    vi.useFakeTimers();
    try {
      const f = make();
      const p = openBrowser("http://x/", f.spawnFn, "linux");
      await vi.advanceTimersByTimeAsync(4999);
      expect(f.child.unrefCalled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await p).toBe(true);
      expect(f.child.unrefCalled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
