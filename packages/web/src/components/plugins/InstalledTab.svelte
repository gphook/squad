<script lang="ts">
  import { effectiveSwitch, type InstalledPlugin, type PluginInventory, type SwitchSource } from "@squad/shared";
  import { send, ui } from "../../lib/state.svelte.ts";
  import { nextSwitch } from "../../lib/plugins.ts";

  const data = $derived(ui.s.plugins!);
  const project = $derived(ui.s.projects.find((p) => p.id === ui.s.projectId));
  const mates = $derived(ui.s.agents);
  /** The picked squadmate: the one `/plugin` was typed in, else the first. */
  const mate = $derived(mates.find((a) => a.id === ui.pluginMate) ?? mates[0] ?? null);

  let busy = $state<string | null>(null);
  let detailsId = $state<string | null>(null);
  let confirming = $state(false);
  // A fresh snapshot or an error ends whatever was busy.
  // Read through $derived: `ui.s` is replaced on every server message.
  const snapshot = $derived(ui.s.plugins);
  const error = $derived(ui.s.pluginError);
  $effect(() => { void snapshot; void error; busy = null; });

  const sourceNote: Record<SwitchSource, string> = { required: "required", terminal: "terminal", project: "project", own: "own setting" };

  function flip(p: InstalledPlugin, agentId: string | null) {
    const projectState = effectiveSwitch(p, data.switches, null);
    const current = effectiveSwitch(p, data.switches, agentId);
    busy = `${p.id}:${agentId ?? ""}`;
    send({ t: "plugins.switch", projectId: ui.s.projectId!, pluginId: p.id, agentId,
      enabled: nextSwitch(current, agentId === null ? "project" : "mate", projectState.on) });
  }

  function openDetails(p: InstalledPlugin) {
    confirming = false;
    if (detailsId === p.id) { detailsId = null; return; }
    detailsId = p.id;
    send({ t: "plugins.details", pluginId: p.id });
  }

  const details = $derived(data.installed.find((p) => p.id === detailsId) ?? null);
  const inventory = $derived<PluginInventory>(
    (ui.s.pluginDetails?.id === detailsId ? ui.s.pluginDetails?.inventory : details?.inventory) ?? {});
  const parts = (inv: PluginInventory) => Object.entries(inv).filter(([, n]) => n)
    .map(([k, n]) => `${n} ${n === 1 ? k.replace(/s$/, "").replace("mcpServer", "MCP server") : k.replace("mcpServers", "MCP servers")}`);

  function act(t: "plugins.update" | "plugins.uninstall", p: InstalledPlugin) {
    busy = `${t}:${p.id}`;
    send({ t, pluginId: p.id });
    if (t === "plugins.uninstall") { detailsId = null; confirming = false; }
  }
  function followTerminal(p: InstalledPlugin) {
    busy = `${p.id}:`;
    send({ t: "plugins.switch", projectId: ui.s.projectId!, pluginId: p.id, agentId: null, enabled: null });
  }
</script>

