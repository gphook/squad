<script lang="ts">
  import { untrack } from "svelte";
  import { AGENT_NAME_RE, type Agent } from "@squad/shared";
  import { send, ui } from "../lib/state.svelte.ts";
  import { ownedAfterEdit, ownedBy, ownsPayload, unowned } from "../lib/activities.ts";

  let { agent, onclose }: { agent: Agent | null; onclose: () => void } = $props();
  // The form edits a copy taken when it opens.
  const initial = untrack(() => agent);
  let name = $state(initial?.name ?? "");
  let role = $state(initial?.role ?? "");
  let folder = $state(initial?.folder ?? "");
  let model = $state(initial?.model ?? "");
  let createFolder = $state(false);
  const nameOk = $derived(AGENT_NAME_RE.test(name));

  // Offer what this squadmate already owns plus anything nobody owns; reassigning is done in the project dialog.
  const project = untrack(() => ui.s.projects.find((p) => p.id === ui.s.projectId) ?? null);
  const mine = initial ? ownedBy(project, initial.id) : [];
  const offered = [...mine, ...unowned(project)];
  let owns = $state<string[]>(mine.map((a) => a.id));
  let newActivities = $state("");
  const liveProject = () => ui.s.projects.find((p) => p.id === ui.s.projectId) ?? null;
  const toggleOwn = (id: string) => (owns = owns.includes(id) ? owns.filter((x) => x !== id) : [...owns, id]);

  function save(e: SubmitEvent) {
    e.preventDefault();
    if (!nameOk || !ui.s.projectId) return;
    send({
      t: "agent.save",
      agent: { id: agent?.id, projectId: ui.s.projectId, name, role, folder, model: model.trim() || null },
      createFolder,
      // Built against what it owns now, so ownership given elsewhere while this was open isn't dropped.
      owns: ownsPayload(ownedAfterEdit(agent ? ownedBy(liveProject(), agent.id).map((a) => a.id) : [], mine.map((a) => a.id), owns), newActivities),
    });
    onclose();
  }
  function remove() {
    if (agent && confirm(`Remove ${agent.name} from the project? Its repo is not touched.`)) {
      send({ t: "agent.delete", agentId: agent.id });
      onclose();
    }
  }
</script>

<div class="modal" role="dialog" aria-label="Squadmate">
  <form onsubmit={save}>
    <h2>{agent ? `Edit ${agent.name}` : "Add squadmate"}</h2>
    <label>Name <span class="hint">Lowercase letters, digits and dashes. Must be unique on this machine: other sessions message it by this name.</span>
      <input bind:value={name} required aria-invalid={!nameOk && name !== ""} /></label>
    <label>Role <span class="hint">What it owns and does (markdown). The first line is shown to squadmates.</span>
      <textarea bind:value={role} rows="8"></textarea></label>
    <label>Repo folder <span class="hint">Absolute path</span>
      <input bind:value={folder} required placeholder="/home/you/dev/project/repo" /></label>
    {#if !agent}
      <label class="check"><input type="checkbox" bind:checked={createFolder} /> Create this folder and run git init</label>
    {/if}
    <fieldset class="owns">
      <legend>Owns</legend>
      <p class="hint">The activities this squadmate is responsible for.</p>
      {#each offered as a (a.id)}
        <label class="check"><input type="checkbox" checked={owns.includes(a.id)} onchange={() => toggleOwn(a.id)} /> {a.name}</label>
      {/each}
      <label>New activities <span class="hint">Comma-separated, e.g. Shaders, UI shaders</span>
        <input bind:value={newActivities} /></label>
    </fieldset>
    <label>Model <span class="hint">Optional, e.g. opus, sonnet, haiku</span><input bind:value={model} /></label>
    <p class="hint">Changes apply the next time this squadmate launches.</p>
    <div class="actions">
      {#if agent}<button type="button" class="danger" onclick={remove}>Remove</button>{/if}
      <span class="grow"></span>
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary" disabled={!nameOk}>Save</button>
    </div>
  </form>
</div>

<style>
  .owns { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; margin: 0; }
  legend { font-weight: 600; padding: 0 4px; }
  .owns > .hint { margin: 0; }
</style>
