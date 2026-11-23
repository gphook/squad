import { describe, it, expect } from "vitest";
import { FIVE_HOUR_MS, SEVEN_DAY_MS, projectedPct } from "../src/index.ts";

const now = 1_800_000_000_000;

describe("projectedPct", () => {
  it("returns null before 10% of the window has elapsed", () => {
    expect(projectedPct({ pct: 5, resetsAt: now + 0.95 * FIVE_HOUR_MS }, FIVE_HOUR_MS, now)).toBeNull();
  });

  it("extrapolates linearly", () => {
    expect(projectedPct({ pct: 30, resetsAt: now + 0.5 * FIVE_HOUR_MS }, FIVE_HOUR_MS, now)).toBe(60);
  });

  it("caps at 200", () => {
    expect(projectedPct({ pct: 90, resetsAt: now + 0.8 * SEVEN_DAY_MS }, SEVEN_DAY_MS, now)).toBe(200);
  });

  it("is null without a reset time", () => {
    expect(projectedPct({ pct: 30, resetsAt: null }, FIVE_HOUR_MS, now)).toBeNull();
  });

  it("at or past reset returns pct", () => {
    expect(projectedPct({ pct: 42, resetsAt: now }, FIVE_HOUR_MS, now)).toBe(42);
  });
});
