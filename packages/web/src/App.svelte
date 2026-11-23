<script lang="ts">
  import type { Agent, Project } from "@squad/shared";
  import { layout, saveLayout, ui } from "./lib/state.svelte.ts";
  import { openTile, showInMain } from "./lib/layout.ts";
  import TopBar from "./components/TopBar.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Workspace from "./components/Workspace.svelte";
  import MessagesView from "./components/MessagesView.svelte";
  import SharedFilesPanel from "./components/SharedFilesPanel.svelte";
  import UsageView from "./components/UsageView.svelte";
  import ProjectEditor from "./components/ProjectEditor.svelte";
  import AgentEditor from "./components/AgentEditor.svelte";

  let editingProject = $state<{ p: Project | null } | null>(null);
  let editingAgent = $state<{ a: Agent | null } | null>(null);

  const show = (id: string) => {
    ui.view = "chat";
    ui.focus = id;
    saveLayout(showInMain(layout(), id));
  };
</script>

<div class="app">
  <TopBar oneditproject={(p) => (editingProject = { p })} />
  {#if ui.s.error}
    <div class="error" role="alert">{ui.s.error} <button onclick={() => (ui.s = { ...ui.s, error: null })}>×</button></div>
  {/if}
  {#if !ui.s.projectId}
    <main class="empty">
      <p>No projects yet.</p>
      <button class="primary" onclick={() => (editingProject = { p: null })}>Create a project</button>
    </main>
  {:else}
    <div class="body">
      <Sidebar onedit={(a) => (editingAgent = { a })} oneditproject={(p) => (editingProject = { p })} onopentile={(id) => saveLayout(openTile(layout(), id))} onshow={show} />
      {#if ui.view === "messages"}<MessagesView onjump={show} />
      {:else if ui.view === "shares"}<SharedFilesPanel />
      {:else if ui.view === "usage"}<UsageView onjump={show} />
      {:else}<Workspace />{/if}
    </div>
  {/if}
</div>

{#if editingProject}<ProjectEditor project={editingProject.p} onclose={() => (editingProject = null)} />{/if}
{#if editingAgent}<AgentEditor agent={editingAgent.a} onclose={() => (editingAgent = null)} />{/if}

<style>
  /* Each token is light-dark(light, dark). color-scheme picks which: the system setting by default,
     or the user's choice via data-theme (see lib/theme.ts). */
  :global(:root) {
    color-scheme: light dark;
    --bg: light-dark(#fbfbfa, #17171a); --panel: light-dark(#ffffff, #1f1f23); --text: light-dark(#1c1c1e, #e8e8ea);
    --muted: light-dark(#77777c, #8e8e94); --line: light-dark(#e3e3e0, #2e2e33); --hover: light-dark(#f0f0ee, #26262b);
    --accent: light-dark(#3a6df0, #5b86f5); --on-accent: #fff; --ok: light-dark(#2f9e44, #40c057);
    --warn: light-dark(#d9930d, #f0b429); --bad: light-dark(#d64545, #f06363); --code: light-dark(#f4f4f2, #26262b);
  }
  :global(:root[data-theme="light"]) { color-scheme: light; }
  :global(:root[data-theme="dark"]) { color-scheme: dark; }
  :global(*) { box-sizing: border-box; }
  :global(html, body, #app) { margin: 0; height: 100%; }
  :global(body) { background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  :global(button, input, select, textarea) { font: inherit; color: inherit; }
  :global(button) { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
  :global(button:disabled) { opacity: .5; cursor: default; }
  :global(button.primary) { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  :global(button.danger) { color: var(--bad); }
  :global(input, select, textarea) { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; }
  :global(:focus-visible) { outline: 2px solid var(--accent); outline-offset: 1px; }
  :global(.grow) { flex: 1; }
  :global(.hint) { color: var(--muted); font-size: 12px; font-weight: normal; }
  :global(.modal) { position: fixed; inset: 0; background: #0006; display: grid; place-items: center; z-index: 50; }
  :global(.modal form) { background: var(--panel); border-radius: 10px; padding: 18px; width: min(560px, 94vw); max-height: 90vh; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
  :global(.modal h2) { margin: 0; font-size: 17px; }
  :global(.modal label) { display: flex; flex-direction: column; gap: 4px; font-weight: 600; }
  :global(.modal label.check) { flex-direction: row; align-items: center; font-weight: normal; }
  :global(.modal .actions) { display: flex; gap: 8px; }
  .app { height: 100%; display: flex; flex-direction: column; }
  .body { flex: 1; display: flex; min-height: 0; }
  .empty { flex: 1; display: grid; place-content: center; gap: 10px; text-align: center; }
  .error { background: color-mix(in srgb, var(--bad) 15%, var(--panel)); padding: 6px 12px; display: flex; justify-content: space-between; }
  .error button { border: 0; background: none; }
</style>
