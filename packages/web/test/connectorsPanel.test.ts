import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { ClientMsg, ConnectorView, ServerMsg } from "@squad/shared";
import { emptyState, reduce, forProject } from "../src/lib/reducer.ts";

const sent: ClientMsg[] = [];
let deliver: (m: ServerMsg) => void = () => {};
vi.mock("../src/lib/ws.ts", () => ({
  connect: (h: { onMsg: (m: ServerMsg) => void }) => { deliver = h.onMsg; return { send: (m: ClientMsg) => sent.push(m) }; },
}));
vi.mock("../src/lib/signin.ts", () => ({ fetchSession: async () => ({ signedIn: true, setupNeeded: false, setupGrant: false }) }));

const { start } = await import("../src/lib/state.svelte.ts");
const { default: ConnectorsPanel } = await import("../src/components/plugins/ConnectorsPanel.svelte");

const gh: ConnectorView = { id: "c1", template: "github", name: "GitHub", host: "github.com", state: "signed-in", user: "gphook" };
const acme: ConnectorView = { id: "c2", template: "github", name: "Acme GitHub", host: "github.acme.com", state: "signed-out" };
const lab: ConnectorView = { id: "c3", template: "gitlab", name: "Lab", host: "git.acme.internal", state: "missing-cli" };
const feed = (m: ServerMsg) => { deliver(m); flushSync(); };
let cleanup: (() => void)[] = [];
let root: HTMLElement;

beforeEach(async () => {
  sent.length = 0;
  await start();
  const target = document.createElement("div");
  document.body.append(target);
  const app = mount(ConnectorsPanel as never, { target, props: {} });
  cleanup.push(() => unmount(app));
  root = target;
  flushSync();
});
afterEach(() => { for (const c of cleanup) c(); cleanup = []; document.body.innerHTML = ""; });

const text = () => root.textContent!.replace(/\s+/g, " ");
const button = (label: string) => [...root.querySelectorAll("button")].find((b) => b.textContent!.trim() === label)!;
const type = (el: HTMLInputElement | HTMLSelectElement, v: string) => { el.value = v; el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input")); flushSync(); };

describe("connector state", () => {
  it("keeps connectors and their sign-in across projects", () => {
    let s = reduce(emptyState(), { t: "connectors", connectors: [gh] });
    s = reduce(s, { t: "connector.login", login: { phase: "starting", id: "c1" } });
    s = reduce(s, { t: "connector.error", message: "nope" });
    const next = forProject(s, "q");
    expect(next.connectors).toEqual([gh]);
    expect(next.connectorLogin).toEqual({ phase: "starting", id: "c1" });
  });
});

describe("ConnectorsPanel", () => {
  it("asks for the connectors and shows each one's state", () => {
    expect(sent).toContainEqual({ t: "connectors.get" });
    feed({ t: "connectors", connectors: [gh, acme, lab] });
    expect(text()).toContain("signed in as gphook");
    expect(text()).toContain("github.acme.com");
    expect(text()).toContain("Install the GitLab CLI (glab)");
    expect(root.querySelector('a[href="https://github.com/gphook/squad/issues/new"]')?.textContent).toContain("Request a connector");
  });

  it("starts a sign-in and shows the code and link while it waits", () => {
    feed({ t: "connectors", connectors: [gh, acme] });
    button("Sign in").click();
    expect(sent.at(-1)).toEqual({ t: "connector.login", id: "c2" });
    feed({ t: "connector.login", login: { phase: "waiting", id: "c2", code: "AB12-CD34", url: "https://github.acme.com/login/device" } });
    expect(root.querySelector("code")?.textContent).toBe("AB12-CD34");
    const link = root.querySelector('a[href="https://github.acme.com/login/device"]') as HTMLAnchorElement;
    expect(link.target).toBe("_blank");
    button("Cancel").click();
    expect(sent.at(-1)).toEqual({ t: "connector.cancel" });
  });

  it("takes a token for a token sign-in and clears the field", () => {
    feed({ t: "connectors", connectors: [{ ...lab, state: "signed-out" }] });
    feed({ t: "connector.login", login: { phase: "token", id: "c3", tokenUrl: "https://git.acme.internal/-/tokens", error: "GitLab didn't accept that token." } });
    expect(text()).toContain("GitLab didn't accept that token.");
    const field = root.querySelector('input[type="password"]') as HTMLInputElement;
    type(field, "glpat-abc");
    (field.form as HTMLFormElement).requestSubmit();
    flushSync();
    expect(sent.at(-1)).toEqual({ t: "connector.token", token: "glpat-abc" });
    expect(field.value).toBe("");
  });

  it("shows a failed sign-in until dismissed", () => {
    feed({ t: "connectors", connectors: [acme] });
    feed({ t: "connector.login", login: { phase: "failed", id: "c2", message: "access denied" } });
    expect(text()).toContain("access denied");
    button("Dismiss").click();
    expect(sent.at(-1)).toEqual({ t: "connector.cancel" });
  });

  it("adds a connector, checking the host first", () => {
    feed({ t: "connectors", connectors: [] });
    button("+ Add connector").click();
    flushSync();
    const host = root.querySelector('input[aria-label="Host"]') as HTMLInputElement;
    type(root.querySelector('select[aria-label="Template"]') as HTMLSelectElement, "gitlab");
    type(host, "https://gitlab.acme.com");
    button("Add").click();
    flushSync();
    expect(sent.some((m) => m.t === "connector.add")).toBe(false);
    expect(text()).toContain("isn't a hostname");
    type(host, "gitlab.acme.com");
    type(root.querySelector('input[aria-label="Name"]') as HTMLInputElement, "Acme Lab");
    button("Add").click();
    expect(sent.at(-1)).toEqual({ t: "connector.add", template: "gitlab", name: "Acme Lab", host: "gitlab.acme.com" });
  });

  it("removes a connector, optionally signing out", () => {
    feed({ t: "connectors", connectors: [gh] });
    button("Remove").click();
    flushSync();
    (root.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    flushSync();
    button("Remove GitHub").click();
    expect(sent.at(-1)).toEqual({ t: "connector.remove", id: "c1", signOut: true });
  });

  it("signs out", () => {
    feed({ t: "connectors", connectors: [gh] });
    button("Sign out").click();
    expect(sent.at(-1)).toEqual({ t: "connector.signOut", id: "c1" });
  });
});
