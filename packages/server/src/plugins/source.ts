import type { AvailablePlugin, InstalledPlugin, Marketplace } from "@squad/shared";

/**
 * Where plugins and marketplaces come from. `FakePluginSource` serves made-up data; the real one (a later pass)
 * runs the `claude plugin` CLI. Ids are `name@marketplace`. Every method rejects with a message fit to show the user.
 */
export interface PluginSource {
  installed(): Promise<InstalledPlugin[]>;
  marketplaces(): Promise<Marketplace[]>;
  /** Plugins not yet installed whose name or description contains `query`; `total` counts all matches. */
  search(query: string, marketplace: string | null, limit: number): Promise<{ total: number; items: AvailablePlugin[] }>;
  details(id: string): Promise<InstalledPlugin>;
  install(id: string): Promise<void>;
  uninstall(id: string): Promise<void>;
  update(id: string): Promise<void>;
  addMarketplace(source: string): Promise<Marketplace>;
  removeMarketplace(name: string): Promise<void>;
  updateMarketplace(name: string): Promise<void>;
}
