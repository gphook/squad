<script lang="ts">
  import { ringTone } from "../lib/usage.ts";

  /** A progress ring with the percentage in the middle; `over` adds a dashed outer warning ring. */
  let { pct, size = 28, over = false }: { pct: number; size?: number; over?: boolean } = $props();

  const R = 11;
  const C = 2 * Math.PI * R;
  const filled = $derived((Math.min(100, Math.max(0, pct)) / 100) * C);
</script>

<svg class={ringTone(pct)} viewBox="0 0 28 28" width={size} height={size} aria-hidden="true">
  {#if over}<circle class="over" cx="14" cy="14" r="13.25" />{/if}
  <circle class="track" cx="14" cy="14" r={R} />
  <circle class="fill" cx="14" cy="14" r={R} stroke-dasharray="{filled} {C}" transform="rotate(-90 14 14)" />
  <text x="14" y="15" text-anchor="middle" dominant-baseline="middle">{pct}</text>
</svg>

<style>
  svg { flex: none; }
  circle { fill: none; stroke-width: 3; }
  .track { stroke: var(--line); }
  .fill { stroke: var(--tone); stroke-linecap: round; }
  .over { stroke: var(--bad); stroke-width: 1; stroke-dasharray: 2 2; }
  text { fill: var(--text); font-size: 9px; font-weight: 600; }
  .ok { --tone: var(--accent); }
  .warn { --tone: var(--warn); }
  .bad { --tone: var(--bad); }
</style>
