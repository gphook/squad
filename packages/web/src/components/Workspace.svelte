<script lang="ts">
  import type { SlotKey } from "@squad/shared";
  import { closeTile, moveTile, openAgents, openTile, pressAlt, pruneLayout, toggleMaximise } from "../lib/layout.ts";
  import { clampSplit, loadSplit, saveSplit, stepSplit } from "../lib/split.ts";
  import { layout as currentLayout, saveLayout, ui } from "../lib/state.svelte.ts";
  import ChatPane from "./ChatPane.svelte";

  const AGENT = "text/squad-agent";
  const TILE = "text/squad-tile";
  // Tiles of deleted squadmates are dropped from view; the saved layout catches up on its next save.
  const layout = $derived(pruneLayout(currentLayout(), ui.s.agents.map((a) => a.id)));
  const tiles = $derived(openAgents(layout));
  const big = $derived(layout.maximised);
  const side = $derived(tiles.filter(([, id]) => id !== big));
  // The cursor follows the tile you maximise (a header double-click doesn't move focus by itself).
  const maximise = (id: string) => {
    saveLayout(toggleMaximise(layout, id));
    ui.focus = id;
  };

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

  // The bar between the maximised tile and the side column: drag it (or use the arrow keys) to change the split,
  // double-click it to go back to the default.
  let split = $state(loadSplit());
  let dragging = $state(false);
  let row: HTMLDivElement | undefined = $state();
  function startDrag(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
  }
  function drag(e: PointerEvent) {
    if (!dragging || !row) return;
    const r = row.getBoundingClientRect();
    split = clampSplit((e.clientX - r.left) / r.width);
  }
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    saveSplit(split);
  }
  function splitKey(e: KeyboardEvent) {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    split = stepSplit(split, dir);
    saveSplit(split);
  }
  function resetSplit() {
    split = null;
    saveSplit(null);
  }
</script>

<svelte:window {onkeydown} />

{#snippet tile(slot: SlotKey, id: string)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tile" ondragover={accepts} ondrop={(e) => dropOnTile(e, slot)} onfocusin={() => (ui.focus = id)}>
    <ChatPane agentId={id} {slot} focused={ui.focus === id} maximised={big === id}
      onmaximise={() => maximise(id)} onclose={() => close(id)} ondragstart={(e) => dragTile(e, id)} />
  </div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<main class="workspace" ondragover={accepts} ondrop={dropOnArea}>
  {#if !ui.s.agents.length}
    <p class="hint center">Add a squadmate to get started.</p>
  {:else if !tiles.length}
    <p class="hint center">Click a squadmate to open it here.</p>
  {:else if big}
    <div class="maximised" class:dragging bind:this={row}>
      <!-- Keyed so a different squadmate gets a fresh pane (focus, scroll) rather than the last one's. -->
      <div class="big" class:sized={split !== null && side.length} style:--split={split}>
        {#key big}{@render tile(tiles.find(([, id]) => id === big)![0], big)}{/key}
      </div>
      {#if side.length}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div class="splitter" role="separator" aria-orientation="vertical" aria-label="Resize the maximised tile"
          aria-valuemin={30} aria-valuemax={90} aria-valuenow={split === null ? undefined : Math.round(split * 100)}
          tabindex="0" title="Drag to resize · double-click to reset"
          onpointerdown={startDrag} onpointermove={drag} onpointerup={endDrag} onpointercancel={endDrag}
          onlostpointercapture={endDrag} ondblclick={resetSplit} onkeydown={splitKey}></div>
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
  .maximised { flex: 1; display: flex; min-width: 0; }
  .maximised.dragging { cursor: col-resize; user-select: none; }
  .big { flex: 3; min-width: 0; display: flex; }
  .big.sized { flex: 0 1 calc(var(--split) * 100%); }
  .big.sized + .splitter + .side { max-width: none; }
  /* Sits in the gap between the columns; a line shows on hover, focus or drag. */
  .splitter { flex: 0 0 8px; cursor: col-resize; position: relative; touch-action: none; outline: none; }
  .splitter::after { content: ""; position: absolute; inset: 0 3px; border-radius: 1px; }
  .splitter:hover::after, .splitter:focus-visible::after, .dragging .splitter::after { background: var(--accent); }
  .big > .tile { flex: 1; }
  /* The other tiles stay full chats; the column scrolls once they'd get too short to use. */
  .side { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 200px; max-width: 460px; overflow-y: auto; }
  .side > .tile { flex: 1 0 220px; }
  .tile { min-height: 0; min-width: 0; }
  @media (max-width: 800px) {
    .maximised { flex-direction: column; gap: 8px; }
    .big.sized { flex: 3; }
    .splitter { display: none; }
    .side { max-width: none; min-width: 0; }
  }
</style>
