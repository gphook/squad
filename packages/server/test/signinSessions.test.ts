import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { SetupCodes } from "../src/signin/setupCodes.ts";
import { Sessions, hashId, sessionLabel, REMEMBER_MS, TOUCH_MS } from "../src/signin/sessions.ts";

const MIN = 60_000;
let store: Store;
let t: number;
let sessions: Sessions;
beforeEach(() => {
  store = new Store(join(mkdtempSync(join(tmpdir(), "squad-sessions-")), "squad.db"));
  t = 1_000_000;
  sessions = new Sessions(store, { now: () => t });
});

describe("Sessions", () => {
  it("check returns the row for a fresh session and null for an unknown id", () => {
    const { id, idHash } = sessions.create("remember", null, "ua");
    const res = sessions.check(id)!;
    expect(res.row.idHash).toBe(idHash);
    expect(res.refreshCookie).toBe(false);
    expect(sessions.check("nope")).toBeNull();
  });

  it("a remember session expires 30 days after last use", () => {
    const { id, idHash } = sessions.create("remember", null, "ua");
    const t0 = t;
    const revoked: string[][] = [];
    sessions.on("revoked", (h: string[]) => revoked.push(h));
    t = t0 + REMEMBER_MS - 1;
    expect(sessions.check(id)).not.toBeNull();
    t = t0 + REMEMBER_MS - 1 + REMEMBER_MS;
    expect(sessions.check(id)).toBeNull();
    expect(store.getSession(idHash)).toBeNull();
    expect(revoked).toEqual([[idHash]]);
  });

  it("a remember session expires at t0+2*REMEMBER_MS with no use in between", () => {
    const { id, idHash } = sessions.create("remember", null, "ua");
    const t0 = t;
    t = t0 + 2 * REMEMBER_MS;
    expect(sessions.check(id)).toBeNull();
    expect(store.getSession(idHash)).toBeNull();
  });

  it("touch happens at most hourly", () => {
    const { id, idHash } = sessions.create("remember", null, "ua");
    const t0 = t;
    t = t0 + 10 * MIN;
    expect(sessions.check(id)!.refreshCookie).toBe(false);
    expect(store.getSession(idHash)!.lastUsedAt).toBe(t0);
    t = t0 + 61 * MIN;
    expect(sessions.check(id)!.refreshCookie).toBe(true);
    expect(store.getSession(idHash)!.lastUsedAt).toBe(t0 + 61 * MIN);
    t = t0 + 62 * MIN;
    expect(sessions.check(id)!.refreshCookie).toBe(false);
    expect(TOUCH_MS).toBe(3600_000);
  });

  it("a restart session is touched but never asks for a cookie refresh, and does not expire", () => {
    const { id, idHash } = sessions.create("restart", null, "ua");
    const t0 = t;
    t = t0 + 61 * MIN;
    expect(sessions.check(id)!.refreshCookie).toBe(false);
    expect(store.getSession(idHash)!.lastUsedAt).toBe(t0 + 61 * MIN);
    t = t0 + 3 * REMEMBER_MS;
    expect(sessions.check(id)).not.toBeNull();
  });

  it("startup(false) removes restart sessions and keeps remember ones", () => {
    const a = sessions.create("remember", null, "ua");
    const b = sessions.create("restart", null, "ua");
    sessions.startup(false);
    expect(store.getSession(a.idHash)).not.toBeNull();
    expect(store.getSession(b.idHash)).toBeNull();
  });

  it("startup(true) keeps both", () => {
    const a = sessions.create("remember", null, "ua");
    const b = sessions.create("restart", null, "ua");
    sessions.startup(true);
    expect(store.getSession(a.idHash)).not.toBeNull();
    expect(store.getSession(b.idHash)).not.toBeNull();
  });

  it("startup deletes remember sessions idle for 30 days and emits revoked for them", () => {
    const old = sessions.create("remember", null, "ua");
    const t0 = t;
    t = t0 + REMEMBER_MS - 1;
    const fresh = sessions.create("remember", null, "ua");
    const restart = sessions.create("restart", null, "ua");
    t = t0 + REMEMBER_MS;
    const seen: string[][] = [];
    sessions.on("revoked", (h: string[]) => seen.push(h));
    sessions.startup(true);
    expect(store.getSession(old.idHash)).toBeNull();
    expect(store.getSession(fresh.idHash)).not.toBeNull();
    expect(store.getSession(restart.idHash)).not.toBeNull();
    expect(seen).toEqual([[old.idHash]]);
  });

  it("expireIdle removes only idle remember sessions and stays quiet when there are none", () => {
    const a = sessions.create("remember", null, "ua");
    const b = sessions.create("restart", null, "ua");
    const seen: string[][] = [];
    sessions.on("revoked", (h: string[]) => seen.push(h));
    sessions.expireIdle();
    expect(seen).toEqual([]);
    t += 2 * REMEMBER_MS;
    sessions.expireIdle();
    expect(store.getSession(a.idHash)).toBeNull();
    expect(store.getSession(b.idHash)).not.toBeNull();
    expect(seen).toEqual([[a.idHash]]);
  });

  it("revoke emits revoked with the hash", () => {
    const { idHash } = sessions.create("remember", null, "ua");
    const seen: string[][] = [];
    sessions.on("revoked", (h: string[]) => seen.push(h));
    sessions.revoke(idHash);
    expect(seen).toEqual([[idHash]]);
    expect(store.getSession(idHash)).toBeNull();
  });

  it("revokeAll emits one revoked event with every hash", () => {
    const a = sessions.create("remember", null, "ua");
    const b = sessions.create("restart", null, "ua");
    const seen: string[][] = [];
    sessions.on("revoked", (h: string[]) => seen.push(h));
    sessions.revokeAll();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.sort()).toEqual([a.idHash, b.idHash].sort());
    expect(store.listSessions()).toEqual([]);
  });

  it("onPasskeyDeleted emits revoked for the given hashes", () => {
    const seen: string[][] = [];
    sessions.on("revoked", (h: string[]) => seen.push(h));
    sessions.onPasskeyDeleted(["x", "y"]);
    expect(seen).toEqual([["x", "y"]]);
  });

  it("only the hash is stored", () => {
    const { id, idHash } = sessions.create("remember", null, "Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0 Safari/537.36");
    expect(idHash).toBe(hashId(id));
    expect(store.getSession(id)).toBeNull();
    expect(store.getSession(hashId(id))).not.toBeNull();
  });
});

