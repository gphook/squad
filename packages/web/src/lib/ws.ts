import type { ClientMsg, ServerMsg } from "@squad/shared";

/**
 * One WebSocket to the Squad server that reconnects with backoff (1s → 10s) and calls onOpen each time.
 * When the server rejects the session (a 4401 close, or a 401 from /api/ping), onUnauthorized is called and it stops
 * reconnecting. stop() also stops it; start a new connection after signing in again.
 */
export interface ConnectHandlers {
  onMsg: (m: ServerMsg) => void;
  onOpen: () => void;
  onDown: () => void;
  onUnauthorized?: () => void;
}

export function connect({ onMsg, onOpen, onDown, onUnauthorized = () => {} }: ConnectHandlers) {
  let ws: WebSocket | null = null;
  let delay = 1000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const queue: string[] = [];

  const unauthorized = () => {
    stop();
    onUnauthorized();
  };
  const retry = () => {
    if (stopped) return;
    timer = setTimeout(open, delay);
    delay = Math.min(delay * 2, 10_000);
  };

  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const socket = (ws = new WebSocket(`${proto}://${location.host}/ws`));
    socket.onopen = () => {
      delay = 1000;
      onOpen();
      for (const m of queue.splice(0)) socket.send(m);
    };
    socket.onmessage = (e) => onMsg(JSON.parse(e.data));
    socket.onclose = (e) => {
      if (stopped) return;
      onDown();
      if (e.code === 4401) return unauthorized();
      fetch("/api/ping").then(
        (r) => (r.status === 401 ? unauthorized() : retry()),
        retry,
      );
    };
  };

  function stop() {
    stopped = true;
    clearTimeout(timer);
    const socket = ws;
    ws = null;
    if (socket) socket.onclose = null;
    socket?.close();
  }
  open();

  return {
    send(m: ClientMsg) {
      const raw = JSON.stringify(m);
      if (ws?.readyState === WebSocket.OPEN) ws.send(raw);
      else queue.push(raw);
    },
    stop,
  };
}
