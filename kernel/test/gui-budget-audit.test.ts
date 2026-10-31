// Phase 7 item 07: the `gui` feature's `budget-audit` part. `GET /budget/usage`
// and `GET /audit` against a real store, through a real API server (so the
// query string is parsed as in the daemon). Never the SDK or a model.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startApiServer } from "../src/api/index.js";
import type { ApiServer } from "../src/api/index.js";
import { localDay } from "../src/budget/internal.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import { GUI_PARTS, budgetAuditPart, budgetAuditRoutes } from "../src/gui/index.js";
import { appendEvent } from "../src/loop/internal.js";
import { loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const TOKEN = "0123456789abcdef".repeat(4);
const NOW = "2026-10-14T12:00:00.000Z";

let env: LoopEnv;
let server: ApiServer;

beforeEach(async () => {
  env = loopEnv(NOW);
  server = await startApiServer(
    {
      store: env.store,
      sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
      loop: { start: () => {}, stop: async () => {} },
      authProviders: [stubProvider()],
      token: TOKEN,
      routes: mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).routes,
    },
    { now: () => env.now() },
  );
});

afterEach(async () => {
  await server.close();
  env.cleanup();
});

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return { status: res.status, body: await res.json() };
}

/** The host's local day `n` days before the clock's today, as the route computes it. */
function dayAgo(n: number): string {
  const now = env.now();
  return localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
}

function playbook(slug: string, limit: number | null = null): number {
  return Number(
    env.store
      .prepare("INSERT INTO playbooks (slug, name, owning_agent, intent, token_limit_per_day) VALUES (?, ?, 'wright', 'do it', ?)")
      .run(slug, slug, limit).lastInsertRowid,
  );
}

function session(agent: string, status: string, playbookId: number | null = null): number {
  return Number(env.store.prepare("INSERT INTO sessions (agent, status, playbook) VALUES (?, ?, ?)").run(agent, status, playbookId).lastInsertRowid);
}

interface Spend {
  readonly day: string;
  readonly agent: string | null;
  readonly playbook?: string | null;
  readonly input?: number;
  readonly output?: number;
  readonly cacheWrite?: number;
  readonly cacheRead?: number;
  readonly cost?: number | null;
}

function spend(s: Spend): void {
  env.store
    .prepare(
      "INSERT INTO budget (day, agent, playbook, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd) VALUES (?, ?, ?, 'm', ?, ?, ?, ?, ?)",
    )
    .run(s.day, s.agent, s.playbook ?? null, s.input ?? 0, s.output ?? 0, s.cacheWrite ?? 0, s.cacheRead ?? 0, s.cost ?? null);
}

/** Write `<dataDir>/config/agents/<id>.json`. */
function writeSettings(id: string, extra: Record<string, unknown>): void {
  const file = join(env.dataDir, "config", "agents", `${id}.json`);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ model: "claude-haiku-4-5", permission_mode: "default", tool_policy: { allowedTools: [], allowedBashPrefixes: [] }, ...extra }, null, 2)}\n`);
}

function crewMember(id: string): void {
  env.store
    .prepare("INSERT INTO agents (id, display_name, avatar_shape, avatar_hue, created_by, charter_json) VALUES (?, ?, 'crab', 'crew-teal', 'owner', '{}')")
    .run(id, id);
}

function cap(account: string, type: string, status: string, resetsAt: string | null, utilization: number | null, source: string | null): void {
  env.store
    .prepare("INSERT INTO cap_state (account, rate_limit_type, status, resets_at, utilization, reset_source) VALUES (?, ?, ?, ?, ?, ?)")
    .run(account, type, status, resetsAt, utilization, source);
}

describe("the budget-audit part (phase 7 item 07)", () => {
  it("is the fifth gui part, holds exactly the two owner routes, and none is unauthenticated", () => {
    expect(GUI_PARTS[4]).toBe(budgetAuditPart);
    expect(budgetAuditPart.name).toBe("budget-audit");
    expect(budgetAuditPart.routes).toBe(budgetAuditRoutes);
    expect(Object.isFrozen(budgetAuditRoutes)).toBe(true);
    expect(budgetAuditRoutes.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /budget/usage", "GET /audit"]);
    expect(budgetAuditRoutes.filter((r) => r.unauthenticated === true)).toEqual([]);
  });

  it("needs the API token", async () => {
    for (const path of ["/budget/usage", "/audit"]) {
      expect((await fetch(`http://127.0.0.1:${server.port}${path}`)).status).toBe(401);
    }
  });
});

