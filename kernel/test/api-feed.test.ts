// The live event feed (phase 5 item 02): `handleEventFeed` behind a real
// `startApiServer` on a temp-dir store, `ws` clients with the bearer token,
// and `GET /events` through the API. Events are appended with plain inserts
// (the feed reads `events` and nothing else). Real timers, except the 15 s
// heartbeat and the catch-up race, which fake only `setInterval`.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { startApiServer } from "../src/api/index.js";
import type { ApiServer, ApiServerOptions } from "../src/api/index.js";
import {
  DEFAULT_FEED_MAX_BUFFERED_BYTES,
  FEED_CLOSE_CODES,
  FEED_MAX_FRAME_BYTES,
  feedMaxBufferedBytes,
  feedTimersActive,
  setFeedMaxBufferedBytesForTesting,
} from "../src/api/feed.js";
import { consoleContribution } from "../src/console/index.js";
import { EVENT_PAGE_SIZE } from "../src/console/events.js";
import { PHASE1_RESERVED, mergeContributions } from "../src/features/index.js";
import { Store } from "../src/store/index.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const TOKEN = "0123456789abcdef".repeat(4);
const NOW = new Date("2026-10-21T10:00:00.000Z");
const AT = "2026-10-21T09:00:00.000Z";

let tmp: string;
let store: Store;
const servers: ApiServer[] = [];
const clients: WebSocket[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-api-feed-"));
  store = new Store({ dataDir: join(tmp, "data") });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setFeedMaxBufferedBytesForTesting(undefined);
  for (const c of clients.splice(0)) c.terminate();
  for (const s of servers.splice(0)) await s.close();
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function serve(overrides: Partial<ApiServerOptions> = {}): Promise<ApiServer> {
  const server = await startApiServer(
    {
      store,
      sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
      loop: { start: () => undefined, stop: async () => undefined },
      authProviders: [stubProvider()],
      token: TOKEN,
      port: 0,
      // The shipped console contribution's routes, as `startKernel` merges them: `GET /events`.
      routes: mergeContributions([consoleContribution], PHASE1_RESERVED).routes,
      ...overrides,
    },
    { now: () => NOW, startedAt: NOW, pid: 4242, dayOf: (d) => d.toISOString().slice(0, 10) },
  );
  servers.push(server);
  return server;
}

/** Append one event; its id. */
function insert(opts: { kind?: string; payload?: string | null; sessionId?: number | null; taskId?: number | null } = {}): number {
  const result = store
    .prepare("INSERT INTO events (at, kind, task_id, session_id, payload_json) VALUES (?, ?, ?, ?, ?)")
    .run(AT, opts.kind ?? "probe", opts.taskId ?? null, opts.sessionId ?? null, opts.payload === undefined ? "{}" : opts.payload);
  return Number(result.lastInsertRowid);
}

/** Append `n` events in one statement (`{"n": i}` payloads). */
function insertMany(n: number): void {
  store
    .prepare(
      "WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ?) INSERT INTO events (at, kind, payload_json) SELECT ?, 'bulk', json_object('n', i) FROM seq",
    )
    .run(n, AT);
}

type Frame = Record<string, unknown>;

interface Conn {
  readonly ws: WebSocket;
  readonly frames: Frame[];
  readonly closed: Promise<{ code: number; reason: string }>;
  isClosed(): boolean;
}

/** Open the feed with the token; resolves once the socket is open (or once it closed, whichever comes first). */
function open(server: ApiServer): Promise<Conn> {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/events/stream`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  clients.push(ws);
  const frames: Frame[] = [];
  let isClosed = false;
  ws.on("message", (data: Buffer) => frames.push(JSON.parse(data.toString("utf8")) as Frame));
  ws.on("error", () => {});
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on("close", (code: number, reason: Buffer) => {
      isClosed = true;
      resolve({ code, reason: reason.toString("utf8") });
    });
  });
  const conn: Conn = { ws, frames, closed, isClosed: () => isClosed };
  return new Promise((resolve) => {
    ws.on("open", () => resolve(conn));
    void closed.then(() => resolve(conn));
  });
}

async function subscribed(server: ApiServer, after: number): Promise<Conn> {
  const conn = await open(server);
  conn.ws.send(JSON.stringify({ type: "subscribe", after }));
  return conn;
}

function eventIds(conn: Conn): number[] {
  return conn.frames.filter((f) => f.type === EVENT_TYPE).map((f) => f.id as number);
}

/**
 * Retry `check` until it stops throwing, on real `setTimeout` (never faked
 * here). Not `vi.waitFor`: under fake timers it advances them on every
 * check, which would run the feed's poll and heartbeat behind the test's back.
 */
async function until(check: () => void, timeout = 5_000): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      check();
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForIds(conn: Conn, expected: number[], timeout = 5_000): Promise<void> {
  await until(() => expect(eventIds(conn)).toEqual(expected), timeout);
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

async function get(server: ApiServer, path: string, auth: string | null = `Bearer ${TOKEN}`): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { headers: auth === null ? {} : { Authorization: auth } });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as unknown };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// `app/src/api/contract.ts` is read as TEXT, never imported (as in
// console-contract.test.ts): the close codes and frame shapes below come from
// the contract itself, so a change there fails here instead of drifting.
const CONTRACT = new URL("../../app/src/api/contract.ts", import.meta.url);
const contractText = readFileSync(CONTRACT, "utf8");

/** `export const FEED_CLOSE_CODES = Object.freeze({ name: code, … } as const);`, refusing any other shape. */
function contractCloseCodes(text: string): Record<string, number> {
  const match = /export const FEED_CLOSE_CODES = Object\.freeze\(\{([^}]*)\} as const\);/.exec(text);
  if (match === null) throw new Error("contract.ts has no `export const FEED_CLOSE_CODES = Object.freeze({ … } as const);`");
  const codes: Record<string, number> = {};
  for (const entry of (match[1] ?? "").split(",").map((e) => e.trim()).filter((e) => e !== "")) {
    const pair = /^([A-Za-z]+): (\d+)$/.exec(entry);
    if (pair === null) throw new Error(`FEED_CLOSE_CODES entry is not \`name: code\`: ${entry}`);
    codes[pair[1] ?? ""] = Number(pair[2]);
  }
  return codes;
}

