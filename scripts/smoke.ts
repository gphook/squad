// Installs the packed release/ tarball into a temp folder, as `npx` would, and checks it really runs:
// --version, startup with a setup link, the UI and sign-in gate, and the Claude Code binary resolving.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const release = join(root, "release");
const fail = (what: string): never => {
  console.error(`smoke: FAIL ${what}`);
  process.exit(1);
};
const check = (ok: boolean, what: string) => (ok ? console.log(`smoke: ok   ${what}`) : fail(what));

if (!existsSync(join(release, "package.json"))) fail("release/ is missing: run npm run package first");
const version = JSON.parse(readFileSync(join(release, "package.json"), "utf8")).version as string;
const work = mkdtempSync(join(tmpdir(), "squad-smoke-"));
const home = mkdtempSync(join(tmpdir(), "squad-smoke-home-"));

// `npm run smoke` passes npm_* settings (workspace, prefix…) to its children; a plain install must not see them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toLowerCase().startsWith("npm_")));

const freePort = () => new Promise<number>((resolve) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const { port } = s.address() as { port: number };
    s.close(() => resolve(port));
  });
});

try {
  const tgz = execFileSync("npm", ["pack", "--silent", "--pack-destination", work], { cwd: release, encoding: "utf8", env: cleanEnv }).trim().split("\n").pop()!;
  execFileSync("npm", ["init", "-y", "--silent"], { cwd: work, stdio: "ignore", env: cleanEnv });
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", join(work, tgz)], { cwd: work, stdio: "inherit", env: cleanEnv });
  const bin = join(work, "node_modules/.bin/squad");

  check(execFileSync(bin, ["--version"], { encoding: "utf8" }).trim() === version, `squad --version prints ${version}`);

  const installed = join(work, "node_modules/@gphook/squad/package.json");
  const sdkBinary = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`;
  let resolved = "";
  try { resolved = createRequire(installed).resolve(sdkBinary); } catch { /* checked below */ }
  check(resolved !== "" && existsSync(resolved), `the Claude Code binary resolves (${sdkBinary})`);

  const port = await freePort();
  const child = spawn(bin, ["--no-open", "--port", String(port)], {
    env: { ...cleanEnv, SQUAD_HOME: home, SQUAD_NO_UPDATE_CHECK: "1", SQUAD_DEV: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    let output = "";
    const started = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 20_000);
      const onData = (d: Buffer) => {
        output += d;
        if (output.includes("Squad: set up sign-in at")) { clearTimeout(timer); resolve(true); }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("exit", () => { clearTimeout(timer); resolve(false); });
    });
    check(started, `starts on port ${port} and prints a setup link${started ? "" : `\n${output}`}`);

    const get = (path: string) => fetch(`http://localhost:${port}${path}`, { redirect: "manual" });
    const page = await get("/");
    check(page.status === 200 && (await page.text()).includes("manifest.webmanifest"), "GET / serves the UI with its manifest");
    check((await get("/sw.js")).status === 200, "GET /sw.js is served");
    check((await get("/api/usage?days=7")).status === 401, "GET /api/usage without a session is 401");
  } finally {
    child.kill();
  }
  console.log("smoke: passed");
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
