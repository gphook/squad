import { EventEmitter } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import type { Store, SessionRow } from "../store.ts";
import type { SessionKind } from "@squad/shared";

export const REMEMBER_MS = 30 * 24 * 3600_000;
export const TOUCH_MS = 3600_000;

export function hashId(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

/**
 * Sign-in sessions. Only sha256(id) is stored.
 * Emits "revoked"(idHashes) whenever rows are removed, and "created"(idHash) when one is added.
 */
export class Sessions extends EventEmitter {
  private readonly now: () => number;
  constructor(private readonly store: Store, opts: { now?: () => number } = {}) {
    super();
    this.now = opts.now ?? Date.now;
  }

  create(kind: SessionKind, passkeyId: string | null, userAgent: string): { id: string; idHash: string } {
    const id = randomBytes(32).toString("base64url");
    const idHash = hashId(id);
    const at = this.now();
    this.store.addSession({ idHash, kind, passkeyId, createdAt: at, lastUsedAt: at, userAgent, label: sessionLabel(userAgent) });
    this.emit("created", idHash);
    return { id, idHash };
  }

  /** Looks the session up; deletes it if a remember session has expired. Touches at most once per TOUCH_MS. */
  check(id: string): { row: SessionRow; refreshCookie: boolean } | null {
    const idHash = hashId(id);
    const row = this.store.getSession(idHash);
    if (!row) return null;
    const at = this.now();
    if (row.kind === "remember" && at - row.lastUsedAt >= REMEMBER_MS) {
      this.store.deleteSession(idHash);
      this.emit("revoked", [idHash]);
      return null;
    }
    if (at - row.lastUsedAt < TOUCH_MS) return { row, refreshCookie: false };
    this.store.touchSession(idHash, at);
    return { row: { ...row, lastUsedAt: at }, refreshCookie: row.kind === "remember" };
  }

  revoke(idHash: string): void {
    this.store.deleteSession(idHash);
    this.emit("revoked", [idHash]);
  }

  revokeAll(): void {
    this.emit("revoked", this.store.deleteSessionsWhere("all"));
  }

  /** Rows were already removed by the FK cascade; this lets listeners close their sockets. */
  onPasskeyDeleted(idHashes: string[]): void {
    this.emit("revoked", idHashes);
  }

  /** Deletes remember sessions idle for REMEMBER_MS, which check() would refuse, so they leave lists and sockets close. */
  expireIdle(): void {
    const gone = this.store.deleteSessionsIdleSince("remember", this.now() - REMEMBER_MS);
    if (gone.length) this.emit("revoked", gone);
  }

  startup(dev: boolean): void {
    if (!dev) this.store.deleteSessionsWhere("restart");
    this.expireIdle();
  }
}

export function sessionLabel(userAgent: string): string {
  const browser = /Edg\//.test(userAgent) ? "Edge"
    : /OPR\/|Opera/.test(userAgent) ? "Opera"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : /Chrome\/|Chromium\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari"
    : null;
  if (!browser) return "Unknown browser";
  const os = /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad|iPod/.test(userAgent) ? "iOS"
    : /Windows/.test(userAgent) ? "Windows"
    : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
    : /CrOS/.test(userAgent) ? "ChromeOS"
    : /Linux|X11/.test(userAgent) ? "Linux"
    : null;
  return os ? `${browser} on ${os}` : browser;
}
