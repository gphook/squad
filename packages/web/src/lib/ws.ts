import type { ClientMsg, ServerMsg } from "@squad/shared";

/**
 * One WebSocket to the Squad server that reconnects with backoff (1s → 10s) and calls onOpen each time.
 * When the server rejects the session key (it restarted with a new one), onUnauthorized is called.
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
  const queue: string[] = [];

  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      delay = 1000;
      onOpen();
      for (const m of queue.splice(0)) ws!.send(m);
    };
    ws.onmessage = (e) => onMsg(JSON.parse(e.data));
    ws.onclose = () => {
      onDown();
      fetch("/api/ping").then((r) => r.status === 401 && onUnauthorized(), () => {});
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 10_000);
    };
  };
  open();

  return {
    send(m: ClientMsg) {
      const raw = JSON.stringify(m);
      if (ws?.readyState === WebSocket.OPEN) ws.send(raw);
      else queue.push(raw);
    },
  };
}
