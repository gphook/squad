import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appPaths, appVersion } from "../src/paths.ts";

describe("appPaths", () => {
  it("finds the UI and kit beside the bundle when packaged", () => {
    const p = appPaths({ packaged: true, here: "/pkg/dist" });
    expect(p).toEqual({ root: "/pkg", web: "/pkg/web", kit: "/pkg/kit", packageJson: "/pkg/package.json" });
  });
  it("finds the repo's built UI and kit when run from source", () => {
    const p = appPaths({ packaged: false, here: "/repo/packages/server/src" });
    expect(p).toEqual({ root: "/repo", web: "/repo/packages/web/dist", kit: "/repo/kit", packageJson: "/repo/package.json" });
  });
});

describe("appVersion", () => {
  it("reads the version from package.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "squad-ver-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.2.3" }));
    expect(appVersion({ root: dir, web: "", kit: "", packageJson: join(dir, "package.json") })).toBe("1.2.3");
  });
  it("is 0.0.0 when package.json is missing", () => {
    expect(appVersion({ root: "/nope", web: "", kit: "", packageJson: "/nope/package.json" })).toBe("0.0.0");
  });
});
