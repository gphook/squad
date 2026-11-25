# Installing Squad

Run it with `npx @gphook/squad` once Node and Claude Code are set up (sections 1–3). Section 4 covers running it,
section 5 running from source.

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

The SDK uses the same sign-in as the `claude` CLI. You can also sign in later from inside Squad with an Anthropic
Console account (API billing): click the account chip in the top bar. Squad doesn't offer claude.ai (subscription)
sign-in itself, because Anthropic's terms don't allow apps built on the Agent SDK to; sign in to Claude Code in a
terminal instead (`claude auth login`).

## 3. git

Needed to create new agent repos.

```bash
git --version
```

## 4. Running Squad

```bash
npx @gphook/squad@latest          # run the newest version (plain npx @gphook/squad may reuse a cached one)
npm i -g @gphook/squad && squad   # or install it, then run `squad`
```

Options (the same with `npx @gphook/squad`, `squad` or, from source, `npm start --`):

| Option | Does |
|---|---|
| `--port <n>` | Port to listen on. Precedence: `--port`, then `SQUAD_PORT`, then `~/.squad/config.json`, then 7340. |
| `--no-open` | Don't open the browser; print the link instead (also `SQUAD_NO_OPEN=1`). |
| `--reset-sign-in` | A new setup link to add a passkey (see Signing in below). |
| `--version`, `--help` | Print the version or the help. |

If the port is already in use (usually Squad is already running), Squad says so and exits: open the URL it prints, or
pick another port.

**Install Squad as an app:** in Chrome or Edge, open Squad and choose **Install Squad** from the address bar or the
browser menu. It then opens in its own window with the Squad icon. The installed app belongs to the address it was
installed from, so if you change the port you install it again for the new one.

**Updates:** when it starts, Squad asks npm whether a newer version exists. The request is anonymous, sends nothing
about you or your projects, and gives up after 3 seconds. If there is one, Squad says so in the terminal and the top
bar: run `npx @gphook/squad@latest` (or `npm i -g @gphook/squad@latest`). Turn the check off with
`SQUAD_NO_UPDATE_CHECK=1`. Running from source never checks.

## 5. From source

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
npm run dev -w @squad/web               # Vite on http://localhost:5173; open the printed setup link the first time
```

Squad stores its data in `~/.squad/`.

### Signing in

Squad uses passkeys. On first run it opens your browser at a single-use setup link (valid 10 minutes) where you click
**Create passkey**. If the browser can't be opened, or with `npm start -- --no-open` (or `SQUAD_NO_OPEN=1`), Squad prints the
link instead. In dev (`SQUAD_DEV=1`) it prints the link rather than opening a browser, and the link is on
Vite's `http://localhost:5173`.

If you lose every passkey, run `npm start -- --reset-sign-in`: it opens a new setup link in your browser (or prints
it, as above) so you can add a passkey.
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
- Environment: `SQUAD_HOME` (data folder, default `~/.squad`), `SQUAD_PORT`, `SQUAD_NO_OPEN=1` (don't open a browser), `SQUAD_NO_UPDATE_CHECK=1` (don't check npm for updates), `SQUAD_DEV=1` (dev mode; set by the server `dev` script).
