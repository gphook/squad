import { isUnavailableCommand, type SlashCommandInfo } from "@squad/shared";

/** What follows the `/` while a command name is being typed: a one-line draft starting with `/` and no space yet. */
export function pickerQuery(draft: string): string | null {
  const m = /^\/(\S*)$/.exec(draft);
  return m ? m[1] : null;
}

const byName = (a: SlashCommandInfo, b: SlashCommandInfo) => a.name.localeCompare(b.name);

/** Commands for the picker: name or alias prefix matches first, then names containing the query; each group by name. */
export function matchCommands(list: SlashCommandInfo[], query: string, max = 8): SlashCommandInfo[] {
  const q = query.toLowerCase();
  const prefix = list.filter((c) => [c.name, ...(c.aliases ?? [])].some((n) => n.toLowerCase().startsWith(q)));
  const inside = list.filter((c) => !prefix.includes(c) && c.name.toLowerCase().includes(q));
  return [...prefix.sort(byName), ...inside.sort(byName)].slice(0, max);
}

/** The draft after picking a command: the command and a space, ready for arguments or Enter. */
export function completion(c: SlashCommandInfo): string {
  return `/${c.name} `;
}

/**
 * True when the query names a whole command, so Enter runs what was typed (as in the terminal) instead of completing
 * it. Includes the commands Squad answers with a notice: they aren't listed, but `/plugin` mustn't become
 * `/plugin-authoring`.
 */
export function isWholeCommand(query: string, list: SlashCommandInfo[]): boolean {
  const q = query.toLowerCase();
  return isUnavailableCommand(q) || list.some((c) => c.name === q || c.aliases?.includes(q));
}
