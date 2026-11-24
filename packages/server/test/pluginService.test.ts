import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQUAD_KIT_ID } from "@squad/shared";
import { Store } from "../src/store.ts";
import { FakePluginSource } from "../src/plugins/fakeSource.ts";
import { PluginService, kitPlugin } from "../src/plugins/service.ts";

let store: Store, svc: PluginService, p: string, a: string, other: string;
const kit = kitPlugin(join(import.meta.dirname, "../../../kit"));
beforeEach(() => {
  store = new Store(join(mkdtempSync(join(tmpdir(), "squad-plugins-")), "squad.db"));
  svc = new PluginService(new FakePluginSource({ delayMs: 0 }), store, kit);
  p = store.saveProject({ name: "P", rules: "", permissionMode: "default" }).id;
  a = store.saveAgent({ projectId: p, name: "a", role: "", folder: "/tmp", model: null }).id;
  const q = store.saveProject({ name: "Q", rules: "", permissionMode: "default" }).id;
  other = store.saveAgent({ projectId: q, name: "b", role: "", folder: "/tmp", model: null }).id;
});
const FD = "frontend-design@claude-plugins-official";

describe("PluginService with a source that fails", () => {
  it("leaves the switches alone when the install or uninstall fails", async () => {
    const source = new FakePluginSource({ delayMs: 0 });
    source.install = () => Promise.reject(new Error("Network down"));
    const failing = new PluginService(source, store, kit);
    await expect(failing.install(p, FD, a)).rejects.toThrow("Network down");
    store.setPluginSwitch(p, "superpowers@claude-plugins-official", a, true);
    source.uninstall = () => Promise.reject(new Error("Busy"));
    await expect(failing.uninstall("superpowers@claude-plugins-official")).rejects.toThrow("Busy");
    expect(store.listPluginSwitches(p)).toEqual([{ pluginId: "superpowers@claude-plugins-official", agentId: a, enabled: true }]);
  });
});

describe("PluginService", () => {
  it("refuses to install for a squadmate from another project, before installing", async () => {
    await expect(svc.install(p, FD, other)).rejects.toThrow("isn't a squadmate in this project");
    expect((await svc.snapshot(p)).installed.map((x) => x.id)).not.toContain(FD);
  });
  it("refuses a project that no longer exists, before installing anything", async () => {
    await expect(svc.install("gone", FD, null)).rejects.toThrow("That project no longer exists.");
    expect((await svc.snapshot(p)).installed.map((x) => x.id)).not.toContain(FD);
    await expect(svc.switch("gone", "superpowers@claude-plugins-official", null, true)).rejects.toThrow("That project no longer exists.");
    await expect(svc.snapshot("gone")).rejects.toThrow("That project no longer exists.");
  });
  it("lists squad-kit first, required and on, with the skills it carries", async () => {
    const s = await svc.snapshot(p);
    expect(s.installed[0]).toMatchObject({ id: SQUAD_KIT_ID, name: "squad-kit", required: true, enabled: true });
    expect(s.installed[0].inventory?.skills).toBeGreaterThanOrEqual(1);
    expect(s.available).toBeGreaterThan(0);
  });
  it("installs for one squadmate as its own setting", async () => {
    await svc.install(p, FD, a);
    const s = await svc.snapshot(p);
    expect(s.installed.map((x) => x.id)).toContain(FD);
    expect(s.switches).toEqual([{ pluginId: FD, agentId: a, enabled: true }]);
  });
  it("installs for the entire squad as the project's setting", async () => {
    await svc.install(p, FD, null);
    expect((await svc.snapshot(p)).switches).toEqual([{ pluginId: FD, agentId: null, enabled: true }]);
  });
  it("refuses to switch squad-kit, a plugin that isn't installed, or a squadmate from another project", async () => {
    await expect(svc.switch(p, SQUAD_KIT_ID, null, false)).rejects.toThrow("squad-kit is required");
    await expect(svc.switch(p, FD, null, true)).rejects.toThrow("isn't installed");
    const installed = (await svc.snapshot(p)).installed[1].id;
    await expect(svc.switch(p, installed, other, true)).rejects.toThrow("isn't a squadmate in this project");
    expect(store.listPluginSwitches(p)).toEqual([]);
  });
  it("forgets a plugin's switches when it's uninstalled, so a reinstall starts fresh", async () => {
    await svc.install(p, FD, a);
    await svc.uninstall(FD);
    expect(store.listPluginSwitches(p)).toEqual([]);
    await svc.install(p, FD, null);
    expect(store.listPluginSwitches(p)).toEqual([{ pluginId: FD, agentId: null, enabled: true }]);
  });
  it("won't uninstall squad-kit", async () => {
    await expect(svc.uninstall(SQUAD_KIT_ID)).rejects.toThrow("squad-kit is required");
  });
  it("refuses a marketplace source that isn't a repo, URL or path, before reaching the source", async () => {
    await expect(svc.addMarketplace("hello")).rejects.toThrow('"hello" isn\'t a GitHub repo');
    expect((await svc.snapshot(p)).marketplaces).toHaveLength(3);
  });
});

