// @vitest-environment node
import { describe, it, expect } from "vitest";
import config from "../vite.config.ts";

describe("vite dev proxy", () => {
  // The sign-in gate checks Origin against Host, and WebAuthn's expected origin is http://<Host>, so the proxy must
  // forward the browser's Host (localhost:5173) rather than rewrite it to the server's.
  it("keeps the browser's Host for every proxied path", () => {
    const proxy = config.server!.proxy as Record<string, { target: string; changeOrigin?: boolean; ws?: boolean }>;
    expect(Object.keys(proxy).sort()).toEqual(["/api", "/files", "/setup", "/ws"]);
    for (const [path, entry] of Object.entries(proxy)) {
      expect(typeof entry, path).toBe("object");
      expect(entry.changeOrigin ?? false, path).toBe(false);
      expect(entry.target, path).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    }
    expect(proxy["/ws"]!.ws).toBe(true);
  });
});
