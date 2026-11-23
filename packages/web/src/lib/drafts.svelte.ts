/**
 * Unsent messages per squadmate. They live outside the message box, so maximising, restoring or swapping tiles
 * (which remounts panes) never loses what was being typed.
 */
export interface Draft {
  text: string;
  images: string[];
}

const drafts = new Map<string, Draft>();

export function draftFor(agentId: string): Draft {
  const existing = drafts.get(agentId);
  if (existing) return existing;
  const created: Draft = $state({ text: "", images: [] });
  drafts.set(agentId, created);
  return created;
}
