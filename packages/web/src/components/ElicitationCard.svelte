<script lang="ts">
  import type { Approval, ElicitContent, ElicitField, Elicitation } from "@squad/shared";
  import { untrack } from "svelte";
  import { send } from "../lib/state.svelte.ts";
  let { approval, elicitation }: { approval: Approval; elicitation: Elicitation } = $props();

  const INPUT_TYPE: Record<string, string> = { email: "email", uri: "url", date: "date", "date-time": "datetime-local" };
  const initial = (f: ElicitField): string | boolean | string[] => {
    if (f.type === "boolean") return f.default === true;
    if (f.type === "multi") return Array.isArray(f.default) ? [...f.default] : [];
    return f.default === undefined || Array.isArray(f.default) ? "" : String(f.default);
  };
  // An approval's request never changes, so the initial values are all there is.
  // Number inputs bind numbers (or null when empty).
  let values = $state<(string | number | null | boolean | string[])[]>(untrack(() => elicitation.fields.map(initial)));

  function toggle(i: number, v: string) {
    const cur = values[i] as string[];
    values[i] = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
  }

  function value(f: ElicitField, v: string | number | null | boolean | string[]): ElicitContent[string] | undefined {
    if (f.type === "boolean" || f.type === "multi") return v as boolean | string[];
    const s = String(v ?? "").trim();
    if (!s) return undefined;
    if (f.type === "number" || f.type === "integer") return Number(s);
    if (f.format === "date-time") {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? s : d.toISOString();
    }
    return s;
  }

  const missing = $derived(elicitation.fields.some((f, i) => {
    if (!f.required) return false;
    const v = value(f, values[i]);
    return v === undefined || (Array.isArray(v) && !v.length);
  }));

  function submit() {
    const content: ElicitContent = {};
    elicitation.fields.forEach((f, i) => {
      const v = value(f, values[i]);
      if (v !== undefined) content[f.name] = v;
    });
    send({ t: "approval.answer", approvalId: approval.id, decision: "allow", content });
  }
  const done = () => send({ t: "approval.answer", approvalId: approval.id, decision: "allow" });
  const decline = () => send({ t: "approval.answer", approvalId: approval.id, decision: "deny" });
</script>

<form class="elicit" aria-label="Request from {elicitation.serverName}"
  onsubmit={(e) => { e.preventDefault(); if (elicitation.mode === "url") done(); else if (!missing) submit(); }}>
  <div class="head"><span class="chip">{elicitation.serverName}</span>{#if elicitation.title}<strong>{elicitation.title}</strong>{/if}</div>
  {#if elicitation.message}<p class="msg">{elicitation.message}</p>{/if}

  {#if elicitation.mode === "url"}
    {#if elicitation.url}
      <a class="url" href={elicitation.url} target="_blank" rel="noopener noreferrer">Open {new URL(elicitation.url).host} ↗</a>
    {:else}
      <p class="desc">The server sent no usable link.</p>
    {/if}
  {:else}
    {#each elicitation.fields as f, i (f.name)}
      <div class="field">
        {#if f.type === "boolean"}
          <label class="opt"><input type="checkbox" bind:checked={values[i] as boolean} /> <span>{f.label}</span></label>
        {:else if f.type === "multi"}
          <span class="label">{f.label}{#if f.required}<span class="req" aria-label="required">*</span>{/if}</span>
          {#each f.options ?? [] as o (o.value)}
            <label class="opt"><input type="checkbox" checked={(values[i] as string[]).includes(o.value)} onchange={() => toggle(i, o.value)} /> {o.label}</label>
          {/each}
        {:else}
          <label class="label" for="e{approval.id}-{i}">{f.label}{#if f.required}<span class="req" aria-label="required">*</span>{/if}</label>
          {#if f.type === "choice"}
            <select id="e{approval.id}-{i}" bind:value={values[i]} required={f.required}>
              <option value="">Choose…</option>
              {#each f.options ?? [] as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
            </select>
          {:else if f.type === "number" || f.type === "integer"}
            <input id="e{approval.id}-{i}" type="number" step={f.type === "integer" ? 1 : "any"} min={f.min} max={f.max}
              bind:value={values[i]} required={f.required} />
          {:else}
            <input id="e{approval.id}-{i}" type={INPUT_TYPE[f.format ?? ""] ?? "text"} minlength={f.min} maxlength={f.max}
              bind:value={values[i]} required={f.required} />
          {/if}
        {/if}
        {#if f.description}<span class="desc">{f.description}</span>{/if}
      </div>
    {/each}
  {/if}

  <div class="btns">
    {#if elicitation.mode === "url"}
      <button class="primary" type="submit" disabled={!elicitation.url} title="Tell the server you've finished on that page">Done</button>
    {:else}
      <button class="primary" type="submit" disabled={missing}>Submit</button>
    {/if}
    <button type="button" onclick={decline}>Decline</button>
  </div>
</form>

<style>
  .elicit { border: 1px solid var(--accent); border-radius: 8px; padding: 8px 10px; margin: 6px 0; background: color-mix(in srgb, var(--accent) 8%, var(--bg)); }
  .head { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
  .chip { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .msg { margin: 4px 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .field { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; min-width: 0; }
  .label { font-weight: 600; }
  .req { color: var(--warn); margin-left: 2px; }
  .opt { display: flex; gap: 8px; align-items: center; cursor: pointer; }
  .desc { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
  .url { display: inline-block; margin-bottom: 8px; overflow-wrap: anywhere; }
  .btns { display: flex; gap: 6px; flex-wrap: wrap; }
</style>
