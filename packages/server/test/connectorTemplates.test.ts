import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTemplates, sourceHost } from "../src/connectors/templates.ts";
import type { CliExec, ExecResult } from "../src/connectors/exec.ts";

const fixture = (n: string) => readFileSync(join(import.meta.dirname, "fixtures/connectors", n), "utf8");
type Call = { bin: string; args: string[]; env?: NodeJS.ProcessEnv; stdin?: string };

function fakeExec(reply: (c: Call) => Partial<ExecResult> | Error): { exec: CliExec; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    exec: {
      async run(bin, args, opts = {}) {
        const c = { bin, args, env: opts.env, stdin: opts.stdin };
        calls.push(c);
        const r = reply(c);
        if (r instanceof Error) throw r;
        return { code: 0, stdout: "", stderr: "", ...r };
      },
    },
  };
}
const enoent = () => Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });

describe("github template", () => {
  it("parses the device code and link once both are printed", () => {
    const { github } = makeTemplates(fakeExec(() => ({})).exec);
    expect(github.parseDevice("\n! First copy your one-time code: A17A-B260\n")).toBeNull();
    expect(github.parseDevice("\n! First copy your one-time code: A17A-B260\nOpen this URL to continue in your web browser: https://github.com/login/device\n"))
      .toEqual({ code: "A17A-B260", url: "https://github.com/login/device" });
  });
  it("signs in with a device flow on the given host, never opening a browser itself", () => {
    const { github } = makeTemplates(fakeExec(() => ({})).exec);
    const plan = github.signInPlan("github.acme.com");
    if (plan.kind !== "device") throw new Error("expected device");
    expect(plan.args).toEqual(["auth", "login", "--web", "--hostname", "github.acme.com", "--git-protocol", "https"]);
    expect(plan.env.BROWSER).toBe("true");
  });
  it("lists every signed-in host from gh auth status (stderr, non-zero exit)", async () => {
    const { github } = makeTemplates(fakeExec(() => ({ code: 1, stderr: fixture("gh-status.txt") })).exec);
    expect(await github.accounts()).toEqual([{ host: "github.com", user: "gphook" }, { host: "github.acme.com", user: "g-hook" }]);
  });
  it("is unavailable when gh isn't installed", async () => {
    const { github } = makeTemplates(fakeExec(enoent).exec);
    expect(await github.available()).toBe(false);
    expect(await github.accounts()).toEqual([]);
  });
  it("sets git up to use gh after signing in", async () => {
    const f = fakeExec(() => ({}));
    await makeTemplates(f.exec).github.afterSignIn("github.com");
    expect(f.calls[0]).toMatchObject({ bin: "gh", args: ["auth", "setup-git", "--hostname", "github.com"] });
  });
  it("signs out of one host", async () => {
    const f = fakeExec(() => ({}));
    await makeTemplates(f.exec).github.signOut("github.acme.com");
    expect(f.calls[0].args).toEqual(["auth", "logout", "--hostname", "github.acme.com"]);
  });
});

describe("gitlab template", () => {
  const savedCI = process.env.CI;
  afterEach(() => { if (savedCI === undefined) delete process.env.CI; else process.env.CI = savedCI; });

  it("uses the device flow on gitlab.com and a token on other hosts", () => {
    const { gitlab } = makeTemplates(fakeExec(() => ({})).exec);
    const dev = gitlab.signInPlan("gitlab.com");
    if (dev.kind !== "device") throw new Error("expected device");
    expect(dev.args).toEqual(["auth", "login", "--hostname", "gitlab.com", "--device", "--git-protocol", "https", "--setup-git-credential-helper"]);
    expect(gitlab.signInPlan("git.acme.internal:8443")).toEqual({
      kind: "token",
      tokenUrl: "https://git.acme.internal:8443/-/user_settings/personal_access_tokens?name=Squad&scopes=read_repository,read_api",
    });
  });
  it("parses glab's device code and link", () => {
    const { gitlab } = makeTemplates(fakeExec(() => ({})).exec);
    expect(gitlab.parseDevice("- Signing into gitlab.com\n\nFirst copy your one-time code: JV0CHAYI\nThen open this URL on any device to authorize: https://gitlab.com/oauth/device\n"))
      .toEqual({ code: "JV0CHAYI", url: "https://gitlab.com/oauth/device" });
  });
  it("strips CI from glab's environment, so tokens go to the keyring", async () => {
    process.env.CI = "1";
    const f = fakeExec(() => ({}));
    const { gitlab } = makeTemplates(f.exec);
    const dev = gitlab.signInPlan("gitlab.com");
    if (dev.kind !== "device") throw new Error("expected device");
    expect(dev.env.CI).toBeUndefined();
    await gitlab.accounts();
    expect(f.calls[0].env?.CI).toBeUndefined();
  });
  it("lists only hosts glab is really signed in to", async () => {
    const { gitlab } = makeTemplates(fakeExec(() => ({ code: 1, stderr: fixture("glab-status.txt") })).exec);
    expect(await gitlab.accounts()).toEqual([{ host: "gitlab.com", user: "gphook" }]);
  });
  it("passes a token on stdin, never as an argument", async () => {
    const f = fakeExec((c) => (c.args[1] === "status" ? { stderr: "  ✓ Logged in to git.acme.internal as me (keyring)" } : {}));
    await makeTemplates(f.exec).gitlab.tokenSignIn!("git.acme.internal", "glpat-secret");
    const login = f.calls.find((c) => c.args[1] === "login")!;
    expect(login.stdin).toBe("glpat-secret");
    expect(login.args).toEqual(["auth", "login", "--hostname", "git.acme.internal", "--stdin", "--git-protocol", "https", "--setup-git-credential-helper"]);
    expect(f.calls.flatMap((c) => c.args).join(" ")).not.toContain("glpat-secret");
  });
  it("logs back out and rejects when GitLab didn't accept the token (glab exits 0 anyway)", async () => {
    const f = fakeExec((c) => (c.args[1] === "status" ? { code: 1, stderr: fixture("glab-status.txt") } : {}));
    await expect(makeTemplates(f.exec).gitlab.tokenSignIn!("git.acme.internal", "bad")).rejects.toThrow("GitLab didn't accept that token.");
    expect(f.calls.some((c) => c.args.join(" ") === "auth logout --hostname git.acme.internal")).toBe(true);
  });
});

describe("sourceHost", () => {
  it.each([
    ["acme/plugins", "github.com"],
    ["https://github.acme.com/a/b.git", "github.acme.com"],
    ["https://GitLab.com:8443/a/b", "gitlab.com:8443"],
    ["git@gitlab.com:a/b.git", "gitlab.com"],
    ["ssh://git@git.acme.internal/a/b.git", "git.acme.internal"],
    ["./local", null],
    ["~/dev/plugins", null],
  ])("%s → %s", (src, host) => expect(sourceHost(src)).toBe(host));
});
