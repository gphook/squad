import { describe, it, expect } from "vitest";
import { resolveShell } from "../src/shells/adapters.ts";
import { posixControl, processControlFor } from "../src/shells/processControl.ts";

describe("resolveShell", () => {
  it("picks the posix adapter for POSIX shells, keeping the path", () => {
    for (const name of ["sh", "bash", "zsh", "dash", "ksh"]) {
      const s = resolveShell(`/bin/${name}`);
      expect(s, name).toMatchObject({ path: `/bin/${name}`, name });
      expect(s.adapter.id).toBe("posix");
    }
  });

  it("picks fish, nushell and PowerShell by name", () => {
    expect(resolveShell("/opt/homebrew/bin/fish").adapter.id).toBe("fish");
    expect(resolveShell("/usr/bin/nu").adapter.id).toBe("nu");
    expect(resolveShell("/usr/bin/pwsh").adapter.id).toBe("pwsh");
  });

  it("falls back to /bin/sh for an unset, empty or unknown shell", () => {
    for (const env of [undefined, "", "/usr/local/bin/xonsh"]) {
      const s = resolveShell(env);
      expect(s, String(env)).toMatchObject({ path: "/bin/sh", name: "sh" });
      expect(s.adapter.id).toBe("posix");
    }
  });

  it("builds each shell's arguments", () => {
    expect(resolveShell("/bin/bash").adapter.argv("ls")).toEqual(["-c", "ls"]);
    expect(resolveShell("/usr/bin/fish").adapter.argv("ls")).toEqual(["-c", "ls"]);
    expect(resolveShell("/usr/bin/nu").adapter.argv("ls")).toEqual(["-c", "ls"]);
    expect(resolveShell("/usr/bin/pwsh").adapter.argv("ls")).toEqual(["-NoProfile", "-NonInteractive", "-Command", "ls"]);
  });
});

describe("processControlFor", () => {
  it("uses process groups on Linux and macOS", () => {
    expect(processControlFor("linux")).toBe(posixControl);
    expect(processControlFor("darwin")).toBe(posixControl);
    expect(posixControl.detached).toBe(true);
  });

  it("has nothing for Windows yet", () => {
    expect(processControlFor("win32")).toBeNull();
  });
});
