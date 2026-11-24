import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectorLogin, ConnectorTemplateId } from "@squad/shared";
import type { LoginChild } from "../src/claudeLogin.ts";
import { Store } from "../src/store.ts";
import { ConnectorService } from "../src/connectors/service.ts";
import type { ConnectorTemplate } from "../src/connectors/template.ts";

class FakeChild extends EventEmitter implements LoginChild {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  ended = false;
  stdin = { write: () => true, end: () => { this.ended = true; } };
  kill() { this.killed = true; this.emit("exit", null, "SIGTERM"); return true; }
  exit(code: number) { this.emit("exit", code, null); }
}
const tick = () => new Promise((r) => setTimeout(r, 5));

function template(id: ConnectorTemplateId, over: Partial<ConnectorTemplate> = {}): ConnectorTemplate & { signedIn: Map<string, string> } {
  const signedIn = new Map<string, string>();
  return {
    signedIn,
    id, label: id === "github" ? "GitHub" : "GitLab", defaultHost: id === "github" ? "github.com" : "gitlab.com",
    cli: { bin: id === "github" ? "gh" : "glab", label: id === "github" ? "the GitHub CLI (gh)" : "the GitLab CLI (glab)", installUrl: "x" },
    available: async () => true,
    accounts: async () => [...signedIn].map(([host, user]) => ({ host, user })),
    signInPlan: (host) => (host.endsWith(".internal")
      ? { kind: "token", tokenUrl: `https://${host}/tokens` }
      : { kind: "device", args: ["login", host], env: {} }),
    parseDevice: (out) => (/code: (\S+)/.test(out) && /url: (\S+)/.test(out)
      ? { code: /code: (\S+)/.exec(out)![1], url: /url: (\S+)/.exec(out)![1] } : null),
    tokenSignIn: vi.fn(async (host: string, token: string) => {
      if (token === "bad") throw new Error("GitLab didn't accept that token.");
      signedIn.set(host, "tok-user");
    }),
    afterSignIn: vi.fn(async () => {}),
    signOut: vi.fn(async (host: string) => { signedIn.delete(host); }),
    ...over,
  };
}

function setup(opts: { github?: Partial<ConnectorTemplate>; timeoutMs?: number; store?: Store } = {}) {
  const store = opts.store ?? new Store(join(mkdtempSync(join(tmpdir(), "squad-conn-")), "squad.db"));
  const github = template("github", opts.github);
  const gitlab = template("gitlab");
  const children: FakeChild[] = [];
  const svc = new ConnectorService({
    store, templates: { github, gitlab }, timeoutMs: opts.timeoutMs,
    spawn: () => { const c = new FakeChild(); children.push(c); return c; },
  });
  const logins: ConnectorLogin[] = [];
  svc.on("login", (l: ConnectorLogin) => logins.push(l));
  return { svc, store, github, gitlab, children, logins };
}

