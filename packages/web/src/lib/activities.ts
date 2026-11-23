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
