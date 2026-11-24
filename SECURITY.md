# Security

Squad runs Claude Code agents that can read and change files and run commands on your machine, and its web UI can approve those actions. Please treat security issues seriously.

## Reporting a vulnerability

Don't open a public issue. Use GitHub's private vulnerability reporting on this repository (**Security → Report a vulnerability**). Include what an attacker needs, what they can do, and steps to reproduce. You should hear back within a week.

## Security model

Squad is a single-user, local tool. What it relies on:

- The server listens on `127.0.0.1` only.
- Every request must carry an allowed `Host` (`localhost:<port>` or `127.0.0.1:<port>`) and, where sent, an allowed `Origin`. This blocks DNS rebinding and cross-site requests.
- Sign-in uses passkeys (WebAuthn, relying party `localhost`, user verification required). Unauthenticated `/api`, `/files` and `/ws` requests get 401. Only a hash of each session id is stored.
- A session is either **remember** (30 days since last use, survives restarts) or **restart** (ended whenever the server starts). The session cookie is `squad_session_<port>`, `HttpOnly`, `SameSite=Strict`. Deleting a passkey ends every session it created, and the Sign-in view can revoke any session.
- The first passkey is created through a single-use setup link (valid 10 minutes, held in memory) that Squad opens in your browser, or prints when it can't. It is the only secret that ever appears in a URL or the terminal. `--reset-sign-in` makes a new one, opened or printed the same way.
- Cookies are not scoped by port, so another server on `localhost` that you visit in the same browser could receive the Squad cookie. This is accepted.
- `/files` serves only files whose real path (after following symlinks) is inside the project's agent folders or its share folder. Every response carries a sandboxing `Content-Security-Policy`, so a file an agent shares can't run script on the Squad origin.
- Agent output is rendered as sanitised markdown (DOMPurify). External images load only when clicked.
- Tool approvals are answered only by the user, from the UI. Squad's own tools (`squad_*`) are the only tools allowed without asking.
- `$ cmd` in a prompt box runs a shell command as your user without any approval step, by design (like the Claude CLI's `!`). Sign-in is what guards it.
- The only request Squad makes on its own is the update check of the published package: one anonymous GET to `registry.npmjs.org/@gphook/squad/latest` at startup (generic `User-Agent: squad`, no cookies, 3 s timeout). `SQUAD_NO_UPDATE_CHECK=1` turns it off; running from source never checks.
- The installable app's service worker caches nothing: every request goes to the server, so a sign-out or a new version takes effect at once.
- Releases are published from GitHub Actions with npm trusted publishing and provenance, so each version on npm links to the commit and workflow that built it.

Out of scope: anyone who can already run code as your user, or read `~/.squad` (the database holds only passkey public keys and session hashes, but anyone with that access can already act as you).
