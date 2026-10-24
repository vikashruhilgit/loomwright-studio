// The live store's core over a scriptable bridge, in fake time: the throttled
// kind-routed refetch (AC1), dedupe and resume from the last id (AC2), the
// backoff schedule and the honest connection states (AC3), staleness and the
// never-canned status (AC4), truncated frames, every close code, and dispose.
// Assertions spell the brief's numbers (250 ms, 500 ms, 10 000 ms) as
// literals, never the store's constants, so a changed constant fails here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, Approval, EventFrame, StatusBody, TruncatedEventFrame } from "../api/contract";
import { fakeBridge, ok } from "./fake-bridge";
import type { FakeBridge } from "./fake-bridge";
import { KIND_ROUTES, resourcesForKind, threadResource } from "./resources";
import { BACKOFF_INITIAL_MS, REFETCH_THROTTLE_MS, SETTLE_MS, createLiveStore } from "./store";
import type { LiveConnection, LiveStore } from "./store";

const STATUS: StatusBody = {
  kernel: { version: "1.2.3", uptime_s: 1, pid: 7 },
  kill_switch: { engaged: false, since: null },
  auth: [],
  sessions: [],
  kill_unconfirmed: [],
  orphaned: [],
  queue: { pending: 0, events: [] },
  wakeups: { pending: 0, items: [] },
  tokens_today: { day: "2026-10-22", agents: [] },
  cap_state: [],
};

function event(id: number, kind = "task_updated"): EventFrame {
  return { type: "event", id, at: new Date(0).toISOString(), kind, session_id: null, task_id: null, payload: { untrusted: "<b>never interpreted</b>" } };
}

function approval(id: number): Approval {
  return {
    id,
    requesting_agent: "wright",
    requesting_session: null,
    action: "comment",
    payload: {},
    requested_at: new Date(0).toISOString(),
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: null,
  };
}

/** Let every resolved promise chain run (fake timers do not touch microtasks). */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

/** Advance fake time, running timers and the promise chains they start. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
}

function diffs(times: readonly number[]): number[] {
  return times.slice(1).map((t, i) => t - (times[i] as number));
}

/** Every connection view the store passes through. */
function watchViews(store: LiveStore): LiveConnection[] {
  const seen: LiveConnection[] = [store.getSnapshot().connection];
  store.subscribe(() => {
    const view = store.getSnapshot().connection;
    if (seen.at(-1) !== view) seen.push(view);
  });
  return seen;
}

let stores: LiveStore[] = [];

function storeOver(fake: FakeBridge): LiveStore {
  const store = createLiveStore(fake.bridge);
  stores.push(store);
  return store;
}

/** Start `store` and make it live with a heartbeat, then let the reconnect's refetches settle past the throttle. */
async function goLive(fake: FakeBridge, store: LiveStore): Promise<void> {
  store.start();
  await flush();
  expect(fake.subscribeCalls.length).toBeGreaterThan(0);
  fake.emit({ type: "heartbeat", latest_id: 0 });
  expect(store.getSnapshot().connection).toEqual({ state: "live" });
  await advance(REFETCH_THROTTLE_MS * 4);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-22T09:00:00Z"));
});

afterEach(() => {
  for (const store of stores) store.dispose();
  stores = [];
  vi.useRealTimers();
});

