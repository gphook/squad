import { describe, it, expect } from "vitest";
import type { AuthStatus } from "@squad/shared";
import { chipLabel, chipTitle, chipTone } from "../src/lib/account.ts";
import { emptyState, forProject, reduce } from "../src/lib/reducer.ts";

const now = Date.parse("2026-11-23T12:00:00Z");
const DAY = 86_400_000;
const signedIn: AuthStatus = {
  state: "signedIn", method: "claude.ai", email: "someone@example.com", organization: "Example Org", plan: "pro",
  provider: "firstParty", expiresAt: now + 12 * DAY,
};

describe("account chip", () => {
  it("labels each state, showing only the email's local part", () => {
    expect(chipLabel(null)).toBe("Account…");
    expect(chipLabel({ state: "unknown" })).toBe("Account ?");
    expect(chipLabel({ state: "signedOut", method: "none" })).toBe("Not signed in");
    expect(chipLabel(signedIn)).toBe("someone · Pro");
    expect(chipLabel({ ...signedIn, plan: undefined })).toBe("someone");
    expect(chipLabel({ state: "signedIn", method: "api_key", provider: "firstParty" })).toBe("API key");
    expect(chipLabel({ state: "signedIn", method: "bedrock", provider: "bedrock" })).toBe("Bedrock");
  });

  it("puts the details in the tooltip, with the expiry only when it's close", () => {
    expect(chipTitle(signedIn, now)).toBe("someone@example.com · Example Org · claude.ai");
    expect(chipTitle({ ...signedIn, expiresAt: now + 2 * DAY + 3600_000 }, now))
      .toBe("someone@example.com · Example Org · claude.ai · login expires in 2 days");
    expect(chipTitle({ ...signedIn, expiresAt: now + 3600_000 }, now)).toContain("login expires today");
    expect(chipTitle({ state: "signedOut" }, now)).toBe("Not signed in to Claude: squadmates can't start. Click to sign in.");
    expect(chipTitle({ state: "unknown" }, now)).toBe("Couldn't read the Claude sign-in. Click for help.");
  });

  it("colours the chip", () => {
    expect([chipTone(signedIn), chipTone({ state: "signedOut" }), chipTone({ state: "unknown" }), chipTone(null)])
      .toEqual(["ok", "bad", "muted", "muted"]);
  });

  it("stores the account and keeps it across project switches", () => {
    const s = reduce(emptyState(), { t: "auth", status: signedIn });
    expect(forProject(s, "p").auth).toEqual(signedIn);
  });

  it("stores the running Claude sign-in and keeps it across project switches", () => {
    expect(emptyState().login).toEqual({ phase: "idle" });
    const login = { phase: "waiting", url: "https://claude.ai/oauth/authorize?x" } as const;
    const s = reduce(emptyState(), { t: "auth.login", login });
    expect(forProject(s, "p").login).toEqual(login);
  });
});
