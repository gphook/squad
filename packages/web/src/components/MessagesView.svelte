<script lang="ts">
  import { firstLine } from "@squad/shared";
  import { ui } from "../lib/state.svelte.ts";
  let { onjump }: { onjump: (agentId: string) => void } = $props();
  let filter = $state("");
  let expanded = $state<Set<string>>(new Set());
  const list = $derived(
    [...ui.s.messages].reverse().filter((m) => !filter || m.from === filter || m.to === filter),
  );
  const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const agentIdOf = (name: string) => ui.s.agents.find((a) => a.name === name)?.id;
  const toggle = (id: string) => {
    const s = new Set(expanded);
    if (!s.delete(id)) s.add(id);
    expanded = s;
  };
</script>

<main class="view">
  <header>
    <h2>Messages</h2>
    <select bind:value={filter} aria-label="Filter by agent">
      <option value="">All agents</option>
      {#each ui.s.agents as a}<option value={a.name}>{a.name}</option>{/each}
    </select>
  </header>
  {#if !list.length}<p class="hint">No messages between agents yet.</p>{/if}
  <ul>
    {#each list as m (m.id)}
      <li>
        <span class="t">{time(m.at)}</span>
        <button class="who" onclick={() => { const id = agentIdOf(m.from) ?? agentIdOf(m.to); if (id) onjump(id); }}>
          {m.from}{m.external ? " (outside session)" : ""} → {m.to}
        </button>
        <button class="body" onclick={() => toggle(m.id)} aria-expanded={expanded.has(m.id)}>
          {#if expanded.has(m.id)}<span class="full">{m.text}</span>{:else}{firstLine(m.text)}{/if}
        </button>
      </li>
    {/each}
  </ul>
</main>

<style>
  .view { flex: 1; overflow-y: auto; padding: 12px 18px; }
  header { display: flex; align-items: center; gap: 12px; }
  h2 { font-size: 16px; margin: 0; }
  ul { list-style: none; padding: 0; }
  li { display: grid; grid-template-columns: 50px 220px 1fr; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--line); align-items: start; }
  .t { color: var(--muted); font-size: 12px; }
  .who { background: none; border: 0; padding: 0; text-align: left; font-weight: 600; }
  .body { background: none; border: 0; padding: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .full { white-space: pre-wrap; }
  @media (max-width: 800px) { li { grid-template-columns: 1fr; } }
</style>
