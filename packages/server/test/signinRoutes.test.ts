import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.ts";
import { Store } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { createSignIn, type SignIn } from "../src/signin/index.ts";
import type { WebAuthnLib } from "../src/signin/passkeys.ts";
import { fakeFactory } from "./fakeQuery.ts";
import { signedInCookie } from "./signinHelper.ts";

const CHROME_LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const clientData = (challenge: string) => Buffer.from(JSON.stringify({ challenge })).toString("base64url");
const resp = (challenge: string, id = "cred1") => ({ id, response: { clientDataJSON: clientData(challenge) } });

let app: FastifyInstance, store: Store, signin: SignIn, port: number;
let n: number, credN: number;

beforeEach(async () => {
  const home = mkdtempSync(join(tmpdir(), "squad-signin-"));
  process.env.SQUAD_HOME = home;
  store = new Store(join(home, "squad.db"));
  const webDist = mkdtempSync(join(tmpdir(), "squad-web-"));
  writeFileSync(join(webDist, "index.html"), "<!doctype html><title>Squad</title>");
  n = 0; credN = 0;
  const lib: WebAuthnLib = {
    generateRegistrationOptions: async () => ({ challenge: `c${++n}` }) as any,
    generateAuthenticationOptions: async () => ({ challenge: `c${++n}` }) as any,
    verifyRegistrationResponse: async (o: any) => {
      const c = JSON.parse(Buffer.from(o.response.response.clientDataJSON, "base64url").toString()).challenge;
      if (!(await o.expectedChallenge(c))) throw new Error("challenge rejected");
      return { verified: true, registrationInfo: { credential: { id: `cred${++credN}`, publicKey: new Uint8Array([1]), counter: 0, transports: [] } } } as any;
    },
    verifyAuthenticationResponse: async (o: any) => {
      const c = JSON.parse(Buffer.from(o.response.response.clientDataJSON, "base64url").toString()).challenge;
      if (!(await o.expectedChallenge(c))) throw new Error("challenge rejected");
      return { verified: true, authenticationInfo: { newCounter: 1 } } as any;
    },
  };
  signin = createSignIn(store, { dev: false, lib });
  const sup = new Supervisor(store, fakeFactory().factory, "/kit");
  app = buildApp({ store, supervisor: sup, signin, webDist });
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = (app.server.address() as { port: number }).port;
});
afterEach(async () => {
  await app.close();
});

const sessionCookie = () => `squad_session_${port}`;
const setupCookie = () => `squad_setup_${port}`;

function req(o: InjectOptions & { url: string }) {
  return app.inject({ ...o, headers: { host: `localhost:${port}`, ...(o.headers ?? {}) } });
}
function post(url: string, payload?: object, cookies: Record<string, string> = {}) {
  return req({
    method: "POST", url, cookies, payload: payload ?? {},
    headers: { origin: `http://localhost:${port}`, "user-agent": CHROME_LINUX },
  });
}
const setCookies = (r: { headers: Record<string, unknown> }): string[] => {
  const h = r.headers["set-cookie"];
  return h === undefined ? [] : Array.isArray(h) ? h.map(String) : [String(h)];
};
const cookieLine = (r: { headers: Record<string, unknown> }, name: string) => setCookies(r).find((c) => c.startsWith(`${name}=`));
const cookieValue = (line: string | undefined) => line?.split(";")[0]!.split("=").slice(1).join("=");

async function grant(): Promise<Record<string, string>> {
  const code = signin.setup.mint();
  const r = await req({ url: `/setup?code=${code}` });
  return { [setupCookie()]: cookieValue(cookieLine(r, setupCookie()))! };
}

async function register(cookies: Record<string, string>, remember: boolean, name?: string) {
  const o = await post("/api/auth/register/options", {}, cookies);
  expect(o.statusCode).toBe(200);
  return post("/api/auth/register/verify", { response: resp(o.json().challenge), remember, ...(name ? { name } : {}) }, cookies);
}

