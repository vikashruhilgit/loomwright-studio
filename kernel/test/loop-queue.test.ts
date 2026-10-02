// The durable event queue and the loop that processes it (AC1, AC6). Handlers
// are fakes; "restart" = close the Store and open a new one on the data dir.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PARK_MS, EventLoop, enqueueEvent, enqueueMessage, getQueueRow, getWorkStep } from "../src/loop/index.js";
import type { EventHandler, EventKind, QueuedEvent } from "../src/loop/index.js";
import { AdmissionRefusedError } from "../src/sessions/index.js";
import type { CancelTimer } from "../src/sessions/index.js";
import { count, events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

let env: LoopEnv;

beforeEach(() => {
  env = loopEnv();
});

afterEach(() => {
  env.cleanup();
});

function loop(handlers: Partial<Record<EventKind, EventHandler>>): EventLoop {
  return new EventLoop({ store: env.store, handlers }, { now: env.now });
}

describe("enqueue", () => {
  it("writes the queue row and its event_enqueued audit row together", () => {
    const { id, created } = enqueueMessage(env.store, { text: "hello", agent: "wright" }, env.now());
    expect(created).toBe(true);
    expect(getQueueRow(env.store, id)).toMatchObject({
      kind: "message",
      status: "pending",
      attempts: 0,
      source_ref: null,
      enqueued_at: env.now().toISOString(),
      done_at: null,
    });
    expect(JSON.parse(getQueueRow(env.store, id)?.payload_json ?? "null")).toEqual({ text: "hello", agent: "wright" });
    expect(events(env.store, "event_enqueued").map((e) => [e.actor, e.payload])).toEqual([
      ["kernel", { queue_id: id, kind: "message", source_ref: null }],
    ]);
  });

  it("dedupes on sourceRef: the second enqueue writes nothing and returns the first id", () => {
    const a = enqueueEvent(env.store, { kind: "wakeup", payload: { n: 1 }, sourceRef: "wakeup:9" });
    const b = enqueueEvent(env.store, { kind: "wakeup", payload: { n: 2 }, sourceRef: "wakeup:9" });
    expect(b).toEqual({ id: a.id, created: false });
    expect(count(env.store, "SELECT count(*) FROM event_queue")).toBe(1);
    expect(events(env.store, "event_enqueued")).toHaveLength(1);
  });

  it("refuses an unknown kind, a non-object payload and an empty message, writing nothing", () => {
    expect(() => enqueueEvent(env.store, { kind: "trigger" as EventKind, payload: {} })).toThrow(/unknown event kind/);
    expect(() => enqueueEvent(env.store, { kind: "message", payload: [] as unknown as Record<string, unknown> })).toThrow(TypeError);
    expect(() => enqueueMessage(env.store, { text: "  " })).toThrow(TypeError);
    expect(count(env.store, "SELECT count(*) FROM event_queue")).toBe(0);
    expect(events(env.store)).toHaveLength(0);
  });
});

describe("EventLoop.tick", () => {
  it("processes pending rows in id order and marks each done only after its handler resolved", async () => {
    const ids = [1, 2, 3].map((n) => enqueueMessage(env.store, { text: `m${n}` }).id);
    const seen: [number, string | undefined][] = [];
    const message: EventHandler = async ({ event }) => {
      await Promise.resolve();
      seen.push([event.id, getQueueRow(env.store, event.id)?.status]);
    };
    const result = await loop({ message }).tick();
    expect(result).toEqual({ wakeupsFired: 0, done: 3, unhandled: 0, parked: 0, failed: 0 });
    expect(seen).toEqual(ids.map((id) => [id, "pending"]));
    for (const id of ids) expect(getQueueRow(env.store, id)).toMatchObject({ status: "done", attempts: 1, done_at: env.now().toISOString() });
    expect(events(env.store, "event_done").map((e) => e.payload.queue_id)).toEqual(ids);
  });

  it("a handler that throws ⇒ failed, one notify, and the next event is still processed", async () => {
    const a = enqueueMessage(env.store, { text: "bad" }).id;
    const b = enqueueMessage(env.store, { text: "good" }).id;
    const message = vi.fn<EventHandler>(({ event }) => {
      if (event.payload.text === "bad") throw new Error("handler broke");
    });
    expect(await loop({ message }).tick()).toMatchObject({ done: 1, failed: 1 });
    expect(getQueueRow(env.store, a)).toMatchObject({ status: "failed", attempts: 1, last_error: "handler broke", done_at: null });
    expect(getQueueRow(env.store, b)?.status).toBe("done");
    expect(events(env.store, "event_failed").map((e) => e.payload)).toEqual([{ queue_id: a, kind: "message", error: "handler broke" }]);
    expect(events(env.store, "notify").map((e) => e.payload)).toEqual([
      { reason: "event_failed", queue_id: a, kind: "message", error: "handler broke" },
    ]);
    // A failed row is not delivered again.
    await loop({ message }).tick();
    expect(message).toHaveBeenCalledTimes(2);
  });

  it("AdmissionRefusedError parks the row until retryAt (no notify), then it is processed", async () => {
    const id = enqueueMessage(env.store, { text: "later" }).id;
    const retryAt = new Date(env.now().getTime() + 30 * 60_000).toISOString();
    let refuse = true;
    const message = vi.fn<EventHandler>(() => {
      if (refuse) throw new AdmissionRefusedError("cap_parked", retryAt, "parked");
    });
    const l = loop({ message });
    expect(await l.tick()).toMatchObject({ parked: 1, done: 0 });
    expect(getQueueRow(env.store, id)).toMatchObject({ status: "pending", not_before: retryAt, attempts: 1 });
    expect(events(env.store, "event_parked").map((e) => e.payload)).toEqual([
      { queue_id: id, kind: "message", reason: "cap_parked", retry_at: retryAt, not_before: retryAt },
    ]);
    expect(events(env.store, "notify")).toHaveLength(0);

    refuse = false;
    env.advance(29 * 60_000);
    expect(await l.tick()).toMatchObject({ done: 0, parked: 0 });
    expect(message).toHaveBeenCalledTimes(1);
    env.advance(60_000);
    expect(await l.tick()).toMatchObject({ done: 1 });
    expect(getQueueRow(env.store, id)).toMatchObject({ status: "done", attempts: 2 });
  });

  it("a refusal out of ctx.runStepAsync parks the event and releases the step, so the redelivery runs it and completes", async () => {
    const id = enqueueMessage(env.store, { text: "start a session" }).id;
    const retryAt = new Date(env.now().getTime() + 30 * 60_000).toISOString();
    let refuse = true;
    const start = vi.fn(async () => {
      if (refuse) throw new AdmissionRefusedError("cap_parked", retryAt, "parked");
      return { session: 7 };
    });
    const message: EventHandler = async (ctx) => {
      await ctx.runStepAsync("start", start);
    };
    const l = loop({ message });
    expect(await l.tick()).toMatchObject({ parked: 1, failed: 0 });
    expect(getQueueRow(env.store, id)).toMatchObject({ status: "pending", not_before: retryAt });
    expect(getWorkStep(env.store, `event:${id}:start`)).toBeUndefined();

    refuse = false;
    env.advance(30 * 60_000);
    expect(await l.tick()).toMatchObject({ done: 1, parked: 0, failed: 0 });
    expect(start).toHaveBeenCalledTimes(2);
    expect(getQueueRow(env.store, id)).toMatchObject({ status: "done", attempts: 2, last_error: expect.stringContaining("parked") });
    expect(getWorkStep(env.store, `event:${id}:start`)).toMatchObject({ status: "done", result: { session: 7 } });
    expect(events(env.store, "notify")).toHaveLength(0);
  });

  it("a refusal out of a nested ctx.runStepAsync releases only the inner step: the outer effect runs once and the event fails visibly", async () => {
    const id = enqueueMessage(env.store, { text: "nested" }).id;
    const retryAt = new Date(env.now().getTime() + 30 * 60_000).toISOString();
    const outerEffect = vi.fn();
    const start = vi.fn(async () => {
      throw new AdmissionRefusedError("cap_parked", retryAt, "parked");
    });
    const message: EventHandler = async (ctx) => {
      await ctx.runStepAsync("outer", async () => {
        outerEffect(); // an effect made before the refusable inner step
        return ctx.runStepAsync("start", start);
      });
    };
    const l = loop({ message });
    expect(await l.tick()).toMatchObject({ parked: 0, failed: 1 });
    expect(getQueueRow(env.store, id)).toMatchObject({ status: "failed", attempts: 1, last_error: expect.stringContaining(`event:${id}:outer`) });
    expect(getWorkStep(env.store, `event:${id}:start`)).toBeUndefined();
    expect(getWorkStep(env.store, `event:${id}:outer`)?.label).toBe("failed:error");
    expect(events(env.store, "event_parked")).toHaveLength(0);
    expect(events(env.store, "notify").map((e) => e.payload.reason)).toEqual(["event_failed"]);

    // Nothing is redelivered: the outer effect is never repeated.
    env.advance(31 * 60_000);
    expect(await l.tick()).toMatchObject({ done: 0, parked: 0, failed: 0 });
    expect(outerEffect).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("a ctx.runStepAsync failure other than a refusal still fails its step terminally", async () => {
    const id = enqueueMessage(env.store, { text: "x" }).id;
    await loop({
      message: async (ctx) => {
        await ctx.runStepAsync("effect", async () => Promise.reject(new Error("effect broke")));
      },
    }).tick();
    expect(getQueueRow(env.store, id)?.status).toBe("failed");
    expect(getWorkStep(env.store, `event:${id}:effect`)?.label).toBe("failed:error");
  });

  it("an unknown reset (retryAt null) parks for DEFAULT_PARK_MS", async () => {
    const id = enqueueMessage(env.store, { text: "x" }).id;
    await loop({
      message: () => {
        throw new AdmissionRefusedError("cap_parked", null, "parked");
      },
    }).tick();
    expect(getQueueRow(env.store, id)?.not_before).toBe(new Date(env.now().getTime() + DEFAULT_PARK_MS).toISOString());
  });

  it("a kind with no handler ⇒ done + event_unhandled; nothing else is invented", async () => {
    const id = enqueueMessage(env.store, { text: "nobody listens" }).id;
    expect(await loop({}).tick()).toMatchObject({ unhandled: 1, done: 0 });
    expect(getQueueRow(env.store, id)).toMatchObject({ status: "done", attempts: 0 });
    expect(events(env.store, "event_unhandled").map((e) => e.payload)).toEqual([{ queue_id: id, kind: "message" }]);
  });

  it("pending rows are processed again after a restart (a crash before done re-delivers)", async () => {
    const id = enqueueMessage(env.store, { text: "survive" }).id;
    // The first kernel dies inside the handler (it never returns): the row stays pending.
    const entered = vi.fn();
    void loop({
      message: () => {
        entered();
        return new Promise<void>(() => undefined);
      },
    }).tick();
    await vi.waitFor(() => expect(entered).toHaveBeenCalledTimes(1));
    const store = env.restart();
    expect(getQueueRow(store, id)?.status).toBe("pending");
    const seen: QueuedEvent[] = [];
    await new EventLoop({ store, handlers: { message: ({ event }) => void seen.push(event) } }, { now: env.now }).tick();
    expect(seen.map((e) => [e.id, e.payload.text])).toEqual([[id, "survive"]]);
    expect(getQueueRow(store, id)?.status).toBe("done");
  });

  it("handler effects keyed through ctx.runStep happen once even when the event is delivered again", async () => {
    const id = enqueueMessage(env.store, { text: "x" }).id;
    const effect = vi.fn(() => Number(env.store.prepare("INSERT INTO tasks (title, state) VALUES ('t', 's')").run().lastInsertRowid));
    // First delivery: the effect commits, then the kernel "crashes" before done.
    let crash = true;
    const message: EventHandler = (ctx) => {
      ctx.runStep("create-task", effect);
      if (crash) throw new Error("crash after effects");
    };
    await loop({ message }).tick();
    // Simulate the crash's outcome: the row is still pending.
    env.store.prepare("UPDATE event_queue SET status = 'pending' WHERE id = ?").run(id);
    crash = false;
    await loop({ message }).tick();
    expect(effect).toHaveBeenCalledTimes(1);
    expect(count(env.store, "SELECT count(*) FROM tasks")).toBe(1);
    expect(count(env.store, "SELECT count(*) FROM work_steps WHERE key = ?", `event:${id}:create-task`)).toBe(1);
  });

  it("events rows are never updated: the append-only triggers stay intact", async () => {
    enqueueMessage(env.store, { text: "x" });
    await loop({ message: () => undefined }).tick();
    expect(() => env.store.prepare("UPDATE events SET kind = 'x'").run()).toThrow(/append-only/);
    expect(() => env.store.prepare("DELETE FROM events").run()).toThrow(/append-only/);
  });

  it("tick is single-flight and a handler's enqueue is processed in the same tick", async () => {
    enqueueMessage(env.store, { text: "first" });
    const texts: unknown[] = [];
    const message: EventHandler = async ({ event }) => {
      texts.push(event.payload.text);
      if (event.payload.text === "first") enqueueMessage(env.store, { text: "second" });
      await Promise.resolve();
    };
    const l = loop({ message });
    const [a, b] = await Promise.all([l.tick(), l.tick()]);
    expect(a).toBe(b);
    expect(texts).toEqual(["first", "second"]);
  });

  it("start() ticks through the injected scheduler and stop() cancels the next tick", async () => {
    const scheduled: { fn: () => void; ms: number; cancelled: boolean }[] = [];
    const schedule = (fn: () => void, ms: number): CancelTimer => {
      const entry = { fn, ms, cancelled: false };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    };
    const message = vi.fn<EventHandler>();
    const l = new EventLoop({ store: env.store, handlers: { message } }, { now: env.now, schedule, tickMs: 500 });
    enqueueMessage(env.store, { text: "x" });
    l.start();
    l.start();
    expect(scheduled.map((s) => s.ms)).toEqual([0]);
    scheduled[0]?.fn();
    await vi.waitFor(() => expect(scheduled.map((s) => s.ms)).toEqual([0, 500]));
    expect(message).toHaveBeenCalledTimes(1);
    await l.stop();
    expect(scheduled[1]?.cancelled).toBe(true);
    expect(() => new EventLoop({ store: env.store, handlers: {} }, { tickMs: 0 })).toThrow(RangeError);
  });

  it("stop() during a running tick waits for the current event and starts no other", async () => {
    const first = enqueueMessage(env.store, { text: "first" }).id;
    const second = enqueueMessage(env.store, { text: "second" }).id;
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let entered = false;
    const message = vi.fn<EventHandler>(async () => {
      entered = true;
      await gate;
    });
    const l = loop({ message });
    const ticking = l.tick();
    await vi.waitFor(() => expect(entered).toBe(true));
    let stopped = false;
    const stopping = l.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false); // still waiting for the running event
    open();
    await stopping;
    expect(await ticking).toMatchObject({ done: 1 });
    expect(message).toHaveBeenCalledTimes(1);
    expect(getQueueRow(env.store, first)?.status).toBe("done");
    expect(getQueueRow(env.store, second)).toMatchObject({ status: "pending", attempts: 0 });

    // A later tick picks the rest up.
    expect(await l.tick()).toMatchObject({ done: 1 });
    expect(getQueueRow(env.store, second)?.status).toBe("done");
  });

  it("a tick that throws (store failure) is recorded as loop_error and the loop keeps scheduling", async () => {
    const scheduled: { fn: () => void; ms: number }[] = [];
    const schedule = (fn: () => void, ms: number): CancelTimer => {
      scheduled.push({ fn, ms });
      return () => undefined;
    };
    const message = vi.fn<EventHandler>();
    const l = new EventLoop({ store: env.store, handlers: { message } }, { now: env.now, schedule, tickMs: 500 });
    enqueueMessage(env.store, { text: "x" });
    const prepare = env.store.prepare.bind(env.store);
    const spy = vi.spyOn(env.store, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("FROM event_queue") && sql.includes("status = 'pending'")) throw new Error("disk I/O error");
      return prepare(sql);
    }) as typeof env.store.prepare);
    l.start();
    scheduled[0]?.fn();
    await vi.waitFor(() => expect(scheduled.map((s) => s.ms)).toEqual([0, 500]));
    expect(events(env.store, "loop_error").map((e) => e.payload)).toEqual([{ error: "disk I/O error" }]);
    expect(message).not.toHaveBeenCalled();

    // The next tick, with the store healthy again, processes the row.
    spy.mockRestore();
    scheduled[1]?.fn();
    await vi.waitFor(() => expect(message).toHaveBeenCalledTimes(1));
    await l.stop();
  });

  it("a store that fails entirely (loop_error cannot be written either) does not crash the loop", async () => {
    const scheduled: { fn: () => void; ms: number }[] = [];
    const schedule = (fn: () => void, ms: number): CancelTimer => {
      scheduled.push({ fn, ms });
      return () => undefined;
    };
    const l = new EventLoop({ store: env.store, handlers: {} }, { now: env.now, schedule, tickMs: 500 });
    const spy = vi.spyOn(env.store, "prepare").mockImplementation(() => {
      throw new Error("database is locked");
    });
    l.start();
    scheduled[0]?.fn();
    await vi.waitFor(() => expect(scheduled.map((s) => s.ms)).toEqual([0, 500]));
    spy.mockRestore();
    expect(events(env.store, "loop_error")).toHaveLength(0);
    await l.stop();
  });
});
