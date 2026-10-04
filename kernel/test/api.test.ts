// The loopback API (item 08, AC1-AC3, AC5): a real server on 127.0.0.1 and an
// OS-assigned port, a temp data dir, and sessions on the fake spawner/query
// in session-fakes.ts. Never the real SDK, a model or the real Keychain.
import { mkdtempSync, rmSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startApiServer } from "../src/api/index.js";
import type { ApiServer, ApiServerOptions, StatusBody } from "../src/api/index.js";
import type { AuthProvider } from "../src/auth/index.js";
import { SessionManager } from "../src/sessions/index.js";
import type { SessionHandle, SessionRow } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { kernelVersion } from "../src/version.js";
import { fakeSessions, flush, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

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
      sessions: { stopAll: async () => [] },
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

async function call(server: ApiServer, path: string, init: { method?: string; auth?: string | null } = {}): Promise<Answer> {
  const headers: Record<string, string> = {};
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
  ];
  for (const [name, auth, method, path] of cases) {
    it(`answers 401 for ${name}, never echoing a token`, async () => {
      const loop = fakeLoop();
      const stopAll = vi.fn(async () => []);
      const server = await serve({ loop, sessions: { stopAll } });
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
