import { z } from "zod";
import type { SlashCommandInfo } from "./commands.ts";
import type { AvailablePlugin, InstalledPlugin, Marketplace, PluginSwitch } from "./plugins.ts";
import type {
  Agent, AuthStatus, LoginState, ModelOption, AgentEvent, AgentState, Approval, Layout, LoggedMessage, Project, SharedFile,
} from "./model.ts";
import { CONNECTOR_TEMPLATES, type ConnectorLogin, type ConnectorView } from "./connectors.ts";
import {
  AGENT_ACTIONS, AGENT_NAME_RE, EFFORT_LEVELS, APPROVAL_DECISIONS, PERMISSION_MODES, SLOT_ORDER,
} from "./model.ts";

const id = z.string().min(1);
const slotKey = z.enum(SLOT_ORDER);
const layout = z.object({
  slots: z.partialRecord(slotKey, z.string()),
  maximised: z.string().nullable(),
});

const activityInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(1),
  ownerId: id.nullable(),
  reviewerIds: z.array(id),
  description: z.string(),
});

const clientMsg = z.discriminatedUnion("t", [
  z.object({ t: z.literal("subscribe"), projectId: id }),
  z.object({
    t: z.literal("project.save"),
    project: z.object({
      id: id.optional(),
      name: z.string().trim().min(1),
      rules: z.string(),
      permissionMode: z.enum(PERMISSION_MODES),
      /** When present, replaces the project's activities. */
      activities: z.array(activityInput).optional(),
    }),
  }),
  z.object({ t: z.literal("project.delete"), projectId: id }),
  z.object({ t: z.literal("project.clearAll"), projectId: id }),
  z.object({
    t: z.literal("agent.save"),
    agent: z.object({
      id: id.optional(),
      projectId: id,
      name: z.string().regex(AGENT_NAME_RE, "Name must be lowercase letters, digits and dashes"),
      role: z.string(),
      folder: z.string().min(1),
      model: z.string().nullable(),
      effort: z.enum(EFFORT_LEVELS).nullable().optional(),
    }),
    createFolder: z.boolean().optional(),
    /** When present, the activities this squadmate owns after the save. */
    owns: z.object({ activityIds: z.array(id), newActivities: z.array(z.string()) }).optional(),
  }),
  z.object({ t: z.literal("agent.delete"), agentId: id }),
  z.object({
    t: z.literal("agent.action"),
    agentId: id,
    action: z.enum(AGENT_ACTIONS),
  }),
  z.object({ t: z.literal("agent.send"), agentId: id, text: z.string(), images: z.array(z.string()).optional() }),
  z.object({ t: z.literal("agent.shellKill"), agentId: id, id }),
  z.object({ t: z.literal("models.get") }),
  z.object({ t: z.literal("auth.check") }),
  /** Sign in (or switch account) with the Anthropic Console by running `claude auth login --console`; `auth.code` passes the code the sign-in page shows. claude.ai sign-in isn't offered (#43). */
  z.object({ t: z.literal("auth.login"), method: z.literal("console") }),
  z.object({ t: z.literal("auth.code"), code: z.string().min(1).max(4096) }),
  z.object({ t: z.literal("auth.cancel") }),
  z.object({ t: z.literal("auth.logout") }),
  /**
   * `answers` / `annotations` only for an AskUserQuestion approval, `content` only for an elicitation; both with decision "allow".
   * `feedback` only for a plan approval, with decision "deny" (Keep planning).
   */
  z.object({
    t: z.literal("approval.answer"), approvalId: id, decision: z.enum(APPROVAL_DECISIONS),
    answers: z.record(z.string().max(4096), z.string().max(16384)).optional(),
    annotations: z.record(
      z.string().max(4096),
      z.object({ notes: z.string().max(16384).optional(), preview: z.string().max(65536).optional() }),
    ).optional(),
    content: z.record(
      z.string().max(256),
      z.union([z.string().max(16384), z.number(), z.boolean(), z.array(z.string().max(4096)).max(256)]),
    ).optional(),
    feedback: z.string().max(16384).optional(),
  }),
  z.object({ t: z.literal("layout.save"), projectId: id, layout }),
  z.object({ t: z.literal("share.delete"), shareId: id }),
  z.object({ t: z.literal("plugins.get"), projectId: id }),
  z.object({ t: z.literal("plugins.search"), query: z.string(), marketplace: z.string().nullable() }),
  /** `agentId` null: the project default. `enabled` null: back to following (the terminal, or the project). */
  z.object({ t: z.literal("plugins.switch"), projectId: id, pluginId: id, agentId: id.nullable(), enabled: z.boolean().nullable() }),
  /** `agentId` null: switch it on for the entire squad. */
  z.object({ t: z.literal("plugins.install"), projectId: id, pluginId: id, agentId: id.nullable() }),
  z.object({ t: z.literal("plugins.uninstall"), pluginId: id }),
  z.object({ t: z.literal("plugins.update"), pluginId: id }),
  z.object({ t: z.literal("plugins.details"), pluginId: id }),
  z.object({ t: z.literal("marketplace.add"), source: z.string() }),
  z.object({ t: z.literal("marketplace.remove"), name: id }),
  z.object({ t: z.literal("marketplace.update"), name: id }),
  z.object({ t: z.literal("connectors.get") }),
  z.object({ t: z.literal("connector.add"), template: z.enum(CONNECTOR_TEMPLATES), name: z.string().max(100), host: z.string().max(300) }),
  z.object({ t: z.literal("connector.rename"), id, name: z.string().max(100) }),
  /** `signOut`: also sign the host's CLI out. */
  z.object({ t: z.literal("connector.remove"), id, signOut: z.boolean() }),
  z.object({ t: z.literal("connector.login"), id }),
  /** An access token for a sign-in waiting on one; it goes to the host's CLI and nowhere else. */
  z.object({ t: z.literal("connector.token"), token: z.string().min(1).max(4096) }),
  z.object({ t: z.literal("connector.cancel") }),
  z.object({ t: z.literal("connector.signOut"), id }),
]);

