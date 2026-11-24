<script lang="ts">
  import { parseShellInput } from "@squad/shared";
  import { send, ui } from "../lib/state.svelte.ts";
  import { completion, isWholeCommand, matchCommands, pickerQuery } from "../lib/commands.ts";
  import { draftFor } from "../lib/drafts.svelte.ts";
  let { agentId, name, focused }: { agentId: string; name: string; focused: boolean } = $props();
  const draft = $derived(draftFor(agentId));
  let el: HTMLTextAreaElement;

  $effect(() => { if (focused) el?.focus(); });

  // Shell commands go to a shell or the squadmate's Bash tool, neither of which takes images.
  const shellWithImages = $derived(draft.images.length > 0 && parseShellInput(draft.text) !== null);

  // The `/` picker: open while a command name is being typed, until Esc or a pick.
  const query = $derived(pickerQuery(draft.text));
  const matches = $derived(query === null ? [] : matchCommands(ui.s.commands[agentId] ?? [], query));
  let dismissed = $state(false);
  let active = $state(0);
  const pickerOpen = $derived(matches.length > 0 && !dismissed);
  $effect(() => { if (query === null) dismissed = false; });
  $effect(() => { void query; active = 0; });

  function pick(i: number) {
    draft.text = completion(matches[i]);
    el?.focus();
  }
  // Typed in full, `/clear` + Enter runs it, as in the terminal; a partial name is completed instead.
  const exact = () => isWholeCommand(query ?? "", ui.s.commands[agentId] ?? []);

  function pickerKey(e: KeyboardEvent): boolean {
    if (!pickerOpen) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const step = e.key === "ArrowDown" ? 1 : -1;
      active = (active + step + matches.length) % matches.length;
    } else if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.isComposing && !exact())) {
      pick(active);
    } else if (e.key === "Escape") {
      dismissed = true;
    } else return false;
    e.preventDefault();
    return true;
  }

  function submit() {
    if ((!draft.text.trim() && !draft.images.length) || shellWithImages) return;
    send({ t: "agent.send", agentId, text: draft.text, ...(draft.images.length ? { images: draft.images } : {}) });
    draft.text = "";
    draft.images = [];
  }
  function onkey(e: KeyboardEvent) {
    if (pickerKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  }
  function addFiles(files: FileList | null | undefined) {
    for (const f of [...(files ?? [])].filter((f) => f.type.startsWith("image/"))) {
      const r = new FileReader();
      r.onload = () => (draft.images = [...draft.images, String(r.result)]);
      r.readAsDataURL(f);
    }
  }
</script>

<div class="prompt" role="group" aria-label="Message {name}"
  ondragover={(e) => e.dataTransfer?.types.includes("Files") && e.preventDefault()}
  ondrop={(e) => { if (e.dataTransfer?.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } }}>
  {#if pickerOpen}
    <ul class="picker" role="listbox" aria-label="Commands">
      {#each matches as c, i (c.name)}
        <li role="option" aria-selected={i === active}>
          <button class:active={i === active} onmousedown={(e) => { e.preventDefault(); pick(i); }}>
            <span class="name">/{c.name}</span>{#if c.argumentHint}<span class="hint-arg">{c.argumentHint}</span>{/if}
            <span class="desc">{c.description}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if draft.images.length}
    <div class="att">{#each draft.images as src, i}<button onclick={() => (draft.images = draft.images.filter((_, j) => j !== i))} title="Remove"><img {src} alt="attachment" /></button>{/each}</div>
  {/if}
  <textarea bind:this={el} bind:value={draft.text} rows="2" placeholder="Message {name}…   / for commands · !cmd: {name} runs it · $ cmd: run it here" onkeydown={onkey}
    onpaste={(e) => { if (e.clipboardData?.files.length) addFiles(e.clipboardData.files); }}></textarea>
  {#if shellWithImages}<div class="hint" role="alert">Shell commands can't carry images. Remove them to send.</div>{/if}
</div>

<style>
  .prompt { border-top: 1px solid var(--line); padding: 6px; position: relative; }
  .picker { position: absolute; bottom: 100%; left: 6px; right: 6px; margin: 0 0 2px; padding: 4px; list-style: none;
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 4px 16px rgb(0 0 0 / 0.15); z-index: 5; }
  .picker button { display: flex; gap: 8px; align-items: baseline; width: 100%; text-align: left; border: 0; background: none;
    padding: 4px 8px; border-radius: 5px; cursor: pointer; color: inherit; }
  .picker button.active { background: var(--hover); }
  .picker .name { font-family: var(--mono, monospace); white-space: nowrap; }
  .picker .hint-arg { color: var(--muted); white-space: nowrap; }
  .picker .desc { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
  textarea { width: 100%; resize: vertical; min-height: 40px; }
  .att { display: flex; gap: 4px; margin-bottom: 4px; }
  .att button { padding: 0; border: 1px solid var(--line); }
  .att img { height: 48px; display: block; border-radius: 4px; }
</style>
