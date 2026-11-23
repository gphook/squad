<script lang="ts">
  import { ui } from "../lib/state.svelte.ts";
  const close = () => (ui.viewer = null);
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />
{#if ui.viewer}
  <div class="viewer" role="dialog" aria-label="Image">
    <button class="bg" aria-label="Close" onclick={close}></button>
    <img src={ui.viewer} alt="full size" />
  </div>
{/if}

<style>
  .viewer { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; }
  .bg { position: absolute; inset: 0; background: #000c; border: 0; border-radius: 0; cursor: zoom-out; }
  img { position: relative; max-width: 94vw; max-height: 94vh; pointer-events: none; }
</style>
