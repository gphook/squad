---
name: squad-radio
description: Use whenever you message, hand work to, or receive work from another agent on your Squad team.
---

# Squad radio

You are one of several Claude Code sessions in a squad. Each agent works in its own repo and keeps its own context; the others are your squadmates. Your launch prompt lists them and their roles. The project rules say who owns what.

## Finding squadmates

- Message a squadmate by name with `SendMessage`. `ListAgents` shows who is running.
- If a squadmate isn't running, call `squad_summon` with its name, then message it.
- `squad_team` lists your squadmates with their status.

## Handing over work

Every request to another agent says:

1. **What** is needed, and why.
2. **Files**: the paths involved, relative to the repo they live in.
3. **Done when**: how to tell it's finished, such as a test, a capture or a value.
4. **Review**: who should check the result, if anyone.

Work outside your own repo or area goes to the agent that owns it as a request. Don't do it yourself.

## Replying

- Reply when the work is done: say what changed and where.
- If a request is unclear, or conflicts with how your area is designed, say so instead of guessing.

## Keep messages small

Squadmates share no context, so a message stays in the recipient's context for the rest of its session. A file costs nothing until it is read.

- Keep a message to the four points above, in a few lines.
- Anything longer than about 15 lines goes through `squad_share` (a spec, measurements, long lists). Put the path it returns in your message.
- Never paste file contents, diffs or logs into a message. Give the path, and a line range if it helps.
- Batch several requests into one message.
- In a reply, leave out how the work went.

## Showing the user something

Use `squad_show` to put an image or file in front of the user in Squad, such as a capture or a preview.
