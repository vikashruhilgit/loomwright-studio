// The console's session-control part (phase 5 item 04): `POST
// /sessions/:id/stop` (graceful) and `POST /sessions/:id/kill` (immediate),
// through a real `startApiServer` and a real `SessionManager` over the fake
// spawner/query of session-fakes.ts, a fake process table for the tools'
// groups (H08) and an injected scheduler that holds the stop grace until the
// test releases it. Never the real SDK, a model, `ps` or a real signal: every
// pid is above any real pid_max. The route is pinned against the app contract
// here (`console-contract.test.ts` leaves each phase 5 item's routes to it):
// `app/src/api/contract.ts` is read as text, never imported.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startApiServer } from "../src/api/index.js";
import type { ApiServer, ApiServerOptions } from "../src/api/index.js";
import { SESSION_STOP_REQUESTED, controlPart } from "../src/console/control.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import type { ContributedRouteRequest } from "../src/features/index.js";
import { SessionError, SessionManager } from "../src/sessions/index.js";
import type { CancelTimer, GroupLeader, ProcessEntry, SessionHandle, SessionManagerDeps, SessionRow } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { fakeMsg, fakeSessions, flush, immediate, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

const TOKEN = "c".repeat(64);
const NOW = new Date("2026-10-21T09:00:00.000Z");
/** The stop grace: its timer is held by the scheduler until the test fires it (a kill must never need it). */
const GRACE_MS = 3_600_000;
const CLI_PATH = "/opt/sdk/claude";
const T0 = Date.UTC(2026, 9, 21, 8, 0, 0);
const T1 = T0 + 5_000;
/** The Bash tool's group: a shell in a new session and group, running `sleep`. */
const SHELL = 3_100_000_001;
const SLEEP = 3_100_000_002;

const CONTRACT = new URL("../../app/src/api/contract.ts", import.meta.url);
const contractText = readFileSync(CONTRACT, "utf8");

let tmp: string;
let pluginDir: string;
const stores: Store[] = [];
const servers: ApiServer[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-console-control-"));
  pluginDir = makePluginDir(tmp);
});

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

interface Harness {
  readonly store: Store;
  readonly manager: SessionManager;
  readonly fakes: ReturnType<typeof fakeSessions>;
  readonly tools: Map<number, ProcessEntry>;
  /** Every tool pgid that received a signal. */
  readonly signalled: number[];
  /** The held grace timers, in the order stops started them. */
  readonly graceTimers: (() => void)[];
  startTool(cliPid: number): void;
}

/**
 * A manager whose CLI ignores stdin EOF (so a stop has to kill its group),
 * with a fake process table: `startTool` puts the Bash tool's group under a
 * CLI. `stubbornCli` / `stubbornTool`: that group survives every SIGKILL.
 * `holdLong`: every timer of 1 s or more is held too (the end-of-stream
 * cleanup's wait for the leader, and the tool poll), so a stream that ended
 * stays in its cleanup until a stop arrives.
 */
