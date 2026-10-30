// Phase 7 item 05: the `gui` feature's `schedules` part. `GET /schedule` and
// `GET /triggers/:id/fires` against a real store, through a real API server
// (so the query string is parsed as in the daemon). Never the SDK or a model.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startApiServer } from "../src/api/index.js";
import type { ApiServer } from "../src/api/index.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import { GUI_PARTS, schedulesPart, schedulesRoutes } from "../src/gui/index.js";
import { appendEvent } from "../src/loop/internal.js";
import { scheduleWakeup } from "../src/loop/wakeups.js";
import { fireDueTriggers, registerTrigger, setTriggerEnabled } from "../src/triggers/index.js";
import { loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const TOKEN = "0123456789abcdef".repeat(4);
const NOW = "2026-10-14T10:00:00.000Z";

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

function once(at: string, text = "once"): number {
  return registerTrigger(env.store, { agent: "wright", kind: "once", spec: at, action: "notify", text }, env.now()).id;
}

function cron(text = "cron", playbook?: string): number {
  return registerTrigger(env.store, { agent: "wright", kind: "cron", spec: "0 9 * * *", tz: "UTC", action: "wake_agent", text, ...(playbook === undefined ? {} : { playbook }) }, env.now()).id;
}

/** A poll trigger straight into the table: registering one needs a connector, which is not what is under test. */
function poll(nextFireAt: string | null = "2026-10-14T10:02:00.000Z"): number {
  const spec = JSON.stringify({ source: "github", repos: ["o/r"], filters: {}, interval_seconds: 120 });
  return Number(
    env.store
      .prepare("INSERT INTO triggers (owning_agent, playbook, kind, spec_json, action, action_payload, created_by, next_fire_at) VALUES ('wright', 'review', 'poll', ?, 'wake_agent', 'poll prs', 'agent', ?)")
      .run(spec, nextFireAt).lastInsertRowid,
  );
}

function missed(triggerId: number, reason: string, scheduledAt: string | null = NOW): void {
  appendEvent(env.store, "trigger_missed", { taskId: null, sessionId: null }, { trigger_id: triggerId, reason, ...(scheduledAt === null ? {} : { scheduled_at: scheduledAt }) }, NOW);
}

describe("the schedules part (phase 7 item 05)", () => {
  it("is the third gui part, holds exactly the two owner routes, and none is unauthenticated", () => {
    expect(GUI_PARTS[2]).toBe(schedulesPart);
    expect(schedulesPart.name).toBe("schedules");
    expect(schedulesPart.routes).toBe(schedulesRoutes);
    expect(Object.isFrozen(schedulesRoutes)).toBe(true);
    expect(schedulesRoutes.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /schedule", "GET /triggers/:id/fires"]);
    expect(schedulesRoutes.filter((r) => r.unauthenticated === true)).toEqual([]);
  });

  it("needs the API token", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/schedule`);
    expect(res.status).toBe(401);
  });
});

describe("GET /schedule", () => {
  it("answers an empty list when nothing is scheduled", async () => {
    expect(await get("/schedule")).toEqual({ status: 200, body: { entries: [] } });
  });

  it("lists enabled triggers and pending wake-ups only, soonest first, with each field mapped", async () => {
    const cronId = cron("daily", "review"); // next fire 2026-10-15T09:00Z
    const onceId = once("2026-10-14T12:00:00.000Z", "remind me");
    const pollId = poll("2026-10-14T10:02:00.000Z");
    const disabled = once("2026-10-14T10:30:00.000Z", "off");
    setTriggerEnabled(env.store, { id: disabled, enabled: false, by: "owner" }, env.now());
    // An off trigger normally has no next fire; a stale one in the row must still not list it (the kernel's own toggle clears it).
    const staleOff = poll("2026-10-14T10:04:00.000Z");
    env.store.prepare("UPDATE triggers SET enabled = 0 WHERE id = ?").run(staleOff);
    const pending = scheduleWakeup(env.store, { at: "2026-10-14T11:00:00.000Z", reason: "check the build" }, env.now()).wakeupId;
    const firedW = scheduleWakeup(env.store, { at: "2026-10-14T10:01:00.000Z", reason: "already fired" }, env.now()).wakeupId;
    const supersededW = scheduleWakeup(env.store, { at: "2026-10-14T10:03:00.000Z", reason: "superseded" }, env.now()).wakeupId;
    env.store.prepare("UPDATE wakeups SET status = 'fired', fired_at = ? WHERE id = ?").run(NOW, firedW);
    env.store.prepare("UPDATE wakeups SET status = 'superseded' WHERE id = ?").run(supersededW);

    const { status, body } = await get("/schedule");
    expect(status).toBe(200);
    // sorted by `at` ascending; the disabled trigger and the fired and superseded wake-ups never appear
    expect(body.entries.map((e: { kind: string; id: number }) => `${e.kind}:${e.id}`)).toEqual([`trigger:${pollId}`, `wakeup:${pending}`, `trigger:${onceId}`, `trigger:${cronId}`]);
    expect(body.entries).toEqual([
      { kind: "trigger", id: pollId, at: "2026-10-14T10:02:00.000Z", agent: "wright", playbook: "review", action: "wake_agent", text: "poll prs", task_id: null },
      { kind: "wakeup", id: pending, at: "2026-10-14T11:00:00.000Z", agent: null, playbook: null, action: null, text: "check the build", task_id: null },
      { kind: "trigger", id: onceId, at: "2026-10-14T12:00:00.000Z", agent: "wright", playbook: null, action: "notify", text: "remind me", task_id: null },
      { kind: "trigger", id: cronId, at: "2026-10-15T09:00:00.000Z", agent: "wright", playbook: "review", action: "wake_agent", text: "daily", task_id: null },
    ]);
  });

  it("a wake-up carries its task", async () => {
    const taskId = Number(env.store.prepare("INSERT INTO tasks (title, state) VALUES ('t', 'queued')").run().lastInsertRowid);
    const w = scheduleWakeup(env.store, { at: "2026-10-14T11:00:00.000Z", reason: "r", taskId }, env.now()).wakeupId;
    const { body } = await get("/schedule");
    expect(body.entries).toEqual([{ kind: "wakeup", id: w, at: "2026-10-14T11:00:00.000Z", agent: null, playbook: null, action: null, text: "r", task_id: taskId }]);
  });

  it("a trigger with no next fire never appears", async () => {
    poll(null);
    expect((await get("/schedule")).body.entries).toEqual([]);
  });

  it("breaks a tie on the instant with the trigger first, then the id", async () => {
    const at = "2026-10-14T12:00:00.000Z";
    const w1 = scheduleWakeup(env.store, { at, reason: "w1" }, env.now()).wakeupId;
    const t1 = once(at, "t1");
    const t2 = once(at, "t2");
    const w2 = scheduleWakeup(env.store, { at, reason: "w2" }, env.now()).wakeupId;
    const { body } = await get("/schedule");
    expect(body.entries.map((e: { kind: string; id: number }) => `${e.kind}:${e.id}`)).toEqual([`trigger:${t1}`, `trigger:${t2}`, `wakeup:${w1}`, `wakeup:${w2}`]);
  });

  it("cuts to limit (default 50, at most 200) across both sources", async () => {
    for (let i = 0; i < 3; i++) once(`2026-10-14T1${i + 1}:00:00.000Z`, `t${i}`);
    for (let i = 0; i < 3; i++) scheduleWakeup(env.store, { at: `2026-10-14T1${i + 1}:30:00.000Z`, reason: `w${i}` }, env.now());
    const two = await get("/schedule?limit=4");
    expect(two.body.entries.map((e: { text: string }) => e.text)).toEqual(["t0", "w0", "t1", "w1"]);
    expect((await get("/schedule?limit=200")).body.entries).toHaveLength(6);
    for (let i = 0; i < 60; i++) scheduleWakeup(env.store, { at: "2026-10-20T00:00:00.000Z", reason: `bulk${i}` }, env.now());
    expect((await get("/schedule")).body.entries).toHaveLength(50);
  });

  it("refuses a limit that is not a whole number from 1 to 200 with 400 invalid_limit", async () => {
    for (const bad of ["0", "201", "x", "-1", "1.5", "", "1e2", "0x10", "+5"]) {
      expect(await get(`/schedule?limit=${encodeURIComponent(bad)}`), bad).toEqual({ status: 400, body: { error: "invalid_limit" } });
    }
    expect((await get("/schedule?limit=1")).status).toBe(200);
    expect((await get("/schedule?limit=200")).status).toBe(200);
  });

  it("is read-only: no row or event changes", async () => {
    once("2026-10-14T12:00:00.000Z");
    scheduleWakeup(env.store, { at: "2026-10-14T11:00:00.000Z", reason: "r" }, env.now());
    const before = env.store.prepare<[], number>("SELECT count(*) FROM events").pluck().get();
    await get("/schedule");
    expect(env.store.prepare<[], number>("SELECT count(*) FROM events").pluck().get()).toBe(before);
  });
});

describe("GET /triggers/:id/fires", () => {
  it("carries each missed fire's recorded reason verbatim with its scheduled instant, newest first, and a fired one has reason null", async () => {
    const id = poll();
    const reasons = ["playbook_not_enabled", "paused", "kill_switch", "connector_missing", "rate_limited", "source_error", "some_future_code"];
    reasons.forEach((r, i) => missed(id, r, `2026-10-14T10:0${i}:00.000Z`));
    appendEvent(env.store, "trigger_fired", { taskId: null, sessionId: 7 }, { trigger_id: id, scheduled_at: "2026-10-14T10:09:00.000Z", reason: "ignored on a fire" }, "2026-10-14T10:09:30.000Z");
    const { status, body } = await get(`/triggers/${id}/fires`);
    expect(status).toBe(200);
    expect(body.next_before).toBeNull();
    expect(body.fires.map((f: { reason: string | null }) => f.reason)).toEqual([null, ...[...reasons].reverse()]);
    expect(body.fires[0]).toMatchObject({ kind: "trigger_fired", at: "2026-10-14T10:09:30.000Z", scheduled_at: "2026-10-14T10:09:00.000Z", reason: null, session_id: 7 });
    expect(body.fires[1]).toMatchObject({ kind: "trigger_missed", at: NOW, scheduled_at: "2026-10-14T10:06:00.000Z", reason: "some_future_code", session_id: null });
    const ids = body.fires.map((f: { id: number }) => f.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });

  it("reads the kernel's own fire paths: a linked trigger of a playbook that is not enabled is a playbook_not_enabled miss", async () => {
    const id = cron("daily", "no-such-playbook");
    fireDueTriggers(env.store, new Date("2026-10-15T09:00:30.000Z"));
    const { body } = await get(`/triggers/${id}/fires`);
    expect(body.fires).toHaveLength(1);
    expect(body.fires[0]).toMatchObject({ kind: "trigger_missed", reason: "playbook_not_enabled", scheduled_at: "2026-10-15T09:00:00.000Z" });
  });

  it("a fire without a scheduled instant has scheduled_at null; a non-string reason or instant is null", async () => {
    const id = poll();
    missed(id, "paused", null);
    appendEvent(env.store, "trigger_missed", { taskId: null, sessionId: null }, { trigger_id: id, reason: 5, scheduled_at: 9 }, NOW);
    const { body } = await get(`/triggers/${id}/fires`);
    expect(body.fires.map((f: { reason: unknown; scheduled_at: unknown }) => [f.reason, f.scheduled_at])).toEqual([[null, null], ["paused", null]]);
  });

  it("pages a long history with next_before: no overlap, no skip, the last page ends with null, and another trigger's events never appear", async () => {
    const id = poll();
    const other = poll();
    for (let i = 0; i < 120; i++) {
      missed(id, "playbook_not_enabled", `2026-10-14T10:${String(i % 60).padStart(2, "0")}:00.000Z`);
      if (i % 7 === 0) missed(other, "paused");
    }
    const seen: number[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const res: { status: number; body: any } = await get(`/triggers/${id}/fires?limit=50${cursor === null ? "" : `&before=${cursor}`}`);
      expect(res.status).toBe(200);
      sizes.push(res.body.fires.length);
      for (const f of res.body.fires) {
        expect(f.reason).toBe("playbook_not_enabled");
        seen.push(f.id);
      }
      cursor = res.body.next_before;
    } while (cursor !== null);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    expect(seen).toEqual([...seen].sort((a, b) => b - a));
    const all = env.store.prepare<[number], number>("SELECT id FROM events WHERE kind = 'trigger_missed' AND json_extract(payload_json, '$.trigger_id') = ? ORDER BY id DESC").pluck().all(id);
    expect(seen).toEqual(all);
  });

  it("next_before is the last returned id when the page is full, and a cursor returns only ids below it", async () => {
    const id = poll();
    for (let i = 0; i < 5; i++) missed(id, "paused");
    const page = await get(`/triggers/${id}/fires?limit=2`);
    const ids = page.body.fires.map((f: { id: number }) => f.id);
    expect(page.body.next_before).toBe(String(ids[1]));
    const next = await get(`/triggers/${id}/fires?limit=2&before=${page.body.next_before}`);
    expect(next.body.fires.every((f: { id: number }) => f.id < ids[1])).toBe(true);
    expect(next.body.fires).toHaveLength(2);
    const last = await get(`/triggers/${id}/fires?limit=2&before=${next.body.next_before}`);
    expect(last.body.fires).toHaveLength(1);
    expect(last.body.next_before).toBeNull();
  });

  it("skips a row whose payload is not valid JSON and still answers 200", async () => {
    const id = poll();
    missed(id, "paused");
    env.store.prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES (?, 'trigger_missed', 'kernel', ?)").run(NOW, '{"trigger_id": 1, "reason": ');
    env.store.prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES (?, 'trigger_missed', 'kernel', NULL)").run(NOW);
    env.store.prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES (?, 'trigger_fired', 'kernel', 'not json at all')").run(NOW);
    env.store.prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES (?, 'trigger_missed', 'kernel', '[1,2]')").run(NOW);
    missed(id, "rate_limited");
    const { status, body } = await get(`/triggers/${id}/fires`);
    expect(status).toBe(200);
    expect(body.fires.map((f: { reason: string }) => f.reason)).toEqual(["rate_limited", "paused"]);
  });

  it("answers 404 not_found for an unknown trigger and 400 invalid_id for a bad id", async () => {
    expect(await get("/triggers/999/fires")).toEqual({ status: 404, body: { error: "not_found" } });
    for (const bad of ["0", "-1", "abc", "1.5", "01", "99999999999999999999"]) {
      expect(await get(`/triggers/${bad}/fires`), bad).toEqual({ status: 400, body: { error: "invalid_id" } });
    }
  });

  it("answers 400 invalid_cursor for a bad before and 400 invalid_limit for a bad limit", async () => {
    const id = poll();
    for (const bad of ["0", "-1", "abc", "1.5", "", "99999999999999999999"]) {
      expect(await get(`/triggers/${id}/fires?before=${encodeURIComponent(bad)}`), bad).toEqual({ status: 400, body: { error: "invalid_cursor" } });
    }
    for (const bad of ["0", "201", "x", ""]) {
      expect(await get(`/triggers/${id}/fires?limit=${encodeURIComponent(bad)}`), bad).toEqual({ status: 400, body: { error: "invalid_limit" } });
    }
    expect((await get(`/triggers/${id}/fires?limit=200`)).status).toBe(200);
  });

  it("is read-only and shows only fired and missed events, never a toggle or registration", async () => {
    const id = once("2026-10-14T12:00:00.000Z");
    setTriggerEnabled(env.store, { id, enabled: false, by: "owner" }, env.now());
    const before = env.store.prepare<[], number>("SELECT count(*) FROM events").pluck().get();
    const { body } = await get(`/triggers/${id}/fires`);
    expect(body).toEqual({ fires: [], next_before: null });
    expect(env.store.prepare<[], number>("SELECT count(*) FROM events").pluck().get()).toBe(before);
  });
});