/** The fields of `export interface <name> { readonly field: type; … }`, in order, as [field, type text]; comment lines are skipped. */
function contractInterface(text: string, name: string): [string, string][] {
  const match = new RegExp(`export interface ${name} \\{([^}]*)\\}`).exec(text);
  if (match === null) throw new Error(`contract.ts has no \`export interface ${name} { … }\``);
  const fields: [string, string][] = [];
  for (const raw of (match[1] ?? "").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("/**") || line.startsWith("*") || line.startsWith("//")) continue;
    const field = /^readonly ([a-z_]+): (.+);$/.exec(line);
    if (field === null) throw new Error(`${name} line is not \`readonly field: type;\`: ${line}`);
    fields.push([field[1] ?? "", field[2] ?? ""]);
  }
  return fields;
}

const contractKeys = (name: string): string[] => contractInterface(contractText, name).map(([field]) => field);

/** The string literal a frame interface gives its `type` field. */
function contractTypeLiteral(name: string): string {
  const type = contractInterface(contractText, name).find(([field]) => field === "type")?.[1] ?? "";
  const literal = /^"([a-z]+)"$/.exec(type);
  if (literal === null) throw new Error(`${name}.type is not a string literal: ${type}`);
  return literal[1] ?? "";
}

const CLOSE = contractCloseCodes(contractText);
const EVENT_KEYS = contractKeys("EventFrame");
const TRUNCATED_KEYS = contractKeys("TruncatedEventFrame");
const HEARTBEAT_KEYS = contractKeys("HeartbeatFrame");
const EVENT_TYPE = contractTypeLiteral("EventFrame");
const HEARTBEAT_TYPE = contractTypeLiteral("HeartbeatFrame");

/**
 * Record every interval set from now on with its period, dropping it when
 * cleared: the feed's poll is the 250 ms one, its heartbeat the 15 s one.
 * Installed after `serve()`, so the HTTP server's own interval is not counted.
 */