function setup(o: { stubbornCli?: boolean; stubbornTool?: boolean; holdLong?: boolean; script?: Parameters<typeof fakeSessions>[0] } = {}): Harness {
  const store = new Store({ dataDir: join(tmp, "data") });
  stores.push(store);
  const fakes = fakeSessions(o.script);
  const tools = new Map<number, ProcessEntry>();
  const signalled: number[] = [];
  const graceTimers: (() => void)[] = [];
  const fakeKill = fakes.deps.killGroup as (pgid: number, signal: NodeJS.Signals) => boolean;
  const killGroup = (pgid: number, signal: NodeJS.Signals): boolean => {
    if (fakes.children.has(pgid)) return o.stubbornCli === true ? (fakes.killed.push([pgid, signal]), true) : fakeKill(pgid, signal);
    const members = [...tools.values()].filter((p) => p.pgid === pgid);
    if (members.length === 0) return false;
    signalled.push(pgid);
    if (o.stubbornTool !== true) for (const m of members) tools.delete(m.pid);
    return true;
  };
  const isGroupAlive = (pgid: number): boolean =>
    (o.stubbornCli === true && fakes.children.has(pgid)) || fakes.isGroupAlive(pgid) || [...tools.values()].some((p) => p.pgid === pgid);
  const readGroupLeader = (pgid: number): GroupLeader => {
    if (fakes.isGroupAlive(pgid)) return { status: "present", command: CLI_PATH, startedAtMs: T0 };
    const p = tools.get(pgid);
    return p === undefined ? { status: "absent" } : { status: "present", command: p.command, startedAtMs: p.startedAtMs };
  };
  const snapshotProcesses = async (): Promise<ProcessEntry[]> => [
    ...[...fakes.children.values()].filter((c) => !c.exited).map((c) => ({ pid: c.pid, ppid: 1, pgid: c.pid, startedAtMs: T0, command: CLI_PATH })),
    ...tools.values(),
  ];
  const schedule = (fn: () => void, ms: number): CancelTimer => {
    if (ms === GRACE_MS) {
      graceTimers.push(fn);
      return () => {};
    }
    if (o.holdLong === true && ms >= 1_000) return () => {};
    return immediate(fn, ms);
  };
  const deps: SessionManagerDeps = { ...fakes.deps, killGroup, isGroupAlive, readGroupLeader, snapshotProcesses, schedule };
  const manager = new SessionManager({ store, authProvider: stubProvider(), loomwrightPath: pluginDir, stopGraceMs: GRACE_MS, baseEnv: { PATH: "/usr/bin" } }, deps);
  const startTool = (cliPid: number): void => {
    tools.set(SHELL, { pid: SHELL, ppid: cliPid, pgid: SHELL, startedAtMs: T1, command: "/bin/zsh" });
    tools.set(SLEEP, { pid: SLEEP, ppid: SHELL, pgid: SHELL, startedAtMs: T1, command: "/bin/sleep" });
  };
  return { store, manager, fakes, tools, signalled, graceTimers, startTool };
}

/** The shipped composition's routes, as `startKernel` merges them. */
const shippedRoutes = () => mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).routes;

async function serve(h: Pick<Harness, "store" | "manager">, overrides: Partial<ApiServerOptions> = {}): Promise<{ api: ApiServer; post: (path: string) => Promise<Response> }> {
  const api = await startApiServer(
    {
      store: h.store,
      sessions: h.manager,
      sessionManager: h.manager,
      loop: { start: () => {}, stop: async () => {} },
      authProviders: [],
      token: TOKEN,
      port: 0,
      routes: shippedRoutes(),
      ...overrides,
    },
    { now: () => NOW },
  );
  servers.push(api);
  const post = (path: string): Promise<Response> => fetch(`http://127.0.0.1:${api.port}${path}`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } });
  return { api, post };
}

function row(store: Store, id: number): SessionRow {
  const r = store.prepare<[number], SessionRow>("SELECT * FROM sessions WHERE id = ?").get(id);
  if (r === undefined) throw new Error(`no session ${id}`);
  return r;
}

async function running(h: Harness): Promise<SessionHandle> {
  const handle = await h.manager.startSession(startParams(tmp));
  await vi.waitFor(() => expect(row(h.store, handle.id).status).toBe("running"));
  return handle;
}

interface EventRow {
  readonly id: number;
  readonly actor: string;
  readonly session_id: number | null;
  readonly task_id: number | null;
  readonly payload: Record<string, unknown>;
}

function events(store: Store, kind: string, sessionId?: number): EventRow[] {
  return store
    .prepare<[string], { id: number; actor: string; session_id: number | null; task_id: number | null; payload_json: string }>(
      "SELECT id, actor, session_id, task_id, payload_json FROM events WHERE kind = ? ORDER BY id",
    )
    .all(kind)
    .filter((e) => sessionId === undefined || e.session_id === sessionId)
    .map(({ payload_json, ...rest }) => ({ ...rest, payload: JSON.parse(payload_json) as Record<string, unknown> }));
}

const stopRequests = (store: Store): EventRow[] => events(store, SESSION_STOP_REQUESTED);

