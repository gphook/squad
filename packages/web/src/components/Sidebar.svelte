<script lang="ts">
  import type { Agent, AgentAction, Project } from "@squad/shared";
  import { unowned } from "../lib/activities.ts";
  import { slotOf } from "../lib/layout.ts";
  import { agentAction, approvalsFor, layout, send, ui } from "../lib/state.svelte.ts";
  import StatusDot from "./StatusDot.svelte";
  import ContextRing from "./ContextRing.svelte";

  let { onedit, onopentile, onshow, oneditproject }: {
    oneditproject: (p: Project) => void;
    onedit: (a: Agent | null) => void;
    onopentile: (agentId: string) => void;
    onshow: (agentId: string) => void;
  } = $props();

  let menuFor = $state<string | null>(null);

  const current = $derived(layout());
  const project = $derived(ui.s.projects.find((p) => p.id === ui.s.projectId) ?? null);
  const noOwner = $derived(unowned(project).length);

  function clearAll() {
    if (!project) return;
    const n = ui.s.agents.length;
    const what = n === 1 ? "the squadmate" : `all ${n} squadmates`;
    if (!confirm(`Clear ${what} in ${project.name}? Each starts a fresh conversation, files they shared are deleted and the message log is emptied. Repos aren't touched.`)) return;
    send({ t: "project.clearAll", projectId: project.id });
  }

  function act(a: Agent, action: AgentAction) {
    menuFor = null;
    agentAction(a, action);
  }
</script>

<nav class="sidebar" aria-label="Squadmates" role="list">
  <div class="head">
    <span>Squadmates</span>
    {#if ui.s.agents.length && project}
      <button class="clearall" title="Clear every squadmate's conversation and the message log" onclick={clearAll}>Clear all…</button>
    {/if}
  </div>
  {#if noOwner && project}
    <button class="noowner" onclick={() => oneditproject(project)}>⚠ {noOwner} {noOwner === 1 ? "activity has" : "activities have"} no owner</button>
  {/if}
  {#each ui.s.agents as a (a.id)}
    {@const st = ui.s.states[a.id]?.status ?? "stopped"}
    <div class="row" role="listitem" class:active={(current.maximised ?? ui.focus) === a.id} draggable="true"
      ondragstart={(e) => e.dataTransfer?.setData("text/squad-agent", a.id)}>
      <button class="name" onclick={() => onshow(a.id)}>
        <span class="slot">{slotOf(current, a.id) ?? ""}</span>
        <StatusDot status={st} />
        <span class="label">{a.name}</span>
        {#if approvalsFor(a.id).length}<span class="warn" title="Waiting for your approval">⚠</span>{/if}
        <span class="ctx"><ContextRing state={ui.s.states[a.id]} /></span>
      </button>
      <button class="more" aria-label="Actions for {a.name}" onclick={() => (menuFor = menuFor === a.id ? null : a.id)}>⋯</button>
      {#if menuFor === a.id}
        <div class="menu" role="menu">
          {#if st === "stopped" || st === "error"}
            <button role="menuitem" onclick={() => act(a, "launch")}>Launch</button>
          {:else}
            <button role="menuitem" onclick={() => act(a, "stop")}>Stop</button>
            <button role="menuitem" onclick={() => act(a, "interrupt")}>Interrupt</button>
            <button role="menuitem" onclick={() => act(a, "compact")}>Compact</button>
          {/if}
          <button role="menuitem" onclick={() => act(a, "clear")}>Clear…</button>
          {#if !slotOf(current, a.id)}<button role="menuitem" onclick={() => { menuFor = null; onopentile(a.id); }}>Open tile</button>{/if}
          <button role="menuitem" onclick={() => { menuFor = null; onedit(a); }}>Edit…</button>
        </div>
      {/if}
    </div>
  {/each}
  <button class="add" onclick={() => onedit(null)}>+ Add squadmate</button>
</nav>

<style>
  .sidebar { width: 210px; flex: none; border-right: 1px solid var(--line); padding: 8px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
  .head { display: flex; align-items: center; justify-content: space-between; }
  .clearall { background: none; border: 0; padding: 0 2px; font-size: 11px; color: var(--muted); text-transform: none; letter-spacing: 0; }
  .clearall:hover { color: var(--bad); }
  .head { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 4px 6px; }
  .row { position: relative; display: flex; align-items: center; border-radius: 6px; }
  .row.active, .row:hover { background: var(--hover); }
  .name { flex: 1; display: flex; align-items: center; gap: 7px; padding: 6px; background: none; border: 0; text-align: left; min-width: 0; }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .slot { width: 12px; font-size: 10px; color: var(--muted); text-align: center; }
  .warn { color: var(--warn); margin-left: auto; }
  .ctx { margin-left: auto; display: inline-flex; }
  .warn + .ctx { margin-left: 0; }
  .more { background: none; border: 0; padding: 4px 8px; color: var(--muted); }
  .menu { position: absolute; right: 0; top: 100%; z-index: 10; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 4px; display: flex; flex-direction: column; min-width: 140px; box-shadow: 0 6px 20px #0003; }
  .menu button { background: none; border: 0; text-align: left; padding: 6px 10px; border-radius: 4px; }
  .menu button:hover { background: var(--hover); }
  .noowner { background: none; border: 0; color: var(--warn); font-size: 12px; text-align: left; padding: 2px 6px 6px; }
  .add { margin-top: 8px; background: none; border: 1px dashed var(--line); padding: 6px; border-radius: 6px; color: var(--muted); }
</style>
