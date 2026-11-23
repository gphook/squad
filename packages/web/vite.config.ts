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
  test: { environment: "jsdom" },
});