function trackIntervals(): { live: () => number[] } {
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  const live = new Map<unknown, number>();
  vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void, ms?: number) => {
    const handle = realSet(fn, ms);
    live.set(handle, ms ?? 0);
    return handle;
  }) as typeof setInterval);
  vi.spyOn(globalThis, "clearInterval").mockImplementation(((handle: Parameters<typeof clearInterval>[0]) => {
    live.delete(handle);
    realClear(handle);
  }) as typeof clearInterval);
  return { live: () => [...live.values()].sort((a, b) => a - b) };
}

describe("the close codes and bounds", () => {
  it("equal the contract's FEED_CLOSE_CODES; 1 MiB frames; 500-row pages; an 8 MiB slow-client bound by default", () => {
    expect(FEED_CLOSE_CODES).toEqual(CLOSE);
    expect(Object.keys(FEED_CLOSE_CODES)).toEqual(Object.keys(CLOSE));
    expect(Object.isFrozen(FEED_CLOSE_CODES)).toBe(true);
    expect(FEED_MAX_FRAME_BYTES).toBe(1_048_576);
    expect(EVENT_PAGE_SIZE).toBe(500);
    expect(DEFAULT_FEED_MAX_BUFFERED_BYTES).toBe(8 * 1_048_576);
    expect(feedMaxBufferedBytes()).toBe(DEFAULT_FEED_MAX_BUFFERED_BYTES);
  });

  it("the contract's frame shapes, read as text, are the ones these tests hold the kernel to", () => {
    expect(CLOSE).toEqual({ tryAgainLater: 1013, tooSlow: 1011, malformedFrame: 1003 });
    expect(EVENT_KEYS).toEqual(["type", "id", "at", "kind", "session_id", "task_id", "payload"]);
    expect(TRUNCATED_KEYS).toEqual(["type", "id", "kind", "truncated"]);
    expect(HEARTBEAT_KEYS).toEqual(["type", "latest_id"]);
    expect(contractKeys("SubscribeFrame")).toEqual(["type", "after"]);
    expect(contractTypeLiteral("SubscribeFrame")).toBe("subscribe");
    expect(contractTypeLiteral("TruncatedEventFrame")).toBe(EVENT_TYPE);
    expect(contractInterface(contractText, "EventsResponse")).toEqual([["events", "readonly (EventFrame | TruncatedEventFrame)[]"]]);
  });

  it("the contract text readers fail loudly on a contract they can't read", () => {
    expect(() => contractCloseCodes("export const CODES = {};\n")).toThrow(/no `export const FEED_CLOSE_CODES/);
    expect(() => contractCloseCodes("export const FEED_CLOSE_CODES = Object.freeze({ tooSlow: \"1011\" } as const);\n")).toThrow(/not `name: code`/);
    expect(() => contractInterface("export interface Other {}\n", "EventFrame")).toThrow(/no `export interface EventFrame/);
    expect(() => contractInterface("export interface EventFrame {\n  type: \"event\";\n}\n", "EventFrame")).toThrow(/not `readonly field: type;`/);
  });

  it("the test-only bound setter refuses a negative or fractional bound and restores the default on undefined", () => {
    expect(() => setFeedMaxBufferedBytesForTesting(-1)).toThrow(RangeError);
    expect(() => setFeedMaxBufferedBytesForTesting(1.5)).toThrow(RangeError);
    setFeedMaxBufferedBytesForTesting(1024);
    expect(feedMaxBufferedBytes()).toBe(1024);
    setFeedMaxBufferedBytesForTesting(undefined);
    expect(feedMaxBufferedBytes()).toBe(DEFAULT_FEED_MAX_BUFFERED_BYTES);
  });
});

