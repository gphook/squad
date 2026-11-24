import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { Passkeys, type WebAuthnLib } from "../src/signin/passkeys.ts";

const MIN = 60_000;
const ORIGIN = "http://localhost:3000";
const clientData = (challenge: string) => Buffer.from(JSON.stringify({ challenge })).toString("base64url");
const resp = (challenge: string, id = "cred1") => ({ id, response: { clientDataJSON: clientData(challenge) } });

let store: Store;
let t: number;
let n: number;
let calls: Record<string, any[]>;
let fail: boolean;
let lib: WebAuthnLib;
let pk: Passkeys;

beforeEach(() => {
  store = new Store(join(mkdtempSync(join(tmpdir(), "squad-passkeys-")), "squad.db"));
  t = 1_000_000; n = 0; fail = false;
  calls = { reg: [], regVerify: [], auth: [], authVerify: [] };
  lib = {
    generateRegistrationOptions: async (o: any) => { calls.reg.push(o); return { challenge: `c${++n}` } as any; },
    generateAuthenticationOptions: async (o: any) => { calls.auth.push(o); return { challenge: `c${++n}` } as any; },
    verifyRegistrationResponse: async (o: any) => {
      calls.regVerify.push(o);
      if (fail) throw new Error("boom");
      return { verified: true, registrationInfo: { credential: { id: "cred1", publicKey: new Uint8Array([1, 2]), counter: 0, transports: ["internal"] } } } as any;
    },
    verifyAuthenticationResponse: async (o: any) => {
      calls.authVerify.push(o);
      if (fail) throw new Error("boom");
      return { verified: true, authenticationInfo: { newCounter: 7 } } as any;
    },
  };
  pk = new Passkeys(store, { now: () => t, lib });
});

async function register(): Promise<string | null> {
  await pk.registrationOptions();
  return pk.verifyRegistration(resp(`c${n}`), ORIGIN, "Laptop");
}

describe("Passkeys", () => {
  it("registration stores the passkey with the name given", async () => {
    expect(await register()).toBe("cred1");
    const row = store.getPasskey("cred1")!;
    expect(row.name).toBe("Laptop");
    expect(row.transports).toEqual(["internal"]);
    expect(calls.regVerify[0].expectedOrigin).toBe(ORIGIN);
    expect(calls.regVerify[0].expectedRPID).toBe("localhost");
  });

  it("login returns the passkey id and updates the counter", async () => {
    await register();
    await pk.loginOptions();
    expect(await pk.verifyLogin(resp(`c${n}`), ORIGIN)).toBe("cred1");
    expect(store.getPasskey("cred1")!.counter).toBe(7);
    expect(calls.authVerify[0].credential.id).toBe("cred1");
  });

  it("a challenge cannot be used twice", async () => {
    await pk.registrationOptions();
    expect(await pk.verifyRegistration(resp("c1"), ORIGIN, "A")).toBe("cred1");
    expect(await pk.verifyRegistration(resp("c1"), ORIGIN, "B")).toBeNull();
    expect(calls.regVerify).toHaveLength(1);
  });

  it("a challenge older than 5 minutes is refused", async () => {
    await pk.registrationOptions();
    t += 5 * MIN + 1;
    expect(await pk.verifyRegistration(resp("c1"), ORIGIN, "A")).toBeNull();
    expect(calls.regVerify).toHaveLength(0);
  });

  it("a challenge the server never issued is refused before the library runs", async () => {
    expect(await pk.verifyRegistration(resp("nope"), ORIGIN, "A")).toBeNull();
    expect(await pk.verifyLogin({ id: "cred1", response: {} }, ORIGIN)).toBeNull();
    expect(calls.regVerify).toHaveLength(0);
  });

  it("a login for an unknown credential returns null", async () => {
    await pk.loginOptions();
    expect(await pk.verifyLogin(resp("c1", "ghost"), ORIGIN)).toBeNull();
    expect(calls.authVerify).toHaveLength(0);
  });

  it("library errors become null and still spend the challenge", async () => {
    await register();
    await pk.loginOptions();
    fail = true;
    expect(await pk.verifyLogin(resp(`c${n}`), ORIGIN)).toBeNull();
    fail = false;
    expect(await pk.verifyLogin(resp(`c${n}`), ORIGIN)).toBeNull();
  });

  it("registrationOptions passes rpID, user verification, resident key and excludes existing credentials", async () => {
    await register();
    await pk.registrationOptions();
    const o = calls.reg[1];
    expect(o.rpID).toBe("localhost");
    expect(o.rpName).toBe("Squad");
    expect(o.authenticatorSelection).toEqual({ residentKey: "preferred", userVerification: "required" });
    expect(o.excludeCredentials).toEqual([{ id: "cred1", transports: ["internal"] }]);
  });

  it("keeps one user handle of 32 bytes across calls", async () => {
    await pk.registrationOptions();
    await pk.registrationOptions();
    expect(calls.reg[0].userID).toHaveLength(32);
    expect(calls.reg[1].userID).toEqual(calls.reg[0].userID);
    expect(store.signinMeta("userHandle")).not.toBeNull();
  });

  it("loginOptions asks for user verification and no allowCredentials", async () => {
    await pk.loginOptions();
    expect(calls.auth[0]).toEqual({ rpID: "localhost", userVerification: "required" });
  });
});
