# Squad

[![CI](https://github.com/gphook/squad/actions/workflows/ci.yml/badge.svg)](https://github.com/gphook/squad/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Run a team of Claude Code agents from one local web page.

Each agent works in its own repo, in its own Claude Code session, with its own context. Squad launches agents when you or a squadmate need them. You can talk to each one, watch them all side by side, approve their tool calls, and see every message they send each other.

## What it does

- **Projects and teams.** Create any number of projects. Each has as many agents as you like, each with a name, a role and a repo, plus rules shared by the whole team.
- **Agents on demand.** Launch an agent yourself, or let a squadmate start it with `squad_summon`. By default it resumes its previous conversation. Squad never restarts agents on its own.
- **One place to watch them all.** A chat for each agent with streamed replies, tool calls, inline Allow/Deny approvals and live status. Use focussed or tiled layouts, with `Alt+1`…`Alt+0` to switch between up to 10 tiles.
- **Team messaging.** Agents talk with Claude Code's own `SendMessage`. Squad logs every message in a Messages view.
- **Shared files.** Agents hand over large specs and files with `squad_share` instead of pasting them into messages. You can drop files in too.
- **Images and links.** Captures from an agent's repo display inline. Images from the web load only when you click.
- **The `squad-radio` skill.** Loaded into every agent, it sets out how to hand work over: what is needed, which files, when it counts as done, and who reviews it.

See [FEATURES.md](FEATURES.md) for the full list.

## Quick start

You need Node 24+, git, and [Claude Code](https://claude.com/claude-code) installed and signed in. Details are in [docs/INSTALL.md](docs/INSTALL.md).

```bash
git clone https://github.com/gphook/squad.git
cd squad
npm install && npm run build && npm start
```

Open the `http://localhost:7340/?key=…` URL it prints. Create a project, add an agent for each repo, and send the first message.

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
| `radio/` | Skills loaded into every agent |
| `docs/` | Install guide |

## Keys

| Key | Does |
|---|---|
| `Alt+1` … `Alt+9`, `Alt+0` | Focussed mode: swap that tile into the main pane. Tiled mode: move typing focus to it. |
| `Enter` / `Shift+Enter` | Send / new line |
| Paste or drop an image | Attach it to your message |

## Security

Squad is a single-user tool that listens only on `127.0.0.1`, behind a random session key. See [SECURITY.md](SECURITY.md) for the model, and to report a vulnerability privately.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

```bash
npm test        # all tests
npm run check   # TypeScript and Svelte type checks
```

## License

[MIT](LICENSE)