describe("subscribe, backlog and live (AC1)", () => {
  it("subscribe after 7 gets 8, 9 and 10 in order, each exactly the event frame, payload parsed (null for a null column)", async () => {
    for (let i = 1; i <= 7; i += 1) insert();
    insert({ kind: "approval_requested", payload: JSON.stringify({ a: 1, nested: { b: [true, "x"] } }), sessionId: 3, taskId: 5 });
    insert({ kind: "session_started", payload: null, sessionId: 4 });
    insert({ kind: "kill_switch_engaged", payload: JSON.stringify([1, "two"]), taskId: 9 });
    const server = await serve();
    const conn = await subscribed(server, 7);
    await waitForIds(conn, [8, 9, 10]);
    expect(conn.frames).toStrictEqual([
      { type: EVENT_TYPE, id: 8, at: AT, kind: "approval_requested", session_id: 3, task_id: 5, payload: { a: 1, nested: { b: [true, "x"] } } },
      { type: EVENT_TYPE, id: 9, at: AT, kind: "session_started", session_id: 4, task_id: null, payload: null },
      { type: EVENT_TYPE, id: 10, at: AT, kind: "kill_switch_engaged", session_id: null, task_id: 9, payload: [1, "two"] },
    ]);
    for (const frame of conn.frames) expect(Object.keys(frame)).toEqual(EVENT_KEYS);
    for (const frame of conn.frames) expect(frame.type).toBe(EVENT_TYPE);
    // Nothing else came first: a later append is the very next frame.
    insert();
    await waitForIds(conn, [8, 9, 10, 11]);
  });

  it("a stored payload that is not JSON is sent as its raw string, never dropped", async () => {
    insert({ payload: "not json {" });
    const server = await serve();
    const conn = await subscribed(server, 0);
    await waitForIds(conn, [1]);
    expect(conn.frames[0]).toMatchObject({ id: 1, payload: "not json {" });
  });

  it("each newly appended event arrives within 500 ms of its append", async () => {
    const server = await serve();
    const conn = await subscribed(server, 0);
    // The subscribe is in: an empty backlog sends nothing, so wait out one poll first.
    await sleep(300);
    for (const id of [1, 2, 3]) {
      const arrived = new Promise<number>((resolve) => conn.ws.once("message", () => resolve(performance.now())));
      const appended = performance.now();
      expect(insert()).toBe(id);
      const at = await Promise.race([arrived, sleep(2_000).then(() => Number.POSITIVE_INFINITY)]);
      expect(at - appended).toBeLessThan(500);
      await sleep(Math.floor(Math.random() * 100));
    }
    expect(eventIds(conn)).toEqual([1, 2, 3]);
  });

  it("a backlog of 1,201 events is read in pages of at most 500 and arrives complete and in order", async () => {
    insertMany(1_201);
    const server = await serve();
    // Every page the feed reads, by its row count.
    const pages: number[] = [];
    const prepare = store.prepare.bind(store);
    vi.spyOn(store, "prepare").mockImplementation(((sql: string) => {
      const statement = prepare(sql);
      if (sql.includes("FROM events WHERE id > ?")) {
        const all = statement.all.bind(statement);
        Object.assign(statement, {
          all: (...args: unknown[]) => {
            const rows = all(...(args as [number, number]));
            pages.push(rows.length);
            return rows;
          },
        });
      }
      return statement;
    }) as typeof store.prepare);
    const conn = await subscribed(server, 0);
    await waitForIds(conn, range(1, 1_201));
    expect(conn.frames.map((f) => (f.payload as { n: number }).n)).toEqual(range(1, 1_201));
    expect(pages.slice(0, 3)).toEqual([500, 500, 201]);
    expect(Math.max(...pages)).toBeLessThanOrEqual(500);
  });

  it("a connected client gets no events and no heartbeats before its subscribe frame", async () => {
    insert();
    const server = await serve();
    const conn = await open(server);
    insert();
    await sleep(400);
    expect(conn.frames).toEqual([]);
    expect(conn.isClosed()).toBe(false);
  });
});

