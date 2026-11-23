import { describe, it, expect } from "vitest";
import fixture from "./fixtures/usage-messages.json" with { type: "json" };
import { toTotals, turnRows } from "../src/turnUsage.ts";

const [first, second] = fixture.results;

describe("turnRows", () => {
  it("maps modelUsage to rows against an empty baseline", () => {
    const { rows } = turnRows(first.modelUsage, {});
    expect(rows).toContainEqual({ model: "claude-opus-5-5", input: 2, output: 4, cacheRead: 0, cacheWrite: 13887, cost: 0.111184 });
    expect(rows).toHaveLength(2);
  });

  it("second result yields only that turn's usage", () => {
    const { rows } = turnRows(second.modelUsage, toTotals(first.modelUsage));
    expect(rows).toHaveLength(1); // haiku did not change
    expect(rows[0]).toMatchObject({ model: "claude-opus-5-5", input: 2, output: 63, cacheRead: 9656, cacheWrite: 6284 });
    expect(rows[0].cost).toBeCloseTo(0.1646552 - 0.111184, 9);
  });

  it("records nothing without a baseline, but returns the totals", () => {
    const { rows, totals } = turnRows(second.modelUsage, null);
    expect(rows).toEqual([]);
    expect(totals["claude-opus-5-5"].output).toBe(67);
  });

  it("treats a model whose totals went down as starting from zero", () => {
    const { rows } = turnRows(first.modelUsage, toTotals(second.modelUsage));
    expect(rows.find((r) => r.model === "claude-opus-5-5")).toMatchObject({ output: 4, cacheWrite: 13887 });
  });

  it("drops all-zero models", () => {
    expect(turnRows({ m: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 } }, {}).rows).toEqual([]);
  });
});
