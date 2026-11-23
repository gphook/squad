import { SLOT_ORDER, type Layout, type SlotKey } from "@squad/shared";

export const slotOf = (l: Layout, agentId: string): SlotKey | undefined =>
  SLOT_ORDER.find((k) => l.slots[k] === agentId);

/** Open tiles as [slot, agentId] in slot order (1..9, 0). */
export function openAgents(l: Layout): [SlotKey, string][] {
  return SLOT_ORDER.filter((k) => l.slots[k]).map((k) => [k, l.slots[k]!]);
}

export function openTile(l: Layout, agentId: string): Layout {
  if (slotOf(l, agentId)) return l;
  const free = SLOT_ORDER.find((k) => !l.slots[k]);
  if (!free) return l;
  return { ...l, slots: { ...l.slots, [free]: agentId } };
}

export function closeTile(l: Layout, agentId: string): Layout {
  const k = slotOf(l, agentId);
  if (!k) return l;
  const slots = { ...l.slots };
  delete slots[k];
  return { ...l, slots };
}

export function moveTile(l: Layout, agentId: string, slot: SlotKey): Layout {
  const from = slotOf(l, agentId);
  if (!from || from === slot) return l;
  const slots = { ...l.slots };
  const occupant = slots[slot];
  slots[slot] = agentId;
  if (occupant) slots[from] = occupant;
  else delete slots[from];
  return { ...l, slots };
}

export function pressAlt(l: Layout, slot: SlotKey): { layout: Layout; focus: string | null } {
  const agentId = l.slots[slot];
  if (!agentId) return { layout: l, focus: null };
  if (l.mode === "tiled") return { layout: l, focus: agentId };
  return { layout: { ...l, main: agentId }, focus: agentId };
}

export function showInMain(l: Layout, agentId: string): Layout {
  return { ...l, main: agentId };
}
