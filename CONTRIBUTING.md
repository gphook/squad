# Contributing to Squad

Thanks for helping. Squad is a local web app that runs a team of Claude Code agents, one repo each. Read the [README](README.md) first.

## Getting set up

You need Node 24+, git, and Claude Code signed in. Full steps are in [docs/INSTALL.md](docs/INSTALL.md).

```bash
npm install
npm test                                  # all workspaces
npm run check                             # TypeScript + Svelte type checks
npm run dev -w @squad/server              # server on 127.0.0.1:7340, restarts on change
npm run dev -w @squad/web                 # UI on http://localhost:5173 (proxies to the server)
```

Use a scratch data folder while developing so you don't touch your real projects:

```bash
SQUAD_HOME=/tmp/squad-dev npm run dev -w @squad/server
```

The `dev` script sets `SQUAD_DEV=1`: Squad doesn't open a browser, prints the setup link when a passkey is needed, and
"until restart" sessions survive restarts. The printed link is on Vite's `http://localhost:5173`, so start Vite before
opening it. Vite must be on 5173 (the only extra Host Squad allows in dev); if you run the server on another port, give
Vite the same `SQUAD_PORT` so its proxy targets it.

### Browser checks

To check the UI in a real browser (for example with the Playwright MCP), start a test Squad on its own port and data folder:

```bash
SQUAD_HOME=$(mktemp -d) SQUAD_PORT=7341 npm start -- --no-open
```

Read the setup link from its output, run `scripts/virtual-passkey.js` (it adds a virtual authenticator; use it as the body of
Playwright MCP's `browser_run_code_unsafe`), open the link, then click **Create passkey**. Never point checks at your real
Squad or `~/.squad`.

To register a second passkey (for example after `--reset-sign-in`), add a second authenticator first: a copy of
`scripts/virtual-passkey.js` with `transport: "usb"`. One authenticator can hold only one Squad passkey, because Squad
excludes the passkeys it already knows when registering.
In dev, Vite must get port 5173 (it stops rather than move to another port), since that is the only dev origin Squad accepts.

## How the code is organised

| Path | Owns |
|---|---|
| `packages/shared` | Types and the browser↔server message format (`protocol.ts`, validated with zod). Change this first when adding a message. |
| `packages/server` | `runner.ts` (one agent's Claude Agent SDK session), `supervisor.ts` (all agents, Squad tools, message log, shares), `app.ts` (HTTP + WebSocket), `store.ts` (SQLite). |
| `packages/web` | Svelte 5 UI. `lib/reducer.ts` is the pure state reducer; `lib/layout.ts` is the pure tile logic. |
| `kit/` | The `squad-kit` Claude Code plugin: the skills loaded into every agent. |

## Ground rules

These are deliberate design choices. Changes that break them need a design discussion first:

- **Each agent is its own Claude Code session.** Never run squadmates as SDK subagents. Separate repos exist to keep agents' context apart.
- **Squad doesn't carry messages between agents.** They use Claude Code's `SendMessage`; Squad only observes.
- **Nothing is written into agents' repos** (except `git init` when the user asks for a new folder).
- **Squad never restarts an agent by itself.**
- **Local only.** Keep the security model in [SECURITY.md](SECURITY.md) intact.

## Packaging and releases

`npm run package` builds the publishable `@gphook/squad` into `release/`: the server bundled by esbuild into
`dist/server.js`, the built UI in `web/`, `kit/`, and a `package.json` generated from the server's. `npm run smoke`
installs that tarball into a temp folder and checks it starts, serves the UI, guards the API and finds the Claude
Code binary. CI runs both on every PR.

To cut a release, bump `version` in the root `package.json`, add the release's notes to
[CHANGELOG.md](CHANGELOG.md), commit, then tag and push:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

The Release workflow checks, tests, packages, smoke-tests and publishes with npm trusted publishing (no token).

**One-time setup (owner):** trusted publishing can only be linked to a package that exists, so publish the first
version by hand while signed in to npm as `gphook` with 2FA:

```bash
npm run package
cd release && npm publish --access public
```

Then on npmjs.com open the package's **Settings → Trusted publishing**, choose GitHub Actions, and enter repository
`gphook/squad` and workflow `release.yml`. From then on, pushing a `v*` tag publishes.

App icons: edit `packages/web/public/icon.svg` (and `icon-maskable.svg`), then run `npx tsx scripts/icons.ts` (needs
`rsvg-convert`) and commit the PNGs.

## Making a change

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Branch from `main`.
3. **Write the test first.** Every behaviour change comes with a test that failed before the change. Server code that talks to the SDK is tested with the fake query in `packages/server/test/fakeQuery.ts`. Web logic lives in pure modules (`reducer.ts`, `layout.ts`, `markdown.ts`) so it can be tested without a browser.
4. Run `npm test` and `npm run check`. CI runs both, plus the build.
5. For UI changes, run the app and check it in a browser, in both light and dark mode. Include a screenshot in the PR.
6. Keep commits focused, with messages like `feat(server): …`, `fix(web): …` or `docs: …`.
7. Open a pull request using the template.

## Style

- TypeScript, strict mode, ES modules, imports with `.ts` extensions.
- 2-space indent, double quotes, semicolons. `.editorconfig` covers the basics.
- Small files with one job each. Prefer pure functions for logic, so it can be tested.
- Comments say *why*, not what.
- Read SDK messages structurally (see `normalise.ts`) rather than depending on the SDK's large message unions.
- Value lists (actions, modes, slots, tool names) are defined once in `packages/shared/src/model.ts`. Types and zod schemas derive from them, so add new values there.

## Agent skills

Skills that every agent loads live in the `squad-kit` plugin, at `kit/skills/<name>/SKILL.md`. Name them `squad-<name>` after the military squad equivalent of what they do: `squad-radio` covers how agents communicate. Keep skills generic. Roles and rules for a particular project belong in that project's settings in Squad.

## Licence

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
