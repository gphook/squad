import { describe, it, expect } from "vitest";
import { helpText, nodeTooOld, parseCli } from "../src/cli.ts";

describe("parseCli", () => {
  it("takes the port from --port, then SQUAD_PORT, then config, then 7340", () => {
    expect(parseCli(["--port", "7400"], { SQUAD_PORT: "7500" }, 7600).port).toBe(7400);
    expect(parseCli([], { SQUAD_PORT: "7500" }, 7600).port).toBe(7500);
    expect(parseCli([], {}, 7600).port).toBe(7600);
    expect(parseCli([], {}, undefined).port).toBe(7340);
  });
  it("accepts --port=<n>", () => {
    expect(parseCli(["--port=7401"], {}, undefined).port).toBe(7401);
  });
  it("leaves a bad port in unknown", () => {
    expect(parseCli(["--port", "abc"], {}, undefined).unknown).toEqual(["--port abc"]);
    expect(parseCli(["--port=70000"], {}, undefined).unknown).toEqual(["--port=70000"]);
    expect(parseCli(["--port"], {}, undefined).unknown).toEqual(["--port"]);
  });
  it("reports an invalid SQUAD_PORT instead of quietly using another port", () => {
    expect(parseCli([], { SQUAD_PORT: "7400x" }, undefined).unknown).toEqual(["SQUAD_PORT=7400x"]);
    expect(parseCli(["--port", "7401"], { SQUAD_PORT: "nope" }, undefined).unknown).toEqual([]);
  });
  it("recognises --version, -v, --help and -h", () => {
    expect(parseCli(["--version"], {}, undefined).version).toBe(true);
    expect(parseCli(["-v"], {}, undefined).version).toBe(true);
    expect(parseCli(["--help"], {}, undefined).help).toBe(true);
    expect(parseCli(["-h"], {}, undefined).help).toBe(true);
  });
  it("knows the startup flags and reports anything else", () => {
    expect(parseCli(["--no-open", "--reset-sign-in", "--bogus"], {}, undefined).unknown).toEqual(["--bogus"]);
  });
});

describe("nodeTooOld", () => {
  it("is true below Node 24", () => {
    expect(nodeTooOld("22.11.0")).toBe(true);
    expect(nodeTooOld("24.0.0")).toBe(false);
    expect(nodeTooOld("25.1.0")).toBe(false);
  });
});

describe("helpText", () => {
  it("names the version, every flag and every environment variable", () => {
    const t = helpText("1.2.3");
    expect(t.split("\n")[0]).toBe("Squad 1.2.3 — run a squad of Claude Code agents from your browser");
    for (const s of ["--port <n>", "--no-open", "--reset-sign-in", "--version", "--help", "SQUAD_HOME", "SQUAD_PORT", "SQUAD_NO_OPEN", "SQUAD_NO_UPDATE_CHECK"]) {
      expect(t).toContain(s);
    }
  });
});
