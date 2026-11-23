<script lang="ts">
  import { SQUAD_TOOL_PREFIX, isExternalUrl, type AgentEvent } from "@squad/shared";
  import { fileUrl, renderMarkdown } from "../lib/markdown.ts";
  import { ui } from "../lib/state.svelte.ts";

  let { ev, result, projectId, agentId }: {
    ev: AgentEvent; result?: Extract<AgentEvent, { kind: "tool_result" }>; projectId: string; agentId: string;
  } = $props();
  let open = $state(false);
  const ctx = $derived({ projectId, agentId });
  const isImage = (t: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(t.split("?")[0]);
  const showUrl = (t: string) => (isExternalUrl(t) ? t : fileUrl(ctx, t));
</script>

{#if ev.kind === "user_text"}
  <div class="msg user">
    <div class="text">{ev.text}</div>
    {#each ev.images ?? [] as src}<button class="imgbtn" onclick={() => (ui.viewer = src)}><img class="thumb" {src} alt="attached" /></button>{/each}
  </div>
{:else if ev.kind === "text_delta"}
  <div class="msg streaming">{ev.text}</div>
{:else if ev.kind === "assistant_text"}
  <div class="msg md">{@html renderMarkdown(ev.text, ctx)}</div>
{:else if ev.kind === "tool_use"}
  <div class="tool" class:err={result?.isError}>
    <button class="toolhead" onclick={() => (open = !open)} aria-expanded={open}>
      <span class="chev">{open ? "▾" : "▸"}</span> <strong>{ev.name.replace(SQUAD_TOOL_PREFIX, "")}</strong>
      <span class="sum">{ev.summary}</span>
    </button>
    {#if result?.images?.length}
      <div class="imgs">{#each result.images as src}<button class="imgbtn" onclick={() => (ui.viewer = src)}><img class="thumb" {src} alt="tool output" /></button>{/each}</div>
    {/if}
    {#if open}
      <pre>{JSON.stringify(ev.input, null, 2)}</pre>
      {#if result}<pre class="out">{result.text.slice(0, 20000)}</pre>{/if}
    {/if}
  </div>
{:else if ev.kind === "peer_in"}
  <div class="peer">⇠ from <strong>{ev.from}</strong>: {ev.text}</div>
{:else if ev.kind === "peer_out"}
  <div class="peer">⇢ to <strong>{ev.to}</strong>: {ev.text}</div>
{:else if ev.kind === "show"}
  <figure class="show">
    {#if isImage(ev.target)}
      {#if isExternalUrl(ev.target)}
        <a href={ev.target} target="_blank" rel="noopener noreferrer">{ev.target}</a>
      {:else}
        <button class="imgbtn" onclick={() => (ui.viewer = showUrl(ev.target))}><img class="thumb" src={showUrl(ev.target)} alt={ev.caption ?? ev.target} /></button>
      {/if}
    {:else}
      <a href={showUrl(ev.target)} target="_blank" rel="noopener noreferrer">📄 {ev.target}</a>
    {/if}
    {#if ev.caption}<figcaption>{ev.caption}</figcaption>{/if}
  </figure>
{:else if ev.kind === "compacted"}
  <div class="divider">conversation compacted</div>
{:else if ev.kind === "turn_end" && !ev.ok}
  <div class="divider err">turn ended: {ev.error}</div>
{/if}

<style>
  .msg { margin: 8px 0; }
  .streaming { white-space: pre-wrap; }
  .user .text { white-space: pre-wrap; background: var(--hover); padding: 6px 10px; border-radius: 8px; display: inline-block; max-width: 100%; }
  .md :global(pre) { background: var(--code); padding: 8px; border-radius: 6px; overflow: auto; }
  .md :global(code) { background: var(--code); padding: 0 3px; border-radius: 3px; }
  .md :global(p) { margin: 6px 0; }
  .md :global(a.ext-img) { color: var(--muted); }
  :global(img.thumb) { max-width: min(320px, 100%); max-height: 220px; border-radius: 6px; border: 1px solid var(--line); cursor: zoom-in; display: block; }
  .imgbtn { padding: 0; border: 0; background: none; margin: 4px 4px 0 0; display: inline-block; }
  .tool { border-left: 2px solid var(--line); padding-left: 8px; margin: 4px 0; font-size: 13px; }
  .tool.err { border-color: var(--bad); }
  .toolhead { background: none; border: 0; padding: 2px 0; display: flex; gap: 6px; width: 100%; text-align: left; color: var(--muted); }
  .toolhead strong { color: var(--text); font-weight: 600; }
  .sum { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, monospace; }
  .chev { width: 10px; }
  pre { background: var(--code); padding: 6px; border-radius: 6px; overflow: auto; max-height: 300px; font-size: 12px; }
  .peer { margin: 6px 0; padding: 4px 8px; border-radius: 6px; background: color-mix(in srgb, var(--accent) 10%, transparent); white-space: pre-wrap; }
  .show { margin: 8px 0; }
  figcaption { color: var(--muted); font-size: 12px; }
  .divider { text-align: center; color: var(--muted); font-size: 12px; margin: 10px 0; }
  .divider.err { color: var(--bad); }
</style>
