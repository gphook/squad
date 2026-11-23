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

/** The last `cap` characters of `s`, marked when anything was cut. */
export function keepTail(s: string, cap: number): string {
  return s.length > cap ? `[… ${s.length - cap} earlier characters]\n${s.slice(-cap)}` : s;
}

export interface ShellResult {
  command: string;
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
}

// A closing tag inside the content would end the block early, so it is written escaped.
const escape = (s: string) => s.replaceAll("</bash-", "<\\/bash-");
const unescape = (s: string) => s.replaceAll("<\\/bash-", "</bash-");

/** A finished command as the Claude CLI records a `!` command, for the squadmate to read. */
export function bashContextBlock(r: ShellResult): string {
  let stderr = keepTail(r.stderr, SHELL_CONTEXT_CAP);
  if (r.signal) stderr += `\nKilled by ${r.signal}`;
  else if (r.code !== null && r.code !== 0) stderr += `\nExit code ${r.code}`;
  return `<bash-input>${escape(r.command)}</bash-input>\n<bash-stdout>${escape(keepTail(r.stdout, SHELL_CONTEXT_CAP))}</bash-stdout>\n<bash-stderr>${escape(stderr)}</bash-stderr>`;
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
