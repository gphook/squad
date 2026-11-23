import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import type { AuthStatus } from "@squad/shared";

const STATUS_TIMEOUT_MS = 15_000;

/** The Claude Code CLI the SDK runs squadmates with, so the account reported is theirs; `claude` on PATH otherwise. */
export function cliPath(): string {
  try {
    return createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`);
  } catch {
    return "claude";
  }
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** `claude auth status --json` output as an AuthStatus. An API key or another provider counts as signed in. */
export function toAuthStatus(raw: unknown): AuthStatus {
  if (!raw || typeof raw !== "object") return { state: "unknown" };
  const r = raw as Record<string, unknown>;
  const method = str(r.authMethod);
  if (typeof r.loggedIn !== "boolean" && !method) return { state: "unknown" };
  const signedIn = r.loggedIn === true || (method !== undefined && method !== "none");
  const expires = str(r.loginExpiresAt) ? Date.parse(r.loginExpiresAt as string) : NaN;
  const status: AuthStatus = { state: signedIn ? "signedIn" : "signedOut" };
  if (method) status.method = method;
  if (str(r.email)) status.email = r.email as string;
  if (str(r.orgName)) status.organization = r.orgName as string;
  if (str(r.subscriptionType)) status.plan = r.subscriptionType as string;
  if (str(r.apiProvider)) status.provider = r.apiProvider as string;
  if (Number.isFinite(expires)) status.expiresAt = expires;
  return status;
}

const defaultRun = () =>
  new Promise<string>((resolve, reject) => {
    execFile(cliPath(), ["auth", "status", "--json"], { timeout: STATUS_TIMEOUT_MS }, (err, stdout) =>
      // `auth status` exits non-zero when signed out but still prints the JSON.
      stdout ? resolve(stdout) : reject(err ?? new Error("No output")));
  });

/** Keeps the account squadmates run on. Event: "change"(AuthStatus). */
export class AuthTracker extends EventEmitter {
  private status: AuthStatus | null = null;
  private inFlight: Promise<AuthStatus> | null = null;

  constructor(private run: () => Promise<string> = defaultRun) {
    super();
  }

  get current(): AuthStatus | null {
    return this.status;
  }

  refresh(): Promise<AuthStatus> {
    this.inFlight ??= this.run()
      .then((out) => { try { return toAuthStatus(JSON.parse(out)); } catch { return toAuthStatus(null); } })
      .catch(() => toAuthStatus(null))
      .then((next) => {
        const changed = JSON.stringify(next) !== JSON.stringify(this.status);
        this.status = next;
        if (changed) this.emit("change", next);
        return next;
      })
      .finally(() => (this.inFlight = null));
    return this.inFlight;
  }
}
