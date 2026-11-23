import type { Activity, Project } from "@squad/shared";

export const unowned = (project: Project | null): Activity[] => project?.activities.filter((a) => !a.ownerId) ?? [];

export const ownedBy = (project: Project | null, agentId: string): Activity[] =>
  project?.activities.filter((a) => a.ownerId === agentId) ?? [];

/** `list` with item `i` swapped one place up (-1) or down (1); unchanged at the ends. */
export function move<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** What a squadmate should own: the ticked activities plus new ones typed as a comma-separated list. */
export function ownsPayload(activityIds: string[], newNames: string): { activityIds: string[]; newActivities: string[] } {
  return { activityIds, newActivities: newNames.split(",").map((n) => n.trim()).filter(Boolean) };
}

/**
 * What a squadmate should own after its dialog is saved: what it owns now (including anything assigned
 * elsewhere while the dialog was open) plus what was ticked, minus only what the user unticked.
 */
export function ownedAfterEdit(ownedNow: string[], tickedAtOpen: string[], ticked: string[]): string[] {
  const unticked = new Set(tickedAtOpen.filter((id) => !ticked.includes(id)));
  return [...new Set([...ownedNow, ...ticked])].filter((id) => !unticked.has(id));
}

/** The dialog's list plus activities created elsewhere after it opened, so saving doesn't delete them. */
export function keepNewer<T extends { id?: string }>(edited: T[], idsAtOpen: string[], live: (T & { id: string })[]): T[] {
  const known = new Set(idsAtOpen);
  return [...edited, ...live.filter((a) => !known.has(a.id))];
}

/** Reviewer names as one line, in the order given; "nobody" when there are none. */
export function reviewerLabel(ids: string[], names: Map<string, string>): string {
  const known = ids.flatMap((id) => (names.has(id) ? [names.get(id)!] : []));
  return known.length ? known.join(", ") : "nobody";
}

/** Above this many options, PickList shows a filter box. */
export const PICKLIST_FILTER_THRESHOLD = 6;

export function filterOptions<T extends { name: string }>(options: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
}

/** The row with a new owner, who can't also review their own activity. */
export function withOwner<T extends { ownerId: string | null; reviewerIds: string[] }>(row: T, ownerId: string | null): T {
  return { ...row, ownerId, reviewerIds: row.reviewerIds.filter((r) => r !== ownerId) };
}

/** Why the dialog's activities can't be saved, or null when they can. */
export function activityProblem(rows: { name: string }[]): string | null {
  if (rows.some((r) => !r.name.trim())) return "Name every activity.";
  const seen = new Set<string>();
  for (const r of rows) {
    const k = r.name.trim().toLowerCase();
    if (seen.has(k)) return `Two activities are called "${r.name.trim()}".`;
    seen.add(k);
  }
  return null;
}
