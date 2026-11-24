import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AvailablePlugin, InstalledPlugin, Marketplace } from "@squad/shared";
import type { PluginSource } from "./source.ts";
import type { PluginInstall } from "./cliSource.ts";

type Fixture = { installed: InstalledPlugin[]; available: AvailablePlugin[]; marketplaces: Omit<Marketplace, "pluginCount">[] };

/** A marketplace added at runtime gets this many made-up plugins, so Discover shows something for it. */
const ADDED_PLUGINS = 3;

/**
 * Made-up plugins and marketplaces, kept in memory: actions change them until Squad restarts. Each call waits
 * `delayMs` (300 by default) so the UI's busy states show.
 */
export class FakePluginSource implements PluginSource {
  private installedList: InstalledPlugin[];
  private availableList: AvailablePlugin[];
  private markets: Omit<Marketplace, "pluginCount">[];
  private delayMs: number;

  constructor(opts: { delayMs?: number } = {}) {
    const f = JSON.parse(readFileSync(join(import.meta.dirname, "fake-plugins.json"), "utf8")) as Fixture;
    this.installedList = f.installed;
    this.availableList = f.available;
    this.markets = f.marketplaces;
    this.delayMs = opts.delayMs ?? 300;
  }

  private wait(): Promise<void> {
    return this.delayMs ? new Promise((r) => setTimeout(r, this.delayMs)) : Promise.resolve();
  }

  readonly squadFolder = "/fake/squad";

  async installs(): Promise<PluginInstall[]> {
    await this.wait();
    return this.installedList.map((p) => ({
      id: p.id, scope: "user", enabled: p.enabled, installPath: `/fake/${p.name}`, version: p.version,
    }));
  }

  async installed(): Promise<InstalledPlugin[]> {
    await this.wait();
    return this.installedList.map((p) => ({ ...p }));
  }

  async marketplaces(): Promise<Marketplace[]> {
    await this.wait();
    const count = (m: string) =>
      this.availableList.filter((p) => p.marketplace === m).length + this.installedList.filter((p) => p.marketplace === m).length;
    return this.markets.map((m) => ({ ...m, pluginCount: count(m.name) }));
  }

  async search(query: string, marketplace: string | null, limit: number): Promise<{ total: number; items: AvailablePlugin[] }> {
    await this.wait();
    const q = query.trim().toLowerCase();
    const rank = (p: AvailablePlugin) => {
      const name = p.name.toLowerCase();
      if (name.startsWith(q)) return 0;
      if (name.includes(q)) return 1;
      return p.description.toLowerCase().includes(q) ? 2 : -1;
    };
    const matches = this.availableList
      .filter((p) => marketplace === null || p.marketplace === marketplace)
      .map((p) => ({ p, r: rank(p) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name))
      .map((x) => x.p);
    return { total: matches.length, items: matches.slice(0, limit) };
  }

  async details(id: string): Promise<InstalledPlugin> {
    await this.wait();
    const p = this.installedList.find((x) => x.id === id);
    if (!p) throw new Error(`${id} isn't installed.`);
    return { ...p, inventory: p.inventory ?? {} };
  }

  async install(id: string): Promise<void> {
    await this.wait();
    const p = this.availableList.find((x) => x.id === id);
    if (!p) throw new Error(`No plugin ${id} in your marketplaces.`);
    this.availableList = this.availableList.filter((x) => x.id !== id);
    // As the CLI would, but Squad's own switches decide where it's on; the terminal keeps it off.
    this.installedList.push({
      id: p.id, name: p.name, marketplace: p.marketplace, version: "1.0.0", description: p.description, enabled: false,
      ...(p.tokens ? { tokens: p.tokens } : {}), ...(p.inventory ? { inventory: p.inventory } : {}),
    });
  }

  async uninstall(id: string): Promise<void> {
    await this.wait();
    const p = this.installedList.find((x) => x.id === id);
    if (!p) throw new Error(`${id} isn't installed.`);
    this.installedList = this.installedList.filter((x) => x.id !== id);
    this.availableList.push({ id: p.id, name: p.name, marketplace: p.marketplace, description: p.description,
      ...(p.tokens ? { tokens: p.tokens } : {}), ...(p.inventory ? { inventory: p.inventory } : {}) });
  }

  async update(id: string): Promise<void> {
    await this.wait();
    if (!this.installedList.some((x) => x.id === id)) throw new Error(`${id} isn't installed.`);
  }

  async addMarketplace(source: string): Promise<Marketplace> {
    await this.wait();
    const s = source.trim();
    const kind: Marketplace["source"] = /^https?:/.test(s) ? "url" : /^git@/.test(s) ? "git" : /^[~./]/.test(s) ? "path" : "github";
    const name = s.replace(/\.git$|\/marketplace\.json$|\.json$/, "").split(/[/:]/).filter(Boolean).pop()!;
    if (this.markets.some((m) => m.name === name)) throw new Error(`${name} is already added.`);
    const m = { name, source: kind, location: s, official: false, updatedAt: new Date().toISOString() };
    this.markets.push(m);
    for (let i = 1; i <= ADDED_PLUGINS; i++) {
      this.availableList.push({ id: `${name}-plugin-${i}@${name}`, name: `${name}-plugin-${i}`, marketplace: name,
        description: `A made-up plugin from ${name}.`, tokens: "≈200", inventory: { skills: 1 } });
    }
    return { ...m, pluginCount: ADDED_PLUGINS };
  }

  async removeMarketplace(name: string): Promise<void> {
    await this.wait();
    const m = this.markets.find((x) => x.name === name);
    if (!m) throw new Error(`No marketplace named ${name}.`);
    if (m.official) throw new Error("The Anthropic marketplace can't be removed.");
    this.markets = this.markets.filter((x) => x.name !== name);
    // Its installed plugins stay until uninstalled, as in Claude Code.
    this.availableList = this.availableList.filter((p) => p.marketplace !== name);
  }

  async updateMarketplace(name: string): Promise<void> {
    await this.wait();
    const m = this.markets.find((x) => x.name === name);
    if (!m) throw new Error(`No marketplace named ${name}.`);
    m.updatedAt = new Date().toISOString();
  }
}