/** The field names of `export interface <name> { … }` in the contract text. */
function contractInterfaceFields(name: string): string[] {
  const match = new RegExp(`export interface ${name} \\{([^}]*)\\}`).exec(contractText);
  if (match === null) throw new Error(`contract.ts has no \`export interface ${name}\``);
  return [...(match[1] ?? "").matchAll(/^\s*readonly (\w+)\??:/gm)].map((m) => m[1] ?? "");
}

/** `p`'s value, or `"pending"` once `ms` passed without it. */
const within = <T,>(p: Promise<T>, ms = 100): Promise<T | "pending"> =>
  Promise.race([p, new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), ms))]);

describe("the control part against the app contract", () => {
  it("serves both item-04 contract routes, same method and path, owner console", () => {
    const entries = [...contractText.matchAll(/^\s*\{ method: "([A-Z]+)", path: "([^"]+)", origin: "item-04" \},$/gm)].map((m) => `${m[1]} ${m[2]}`);
    expect(entries).toEqual(["POST /sessions/:id/stop", "POST /sessions/:id/kill"]);
    const served = shippedRoutes().map((r) => `${r.owner} ${r.method} ${r.path}`);
    for (const entry of entries) expect(served).toContain(`console ${entry}`);
    expect(controlPart.routes.map((r) => `${r.method} ${r.path}`)).toEqual(entries);
  });

  it("the contract's SessionControlResponse is exactly id, status and reason, its reason nullable like lastStatusReason's", () => {
    expect(contractInterfaceFields("SessionControlResponse")).toEqual(["id", "status", "reason"]);
    const body = /export interface SessionControlResponse \{([^}]*)\}/.exec(contractText)?.[1] ?? "";
    expect(body).toMatch(/^\s*readonly reason: string \| null;$/m);
  });
});