describe("the gate", () => {
  it("GET /api/usage without a session is 401", async () => {
    const r = await req({ url: "/api/usage?days=7" });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: "Signed out" });
  });
  it("GET / is served without a session", async () => {
    const r = await req({ url: "/" });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("<title>Squad</title>");
  });
  it("GET /api/session says setupNeeded with no passkeys", async () => {
    const r = await req({ url: "/api/session" });
    expect(r.json()).toEqual({ signedIn: false, setupNeeded: true, setupGrant: false });
  });
  it("a signed-in request is let through", async () => {
    const r = await req({ url: "/api/usage?days=7", cookies: signedInCookie(signin, port) });
    expect(r.statusCode).toBe(200);
    expect((await req({ url: "/api/session", cookies: signedInCookie(signin, port) })).json().signedIn).toBe(true);
  });
  it("an encoded or dotted path to a protected route is still 401", async () => {
    for (const url of ["/%61pi/usage?days=7", "/api/./usage?days=7", "/fil%65s?project=x&path=y"]) {
      expect((await req({ url })).statusCode, url).toBe(401);
    }
  });
  it("/files/ without a session is 401", async () => {
    expect((await req({ url: "/files/" })).statusCode).toBe(401);
    expect((await req({ url: "/files/a.png?project=x" })).statusCode).toBe(401);
  });
  it("HEAD / is served without a session", async () => {
    expect((await req({ method: "HEAD", url: "/" })).statusCode).toBe(200);
  });
  it("HEAD /api/usage without a session is 401", async () => {
    expect((await req({ method: "HEAD", url: "/api/usage?days=7" })).statusCode).toBe(401);
  });
  it("OPTIONS /api/usage without a session is 401", async () => {
    const r = await req({ method: "OPTIONS", url: "/api/usage?days=7", headers: { origin: `http://localhost:${port}` } });
    expect(r.statusCode).toBe(401);
  });
  it("an unknown path without a session leaks nothing", async () => {
    expect((await req({ url: "/api/nope" })).statusCode).toBe(401);
  });
  it("a cookie for another port is ignored", async () => {
    const { id } = signin.sessions.create("remember", null, "test");
    expect((await req({ url: "/api/usage?days=7", cookies: { squad_session_1: id } })).statusCode).toBe(401);
  });
  it("an unknown host is refused", async () => {
    expect((await req({ url: "/api/session", headers: { host: "evil.example" } })).statusCode).toBe(421);
  });
  it("GET /setup?code=x on 127.0.0.1 redirects to localhost keeping the code", async () => {
    const r = await req({ url: "/setup?code=x", headers: { host: `127.0.0.1:${port}` } });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe(`http://localhost:${port}/setup?code=x`);
  });
  it("a 401 body never contains the session id", async () => {
    const { id } = signin.sessions.create("remember", null, "test");
    signin.sessions.revokeAll();
    const r = await req({ url: "/api/usage?days=7", cookies: { [sessionCookie()]: id } });
    expect(r.statusCode).toBe(401);
    expect(r.body).not.toContain(id);
    expect(JSON.stringify(r.headers)).not.toContain(id);
  });
});

describe("/setup", () => {
  it("/setup with a valid code sets the setup cookie and redirects to / without the code", async () => {
    const code = signin.setup.mint();
    const r = await req({ url: `/setup?code=${code}` });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe("/");
    const line = cookieLine(r, setupCookie())!;
    expect(line).toContain("HttpOnly");
    expect(line).toContain("SameSite=Strict");
    expect(line).toContain("Path=/");
    expect(line).toContain("Max-Age=600");
    expect(line).not.toContain(code);
    expect(signin.setup.grantValid(cookieValue(line))).toBe(true);
    const s = await req({ url: "/api/session", cookies: { [setupCookie()]: cookieValue(line)! } });
    expect(s.json().setupGrant).toBe(true);
  });
  it("/setup with a used or expired code redirects to /?setup=expired", async () => {
    const code = signin.setup.mint();
    await req({ url: `/setup?code=${code}` });
    const used = await req({ url: `/setup?code=${code}` });
    expect(used.statusCode).toBe(302);
    expect(used.headers.location).toBe("/?setup=expired");
    expect(cookieLine(used, setupCookie())).toBeUndefined();
    expect((await req({ url: "/setup" })).headers.location).toBe("/?setup=expired");
  });
});