describe("ConnectorService", () => {
  it("seeds a connector for each host the CLIs are signed in to, once", async () => {
    const { svc, store, github, gitlab } = setup();
    github.signedIn.set("github.com", "gphook");
    gitlab.signedIn.set("git.acme.internal", "me");
    await svc.init();
    expect(svc.list.map((c) => [c.template, c.name, c.host, c.state])).toEqual([
      ["github", "GitHub", "github.com", "signed-in"], ["gitlab", "GitLab", "git.acme.internal", "signed-in"],
    ]);
    store.removeConnector(svc.list[0].id);
    await svc.init();
    expect(store.listConnectors()).toHaveLength(1);
  });

  it("shows missing-cli when a template's CLI isn't installed, and won't start a sign-in", async () => {
    const { svc, logins } = setup({ github: { available: async () => false } });
    await svc.init();
    const c = await svc.add("github", "", "github.com");
    expect(svc.list[0]).toMatchObject({ id: c.id, state: "missing-cli" });
    await svc.startLogin(c.id);
    expect(logins.at(-1)).toEqual({ phase: "failed", id: c.id, message: "Install the GitHub CLI (gh) first." });
  });

  it("validates, normalises and names new connectors", async () => {
    const { svc } = setup();
    await expect(svc.add("github", "", "https://github.com")).rejects.toThrow(/isn't a hostname/);
    const a = await svc.add("github", "  ", " GitHub.Acme.com ");
    expect(a).toMatchObject({ name: "GitHub", host: "github.acme.com" });
    const b = await svc.add("github", "", "github.com");
    expect(b.name).toBe("github.com");
    await expect(svc.add("gitlab", "x", "GITHUB.COM")).rejects.toThrow("A connector for github.com already exists.");
  });

  it("runs a device sign-in: code and link, then git setup and signed in", async () => {
    const { svc, github, children, logins } = setup();
    const c = await svc.add("github", "", "github.com");
    await svc.startLogin(c.id);
    expect(logins.at(-1)).toEqual({ phase: "starting", id: c.id });
    children[0].stderr.write("! First copy your one-time code: AB-12\n");
    children[0].stderr.write("url: https://github.com/login/device\ncode: AB-12\n");
    await tick();
    expect(logins.at(-1)).toEqual({ phase: "waiting", id: c.id, code: "AB-12", url: "https://github.com/login/device" });
    expect(children[0].ended).toBe(false);
    github.signedIn.set("github.com", "gphook");
    children[0].exit(0);
    await tick();
    expect(github.afterSignIn).toHaveBeenCalledWith("github.com");
    expect(logins.at(-1)).toEqual({ phase: "idle" });
    expect(svc.list[0]).toMatchObject({ state: "signed-in", user: "gphook" });
  });

  it("reports the CLI's last line when a sign-in fails", async () => {
    const { svc, children, logins } = setup();
    const c = await svc.add("github", "", "github.com");
    await svc.startLogin(c.id);
    children[0].stderr.write("error: access denied by user\n");
    await tick();
    children[0].exit(1);
    await tick();
    expect(logins.at(-1)).toEqual({ phase: "failed", id: c.id, message: "error: access denied by user" });
  });

  it("times out, killing the CLI", async () => {
    const { svc, children, logins } = setup({ timeoutMs: 20 });
    const c = await svc.add("github", "", "github.com");
    await svc.startLogin(c.id);
    await new Promise((r) => setTimeout(r, 40));
    expect(children[0].killed).toBe(true);
    expect(logins.at(-1)).toEqual({ phase: "failed", id: c.id, message: "Sign-in timed out. Try again." });
  });

  it("cancels the running sign-in when its connector is removed, and can sign the host out", async () => {
    const { svc, github, children, logins } = setup();
    const c = await svc.add("github", "", "github.com");
    await svc.startLogin(c.id);
    await svc.remove(c.id, true);
    expect(children[0].killed).toBe(true);
    expect(logins.at(-1)).toEqual({ phase: "idle" });
    expect(github.signOut).toHaveBeenCalledWith("github.com");
    expect(svc.list).toEqual([]);
  });

  it("takes a token for a token sign-in, never broadcasting it, and asks again when it's refused", async () => {
    const { svc, gitlab, logins } = setup();
    const events: unknown[] = [];
    svc.on("connectors", (v) => events.push(v));
    const c = await svc.add("gitlab", "Lab", "git.acme.internal");
    await svc.startLogin(c.id);
    expect(logins.at(-1)).toEqual({ phase: "token", id: c.id, tokenUrl: "https://git.acme.internal/tokens" });
    await svc.submitToken("bad");
    expect(logins.at(-1)).toEqual({ phase: "token", id: c.id, tokenUrl: "https://git.acme.internal/tokens", error: "GitLab didn't accept that token." });
    await svc.submitToken("glpat-good");
    expect(gitlab.tokenSignIn).toHaveBeenLastCalledWith("git.acme.internal", "glpat-good");
    expect(logins.at(-1)).toEqual({ phase: "idle" });
    expect(svc.list[0]).toMatchObject({ state: "signed-in", user: "tok-user" });
    expect(JSON.stringify([logins, events])).not.toContain("glpat-good");
  });

  it("signs a connector's host out", async () => {
    const { svc, github } = setup();
    github.signedIn.set("github.com", "gphook");
    const c = await svc.add("github", "", "github.com");
    await svc.signOut(c.id);
    expect(svc.list[0].state).toBe("signed-out");
  });

  it("hints at the connector a failed marketplace source needs", async () => {
    const { svc, github } = setup();
    const c = await svc.add("github", "Acme", "github.acme.com");
    expect(svc.hintFor("https://github.acme.com/a/b.git")).toBe("Sign in to Acme (github.acme.com) under Connectors, then try again.");
    expect(svc.hintFor("https://gitlab.com/a/b")).toBe("Add a GitHub or GitLab connector for gitlab.com under Connectors, then try again.");
    expect(svc.hintFor("./local")).toBeNull();
    github.signedIn.set("github.acme.com", "me");
    await svc.refresh();
    expect(svc.hintFor("https://github.acme.com/a/b.git")).toBeNull();
    void c;
  });

  it("runs one sign-in when Sign in is clicked twice, and Cancel works before the CLI starts", async () => {
    const { svc, children, logins } = setup();
    const c = await svc.add("github", "", "github.com");
    await Promise.all([svc.startLogin(c.id), svc.startLogin(c.id)]);
    expect(children.filter((ch) => !ch.killed)).toHaveLength(1);
    svc.cancel();
    const pending = svc.startLogin(c.id);
    svc.cancel();
    await pending;
    expect(children.filter((ch) => !ch.killed)).toHaveLength(0);
    expect(logins.at(-1)).toEqual({ phase: "idle" });
  });

  it("doesn't seed a host that isn't a valid hostname", async () => {
    const { svc, github } = setup();
    github.signedIn.set("-oProxyCommand=x", "evil");
    github.signedIn.set("github.com", "gphook");
    await svc.init();
    expect(svc.list.map((c) => c.host)).toEqual(["github.com"]);
  });
});