describe("POST /sessions/:id/stop and /kill", () => {
  it("stop: graceful, it ends stopped (owner_stop) only after its grace, every group gone; one session_stop_requested first", async () => {
    const h = setup();
    const s = await running(h);
    h.startTool(s.pgid as number);
    await vi.waitFor(() => expect(events(h.store, "session_group_recorded", s.id)).toHaveLength(1));
    const { post } = await serve(h);

    const answer = post(`/sessions/${s.id}/stop`);
    await vi.waitFor(() => expect(h.graceTimers).toHaveLength(1));
    // In its grace: nothing killed yet, no answer yet.
    expect(await within(answer)).toBe("pending");
    expect(h.fakes.isGroupAlive(s.pgid as number)).toBe(true);
    expect(h.signalled).toEqual([]);
    h.graceTimers[0]?.();

    const res = await answer;
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ id: s.id, status: "stopped", reason: "owner_stop" });
    expect(Object.keys(body).sort()).toEqual(contractInterfaceFields("SessionControlResponse").sort());
    expect(h.fakes.allGroupsGone()).toBe(true);
    expect(h.signalled).toContain(SHELL);
    expect(h.tools.size).toBe(0);
    expect(row(h.store, s.id).status).toBe("stopped");

    const requested = stopRequests(h.store);
    expect(requested).toEqual([{ id: requested[0]?.id, actor: "kernel", session_id: s.id, task_id: row(h.store, s.id).task_id, payload: { by: "owner", mode: "stop" } }]);
    // Recorded before the stop began: before the terminal status event.
    const terminal = events(h.store, "session_status", s.id).at(-1);
    expect(terminal?.payload).toEqual({ from: "running", to: "stopped", reason: "owner_stop" });
    expect(requested[0]?.id).toBeLessThan(terminal?.id ?? 0);
  });

  it("kill: the CLI's group and the recorded tool group are killed with no grace, ending stopped (owner_kill)", async () => {
    const h = setup();
    const s = await running(h);
    h.startTool(s.pgid as number);
    await vi.waitFor(() => expect(events(h.store, "session_group_recorded", s.id)).toHaveLength(1));
    const { post } = await serve(h);

    // The grace timer is held and never fired: a kill that waited for it would never answer.
    const res = await within(post(`/sessions/${s.id}/kill`), 5_000);
    expect(res).not.toBe("pending");
    expect((res as Response).status).toBe(200);
    expect(await (res as Response).json()).toEqual({ id: s.id, status: "stopped", reason: "owner_kill" });
    expect(h.graceTimers).toEqual([]);
    expect(h.fakes.killed).toContainEqual([s.pgid, "SIGKILL"]);
    expect(h.signalled).toContain(SHELL);
    expect(h.tools.size).toBe(0);
    expect(events(h.store, "session_group_killed", s.id).map((e) => e.payload["pgid"])).toEqual([SHELL]);
    expect(h.store.prepare<[number], string>("SELECT resolution FROM session_groups WHERE session_id = ?").pluck().all(s.id)).toEqual(["killed"]);
    expect(stopRequests(h.store).map((e) => e.payload)).toEqual([{ by: "owner", mode: "kill" }]);
  });

  it("kill: a CLI group that can't be confirmed gone ends failed (kill_incomplete), flagged for the reaper", async () => {
    const h = setup({ stubbornCli: true });
    const s = await running(h);
    const { post } = await serve(h);
    const res = await post(`/sessions/${s.id}/kill`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: s.id, status: "failed", reason: "kill_incomplete" });
    expect(row(h.store, s.id).status).toBe("failed");
    expect(row(h.store, s.id).kill_incomplete_at).not.toBeNull();
    expect(events(h.store, "session_status", s.id).at(-1)?.payload).toMatchObject({
      to: "failed",
      reason: "kill_incomplete",
      cause: { to: "stopped", reason: "owner_kill" },
    });
  });

  it("kill: a tool group that can't be confirmed gone ends failed (kill_incomplete), its session_groups row flagged", async () => {
    const h = setup({ stubbornTool: true });
    const s = await running(h);
    h.startTool(s.pgid as number);
    await vi.waitFor(() => expect(events(h.store, "session_group_recorded", s.id)).toHaveLength(1));
    const { post } = await serve(h);
    const res = await post(`/sessions/${s.id}/kill`);
    expect(await res.json()).toEqual({ id: s.id, status: "failed", reason: "kill_incomplete" });
    const flagged = h.store.prepare<[number], string | null>("SELECT kill_incomplete_at FROM session_groups WHERE session_id = ?").pluck().all(s.id);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).not.toBeNull();
  });

  it("a session that ended on its own before the stop keeps its stream's outcome, reported as it is", async () => {
    const success = { type: "result", subtype: "success", is_error: false, result: "hi" } as unknown as SDKMessage;
    const h = setup({
      holdLong: true,
      script: {
        script: ({ stream, options }) => {
          // The stream ends with a success while the CLI's group lives on (its cleanup waits for the leader).
          stream.onEnd = () => {};
          stream.push(fakeMsg.init(options.sessionId ?? ""));
          stream.push(success);
          stream.end();
        },
      },
    });
    const s = await h.manager.startSession(startParams(tmp));
    await flush();
    expect(row(h.store, s.id).status).not.toBe("completed");
    const { post } = await serve(h);
    const answer = post(`/sessions/${s.id}/stop`);
    await vi.waitFor(() => expect(h.graceTimers).toHaveLength(1));
    h.graceTimers[0]?.();
    const res = await answer;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: s.id, status: "completed", reason: "result_success" });
    expect(events(h.store, "session_status", s.id).at(-1)?.payload).toMatchObject({ to: "completed", reason: "result_success", stop_requested_after_end: true });
    // It was accepted (the session had not ended yet), so it was recorded.
    expect(stopRequests(h.store)).toHaveLength(1);
  });

  it("refuses a completed session 409 not_running with its status, and an unknown id 404; neither is recorded", async () => {
    const h = setup();
    const s = await running(h);
    h.fakes.calls[0]?.stream.push({ type: "result", subtype: "success", is_error: false, result: "done" } as unknown as SDKMessage);
    h.fakes.calls[0]?.stream.end();
    expect(await s.done).toBe("completed");
    const { post } = await serve(h);
    for (const verb of ["stop", "kill"]) {
      const done = await post(`/sessions/${s.id}/${verb}`);
      expect(done.status, verb).toBe(409);
      expect(await done.json(), verb).toEqual({ error: "not_running", status: "completed" });
      const unknown = await post(`/sessions/9999/${verb}`);
      expect(unknown.status, verb).toBe(404);
      expect(await unknown.json(), verb).toEqual({ error: "not_found" });
    }
    expect(stopRequests(h.store)).toEqual([]);
    expect(row(h.store, s.id).status).toBe("completed");
  });

  it("refuses a row this kernel does not run (not_live) 409 not_running with the row's status, recording nothing", async () => {
    const h = setup();
    const { post } = await serve(h);
    for (const status of ["interrupted", "orphaned", "running"]) {
      const id = Number(h.store.prepare("INSERT INTO sessions (agent, status) VALUES ('wright', ?)").run(status).lastInsertRowid);
      for (const verb of ["stop", "kill"]) {
        const res = await post(`/sessions/${id}/${verb}`);
        expect(res.status, `${status} ${verb}`).toBe(409);
        expect(await res.json(), `${status} ${verb}`).toEqual({ error: "not_running", status });
      }
      expect(row(h.store, id).status).toBe(status);
    }
    expect(stopRequests(h.store)).toEqual([]);
  });

  it("refuses an :id that is not a positive integer 400 invalid_id, recording nothing", async () => {
    const h = setup();
    const s = await running(h);
    const { post } = await serve(h);
    for (const id of ["0", "-1", "abc", "1.5", "1e1", "%201", "0x1", "+1", "%00", "1%2F2", "99999999999999999999"]) {
      for (const verb of ["stop", "kill"]) {
        const res = await post(`/sessions/${id}/${verb}`);
        expect(res.status, `${id} ${verb}`).toBe(400);
        expect(await res.json(), `${id} ${verb}`).toEqual({ error: "invalid_id" });
      }
    }
    expect(stopRequests(h.store)).toEqual([]);
    expect(row(h.store, s.id).status).toBe("running");
    await h.manager.stopSession(s.id, { mode: "kill" });
  });

  it("answers 503 sessions_unavailable without a session manager or a queue, and never throws", async () => {
    const h = setup();
    const s = await running(h);
    // A composition with no session manager: the request carries no `sessions`.
    const { post } = await serve(h, { sessionManager: undefined });
    for (const verb of ["stop", "kill"]) {
      const res = await post(`/sessions/${s.id}/${verb}`);
      expect(res.status, verb).toBe(503);
      expect(await res.json(), verb).toEqual({ error: "sessions_unavailable" });
    }
    // Called directly: no manager, or a manager but no queue.
    const base: ContributedRouteRequest = { params: { id: String(s.id) }, query: {}, body: undefined, store: h.store, now: () => NOW };
    for (const route of controlPart.routes) {
      expect(await route.handler(base)).toEqual({ status: 503, body: { error: "sessions_unavailable" } });
      expect(await route.handler({ ...base, sessions: h.manager })).toEqual({ status: 503, body: { error: "sessions_unavailable" } });
    }
    expect(stopRequests(h.store)).toEqual([]);
    expect(row(h.store, s.id).status).toBe("running");
    await h.manager.stopSession(s.id, { mode: "kill" });
  });

  it("rethrows anything that is not a SessionError refusal (the API's 500 and route_failed apply)", async () => {
    const h = setup();
    const s = await running(h);
    const boom = new Error("store went away");
    const sessions = {
      getSession: (id: number) => h.manager.getSession(id),
      stopSession: () => Promise.reject(boom),
    } as unknown as SessionManager;
    const req: ContributedRouteRequest = { params: { id: String(s.id) }, query: {}, body: undefined, store: h.store, now: () => NOW, sessions, serialized: (fn) => fn() };
    await expect(controlPart.routes[1]?.handler(req)).rejects.toBe(boom);
    // A SessionError of another code is rethrown too, never mapped.
    const odd = { ...req, sessions: { ...sessions, getSession: sessions.getSession, stopSession: () => Promise.reject(new SessionError("invalid_params", "x")) } as unknown as SessionManager };
    await expect(controlPart.routes[0]?.handler(odd)).rejects.toMatchObject({ code: "invalid_params" });
    // An accepted stop that fails later, awaited off the queue: rethrown too, and the queued work had already returned.
    let queueDone = false;
    const late: ContributedRouteRequest = {
      ...req,
      serialized: async <T,>(fn: () => Promise<T>): Promise<T> => {
        const r = await fn();
        queueDone = true;
        return r;
      },
      sessions: {
        getSession: sessions.getSession,
        stopSession: (_id: number, o: { onAccepted?: () => void }) => {
          o.onAccepted?.();
          return new Promise((_resolve, reject) => setTimeout(() => reject(boom), 20));
        },
      } as unknown as SessionManager,
    };
    for (const route of controlPart.routes) {
      queueDone = false;
      await expect(route.handler(late)).rejects.toBe(boom);
      expect(queueDone).toBe(true);
    }
    await h.manager.stopSession(s.id, { mode: "kill" });
  });
});