describe("sessionLabel", () => {
  it("names browser and OS", () => {
    expect(sessionLabel("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36")).toBe("Chrome on Linux");
    expect(sessionLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15")).toBe("Safari on macOS");
    expect(sessionLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0")).toBe("Firefox on Windows");
    expect(sessionLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36 Edg/131.0")).toBe("Edge on Windows");
  });
  it("falls back", () => {
    expect(sessionLabel("")).toBe("Unknown browser");
    expect(sessionLabel("curl/8.0")).toBe("Unknown browser");
  });
});

describe("SetupCodes", () => {
  let n: number;
  let codes: SetupCodes;
  beforeEach(() => { n = 5_000; codes = new SetupCodes({ now: () => n }); });

  it("a setup code redeems once", () => {
    const code = codes.mint();
    expect(codes.pending).toBe(true);
    const grant = codes.redeem(code);
    expect(grant).toBeTruthy();
    expect(codes.pending).toBe(false);
    expect(codes.redeem(code)).toBeNull();
  });

  it("a setup code expires after 10 minutes", () => {
    const code = codes.mint();
    n += 10 * MIN;
    expect(codes.pending).toBe(false);
    expect(codes.redeem(code)).toBeNull();
  });

  it("a wrong code of a different length returns null without throwing", () => {
    codes.mint();
    expect(codes.redeem("short")).toBeNull();
    expect(codes.redeem("")).toBeNull();
  });

  it("a wrong code of the same length returns null and keeps the code", () => {
    const code = codes.mint();
    expect(codes.redeem("A".repeat(code.length))).toBeNull();
    expect(codes.redeem(code)).not.toBeNull();
  });

  it("a grant is valid for 10 minutes and not after consumeGrant", () => {
    const grant = codes.redeem(codes.mint())!;
    expect(codes.grantValid(grant)).toBe(true);
    n += 10 * MIN - 1;
    expect(codes.grantValid(grant)).toBe(true);
    n += 1;
    expect(codes.grantValid(grant)).toBe(false);
    const g2 = codes.redeem(codes.mint())!;
    codes.consumeGrant(g2);
    expect(codes.grantValid(g2)).toBe(false);
    expect(codes.grantValid(undefined)).toBe(false);
    expect(codes.grantValid("bogus")).toBe(false);
  });

  it("mint replaces the previous code", () => {
    const a = codes.mint();
    const b = codes.mint();
    expect(a).not.toBe(b);
    expect(codes.redeem(a)).toBeNull();
    expect(codes.redeem(b)).not.toBeNull();
  });
});
