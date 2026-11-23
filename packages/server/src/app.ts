import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, mkdirSync } from "node:fs";
import { basename, extname } from "node:path";
import type { WebSocket } from "ws";
import {
  MAX_EVENTS, USAGE_RANGES, errorMessage, parseClientMsg, type ClientMsg, type ServerMsg, type UsageRange,
} from "@squad/shared";
import { loadHistory } from "./history.ts";
import { shareDir } from "./paths.ts";
import type { PlanUsageTracker } from "./planUsage.ts";
import { resolveInside } from "./safePath.ts";
import type { Store } from "./store.ts";

const run = promisify(execFile);
import type { Supervisor } from "./supervisor.ts";

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".pdf": "application/pdf", ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".json": "application/json", ".html": "text/plain; charset=utf-8",
};

function cookieKey(req: FastifyRequest): string | undefined {
  const header = req.headers.cookie ?? "";
  return /(?:^|;\s*)squad_key=([^;]+)/.exec(header)?.[1];
}

export function buildApp(opts: {
  store: Store; supervisor: Supervisor; key: string; webDist?: string; plan?: PlanUsageTracker;
}): FastifyInstance {
  const { store, supervisor: sup, key, plan } = opts;
  const app = Fastify();
  app.register(websocket);
  app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } });

  app.addHook("onRequest", async (req, reply) => {
    const q = (req.query as Record<string, string | undefined>).key;
    if (q === key) {
      reply.header("set-cookie", `squad_key=${key}; HttpOnly; SameSite=Strict; Path=/`);
      return;
    }
    if (cookieKey(req) !== key) return reply.code(401).send({ error: "Missing or wrong session key" });
  });

  // ---- WebSocket ----
  const sockets = new Map<WebSocket, { projectId: string | null }>();
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
  sup.on("approval", (p, approval) => broadcast(p, { t: "approval.request", approval }));
  sup.on("approvalResolved", (p, approvalId) => broadcast(p, { t: "approval.resolved", approvalId }));
  sup.on("message", (p, message) => broadcast(p, { t: "message.logged", message }));
  sup.on("share", (p, share) => broadcast(p, { t: "share.added", share }));
  sup.on("shareRemoved", (p, shareId) => broadcast(p, { t: "share.removed", shareId }));
  if (plan) {
    plan.on("change", (p) => broadcast(null, { t: "usage.plan", plan: p }));
    sup.on("rateLimit", (info) => plan.applyRateLimit(info));
    sup.on("turnEnd", () => plan.afterTurn());
  }

  const stateMsg = (projectId: string): ServerMsg => ({
    t: "state", projectId, agents: store.listAgents(projectId), states: sup.states(projectId),
    approvals: sup.pendingApprovals(projectId), messages: store.listMessages(projectId), shares: store.listShares(projectId),
  });

  async function handle(ws: WebSocket, m: ClientMsg): Promise<void> {
    switch (m.t) {
      case "subscribe": {
        if (!store.getProject(m.projectId)) return out(ws, { t: "error", message: "Unknown project" });
        sockets.get(ws)!.projectId = m.projectId;
        out(ws, stateMsg(m.projectId));
        await Promise.all(store.listAgents(m.projectId).filter((a) => a.sessionId).map(async (a) => {
          const events = await loadHistory(a.sessionId!, a.folder);
          out(ws, { t: "agent.history", agentId: a.id, events: events.slice(-MAX_EVENTS) });
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
        store.saveAgent(m.agent);
        return broadcast(m.agent.projectId, stateMsg(m.agent.projectId));
      }
      case "agent.delete": {
        const a = store.getAgent(m.agentId);
        if (!a) return;
        await sup.forget(a.id);
        store.deleteAgent(a.id);
        return broadcast(a.projectId, stateMsg(a.projectId));
      }
      case "agent.action":
        return sup.action(m.agentId, m.action);
      case "agent.send":
        return sup.send(m.agentId, m.text, m.images);
      case "agent.shellKill":
        return sup.killShell(m.agentId, m.id);
      case "approval.answer":
        return sup.answer(m.approvalId, m.decision);
      case "layout.save":
        store.saveLayout(m.projectId, m.layout);
        return broadcast(m.projectId, { t: "layout", projectId: m.projectId, layout: m.layout });
      case "share.delete":
        return sup.removeShare(m.shareId);
    }
  }

  app.register(async (scoped) => {
    scoped.get("/ws", {
      websocket: true,
      preValidation: async (req, reply) => {
        const origin = req.headers.origin;
        const host = req.headers.host;
        if (origin && (!host || new URL(origin).host !== host)) return reply.code(403).send({ error: "Bad origin" });
      },
    }, (ws) => {
      sockets.set(ws, { projectId: null });
      out(ws, { t: "projects", projects: store.listProjects() });
      if (plan?.current) out(ws, { t: "usage.plan", plan: plan.current });
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