describe("the routes run on the API server's POST queue", () => {
  it("a kill sent while the owner's Stop of that session waits out its grace answers at once: it joins that Stop, one terminal transition, owner_kill", async () => {
    const h = setup();
    const s = await running(h);
    h.startTool(s.pgid as number);
    await vi.waitFor(() => expect(events(h.store, "session_group_recorded", s.id)).toHaveLength(1));
    const { post } = await serve(h);
    const stop = post(`/sessions/${s.id}/stop`);
    // The Stop is accepted and in its grace; only its acceptance ran on the POST queue.
    await vi.waitFor(() => expect(h.graceTimers).toHaveLength(1));
    // The grace timer is never fired: a kill that waited for it would never answer.
    const kill = await within(post(`/sessions/${s.id}/kill`), 5_000);
    expect(kill).not.toBe("pending");
    expect((kill as Response).status).toBe(200);
    expect(await (kill as Response).json()).toEqual({ id: s.id, status: "stopped", reason: "owner_kill" });
    // The Stop shares that one outcome.
    const stopped = await within(stop, 5_000);
    expect(stopped).not.toBe("pending");
    expect(await (stopped as Response).json()).toEqual({ id: s.id, status: "stopped", reason: "owner_kill" });
    // One stop: one grace started, each group killed once, one terminal transition.
    expect(h.graceTimers).toHaveLength(1);
    expect(h.fakes.killed.filter(([pgid]) => pgid === s.pgid)).toEqual([[s.pgid, "SIGKILL"]]);
    expect(events(h.store, "session_group_killed", s.id).map((e) => e.payload["pgid"])).toEqual([SHELL]);
    expect(h.fakes.allGroupsGone()).toBe(true);
    const terminal = events(h.store, "session_status", s.id).filter((e) => e.payload["to"] === "stopped" || e.payload["to"] === "failed");
    expect(terminal.map((e) => e.payload)).toEqual([{ from: "running", to: "stopped", reason: "owner_kill" }]);
    // One event per accepted request, both before the terminal transition.
    const requested = stopRequests(h.store);
    expect(requested.map((e) => e.payload)).toEqual([
      { by: "owner", mode: "stop" },
      { by: "owner", mode: "kill" },
    ]);
    for (const e of requested) expect(e.id).toBeLessThan(terminal[0]?.id ?? 0);
  });

  it("a second stop sent during the owner's Stop joins it: accepted and recorded, it shares the one outcome; one grace, one terminal transition", async () => {
    const h = setup();
    const s = await running(h);
    const { post } = await serve(h);
    const stop = post(`/sessions/${s.id}/stop`);
    await vi.waitFor(() => expect(h.graceTimers).toHaveLength(1));
    const again = post(`/sessions/${s.id}/stop`);
    await vi.waitFor(() => expect(stopRequests(h.store)).toHaveLength(2));
    // Joined, not a second stop: no second grace, and it does not cut the first one short.
    expect(await within(again)).toBe("pending");
    expect(h.graceTimers).toHaveLength(1);
    h.graceTimers[0]?.();
    expect(await (await stop).json()).toEqual({ id: s.id, status: "stopped", reason: "owner_stop" });
    expect(await (await again).json()).toEqual({ id: s.id, status: "stopped", reason: "owner_stop" });
    expect(stopRequests(h.store).map((e) => e.payload["mode"])).toEqual(["stop", "stop"]);
    expect(events(h.store, "session_status", s.id).filter((e) => e.payload["to"] === "stopped")).toHaveLength(1);
  });

  it("a kill queued behind the owner's Stops (another session's, then its own) runs once they are accepted, not after their graces: Stop A, Stop B, Kill B", async () => {
    const h = setup();
    const a = await running(h);
    const b = await running(h);
    const { post } = await serve(h);
    const stopA = post(`/sessions/${a.id}/stop`);
    await vi.waitFor(() => expect(h.graceTimers).toHaveLength(1));
    const stopB = post(`/sessions/${b.id}/stop`);
    // B's Stop is accepted while A's waits out its grace: no grace holds the queue.
    await vi.waitFor(() => expect(h.graceTimers).toHaveLength(2));
    // No grace timer is fired: a kill that waited for either would never answer.
    const kill = await within(post(`/sessions/${b.id}/kill`), 5_000);
    expect(kill).not.toBe("pending");
    expect((kill as Response).status).toBe(200);
    expect(await (kill as Response).json()).toEqual({ id: b.id, status: "stopped", reason: "owner_kill" });
    const stoppedB = await within(stopB, 5_000);
    expect(stoppedB).not.toBe("pending");
    expect(await (stoppedB as Response).json()).toEqual({ id: b.id, status: "stopped", reason: "owner_kill" });
    expect(events(h.store, "session_status", b.id).filter((e) => e.payload["to"] === "stopped" || e.payload["to"] === "failed").map((e) => e.payload)).toEqual([
      { from: "running", to: "stopped", reason: "owner_kill" },
    ]);
    // A is untouched by B's kill: still in its grace until it runs out.
    expect(await within(stopA)).toBe("pending");
    expect(h.fakes.isGroupAlive(a.pgid as number)).toBe(true);
    h.graceTimers[0]?.();
    expect(await (await stopA).json()).toEqual({ id: a.id, status: "stopped", reason: "owner_stop" });
    expect(stopRequests(h.store).map((e) => [e.session_id, e.payload["mode"]])).toEqual([
      [a.id, "stop"],
      [b.id, "stop"],
      [b.id, "kill"],
    ]);
  });

  it("a kill or stop after a kill has ended the session is refused 409 not_running: one event, one terminal transition", async () => {
    const h = setup();
    const s = await running(h);
    const { post } = await serve(h);
    const first = await post(`/sessions/${s.id}/kill`);
    expect(await first.json()).toEqual({ id: s.id, status: "stopped", reason: "owner_kill" });
    for (const verb of ["kill", "stop"]) {
      const res = await post(`/sessions/${s.id}/${verb}`);
      expect(res.status, verb).toBe(409);
      expect(await res.json(), verb).toEqual({ error: "not_running", status: "stopped" });
    }
    expect(stopRequests(h.store).map((e) => e.payload["mode"])).toEqual(["kill"]);
    expect(events(h.store, "session_status", s.id).filter((e) => e.payload["to"] === "stopped")).toHaveLength(1);
  });

  it("a kill sent while a stop-all is still running starts only after it", async () => {
    const h = setup();
    const s = await running(h);
    let entered!: () => void;
    const stopAllEntered = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { post } = await serve(h, {
      sessions: {
        // A stop-all that holds the queue until released (it stops nothing itself).
        stopAll: async () => {
          entered();
          await gate;
          return [];
        },
        abandonSession: () => "abandoned",
      },
    });
    const stopAll = post("/stop-all");
    await stopAllEntered;
    try {
      const kill = post(`/sessions/${s.id}/kill`);
      expect(await within(kill, 200)).toBe("pending");
      // Not started: nothing recorded, nothing killed.
      expect(stopRequests(h.store)).toEqual([]);
      expect(h.fakes.isGroupAlive(s.pgid as number)).toBe(true);
      release();
      expect((await stopAll).status).toBe(200);
      const res = await kill;
      expect(await res.json()).toEqual({ id: s.id, status: "stopped", reason: "owner_kill" });
      // The kill's request event follows the stop-all's completion.
      const completed = events(h.store, "stop_all_completed");
      expect(completed).toHaveLength(1);
      expect(stopRequests(h.store)[0]?.id).toBeGreaterThan(completed[0]?.id ?? Infinity);
    } finally {
      release();
    }
  });

  it("a kill queued directly behind the owner's Stop of that session (both behind a held stop-all) cuts the grace that Stop's acceptance armed: owner_kill, one grace", async () => {
    const h = setup();
    const s = await running(h);
    let entered!: () => void;
    const stopAllEntered = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // The shipped routes, each noting when its handler has run up to its queued
    // work (the handler queues it synchronously), so the order on the queue is
    // known without sleeping.
    const queued: string[] = [];
    const routes = shippedRoutes().map((r) =>
      r.owner === "console"
        ? {
            ...r,
            handler: (req: ContributedRouteRequest) => {
              const answer = r.handler(req);
              queued.push(r.path);
              return answer;
            },
          }
        : r,
    );
    const { post } = await serve(h, {
      routes,
      sessions: {
        // A stop-all that holds the queue until released (it stops nothing itself).
        stopAll: async () => {
          entered();
          await gate;
          return [];
        },
        abandonSession: () => "abandoned",
      },
    });
    const stopAll = post("/stop-all");
    await stopAllEntered;
    try {
      const stop = post(`/sessions/${s.id}/stop`);
      await vi.waitFor(() => expect(queued).toEqual(["/sessions/:id/stop"]));
      const kill = post(`/sessions/${s.id}/kill`);
      await vi.waitFor(() => expect(queued).toEqual(["/sessions/:id/stop", "/sessions/:id/kill"]));
      expect(stopRequests(h.store)).toEqual([]);
      release();
      expect((await stopAll).status).toBe(200);
      // The Kill's queued work runs right after the Stop's acceptance returns:
      // that acceptance must already have armed the grace cut. The grace timer
      // is never fired, so a kill that only joined would never answer.
      const killed = await within(kill, 5_000);
      expect(killed).not.toBe("pending");
      expect((killed as Response).status).toBe(200);
      expect(await (killed as Response).json()).toEqual({ id: s.id, status: "stopped", reason: "owner_kill" });
      const stopped = await within(stop, 5_000);
      expect(stopped).not.toBe("pending");
      expect(await (stopped as Response).json()).toEqual({ id: s.id, status: "stopped", reason: "owner_kill" });
      expect(h.graceTimers).toHaveLength(1);
      expect(stopRequests(h.store).map((e) => e.payload["mode"])).toEqual(["stop", "kill"]);
      expect(events(h.store, "session_status", s.id).filter((e) => e.payload["to"] === "stopped" || e.payload["to"] === "failed")).toHaveLength(1);
    } finally {
      release();
    }
  });

  it("a stop-all sent during an owner's Stop answers once that Stop has ended", async () => {
    const h = setup();
    const s = await running(h);
    const { post } = await serve(h);
    const stop = post(`/sessions/${s.id}/stop`);
    await vi.waitFor(() => expect(h.graceTimers).toHaveLength(1));
    const stopAll = post("/stop-all");
    // Not queued behind the Stop's grace: the kill switch engages at once and joins the Stop in flight.
    await vi.waitFor(() => expect(events(h.store, "kill_switch_engaged")).toHaveLength(1));
    expect(await within(stopAll, 200)).toBe("pending");
    // One stop: the kill switch started no grace of its own.
    expect(h.graceTimers).toHaveLength(1);
    h.graceTimers[0]?.();
    const all = await stopAll;
    // It answers only once the Stop has ended.
    expect(row(h.store, s.id).status).toBe("stopped");
    expect(all.status).toBe(200);
    expect(await all.json()).toEqual({ engaged: true, sessions: [{ id: s.id, status: "stopped" }] });
    expect(await (await stop).json()).toEqual({ id: s.id, status: "stopped", reason: "owner_stop" });
    expect(events(h.store, "session_status", s.id).filter((e) => e.payload["to"] === "stopped")).toHaveLength(1);
  });
});
