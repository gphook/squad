<script lang="ts">
  import { FIVE_HOUR_MS, SEVEN_DAY_MS, type LayoutMode, type Project } from "@squad/shared";
  import { layout, saveLayout, selectProject, ui } from "../lib/state.svelte.ts";
  import UsageRing from "./UsageRing.svelte";
  import Icon from "./Icon.svelte";
  import { applyTheme, loadTheme, nextTheme, saveTheme, type Theme } from "../lib/theme.ts";

  let theme = $state<Theme>(loadTheme());
  const THEME_LABELS: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };
  const themeLabel = $derived(`Theme: ${THEME_LABELS[theme]} (click for ${THEME_LABELS[nextTheme(theme)]})`);
  function cycleTheme() {
    theme = nextTheme(theme);
    saveTheme(theme);
    applyTheme(theme);
  }

  let { oneditproject }: { oneditproject: (p: Project | null) => void } = $props();
  const current = $derived(ui.s.projects.find((p) => p.id === ui.s.projectId) ?? null);

  const mode = $derived(layout().mode);
  const setMode = (m: LayoutMode) => saveLayout({ ...layout(), mode: m });
  const toggleView = (v: "messages" | "shares") => (ui.view = ui.view === v ? "chat" : v);
  const showUsage = () => (ui.view = "usage");
  const plan = $derived(ui.s.plan?.available ? ui.s.plan : null);

  // Reset times and projections move with the clock, not only when new numbers arrive.
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(t);
  });
</script>

<header class="topbar">
  <strong class="brand">Squad</strong>
  <button class="icon" aria-label="New project" title="New project" onclick={() => oneditproject(null)}><Icon name="plus" /></button>
  <select value={ui.s.projectId ?? ""} onchange={(e) => selectProject((e.target as HTMLSelectElement).value)} aria-label="Project">
    {#if !ui.s.projects.length}<option value="" disabled>No projects</option>{/if}
    {#each ui.s.projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
  </select>
  {#if current}
    <button class="icon" aria-label="Edit project {current.name}" title="Edit project" onclick={() => oneditproject(current)}><Icon name="edit" /></button>
  {/if}
  <span class="grow"></span>
  {#if plan}
    <div class="rings" role="group" aria-label="Plan usage">
      {#if plan.fiveHour}<UsageRing label="5h" name="Session" window={plan.fiveHour} windowMs={FIVE_HOUR_MS} {now} onclick={showUsage} />{/if}
      {#if plan.sevenDay}<UsageRing label="7d" name="Weekly" window={plan.sevenDay} windowMs={SEVEN_DAY_MS} {now} onclick={showUsage} />{/if}
    </div>
  {/if}
  <div class="seg" role="group" aria-label="Layout mode">
    <button class:on={mode === "focussed"} onclick={() => setMode("focussed")}>Focussed</button>
    <button class:on={mode === "tiled"} onclick={() => setMode("tiled")}>Tiled</button>
  </div>
  <button class="icon" class:on={ui.view === "messages"} aria-pressed={ui.view === "messages"}
    aria-label="Messages" title="Messages between squadmates" onclick={() => toggleView("messages")}><Icon name="messages" /></button>
  <button class="icon" class:on={ui.view === "shares"} aria-pressed={ui.view === "shares"}
    aria-label="Shared files" title="Shared files" onclick={() => toggleView("shares")}><Icon name="files" /></button>
  <button class="icon" aria-label={themeLabel} title={themeLabel} onclick={cycleTheme}><Icon name={theme} /></button>
  {#if ui.keyExpired}
    <span class="offline" role="alert">Squad restarted with a new key. Open the URL printed in the terminal.</span>
  {:else if !ui.connected}<span class="offline" role="status">Reconnecting…</span>{/if}
</header>

<style>
  .topbar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--line); }
  .brand { margin-right: 6px; }
  .rings { display: inline-flex; gap: 2px; margin-right: 4px; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .seg button { border: 0; border-radius: 0; }
  .on { background: var(--accent); color: var(--on-accent); }
  .icon { display: inline-grid; place-items: center; width: 32px; height: 30px; padding: 0; }
  .offline { color: var(--bad); font-size: 12px; }
</style>
