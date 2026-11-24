import { describe, it, expect } from "vitest";
import { checkRequest, isPublicPath, type GateInput } from "../src/signin/gate.ts";

const base: GateInput = {
  method: "GET",
  path: "/",
  host: "localhost:7340",
  origin: undefined,
  serverPort: 7340,
  dev: false,
  upgrade: false,
};
const req = (o: Partial<GateInput>) => checkRequest({ ...base, ...o });

describe("checkRequest", () => {
  it("refuses an unknown Host", () => {
    expect(req({ host: "evil.example:7340" })).toEqual({ ok: false, status: 421, error: "Unknown host" });
    expect(req({ host: undefined })).toEqual({ ok: false, status: 421, error: "Unknown host" });
  });

  it("allows localhost:5173 only in dev", () => {
    expect(req({ host: "localhost:5173" })).toMatchObject({ ok: false, status: 421 });
    expect(req({ host: "localhost:5173", dev: true })).toEqual({ ok: true });
  });

  it("redirects a 127.0.0.1 page GET to localhost, keeping path and query", () => {
    expect(req({ host: "127.0.0.1:7340", path: "/setup?code=abc" })).toEqual({
      redirect: "http://localhost:7340/setup?code=abc",
    });
  });

  it("does not redirect 127.0.0.1 API GETs", () => {
    expect(req({ host: "127.0.0.1:7340", path: "/api/session" })).toEqual({ ok: true });
    expect(req({ host: "127.0.0.1:7340", path: "/files?x=1" })).toEqual({ ok: true });
  });

  it("refuses a POST with no Origin", () => {
    expect(req({ method: "POST", path: "/api/x" })).toEqual({ ok: false, status: 403, error: "Bad origin" });
  });

  it("refuses a POST from another origin", () => {
    expect(req({ method: "POST", path: "/api/x", origin: "http://evil.example" })).toMatchObject({ status: 403 });
  });

  it("refuses a WebSocket upgrade from another origin", () => {
    expect(req({ path: "/ws", upgrade: true, origin: "http://evil.example:7340" })).toMatchObject({ status: 403 });
    expect(req({ path: "/ws", upgrade: true })).toMatchObject({ status: 403 });
  });

  it("allows a same-origin POST", () => {
    expect(req({ method: "POST", path: "/api/x", origin: "http://localhost:7340" })).toEqual({ ok: true });
  });

  it("refuses a GET with a mismatched Origin but allows one without", () => {
    expect(req({ origin: "http://evil.example" })).toMatchObject({ status: 403 });
    expect(req({ origin: "http://localhost:7340" })).toEqual({ ok: true });
  });
});

describe("isPublicPath", () => {
  it("is true for the shell, assets, session, login and setup", () => {
    expect(isPublicPath("GET", "/")).toBe(true);
    expect(isPublicPath("GET", "/assets/x.js")).toBe(true);
    expect(isPublicPath("GET", "/api/session")).toBe(true);
    expect(isPublicPath("POST", "/api/auth/login/options")).toBe(true);
    expect(isPublicPath("GET", "/setup")).toBe(true);
  });

  it("is false for everything else", () => {
    expect(isPublicPath("GET", "/api/usage")).toBe(false);
    expect(isPublicPath("GET", "/files")).toBe(false);
    expect(isPublicPath("GET", "/ws")).toBe(false);
    expect(isPublicPath("POST", "/api/auth/register/options")).toBe(false);
    expect(isPublicPath("POST", "/api/projects/p/shares")).toBe(false);
  });
});