describe("resume (AC2)", () => {
  it("a client that disconnects after 12 and resubscribes after 12 gets exactly 13, 14 and 15", async () => {
    for (let i = 1; i <= 12; i += 1) insert();
    const server = await serve();
    const first = await subscribed(server, 0);
    await waitForIds(first, range(1, 12));
    first.ws.close();
    await first.closed;
    for (let i = 13; i <= 15; i += 1) insert();
    const second = await subscribed(server, 12);
    await waitForIds(second, [13, 14, 15]);
    // None twice: the next append is the next frame.
    insert();
    await waitForIds(second, [13, 14, 15, 16]);
  });

  it("an event appended during a client's catch-up, while another live client keeps the hub's cursor behind, reaches each exactly once", async () => {
    const server = await serve();
    // Only the feed's intervals are fake: the poll runs when the test says so.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    insert();
    const live = await subscribed(server, 0);
    await waitForIds(live, [1]);
    // Appended after the hub's cursor (1), before the next poll.
    insert();
    insert();
    const catching = await subscribed(server, 0);
    await waitForIds(catching, [1, 2, 3]);
    // The poll now reads 2 and 3: the live client's, already the catching-up client's.
    vi.advanceTimersByTime(250);
    await waitForIds(live, [1, 2, 3]);
    insert();
    vi.advanceTimersByTime(250);
    await waitForIds(live, [1, 2, 3, 4]);
    await waitForIds(catching, [1, 2, 3, 4]);
  });

  it("a subscribe after an id past the newest stored one (50 of 3) gets no backlog, then the next append", async () => {
    insertMany(3);
    const server = await serve();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const conn = await subscribed(server, 50);
    // A heartbeat reaches only a live client: once it arrives, the subscribe was handled before the append below.
    await until(() => {
      vi.advanceTimersByTime(15_000);
      expect(conn.frames.filter((f) => f.type === HEARTBEAT_TYPE).length).toBeGreaterThan(0);
    });
    expect(eventIds(conn)).toEqual([]);
    insert();
    vi.advanceTimersByTime(250);
    await waitForIds(conn, [4]);
  });
});

describe("refusals (AC3)", () => {
  it("a fifth connected client is closed with 1013; the four stay open, and a freed slot takes a new client", async () => {
    const server = await serve();
    const four = [await open(server), await open(server), await open(server), await open(server)];
    const fifth = await open(server);
    expect(await fifth.closed).toEqual({ code: CLOSE.tryAgainLater, reason: "too many clients" });
    for (const conn of four) expect(conn.isClosed()).toBe(false);
    four[0]?.ws.close();
    await four[0]?.closed;
    insert();
    const sixth = await subscribed(server, 0);
    await waitForIds(sixth, [1]);
    expect(sixth.isClosed()).toBe(false);
  });

  const malformed: [string, (ws: WebSocket) => void][] = [
    ["not JSON", (ws) => ws.send("{nope")],
    ["not an object (a number)", (ws) => ws.send("42")],
    ["not an object (null)", (ws) => ws.send("null")],
    ["not an object (an array)", (ws) => ws.send(JSON.stringify([{ type: "subscribe", after: 0 }]))],
    ["not an object (a string)", (ws) => ws.send(JSON.stringify("subscribe"))],
    ["a type other than subscribe", (ws) => ws.send(JSON.stringify({ type: "unsubscribe", after: 0 }))],
    ["no type", (ws) => ws.send(JSON.stringify({ after: 0 }))],
    ["a negative after", (ws) => ws.send(JSON.stringify({ type: "subscribe", after: -1 }))],
    ["a fractional after", (ws) => ws.send(JSON.stringify({ type: "subscribe", after: 1.5 }))],
    ["a string after", (ws) => ws.send(JSON.stringify({ type: "subscribe", after: "3" }))],
    ["a null after", (ws) => ws.send(JSON.stringify({ type: "subscribe", after: null }))],
    ["no after", (ws) => ws.send(JSON.stringify({ type: "subscribe" }))],
    ["an after past the safe integers", (ws) => ws.send('{"type":"subscribe","after":9007199254740992}')],
    ["a binary frame", (ws) => ws.send(Buffer.from(JSON.stringify({ type: "subscribe", after: 0 })), { binary: true })],
  ];
  for (const [name, send] of malformed) {
    it(`a malformed frame (${name}) closes the socket with 1003 and sends no event`, async () => {
      insert();
      const server = await serve();
      const conn = await open(server);
      send(conn.ws);
      expect(await conn.closed).toEqual({ code: CLOSE.malformedFrame, reason: "malformed frame" });
      expect(conn.frames).toEqual([]);
      expect((await get(server, "/events?limit=1")).status).toBe(200);
    });
  }

  it("a malformed frame (a second frame after the subscribe) closes the socket with 1003", async () => {
    insert();
    const server = await serve();
    const conn = await subscribed(server, 0);
    await waitForIds(conn, [1]);
    conn.ws.send(JSON.stringify({ type: "subscribe", after: 0 }));
    expect(await conn.closed).toEqual({ code: CLOSE.malformedFrame, reason: "malformed frame" });
    expect(eventIds(conn)).toEqual([1]);
  });
});

