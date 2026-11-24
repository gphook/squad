import type { Store } from "../store.ts";
import { Passkeys, type WebAuthnLib } from "./passkeys.ts";
import { Sessions } from "./sessions.ts";
import { SetupCodes } from "./setupCodes.ts";

export { registerSignInRoutes, cookieName } from "./routes.ts";

/** Everything sign-in needs, built once per server. */
export interface SignIn { sessions: Sessions; setup: SetupCodes; passkeys: Passkeys; store: Store; dev: boolean }

export function createSignIn(store: Store, opts: { dev: boolean; now?: () => number; lib?: WebAuthnLib }): SignIn {
  const { now, lib, dev } = opts;
  return { sessions: new Sessions(store, { now }), setup: new SetupCodes({ now }), passkeys: new Passkeys(store, { now, lib }), store, dev };
}
