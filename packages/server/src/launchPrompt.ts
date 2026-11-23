import { firstLine, type Agent, type Project } from "@squad/shared";

export function buildLaunchPrompt(project: Project, agent: Agent, team: Agent[], shareDir: string, shellContext: string[] = []): string {
  const parts: string[] = [];
  parts.push(`# You are ${agent.name}\n\nYou are one agent in the "${project.name}" squad, run by Squad. Your repo is ${agent.folder}.\n\n${agent.role.trim()}`);

  const others = team.filter((a) => a.id !== agent.id);
  if (others.length) {
    const lines = others.map((a) => `- **${a.name}** (${a.folder}): ${firstLine(a.role)}`);
    parts.push(`## Your squadmates\n\n${lines.join("\n")}`);
  }

  if (project.rules.trim()) parts.push(`## Project rules\n\n${project.rules.trim()}`);

  parts.push(
    `## Working with your squadmates\n\n` +
      `- Follow the squad-radio skill whenever you message, hand work to, or receive work from a squadmate.\n` +
      `- Message squadmates by name with SendMessage. Use squad_team to see who is running and squad_summon to start one that isn't.\n` +
      `- Large messages and files go through squad_share; the shared folder is ${shareDir}.\n` +
      `- Use squad_show to put an image or file in front of the user.\n` +
      `- Do work outside your own repo by asking its owner.`,
  );
  if (shellContext.length) {
    parts.push(`## Shell output from the user\n\nThe user ran these commands in your folder before you started:\n\n${shellContext.join("\n")}`);
  }
  return parts.join("\n\n");
}
