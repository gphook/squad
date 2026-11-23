<script lang="ts">
  import { shareDisplayName as name } from "@squad/shared";
  import { fileUrl } from "../lib/markdown.ts";
  import { send, ui } from "../lib/state.svelte.ts";

  let to = $state<string[]>([]);
  let note = $state("");
  let busy = $state(false);
  let over = $state(false);
  const list = $derived([...ui.s.shares].reverse());
  const ctx = $derived({ projectId: ui.s.projectId ?? "" });
  const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

  async function upload(files: FileList | null | undefined) {
    if (!files?.length || !ui.s.projectId) return;
    busy = true;
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append("to", to.join(","));
        fd.append("note", note);
        fd.append("file", f);
        const r = await fetch(`/api/projects/${ui.s.projectId}/shares`, { method: "POST", body: fd });
        if (!r.ok) ui.s = { ...ui.s, error: `Upload failed: ${r.status}` };
      }
      note = "";
    } finally {
      busy = false;
    }
  }
  const remove = (id: string, n: string) => confirm(`Delete ${n}?`) && send({ t: "share.delete", shareId: id });
</script>

<main class="view">
  <h2>Shared files</h2>
  <div class="drop" class:over role="region" aria-label="Share a file with squadmates"
    ondragover={(e) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); over = true; } }}
    ondragleave={() => (over = false)}
    ondrop={(e) => { e.preventDefault(); over = false; upload(e.dataTransfer?.files); }}>
    <div class="row">
      <span>Share with:</span>
      {#each ui.s.agents as a}
        <label><input type="checkbox" value={a.name} bind:group={to} /> {a.name}</label>
      {/each}
    </div>
    <input placeholder="Note (what this is)" bind:value={note} />
    <label class="pick">{busy ? "Uploading…" : "Drop files here or choose…"}
      <input type="file" multiple onchange={(e) => upload((e.target as HTMLInputElement).files)} hidden /></label>
    <p class="hint">Squadmates receive the path; tell them about it in the chat.</p>
  </div>
  {#if !list.length}<p class="hint">Nothing shared yet.</p>{/if}
  <table>
    <tbody>
      {#each list as s (s.id)}
        <tr>
          <td><a href={fileUrl(ctx, s.path)} target="_blank" rel="noopener noreferrer">{name(s.path)}</a>
            {#if s.note}<div class="hint">{s.note}</div>{/if}</td>
          <td>{s.fromAgent} → {s.to.join(", ") || "—"}</td>
          <td class="hint">{size(s.size)}</td>
          <td class="hint">{new Date(s.at).toLocaleString()}</td>
          <td class="act"><a href={fileUrl(ctx, s.path, true)}>Download</a>
            <button class="danger" onclick={() => remove(s.id, name(s.path))}>Delete</button></td>
        </tr>
      {/each}
    </tbody>
  </table>
</main>

<style>
  .view { flex: 1; overflow-y: auto; padding: 12px 18px; }
  h2 { font-size: 16px; margin: 0 0 10px; }
  .drop { border: 2px dashed var(--line); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
  .drop.over { border-color: var(--accent); }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .pick { cursor: pointer; color: var(--accent); }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .act { white-space: nowrap; display: flex; gap: 8px; align-items: center; }
</style>
