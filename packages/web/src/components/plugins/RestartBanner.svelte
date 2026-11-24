<script lang="ts">
  import { send, ui } from "../../lib/state.svelte.ts";

  // Read through $derived: `ui.s` is replaced on every server message.
  const restarts = $derived(ui.s.pluginRestarts);
  const states = $derived(ui.s.states);
  const isWorking = (id: string) => ["working", "awaiting"].includes(states[id]?.status ?? "");
  /** Working squadmates waiting on "Restart anyway". */
  let asking = $state<{ agentId: string; name: string }[]>([]);

  const restart = (id: string) => send({ t: "agent.action", agentId: id, action: "restart" });
  function ask(list: { agentId: string; name: string }[]) {
    for (const a of list.filter((a) => !isWorking(a.agentId))) restart(a.agentId);
    asking = list.filter((a) => isWorking(a.agentId));
  }
  function confirmAsked() {
    for (const a of asking) restart(a.agentId);
    asking = [];
  }
  const askedText = $derived(
    asking.length === 1
      ? `${asking[0].name} is working. Restarting stops what it's doing.`
      : `${asking.map((a) => a.name).join(", ")} are working. Restarting stops what they're doing.`,
  );
</script>

{#if restarts.length}
  <div class="banner" role="status" aria-label="Restart to apply">
    <span>Restart to apply plugin changes:</span>
    {#each restarts as a (a.agentId)}
      <span class="mate">
        {a.name}{isWorking(a.agentId) ? " (working)" : ""}
        <button type="button" aria-label={`Restart ${a.name}`} onclick={() => ask([a])}>Restart</button>
      </span>
    {/each}
    {#if restarts.length > 1}<button type="button" onclick={() => ask(restarts)}>Restart all</button>{/if}
    {#if asking.length}
      <div class="confirm" role="alertdialog" aria-label="Confirm restart">
        <span>{askedText}</span>
        <button type="button" onclick={() => (asking = [])}>Cancel</button>
        <button type="button" class="danger" onclick={confirmAsked}>Restart anyway</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .banner { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; padding: 8px 12px; border: 1px solid var(--accent); border-radius: 6px; font-size: 13px; }
  .mate { display: inline-flex; gap: 6px; align-items: center; }
  .confirm { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; width: 100%; }
</style>
