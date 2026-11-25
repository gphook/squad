import type { ElicitationRequest } from "@anthropic-ai/claude-agent-sdk";
import type { ElicitContent, ElicitField, ElicitValue, Elicitation } from "@squad/shared";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const FORMATS = new Set(["email", "uri", "date", "date-time"]);

/** `{const, title}` lists (oneOf / anyOf) or a plain `enum` (with optional `enumNames`) as options. */
function options(s: Obj): { value: string; label: string }[] | undefined {
  const titled = Array.isArray(s.oneOf) ? s.oneOf : Array.isArray(s.anyOf) ? s.anyOf : undefined;
  if (titled) {
    const opts = titled.filter((o): o is Obj => isObj(o) && typeof o.const === "string")
      .map((o) => ({ value: o.const as string, label: str(o.title) || (o.const as string) }));
    return opts.length ? opts : undefined;
  }
  if (Array.isArray(s.enum)) {
    const names = Array.isArray(s.enumNames) ? s.enumNames : [];
    const opts = s.enum.map((v, i) => (typeof v === "string" ? { value: v, label: str(names[i]) || v } : undefined))
      .filter((o) => o !== undefined);
    return opts.length ? opts : undefined;
  }
  return undefined;
}

/** One property of an elicitation's flat schema; undefined when it isn't a kind MCP allows. */
function field(name: string, s: unknown, required: boolean): ElicitField | undefined {
  if (!isObj(s)) return undefined;
  const base = { name, label: str(s.title) || name, description: str(s.description), required };
  if (s.type === "array") {
    const opts = isObj(s.items) ? options(s.items) : undefined;
    if (!opts) return undefined;
    const def = Array.isArray(s.default) ? s.default.filter((v) => typeof v === "string") : undefined;
    return { ...base, type: "multi", options: opts, default: def, min: num(s.minItems), max: num(s.maxItems) };
  }
  if (s.type === "string") {
    const opts = options(s);
    const def = typeof s.default === "string" ? s.default : undefined;
    if (opts) return { ...base, type: "choice", options: opts, default: def };
    const format = FORMATS.has(str(s.format)) ? str(s.format) : undefined;
    return { ...base, type: "string", default: def, format, min: num(s.minLength), max: num(s.maxLength) };
  }
  if (s.type === "number" || s.type === "integer") {
    return { ...base, type: s.type, default: num(s.default), min: num(s.minimum), max: num(s.maximum) };
  }
  if (s.type === "boolean") return { ...base, type: "boolean", default: typeof s.default === "boolean" ? s.default : undefined };
  return undefined;
}

const httpUrl = (u: string | undefined) => {
  try {
    return u && /^https?:$/.test(new URL(u).protocol) ? u : undefined;
  } catch {
    return undefined;
  }
};

/** What the page needs to show an elicitation request. */
export function toElicitation(req: ElicitationRequest): Elicitation {
  const mode = req.mode === "url" ? "url" : "form";
  const schema = isObj(req.requestedSchema) ? req.requestedSchema : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((r) => typeof r === "string") : []);
  const props = isObj(schema.properties) ? schema.properties : {};
  const fields = mode === "form"
    ? Object.entries(props).map(([n, s]) => field(n, s, required.has(n))).filter((f) => f !== undefined)
    : [];
  const e: Elicitation = { serverName: str(req.serverName), message: str(req.message), mode, fields };
  if (mode === "url") e.url = httpUrl(req.url);
  const title = str(req.title) || str(req.displayName);
  if (title) e.title = title;
  return e;
}

function value(f: ElicitField, v: ElicitValue): ElicitValue | undefined {
  const allowed = (s: string) => f.options?.some((o) => o.value === s);
  switch (f.type) {
    case "string": return typeof v === "string" ? v : undefined;
    case "choice": return typeof v === "string" && allowed(v) ? v : undefined;
    case "multi": return Array.isArray(v) ? v.filter(allowed) : undefined;
    case "boolean": return typeof v === "boolean" ? v : undefined;
    case "integer": return typeof v === "number" && Number.isInteger(v) ? v : undefined;
    case "number": return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  }
}

/** The page's answers, kept to the requested fields and their types; undefined when a required field is missing. */
export function cleanContent(fields: ElicitField[], content: ElicitContent | undefined): ElicitContent | undefined {
  const out: ElicitContent = {};
  for (const f of fields) {
    const raw = content?.[f.name];
    const v = raw === undefined ? undefined : value(f, raw);
    const empty = v === undefined || v === "" || (Array.isArray(v) && !v.length);
    if (!empty) out[f.name] = v;
    else if (f.required) return undefined;
  }
  return out;
}
