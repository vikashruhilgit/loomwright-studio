// The app's one live store (phase 5 item 12): every resource loaded over REST
// through the preload bridge, kept current by the kernel's event feed.
//
// - Each resource is one contract read (`./resources.ts`). `status` loads at
//   start; every other resource on its first use.
// - The feed is followed by `kind` only (`payload` is untrusted and never
//   interpreted): an event refetches the loaded resources its kind routes to,
//   throttled per resource (leading and trailing edge, at most one per
//   `REFETCH_THROTTLE_MS`, at most one in flight).
// - Event ids are deduped (`id <= lastEventId` is dropped and counted), and
//   the store resubscribes with `after = lastEventId`, so a kernel restart
//   loses nothing and replays nothing.
// - Connection state is the kernel's own answer, never a guess. An attempt is
//   `connection()` (the main process's api.json, pid, token and `GET /status`
//   check), then `feed.subscribe`, then the feed proving itself: a frame, or
//   `SETTLE_MS` open with no close. Only then is the store `live`. A failed
//   attempt doubles the backoff (500 ms -> 10 s); success resets it.
// - Nothing is reported that the kernel did not answer: a resource holds only
//   a body from an `ok` response, `status` is `undefined` until `GET /status`
//   answers, and every resource reads `stale: true` while the store is not
//   `live`.
//
// Plain TypeScript: no React, no DOM-only API and no `import.meta` (the e2e
// imports it under `tsconfig.node.json`). Timers come in through options, and
// their handles are opaque (`unknown`): `ReturnType<typeof setTimeout>`
// differs between the DOM and Node typings.
import type {
  ApiError,
  ApiResult,
  EventFrame,
  EventsResponse,
  FeedRelayFrame,
  KernelConnectionState,
  StatusBody,
  StudioBridge,
  TruncatedEventFrame,
} from "../api/contract";
import { isThreadResource, resourceRequest, resourcesForKind } from "./resources";
import type { ResourceBody, ResourceName } from "./resources";

/** A pending attempt succeeds once its subscription stays open this long with no close. */
export const SETTLE_MS = 2_000;
/** The first retry's delay, and the delay after any success. */
export const BACKOFF_INITIAL_MS = 500;
/** The longest delay between attempts. */
export const BACKOFF_CAP_MS = 10_000;
/** At most one refetch per resource per this many ms. */
export const REFETCH_THROTTLE_MS = 250;
/** How many events the store keeps in `eventLog` (oldest dropped first). */
export const EVENT_LOG_LIMIT = 1_000;

type NotConnected = Exclude<KernelConnectionState, { readonly state: "connected" }>;

/**
 * The store's connection view. `connecting` until the first attempt
 * succeeds; `live` while the feed is open; `reconnecting` once it was live and
 * is not now (with the time the store last received data from the kernel, ms
 * since the epoch, `null` if never). `not_installed` and `unreachable` are the
 * bridge's own answer, passed through unchanged, before the store was ever live.
 */
export type LiveConnection =
  | { readonly state: "connecting" }
  | { readonly state: "live" }
  | { readonly state: "reconnecting"; readonly lastUpdated: number | null }
  | NotConnected;

/** Why a read did not answer: the kernel's refusal, the bridge's connection state, or a failed IPC call. */
export type ResourceError =
  | { readonly kind: "refused"; readonly status: number; readonly body: ApiError }
  | { readonly kind: "not_connected"; readonly connection: NotConnected }
  | { readonly kind: "bridge_failed" };

/** One resource, as the store holds it. */
export interface ResourceState<T> {
  /** The body of the last `ok` answer; `undefined` until the kernel has answered. Never canned. */
  readonly data: T | undefined;
  /** The last read's failure, cleared by the next `ok` answer. */
  readonly error: ResourceError | undefined;
  /** A read is in flight. */
  readonly loading: boolean;
  /** True whenever the store is not `live`: the feed is not following, so `data` may be behind the kernel. */
  readonly stale: boolean;
  /** When `data` was answered (ms since the epoch), `null` if never. */
  readonly updatedAt: number | null;
}

export interface LiveSnapshot {
  readonly connection: LiveConnection;
  /** When the store last received data from the kernel (a REST answer, an event, a heartbeat), ms since the epoch. */
  readonly lastUpdated: number | null;
  /** The highest event id seen; the next subscribe's `after`. */
  readonly lastEventId: number;
  /** The last `EVENT_LOG_LIMIT` events, in id order, each once. */
  readonly eventLog: readonly (EventFrame | TruncatedEventFrame)[];
  /** Events dropped because their id was not above `lastEventId`. */
  readonly duplicatesDropped: number;
  /** Every resource used so far. */
  readonly resources: ReadonlyMap<ResourceName, ResourceState<unknown>>;
  /** `GET /status`'s body, `undefined` until it answers. */
  readonly status: StatusBody | undefined;
}

