import { describe, it, expect, beforeEach } from "vitest";
import { ModelCatalog, toModelOptions } from "../src/models.ts";
import { fakeFactory } from "./fakeQuery.ts";

// The shape supportedModels() returned on a real account, trimmed.
const RAW = [
  { value: "default", resolvedModel: "claude-opus-5-5", displayName: "Default (recommended)", description: "Opus 5.5 · Best for everyday, complex tasks",
    supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
  { value: "haiku", displayName: "Haiku 5.5", description: "Fastest for quick answers", supportsEffort: false },
  { value: "odd", displayName: "Odd", description: "", supportsEffort: true, supportedEffortLevels: ["low", "ludicrous"] },
  { displayName: "No value" },
];

describe("toModelOptions", () => {
  it("keeps usable entries with only the effort levels Squad knows", () => {
    expect(toModelOptions(RAW)).toEqual([
      { value: "default", displayName: "Default (recommended)", description: "Opus 5.5 · Best for everyday, complex tasks", effortLevels: ["low", "medium", "high", "xhigh", "max"] },
      { value: "haiku", displayName: "Haiku 5.5", description: "Fastest for quick answers", effortLevels: [] },
      { value: "odd", displayName: "Odd", description: "", effortLevels: ["low"] },
    ]);
    expect(toModelOptions("nope")).toEqual([]);
  });
});

describe("ModelCatalog", () => {
  let f: ReturnType<typeof fakeFactory>;
  let catalog: ModelCatalog;
  beforeEach(() => {
    f = fakeFactory();
    catalog = new ModelCatalog({ queryFactory: f.factory, source: () => null, cwd: "/tmp" });
  });

  it("fetches once for concurrent requests and caches the list", async () => {
    f.models.response = RAW;
    const [a, b] = await Promise.all([catalog.get(), catalog.get()]);
    expect(a).toHaveLength(3);
    expect(b).toBe(a);
    await catalog.get();
    expect(f.models.calls).toBe(1);
    expect(f.queries[0].closed).toBe(true); // the probe session is closed afterwards
  });

  it("treats an empty or unreadable list as a failure, not a list to keep", async () => {
    f.models.response = [{ nothing: true }];
    expect(await catalog.get()).toBeNull();
    f.models.response = RAW;
    expect(await catalog.get()).toHaveLength(3);
  });

  it("answers null on failure and tries again next time", async () => {
    f.models.response = () => Promise.reject(new Error("offline"));
    expect(await catalog.get()).toBeNull();
    f.models.response = RAW;
    expect(await catalog.get()).toHaveLength(3);
    expect(f.models.calls).toBe(2);
  });
});
