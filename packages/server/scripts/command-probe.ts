/**
 * Captures how real sessions stream slash commands into test/fixtures/command-messages.json. Re-run after an SDK
 * upgrade:
 *   npx tsx packages/server/scripts/command-probe.ts
 * Each command runs in its own fresh session; local commands spend no tokens.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsyncQueue } from "../src/inputQueue.ts";

const COMMANDS = ["/context", "/cost", "/doctor", "/permissions", "/agents", "/memory", "/login", "/config", "/model", "/clear"];
const TIMEOUT_MS = 20_000;
const out = join(import.meta.dirname, "../test/fixtures/command-messages.json");
const ask = (text: string) =>
  ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: "" }) as SDKUserMessage;

/** The transcript lines a session wrote, found by session id under ~/.claude/projects. */
function transcript(sessionId: string): unknown[] {
  const root = join(homedir(), ".claude", "projects");
  for (const dir of readdirSync(root)) {
    const f = join(root, dir, `${sessionId}.jsonl`);
    if (existsSync(f)) return readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  }
  return [];
}

async function run(command: string) {
  const cwd = mkdtempSync(join(tmpdir(), "squad-command-probe-"));
  const input = new AsyncQueue<SDKUserMessage>();
  const q = query({ prompt: input, options: { cwd, settingSources: [], allowedTools: [], permissionMode: "default" } });
  const init = (await q.initializationResult()) as { commands?: unknown[] };
  const messages: unknown[] = [];
  let sessionId = "";
  let gotResult = false;
  const t = Date.now();
  input.push(ask(command));
  const timer = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), TIMEOUT_MS));
  const iter = (q as AsyncIterable<any>)[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await Promise.race([iter.next(), timer]);
      if (next === "timeout" || next.done) break;
      const m = next.value;
      if (m.type === "stream_event") continue;
      messages.push(m);
      if (m.session_id) sessionId = m.session_id;
      if (m.type === "result") { gotResult = true; break; }
    }
  } catch (e) {
    messages.push({ probeError: String(e) });
  }
  const ms = Date.now() - t;
  input.end();
  q.close();
  return { command, ms, gotResult, sessionId, commands: init.commands, messages, transcript: sessionId ? transcript(sessionId) : [] };
}

const results = [];
for (const c of COMMANDS) {
  const r = await run(c);
  console.log(`${c}: ${r.gotResult ? "result" : "NO RESULT"} in ${r.ms}ms; ` +
    r.messages.map((m: any) => `${m.type}${m.subtype ? "/" + m.subtype : ""}`).join(", "));
  results.push(r);
}
// The fixture is committed: keep only the shapes tests need, clipped, with local paths and the account scrubbed.
const scrub = (s: string) => s.split(homedir()).join("~").replace(/squad-command-probe-\w+/g, "squad-command-probe-X")
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "user@example.com").replace(/\([A-Z][a-z]+\/[A-Za-z_]+\)/g, "(UTC)").slice(0, 400);
const text = (c: unknown): unknown => typeof c === "string" ? scrub(c)
  : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => ({ type: "text", text: scrub(b.text) })) : c;
const slim = (m: any) => ({
  type: m.type, ...(m.subtype ? { subtype: m.subtype } : {}), ...(m.isMeta ? { isMeta: true } : {}),
  ...(m.message ? { message: { ...(m.message.model ? { model: m.message.model } : {}), content: text(m.message.content) } } : {}),
  ...(m.content !== undefined ? { content: text(m.content) } : {}),
});
// /cost prints the account's usage figures; the fixture keeps their shape, not the numbers.
const accountless = (command: string, msgs: unknown[]) =>
  command === "/cost" ? JSON.parse(JSON.stringify(msgs).replace(/\d+/g, "N")) : msgs;
const keep = (m: any) => ["assistant", "user", "system", "result", "conversation_reset"].includes(m.type) && m.subtype !== "init";
const commands = (results[0].commands as any[]).map(({ name, aliases, builtin }) => ({ name, ...(aliases ? { aliases } : {}), ...(builtin ? { builtin } : {}) }));
writeFileSync(out, JSON.stringify({
  commands,
  runs: results.map((r) => ({
    command: r.command, ms: r.ms, gotResult: r.gotResult,
    // /doctor is a prompt command: the model runs it, so its messages are an ordinary turn, not command output.
    messages: r.command === "/doctor" ? [] : accountless(r.command, r.messages.filter(keep).map(slim)),
    transcript: r.command === "/doctor" ? [] : accountless(r.command, r.transcript.filter(keep).map(slim)),
  })),
}, null, 2) + "\n");
console.log(`wrote ${out}`);
