<script lang="ts">
  import { untrack } from "svelte";
  import { AGENT_NAME_RE, type Agent } from "@squad/shared";
  import { send, ui } from "../lib/state.svelte.ts";

  let { agent, onclose }: { agent: Agent | null; onclose: () => void } = $props();
  // The form edits a copy taken when it opens.
  const initial = untrack(() => agent);
  let name = $state(initial?.name ?? "");
  let role = $state(initial?.role ?? "");
  let folder = $state(initial?.folder ?? "");
  let model = $state(initial?.model ?? "");
  let createFolder = $state(false);
  const nameOk = $derived(AGENT_NAME_RE.test(name));

  function save(e: SubmitEvent) {
    e.preventDefault();
    if (!nameOk || !ui.s.projectId) return;
    send({
      t: "agent.save",
      agent: { id: agent?.id, projectId: ui.s.projectId, name, role, folder, model: model.trim() || null },
      createFolder,
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

<div class="modal" role="dialog" aria-label="Agent">
  <form onsubmit={save}>
    <h2>{agent ? `Edit ${agent.name}` : "Add agent"}</h2>
    <label>Name <span class="hint">Lowercase letters, digits and dashes. Must be unique on this machine: other sessions message it by this name.</span>
      <input bind:value={name} required aria-invalid={!nameOk && name !== ""} /></label>
    <label>Role <span class="hint">What it owns and does (markdown). The first line is shown to teammates.</span>
      <textarea bind:value={role} rows="8"></textarea></label>
    <label>Repo folder <span class="hint">Absolute path</span>
      <input bind:value={folder} required placeholder="/home/you/dev/project/repo" /></label>
    {#if !agent}
      <label class="check"><input type="checkbox" bind:checked={createFolder} /> Create this folder and run git init</label>
    {/if}
    <label>Model <span class="hint">Optional, e.g. opus, sonnet, haiku</span><input bind:value={model} /></label>
    <p class="hint">Changes apply the next time the agent launches.</p>
    <div class="actions">
      {#if agent}<button type="button" class="danger" onclick={remove}>Remove</button>{/if}
      <span class="grow"></span>
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary" disabled={!nameOk}>Save</button>
    </div>
  </form>
</div>
