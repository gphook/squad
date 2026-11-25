import { describe, it, expect } from "vitest";
import { cleanContent, toElicitation } from "../src/elicitation.ts";

describe("toElicitation", () => {
  it("reads every MCP field kind and skips the rest", () => {
    const e = toElicitation({
      serverName: "s", message: "m", requestedSchema: {
        type: "object", required: ["email"],
        properties: {
          email: { type: "string", title: "Email", format: "email", maxLength: 80 },
          size: { type: "string", oneOf: [{ const: "s", title: "Small" }, { const: "l", title: "Large" }] },
          colour: { type: "string", enum: ["r", "g"], enumNames: ["Red"] },
          tags: { type: "array", items: { enum: ["a", "b"] }, minItems: 1 },
          count: { type: "integer", minimum: 1, default: 2 },
          ok: { type: "boolean", default: true },
          nested: { type: "object" },
        },
      },
    });
    expect(e.mode).toBe("form");
    expect(e.fields.map((f) => [f.name, f.type])).toEqual([
      ["email", "string"], ["size", "choice"], ["colour", "choice"], ["tags", "multi"], ["count", "integer"], ["ok", "boolean"],
    ]);
    expect(e.fields[0]).toMatchObject({ label: "Email", required: true, format: "email", max: 80 });
    expect(e.fields[1].options).toEqual([{ value: "s", label: "Small" }, { value: "l", label: "Large" }]);
    expect(e.fields[2].options).toEqual([{ value: "r", label: "Red" }, { value: "g", label: "g" }]);
    expect(e.fields[4]).toMatchObject({ default: 2, min: 1 });
  });
});

describe("cleanContent", () => {
  const { fields } = toElicitation({
    serverName: "s", message: "m", requestedSchema: {
      type: "object", required: ["n"],
      properties: { n: { type: "integer" }, t: { type: "array", items: { enum: ["a", "b"] } }, s: { type: "string" } },
    },
  });
  it("keeps valid values, drops unknown fields and options", () => {
    expect(cleanContent(fields, { n: 3, t: ["a", "z"], s: "", x: "y" })).toEqual({ n: 3, t: ["a"] });
  });
  it("is undefined when a required field is missing or the wrong type", () => {
    expect(cleanContent(fields, { n: 1.5 })).toBeUndefined();
    expect(cleanContent(fields, {})).toBeUndefined();
  });
});
