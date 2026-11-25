<script lang="ts">
  import type { Approval } from "@squad/shared";
  import { send } from "../lib/state.svelte.ts";
  import { renderMarkdown, type FileCtx } from "../lib/markdown.ts";
  let { approval, plan, ctx }: { approval: Approval; plan: string; ctx: FileCtx } = $props();

  // "Keep planning" opens a feedback box first; sending it (empty is fine) tells the squadmate to revise.
  let revising = $state(false);
  let feedback = $state("");

  const approve = () => send({ t: "approval.answer", approvalId: approval.id, decision: "allow" });
  const keepPlanning = () => {
    const f = feedback.trim();
    send({ t: "approval.answer", approvalId: approval.id, decision: "deny", ...(f ? { feedback: f } : {}) });
  };
</script>

<div class="plan" role="group" aria-label="Plan for approval">
  <div class="title">Plan ready for approval</div>
  <div class="body md">{@html renderMarkdown(plan, ctx)}</div>
  {#if revising}
    <!-- svelte-ignore a11y_autofocus -->
    <textarea class="feedback" rows="3" placeholder="What should change? (optional)" aria-label="Feedback on the plan"
      bind:value={feedback} autofocus
      onkeydown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) keepPlanning(); }}></textarea>
    <div class="btns">
      <button class="primary" onclick={keepPlanning}>Send feedback</button>
      <button onclick={() => (revising = false)}>Back</button>
    </div>
  {:else}
    <div class="btns">
      <button class="primary" onclick={approve}>Approve</button>
      <button onclick={() => (revising = true)}>Keep planning</button>
    </div>
  {/if}
</div>

<style>
  .plan { border: 1px solid var(--accent); border-radius: 8px; padding: 8px 10px; margin: 6px 0; background: color-mix(in srgb, var(--accent) 8%, var(--bg)); }
  .title { font-weight: 600; margin-bottom: 4px; }
  .body { max-height: 420px; overflow: auto; padding: 0 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); overflow-wrap: anywhere; }
  .feedback { width: 100%; box-sizing: border-box; resize: vertical; font: inherit; margin-top: 6px; }
  .btns { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
</style>
