import type { SwitchSource } from "@squad/shared";

/**
 * What clicking a switch sends as `enabled`. The project column gets its own setting, the opposite of what it shows.
 * A squadmate following the project gets its own setting, the opposite of the project's; one with its own setting
 * goes back to following the project (null).
 */
export function nextSwitch(current: { on: boolean; source: SwitchSource }, column: "project" | "mate", projectOn: boolean): boolean | null {
  if (column === "project") return !current.on;
  return current.source === "own" ? null : !projectOn;
}