describe("refetch by kind, throttled (AC1)", () => {
  it("issues GET /approvals in the same tick as an approval_requested event and applies the answer within one frame", async () => {
    const fake = fakeBridge();
    let approvals: Approval[] = [];
    fake.route("GET /status", () => ok(STATUS));
    fake.route("GET /approvals", () => ok({ approvals }));
    const store = storeOver(fake);
    store.load("approvals");
    await goLive(fake, store);
    expect(store.resource("approvals")?.data?.approvals).toEqual([]);

    let release: () => void = () => undefined;
    approvals = [approval(7)];
    fake.route("GET /approvals", () => new Promise((done) => (release = () => done(ok({ approvals })))));
    const before = fake.requestsTo("GET /approvals").length;
    fake.emit(event(1, "approval_requested"));
    // Leading edge: no debounce, no await.
    expect(fake.requestsTo("GET /approvals").length).toBe(before + 1);

    const applied: number[] = [];
    store.subscribe(() => {
      if (store.resource("approvals")?.data?.approvals.some((a) => a.id === 7) === true) applied.push(Date.now());
    });
    const answeredAt = Date.now();
    release();
    await advance(16);
    expect(store.resource("approvals")?.data?.approvals.map((a) => a.id)).toEqual([7]);
    expect(applied.length).toBeGreaterThan(0);
    expect((applied[0] as number) - answeredAt).toBeLessThanOrEqual(16);
  });

  it("20 approval_* events within 250 ms: at most one GET /approvals per 250 ms, one in flight, leading and trailing", async () => {
    const fake = fakeBridge();
    // The kernel's list grows with each event; an answer is the list when its read arrived.
    let kernelCount = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const starts: number[] = [];
    fake.route("GET /status", () => ok(STATUS));
    fake.route("GET /approvals", () => ok({ approvals: [] as Approval[] }));
    const store = storeOver(fake);
    store.load("approvals");
    await goLive(fake, store);

    fake.route("GET /approvals", () => {
      starts.push(Date.now());
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const answer = Array.from({ length: kernelCount }, (_, i) => approval(i + 1));
      return new Promise((done) =>
        setTimeout(() => {
          inFlight -= 1;
          done(ok({ approvals: answer }));
        }, 40),
      );
    });
    const burstStart = Date.now();
    let lastEventAt = burstStart;
    for (let i = 1; i <= 20; i += 1) {
      kernelCount = i;
      lastEventAt = Date.now();
      fake.emit(event(i, i % 2 === 0 ? "approval_decided" : "approval_requested"));
      if (i < 20) await advance(12);
    }
    expect(lastEventAt - burstStart).toBeLessThan(250);
    await advance(2_000);

    expect(starts[0]).toBe(burstStart);
    for (const gap of diffs(starts)) expect(gap).toBeGreaterThanOrEqual(250);
    expect(maxInFlight).toBe(1);
    expect(starts.at(-1) as number).toBeGreaterThan(lastEventAt);
    expect(starts.length).toBeLessThanOrEqual(Math.ceil((Date.now() - burstStart) / 250) + 1);
    // The resource ends on the answer to a read issued after the last event.
    expect(store.resource("approvals")?.data?.approvals.length).toBe(20);
  });

  it("a backward wall-clock step between two events never stalls the throttled refetch", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    fake.route("GET /approvals", () => ok({ approvals: [] as Approval[] }));
    const store = storeOver(fake);
    store.load("approvals");
    await goLive(fake, store);
    fake.emit(event(1, "approval_requested"));
    await flush();
    const before = fake.requestsTo("GET /approvals").length;
    vi.setSystemTime(Date.now() - 3_600_000);
    fake.emit(event(2, "approval_requested"));
    await advance(250);
    expect(fake.requestsTo("GET /approvals").length).toBe(before + 1);
  });

  it("refetch() reads a used resource again (throttled) and loads an unused one", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    fake.route("GET /approvals", () => ok({ approvals: [] as Approval[] }));
    const store = storeOver(fake);
    await goLive(fake, store);
    expect(store.resource("approvals")).toBeUndefined();
    store.refetch("approvals");
    expect(fake.requestsTo("GET /approvals").length).toBe(1);
    store.refetch("approvals");
    store.refetch("approvals");
    await advance(250);
    expect(fake.requestsTo("GET /approvals").length).toBe(2);
    // load() on a used resource does nothing.
    store.load("approvals");
    await advance(1_000);
    expect(fake.requestsTo("GET /approvals").length).toBe(2);
  });

  it("refetches only resources in use, by kind, plus every loaded thread; payload is never read", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    const store = storeOver(fake);
    store.load("agents");
    store.load("messages");
    store.load(threadResource("wright"));
    await goLive(fake, store);
    const count = (key: string): number => fake.requestsTo(key).length;
    const base = { agents: count("GET /agents"), messages: count("GET /messages"), threads: count("GET /threads/:agent"), status: count("GET /status") };

    fake.emit(event(1, "agent_message_queued"));
    expect(count("GET /messages")).toBe(base.messages + 1);
    expect(count("GET /agents")).toBe(base.agents);
    expect(count("GET /threads/:agent")).toBe(base.threads + 1);
    expect(fake.requestsTo("GET /threads/:agent").at(-1)?.req.params).toEqual({ agent: "wright" });
    expect(fake.requestsTo("GET /messages").at(-1)?.req.query).toEqual({ all: "1" });
    // approvals is not in use: nothing is fetched for it.
    fake.emit(event(2, "approval_requested"));
    expect(count("GET /approvals")).toBe(0);
    await advance(1_000);
    const status = count("GET /status");
    fake.emit(event(3, "something_new"));
    expect(count("GET /status")).toBe(status + 1);
  });

  it("reads GET /playbooks with all=1, so a disabled playbook stays in the list (and on its card)", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    fake.route("GET /playbooks", () => ok({ playbooks: [] }));
    const store = storeOver(fake);
    store.load("playbooks");
    await goLive(fake, store);
    fake.emit(event(1, "playbook_disabled"));
    await advance(1_000);
    const reads = fake.requestsTo("GET /playbooks");
    expect(reads.length).toBeGreaterThan(1);
    for (const read of reads) expect(read.req.query).toEqual({ all: "1" });
  });

  it("routes the kernel's real kinds by prefix, first match wins", () => {
    expect(resourcesForKind("approval_requested")).toEqual(["approvals", "grants"]);
    expect(resourcesForKind("agent_message_queued")).toEqual(["messages"]);
    expect(resourcesForKind("agent_created")).toEqual(["agents"]);
    expect(resourcesForKind("playbook_updated")).toEqual(["playbooks", "triggers"]);
    expect(resourcesForKind("trigger_fired")).toEqual(["triggers"]);
    expect(resourcesForKind("wakeup_scheduled")).toEqual(["triggers", "status"]);
    expect(resourcesForKind("notification_created")).toEqual(["notifications"]);
    expect(resourcesForKind("notify")).toEqual(["notifications"]);
    expect(resourcesForKind("session_status")).toEqual(["sessions", "status"]);
    expect(resourcesForKind("stop_requested")).toEqual(["sessions", "status"]);
    expect(resourcesForKind("tool_decision")).toEqual(["sessions", "status"]);
    // Not a kernel kind: `work_step_interrupted` is a `notify` event's payload reason, so a frame of that kind takes the default route.
    expect(resourcesForKind("work_step_interrupted")).toEqual(["status"]);
    expect(resourcesForKind("event_done")).toEqual(["status", "messages"]);
    expect(resourcesForKind("task_updated")).toEqual(["status"]);
    expect(resourcesForKind("cap_warning")).toEqual(["status"]);
    expect(KIND_ROUTES.findIndex((r) => r.prefix === "agent_message_")).toBeLessThan(KIND_ROUTES.findIndex((r) => r.prefix === "agent_"));
  });
});

