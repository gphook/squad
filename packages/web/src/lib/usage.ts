import { projectedPct, type PlanWindow, type UsageRange, type UsageReport } from "@squad/shared";

export type RingTone = "ok" | "warn" | "bad";

export function ringTone(pct: number): RingTone {
  return pct < 75 ? "ok" : pct < 90 ? "warn" : "bad";
}

const DAY_MS = 86400_000;

/** A reset time: just the time when it's within a day, with the weekday when further out. */
export function formatReset(resetsAt: number, now: number): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (resetsAt - now >= DAY_MS || new Date(resetsAt).getDate() !== new Date(now).getDate()) opts.weekday = "short";
  return new Date(resetsAt).toLocaleString(undefined, opts);
}

export function ringLabel(name: "Session" | "Weekly", w: PlanWindow, windowMs: number, now: number): string {
  const parts = [`${name}: ${w.pct}% used`];
  if (w.resetsAt !== null) parts.push(`resets ${formatReset(w.resetsAt, now)}`);
  const projected = projectedPct(w, windowMs, now);
  if (projected !== null) parts.push(`projected ${projected}%`);
  return parts.join(", ");
}

export async function fetchUsage(projectId: string | null, days: UsageRange): Promise<UsageReport> {
  const r = await fetch(`/api/usage?projectId=${encodeURIComponent(projectId ?? "")}&days=${days}`);
  const body = await r.json();
  if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
  return body as UsageReport;
}

/** "YYYY-MM-DD" for a local date, matching the server's day buckets. */
export function localDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The `count` calendar days ending at `today`, oldest first. Plain date arithmetic, so DST can't skip a day. */
function dayRange(today: string, count: number): string[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

export interface StackedDaily {
  days: string[];
  series: { agentId: string; agentName: string; values: number[] }[];
  /** The largest day total, for scaling the chart. */
  max: number;
}

/** Daily usage as one series per agent over every day in range, biggest agent first. */
export function stackDaily(daily: UsageReport["daily"], days: number, today: string, metric: "cost" | "tokens"): StackedDaily {
  const range = dayRange(today, days);
  const index = new Map(range.map((d, i) => [d, i]));
  const byAgent = new Map<string, StackedDaily["series"][number]>();
  for (const r of daily) {
    const i = index.get(r.day);
    if (i === undefined) continue;
    let s = byAgent.get(r.agentId);
    if (!s) byAgent.set(r.agentId, (s = { agentId: r.agentId, agentName: r.agentName, values: range.map(() => 0) }));
    s.values[i] += r[metric];
  }
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  const series = [...byAgent.values()].sort((a, b) => sum(b.values) - sum(a.values));
  const max = Math.max(0, ...range.map((_, i) => sum(series.map((s) => s.values[i]))));
  return { days: range, series, max };
}

export const formatCost = (usd: number): string => (usd > 0 && usd < 0.005 ? "<$0.01" : `$${usd.toFixed(2)}`);

export function formatTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}
