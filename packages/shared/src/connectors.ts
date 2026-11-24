/** Connector templates built into Squad; each drives a host's own CLI to sign git in. */
export const CONNECTOR_TEMPLATES = ["github", "gitlab"] as const;
export type ConnectorTemplateId = (typeof CONNECTOR_TEMPLATES)[number];

/** A connector the user added: one template, signed in on one host. */
export interface Connector { id: string; template: ConnectorTemplateId; name: string; host: string }
export type ConnectorStatus = { state: "missing-cli" } | { state: "signed-out" } | { state: "signed-in"; user: string };
export type ConnectorView = Connector & ConnectorStatus;

/** The one connector sign-in Squad runs at a time, shared by every page. */
export type ConnectorLogin =
  | { phase: "idle" }
  | { phase: "starting"; id: string }
  | { phase: "waiting"; id: string; code: string; url: string }
  | { phase: "token"; id: string; tokenUrl: string; error?: string }
  | { phase: "verifying"; id: string }
  | { phase: "failed"; id: string; message: string };

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function normaliseHost(host: string): string {
  return host.trim().toLowerCase();
}

/** Why `host` isn't a bare host[:port] (no scheme, path or user), or null when it is. */
export function connectorHostError(host: string): string | null {
  const h = normaliseHost(host);
  if (!h) return "Enter a hostname, like github.com.";
  const bad = `"${host.trim()}" isn't a hostname. Enter just the host, like github.example.com or gitlab.example.com:8443.`;
  const m = /^([^:]+)(?::(\d{1,5}))?$/.exec(h);
  if (!m) return bad;
  if (!m[1].split(".").every((l) => LABEL.test(l))) return bad;
  if (m[2] !== undefined && (Number(m[2]) < 1 || Number(m[2]) > 65535)) return bad;
  return null;
}