export interface LiveStoreOptions {
  readonly now?: () => number;
  readonly setTimeout?: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
  readonly eventLogLimit?: number;
}

export interface LiveStore {
  /** Attach the feed listener and start connecting (idempotent; also restarts a disposed store). */
  start(): void;
  /** Unsubscribe the feed, remove the listener and clear every timer. Data is kept. */
  dispose(): void;
  /** Load `name` on its first use; later calls do nothing (the feed keeps it current). */
  load(name: ResourceName): void;
  /** One refetch of `name` (throttled), loading it if it is not yet used. */
  refetch(name: ResourceName): void;
  /** `name`'s state, `undefined` before its first use. */
  resource<N extends ResourceName>(name: N): ResourceState<ResourceBody<N>> | undefined;
  getSnapshot(): LiveSnapshot;
  /** Called synchronously after every change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

interface Slot {
  readonly name: ResourceName;
  data: unknown;
  error: ResourceError | undefined;
  updatedAt: number | null;
  inFlight: boolean;
  /** A refetch is owed (an event, a reconnect, the first load). */
  wanted: boolean;
  /** When the last read started, for the throttle. */
  lastStart: number | undefined;
  timer: unknown;
  hasTimer: boolean;
}

/** Where the current attempt is. */
type Phase = "idle" | "checking" | "subscribing" | "pending" | "open" | "waiting";

function isNotConnected(state: KernelConnectionState): state is NotConnected {
  return state.state === "not_installed" || state.state === "unreachable";
}

/** A frame the store can use: an event with a positive integer id and a string kind, a heartbeat, or a close. */
function wellFormed(frame: FeedRelayFrame): boolean {
  if (typeof frame !== "object" || frame === null) return false;
  if (frame.type === "event") return Number.isSafeInteger(frame.id) && frame.id > 0 && typeof frame.kind === "string";
  return frame.type === "heartbeat" || frame.type === "closed";
}

function isTruncated(frame: EventFrame | TruncatedEventFrame): frame is TruncatedEventFrame {
  return (frame as { truncated?: unknown }).truncated === true;
}

