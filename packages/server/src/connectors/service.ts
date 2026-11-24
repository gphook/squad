import { EventEmitter } from "node:events";
import { spawn as nodeSpawn } from "node:child_process";
import {
  connectorHostError, normaliseHost,
  type Connector, type ConnectorLogin, type ConnectorTemplateId, type ConnectorView,
} from "@squad/shared";
import type { LoginChild } from "../claudeLogin.ts";
import type { Store } from "../store.ts";
import { lastLine } from "./exec.ts";
import { sourceHost, type ConnectorTemplate } from "./template.ts";

const TIMEOUT_MS = 10 * 60_000;

type ConnectorStore = Pick<Store,
  "listConnectors" | "addConnector" | "renameConnector" | "removeConnector" | "connectorsSeeded" | "markConnectorsSeeded">;

export interface ConnectorServiceDeps {
  store: ConnectorStore;
  templates: Record<ConnectorTemplateId, ConnectorTemplate>;
  spawn?: (bin: string, args: string[], env: NodeJS.ProcessEnv) => LoginChild;
  timeoutMs?: number;
}

function defaultSpawn(bin: string, args: string[], env: NodeJS.ProcessEnv): LoginChild {
  const child = nodeSpawn(bin, args, { stdio: "pipe", env });
  child.stdin.on("error", () => {});
  return child;
}

/**
 * The user's connectors, who each is signed in as, and the one sign-in Squad runs at a time.
 * Events: "connectors"(ConnectorView[]), "login"(ConnectorLogin).
 */
export class ConnectorService extends EventEmitter {
  private views: ConnectorView[] = [];
  private state: ConnectorLogin = { phase: "idle" };
  private child: LoginChild | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by every start and stop, so a finished flow can tell it's been superseded. */
  private flow = 0;
  private readonly spawnChild: NonNullable<ConnectorServiceDeps["spawn"]>;

  constructor(private deps: ConnectorServiceDeps) {
    super();
    this.spawnChild = deps.spawn ?? defaultSpawn;
  }

  get list(): ConnectorView[] {
    return this.views;
  }

  get login(): ConnectorLogin {
    return this.state;
  }

  /** On first run, adds a connector for each host gh/glab are already signed in to; then checks them all. */
  async init(): Promise<void> {
    const { store, templates } = this.deps;
    if (!store.connectorsSeeded()) {
      for (const t of Object.values(templates)) {
        for (const a of await t.accounts().catch(() => [])) {
          if (store.listConnectors().some((c) => c.host === a.host)) continue;
          store.addConnector({ template: t.id, name: this.defaultName(t, a.host), host: a.host });
        }
      }
      store.markConnectorsSeeded();
    }
    await this.refresh();
  }

  /** Rechecks every connector against its CLI and broadcasts the list. */
  async refresh(): Promise<ConnectorView[]> {
    const status = new Map<ConnectorTemplateId, { available: boolean; accounts: Map<string, string> }>();
    for (const t of Object.values(this.deps.templates)) {
      const available = await t.available().catch(() => false);
      const accounts = available ? await t.accounts().catch(() => []) : [];
      status.set(t.id, { available, accounts: new Map(accounts.map((a) => [a.host, a.user])) });
    }
    this.views = this.deps.store.listConnectors().map((c): ConnectorView => {
      const s = status.get(c.template);
      if (!s?.available) return { ...c, state: "missing-cli" };
      const user = s.accounts.get(c.host);
      return user ? { ...c, state: "signed-in", user } : { ...c, state: "signed-out" };
    });
    this.emit("connectors", this.views);
    return this.views;
  }

  async add(template: ConnectorTemplateId, name: string, host: string): Promise<Connector> {
    const error = connectorHostError(host);
    if (error) throw new Error(error);
    const h = normaliseHost(host);
    const t = this.deps.templates[template];
    const made = this.deps.store.addConnector({ template, name: name.trim() || this.defaultName(t, h), host: h });
    await this.refresh();
    return made;
  }

  async rename(id: string, name: string): Promise<void> {
    const c = this.find(id);
    this.deps.store.renameConnector(id, name.trim() || this.deps.templates[c.template].label);
    await this.refresh();
  }

  /** Removes a connector, stopping its sign-in; `signOut` also signs its CLI out of the host. */
  async remove(id: string, signOut: boolean): Promise<void> {
    const c = this.find(id);
    if ("id" in this.state && this.state.id === id) this.cancel();
    this.deps.store.removeConnector(id);
    try {
      if (signOut) await this.deps.templates[c.template].signOut(c.host);
    } finally {
      await this.refresh();
    }
  }

