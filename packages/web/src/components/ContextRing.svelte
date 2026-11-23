<script lang="ts">
  import type { AgentState } from "@squad/shared";
  import { contextLabel, liveContextPct } from "../lib/usage.ts";
  import Ring from "./Ring.svelte";

  /** How full a running squadmate's context window is; renders nothing until there is a reading. */
  let { state, size = 22 }: { state: AgentState | undefined; size?: number } = $props();
  const pct = $derived(liveContextPct(state));
</script>

{#if pct !== null}
  <span class="ctx" role="img" aria-label={contextLabel(pct)} title={contextLabel(pct)}><Ring {pct} {size} /></span>
{/if}

<style>
  .ctx { display: inline-flex; }
</style>