describe("registration", () => {
  it("register/options without a session or grant is 401", async () => {
    expect((await post("/api/auth/register/options")).statusCode).toBe(401);
  });
  it("register/options with a grant returns options", async () => {
    const r = await post("/api/auth/register/options", {}, await grant());
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ challenge: "c1" });
  });
  it("register/verify with remember=false creates a session cookie with no Max-Age", async () => {
    const r = await register(await grant(), false);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    const line = cookieLine(r, sessionCookie())!;
    expect(line).toMatch(/HttpOnly; SameSite=Strict; Path=\/$/);
    expect(line).not.toContain("Max-Age");
    expect(store.listSessions()).toMatchObject([{ kind: "restart", passkeyId: "cred1" }]);
    expect(store.getPasskey("cred1")!.name).toBe("Chrome on Linux");
  });
  it("register/verify with remember=true has Max-Age=2592000", async () => {
    const r = await register(await grant(), true, "Laptop");
    expect(cookieLine(r, sessionCookie())).toContain("Max-Age=2592000");
    expect(store.listSessions()).toMatchObject([{ kind: "remember" }]);
    expect(store.getPasskey("cred1")!.name).toBe("Laptop");
    const id = cookieValue(cookieLine(r, sessionCookie()))!;
    expect((await req({ url: "/api/usage?days=7", cookies: { [sessionCookie()]: id } })).statusCode).toBe(200);
  });
  it("register/verify clears the setup grant", async () => {
    const g = await grant();
    const r = await register(g, false);
    expect(cookieLine(r, setupCookie())).toContain("Max-Age=0");
    expect(signin.setup.grantValid(g[setupCookie()])).toBe(false);
    expect((await post("/api/auth/register/options", {}, g)).statusCode).toBe(401);
  });
  it("a signed-in user adding a passkey keeps their session and gets no new one", async () => {
    const cookies = signedInCookie(signin, port);
    const r = await register(cookies, true);
    expect(r.statusCode).toBe(200);
    expect(cookieLine(r, sessionCookie())).toBeUndefined();
    expect(store.listSessions()).toHaveLength(1);
    expect(store.listPasskeys()).toHaveLength(1);
  });
  it("register/verify rejects a non-boolean remember or a non-string name with 400", async () => {
    const g = await grant();
    expect((await post("/api/auth/register/verify", { response: resp("c9"), remember: "yes" }, g)).statusCode).toBe(400);
    expect((await post("/api/auth/register/verify", { response: resp("c9"), remember: true, name: 5 }, g)).statusCode).toBe(400);
  });
  it("a POST without an Origin is refused", async () => {
    const r = await req({ method: "POST", url: "/api/auth/login/options", payload: {} });
    expect(r.statusCode).toBe(403);
  });
});

describe("login and logout", () => {
  it("login/verify sets a session cookie; logout clears it and the old cookie is then 401", async () => {
    await register(await grant(), false);
    const o = await post("/api/auth/login/options");
    expect(o.statusCode).toBe(200);
    const r = await post("/api/auth/login/verify", { response: resp(o.json().challenge), remember: true });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    const line = cookieLine(r, sessionCookie())!;
    expect(line).toContain("Max-Age=2592000");
    const cookies = { [sessionCookie()]: cookieValue(line)! };
    expect((await req({ url: "/api/usage?days=7", cookies })).statusCode).toBe(200);

    const out = await post("/api/auth/logout", {}, cookies);
    expect(out.statusCode).toBe(200);
    expect(cookieLine(out, sessionCookie())).toContain("Max-Age=0");
    expect((await req({ url: "/api/usage?days=7", cookies })).statusCode).toBe(401);
  });
  it("a login with an unknown challenge is 401 Passkey not recognised", async () => {
    const r = await post("/api/auth/login/verify", { response: resp("nope"), remember: false });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: "Passkey not recognised" });
    expect(cookieLine(r, sessionCookie())).toBeUndefined();
  });
  it("login/verify rejects a missing remember with 400", async () => {
    expect((await post("/api/auth/login/verify", { response: resp("c1") })).statusCode).toBe(400);
  });
});

