import { EFFORT_LEVELS, type Agent, type EffortLevel, type ModelOption } from "@squad/shared";

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max",
};

/** One entry in the model dropdown; `model: null` is the account's default. */
export interface ModelChoice {
  model: string | null;
  label: string;
  description: string;
  effortLevels: EffortLevel[];
}

/** The account's models as dropdown entries, plus the saved model when the list doesn't have it. */
export function modelChoices(models: ModelOption[], saved: string | null): ModelChoice[] {
  const choices: ModelChoice[] = models.map((m) => ({
    model: m.value === "default" ? null : m.value, label: m.displayName, description: m.description, effortLevels: m.effortLevels,
  }));
  if (saved !== null && !choices.some((c) => c.model === saved)) {
    choices.push({ model: saved, label: `${saved} (not in your account's list)`, description: "", effortLevels: [...EFFORT_LEVELS] });
  }
  return choices;
}

/** The effort to keep after switching model: unchanged if the new model takes it, else back to default. */
export function effortAfterModelChange(effort: EffortLevel | null, choice: ModelChoice | undefined): EffortLevel | null {
  return effort && choice?.effortLevels.includes(effort) ? effort : null;
}

/** e.g. "sonnet · low effort", "default model". */
export function modelSummary(agent: Pick<Agent, "model" | "effort">): string {
  const model = agent.model ?? "default model";
  return agent.effort ? `${model} · ${agent.effort} effort` : model;
}

/** The effort dropdown's entries: the model's levels, plus a saved level it doesn't offer, marked, so it isn't hidden. */
export function effortOptions(levels: EffortLevel[], saved: EffortLevel | null): { level: EffortLevel; label: string }[] {
  const options = levels.map((level) => ({ level, label: EFFORT_LABELS[level] }));
  if (saved && !levels.includes(saved)) options.push({ level: saved, label: `${EFFORT_LABELS[saved]} (not offered for this model)` });
  return options;
}
