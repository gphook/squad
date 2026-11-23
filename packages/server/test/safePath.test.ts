import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInside } from "../src/safePath.ts";

const root = mkdtempSync(join(tmpdir(), "squad-root-"));
const outside = mkdtempSync(join(tmpdir(), "squad-out-"));
mkdirSync(join(root, "captures"));
writeFileSync(join(root, "captures", "a.png"), "x");
writeFileSync(join(outside, "secret.txt"), "x");
symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));

describe("resolveInside", () => {
  it("resolves a relative path inside a root", () => {
    expect(resolveInside([root], "captures/a.png", root)).toBe(join(root, "captures", "a.png"));
  });
  it("rejects ../ escapes", () => {
    expect(resolveInside([root], "../" + outside.split("/").pop() + "/secret.txt", root)).toBeNull();
  });
  it("rejects an absolute path outside every root", () => {
    expect(resolveInside([root], join(outside, "secret.txt"))).toBeNull();
  });
  it("rejects a symlink inside a root that points outside", () => {
    expect(resolveInside([root], "link.txt", root)).toBeNull();
  });
  it("returns null for a missing file", () => {
    expect(resolveInside([root], "nope.png", root)).toBeNull();
  });
});
