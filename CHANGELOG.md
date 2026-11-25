# Changelog

## 0.5.0 — 2026-11-25

### Changed
- **Squadmates don't run on a claude.ai subscription.** Anthropic's terms don't allow apps built on the Agent SDK to
  run on claude.ai login or subscription limits, wherever the sign-in happens. When Claude Code is signed in with a
  subscription, launches are refused and the account chip says so. Sign in with the Anthropic Console from the chip,
  or start Squad with `ANTHROPIC_API_KEY` or a cloud provider (Bedrock, Claude Platform on AWS, Vertex, Foundry) set;
  see the install guide. This replaces 0.4.0's advice to sign in with a subscription in a terminal.
- **Usage has its own top-bar button.** The Usage view still shows Squad's own tokens and API-equivalent cost by
  squadmate, day, model and costliest turn.

### Removed
- **Plan limits.** The 5h and 7d rings, the Usage view's plan section and its "Max % of" columns were claude.ai
  subscription limits, so they're gone.

## 0.4.0 — 2026-11-25

### Changed
- **Sign-in from Squad uses the Anthropic Console.** The account chip now signs in with the Anthropic Console (API
  billing) only. Anthropic's terms don't allow apps built on the Agent SDK to offer claude.ai (subscription) sign-in,
  so the Sign in to Claude and SSO options are gone. A subscription still works: sign in to Claude Code in a terminal
  (`claude auth login`) and Squad picks it up.

## 0.3.0 — 2026-11-25

### Added
- **Answer MCP servers' requests for input.** When an MCP server or connector asks the user for something, the tile
  shows its message with a form to fill in or a link to open (e.g. to sign in), instead of the request going unanswered.
- **Plan approval card.** A squadmate's plan (`ExitPlanMode`) shows as markdown with Approve and Keep planning,
  instead of a generic Allow/Deny. Keep planning takes optional feedback that's sent back so the squadmate revises.

### Fixed
- **Squadmates' questions can be answered.** `AskUserQuestion` used to show as a plain Allow/Deny approval and
  reached the squadmate unanswered. The tile now shows the questions with their options and an Other box; Submit
  sends your answers, Skip tells the squadmate to ask in chat instead.
  Questions whose options carry previews show them beside the options, with an optional notes box sent back with
  the answer.

## 0.2.0 — 2026-11-24

### Added
- **Sign in to Claude from inside Squad.** Click the account chip to sign in with a subscription, Console or SSO.
  Squad runs `claude auth login`, shows the claude.ai link and takes the code claude.ai gives you. When signed in, the
  chip offers Switch account and Sign out. The terminal command still works as a fallback.
- **Connectors** (top of the Marketplaces tab): sign git in to GitHub or GitLab, hosted or self-hosted, so you can add
  private marketplaces and keep them up to date. Add one connector per host from the GitHub and GitLab templates.
  Sign-in drives the host's own CLI (`gh` or `glab`). Self-managed GitLab takes an access token, which is passed
  straight to `glab` and never stored by Squad. Hosts `gh`/`glab` were already signed in to appear on first run, and a
  marketplace that fails to authenticate points at the connector it needs.
- **Resize the maximised tile:** drag the bar between it and the column of other tiles, or focus the bar and use the
  arrow keys. Double-click it to reset. The width is remembered per browser.

### Changed
- Launch and Clear in each tile's header are now icon buttons.

## 0.1.1 — 2026-11-24

- A second Squad on the same machine can no longer sign out the first.
- An invalid `SQUAD_PORT` is rejected at startup.
- `@fastify/static` 10, which drops the deprecated `glob@11` dependency.
- First release published by the Release workflow, with provenance.

## 0.1.0 — 2026-11-24

- First release on npm: `npx @gphook/squad`.