describe("GET /budget/usage: rows", () => {
  function seed(): void {
    const review = playbook("review");
    const triage = playbook("triage");
    const today = dayAgo(0);
    // today, Wright, review: two rows that group together
    spend({ day: today, agent: "wright", playbook: String(review), input: 100, output: 50, cacheWrite: 10, cacheRead: 1_000, cost: 0.5 });
    spend({ day: today, agent: "wright", playbook: String(review), input: 30, output: 10, cacheRead: 5 });
    // today, scout, outside any playbook, no cost recorded
    spend({ day: today, agent: "scout", input: 5 });
    // yesterday: a playbook that exists, and a stored playbook that names none
    spend({ day: dayAgo(1), agent: "wright", playbook: String(triage), input: 7 });
    spend({ day: dayAgo(1), agent: "wright", playbook: "999", output: 3, cost: 0.25 });
    spend({ day: dayAgo(2), agent: "scout", input: 11 });
    // three days ago: outside a 3-day window
    spend({ day: dayAgo(3), agent: "wright", input: 9_000 });
  }

  it("groups by day, agent and playbook, newest day first, counting per D26", async () => {
    seed();
    const { status, body } = await get("/budget/usage?days=3");
    expect(status).toBe(200);
    expect(body.rows).toEqual([
      // agent NULLs would sort first; within a day by agent, then playbook
      { day: dayAgo(0), agent: "scout", playbook: null, counted_tokens: 5, cache_read_tokens: 0, cost_estimate_usd: null },
      // 100 + 50 + 10 and 30 + 10: cache reads (1005) are reported beside, never added
      { day: dayAgo(0), agent: "wright", playbook: "review", counted_tokens: 200, cache_read_tokens: 1_005, cost_estimate_usd: 0.5 },
      { day: dayAgo(1), agent: "wright", playbook: "999", counted_tokens: 3, cache_read_tokens: 0, cost_estimate_usd: 0.25 },
      { day: dayAgo(1), agent: "wright", playbook: "triage", counted_tokens: 7, cache_read_tokens: 0, cost_estimate_usd: null },
      { day: dayAgo(2), agent: "scout", playbook: null, counted_tokens: 11, cache_read_tokens: 0, cost_estimate_usd: null },
    ]);
  });

  it("leaves out a row older than the window and takes it back as the window grows", async () => {
    seed();
    const days = async (n: string): Promise<string[]> => [...new Set<string>((await get(`/budget/usage?days=${n}`)).body.rows.map((r: { day: string }) => r.day))];
    expect(await days("1")).toEqual([dayAgo(0)]);
    expect(await days("3")).toEqual([dayAgo(0), dayAgo(1), dayAgo(2)]);
    expect(await days("4")).toEqual([dayAgo(0), dayAgo(1), dayAgo(2), dayAgo(3)]);
    // default 7 days
    expect((await get("/budget/usage")).body.rows).toHaveLength(6);
  });

  it("keeps the day totals equal to the budget rows, the unknown-playbook row included", async () => {
    seed();
    const { body } = await get("/budget/usage?days=90");
    const total = (body.rows as { counted_tokens: number }[]).reduce((sum, r) => sum + r.counted_tokens, 0);
    const stored = env.store.prepare<[], number>("SELECT SUM(counted_tokens) FROM budget").pluck().get();
    expect(total).toBe(stored);
  });

  it("answers the cost estimate as null only when every cost in the group is null", async () => {
    const today = dayAgo(0);
    spend({ day: today, agent: "wright", input: 1 });
    spend({ day: today, agent: "wright", input: 1 });
    expect((await get("/budget/usage")).body.rows[0].cost_estimate_usd).toBeNull();
    spend({ day: today, agent: "wright", input: 1, cost: 0 });
    expect((await get("/budget/usage")).body.rows[0].cost_estimate_usd).toBe(0);
  });

  it("sorts a row with no agent first", async () => {
    spend({ day: dayAgo(0), agent: "wright", input: 1 });
    spend({ day: dayAgo(0), agent: null, input: 2 });
    expect((await get("/budget/usage")).body.rows.map((r: { agent: string | null }) => r.agent)).toEqual([null, "wright"]);
  });

  it.each(["0", "91", "x", "1.5", "-1", "", "01", "1e1", "9999999999999999999999"])("refuses days=%j with 400 invalid_days", async (days) => {
    expect(await get(`/budget/usage?days=${days}`)).toEqual({ status: 400, body: { error: "invalid_days" } });
  });

  it("accepts the ends of the range", async () => {
    expect((await get("/budget/usage?days=1")).status).toBe(200);
    expect((await get("/budget/usage?days=90")).status).toBe(200);
  });

  it("answers empty rows and only Wright's limit on an empty store", async () => {
    const { status, body } = await get("/budget/usage");
    expect(status).toBe(200);
    expect(body.rows).toEqual([]);
    expect(body.cap_state).toEqual([]);
    expect(body.limits).toEqual([{ scope: "agent", id: "wright", tokens_today: 0, tokens_per_day: null, sessions_running: 0, sessions_at_once: null }]);
  });

  it("writes nothing", async () => {
    seed();
    const before = env.store.prepare<[], number>("SELECT (SELECT COUNT(*) FROM budget) + (SELECT COUNT(*) FROM events) + (SELECT COUNT(*) FROM sessions)").pluck().get();
    await get("/budget/usage?days=30");
    await get("/audit");
    expect(env.store.prepare<[], number>("SELECT (SELECT COUNT(*) FROM budget) + (SELECT COUNT(*) FROM events) + (SELECT COUNT(*) FROM sessions)").pluck().get()).toBe(before);
  });
});

