import { EventEmitter } from "node:events";
import type { Store } from "../store.ts";
import { Passkeys, type WebAuthnLib } from "./passkeys.ts";
import { Sessions } from "./sessions.ts";
import { SetupCodes } from "./setupCodes.ts";

export { registerSignInRoutes, cookieName } from "./routes.ts";

/**
 * Everything sign-in needs, built once per server.
 * `changes` emits "changed" whenever the passkey or session lists change, so open Sign-in views can refresh.
 */
export interface SignIn { sessions: Sessions; setup: SetupCodes; passkeys: Passkeys; store: Store; dev: boolean; changes: EventEmitter }

export function createSignIn(store: Store, opts: { dev: boolean; now?: () => number; lib?: WebAuthnLib }): SignIn {
  const { now, lib, dev } = opts;
  const sessions = new Sessions(store, { now });
  const changes = new EventEmitter();
  const changed = () => changes.emit("changed");
  sessions.on("created", changed);
  sessions.on("revoked", (hashes: string[]) => { if (hashes.length) changed(); });
  return { sessions, setup: new SetupCodes({ now }), passkeys: new Passkeys(store, { now, lib }), store, dev, changes };
}
