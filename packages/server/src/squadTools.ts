import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { errorMessage, type SquadToolName } from "@squad/shared";
import type { Supervisor } from "./supervisor.ts";

export interface SquadToolHandlers {
  team(): Promise<string>;
  summon(a: { agent: string }): Promise<string>;
  share(a: { path?: string; text?: string; to: string[]; note: string }): Promise<string>;
  show(a: { target: string }): Promise<string>;
}

/**
 * Plain handlers, kept apart from the MCP wrapper so they can be tested directly.
 * `agentName` is a lookup so a renamed agent's tools use its current name.
 */
export function squadToolHandlers(sup: Supervisor, projectId: string, agentName: () => string): SquadToolHandlers {
  return {
    team: async () => sup.teamSummary(projectId, agentName()),
    summon: ({ agent }) => sup.summon(projectId, agentName(), agent),
    share: async (input) => {
      try {
        const s = await sup.share(projectId, agentName(), input);
        return `Shared as ${s.path}. Put this path in your SendMessage.`;
      } catch (e) {
        return errorMessage(e);
      }
    },
    show: async ({ target }) => (sup.canShow(projectId, agentName(), target) ? "shown" : "Path not allowed"),
  };
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export function createSquadTools(sup: Supervisor, projectId: string, agentName: () => string) {
  const h = squadToolHandlers(sup, projectId, agentName);
  return createSdkMcpServer({
    name: "squad",
    version: "1.0.0",
    tools: [
      tool("squad_team" satisfies SquadToolName, "List the agents on your Squad team with their role and current status.", {},
        async () => text(await h.team())),
      tool("squad_summon" satisfies SquadToolName, "Start a squadmate that isn't running so you can message it. Does nothing if it is already running.",
        { agent: z.string().describe("Squadmate's name"), reason: z.string().describe("Why you need them") },
        async (a) => text(await h.summon(a))),
      tool("squad_share" satisfies SquadToolName,
        "Share a large message or a file with squadmates. Give either `path` (a file in your repo) or `text`. Returns the shared path to put in your SendMessage.",
        {
          path: z.string().optional(), text: z.string().optional(),
          to: z.array(z.string()).describe("Recipient agent names"), note: z.string().describe("One line on what this is"),
        },
        async (a) => text(await h.share(a))),
      tool("squad_show" satisfies SquadToolName, "Show an image or file to the user in Squad. `target` is a path in your repo or the shared folder, or an http(s) URL.",
        { target: z.string(), caption: z.string().optional() },
        async (a) => text(await h.show(a))),
    ],
  });
}
