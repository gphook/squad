/**
 * The maximised tile's share of the workspace width (0..1), set by dragging the bar beside it. It depends on the
 * screen, so it's kept per browser rather than in the project's layout. Null means the default split.
 */
const KEY = "squad.maximisedWidth";
export const MIN_SPLIT = 0.3;
export const MAX_SPLIT = 0.9;
/** Roughly where the default flex split puts the bar, so arrow keys start from there. */
const DEFAULT_SPLIT = 0.75;
const STEP = 0.02;

export const clampSplit = (f: number): number => Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, f));

export const stepSplit = (f: number | null, dir: 1 | -1): number => clampSplit((f ?? DEFAULT_SPLIT) + dir * STEP);

export function loadSplit(): number | null {
  try {
    const v = localStorage.getItem(KEY);
    const f = v === null ? NaN : Number(v);
    return Number.isFinite(f) ? clampSplit(f) : null;
  } catch {
    return null;
  }
}

export function saveSplit(f: number | null): void {
  try {
    if (f === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(f));
  } catch {
    // storage disabled: the width lasts until reload
  }
}
