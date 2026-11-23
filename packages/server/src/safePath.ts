import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/** Real path of `p` (relative to `base`) if it exists and lies inside one of `roots`, else null. Follows symlinks. */
export function resolveInside(roots: string[], p: string, base?: string): string | null {
  let real: string;
  try {
    real = realpathSync(resolve(base ?? "/", p));
  } catch {
    return null;
  }
  for (const root of roots) {
    let rootReal: string;
    try {
      rootReal = realpathSync(root);
    } catch {
      continue;
    }
    const rel = relative(rootReal, real);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return real;
  }
  return null;
}
