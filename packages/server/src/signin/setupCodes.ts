import { randomBytes, timingSafeEqual } from "node:crypto";

const TTL_MS = 10 * 60_000;

/** One in-memory, single-use setup code (10 min). Redeeming it yields a grant (10 min) for registering a passkey. */
export class SetupCodes {
  private readonly now: () => number;
  private code: { value: string; expires: number } | null = null;
  private readonly grants = new Map<string, number>();
  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
  }

  mint(): string {
    const value = randomBytes(32).toString("base64url");
    this.code = { value, expires: this.now() + TTL_MS };
    return value;
  }

  redeem(code: string): string | null {
    const cur = this.code;
    if (!cur || this.now() >= cur.expires) return null;
    const a = Buffer.from(code);
    const b = Buffer.from(cur.value);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    this.code = null;
    const grant = randomBytes(32).toString("base64url");
    this.grants.set(grant, this.now() + TTL_MS);
    return grant;
  }

  grantValid(grant: string | undefined): boolean {
    if (!grant) return false;
    const expires = this.grants.get(grant);
    if (expires === undefined) return false;
    if (this.now() >= expires) { this.grants.delete(grant); return false; }
    return true;
  }

  consumeGrant(grant: string): void {
    this.grants.delete(grant);
  }

  get pending(): boolean {
    return this.code !== null && this.now() < this.code.expires;
  }
}
