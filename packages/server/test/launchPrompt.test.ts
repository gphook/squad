import { describe, it, expect } from "vitest";
import type { Agent, Project } from "@squad/shared";
import { buildLaunchPrompt, ownershipSection } from "../src/launchPrompt.ts";

const project: Project = {
  id: "p", name: "Starfade", rules: "Only starfade edits the game repo.", permissionMode: "default",
  layout: { mode: "focussed", slots: {}, main: null }, activities: [],
};
const agent = (name: string, role: string, folder = `/dev/${name}`): Agent =>
  ({ id: name, projectId: "p", name, role, folder, model: null, sessionId: null });
const me = agent("starfade", "All game code.");
const team = [me, agent("sf-ui-designer", "UI and UI styling.\nMockups, theme, icons.")];

describe("buildLaunchPrompt", () => {
  const out = buildLaunchPrompt(project, me, team, "/home/u/.squad/projects/p/share");
  it("names the agent and its role", () => {
    expect(out).toContain("# You are starfade");
    expect(out).toContain("All game code.");
  });
  it("calls the other agents squadmates", () => {
    expect(out).toContain("## Your squadmates");
    expect(out).not.toMatch(/teammate|## Team/i);
  });
  it("lists other agents with only the first line of their role", () => {
    expect(out).toContain("- **sf-ui-designer** (/dev/sf-ui-designer): UI and UI styling.");
    expect(out).not.toContain("Mockups, theme, icons.");
  });
  it("does not list the agent itself in the team", () => {
    expect(out).not.toContain("- **starfade**");
  });
  it("includes the share folder", () => {
    expect(out).toContain("/home/u/.squad/projects/p/share");
  });
  it("includes project rules when present and omits the section when empty", () => {
    expect(out).toContain("## Project rules\n\nOnly starfade edits the game repo.");
    expect(buildLaunchPrompt({ ...project, rules: "" }, me, team, "/s")).not.toContain("## Project rules");
  });
  it("adds the user's shell output when there is some, and omits the section otherwise", () => {
    const withShell = buildLaunchPrompt(project, me, team, "/s", ["<bash-input>ls</bash-input>"]);
    expect(withShell).toContain("## Shell output from the user\n\nThe user ran these commands in your folder before you started:\n\n<bash-input>ls</bash-input>");
    expect(out).not.toContain("## Shell output from the user");
  });
});

describe("ownership from activities", () => {
  const ui = team[1];
  const withActs = {
    ...project,
    activities: [
      { id: "1", name: "Game code", ownerId: "starfade", reviewerIds: [], description: "" },
      { id: "2", name: "3D models", ownerId: "sf-ui-designer", reviewerIds: ["starfade"], description: "Blender scripts, .glb files" },
      { id: "3", name: "Level design", ownerId: null, reviewerIds: [], description: "" },
    ],
  };

  it("writes who owns what for a squadmate that isn't involved", () => {
    expect(ownershipSection(withActs, agent("other", "x"), team)).toBe(
      "## Who owns what\n\n" +
      "- **Game code** — starfade\n" +
      "- **3D models** — sf-ui-designer (reviewed by starfade): Blender scripts, .glb files\n" +
      "- **Level design** — no owner yet; ask the user\n\n" +
      "Work in an activity you don't own goes to its owner as a request; don't do it yourself. When you finish work in an activity with reviewers, send it to them for review.",
    );
  });

  it("says you for the squadmate itself, and lists what it owns", () => {
    const outFor = buildLaunchPrompt(withActs, me, team, "/s");
    expect(outFor).toContain("- **Game code** — you\n");
    expect(outFor).toContain("- **3D models** — sf-ui-designer (reviewed by you)");
    expect(outFor).toContain("All game code.\n\nYou own: Game code.");
    expect(buildLaunchPrompt(withActs, ui, team, "/s")).toContain("You own: 3D models.");
  });

  it("follows a renamed squadmate, because owners are ids", () => {
    const renamed = [me, { ...ui, name: "sf-artist" }];
    expect(ownershipSection(withActs, me, renamed)).toContain("- **3D models** — sf-artist (reviewed by you)");
  });

  it("adds nothing when the project has no activities", () => {
    expect(ownershipSection(project, me, team)).toBe("");
    const plain = buildLaunchPrompt(project, me, team, "/s");
    expect(plain).not.toContain("You own:");
    expect(plain).not.toContain("## Who owns what");
  });
});
