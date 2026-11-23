export const FIVE_HOUR_MS = 5 * 3600_000;
export const SEVEN_DAY_MS = 7 * 86400_000;
export const USAGE_RANGES = [7, 30, 90] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

/** One plan rate-limit window. `resetsAt` is epoch ms. */
export interface PlanWindow {
  pct: number;
  resetsAt: number | null;
}

/** The claude.ai plan limits for the signed-in account. Account-wide, not per project. */
export interface PlanUsage {
  available: boolean;
  fiveHour?: PlanWindow;
  sevenDay?: PlanWindow;
  perModel: (PlanWindow & { label: string })[];
  extra?: { enabled: boolean; pct: number | null; used: number | null; limit: number | null; currency: string | null };
  fetchedAt: number;
  stale: boolean;
}

export interface UsageTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** One model's share of one agent turn. Cost is the SDK's API-equivalent estimate. */
export interface UsageTurnRow extends UsageTokens {
  model: string;
  cost: number;
}

export interface AgentWindowUsage extends UsageTokens {
  agentId: string;
  agentName: string;
  projectName: string;
  turns: number;
  cost: number;
  share5h: number;
  share7d: number;
}

export interface UsageReport {
  windows: AgentWindowUsage[];
  /** `day` is "YYYY-MM-DD" in the server's local time zone. */
  daily: { day: string; agentId: string; agentName: string; cost: number; tokens: number }[];
  byModel: ({ model: string; cost: number } & UsageTokens)[];
  top: ({ at: number; agentId: string; agentName: string; projectName: string; model: string; cost: number } & UsageTokens)[];
}

const MIN_ELAPSED = 0.1;
const MAX_PROJECTION = 200;

/** Linear projection of a window's % at reset; null too early in the window to be meaningful. */
export function projectedPct(w: PlanWindow, windowMs: number, now: number): number | null {
  if (w.resetsAt === null) return null;
  const elapsed = (now - (w.resetsAt - windowMs)) / windowMs;
  if (elapsed >= 1) return w.pct;
  if (elapsed < MIN_ELAPSED) return null;
  return Math.min(MAX_PROJECTION, Math.round(w.pct / elapsed));
}
