import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, mkdirSync } from "node:fs";
import { basename, extname } from "node:path";
import type { WebSocket } from "ws";
import {
  MAX_EVENTS, USAGE_RANGES, errorMessage, normaliseLayout, parseClientMsg, parseSlashCommand, routeCommand,
  type ClientMsg, type ServerMsg, type UsageRange,
} from "@squad/shared";
import type { PluginService } from "./plugins/service.ts";
import { loadHistory } from "./history.ts";
import { shareDir } from "./paths.ts";
import type { PlanUsageTracker } from "./planUsage.ts";
import type { ModelCatalog } from "./models.ts";
import type { AuthTracker } from "./auth.ts";
import type { UpdateInfo, UpdateNotice } from "./updateCheck.ts";
import { resolveInside } from "./safePath.ts";
import { registerSignInRoutes, type SignIn } from "./signin/index.ts";
import type { Store } from "./store.ts";

const run = promisify(execFile);
import type { Supervisor } from "./supervisor.ts";

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".pdf": "application/pdf", ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".json": "application/json", ".html": "text/plain; charset=utf-8",
};

export function buildApp(opts: {
  store: Store; supervisor: Supervisor; signin: SignIn; webDist?: string; plan?: PlanUsageTracker; models?: ModelCatalog; auth?: AuthTracker;
  plugins?: PluginService; update?: UpdateNotice;
}): FastifyInstance {
  const { store, supervisor: sup, signin, plan, models, auth, plugins, update } = opts;
  const app = Fastify();
  app.register(websocket);
  app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } });

  // Host, Origin and session checks on every request (the WebSocket upgrade included), plus /setup and /api/auth/*.
  registerSignInRoutes(app, signin);

  // ---- WebSocket ----
  const sockets = new Map<WebSocket, { projectId: string | null; sessionHash: string | null }>();
  // A revoked session must not keep a live socket: the web client treats 4401 as signed out.
  const closeRevoked = (idHashes: string[]): void => {
    const gone = new Set(idHashes);
    for (const [ws, s] of sockets) if (s.sessionHash && gone.has(s.sessionHash)) ws.close(4401, "Signed out");
  };
  signin.sessions.on("revoked", closeRevoked);
  const signinChanged = (): void => broadcast(null, { t: "signin.changed" });
  signin.changes.on("changed", signinChanged);
  app.addHook("onClose", async () => {
    signin.sessions.off("revoked", closeRevoked);
    signin.changes.off("changed", signinChanged);
  });
  const out = (ws: WebSocket, m: ServerMsg): void => {
    if (ws.readyState === 1) ws.send(JSON.stringify(m));
  };
  const broadcast = (projectId: string | null, m: ServerMsg) => {
    const raw = JSON.stringify(m); // once per message, not per socket
    for (const [ws, s] of sockets) {
      if (ws.readyState === 1 && (projectId === null || s.projectId === projectId)) ws.send(raw);
    }
  };
  const sendProjects = () => broadcast(null, { t: "projects", projects: store.listProjects() });

  sup.on("status", (p, state) => broadcast(p, { t: "agent.status", state }));
  sup.on("event", (p, agentId, event) => broadcast(p, { t: "agent.event", agentId, event }));
  sup.on("commands", (p, agentId, commands) => broadcast(p, { t: "agent.commands", agentId, commands }));
  sup.on("approval", (p, approval) => broadcast(p, { t: "approval.request", approval }));
  sup.on("approvalResolved", (p, approvalId) => broadcast(p, { t: "approval.resolved", approvalId }));
  sup.on("message", (p, message) => broadcast(p, { t: "message.logged", message }));
  sup.on("share", (p, share) => broadcast(p, { t: "share.added", share }));
  sup.on("shareRemoved", (p, shareId) => broadcast(p, { t: "share.removed", shareId }));
  auth?.on("change", (status) => broadcast(null, { t: "auth", status }));
  update?.on("change", (info: UpdateInfo) => broadcast(null, { t: "update", ...info }));
  if (plan) {
    plan.on("change", (p) => broadcast(null, { t: "usage.plan", plan: p }));
    sup.on("rateLimit", (info) => plan.applyRateLimit(info));
    sup.on("turnEnd", () => plan.afterTurn());
  }

  const stateMsg = (projectId: string): ServerMsg => ({
    t: "state", projectId, agents: store.listAgents(projectId), states: sup.states(projectId),
    approvals: sup.pendingApprovals(projectId), messages: store.listMessages(projectId), shares: store.listShares(projectId),
  });

  /** Tells the project's pages which running squadmates need a restart to pick up plugin changes. */
  async function sendRestarts(projectId: string): Promise<void> {
    broadcast(projectId, { t: "plugins.restart", projectId, agents: await sup.pendingRestarts(projectId) });
  }
  sup.on("pluginsChanged", (p: string) => void sendRestarts(p));

  /** Sends a fresh plugins snapshot to every page on `projectId`, or on any project (machine-wide changes). */
  async function refreshPlugins(projectId: string | null): Promise<void> {
    if (!plugins) return;
    const ids = projectId ? [projectId] : [...new Set([...sockets.values()].map((s) => s.projectId).filter((p) => p !== null))];
    await Promise.all(ids.map(async (id) => {
      try {
        broadcast(id, await plugins.snapshot(id));
        await sendRestarts(id);
      } catch (e) {
        // The change itself went through; only the fresh view of it failed.
        broadcast(id, { t: "plugins.error", action: "plugins.get", message: errorMessage(e) });
      }
    }));
  }

  /** The Plugins view's messages. A failure goes back to the page that asked, as `plugins.error`. */
  async function handlePlugins(ws: WebSocket, m: Extract<ClientMsg, { t: `plugins.${string}` | `marketplace.${string}` }>) {
    try {
      if (!plugins) throw new Error("Plugins aren't available.");
      switch (m.t) {
        case "plugins.get":
          plugins.refresh(); // see plugins switched in the terminal
          out(ws, await plugins.snapshot(m.projectId));
          return out(ws, { t: "plugins.restart", projectId: m.projectId, agents: await sup.pendingRestarts(m.projectId) });
        case "plugins.search": {
          const r = await plugins.search(m.query, m.marketplace);
          return out(ws, { t: "plugins.results", query: m.query, marketplace: m.marketplace, ...r });
        }
        case "plugins.details": return out(ws, { t: "plugins.details", details: await plugins.details(m.pluginId) });
        case "plugins.switch":
          await plugins.switch(m.projectId, m.pluginId, m.agentId, m.enabled);
          return refreshPlugins(m.projectId);
        case "plugins.install":
          await plugins.install(m.projectId, m.pluginId, m.agentId);
          return refreshPlugins(null); // other projects' Discover counts change too
        case "plugins.uninstall": await plugins.uninstall(m.pluginId); return refreshPlugins(null);
        case "plugins.update": await plugins.update(m.pluginId); return refreshPlugins(null);
        case "marketplace.add": await plugins.addMarketplace(m.source); return refreshPlugins(null);
        case "marketplace.remove": await plugins.removeMarketplace(m.name); return refreshPlugins(null);
        case "marketplace.update": await plugins.updateMarketplace(m.name); return refreshPlugins(null);
      }
    } catch (e) {
      out(ws, { t: "plugins.error", action: m.t, message: errorMessage(e) });
    }
  }

  async function handle(ws: WebSocket, m: ClientMsg): Promise<void> {
    if (m.t.startsWith("plugins.") || m.t.startsWith("marketplace.")) {
      return handlePlugins(ws, m as Parameters<typeof handlePlugins>[1]);
    }
    switch (m.t) {
      case "subscribe": {
        if (!store.getProject(m.projectId)) return out(ws, { t: "error", message: "Unknown project" });
        sockets.get(ws)!.projectId = m.projectId;
        out(ws, stateMsg(m.projectId));
        for (const a of store.listAgents(m.projectId)) out(ws, { t: "agent.commands", agentId: a.id, commands: sup.commands(a.id) });
        await Promise.all(store.listAgents(m.projectId).map(async (a) => {
          const events = a.sessionId ? await loadHistory(a.sessionId, a.folder) : [];
          // `$ cmd` blocks still running or not yet handed over aren't in the transcript yet.
          const shells = sup.shellSnapshots(a.id);
          if (events.length || shells.length) out(ws, { t: "agent.history", agentId: a.id, events: [...events, ...shells].slice(-MAX_EVENTS) });
        }));
        return;
      }
      case "project.save":
        store.saveProject(m.project);
        return sendProjects();
      case "project.delete":
        for (const a of store.listAgents(m.projectId)) await sup.forget(a.id);
        store.deleteProject(m.projectId);
        return sendProjects();
      case "agent.save": {
        if (m.createFolder) {
          mkdirSync(m.agent.folder, { recursive: true });
          await run("git", ["init", "-q"], { cwd: m.agent.folder });
        }
        const saved = store.saveAgent(m.agent);
        if (m.owns) store.setOwnership(saved.id, m.owns);
        sendProjects(); // ownership and names in activities may have changed
        return broadcast(m.agent.projectId, stateMsg(m.agent.projectId));
      }
      case "agent.delete": {
        const a = store.getAgent(m.agentId);
        if (!a) return;
        await sup.forget(a.id);
        store.deleteAgent(a.id);
        sendProjects(); // its activities are now unowned
        return broadcast(a.projectId, stateMsg(a.projectId));
      }
      case "project.clearAll":
        await sup.clearAll(m.projectId);
        return broadcast(m.projectId, stateMsg(m.projectId)); // empty message log and shares for every page
      case "agent.action":
        return sup.action(m.agentId, m.action);
      case "agent.send": {
        // `/plugin` opens the Plugins view on this page (only), with that squadmate picked.
        const cmd = m.images?.length ? null : parseSlashCommand(m.text);
        if (cmd && routeCommand(cmd.name, []).kind === "plugins") out(ws, { t: "ui.open", view: "plugins", agentId: m.agentId });
        return sup.send(m.agentId, m.text, m.images);
      }
      case "agent.shellKill":
        return sup.killShell(m.agentId, m.id);
      case "auth.check":
        return out(ws, { t: "auth", status: auth ? await auth.refresh() : { state: "unknown" } });
      case "models.get":
        return out(ws, { t: "models", models: models ? await models.get() : null });
      case "approval.answer":
        return sup.answer(m.approvalId, m.decision);
      case "layout.save":
      {
        // Stored and sent back in the shape every page can render (e.g. no maximised tile that isn't open).
        const layout = normaliseLayout(m.layout);
        store.saveLayout(m.projectId, layout);
        return broadcast(m.projectId, { t: "layout", projectId: m.projectId, layout });
      }
      case "share.delete":
        return sup.removeShare(m.shareId);
    }
  }

  app.register(async (scoped) => {
    scoped.get("/ws", { websocket: true }, (ws, req) => {
      sockets.set(ws, { projectId: null, sessionHash: req.session?.idHash ?? null });
      out(ws, { t: "projects", projects: store.listProjects() });
      if (plan?.current) out(ws, { t: "usage.plan", plan: plan.current });
      if (auth?.current) out(ws, { t: "auth", status: auth.current });
      if (update?.current) out(ws, { t: "update", ...update.current });
      if (sockets.size === 1) void auth?.refresh(); // someone may have signed in or out while nobody was looking
      if (sockets.size === 1 && plan) {
        // The limits are only worth polling while someone is looking; the reading may be hours old by now.
        plan.setPolling(true);
        void plan.refresh();
      }
      ws.on("close", () => {
        sockets.delete(ws);
        if (sockets.size === 0) plan?.setPolling(false);
      });
      ws.on("message", async (raw) => {
        const m = parseClientMsg(String(raw));
        if ("error" in m) return out(ws, { t: "error", message: m.error });
        try {
          await handle(ws, m);
        } catch (e) {
          out(ws, { t: "error", message: errorMessage(e) });
        }
      });
    });
  });

  // ---- HTTP ----
  app.get("/api/ping", async () => ({ ok: true }));

  app.get("/api/usage", async (req, reply) => {
    const q = req.query as { projectId?: string; days?: string };
    const days = Number(q.days) as UsageRange;
    if (!USAGE_RANGES.includes(days)) return reply.code(400).send({ error: `days must be one of ${USAGE_RANGES.join(", ")}` });
    void plan?.refresh(); // the page shows the plan windows too: bring them up to date
    return store.usageReport({ projectId: q.projectId || null, days, now: Date.now() });
  });

  app.get("/files", async (req, reply) => {
    const q = req.query as { project?: string; agent?: string; path?: string; download?: string };
    if (!q.project || !q.path) return reply.code(400).send({ error: "project and path required" });
    if (!store.getProject(q.project)) return reply.code(404).send({ error: "Unknown project" });
    const agent = q.agent ? store.getAgent(q.agent) : null;
    const base = agent && agent.projectId === q.project ? agent.folder : shareDir(q.project);
    const real = resolveInside(sup.fileRoots(q.project), q.path, base);
    if (!real) return reply.code(403).send({ error: "Not allowed" });
    reply.type(MIME[extname(real).toLowerCase()] ?? "application/octet-stream");
    reply.header("x-content-type-options", "nosniff");
    // Files come from agents (possibly from the web): never let one run script on the Squad origin.
    reply.header("content-security-policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    if (q.download === "1") reply.header("content-disposition", `attachment; filename="${basename(real).replace(/"/g, "")}"`);
    return reply.send(createReadStream(real));
  });

  app.post("/api/projects/:id/shares", async (req, reply) => {
    const projectId = (req.params as { id: string }).id;
    if (!store.getProject(projectId)) return reply.code(404).send({ error: "Unknown project" });
    let to: string[] = [];
    let note = "";
    let file: { name: string; data: Buffer } | null = null;
    for await (const part of req.parts()) {
      if (part.type === "file") file = { name: part.filename, data: await part.toBuffer() };
      else if (part.fieldname === "to") to = String(part.value).split(",").map((s) => s.trim()).filter(Boolean);
      else if (part.fieldname === "note") note = String(part.value);
    }
    if (!file) return reply.code(400).send({ error: "file required" });
    return sup.shareUpload(projectId, file.name, file.data, to, note);
  });

  if (opts.webDist) app.register(fastifyStatic, { root: opts.webDist });
  return app;
}