describe("GET /budget/usage: limits", () => {
  it("reports an agent at its daily limit with tokens_today equal to tokens_per_day", async () => {
    writeSettings("wright", { limits: { tokens_per_day: 200, sessions_at_once: 2 } });
    spend({ day: dayAgo(0), agent: "wright", input: 150, output: 40, cacheWrite: 10, cacheRead: 9_999 });
    spend({ day: dayAgo(1), agent: "wright", input: 5_000 }); // yesterday never counts toward today
    session("wright", "running");
    session("wright", "completed");
    const { body } = await get("/budget/usage");
    expect(body.limits[0]).toEqual({ scope: "agent", id: "wright", tokens_today: 200, tokens_per_day: 200, sessions_running: 1, sessions_at_once: 2 });
  });

  it("lists Wright first, then the members in id order, then the playbooks in id order", async () => {
    crewMember("mason");
    crewMember("ada");
    writeSettings("ada", { limits: { tokens_per_day: 1_000 } });
    playbook("zeta");
    playbook("alpha");
    const { body } = await get("/budget/usage");
    expect(body.limits.map((l: { scope: string; id: string }) => `${l.scope}:${l.id}`)).toEqual(["agent:wright", "agent:ada", "agent:mason", "playbook:zeta", "playbook:alpha"]);
    expect(body.limits[1]).toMatchObject({ id: "ada", tokens_per_day: 1_000, sessions_at_once: null });
    // an agent whose settings file is missing reads as no limit, never a throw
    expect(body.limits[2]).toMatchObject({ id: "mason", tokens_per_day: null, sessions_at_once: null });
  });

  it("reads a playbook's limit, today's counted tokens by the meter's own query, and its running sessions", async () => {
    const review = playbook("review", 150);
    const triage = playbook("triage");
    const damaged = playbook("damaged", -5);
    spend({ day: dayAgo(0), agent: "wright", playbook: String(review), input: 100, output: 50, cacheRead: 77 });
    spend({ day: dayAgo(1), agent: "wright", playbook: String(review), input: 400 });
    spend({ day: dayAgo(0), agent: "wright", playbook: String(triage), input: 5 });
    session("wright", "running", review);
    session("wright", "starting", review);
    session("wright", "completed", review);
    session("wright", "running", triage);
    const { body } = await get("/budget/usage");
    const playbooks = body.limits.filter((l: { scope: string }) => l.scope === "playbook");
    expect(playbooks).toEqual([
      { scope: "playbook", id: "review", tokens_today: 150, tokens_per_day: 150, sessions_running: 2, sessions_at_once: null },
      { scope: "playbook", id: "triage", tokens_today: 5, tokens_per_day: null, sessions_running: 1, sessions_at_once: null },
      // a damaged stored limit reads as none
      { scope: "playbook", id: "damaged", tokens_today: 0, tokens_per_day: null, sessions_running: 0, sessions_at_once: null },
    ]);
    expect(damaged).toBeGreaterThan(0);
  });
});

