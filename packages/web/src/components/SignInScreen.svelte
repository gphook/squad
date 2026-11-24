<script lang="ts">
  import { ui, signedIn } from "../lib/state.svelte.ts";
  import { createPasskey, rememberedChoice, saveChoice, signIn } from "../lib/signin.ts";

  let remember = $state(rememberedChoice());
  let busy = $state(false);
  let error = $state<string | null>(null);

  // A failed setup link lands on /?setup=expired. Remember it, then tidy the address bar.
  const urlExpired = new URLSearchParams(location.search).get("setup") === "expired";
  if (urlExpired) history.replaceState(null, "", location.pathname + location.hash);

  const setupNeeded = $derived(ui.session?.setupNeeded ?? false);
  const mode = $derived(
    setupNeeded && ui.session?.setupGrant ? "setup" : urlExpired || setupNeeded ? "expired" : "signin",
  );

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      saveChoice(remember);
      await (mode === "setup" ? createPasskey(remember) : signIn(remember));
      signedIn();
    } catch (err) {
      error = err instanceof Error && err.name === "NotAllowedError" ? "Passkey request was cancelled." : err instanceof Error ? err.message : "Something went wrong.";
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen">
  {#if mode === "expired"}
    <div class="card">
      <h1>Squad</h1>
      <p role="alert">This setup link has expired or was already used. Restart Squad to get a new one.</p>
    </div>
  {:else}
    <form class="card" onsubmit={submit}>
      <h1>{mode === "setup" ? "Set up Squad" : "Sign in to Squad"}</h1>
      {#if mode === "setup"}
        <p>Squad uses a passkey, your fingerprint, face, device PIN or a security key, so only you can open it.</p>
      {/if}
      <fieldset>
        <legend class="hint">Stay signed in</legend>
        <label><input type="radio" name="remember" value="remember" checked={remember} onchange={() => (remember = true)} /> Remember this browser for 30 days</label>
        <label><input type="radio" name="remember" value="restart" checked={!remember} onchange={() => (remember = false)} /> Until Squad restarts</label>
      </fieldset>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit" disabled={busy}>{mode === "setup" ? "Create passkey" : "Sign in with passkey"}</button>
    </form>
  {/if}
</main>

<style>
  .screen { height: 100%; display: grid; place-items: center; padding: 16px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 24px; width: min(420px, 100%); display: flex; flex-direction: column; gap: 14px; }
  h1 { margin: 0; font-size: 20px; }
  p { margin: 0; }
  fieldset { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  legend { padding: 0; margin-bottom: 4px; }
  label { display: flex; align-items: center; gap: 8px; }
  .error { color: var(--bad); }
  button.primary { padding: 8px 12px; }
</style>
