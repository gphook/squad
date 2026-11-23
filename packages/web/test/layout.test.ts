import { describe, it, expect } from "vitest";
import type { Layout } from "@squad/shared";
import { closeTile, moveTile, openTile, pressAlt, openAgents, pruneLayout, showSquadmate, toggleMaximise } from "../src/lib/layout.ts";

const empty: Layout = { slots: {}, maximised: null };
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
  it("maximises a tile and restores the grid when toggled again", () => {
    const l = toggleMaximise(withTiles("a", "b"), "b");
    expect(l.maximised).toBe("b");
    expect(toggleMaximise(l, "b").maximised).toBeNull();
  });
  it("maximising another tile swaps it in, opening its tile if needed", () => {
    const l = toggleMaximise(toggleMaximise(withTiles("a", "b"), "a"), "c");
    expect(l.maximised).toBe("c");
    expect(l.slots).toEqual({ "1": "a", "2": "b", "3": "c" });
  });
  it("Alt+N with a tile maximised swaps tile N in and focuses it", () => {
    const r = pressAlt(toggleMaximise(withTiles("a", "b"), "a"), "2");
    expect(r.layout.maximised).toBe("b");
    expect(r.focus).toBe("b");
  });
  it("Alt+N with nothing maximised only moves focus", () => {
    const l = withTiles("a", "b");
    expect(pressAlt(l, "2")).toEqual({ layout: l, focus: "b" });
  });
  it("Alt+N for the maximised tile keeps it maximised and focuses it", () => {
    const l = toggleMaximise(withTiles("a", "b"), "b");
    expect(pressAlt(l, "2")).toEqual({ layout: l, focus: "b" });
  });
  it("Alt on an empty slot does nothing", () => {
    expect(pressAlt(withTiles("a"), "7")).toEqual({ layout: withTiles("a"), focus: null });
  });
  it("showing a squadmate opens its tile, and swaps it in while a tile is maximised", () => {
    expect(showSquadmate(withTiles("a"), "z")).toEqual({ slots: { "1": "a", "2": "z" }, maximised: null });
    expect(showSquadmate(toggleMaximise(withTiles("a"), "a"), "z")).toEqual({ slots: { "1": "a", "2": "z" }, maximised: "z" });
    expect(showSquadmate(withTiles("a"), "a")).toEqual(withTiles("a"));
  });
  it("closing the maximised tile restores the grid", () => {
    const l = closeTile(toggleMaximise(withTiles("a", "b"), "a"), "a");
    expect(l).toEqual({ slots: { "2": "b" }, maximised: null });
  });
  it("pruneLayout drops squadmates that no longer exist, including the maximised one", () => {
    const l = toggleMaximise(withTiles("a", "b", "c"), "b");
    expect(pruneLayout(l, ["a", "c"])).toEqual({ slots: { "1": "a", "3": "c" }, maximised: null });
    expect(pruneLayout(l, ["a", "b", "c"])).toBe(l);
  });
  it("openAgents lists tiled agents in slot order", () => {
    expect(openAgents(moveTile(withTiles("a", "b"), "a", "0"))).toEqual([["2", "b"], ["0", "a"]]);
  });
});
