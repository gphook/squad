import { describe, it, expect } from "vitest";
import { effectiveSwitch, marketplaceSourceError, type InstalledPlugin, type PluginSwitch } from "../src/plugins.ts";

const plugin = (enabled: boolean, required = false): InstalledPlugin =>
  ({ id: "p@m", name: "p", marketplace: "m", version: "1", description: "", enabled, ...(required ? { required } : {}) });
const sw = (agentId: string | null, enabled: boolean, pluginId = "p@m"): PluginSwitch => ({ pluginId, agentId, enabled });

describe("effectiveSwitch", () => {
  it("is always on for a required plugin, whatever is stored", () => {
    expect(effectiveSwitch(plugin(false, true), [sw(null, false), sw("a", false)], "a")).toEqual({ on: true, source: "required" });
  });
  it("follows the terminal for a project with nothing stored", () => {
    expect(effectiveSwitch(plugin(true), [], null)).toEqual({ on: true, source: "terminal" });
    expect(effectiveSwitch(plugin(false), [], null)).toEqual({ on: false, source: "terminal" });
  });
  it("uses the project's own setting once stored", () => {
    expect(effectiveSwitch(plugin(true), [sw(null, false)], null)).toEqual({ on: false, source: "own" });
  });
  it("has a squadmate with nothing stored follow the project", () => {
    expect(effectiveSwitch(plugin(true), [sw(null, false)], "a")).toEqual({ on: false, source: "project" });
    expect(effectiveSwitch(plugin(true), [], "a")).toEqual({ on: true, source: "project" });
  });
  it("uses a squadmate's own setting, and ignores another squadmate's and another plugin's", () => {
    expect(effectiveSwitch(plugin(false), [sw("a", true)], "a")).toEqual({ on: true, source: "own" });
    expect(effectiveSwitch(plugin(false), [sw("b", true), sw("a", true, "q@m")], "a")).toEqual({ on: false, source: "project" });
  });
});

describe("marketplaceSourceError", () => {
  it("accepts a GitHub repo, a URL, a git address or a path", () => {
    for (const s of ["acme/plugins", "https://x.dev/marketplace.json", "git@github.com:a/b.git", "~/dev/p", "./p", "/abs"]) {
      expect(marketplaceSourceError(s)).toBeNull();
    }
  });
  it("asks for something when empty", () => {
    expect(marketplaceSourceError("  ")).toBe("Enter a GitHub repo, a URL or a path.");
  });
  it("names what it got when it's none of those", () => {
    expect(marketplaceSourceError("hello")).toBe('"hello" isn\'t a GitHub repo (owner/repo), a URL or a path.');
  });
});
