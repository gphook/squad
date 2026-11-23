import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const target = `http://127.0.0.1:${process.env.SQUAD_PORT ?? 7340}`;
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      "/ws": { target, ws: true },
      "/files": target,
      "/api": target,
    },
  },
  // Component tests mount Svelte in jsdom, which needs Svelte's browser build rather than its server one.
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
  test: { environment: "jsdom" },
});
