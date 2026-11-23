import { describe, it, expect } from "vitest";
import { normaliseLayout, firstLine, isExternalUrl, shareDisplayName, shareFileName } from "../src/index.ts";

describe("shared helpers", () => {
  it("firstLine trims and keeps the first line", () => {
    expect(firstLine("  UI and styling.\nMockups.")).toBe("UI and styling.");
  });
  it("isExternalUrl accepts http(s) and protocol-relative URLs only", () => {
    expect(isExternalUrl("https://e.com/a.png")).toBe(true);
    expect(isExternalUrl("//e.com/a.png")).toBe(true);
    expect(isExternalUrl("captures/a.png")).toBe(false);
  });
  it("shareDisplayName reverses shareFileName", () => {
    const id = "d7291525-1a71-4315-918f-52206c8e826d";
    expect(shareDisplayName(`/share/${shareFileName(id, "hud.png")}`)).toBe("hud.png");
    expect(shareDisplayName(`/share/${shareFileName(id, "message.md")}`)).toBe("message.md");
    expect(shareDisplayName("/share/plain.txt")).toBe("plain.txt");
  });
});

describe("normaliseLayout", () => {
  it("turns an old focussed layout into its maximised tile, when that tile is open", () => {
    expect(normaliseLayout({ mode: "focussed", slots: { "1": "a", "2": "b" }, main: "b" })).toEqual({ slots: { "1": "a", "2": "b" }, maximised: "b" });
    expect(normaliseLayout({ mode: "focussed", slots: { "1": "a" }, main: "z" })).toEqual({ slots: { "1": "a" }, maximised: null });
    expect(normaliseLayout({ mode: "tiled", slots: { "1": "a" }, main: "a" })).toEqual({ slots: { "1": "a" }, maximised: null });
  });

  it("keeps a new layout, dropping a maximised tile that isn't open and bad slots", () => {
    expect(normaliseLayout({ slots: { "1": "a", "x": "b", "2": 5 }, maximised: "a" })).toEqual({ slots: { "1": "a" }, maximised: "a" });
    expect(normaliseLayout({ slots: { "1": "a" }, maximised: "q" })).toEqual({ slots: { "1": "a" }, maximised: null });
  });

  it("falls back to an empty layout for anything else", () => {
    expect(normaliseLayout("nope")).toEqual({ slots: {}, maximised: null });
    expect(normaliseLayout(null)).toEqual({ slots: {}, maximised: null });
  });
});