/** Create the store over `bridge`. Inert until `start()`. */
export function createLiveStore(bridge: StudioBridge, options: LiveStoreOptions = {}): LiveStore {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimeout ?? ((callback: () => void, ms: number): unknown => globalThis.setTimeout(callback, ms));
  const clearTimer = options.clearTimeout ?? ((handle: unknown): void => globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0]));
  const eventLogLimit = options.eventLogLimit ?? EVENT_LOG_LIMIT;

  const listeners = new Set<() => void>();
  const slots = new Map<ResourceName, Slot>();
  const timers = new Set<unknown>();

  let view: LiveConnection = { state: "connecting" };
  let everLive = false;
  let lastUpdated: number | null = null;
  let lastEventId = 0;
  let eventLog: (EventFrame | TruncatedEventFrame)[] = [];
  let duplicatesDropped = 0;
  let snapshot: LiveSnapshot | undefined;

  let running = false;
  /** Bumped by `dispose()`: an answer from before it is dropped. */
  let epoch = 0;
  /** Bumped by every attempt and every attempt's end: a late answer from a finished attempt is dropped. */
  let attemptSeq = 0;
  let phase: Phase = "idle";
  let backoff = BACKOFF_INITIAL_MS;
  let retryTimer: unknown;
  let settleTimer: unknown;
  let offFrame: (() => void) | undefined;

  // ---- timers ---------------------------------------------------------------

  const after = (ms: number, callback: () => void): unknown => {
    const handle = setTimer(() => {
      timers.delete(handle);
      callback();
    }, ms);
    timers.add(handle);
    return handle;
  };
  const cancel = (handle: unknown): void => {
    if (handle === undefined || !timers.has(handle)) return;
    timers.delete(handle);
    clearTimer(handle);
  };

  // ---- snapshot ---------------------------------------------------------------

  const emit = (): void => {
    snapshot = undefined;
    for (const listener of [...listeners]) listener();
  };

  const stateOf = (slot: Slot): ResourceState<unknown> => ({
    data: slot.data,
    error: slot.error,
    loading: slot.inFlight,
    stale: view.state !== "live",
    updatedAt: slot.updatedAt,
  });

  const build = (): LiveSnapshot => {
    const resources = new Map<ResourceName, ResourceState<unknown>>();
    for (const [name, slot] of slots) resources.set(name, stateOf(slot));
    return {
      connection: view,
      lastUpdated,
      lastEventId,
      eventLog,
      duplicatesDropped,
      resources,
      status: slots.get("status")?.data as StatusBody | undefined,
    };
  };

  const setView = (next: LiveConnection): void => {
    view = next;
  };

  const received = (): void => {
    lastUpdated = now();
  };

  // ---- resources ----------------------------------------------------------------

  const slotFor = (name: ResourceName): { readonly slot: Slot; readonly created: boolean } => {
    const existing = slots.get(name);
    if (existing !== undefined) return { slot: existing, created: false };
    const slot: Slot = {
      name,
      data: undefined,
      error: undefined,
      updatedAt: null,
      inFlight: false,
      wanted: false,
      lastStart: undefined,
      timer: undefined,
      hasTimer: false,
    };
    slots.set(name, slot);
    return { slot, created: true };
  };

  const apply = (slot: Slot, result: ApiResult<unknown> | undefined): void => {
    if (result === undefined) {
      slot.error = { kind: "bridge_failed" };
      return;
    }
    if (result.ok) {
      slot.data = result.body;
      slot.error = undefined;
      slot.updatedAt = now();
      received();
      return;
    }
    if ("connection" in result) slot.error = { kind: "not_connected", connection: result.connection };
    else slot.error = { kind: "refused", status: result.status, body: result.body };
  };

  /** Start the owed read now if the throttle and the in-flight rule allow it, else when they will. */
  const pump = (slot: Slot): void => {
    if (!running || !slot.wanted || slot.inFlight || slot.hasTimer) return;
    const wait = slot.lastStart === undefined ? 0 : slot.lastStart + REFETCH_THROTTLE_MS - now();
    if (wait > 0) {
      slot.hasTimer = true;
      slot.timer = after(wait, () => {
        slot.hasTimer = false;
        slot.timer = undefined;
        pump(slot);
      });
      return;
    }
    slot.wanted = false;
    slot.inFlight = true;
    slot.lastStart = now();
    const mine = epoch;
    const req = resourceRequest(slot.name);
    let answer: Promise<ApiResult<unknown>>;
    try {
      answer = bridge.request<unknown>(req);
    } catch {
      answer = Promise.reject(new Error("bridge_failed"));
    }
    answer.then(
      (result) => settle(slot, mine, result),
      () => settle(slot, mine, undefined),
    );
    emit();
  };

  const settle = (slot: Slot, mine: number, result: ApiResult<unknown> | undefined): void => {
    if (mine !== epoch) return;
    slot.inFlight = false;
    apply(slot, result);
    emit();
    pump(slot);
  };

  const want = (slot: Slot): void => {
    slot.wanted = true;
    pump(slot);
  };

  /** Owe one refetch of every used resource (on becoming live: the feed may have moved while it was not). */
  const refetchAll = (): void => {
    for (const slot of slots.values()) want(slot);
  };

  const route = (kind: string): void => {
    const names = new Set<ResourceName>(resourcesForKind(kind));
    for (const name of slots.keys()) if (isThreadResource(name)) names.add(name);
    for (const name of names) {
      const slot = slots.get(name);
      // Only resources already in use are refetched.
      if (slot !== undefined) want(slot);
    }
  };

  // ---- the feed -------------------------------------------------------------------

  const record = (frame: EventFrame | TruncatedEventFrame): void => {
    eventLog = [...eventLog, frame];
    if (eventLog.length > eventLogLimit) eventLog = eventLog.slice(eventLog.length - eventLogLimit);
  };

  /** A truncated frame's row, fetched through `GET /events?after=<id-1>&limit=1`, then routed. */
  const fetchTruncated = (frame: TruncatedEventFrame): void => {
    const mine = epoch;
    let answer: Promise<ApiResult<EventsResponse>>;
    try {
      answer = bridge.request<EventsResponse>({ method: "GET", path: "/events", query: { after: String(frame.id - 1), limit: "1" } });
    } catch {
      answer = Promise.reject(new Error("bridge_failed"));
    }
    const done = (result: ApiResult<EventsResponse> | undefined): void => {
      if (mine !== epoch) return;
      const row = result?.ok === true ? result.body.events.find((e) => e.id === frame.id && !isTruncated(e)) : undefined;
      if (row !== undefined) {
        received();
        eventLog = eventLog.map((e) => (e.id === frame.id ? row : e));
      }
      // The kind is known either way: route it.
      route(frame.kind);
      emit();
    };
    answer.then(done, () => done(undefined));
  };

  const dropDuplicate = (): void => {
    duplicatesDropped += 1;
  };

  const onEvent = (frame: EventFrame | TruncatedEventFrame): void => {
    // The kernel replays only ids above `after`; anything at or below the last id seen was already applied.
    if (frame.id <= lastEventId) return dropDuplicate();
    lastEventId = frame.id;
    received();
    record(frame);
    if (isTruncated(frame)) fetchTruncated(frame);
    else route(frame.kind);
  };

  const onFrame = (frame: FeedRelayFrame): void => {
    if (!running || !wellFormed(frame)) return;
    if (frame.type === "closed") {
      onClosed();
      emit();
      return;
    }
    // A frame proves the subscription open.
    if (phase === "subscribing" || phase === "pending") succeed();
    if (frame.type === "heartbeat") received();
    else onEvent(frame);
    emit();
  };

  // ---- attempts ---------------------------------------------------------------------

  const scheduleRetry = (): void => {
    phase = "waiting";
    cancel(retryTimer);
    retryTimer = after(backoff, () => {
      retryTimer = undefined;
      void attempt();
    });
    backoff = Math.min(backoff * 2, BACKOFF_CAP_MS);
  };

  /** The attempt failed: `state` is the bridge's answer, when it gave one. */
  const fail = (state: NotConnected | undefined): void => {
    attemptSeq += 1;
    cancel(settleTimer);
    settleTimer = undefined;
    if (everLive) setView({ state: "reconnecting", lastUpdated });
    else if (state !== undefined) setView(state);
    scheduleRetry();
    emit();
  };

  const succeed = (): void => {
    attemptSeq += 1;
    cancel(settleTimer);
    settleTimer = undefined;
    phase = "open";
    backoff = BACKOFF_INITIAL_MS;
    everLive = true;
    setView({ state: "live" });
    refetchAll();
    emit();
  };

  const onClosed = (): void => {
    if (phase === "subscribing" || phase === "pending") {
      // A close before the feed proved itself is a failed attempt: the backoff keeps growing.
      fail(undefined);
      return;
    }
    if (phase !== "open") return;
    if (everLive) setView({ state: "reconnecting", lastUpdated });
    scheduleRetry();
  };

  const attempt = async (): Promise<void> => {
    if (!running) return;
    attemptSeq += 1;
    const mine = attemptSeq;
    phase = "checking";
    let state: KernelConnectionState;
    try {
      state = await bridge.connection();
    } catch {
      state = { state: "unreachable", reason: "connection_failed" };
    }
    if (mine !== attemptSeq || !running) return;
    if (isNotConnected(state)) {
      fail(state);
      return;
    }
    if (!everLive && view.state !== "connecting") {
      // The kernel answered `GET /status`: whatever stopped it before is no longer true.
      setView({ state: "connecting" });
      emit();
    }
    phase = "subscribing";
    let subscribed: KernelConnectionState;
    try {
      subscribed = await bridge.feed.subscribe(lastEventId);
    } catch {
      subscribed = { state: "unreachable", reason: "connection_failed" };
    }
    if (mine !== attemptSeq || !running) return;
    if (isNotConnected(subscribed)) {
      fail(subscribed);
      return;
    }
    phase = "pending";
    settleTimer = after(SETTLE_MS, () => {
      settleTimer = undefined;
      if (mine === attemptSeq && phase === "pending") succeed();
    });
  };

  // ---- the store ----------------------------------------------------------------------

  const store: LiveStore = {
    start() {
      if (running) return;
      running = true;
      offFrame = bridge.feed.onFrame(onFrame);
      // Owed reads from before a dispose, and the eager `status`.
      want(slotFor("status").slot);
      for (const slot of slots.values()) if (slot.wanted || slot.data === undefined) want(slot);
      void attempt();
    },

    dispose() {
      if (!running) return;
      running = false;
      epoch += 1;
      attemptSeq += 1;
      phase = "idle";
      offFrame?.();
      offFrame = undefined;
      for (const handle of timers) clearTimer(handle);
      timers.clear();
      retryTimer = undefined;
      settleTimer = undefined;
      for (const slot of slots.values()) {
        slot.timer = undefined;
        slot.hasTimer = false;
        slot.inFlight = false;
      }
      bridge.feed.unsubscribe().catch(() => undefined);
      emit();
    },

    load(name) {
      const { slot, created } = slotFor(name);
      if (created) {
        want(slot);
        emit();
      }
    },

    refetch(name) {
      const { slot } = slotFor(name);
      want(slot);
      emit();
    },

    resource<N extends ResourceName>(name: N) {
      return store.getSnapshot().resources.get(name) as ResourceState<ResourceBody<N>> | undefined;
    },

    getSnapshot() {
      snapshot ??= build();
      return snapshot;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return store;
}
