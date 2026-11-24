import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function squadHome(): string {
  return process.env.SQUAD_HOME ?? join(homedir(), ".squad");
}

const created = new Set<string>();

/** A project's share folder, created on first use. */
export function shareDir(projectId: string): string {
  const dir = join(squadHome(), "projects", projectId, "share");
  if (!created.has(dir)) {
    mkdirSync(dir, { recursive: true });
    created.add(dir);
  }
  return dir;
}

/** Where Squad's own files are: the built web UI, the squad-kit plugin and the package.json with the version. */
export interface AppPaths { root: string; web: string; kit: string; packageJson: string }

/**
 * Finds Squad's files in either layout. Packaged (the published npm package, where the bundle sets SQUAD_PACKAGED):
 * `<pkg>/dist/server.js` with `web/` and `kit/` beside `dist/`. From source: the repo, run from packages/server/src.
 */
export function appPaths(opts: { packaged?: boolean; here?: string } = {}): AppPaths {
  const packaged = opts.packaged ?? process.env.SQUAD_PACKAGED === "1";
  const here = opts.here ?? dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, packaged ? ".." : "../../..");
  return {
    root,
    web: packaged ? join(root, "web") : join(root, "packages/web/dist"),
    kit: join(root, "kit"),
    packageJson: join(root, "package.json"),
  };
}

export function appVersion(paths: AppPaths): string {
  try {
    const v = (JSON.parse(readFileSync(paths.packageJson, "utf8")) as { version?: unknown }).version;
    return typeof v === "string" ? v : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
