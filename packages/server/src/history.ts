import { existsSync, readdirSync, readFileSync } from "node:fs";
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
    return historyEvents(withCommandOutput(msgs as Line[], commandOutputLines(sessionId)));
  } catch {
    return [];
  }
}

/** The session file's `/` command output lines; getSessionMessages doesn't return their text. */
function commandOutputLines(sessionId: string): Line[] {
  try {
    const root = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
    for (const dir of readdirSync(root)) {
      const file = join(root, dir, `${sessionId}.jsonl`);
      if (!existsSync(file)) continue;
      return readFileSync(file, "utf8").split("\n").flatMap((l) => {
        if (!l.includes('"local_command"')) return [];
        try {
          const line = JSON.parse(l) as Line;
          return line.type === "system" && line.subtype === "local_command" ? [line] : [];
        } catch {
          return [];
        }
      });
    }
  } catch {}
  return [];
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
