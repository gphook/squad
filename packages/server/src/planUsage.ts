import { EventEmitter } from "node:events";
import type { Query, SDKControlGetUsageResponse, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PlanUsage, PlanWindow } from "@squad/shared";
import { AsyncQueue } from "./inputQueue.ts";
import type { QueryFactory } from "./runner.ts";

/**
 * The claude.ai plan limits. This is the only module that calls the SDK's experimental usage API,
 * so an SDK change that renames or reshapes it is fixed here.
 */

export const PLAN_POLL_MS = 300_000;
export const PLAN_AFTER_TURN_MS = 30_000;
export const PROBE_TIMEOUT_MS = 20_000;

type RawWindow = { utilization?: number | null; resets_at?: string | null } | null | undefined;
type RateLimitInfo = {
  rateLimitType?: string; utilization?: number; resetsAt?: number;
  unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number }>;
};

const WINDOW_KEYS = { five_hour: "fiveHour", seven_day: "sevenDay" } as const;
const PER_MODEL_KEYS = { seven_day_opus: "Opus", seven_day_sonnet: "Sonnet" } as const;

const toWindow = (w: RawWindow): PlanWindow | undefined =>
  w && typeof w.utilization === "number"
    ? { pct: Math.round(w.utilization), resetsAt: w.resets_at ? Date.parse(w.resets_at) : null }
    : undefined;

/** Maps the SDK's `/usage` response; ISO reset times become epoch ms. */
export function toPlanUsage(raw: SDKControlGetUsageResponse, now: number): PlanUsage {
  const r = raw.rate_limits;
  if (!raw.rate_limits_available || !r) return { available: false, perModel: [], fetchedAt: now, stale: false };
  const perModel: PlanUsage["perModel"] = [];
  for (const [key, label] of Object.entries(PER_MODEL_KEYS)) {
    const w = toWindow(r[key as keyof typeof PER_MODEL_KEYS]);
    if (w) perModel.push({ label, ...w });
  }
  for (const m of r.model_scoped ?? []) {
    const w = toWindow(m);
    if (w) perModel.push({ label: m.display_name, ...w });
  }
  const x = r.extra_usage;
  return {
    available: true,
    fiveHour: toWindow(r.five_hour),
    sevenDay: toWindow(r.seven_day),
    perModel,
    extra: x
      ? { enabled: x.is_enabled, pct: x.utilization, used: x.used_credits, limit: x.monthly_limit, currency: x.currency ?? null }
      : undefined,
    fetchedAt: now,
    stale: false,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer in ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Keeps the plan limits current. Event: "change"(PlanUsage). */
export class PlanUsageTracker extends EventEmitter {
  private plan: PlanUsage | null = null;
  private inFlight: Promise<PlanUsage | null> | null = null;
  private turnTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private now: () => number;

  constructor(private deps: { queryFactory: QueryFactory; source: () => Query | null; probeCwd: string; now?: () => number }) {
    super();
    this.now = deps.now ?? Date.now;
  }

  get current(): PlanUsage | null {
    return this.plan;
  }

  /** Reads the limits now; calls made while one is running share it. */
  refresh(): Promise<PlanUsage | null> {
    this.inFlight ??= this.fetch().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  afterTurn(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      void this.refresh();
    }, PLAN_AFTER_TURN_MS);
  }

  /** Applies a `rate_limit_event` from an agent's stream; its utilization is a 0–1 fraction. */
  applyRateLimit(info: RateLimitInfo | undefined): void {
    if (!info || typeof info !== "object") return;
    const updates: [keyof typeof WINDOW_KEYS, { utilization?: number; resetsAt?: number }][] = info.unifiedWindows
      ? (Object.entries(info.unifiedWindows) as [keyof typeof WINDOW_KEYS, RateLimitInfo][])
      : [[info.rateLimitType as keyof typeof WINDOW_KEYS, info]];
    const next: PlanUsage = this.plan
      ? { ...this.plan }
      : { available: true, perModel: [], fetchedAt: this.now(), stale: false };
    let changed = false;
    for (const [type, w] of updates) {
      const key = WINDOW_KEYS[type];
      if (!key || typeof w.utilization !== "number") continue;
      next[key] = { pct: Math.round(w.utilization * 100), resetsAt: w.resetsAt ? w.resetsAt * 1000 : null };
      changed = true;
    }
    if (changed) this.set(next);
  }

  setPolling(on: boolean): void {
    if (on && !this.pollTimer) this.pollTimer = setInterval(() => void this.refresh(), PLAN_POLL_MS);
    if (!on && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  dispose(): void {
    this.setPolling(false);
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
  }

  private async fetch(): Promise<PlanUsage | null> {
    try {
      const raw = await this.withQuery((q) => q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }));
      this.set(toPlanUsage(raw, this.now()));
    } catch {
      if (this.plan) this.set({ ...this.plan, stale: true });
    }
    return this.plan;
  }

  /** Runs `fn` on a running agent's query, or on a probe session that never gets a prompt. */
  private async withQuery<T>(fn: (q: Query) => Promise<T>): Promise<T> {
    const running = this.deps.source();
    if (running) return withTimeout(fn(running), PROBE_TIMEOUT_MS);
    const input = new AsyncQueue<SDKUserMessage>();
    const probe = this.deps.queryFactory({
      prompt: input,
      options: { cwd: this.deps.probeCwd, settingSources: [], allowedTools: [], permissionMode: "default" },
    });
    try {
      return await withTimeout(fn(probe), PROBE_TIMEOUT_MS);
    } finally {
      input.end();
      probe.close();
    }
  }

  private set(next: PlanUsage): void {
    const before = JSON.stringify(this.plan);
    this.plan = next;
    if (JSON.stringify(next) !== before) this.emit("change", next);
  }
}
