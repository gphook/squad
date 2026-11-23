import { describe, it, expect } from "vitest";
import type { Project } from "@squad/shared";
import { move, ownedBy, ownsPayload, unowned } from "../src/lib/activities.ts";

const project: Project = {
  id: "p", name: "P", rules: "", permissionMode: "default", layout: { mode: "focussed", slots: {}, main: null },
  activities: [
    { id: "1", name: "Game code", ownerId: "a", reviewerIds: [], description: "" },
    { id: "2", name: "Levels", ownerId: null, reviewerIds: [], description: "" },
    { id: "3", name: "UI", ownerId: "a", reviewerIds: [], description: "" },
  ],
};

describe("activity helpers", () => {
  it("finds unowned activities and a squadmate's own", () => {
    expect(unowned(project).map((a) => a.id)).toEqual(["2"]);
    expect(ownedBy(project, "a").map((a) => a.id)).toEqual(["1", "3"]);
    expect(unowned(null)).toEqual([]);
    expect(ownedBy(null, "a")).toEqual([]);
  });

  it("moves an item up or down, and not past the ends", () => {
    expect(move(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(move(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(move(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(move(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });

  it("builds the owns payload from ticks and comma-separated new names", () => {
    expect(ownsPayload(["1"], " Shaders, , 3D models ,")).toEqual({ activityIds: ["1"], newActivities: ["Shaders", "3D models"] });
    expect(ownsPayload([], "  ")).toEqual({ activityIds: [], newActivities: [] });
  });
});
