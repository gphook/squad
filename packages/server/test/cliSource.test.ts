import { describe, it, expect } from "vitest";
import { CliPluginSource, loadPath, type PluginInstall } from "../src/plugins/cliSource.ts";
import type { ClaudeRunner } from "../src/plugins/cli.ts";

const SQUAD = "/home/u/.squad/plugins";
const FD = "frontend-design@claude-plugins-official";

const LIST = [
  { id: FD, version: "1.0", scope: "user", enabled: true, installPath: "/c/fd/user", installedAt: "2026-01-01", lastUpdated: "2026-02-01" },
  { id: FD, version: "0.9", scope: "local", enabled: true, installPath: "/c/fd/a", projectPath: "/games/a" },
  { id: FD, version: "0.9", scope: "local", enabled: true, installPath: "/c/fd/b", projectPath: "/games/b" },
  { id: "other@m", version: "2", scope: "local", enabled: true, installPath: "/c/other", projectPath: "/games/a" },
  { id: "design@synced", scope: "synced", enabled: true, installPath: "/c/design" },
];
const AVAILABLE = [
  { pluginId: FD, name: "frontend-design", description: "UI", marketplaceName: "claude-plugins-official" },
  { pluginId: "agent-sdk-dev@claude-plugins-official", name: "agent-sdk-dev", description: "Agent SDK tools", marketplaceName: "claude-plugins-official", installCount: 12 },
  { pluginId: "sdk-helper@anthropic-plugin-directory", name: "sdk-helper", description: "Helps", marketplaceName: "anthropic-plugin-directory" },
  { pluginId: "zeta@claude-plugins-official", name: "zeta", description: "Nothing here", marketplaceName: "claude-plugins-official" },
];
const MARKETS = [
  { name: "claude-plugins-official", source: "github", repo: "anthropics/claude-plugins-official", installLocation: "/nowhere/a" },
  { name: "mine", source: "directory", path: "/home/u/market", installLocation: "/nowhere/b" },
];
const DETAILS = `superpowers 7.0.2
  Description: Superpowers teaches Claude things.
  Source: superpowers@claude-plugins-official

Component inventory
  Skills (15)  brainstorming, writing-plans
  Agents (0)
  Hooks (1)  SessionStart  (harness-only — no model context cost)
  MCP servers (0)
  LSP servers (0)

Projected token cost
  Always-on:   ~848 tok   added to every session
`;

type Call = { args: string[]; cwd?: string; timeoutMs: number };
function fake(outputs: Record<string, string | Error>): { run: ClaudeRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: ClaudeRunner = async (args, opts) => {
    calls.push({ args, ...opts });
    const out = outputs[args.join(" ")];
    if (out === undefined) throw new Error(`unexpected call: ${args.join(" ")}`);
    if (out instanceof Error) throw out;
    return out;
  };
  return { run, calls };
}
const reads = () => ({
  "plugin list --json": JSON.stringify(LIST),
  "plugin list --json --available": JSON.stringify({ installed: LIST, available: AVAILABLE }),
  "plugin marketplace list --json": JSON.stringify(MARKETS),
});

