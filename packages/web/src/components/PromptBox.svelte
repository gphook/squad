<script lang="ts">
  import { send } from "../lib/state.svelte.ts";
  let { agentId, name, focused }: { agentId: string; name: string; focused: boolean } = $props();
  let text = $state("");
  let images = $state<string[]>([]);
  let el: HTMLTextAreaElement;

  $effect(() => { if (focused) el?.focus(); });

  function submit() {
    if (!text.trim() && !images.length) return;
    send({ t: "agent.send", agentId, text, ...(images.length ? { images } : {}) });
    text = "";
    images = [];
  }
  function onkey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  }
  function addFiles(files: FileList | null | undefined) {
    for (const f of [...(files ?? [])].filter((f) => f.type.startsWith("image/"))) {
      const r = new FileReader();
      r.onload = () => (images = [...images, String(r.result)]);
      r.readAsDataURL(f);
    }
  }
</script>

<div class="prompt" role="group" aria-label="Message {name}"
  ondragover={(e) => e.dataTransfer?.types.includes("Files") && e.preventDefault()}
  ondrop={(e) => { if (e.dataTransfer?.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } }}>
  {#if images.length}
    <div class="att">{#each images as src, i}<button onclick={() => (images = images.filter((_, j) => j !== i))} title="Remove"><img {src} alt="attachment" /></button>{/each}</div>
  {/if}
  <textarea bind:this={el} bind:value={text} rows="2" placeholder="Message {name}…" onkeydown={onkey}
    onpaste={(e) => { if (e.clipboardData?.files.length) addFiles(e.clipboardData.files); }}></textarea>
</div>

<style>
  .prompt { border-top: 1px solid var(--line); padding: 6px; }
  textarea { width: 100%; resize: vertical; min-height: 40px; }
  .att { display: flex; gap: 4px; margin-bottom: 4px; }
  .att button { padding: 0; border: 1px solid var(--line); }
  .att img { height: 48px; display: block; border-radius: 4px; }
</style>
