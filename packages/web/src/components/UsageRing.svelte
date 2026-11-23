<script lang="ts">
  import { projectedPct, type PlanWindow } from "@squad/shared";
  import { ringLabel, ringTone } from "../lib/usage.ts";

  let { label, name, window: w, windowMs, now, onclick }: {
    label: "5h" | "7d"; name: "Session" | "Weekly"; window: PlanWindow; windowMs: number; now: number; onclick: () => void;
  } = $props();

  const R = 11;
  const C = 2 * Math.PI * R;
  const text = $derived(ringLabel(name, w, windowMs, now));
  const projected = $derived(projectedPct(w, windowMs, now));
  const filled = $derived((Math.min(100, Math.max(0, w.pct)) / 100) * C);
</script>

<button class="ring {ringTone(w.pct)}" aria-label={text} title={text} {onclick}>
  <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
    {#if projected !== null && projected > 100}<circle class="over" cx="14" cy="14" r="13.25" />{/if}
    <circle class="track" cx="14" cy="14" r={R} />
    <circle class="fill" cx="14" cy="14" r={R} stroke-dasharray="{filled} {C}" transform="rotate(-90 14 14)" />
    <text x="14" y="15" text-anchor="middle" dominant-baseline="middle">{w.pct}</text>
  </svg>
  <span class="label">{label}</span>
</button>

<style>
  .ring { display: inline-flex; align-items: center; gap: 4px; background: none; border: 0; padding: 0 4px; color: var(--muted); font-size: 11px; }
  circle { fill: none; stroke-width: 3; }
  .track { stroke: var(--line); }
  .fill { stroke: var(--tone); stroke-linecap: round; }
  .over { stroke: var(--bad); stroke-width: 1; stroke-dasharray: 2 2; }
  text { fill: var(--text); font-size: 9px; font-weight: 600; }
  .ok { --tone: var(--accent); }
  .warn { --tone: var(--warn); }
  .bad { --tone: var(--bad); }
</style>
