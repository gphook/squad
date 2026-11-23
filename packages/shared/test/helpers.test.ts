import { describe, it, expect } from "vitest";
import { firstLine, isExternalUrl, shareDisplayName, shareFileName } from "../src/index.ts";

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