describe("dedupe and resume (AC2, fake bridge)", () => {
  it("drops duplicate ids and counts them", async () => {
    const fake = fakeBridge();
    const store = storeOver(fake);
    await goLive(fake, store);
    for (const id of [1, 2, 3, 2, 3, 4]) fake.emit(event(id));
    const snap = store.getSnapshot();
    expect(snap.eventLog.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    expect(snap.duplicatesDropped).toBe(2);
    expect(snap.lastEventId).toBe(4);
  });

  it("after a close, resubscribes with after = the last id; an overlapping replay is dropped and counted", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    const store = storeOver(fake);
    store.start();
    await flush();
    expect(fake.subscribeCalls).toEqual([{ at: Date.now(), after: 0 }]);
    for (const id of [1, 2, 3]) fake.emit(event(id));
    expect(store.getSnapshot().connection).toEqual({ state: "live" });

    fake.emit({ type: "closed", code: 1006, reason: "" });
    expect(store.getSnapshot().connection.state).toBe("reconnecting");
    await advance(BACKOFF_INITIAL_MS - 1);
    expect(fake.subscribeCalls.length).toBe(1);
    await advance(1);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(3);
    for (const id of [3, 4, 5]) fake.emit(event(id));
    const snap = store.getSnapshot();
    expect(snap.connection).toEqual({ state: "live" });
    expect(snap.eventLog.map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
    expect(snap.lastEventId).toBe(5);
    expect(snap.duplicatesDropped).toBe(1);
  });

  /** Live on pid 7 with events 1..3 in the log, then the feed closes. */
  async function liveThenClosed(): Promise<{ fake: FakeBridge; store: LiveStore }> {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    const store = storeOver(fake);
    await goLive(fake, store);
    for (const id of [1, 2, 3]) fake.emit(event(id));
    fake.emit({ type: "closed", code: 1006, reason: "" });
    return { fake, store };
  }

  const RESTARTED: StatusBody = { ...STATUS, kernel: { ...STATUS.kernel, pid: 8 } };

  it.each([
    ["the last event's row is gone", [] as EventFrame[]],
    ["the last id names another event", [event(3, "agent_created")]],
    ["the last id names an event at another time", [{ ...event(3), at: new Date(1_000).toISOString() }]],
  ])("a new kernel pid and %s: the ids reset, resubscribe from 0, every used resource refetched", async (_why, rows) => {
    const { fake, store } = await liveThenClosed();
    fake.route("GET /status", () => ok(RESTARTED));
    fake.route("GET /events", () => ok({ events: rows }));
    const statusBefore = fake.requestsTo("GET /status").length;
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.requestsTo("GET /events").at(-1)?.req.query).toEqual({ after: "2", limit: "1" });
    expect(fake.subscribeCalls.at(-1)?.after).toBe(0);
    expect(store.getSnapshot().lastEventId).toBe(0);
    expect(store.getSnapshot().eventLog).toEqual([]);

    // The new kernel's ids 1 and 2 are new events, not duplicates.
    fake.emit(event(1));
    fake.emit(event(2));
    const snap = store.getSnapshot();
    expect(snap.connection).toEqual({ state: "live" });
    expect(snap.eventLog.map((e) => e.id)).toEqual([1, 2]);
    expect(snap.duplicatesDropped).toBe(0);
    await advance(REFETCH_THROTTLE_MS * 4);
    // One probe, then one refetch on going live (the events route status too, throttled into it).
    expect(fake.requestsTo("GET /status").length).toBeGreaterThanOrEqual(statusBefore + 2);
    expect(store.getSnapshot().status).toEqual(RESTARTED);

    // The next reconnect knows pid 8: no row read, the ids are kept.
    const eventsReads = fake.requestsTo("GET /events").length;
    fake.emit({ type: "closed", code: 1006, reason: "" });
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.requestsTo("GET /events").length).toBe(eventsReads);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(2);
  });

  it("a new kernel pid with the same last row (a restart on the same data): the ids are kept and an overlap is still dropped", async () => {
    const { fake, store } = await liveThenClosed();
    fake.route("GET /status", () => ok(RESTARTED));
    fake.route("GET /events", () => ok({ events: [event(3)] }));
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.requestsTo("GET /events").length).toBe(1);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(3);
    for (const id of [3, 4]) fake.emit(event(id));
    const snap = store.getSnapshot();
    expect(snap.eventLog.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    expect(snap.duplicatesDropped).toBe(1);
  });

  it("the same kernel pid: no row read, the ids are kept", async () => {
    const { fake } = await liveThenClosed();
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.requestsTo("GET /events").length).toBe(0);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(3);
  });

  it("a refused probe or row read keeps the ids; an unreachable or failed one is a failed attempt", async () => {
    const { fake, store } = await liveThenClosed();
    // GET /status refused: cannot tell, keep the ids.
    fake.route("GET /status", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(3);
    fake.emit({ type: "closed", code: 1006, reason: "" });

    // GET /status unreachable: no subscribe, retried after the backoff.
    fake.route("GET /status", () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } }));
    const subscribes = fake.subscribeCalls.length;
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.subscribeCalls.length).toBe(subscribes);
    expect(store.getSnapshot().connection.state).toBe("reconnecting");

    // The row read unreachable, then throwing: still no subscribe.
    fake.route("GET /status", () => ok(RESTARTED));
    fake.route("GET /events", () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "timeout" } }));
    await advance(1_000);
    expect(fake.subscribeCalls.length).toBe(subscribes);
    const request = fake.bridge.request;
    fake.bridge.request = (req) => {
      if (req.path === "/events") throw new Error("ipc gone");
      return request(req);
    };
    await advance(2_000);
    expect(fake.subscribeCalls.length).toBe(subscribes);

    // The row read refused: cannot tell, keep the ids.
    fake.bridge.request = request;
    fake.route("GET /events", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    await advance(4_000);
    expect(fake.subscribeCalls.length).toBe(subscribes + 1);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(3);
    expect(store.getSnapshot().lastEventId).toBe(3);
  });

  it("a truncated row fetched before an id reset is not applied to the new kernel's event with that id", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    const store = storeOver(fake);
    await goLive(fake, store);
    let release: () => void = () => undefined;
    const old = event(1, "approval_requested");
    fake.route("GET /events", () => new Promise((done) => (release = () => done(ok({ events: [old] })))));
    fake.emit({ type: "event", id: 1, kind: "approval_requested", truncated: true });
    fake.emit({ type: "closed", code: 1006, reason: "" });
    // The new kernel's table does not have the old row.
    const pending = release;
    fake.route("GET /status", () => ok(RESTARTED));
    fake.route("GET /events", () => ok({ events: [] }));
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(0);
    const fresh = event(1, "agent_created");
    fake.emit(fresh);
    pending();
    await flush();
    expect(store.getSnapshot().eventLog).toEqual([fresh]);
  });

  it("a refused row read leaves the new pid unverified: the next reconnect reads the row again and a wiped table resets to 0", async () => {
    const { fake, store } = await liveThenClosed();
    fake.route("GET /status", () => ok(RESTARTED));
    fake.route("GET /events", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.requestsTo("GET /events").length).toBe(1);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(3);
    fake.emit({ type: "heartbeat", latest_id: 0 });
    fake.emit({ type: "closed", code: 1006, reason: "" });

    // Same pid 8, but it was never verified: the row is read, it is gone, the ids reset.
    fake.route("GET /events", () => ok({ events: [] }));
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.requestsTo("GET /events").length).toBe(2);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(0);
    expect(store.getSnapshot().lastEventId).toBe(0);
    fake.emit(event(1));
    expect(store.getSnapshot().eventLog.map((e) => e.id)).toEqual([1]);
    expect(store.getSnapshot().duplicatesDropped).toBe(0);
  });

  it("GET /status refused for the whole first session, then a refused row read: the open feed's GET /status never records the pid in the row check's place", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    const store = storeOver(fake);
    await goLive(fake, store);
    for (const id of [1, 2, 3]) fake.emit(event(id));
    await advance(REFETCH_THROTTLE_MS * 4);
    fake.emit({ type: "closed", code: 1006, reason: "" });

    // pid 8 with a wiped table, but the row read is refused: the ids are kept, unverified.
    fake.route("GET /status", () => ok(RESTARTED));
    fake.route("GET /events", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.requestsTo("GET /events").length).toBe(1);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(3);
    // Going live refetches status inside the open feed: it answers pid 8.
    fake.emit({ type: "heartbeat", latest_id: 0 });
    await advance(REFETCH_THROTTLE_MS * 4);
    expect(store.getSnapshot().status).toEqual(RESTARTED);
    fake.emit({ type: "closed", code: 1006, reason: "" });

    // Still unverified: the row is read again, it is gone, the ids reset.
    fake.route("GET /events", () => ok({ events: [] }));
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.requestsTo("GET /events").length).toBe(2);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(0);
    expect(store.getSnapshot().lastEventId).toBe(0);
  });

  it("a healthy session records the pid on first live: a same-pid reconnect makes no row read", async () => {
    const { fake, store } = await liveThenClosed();
    await advance(BACKOFF_INITIAL_MS);
    fake.emit({ type: "heartbeat", latest_id: 3 });
    fake.emit({ type: "closed", code: 1006, reason: "" });
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.requestsTo("GET /events").length).toBe(0);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(3);
    expect(store.getSnapshot().lastEventId).toBe(3);
  });

  it("GET /status throwing during the probe is a failed attempt: no subscribe until a later probe answers", async () => {
    const { fake, store } = await liveThenClosed();
    const request = fake.bridge.request;
    fake.bridge.request = (req) => {
      if (req.path === "/status") throw new Error("ipc gone");
      return request(req);
    };
    const subscribes = fake.subscribeCalls.length;
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.subscribeCalls.length).toBe(subscribes);
    expect(store.getSnapshot().connection.state).toBe("reconnecting");
    fake.bridge.request = request;
    await advance(1_000);
    expect(fake.subscribeCalls.length).toBe(subscribes + 1);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(3);
  });

  it("a status body with no kernel pid keeps the ids with no row read", async () => {
    const { fake, store } = await liveThenClosed();
    const { pid: _pid, ...kernel } = STATUS.kernel;
    fake.route("GET /status", () => ok({ ...STATUS, kernel } as unknown as StatusBody));
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.requestsTo("GET /events").length).toBe(0);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(3);
    expect(store.getSnapshot().lastEventId).toBe(3);
  });

  it("an events body with no events array, after a new pid, is a wiped table: the ids reset", async () => {
    const { fake, store } = await liveThenClosed();
    fake.route("GET /status", () => ok(RESTARTED));
    fake.route("GET /events", () => ok({}));
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(0);
    expect(store.getSnapshot().lastEventId).toBe(0);
  });

  it("a truncated last frame, or one evicted from the log, matches the new pid's row by id (and kind) alone", async () => {
    // Truncated in the log: `at` is unknown, the kind still has to match.
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    fake.route("GET /events", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    const store = storeOver(fake);
    await goLive(fake, store);
    fake.emit({ type: "event", id: 3, kind: "task_updated", truncated: true });
    fake.emit({ type: "closed", code: 1006, reason: "" });
    fake.route("GET /status", () => ok(RESTARTED));
    fake.route("GET /events", () => ok({ events: [{ ...event(3), at: new Date(5_000).toISOString() }] }));
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(3);

    // Evicted (a log of 0): any row with that id is the same event.
    const evicted = fakeBridge();
    evicted.route("GET /status", () => ok(STATUS));
    const small = createLiveStore(evicted.bridge, { eventLogLimit: 0 });
    stores.push(small);
    await goLive(evicted, small);
    evicted.emit(event(3));
    evicted.emit({ type: "closed", code: 1006, reason: "" });
    evicted.route("GET /status", () => ok(RESTARTED));
    evicted.route("GET /events", () => ok({ events: [event(3, "agent_created")] }));
    await advance(BACKOFF_INITIAL_MS);
    expect(evicted.requestsTo("GET /events").length).toBe(1);
    expect(evicted.subscribeCalls.at(-1)?.after).toBe(3);
  });

  it("dispose() and start() while the probe is pending: the stale probe changes nothing, one subscribe from the last id", async () => {
    const { fake, store } = await liveThenClosed();
    const held: ((answer: ApiResult<unknown>) => void)[] = [];
    let hold = false;
    fake.route("GET /status", () => (hold ? new Promise((done) => held.push(done)) : ok(STATUS)));
    fake.route("GET /events", () => ok({ events: [] }));
    await advance(BACKOFF_INITIAL_MS - 1);
    hold = true;
    await advance(1);
    expect(held.length).toBe(1);
    store.dispose();
    hold = false;
    const subscribes = fake.subscribeCalls.length;
    store.start();
    await flush();
    // The old attempt's probe answers late, from a "new" kernel: ignored.
    held[0]?.(ok(RESTARTED));
    await flush();
    expect(fake.subscribeCalls.length).toBe(subscribes + 1);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(3);
    expect(fake.requestsTo("GET /events").length).toBe(0);
    expect(store.getSnapshot().lastEventId).toBe(3);
  });

  it("dispose() and start() while the row read is pending: the stale row changes nothing, one subscribe from the last id", async () => {
    const { fake, store } = await liveThenClosed();
    fake.route("GET /status", () => ok(RESTARTED));
    const held: ((answer: ApiResult<unknown>) => void)[] = [];
    fake.route("GET /events", () => new Promise((done) => held.push(done)));
    await advance(BACKOFF_INITIAL_MS);
    expect(held.length).toBe(1);
    store.dispose();
    fake.route("GET /events", () => ok({ events: [event(3)] }));
    const subscribes = fake.subscribeCalls.length;
    store.start();
    await flush();
    // The old attempt's row answers late: "gone", which would reset. Ignored.
    held[0]?.(ok({ events: [] }));
    await flush();
    expect(fake.subscribeCalls.length).toBe(subscribes + 1);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(3);
    expect(store.getSnapshot().lastEventId).toBe(3);
    expect(store.getSnapshot().eventLog.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("a frame that moves lastEventId during the row read: no reset, and the pid stays unverified until a later row check", async () => {
    const { fake, store } = await liveThenClosed();
    fake.route("GET /status", () => ok(RESTARTED));
    const held: ((answer: ApiResult<unknown>) => void)[] = [];
    fake.route("GET /events", () => new Promise((done) => held.push(done)));
    await advance(BACKOFF_INITIAL_MS);
    expect(held.length).toBe(1);
    fake.emit(event(4));
    held[0]?.(ok({ events: [] }));
    await flush();
    expect(fake.subscribeCalls.at(-1)?.after).toBe(4);
    expect(store.getSnapshot().lastEventId).toBe(4);
    expect(store.getSnapshot().eventLog.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    fake.emit({ type: "heartbeat", latest_id: 4 });
    fake.emit({ type: "closed", code: 1006, reason: "" });

    // Unverified: the row is read again; it matches, so pid 8 is recorded.
    fake.route("GET /events", () => ok({ events: [event(4)] }));
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.requestsTo("GET /events").length).toBe(2);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(4);
    fake.emit({ type: "heartbeat", latest_id: 4 });
    fake.emit({ type: "closed", code: 1006, reason: "" });

    // Verified now: no further row read.
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.requestsTo("GET /events").length).toBe(2);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(4);
  });

  it("a status answer that arrives after the feed closed never names the ids' kernel", async () => {
    // No pid known yet: the probes while live are refused.
    const fake = fakeBridge();
    fake.route("GET /status", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    const store = storeOver(fake);
    await goLive(fake, store);
    for (const id of [1, 2, 3]) fake.emit(event(id));
    await advance(REFETCH_THROTTLE_MS * 4);
    // A status refetch sent while live, answered by a restarted kernel after the close.
    const held: ((answer: ApiResult<unknown>) => void)[] = [];
    fake.route("GET /status", () => new Promise((done) => held.push(done)));
    fake.emit(event(4));
    expect(held.length).toBe(1);
    fake.emit({ type: "closed", code: 1006, reason: "" });
    fake.route("GET /status", () => ok(RESTARTED));
    held[0]?.(ok(RESTARTED));
    await flush();
    expect(store.getSnapshot().status).toEqual(RESTARTED);

    // pid 8 was not recorded as the ids' kernel: the row is read, it is gone, the ids reset.
    fake.route("GET /events", () => ok({ events: [] }));
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.requestsTo("GET /events").length).toBe(1);
    expect(fake.subscribeCalls.at(-1)?.after).toBe(0);
    expect(store.getSnapshot().lastEventId).toBe(0);
  });

  it("keeps the event log bounded, oldest dropped first", async () => {
    const fake = fakeBridge();
    const store = createLiveStore(fake.bridge, { eventLogLimit: 3 });
    stores.push(store);
    await goLive(fake, store);
    for (let id = 1; id <= 5; id += 1) fake.emit(event(id));
    expect(store.getSnapshot().eventLog.map((e) => e.id)).toEqual([3, 4, 5]);
    expect(store.getSnapshot().lastEventId).toBe(5);
  });

  it.each([1013, 1011, 1006, 1001])("a %i close from live: reconnecting, then a retry after 500 ms from the last id", async (code) => {
    const fake = fakeBridge();
    const store = storeOver(fake);
    await goLive(fake, store);
    fake.emit(event(9));
    fake.emit({ type: "closed", code, reason: "bye" });
    expect(store.getSnapshot().connection.state).toBe("reconnecting");
    const closedAt = Date.now();
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.subscribeCalls.at(-1)).toEqual({ at: closedAt + 500, after: 9 });
  });
});

