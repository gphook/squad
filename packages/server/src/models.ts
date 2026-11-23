import { EFFORT_LEVELS, type EffortLevel, type ModelOption } from "@squad/shared";
import { withSession, type SessionDeps } from "./sdkSession.ts";

const MODELS_TIMEOUT_MS = 20_000;

/** The SDK's `supportedModels()` entries, keeping what Squad shows and the effort levels it knows. */
export function toModelOptions(raw: unknown): ModelOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m) => {
    if (typeof m?.value !== "string" || typeof m?.displayName !== "string") return [];
    const levels: unknown[] = m.supportsEffort && Array.isArray(m.supportedEffortLevels) ? m.supportedEffortLevels : [];
    return [{
      value: m.value, displayName: m.displayName, description: typeof m.description === "string" ? m.description : "",
      effortLevels: levels.filter((l): l is EffortLevel => (EFFORT_LEVELS as readonly unknown[]).includes(l)),
    }];
  });
}

/** The models the account offers, fetched once and kept; a failed fetch isn't kept, so the next ask retries. */
export class ModelCatalog {
  private models: ModelOption[] | null = null;
  private inFlight: Promise<ModelOption[] | null> | null = null;

  constructor(private deps: SessionDeps) {}

  get(): Promise<ModelOption[] | null> {
    if (this.models) return Promise.resolve(this.models);
    this.inFlight ??= withSession(this.deps, (q) => q.supportedModels(), MODELS_TIMEOUT_MS)
      .then((raw) => (this.models = toModelOptions(raw)))
      .catch(() => null)
      .finally(() => (this.inFlight = null));
    return this.inFlight;
  }
}
