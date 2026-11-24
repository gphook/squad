import { randomBytes } from "node:crypto";
import * as simplewebauthn from "@simplewebauthn/server";
import type { Store } from "../store.ts";

export type WebAuthnLib = Pick<typeof import("@simplewebauthn/server"),
  "generateRegistrationOptions" | "verifyRegistrationResponse" | "generateAuthenticationOptions" | "verifyAuthenticationResponse">;

const RP_ID = "localhost";
const RP_NAME = "Squad";
const CHALLENGE_MS = 5 * 60_000;
const USER_HANDLE_KEY = "userHandle";

/** The challenge the browser signed, read from the response's clientDataJSON. */
function challengeOf(response: unknown): string | null {
  try {
    const b64 = (response as { response?: { clientDataJSON?: unknown } })?.response?.clientDataJSON;
    if (typeof b64 !== "string") return null;
    const c = JSON.parse(Buffer.from(b64, "base64url").toString("utf8")).challenge;
    return typeof c === "string" ? c : null;
  } catch { return null; }
}

/** WebAuthn registration and login ceremonies, with single-use challenges kept in memory. */
export class Passkeys {
  private challenges = new Map<string, number>();
  private now: () => number;
  private lib: WebAuthnLib;

  constructor(private store: Store, opts: { now?: () => number; lib?: WebAuthnLib } = {}) {
    this.now = opts.now ?? Date.now;
    this.lib = opts.lib ?? simplewebauthn;
  }

  private sweep(): void {
    const t = this.now();
    for (const [c, exp] of this.challenges) if (exp <= t) this.challenges.delete(c);
  }

  private remember(challenge: string): void {
    this.challenges.set(challenge, this.now() + CHALLENGE_MS);
  }

  /** The stable WebAuthn user handle, created on first use. */
  private userHandle(): Uint8Array<ArrayBuffer> {
    let h = this.store.signinMeta(USER_HANDLE_KEY);
    if (!h) { h = randomBytes(32).toString("base64url"); this.store.setSigninMeta(USER_HANDLE_KEY, h); }
    return Uint8Array.from(Buffer.from(h, "base64url"));
  }

  async registrationOptions(): Promise<unknown> {
    this.sweep();
    const options = await this.lib.generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID, userName: "squad", userID: this.userHandle(),
      excludeCredentials: this.store.listPasskeys().map((p) => ({ id: p.id, transports: p.transports })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    });
    this.remember(options.challenge);
    return options;
  }

  /** Consumes the response's challenge (pass or fail); null when it is unknown or expired. */
  private take(response: unknown): ((c: string) => boolean) | null {
    this.sweep();
    const challenge = challengeOf(response);
    if (challenge === null || !this.challenges.has(challenge)) return null;
    return (c) => c === challenge && this.challenges.delete(c);
  }

  async verifyRegistration(response: unknown, expectedOrigin: string, name: string): Promise<string | null> {
    const expectedChallenge = this.take(response);
    if (!expectedChallenge) return null;
    const challenge = challengeOf(response)!;
    try {
      const res = await this.lib.verifyRegistrationResponse({
        response: response as never, expectedChallenge, expectedOrigin, expectedRPID: RP_ID,
        requireUserVerification: true,
      });
      if (!res.verified) return null;
      const cred = res.registrationInfo.credential;
      this.store.addPasskey({
        id: cred.id, publicKey: cred.publicKey, counter: cred.counter,
        transports: cred.transports ?? [], name, createdAt: this.now(),
      });
      return cred.id;
    } catch { return null; }
    finally { this.challenges.delete(challenge); }
  }

  async loginOptions(): Promise<unknown> {
    this.sweep();
    const options = await this.lib.generateAuthenticationOptions({ rpID: RP_ID, userVerification: "required" });
    this.remember(options.challenge);
    return options;
  }

  async verifyLogin(response: unknown, expectedOrigin: string): Promise<string | null> {
    const expectedChallenge = this.take(response);
    if (!expectedChallenge) return null;
    const challenge = challengeOf(response)!;
    try {
      const id = (response as { id?: unknown }).id;
      const passkey = typeof id === "string" ? this.store.getPasskey(id) : null;
      if (!passkey) return null;
      const res = await this.lib.verifyAuthenticationResponse({
        response: response as never, expectedChallenge, expectedOrigin, expectedRPID: RP_ID,
        credential: { id: passkey.id, publicKey: passkey.publicKey as never, counter: passkey.counter, transports: passkey.transports as never },
        requireUserVerification: true,
      });
      if (!res.verified) return null;
      this.store.passkeyUsed(passkey.id, res.authenticationInfo.newCounter, this.now());
      return passkey.id;
    } catch { return null; }
    finally { this.challenges.delete(challenge); }
  }
}
