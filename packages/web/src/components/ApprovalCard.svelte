<script lang="ts">
  import type { Approval, ApprovalDecision } from "@squad/shared";
  import { send } from "../lib/state.svelte.ts";
  let { approval }: { approval: Approval } = $props();
  let open = $state(false);
  const answer = (decision: ApprovalDecision) => send({ t: "approval.answer", approvalId: approval.id, decision });
</script>

<div class="approval" role="group" aria-label="Approval for {approval.toolName}">
  <div class="what"><strong>⚠ {approval.toolName}</strong> <code>{approval.summary}</code>
    <button class="link" onclick={() => (open = !open)}>{open ? "hide" : "details"}</button></div>
  {#if open}<pre>{JSON.stringify(approval.input, null, 2)}</pre>{/if}
  <div class="btns">
    <button class="primary" onclick={() => answer("allow")}>Allow</button>
    <button onclick={() => answer("deny")}>Deny</button>
    {#if approval.canAlways}<button onclick={() => answer("always")}>Allow always this session</button>{/if}
  </div>
</div>

<style>
  .approval { border: 1px solid var(--warn); border-radius: 8px; padding: 8px 10px; margin: 6px 0; background: color-mix(in srgb, var(--warn) 8%, var(--panel)); }
  .what { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  code { overflow-wrap: anywhere; }
  .btns { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
  .link { background: none; border: 0; color: var(--muted); padding: 0; }
  pre { background: var(--code); padding: 6px; border-radius: 6px; overflow: auto; max-height: 200px; font-size: 12px; }
</style>
