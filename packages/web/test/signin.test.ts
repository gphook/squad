import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

const browser = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock("@simplewebauthn/browser", () => browser);

import SignInScreen from "../src/components/SignInScreen.svelte";
import App from "../src/App.svelte";
import { ui, start } from "../src/lib/state.svelte.ts";
import { rememberedChoice, saveChoice } from "../src/lib/signin.ts";

class FakeWS {
  static OPEN = 1;
  readyState = 0;
  send() {}
  close() {}
}

let cleanup: (() => void)[] = [];
const calls: { url: string; body: unknown }[] = [];

function mockFetch(handler: (url: string) => { status?: number; json: unknown }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const r = handler(url);
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.json };
  }));
}

function render(session: { signedIn: boolean; setupNeeded: boolean; setupGrant: boolean }) {
  ui.session = session;
  const target = document.createElement("div");
  document.body.append(target);
  const app = mount(SignInScreen, { target });
  cleanup.push(() => unmount(app));
  flushSync();
  return target;
}
const click = (el: Element) => { (el as HTMLElement).click(); flushSync(); };
const settle = async () => { await new Promise((r) => setTimeout(r, 0)); flushSync(); };
const button = (t: HTMLElement, text: string) => [...t.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  vi.stubGlobal("WebSocket", FakeWS);
  browser.startAuthentication.mockReset();
  browser.startRegistration.mockReset();
});
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("SignInScreen", () => {
  it("shows Set up Squad when setupNeeded and setupGrant", () => {
    const t = render({ signedIn: false, setupNeeded: true, setupGrant: true });
    expect(t.querySelector("h1")?.textContent).toBe("Set up Squad");
    expect(t.textContent).toContain("Squad uses a passkey, your fingerprint, face, device PIN or a security key, so only you can open it.");
    expect(button(t, "Create passkey")).toBeTruthy();
  });

  it("offers Create passkey for a setup grant even when passkeys already exist", () => {
    const t = render({ signedIn: false, setupNeeded: false, setupGrant: true });
    expect(t.querySelector("h1")?.textContent).toBe("Set up Squad");
    expect(button(t, "Create passkey")).toBeTruthy();
  });

  it("shows the expired message when setupNeeded without a grant", () => {
    const t = render({ signedIn: false, setupNeeded: true, setupGrant: false });
    expect(t.textContent).toContain("This setup link has expired or was already used. Restart Squad to get a new one.");
    expect(t.querySelector("button")).toBeNull();
  });

  it("shows the expired message for ?setup=expired and removes it from the URL", () => {
    history.replaceState(null, "", "/?setup=expired");
    const t = render({ signedIn: false, setupNeeded: false, setupGrant: false });
    expect(t.textContent).toContain("This setup link has expired or was already used.");
    expect(location.search).toBe("");
  });

  it("shows Sign in when passkeys exist", () => {
    const t = render({ signedIn: false, setupNeeded: false, setupGrant: false });
    expect(t.querySelector("h1")?.textContent).toBe("Sign in to Squad");
    expect(button(t, "Sign in with passkey")).toBeTruthy();
  });

  it("signIn posts remember from the radio and then marks the session signed in", async () => {
    browser.startAuthentication.mockResolvedValue({ id: "cred" });
    mockFetch((url) => (url === "/api/auth/login/options" ? { json: { challenge: "c" } } : { json: { ok: true } }));
    const t = render({ signedIn: false, setupNeeded: false, setupGrant: false });
    click(t.querySelector<HTMLInputElement>('input[value="remember"]')!);
    click(button(t, "Sign in with passkey"));
    await settle();
    expect(browser.startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: "c" } });
    expect(calls.find((c) => c.url === "/api/auth/login/verify")?.body).toEqual({ response: { id: "cred" }, remember: true });
    expect(ui.session?.signedIn).toBe(true);
  });

  it("creates a passkey from the setup screen", async () => {
    browser.startRegistration.mockResolvedValue({ id: "new" });
    mockFetch((url) => (url === "/api/auth/register/options" ? { json: { challenge: "r" } } : { json: { ok: true } }));
    const t = render({ signedIn: false, setupNeeded: true, setupGrant: true });
    click(button(t, "Create passkey"));
    await settle();
    expect(calls.find((c) => c.url === "/api/auth/register/verify")?.body).toEqual({ response: { id: "new" }, remember: false });
    expect(ui.session?.signedIn).toBe(true);
  });

  it("shows the server's message when sign-in fails", async () => {
    browser.startAuthentication.mockResolvedValue({ id: "cred" });
    mockFetch((url) => (url === "/api/auth/login/options" ? { json: {} } : { status: 401, json: { error: "Passkey not recognised" } }));
    const t = render({ signedIn: false, setupNeeded: false, setupGrant: false });
    click(button(t, "Sign in with passkey"));
    await settle();
    expect(t.querySelector('[role="alert"]')?.textContent).toBe("Passkey not recognised");
    expect(ui.session?.signedIn).toBe(false);
  });

  it("a cancelled prompt shows the cancelled message", async () => {
    browser.startAuthentication.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    mockFetch(() => ({ json: {} }));
    const t = render({ signedIn: false, setupNeeded: false, setupGrant: false });
    click(button(t, "Sign in with passkey"));
    await settle();
    expect(t.querySelector('[role="alert"]')?.textContent).toBe("Passkey request was cancelled.");
  });

  it("the radio defaults to Until Squad restarts and remembers the last choice", async () => {
    expect(rememberedChoice()).toBe(false);
    let t = render({ signedIn: false, setupNeeded: false, setupGrant: false });
    expect(t.querySelector<HTMLInputElement>('input[value="restart"]')!.checked).toBe(true);
    expect(t.textContent).toContain("Until Squad restarts");
    expect(t.textContent).toContain("Remember this browser for 30 days");
    saveChoice(true);
    expect(rememberedChoice()).toBe(true);
    document.body.innerHTML = "";
    t = render({ signedIn: false, setupNeeded: false, setupGrant: false });
    expect(t.querySelector<HTMLInputElement>('input[value="remember"]')!.checked).toBe(true);
  });

  it("says it can't reach Squad, retries, then shows the sign-in screen", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      vi.stubGlobal("fetch", vi.fn(async () => {
        if (n++ === 0) throw new Error("down");
        return { ok: true, status: 200, json: async () => ({ signedIn: false, setupNeeded: false, setupGrant: false }) };
      }));
      ui.session = null;
      const target = document.createElement("div");
      document.body.append(target);
      const app = mount(App, { target });
      cleanup.push(() => unmount(app));
      const started = start();
      await vi.advanceTimersByTimeAsync(0);
      flushSync();
      expect(target.textContent).toContain("Can't reach Squad. Retrying…");
      await vi.advanceTimersByTimeAsync(1000);
      await started;
      flushSync();
      expect(target.textContent).not.toContain("Can't reach Squad");
      expect(target.querySelector("h1")?.textContent).toBe("Sign in to Squad");
    } finally {
      vi.useRealTimers();
    }
  });
});