describe("GET /budget/usage: cap_state", () => {
  it("groups the stored windows by provider, with every field as stored", async () => {
    cap("stub-provider", "seven_day", "allowed_warning", "2026-10-20T00:00:00.000Z", 0.85, "event");
    cap("stub-provider", "five_hour", "allowed", "2026-10-14T15:00:00.000Z", 0.4, "event");
    cap("other-provider", "five_hour", "rejected", "2026-10-14T13:00:00.000Z", null, "recheck");
    const { body } = await get("/budget/usage");
    expect(body.cap_state).toEqual([
      {
        account: "other-provider",
        provider: "other-provider",
        limits: [{ rate_limit_type: "five_hour", status: "rejected", resets_at: "2026-10-14T13:00:00.000Z", utilization: null, reset_source: "recheck" }],
      },
      {
        account: "stub-provider",
        provider: "stub-provider",
        limits: [
          { rate_limit_type: "five_hour", status: "allowed", resets_at: "2026-10-14T15:00:00.000Z", utilization: 0.4, reset_source: "event" },
          { rate_limit_type: "seven_day", status: "allowed_warning", resets_at: "2026-10-20T00:00:00.000Z", utilization: 0.85, reset_source: "event" },
        ],
      },
    ]);
  });

  it("answers the same windows GET /status does (labels aside)", async () => {
    cap("stub-provider", "five_hour", "allowed", "2026-10-14T15:00:00.000Z", 0.4, "event");
    const status = (await get("/status")).body.cap_state as { provider: string; limits: unknown }[];
    const usage = (await get("/budget/usage")).body.cap_state as { provider: string; limits: unknown }[];
    expect(usage.map((c) => ({ provider: c.provider, limits: c.limits }))).toEqual(status.map((c) => ({ provider: c.provider, limits: c.limits })));
  });
});

// ---- GET /audit --------------------------------------------------------------------

interface Seeded {
  readonly [name: string]: number;
}

/** Seven events across a week, linked to sessions or naming agent and playbook only in the payload; one with a payload that is not JSON. */
function seedEvents(): Seeded {
  const review = playbook("review");
  const triage = playbook("triage");
  const s1 = session("wright", "completed", review);
  const s2 = session("scout", "completed", triage);
  const s3 = session("scout", "completed");
  const add = (kind: string, at: string, sessionId: number | null, payload: unknown): number => {
    appendEvent(env.store, kind, { taskId: null, sessionId }, payload as Record<string, unknown>, at);
    return env.store.prepare<[], number>("SELECT max(id) FROM events").pluck().get() as number;
  };
  const e1 = add("notify", "2026-10-08T09:00:00.000Z", s1, { text: "one" });
  const e2 = add("budget_limit_reached", "2026-10-09T09:00:00.000Z", null, { agent: "scout" });
  const e3 = add("admission_refused", "2026-10-10T09:00:00.000Z", s2, { reason: "agent_daily_limit" });
  const e4 = add("admission_refused", "2026-10-11T09:00:00.000Z", null, { playbook: review });
  const e5 = add("notify", "2026-10-12T09:00:00.000Z", null, { playbook: "triage" });
  const e6 = Number(
    env.store.prepare("INSERT INTO events (at, kind, actor, session_id, payload_json) VALUES ('2026-10-13T09:00:00.000Z', 'malformed_kind', 'kernel', ?, 'not json{')").run(s1).lastInsertRowid,
  );
  const e7 = add("notify", "2026-10-14T11:00:00.000Z", s3, [1, 2]);
  return { e1, e2, e3, e4, e5, e6, e7, review, triage };
}

const ids = (body: { events: { id: number }[] }): number[] => body.events.map((e) => e.id);

