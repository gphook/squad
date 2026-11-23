<script lang="ts">
  import { formatCost, formatTokens, type StackedDaily } from "../lib/usage.ts";

  let { data, metric }: { data: StackedDaily; metric: "cost" | "tokens" } = $props();

  const PALETTE = ["#3a6df0", "#e8590c", "#2f9e44", "#ae3ec9", "#d9930d", "#1098ad", "#d6336c", "#5c940d"];
  const H = 160;
  const GAP = 2;
  const fmt = (v: number) => (metric === "cost" ? formatCost(v) : formatTokens(v));
  const width = $derived(Math.max(1, data.days.length) * 14);
  const barW = $derived(width / Math.max(1, data.days.length) - GAP);
  const scale = (v: number) => (data.max ? (v / data.max) * H : 0);

  /** Each day's segments, bottom up, in series order. */
  const bars = $derived(data.days.map((day, i) => {
    let y = H;
    const segs = data.series.flatMap((s, si) => {
      const v = s.values[i];
      if (!v) return [];
      const h = scale(v);
      y -= h;
      return [{ y, h, color: PALETTE[si % PALETTE.length], title: `${day} · ${s.agentName}: ${fmt(v)}` }];
    });
    return { x: i * (barW + GAP), segs };
  }));
</script>

{#if !data.series.length}
  <p class="hint">No usage recorded in this range yet.</p>
{:else}
  <figure>
    <svg viewBox="0 0 {width} {H}" preserveAspectRatio="none" role="img" aria-label="Daily usage by agent">
      {#each bars as b}
        {#each b.segs as s}<rect x={b.x} y={s.y} width={barW} height={s.h} fill={s.color}><title>{s.title}</title></rect>{/each}
      {/each}
    </svg>
    <div class="axis"><span>{data.days[0]}</span><span>max {fmt(data.max)}/day</span><span>{data.days.at(-1)}</span></div>
    <figcaption>
      {#each data.series as s, si}<span class="key"><i style="background:{PALETTE[si % PALETTE.length]}"></i>{s.agentName}</span>{/each}
    </figcaption>
  </figure>
{/if}

<style>
  figure { margin: 0; }
  svg { width: 100%; height: 160px; display: block; }
  .axis { display: flex; justify-content: space-between; color: var(--muted); font-size: 11px; margin-top: 4px; }
  figcaption { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; font-size: 12px; }
  .key { display: inline-flex; align-items: center; gap: 5px; }
  .key i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
</style>
