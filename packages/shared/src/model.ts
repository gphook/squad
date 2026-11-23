/** Value lists are the single source for both the TypeScript types and the zod schemas. */
export const SLOT_ORDER = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;
export const PERMISSION_MODES = ["default", "acceptEdits", "bypassPermissions", "plan"] as const;
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export const AGENT_ACTIONS = ["launch", "stop", "interrupt", "compact", "clear"] as const;
export const APPROVAL_DECISIONS = ["allow", "deny", "always"] as const;

export type SlotKey = (typeof SLOT_ORDER)[number];
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export type AgentAction = (typeof AGENT_ACTIONS)[number];
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
export type AgentStatus = "stopped" | "starting" | "working" | "idle" | "awaiting" | "error";

/** Most chat events kept per agent, in the browser and when sending history. */
export const MAX_EVENTS = 2000;

export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Squad's in-process MCP server is registered as "squad"; Claude Code prefixes its tool names with this. */
export const SQUAD_TOOL_PREFIX = "mcp__squad__";
export const SQUAD_TOOL_NAMES = ["squad_team", "squad_summon", "squad_share", "squad_show"] as const;
export type SquadToolName = (typeof SQUAD_TOOL_NAMES)[number];

/** Open tiles by slot, and the one tile taking most of the screen, if any. */
export interface Layout {
  slots: Partial<Record<SlotKey, string>>;
  maximised: string | null;
}

export interface Project {
  id: string;
  name: string;
  rules: string;
  permissionMode: PermissionMode;
  layout: Layout;
  /** What the squad does and who owns each part, in display order. */
  activities: Activity[];
}

/** A piece of the project's work, owned by one squadmate and optionally reviewed by others. */
export interface Activity {
  id: string;
  name: string;
  ownerId: string | null;
  reviewerIds: string[];
  description: string;
}

export type ActivityInput = Omit<Activity, "id"> & { id?: string };

export interface Agent {
  id: string;
  projectId: string;
  name: string;
  role: string;
  folder: string;
  model: string | null;
  /** How hard the model thinks; null leaves it to the model's default. */
  effort: EffortLevel | null;
  sessionId: string | null;
}

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** The Claude account squadmates run on, as the CLI reports it. `unknown`: the CLI couldn't be run or read. */
export interface AuthStatus {
  state: "signedIn" | "signedOut" | "unknown";
  method?: string;
  email?: string;
  organization?: string;
  plan?: string;
  provider?: string;
  expiresAt?: number;
}

/** A model the user's account offers, as Squad shows it. */
export interface ModelOption {
  value: string;
  displayName: string;
  description: string;
  /** Empty when the model doesn't take an effort level. */
  effortLevels: EffortLevel[];
}

export interface AgentState {
  agentId: string;
  status: AgentStatus;
  error?: string;
  contextPct?: number;
}

export type AgentEvent =
  | { kind: "user_text"; text: string; images?: string[] }
  | { kind: "text_delta"; text: string }
  | { kind: "assistant_text"; text: string }
  | { kind: "tool_use"; id: string; name: string; summary: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; isError: boolean; text: string; images?: string[] }
  | { kind: "peer_in"; from: string; text: string }
  | { kind: "peer_out"; to: string; text: string }
  | { kind: "show"; target: string; caption?: string }
  | { kind: "compacted" }
  | { kind: "turn_end"; ok: boolean; error?: string }
  /** A `$ cmd` Squad ran; live ones grow through shell_output and shell_end with the same id. */
  | {
      kind: "shell"; id: string; command: string; chunks: ShellChunk[]; running: boolean; code: number | null; signal: string | null;
      /** The shell that ran it, e.g. "zsh"; absent for blocks read back from history. */
      shellName?: string;
    }
  | { kind: "shell_output"; id: string; stream: ShellChunk["stream"]; text: string }
  | { kind: "shell_end"; id: string; code: number | null; signal: string | null };

export type ShellChunk = { stream: "stdout" | "stderr"; text: string };

export interface Approval {
  id: string;
  agentId: string;
  toolName: string;
  input: unknown;
  summary: string;
  canAlways: boolean;
}

export interface LoggedMessage {
  id: string;
  projectId: string;
  from: string;
  to: string;
  text: string;
  at: number;
  external: boolean;
}

export interface SharedFile {
  id: string;
  projectId: string;
  fromAgent: string;
  to: string[];
  note: string;
  path: string;
  size: number;
  at: number;
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const defaultLayout = (): Layout => ({ slots: {}, maximised: null });

/**
 * A stored layout in the current shape. Layouts from before maximising (`{ mode, slots, main }`) keep their open tiles,
 * and a focussed layout's main tile becomes the maximised one.
 */
export function normaliseLayout(raw: unknown): Layout {
  if (!raw || typeof raw !== "object") return defaultLayout();
  const r = raw as Record<string, unknown>;
  const slots: Layout["slots"] = {};
  const rawSlots = r.slots && typeof r.slots === "object" ? (r.slots as Record<string, unknown>) : {};
  for (const k of SLOT_ORDER) if (typeof rawSlots[k] === "string") slots[k] = rawSlots[k] as string;
  const open = (id: unknown): id is string => typeof id === "string" && Object.values(slots).includes(id);
  const candidate = "maximised" in r ? r.maximised : r.mode === "focussed" ? r.main : null;
  return { slots, maximised: open(candidate) ? candidate : null };
}

/** First line of a multi-line text, trimmed (role summaries, message previews). */
export const firstLine = (s: string): string => s.trim().split("\n")[0];

/** http(s) or protocol-relative URL, as opposed to a local path. */
export const isExternalUrl = (s: string): boolean => /^(https?:)?\/\//i.test(s);

/** Shared files are stored as `<shareId>-<original name>`; these convert both ways. */
export const shareFileName = (shareId: string, name: string): string => `${shareId}-${name}`;
export const shareDisplayName = (path: string): string => {
  const base = path.split("/").pop() ?? path;
  return base.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/, "") || base;
};
