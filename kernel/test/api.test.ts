// The loopback API (item 08, AC1-AC3, AC5): a real server on 127.0.0.1 and an
// OS-assigned port, a temp data dir, and sessions on the fake spawner/query
// in session-fakes.ts. Never the real SDK, a model or the real Keychain.
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startApiServer } from "../src/api/index.js";
import type { ApiServer, ApiServerOptions, StatusBody } from "../src/api/index.js";
import type { AuthProvider } from "../src/auth/index.js";
import { CLIENT_HEADER } from "../src/api/server.js";
import { SessionError, SessionManager } from "../src/sessions/index.js";
import type { AbandonVia, SessionHandle, SessionRow } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { kernelVersion } from "../src/version.js";
import { fakeSessions, flush, makePluginDir, startParams, stubProvider, unexpectedAbandon } from "./session-fakes.js";

const TOKEN = "0123456789abcdef".repeat(4);
const WRONG = "fedcba9876543210".repeat(4);
const NOW = new Date("2026-10-02T10:00:00.000Z");
const STARTED = new Date(NOW.getTime() - 125_000);

let tmp: string;
let store: Store;
const servers: ApiServer[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-api-"));
  store = new Store({ dataDir: join(tmp, "data") });
});

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  store.close();
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function fakeLoop(order: string[] = []) {
  return {
    order,
    start: vi.fn(() => {
      order.push("loop.start");
    }),
    stop: vi.fn(async () => {
      order.push("loop.stop:begin");
      await flush(2);
      order.push("loop.stop:end");
    }),
  };
}

async function serve(overrides: Partial<ApiServerOptions> = {}): Promise<ApiServer> {
  const server = await startApiServer(
    {
      store,
      sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
      loop: fakeLoop(),
      authProviders: [stubProvider()],
      token: TOKEN,
      port: 0,
      ...overrides,
    },
    { now: () => NOW, startedAt: STARTED, pid: 4242, dayOf: (d) => d.toISOString().slice(0, 10) },
  );
  servers.push(server);
  return server;
}

interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  json(): unknown;
}

async function call(
  server: ApiServer,
  path: string,
  init: { method?: string; auth?: string | null; headers?: Record<string, string> } = {},
): Promise<Answer> {
  const headers: Record<string, string> = { ...init.headers };
  const auth = init.auth === undefined ? `Bearer ${TOKEN}` : init.auth;
  if (auth !== null) headers["Authorization"] = auth;
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { method: init.method ?? "GET", headers });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: () => JSON.parse(text) };
}

function eventKinds(): string[] {
  return store.prepare<[], string>("SELECT kind FROM events ORDER BY id").pluck().all();
}

function payloadOf(kind: string): unknown {
  const raw = store.prepare<[string], string>("SELECT payload_json FROM events WHERE kind = ? ORDER BY id DESC LIMIT 1").pluck().get(kind);
  return raw === undefined ? undefined : JSON.parse(raw);
}

function row(id: number): SessionRow {
  const r = store.prepare<[number], SessionRow>("SELECT * FROM sessions WHERE id = ?").get(id);
  if (r === undefined) throw new Error(`no session ${id}`);
  return r;
}

