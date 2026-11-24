<script lang="ts">
  import { CONNECTOR_TEMPLATES, connectorHostError, type ConnectorTemplateId, type ConnectorView } from "@squad/shared";
  import { send, ui } from "../../lib/state.svelte.ts";

  const TEMPLATES: Record<ConnectorTemplateId, { label: string; host: string; cli: string; install: string }> = {
    github: { label: "GitHub", host: "github.com", cli: "the GitHub CLI (gh)", install: "https://cli.github.com" },
    gitlab: { label: "GitLab", host: "gitlab.com", cli: "the GitLab CLI (glab)", install: "https://gitlab.com/gitlab-org/cli#installation" },
  };
  const REQUEST = "https://github.com/gphook/squad/issues/new";

  // Read through $derived: `ui.s` is replaced on every server message.
  const list = $derived(ui.s.connectors);
  const login = $derived(ui.s.connectorLogin);
  const serverError = $derived(ui.s.connectorError);
  const active = (c: ConnectorView) => login.phase !== "idle" && login.id === c.id;

  send({ t: "connectors.get" });

  let adding = $state(false);
  let template = $state<ConnectorTemplateId>("github");
  let name = $state("");
  let host = $state("");
  let hostError = $state<string | null>(null);
  let token = $state("");
  let removing = $state<string | null>(null);
  let alsoSignOut = $state(false);
  let renaming = $state<string | null>(null);
  let newName = $state("");

  function openAdd(t: ConnectorTemplateId = "github") {
    adding = true; template = t; name = ""; host = ""; hostError = null;
  }
  function add(e: SubmitEvent) {
    e.preventDefault();
    const h = host.trim() || TEMPLATES[template].host;
    hostError = connectorHostError(h);
    if (hostError) return;
    send({ t: "connector.add", template, name: name.trim(), host: h });
    adding = false;
  }
  function submitToken(e: SubmitEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    send({ t: "connector.token", token: token.trim() });
    token = "";
  }
  function rename(e: SubmitEvent, id: string) {
    e.preventDefault();
    send({ t: "connector.rename", id, name: newName.trim() });
    renaming = null;
  }
  const copy = (code: string) => void navigator.clipboard?.writeText(code).catch(() => {});
</script>

