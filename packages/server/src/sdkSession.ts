import type { Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsyncQueue } from "./inputQueue.ts";
import type { QueryFactory } from "./runner.ts";

export interface SessionDeps {
  queryFactory: QueryFactory;
  /** A running squadmate's query to borrow, if there is one. */
  source: () => Query | null;
  /** Where a throwaway probe session runs. */
  cwd: string;
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer in ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Runs `fn` on a running squadmate's query, or on a probe session that never gets a prompt (so it costs nothing),
 * for SDK calls that answer about the account rather than a conversation.
 */
export async function withSession<T>(deps: SessionDeps, fn: (q: Query) => Promise<T>, timeoutMs: number): Promise<T> {
  const running = deps.source();
  if (running) return withTimeout(fn(running), timeoutMs);
  const input = new AsyncQueue<SDKUserMessage>();
  const probe = deps.queryFactory({
    prompt: input,
    options: { cwd: deps.cwd, settingSources: [], allowedTools: [], permissionMode: "default" },
  });
  try {
    return await withTimeout(fn(probe), timeoutMs);
  } finally {
    input.end();
    probe.close();
  }
}