describe("bind (AC1, AC5)", () => {
  it("listens on 127.0.0.1 only, on an OS-assigned port", async () => {
    const server = await serve();
    expect(server.host).toBe("127.0.0.1");
    expect(server.port).toBeGreaterThan(0);
    expect(server.address()).toMatchObject({ address: "127.0.0.1", family: "IPv4", port: server.port });
    expect((await call(server, "/status")).status).toBe(200);
  });

  it("is not reachable on a non-loopback interface address (when the host has one)", async () => {
    const server = await serve();
    const external = Object.values(networkInterfaces())
      .flat()
      .find((i) => i !== undefined && i.family === "IPv4" && !i.internal);
    if (external === undefined) return; // No non-loopback IPv4 here; the address() check above still holds.
    const err = await fetch(`http://${external.address}:${server.port}/status`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(2_000),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
  });

  it("refuses an empty token", async () => {
    await expect(serve({ token: "" })).rejects.toThrow(RangeError);
  });
});

describe("authentication (AC1, AC5)", () => {
  const cases: [string, string | null, string, string][] = [
    ["no header", null, "GET", "/status"],
    ["a wrong token", `Bearer ${WRONG}`, "GET", "/status"],
    ["a wrong scheme", `Basic ${TOKEN}`, "GET", "/status"],
    ["a token with a trailing character", `Bearer ${TOKEN}x`, "GET", "/status"],
    ["a token prefix", `Bearer ${TOKEN.slice(0, 32)}`, "GET", "/status"],
    ["an empty bearer", "Bearer ", "GET", "/status"],
    ["an unknown path, unauthenticated", null, "GET", "/nope"],
    ["a wrong method, unauthenticated", `Bearer ${WRONG}`, "DELETE", "/status"],
    ["POST /stop-all with a wrong token", `Bearer ${WRONG}`, "POST", "/stop-all"],
    ["POST /sessions/<id>/abandon, unauthenticated", null, "POST", "/sessions/1/abandon"],
    ["POST /sessions/<id>/abandon with a wrong token", `Bearer ${WRONG}`, "POST", "/sessions/1/abandon"],
    ["a malformed abandon path, unauthenticated", null, "POST", "/sessions/0/abandon"],
  ];
  for (const [name, auth, method, path] of cases) {
    it(`answers 401 for ${name}, never echoing a token`, async () => {
      const loop = fakeLoop();
      const stopAll = vi.fn(async () => []);
      const server = await serve({ loop, sessions: { stopAll, abandonSession: unexpectedAbandon } });
      const res = await call(server, path, { method, auth });
      expect(res.status).toBe(401);
      expect(res.text).toBe('{"error":"unauthorized"}');
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
      const everything = `${res.text} ${JSON.stringify([...res.headers])}`;
      expect(everything).not.toContain(TOKEN);
      expect(everything).not.toContain(WRONG);
      expect(everything).not.toContain(TOKEN.slice(0, 32));
      // Nothing behind the gate ran.
      expect(loop.stop).not.toHaveBeenCalled();
      expect(stopAll).not.toHaveBeenCalled();
      expect(eventKinds()).toEqual([]);
    });
  }

  it("answers 404 for an unknown path and 405 for a wrong method only when authenticated", async () => {
    const server = await serve();
    expect((await call(server, "/nope")).status).toBe(404);
    const wrong = await call(server, "/status", { method: "POST" });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("GET");
    expect((await call(server, "/stop-all")).status).toBe(405);
    expect((await call(server, "/resume", { method: "GET" })).status).toBe(405);
  });
});

describe("GET /status (AC2)", () => {
  function seed(): void {
    const ins = (sql: string, ...args: unknown[]): void => {
      store.prepare(sql).run(...args);
    };
    ins("INSERT INTO sessions (id, agent, status, model, pgid, started_at) VALUES (1, 'wright', 'running', 'claude-haiku-4-5', 2000000001, '2026-10-02T09:00:00.000Z')");
    ins("INSERT INTO sessions (id, agent, status, model, pgid, started_at) VALUES (2, 'scout', 'starting', 'claude-sonnet-5', 2000000002, '2026-10-02T09:30:00.000Z')");
    ins("INSERT INTO sessions (id, agent, status, model, pgid, started_at) VALUES (3, 'wright', 'completed', 'claude-haiku-4-5', 2000000003, '2026-10-02T08:00:00.000Z')");
    ins("INSERT INTO sessions (id, agent, status, model, pgid, started_at) VALUES (4, 'wright', 'interrupted', 'claude-haiku-4-5', 2000000004, '2026-10-02T08:00:00.000Z')");
    // Kills that gave up: their groups may still be alive, whatever the status.
    const killIncomplete = "INSERT INTO sessions (id, agent, status, model, pgid, started_at, kill_incomplete_at) VALUES (?, ?, ?, 'claude-haiku-4-5', ?, '2026-10-02T07:00:00.000Z', ?)";
    ins(killIncomplete, 5, "wright", "failed", 2000000005, "2026-10-02T07:10:00.000Z");
    ins(killIncomplete, 6, null, "failed:auth", 2000000006, "2026-10-02T07:20:00.000Z");

    ins("INSERT INTO event_queue (id, kind, payload_json, status, enqueued_at) VALUES (1, 'message', '{}', 'done', '2026-10-02T09:00:00.000Z')");
    ins("INSERT INTO event_queue (id, kind, payload_json, status, enqueued_at, not_before, attempts) VALUES (2, 'message', '{}', 'pending', '2026-10-02T09:01:00.000Z', '2026-10-02T11:00:00.000Z', 1)");
    ins("INSERT INTO event_queue (id, kind, payload_json, status, enqueued_at) VALUES (3, 'wakeup', '{}', 'pending', '2026-10-02T09:02:00.000Z')");
    ins("INSERT INTO event_queue (id, kind, payload_json, status, enqueued_at) VALUES (4, 'message', '{}', 'failed', '2026-10-02T09:03:00.000Z')");

    ins("INSERT INTO wakeups (id, due_at, reason, status) VALUES (1, '2026-10-02T12:00:00.000Z', 'later', 'pending')");
    ins("INSERT INTO wakeups (id, due_at, reason, status) VALUES (2, '2026-10-02T11:00:00.000Z', 'sooner', 'pending')");
    ins("INSERT INTO wakeups (id, due_at, reason, status) VALUES (3, '2026-10-02T09:00:00.000Z', 'fired', 'fired')");

    const budget = "INSERT INTO budget (day, agent, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens) VALUES (?, ?, 'm', ?, ?, ?, ?)";
    ins(budget, "2026-10-02", "wright", 100, 50, 10, 100_000); // 160 counted; cache reads never count (D26)
    ins(budget, "2026-10-02", "wright", 30, 10, 0, 5); // 40
    ins(budget, "2026-10-02", "scout", 5, 0, 0, 0); // 5
    ins(budget, "2026-10-01", "wright", 9_000, 999, 0, 0); // yesterday: excluded

    const cap = "INSERT INTO cap_state (account, rate_limit_type, status, resets_at, utilization, reset_source) VALUES (?, ?, ?, ?, ?, ?)";
    ins(cap, "owner@example.test", "seven_day", "allowed", "2026-10-05T00:00:00.000Z", 0.4, "event");
    ins(cap, "owner@example.test", "five_hour", "rejected", "2026-10-02T12:00:00.000Z", 1, "event");
    ins(cap, "other@example.test", "five_hour", "allowed", null, null, "recheck");
  }

  it("reports kernel, kill switch, auth health, running sessions, pending queue and wake-ups, today's tokens and cap state", async () => {
    seed();
    const expiring = stubProvider({ id: "subscription-token", health: () => ({ status: "expiring", days: 12 }) });
    const throwing: AuthProvider = stubProvider({
      id: "api-key",
      account: "api-key",
      health: () => {
        throw new Error("security printed SECRET-KEYCHAIN-OUTPUT");
      },
    });
    const server = await serve({ authProviders: [expiring, throwing] });
    const res = await call(server, "/status");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.text).not.toContain("SECRET-KEYCHAIN-OUTPUT");
    expect(res.text).not.toContain(TOKEN);
    expect(res.json()).toEqual({
      kernel: { version: kernelVersion(), uptime_s: 125, pid: 4242 },
      kill_switch: { engaged: false, since: null },
      auth: [
        { id: "subscription-token", account: "owner@example.test", health: { status: "expiring", days: 12 } },
        { id: "api-key", account: "api-key", health: { status: "error", reason: "health_threw" } },
      ],
      sessions: [
        { id: 1, agent: "wright", model: "claude-haiku-4-5", pgid: 2000000001, started_at: "2026-10-02T09:00:00.000Z", status: "running" },
        { id: 2, agent: "scout", model: "claude-sonnet-5", pgid: 2000000002, started_at: "2026-10-02T09:30:00.000Z", status: "starting" },
      ],
      kill_unconfirmed: [
        { id: 5, agent: "wright", status: "failed", pgid: 2000000005, kill_incomplete_at: "2026-10-02T07:10:00.000Z" },
        { id: 6, agent: null, status: "failed:auth", pgid: 2000000006, kill_incomplete_at: "2026-10-02T07:20:00.000Z" },
      ],
      orphaned: [],
      queue: {
        pending: 2,
        events: [
          { id: 2, kind: "message", enqueued_at: "2026-10-02T09:01:00.000Z", not_before: "2026-10-02T11:00:00.000Z", attempts: 1 },
          { id: 3, kind: "wakeup", enqueued_at: "2026-10-02T09:02:00.000Z", not_before: null, attempts: 0 },
        ],
      },
      wakeups: {
        pending: 2,
        items: [
          { id: 2, due_at: "2026-10-02T11:00:00.000Z", reason: "sooner", task_id: null },
          { id: 1, due_at: "2026-10-02T12:00:00.000Z", reason: "later", task_id: null },
        ],
      },
      tokens_today: {
        day: "2026-10-02",
        agents: [
          { agent: "scout", counted_tokens: 5 },
          { agent: "wright", counted_tokens: 200 },
        ],
      },
      cap_state: [
        { account: "other@example.test", limits: [{ rate_limit_type: "five_hour", status: "allowed", resets_at: null, utilization: null, reset_source: "recheck" }] },
        {
          account: "owner@example.test",
          limits: [
            { rate_limit_type: "five_hour", status: "rejected", resets_at: "2026-10-02T12:00:00.000Z", utilization: 1, reset_source: "event" },
            { rate_limit_type: "seven_day", status: "allowed", resets_at: "2026-10-05T00:00:00.000Z", utilization: 0.4, reset_source: "event" },
          ],
        },
      ],
    } satisfies StatusBody);
  });

  it("passes a returned error health through unchanged and hands every provider readStatus's one instant", async () => {
    const seen: (Date | undefined)[] = [];
    const recording = (id: string, health: ReturnType<AuthProvider["health"]>): AuthProvider =>
      stubProvider({
        id,
        account: id,
        health: (at?: Date) => {
          seen.push(at);
          return health;
        },
      });
    const server = await serve({
      authProviders: [
        recording("broken-keychain", { status: "error", reason: "keychain_unreadable" }),
        recording("fine", { status: "ok" }),
      ],
    });
    const res = await call(server, "/status");
    expect(res.status).toBe(200);
    expect((res.json() as StatusBody).auth).toEqual([
      { id: "broken-keychain", account: "broken-keychain", health: { status: "error", reason: "keychain_unreadable" } },
      { id: "fine", account: "fine", health: { status: "ok" } },
    ]);
    expect(seen).toEqual([NOW, NOW]);
  });

  it("lists every row with kill_incomplete_at set under kill_unconfirmed, apart from sessions, and drops it once cleared", async () => {
    const ins = (sql: string, ...args: unknown[]): void => {
      store.prepare(sql).run(...args);
    };
    const s = "INSERT INTO sessions (id, agent, status, pgid, kill_incomplete_at) VALUES (?, 'wright', ?, ?, ?)";
    ins(s, 1, "running", 2000000001, "2026-10-02T09:00:00.000Z");
    ins(s, 2, "orphaned", 2000000002, "2026-10-02T09:01:00.000Z");
    ins(s, 3, "stopped", 2000000003, null);
    ins(s, 4, "failed", 2000000004, "2026-10-02T09:02:00.000Z");
    const server = await serve();
    const body = (await call(server, "/status")).json() as StatusBody;
    expect(body.sessions.map((r) => r.id)).toEqual([1]);
    expect(body.kill_unconfirmed.map((r) => [r.id, r.status])).toEqual([
      [1, "running"],
      [2, "orphaned"],
      [4, "failed"],
    ]);
    // The reaper confirmed the group gone: the row leaves the list.
    store.prepare("UPDATE sessions SET kill_incomplete_at = NULL WHERE id = 4").run();
    const after = (await call(server, "/status")).json() as StatusBody;
    expect(after.kill_unconfirmed.map((r) => r.id)).toEqual([1, 2]);
  });

  it("caps the listed queue rows and wake-ups at 50 while the counts stay complete", async () => {
    for (let i = 0; i < 60; i++) {
      store.prepare("INSERT INTO event_queue (kind, payload_json) VALUES ('message', '{}')").run();
      store.prepare("INSERT INTO wakeups (due_at, reason) VALUES ('2026-10-03T00:00:00.000Z', 'r')").run();
    }
    const body = (await call(await serve(), "/status")).json() as StatusBody;
    expect(body.queue.pending).toBe(60);
    expect(body.queue.events).toHaveLength(50);
    expect(body.wakeups.pending).toBe(60);
    expect(body.wakeups.items).toHaveLength(50);
  });
});

