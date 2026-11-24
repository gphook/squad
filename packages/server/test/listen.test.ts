import { describe, it, expect } from "vitest";
import { listenOrExplain, portInUseMessage } from "../src/listen.ts";

describe("portInUseMessage", () => {
  it("says the port is taken and what to do", () => {
    expect(portInUseMessage(7340)).toBe(
      "Squad: port 7340 is in use — is Squad already running? Open http://localhost:7340/ or use --port.",
    );
  });
});

describe("listenOrExplain", () => {
  it("explains a port in use and returns false", async () => {
    const logged: string[] = [];
    const ok = await listenOrExplain(() => Promise.reject(Object.assign(new Error("busy"), { code: "EADDRINUSE" })), 7341, (s) => logged.push(s));
    expect(ok).toBe(false);
    expect(logged).toEqual([portInUseMessage(7341)]);
  });
  it("rethrows any other listen error", async () => {
    await expect(listenOrExplain(() => Promise.reject(new Error("EACCES")), 80, () => {})).rejects.toThrow("EACCES");
  });
  it("returns true once listening", async () => {
    expect(await listenOrExplain(() => Promise.resolve(), 7340, () => {})).toBe(true);
  });
});
