import type { UsageTurnRow } from "@squad/shared";

/**
 * The SDK reports a session's usage as running per-model totals that carry over when the session is
 * resumed. Squad stores the totals at each turn as a baseline and records the difference.
 */
export type ModelTotals = Record<string, UsageTurnRow>;

type SdkModelUsage = Record<string, {
  inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; costUSD?: number;
}>;

const FIELDS = ["input", "output", "cacheRead", "cacheWrite", "cost"] as const;

export function toTotals(modelUsage: SdkModelUsage | undefined): ModelTotals {
  const totals: ModelTotals = {};
  for (const [model, u] of Object.entries(modelUsage ?? {})) {
    totals[model] = {
      model, input: u.inputTokens ?? 0, output: u.outputTokens ?? 0,
      cacheRead: u.cacheReadInputTokens ?? 0, cacheWrite: u.cacheCreationInputTokens ?? 0, cost: u.costUSD ?? 0,
    };
  }
  return totals;
}

/**
 * This turn's rows: current totals minus the baseline. A null baseline (a session whose earlier
 * totals Squad never saw) records nothing. A model whose totals went down is counted from zero.
 */
export function turnRows(modelUsage: SdkModelUsage | undefined, prev: ModelTotals | null): { rows: UsageTurnRow[]; totals: ModelTotals } {
  const totals = toTotals(modelUsage);
  if (!prev) return { rows: [], totals };
  const rows: UsageTurnRow[] = [];
  for (const cur of Object.values(totals)) {
    const before = prev[cur.model];
    const base = before && FIELDS.every((k) => cur[k] >= before[k]) ? before : undefined;
    const row = { ...cur };
    for (const k of FIELDS) row[k] = cur[k] - (base?.[k] ?? 0);
    if (FIELDS.some((k) => row[k] > 0)) rows.push(row);
  }
  return { rows, totals };
}
