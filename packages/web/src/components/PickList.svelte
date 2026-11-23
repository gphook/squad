<script lang="ts">
  import { tick } from "svelte";
  import { PICKLIST_FILTER_THRESHOLD, filterOptions, reviewerLabel } from "../lib/activities.ts";

  /** A comma-separated choice that opens a dropdown checklist when clicked. */
  let { selected = $bindable(), options, label }: {
    selected: string[]; options: { id: string; name: string }[]; label: string;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let root = $state<HTMLElement>();
  let summary = $state<HTMLButtonElement>();
  const names = $derived(new Map(options.map((o) => [o.id, o.name])));
  const shown = $derived(filterOptions(options, query));

  function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
  }
  // Opening moves the keyboard into the list: the filter when there is one, else the first box.
  async function openList() {
    open = true;
    await tick();
    root?.querySelector<HTMLInputElement>(".drop input")?.focus();
  }
  function close() {
    open = false;
    query = "";
  }
  // While open: Escape closes just this dropdown (not the dialog around it), and so does a click outside.
  $effect(() => {
    if (!open || !root) return;
    const el = root;
    const outside = (e: Event) => { if (!el.contains(e.target as Node)) close(); };
    const escape = (e: KeyboardEvent) => {
      // Enter on the filter or a box must not submit the form this sits in.
      if (e.key === "Enter") e.preventDefault();
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
      void tick().then(() => summary?.focus());
    };
    document.addEventListener("pointerdown", outside);
    el.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      el.removeEventListener("keydown", escape);
    };
  });
</script>

<div class="picklist" bind:this={root} role="group" aria-label={label}>
  <button bind:this={summary} type="button" class="summary" aria-expanded={open} onclick={() => (open ? close() : openList())}>
    <span class="hint">{label}:</span> <span>{reviewerLabel(selected, names)}</span><span class="pen" aria-hidden="true">✎</span>
  </button>
  {#if open}
    <div class="drop">
      {#if options.length > PICKLIST_FILTER_THRESHOLD}
        <input type="search" bind:value={query} placeholder="Filter…" aria-label="Filter {label}" />
      {/if}
      {#each shown as o (o.id)}
        <label class="check"><input type="checkbox" checked={selected.includes(o.id)} onchange={() => toggle(o.id)} /> {o.name}</label>
      {:else}
        <span class="hint">{options.length ? "No match" : "No other squadmates"}</span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .picklist { position: relative; }
  .summary { background: none; border: 1px solid transparent; padding: 2px 6px; text-align: left; display: inline-flex; gap: 4px; align-items: baseline; font-size: 13px; }
  .summary:hover { border-color: var(--line); }
  .pen { color: var(--muted); font-size: 12px; margin-left: 4px; }
  .drop { position: absolute; z-index: 20; top: 100%; left: 0; min-width: 220px; max-height: 240px; overflow: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 6px 20px #0003; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
  .drop .check { font-weight: normal; display: flex; gap: 6px; align-items: center; }
  input[type="search"] { margin-bottom: 2px; }
</style>
