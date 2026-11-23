<script lang="ts">
  import { parseShellInput } from "@squad/shared";
  import { send } from "../lib/state.svelte.ts";
  import { draftFor } from "../lib/drafts.svelte.ts";
  let { agentId, name, focused }: { agentId: string; name: string; focused: boolean } = $props();
  const draft = $derived(draftFor(agentId));
  let el: HTMLTextAreaElement;

  $effect(() => { if (focused) el?.focus(); });

  // Shell commands go to a shell or the squadmate's Bash tool, neither of which takes images.
  const shellWithImages = $derived(draft.images.length > 0 && parseShellInput(draft.text) !== null);

  function submit() {
    if ((!draft.text.trim() && !draft.images.length) || shellWithImages) return;
    send({ t: "agent.send", agentId, text: draft.text, ...(draft.images.length ? { images: draft.images } : {}) });
    draft.text = "";
    draft.images = [];
  }
  function onkey(e: KeyboardEvent) {
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
  {#if draft.images.length}
    <div class="att">{#each draft.images as src, i}<button onclick={() => (draft.images = draft.images.filter((_, j) => j !== i))} title="Remove"><img {src} alt="attachment" /></button>{/each}</div>
  {/if}
  <textarea bind:this={el} bind:value={draft.text} rows="2" placeholder="Message {name}…   !cmd: {name} runs it · $ cmd: run it here" onkeydown={onkey}
    onpaste={(e) => { if (e.clipboardData?.files.length) addFiles(e.clipboardData.files); }}></textarea>
  {#if shellWithImages}<div class="hint" role="alert">Shell commands can't carry images. Remove them to send.</div>{/if}
</div>

<style>
  .prompt { border-top: 1px solid var(--line); padding: 6px; }
  textarea { width: 100%; resize: vertical; min-height: 40px; }
  .att { display: flex; gap: 4px; margin-bottom: 4px; }
  .att button { padding: 0; border: 1px solid var(--line); }
  .att img { height: 48px; display: block; border-radius: 4px; }
</style>
