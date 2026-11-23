<script lang="ts">
  import type { AgentEvent } from "@squad/shared";
  import { send } from "../lib/state.svelte.ts";

  /** A `$ cmd` Squad ran: live output while running, then how it ended. */
  let { ev, agentId, agentName, waiting = false }: {
    ev: Extract<AgentEvent, { kind: "shell" }>; agentId: string; agentName: string; waiting?: boolean;
  } = $props();

  const status = $derived(
    ev.running ? "running…"
      : ev.signal ? `killed (${ev.signal})`
      : ev.code === null ? ""
      : ev.code === 0 ? "done" : `exit ${ev.code}`,
  );
</script>

<div class="shell" class:failed={!ev.running && (ev.signal || (ev.code !== null && ev.code !== 0))}>
  <div class="head">
    <code class="cmd">$ {ev.command}</code>
    <span class="status">{status}</span>
    {#if ev.running}
      <button onclick={() => send({ t: "agent.shellKill", agentId, id: ev.id })}>Kill</button>
    {/if}
  </div>
  {#if ev.chunks.length}
    <pre>{#each ev.chunks as c}<span class={c.stream}>{c.text}</span>{/each}</pre>
  {/if}
  {#if waiting}<div class="hint">{agentName} sees this with your next message.</div>{/if}
</div>

<style>
  .shell { border-left: 2px solid var(--accent); padding-left: 8px; margin: 6px 0; font-size: 13px; }
  .shell.failed { border-color: var(--bad); }
  .head { display: flex; align-items: center; gap: 8px; }
  .cmd { font-family: ui-monospace, monospace; font-weight: 600; white-space: pre-wrap; word-break: break-all; }
  .status { color: var(--muted); font-size: 12px; margin-left: auto; white-space: nowrap; }
  .head button { padding: 1px 8px; font-size: 12px; }
  pre { background: var(--code); padding: 6px; border-radius: 6px; overflow: auto; max-height: 300px; font-size: 12px; margin: 4px 0; white-space: pre-wrap; }
  .stderr { color: var(--bad); }
  .hint { margin-top: 2px; }
</style>
