// Pure request gate: Host allow-list, canonical-host redirect, Origin check.
export interface GateInput {
  method: string;
  /** URL including query */
  path: string;
  host: string | undefined;
  origin: string | undefined;
  serverPort: number;
  dev: boolean;
  upgrade: boolean;
}
export type GateResult = { ok: true } | { ok: false; status: 403 | 421; error: string } | { redirect: string };

const DEV_PORT = 5173;

const pathname = (path: string): string => path.split(/[?#]/, 1)[0]!;

/** Non-page routes: the API, file downloads and the WebSocket. */
const isNonPage = (p: string): boolean => p.startsWith("/api/") || p === "/files" || p === "/ws";

export function checkRequest(r: GateInput): GateResult {
  const allowed = new Set([`localhost:${r.serverPort}`, `127.0.0.1:${r.serverPort}`]);
  if (r.dev) allowed.add(`localhost:${DEV_PORT}`);
  if (r.host === undefined || !allowed.has(r.host)) return { ok: false, status: 421, error: "Unknown host" };

  const get = r.method === "GET";
  if (get && !r.upgrade && !isNonPage(pathname(r.path)) && r.host === `127.0.0.1:${r.serverPort}`) {
    return { redirect: `http://localhost:${r.serverPort}${r.path}` };
  }

  const originRequired = !get || r.upgrade;
  if (r.origin === undefined ? originRequired : r.origin !== `http://${r.host}`) {
    return { ok: false, status: 403, error: "Bad origin" };
  }
  return { ok: true };
}

export function isPublicPath(method: string, path: string): boolean {
  const p = pathname(path);
  if (p.startsWith("/api/auth/login/")) return true;
  if (method !== "GET") return false;
  return !isNonPage(p) || p === "/api/session";
}
