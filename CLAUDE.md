# Project Summary

This project provides a tool for creating and monitoring a team of agents for a Project.
The user can create as many projects as they wish and switch between them. The number, role and nature of all agents in
a team is also determined by the user.

# Stack

TypeScript throughout: a Node 24 server (Fastify, Claude Agent SDK, `node:sqlite`) and a Svelte 5 + Vite web UI,
in npm workspaces. See `docs/superpowers/specs/2026-11-22-squad-design.md` and `docs/INSTALL.md`.

# Agents

Each agent runs in its own separate session, and communicates using the gphook/squad-radio skill.

## Agent skills

Squad's agent skills live in `radio/` (a Claude Code plugin loaded into every agent at launch; `squad-radio` is the
first). Whenever a feature, a recurring agent behaviour, or a gap seen in agent transcripts would be better handled by
guidance agents load on demand, design and add a new skill there (`radio/skills/<name>/SKILL.md`) rather than growing
the launch prompt. Keep skills generic: project-specific roles and rules belong in the project's agents and rules, not
in a skill.

Name skills after the military squad equivalent of what they do, as `squad-<name>`. `squad-radio` is how agents
communicate, because a radio is how a squad communicates. Follow that pattern, e.g. `squad-orders` for taking on and
reporting work, `squad-sitrep` for status reports, `squad-debrief` for end-of-session notes.

# Application Features

See FEATURES.md
