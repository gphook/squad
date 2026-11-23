import type { ShellChunk } from "./model.ts";

/**
 * Shell commands typed into a prompt box:
 * `!cmd` asks the squadmate to run it with its Bash tool; `$ cmd` has Squad run it in the squadmate's folder.
 */
export type ShellMode = "agent" | "run";

export function parseShellInput(text: string): { mode: ShellMode; command: string } | null {
  const t = text.trimStart();
  const run = /^\$\s+(\S[\s\S]*)$/.exec(t);
  if (run) return { mode: "run", command: run[1].trim() };
  if (t.startsWith("!") && t.slice(1).trim()) return { mode: "agent", command: t.slice(1).trim() };
  return null;
}

const AGENT_SHELL_INTRO = "Run this shell command with your Bash tool, exactly as written, and show me its output.";

export const agentShellPrompt = (command: string): string => `${AGENT_SHELL_INTRO}\n\n\`\`\`sh\n${command}\n\`\`\``;

/** The command inside a message written by agentShellPrompt, or null for any other text. */
export function parseAgentShellPrompt(text: string): string | null {
  const m = /^Run this shell command with your Bash tool, exactly as written, and show me its output\.\n\n```sh\n([\s\S]*)\n```$/.exec(text);
  return m ? m[1] : null;
}

/** How much of each output stream the squadmate is given, like the Bash tool's inline limit. */
export const SHELL_CONTEXT_CAP = 30_000;

/** The last `cap` characters of `s`, marked when anything was cut; `omitted` counts text already dropped before `s`. */
export function keepTail(s: string, cap: number, omitted = 0): string {
  const cut = Math.max(0, s.length - cap) + omitted;
  return cut ? `[… ${cut} earlier characters]\n${s.slice(-cap)}` : s;
}

/** Output kept per `$ cmd` block for display; older output is trimmed. */
export const SHELL_UI_CAP = 200_000;
const TRIMMED = "[… earlier output trimmed]\n";

/** Adds output to a block's chunks, merging with the last chunk of the same stream and keeping the newest `cap` characters. */
export function appendShellOutput(chunks: ShellChunk[], stream: ShellChunk["stream"], text: string, cap = SHELL_UI_CAP): ShellChunk[] {
  const last = chunks.at(-1);
  let next = last?.stream === stream ? [...chunks.slice(0, -1), { stream, text: last.text + text }] : [...chunks, { stream, text }];
  if (next[0]?.text === TRIMMED) next = next.slice(1);
  let total = next.reduce((n, c) => n + c.text.length, 0);
  if (total <= cap) return next;
  while (total > cap) {
    const over = total - cap;
    if (next[0].text.length <= over) {
      total -= next[0].text.length;
      next = next.slice(1);
    } else {
      next = [{ ...next[0], text: next[0].text.slice(over) }, ...next.slice(1)];
      total -= over;
    }
  }
  return [{ stream: "stdout", text: TRIMMED }, ...next];
}

export interface ShellResult {
  command: string;
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
  /** Characters already dropped from the front of each stream while it was buffered. */
  omitted?: { stdout: number; stderr: number };
}

// A closing tag inside the content would end the block early, so it is written escaped.
const escape = (s: string) => s.replaceAll("</bash-", "<\\/bash-");
const unescape = (s: string) => s.replaceAll("<\\/bash-", "</bash-");

/** A finished command as the Claude CLI records a `!` command, for the squadmate to read. */
export function bashContextBlock(r: ShellResult): string {
  let stderr = keepTail(r.stderr, SHELL_CONTEXT_CAP, r.omitted?.stderr);
  if (r.signal) stderr += `\nKilled by ${r.signal}`;
  else if (r.code !== null && r.code !== 0) stderr += `\nExit code ${r.code}`;
  return `<bash-input>${escape(r.command)}</bash-input>\n<bash-stdout>${escape(keepTail(r.stdout, SHELL_CONTEXT_CAP, r.omitted?.stdout))}</bash-stdout>\n<bash-stderr>${escape(stderr)}</bash-stderr>`;
}

const BLOCK_RE = /^<bash-input>([\s\S]*?)<\/bash-input>\n<bash-stdout>([\s\S]*?)<\/bash-stdout>\n<bash-stderr>([\s\S]*?)<\/bash-stderr>\n*/;

/** Blocks written by bashContextBlock at the start of a message, and the message after them. */
export function parseBashContext(text: string): { shells: { command: string; stdout: string; stderr: string }[]; rest: string } | null {
  const shells = [];
  let rest = text;
  for (let m = BLOCK_RE.exec(rest); m; m = BLOCK_RE.exec(rest)) {
    shells.push({ command: unescape(m[1]), stdout: unescape(m[2]), stderr: unescape(m[3]) });
    rest = rest.slice(m[0].length);
  }
  return shells.length ? { shells, rest: rest.trim() } : null;
}
