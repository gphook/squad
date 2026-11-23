<script lang="ts">
  import { projectedPct, type PlanWindow } from "@squad/shared";
  import { ringLabel } from "../lib/usage.ts";
  import Ring from "./Ring.svelte";

  let { label, name, window: w, windowMs, now, onclick }: {
    label: "5h" | "7d"; name: "Session" | "Weekly"; window: PlanWindow; windowMs: number; now: number; onclick: () => void;
  } = $props();

  const text = $derived(ringLabel(name, w, windowMs, now));
  const projected = $derived(projectedPct(w, windowMs, now));
</script>

<button class="ring" aria-label={text} title={text} {onclick}>
  <Ring pct={w.pct} over={projected !== null && projected > 100} />
  <span class="label">{label}</span>
</button>

<style>
  .ring { display: inline-flex; align-items: center; gap: 4px; background: none; border: 0; padding: 0 4px; color: var(--muted); font-size: 11px; }
</style>
