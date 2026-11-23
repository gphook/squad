import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@squad/shared";
import { normalise } from "./normalise.ts";

/** An agent's past conversation, read from Claude Code's own session file. */
export async function loadHistory(sessionId: string, cwd: string): Promise<AgentEvent[]> {
  try {
    const msgs = await getSessionMessages(sessionId, { dir: cwd, includeSystemMessages: true });
    return msgs.flatMap((m) => normalise(m));
  } catch {
    return [];
  }
}
