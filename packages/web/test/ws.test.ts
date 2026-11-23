import { describe, it, expect, vi, afterEach } from "vitest";
import { connect } from "../src/lib/ws.ts";

class FakeWS {
  static OPEN = 1;
  static last: FakeWS;
  readyState = 0;
  onopen?: () => void; onclose?: () => void; onmessage?: (e: { data: string }) => void;
  constructor() { FakeWS.last = this; }
  send() {}
}

afterEach(() => vi.unstubAllGlobals());

describe("connect", () => {
  it("reports an expired session key when the server rejects it after a restart", async () => {
    vi.stubGlobal("WebSocket", FakeWS);
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 401 })));
    const onUnauthorized = vi.fn();
    connect({ onMsg: () => {}, onOpen: () => {}, onDown: () => {}, onUnauthorized });
    FakeWS.last.onclose!();
    await new Promise((r) => setTimeout(r, 0));
    expect(onUnauthorized).toHaveBeenCalled();
  });
  it("does not report it when the server is just down", async () => {
    vi.stubGlobal("WebSocket", FakeWS);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const onUnauthorized = vi.fn();
    connect({ onMsg: () => {}, onOpen: () => {}, onDown: () => {}, onUnauthorized });
    FakeWS.last.onclose!();
    await new Promise((r) => setTimeout(r, 0));
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