describe("1 MiB frames and GET /events (AC4)", () => {
  /** A payload whose event frame (id `id`, kind `probe`, no refs) serializes to exactly `bytes` bytes. */
  function payloadForFrame(id: number, bytes: number): string {
    const frameOf = (blob: string): string =>
      JSON.stringify({ type: EVENT_TYPE, id, at: AT, kind: "probe", session_id: null, task_id: null, payload: { blob } });
    const blob = "x".repeat(bytes - Buffer.byteLength(frameOf("")));
    expect(Buffer.byteLength(frameOf(blob))).toBe(bytes);
    return JSON.stringify({ blob });
  }

  it("an event whose frame is over 1 MiB is sent truncated; GET /events?after=<id - 1>&limit=1 returns it in full", async () => {
    insert();
    const big = payloadForFrame(2, FEED_MAX_FRAME_BYTES + 1);
    insert({ payload: big });
    insert();
    const server = await serve();
    const conn = await subscribed(server, 0);
    await waitForIds(conn, [1, 2, 3]);
    expect(conn.frames[1]).toStrictEqual({ type: EVENT_TYPE, id: 2, kind: "probe", truncated: true });
    expect(Object.keys(conn.frames[1] ?? {}).sort()).toEqual([...TRUNCATED_KEYS].sort());
    expect(conn.frames[0]).toMatchObject({ id: 1, payload: {} });
    const answer = await get(server, "/events?after=1&limit=1");
    expect(answer.status).toBe(200);
    expect(answer.body).toStrictEqual({
      events: [{ type: EVENT_TYPE, id: 2, at: AT, kind: "probe", session_id: null, task_id: null, payload: JSON.parse(big) as unknown }],
    });
  });

  it("an event whose frame is exactly 1 MiB is sent in full", async () => {
    const exact = payloadForFrame(1, FEED_MAX_FRAME_BYTES);
    insert({ payload: exact });
    const server = await serve();
    const conn = await subscribed(server, 0);
    await waitForIds(conn, [1]);
    expect(conn.frames[0]).toStrictEqual({ type: EVENT_TYPE, id: 1, at: AT, kind: "probe", session_id: null, task_id: null, payload: JSON.parse(exact) as unknown });
  });

  it("GET /events returns {events}, the same frames, oldest first; an absent after is 0", async () => {
    insert({ kind: "a", payload: JSON.stringify({ x: 1 }), sessionId: 2 });
    insert({ kind: "b", payload: null, taskId: 7 });
    insert({ kind: "c" });
    const server = await serve();
    const answer = await get(server, "/events");
    expect(answer.status).toBe(200);
    expect(Object.keys(answer.body as object)).toEqual(contractKeys("EventsResponse"));
    for (const event of (answer.body as { events: Frame[] }).events) expect(Object.keys(event)).toEqual(EVENT_KEYS);
    expect(answer.body).toStrictEqual({
      events: [
        { type: EVENT_TYPE, id: 1, at: AT, kind: "a", session_id: 2, task_id: null, payload: { x: 1 } },
        { type: EVENT_TYPE, id: 2, at: AT, kind: "b", session_id: null, task_id: 7, payload: null },
        { type: EVENT_TYPE, id: 3, at: AT, kind: "c", session_id: null, task_id: null, payload: {} },
      ],
    });
  });

  it("GET /events with no limit returns 500 rows, from after; limit 500 is allowed", async () => {
    insertMany(600);
    const server = await serve();
    const ids = (body: unknown): number[] => (body as { events: { id: number }[] }).events.map((e) => e.id);
    expect(ids((await get(server, "/events")).body)).toEqual(range(1, 500));
    expect(ids((await get(server, "/events?after=500")).body)).toEqual(range(501, 600));
    expect(ids((await get(server, "/events?after=3&limit=2")).body)).toEqual([4, 5]);
    expect(ids((await get(server, "/events?after=0&limit=500")).body)).toEqual(range(1, 500));
    expect(ids((await get(server, "/events?after=600")).body)).toEqual([]);
  });

  for (const after of ["x", "-1", "1.5", "", "01", "1e3", "9007199254740993", "99999999999999999"]) {
    it(`GET /events?after=${after} is 400 invalid_after`, async () => {
      const server = await serve();
      expect(await get(server, `/events?after=${after}`)).toEqual({ status: 400, body: { error: "invalid_after" } });
    });
  }

  for (const limit of ["0", "501", "5000", "abc", "-1", "", "1.5"]) {
    it(`GET /events?limit=${limit} is 400 invalid_limit`, async () => {
      const server = await serve();
      expect(await get(server, `/events?limit=${limit}`)).toEqual({ status: 400, body: { error: "invalid_limit" } });
    });
  }

  it("GET /events needs the token, like every route", async () => {
    insert();
    const server = await serve();
    expect(await get(server, "/events", null)).toEqual({ status: 401, body: { error: "unauthorized" } });
  });
});

