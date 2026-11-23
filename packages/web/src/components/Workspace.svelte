<script lang="ts">
  import type { SlotKey } from "@squad/shared";
  import { closeTile, moveTile, openAgents, openTile, pressAlt, pruneLayout, toggleMaximise } from "../lib/layout.ts";
  import { layout as currentLayout, saveLayout, ui } from "../lib/state.svelte.ts";
  import ChatPane from "./ChatPane.svelte";

  const AGENT = "text/squad-agent";
  const TILE = "text/squad-tile";
  // Tiles of deleted squadmates are dropped from view; the saved layout catches up on its next save.
  const layout = $derived(pruneLayout(currentLayout(), ui.s.agents.map((a) => a.id)));
  const tiles = $derived(openAgents(layout));
  const big = $derived(layout.maximised);
  const side = $derived(tiles.filter(([, id]) => id !== big));
  const maximise = (id: string) => saveLayout(toggleMaximise(layout, id));

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

{#snippet tile(slot: SlotKey, id: string)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tile" draggable="true" ondragstart={(e) => dragTile(e, id)} ondragover={accepts} ondrop={(e) => dropOnTile(e, slot)}
    onfocusin={() => (ui.focus = id)}>
    <ChatPane agentId={id} {slot} focused={ui.focus === id} maximised={big === id}
      onmaximise={() => maximise(id)} onclose={() => close(id)} />
  </div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<main class="workspace" ondragover={accepts} ondrop={dropOnArea}>
  {#if !ui.s.agents.length}
    <p class="hint center">Add a squadmate to get started.</p>
  {:else if !tiles.length}
    <p class="hint center">Click a squadmate to open it here.</p>
  {:else if big}
    <div class="maximised">
      <!-- Keyed so a different squadmate gets a fresh pane (focus, scroll) rather than the last one's. -->
      <div class="big">{#key big}{@render tile(tiles.find(([, id]) => id === big)![0], big)}{/key}</div>
      {#if side.length}
        <div class="side">{#each side as [slot, id] (id)}{@render tile(slot, id)}{/each}</div>
      {/if}
    </div>
  {:else}
    <div class="grid" style="--cols: {Math.ceil(Math.sqrt(tiles.length))}">
      {#each tiles as [slot, id] (id)}{@render tile(slot, id)}{/each}
    </div>
  {/if}
</main>

<style>
  .workspace { flex: 1; min-width: 0; display: flex; padding: 8px; }
  .center { margin: auto; }
  .grid { flex: 1; display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); gap: 8px; }
  .maximised { flex: 1; display: flex; gap: 8px; min-width: 0; }
  .big { flex: 3; min-width: 0; display: flex; }
  .big > .tile { flex: 1; }
  /* The other tiles stay full chats; the column scrolls once they'd get too short to use. */
  .side { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; max-width: 460px; overflow-y: auto; }
  .side > .tile { flex: 1 0 220px; }
  .tile { min-height: 0; min-width: 0; }
  @media (max-width: 800px) { .maximised { flex-direction: column; } .side { max-width: none; } }
</style>
