/**
 * Captures real SDK usage data into test/fixtures/usage-messages.json. Re-run after an SDK upgrade:
 *   npx tsx packages/server/scripts/usage-probe.ts
 * Spends a few tokens on three one-word prompts.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsyncQueue } from "../src/inputQueue.ts";

const cwd = mkdtempSync(join(tmpdir(), "squad-usage-probe-"));
const out = join(import.meta.dirname, "../test/fixtures/usage-messages.json");
const ask = (text: string) =>
  ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: "" }) as SDKUserMessage;

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms))]);

const opts = { cwd, settingSources: [], allowedTools: [], permissionMode: "default" as const };

async function session(prompts: string[], resume?: string, measureFirst = false) {
  const input = new AsyncQueue<SDKUserMessage>();
  const q: Query = query({ prompt: input, options: { ...opts, ...(resume ? { resume } : {}) } });
  let usage: unknown;
  let usageMs: number | undefined;
  if (measureFirst) {
    const t = Date.now();
    usage = await withTimeout(q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }), 20_000);
    usageMs = Date.now() - t;
  }
  const results: any[] = [];
  const rateLimitEvents: any[] = [];
  let sessionId = "";
  let i = 0;
  input.push(ask(prompts[i++]));
  for await (const m of q as AsyncIterable<any>) {
    if (m.type === "system" && m.subtype === "init") sessionId = m.session_id;
    if (m.type === "rate_limit_event") rateLimitEvents.push(m);
    if (m.type === "result") {
      results.push(m);
      if (i < prompts.length) input.push(ask(prompts[i++]));
      else { input.end(); q.close(); break; }
    }
  }
  return { usage, usageMs, results, rateLimitEvents, sessionId };
}

const first = await session(["Reply with the word ok", "Reply with the word yes, then count to twenty"], undefined, true);
const resumed = await session(["Reply with the word done"], first.sessionId);

const pick = (r: any) => ({
  type: r.type, subtype: r.subtype, num_turns: r.num_turns, total_cost_usd: r.total_cost_usd, usage: r.usage, modelUsage: r.modelUsage,
});
writeFileSync(out, JSON.stringify({
  usageMs: first.usageMs,
  usage: first.usage,
  results: first.results.map(pick),
  resumedResult: pick(resumed.results[0]),
  rateLimitEvents: [...first.rateLimitEvents, ...resumed.rateLimitEvents].map((e) => ({ type: e.type, rate_limit_info: e.rate_limit_info })),
}, null, 2) + "\n");
console.log(`wrote ${out}`);