describe("POST /stop-all and /resume (AC3, AC5)", () => {
  function realManager() {
    const fakes = fakeSessions();
    const manager = new SessionManager(
      { store, authProvider: stubProvider(), loomwrightPath: makePluginDir(tmp), stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" } },
      fakes.deps,
    );
    return { manager, ...fakes };
  }

  async function twoRunning(manager: SessionManager): Promise<[SessionHandle, SessionHandle]> {
    const a = await manager.startSession(startParams(tmp));
    const b = await manager.startSession(startParams(tmp));
    await vi.waitFor(() => {
      expect(row(a.id).status).toBe("running");
      expect(row(b.id).status).toBe("running");
    });
    return [a, b];
  }

  it("stops the loop first, then every session (no group left alive), and records both in events", async () => {
    const { manager, allGroupsGone, children } = realManager();
    const [a, b] = await twoRunning(manager);
    const order: string[] = [];
    const loop = fakeLoop(order);
    const sessions = {
      stopAll: async () => {
        order.push("sessions.stopAll");
        return manager.stopAll();
      },
      abandonSession: unexpectedAbandon,
    };
    const server = await serve({ loop, sessions });

    const res = await call(server, "/stop-all", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.json()).toEqual({
      engaged: true,
      sessions: [
        { id: a.id, status: "stopped" },
        { id: b.id, status: "stopped" },
      ],
    });
    expect(order).toEqual(["loop.stop:begin", "loop.stop:end", "sessions.stopAll"]);
    expect(row(a.id).status).toBe("stopped");
    expect(row(b.id).status).toBe("stopped");
    expect(children.size).toBe(2);
    expect(allGroupsGone()).toBe(true);
    expect(eventKinds().filter((k) => k.startsWith("kill_switch") || k === "stop_all_completed")).toEqual([
      "kill_switch_engaged",
      "stop_all_completed",
    ]);
    expect(payloadOf("stop_all_completed")).toEqual({ sessions: [{ id: a.id, status: "stopped" }, { id: b.id, status: "stopped" }] });
    expect(loop.start).not.toHaveBeenCalled();

    // Engaged: /status says so, and a repeated stop-all re-runs every step without restarting the loop.
    const status = (await call(server, "/status")).json() as StatusBody;
    expect(status.kill_switch).toEqual({ engaged: true, since: NOW.toISOString() });
    expect((await call(server, "/stop-all", { method: "POST" })).json()).toEqual({ engaged: true, sessions: [] });
    expect(loop.stop).toHaveBeenCalledTimes(2);
    expect(loop.start).not.toHaveBeenCalled();
    expect(eventKinds().filter((k) => k.startsWith("kill_switch"))).toEqual(["kill_switch_engaged", "kill_switch_engaged"]);
  });

  it("a stop of one session that rejects does not skip the other", async () => {
    const { manager, isGroupAlive } = realManager();
    const [a, b] = await twoRunning(manager);
    const original = manager.stopSession.bind(manager);
    vi.spyOn(manager, "stopSession").mockImplementation((id) => (id === a.id ? Promise.reject(new Error("boom")) : original(id)));
    const server = await serve({ sessions: manager });

    const body = (await call(server, "/stop-all", { method: "POST" })).json();
    expect(body).toEqual({
      engaged: true,
      sessions: [
        { id: a.id, status: "stop_failed", error: "boom" },
        { id: b.id, status: "stopped" },
      ],
    });
    expect(isGroupAlive(b.pgid as number)).toBe(false);
    vi.restoreAllMocks();
    await manager.stopAll();
  });

  it("/resume releases an engaged switch and restarts the loop; when not engaged it appends nothing", async () => {
    const loop = fakeLoop();
    const server = await serve({ loop });

    expect((await call(server, "/resume", { method: "POST" })).json()).toEqual({ engaged: false });
    expect(eventKinds()).toEqual([]);
    expect(loop.start).not.toHaveBeenCalled();

    await call(server, "/stop-all", { method: "POST" });
    expect((await call(server, "/resume", { method: "POST" })).json()).toEqual({ engaged: false });
    expect(loop.start).toHaveBeenCalledTimes(1);
    expect(eventKinds()).toEqual(["kill_switch_engaged", "stop_all_completed", "kill_switch_released"]);
    expect(((await call(server, "/status")).json() as StatusBody).kill_switch).toEqual({ engaged: false, since: null });
  });

  it("answers 500 without any error text when a step throws, and the switch stays engaged", async () => {
    const server = await serve({
      sessions: {
        stopAll: async () => {
          throw new Error("internal detail");
        },
        abandonSession: unexpectedAbandon,
      },
    });
    const res = await call(server, "/stop-all", { method: "POST" });
    expect(res.status).toBe(500);
    expect(res.text).toBe('{"error":"internal_error"}');
    expect(eventKinds()).toEqual(["kill_switch_engaged"]);
  });

  it("close() stops listening", async () => {
    const server = await serve();
    const port = server.port;
    await server.close();
    await server.close();
    const err = await fetch(`http://127.0.0.1:${port}/status`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("POST /sessions/<id>/abandon and /status orphaned (H04, AC4)", () => {
  function realManager() {
    const fakes = fakeSessions();
    const manager = new SessionManager(
      { store, authProvider: stubProvider(), loomwrightPath: makePluginDir(tmp), stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" } },
      fakes.deps,
    );
    return { manager, ...fakes };
  }

  /** An `orphaned` row whose kernel event records `reason`. */
  function orphan(id: number, reason: string): void {
    store.prepare("INSERT INTO sessions (id, agent, status, pgid, updated_at) VALUES (?, 'wright', 'orphaned', ?, '2026-10-02T08:00:00.000Z')").run(id, 2000000000 + id);
    store
      .prepare("INSERT INTO events (at, kind, actor, session_id, payload_json) VALUES ('2026-10-02T08:00:00.000Z', 'session_status', 'kernel', ?, ?)")
      .run(id, JSON.stringify({ from: "running", to: "orphaned", reason, pgid: 2000000000 + id }));
  }

  function lastStatusPayload(id: number): Record<string, unknown> {
    const raw = store
      .prepare<[number], string>("SELECT payload_json FROM events WHERE kind = 'session_status' AND session_id = ? ORDER BY id DESC LIMIT 1")
      .pluck()
      .get(id);
    return JSON.parse(raw ?? "{}") as Record<string, unknown>;
  }

  it("abandons a leader_unverified orphan (200), via cli only when the client header says so, and lists orphans in /status", async () => {
    orphan(7, "leader_unverified");
    orphan(8, "leader_unverified");
    orphan(9, "reap_error");
    const server = await serve({ sessions: realManager().manager });

    const before = (await call(server, "/status")).json() as StatusBody;
    expect(before.orphaned).toEqual([
      { id: 7, agent: "wright", pgid: 2000000007, reason: "leader_unverified", updated_at: "2026-10-02T08:00:00.000Z" },
      { id: 8, agent: "wright", pgid: 2000000008, reason: "leader_unverified", updated_at: "2026-10-02T08:00:00.000Z" },
      { id: 9, agent: "wright", pgid: 2000000009, reason: "reap_error", updated_at: "2026-10-02T08:00:00.000Z" },
    ]);

    const viaCli = await call(server, "/sessions/7/abandon", { method: "POST", headers: { [CLIENT_HEADER]: "cli" } });
    expect(viaCli.status).toBe(200);
    expect(viaCli.json()).toEqual({ id: 7, status: "abandoned" });
    expect(lastStatusPayload(7)).toMatchObject({ from: "orphaned", to: "abandoned", by: "owner", via: "cli" });
    const viaApi = await call(server, "/sessions/8/abandon", { method: "POST" });
    expect(viaApi.json()).toEqual({ id: 8, status: "abandoned" });
    expect(lastStatusPayload(8)).toMatchObject({ to: "abandoned", by: "owner", via: "api" });

    // Abandoned rows are neither running sessions nor orphans.
    const after = (await call(server, "/status")).json() as StatusBody;
    expect(after.orphaned.map((o) => o.id)).toEqual([9]);
    expect(after.sessions).toEqual([]);
  });

  it("answers 409 with the stable code for a refusal, 404 for no such row, 400 for an id that is not a safe positive integer", async () => {
    orphan(9, "reap_error");
    store.prepare("INSERT INTO sessions (id, agent, status) VALUES (10, 'wright', 'interrupted')").run();
    const server = await serve({ sessions: realManager().manager });
    for (const id of [9, 10]) {
      const res = await call(server, `/sessions/${id}/abandon`, { method: "POST" });
      expect(res.status).toBe(409);
      expect(res.json()).toEqual({ error: "not_abandonable" });
    }
    const missing = await call(server, "/sessions/77/abandon", { method: "POST" });
    expect(missing.status).toBe(404);
    expect(missing.json()).toEqual({ error: "not_found" });
    for (const id of ["0", "9007199254740993", "00"]) {
      const res = await call(server, `/sessions/${id}/abandon`, { method: "POST" });
      expect(res.status, id).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_id" });
    }
    expect(store.prepare("SELECT status FROM sessions WHERE id = 9").pluck().get()).toBe("orphaned");
  });

  it("treats any other shape as an unknown path (404), and a GET as 405", async () => {
    const abandonSession = vi.fn(() => "abandoned" as const);
    const server = await serve({ sessions: { stopAll: async () => [], abandonSession } });
    for (const path of ["/sessions/abc/abandon", "/sessions/-1/abandon", "/sessions/7/abandon/x", "/sessions/7", "/sessions//abandon"]) {
      expect((await call(server, path, { method: "POST" })).status, path).toBe(404);
    }
    const get = await call(server, "/sessions/7/abandon");
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect(abandonSession).not.toHaveBeenCalled();
  });

  it("never echoes a refusal's message, only its code", async () => {
    const server = await serve({
      sessions: {
        stopAll: async () => [],
        abandonSession: () => {
          throw new SessionError("not_abandonable", "secret-ish detail /Users/someone");
        },
      },
    });
    const res = await call(server, "/sessions/3/abandon", { method: "POST" });
    expect(res.status).toBe(409);
    expect(res.text).toBe('{"error":"not_abandonable"}');
  });

  describe("an abandon queued behind a slow stop-all (owner fix-now)", () => {
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => (resolve = r));
      return { promise, resolve };
    }

    /** The server side of the next request for `path`, once its handler has run (Node's public `http.server.request.start` channel). */
    function arrival(path: string): Promise<{ readonly request: IncomingMessage; readonly response: ServerResponse }> {
      return new Promise((resolve) => {
        const onStart = (message: unknown): void => {
          const m = message as { readonly request: IncomingMessage; readonly response: ServerResponse };
          if (m.request.url !== path) return;
          unsubscribe("http.server.request.start", onStart);
          resolve(m);
        };
        subscribe("http.server.request.start", onStart);
      });
    }

    /** A real manager whose `stopAll` waits for `release`, with `abandonSession` spied. */
    async function blockedStopAll() {
      const { manager } = realManager();
      const entered = deferred<void>();
      const gate = deferred<void>();
      const abandonSession = vi.fn((id: number, options: { readonly via: AbandonVia }) => manager.abandonSession(id, options));
      const server = await serve({
        sessions: {
          stopAll: async () => {
            entered.resolve();
            await gate.promise;
            return manager.stopAll();
          },
          abandonSession,
        },
      });
      const stopping = call(server, "/stop-all", { method: "POST" });
      await entered.promise;
      return { server, abandonSession, stopping, release: () => gate.resolve() };
    }

    function sessionEvents(id: number): unknown[] {
      return store.prepare<[number], unknown>("SELECT * FROM events WHERE session_id = ? ORDER BY id").all(id);
    }

    it("never runs once its client has gone: no write, no event, and later POSTs still run", async () => {
      orphan(7, "leader_unverified");
      const { server, abandonSession, stopping, release } = await blockedStopAll();
      try {
        const rowBefore = row(7);
        const eventsBefore = sessionEvents(7);

        const arrived = arrival("/sessions/7/abandon");
        const client = new AbortController();
        const abandoning = fetch(`http://127.0.0.1:${server.port}/sessions/7/abandon`, {
          method: "POST",
          headers: { Authorization: `Bearer ${TOKEN}` },
          signal: client.signal,
        });
        const { response } = await arrived; // its handler has queued it behind the stop-all
        const closed = new Promise<void>((resolve) => response.once("close", () => resolve()));
        client.abort(); // the CLI giving up at its timeout
        await expect(abandoning).rejects.toThrow();
        await closed; // the server has seen the disconnect
        release();
        expect((await stopping).status).toBe(200);
        // /resume queues behind the abandon's turn: once it answers, that turn has run.
        const resumed = await call(server, "/resume", { method: "POST" });
        expect(resumed.status).toBe(200);
        expect(resumed.json()).toEqual({ engaged: false });

        expect(abandonSession).not.toHaveBeenCalled();
        expect(row(7)).toEqual(rowBefore);
        expect(sessionEvents(7)).toEqual(eventsBefore);
        // The queue is not broken: a connected abandon after it runs.
        const later = await call(server, "/sessions/7/abandon", { method: "POST" });
        expect(later.status).toBe(200);
        expect(abandonSession).toHaveBeenCalledTimes(1);
        expect(row(7).status).toBe("abandoned");
      } finally {
        release(); // a failed assertion must not leave close() waiting on the stop-all
      }
    });

    it("still runs for a client that is waiting, though its request already reads as destroyed", async () => {
      orphan(7, "leader_unverified");
      const { server, abandonSession, stopping, release } = await blockedStopAll();
      try {
        const arrived = arrival("/sessions/7/abandon");
        const abandoning = call(server, "/sessions/7/abandon", { method: "POST" });
        const { request } = await arrived;
        // Node closes the request once its (empty) body is read, with the client still connected.
        if (!request.destroyed) await new Promise<void>((resolve) => request.once("close", () => resolve()));
        expect(request.destroyed).toBe(true);
        release();
        expect((await stopping).status).toBe(200);
        const answer = await abandoning;
        expect(answer.status).toBe(200);
        expect(answer.json()).toEqual({ id: 7, status: "abandoned" });
        expect(abandonSession).toHaveBeenCalledTimes(1);
        expect(row(7).status).toBe("abandoned");
        expect(lastStatusPayload(7)).toMatchObject({ from: "orphaned", to: "abandoned", by: "owner", via: "api" });
      } finally {
        release();
      }
    });
  });
});
