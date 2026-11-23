import { SQUAD_TOOL_PREFIX, parseAgentShellPrompt, parseBashContext, type AgentEvent } from "@squad/shared";

// SDK messages are handled structurally: only the fields we read are typed, so SDK minor
// changes to unrelated fields don't break the build.
type Block = {
  type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>;
  tool_use_id?: string; is_error?: boolean; content?: unknown;
  source?: { type: string; media_type?: string; data?: string };
};
export type SdkMsg = {
  type: string; subtype?: string; state?: string; session_id?: string; is_error?: boolean;
  parent_tool_use_id?: string | null;
  // Set by Claude Code on user messages it wrote itself rather than the person typing.
  isReplay?: boolean; isSynthetic?: boolean; isMeta?: boolean; isCompactSummary?: boolean;
  event?: { type?: string; delta?: { type?: string; text?: string } };
  message?: { content?: string | Block[] };
  modelUsage?: Record<string, Record<string, number>>;
  rate_limit_info?: unknown;
};

/** Harness-written user messages (replays, loaded skills, compaction summaries, slash-command output). */
const isHarnessMessage = (m: SdkMsg) => Boolean(m.isReplay || m.isSynthetic || m.isMeta || m.isCompactSummary);
/** Slash commands are stored as `<command-name>/x</command-name>…`; their output as `<local-command-stdout>`. */
const COMMAND_RE = /<command-name>([^<]*)<\/command-name>/;
const COMMAND_OUTPUT_PREFIX = "<local-command-stdout>";

/** History ids for `$ cmd` blocks read back from a transcript; live ones are UUIDs. */
let historyShellSeq = 0;

/** A user message that starts with delivered `$ cmd` blocks: the blocks as shell events, then the rest. */
function withShellBlocks(raw: string): { shells: AgentEvent[]; rest: string } {
  const parsed = parseBashContext(raw);
  if (!parsed) return { shells: [], rest: raw };
  const shells: AgentEvent[] = parsed.shells.map((s) => ({
    kind: "shell", id: `hist-${++historyShellSeq}`, command: s.command,
    chunks: [{ stream: "stdout" as const, text: s.stdout }, { stream: "stderr" as const, text: s.stderr }].filter((c) => c.text),
    running: false, code: null, signal: null,
  }));
  return { shells, rest: parsed.rest };
}

const MAX_SUMMARY = 80;
const clip = (s: string) => (s.length > MAX_SUMMARY ? s.slice(0, MAX_SUMMARY - 1) + "…" : s);

export function summariseTool(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  let s: string | undefined;
  if (name === "Bash") s = str(i.command);
  else if (name === "Read" || name === "Edit" || name === "Write") s = str(i.file_path);
  else if (name === "SendMessage") s = `${str(i.to) ?? "?"}: ${(str(i.message) ?? "").split("\n")[0]}`;
  return clip((s ?? name).replace(/\s+/g, " ").trim());
}

const PEER_RE = /<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/;

export function parsePeerMessage(text: string): { from: string; body: string } | null {
  const m = PEER_RE.exec(text);
  if (!m) return null;
  const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(m[1])?.[1];
  return { from: attr("from-name") ?? attr("from") ?? "unknown", body: m[2].trim() };
}

/**
 * The sender's name and session address from an incoming squadmate message. Claude Code delivers these as harness
 * messages, so normalise() doesn't turn them into events; but replies may be sent to that address instead of the
 * name, so Squad needs it to log them by name.
 */
export function peerAddress(raw: unknown): { name: string; address: string } | null {
  const msg = raw as SdkMsg;
  if (msg.type !== "user") return null;
  const m = PEER_RE.exec(blockText(msg.message?.content));
  if (!m) return null;
  const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(m[1])?.[1];
  const name = attr("from-name");
  const address = attr("from");
  return name && address && address !== name ? { name, address } : null;
}

function blockImages(blocks: Block[]): string[] {
  return blocks
    .filter((b) => b.type === "image" && b.source?.type === "base64")
    .map((b) => `data:${b.source!.media_type};base64,${b.source!.data}`);
}

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return (content as Block[]).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
  return "";
}

