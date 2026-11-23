import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
