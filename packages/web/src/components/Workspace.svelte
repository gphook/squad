<script lang="ts">
  import type { SlotKey } from "@squad/shared";
  import { closeTile, moveTile, openAgents, openTile, pressAlt, showInMain, slotOf } from "../lib/layout.ts";
  import { layout as currentLayout, saveLayout, ui } from "../lib/state.svelte.ts";
  import ChatPane from "./ChatPane.svelte";

  const AGENT = "text/squad-agent";
  const TILE = "text/squad-tile";
  const layout = $derived(currentLayout());
  const tiles = $derived(openAgents(layout).filter(([, id]) => ui.s.agents.some((a) => a.id === id)));
  const mainId = $derived(
    (layout.main && ui.s.agents.some((a) => a.id === layout.main) ? layout.main : null) ?? tiles[0]?.[1] ?? ui.s.agents[0]?.id ?? null,
  );
  const side = $derived(tiles.filter(([, id]) => id !== mainId));

  function onkeydown(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const m = /^Digit(\d)$/.exec(e.code);
    if (!m) return;
    e.preventDefault();
    const r = pressAlt(layout, m[1] as SlotKey);
    if (!r.focus) return;
    if (r.layout !== layout) saveLayout(r.layout);
    ui.focus = r.focus;
  }

  const accepts = (e: DragEvent) => {
    const types = e.dataTransfer?.types ?? [];
    if (types.includes(AGENT) || types.includes(TILE)) e.preventDefault();
  };
  function dropOnArea(e: DragEvent) {
    const id = e.dataTransfer?.getData(AGENT);
    if (id) { e.preventDefault(); saveLayout(openTile(layout, id)); }
  }
  function dropOnTile(e: DragEvent, slot: SlotKey) {
    const moving = e.dataTransfer?.getData(TILE);
    const adding = e.dataTransfer?.getData(AGENT);
    e.preventDefault();
    e.stopPropagation();
    if (moving) saveLayout(moveTile(layout, moving, slot));
    else if (adding) {
      const opened = openTile(layout, adding);
      saveLayout(moveTile(opened, adding, slot));
    }
  }
  const dragTile = (e: DragEvent, id: string) => e.dataTransfer?.setData(TILE, id);
  const close = (id: string) => saveLayout(closeTile(layout, id));
</script>

<svelte:window {onkeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<main class="workspace" ondragover={accepts} ondrop={dropOnArea}>
  {#if !mainId}
    <p class="hint center">Add an agent to get started.</p>
  {:else if layout.mode === "tiled" && tiles.length}
    <div class="grid" style="--cols: {Math.ceil(Math.sqrt(tiles.length))}">
      {#each tiles as [slot, id] (id)}
        <div class="tile" draggable="true" ondragstart={(e) => dragTile(e, id)} ondragover={accepts} ondrop={(e) => dropOnTile(e, slot)}
          onfocusin={() => (ui.focus = id)}>
          <ChatPane agentId={id} {slot} focused={ui.focus === id} onclose={() => close(id)} />
        </div>
      {/each}
    </div>
  {:else}
    <div class="focussed">
      <div class="main" onfocusin={() => (ui.focus = mainId)}>
        <ChatPane agentId={mainId} slot={slotOf(layout, mainId)} focused={ui.focus === mainId || !ui.focus}
          onclose={slotOf(layout, mainId) ? () => close(mainId!) : undefined} />
      </div>
      {#if side.length}
        <div class="side">
          {#each side as [slot, id] (id)}
            <div class="tile small" draggable="true" ondragstart={(e) => dragTile(e, id)} ondragover={accepts} ondrop={(e) => dropOnTile(e, slot)}>
              <button class="swap" aria-label="Show {slot} in main" onclick={() => { saveLayout(showInMain(layout, id)); ui.focus = id; }}></button>
              <ChatPane agentId={id} {slot} compact onclose={() => close(id)} />
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</main>

<style>
  .workspace { flex: 1; min-width: 0; display: flex; padding: 8px; }
  .center { margin: auto; }
  .grid { flex: 1; display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); gap: 8px; }
  .focussed { flex: 1; display: flex; gap: 8px; min-width: 0; }
  .main { flex: 2; min-width: 0; }
  .side { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; max-width: 420px; }
  .tile { min-height: 0; min-width: 0; position: relative; }
  .tile.small { flex: 1; }
  .swap { position: absolute; inset: 34px 0 0 0; background: transparent; border: 0; z-index: 1; cursor: pointer; border-radius: 0; }
  .swap:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); }
  @media (max-width: 800px) { .focussed { flex-direction: column; } .side { max-width: none; } }
</style>
