<script lang="ts">
  import { send, ui } from "../lib/state.svelte.ts";
  import { chipLabel, chipTitle, chipTone } from "../lib/account.ts";

  let { now }: { now: number } = $props();

  const CHECK_EVERY_MS = 5_000;
  const COMMAND = "claude auth login";
  let open = $state(false);
  let copied = $state(false);
  let root = $state<HTMLElement>();

  const status = $derived(ui.s.auth);
  const needsHelp = $derived(status !== null && status.state !== "signedIn");

  // The panel closes itself once someone signs in.
  $effect(() => {
    if (open && status?.state === "signedIn") open = false;
  });
  // While the panel is open, ask the server to check again every few seconds.
  $effect(() => {
    if (!open) return;
    const t = setInterval(() => send({ t: "auth.check" }), CHECK_EVERY_MS);
    return () => clearInterval(t);
  });
  $effect(() => {
    if (!open || !root) return;
    const el = root;
    const outside = (e: Event) => { if (!el.contains(e.target as Node)) open = false; };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") open = false; };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  });

  function toggle() {
    if (!needsHelp) return;
    open = !open;
    if (open) send({ t: "auth.check" });
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(COMMAND);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      copied = false; // clipboard blocked: the command is still there to select
    }
  }
</script>

<div class="account" bind:this={root}>
  <button class="chip {chipTone(status)}" title={chipTitle(status, now)} aria-expanded={needsHelp ? open : undefined}
    aria-label="Claude account: {chipLabel(status)}" onclick={toggle}>{chipLabel(status)}</button>
  {#if open}
    <div class="panel" role="dialog" aria-label="Sign in to Claude">
      <p>{status?.state === "signedOut" ? "Squadmates can't start until you sign in to Claude." : "Squad couldn't read the Claude sign-in."}
        Run this in a terminal, then come back:</p>
      <div class="cmd"><code>{COMMAND}</code><button onclick={copy}>{copied ? "Copied" : "Copy"}</button></div>
      <p class="hint">Checking every few seconds… this closes once you're signed in.</p>
    </div>
  {/if}
</div>

<style>
  .account { position: relative; }
  .chip { font-size: 12px; padding: 3px 9px; border-radius: 12px; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
  .ok { color: var(--text); }
  .muted { color: var(--muted); }
  .bad { color: var(--bad); border-color: var(--bad); font-weight: 600; }
  .panel { position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; width: 320px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 6px 20px #0003; padding: 10px 12px; }
  .panel p { margin: 0 0 8px; }
  .cmd { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
  code { flex: 1; background: var(--code); padding: 4px 8px; border-radius: 4px; user-select: all; }
</style>
