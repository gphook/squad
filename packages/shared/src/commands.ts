/** A `/` command a squadmate can run, as the SDK lists it. */
export interface SlashCommandInfo {
  name: string;
  description: string;
  argumentHint: string;
  aliases?: string[];
}

/** Commands Squad runs itself, so the SDK session never changes behind Squad's back. */
export const SQUAD_COMMANDS: SlashCommandInfo[] = [
  // Claude Code's own aliases, so they reach Squad's Clear even before the session has listed its commands.
  { name: "clear", description: "Start a fresh session (Squad's Clear)", argumentHint: "", aliases: ["reset", "new"] },
  { name: "exit", description: "Stop this squadmate (Squad's Stop)", argumentHint: "", aliases: ["quit"] },
];

const NOT_YET = "isn't available in Squad yet.";

/** Commands Squad answers with a notice instead of running: name → what follows `/name` in the notice. */
export const UNAVAILABLE_COMMANDS: Record<string, string> = {
  resume: "isn't needed: Squad resumes the squadmate's previous conversation when it launches. Picking an older one is coming.",
  plugin: NOT_YET,
  skills: NOT_YET,
  config: "isn't available in Squad.",
  model: "isn't available in Squad. Set the model in the squadmate's settings.",
};

/** Claude Code's aliases for the commands above, known before the session has listed its commands. */
const UNAVAILABLE_ALIASES: Record<string, string> = { settings: "config" };

/** True when `name` is one of the commands Squad answers with a notice (own keys only, so `constructor` isn't). */
export const isUnavailableCommand = (name: string) => Object.hasOwn(UNAVAILABLE_COMMANDS, name);

// A name can't contain `/`, so a message starting with a path is just a message.
const COMMAND_RE = /^\/([A-Za-z0-9][\w:.-]*)(?:\s+([\s\S]*))?$/;

/** The command at the start of a message, or null if it doesn't start with one. */
export function parseSlashCommand(text: string): { name: string; args: string } | null {
  const m = COMMAND_RE.exec(text.trim());
  return m ? { name: m[1].toLowerCase(), args: (m[2] ?? "").trim() } : null;
}

export type CommandRoute = { kind: "clear" } | { kind: "stop" } | { kind: "notice"; text: string } | { kind: "sdk" };

/** What Squad does with `/name`, after resolving Squad's and the SDK's aliases. */
export function routeCommand(name: string, sdkCommands: SlashCommandInfo[]): CommandRoute {
  // A command's own name wins over another's alias, as in Claude Code.
  const all = [...SQUAD_COMMANDS, ...sdkCommands];
  const resolved = all.some((c) => c.name === name) ? name
    : (all.find((c) => c.aliases?.includes(name))?.name ?? (Object.hasOwn(UNAVAILABLE_ALIASES, name) ? UNAVAILABLE_ALIASES[name] : name));
  if (resolved === "clear") return { kind: "clear" };
  if (resolved === "exit") return { kind: "stop" };
  return isUnavailableCommand(resolved) ? { kind: "notice", text: `/${resolved} ${UNAVAILABLE_COMMANDS[resolved]}` } : { kind: "sdk" };
}
