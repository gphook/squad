import type { AddressInfo } from "node:net";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SessionKind, SessionStatus } from "@squad/shared";
import type { SessionRow } from "../store.ts";
import type { SignIn } from "./index.ts";
import { checkRequest, isPublicPath } from "./gate.ts";
import { REMEMBER_MS, sessionLabel } from "./sessions.ts";

declare module "fastify" {
  interface FastifyRequest {
    /** The signed-in session, resolved from the cookie by the sign-in hook; null when signed out. */
    session: SessionRow | null;
  }
}

const SETUP_MAX_AGE = 600;
const REMEMBER_MAX_AGE = REMEMBER_MS / 1000;

export function cookieName(kind: "session" | "setup", port: number): string {
  return `squad_${kind}_${port}`;
}

/** Ruling R1: the listening port (inject has no real socket), else the socket's local port. */
function serverPort(app: FastifyInstance, req: FastifyRequest): number {
  const a = app.server.address() as AddressInfo | string | null;
  return a && typeof a === "object" ? a.port : (req.socket.localPort ?? 0);
}

function readCookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** Max-Age omitted = a browser-session cookie; 0 = clear it. */
const cookie = (name: string, value: string, maxAge?: number): string =>
  `${name}=${value}; HttpOnly; SameSite=Strict; Path=/${maxAge === undefined ? "" : `; Max-Age=${maxAge}`}`;

const sessionCookie = (port: number, id: string, kind: SessionKind): string =>
  cookie(cookieName("session", port), id, kind === "remember" ? REMEMBER_MAX_AGE : undefined);

interface VerifyBody { response: unknown; remember: boolean; name?: string }

function verifyBody(body: unknown): VerifyBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.remember !== "boolean") return null;
  if (b.name !== undefined && typeof b.name !== "string") return null;
  return { response: b.response, remember: b.remember, name: b.name as string | undefined };
}

const kindOf = (remember: boolean): SessionKind => (remember ? "remember" : "restart");

/** Adds the request gate (Host, Origin, session) to every route, and the sign-in routes. Call before other routes. */
export function registerSignInRoutes(app: FastifyInstance, s: SignIn): void {
  app.decorateRequest("session", null);

  app.addHook("onRequest", async (req, reply) => {
    const port = serverPort(app, req);
    const gate = checkRequest({
      method: req.method, path: req.url, host: req.headers.host, origin: req.headers.origin,
      serverPort: port, dev: s.dev, upgrade: req.headers.upgrade?.toLowerCase() === "websocket",
    });
    if ("redirect" in gate) return reply.redirect(gate.redirect, 302);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });

    req.session = null;
    const id = readCookie(req, cookieName("session", port));
    const found = id ? s.sessions.check(id) : null;
    if (found && id) {
      req.session = found.row;
      if (found.refreshCookie) reply.header("set-cookie", sessionCookie(port, id, found.row.kind));
    }
    if (req.session) return;
    // Both the raw URL and the route the router matched must be open: the router decodes %xx (so /%61pi/usage
    // reaches /api/usage), and a wildcard static route matches unknown /api/ paths.
    const paths = [req.url, req.routeOptions.url ?? req.url];
    if (paths.every((p) => isPublicPath(req.method, p))) return;
    const registering = paths.every((p) => p.startsWith("/api/auth/register/"))
      && s.setup.grantValid(readCookie(req, cookieName("setup", port)));
    if (!registering) return reply.code(401).send({ error: "Signed out" });
  });

  const expectedOrigin = (req: FastifyRequest): string => `http://${req.headers.host}`;
  const userAgent = (req: FastifyRequest): string => req.headers["user-agent"] ?? "";

  function startSession(req: FastifyRequest, reply: FastifyReply, remember: boolean, passkeyId: string): void {
    const kind = kindOf(remember);
    const { id } = s.sessions.create(kind, passkeyId, userAgent(req));
    reply.header("set-cookie", sessionCookie(serverPort(app, req), id, kind));
  }

  app.get("/api/session", async (req): Promise<SessionStatus> => ({
    signedIn: req.session !== null,
    setupNeeded: s.store.listPasskeys().length === 0,
    setupGrant: s.setup.grantValid(readCookie(req, cookieName("setup", serverPort(app, req)))),
  }));

  // The code leaves the address bar at once: it is swapped for a grant cookie and never echoed.
  app.get("/setup", async (req, reply) => {
    const code = (req.query as Record<string, unknown>).code;
    const grant = typeof code === "string" ? s.setup.redeem(code) : null;
    if (!grant) return reply.redirect("/?setup=expired", 302);
    reply.header("set-cookie", cookie(cookieName("setup", serverPort(app, req)), grant, SETUP_MAX_AGE));
    return reply.redirect("/", 302);
  });

  app.post("/api/auth/register/options", async () => s.passkeys.registrationOptions());

  app.post("/api/auth/register/verify", async (req, reply) => {
    const body = verifyBody(req.body);
    if (!body) return reply.code(400).send({ error: "Bad request" });
    const name = body.name?.trim() || sessionLabel(userAgent(req));
    const passkeyId = await s.passkeys.verifyRegistration(body.response, expectedOrigin(req), name);
    if (!passkeyId) return reply.code(400).send({ error: "Passkey not created" });
    const port = serverPort(app, req);
    const grant = readCookie(req, cookieName("setup", port));
    if (grant) {
      s.setup.consumeGrant(grant);
      reply.header("set-cookie", cookie(cookieName("setup", port), "", 0));
    }
    // Adding a passkey from Settings keeps the current session.
    if (!req.session) startSession(req, reply, body.remember, passkeyId);
    return { ok: true };
  });

  app.post("/api/auth/login/options", async () => s.passkeys.loginOptions());

  app.post("/api/auth/login/verify", async (req, reply) => {
    const body = verifyBody(req.body);
    if (!body) return reply.code(400).send({ error: "Bad request" });
    const passkeyId = await s.passkeys.verifyLogin(body.response, expectedOrigin(req));
    if (!passkeyId) return reply.code(401).send({ error: "Passkey not recognised" });
    if (req.session) s.sessions.revoke(req.session.idHash);
    startSession(req, reply, body.remember, passkeyId);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.session) s.sessions.revoke(req.session.idHash);
    reply.header("set-cookie", cookie(cookieName("session", serverPort(app, req)), "", 0));
    return { ok: true };
  });
}
