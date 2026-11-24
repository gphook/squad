<script lang="ts">
  import { marketplaceSourceError } from "@squad/shared";
  import { send, ui } from "../../lib/state.svelte.ts";

  const data = $derived(ui.s.plugins!);
  let source = $state("");
  let localError = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let removing = $state<string | null>(null);
  $effect(() => { void ui.s.plugins; void ui.s.pluginError; busy = null; });
  // The form clears once the added marketplace shows up; after an error it keeps what was typed.
  let added = $state<string | null>(null);
  $effect(() => {
    if (added && ui.s.plugins?.marketplaces.some((m) => m.location === added)) { source = ""; added = null; }
  });

  const serverError = $derived(ui.s.pluginError?.action.startsWith("marketplace.") ? ui.s.pluginError.message : null);
  const ago = (iso: string) => {
    const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
    return days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  };

  function add(e: SubmitEvent) {
    e.preventDefault();
    localError = marketplaceSourceError(source);
    if (localError) return;
    busy = "add";
    added = source.trim();
    send({ t: "marketplace.add", source: source.trim() });
  }
</script>

<p class="explain">Marketplaces are shared with your terminal: adding one here adds it for Claude Code everywhere on this machine.</p>

<div class="list">
  {#each data.marketplaces as m (m.name)}
    <div class="row">
      <div><span class="name">{m.name}</span>{#if m.official}<span class="tag">Anthropic</span>{/if}</div>
      <div class="src">{m.source} · {m.location} · {m.pluginCount.toLocaleString()} plugins · updated {ago(m.updatedAt)}</div>
      <div class="acts">
        {#if removing === m.name}
          <span class="confirm">Remove {m.name}? Its installed plugins stay until you uninstall them.</span>
          <button type="button" onclick={() => (removing = null)}>Cancel</button>
          <button type="button" class="danger" onclick={() => { busy = m.name; removing = null; send({ t: "marketplace.remove", name: m.name }); }}>Remove</button>
        {:else}
          <button type="button" disabled={busy !== null} onclick={() => { busy = m.name; send({ t: "marketplace.update", name: m.name }); }}>
            {busy === m.name ? "Working…" : "Update"}</button>
          {#if !m.official}<button type="button" class="danger" disabled={busy !== null} onclick={() => (removing = m.name)}>Remove</button>{/if}
        {/if}
      </div>
    </div>
  {/each}
</div>

<form class="add" onsubmit={add}>
  <strong>Add a marketplace</strong>
  <div class="line">
    <input bind:value={source} aria-label="Marketplace source" placeholder="owner/repo, a git URL, a marketplace.json URL, or a local path"
      oninput={() => (localError = null)} />
    <button type="submit" class="primary" disabled={busy !== null}>{busy === "add" ? "Adding…" : "Add"}</button>
  </div>
  <span class="hint">Examples: <code>acme/claude-plugins</code> · <code>https://example.com/marketplace.json</code> · <code>~/dev/my-plugins</code></span>
  {#if localError ?? serverError}<span class="error" role="alert">{localError ?? serverError}</span>{/if}
</form>

<style>
  .explain { margin: 0; font-size: 13px; color: var(--muted); max-width: 75ch; }
  .list { display: grid; gap: 8px; }
  .row { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: center; border: 1px solid var(--line);
    background: var(--panel); border-radius: 8px; padding: 10px 12px; }
  .name { font-weight: 600; }
  .tag { font-size: 11px; padding: 0 6px; border-radius: 4px; background: var(--code); color: var(--muted); margin-left: 6px; }
  .src { grid-column: 1; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
  .acts { grid-row: 1 / span 2; grid-column: 2; display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
  .confirm { font-size: 13px; }
  .add { border: 1px dashed var(--line); border-radius: 8px; padding: 12px; display: grid; gap: 8px; }
  .line { display: flex; gap: 8px; flex-wrap: wrap; }
  .line input { flex: 1 1 260px; min-width: 0; }
  .error { color: var(--bad); font-size: 13px; }
  @media (max-width: 600px) { .row { grid-template-columns: 1fr; } .acts { grid-row: auto; grid-column: 1; justify-content: flex-start; } }
</style>