{#snippet toggle(p: InstalledPlugin, agentId: string | null)}
  {@const st = effectiveSwitch(p, data.switches, agentId)}
  <button type="button" class="switch" class:follows={st.source === "project" || st.source === "terminal"} role="switch"
    aria-checked={st.on} disabled={!!p.required || busy !== null}
    aria-label="{p.name} for {agentId === null ? project?.name ?? 'the project' : mate?.name}: {st.on ? 'on' : 'off'}, {sourceNote[st.source]}"
    onclick={() => flip(p, agentId)}></button>
  <span class="note">{sourceNote[st.source]}</span>
{/snippet}

<p class="explain">
  Each plugin is on or off for the whole project, and each squadmate follows the project unless it has its own setting.
  Faded switches follow; click one to give it its own setting. Nothing here changes your terminal or the repos.
</p>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Plugin</th>
        <th class="col">{project?.name ?? "Project"}</th>
        <th class="col pick">
          {#if mates.length}
            <select aria-label="Squadmate" value={mate?.id} onchange={(e) => (ui.pluginMate = e.currentTarget.value)}>
              {#each mates as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
            </select>
          {:else}<span class="hint">No squadmates</span>{/if}
        </th>
        <th class="col"><span class="sr">Details</span></th>
      </tr>
    </thead>
    <tbody>
      {#each data.installed as p (p.id)}
        <tr>
          <td>
            <div class="name">{p.name}{#if p.required}<span class="required">Required</span>{:else}<span class="tag">{p.marketplace}</span>{/if}</div>
            <div class="meta">{[p.description, p.version && `v${p.version}`, p.tokens && `${p.tokens} tokens`].filter(Boolean).join(" · ")}</div>
          </td>
          <td class="col">{@render toggle(p, null)}</td>
          <td class="col">{#if mate}{@render toggle(p, mate.id)}{/if}</td>
          <td class="col"><button type="button" aria-expanded={detailsId === p.id} onclick={() => openDetails(p)}>Details</button></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

{#if ui.s.pluginError && !ui.s.pluginError.action.startsWith("marketplace.")}
  <p class="error" role="alert">{ui.s.pluginError.message}</p>
{/if}

{#if details}
  {@const projectState = effectiveSwitch(details, data.switches, null)}
  <section class="details" aria-label="{details.name} details">
    <div class="dhead">
      <h3>{details.name}</h3>
      <span class="hint">{[details.required ? "Squad" : details.marketplace, details.version && `v${details.version}`].filter(Boolean).join(" · ")}</span>
      <span class="grow"></span>
      <button type="button" onclick={() => (detailsId = null)}>Close</button>
    </div>
    <p class="explain">{details.description}</p>
    <div class="inv">
      {#each parts(inventory) as part}<span>{part}</span>{/each}
      {#if details.tokens}<span>adds {details.tokens} tokens to each squadmate it's on for</span>{/if}
    </div>
    {#if details.required}
      <p class="hint">Squad gives this plugin to every squadmate, so it can't be switched off, updated or uninstalled here.</p>
    {:else if confirming}
      <div class="confirm" role="alertdialog" aria-label="Confirm uninstall">
        <span>Uninstall {details.name}? It's removed from every project and from your terminal.</span>
        <button type="button" onclick={() => (confirming = false)}>Cancel</button>
        <button type="button" class="danger" onclick={() => act("plugins.uninstall", details)}>Uninstall</button>
      </div>
    {:else}
      <div class="actions">
        <button type="button" disabled={busy !== null} onclick={() => act("plugins.update", details)}>
          {busy === `plugins.update:${details.id}` ? "Updating…" : "Update"}</button>
        <button type="button" class="danger" disabled={busy !== null} onclick={() => (confirming = true)}>Uninstall</button>
        {#if projectState.source === "own"}
          <button type="button" disabled={busy !== null} onclick={() => followTerminal(details)}>Follow terminal</button>
        {/if}
      </div>
    {/if}
  </section>
{/if}

<style>
  .explain { margin: 0; font-size: 13px; color: var(--muted); max-width: 75ch; }
  .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
  table { border-collapse: collapse; width: 100%; min-width: 560px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; }
  tbody tr:last-child td { border-bottom: 0; }
  thead th { font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); font-weight: 600; background: var(--bg); }
  .col { text-align: center; width: 96px; }
  .pick { width: 180px; text-transform: none; letter-spacing: 0; }
  .pick select { width: 100%; padding: 3px 6px; font-size: 13px; font-weight: 600; color: var(--text); }
  .name { font-weight: 600; }
  .meta { font-size: 12px; color: var(--muted); }
  .tag { font-size: 11px; padding: 0 6px; border-radius: 4px; background: var(--code); color: var(--muted); margin-left: 6px; font-weight: 400; }
  .required { font-size: 11px; padding: 0 6px; border-radius: 4px; margin-left: 6px; font-weight: 600;
    color: var(--bad); background: color-mix(in srgb, var(--bad) 14%, var(--panel)); }
  .switch { position: relative; width: 34px; height: 20px; border-radius: 999px; border: 1px solid var(--line); background: var(--hover); padding: 0; vertical-align: middle; }
  .switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--muted); transition: transform .15s; }
  .switch[aria-checked="true"] { background: var(--accent); border-color: var(--accent); }
  .switch[aria-checked="true"]::after { transform: translateX(14px); background: var(--on-accent); }
  .switch.follows { opacity: .45; }
  .switch:disabled { cursor: default; }
  .note { display: block; font-size: 10.5px; color: var(--muted); margin-top: 2px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .error { margin: 0; color: var(--bad); font-size: 13px; }
  .details { border: 1px solid var(--accent); background: var(--panel); border-radius: 8px; padding: 12px 14px; display: grid; gap: 10px; }
  .dhead { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  h3 { margin: 0; font-size: 16px; }
  .inv { display: flex; flex-wrap: wrap; gap: 6px; }
  .inv span { background: var(--code); border-radius: 5px; padding: 2px 8px; font-size: 12px; }
  .actions, .confirm { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .confirm span { font-size: 13px; }
  @media (prefers-reduced-motion: reduce) { .switch::after { transition: none; } }
</style>
