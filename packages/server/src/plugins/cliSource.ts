import { statSync } from "node:fs";
import type { AvailablePlugin, InstalledPlugin, Marketplace, PluginInventory } from "@squad/shared";
import type { ClaudeRunner } from "./cli.ts";
import type { PluginSource } from "./source.ts";

/** One row of `claude plugin list --json`: a plugin can be installed at several scopes. */
export interface PluginInstall {
  id: string;
  scope: "user" | "local" | "project" | "synced";
  enabled: boolean;
  installPath: string;
  projectPath?: string;
  version: string;
}

type RawInstall = PluginInstall & { installedAt?: string; lastUpdated?: string };
type RawAvailable = { pluginId: string; name: string; description?: string; marketplaceName: string; installCount?: number };
type RawMarket = { name: string; source: string; repo?: string; url?: string; path?: string; installLocation?: string };

const SHORT = 20_000;
const OFFICIAL = "claude-plugins-official";
const UNREADABLE = "Claude Code returned something Squad couldn't read.";

const nameOf = (id: string) => (id.lastIndexOf("@") > 0 ? id.slice(0, id.lastIndexOf("@")) : id);
const marketOf = (id: string) => (id.lastIndexOf("@") > 0 ? id.slice(id.lastIndexOf("@") + 1) : "");

/** Where a squadmate loads a plugin from: the user copy, then Squad's own install, then any other. */
export function loadPath(installs: PluginInstall[], id: string, squadFolder: string): string | null {
  const rows = installs.filter((r) => r.id === id);
  const pick = rows.find((r) => r.scope === "user")
    ?? rows.find((r) => r.scope === "local" && r.projectPath === squadFolder)
    ?? rows[0];
  return pick?.installPath ?? null;
}

