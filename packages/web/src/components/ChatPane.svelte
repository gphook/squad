<script lang="ts">
  import type { AgentAction, AgentEvent } from "@squad/shared";
  import { agentAction, agentById, approvalsFor, ui } from "../lib/state.svelte.ts";
  import ApprovalCard from "./ApprovalCard.svelte";
  import MessageItem from "./MessageItem.svelte";
  import PromptBox from "./PromptBox.svelte";
  import StatusDot from "./StatusDot.svelte";

  let { agentId, compact = false, focused = false, slot, onclose }: {
    agentId: string; compact?: boolean; focused?: boolean; slot?: string; onclose?: () => void;
  } = $props();

  const agent = $derived(agentById(agentId));
  const agentState = $derived(ui.s.states[agentId] ?? { agentId, status: "stopped" as const });
  const events = $derived(ui.s.events[agentId] ?? []);
  const results = $derived(new Map(
    events.filter((e): e is Extract<AgentEvent, { kind: "tool_result" }> => e.kind === "tool_result").map((e) => [e.toolUseId, e]),
  ));
  const visible = $derived(
    (compact ? events.slice(-5) : events).filter((e) => e.kind !== "tool_result" && !(e.kind === "turn_end" && e.ok)),
  );
  const approvals = $derived(approvalsFor(agentId));
  let scroller = $state<HTMLDivElement>();

  // Keep the newest message in view as events and approvals arrive.
  $effect(() => {
    void events.length;
    void approvals.length;
    const el = scroller;
    if (el) queueMicrotask(() => (el.scrollTop = el.scrollHeight));
  });

  function onclick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.matches("a.ext-img")) {
      e.preventDefault();
      const img = document.createElement("img");
      img.src = t.dataset.src ?? "";
      img.className = "thumb";
      t.replaceWith(img);
    } else if (t.matches(".md img.thumb")) {
      ui.viewer = (t as HTMLImageElement).src;
    }
  }
  const act = (action: AgentAction) => agent && agentAction(agent, action);
</script>

{#if agent}
  <section class="pane" class:compact class:focused aria-label={agent.name}>
    <header>
      {#if slot}<span class="slot">{slot}</span>{/if}
      <StatusDot status={agentState.status} />
      <strong>{agent.name}</strong>
      <span class="st">{agentState.status}{agentState.contextPct !== undefined ? ` · ctx ${agentState.contextPct}%` : ""}</span>
      {#if agentState.error}<span class="errtxt" title={agentState.error}>{agentState.error}</span>{/if}
      <span class="grow"></span>
      {#if !compact}
        {#if agentState.status === "stopped" || agentState.status === "error"}
          <button onclick={() => act("launch")}>Launch</button>
        {:else}
          <button onclick={() => act("compact")}>Compact</button>
          <button onclick={() => act("stop")}>Stop</button>
        {/if}
        <button onclick={() => act("clear")}>Clear</button>
      {/if}
      {#if onclose}<button class="x" aria-label="Close tile" onclick={onclose}>×</button>{/if}
    </header>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="log" bind:this={scroller} {onclick}>
      {#each visible as ev (ev)}
        <MessageItem {ev} result={ev.kind === "tool_use" ? results.get(ev.id) : undefined} projectId={agent.projectId} {agentId} />
      {/each}
      {#each approvals as a (a.id)}<ApprovalCard approval={a} />{/each}
      {#if !events.length && !approvals.length}<p class="hint">No messages yet. Type below to start {agent.name}.</p>{/if}
    </div>
    {#if !compact}<PromptBox {agentId} name={agent.name} {focused} />{/if}
  </section>
{/if}

<style>
  .pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; height: 100%; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .pane.focused { border-color: var(--accent); }
  header { display: flex; align-items: center; gap: 7px; padding: 6px 10px; border-bottom: 1px solid var(--line); min-width: 0; }
  header button { padding: 2px 8px; font-size: 12px; }
  .slot { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 3px; padding: 0 4px; }
  .st { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .errtxt { color: var(--bad); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .x { border: 0; background: none; font-size: 16px; }
  .log { flex: 1; overflow-y: auto; padding: 4px 12px; min-height: 0; }
  .compact .log { font-size: 12px; }
</style>