  async signOut(id: string): Promise<void> {
    const c = this.find(id);
    if ("id" in this.state && this.state.id === id) this.cancel();
    try {
      await this.deps.templates[c.template].signOut(c.host);
    } finally {
      await this.refresh();
    }
  }

  async startLogin(id: string): Promise<void> {
    this.stop();
    const c = this.find(id);
    const t = this.deps.templates[c.template];
    if (!(await t.available().catch(() => false))) {
      return this.set({ phase: "failed", id, message: `Install ${t.cli.label} first.` });
    }
    const plan = t.signInPlan(c.host);
    if (plan.kind === "token") return this.set({ phase: "token", id, tokenUrl: plan.tokenUrl });

    const flow = ++this.flow;
    const mine = () => this.flow === flow;
    let child: LoginChild;
    try {
      child = this.spawnChild(t.cli.bin, plan.args, plan.env);
    } catch (err) {
      return this.set({ phase: "failed", id, message: `Couldn't run ${t.cli.bin}: ${(err as Error).message}` });
    }
    this.child = child;
    this.set({ phase: "starting", id });
    let output = "";
    const read = (chunk: Buffer | string) => {
      if (!mine()) return;
      output += chunk.toString();
      const found = this.state.phase === "starting" ? t.parseDevice(output) : null;
      if (found) this.set({ phase: "waiting", id, ...found });
    };
    // stdin stays open: with it closed, gh prints nothing.
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", (err) => {
      if (!mine()) return;
      this.stop();
      this.set({ phase: "failed", id, message: `Couldn't run ${t.cli.bin}: ${err.message}` });
    });
    child.on("exit", (code) => {
      if (!mine()) return;
      this.stop();
      if (code !== 0) {
        this.set({ phase: "failed", id, message: lastLine(output) || `Sign-in didn't finish (exit code ${code}).` });
        void this.refresh();
        return;
      }
      this.set({ phase: "verifying", id });
      const after = this.flow;
      void t.afterSignIn(c.host)
        .then(() => this.refresh())
        .then(() => { if (this.flow === after) this.set({ phase: "idle" }); })
        .catch((err: Error) => { if (this.flow === after) this.set({ phase: "failed", id, message: err.message }); });
    });
    this.timer = setTimeout(() => {
      if (!mine()) return;
      this.stop();
      this.set({ phase: "failed", id, message: "Sign-in timed out. Try again." });
    }, this.deps.timeoutMs ?? TIMEOUT_MS);
  }

  /** Hands a pasted access token to the waiting token sign-in's CLI. */
  async submitToken(token: string): Promise<void> {
    const s = this.state;
    if (s.phase !== "token") return;
    const c = this.find(s.id);
    const t = this.deps.templates[c.template];
    if (!t.tokenSignIn) return;
    const flow = ++this.flow;
    this.set({ phase: "verifying", id: s.id });
    try {
      await t.tokenSignIn(c.host, token);
      await this.refresh();
      if (this.flow === flow) this.set({ phase: "idle" });
    } catch (err) {
      if (this.flow === flow) this.set({ phase: "token", id: s.id, tokenUrl: s.tokenUrl, error: (err as Error).message });
    }
  }

  /** Stops a running sign-in, or dismisses a failed one. */
  cancel(): void {
    if (this.state.phase === "idle") return;
    this.stop();
    this.set({ phase: "idle" });
  }

  /** What to tell the user when a marketplace from `source` failed to authenticate; null when a connector can't help. */
  hintFor(source: string): string | null {
    const host = sourceHost(source);
    if (!host) return null;
    const c = this.views.find((v) => v.host === host);
    if (!c) return `Add a GitHub or GitLab connector for ${host} under Connectors, then try again.`;
    if (c.state === "signed-in") return null;
    return `Sign in to ${c.name} (${host}) under Connectors, then try again.`;
  }

  private find(id: string): Connector {
    const c = this.deps.store.listConnectors().find((x) => x.id === id);
    if (!c) throw new Error("That connector no longer exists.");
    return c;
  }

  private defaultName(t: ConnectorTemplate, host: string): string {
    return this.deps.store.listConnectors().some((c) => c.name === t.label) ? host : t.label;
  }

  private stop(): void {
    this.flow++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const child = this.child;
    this.child = null;
    child?.kill();
  }

  private set(next: ConnectorLogin): void {
    this.state = next;
    this.emit("login", next);
  }
}