describe("GET /audit: filters", () => {
  it("answers every event newest first, as event frames", async () => {
    const e = seedEvents();
    const { status, body } = await get("/audit");
    expect(status).toBe(200);
    expect(ids(body)).toEqual([e.e7, e.e6, e.e5, e.e4, e.e3, e.e2, e.e1]);
    expect(body.next_before).toBeNull();
    expect(body.events.at(-1)).toEqual({ type: "event", id: e.e1, at: "2026-10-08T09:00:00.000Z", kind: "notify", session_id: 1, task_id: null, payload: { text: "one" } });
    // a payload that is not JSON is passed on as the stored text, never a throw
    expect(body.events.find((f: { id: number }) => f.id === e.e6).payload).toBe("not json{");
  });

  it("answers an empty page for an empty log", async () => {
    expect(await get("/audit")).toEqual({ status: 200, body: { events: [], next_before: null } });
  });

  it("filters by kind, exactly", async () => {
    const e = seedEvents();
    expect(ids((await get("/audit?kind=notify")).body)).toEqual([e.e7, e.e5, e.e1]);
    expect(ids((await get("/audit?kind=notif")).body)).toEqual([]);
    expect(ids((await get("/audit?kind=Notify")).body)).toEqual([]);
  });

  it("returns the malformed-payload row when it matches by kind, and still answers 200", async () => {
    const e = seedEvents();
    const { status, body } = await get("/audit?kind=malformed_kind");
    expect(status).toBe(200);
    expect(ids(body)).toEqual([e.e6]);
  });

  it("filters by agent through the event's session or the payload's agent", async () => {
    const e = seedEvents();
    // e6 and e1 are session 1's (wright); the malformed e6 matches through its session
    expect(ids((await get("/audit?agent=wright")).body)).toEqual([e.e6, e.e1]);
    // e2 names scout only in its payload; e3 and e7 are scout sessions'
    expect(ids((await get("/audit?agent=scout")).body)).toEqual([e.e7, e.e3, e.e2]);
    expect(ids((await get("/audit?agent=nobody")).body)).toEqual([]);
  });

  it("filters by playbook slug through the event's session or the payload's id or slug", async () => {
    const e = seedEvents();
    // review: session 1's e6 and e1, and e4 naming the playbook's id
    expect(ids((await get("/audit?playbook=review")).body)).toEqual([e.e6, e.e4, e.e1]);
    // triage: session 2's e3, and e5 naming the slug
    expect(ids((await get("/audit?playbook=triage")).body)).toEqual([e.e5, e.e3]);
  });

  it("answers an empty page for an unknown playbook slug", async () => {
    seedEvents();
    expect(await get("/audit?playbook=nope")).toEqual({ status: 200, body: { events: [], next_before: null } });
  });

  it("combines filters with AND", async () => {
    const e = seedEvents();
    expect(ids((await get("/audit?kind=admission_refused&playbook=triage")).body)).toEqual([e.e3]);
    expect(ids((await get("/audit?kind=notify&agent=scout")).body)).toEqual([e.e7]);
    expect(ids((await get("/audit?agent=wright&playbook=triage")).body)).toEqual([]);
    expect(ids((await get("/audit?agent=scout&playbook=triage&kind=admission_refused")).body)).toEqual([e.e3]);
  });

  it("filters by time, both bounds inclusive, offsets normalized", async () => {
    const e = seedEvents();
    // since is e3's exact instant and until is e5's: both events are in
    expect(ids((await get("/audit?since=2026-10-10T09:00:00.000Z&until=2026-10-12T09:00:00.000Z")).body)).toEqual([e.e5, e.e4, e.e3]);
    expect(ids((await get("/audit?since=2026-10-10T09:00:00.001Z&until=2026-10-12T08:59:59.999Z")).body)).toEqual([e.e4]);
    // 11:00+02:00 is 09:00Z
    expect(ids((await get("/audit?since=2026-10-13T11:00:00%2B02:00")).body)).toEqual([e.e7, e.e6]);
    expect(ids((await get("/audit?until=2026-10-09T09:00:00Z")).body)).toEqual([e.e2, e.e1]);
    // a one-instant range
    expect(ids((await get("/audit?since=2026-10-11T09:00:00Z&until=2026-10-11T09:00:00Z")).body)).toEqual([e.e4]);
  });

  it("treats a hostile filter value as data", async () => {
    seedEvents();
    for (const q of ["kind=%27%20OR%201%3D1%20--", "agent=%27)%20OR%201%3D1%20--", "playbook=%27%20OR%201%3D1%20--"]) {
      expect(await get(`/audit?${q}`)).toEqual({ status: 200, body: { events: [], next_before: null } });
    }
  });
});

