import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { ServerMsg, SignInOverview } from "@squad/shared";

let deliver: (m: ServerMsg) => void = () => {};
const stop = vi.fn();
vi.mock("../src/lib/ws.ts", () => ({
  connect: (h: { onMsg: (m: ServerMsg) => void }) => { deliver = h.onMsg; return { send: () => {}, stop }; },
}));

const key = (id: string, name: string) => ({ id, name, createdAt: 1_700_000_000_000, lastUsedAt: null });
const sess = (id: string, current: boolean, kind: "remember" | "restart" = "remember") =>
  ({ id, kind, label: `Browser ${id}`, createdAt: 1_700_000_000_000, lastUsedAt: 1_700_000_100_000, current });
let data: SignInOverview;
let serverSignedIn = true;
const api = {
  fetchSession: vi.fn(async () => ({ signedIn: serverSignedIn, setupNeeded: false, setupGrant: false })),
  overview: vi.fn(async () => data),
  renamePasskey: vi.fn(async () => {}),
  deletePasskey: vi.fn(async () => {}),
  revokeSession: vi.fn(async () => {}),
  signOutEverywhere: vi.fn(async () => {}),
  addPasskey: vi.fn(async () => {}),
};
vi.mock("../src/lib/signin.ts", () => api);

const { start, ui } = await import("../src/lib/state.svelte.ts");
const { default: SignInView } = await import("../src/components/SignInView.svelte");

let cleanup: (() => void)[] = [];
beforeEach(async () => {
  data = { passkeys: [key("k1", "Laptop"), key("k2", "Phone")], sessions: [sess("s1", true), sess("s2", false, "restart")] };
  stop.mockClear();
  ui.view = "signin";
  Object.values(api).forEach((f) => f.mockClear());
  serverSignedIn = true;
  await start();
  // Signing this browser out only happens once the server has ended its session, so later refetches say so.
  serverSignedIn = false;
});
afterEach(() => { for (const c of cleanup) c(); cleanup = []; document.body.innerHTML = ""; });

async function render() {
  const target = document.createElement("div");
  document.body.append(target);
  const app = mount(SignInView, { target });
  cleanup.push(() => unmount(app));
  flushSync();
  await vi.waitFor(() => expect(target.querySelector("li")).toBeTruthy());
  return target;
}
const button = (t: HTMLElement, label: string) => t.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

describe("Sign-in view", () => {
  it("lists passkeys and sessions and marks This browser", async () => {
    const t = await render();
    expect(t.textContent).toContain("Laptop");
    expect(t.textContent).toContain("Phone");
    expect(t.textContent).toContain("Remembered for 30 days");
    expect(t.textContent).toContain("Until Squad restarts");
    expect(t.textContent?.match(/This browser/g)).toHaveLength(1);
  });

  it("Delete is disabled for the only passkey", async () => {
    data = { ...data, passkeys: [key("k1", "Laptop")] };
    const t = await render();
    const del = button(t, "Delete Laptop");
    expect(del.disabled).toBe(true);
    expect(del.title).toBe("You can't delete your only passkey");
  });

  it("Revoke calls the API and refetches", async () => {
    const t = await render();
    api.overview.mockClear();
    data = { ...data, sessions: [sess("s1", true)] };
    button(t, "Revoke Browser s2").click();
    await vi.waitFor(() => expect(api.overview).toHaveBeenCalledTimes(1));
    expect(api.revokeSession).toHaveBeenCalledWith("s2");
    flushSync();
    expect(t.textContent).not.toContain("Browser s2");
  });

  it("revoking this browser's session shows the sign-in screen", async () => {
    const t = await render();
    button(t, "Revoke Browser s1").click();
    await vi.waitFor(() => expect(ui.session?.signedIn).toBe(false));
    expect(api.revokeSession).toHaveBeenCalledWith("s1");
  });

  it("fetches overview once on open, not on server messages", async () => {
    await render();
    for (let i = 0; i < 5; i++) { deliver({ t: "agent.event", agentId: "a", event: { kind: "text_delta", text: "x" } }); flushSync(); }
    expect(api.overview).toHaveBeenCalledTimes(1);
  });

  it("stops the socket and leaves the Sign-in view when this browser signs out", async () => {
    const t = await render();
    button(t, "Revoke Browser s1").click();
    await vi.waitFor(() => expect(ui.session?.signedIn).toBe(false));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(ui.view).toBe("chat");
  });

  it("Sign out everywhere asks first, then signs this browser out", async () => {
    const t = await render();
    const signOutBtn = [...t.querySelectorAll("button")].find((b) => b.textContent === "Sign out everywhere")!;
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    signOutBtn.click();
    await Promise.resolve();
    expect(api.signOutEverywhere).not.toHaveBeenCalled();
    expect(ui.session?.signedIn).toBe(true);
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    signOutBtn.click();
    await vi.waitFor(() => expect(ui.session?.signedIn).toBe(false));
    expect(api.signOutEverywhere).toHaveBeenCalledTimes(1);
  });

  it("a 401 on refetch signs this browser out", async () => {
    api.overview.mockRejectedValueOnce(Object.assign(new Error("Request failed (401)"), { status: 401 }));
    await render().catch(() => {});
    await vi.waitFor(() => expect(ui.session?.signedIn).toBe(false));
  });

  it("a 401 from a manage call signs this browser out instead of showing an error", async () => {
    const t = await render();
    api.deletePasskey.mockRejectedValueOnce(Object.assign(new Error("Request failed (401)"), { status: 401 }));
    button(t, "Delete Phone").click();
    await vi.waitFor(() => expect(ui.session?.signedIn).toBe(false));
    expect(t.querySelector("[role=alert]")).toBeNull();
  });
});
