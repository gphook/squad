import { createReadStream } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@squad/shared";
import { historyEvents } from "./normalise.ts";

type Line = { type?: string; subtype?: string; uuid?: string; parentUuid?: string | null };

/** An agent's past conversation, read from Claude Code's own session file. */
export async function loadHistory(sessionId: string, cwd: string): Promise<AgentEvent[]> {
  try {
    const msgs = await getSessionMessages(sessionId, { dir: cwd, includeSystemMessages: true });
    return historyEvents(withCommandOutput(msgs as Line[], await commandOutputLines(sessionId, cwd)));
  } catch {
    return [];
  }
}

/** Where Claude Code keeps a session's file: the folder's own project directory, else any other (a moved folder). */
async function sessionFile(sessionId: string, cwd: string): Promise<string | null> {
  const root = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
  const name = `${sessionId}.jsonl`;
  const own = join(root, cwd.replace(/[^a-zA-Z0-9]/g, "-"), name);
  if (await exists(own)) return own;
  for (const dir of await readdir(root).catch(() => [])) {
    if (await exists(join(root, dir, name))) return join(root, dir, name);
  }
  return null;
}

const exists = (f: string) => access(f).then(() => true, () => false);

/** The session file's `/` command output lines; getSessionMessages doesn't return their text. Read as a stream. */
export async function commandOutputLines(sessionId: string, cwd: string): Promise<Line[]> {
  const out: Line[] = [];
  try {
    const file = await sessionFile(sessionId, cwd);
    if (!file) return out;
    for await (const l of createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity })) {
      if (!l.includes('"local_command"')) continue;
      try {
        const line = JSON.parse(l) as Line;
        if (line.type === "system" && line.subtype === "local_command") out.push(line);
      } catch {}
    }
  } catch {}
  return out;
}

/**
 * The conversation with command output put back: getSessionMessages returns a command's output line without its
 * text, and leaves it out entirely while nothing follows it. Output is placed after the message it follows, and only
 * when that message is in the conversation (not on an abandoned branch).
 */
export function withCommandOutput(msgs: Line[], outputs: Line[]): Line[] {
  const byUuid = new Map(outputs.map((o) => [o.uuid, o]));
  const children = new Map<string, Line[]>();
  for (const o of outputs) if (o.parentUuid) children.set(o.parentUuid, [...(children.get(o.parentUuid) ?? []), o]);
  const result: Line[] = [];
  const seen = new Set<string>();
  const add = (m: Line) => {
    if (m.uuid && seen.has(m.uuid)) return;
    if (m.uuid) seen.add(m.uuid);
    result.push((m.uuid && byUuid.get(m.uuid)) || m);
    // Output that follows this message but isn't in the list yet (the list's own copy comes later and is skipped).
    for (const child of m.uuid ? (children.get(m.uuid) ?? []) : []) {
      if (!msgs.some((x) => x.uuid === child.uuid)) add(child);
    }
  };
  for (const m of msgs) add(m);
  return result;
}
