// Scheduled wake-ups (AC5, AC7): each fires exactly once by id, including one
// that came due while the kernel was down. "Restart" = close the Store and
// open a new one on the same data dir.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scheduleWakeupOnce } from "../src/budget/internal.js";
import { EventLoop, fireDueWakeups, scheduleWakeup } from "../src/loop/index.js";
import type { QueuedEvent } from "../src/loop/index.js";
import type { Store } from "../src/store/index.js";
import { count, events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

let env: LoopEnv;

beforeEach(() => {
  env = loopEnv();
});

afterEach(() => {
  env.cleanup();
});

function queued(store: Store): { kind: string; source_ref: string | null; payload: Record<string, unknown>; status: string }[] {
  return store
    .prepare<[], { kind: string; source_ref: string | null; payload_json: string; status: string }>(
      "SELECT kind, source_ref, payload_json, status FROM event_queue ORDER BY id",
    )
    .all()
    .map((r) => ({ kind: r.kind, source_ref: r.source_ref, status: r.status, payload: JSON.parse(r.payload_json) }));
}

function wakeupStatus(store: Store, id: number): string | undefined {
  return store.prepare<[number], string>("SELECT status FROM wakeups WHERE id = ?").pluck().get(id);
}

describe("scheduleWakeup", () => {
  it("stores a pending wake-up at the normalized UTC instant with an audit row", () => {
    const w = scheduleWakeup(env.store, { at: "2026-10-02T12:30:00+02:00", reason: "check PR" }, env.now());
    expect(w.dueAt).toBe("2026-10-02T10:30:00.000Z");
    expect(wakeupStatus(env.store, w.wakeupId)).toBe("pending");
    expect(events(env.store, "wakeup_scheduled").map((e) => e.payload)).toEqual([
      { wakeup_id: w.wakeupId, due_at: w.dueAt, reason: "check PR" },
    ]);
  });

  it("rejects an unparseable or zone-less time, an empty reason and an unknown task, writing nothing", () => {
    for (const at of ["tomorrow", "2026-10-02", "2026-10-02T10:00:00", "2026-13-45T99:00:00Z", ""]) {
      expect(() => scheduleWakeup(env.store, { at, reason: "r" })).toThrow(TypeError);
    }
    expect(() => scheduleWakeup(env.store, { at: "2026-10-02T10:00:00Z", reason: " " })).toThrow(TypeError);
    expect(() => scheduleWakeup(env.store, { at: "2026-10-02T10:00:00Z", reason: "r", taskId: 99 })).toThrow(/no task 99/);
    expect(count(env.store, "SELECT count(*) FROM wakeups")).toBe(0);
  });
});

describe("fireDueWakeups", () => {
  it("fires a due wake-up once into a wakeup queue row; a second call fires nothing", () => {
    const w = scheduleWakeup(env.store, { at: env.now().toISOString(), reason: "now" });
    const fired = fireDueWakeups(env.store, env.now());
    expect(fired.map((f) => f.wakeupId)).toEqual([w.wakeupId]);
    expect(fireDueWakeups(env.store, env.now())).toEqual([]);
    expect(wakeupStatus(env.store, w.wakeupId)).toBe("fired");
    expect(queued(env.store)).toEqual([
      { kind: "wakeup", source_ref: `wakeup:${w.wakeupId}`, status: "pending", payload: { wakeupId: w.wakeupId, reason: "now", dueAt: w.dueAt } },
    ]);
  });

  it("does not fire a future wake-up until it is due", () => {
    const w = scheduleWakeup(env.store, { at: new Date(env.now().getTime() + 60_000).toISOString(), reason: "later" });
    expect(fireDueWakeups(env.store, env.now())).toEqual([]);
    env.advance(59_999);
    expect(fireDueWakeups(env.store, env.now())).toEqual([]);
    env.advance(1);
    expect(fireDueWakeups(env.store, env.now()).map((f) => f.wakeupId)).toEqual([w.wakeupId]);
  });

  it("a wake-up that came due while the kernel was closed fires exactly once after the restart", async () => {
    const w = scheduleWakeup(env.store, { at: new Date(env.now().getTime() + 60_000).toISOString(), reason: "missed" });
    env.store.close();
    env.advance(6 * 60 * 60_000); // the kernel was down for hours
    const store = env.restart();

    const seen: QueuedEvent[] = [];
    const first = new EventLoop({ store, handlers: { wakeup: ({ event }) => void seen.push(event) } }, { now: env.now });
    expect(await first.tick()).toMatchObject({ wakeupsFired: 1, done: 1 });
    expect(await first.tick()).toMatchObject({ wakeupsFired: 0, done: 0 });

    // A second loop on yet another reopened store does not fire it again.
    const reopened = env.restart();
    const second = new EventLoop({ store: reopened, handlers: { wakeup: ({ event }) => void seen.push(event) } }, { now: env.now });
    expect(await second.tick()).toMatchObject({ wakeupsFired: 0, done: 0 });

    expect(seen.map((e) => e.payload)).toEqual([{ wakeupId: w.wakeupId, reason: "missed", dueAt: w.dueAt }]);
    expect(count(reopened, "SELECT count(*) FROM event_queue WHERE kind = 'wakeup'")).toBe(1);
  });

  it("a wake-up already fired whose queue row exists is never queued twice (status guard + unique source_ref)", () => {
    const w = scheduleWakeup(env.store, { at: env.now().toISOString(), reason: "r" });
    fireDueWakeups(env.store, env.now());
    // Even if its status were pending again, the source_ref keeps one queue row.
    env.store.prepare("UPDATE wakeups SET status = 'pending' WHERE id = ?").run(w.wakeupId);
    fireDueWakeups(env.store, env.now());
    expect(count(env.store, "SELECT count(*) FROM event_queue")).toBe(1);
  });

  it("a cap_reset row written by the budget module fires the same way", () => {
    const at = env.now().toISOString();
    env.store.transaction(() => scheduleWakeupOnce(env.store, "cap_reset:owner@example.test", at, at));
    const fired = fireDueWakeups(env.store, env.now());
    expect(fired).toHaveLength(1);
    expect(queued(env.store)[0]).toMatchObject({ kind: "wakeup", payload: { reason: "cap_reset:owner@example.test", dueAt: at } });
  });

  it("fires due wake-ups oldest first", () => {
    const late = scheduleWakeup(env.store, { at: "2026-10-02T09:00:00Z", reason: "b" });
    const early = scheduleWakeup(env.store, { at: "2026-10-02T08:00:00Z", reason: "a" });
    expect(fireDueWakeups(env.store, env.now()).map((f) => f.wakeupId)).toEqual([early.wakeupId, late.wakeupId]);
  });
});
