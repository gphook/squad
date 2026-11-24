import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const web = join(import.meta.dirname, "..");
const pub = join(web, "public");

describe("installable app", () => {
  const manifest = JSON.parse(readFileSync(join(pub, "manifest.webmanifest"), "utf8"));

  it("has a manifest a browser can install from", () => {
    expect(manifest).toMatchObject({
      name: "Squad", short_name: "Squad", start_url: "/", scope: "/", display: "standalone",
      background_color: "#fbfbfa", theme_color: "#3a6df0",
    });
    const kinds = manifest.icons.map((i: { sizes: string; type: string; purpose?: string }) => `${i.sizes} ${i.type} ${i.purpose ?? "any"}`);
    expect(kinds).toEqual(expect.arrayContaining([
      "any image/svg+xml any", "192x192 image/png any", "512x512 image/png any", "512x512 image/png maskable",
    ]));
  });

  it("ships every icon the manifest names", () => {
    for (const i of manifest.icons as { src: string }[]) expect(existsSync(join(pub, i.src.replace(/^\//, "")))).toBe(true);
  });

  it("links the manifest, the icon and light and dark theme colours from the page", () => {
    const html = readFileSync(join(web, "index.html"), "utf8");
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('<link rel="icon" href="/icon.svg" type="image/svg+xml"');
    expect(html.match(/<meta name="theme-color"/g)).toHaveLength(2);
  });

  it("has a service worker that caches nothing", () => {
    const sw = readFileSync(join(pub, "sw.js"), "utf8");
    expect(sw).not.toMatch(/caches\./);
    expect(sw).toContain("respondWith(fetch(");
  });
});
