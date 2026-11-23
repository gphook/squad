import type { QueryFactory } from "../src/runner.ts";

export interface FakeQuery {
  options: Record<string, any>;
  /** Resolves the fake's initializationResult(), as Claude Code does once its process is up (no prompt needed). */
  initialize(): void;
  inputs: any[];
  emit(msg: unknown): void;
  end(): void;
  closed: boolean;
  interrupted: number;
  /** The opts of each getContextUsage call. */
  contextCalls: unknown[];
  /** Set to hold getContextUsage answers until it resolves. */
  contextGate: Promise<void> | null;
}

/** What the fake `/usage` call answers; a function lets a test make it fail or hang. */
export interface FakeUsage {
  response: unknown | (() => Promise<unknown>);
  calls: number;
}

/** A controllable stand-in for the SDK query(): the test emits SDK messages and reads what the runner sent. */
export function fakeFactory(): { factory: QueryFactory; queries: FakeQuery[]; usage: FakeUsage; models: FakeUsage } {
  const queries: FakeQuery[] = [];
  const usage: FakeUsage = { response: { rate_limits_available: false, rate_limits: null }, calls: 0 };
  const models: FakeUsage = { response: [], calls: 0 };
  const factory: QueryFactory = ({ prompt, options }) => {
    const pending: unknown[] = [];
    let wake: (() => void) | null = null;
    let done = false;
    let initialize!: () => void;
    const initialized = new Promise<unknown>((r) => (initialize = () => r({})));
    const fq: FakeQuery = {
      options: options as Record<string, any>, inputs: [], closed: false, interrupted: 0, contextCalls: [], contextGate: null,
      emit(m) { pending.push(m); wake?.(); },
      initialize: () => initialize(),
      end() { done = true; wake?.(); },
    };
    (async () => { for await (const m of prompt) fq.inputs.push(m); })();
    const iter = {
      async *[Symbol.asyncIterator]() {
        while (true) {
          while (pending.length) yield pending.shift();
          if (done) return;
          await new Promise<void>((r) => (wake = r));
          wake = null;
        }
      },
      interrupt: async () => { fq.interrupted++; },
      initializationResult: () => initialized,
      close: () => { fq.closed = true; fq.end(); },
      getContextUsage: async (opts?: unknown) => { fq.contextCalls.push(opts); await fq.contextGate; return { percentage: 41 }; },
      supportedModels: async () => {
        models.calls++;
        return typeof models.response === "function" ? (models.response as () => Promise<unknown>)() : models.response;
      },
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
        usage.calls++;
        return typeof usage.response === "function" ? (usage.response as () => Promise<unknown>)() : usage.response;
      },
    };
    queries.push(fq);
    return iter as any;
  };
  return { factory, queries, usage, models };
}

export const tick = () => new Promise((r) => setTimeout(r, 0));
