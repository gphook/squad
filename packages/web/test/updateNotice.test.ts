import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { ServerMsg } from "@squad/shared";

let deliver: (m: ServerMsg) => void = () => {};
vi.mock("../src/lib/ws.ts", () => ({
  connect: (h: { onMsg: (m: ServerMsg) => void }) => { deliver = h.onMsg; return { send: () => {}, stop: () => {} }; },
}));
vi.mock("../src/lib/signin.ts", () => ({ fetchSession: async () => ({ signedIn: true, setupNeeded: false, setupGrant: false }) }));

const { start, ui } = await import("../src/lib/state.svelte.ts");
const { default: TopBar } = await import("../src/components/TopBar.svelte");

let cleanup: (() => void)[] = [];
beforeEach(async () => {
  await start();
  ui.update = null;
});
afterEach(() => { for (const c of cleanup) c(); cleanup = []; document.body.innerHTML = ""; });

function render() {
  const target = document.createElement("div");
  document.body.append(target);
  const app = mount(TopBar, { target, props: { oneditproject: () => {} } });
  cleanup.push(() => unmount(app));
  flushSync();
  return target;
}

describe("update notice", () => {
  it("shows when the server says a newer version exists, with the command to run", () => {
    const t = render();
    expect(t.textContent).not.toContain("Update available");
    deliver({ t: "update", latest: "9.0.0", current: "0.1.0" });
    flushSync();
    expect(t.textContent).toContain("Update available: 9.0.0");
    expect(t.innerHTML).toContain("npx @gphook/squad@latest");
  });
  it("can be dismissed", () => {
    const t = render();
    deliver({ t: "update", latest: "9.0.0", current: "0.1.0" });
    flushSync();
    (t.querySelector('button[aria-label="Dismiss update notice"]') as HTMLButtonElement).click();
    flushSync();
    expect(t.textContent).not.toContain("Update available");
  });
});