describe("PluginService caching, pruning and launch sets", () => {
  const SP = "superpowers@claude-plugins-official"; // on in the terminal
  const BU = "browser-use@claude-plugins-official"; // off in the terminal
  let source: FakePluginSource, calls: Record<string, number>, now: number, cached: PluginService;
  beforeEach(() => {
    source = new FakePluginSource({ delayMs: 0 });
    calls = { installed: 0, installs: 0, search: 0 };
    for (const k of ["installed", "installs", "search"] as const) {
      const orig = source[k].bind(source) as (...args: unknown[]) => unknown;
      (source as unknown as Record<string, unknown>)[k] = (...args: unknown[]) => { calls[k]++; return orig(...args); };
    }
    now = 0;
    cached = new PluginService(source, store, kit, { now: () => now });
  });

  it("asks the source once for repeated snapshots, again after an install, not after a switch", async () => {
    await cached.snapshot(p);
    await cached.snapshot(p);
    expect(calls).toMatchObject({ installed: 1, search: 1 });
    await cached.switch(p, SP, a, false);
    await cached.snapshot(p);
    expect(calls).toMatchObject({ installed: 1, search: 1 });
    await cached.install(p, FD, a);
    await cached.snapshot(p);
    expect(calls.installed).toBeGreaterThan(1);
    expect(calls.search).toBeGreaterThan(1);
  });

  it("refreshes the available list after 10 minutes", async () => {
    await cached.snapshot(p);
    now = 599_000;
    await cached.snapshot(p);
    expect(calls.search).toBe(1);
    now = 600_001;
    await cached.snapshot(p);
    expect(calls.search).toBe(2);
  });

  it("refreshes the installed list for a launch only when it's over 30 seconds old", async () => {
    await cached.launchSet(a);
    now = 29_000;
    await cached.launchSet(a);
    expect(calls.installs).toBe(1);
    now = 30_001;
    await cached.launchSet(a);
    expect(calls.installs).toBe(2);
  });

  it("refresh() drops the installed list", async () => {
    await cached.snapshot(p);
    cached.refresh();
    await cached.snapshot(p);
    expect(calls.installed).toBe(2);
  });

  it("shares one fetch between callers asking at once", async () => {
    await Promise.all([cached.launchSet(a), cached.launchSet(a), cached.snapshot(p)]);
    expect(calls.installs).toBe(1);
  });

  it("doesn't keep a failed fetch", async () => {
    const orig = source.installs.bind(source);
    source.installs = () => Promise.reject(new Error("CLI broke"));
    await expect(cached.launchSet(a)).rejects.toThrow("CLI broke");
    source.installs = orig;
    await expect(cached.launchSet(a)).resolves.toBeTruthy();
  });

  it("drops switches for plugins no longer installed", async () => {
    store.setPluginSwitch(p, "gone@x", a, true);
    store.setPluginSwitch(p, SP, null, false);
    await cached.snapshot(p);
    expect(store.listPluginSwitches(p)).toEqual([{ pluginId: SP, agentId: null, enabled: false }]);
  });

  it("works out what each squadmate loads and switches off", async () => {
    expect(await cached.launchSet(a)).toEqual({ paths: [], off: [] });
    store.setPluginSwitch(p, BU, null, true);
    store.setPluginSwitch(p, SP, a, false);
    expect(await cached.launchSet(a)).toEqual({ paths: ["/fake/browser-use"], off: [SP] });
    store.setPluginSwitch(p, SP, a, true); // on here and in the terminal: nothing extra
    store.setPluginSwitch(p, BU, a, false); // off here and in the terminal: nothing
    expect(await cached.launchSet(a)).toEqual({ paths: [], off: [] });
  });

  it("compares launch sets by value", async () => {
    const { sameLaunch } = await import("../src/plugins/service.ts");
    expect(sameLaunch({ paths: ["a", "b"], off: [] }, { paths: ["b", "a"], off: [] })).toBe(true);
    expect(sameLaunch({ paths: ["a"], off: [] }, { paths: ["a"], off: ["x"] })).toBe(false);
  });
});
