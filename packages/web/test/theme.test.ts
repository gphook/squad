import { describe, it, expect, beforeEach } from "vitest";
import { applyTheme, loadTheme, saveTheme } from "../src/lib/theme.ts";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme", () => {
  it("defaults to the system setting", () => {
    expect(loadTheme()).toBe("system");
  });

  it("remembers a choice and ignores junk", () => {
    saveTheme("dark");
    expect(loadTheme()).toBe("dark");
    localStorage.setItem("squad.theme", "purple");
    expect(loadTheme()).toBe("system");
  });

  it("pins light or dark on the page, and clears it for system", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("nextTheme", () => {
  it("cycles system → light → dark → system", async () => {
    const { nextTheme } = await import("../src/lib/theme.ts");
    expect(["system", "light", "dark"].map((t) => nextTheme(t as any))).toEqual(["light", "dark", "system"]);
  });
});
