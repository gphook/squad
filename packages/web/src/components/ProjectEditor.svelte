<script lang="ts">
  import { untrack } from "svelte";
  import type { PermissionMode, Project } from "@squad/shared";
  import { PERMISSION_MODE_OPTIONS } from "../lib/permissionModes.ts";
  import { send, ui } from "../lib/state.svelte.ts";
  import { move } from "../lib/activities.ts";

  let { project, onclose }: { project: Project | null; onclose: () => void } = $props();
  // The form edits a copy taken when it opens.
  const initial = untrack(() => project);
  let name = $state(initial?.name ?? "");
  let rules = $state(initial?.rules ?? "");
  let permissionMode = $state<PermissionMode>(initial?.permissionMode ?? "default");
  const modeDescription = $derived(PERMISSION_MODE_OPTIONS.find((o) => o.value === permissionMode)?.description ?? "");

  // Squadmates exist only for the project that's open; a new project has none yet.
  const squadmates = untrack(() => (initial && initial.id === ui.s.projectId ? ui.s.agents : []));
  type Row = { key: number; id?: string; name: string; ownerId: string | null; reviewerIds: string[]; description: string };
  let nextKey = 0;
  let activities = $state<Row[]>((initial?.activities ?? []).map((a) => ({ key: nextKey++, ...a, reviewerIds: [...a.reviewerIds] })));
  const clash = $derived.by(() => {
    const seen = new Set<string>();
    for (const a of activities) {
      const k = a.name.trim().toLowerCase();
      if (k && seen.has(k)) return a.name.trim();
      seen.add(k);
    }
    return null;
  });
  const blank = $derived(activities.some((a) => !a.name.trim()));
  const addActivity = () => (activities = [...activities, { key: nextKey++, name: "", ownerId: null, reviewerIds: [], description: "" }]);
  function toggleReviewer(row: Row, id: string) {
    row.reviewerIds = row.reviewerIds.includes(id) ? row.reviewerIds.filter((r) => r !== id) : [...row.reviewerIds, id];
  }

  function save(e: SubmitEvent) {
    e.preventDefault();
    if (clash || blank) return;
    const list = activities.map(({ id, name, ownerId, reviewerIds, description }) => ({
      ...(id ? { id } : {}), name: name.trim(), ownerId, reviewerIds: reviewerIds.filter((r) => r !== ownerId), description,
    }));
    send({ t: "project.save", project: { id: project?.id, name, rules, permissionMode, activities: list } });
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
    <fieldset class="activities">
      <legend>Activities</legend>
      <p class="hint">Who owns each part of the work. Squad turns this into ownership rules for every squadmate.</p>
      {#each activities as a, i (a.key)}
        <div class="act">
          <div class="line">
            <input class="aname" bind:value={a.name} placeholder="Activity, e.g. UI design" aria-label="Activity name" />
            <select bind:value={a.ownerId} aria-label="Owner of {a.name || 'activity'}">
              <option value={null}>No owner</option>
              {#each squadmates as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
            </select>
            {#if !a.ownerId}<span class="chip" title="Squadmates are told to ask you">No owner</span>{/if}
            <button type="button" class="mini" aria-label="Move up" disabled={i === 0} onclick={() => (activities = move(activities, i, -1))}>↑</button>
            <button type="button" class="mini" aria-label="Move down" disabled={i === activities.length - 1} onclick={() => (activities = move(activities, i, 1))}>↓</button>
            <button type="button" class="mini" aria-label="Remove {a.name || 'activity'}" onclick={() => (activities = activities.filter((x) => x !== a))}>×</button>
          </div>
          <input class="desc" bind:value={a.description} placeholder="Description (optional)" aria-label="Description of {a.name || 'activity'}" />
          {#if squadmates.some((m) => m.id !== a.ownerId)}
            <div class="reviewers"><span class="hint">Reviewed by</span>
              {#each squadmates.filter((m) => m.id !== a.ownerId) as m (m.id)}
                <label class="check"><input type="checkbox" checked={a.reviewerIds.includes(m.id)} onchange={() => toggleReviewer(a, m.id)} /> {m.name}</label>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
      {#if clash}<p class="err" role="alert">Two activities are called "{clash}".</p>{/if}
      <button type="button" class="add" onclick={addActivity}>+ Add activity</button>
    </fieldset>
    <label>Permission mode <span class="hint">Shared by every squadmate in the project</span>
      <select bind:value={permissionMode}>
        {#each PERMISSION_MODE_OPTIONS as o}<option value={o.value}>{o.label}</option>{/each}
      </select>
      <span class="hint">{modeDescription}</span></label>
    <div class="actions">
      {#if project}<button type="button" class="danger" onclick={remove}>Delete</button>{/if}
      <span class="grow"></span>
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary" disabled={Boolean(clash) || blank}>Save</button>
    </div>
  </form>
</div>

<style>
  .activities { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; margin: 0; }
  legend { font-weight: 600; padding: 0 4px; }
  .activities > .hint { margin: 0; }
  .act { display: flex; flex-direction: column; gap: 4px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
  .line { display: flex; gap: 6px; align-items: center; }
  .aname { flex: 1; min-width: 0; }
  .mini { padding: 2px 7px; }
  .chip { font-size: 11px; color: var(--warn); border: 1px solid var(--warn); border-radius: 10px; padding: 0 6px; white-space: nowrap; }
  .reviewers { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
  .reviewers .check { font-weight: normal; gap: 4px; }
  .err { color: var(--bad); margin: 0; font-size: 12px; }
  .add { align-self: flex-start; background: none; border: 1px dashed var(--line); color: var(--muted); }
</style>
