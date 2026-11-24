import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
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
  const fake = (event: "error" | "spawn") => (() => {
    const e = new EventEmitter() as EventEmitter & { unref(): void };
    e.unref = () => {};
    queueMicrotask(() => e.emit(event, new Error("ENOENT")));
    return e;
  }) as never;
  it("resolves false when the spawn errors", async () => {
    expect(await openBrowser("http://x/", fake("error"))).toBe(false);
  });
  it("resolves true when the process spawns", async () => {
    expect(await openBrowser("http://x/", fake("spawn"))).toBe(process.platform === "linux" || process.platform === "darwin");
  });
});
