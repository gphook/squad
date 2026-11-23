import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashContextBlock, type Agent, type AgentEvent, type AuthStatus, type Project } from "@squad/shared";
import { Store } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { squadToolHandlers } from "../src/squadTools.ts";
import { fakeFactory, tick } from "./fakeQuery.ts";
import fixture from "./fixtures/usage-messages.json" with { type: "json" };

let store: Store, sup: Supervisor, f: ReturnType<typeof fakeFactory>;
let project: Project, other: Project, a: Agent, b: Agent, x: Agent;
const folder = () => mkdtempSync(join(tmpdir(), "squad-agent-"));

beforeEach(() => {
  process.env.SQUAD_HOME = mkdtempSync(join(tmpdir(), "squad-home-"));
  store = new Store(join(process.env.SQUAD_HOME, "squad.db"));
  f = fakeFactory();
  sup = new Supervisor(store, f.factory, "/kit");
  project = store.saveProject({ name: "P", rules: "", permissionMode: "default" });
  other = store.saveProject({ name: "O", rules: "", permissionMode: "default" });
  a = store.saveAgent({ projectId: project.id, name: "starfade", role: "code", folder: folder(), model: null });
  b = store.saveAgent({ projectId: project.id, name: "sf-modeller", role: "models", folder: folder(), model: null });
  x = store.saveAgent({ projectId: other.id, name: "outsider", role: "x", folder: folder(), model: null });
});

const tools = (name = "starfade") => squadToolHandlers(sup, project.id, () => name);

describe("squad_summon", () => {
  it("rejects an unknown agent without launching anything", async () => {
    expect(await tools().summon({ agent: "nobody" })).toBe("No agent named nobody in this project");
    expect(f.queries).toHaveLength(0);
  });
  it("rejects summoning yourself", async () => {
    expect(await tools().summon({ agent: "starfade" })).toBe("You are starfade");
  });
  it("cannot reach an agent in another project", async () => {
    expect(await tools().summon({ agent: "outsider" })).toBe("No agent named outsider in this project");
    expect(f.queries).toHaveLength(0);
  });
  it("launches a stopped agent and reports it running", async () => {
    const res = tools().summon({ agent: "sf-modeller" });
    await tick();
    f.queries[0].emit({ type: "system", subtype: "init", session_id: "s" });
    expect(await res).toBe('sf-modeller is running; message it with SendMessage to "sf-modeller"');
    expect(f.queries[0].options.cwd).toBe(b.folder);
  });
  it("does nothing for an agent already running", async () => {
    await sup.action(b.id, "launch");
    expect(await tools().summon({ agent: "sf-modeller" })).toBe("sf-modeller is already running (starting)");
    expect(f.queries).toHaveLength(1);
  });
});

describe("session ids", () => {
  it("stores the session id from init and resumes it next launch", async () => {
    await sup.action(a.id, "launch");
    f.queries[0].emit({ type: "system", subtype: "init", session_id: "s-123" });
    await tick();
    expect(store.getAgent(a.id)!.sessionId).toBe("s-123");
    await sup.action(a.id, "stop");
    await sup.action(a.id, "launch");
    expect(f.queries[1].options.resume).toBe("s-123");
  });
});

describe("message log", () => {
  it("logs SendMessage between agents and gives the recipient a peer_in event", async () => {
    const events: any[] = [];
    sup.on("event", (_p, agentId, ev) => events.push({ agentId, ev }));
    await sup.action(a.id, "launch");
    f.queries[0].emit({ type: "assistant", message: { content: [
      { type: "tool_use", id: "t", name: "SendMessage", input: { to: "sf-modeller", message: "build a ship" } },
    ] } });
    await tick();
    expect(store.listMessages(project.id)).toMatchObject([{ from: "starfade", to: "sf-modeller", text: "build a ship", external: false }]);
    expect(events).toContainEqual({ agentId: b.id, ev: { kind: "peer_in", from: "starfade", text: "build a ship" } });
  });
  it("logs a peer_in from an outside session as external", async () => {
    await sup.action(a.id, "launch");
    f.queries[0].emit({ type: "user", message: { content: '<cross-session-message from-name="me">hi</cross-session-message>' } });
    await tick();
    expect(store.listMessages(project.id)).toMatchObject([{ from: "me", to: "starfade", external: true }]);
  });
});

