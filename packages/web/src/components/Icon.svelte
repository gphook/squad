<script lang="ts" module>
  /** 24×24 stroke icons, drawn for Squad. */
  const PATHS = {
    messages: [
      "M4 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
      "M17 9h3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v3l-4-3h-4a2 2 0 0 1-2-2v-1",
    ],
    plus: ["M12 5v14", "M5 12h14"],
    plugins: [
      "M10 3.5a2 2 0 0 1 4 0V5h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 0 0 0 4H19v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 0 0-4 0V19H6a1 1 0 0 1-1-1v-4h1.5a2 2 0 0 0 0-4H5V6a1 1 0 0 1 1-1h4z",
    ],
    edit: ["M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z", "M13.5 6.5l4 4"],
    files: ["M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"],
    system: ["M3 4h18v12H3z", "M8 20h8", "M12 16v4"],
    light: [
      "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z",
      "M12 2v2", "M12 20v2", "M4.9 4.9l1.4 1.4", "M17.7 17.7l1.4 1.4", "M2 12h2", "M20 12h2", "M4.9 19.1l1.4-1.4", "M17.7 6.3l1.4-1.4",
    ],
    dark: ["M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"],
    lock: ["M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z", "M8 11V8a4 4 0 0 1 8 0v3"],
    maximise: ["M4 9V4h5", "M20 9V4h-5", "M4 15v5h5", "M20 15v5h-5"],
    restore: ["M9 4v5H4", "M15 4v5h5", "M9 20v-5H4", "M15 20v-5h5"],
    launch: ["M7 4.5v15l12-7.5z"],
    clear: [
      "M14.6 4.4l5 5a1.4 1.4 0 0 1 0 2L12 19H8l-3.6-3.6a1.4 1.4 0 0 1 0-2l8.2-9a1.4 1.4 0 0 1 2 0z",
      "M9 9.5l5.5 5.5", "M12 19h8",
    ],
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 18 }: { name: IconName; size?: number } = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#each PATHS[name] as d}<path {d} />{/each}
</svg>