describe("connection states and backoff (AC3)", () => {
  it("(i) dead port: unreachable, never live, connection() spaced 500, 1 000, 2 000, … capped at 10 000 ms", async () => {
    const fake = fakeBridge({ state: "unreachable", reason: "connection_failed" });
    const store = storeOver(fake);
    const views = watchViews(store);
    store.start();
    await flush();
    expect(store.getSnapshot().connection).toEqual({ state: "unreachable", reason: "connection_failed" });
    await advance(60_000);
    expect(diffs(fake.connectionCalls).slice(0, 8)).toEqual([500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000]);
    expect(views.map((v) => v.state)).not.toContain("live");
    expect(fake.subscribeCalls).toEqual([]);

    // A kernel answers: the next attempt goes live, and the backoff resets.
    fake.connectionAnswer = { state: "connected", port: 1 };
    fake.subscribeAnswer = { state: "connected", port: 1 };
    while (fake.subscribeCalls.length === 0) await advance(100);
    expect(store.getSnapshot().connection).toEqual({ state: "connecting" });
    fake.emit({ type: "heartbeat", latest_id: 0 });
    expect(store.getSnapshot().connection).toEqual({ state: "live" });
  });

  it("not installed: the bridge's own dataDir, unchanged", async () => {
    const fake = fakeBridge({ state: "not_installed", dataDir: "/Users/o/.loomwright-studio" });
    const store = storeOver(fake);
    store.start();
    await flush();
    expect(store.getSnapshot().connection).toEqual({ state: "not_installed", dataDir: "/Users/o/.loomwright-studio" });
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.connectionCalls.length).toBe(2);
  });

  it("(ii) REST up, socket dies before SETTLE_MS: never live, the backoff never resets; a subscription open SETTLE_MS goes live", async () => {
    const fake = fakeBridge();
    fake.closeAfterSubscribe = 4;
    const store = storeOver(fake);
    const views = watchViews(store);
    store.start();
    await flush();
    await advance(500 + 1_000 + 2_000 + 4_000);
    expect(fake.subscribeCalls.length).toBe(5);
    expect(diffs(fake.subscribeCalls.map((c) => c.at))).toEqual([500, 1_000, 2_000, 4_000]);
    expect(views.map((v) => v.state)).toEqual(["connecting"]);

    // The fifth stays open.
    await advance(SETTLE_MS - 1);
    expect(store.getSnapshot().connection).toEqual({ state: "connecting" });
    await advance(1);
    expect(store.getSnapshot().connection).toEqual({ state: "live" });

    // Success reset the backoff: the next close retries after 500 ms.
    fake.emit({ type: "closed", code: 1006, reason: "" });
    const closedAt = Date.now();
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.subscribeCalls.at(-1)?.at).toBe(closedAt + 500);
  });

  it("a subscribe that answers unreachable is a failed attempt", async () => {
    const fake = fakeBridge();
    fake.subscribeAnswer = { state: "unreachable", reason: "daemon_not_running" };
    const store = storeOver(fake);
    store.start();
    await flush();
    expect(store.getSnapshot().connection).toEqual({ state: "unreachable", reason: "daemon_not_running" });
    await advance(BACKOFF_INITIAL_MS);
    expect(fake.connectionCalls.length).toBe(2);
  });

  it("a failed REST read never changes the connection state", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } }));
    const store = storeOver(fake);
    store.start();
    await flush();
    expect(store.resource("status")?.error).toEqual({ kind: "not_connected", connection: { state: "unreachable", reason: "connection_failed" } });
    expect(store.getSnapshot().connection).toEqual({ state: "connecting" });
    await advance(SETTLE_MS);
    expect(store.getSnapshot().connection).toEqual({ state: "live" });
  });
});

