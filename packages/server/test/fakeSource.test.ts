import { describe, it, expect, beforeEach } from "vitest";
import { FakePluginSource } from "../src/plugins/fakeSource.ts";

let src: FakePluginSource;
beforeEach(() => { src = new FakePluginSource({ delayMs: 0 }); });

describe("FakePluginSource", () => {
  it("starts with a mix of installed plugins and three marketplaces, one of them Anthropic's", async () => {
    const installed = await src.installed();
    expect(installed.length).toBeGreaterThanOrEqual(6);
    expect(installed.some((p) => p.enabled) && installed.some((p) => !p.enabled)).toBe(true);
    expect(installed.map((p) => p.name)).toEqual(expect.arrayContaining(["superpowers", "godot-game-tools", "playwright", "discord"]));
    const markets = await src.marketplaces();
    expect(markets).toHaveLength(3);
    expect(markets.filter((m) => m.official).map((m) => m.name)).toEqual(["claude-plugins-official"]);
  });
  it("ranks name prefix, then name contains, then description contains", async () => {
    const { items } = await src.search("co", null, 50);
    const rank = (i: (typeof items)[number]) => i.name.startsWith("co") ? 0 : i.name.includes("co") ? 1 : 2;
    const ranks = items.map(rank);
    expect(ranks).toEqual([...ranks].sort());
    expect(items.every((i) => (i.name + " " + i.description).toLowerCase().includes("co"))).toBe(true);
  });
  it("caps items at the limit but counts every match", async () => {
    const all = await src.search("", null, 50);
    const two = await src.search("", null, 2);
    expect(two.items).toHaveLength(2);
    expect(two.total).toBe(all.total);
  });
  it("narrows to one marketplace", async () => {
    const { items } = await src.search("", "graeme-godot-tools", 50);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.marketplace === "graeme-godot-tools")).toBe(true);
  });
  it("doesn't offer plugins that are already installed", async () => {
    const installed = new Set((await src.installed()).map((p) => p.id));
    expect((await src.search("", null, 50)).items.some((i) => installed.has(i.id))).toBe(false);
  });
  it("installs a plugin switched off in the terminal, and uninstalls it", async () => {
    const id = (await src.search("", null, 1)).items[0].id;
    await src.install(id);
    expect((await src.installed()).find((p) => p.id === id)).toMatchObject({ enabled: false });
    await src.uninstall(id);
    expect((await src.installed()).some((p) => p.id === id)).toBe(false);
  });
  it("refuses to install a plugin no marketplace has", async () => {
    await expect(src.install("nope@nowhere")).rejects.toThrow("No plugin nope@nowhere in your marketplaces.");
  });
  it("adds a marketplace from a GitHub repo, once", async () => {
    expect(await src.addMarketplace("acme/tools")).toMatchObject({ name: "tools", source: "github", location: "acme/tools", official: false });
    expect((await src.marketplaces()).map((m) => m.name)).toContain("tools");
    await expect(src.addMarketplace("acme/tools")).rejects.toThrow("tools is already added.");
  });
  it("won't remove Anthropic's marketplace, but removes others", async () => {
    await expect(src.removeMarketplace("claude-plugins-official")).rejects.toThrow("The Anthropic marketplace can't be removed.");
    await src.removeMarketplace("graeme-godot-tools");
    expect((await src.marketplaces()).map((m) => m.name)).not.toContain("graeme-godot-tools");
  });
  it("gives details of an installed plugin", async () => {
    const p = (await src.installed())[0];
    expect(await src.details(p.id)).toMatchObject({ id: p.id, inventory: expect.any(Object) });
  });
});
