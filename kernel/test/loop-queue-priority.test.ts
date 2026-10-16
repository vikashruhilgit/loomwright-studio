// Pending work by priority: `enqueueEvent`'s optional priority and the tick's
// order (high, normal, low; id within a level). Handlers are fakes that record
// the order they are called in.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventLoop, enqueueEvent, enqueueMessage, getQueueRow } from "../src/loop/index.js";
import type { EventHandler, EventKind } from "../src/loop/index.js";
import type { PlaybookPriority } from "../src/playbooks/types.js";
import { AdmissionRefusedError } from "../src/sessions/index.js";
import { count, events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

let env: LoopEnv;

beforeEach(() => {
  env = loopEnv();
});

afterEach(() => {
  env.cleanup();
});

function loop(handlers: Partial<Record<EventKind, EventHandler>>, now: () => Date = env.now): EventLoop {
  return new EventLoop({ store: env.store, handlers }, { now });
}

/** A `message` row at `priority` (absent ⇒ the default). */
function enqueue(text: string, priority?: PlaybookPriority): number {
  return enqueueEvent(env.store, { kind: "message", payload: { text }, ...(priority === undefined ? {} : { priority }) }, env.now()).id;
}

/** A `message` handler that records the id of each row it is called for. */
function recorder(): { readonly order: number[]; readonly message: EventHandler } {
  const order: number[] = [];
  return {
    order,
    message: ({ event }) => {
      order.push(event.id);
    },
  };
}

describe("enqueueEvent priority", () => {
  it("defaults to normal for a caller that passes none, and for enqueueMessage", () => {
    const plain = enqueueEvent(env.store, { kind: "message", payload: { text: "a" } }).id;
    const nulled = enqueueEvent(env.store, { kind: "message", payload: { text: "b" }, priority: null as unknown as PlaybookPriority }).id;
    const message = enqueueMessage(env.store, { text: "c" }).id;
    for (const id of [plain, nulled, message]) expect(getQueueRow(env.store, id)?.priority).toBe("normal");
  });

  it("stores the priority it is given", () => {
    expect(getQueueRow(env.store, enqueue("l", "low"))?.priority).toBe("low");
    expect(getQueueRow(env.store, enqueue("h", "high"))?.priority).toBe("high");
  });

  it.each([["urgent"], [""], [1]])("refuses priority %j with a TypeError, writing nothing", (bad) => {
    expect(() =>
      enqueueEvent(env.store, { kind: "message", payload: { text: "x" }, priority: bad as unknown as PlaybookPriority }),
    ).toThrow(TypeError);
    expect(count(env.store, "SELECT count(*) FROM event_queue")).toBe(0);
    expect(events(env.store, "event_enqueued")).toHaveLength(0);
  });

  it("a sourceRef duplicate returns the first id and keeps the first row's priority", () => {
    const first = enqueueEvent(env.store, { kind: "wakeup", payload: {}, sourceRef: "x", priority: "low" });
    const again = enqueueEvent(env.store, { kind: "wakeup", payload: {}, sourceRef: "x", priority: "high" });
    expect(again).toEqual({ id: first.id, created: false });
    expect(getQueueRow(env.store, first.id)?.priority).toBe("low");
    expect(count(env.store, "SELECT count(*) FROM event_queue")).toBe(1);
  });
});

describe("EventLoop.tick order", () => {
  it("handles high, then normal, then low", async () => {
    const low = enqueue("l", "low");
    const normal = enqueue("n", "normal");
    const high = enqueue("h", "high");
    const { order, message } = recorder();
    expect(await loop({ message }).tick()).toMatchObject({ done: 3 });
    expect(order).toEqual([high, normal, low]);
  });

  it("handles the lower id first within a level", async () => {
    const a = enqueue("a", "high");
    const b = enqueue("b", "high");
    const { order, message } = recorder();
    await loop({ message }).tick();
    expect(order).toEqual([a, b]);
  });

  it("sorts a stored priority outside the closed set as normal", async () => {
    const low = enqueue("l", "low");
    const odd = enqueue("o", "normal");
    env.store.prepare("UPDATE event_queue SET priority = 'bogus' WHERE id = ?").run(odd);
    const normal = enqueue("n", "normal");
    const high = enqueue("h", "high");
    const { order, message } = recorder();
    await loop({ message }).tick();
    expect(order).toEqual([high, odd, normal, low]);
  });

  it("a parked high row waits for its not_before while a low row runs, then runs", async () => {
    const high = enqueue("h", "high");
    const notBefore = new Date(env.now().getTime() + 10 * 60_000).toISOString();
    env.store.prepare("UPDATE event_queue SET not_before = ? WHERE id = ?").run(notBefore, high);
    const low = enqueue("l", "low");
    const { order, message } = recorder();
    const l = loop({ message });

    expect(await l.tick()).toMatchObject({ done: 1 });
    expect(order).toEqual([low]);
    expect(getQueueRow(env.store, high)?.status).toBe("pending");

    env.advance(10 * 60_000);
    expect(await l.tick()).toMatchObject({ done: 1 });
    expect(order).toEqual([low, high]);
    expect(getQueueRow(env.store, high)?.status).toBe("done");
  });

  it("a high row a handler enqueues runs in the same tick, before the pending low row", async () => {
    const normal = enqueue("n", "normal");
    const low = enqueue("l", "low");
    let high = 0;
    const order: number[] = [];
    const message: EventHandler = ({ event }) => {
      order.push(event.id);
      if (event.id === normal) high = enqueue("h", "high");
    };
    expect(await loop({ message }).tick()).toMatchObject({ done: 3 });
    expect(order).toEqual([normal, high, low]);
  });

  it("a row parked during the tick is not delivered again in it, even once its retryAt has passed", async () => {
    // Each read of the clock is one second later than the last, so the next
    // query of the tick reads a time after the refusal's retryAt.
    let at = env.now().getTime();
    const now = (): Date => new Date((at += 1_000));
    const id = enqueue("refused once");
    let retryAt = "";
    const message = vi.fn<EventHandler>(() => {
      if (retryAt !== "") return;
      // `at` is the clock the query that found this row read. The park reads
      // at + 1s and the tick's next query at + 2s: retryAt lies between them.
      retryAt = new Date(at + 1_500).toISOString();
      throw new AdmissionRefusedError("cap_parked", retryAt, "parked");
    });
    const l = loop({ message }, now);

    expect(await l.tick()).toMatchObject({ parked: 1, done: 0 });
    expect(message).toHaveBeenCalledTimes(1);
    // The refusal's retryAt was taken (not now + DEFAULT_PARK_MS), and the
    // tick's last query read a later time than it.
    expect(getQueueRow(env.store, id)).toMatchObject({ status: "pending", attempts: 1, not_before: retryAt });
    expect(Date.parse(retryAt)).toBeLessThan(at);

    expect(await l.tick()).toMatchObject({ done: 1 });
    expect(message).toHaveBeenCalledTimes(2);
    expect(getQueueRow(env.store, id)).toMatchObject({ status: "done", attempts: 2 });
  });
});
