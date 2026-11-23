import { describe, it, expect } from "vitest";
import { PERMISSION_MODES } from "@squad/shared";
import { PERMISSION_MODE_OPTIONS } from "../src/lib/permissionModes.ts";

describe("permission mode options", () => {
  it("cover every mode once, safest first", () => {
    expect(PERMISSION_MODE_OPTIONS.map((o) => o.value)).toEqual(["plan", "default", "acceptEdits", "bypassPermissions"]);
    expect([...PERMISSION_MODE_OPTIONS.map((o) => o.value)].sort()).toEqual([...PERMISSION_MODES].sort());
  });

  it("give each mode a friendly name and what it means", () => {
    expect(PERMISSION_MODE_OPTIONS.map((o) => o.label)).toEqual([
      "Plan only", "Ask before changes", "Auto-accept edits", "Skip all approvals",
    ]);
    for (const o of PERMISSION_MODE_OPTIONS) expect(o.description.length, o.value).toBeGreaterThan(10);
  });
});