describe("timers and slow clients (AC5)", () => {
  it("no poll timer runs while no client is connected: before the first, and after the last closes", async () => {
    const server = await serve();
    const intervals = trackIntervals();
    expect(intervals.live()).not.toContain(250);
    expect(feedTimersActive(store).poll).toBe(false);
    const a = await subscribed(server, 0);
    const b = await open(server);
    expect(intervals.live().filter((ms) => ms === 250)).toEqual([250]);
    a.ws.close();
    await a.closed;
    await sleep(50);
    expect(intervals.live().filter((ms) => ms === 250)).toEqual([250]);
    b.ws.close();
    await b.closed;
    await until(() => expect(intervals.live()).not.toContain(250), 2_000);
    expect(feedTimersActive(store).poll).toBe(false);
    // And again on the next connect: one poll, not two.
    const c = await open(server);
    expect(intervals.live().filter((ms) => ms === 250)).toEqual([250]);
    c.ws.close();
    await c.closed;
    await until(() => expect(intervals.live()).not.toContain(250), 2_000);
  });

  it("no heartbeat timer runs while no client is connected: before the first, and after the last closes", async () => {
    const server = await serve();
    const intervals = trackIntervals();
    expect(intervals.live()).not.toContain(15_000);
    const a = await subscribed(server, 0);
    expect(intervals.live().filter((ms) => ms === 15_000)).toEqual([15_000]);
    expect(feedTimersActive(store)).toEqual({ poll: true, heartbeat: true });
    a.ws.close();
    await a.closed;
    await until(() => expect(intervals.live()).not.toContain(15_000), 2_000);
    expect(feedTimersActive(store)).toEqual({ poll: false, heartbeat: false });
  });

  it("no timer runs after api.close() terminates the last client", async () => {
    const server = await serve();
    const intervals = trackIntervals();
    const a = await subscribed(server, 0);
    const b = await open(server);
    expect(intervals.live()).toEqual([250, 15_000]);
    await server.close();
    await a.closed;
    await b.closed;
    await until(() => expect(intervals.live()).toEqual([]), 2_000);
    expect(feedTimersActive(store)).toEqual({ poll: false, heartbeat: false });
  });

  it("a live client gets a heartbeat with latest_id every 15 s; an unsubscribed one gets none", async () => {
    insert();
    insert();
    const server = await serve();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const conn = await subscribed(server, 0);
    const idle = await open(server);
    await waitForIds(conn, [1, 2]);
    insert();
    vi.advanceTimersByTime(14_999);
    await waitForIds(conn, [1, 2, 3]);
    await sleep(50);
    expect(conn.frames.filter((f) => f.type === HEARTBEAT_TYPE)).toEqual([]);
    vi.advanceTimersByTime(1);
    await until(() => expect(conn.frames.filter((f) => f.type === HEARTBEAT_TYPE)).toEqual([{ type: HEARTBEAT_TYPE, latest_id: 3 }]), 2_000);
    insert();
    vi.advanceTimersByTime(15_000);
    await until(
      () =>
        expect(conn.frames.filter((f) => f.type === HEARTBEAT_TYPE)).toEqual([
          { type: HEARTBEAT_TYPE, latest_id: 3 },
          { type: HEARTBEAT_TYPE, latest_id: 4 },
        ]),
      2_000,
    );
    for (const hb of conn.frames.filter((f) => f.type === HEARTBEAT_TYPE)) expect(Object.keys(hb)).toEqual(HEARTBEAT_KEYS);
    // The heartbeat never names an event the client was not sent first.
    expect(conn.frames.map((f) => (f.type === EVENT_TYPE ? f.id : `hb${String(f.latest_id)}`))).toEqual([1, 2, 3, "hb3", 4, "hb4"]);
    await sleep(50);
    expect(idle.frames).toEqual([]);
  });

  /** Server-side feed sockets report `extra` more unsent bytes than they have (the client sockets here report the truth). */
  function inflateServerBufferedAmount(extra: number): void {
    const real = Object.getOwnPropertyDescriptor(WebSocket.prototype, "bufferedAmount")?.get;
    if (real === undefined) throw new Error("ws has no bufferedAmount getter");
    vi.spyOn(WebSocket.prototype, "bufferedAmount", "get").mockImplementation(function (this: WebSocket): number {
      const actual = real.call(this) as number;
      return clients.includes(this) ? actual : actual + extra;
    });
  }

  it("a client whose unsent backlog passes the bound is closed with 1011 and resumes from its last id", async () => {
    insert();
    insert();
    insert();
    const server = await serve();
    setFeedMaxBufferedBytesForTesting(1_024);
    inflateServerBufferedAmount(2_048);
    const slow = await subscribed(server, 0);
    expect(await slow.closed).toEqual({ code: CLOSE.tooSlow, reason: "too slow" });
    expect(eventIds(slow)).toEqual([]);
    // Under the bound (the default), the same unsent backlog is fine.
    setFeedMaxBufferedBytesForTesting(undefined);
    const ok = await subscribed(server, 0);
    await waitForIds(ok, [1, 2, 3]);
    expect(ok.isClosed()).toBe(false);
  });
});

