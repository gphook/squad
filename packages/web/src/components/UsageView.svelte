<script lang="ts">
  import { USAGE_RANGES, errorMessage, type UsageRange, type UsageReport } from "@squad/shared";
  import { agentById, ui } from "../lib/state.svelte.ts";
  import { fetchUsage, formatCost, formatTokens, localDay, stackDaily } from "../lib/usage.ts";
  import DailyChart from "./DailyChart.svelte";

  let { onjump }: { onjump: (agentId: string) => void } = $props();

  let scope = $state<"project" | "all">("project");
  let days = $state<UsageRange>(30);
  let metric = $state<"cost" | "tokens">("cost");
  let report = $state<UsageReport | null>(null);
  let error = $state<string | null>(null);

  const allProjects = $derived(scope === "all");

  $effect(() => {
    const projectId = allProjects ? null : ui.s.projectId;
    const range = days;
    let current = true;
    error = null;
    fetchUsage(projectId, range).then(
      (r) => { if (current) report = r; },
      (e) => { if (current) error = errorMessage(e); },
    );
    return () => { current = false; };
  });

  const chart = $derived(report ? stackDaily(report.daily, days, localDay(Date.now()), metric) : null);
  const tokens = (t: { input: number; output: number; cacheRead: number; cacheWrite: number }) =>
    `${formatTokens(t.input + t.cacheRead + t.cacheWrite)} / ${formatTokens(t.output)}`;
  const pct = (share: number) => `${Math.round(share * 100)}%`;
  const time = (at: number) => new Date(at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
</script>

<main class="view">
  <header>
    <h2>Usage</h2>
    <div class="seg" role="group" aria-label="Scope">
      <button class:on={!allProjects} onclick={() => (scope = "project")}>This project</button>
      <button class:on={allProjects} onclick={() => (scope = "all")}>All projects</button>
    </div>
    <div class="seg" role="group" aria-label="Range">
      {#each USAGE_RANGES as r}<button class:on={days === r} onclick={() => (days = r)}>{r} days</button>{/each}
    </div>
    <span class="grow"></span>
    <button onclick={() => (ui.view = "chat")}>Close</button>
  </header>

  {#if error}<p class="err" role="alert">Couldn't load usage: {error}</p>{/if}

  {#if report}
    <section>
      <h3>Current windows by squadmate</h3>
      {#if !report.windows.length}<p class="hint">No squadmate turns in the last 7 days.</p>
      {:else}
        <table>
          <thead><tr>
            <th>Squadmate</th><th class="n">Turns</th><th class="n">Tokens in / out</th><th class="n">Est. cost</th>
            <th class="n">Share 5h</th><th class="n">Share 7d</th>
          </tr></thead>
          <tbody>
            {#each report.windows as a (a.agentId)}
              <tr>
                <td>{a.agentName}{#if allProjects}<span class="hint"> · {a.projectName}</span>{/if}</td>
                <td class="n">{a.turns}</td><td class="n">{tokens(a)}</td><td class="n">{formatCost(a.cost)}</td>
                <td class="n">{pct(a.share5h)}</td><td class="n">{pct(a.share7d)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="hint">Costs are API-equivalent estimates. Shares split Squad's own usage in the last 5 hours and 7 days.</p>
      {/if}
    </section>

    <section>
      <header class="sub">
        <h3>Daily by squadmate</h3>
        <div class="seg" role="group" aria-label="Measure">
          <button class:on={metric === "cost"} onclick={() => (metric = "cost")}>Cost</button>
          <button class:on={metric === "tokens"} onclick={() => (metric = "tokens")}>Tokens</button>
        </div>
      </header>
      {#if chart}<DailyChart data={chart} {metric} />{/if}
    </section>

    <section>
      <h3>By model</h3>
      {#if !report.byModel.length}<p class="hint">Nothing in this range.</p>
      {:else}
        <table>
          <thead><tr><th>Model</th><th class="n">Tokens in / out</th><th class="n">Est. cost</th></tr></thead>
          <tbody>{#each report.byModel as m (m.model)}<tr><td>{m.model}</td><td class="n">{tokens(m)}</td><td class="n">{formatCost(m.cost)}</td></tr>{/each}</tbody>
        </table>
      {/if}
    </section>

    <section>
      <h3>Costliest turns</h3>
      {#if !report.top.length}<p class="hint">Nothing in this range.</p>
      {:else}
        <table>
          <thead><tr><th>When</th><th>Squadmate</th><th>Model</th><th class="n">Tokens in / out</th><th class="n">Est. cost</th></tr></thead>
          <tbody>
            {#each report.top as t}
              {@const live = agentById(t.agentId)}
              <tr>
                <td>{time(t.at)}</td>
                <td>
                  {#if live}<button class="link" onclick={() => onjump(t.agentId)}>{t.agentName}</button>
                  {:else}{t.agentName}{/if}
                  {#if allProjects}<span class="hint"> · {t.projectName}</span>{/if}
                </td>
                <td>{t.model}</td><td class="n">{tokens(t)}</td><td class="n">{formatCost(t.cost)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/if}
</main>

<style>
  .view { flex: 1; overflow-y: auto; padding: 12px 18px; display: flex; flex-direction: column; gap: 18px; }
  header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  header.sub { margin-bottom: 8px; }
  h2 { font-size: 16px; margin: 0; }
  h3 { font-size: 13px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  header.sub h3 { margin: 0; }
  .grow { flex: 1; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .seg button { border: 0; border-radius: 0; }
  .on { background: var(--accent); color: var(--on-accent); }
  .err { color: var(--bad); }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 500; font-size: 12px; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  .link { background: none; border: 0; padding: 0; color: var(--accent); }
</style>
