import type { AuthStatus } from "@squad/shared";

const DAY_MS = 86_400_000;
const EXPIRY_WARN_DAYS = 3;
const PROVIDERS: Record<string, string> = {
  bedrock: "Bedrock", vertex: "Vertex", foundry: "Foundry", anthropicAws: "AWS", anthropicGoogleCloud: "Google Cloud",
  mantle: "Mantle", gateway: "Gateway",
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What the top bar chip says. Only the email's local part, so a screenshot doesn't show the whole address. */
export function chipLabel(s: AuthStatus | null): string {
  if (!s) return "Account…";
  if (s.state === "unknown") return "Account ?";
  if (s.state === "signedOut") return "Not signed in";
  if (s.provider && s.provider !== "firstParty") return PROVIDERS[s.provider] ?? s.provider;
  if (s.method !== "claude.ai") return "API key";
  const who = s.email?.split("@")[0] ?? "Claude";
  return s.plan ? `${who} · ${capitalise(s.plan)}` : who;
}

/** The chip's tooltip: the full details, and the login expiry once it's close. */
export function chipTitle(s: AuthStatus | null, now: number): string {
  if (!s) return "Checking the Claude sign-in…";
  if (s.state === "signedOut") return "Not signed in to Claude: squadmates can't start. Click to sign in.";
  if (s.state === "unknown") return "Couldn't read the Claude sign-in. Click for help.";
  const parts = [s.email, s.organization, s.method].filter((p): p is string => Boolean(p));
  if (s.expiresAt !== undefined && s.expiresAt - now < EXPIRY_WARN_DAYS * DAY_MS) {
    const days = Math.floor((s.expiresAt - now) / DAY_MS);
    parts.push(days <= 0 ? "login expires today" : `login expires in ${days} day${days === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

export function chipTone(s: AuthStatus | null): "ok" | "bad" | "muted" {
  return s?.state === "signedIn" ? "ok" : s?.state === "signedOut" ? "bad" : "muted";
}
