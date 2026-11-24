import { describe, it, expect, vi, afterEach } from "vitest";
import { connect } from "../src/lib/ws.ts";

class FakeWS {
  static OPEN = 1;
  static last: FakeWS;
  readyState = 0;
  onopen?: () => void; onclose?: (e: { code: number }) => void; onmessage?: (e: { data: string }) => void;
  constructor() { FakeWS.last = this; }
  send() {}
  close() {}
}

afterEach(() => vi.unstubAllGlobals());

describe("connect", () => {
  it("a 4401 close reports unauthorized and stops reconnecting", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWS);
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200 })));
    const onUnauthorized = vi.fn();
    connect({ onMsg: () => {}, onOpen: () => {}, onDown: () => {}, onUnauthorized });
    const first = FakeWS.last;
    first.onclose!({ code: 4401 });
    await vi.advanceTimersByTimeAsync(60_000);
    vi.useRealTimers();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(FakeWS.last).toBe(first);
  });
  it("a 401 ping after a close reports unauthorized and stops reconnecting", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWS);
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 401 })));
    const onUnauthorized = vi.fn();
    connect({ onMsg: () => {}, onOpen: () => {}, onDown: () => {}, onUnauthorized });
    const first = FakeWS.last;
    first.onclose!({ code: 1006 });
    await vi.advanceTimersByTimeAsync(60_000);
    vi.useRealTimers();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(FakeWS.last).toBe(first);
  });
  it("stop() cancels reconnecting", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWS);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const c = connect({ onMsg: () => {}, onOpen: () => {}, onDown: () => {} });
    const first = FakeWS.last;
    first.onclose!({ code: 1006 });
    c.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    vi.useRealTimers();
    expect(FakeWS.last).toBe(first);
  });
  it("does not report it when the server is just down", async () => {
    vi.stubGlobal("WebSocket", FakeWS);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const onUnauthorized = vi.fn();
    connect({ onMsg: () => {}, onOpen: () => {}, onDown: () => {}, onUnauthorized });
    FakeWS.last.onclose!({ code: 1006 });
    await new Promise((r) => setTimeout(r, 0));
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
