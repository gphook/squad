<script lang="ts">
  import type { AgentStatus } from "@squad/shared";
  let { status }: { status: AgentStatus } = $props();
</script>

<span class="dot {status}" title={status}></span>

<style>
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--muted); }
  .working { background: var(--ok); }
  .starting { background: var(--ok); opacity: 0.5; }
  .idle { background: var(--warn); }
  .awaiting { background: var(--warn); box-shadow: 0 0 0 2px color-mix(in srgb, var(--warn) 40%, transparent); }
  .error { background: var(--bad); }
</style>
