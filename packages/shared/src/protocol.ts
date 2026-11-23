import { z } from "zod";
import type { PlanUsage } from "./usage.ts";
import type {
  Agent, ModelOption, AgentEvent, AgentState, Approval, Layout, LoggedMessage, Project, SharedFile,
} from "./model.ts";
import {
  AGENT_ACTIONS, AGENT_NAME_RE, EFFORT_LEVELS, APPROVAL_DECISIONS, LAYOUT_MODES, PERMISSION_MODES, SLOT_ORDER,
} from "./model.ts";

const id = z.string().min(1);
const slotKey = z.enum(SLOT_ORDER);
const layout = z.object({
  mode: z.enum(LAYOUT_MODES),
  slots: z.partialRecord(slotKey, z.string()),
  main: z.string().nullable(),
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
  z.object({ t: z.literal("approval.answer"), approvalId: id, decision: z.enum(APPROVAL_DECISIONS) }),
  z.object({ t: z.literal("layout.save"), projectId: id, layout }),
  z.object({ t: z.literal("share.delete"), shareId: id }),
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
  | { t: "approval.request"; approval: Approval }
  | { t: "approval.resolved"; approvalId: string }
  | { t: "message.logged"; message: LoggedMessage }
  | { t: "share.added"; share: SharedFile }
  | { t: "share.removed"; shareId: string }
  | { t: "layout"; projectId: string; layout: Layout }
  | { t: "usage.plan"; plan: PlanUsage }
  | { t: "models"; models: ModelOption[] | null }
  | { t: "error"; message: string };

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
