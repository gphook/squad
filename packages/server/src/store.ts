import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  FIVE_HOUR_MS, SEVEN_DAY_MS, defaultLayout, normaliseLayout,
  type Activity, type ActivityInput, type Agent, type EffortLevel, type Layout, type LoggedMessage, type PermissionMode, type Project, type SharedFile, type UsageReport,
  type UsageTurnRow,
} from "@squad/shared";

export class StoreError extends Error {}

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, rules TEXT NOT NULL,
  permission_mode TEXT NOT NULL, layout TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, role TEXT NOT NULL, folder TEXT NOT NULL, model TEXT, session_id TEXT, effort TEXT,
  UNIQUE(project_id, name)
);
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, owner_id TEXT, reviewer_ids TEXT NOT NULL, description TEXT NOT NULL, position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender TEXT NOT NULL, recipient TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL, external INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_agent TEXT NOT NULL, recipients TEXT NOT NULL, note TEXT NOT NULL, path TEXT NOT NULL,
  size INTEGER NOT NULL, at INTEGER NOT NULL
);
-- Usage history has no foreign keys: it outlives agent clears and deletes, under snapshot names.
CREATE TABLE IF NOT EXISTS usage_turns (
  id INTEGER PRIMARY KEY, turn_id TEXT NOT NULL, project_id TEXT NOT NULL, agent_id TEXT NOT NULL,
  project_name TEXT NOT NULL, agent_name TEXT NOT NULL, at INTEGER NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_turns_at ON usage_turns(at);
-- The session's cumulative per-model totals at its last turn, to turn the SDK's running totals into per-turn rows.
CREATE TABLE IF NOT EXISTS usage_baselines (
  agent_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, totals TEXT NOT NULL
);`;

type Row = Record<string, unknown>;

const toProject = (r: Row, activities: Activity[]): Project => ({
  id: r.id as string, name: r.name as string, rules: r.rules as string,
  permissionMode: r.permission_mode as PermissionMode, layout: readLayout(r.layout as string), activities,
});
const readLayout = (json: string): Layout => {
  try {
    return normaliseLayout(JSON.parse(json));
  } catch {
    return defaultLayout();
  }
};
const toActivity = (r: Row): Activity => ({
  id: r.id as string, name: r.name as string, ownerId: (r.owner_id as string | null) ?? null,
  reviewerIds: JSON.parse(r.reviewer_ids as string), description: r.description as string,
});
const nameKey = (name: string) => name.trim().toLowerCase();
const toAgent = (r: Row): Agent => ({
  id: r.id as string, projectId: r.project_id as string, name: r.name as string, role: r.role as string,
  folder: r.folder as string, model: (r.model as string | null) ?? null,
  effort: (r.effort as EffortLevel | null) ?? null, sessionId: (r.session_id as string | null) ?? null,
});
const toMessage = (r: Row): LoggedMessage => ({
  id: r.id as string, projectId: r.project_id as string, from: r.sender as string, to: r.recipient as string,
  text: r.text as string, at: Number(r.at), external: Boolean(r.external),
});
const DAY_MS = 86400_000;
const TOKEN_SUMS = `SUM(input_tokens) AS input, SUM(output_tokens) AS output,
  SUM(cache_read_tokens) AS cacheRead, SUM(cache_write_tokens) AS cacheWrite`;
const TOKEN_TOTAL = "SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens)";
/** Each agent's most recent snapshot names. */
const LATEST_NAMES = `names AS (SELECT agent_id, agent_name, project_name FROM usage_turns
  WHERE id IN (SELECT MAX(id) FROM usage_turns GROUP BY agent_id))`;
const LOCAL_DAY = "strftime('%Y-%m-%d', at / 1000, 'unixepoch', 'localtime')";

const toShare = (r: Row): SharedFile => ({
  id: r.id as string, projectId: r.project_id as string, fromAgent: r.from_agent as string,
  to: JSON.parse(r.recipients as string), note: r.note as string, path: r.path as string,
  size: Number(r.size), at: Number(r.at),
});

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Brings a database made by an older Squad up to the current schema, keeping its rows. */
  private migrate(): void {
    const columns = (this.db.prepare("PRAGMA table_info(agents)").all() as Row[]).map((c) => c.name);
    if (!columns.includes("effort")) this.db.exec("ALTER TABLE agents ADD COLUMN effort TEXT");
  }

  listProjects(): Project[] {
    return (this.db.prepare("SELECT * FROM projects ORDER BY name").all() as Row[]).map((r) => toProject(r, this.listActivities(r.id as string)));
  }

  getProject(id: string): Project | null {
    const r = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
    return r ? toProject(r, this.listActivities(id)) : null;
  }

  /** `activities`, when given, replaces the project's list (ids kept where given, order as listed). */
  saveProject(p: {
    id?: string; name: string; rules: string; permissionMode: PermissionMode; activities?: ActivityInput[];
  }): Project {
    return this.transaction(() => {
      const existing = p.id ? this.getProject(p.id) : null;
      let id: string;
      if (existing) {
        id = existing.id;
        this.db.prepare("UPDATE projects SET name = ?, rules = ?, permission_mode = ? WHERE id = ?")
          .run(p.name, p.rules, p.permissionMode, id);
      } else {
        id = p.id ?? randomUUID();
        this.db.prepare("INSERT INTO projects (id, name, rules, permission_mode, layout) VALUES (?, ?, ?, ?, ?)")
          .run(id, p.name, p.rules, p.permissionMode, JSON.stringify(defaultLayout()));
      }
      if (p.activities) this.replaceActivities(id, p.activities);
      return this.getProject(id)!;
    });
  }

  private listActivities(projectId: string): Activity[] {
    return (this.db.prepare("SELECT * FROM activities WHERE project_id = ? ORDER BY position").all(projectId) as Row[]).map(toActivity);
  }

  private replaceActivities(projectId: string, list: ActivityInput[]): void {
    const seen = new Set<string>();
    for (const a of list) {
      const key = nameKey(a.name);
      if (!key) throw new StoreError("Activity names can't be blank");
      if (seen.has(key)) throw new StoreError("Activity name already used in this project");
      seen.add(key);
    }
    const members = new Set(this.listAgents(projectId).map((a) => a.id));
    const current = new Set(this.listActivities(projectId).map((a) => a.id));
    const keep = new Set(list.flatMap((a) => (a.id && current.has(a.id) ? [a.id] : [])));
    for (const old of current) if (!keep.has(old)) this.db.prepare("DELETE FROM activities WHERE id = ?").run(old);
    list.forEach((a, position) => {
      const ownerId = a.ownerId && members.has(a.ownerId) ? a.ownerId : null;
      const reviewerIds = [...new Set(a.reviewerIds)].filter((r) => members.has(r) && r !== ownerId);
      const values = [a.name.trim(), ownerId, JSON.stringify(reviewerIds), a.description.trim(), position];
      if (a.id && keep.has(a.id)) {
        this.db.prepare("UPDATE activities SET name = ?, owner_id = ?, reviewer_ids = ?, description = ?, position = ? WHERE id = ?")
          .run(...values, a.id);
      } else {
        this.db.prepare("INSERT INTO activities (id, project_id, name, owner_id, reviewer_ids, description, position) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(randomUUID(), projectId, ...values);
      }
    });
  }

  /**
   * Makes `agentId` own exactly the listed activities that are unowned or already its own, plus new ones by name
   * (blank or clashing names are skipped). Activities it owned but aren't listed become unowned.
   */
  setOwnership(agentId: string, owns: { activityIds: string[]; newActivities: string[] }): void {
    const agent = this.getAgent(agentId);
    if (!agent) return;
    this.transaction(() => {
      const wanted = new Set(owns.activityIds);
      const list = this.listActivities(agent.projectId);
      const set = this.db.prepare("UPDATE activities SET owner_id = ?, reviewer_ids = ? WHERE id = ?");
      for (const a of list) {
        const claim = wanted.has(a.id) && (a.ownerId === null || a.ownerId === agentId);
        if (claim && a.ownerId !== agentId) set.run(agentId, JSON.stringify(a.reviewerIds.filter((r) => r !== agentId)), a.id);
        if (!claim && a.ownerId === agentId) set.run(null, JSON.stringify(a.reviewerIds), a.id);
      }
      const names = new Set(list.map((a) => nameKey(a.name)));
      let position = list.length;
      for (const raw of owns.newActivities) {
        const key = nameKey(raw);
        // A name that already exists is claimed if nobody owns it, rather than duplicated.
        const match = list.find((a) => nameKey(a.name) === key);
        if (match && match.ownerId === null) set.run(agentId, JSON.stringify(match.reviewerIds.filter((r) => r !== agentId)), match.id);
        if (!key || names.has(key)) continue;
        names.add(key);
        this.db.prepare("INSERT INTO activities (id, project_id, name, owner_id, reviewer_ids, description, position) VALUES (?, ?, ?, ?, '[]', '', ?)")
          .run(randomUUID(), agent.projectId, raw.trim(), agentId, position++);
      }
    });
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  deleteProject(id: string): void {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }

  listAgents(projectId: string): Agent[] {
    return (this.db.prepare("SELECT * FROM agents WHERE project_id = ? ORDER BY rowid").all(projectId) as Row[]).map(toAgent);
  }

  getAgent(id: string): Agent | null {
    const r = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Row | undefined;
    return r ? toAgent(r) : null;
  }

  getAgentByName(projectId: string, name: string): Agent | null {
    const r = this.db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?").get(projectId, name) as Row | undefined;
    return r ? toAgent(r) : null;
  }

  saveAgent(a: {
    id?: string; projectId: string; name: string; role: string; folder: string; model: string | null; effort?: EffortLevel | null;
  }): Agent {
    const clash = this.getAgentByName(a.projectId, a.name);
    if (clash && clash.id !== a.id) throw new StoreError("Agent name already used in this project");
    const existing = a.id ? this.getAgent(a.id) : null;
    if (existing) {
      this.db.prepare("UPDATE agents SET name = ?, role = ?, folder = ?, model = ?, effort = ? WHERE id = ?")
        .run(a.name, a.role, a.folder, a.model, a.effort ?? null, existing.id);
      if (existing.name !== a.name) {
        this.db.prepare("UPDATE shares SET from_agent = ? WHERE project_id = ? AND from_agent = ?")
          .run(a.name, existing.projectId, existing.name);
      }
      return this.getAgent(existing.id)!;
    }
    const id = a.id ?? randomUUID();
    this.db.prepare("INSERT INTO agents (id, project_id, name, role, folder, model, effort) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, a.projectId, a.name, a.role, a.folder, a.model, a.effort ?? null);
    return this.getAgent(id)!;
  }

  setSessionId(agentId: string, sessionId: string | null): void {
    this.db.prepare("UPDATE agents SET session_id = ? WHERE id = ?").run(sessionId, agentId);
  }

  /** Its activities become unowned and it leaves every reviewer list. */
  deleteAgent(id: string): void {
    const agent = this.getAgent(id);
    if (!agent) return;
    this.transaction(() => {
      for (const a of this.listActivities(agent.projectId)) {
        if (a.ownerId !== id && !a.reviewerIds.includes(id)) continue;
        this.db.prepare("UPDATE activities SET owner_id = ?, reviewer_ids = ? WHERE id = ?")
          .run(a.ownerId === id ? null : a.ownerId, JSON.stringify(a.reviewerIds.filter((r) => r !== id)), a.id);
      }
      this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
    });
  }

  saveLayout(projectId: string, layout: Layout): void {
    this.db.prepare("UPDATE projects SET layout = ? WHERE id = ?").run(JSON.stringify(layout), projectId);
  }

  addMessage(m: Omit<LoggedMessage, "id">): LoggedMessage {
    const id = randomUUID();
    this.db.prepare("INSERT INTO messages (id, project_id, sender, recipient, text, at, external) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, m.projectId, m.from, m.to, m.text, m.at, m.external ? 1 : 0);
    return { id, ...m };
  }

  listMessages(projectId: string, limit = 500): LoggedMessage[] {
    const rows = this.db.prepare("SELECT * FROM messages WHERE project_id = ? ORDER BY at DESC LIMIT ?").all(projectId, limit) as Row[];
    return rows.map(toMessage).reverse();
  }

  /** Records a shared file; pass `id` when the file was already named after it. */
  addShare(input: Omit<SharedFile, "id"> & { id?: string }): SharedFile {
    const s: SharedFile = { ...input, id: input.id ?? randomUUID() };
    this.db.prepare("INSERT INTO shares (id, project_id, from_agent, recipients, note, path, size, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(s.id, s.projectId, s.fromAgent, JSON.stringify(s.to), s.note, s.path, s.size, s.at);
    return s;
  }

  listShares(projectId: string): SharedFile[] {
    return (this.db.prepare("SELECT * FROM shares WHERE project_id = ? ORDER BY at").all(projectId) as Row[]).map(toShare);
  }

  removeShare(id: string): SharedFile | null {
    const r = this.db.prepare("SELECT * FROM shares WHERE id = ?").get(id) as Row | undefined;
    if (!r) return null;
    this.db.prepare("DELETE FROM shares WHERE id = ?").run(id);
    return toShare(r);
  }

  sharesFrom(projectId: string, agentName: string): SharedFile[] {
    return (this.db.prepare("SELECT * FROM shares WHERE project_id = ? AND from_agent = ? ORDER BY at").all(projectId, agentName) as Row[]).map(toShare);
  }

  /** Records one agent turn, one row per model, with the agent's and project's current names. */
  addUsageTurn(t: { projectId: string; agentId: string; at: number; rows: UsageTurnRow[] }): void {
    const projectName = this.getProject(t.projectId)?.name ?? "";
    const agentName = this.getAgent(t.agentId)?.name ?? "";
    const turnId = randomUUID();
    const insert = this.db.prepare(`INSERT INTO usage_turns (turn_id, project_id, agent_id, project_name, agent_name, at, model,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of t.rows) {
      insert.run(turnId, t.projectId, t.agentId, projectName, agentName, t.at, r.model, r.input, r.output, r.cacheRead, r.cacheWrite, r.cost);
    }
  }

  getUsageBaseline(agentId: string): { sessionId: string; totals: Record<string, UsageTurnRow> } | null {
    const r = this.db.prepare("SELECT session_id, totals FROM usage_baselines WHERE agent_id = ?").get(agentId) as Row | undefined;
    return r ? { sessionId: r.session_id as string, totals: JSON.parse(r.totals as string) } : null;
  }

  setUsageBaseline(agentId: string, sessionId: string, totals: Record<string, UsageTurnRow>): void {
    this.db.prepare("INSERT OR REPLACE INTO usage_baselines (agent_id, session_id, totals) VALUES (?, ?, ?)")
      .run(agentId, sessionId, JSON.stringify(totals));
  }

  /** Usage over the current 5h/7d windows and the last `days` days; `projectId` null means all projects. */
  usageReport(q: { projectId: string | null; days: number; now: number }): UsageReport {
    const scope = q.projectId === null ? "" : "AND u.project_id = ?";
    const args = (since: number) => (q.projectId === null ? [since] : [since, q.projectId]);
    const all = <T>(sql: string, ...params: (string | number)[]) =>
      (this.db.prepare(sql).all(...params) as Row[]).map((r) => ({ ...r }) as T);

    const since5h = q.now - FIVE_HOUR_MS;
    const agents = all<Row>(`WITH ${LATEST_NAMES}
      SELECT u.agent_id AS agentId, n.agent_name AS agentName, n.project_name AS projectName,
        COUNT(DISTINCT turn_id) AS turns, SUM(cost_usd) AS cost, ${TOKEN_SUMS},
        SUM(CASE WHEN at >= ${since5h} THEN cost_usd ELSE 0 END) AS cost5h
      FROM usage_turns u JOIN names n USING (agent_id)
      WHERE at >= ? ${scope} GROUP BY u.agent_id`, ...args(q.now - SEVEN_DAY_MS));
    // Shares are of all Squad usage, even when the report is scoped to one project.
    const totals = this.db.prepare(`SELECT SUM(cost_usd) AS total7d,
      SUM(CASE WHEN at >= ? THEN cost_usd ELSE 0 END) AS total5h FROM usage_turns WHERE at >= ?`)
      .get(since5h, q.now - SEVEN_DAY_MS) as Row;
    const [total5h, total7d] = [Number(totals.total5h ?? 0), Number(totals.total7d ?? 0)];
    const windows = agents
      .map(({ cost5h, ...a }) => ({
        ...a, share5h: total5h ? Number(cost5h) / total5h : 0, share7d: total7d ? Number(a.cost) / total7d : 0,
      }) as UsageReport["windows"][number])
      .sort((a, b) => b.share7d - a.share7d);

    const since = q.now - q.days * DAY_MS;
    const daily = all<UsageReport["daily"][number]>(`WITH ${LATEST_NAMES}
      SELECT ${LOCAL_DAY} AS day, u.agent_id AS agentId, n.agent_name AS agentName,
        SUM(cost_usd) AS cost, ${TOKEN_TOTAL} AS tokens
      FROM usage_turns u JOIN names n USING (agent_id)
      WHERE at >= ? ${scope} GROUP BY day, u.agent_id ORDER BY day, u.agent_id`, ...args(since));
    const byModel = all<UsageReport["byModel"][number]>(`SELECT model, SUM(cost_usd) AS cost, ${TOKEN_SUMS}
      FROM usage_turns u WHERE at >= ? ${scope} GROUP BY model ORDER BY cost DESC`, ...args(since));
    const top = all<UsageReport["top"][number]>(`SELECT MAX(at) AS at, agent_id AS agentId, agent_name AS agentName,
        project_name AS projectName, SUM(cost_usd) AS cost, ${TOKEN_SUMS},
        (SELECT model FROM usage_turns x WHERE x.turn_id = u.turn_id ORDER BY cost_usd DESC LIMIT 1) AS model
      FROM usage_turns u WHERE at >= ? ${scope} GROUP BY turn_id ORDER BY cost DESC LIMIT 10`, ...args(since));
    return { windows, daily, byModel, top };
  }
}
