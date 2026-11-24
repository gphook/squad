import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { SessionStatus, SignInOverview } from "@squad/shared";

const REMEMBER_KEY = "squad.signin.remember";

async function post(url: string, body?: unknown): Promise<unknown> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${r.status})`);
  return data;
}

export async function fetchSession(): Promise<SessionStatus> {
  const r = await fetch("/api/session");
  if (!r.ok) throw new Error(`Request failed (${r.status})`);
  return r.json();
}

/** login/options, the browser's passkey prompt, then login/verify. Throws Error(message) on failure. */
export async function signIn(remember: boolean): Promise<void> {
  const optionsJSON = (await post("/api/auth/login/options")) as Parameters<typeof startAuthentication>[0]["optionsJSON"];
  const response = await startAuthentication({ optionsJSON });
  await post("/api/auth/login/verify", { response, remember });
}

async function register(remember: boolean): Promise<void> {
  const optionsJSON = (await post("/api/auth/register/options")) as Parameters<typeof startRegistration>[0]["optionsJSON"];
  const response = await startRegistration({ optionsJSON });
  await post("/api/auth/register/verify", { response, remember });
}

export const createPasskey = register;

/** Registers another passkey while signed in; the server ignores `remember` then. */
export const addPasskey = (): Promise<void> => register(false);

export async function signOut(): Promise<void> {
  await post("/api/auth/logout");
}

async function manage(method: "PATCH" | "DELETE" | "POST", url: string, body?: unknown): Promise<void> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (r.ok) return;
  const data = await r.json().catch(() => ({}));
  throw new Error((data as { error?: string }).error ?? `Request failed (${r.status})`);
}

export async function overview(): Promise<SignInOverview> {
  const r = await fetch("/api/signin");
  if (!r.ok) throw Object.assign(new Error(`Request failed (${r.status})`), { status: r.status });
  return r.json();
}

export const renamePasskey = (id: string, name: string) => manage("PATCH", `/api/signin/passkeys/${encodeURIComponent(id)}`, { name });
export const deletePasskey = (id: string) => manage("DELETE", `/api/signin/passkeys/${encodeURIComponent(id)}`);
export const revokeSession = (id: string) => manage("DELETE", `/api/signin/sessions/${encodeURIComponent(id)}`);
export const signOutEverywhere = () => manage("POST", "/api/signin/sign-out-everywhere");

export function rememberedChoice(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveChoice(remember: boolean): void {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
  } catch {
    // storage disabled: the choice just isn't remembered
  }
}
