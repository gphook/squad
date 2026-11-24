import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SQUAD_KIT_ID, marketplaceSourceError,
  type AvailablePlugin, type InstalledPlugin, type Marketplace, type ServerMsg,
} from "@squad/shared";
import type { Store } from "../store.ts";
import type { PluginSource } from "./source.ts";

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
  constructor(private source: PluginSource, private store: Store, private kit: InstalledPlugin) {}

  async snapshot(projectId: string): Promise<PluginsSnapshot> {
    const [installed, marketplaces, all] = await Promise.all([
      this.source.installed(), this.source.marketplaces(), this.source.search("", null, 0),
    ]);
    return {
      t: "plugins", projectId, installed: [this.kit, ...installed], marketplaces,
      switches: this.store.listPluginSwitches(projectId), available: all.total,
    };
  }

  /** `agentId` null: the project default. `enabled` null: back to following the terminal, or the project. */
  async switch(projectId: string, pluginId: string, agentId: string | null, enabled: boolean | null): Promise<void> {
    if (pluginId === SQUAD_KIT_ID) throw new Error(REQUIRED);
    if (!(await this.source.installed()).some((p) => p.id === pluginId)) throw new Error(`${pluginId} isn't installed.`);
    if (agentId !== null && this.store.getAgent(agentId)?.projectId !== projectId) {
      throw new Error("That isn't a squadmate in this project.");
    }
    this.store.setPluginSwitch(projectId, pluginId, agentId, enabled);
  }

  /** Installs, then switches it on for that squadmate, or for the entire squad when `agentId` is null. */
  async install(projectId: string, pluginId: string, agentId: string | null): Promise<void> {
    if (agentId !== null && this.store.getAgent(agentId)?.projectId !== projectId) {
      throw new Error("That isn't a squadmate in this project.");
    }
    await this.source.install(pluginId);
    this.store.setPluginSwitch(projectId, pluginId, agentId, true);
  }

  async uninstall(pluginId: string): Promise<void> {
    if (pluginId === SQUAD_KIT_ID) throw new Error(REQUIRED);
    await this.source.uninstall(pluginId);
    this.store.deletePluginSwitches(pluginId);
  }

  update(pluginId: string): Promise<void> {
    if (pluginId === SQUAD_KIT_ID) return Promise.reject(new Error(REQUIRED));
    return this.source.update(pluginId);
  }

  details(pluginId: string): Promise<InstalledPlugin> {
    return pluginId === SQUAD_KIT_ID ? Promise.resolve(this.kit) : this.source.details(pluginId);
  }

  search(query: string, marketplace: string | null, limit = 50): Promise<{ total: number; items: AvailablePlugin[] }> {
    return this.source.search(query, marketplace, limit);
  }

  addMarketplace(source: string): Promise<Marketplace> {
    const problem = marketplaceSourceError(source);
    return problem ? Promise.reject(new Error(problem)) : this.source.addMarketplace(source.trim());
  }

  removeMarketplace(name: string): Promise<void> {
    return this.source.removeMarketplace(name);
  }

  updateMarketplace(name: string): Promise<void> {
    return this.source.updateMarketplace(name);
  }
}
