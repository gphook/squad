<script lang="ts">
  import type { AvailablePlugin, PluginInventory } from "@squad/shared";
  import { send, ui } from "../../lib/state.svelte.ts";

  const data = $derived(ui.s.plugins!);
  const mate = $derived(ui.s.agents.find((a) => a.id === ui.pluginMate) ?? ui.s.agents[0] ?? null);
  const results = $derived(ui.s.pluginResults);

  let query = $state("");
  let market = $state<string | null>(null);
  let menu = $state<string | null>(null);
  let installing = $state<string | null>(null);
  $effect(() => { void ui.s.plugins; void ui.s.pluginError; installing = null; });

  // Search as the user types, a moment after they stop; again after any change (an install moves a plugin out).
  $effect(() => {
    const q = query, m = market;
    void ui.s.plugins;
    const timer = setTimeout(() => send({ t: "plugins.search", query: q, marketplace: m }), 200);
    return () => clearTimeout(timer);
  });

  const installed = $derived(new Set(data.installed.map((p) => p.id)));
  const parts = (inv: PluginInventory | undefined) => Object.entries(inv ?? {}).filter(([, n]) => n)
    .map(([k, n]) => `${n} ${n === 1 ? k.replace(/s$/, "").replace("mcpServer", "MCP server") : k.replace("mcpServers", "MCP servers")}`);

  function install(p: AvailablePlugin, agentId: string | null) {
    menu = null;
    installing = p.id;
    send({ t: "plugins.install", projectId: ui.s.projectId!, pluginId: p.id, agentId });
  }

  function closeMenu(e: MouseEvent | KeyboardEvent) {
    if (!menu) return;
    if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest(".split")) menu = null;
  }
</script>

<svelte:window onclick={closeMenu} onkeydown={closeMenu} />

<div class="toolbar">
  <input type="search" bind:value={query} aria-label="Search plugins"
    placeholder="Search {data.available.toLocaleString()} plugins in {data.marketplaces.length} marketplaces" />
  <select aria-label="Marketplace" value={market ?? ""} onchange={(e) => (market = e.currentTarget.value || null)}>
    <option value="">All marketplaces</option>
    {#each data.marketplaces as m (m.name)}<option value={m.name}>{m.name}</option>{/each}
  </select>
</div>

{#if ui.s.pluginError?.action === "plugins.install"}<p class="error" role="alert">{ui.s.pluginError.message}</p>{/if}

{#if results && results.items.length}
  {#if results.total > results.items.length}
    <p class="hint">Showing {results.items.length} of {results.total.toLocaleString()}. Search to narrow it down.</p>
  {/if}
  <div class="results">
    {#each results.items as p (p.id)}
      <article class="card">
        <div class="row"><span class="name">{p.name}</span><span class="tag">{p.marketplace}</span></div>
        <p>{p.description}</p>
        {#if parts(p.inventory).length}<div class="inv">{#each parts(p.inventory) as part}<span>{part}</span>{/each}</div>{/if}
        <div class="foot">
          {#if p.tokens}<span>{p.tokens} tokens</span>{/if}
          {#if p.installs}<span>{p.installs.toLocaleString()} installs</span>{/if}
          <span class="grow"></span>
          {#if installed.has(p.id)}
            <span class="ok">Installed</span>
          {:else if installing === p.id}
            <span class="hint">Installing…</span>
          {:else}
            <span class="split">
              <button type="button" class="primary" disabled={installing !== null || !mate} onclick={() => install(p, mate!.id)}>
                Install for {mate?.name ?? "a squadmate"}</button>
              <button type="button" class="primary caret" disabled={installing !== null} aria-haspopup="menu"
                aria-expanded={menu === p.id} aria-label="More ways to install {p.name}"
                onclick={() => (menu = menu === p.id ? null : p.id)}>▾</button>
              {#if menu === p.id}
                <span class="menu" role="menu">
                  <button type="button" role="menuitem" onclick={() => install(p, null)}>Install for the entire squad</button>
                </span>
              {/if}
            </span>
          {/if}
        </div>
      </article>
    {/each}
  </div>
{:else if results}
  <p class="hint">No plugins match "{results.query}". Try fewer words, or another marketplace.</p>
{:else}
  <p class="hint">Searching…</p>
{/if}

<style>
  .toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
  .toolbar input { flex: 1 1 240px; min-width: 0; }
  .error { margin: 0; color: var(--bad); font-size: 13px; }
  .results { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
  .card { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .row { display: flex; gap: 8px; align-items: baseline; }
  .name { font-weight: 600; flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .tag { font-size: 11px; padding: 0 6px; border-radius: 4px; background: var(--code); color: var(--muted); }
  .card p { margin: 0; font-size: 13px; color: var(--muted); }
  .inv { display: flex; flex-wrap: wrap; gap: 6px; }
  .inv span { background: var(--code); border-radius: 5px; padding: 1px 7px; font-size: 12px; }
  .foot { display: flex; gap: 8px; align-items: center; margin-top: auto; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
  .ok { color: var(--ok); font-weight: 600; }
  .split { position: relative; display: inline-flex; }
  .split > button:first-child { border-radius: 6px 0 0 6px; }
  .caret { border-radius: 0 6px 6px 0; border-left: 1px solid color-mix(in srgb, var(--on-accent) 35%, var(--accent)); padding: 4px 7px; }
  .menu { position: absolute; right: 0; top: calc(100% + 4px); background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
    padding: 4px; box-shadow: 0 6px 20px #0003; z-index: 5; white-space: nowrap; }
  .menu button { border: 0; width: 100%; text-align: left; color: var(--text); }
</style>
