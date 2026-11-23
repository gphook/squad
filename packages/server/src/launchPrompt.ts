import { firstLine, type Agent, type Project } from "@squad/shared";

export function buildLaunchPrompt(project: Project, agent: Agent, team: Agent[], shareDir: string, shellContext: string[] = []): string {
  const parts: string[] = [];
  const owned = project.activities.filter((a) => a.ownerId === agent.id).map((a) => a.name);
  const ownsLine = owned.length ? `\n\nYou own: ${owned.join(", ")}.` : "";
  parts.push(`# You are ${agent.name}\n\nYou are one agent in the "${project.name}" squad, run by Squad. Your repo is ${agent.folder}.\n\n${agent.role.trim()}${ownsLine}`);

  const others = team.filter((a) => a.id !== agent.id);
  if (others.length) {
    const lines = others.map((a) => `- **${a.name}** (${a.folder}): ${firstLine(a.role)}`);
    parts.push(`## Your squadmates\n\n${lines.join("\n")}`);
  }

  const ownership = ownershipSection(project, agent, team);
  if (ownership) parts.push(ownership);

  if (project.rules.trim()) parts.push(`## Project rules\n\n${project.rules.trim()}`);

  parts.push(
    `## Working with your squadmates\n\n` +
      `- Follow the squad-radio skill whenever you message, hand work to, or receive work from a squadmate.\n` +
      `- Message and reply to squadmates by name with SendMessage (not the session address in a message's \`from\`). Use squad_team to see who is running and squad_summon to start one that isn't.\n` +
      `- Large messages and files go through squad_share; the shared folder is ${shareDir}.\n` +
      `- Use squad_show to put an image or file in front of the user.\n` +
      `- Do work outside your own repo by asking its owner.`,
  );
  if (shellContext.length) {
    parts.push(`## Shell output from the user\n\nThe user ran these commands in your folder before you started:\n\n${shellContext.join("\n")}`);
  }
  return parts.join("\n\n");
}

/** The project's activities as ownership and review rules; empty when the project has none. */
export function ownershipSection(project: Project, agent: Agent, team: Agent[]): string {
  if (!project.activities.length) return "";
  const nameOf = (id: string) => (id === agent.id ? "you" : team.find((a) => a.id === id)?.name ?? null);
  const lines = project.activities.map((a) => {
    const owner = a.ownerId ? nameOf(a.ownerId) : null;
    if (!owner) return `- **${a.name}** — no owner yet; ask the user`;
    const reviewers = a.reviewerIds.map(nameOf).filter((n): n is string => n !== null);
    const review = reviewers.length ? ` (reviewed by ${reviewers.join(", ")})` : "";
    const description = a.description ? `: ${a.description}` : "";
    return `- **${a.name}** — ${owner}${review}${description}`;
  });
  return `## Who owns what\n\n${lines.join("\n")}\n\n` +
    "Work in an activity you don't own goes to its owner as a request; don't do it yourself. " +
    "When you finish work in an activity with reviewers, send it to them for review.";
}
