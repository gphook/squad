import { describe, it, expect } from "vitest";
import { connectorHostError, normaliseHost } from "../src/connectors.ts";
import { parseClientMsg } from "../src/protocol.ts";
const ok = (m: object) => !("error" in parseClientMsg(JSON.stringify(m)));

describe("connectorHostError", () => {
  it.each(["github.com", "git.acme.internal:8443", "GitHub.Acme.com", "localhost", "10.0.0.5:3000"])("accepts %s", (h) => {
    expect(connectorHostError(h)).toBeNull();
  });
  it.each(["", "  ", "https://github.com", "github.com/org", "user@github.com", "-oProxy", "a b", "github.com:99999",
    "github.com:", "github.com:0", "git..hub", "-github.com", "github-.com"])("rejects %j", (h) => {
    expect(connectorHostError(h)).toEqual(expect.any(String));
  });
});

describe("normaliseHost", () => {
  it("trims and lowercases", () => expect(normaliseHost("  GitHub.Acme.COM ")).toBe("github.acme.com"));
});

describe("connector messages", () => {
  it.each([
    { t: "connectors.get" },
    { t: "connector.add", template: "github", name: "Acme", host: "github.acme.com" },
    { t: "connector.rename", id: "c1", name: "New" },
    { t: "connector.remove", id: "c1", signOut: true },
    { t: "connector.login", id: "c1" },
    { t: "connector.token", token: "glpat-x" },
    { t: "connector.cancel" },
    { t: "connector.signOut", id: "c1" },
  ])("accepts $t", (m) => expect(ok(m)).toBe(true));
  it("rejects an unknown template", () => {
    expect(ok({ t: "connector.add", template: "bitbucket", name: "", host: "bitbucket.org" })).toBe(false);
  });
  it("rejects an empty token", () => expect(ok({ t: "connector.token", token: "" })).toBe(false));
});
