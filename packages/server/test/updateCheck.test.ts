import { describe, it, expect, vi } from "vitest";
import { checkForUpdate, isNewer, updateMessage } from "../src/updateCheck.ts";

describe("isNewer", () => {
  it("compares major.minor.patch numerically", () => {
    expect(isNewer("1.2.0", "1.1.9")).toBe(true);
    expect(isNewer("1.10.0", "1.9.0")).toBe(true);
    expect(isNewer("2.0.0", "1.99.99")).toBe(true);
  });
  it("is false for an equal or older latest", () => {
    expect(isNewer("1.2.0", "1.2.0")).toBe(false);
    expect(isNewer("1.1.0", "1.2.0")).toBe(false);
  });
  it("ignores a prerelease part", () => {
    expect(isNewer("1.2.0", "1.2.0-beta.1")).toBe(false);
    expect(isNewer("1.3.0-rc.1", "1.2.0")).toBe(true);
  });
});

const respond = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);

describe("checkForUpdate", () => {
  it("returns a newer published version", async () => {
    expect(await checkForUpdate("1.0.0", { fetchFn: respond({ version: "9.0.0" }) })).toBe("9.0.0");
  });
  it("returns null when up to date", async () => {
    expect(await checkForUpdate("1.0.0", { fetchFn: respond({ version: "1.0.0" }) })).toBeNull();
  });
  it("returns null, never throwing, when the registry fails or answers oddly", async () => {
    expect(await checkForUpdate("1.0.0", { fetchFn: vi.fn(async () => { throw new Error("offline"); }) })).toBeNull();
    expect(await checkForUpdate("1.0.0", { fetchFn: respond("not json") })).toBeNull();
    expect(await checkForUpdate("1.0.0", { fetchFn: respond({ version: "9.0.0" }, false) })).toBeNull();
    expect(await checkForUpdate("1.0.0", { fetchFn: vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError("x"); } }) as unknown as Response) })).toBeNull();
  });
  it("asks the npm registry anonymously, with a timeout", async () => {
    const f = respond({ version: "1.0.0" });
    await checkForUpdate("1.0.0", { fetchFn: f });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://registry.npmjs.org/@gphook/squad/latest");
    expect(init.headers).toEqual({ "user-agent": "squad" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.credentials).toBeUndefined();
  });
});

describe("updateMessage", () => {
  it("says what to run", () => {
    expect(updateMessage("1.3.0", "1.2.0")).toBe("Squad: version 1.3.0 is available (you have 1.2.0). Run npx @gphook/squad@latest.");
  });
});
