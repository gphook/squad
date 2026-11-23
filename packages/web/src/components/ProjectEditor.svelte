<script lang="ts">
  import { untrack } from "svelte";
  import type { PermissionMode, Project } from "@squad/shared";
  import { PERMISSION_MODE_OPTIONS } from "../lib/permissionModes.ts";
  import { send } from "../lib/state.svelte.ts";

  let { project, onclose }: { project: Project | null; onclose: () => void } = $props();
  // The form edits a copy taken when it opens.
  const initial = untrack(() => project);
  let name = $state(initial?.name ?? "");
  let rules = $state(initial?.rules ?? "");
  let permissionMode = $state<PermissionMode>(initial?.permissionMode ?? "default");
  const modeDescription = $derived(PERMISSION_MODE_OPTIONS.find((o) => o.value === permissionMode)?.description ?? "");

  function save(e: SubmitEvent) {
    e.preventDefault();
    send({ t: "project.save", project: { id: project?.id, name, rules, permissionMode } });
    onclose();
  }
  function remove() {
    if (project && confirm(`Delete project ${project.name}? Its squadmates stop and its settings are removed. Repos are not touched.`)) {
      send({ t: "project.delete", projectId: project.id });
      onclose();
    }
  }
</script>

<div class="modal" role="dialog" aria-label="Project">
  <form onsubmit={save}>
    <h2>{project ? "Edit project" : "New project"}</h2>
    <label>Name <input bind:value={name} required /></label>
    <label>Project rules <span class="hint">Given to every squadmate at launch (markdown)</span>
      <textarea bind:value={rules} rows="10"></textarea></label>
    <label>Permission mode <span class="hint">Shared by every squadmate in the project</span>
      <select bind:value={permissionMode}>
        {#each PERMISSION_MODE_OPTIONS as o}<option value={o.value}>{o.label}</option>{/each}
      </select>
      <span class="hint">{modeDescription}</span></label>
    <div class="actions">
      {#if project}<button type="button" class="danger" onclick={remove}>Delete</button>{/if}
      <span class="grow"></span>
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  </form>
</div>
