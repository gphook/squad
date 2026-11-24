import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.ts";
import { FakePluginSource } from "./plugins/fakeSource.ts";
import { PluginService, kitPlugin } from "./plugins/service.ts";
import { squadHome } from "./paths.ts";
import { PlanUsageTracker } from "./planUsage.ts";
import { ModelCatalog } from "./models.ts";
import { AuthTracker } from "./auth.ts";
import { Store } from "./store.ts";
import { Supervisor } from "./supervisor.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const configPath = join(squadHome(), "config.json");
const config: { port?: number } = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const port = Number(process.env.SQUAD_PORT ?? config.port ?? 7340);

const store = new Store(join(squadHome(), "squad.db"));
const supervisor = new Supervisor(store, query, join(repoRoot, "kit"));
const webDist = join(repoRoot, "packages/web/dist");
const key = process.env.SQUAD_KEY ?? randomBytes(32).toString("hex");
const plan = new PlanUsageTracker({ queryFactory: query, source: () => supervisor.usageSource(), probeCwd: squadHome() });
const auth = new AuthTracker();
supervisor.setAuth(auth);
void auth.refresh();
const models = new ModelCatalog({ queryFactory: query, source: () => supervisor.usageSource(), cwd: squadHome() });
// Made-up plugins until the next pass wires in the `claude plugin` CLI.
const plugins = new PluginService(new FakePluginSource(), store, kitPlugin(join(repoRoot, "kit")));
const app = buildApp({ store, supervisor, key, plan, models, auth, plugins, webDist: existsSync(webDist) ? webDist : undefined });

await app.listen({ port, host: "127.0.0.1" });
console.log(`Squad: http://localhost:${port}/?key=${key}`);
void plan.refresh(); // fill the rings before the first page load asks

const shutdown = async () => {
  plan.dispose();
  await supervisor.stopAll();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