export function normalise(raw: unknown): AgentEvent[] {
  const msg = raw as SdkMsg;
  if (msg.parent_tool_use_id) return []; // a subagent's turn inside this agent's session
  switch (msg.type) {
    case "stream_event": {
      const d = msg.event?.delta;
      return msg.event?.type === "content_block_delta" && d?.type === "text_delta" && d.text
        ? [{ kind: "text_delta", text: d.text }]
        : [];
    }
    case "assistant": {
      const out: AgentEvent[] = [];
      for (const b of (msg.message?.content ?? []) as Block[]) {
        if (b.type === "text" && b.text) out.push({ kind: "assistant_text", text: b.text });
        if (b.type === "tool_use" && b.name) {
          const input = b.input ?? {};
          out.push({ kind: "tool_use", id: b.id ?? "", name: b.name, summary: summariseTool(b.name, input), input });
          if (b.name === "SendMessage" && typeof input.to === "string") {
            out.push({ kind: "peer_out", to: input.to, text: String(input.message ?? input.content ?? "") });
          }
          if (b.name === `${SQUAD_TOOL_PREFIX}squad_show` && typeof input.target === "string") {
            out.push({ kind: "show", target: input.target, ...(typeof input.caption === "string" ? { caption: input.caption } : {}) });
          }
        }
      }
      return out;
    }
    case "user": {
      if (isHarnessMessage(msg)) return [];
      const content = msg.message?.content;
      if (Array.isArray(content) && content.some((b) => b.type === "tool_result")) {
        return content
          .filter((b) => b.type === "tool_result")
          .map((b) => {
            const inner = Array.isArray(b.content) ? (b.content as Block[]) : [];
            const images = blockImages(inner);
            return {
              kind: "tool_result" as const, toolUseId: b.tool_use_id ?? "", isError: Boolean(b.is_error),
              text: blockText(b.content), ...(images.length ? { images } : {}),
            };
          });
      }
      const { shells, rest: raw } = withShellBlocks(blockText(content));
      if (raw.startsWith(COMMAND_OUTPUT_PREFIX)) return shells;
      const text = COMMAND_RE.exec(raw)?.[1] ?? raw;
      const peer = parsePeerMessage(text);
      if (peer) return [...shells, { kind: "peer_in", from: peer.from, text: peer.body }];
      const images = Array.isArray(content) ? blockImages(content) : [];
      const agentShell = parseAgentShellPrompt(text);
      const shown = agentShell === null ? text : `!${agentShell}`;
      return shown || images.length ? [...shells, { kind: "user_text", text: shown, ...(images.length ? { images } : {}) }] : shells;
    }
    case "system":
      return msg.subtype === "compact_boundary" ? [{ kind: "compacted" }] : [];
    case "result":
      return msg.subtype === "success" && !msg.is_error
        ? [{ kind: "turn_end", ok: true }]
        : [{ kind: "turn_end", ok: false, error: msg.subtype ?? "error" }];
    default:
      return [];
  }
}

/**
 * Shows squadmates' session addresses as their names: a reply sent to an address (as Claude Code tends to) reads
 * "to starfade", in its peer_out event and in its SendMessage tool line. Addresses not in `names` stay as written.
 */
export function renamePeers(events: AgentEvent[], names: ReadonlyMap<string, string>): AgentEvent[] {
  if (!names.size) return events;
  return events.map((ev) => {
    if (ev.kind === "peer_out" && names.has(ev.to)) return { ...ev, to: names.get(ev.to)! };
    if (ev.kind === "tool_use" && ev.name === "SendMessage") {
      const input = (ev.input ?? {}) as Record<string, unknown>;
      const name = typeof input.to === "string" ? names.get(input.to) : undefined;
      if (name) return { ...ev, summary: summariseTool(ev.name, { ...input, to: name }) };
    }
    return ev;
  });
}

/** A transcript as events, with replies named by the addresses its own incoming messages reveal. */
export function historyEvents(msgs: unknown[]): AgentEvent[] {
  const names = new Map<string, string>();
  for (const m of msgs) {
    const sender = peerAddress(m);
    if (sender) names.set(sender.address, sender.name);
  }
  return renamePeers(msgs.flatMap((m) => normalise(m)), names);
}
