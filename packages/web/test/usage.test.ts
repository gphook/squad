import { describe, it, expect, vi, afterEach } from "vitest";
import { FIVE_HOUR_MS, SEVEN_DAY_MS } from "@squad/shared";
import { contextLabel, fetchUsage, formatCost, liveContextPct, formatReset, formatTokens, ringLabel, ringTone, stackDaily } from "../src/lib/usage.ts";

const now = new Date(2026, 10, 23, 12, 0).getTime();

describe("rings", () => {
  it("ringTone thresholds at 74/75/89/90", () => {
    expect([74, 75, 89, 90].map(ringTone)).toEqual(["ok", "warn", "warn", "bad"]);
  });

  it("ringLabel includes the reset time and projection", () => {
    const w = { pct: 30, resetsAt: now + 0.5 * FIVE_HOUR_MS };
    expect(ringLabel("Session", w, FIVE_HOUR_MS, now))
      .toBe(`Session: 30% used, resets ${formatReset(w.resetsAt, now)}, projected 60%`);
  });

  it("ringLabel omits the projection when there is none", () => {
    const w = { pct: 2, resetsAt: now + 0.95 * SEVEN_DAY_MS };
    expect(ringLabel("Weekly", w, SEVEN_DAY_MS, now)).toBe(`Weekly: 2% used, resets ${formatReset(w.resetsAt, now)}`);
    expect(ringLabel("Weekly", { pct: 2, resetsAt: null }, SEVEN_DAY_MS, now)).toBe("Weekly: 2% used");
  });

  it("formatReset shows a time today and a weekday further out", () => {
    const today = formatReset(new Date(2026, 10, 23, 15, 40).getTime(), now);
    expect(today).toMatch(/\b(3|15):40/);
    expect(today).not.toMatch(/Mon/);
    expect(formatReset(new Date(2026, 10, 27, 9, 0).getTime(), now)).toMatch(/Fri/);
  });
});

describe("usage page helpers", () => {
  const row = (day: string, agentId: string, cost: number, tokens = 100) => ({ day, agentId, agentName: agentId.toUpperCase(), cost, tokens });

  it("stackDaily fills gaps and orders oldest first", () => {
    const r = stackDaily([row("2026-11-23", "a", 2), row("2026-11-21", "a", 1)], 3, "2026-11-23", "cost");
    expect(r.days).toEqual(["2026-11-21", "2026-11-22", "2026-11-23"]);
    expect(r.series).toEqual([{ agentId: "a", agentName: "A", values: [1, 0, 2] }]);
    expect(r.max).toBe(2);
  });

  it("stackDaily sorts series by total and stacks max per day", () => {
    const r = stackDaily([row("2026-11-23", "a", 1, 10), row("2026-11-23", "b", 5, 50), row("2026-11-22", "a", 2, 20)], 2, "2026-11-23", "tokens");
    expect(r.series.map((s) => s.agentId)).toEqual(["b", "a"]);
    expect(r.series[1].values).toEqual([20, 10]);
    expect(r.max).toBe(60);
  });

  it("stackDaily crosses month ends", () => {
    expect(stackDaily([], 3, "2026-12-01", "cost").days).toEqual(["2026-11-29", "2026-11-30", "2026-12-01"]);
  });

  it("formatCost and formatTokens examples", () => {
    expect([1.234, 0.004, 0, 12].map(formatCost)).toEqual(["$1.23", "<$0.01", "$0.00", "$12.00"]);
    expect([950, 12_345, 4_100_000].map(formatTokens)).toEqual(["950", "12.3k", "4.1M"]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("fetchUsage builds the query string and throws on non-OK", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => { calls.push(url); return { ok: true, json: async () => ({ windows: [] }) }; });
    expect(await fetchUsage("p1", 30)).toEqual({ windows: [] });
    await fetchUsage(null, 7);
    expect(calls).toEqual(["/api/usage?projectId=p1&days=30", "/api/usage?projectId=&days=7"]);
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) }));
    await expect(fetchUsage("p1", 30)).rejects.toThrow("boom");
  });
});

describe("context rings", () => {
  it("shows a reading only for a live squadmate that has one", () => {
    expect(liveContextPct({ agentId: "a", status: "idle", contextPct: 41 })).toBe(41);
    expect(liveContextPct({ agentId: "a", status: "working", contextPct: 0 })).toBe(0);
    expect(liveContextPct({ agentId: "a", status: "idle" })).toBeNull();
    expect(liveContextPct({ agentId: "a", status: "stopped", contextPct: 41 })).toBeNull();
    expect(liveContextPct({ agentId: "a", status: "error", contextPct: 41 })).toBeNull();
    expect(liveContextPct(undefined)).toBeNull();
  });

  it("labels the reading", () => {
    expect(contextLabel(41)).toBe("Context: 41% used");
  });
});
