<script lang="ts">
  import { tick } from "svelte";

  /** Text that reads as a label and becomes an input when clicked. Enter or leaving keeps the edit; Escape undoes it. */
  let { value = $bindable(), label, placeholder = "" }: { value: string; label: string; placeholder?: string } = $props();

  let editing = $state(false);
  let draft = $state("");
  let input = $state<HTMLInputElement>();

  async function start() {
    draft = value;
    editing = true;
    await tick();
    input?.select();
  }
  function commit() {
    if (!editing) return;
    value = draft;
    editing = false;
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault(); // don't submit the dialog's form
      commit();
    } else if (e.key === "Escape") {
      e.stopPropagation(); // undo this edit only, not close anything around it
      editing = false;
    }
  }
</script>

{#if editing}
  <input bind:this={input} bind:value={draft} aria-label={label} {onkeydown} onblur={commit} />
{:else}
  <button type="button" class="label" class:empty={!value} aria-label="{label}: {value || placeholder}. Click to edit" onclick={start}>
    <span class="text">{value || placeholder}</span><span class="pen" aria-hidden="true">✎</span>
  </button>
{/if}

<style>
  .label { background: none; border: 1px solid transparent; padding: 4px 6px; text-align: left; display: inline-flex; gap: 6px; align-items: baseline; max-width: 100%; min-width: 0; }
  .label:hover { border-color: var(--line); }
  .text { overflow-wrap: anywhere; }
  .empty .text { color: var(--muted); font-style: italic; }
  .pen { color: var(--muted); font-size: 12px; opacity: 0; }
  .label:hover .pen, .label:focus-visible .pen, .empty .pen { opacity: 1; }
  input { width: 100%; }
</style>