describe("management", () => {
  const addPasskey = (id: string, name: string, createdAt: number) =>
    store.addPasskey({ id, publicKey: new Uint8Array([1]), counter: 0, transports: [], name, createdAt });
  const sessionFor = (passkeyId: string | null) => {
    const { id, idHash } = signin.sessions.create("remember", passkeyId, CHROME_LINUX);
    return { idHash, cookies: { [sessionCookie()]: id } };
  };
  const call = (method: "GET" | "PATCH" | "DELETE" | "POST", url: string, cookies: Record<string, string>, payload?: object) =>
    req({ method, url, cookies, ...(payload ? { payload } : {}), headers: { origin: `http://localhost:${port}` } });

  it("GET /api/signin lists passkeys and sessions and marks the current one", async () => {
    addPasskey("b", "Second", 20);
    addPasskey("a", "First", 10);
    const s1 = sessionFor("a"), s2 = sessionFor("b");
    const r = await call("GET", "/api/signin", s1.cookies);
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.passkeys.map((p: { id: string }) => p.id)).toEqual(["a", "b"]);
    expect(body.sessions).toHaveLength(2);
    const cur = body.sessions.filter((s: { current: boolean }) => s.current);
    expect(cur.map((s: { id: string }) => s.id)).toEqual([s1.idHash]);
    expect(body.sessions.find((s: { id: string }) => s.id === s2.idHash).current).toBe(false);
  });

  it("deleting the only passkey is 409", async () => {
    addPasskey("a", "Only", 10);
    const s = sessionFor("a");
    const r = await call("DELETE", "/api/signin/passkeys/a", s.cookies);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("You can't delete your only passkey");
    expect(store.listPasskeys()).toHaveLength(1);
  });

  it("deleting a passkey ends its sessions", async () => {
    addPasskey("a", "A", 10);
    addPasskey("b", "B", 20);
    const sa = sessionFor("a"), sb = sessionFor("b");
    const revoked: string[][] = [];
    signin.sessions.on("revoked", (h: string[]) => revoked.push(h));
    expect((await call("DELETE", "/api/signin/passkeys/a", sb.cookies)).statusCode).toBe(204);
    expect((await call("GET", "/api/signin", sa.cookies)).statusCode).toBe(401);
    expect((await call("GET", "/api/signin", sb.cookies)).statusCode).toBe(200);
    expect(revoked).toEqual([[sa.idHash]]);
  });

  it("renaming validates length", async () => {
    addPasskey("a", "A", 10);
    const s = sessionFor("a");
    const rename = (name: unknown) => call("PATCH", "/api/signin/passkeys/a", s.cookies, { name });
    expect((await rename("")).statusCode).toBe(400);
    expect((await rename("   ")).statusCode).toBe(400);
    expect((await rename("x".repeat(61))).statusCode).toBe(400);
    expect((await rename(5)).statusCode).toBe(400);
    expect((await rename("  Laptop  ")).statusCode).toBe(204);
    expect(store.getPasskey("a")!.name).toBe("Laptop");
    expect((await call("PATCH", "/api/signin/passkeys/nope", s.cookies, { name: "x" })).statusCode).toBe(404);
  });

  it("revoking another session ends it; revoking your own clears the cookie", async () => {
    const s1 = sessionFor(null), s2 = sessionFor(null);
    expect((await call("DELETE", `/api/signin/sessions/${s2.idHash}`, s1.cookies)).statusCode).toBe(204);
    expect((await call("GET", "/api/signin", s2.cookies)).statusCode).toBe(401);
    const r = await call("DELETE", `/api/signin/sessions/${s1.idHash}`, s1.cookies);
    expect(r.statusCode).toBe(204);
    expect(cookieLine(r, sessionCookie())).toContain("Max-Age=0");
    expect((await call("GET", "/api/signin", s1.cookies)).statusCode).toBe(401);
  });

  it("sign out everywhere ends every session and clears the caller's cookie", async () => {
    const s1 = sessionFor(null), s2 = sessionFor(null);
    const r = await call("POST", "/api/signin/sign-out-everywhere", s1.cookies);
    expect(r.statusCode).toBe(204);
    expect(cookieLine(r, sessionCookie())).toContain("Max-Age=0");
    expect((await call("GET", "/api/signin", s2.cookies)).statusCode).toBe(401);
  });
});
