import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "./app.ts";
import { runClaude } from "./plugins/cli.ts";
import { CliPluginSource } from "./plugins/cliSource.ts";
import { PluginService, kitPlugin } from "./plugins/service.ts";
import { appPaths, appVersion, squadHome } from "./paths.ts";
import { helpText, nodeTooOld, parseCli } from "./cli.ts";
import { listenOrExplain } from "./listen.ts";
import { UpdateNotice, checkForUpdate, updateMessage } from "./updateCheck.ts";
import { PlanUsageTracker } from "./planUsage.ts";
import { ModelCatalog } from "./models.ts";
import { AuthTracker } from "./auth.ts";
import { ClaudeLogin } from "./claudeLogin.ts";
import { Store } from "./store.ts";
import { createSignIn } from "./signin/index.ts";
import { appBaseUrl, openBrowser, parseStartupArgs, startupMessage, startupPlan, startupUrl } from "./signin/startup.ts";
import { Supervisor } from "./supervisor.ts";

if (nodeTooOld(process.versions.node)) {
  console.error(`Squad needs Node 24 or later (you have ${process.versions.node}).`);
  process.exit(1);
}

const paths = appPaths();
const version = appVersion(paths);
const configPath = join(squadHome(), "config.json");
const config: { port?: number } = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const cli = parseCli(process.argv.slice(2), process.env, config.port);
if (cli.help) {
  console.log(helpText(version));
  process.exit(0);
}
if (cli.version) {
  console.log(version);
  process.exit(0);
}
if (cli.unknown.length) {
  console.error(`Squad: unknown or invalid option ${cli.unknown[0]}. Run squad --help.`);
  process.exit(2);
}
const port = cli.port;

const store = new Store(join(squadHome(), "squad.db"));
const supervisor = new Supervisor(store, query, paths.kit);
const webDist = paths.web;
const startup = parseStartupArgs(process.argv.slice(2), process.env);
const signin = createSignIn(store, { dev: startup.dev });
const plan = new PlanUsageTracker({ queryFactory: query, source: () => supervisor.usageSource(), probeCwd: squadHome() });
const auth = new AuthTracker();
supervisor.setAuth(auth);
const login = new ClaudeLogin({ finished: () => auth.refresh() });
const models = new ModelCatalog({ queryFactory: query, source: () => supervisor.usageSource(), cwd: squadHome() });
const plugins = new PluginService(new CliPluginSource(runClaude, join(squadHome(), "plugins")), store, kitPlugin(paths.kit));
supervisor.setPlugins((agentId) => plugins.launchSet(agentId));
const update = new UpdateNotice();
const app = buildApp({ store, supervisor, signin, plan, models, auth, login, plugins, update, webDist: existsSync(webDist) ? webDist : undefined });

if (!(await listenOrExplain(() => app.listen({ port, host: "127.0.0.1" }), port, (s) => console.error(s)))) {
  await supervisor.stopAll();
  process.exit(1);
}
// Only once this process owns the port: a second Squad started by mistake must not sign anyone out of the first.
signin.sessions.startup(signin.dev);
void auth.refresh();
const startupAction = startupPlan(startup, store.listPasskeys().length);
const code = startupAction.mintCode ? signin.setup.mint() : null;
const base = appBaseUrl(port, startup.dev);
const opened = startupAction.open ? await openBrowser(startupUrl(base, code)) : false;
console.log(startupMessage(base, code, opened));
// Packaged builds only (a clone updates with git), never in dev, and opt-out: the one request Squad makes on its own.
if (process.env.SQUAD_PACKAGED === "1" && !startup.dev && process.env.SQUAD_NO_UPDATE_CHECK !== "1") {
  void checkForUpdate(version).then((latest) => {
    if (!latest) return;
    console.log(updateMessage(latest, version));
    update.set({ latest, current: version });
  });
}
void plan.refresh(); // fill the rings before the first page load asks

const shutdown = async () => {
  plan.dispose();
  await supervisor.stopAll();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
