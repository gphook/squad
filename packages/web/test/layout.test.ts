import { describe, it, expect } from "vitest";
import type { Layout } from "@squad/shared";
import { closeTile, moveTile, openTile, pressAlt, showInMain, openAgents } from "../src/lib/layout.ts";

const empty: Layout = { mode: "focussed", slots: {}, main: null };
const withTiles = (...ids: string[]) => ids.reduce((l, id) => openTile(l, id), empty);

describe("layout", () => {
  it("opens tiles in slot order 1..9 then 0", () => {
    const l = withTiles(..."abcdefghij".split(""));
    expect(l.slots).toMatchObject({ "1": "a", "9": "i", "0": "j" });
  });
  it("ignores an 11th tile", () => {
    const l = withTiles(..."abcdefghij".split(""));
    expect(openTile(l, "k")).toEqual(l);
  });
  it("does not open the same agent twice", () => {
    expect(openTile(withTiles("a"), "a").slots).toEqual({ "1": "a" });
  });
  it("keeps other slot numbers when a tile closes and reuses the gap", () => {
    let l = closeTile(withTiles("a", "b", "c"), "b");
    expect(l.slots).toEqual({ "1": "a", "3": "c" });
    l = openTile(l, "d");
    expect(l.slots).toEqual({ "1": "a", "2": "d", "3": "c" });
  });
  it("moveTile swaps with the occupant", () => {
    expect(moveTile(withTiles("a", "b"), "a", "2").slots).toEqual({ "1": "b", "2": "a" });
    expect(moveTile(withTiles("a"), "a", "5").slots).toEqual({ "5": "a" });
  });
  it("Alt+N in focussed mode puts that tile in main", () => {
    const r = pressAlt(withTiles("a", "b"), "2");
    expect(r.layout.main).toBe("b");
    expect(r.focus).toBe("b");
  });
  it("Alt+N in tiled mode only moves focus", () => {
    const l = { ...withTiles("a", "b"), mode: "tiled" as const };
    const r = pressAlt(l, "2");
    expect(r.layout).toEqual(l);
    expect(r.focus).toBe("b");
  });
  it("Alt on an empty slot does nothing", () => {
    expect(pressAlt(withTiles("a"), "7")).toEqual({ layout: withTiles("a"), focus: null });
  });
  it("showInMain does not take a slot", () => {
    const l = showInMain(withTiles("a"), "z");
    expect(l.main).toBe("z");
    expect(l.slots).toEqual({ "1": "a" });
  });
  it("openAgents lists tiled agents in slot order", () => {
    expect(openAgents(moveTile(withTiles("a", "b"), "a", "0"))).toEqual([["2", "b"], ["0", "a"]]);
  });
});