<section class="connectors" aria-label="Connectors">
  <div class="head">
    <strong>Connectors</strong>
    <span class="explain">Sign git in to GitHub or GitLab so you can add private marketplaces.</span>
  </div>

  {#if list && list.length === 0 && !adding}
    <div class="empty">
      <button type="button" onclick={() => openAdd("github")}>Add GitHub</button>
      <button type="button" onclick={() => openAdd("gitlab")}>Add GitLab</button>
    </div>
  {/if}

  {#each list ?? [] as c (c.id)}
    <div class="row">
      <div class="who">
        {#if renaming === c.id}
          <form class="inline" onsubmit={(e) => rename(e, c.id)}>
            <input bind:value={newName} aria-label="Connector name" />
            <button type="submit">Save</button>
            <button type="button" onclick={() => (renaming = null)}>Cancel</button>
          </form>
        {:else}
          <span class="name">{c.name}</span>
        {/if}
        <span class="host">{TEMPLATES[c.template].label} · {c.host}</span>
      </div>
      <div class="state">
        {#if c.state === "signed-in"}signed in as {c.user}
        {:else if c.state === "signed-out"}not signed in
        {:else}<a href={TEMPLATES[c.template].install} target="_blank" rel="noopener">Install {TEMPLATES[c.template].cli}</a>{/if}
      </div>
      <div class="acts">
        {#if removing === c.id}
          <label class="check"><input type="checkbox" bind:checked={alsoSignOut} /> Also sign out of {c.host}</label>
          <button type="button" onclick={() => (removing = null)}>Cancel</button>
          <button type="button" class="danger" onclick={() => { send({ t: "connector.remove", id: c.id, signOut: alsoSignOut }); removing = null; }}>Remove {c.name}</button>
        {:else}
          {#if c.state === "signed-in"}
            <button type="button" onclick={() => send({ t: "connector.signOut", id: c.id })}>Sign out</button>
          {:else if c.state === "signed-out" && !active(c)}
            <button type="button" class="primary" disabled={login.phase !== "idle" && login.phase !== "failed"}
              onclick={() => send({ t: "connector.login", id: c.id })}>Sign in</button>
          {/if}
          <button type="button" onclick={() => { renaming = c.id; newName = c.name; }}>Rename</button>
          <button type="button" class="danger" onclick={() => { removing = c.id; alsoSignOut = false; }}>Remove</button>
        {/if}
      </div>

      {#if active(c)}
        <div class="flow" role="status">
          {#if login.phase === "starting"}
            <span>Starting sign-in…</span>
            <button type="button" onclick={() => send({ t: "connector.cancel" })}>Cancel</button>
          {:else if login.phase === "waiting"}
            <span>Enter this code on {c.host}:</span>
            <code>{login.code}</code>
            <button type="button" onclick={() => login.phase === "waiting" && copy(login.code)}>Copy</button>
            <a class="go" href={login.url} target="_blank" rel="noopener">Open {login.url}</a>
            <button type="button" onclick={() => send({ t: "connector.cancel" })}>Cancel</button>
          {:else if login.phase === "token"}
            <form class="inline" onsubmit={submitToken}>
              <span><a href={login.tokenUrl} target="_blank" rel="noopener">Create a token</a> on {c.host}, then paste it here:</span>
              <input type="password" bind:value={token} aria-label="Access token" autocomplete="off" />
              <button type="submit" class="primary">Submit</button>
              <button type="button" onclick={() => send({ t: "connector.cancel" })}>Cancel</button>
            </form>
            {#if login.error}<span class="error" role="alert">{login.error}</span>{/if}
          {:else if login.phase === "verifying"}
            <span>Checking…</span>
          {:else if login.phase === "failed"}
            <span class="error" role="alert">{login.message}</span>
            <button type="button" onclick={() => send({ t: "connector.cancel" })}>Dismiss</button>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  {#if adding}
    <form class="add" onsubmit={add}>
      <div class="line">
        <select bind:value={template} aria-label="Template">
          {#each CONNECTOR_TEMPLATES as t (t)}<option value={t}>{TEMPLATES[t].label}</option>{/each}
        </select>
        <input bind:value={name} aria-label="Name" placeholder={TEMPLATES[template].label} />
        <input bind:value={host} aria-label="Host" placeholder={TEMPLATES[template].host} oninput={() => (hostError = null)} />
        <button type="submit" class="primary">Add</button>
        <button type="button" onclick={() => (adding = false)}>Cancel</button>
      </div>
      <span class="hint">For a self-hosted server, enter its hostname, like <code>github.example.com</code> or <code>gitlab.example.com:8443</code>.</span>
    </form>
  {/if}
  {#if hostError ?? serverError}<span class="error" role="alert">{hostError ?? serverError}</span>{/if}

  <div class="foot">
    {#if !adding && list}<button type="button" onclick={() => openAdd()}>+ Add connector</button>{/if}
    <a href={REQUEST} target="_blank" rel="noopener">Need another? Request a connector</a>
  </div>
</section>

<style>
  .connectors { display: grid; gap: 8px; }
  .head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .explain, .hint, .host { font-size: 12px; color: var(--muted); }
  .empty, .foot { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .foot a { font-size: 13px; margin-left: auto; }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 6px 12px; align-items: center;
    border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 10px 12px; }
  .who { display: grid; min-width: 0; }
  .name { font-weight: 600; }
  .host { overflow-wrap: anywhere; }
  .state { font-size: 13px; }
  .acts { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
  .check { font-size: 13px; display: flex; gap: 4px; align-items: center; }
  .flow { grid-column: 1 / -1; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 13px; }
  .flow code { font-size: 16px; font-weight: 600; letter-spacing: 0.08em; padding: 2px 8px; background: var(--code); border-radius: 4px; }
  .go { overflow-wrap: anywhere; }
  .inline { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .inline input { min-width: 0; flex: 1 1 200px; }
  .add { border: 1px dashed var(--line); border-radius: 8px; padding: 12px; display: grid; gap: 8px; }
  .line { display: flex; gap: 8px; flex-wrap: wrap; }
  .line input { flex: 1 1 160px; min-width: 0; }
  .error { color: var(--bad); font-size: 13px; }
  @media (max-width: 600px) { .row { grid-template-columns: 1fr; } .acts { justify-content: flex-start; } }
</style>
