import { firstLine, type Agent, type Project } from "@squad/shared";

export function buildLaunchPrompt(project: Project, agent: Agent, team: Agent[], shareDir: string): string {
  const parts: string[] = [];
  parts.push(`# You are ${agent.name}\n\nYou are one agent on the "${project.name}" team, run by Squad. Your repo is ${agent.folder}.\n\n${agent.role.trim()}`);

  const others = team.filter((a) => a.id !== agent.id);
  if (others.length) {
    const lines = others.map((a) => `- **${a.name}** (${a.folder}): ${firstLine(a.role)}`);
    parts.push(`## Team\n\n${lines.join("\n")}`);
  }

  if (project.rules.trim()) parts.push(`## Project rules\n\n${project.rules.trim()}`);

  parts.push(
    `## Working with the team\n\n` +
      `- Follow the squad-radio skill whenever you message, hand work to, or receive work from another agent.\n` +
      `- Message agents by name with SendMessage. Use squad_team to see who is running and squad_summon to start an agent that isn't.\n` +
      `- Large messages and files go through squad_share; the shared folder is ${shareDir}.\n` +
      `- Use squad_show to put an image or file in front of the user.\n` +
      `- Do work outside your own repo by asking its owner.`,
  );
  return parts.join("\n\n");
}
