import { EventEmitter } from "node:events";

const LATEST_URL = "https://registry.npmjs.org/@gphook/squad/latest";
const TIMEOUT_MS = 3000;

const core = (v: string): number[] => v.split("-")[0]!.split(".").map((n) => Number(n) || 0);

/** True when `latest` is newer by major.minor.patch. Prerelease parts are ignored. */
export function isNewer(latest: string, current: string): boolean {
  const a = core(latest), b = core(current);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

/**
 * Asks npm for the latest published version: anonymously (only a generic User-Agent), with a 3 s timeout.
 * Returns it when newer than `current`, otherwise null. Never throws.
 */
export async function checkForUpdate(current: string, opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<string | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  try {
    const r = await fetchFn(LATEST_URL, { headers: { "user-agent": "squad" }, signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS) });
    if (!r.ok) return null;
    const latest = ((await r.json()) as { version?: unknown } | null)?.version;
    return typeof latest === "string" && isNewer(latest, current) ? latest : null;
  } catch {
    return null;
  }
}

export function updateMessage(latest: string, current: string): string {
  return `Squad: version ${latest} is available (you have ${current}). Run npx @gphook/squad@latest.`;
}

export interface UpdateInfo { latest: string; current: string }

/** Holds the newer version once found, so pages connecting later hear about it too. Event: "change"(UpdateInfo). */
export class UpdateNotice extends EventEmitter {
  current: UpdateInfo | null = null;
  set(info: UpdateInfo): void {
    this.current = info;
    this.emit("change", info);
  }
}