describe("the kill switch and stopping (AC6)", () => {
  it("POST /stop-all answers 200 while a client is subscribed; the client gets both events live and stays open", async () => {
    const server = await serve();
    const conn = await subscribed(server, 0);
    await sleep(50);
    const res = await fetch(`http://127.0.0.1:${server.port}/stop-all`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } });
    await res.text();
    expect(res.status).toBe(200);
    await until(() => expect(conn.frames.map((f) => f.kind)).toEqual(["kill_switch_engaged", "stop_all_completed"]), 3_000);
    // Still streaming, not just still open.
    const next = insert();
    await until(() => expect(eventIds(conn).at(-1)).toBe(next), 3_000);
    expect(conn.isClosed()).toBe(false);
    expect(conn.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("api.close() then store.close() with a client subscribed: both resolve, the socket closes, no timer is left", async () => {
    const server = await serve();
    const intervals = trackIntervals();
    const conn = await subscribed(server, 0);
    insert();
    await waitForIds(conn, [1]);
    await server.close();
    store.close();
    await conn.closed;
    await until(() => expect(intervals.live()).toEqual([]), 2_000);
    // Past several poll periods: nothing ticks, nothing throws.
    await sleep(600);
    expect(intervals.live()).toEqual([]);
    expect(feedTimersActive(store)).toEqual({ poll: false, heartbeat: false });
  });

  it("store.close() under a subscribed client with the API open: the next poll stops the hub quietly (1001, timers cleared)", async () => {
    const server = await serve();
    const intervals = trackIntervals();
    const conn = await subscribed(server, 0);
    insert();
    await waitForIds(conn, [1]);
    store.close();
    expect(await conn.closed).toEqual({ code: 1001, reason: "feed stopped" });
    expect(intervals.live()).toEqual([]);
    expect(feedTimersActive(store)).toEqual({ poll: false, heartbeat: false });
    // A new socket on the closed store is closed the same way, never a crash.
    const late = await open(server);
    expect(await late.closed).toEqual({ code: 1001, reason: "feed stopped" });
    await sleep(600);
    expect(intervals.live()).toEqual([]);
  });
});