describe("shares", () => {
  it("squad_share with text writes a markdown file in the share folder", async () => {
    const res = await tools().share({ text: "# Spec", to: ["sf-modeller"], note: "ship spec" });
    const s = store.listShares(project.id)[0];
    expect(res).toContain(s.path);
    expect(s.path.endsWith(".md")).toBe(true);
    expect(readFileSync(s.path, "utf8")).toBe("# Spec");
    expect(s).toMatchObject({ fromAgent: "starfade", to: ["sf-modeller"], note: "ship spec", size: 6 });
  });
  it("squad_share copies a file from the caller's folder", async () => {
    writeFileSync(join(a.folder, "a.png"), "png!");
    await tools().share({ path: "a.png", to: ["sf-modeller"], note: "" });
    const s = store.listShares(project.id)[0];
    expect(readFileSync(s.path, "utf8")).toBe("png!");
    expect(s.path.endsWith("-a.png")).toBe(true);
  });
  it("squad_share refuses a path outside the caller's folder", async () => {
    expect(await tools().share({ path: b.folder, to: [], note: "" })).toBe("Path not allowed");
  });
  it("clear deletes the files the agent shared but not files shared to it", async () => {
    await tools("starfade").share({ text: "mine", to: ["sf-modeller"], note: "" });
    await tools("sf-modeller").share({ text: "theirs", to: ["starfade"], note: "" });
    const [mine, theirs] = store.listShares(project.id);
    store.setSessionId(a.id, "s1");
    await sup.action(a.id, "clear");
    expect(existsSync(mine.path)).toBe(false);
    expect(existsSync(theirs.path)).toBe(true);
    expect(store.listShares(project.id).map((s) => s.id)).toEqual([theirs.id]);
    expect(store.getAgent(a.id)!.sessionId).toBeNull();
  });
});

describe("renaming an agent", () => {
  it("uses the new name for squad_share, the message log and clear", async () => {
    await sup.action(a.id, "launch");
    store.saveAgent({ id: a.id, projectId: project.id, name: "game", role: "code", folder: a.folder, model: null });
    writeFileSync(join(a.folder, "spec.md"), "s");
    const t = squadToolHandlers(sup, project.id, () => store.getAgent(a.id)!.name);
    expect(await t.share({ path: "spec.md", to: [], note: "" })).toContain("Shared as");
    f.queries[0].emit({ type: "assistant", message: { content: [
      { type: "tool_use", id: "t", name: "SendMessage", input: { to: "sf-modeller", message: "hi" } },
    ] } });
    await tick();
    expect(store.listMessages(project.id)[0].from).toBe("game");
    await sup.action(a.id, "clear");
    expect(store.listShares(project.id)).toEqual([]);
  });
});

describe("squad_team and squad_show", () => {
  it("squad_team lists what each squadmate owns", async () => {
    store.saveProject({ ...project, activities: [{ name: "Game code", ownerId: a.id, reviewerIds: [], description: "" }] });
    const team = await tools().team();
    expect(team).toMatch(/- starfade \(you\): code — owns: Game code — stopped/);
    expect(team).toMatch(/- sf-modeller: models — stopped/);
  });
  it("lists the team with status", async () => {
    expect(await tools().team()).toBe("- starfade (you): code — stopped\n- sf-modeller: models — stopped");
  });
  it("accepts an http URL or a local file and rejects others", async () => {
    writeFileSync(join(a.folder, "c.png"), "x");
    expect(await tools().show({ target: "https://e.com/a.png" })).toBe("shown");
    expect(await tools().show({ target: "c.png" })).toBe("shown");
    expect(await tools().show({ target: "/etc/passwd" })).toBe("Path not allowed");
  });
});

describe("usage recording", () => {
  const [r0, r1] = fixture.results;
  const result = (r: any, sid: string) => ({ ...r, session_id: sid });
  const now = Date.now();
  const rows = () => store.usageReport({ projectId: project.id, days: 7, now: now + 60_000 }).top;

  it("stores per-turn rows across a resume without counting the session twice", async () => {
    const turnEnds: number[] = [];
    sup.on("turnEnd", () => turnEnds.push(1));
    await sup.action(a.id, "launch");
    f.queries[0].emit({ type: "system", subtype: "init", session_id: "s1" });
    f.queries[0].emit(result(r0, "s1"));
    f.queries[0].emit(result(r1, "s1"));
    await tick();
    await sup.action(a.id, "stop");
    await sup.action(a.id, "launch");
    f.queries[1].emit(result(fixture.resumedResult, "s1"));
    await tick();
    const opusOutputs = rows().map((t) => t.output).sort((x, y) => x - y);
    expect(opusOutputs).toEqual([3, 18, 63]); // turn 1 (4 opus + 14 haiku), turn 2, resumed turn
    expect(turnEnds).toHaveLength(3);
  });

  it("records nothing for the first turn of a resumed session it has no baseline for", async () => {
    store.setSessionId(a.id, "pre-existing");
    await sup.action(a.id, "launch");
    f.queries[0].emit(result(r1, "pre-existing"));
    await tick();
    expect(rows()).toEqual([]);
    f.queries[0].emit(result(fixture.resumedResult, "pre-existing"));
    await tick();
    expect(rows().map((t) => t.output)).toEqual([3]);
  });

  it("forwards rate limits and exposes a running agent's query as the usage source", async () => {
    const seen: unknown[] = [];
    sup.on("rateLimit", (i) => seen.push(i));
    expect(sup.usageSource()).toBeNull();
    await sup.action(a.id, "launch");
    expect(sup.usageSource()).not.toBeNull();
    f.queries[0].emit({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } });
    await tick();
    expect(seen).toEqual([{ status: "allowed" }]);
  });
});

