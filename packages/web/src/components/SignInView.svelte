<script lang="ts">
  import { errorMessage, type SignInOverview } from "@squad/shared";
  import { signedOutHere, ui } from "../lib/state.svelte.ts";
  import { addPasskey, deletePasskey, overview, renamePasskey, revokeSession, signOut, signOutEverywhere } from "../lib/signin.ts";
  import EditableText from "./EditableText.svelte";

  let data = $state<SignInOverview | null>(null);
  let error = $state<string | null>(null);

  const time = (at: number) => new Date(at).toLocaleString();
  const onlyOne = $derived(data?.passkeys.length === 1);

  /** Reloads the lists. A 401 means this browser's session went away (e.g. its passkey was deleted). */
  async function refresh() {
    try {
      data = await overview();
    } catch (e) {
      if ((e as { status?: number }).status === 401) signedOutHere();
      else error = errorMessage(e);
    }
  }

  async function run(action: () => Promise<void>, thenSignedOut = false) {
    error = null;
    try {
      await action();
    } catch (e) {
      if ((e as { status?: number }).status === 401) signedOutHere();
      else error = errorMessage(e);
      return;
    }
    if (thenSignedOut) signedOutHere();
    else await refresh();
  }

  // On open, then whenever the server says the lists changed (another browser signed in, a passkey was renamed…).
  // Only that message counts, not every server message (see issue #20).
  $effect(() => {
    void ui.signinVersion;
    void refresh();
  });

  const rename = (id: string, name: string) => run(() => renamePasskey(id, name));
  /** EditableText's binding writes back every edit: save only a real change. */
  const saveName = (k: { id: string; name: string }, v: string) => {
    if (v !== k.name) void rename(k.id, v);
  };
  const remove = (id: string) => run(() => deletePasskey(id));
  const revoke = (id: string, current: boolean) => run(() => revokeSession(id), current);
  const signOutAll = () => {
    if (confirm("Sign out everywhere? Every browser, including this one, will have to sign in again.")) void run(signOutEverywhere, true);
  };
</script>

<section class="view" aria-label="Sign-in">
  <header><h2>Sign-in</h2></header>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  {#if data}
    <section>
      <header class="sub">
        <h3>Passkeys</h3>
        <span class="grow"></span>
        <button onclick={() => run(addPasskey)}>Add passkey</button>
      </header>
      <ul>
        {#each data.passkeys as k (k.id)}
          <li>
            <span class="name"><EditableText label="Passkey name" placeholder="Unnamed passkey" bind:value={() => k.name, (v) => saveName(k, v)} /></span>
            <span class="hint">Created {time(k.createdAt)}</span>
            <span class="hint">Last used {k.lastUsedAt ? time(k.lastUsedAt) : "never"}</span>
            <button class="danger" disabled={onlyOne} title={onlyOne ? "You can't delete your only passkey" : "Delete this passkey"}
              aria-label="Delete {k.name}" onclick={() => remove(k.id)}>Delete</button>
          </li>
        {/each}
      </ul>
    </section>

    <section>
      <header class="sub"><h3>Sessions</h3></header>
      <ul>
        {#each data.sessions as s (s.id)}
          <li>
            <span class="name">{s.label}{#if s.current} <strong class="here">This browser</strong>{/if}</span>
            <span class="hint">{s.kind === "remember" ? "Remembered for 30 days" : "Until Squad restarts"}</span>
            <span class="hint">Last used {time(s.lastUsedAt)}</span>
            <button aria-label="Revoke {s.label}" onclick={() => revoke(s.id, s.current)}>Revoke</button>
          </li>
        {/each}
      </ul>
    </section>

    <footer>
      <button onclick={() => run(signOut, true)}>Sign out</button>
      <button class="danger" onclick={signOutAll}>Sign out everywhere</button>
    </footer>
  {:else if !error}
    <p class="hint">Loading…</p>
  {/if}
</section>

<style>
  .view { flex: 1; overflow-y: auto; padding: 12px 18px; display: flex; flex-direction: column; gap: 18px; }
  header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  header.sub { margin-bottom: 8px; }
  h2 { font-size: 16px; margin: 0; }
  h3 { font-size: 13px; margin: 0; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .err { color: var(--bad); margin: 0; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  li { display: grid; grid-template-columns: minmax(140px, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--line); }
  .name { min-width: 0; }
  .here { font-size: 11px; color: var(--accent); border: 1px solid var(--accent); border-radius: 10px; padding: 0 6px; margin-left: 6px; }
  footer { margin-top: auto; display: flex; gap: 8px; }
  @media (max-width: 720px) { li { grid-template-columns: 1fr auto; } }
</style>
