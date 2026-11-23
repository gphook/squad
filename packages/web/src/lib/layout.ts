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

/** Closing the maximised tile restores the grid. */
export function closeTile(l: Layout, agentId: string): Layout {
  const k = slotOf(l, agentId);
  if (!k) return l;
  const slots = { ...l.slots };
  delete slots[k];
  return { slots, maximised: l.maximised === agentId ? null : l.maximised };
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

/** Maximises a squadmate's tile (opening it if needed), or restores the grid when it's already maximised. */
export function toggleMaximise(l: Layout, agentId: string): Layout {
  if (l.maximised === agentId) return { ...l, maximised: null };
  const opened = openTile(l, agentId);
  return slotOf(opened, agentId) ? { ...opened, maximised: agentId } : l; // all 10 slots taken: no tile to maximise
}

/** Alt+N: with a tile maximised, tile N takes its place; either way the cursor goes to tile N. */
export function pressAlt(l: Layout, slot: SlotKey): { layout: Layout; focus: string | null } {
  const agentId = l.slots[slot];
  if (!agentId) return { layout: l, focus: null };
  if (l.maximised && l.maximised !== agentId) return { layout: { ...l, maximised: agentId }, focus: agentId };
  return { layout: l, focus: agentId };
}

/** A sidebar click: open the squadmate's tile, and while a tile is maximised, swap this one in. */
export function showSquadmate(l: Layout, agentId: string): Layout {
  const opened = openTile(l, agentId);
  if (!slotOf(opened, agentId)) return l; // all 10 slots taken
  return l.maximised && l.maximised !== agentId ? { ...opened, maximised: agentId } : opened;
}

/** Drops tiles of squadmates that no longer exist; unchanged (same object) when nothing needs dropping. */
export function pruneLayout(l: Layout, agentIds: string[]): Layout {
  const known = new Set(agentIds);
  if (Object.values(l.slots).every((id) => known.has(id!)) && (!l.maximised || known.has(l.maximised))) return l;
  const slots: Layout["slots"] = {};
  for (const [k, id] of Object.entries(l.slots)) if (known.has(id!)) slots[k as SlotKey] = id;
  return { slots, maximised: l.maximised && known.has(l.maximised) ? l.maximised : null };
}
