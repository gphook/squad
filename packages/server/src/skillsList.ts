import type { SlashCommandInfo } from "@squad/shared";

/** A skill as `reloadSkills()` lists it; `builtin` marks the ones bundled with Claude Code. */
export type SkillInfo = SlashCommandInfo & { builtin?: boolean };

const MAX_LINE = 120;
const PLUGIN_MARKER = /^\([^)]*\)\s*/;
const SCOPE_MARKER = /\s*\((user|project)\)$/;
const FIXED_GROUPS = ["Built-in", "Personal", "Project"];

function group(s: SkillInfo): string {
  if (s.builtin) return "Built-in";
  if (s.name.includes(":")) return s.name.slice(0, s.name.indexOf(":"));
  const scope = SCOPE_MARKER.exec(s.description.split("\n")[0])?.[1];
  return scope === "user" ? "Personal" : scope === "project" ? "Project" : "Other";
}

/** The first sentence of the description's first line, without its `(plugin)` / `(user)` marker. */
function summary(description: string): string {
  const line = description.split("\n")[0].replace(PLUGIN_MARKER, "").replace(SCOPE_MARKER, "").trim();
  const end = line.indexOf(". ");
  return end < 0 ? line : line.slice(0, end + 1);
}

function line(s: SkillInfo): string {
  const text = summary(s.description);
  const full = text ? `\`${s.name}\` — ${text}` : `\`${s.name}\``;
  return full.length > MAX_LINE ? full.slice(0, MAX_LINE - 1) + "…" : full;
}

/** The skills as markdown, grouped by where they come from: Built-in, Personal, Project, each plugin, then Other. */
export function formatSkills(skills: SkillInfo[]): string {
  if (!skills.length) return "No skills.";
  const groups = new Map<string, SkillInfo[]>();
  for (const s of skills) groups.set(group(s), [...(groups.get(group(s)) ?? []), s]);
  const rank = (g: string) => (FIXED_GROUPS.includes(g) ? FIXED_GROUPS.indexOf(g) : g === "Other" ? 99 : 50);
  const order = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return order.map((g) => {
    const lines = groups.get(g)!.sort((a, b) => a.name.localeCompare(b.name)).map(line);
    return `**${g}**\n${lines.join("\n")}\n`;
  }).join("\n");
}
