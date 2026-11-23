import { describe, it, expect } from "vitest";
import type { Agent, ModelOption } from "@squad/shared";
import { EFFORT_LABELS, effortAfterModelChange, effortOptions, modelChoices, modelSummary } from "../src/lib/models.ts";
import { emptyState, reduce } from "../src/lib/reducer.ts";

const MODELS: ModelOption[] = [
  { value: "default", displayName: "Default (recommended)", description: "Opus 5.5", effortLevels: ["low", "medium", "high", "xhigh", "max"] },
  { value: "haiku", displayName: "Haiku 5.5", description: "Fastest", effortLevels: [] },
  { value: "sonnet", displayName: "Sonnet 5.5", description: "Efficient", effortLevels: ["low", "high"] },
];

describe("model choices", () => {
  it("maps the default entry to no model and lists the rest", () => {
    expect(modelChoices(MODELS, null).map((c) => [c.model, c.label])).toEqual([
      [null, "Default (recommended)"], ["haiku", "Haiku 5.5"], ["sonnet", "Sonnet 5.5"],
    ]);
  });

  it("keeps a saved model that isn't in the list, marked", () => {
    const choices = modelChoices(MODELS, "claude-opus-4-1");
    expect(choices.at(-1)).toEqual({
      model: "claude-opus-4-1", label: "claude-opus-4-1 (not in your account's list)", description: "",
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
    });
    expect(modelChoices(MODELS, "haiku")).toHaveLength(3);
  });

  it("keeps the effort when the new model supports it, else back to default", () => {
    const [def, haiku, sonnet] = modelChoices(MODELS, null);
    expect(effortAfterModelChange("high", sonnet)).toBe("high");
    expect(effortAfterModelChange("max", sonnet)).toBeNull();
    expect(effortAfterModelChange("low", haiku)).toBeNull();
    expect(effortAfterModelChange("xhigh", def)).toBe("xhigh");
    expect(effortAfterModelChange("low", undefined)).toBeNull();
  });

  it("shows a saved effort the model doesn't offer, rather than hiding it", () => {
    expect(effortOptions(["low", "high"], "high")).toEqual([{ level: "low", label: "Low" }, { level: "high", label: "High" }]);
    expect(effortOptions(["low", "high"], "max")).toEqual([
      { level: "low", label: "Low" }, { level: "high", label: "High" }, { level: "max", label: "Max (not offered for this model)" },
    ]);
    expect(effortOptions([], "low")).toEqual([{ level: "low", label: "Low (not offered for this model)" }]);
    expect(effortOptions([], null)).toEqual([]);
  });

  it("labels effort levels and summarises a squadmate's model", () => {
    expect(EFFORT_LABELS.xhigh).toBe("Extra high");
    const a = { model: "sonnet", effort: "low" } as Agent;
    expect(modelSummary(a)).toBe("sonnet · low effort");
    expect(modelSummary({ ...a, effort: null })).toBe("sonnet");
    expect(modelSummary({ ...a, model: null, effort: null })).toBe("default model");
    expect(modelSummary({ ...a, model: null, effort: "high" })).toBe("default model · high effort");
  });

  it("stores the model list, keeping it across project switches", () => {
    const s = reduce(emptyState(), { t: "models", models: MODELS });
    expect(s.models).toEqual(MODELS);
    expect(reduce(s, { t: "models", models: null }).models).toBeNull();
  });
});
