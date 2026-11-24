import { describe, it, expect } from "vitest";
import { formatSkills, type SkillInfo } from "../src/skillsList.ts";

const skill = (name: string, description: string, builtin?: boolean): SkillInfo =>
  ({ name, description, argumentHint: "", ...(builtin ? { builtin } : {}) });

describe("formatSkills", () => {
  const list = [
    skill("superpowers:b", "(superpowers) Plan things. Then more."),
    skill("simplify", "Review the changed code.", true),
    skill("mine", "Do it. More. (user)"),
    skill("squad-kit:squad-radio", "(squad-kit) Use whenever you message a squadmate."),
    skill("proj", "P (project)"),
    skill("odd", "x"),
  ];
  const md = formatSkills(list);

  it("groups by source: Built-in, Personal, Project, plugins A–Z, then Other", () => {
    const headings = md.split("\n").filter((l) => l.startsWith("**"));
    expect(headings).toEqual(["**Built-in**", "**Personal**", "**Project**", "**squad-kit**", "**superpowers**", "**Other**"]);
  });
  it("shows each skill's name and the first sentence of its description, without the source marker", () => {
    expect(md).toContain("`mine` — Do it.\n");
    expect(md).toContain("`superpowers:b` — Plan things.\n");
    expect(md).toContain("`proj` — P\n");
  });
  it("clips a long description to 120 characters", () => {
    const line = formatSkills([skill("long", "a".repeat(300))]).split("\n").find((l) => l.startsWith("`long`"))!;
    expect(line).toHaveLength(120);
    expect(line.endsWith("…")).toBe(true);
  });
  it("uses the first line of a multi-line description", () => {
    expect(formatSkills([skill("ml", "First line\nsecond line")])).toContain("`ml` — First line\n");
  });
  it("shows just the name when the description is only the source marker", () => {
    expect(formatSkills([skill("superpowers:b", "(superpowers)")])).toContain("`superpowers:b`\n");
  });
  it("keeps markdown characters in a name literal, inside code", () => {
    expect(formatSkills([skill("a_b*c", "x")])).toContain("`a_b*c` — x");
  });
  it("groups skills synced from claude.ai after the plugins, without their marker", () => {
    const md = formatSkills([skill("docx", "Use this for Word files. (claude.ai sync)"), skill("z:y", "(z) Z."), skill("odd", "x")]);
    expect(md.split("\n").filter((l) => l.startsWith("**"))).toEqual(["**z**", "**claude.ai**", "**Other**"]);
    expect(md).toContain("`docx` — Use this for Word files.\n");
  });
  it("never leaves a code span open, so one description can't garble the lines after it", () => {
    const md = formatSkills([skill("d", "Run `npm " + "x".repeat(200) + "` first."), skill("e", "Stray ` tick."), skill("f", "Fine.")]);
    for (const l of md.split("\n")) expect((l.match(/(?<!\\)`/g) ?? []).length % 2).toBe(0);
    expect(md).toContain("`f` — Fine.");
  });
  it("keeps code spans that are whole", () => {
    expect(formatSkills([skill("g", "Run `npm test` first.")])).toContain("`g` — Run `npm test` first.");
  });
  it("keeps <placeholders> as text rather than letting them read as HTML", () => {
    expect(formatSkills([skill("h", "Use when <PR number> is given.")])).toContain("`h` — Use when \\<PR number> is given.");
  });
  it("says so when there are no skills", () => {
    expect(formatSkills([])).toBe("No skills.");
  });
});
