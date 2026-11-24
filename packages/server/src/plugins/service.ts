import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SQUAD_KIT_ID, effectiveSwitch, marketplaceSourceError,
  type AvailablePlugin, type InstalledPlugin, type Marketplace, type ServerMsg,
} from "@squad/shared";
import type { Store } from "../store.ts";
import type { PluginSource } from "./source.ts";
import { loadPath, type PluginInstall } from "./cliSource.ts";

/** What a squadmate launches with besides squad-kit: plugin folders to load, and plugin ids to switch off. */
export interface LaunchPlugins { paths: string[]; off: string[] }

export function sameLaunch(a: LaunchPlugins, b: LaunchPlugins): boolean {
  const key = (l: LaunchPlugins) => JSON.stringify([[...l.paths].sort(), [...l.off].sort()]);
  return key(a) === key(b);
}

/** Available list: refreshed after this long. */
const AVAILABLE_TTL = 10 * 60_000;
/** Installed list: a launch refreshes it when it's older than this (plugins switched in the terminal). */
const LAUNCH_TTL = 30_000;

/** One cached fetch, shared by callers asking at once; a failed fetch isn't kept. */
class Cache<T> {
  private entry: { at: number; value: Promise<T> } | null = null;
  constructor(private now: () => number) {}
  get(maxAge: number, fetch: () => Promise<T>): Promise<T> {
    if (this.entry && this.now() - this.entry.at <= maxAge) return this.entry.value;
    const entry = { at: this.now(), value: fetch() };
    this.entry = entry;
    entry.value.catch(() => { if (this.entry === entry) this.entry = null; });
    return entry.value;
  }
  clear(): void {
    this.entry = null;
  }
}

export type PluginsSnapshot = Extract<ServerMsg, { t: "plugins" }>;

const REQUIRED = "squad-kit is required by Squad, so it can't be changed.";

