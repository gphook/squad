import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const target = `http://127.0.0.1:${process.env.SQUAD_PORT ?? 7340}`;
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    // The sign-in gate allows only localhost:5173 in dev, and the setup link points there: fail loudly if it's taken.
    strictPort: true,
    // changeOrigin stays false so the server sees the browser's Host (localhost:5173): the sign-in gate matches Origin
    // against Host, and WebAuthn's expected origin is http://<Host>.
    proxy: {
      "/ws": { target, ws: true, changeOrigin: false },
      "/files": { target, changeOrigin: false },
      "/api": { target, changeOrigin: false },
      "/setup": { target, changeOrigin: false },
    },
  },
  // Component tests mount Svelte in jsdom, which needs Svelte's browser build rather than its server one.
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
  test: { environment: "jsdom" },
});