describe("CliPluginSource reading", () => {
  it("lists each plugin once, on in the terminal only at user or synced scope", async () => {
    const src = new CliPluginSource(fake(reads()).run, SQUAD);
    const installed = await src.installed();
    expect(installed.map((p) => p.id)).toEqual([FD, "other@m", "design@synced"]);
    expect(installed[0]).toMatchObject({ name: "frontend-design", marketplace: "claude-plugins-official", version: "1.0", enabled: true });
    expect(installed[1]).toMatchObject({ enabled: false });
    expect(installed[2]).toMatchObject({ enabled: true, marketplace: "synced" });
  });

  it("loads from the user copy, then Squad's folder, then any other", () => {
    const rows: PluginInstall[] = [
      { id: "x@m", scope: "local", enabled: true, installPath: "/other", projectPath: "/games/a", version: "1" },
      { id: "x@m", scope: "local", enabled: true, installPath: "/squad", projectPath: SQUAD, version: "1" },
    ];
    expect(loadPath(rows, "x@m", SQUAD)).toBe("/squad");
    expect(loadPath([...rows, { id: "x@m", scope: "user", enabled: false, installPath: "/user", version: "1" }], "x@m", SQUAD)).toBe("/user");
    expect(loadPath(rows.slice(0, 1), "x@m", SQUAD)).toBe("/other");
    expect(loadPath(rows, "nope@m", SQUAD)).toBeNull();
  });

  it("lists marketplaces, adding ones only the available list names", async () => {
    const markets = await new CliPluginSource(fake(reads()).run, SQUAD).marketplaces();
    expect(markets).toEqual([
      { name: "claude-plugins-official", source: "github", location: "anthropics/claude-plugins-official", official: true, pluginCount: 3, updatedAt: "" },
      { name: "mine", source: "path", location: "/home/u/market", official: false, pluginCount: 0, updatedAt: "" },
      { name: "anthropic-plugin-directory", source: "github", location: "", official: true, pluginCount: 1, updatedAt: "" },
    ]);
  });

  it("searches plugins not installed, by name or description, ignoring case", async () => {
    const src = new CliPluginSource(fake(reads()).run, SQUAD);
    const r = await src.search("SDK", null, 1);
    expect(r.total).toBe(2);
    expect(r.items).toEqual([
      { id: "agent-sdk-dev@claude-plugins-official", name: "agent-sdk-dev", marketplace: "claude-plugins-official", description: "Agent SDK tools", installs: 12 },
    ]);
    expect(await src.search("", null, 0)).toEqual({ total: 3, items: [] });
    expect((await src.search("", "anthropic-plugin-directory", 50)).items.map((p) => p.name)).toEqual(["sdk-helper"]);
  });

  it("reads details from the CLI's text", async () => {
    const list = [{ id: "superpowers@claude-plugins-official", version: "7.0.2", scope: "user", enabled: true, installPath: "/c/sp" }];
    const src = new CliPluginSource(fake({
      "plugin list --json": JSON.stringify(list),
      "plugin details superpowers@claude-plugins-official": DETAILS,
    }).run, SQUAD);
    expect(await src.details("superpowers@claude-plugins-official")).toMatchObject({
      version: "7.0.2", description: "Superpowers teaches Claude things.", tokens: "≈850",
      inventory: { skills: 15, agents: 0, hooks: 1, mcpServers: 0 },
    });
  });

  it("keeps the panel working when the details text can't be read", async () => {
    const list = [{ id: "x@m", version: "3", scope: "user", enabled: true, installPath: "/c/x" }];
    const src = new CliPluginSource(fake({ "plugin list --json": JSON.stringify(list), "plugin details x@m": "???" }).run, SQUAD);
    const d = await src.details("x@m");
    expect(d).toMatchObject({ id: "x@m", version: "3" });
    expect(d.inventory).toBeUndefined();
    expect(d.tokens).toBeUndefined();
  });

  it("passes on the CLI's failure, and refuses output it can't read", async () => {
    await expect(new CliPluginSource(fake({ "plugin list --json": new Error("Not logged in") }).run, SQUAD).installed())
      .rejects.toThrow("Not logged in");
    await expect(new CliPluginSource(fake({ "plugin list --json": "warning: hi" }).run, SQUAD).installed())
      .rejects.toThrow("Claude Code returned something Squad couldn't read.");
  });
});

describe("tokens", () => {
  it("rounds small costs to 50 and large ones to one decimal k", async () => {
    const { formatTokens } = await import("../src/plugins/cliSource.ts");
    expect(formatTokens(848)).toBe("≈850");
    expect(formatTokens(3140)).toBe("≈3.1k");
    expect(formatTokens(20)).toBe("≈50");
  });
});