/** Squad's own plugin as an installed plugin: always on, and listed so the user can see what every squadmate carries. */
export function kitPlugin(kitPath: string): InstalledPlugin {
  const manifest = JSON.parse(readFileSync(join(kitPath, ".claude-plugin", "plugin.json"), "utf8")) as {
    name: string; version?: string; description?: string;
  };
  let skills = 0;
  try {
    skills = readdirSync(join(kitPath, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).length;
  } catch {}
  return {
    id: SQUAD_KIT_ID, name: manifest.name, marketplace: "squad", version: manifest.version ?? "", required: true,
    description: manifest.description ?? "", enabled: true, inventory: { skills },
  };
}

/**
 * Plugins as the Plugins view sees them: what the source has installed and offers, Squad's own `squad-kit`, and the
 * switches stored per project and squadmate. Every method rejects with a message fit to show the user.
 */
export class PluginService {
  private installedCache: Cache<InstalledPlugin[]>;
  private installsCache: Cache<PluginInstall[]>;
  private marketsCache: Cache<Marketplace[]>;
  private availableCache: Cache<number>;

  constructor(
    private source: PluginSource, private store: Store, private kit: InstalledPlugin, opts: { now?: () => number } = {},
  ) {
    const now = opts.now ?? Date.now;
    this.installedCache = new Cache(now);
    this.installsCache = new Cache(now);
    this.marketsCache = new Cache(now);
    this.availableCache = new Cache(now);
  }

  private installedList(): Promise<InstalledPlugin[]> {
    return this.installedCache.get(Infinity, async () => {
      const list = await this.source.installed();
      this.store.prunePluginSwitches(list.map((p) => p.id));
      return list;
    });
  }

  /** Drops the installed lists, so the next request sees plugins changed in the terminal. */
  refresh(): void {
    this.installedCache.clear();
    this.installsCache.clear();
  }

  /** After anything that changes what's installed or offered. */
  private invalidate(): void {
    this.refresh();
    this.marketsCache.clear();
    this.availableCache.clear();
  }

  /** What a squadmate launches with: on here but not in the terminal → load by path; off here but on there → off. */
  async launchSet(agentId: string): Promise<LaunchPlugins> {
    const agent = this.store.getAgent(agentId);
    if (!agent) throw new Error("That squadmate no longer exists.");
    const rows = await this.installsCache.get(LAUNCH_TTL, () => this.source.installs());
    const switches = this.store.listPluginSwitches(agent.projectId);
    const out: LaunchPlugins = { paths: [], off: [] };
    for (const id of new Set(rows.map((r) => r.id))) {
      if (id === SQUAD_KIT_ID) continue;
      const terminal = rows.some((r) => r.id === id && (r.scope === "user" || r.scope === "synced") && r.enabled);
      const plugin = { id, enabled: terminal } as InstalledPlugin;
      const { on } = effectiveSwitch(plugin, switches, agentId);
      if (on && !terminal) {
        const path = loadPath(rows, id, this.source.squadFolder);
        if (path) out.paths.push(path);
      } else if (!on && terminal) out.off.push(id);
    }
    out.paths.sort();
    out.off.sort();
    return out;
  }

  /** Refuses a project deleted in the meantime (another page), before anything is installed or stored. */
  private requireProject(projectId: string): void {
    if (!this.store.getProject(projectId)) throw new Error("That project no longer exists.");
  }

  async snapshot(projectId: string): Promise<PluginsSnapshot> {
    this.requireProject(projectId);
    const [installed, marketplaces, available] = await Promise.all([
      this.installedList(),
      this.marketsCache.get(AVAILABLE_TTL, () => this.source.marketplaces()),
      this.availableCache.get(AVAILABLE_TTL, async () => (await this.source.search("", null, 0)).total),
    ]);
    return {
      t: "plugins", projectId, installed: [this.kit, ...installed], marketplaces,
      switches: this.store.listPluginSwitches(projectId), available,
    };
  }

  /** `agentId` null: the project default. `enabled` null: back to following the terminal, or the project. */
  async switch(projectId: string, pluginId: string, agentId: string | null, enabled: boolean | null): Promise<void> {
    this.requireProject(projectId);
    if (pluginId === SQUAD_KIT_ID) throw new Error(REQUIRED);
    if (!(await this.installedList()).some((p) => p.id === pluginId)) throw new Error(`${pluginId} isn't installed.`);
    if (agentId !== null && this.store.getAgent(agentId)?.projectId !== projectId) {
      throw new Error("That isn't a squadmate in this project.");
    }
    this.store.setPluginSwitch(projectId, pluginId, agentId, enabled);
  }

  /** Installs, then switches it on for that squadmate, or for the entire squad when `agentId` is null. */
  async install(projectId: string, pluginId: string, agentId: string | null): Promise<void> {
    this.requireProject(projectId);
    if (agentId !== null && this.store.getAgent(agentId)?.projectId !== projectId) {
      throw new Error("That isn't a squadmate in this project.");
    }
    try {
      await this.source.install(pluginId);
    } finally {
      this.invalidate();
    }
    this.store.setPluginSwitch(projectId, pluginId, agentId, true);
  }

  async uninstall(pluginId: string): Promise<void> {
    if (pluginId === SQUAD_KIT_ID) throw new Error(REQUIRED);
    try {
      await this.source.uninstall(pluginId);
    } finally {
      this.invalidate();
    }
    this.store.deletePluginSwitches(pluginId);
  }

  update(pluginId: string): Promise<void> {
    if (pluginId === SQUAD_KIT_ID) return Promise.reject(new Error(REQUIRED));
    return this.source.update(pluginId).finally(() => this.invalidate());
  }

  details(pluginId: string): Promise<InstalledPlugin> {
    return pluginId === SQUAD_KIT_ID ? Promise.resolve(this.kit) : this.source.details(pluginId);
  }

  search(query: string, marketplace: string | null, limit = 50): Promise<{ total: number; items: AvailablePlugin[] }> {
    return this.source.search(query, marketplace, limit);
  }

  addMarketplace(source: string): Promise<Marketplace> {
    const problem = marketplaceSourceError(source);
    return problem ? Promise.reject(new Error(problem)) : this.source.addMarketplace(source.trim()).finally(() => this.invalidate());
  }

  removeMarketplace(name: string): Promise<void> {
    return this.source.removeMarketplace(name).finally(() => this.invalidate());
  }

  updateMarketplace(name: string): Promise<void> {
    return this.source.updateMarketplace(name).finally(() => this.invalidate());
  }
}
