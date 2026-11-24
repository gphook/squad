<script lang="ts">
  import { send, ui } from "../lib/state.svelte.ts";

  type Tab = "installed" | "discover" | "markets";
  let tab = $state<Tab>("installed");

  const project = $derived(ui.s.projects.find((p) => p.id === ui.s.projectId));
  const data = $derived(ui.s.plugins);

  // Ask for a fresh snapshot whenever the view opens on a project.
  $effect(() => {
    const projectId = ui.s.projectId;
    if (projectId) send({ t: "plugins.get", projectId });
  });

  const tabs = $derived<[Tab, string, string][]>([
    ["installed", "Installed", data ? String(data.installed.length) : ""],
    ["discover", "Discover", data ? data.available.toLocaleString() : ""],
    ["markets", "Marketplaces", data ? String(data.marketplaces.length) : ""],
  ]);
</script>

<section class="plugins" aria-label="Plugins">
  <div class="head">
    <h2>Plugins</h2>
    {#if project}<span class="hint">{project.name} · {ui.s.agents.length} squadmate{ui.s.agents.length === 1 ? "" : "s"}</span>{/if}
  </div>
  <div class="tabs" role="tablist">
    {#each tabs as [id, label, count]}
      <button type="button" role="tab" aria-selected={tab === id} onclick={() => (tab = id)}>{label}<span class="count">{count}</span></button>
    {/each}
  </div>
  {#if !data}
    <p class="hint">Loading plugins…</p>
  {:else}
    <p class="hint">{tab}</p>
  {/if}
</section>

<style>
  .plugins { padding: 14px 16px 28px; display: flex; flex-direction: column; gap: 14px; overflow: auto; min-height: 0; height: 100%; }
  .head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  h2 { margin: 0; font-size: 18px; }
  .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .tabs button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: 6px 12px; background: none; color: var(--muted); }
  .tabs button[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }
  .count { font-size: 11px; color: var(--muted); margin-left: 4px; font-weight: 400; }
</style>
