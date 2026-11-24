import { describe, it, expect, beforeEach } from "vitest";
import { MAX_SPLIT, MIN_SPLIT, clampSplit, loadSplit, saveSplit, stepSplit } from "../src/lib/split.ts";

beforeEach(() => localStorage.clear());

describe("maximised split", () => {
  it("has no saved width by default", () => {
    expect(loadSplit()).toBeNull();
  });

  it("remembers a width, and forgets it on reset", () => {
    saveSplit(0.6);
    expect(loadSplit()).toBe(0.6);
    saveSplit(null);
    expect(loadSplit()).toBeNull();
  });

  it("ignores junk and clamps a stored width", () => {
    localStorage.setItem("squad.maximisedWidth", "wide");
    expect(loadSplit()).toBeNull();
    localStorage.setItem("squad.maximisedWidth", "2");
    expect(loadSplit()).toBe(MAX_SPLIT);
  });

  it("keeps both sides usable", () => {
    expect(clampSplit(0)).toBe(MIN_SPLIT);
    expect(clampSplit(1)).toBe(MAX_SPLIT);
    expect(clampSplit(0.5)).toBe(0.5);
  });

  it("steps from the current width, or from the default when none is set", () => {
    expect(stepSplit(0.5, 1)).toBeCloseTo(0.52);
    expect(stepSplit(0.5, -1)).toBeCloseTo(0.48);
    expect(stepSplit(MAX_SPLIT, 1)).toBe(MAX_SPLIT);
    expect(stepSplit(null, 1)).toBeCloseTo(0.77);
  });
});
