import { describe, it, expect } from "vitest";
import { nextSwitch } from "../src/lib/plugins.ts";

describe("nextSwitch", () => {
  it("gives the project its own setting, the opposite of what it shows", () => {
    expect(nextSwitch({ on: true, source: "terminal" }, "project", true)).toBe(false);
    expect(nextSwitch({ on: false, source: "own" }, "project", false)).toBe(true);
  });
  it("gives a squadmate following the project its own setting, the opposite of the project's", () => {
    expect(nextSwitch({ on: true, source: "project" }, "mate", true)).toBe(false);
    expect(nextSwitch({ on: false, source: "project" }, "mate", false)).toBe(true);
  });
  it("returns a squadmate with its own setting to following the project", () => {
    expect(nextSwitch({ on: true, source: "own" }, "mate", false)).toBeNull();
  });
});
