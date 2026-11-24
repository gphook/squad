# Project Summary

This project provides a tool for creating and monitoring a team of agents for a Project.
The user can create as many projects as they wish and switch between them. The number, role and nature of all agents in
a team is also determined by the user.

# Stack

TypeScript throughout: a Node 24 server (Fastify, Claude Agent SDK, `node:sqlite`) and a Svelte 5 + Vite web UI,
in npm workspaces. See `docs/INSTALL.md`.

# Agents

Each agent runs in its own separate session, and communicates using the gphook/squad-radio skill.

## Terminology

An agent's fellow agents in the same project are its **squadmates**. Use "squadmate(s)", never "teammate(s)" or
"team members", in UI copy, docs, skills, tool descriptions and launch prompts. The web UI calls every agent a
squadmate ("Squadmates", "+ Add squadmate"). Code identifiers and tool names (`Agent`, `agentId`, `squad_team`) stay
as they are.

## Agent skills

Squad's agent skills live in `kit/`, the `squad-kit` Claude Code plugin loaded into every agent at launch (`squad-radio`
is the first skill). Whenever a feature, a recurring agent behaviour, or a gap seen in agent transcripts would be better handled by
guidance agents load on demand, design and add a new skill there (`kit/skills/<name>/SKILL.md`) rather than growing
the launch prompt. Keep skills generic: project-specific roles and rules belong in the project's agents and rules, not
in a skill.

Name skills after the military squad equivalent of what they do, as `squad-<name>`. `squad-radio` is how agents
communicate, because a radio is how a squad communicates. Follow that pattern, e.g. `squad-orders` for taking on and
reporting work, `squad-sitrep` for status reports, `squad-debrief` for end-of-session notes.

# Application Features

See FEATURES.md
