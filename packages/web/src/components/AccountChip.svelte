<script lang="ts">
  import type { LoginMethod } from "@squad/shared";
  import { send, ui } from "../lib/state.svelte.ts";
  import { chipLabel, chipTitle, chipTone } from "../lib/account.ts";

  let { now }: { now: number } = $props();

  const CHECK_EVERY_MS = 5_000;
  const COMMAND = "claude auth login";
  let open = $state(false);
  let copied = $state(false);
  let confirmSignOut = $state(false);
  let code = $state("");
  let root = $state<HTMLElement>();

  const status = $derived(ui.s.auth);
  const login = $derived(ui.s.login);
  const busy = $derived(login.phase !== "idle");
  const signedIn = $derived(status?.state === "signedIn");

  // A sign-in that finishes closes the panel; one started from another page opens it here too.
  let lastPhase = "idle";
  $effect(() => {
    const phase = login.phase;
    if (phase === "idle" && (lastPhase === "waiting" || lastPhase === "verifying") && signedIn) open = false;
    if (phase === "starting" && lastPhase === "idle") { open = true; code = ""; }
    lastPhase = phase;
  });
  // Signed out with nothing running: someone may sign in from a terminal, so check every few seconds.
  $effect(() => {
    if (!open || signedIn || busy) return;
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
    open = !open;
    confirmSignOut = false;
    if (open && !busy) send({ t: "auth.check" });
  }
  const start = (method: LoginMethod) => send({ t: "auth.login", method });
  const cancel = () => send({ t: "auth.cancel" });
  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    send({ t: "auth.code", code: code.trim() });
    code = "";
  }
  function signOut() {
    confirmSignOut = false;
    send({ t: "auth.logout" });
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
  <button class="chip {busy ? 'muted' : chipTone(status)}" title={chipTitle(status, now)} aria-expanded={open}
    aria-label="Claude account: {busy ? 'signing in' : chipLabel(status)}" onclick={toggle}>{busy ? "Signing in…" : chipLabel(status)}</button>
  {#if open}
    <div class="panel" role="dialog" aria-label="Claude account">
      {#if login.phase === "starting"}
        <p>Starting the Claude sign-in…</p>
        <div class="row"><button onclick={cancel}>Cancel</button></div>
      {:else if login.phase === "waiting" || login.phase === "verifying"}
        <p>Sign in on claude.ai, in a new tab:</p>
        <a class="primary" href={login.url} target="_blank" rel="noopener noreferrer">Open the Claude sign-in ↗</a>
        <form onsubmit={submit}>
          <label for="claude-code">If claude.ai shows a code, paste it here:</label>
          <div class="row">
            <input id="claude-code" bind:value={code} autocomplete="off" spellcheck="false" disabled={login.phase === "verifying"} />
            <button type="submit" disabled={login.phase === "verifying" || !code.trim()}>{login.phase === "verifying" ? "Checking…" : "Sign in"}</button>
          </div>
        </form>
        {#if login.phase === "waiting" && login.error}<p class="error" role="alert">{login.error}</p>{/if}
        <div class="row"><button onclick={cancel}>Cancel</button></div>
      {:else if login.phase === "failed"}
        <p class="error" role="alert">{login.message}</p>
        <div class="row"><button class="primary" onclick={() => start("claudeai")}>Try again</button><button onclick={cancel}>Dismiss</button></div>
      {:else if signedIn}
        <p>{status?.email ?? chipLabel(status)}{#if status?.organization}<br /><span class="hint">{status.organization}</span>{/if}</p>
        {#if confirmSignOut}
          <p>Sign out of Claude? Squadmates won't start until you sign in again.</p>
          <div class="row"><button class="danger" onclick={signOut}>Sign out</button><button onclick={() => (confirmSignOut = false)}>Keep</button></div>
        {:else}
          <div class="row"><button onclick={() => start("claudeai")}>Switch account</button><button onclick={() => (confirmSignOut = true)}>Sign out</button></div>
        {/if}
        <p class="hint">Also changes the account Claude Code uses in your terminal.</p>
      {:else}
        <p>{status?.state === "signedOut" ? "Squadmates can't start until you sign in to Claude." : "Squad couldn't read the Claude sign-in."}</p>
        <button class="primary" onclick={() => start("claudeai")}>Sign in to Claude</button>
        <p class="hint">Or with <button class="link" onclick={() => start("console")}>Anthropic Console</button> (API billing)
          or <button class="link" onclick={() => start("sso")}>SSO</button>.</p>
        <details>
          <summary class="hint">Use a terminal instead</summary>
          <div class="cmd"><code>{COMMAND}</code><button onclick={copy}>{copied ? "Copied" : "Copy"}</button></div>
          <p class="hint">Checking every few seconds… this updates once you're signed in.</p>
        </details>
      {/if}
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
  .panel > .primary, .panel form { display: block; margin-bottom: 8px; }
  a.primary { text-align: center; padding: 5px 10px; border-radius: 4px; border: 1px solid var(--line); text-decoration: none; }
  .row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
  .row input { flex: 1; min-width: 0; }
  label { display: block; margin-bottom: 4px; }
  .hint { color: var(--muted); font-size: 12px; }
  .error { color: var(--bad); }
  .danger { color: var(--bad); border-color: var(--bad); }
  .link { border: none; background: none; padding: 0; color: inherit; text-decoration: underline; font-size: inherit; cursor: pointer; }
  .cmd { display: flex; gap: 6px; align-items: center; margin: 6px 0 8px; }
  code { flex: 1; background: var(--code); padding: 4px 8px; border-radius: 4px; user-select: all; }
</style>
