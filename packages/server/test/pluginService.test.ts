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
