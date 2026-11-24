/** What a plugin contains, as counts. */
export interface PluginInventory { skills?: number; commands?: number; agents?: number; hooks?: number; mcpServers?: number }

/** An installed plugin. `enabled` is its state in the terminal (the user's Claude settings). */
export interface InstalledPlugin {
  id: string; // name@marketplace
  name: string;
  marketplace: string;
  version: string;
  description: string;
  enabled: boolean;
  /** Squad needs it (squad-kit): always on, can't be switched off, updated or uninstalled. */
  required?: boolean;
  /** Roughly how many tokens it adds to a squadmate it's on for, e.g. "≈3.1k". */
  tokens?: string;
  inventory?: PluginInventory;
}

/** A plugin a marketplace offers. */
export interface AvailablePlugin {
  id: string; name: string; marketplace: string; description: string;
  tokens?: string; inventory?: PluginInventory; installs?: number;
}

export interface Marketplace {
  name: string;
  source: "github" | "git" | "url" | "path";
  location: string;
  /** Anthropic's own marketplace: it can't be removed. */
  official: boolean;
  pluginCount: number;
  updatedAt: string;
}

/** A stored switch: the project default when `agentId` is null, else that squadmate's own setting. */
export interface PluginSwitch { pluginId: string; agentId: string | null; enabled: boolean }

/** Where a switch's state comes from. */
export type SwitchSource = "required" | "terminal" | "project" | "own";

/** Squad's own plugin, loaded into every squadmate. */
export const SQUAD_KIT_ID = "squad-kit@squad";

/**
 * Whether a plugin is on for the project (`agentId` null) or one squadmate. A project with nothing stored follows the
 * terminal; a squadmate with nothing stored follows the project.
 */
export function effectiveSwitch(
  plugin: InstalledPlugin, switches: PluginSwitch[], agentId: string | null,
): { on: boolean; source: SwitchSource } {
  if (plugin.required) return { on: true, source: "required" };
  const row = (a: string | null) => switches.find((s) => s.pluginId === plugin.id && s.agentId === a);
  const project = row(null);
  const projectOn = project ? project.enabled : plugin.enabled;
  if (agentId === null) return { on: projectOn, source: project ? "own" : "terminal" };
  const own = row(agentId);
  return own ? { on: own.enabled, source: "own" } : { on: projectOn, source: "project" };
}

const SOURCE_RE = /^[\w.-]+\/[\w.-]+$|^https?:\/\/\S+$|^git@\S+$|^[~./]/;

/** Why a marketplace source can't be used, or null: a GitHub repo (owner/repo), a URL, a git address or a path. */
export function marketplaceSourceError(source: string): string | null {
  const s = source.trim();
  if (!s) return "Enter a GitHub repo, a URL or a path.";
  return SOURCE_RE.test(s) ? null : `"${s}" isn't a GitHub repo (owner/repo), a URL or a path.`;
}
