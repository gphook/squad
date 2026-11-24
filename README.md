# Squad

[![CI](https://github.com/gphook/squad/actions/workflows/ci.yml/badge.svg)](https://github.com/gphook/squad/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Run a team of Claude Code agents from one local web page.

Each agent works in its own repo, in its own Claude Code session, with its own context. Squad launches agents when you or a squadmate need them. You can talk to each one, watch them all side by side, approve their tool calls, and see every message they send each other.

## What it does

- **Projects and teams.** Create any number of projects. Each has as many agents as you like, each with a name, a role and a repo, plus rules shared by the whole team. List the project's activities and who owns and reviews each, and Squad tells every squadmate who owns what.
- **Agents on demand.** Launch an agent yourself, or let a squadmate start it with `squad_summon`. By default it resumes its previous conversation. Squad never restarts agents on its own.
- **One place to watch them all.** A chat for each agent with streamed replies, tool calls, inline Allow/Deny approvals and live status. Tiles sit in a grid; maximise one to give it most of the screen, and use `Alt+1`…`Alt+0` to move between up to 10 tiles.
- **Team messaging.** Agents talk with Claude Code's own `SendMessage`. Squad logs every message in a Messages view.
- **Shared files.** Agents hand over large specs and files with `squad_share` instead of pasting them into messages. You can drop files in too.
- **Shell commands.** In a squadmate's prompt box, `!cmd` asks the squadmate to run it with its Bash tool. `$ cmd` runs it straight away in the squadmate's folder, streams the output into the pane, and passes it to the squadmate with your next message, like the Claude CLI's `!`.
- **Images and links.** Captures from an agent's repo display inline. Images from the web load only when you click.
- **The `squad-radio` skill.** Loaded into every agent, it sets out how to hand work over: what is needed, which files, when it counts as done, and who reviews it.

See [FEATURES.md](FEATURES.md) for the full list.

## Quick start

You need Node 24+, git, and [Claude Code](https://claude.com/claude-code) installed and signed in. Details are in [docs/INSTALL.md](docs/INSTALL.md).

```bash
npx @gphook/squad
```

Squad opens your browser to set up sign-in with a passkey (if it can't, it prints a single-use setup link). Create a project, add an agent for each repo, and send the first message.

**Use it like an app:** in Chrome or Edge, choose **Install Squad** (the install icon in the address bar, or the browser menu). Squad then opens in its own window with its own icon in your dock or taskbar.

Prefer a fixed command? `npm i -g @gphook/squad`, then run `squad`. Squad tells you when a newer version is out.

**From source** (to contribute):

```bash
git clone https://github.com/gphook/squad.git
cd squad
npm install && npm run build && npm start
```

> Agents run Claude Code with your permissions and on your Claude account. Each agent's tool use is billed like any other Claude Code session.

## How it fits together

```
browser (Svelte) ──WebSocket──► Squad server (Node, Fastify)
                                 ├─ one Claude Agent SDK session per running agent
                                 ├─ Squad tools: squad_team, squad_summon, squad_share, squad_show
                                 └─ SQLite in ~/.squad (projects, agents, message log, shares)
                                        │
                     Claude Code sessions ◄─ SendMessage ─► each other
```

| Path | What |
|---|---|
| `packages/shared` | Types and the browser↔server message format |
| `packages/server` | Agent sessions, Squad tools, store, HTTP and WebSocket |
| `packages/web` | The Svelte UI |
| `kit/` | The `squad-kit` plugin: skills loaded into every agent |
| `docs/` | Install guide |
| `scripts/` | Packaging (`npm run package`), the install smoke test, icon rendering |

## Keys

| Key | Does |
|---|---|
| `Alt+1` … `Alt+9`, `Alt+0` | With a tile maximised: swap that tile into its place. Otherwise: move typing focus to it. |
| `Enter` / `Shift+Enter` | Send / new line |
| Paste or drop an image | Attach it to your message |

## Security

Squadmates use your Claude Code sign-in (the account shows in the top bar). Squad is a single-user tool that listens only on `127.0.0.1`, behind passkey sign-in. Anyone signed in can run shell commands as you with `$ cmd`, so protect your passkeys. See [SECURITY.md](SECURITY.md) for the model, and to report a vulnerability privately.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

```bash
npm test        # all tests
npm run check   # TypeScript and Svelte type checks
```

## License

[MIT](LICENSE)
