// Builds the publishable @gphook/squad package into release/:
//   bin/squad.js, dist/server.js (server + @squad/shared bundled by esbuild), web/ (built UI), kit/, package.json.
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { releasePackageJson } from "./releasePackage.ts";

const root = join(import.meta.dirname, "..");
const out = join(root, "release");
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });

const pkg = releasePackageJson(readJson("package.json"), readJson("packages/server/package.json"));
await build({
  entryPoints: [join(root, "packages/server/src/main.ts")],
  outfile: join(out, "dist/server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: Object.keys(pkg.dependencies),
  define: { "process.env.SQUAD_PACKAGED": '"1"' },
  // Some dependencies' CommonJS code calls require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __squadRequire } from 'node:module'; const require = __squadRequire(import.meta.url);" },
  logLevel: "warning",
});

cpSync(join(root, "packages/web/dist"), join(out, "web"), { recursive: true });
cpSync(join(root, "kit"), join(out, "kit"), { recursive: true });
mkdirSync(join(out, "bin"));
cpSync(join(root, "release-assets/bin/squad.js"), join(out, "bin/squad.js"));
chmodSync(join(out, "bin/squad.js"), 0o755);
for (const f of ["README.md", "LICENSE"]) cpSync(join(root, f), join(out, f));
writeFileSync(join(out, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

// The tarball must hold exactly what Squad needs, and nothing from the repo besides.
const listing = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: out, encoding: "utf8" })) as { files: { path: string }[] }[];
const files = listing[0]!.files.map((f) => f.path);
const required = ["bin/squad.js", "dist/server.js", "web/index.html", "web/manifest.webmanifest", "web/sw.js", "kit/.claude-plugin/plugin.json"];
const missing = required.filter((f) => !files.includes(f));
const allowed = /^(bin|dist|web|kit)\/|^(README\.md|LICENSE|package\.json)$/;
const stray = files.filter((f) => !allowed.test(f));
if (missing.length || stray.length) {
  console.error(`package: missing ${JSON.stringify(missing)}, unexpected ${JSON.stringify(stray)}`);
  process.exit(1);
}
console.log(`package: release/ holds @gphook/squad ${pkg.version} (${files.length} files)`);
