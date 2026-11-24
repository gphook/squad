# Installing Squad's dependencies

Squad runs locally on Linux or macOS.

## 1. Node.js 24 or later

Squad uses Node's built-in `node:sqlite`, so no native database driver is needed.

```bash
node --version          # need v24.x or later
```

If it's missing or older, install with nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
exec $SHELL
nvm install 24
nvm alias default 24
```

npm comes with Node.

## 2. Claude Code, signed in

Squad's agents are Claude Code sessions, run through the Claude Agent SDK.

```bash
claude --version        # Claude Code 2.1.330 or later
```

If it's missing:

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude                  # run once interactively and sign in
```

The SDK uses the same sign-in as the `claude` CLI.

## 3. git

Needed to create new agent repos.

```bash
git --version
```

## 4. Squad itself

From the repo root:

```bash
npm install             # installs all workspaces (server, web, shared)
npm run build           # builds the web UI into packages/web/dist
npm start               # Squad on 127.0.0.1:7340; first run opens your browser to create a passkey
npm test                # all tests
```

For UI development, run the server and Vite side by side:

```bash
npm run dev -w @squad/server            # server, restarts on change (sets SQUAD_DEV=1)
npm run dev -w @squad/web               # Vite on http://localhost:5173, works directly with no key step
```

Squad stores its data in `~/.squad/`.

### Signing in

Squad uses passkeys. On first run it opens your browser at a single-use setup link (valid 10 minutes) where you click
**Create passkey**. If the browser can't be opened, or with `npm start -- --no-open` (or `SQUAD_NO_OPEN=1`), Squad prints the
link instead. In dev (`SQUAD_DEV=1`) it prints the link rather than opening a browser.

If you lose every passkey, run `npm start -- --reset-sign-in`: it prints a new setup link so you can add a passkey.
Manage passkeys and sessions from the lock icon in the top bar.

## Package dependencies (installed by `npm install`)

| Package | Used by | Purpose |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` 0.3.330 (pinned) | server | runs each agent's Claude Code session |
| `zod` 4 | server, shared | message validation and Squad tool schemas |
| `fastify`, `@fastify/websocket`, `@fastify/static`, `@fastify/multipart` | server | HTTP, WebSocket, serving the built UI, file uploads |
| `svelte`, `vite`, `@sveltejs/vite-plugin-svelte` | web | UI |
| `marked`, `dompurify` | web | rendering agent markdown safely |
| `tsx` | server | runs the TypeScript server directly |
| `typescript`, `vitest`, `jsdom` | dev | types and tests |

## Configuration

- `~/.squad/config.json`: `{ "port": 7340 }` to change the port.
- Environment: `SQUAD_HOME` (data folder, default `~/.squad`), `SQUAD_PORT`, `SQUAD_NO_OPEN=1` (don't open a browser), `SQUAD_DEV=1` (dev mode; set by the server `dev` script).
