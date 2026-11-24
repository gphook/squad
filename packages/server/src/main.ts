import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.ts";
import { runClaude } from "./plugins/cli.ts";
import { CliPluginSource } from "./plugins/cliSource.ts";
import { PluginService, kitPlugin } from "./plugins/service.ts";
import { squadHome } from "./paths.ts";
import { PlanUsageTracker } from "./planUsage.ts";
import { ModelCatalog } from "./models.ts";
import { AuthTracker } from "./auth.ts";
import { Store } from "./store.ts";
import { createSignIn } from "./signin/index.ts";
import { openBrowser, parseStartupArgs, startupMessage, startupPlan } from "./signin/startup.ts";
import { Supervisor } from "./supervisor.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const configPath = join(squadHome(), "config.json");
const config: { port?: number } = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const port = Number(process.env.SQUAD_PORT ?? config.port ?? 7340);

const store = new Store(join(squadHome(), "squad.db"));
const supervisor = new Supervisor(store, query, join(repoRoot, "kit"));
const webDist = join(repoRoot, "packages/web/dist");
const startup = parseStartupArgs(process.argv.slice(2), process.env);
const signin = createSignIn(store, { dev: startup.dev });
signin.sessions.startup(signin.dev);
const plan = new PlanUsageTracker({ queryFactory: query, source: () => supervisor.usageSource(), probeCwd: squadHome() });
const auth = new AuthTracker();
supervisor.setAuth(auth);
void auth.refresh();
const models = new ModelCatalog({ queryFactory: query, source: () => supervisor.usageSource(), cwd: squadHome() });
const plugins = new PluginService(new CliPluginSource(runClaude, join(squadHome(), "plugins")), store, kitPlugin(join(repoRoot, "kit")));
supervisor.setPlugins((agentId) => plugins.launchSet(agentId));
const app = buildApp({ store, supervisor, signin, plan, models, auth, plugins, webDist: existsSync(webDist) ? webDist : undefined });

await app.listen({ port, host: "127.0.0.1" });
const startupPlanned = startupPlan(startup, store.listPasskeys().length);
const code = startupPlanned.mintCode ? signin.setup.mint() : null;
const url = `http://localhost:${port}/` + (code ? `setup?code=${code}` : "");
const opened = startupPlanned.open ? await openBrowser(url) : false;
console.log(startupMessage(port, code, opened));
void plan.refresh(); // fill the rings before the first page load asks

const shutdown = async () => {
  plan.dispose();
  await supervisor.stopAll();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