describe("GET /audit: paging", () => {
  it("pages newest first with next_before, neither overlapping nor skipping", async () => {
    const e = seedEvents();
    const first = (await get("/audit?limit=3")).body;
    expect(ids(first)).toEqual([e.e7, e.e6, e.e5]);
    expect(first.next_before).toBe(String(e.e5));
    const second = (await get(`/audit?limit=3&before=${first.next_before}`)).body;
    expect(ids(second)).toEqual([e.e4, e.e3, e.e2]);
    expect(second.next_before).toBe(String(e.e2));
    const third = (await get(`/audit?limit=3&before=${second.next_before}`)).body;
    expect(ids(third)).toEqual([e.e1]);
    expect(third.next_before).toBeNull();
  });

  it("pages a filtered log by the same cursor", async () => {
    const e = seedEvents();
    const first = (await get("/audit?kind=notify&limit=2")).body;
    expect(ids(first)).toEqual([e.e7, e.e5]);
    expect(first.next_before).toBe(String(e.e5));
    const second = (await get(`/audit?kind=notify&limit=2&before=${first.next_before}`)).body;
    expect(ids(second)).toEqual([e.e1]);
    expect(second.next_before).toBeNull();
  });

  it("gives a full page a cursor, and the page after it is empty with none", async () => {
    const e = seedEvents();
    const full = (await get("/audit?limit=7")).body;
    expect(ids(full)).toHaveLength(7);
    expect(full.next_before).toBe(String(e.e1));
    expect(await get(`/audit?limit=7&before=${full.next_before}`)).toEqual({ status: 200, body: { events: [], next_before: null } });
  });

  it("takes limit 1 to 200 and defaults to 50", async () => {
    for (let i = 0; i < 205; i++) appendEvent(env.store, "bulk", { taskId: null, sessionId: null }, { i }, NOW);
    expect((await get("/audit")).body.events).toHaveLength(50);
    expect((await get("/audit?limit=1")).body.events).toHaveLength(1);
    expect((await get("/audit?limit=200")).body.events).toHaveLength(200);
  });
});

describe("GET /audit: refusals", () => {
  it.each(["0", "201", "x", "-1", "1.5", "", "01"])("refuses limit=%j with 400 invalid_limit", async (limit) => {
    expect(await get(`/audit?limit=${limit}`)).toEqual({ status: 400, body: { error: "invalid_limit" } });
  });

  it.each(["0", "x", "-1", "1.5", "", "01", "99999999999999999999"])("refuses before=%j with 400 invalid_cursor", async (before) => {
    expect(await get(`/audit?before=${before}`)).toEqual({ status: 400, body: { error: "invalid_cursor" } });
  });

  it.each(["yesterday", "2026-10-10", "2026-10-10T09:00:00", "", "2026-13-40T09:00:00Z"])("refuses since=%j with 400 invalid_since", async (since) => {
    expect(await get(`/audit?since=${since}`)).toEqual({ status: 400, body: { error: "invalid_since" } });
  });

  it.each(["yesterday", "2026-10-10", "2026-10-10T09:00:00", "", "2026-13-40T09:00:00Z"])("refuses until=%j with 400 invalid_until", async (until) => {
    expect(await get(`/audit?until=${until}`)).toEqual({ status: 400, body: { error: "invalid_until" } });
  });

  it("refuses a since after until with 400 invalid_range", async () => {
    expect(await get("/audit?since=2026-10-12T00:00:00Z&until=2026-10-11T00:00:00Z")).toEqual({ status: 400, body: { error: "invalid_range" } });
    // the same instant written with an offset is not after
    expect((await get("/audit?since=2026-10-12T02:00:00%2B02:00&until=2026-10-12T00:00:00Z")).status).toBe(200);
  });

  it("refuses a bad value even when the playbook slug is unknown", async () => {
    expect((await get("/audit?playbook=nope&limit=0")).status).toBe(400);
  });
});
