# Squad features

## v1

### Projects
- Create, edit, delete and switch between any number of projects.
- Project-wide rules (markdown) given to every agent in the project.
- One permission mode per project, shared by all its agents.
- Layout (mode, open tiles, slots) saved per project.

### Agents
- Any number of agents per project, each with a name, role, repo folder and optional model.
- Point an agent at an existing repo, or create a new folder with `git init`.
- Each agent's launch prompt includes its role, the team roster, the project rules and the
  squad-radio skill. Nothing is written into the repos.

### Running agents
- Launch on demand by the user, or by another agent via `squad_summon`, if not already running.
- Resume the previous conversation by default.
- User actions per agent: launch, stop, interrupt, compact, clear (start fresh).
- No automatic restarts.
- Live status: stopped, starting, working, idle, awaiting approval, error, plus context usage %.

### Chat
- Prompt box and streamed replies per agent, like Claude Desktop.
- Tool calls shown collapsed, expandable.
- Tool approvals inline: Allow, Deny, Allow always for this session.
- Peer messages marked in the chat (⇠ from / ⇢ to).
- History restored after browser reload.
- Images and links: local images from the agent's repo or share folder render inline
  (click to enlarge); `squad_show` tool lets an agent put an image or file in front of you;
  paste or drop images into the prompt; external links open in a new tab, external images
  load only on click.

### Layout
- Default: sidebar of all agents + one chat.
- Focussed mode: main pane + side stack of open tiles; `Alt+N` swaps tile N into main.
- Tiled mode: grid of open tiles; `Alt+N` moves input focus.
- Up to 10 tiles (slots 1–9, 0), stable numbering, opened via drag from the sidebar or menu.

### Messages
- Log of agent-to-agent messages across the project, filterable by agent.

### Shared files
- `squad_share` tool: agents put large messages and files in the project's share folder and
  send the path; recipients read it only if needed.
- Shared files panel: list, open, download, delete, and drop in files for agents.
- Clearing an agent deletes the files it shared.

### squad-radio skill
- Generic handoff rules: What / Files / Done when / Review; message size discipline;
  work outside your area goes to its owner.

### Local security
- Binds to localhost; random session key in the URL; WebSocket origin check.

## Later
- Several agents in one repo (git worktrees), only if needed.
- Publish the `squad-kit` plugin (squad-radio and later skills) for use outside Squad.
- Optional Rust rewrite of the server against the same WebSocket protocol.
