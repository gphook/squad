# Security

Squad runs Claude Code agents that can read and change files and run commands on your machine, and its web UI can approve those actions. Please treat security issues seriously.

## Reporting a vulnerability

Don't open a public issue. Use GitHub's private vulnerability reporting on this repository (**Security → Report a vulnerability**). Include what an attacker needs, what they can do, and steps to reproduce. You should hear back within a week.

## Security model

Squad is a single-user, local tool. What it relies on:

- The server listens on `127.0.0.1` only.
- Every HTTP and WebSocket request needs the random session key printed at startup (a `?key=` URL once, then an `HttpOnly`, `SameSite=Strict` cookie). The WebSocket also rejects other origins.
- `/files` serves only files whose real path (after following symlinks) is inside the project's agent folders or its share folder. Every response carries a sandboxing `Content-Security-Policy`, so a file an agent shares can't run script on the Squad origin.
- Agent output is rendered as sanitised markdown (DOMPurify). External images load only when clicked.
- Tool approvals are answered only by the user, from the UI. Squad's own tools (`squad_*`) are the only tools allowed without asking.
- `$ cmd` in a prompt box runs a shell command as your user without any approval step, by design (like the Claude CLI's `!`). The session key is what guards it.

Out of scope: anyone who can already run code as your user, or read the terminal where Squad printed its key.
