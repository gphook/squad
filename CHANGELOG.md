# Changelog

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
