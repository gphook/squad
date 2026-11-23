import { describe, it, expect } from "vitest";
import { AuthTracker, toAuthStatus } from "../src/auth.ts";

// The shape `claude auth status --json` printed on a real machine, with personal details replaced.
const SIGNED_IN = {
  loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", loginExpiresAt: "2026-12-05T14:10:12.390Z",
  email: "someone@example.com", orgName: "Example Org", subscriptionType: "pro", planTier: "pro",
};
const SIGNED_OUT = { loggedIn: false, authMethod: "none", apiProvider: "firstParty" };

describe("toAuthStatus", () => {
  it("reads a claude.ai sign-in", () => {
    expect(toAuthStatus(SIGNED_IN)).toEqual({
      state: "signedIn", method: "claude.ai", email: "someone@example.com", organization: "Example Org",
      plan: "pro", provider: "firstParty", expiresAt: Date.parse("2026-12-05T14:10:12.390Z"),
    });
  });

  it("reads signed out", () => {
    expect(toAuthStatus(SIGNED_OUT)).toEqual({ state: "signedOut", method: "none", provider: "firstParty" });
  });

  it("counts an API key or another provider as signed in", () => {
    expect(toAuthStatus({ authMethod: "api_key", apiProvider: "firstParty" })).toMatchObject({ state: "signedIn", method: "api_key" });
    expect(toAuthStatus({ loggedIn: false, authMethod: "bedrock", apiProvider: "bedrock" })).toMatchObject({ state: "signedIn", provider: "bedrock" });
  });

  it("is unknown for anything it can't read", () => {
    expect(toAuthStatus("not json")).toEqual({ state: "unknown" });
    expect(toAuthStatus(null)).toEqual({ state: "unknown" });
    expect(toAuthStatus({})).toEqual({ state: "unknown" });
  });
});

describe("AuthTracker", () => {
  it("runs the CLI once for concurrent refreshes", async () => {
    let runs = 0;
    const t = new AuthTracker(async () => { runs++; return JSON.stringify(SIGNED_IN); });
    const [a, b] = await Promise.all([t.refresh(), t.refresh()]);
    expect(runs).toBe(1);
    expect(a.state).toBe("signedIn");
    expect(b).toBe(a);
    expect(t.current).toBe(a);
  });

  it("is unknown when the CLI fails or prints garbage", async () => {
    expect((await new AuthTracker(async () => { throw new Error("ENOENT"); }).refresh()).state).toBe("unknown");
    expect((await new AuthTracker(async () => "Error: something").refresh()).state).toBe("unknown");
  });

  it("emits change only when the status changes", async () => {
    let out = JSON.stringify(SIGNED_OUT);
    const t = new AuthTracker(async () => out);
    const changes: string[] = [];
    t.on("change", (s) => changes.push(s.state));
    await t.refresh();
    await t.refresh();
    out = JSON.stringify(SIGNED_IN);
    await t.refresh();
    expect(changes).toEqual(["signedOut", "signedIn"]);
  });
});