/** A token count as the Plugins view shows it: "≈850", "≈3.1k". */
export function formatTokens(n: number): string {
  if (n < 1000) return `≈${Math.max(50, Math.round(n / 50) * 50)}`;
  return `≈${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(UNREADABLE);
  }
}

/** Plugins and marketplaces from the `claude plugin` CLI. */
export class CliPluginSource implements PluginSource {
  constructor(private run: ClaudeRunner, readonly squadFolder: string) {}

  async installs(): Promise<PluginInstall[]> {
    const rows = parseJson<RawInstall[]>(await this.run(["plugin", "list", "--json"], { timeoutMs: SHORT }));
    if (!Array.isArray(rows)) throw new Error(UNREADABLE);
    return rows.map((r) => ({ ...r, version: r.version ?? "" }));
  }

  async installed(): Promise<InstalledPlugin[]> {
    // Descriptions come from the marketplaces; a plugin without one (or a failed fetch) just has none.
    const [rows, available] = await Promise.all([this.installs(), this.available().catch(() => [] as RawAvailable[])]);
    const ids = [...new Set(rows.map((r) => r.id))];
    return ids.map((id) => {
      const mine = rows.filter((r) => r.id === id);
      const main = mine.find((r) => r.scope === "user") ?? mine[0];
      return {
        id, name: nameOf(id), marketplace: marketOf(id), version: main.version,
        description: available.find((p) => p.pluginId === id)?.description ?? "",
        enabled: mine.some((r) => (r.scope === "user" || r.scope === "synced") && r.enabled),
      };
    });
  }

  private async available(): Promise<RawAvailable[]> {
    const r = parseJson<{ available?: RawAvailable[] }>(
      await this.run(["plugin", "list", "--json", "--available"], { timeoutMs: SHORT }),
    );
    if (!Array.isArray(r?.available)) throw new Error(UNREADABLE);
    return r.available;
  }

  async marketplaces(): Promise<Marketplace[]> {
    const [raw, available] = await Promise.all([
      this.run(["plugin", "marketplace", "list", "--json"], { timeoutMs: SHORT }).then((t) => parseJson<RawMarket[]>(t)),
      this.available(),
    ]);
    const count = (name: string) => available.filter((p) => p.marketplaceName === name).length;
    const listed: Marketplace[] = raw.map((m) => ({
      name: m.name,
      source: m.source === "github" ? "github" : m.source === "git" ? "git" : m.source === "url" ? "url" : "path",
      location: m.repo ?? m.url ?? m.path ?? "",
      official: m.name === OFFICIAL,
      pluginCount: count(m.name),
      updatedAt: mtime(m.installLocation),
    }));
    const extra = [...new Set(available.map((p) => p.marketplaceName))].filter((n) => !raw.some((m) => m.name === n));
    return [...listed, ...extra.map((name) => ({
      name, source: "github" as const, location: "", official: true, pluginCount: count(name), updatedAt: "",
    }))];
  }

  async search(query: string, marketplace: string | null, limit: number): Promise<{ total: number; items: AvailablePlugin[] }> {
    const [rows, available] = await Promise.all([this.installs(), this.available()]);
    const installed = new Set(rows.map((r) => r.id));
    const q = query.trim().toLowerCase();
    const matches = available.filter((p) =>
      !installed.has(p.pluginId)
      && (marketplace === null || p.marketplaceName === marketplace)
      && (!q || p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q)));
    return {
      total: matches.length,
      items: matches.slice(0, limit).map((p) => ({
        id: p.pluginId, name: p.name, marketplace: p.marketplaceName, description: p.description ?? "",
        ...(p.installCount !== undefined ? { installs: p.installCount } : {}),
      })),
    };
  }

  async details(id: string): Promise<InstalledPlugin> {
    const plugin = (await this.installed()).find((p) => p.id === id);
    if (!plugin) throw new Error(`${id} isn't installed.`);
    const text = await this.run(["plugin", "details", id], { timeoutMs: SHORT });
    return { ...plugin, ...parseDetails(text) };
  }

  install(_id: string): Promise<void> { return Promise.reject(new Error("not yet")); }
  uninstall(_id: string): Promise<void> { return Promise.reject(new Error("not yet")); }
  update(_id: string): Promise<void> { return Promise.reject(new Error("not yet")); }
  addMarketplace(_source: string): Promise<Marketplace> { return Promise.reject(new Error("not yet")); }
  removeMarketplace(_name: string): Promise<void> { return Promise.reject(new Error("not yet")); }
  updateMarketplace(_name: string): Promise<void> { return Promise.reject(new Error("not yet")); }
}

function mtime(path: string | undefined): string {
  if (!path) return "";
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return "";
  }
}

const INVENTORY: [RegExp, keyof PluginInventory][] = [
  [/^\s*Skills \((\d+)\)/m, "skills"], [/^\s*Commands \((\d+)\)/m, "commands"], [/^\s*Agents \((\d+)\)/m, "agents"],
  [/^\s*Hooks \((\d+)\)/m, "hooks"], [/^\s*MCP servers \((\d+)\)/m, "mcpServers"],
];

/** What `claude plugin details` prints, as plugin fields; anything it can't find is left out. */
export function parseDetails(text: string): Partial<InstalledPlugin> {
  const out: Partial<InstalledPlugin> = {};
  const version = /^\S+ (\S+)\s*$/m.exec(text.split("\n")[0] ?? "");
  if (version && /\d/.test(version[1])) out.version = version[1];
  const desc = /^\s*Description: (.+)$/m.exec(text);
  if (desc) out.description = desc[1].trim();
  const inventory: PluginInventory = {};
  for (const [re, key] of INVENTORY) {
    const m = re.exec(text);
    if (m) inventory[key] = Number(m[1]);
  }
  if (Object.keys(inventory).length) out.inventory = inventory;
  const tok = /Always-on:\s*~?([\d.]+)(k?)\s*tok/.exec(text);
  if (tok) out.tokens = formatTokens(Number(tok[1]) * (tok[2] ? 1000 : 1));
  return out;
}
