import type { SlashCommandInfo } from "@squad/shared";

/** A skill as `reloadSkills()` lists it; `builtin` marks the ones bundled with Claude Code. */
export type SkillInfo = SlashCommandInfo & { builtin?: boolean };

const MAX_LINE = 120;
const PLUGIN_MARKER = /^\([^)]*\)\s*/;
/** Where Claude Code says a skill outside any plugin comes from, at the end of its description. */
const SCOPE_MARKER = /\s*\((user|project|claude\.ai sync)\)$/;
const SCOPE_GROUPS: Record<string, string> = { user: "Personal", project: "Project", "claude.ai sync": "claude.ai" };
const FIXED_GROUPS = ["Built-in", "Personal", "Project"];

function group(s: SkillInfo): string {
  if (s.builtin) return "Built-in";
  if (s.name.includes(":")) return s.name.slice(0, s.name.indexOf(":"));
  const scope = SCOPE_MARKER.exec(s.description.split("\n")[0])?.[1];
  return scope ? SCOPE_GROUPS[scope] : "Other";
}

/** The first sentence of the description's first line, without its `(plugin)` / `(user)` marker. */
function summary(description: string): string {
  const line = description.split("\n")[0].replace(PLUGIN_MARKER, "").replace(SCOPE_MARKER, "").trim();
  const end = line.indexOf(". ");
  return end < 0 ? line : line.slice(0, end + 1);
}

function line(s: SkillInfo): string {
  const name = `\`${s.name}\``;
  let text = summary(s.description);
  if (!text) return name;
  const room = MAX_LINE - name.length - 3;
  if (text.length > room) text = text.slice(0, room - 1) + "…";
  // A code span left open (a stray backtick, or one clipped above) would run into the next skill's line.
  if ((text.match(/`/g) ?? []).length % 2) text = text.replaceAll("`", "\\`");
  // `<file>`-style placeholders would otherwise read as HTML and vanish.
  return `${name} — ${text.replaceAll("<", "\\<")}`;
}

/** The skills as markdown, grouped by where they come from: Built-in, Personal, Project, each plugin, then Other. */
export function formatSkills(skills: SkillInfo[]): string {
  if (!skills.length) return "No skills.";
  const groups = new Map<string, SkillInfo[]>();
  for (const s of skills) groups.set(group(s), [...(groups.get(group(s)) ?? []), s]);
  // Built-in, Personal and Project first, then plugins A–Z, then claude.ai and Other.
  const rank = (g: string) => (FIXED_GROUPS.includes(g) ? FIXED_GROUPS.indexOf(g) : g === "claude.ai" ? 98 : g === "Other" ? 99 : 50);
  const order = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return order.map((g) => {
    const lines = groups.get(g)!.sort((a, b) => a.name.localeCompare(b.name)).map(line);
    return `**${g}**\n${lines.join("\n")}\n`;
  }).join("\n");
}