describe("CliPluginSource actions", () => {
  const ok = (cmd: string) => JSON.stringify({ command: cmd, outcome: "ok", message: "done" });
  const rows = [
    { id: FD, version: "1", scope: "user", enabled: true, installPath: "/u" },
    { id: FD, version: "1", scope: "local", enabled: true, installPath: "/s", projectPath: SQUAD },
    { id: FD, version: "1", scope: "local", enabled: true, installPath: "/o", projectPath: "/games/a" },
    { id: "elsewhere@m", version: "1", scope: "project", enabled: true, installPath: "/e", projectPath: "/games/b" },
    { id: "design@synced", scope: "synced", enabled: true, installPath: "/d" },
  ];
  const actions = (extra: Record<string, string | Error> = {}) =>
    fake({ "plugin list --json": JSON.stringify(rows), "plugin marketplace list --json": JSON.stringify(MARKETS),
      "plugin list --json --available": JSON.stringify({ installed: rows, available: AVAILABLE }), ...extra });

  it("installs at local scope from Squad's folder, creating it, without -y", async () => {
    const { mkdtempSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const folder = join(mkdtempSync(join(tmpdir(), "squad-cli-")), "plugins");
    const f = fake({ [`plugin install ${FD} --scope local --json`]: ok("install") });
    await new CliPluginSource(f.run, folder).install(FD);
    expect(f.calls).toEqual([{ args: ["plugin", "install", FD, "--scope", "local", "--json"], cwd: folder, timeoutMs: 60_000 }]);
    expect(existsSync(folder)).toBe(true);
  });

  it("rejects with the CLI's message when the result isn't ok", async () => {
    const f = fake({ [`plugin install ${FD} --scope local --json`]: JSON.stringify({ outcome: "error", message: "Run it from the terminal" }) });
    await expect(new CliPluginSource(f.run, "/tmp").install(FD)).rejects.toThrow("Run it from the terminal");
  });

  it("uninstalls from the user scope and Squad's folder, leaving other folders alone", async () => {
    const f = actions({
      [`plugin uninstall ${FD} --scope user --json`]: ok("uninstall"),
      [`plugin uninstall ${FD} --scope local --json`]: ok("uninstall"),
    });
    await new CliPluginSource(f.run, SQUAD).uninstall(FD);
    const changes = f.calls.filter((c) => c.args[1] === "uninstall");
    expect(changes).toEqual([
      { args: ["plugin", "uninstall", FD, "--scope", "user", "--json"], timeoutMs: 20_000 },
      { args: ["plugin", "uninstall", FD, "--scope", "local", "--json"], cwd: SQUAD, timeoutMs: 20_000 },
    ]);
  });

  it("won't uninstall or update a plugin installed only in another folder", async () => {
    const f = actions();
    const src = new CliPluginSource(f.run, SQUAD);
    await expect(src.uninstall("elsewhere@m")).rejects.toThrow("elsewhere@m is installed only in /games/b; uninstall it there.");
    await expect(src.update("elsewhere@m")).rejects.toThrow("elsewhere@m is installed only in /games/b; update it there.");
    expect(f.calls.every((c) => c.args[1] === "list")).toBe(true);
  });

  it("won't touch claude.ai's plugins", async () => {
    const f = actions();
    const src = new CliPluginSource(f.run, SQUAD);
    await expect(src.uninstall("design@synced")).rejects.toThrow("Managed by claude.ai.");
    await expect(src.update("design@synced")).rejects.toThrow("Managed by claude.ai.");
    expect(f.calls.every((c) => c.args[1] === "list")).toBe(true);
  });

  it("updates each scope Squad may change", async () => {
    const f = actions({
      [`plugin update ${FD} --scope user --json`]: ok("update"),
      [`plugin update ${FD} --scope local --json`]: ok("update"),
    });
    await new CliPluginSource(f.run, SQUAD).update(FD);
    expect(f.calls.filter((c) => c.args[1] === "update")).toEqual([
      { args: ["plugin", "update", FD, "--scope", "user", "--json"], timeoutMs: 60_000 },
      { args: ["plugin", "update", FD, "--scope", "local", "--json"], cwd: SQUAD, timeoutMs: 60_000 },
    ]);
  });

  it("adds, removes and updates marketplaces", async () => {
    MARKETS.push({ name: "owner-mine", source: "github", repo: "owner/mine", installLocation: "/x" });
    const f = actions({
      "plugin marketplace add owner/mine --json": ok("marketplace add"),
      "plugin marketplace remove mine --json": ok("marketplace remove"),
      "plugin marketplace update mine --json": ok("marketplace update"),
    });
    const src = new CliPluginSource(f.run, SQUAD);
    try {
      expect(await src.addMarketplace("owner/mine")).toMatchObject({ name: "owner-mine", location: "owner/mine" });
    } finally {
      MARKETS.pop();
    }
    await src.removeMarketplace("mine");
    await src.updateMarketplace("mine");
    const timeouts = Object.fromEntries(f.calls.filter((c) => c.args[1] === "marketplace" && c.args[2] !== "list")
      .map((c) => [c.args[2], c.timeoutMs]));
    expect(timeouts).toEqual({ add: 60_000, remove: 20_000, update: 60_000 });
  });
});