describe("honest data (AC4)", () => {
  it("status is undefined until GET /status answers, and a refusal is never data", async () => {
    const fake = fakeBridge();
    let release: () => void = () => undefined;
    fake.route("GET /status", () => new Promise((done) => (release = () => done(ok(STATUS)))));
    const store = storeOver(fake);
    expect(store.getSnapshot().status).toBeUndefined();
    store.start();
    await flush();
    expect(store.getSnapshot().status).toBeUndefined();
    expect(store.resource("status")?.data).toBeUndefined();
    expect(store.resource("status")?.loading).toBe(true);
    release();
    await flush();
    expect(store.getSnapshot().status).toEqual(STATUS);

    fake.route("GET /approvals", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    store.load("approvals");
    await flush();
    expect(store.resource("approvals")?.data).toBeUndefined();
    expect(store.resource("approvals")?.error).toEqual({ kind: "refused", status: 500, body: { error: "internal" } });
  });

  it("every loaded resource is stale while reconnecting, refetched once on reconnect, and fresh again when live", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    fake.route("GET /approvals", () => ok({ approvals: [approval(1)] }));
    const store = storeOver(fake);
    store.load("approvals");
    await goLive(fake, store);
    expect(store.resource("approvals")?.stale).toBe(false);
    const lastUpdated = store.getSnapshot().lastUpdated;
    expect(lastUpdated).not.toBeNull();

    await advance(5_000);
    fake.emit({ type: "closed", code: 1006, reason: "" });
    expect(store.getSnapshot().connection).toEqual({ state: "reconnecting", lastUpdated });
    expect(store.resource("approvals")).toMatchObject({ stale: true, data: { approvals: [approval(1)] } });
    expect(store.resource("status")?.stale).toBe(true);

    const before = { approvals: fake.requestsTo("GET /approvals").length, status: fake.requestsTo("GET /status").length };
    await advance(BACKOFF_INITIAL_MS);
    fake.emit({ type: "heartbeat", latest_id: 0 });
    expect(store.getSnapshot().connection).toEqual({ state: "live" });
    await advance(REFETCH_THROTTLE_MS * 4);
    expect(fake.requestsTo("GET /approvals").length).toBe(before.approvals + 1);
    expect(fake.requestsTo("GET /status").length).toBe(before.status + 1);
    expect(store.resource("approvals")?.stale).toBe(false);
  });

  it("a heartbeat refreshes lastUpdated only", async () => {
    const fake = fakeBridge();
    const store = storeOver(fake);
    await goLive(fake, store);
    const requests = fake.requests.length;
    await advance(3_000);
    fake.emit({ type: "heartbeat", latest_id: 99 });
    const snap = store.getSnapshot();
    expect(snap.lastUpdated).toBe(Date.now());
    expect(snap.lastEventId).toBe(0);
    expect(snap.eventLog).toEqual([]);
    expect(fake.requests.length).toBe(requests);
  });

  it("a truncated frame is fetched through GET /events?after=<id-1>&limit=1, then routed", async () => {
    const fake = fakeBridge();
    const full = event(4, "approval_requested");
    fake.route("GET /events", () => ok({ events: [full] }));
    fake.route("GET /approvals", () => ok({ approvals: [] as Approval[] }));
    const store = storeOver(fake);
    store.load("approvals");
    await goLive(fake, store);
    const approvalsBefore = fake.requestsTo("GET /approvals").length;
    const truncated: TruncatedEventFrame = { type: "event", id: 4, kind: "approval_requested", truncated: true };
    fake.emit(truncated);
    expect(fake.requestsTo("GET /events").at(-1)?.req.query).toEqual({ after: "3", limit: "1" });
    expect(store.getSnapshot().lastEventId).toBe(4);
    await flush();
    expect(store.getSnapshot().eventLog).toEqual([full]);
    expect(fake.requestsTo("GET /approvals").length).toBe(approvalsBefore + 1);
  });

  it("drops a malformed event frame", async () => {
    const fake = fakeBridge();
    const store = storeOver(fake);
    await goLive(fake, store);
    fake.emit({ type: "event", id: -1, kind: "x" } as unknown as EventFrame);
    fake.emit({ type: "event", id: 2, kind: 5 } as unknown as EventFrame);
    fake.emit({ type: "event", id: 1.5, kind: "x" } as unknown as EventFrame);
    fake.emit(null as unknown as EventFrame);
    expect(store.getSnapshot().eventLog).toEqual([]);
    expect(store.getSnapshot().lastEventId).toBe(0);
  });
});

