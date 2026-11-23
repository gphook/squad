import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { PlanUsage } from "@squad/shared";
import fixture from "./fixtures/usage-messages.json" with { type: "json" };
import { PLAN_AFTER_TURN_MS, PROBE_TIMEOUT_MS, PlanUsageTracker, toPlanUsage } from "../src/planUsage.ts";
import { fakeFactory } from "./fakeQuery.ts";

const NOW = Date.parse("2026-11-23T10:00:00Z");
let f: ReturnType<typeof fakeFactory>;
let source: any;
let tracker: PlanUsageTracker;
let changes: PlanUsage[];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  f = fakeFactory();
  f.usage.response = fixture.usage;
  source = null;
  tracker = new PlanUsageTracker({ queryFactory: f.factory, source: () => source, probeCwd: "/tmp" });
  changes = [];
  tracker.on("change", (p) => changes.push(p));
});
afterEach(() => {
  tracker.dispose();
  vi.useRealTimers();
});

describe("toPlanUsage", () => {
  it("maps the real usage response", () => {
    expect(toPlanUsage(fixture.usage as any, NOW)).toEqual({
      available: true,
      fiveHour: { pct: 58, resetsAt: Date.parse("2026-11-23T11:29:59.595109+00:00") },
      sevenDay: { pct: 8, resetsAt: Date.parse("2026-11-30T02:59:59.595131+00:00") },
      perModel: [],
      extra: { enabled: false, pct: null, used: null, limit: null, currency: null },
      fetchedAt: NOW, stale: false,
    });
  });
  it("maps per-model weekly windows", () => {
    const raw = { rate_limits_available: true, rate_limits: {
      seven_day_opus: { utilization: 40, resets_at: null },
      model_scoped: [{ display_name: "Fable", utilization: 12, resets_at: null }],
    } };
    expect(toPlanUsage(raw as any, NOW).perModel).toEqual([
      { label: "Opus", pct: 40, resetsAt: null }, { label: "Fable", pct: 12, resetsAt: null },
    ]);
  });
});

describe("PlanUsageTracker", () => {
  it("uses a running agent's query when there is one, and starts no probe", async () => {
    let calls = 0;
    source = { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => { calls++; return fixture.usage; } };
    const p = await tracker.refresh();
    expect(p?.fiveHour?.pct).toBe(58);
    expect(calls).toBe(1);
    expect(f.queries).toHaveLength(0);
    expect(changes).toHaveLength(1);
  });

  it("with no running agent, probes once and closes the probe", async () => {
    await tracker.refresh();
    expect(f.queries).toHaveLength(1);
    expect(f.queries[0].closed).toBe(true);
    expect(f.queries[0].options).toMatchObject({ cwd: "/tmp", settingSources: [], allowedTools: [] });
    expect(f.queries[0].inputs).toEqual([]);
    expect(tracker.current?.sevenDay?.pct).toBe(8);
  });

  it("a probe that never answers times out, is closed, and the next refresh probes again", async () => {
    f.usage.response = () => new Promise(() => {});
    const first = tracker.refresh();
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + 1);
    expect(await first).toBeNull();
    expect(f.queries[0].closed).toBe(true);
    f.usage.response = fixture.usage;
    expect((await tracker.refresh())?.fiveHour?.pct).toBe(58);
    expect(f.queries).toHaveLength(2);
  });

  it("concurrent refreshes share one call", async () => {
    await Promise.all([tracker.refresh(), tracker.refresh()]);
    expect(f.usage.calls).toBe(1);
  });

  it("an unavailable sign-in gives available:false", async () => {
    f.usage.response = { rate_limits_available: false, rate_limits: null };
    expect(await tracker.refresh()).toMatchObject({ available: false, perModel: [] });
  });

  it("an error keeps the last value marked stale", async () => {
    await tracker.refresh();
    f.usage.response = () => Promise.reject(new Error("boom"));
    const p = await tracker.refresh();
    expect(p).toMatchObject({ stale: true, fiveHour: { pct: 58 } });
    expect(changes.at(-1)?.stale).toBe(true);
  });

  it("afterTurn debounces several turns into one refresh after 30s", async () => {
    tracker.afterTurn();
    await vi.advanceTimersByTimeAsync(10_000);
    tracker.afterTurn();
    tracker.afterTurn();
    await vi.advanceTimersByTimeAsync(PLAN_AFTER_TURN_MS - 1);
    expect(f.usage.calls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.usage.calls).toBe(1);
  });

  it("polls while polling is on", async () => {
    tracker.setPolling(true);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(f.usage.calls).toBe(1);
    tracker.setPolling(false);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(f.usage.calls).toBe(1);
  });

  it("applyRateLimit updates both windows from unifiedWindows and emits change", async () => {
    await tracker.refresh();
    tracker.applyRateLimit(fixture.rateLimitEvents[1].rate_limit_info);
    expect(tracker.current?.fiveHour).toEqual({ pct: 59, resetsAt: 1795433400_000 });
    expect(tracker.current?.sevenDay).toEqual({ pct: 8, resetsAt: 1796007600_000 });
    expect(changes).toHaveLength(2);
  });

  it("applyRateLimit falls back to rateLimitType and ignores other types", () => {
    tracker.applyRateLimit({ rateLimitType: "seven_day_opus", utilization: 0.5, resetsAt: 1 });
    expect(tracker.current).toBeNull();
    tracker.applyRateLimit({ rateLimitType: "five_hour", utilization: 0.25, resetsAt: 2 });
    expect(tracker.current).toMatchObject({ available: true, fiveHour: { pct: 25, resetsAt: 2000 } });
  });
});