describe("usage recording failures", () => {
  it("a usage recording error does not take the agent down", async () => {
    store.addUsageTurn = () => { throw new Error("disk full"); };
    await sup.action(a.id, "launch");
    f.queries[0].emit({ type: "system", subtype: "init", session_id: "s1" });
    f.queries[0].emit({ ...fixture.results[0], session_id: "s1" });
    f.queries[0].emit({ type: "rate_limit_event", rate_limit_info: undefined });
    await tick();
    expect(sup.states(project.id).find((s) => s.agentId === a.id)?.status).toBe("idle");
  });
});

describe("$ cmd output", () => {
  const ended = (agentId: string) => new Promise<AgentEvent>((resolve) => {
    const on = (_p: string, id: string, ev: AgentEvent) => {
      if (id === agentId && ev.kind === "shell_end") { sup.off("event", on); resolve(ev); }
    };
    sup.on("event", on);
  });
  const block = bashContextBlock({ command: "printf a", stdout: "a", stderr: "", code: 0, signal: null });

  it("goes into a summoned squadmate's launch prompt, and not again with the next message", async () => {
    const done = ended(b.id);
    await sup.send(b.id, "$ printf a");
    await done;
    const res = tools().summon({ agent: "sf-modeller" });
    await tick();
    expect(f.queries[0].options.systemPrompt.append).toContain(block);
    f.queries[0].emit({ type: "system", subtype: "init", session_id: "s" });
    await res;
    await sup.send(b.id, "hi");
    await tick();
    expect(f.queries[0].inputs.at(-1).message.content).toBe("hi");
  });

  it("is dropped by clear", async () => {
    const done = ended(a.id);
    await sup.send(a.id, "$ printf a");
    await done;
    await sup.action(a.id, "clear");
    await sup.send(a.id, "hi");
    await tick();
    expect(f.queries[0].inputs.at(-1).message.content).toBe("hi");
  });

  it("clear kills a running command and its output never reaches the fresh session", async () => {
    const done = ended(a.id);
    await sup.send(a.id, "$ sleep 30; echo late");
    await sup.action(a.id, "clear");
    expect(await done).toMatchObject({ signal: "SIGTERM" });
    await sup.send(a.id, "hi");
    await tick();
    expect(f.queries[0].inputs.at(-1).message.content).toBe("hi");
  });

  it("stopAll kills running commands at once", async () => {
    const done = ended(a.id);
    await sup.send(a.id, "$ trap '' TERM; sleep 30");
    await sup.stopAll();
    expect(await done).toMatchObject({ signal: "SIGKILL" });
  });

  it("kills a running command by id, and when the squadmate is deleted", async () => {
    const shells: string[] = [];
    sup.on("event", (_p: string, _id: string, ev: AgentEvent) => { if (ev.kind === "shell") shells.push(ev.id); });
    let done = ended(a.id);
    await sup.send(a.id, "$ sleep 30");
    sup.killShell(a.id, shells[0]);
    expect(await done).toMatchObject({ signal: "SIGTERM" });
    done = ended(a.id);
    await sup.send(a.id, "$ sleep 30");
    await sup.forget(a.id);
    expect(await done).toMatchObject({ signal: "SIGTERM" });
  });
});

describe("signed out", () => {
  const MSG = "Not signed in to Claude: click the account in the top bar";
  const authWith = (state: "signedIn" | "signedOut" | "unknown") => {
    const auth = { current: { state } as AuthStatus, refreshes: 0, refresh: async () => { auth.refreshes++; return auth.current; } };
    sup.setAuth(auth);
    return auth;
  };

  it("refuses to launch, with a clear message and no session", async () => {
    authWith("signedOut");
    await sup.action(a.id, "launch");
    expect(sup.runner(a.id).state).toMatchObject({ status: "error", error: MSG });
    await sup.send(a.id, "hi");
    expect(f.queries).toHaveLength(0);
  });

  it("checks again before refusing, so signing in elsewhere isn't met with a stale refusal", async () => {
    const auth = authWith("signedOut");
    auth.refresh = async () => {
      auth.refreshes++;
      await tick(); // the CLI takes a moment
      auth.current = { state: "signedIn" };
      return auth.current;
    };
    await sup.action(a.id, "launch");
    expect(f.queries).toHaveLength(1);
    expect(sup.runner(a.id).state.status).toBe("starting");
  });

  it("starts one session when launch is pressed twice during that check", async () => {
    const auth = authWith("signedOut");
    auth.refresh = async () => { await tick(); auth.current = { state: "signedIn" }; return auth.current; };
    await Promise.all([sup.action(a.id, "launch"), sup.action(a.id, "launch")]);
    expect(f.queries).toHaveLength(1);
  });

  it("launches when the account state is unknown", async () => {
    authWith("unknown");
    await sup.action(a.id, "launch");
    expect(f.queries).toHaveLength(1);
  });

  it("checks the account again when a squadmate fails to start", async () => {
    const auth = authWith("signedIn");
    await sup.action(a.id, "launch");
    f.queries[0].end(); // the session dies before it's ready
    await tick(); await tick();
    expect(sup.runner(a.id).state.status).toBe("error");
    expect(auth.refreshes).toBe(1);
  });
});
