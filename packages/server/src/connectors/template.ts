import type { ConnectorTemplateId } from "@squad/shared";

export type SignInPlan =
  | { kind: "device"; args: string[]; env: NodeJS.ProcessEnv }
  | { kind: "token"; tokenUrl: string };

/** A kind of connector: how to sign git in to one host through that host's own CLI. */
export interface ConnectorTemplate {
  id: ConnectorTemplateId;
  label: string;
  defaultHost: string;
  cli: { bin: string; label: string; installUrl: string };
  /** The CLI is on PATH. */
  available(): Promise<boolean>;
  /** Every host the CLI is signed in to; none when it isn't installed. */
  accounts(): Promise<{ host: string; user: string }[]>;
  signInPlan(host: string): SignInPlan;
  /** The code and link from a device flow's output so far; null until both have been printed. */
  parseDevice(output: string): { code: string; url: string } | null;
  /** Signs in with a pasted access token (token plans only). Rejects with a message to show. */
  tokenSignIn?(host: string, token: string): Promise<void>;
  /** Finishes a successful device sign-in, e.g. pointing git at the CLI's credentials. */
  afterSignIn(host: string): Promise<void>;
  signOut(host: string): Promise<void>;
}

/** Signed-in accounts from `<cli> auth status` text: one per `Logged in to <host> <word> <user>` line. */
export function parseAccounts(text: string, word: RegExp): { host: string; user: string }[] {
  const re = new RegExp(String.raw`Logged in to (\S+) (?:${word.source}) (\S+)`, "g");
  return [...text.matchAll(re)].map((m) => ({ host: m[1].toLowerCase(), user: m[2] }));
}

/**
 * The git host a marketplace source lives on: `owner/repo` is github.com; https, ssh and scp-style git URLs give
 * their host (with any port). Null for paths and anything else.
 */
export function sourceHost(source: string): string | null {
  const s = source.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(s) && !s.startsWith(".")) return "github.com";
  const url = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/]+)/i.exec(s);
  if (url) return url[1].toLowerCase();
  const scp = /^[\w.-]+@([\w.-]+):(?!\/)/.exec(s);
  return scp ? scp[1].toLowerCase() : null;
}