describe("failure paths", () => {
  it("connection() or feed.subscribe rejecting (a failed IPC call) is a failed attempt, never live", async () => {
    const fake = fakeBridge();
    fake.bridge.connection = () => Promise.reject(new Error("ipc"));
    const store = storeOver(fake);
    store.start();
    await flush();
    expect(store.getSnapshot().connection).toEqual({ state: "unreachable", reason: "connection_failed" });
    fake.bridge.connection = async () => ({ state: "connected", port: 1 });
    fake.bridge.feed.subscribe = () => Promise.reject(new Error("ipc"));
    await advance(500);
    expect(store.getSnapshot().connection.state).not.toBe("live");
    await advance(SETTLE_MS);
    expect(store.getSnapshot().connection.state).not.toBe("live");
  });

  it("a request that throws, or a truncated row the kernel refuses: an error, never data; the truncated frame is still routed", async () => {
    const fake = fakeBridge();
    fake.route("GET /events", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    const store = storeOver(fake);
    store.load("notifications");
    await goLive(fake, store);
    const before = fake.requestsTo("GET /notifications").length;
    const truncated: TruncatedEventFrame = { type: "event", id: 3, kind: "notification_created", truncated: true };
    fake.emit(truncated);
    await flush();
    expect(store.getSnapshot().eventLog).toEqual([truncated]);
    expect(fake.requestsTo("GET /notifications").length).toBe(before + 1);

    fake.bridge.request = () => {
      throw new Error("ipc gone");
    };
    store.load("agents");
    await flush();
    expect(store.resource("agents")).toMatchObject({ data: undefined, error: { kind: "bridge_failed" }, loading: false });
  });

  it("a close while not subscribed (a late frame) changes nothing", async () => {
    const fake = fakeBridge({ state: "unreachable", reason: "timeout" });
    const store = storeOver(fake);
    store.start();
    await flush();
    fake.emit({ type: "closed", code: 1006, reason: "" });
    expect(store.getSnapshot().connection).toEqual({ state: "unreachable", reason: "timeout" });
    await advance(500);
    expect(fake.connectionCalls.length).toBe(2);
  });
});

describe("dispose", () => {
  it("unsubscribes the feed, removes the frame listener and leaves no timer", async () => {
    const fake = fakeBridge();
    fake.route("GET /approvals", () => ok({ approvals: [] as Approval[] }));
    const store = createLiveStore(fake.bridge);
    store.load("approvals");
    await goLive(fake, store);
    // A trailing refetch (throttle timer) and a pending retry are both owed.
    fake.emit(event(1, "approval_requested"));
    fake.emit(event(2, "approval_requested"));
    await flush();
    fake.emit({ type: "closed", code: 1011, reason: "" });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(fake.listenerCount()).toBe(1);

    store.dispose();
    await flush();
    expect(vi.getTimerCount()).toBe(0);
    expect(fake.listenerCount()).toBe(0);
    expect(fake.unsubscribes).toBe(1);
    const requests = fake.requests.length;
    await advance(60_000);
    expect(fake.requests.length).toBe(requests);
    expect(fake.connectionCalls.length).toBe(1);
  });

  it("clears a pending attempt's settle timer, through the injected timers with opaque handles", async () => {
    const fake = fakeBridge();
    const live = new Map<object, ReturnType<typeof setTimeout>>();
    const store = createLiveStore(fake.bridge, {
      setTimeout: (callback, ms) => {
        const handle = {};
        live.set(
          handle,
          setTimeout(() => {
            live.delete(handle);
            callback();
          }, ms),
        );
        return handle;
      },
      clearTimeout: (handle) => {
        clearTimeout(live.get(handle as object));
        live.delete(handle as object);
      },
    });
    store.start();
    await flush();
    expect(live.size).toBeGreaterThan(0);
    store.dispose();
    expect(live.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("can start again after a dispose (StrictMode's double effect), keeping its data", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    const store = storeOver(fake);
    await goLive(fake, store);
    fake.emit(event(5));
    store.dispose();
    store.start();
    await flush();
    expect(fake.subscribeCalls.at(-1)?.after).toBe(5);
    expect(store.getSnapshot().status).toEqual(STATUS);
    expect(fake.listenerCount()).toBe(1);
  });

  it("a live store is not live once disposed, nor after a restart until an attempt succeeds", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    fake.route("GET /approvals", () => ok({ approvals: [] as Approval[] }));
    const store = storeOver(fake);
    store.load("approvals");
    await goLive(fake, store);
    expect(store.resource("approvals")?.stale).toBe(false);
    const lastUpdated = store.getSnapshot().lastUpdated;

    store.dispose();
    expect(store.getSnapshot().connection).toEqual({ state: "reconnecting", lastUpdated });
    expect(store.resource("approvals")?.stale).toBe(true);
    expect(store.resource("approvals")?.data?.approvals).toEqual([]);

    // The restart's `connection()` has not answered yet.
    let answer: () => void = () => undefined;
    vi.spyOn(fake.bridge, "connection").mockImplementationOnce(
      () => new Promise((done) => (answer = () => done({ state: "connected", port: 1 }))),
    );
    store.start();
    await flush();
    expect(store.getSnapshot().connection).toEqual({ state: "reconnecting", lastUpdated });
    expect(store.resource("approvals")?.stale).toBe(true);

    answer();
    await flush();
    fake.emit({ type: "heartbeat", latest_id: 0 });
    expect(store.getSnapshot().connection).toEqual({ state: "live" });
    expect(store.resource("approvals")?.stale).toBe(false);
  });

  it("a store never live goes back to connecting on dispose, not the bridge's old answer", async () => {
    const fake = fakeBridge({ state: "not_installed", dataDir: "/Users/o/.loomwright-studio" });
    const store = storeOver(fake);
    store.start();
    await flush();
    expect(store.getSnapshot().connection).toEqual({ state: "not_installed", dataDir: "/Users/o/.loomwright-studio" });

    store.dispose();
    expect(store.getSnapshot().connection).toEqual({ state: "connecting" });
    expect(store.resource("status")?.stale).toBe(true);

    let answer: () => void = () => undefined;
    vi.spyOn(fake.bridge, "connection").mockImplementationOnce(
      () => new Promise((done) => (answer = () => done({ state: "connected", port: 1 }))),
    );
    store.start();
    await flush();
    expect(store.getSnapshot().connection).toEqual({ state: "connecting" });
    expect(store.resource("status")?.stale).toBe(true);
    answer();
    await flush();
  });
});
