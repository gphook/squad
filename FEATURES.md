# Squad features

## v1

### Projects
- Create, edit, delete and switch between any number of projects.
- Project-wide rules (markdown) given to every agent in the project.
- The Claude account squadmates run on, in the top bar (from `claude auth status`). When nobody is signed in,
  launches are refused with a clear message and the account chip shows how to sign in.
- Per squadmate, a model picked from your account's models (fetched from the SDK) and an effort level (Low to
  Max, as the model allows), applied at launch.
- Activities: a project's areas of work, each with an owner, optional reviewers and a description. Squad
  writes them into every squadmate's launch prompt as ownership and review rules, and `squad_team` shows them.
  Assign them in the project dialog, or tick them when adding a squadmate; unowned ones are flagged.
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
- User actions per agent: launch, stop, interrupt, compact, clear (start fresh). Clear all (sidebar) clears every
  squadmate in the project and empties its message log.
- No automatic restarts.
- Live status: stopped, starting, working, idle, awaiting approval, error, plus a context window ring for each running squadmate in the sidebar and its pane header.

### Chat
- Prompt box and streamed replies per agent, like Claude Desktop.
- Tool calls shown collapsed, expandable.
- Tool approvals inline: Allow, Deny, Allow always for this session.
- Peer messages marked in the chat (⇠ from / ⇢ to).
- Shell commands: `!cmd` asks the squadmate to run it with its Bash tool; `$ cmd` has Squad run it in your `$SHELL`
  (POSIX shells such as sh/bash/zsh/dash/ksh, fish, nushell or PowerShell; anything else falls back to `/bin/sh`) in the squadmate's folder, streamed live with a Kill button, and passed to the squadmate with your next message (or when
  it is summoned). Clear drops output it hasn't seen yet.
- Slash commands: type `/` for a picker of the squadmate's commands (skills, plugins and built-ins); Tab completes,
  Enter runs a command typed in full. Command output (`/context`, `/usage`, …) shows in the pane and after a reload.
  `/clear` and `/exit` do what Clear and Stop do. Commands that need a terminal screen (`/config`, `/model`, and for
  now `/plugin`, `/resume`, `/skills`) say so instead.
- History restored after browser reload.
- Images and links: local images from the agent's repo or share folder render inline
  (click to enlarge); `squad_show` tool lets an agent put an image or file in front of you;
  paste or drop images into the prompt; external links open in a new tab, external images
  load only on click.

### Layout
- Sidebar of all squadmates, beside the workspace of open tiles.
- Open tiles sit in a grid, each a full chat with its own message box. Clicking a squadmate in the sidebar opens
  its tile and puts the cursor in it.
- Maximise a tile (double-click its header, or its maximise button) to give it most of the screen, with the other
  tiles in a column on the right. `Alt+N` swaps tile N into the maximised spot; with nothing maximised it moves the
  cursor to tile N.
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
