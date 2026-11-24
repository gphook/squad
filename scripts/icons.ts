// Renders the app icons' PNGs from their SVGs (run by hand after changing an icon; the PNGs are committed).
// Needs rsvg-convert (librsvg).
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const pub = join(import.meta.dirname, "../packages/web/public");
const render = (svg: string, size: number, out: string) =>
  execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), "-o", join(pub, out), join(pub, svg)]);

render("icon.svg", 192, "icon-192.png");
render("icon.svg", 512, "icon-512.png");
render("icon-maskable.svg", 512, "icon-maskable-512.png");
console.log("icons rendered");
