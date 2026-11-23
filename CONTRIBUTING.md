# Contributing to Squad

Thanks for helping. Squad is a local web app that runs a team of Claude Code agents, one repo each. Read the [README](README.md) first.

## Getting set up

You need Node 24+, git, and Claude Code signed in. Full steps are in [docs/INSTALL.md](docs/INSTALL.md).

```bash
npm install
npm test                                  # all workspaces
npm run check                             # TypeScript + Svelte type checks
npm run dev -w @squad/server              # server on 127.0.0.1:7340, restarts on change
npm run dev -w @squad/web                 # UI on http://localhost:5173 (open the server's ?key= URL once first)
```

Use a scratch data folder while developing so you don't touch your real projects:

```bash
SQUAD_HOME=/tmp/squad-dev SQUAD_KEY=dev npm run dev -w @squad/server
```

## How the code is organised

| Path | Owns |
|---|---|
| `packages/shared` | Types and the browser↔server message format (`protocol.ts`, validated with zod). Change this first when adding a message. |
| `packages/server` | `runner.ts` (one agent's Claude Agent SDK session), `supervisor.ts` (all agents, Squad tools, message log, shares), `app.ts` (HTTP + WebSocket), `store.ts` (SQLite). |
| `packages/web` | Svelte 5 UI. `lib/reducer.ts` is the pure state reducer; `lib/layout.ts` is the pure tile logic. |
| `radio/` | Claude Code plugin with the skills loaded into every agent. |

## Ground rules

These are deliberate design choices. Changes that break them need a design discussion first:

- **Each agent is its own Claude Code session.** Never run team members as SDK subagents. Separate repos exist to keep agents' context apart.
- **Squad doesn't carry messages between agents.** They use Claude Code's `SendMessage`; Squad only observes.
- **Nothing is written into agents' repos** (except `git init` when the user asks for a new folder).
- **Squad never restarts an agent by itself.**
- **Local only.** Keep the security model in [SECURITY.md](SECURITY.md) intact.

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

Skills that every agent loads live in `radio/skills/<name>/SKILL.md`. Name them `squad-<name>` after the military squad equivalent of what they do: `squad-radio` covers how agents communicate. Keep skills generic. Roles and rules for a particular project belong in that project's settings in Squad.

## Licence

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