export type ClientMsg = z.infer<typeof clientMsg>;

export type ServerMsg =
  | { t: "projects"; projects: Project[] }
  | {
      t: "state"; projectId: string; agents: Agent[]; states: AgentState[]; approvals: Approval[];
      messages: LoggedMessage[]; shares: SharedFile[];
    }
  | { t: "agent.status"; state: AgentState }
  | { t: "agent.event"; agentId: string; event: AgentEvent }
  | { t: "agent.history"; agentId: string; events: AgentEvent[] }
  | { t: "agent.commands"; agentId: string; commands: SlashCommandInfo[] }
  | { t: "approval.request"; approval: Approval }
  | { t: "approval.resolved"; approvalId: string }
  | { t: "message.logged"; message: LoggedMessage }
  | { t: "share.added"; share: SharedFile }
  | { t: "share.removed"; shareId: string }
  | { t: "layout"; projectId: string; layout: Layout }
  | { t: "models"; models: ModelOption[] | null }
  | { t: "auth"; status: AuthStatus }
  | { t: "auth.login"; login: LoginState }
  | { t: "connectors"; connectors: ConnectorView[] }
  | { t: "connector.login"; login: ConnectorLogin }
  | { t: "connector.error"; message: string }
  | { t: "error"; message: string }
  | { t: "plugins"; projectId: string; installed: InstalledPlugin[]; marketplaces: Marketplace[]; switches: PluginSwitch[]; available: number }
  | { t: "plugins.results"; query: string; marketplace: string | null; total: number; items: AvailablePlugin[] }
  | { t: "plugins.details"; details: InstalledPlugin }
  | { t: "plugins.error"; action: string; message: string }
  /** Running squadmates whose plugins changed since they launched; empty hides the Restart banner. */
  | { t: "plugins.restart"; projectId: string; agents: { agentId: string; name: string }[] }
  /** Sent to the page that typed `/plugin`: open the Plugins view with that squadmate picked. */
  | { t: "ui.open"; view: "plugins"; agentId: string | null }
  /** The passkey or session lists changed: an open Sign-in view refetches them. */
  | { t: "signin.changed" }
  /** A newer Squad is published on npm. */
  | { t: "update"; latest: string; current: string };

export function parseClientMsg(raw: string): ClientMsg | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: "Invalid JSON" };
  }
  const r = clientMsg.safeParse(data);
  if (!r.success) return { error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return r.data;
}
