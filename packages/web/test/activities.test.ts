import { describe, it, expect } from "vitest";
import type { Project } from "@squad/shared";
import { activityProblem, filterOptions, withOwner, keepNewer, move, ownedAfterEdit, ownedBy, ownsPayload, reviewerLabel, unowned } from "../src/lib/activities.ts";

const project: Project = {
  id: "p", name: "P", rules: "", permissionMode: "default", layout: { slots: {}, maximised: null },
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

  it("ownedAfterEdit keeps ownership gained elsewhere and only releases what the user unticked", () => {
    // opened owning 1 and 2; meanwhile 5 was assigned elsewhere; user unticked 2 and ticked 3
    expect(ownedAfterEdit(["1", "2", "5"], ["1", "2"], ["1", "3"]).sort()).toEqual(["1", "3", "5"]);
    // no change in the dialog: everything owned now stays owned
    expect(ownedAfterEdit(["1", "5"], ["1"], ["1"]).sort()).toEqual(["1", "5"]);
  });

  it("keepNewer appends activities created after the dialog opened", () => {
    const edited = [{ id: "1", name: "A" }, { name: "New" }];
    const live = [{ id: "1", name: "A" }, { id: "2", name: "Deleted in dialog" }, { id: "9", name: "Made elsewhere" }];
    expect(keepNewer(edited, ["1", "2"], live)).toEqual([...edited, { id: "9", name: "Made elsewhere" }]);
  });

  it("reviewerLabel joins names in order, skips unknown ids, and says nobody when empty", () => {
    const names = new Map([["a", "ay"], ["b", "bee"]]);
    expect(reviewerLabel(["b", "a"], names)).toBe("bee, ay");
    expect(reviewerLabel(["b", "zz"], names)).toBe("bee");
    expect(reviewerLabel([], names)).toBe("nobody");
  });

  it("filterOptions matches names ignoring case; a blank query keeps all", () => {
    const opts = [{ name: "sf-modeller" }, { name: "starfade" }, { name: "SF-UI-Designer" }];
    expect(filterOptions(opts, "sf-")).toEqual([opts[0], opts[2]]);
    expect(filterOptions(opts, "  ")).toEqual(opts);
  });

  it("withOwner sets the owner and drops them from the reviewers", () => {
    expect(withOwner({ ownerId: "a", reviewerIds: ["b", "c"] }, "b")).toEqual({ ownerId: "b", reviewerIds: ["c"] });
    expect(withOwner({ ownerId: "a", reviewerIds: ["b"] }, null)).toEqual({ ownerId: null, reviewerIds: ["b"] });
  });

  it("activityProblem explains why the activities can't be saved", () => {
    expect(activityProblem([{ name: "UI" }, { name: "Shaders" }])).toBeNull();
    expect(activityProblem([{ name: "UI" }, { name: "  " }])).toBe("Name every activity.");
    expect(activityProblem([{ name: "UI" }, { name: " ui " }])).toBe('Two activities are called "ui".');
  });
});
