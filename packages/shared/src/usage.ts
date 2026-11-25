export const FIVE_HOUR_MS = 5 * 3600_000;
export const SEVEN_DAY_MS = 7 * 86400_000;
export const USAGE_RANGES = [7, 30, 90] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

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
