import type { CancelTimer } from "../sessions/types.js";
import type { Store } from "../store/store.js";

/**
 * The kinds of event the queue accepts in phase 1 (AC6): a wake-up came due,
 * or the user sent a message. Closed in code (no SQL CHECK), so a later phase
 * adds a kind here without a table rebuild. "Internal" events are the
 * kernel's own audit rows in `events` (`notify`, for example): logged, never
 * queued.
 */
export type EventKind = "wakeup" | "message";

export const EVENT_KINDS: readonly EventKind[] = ["wakeup", "message"];

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === "string" && (EVENT_KINDS as readonly string[]).includes(value);
}

/** One `event_queue` row's processing state. */
export type QueueStatus = "pending" | "done" | "failed";

/** One queued event, as a handler receives it. */
export interface QueuedEvent {
  readonly id: number;
  readonly kind: EventKind;
  readonly payload: Record<string, unknown>;
  /** The dedupe anchor of a derived row (`wakeup:<id>`), or `null`. */
  readonly sourceRef: string | null;
  readonly taskId: number | null;
  readonly sessionId: number | null;
  /** Handler calls before this one (a parked event is delivered again). */
  readonly attempts: number;
  readonly enqueuedAt: string;
}

/** Options of `runStep` / `runStepAsync`. */
export interface StepOptions {
  /**
   * The step's effect is idempotent, so a `started` row left by a crash may be
   * run again. Without it such a row becomes `failed:interrupted`.
   */
  readonly rerunnable?: boolean;
  /**
   * `runStepAsync` only: returns true for an error that proves `fn` had no
   * effect at all (nothing written, spawned or sent). Such a rejection
   * releases the step's claim instead of recording `failed:error`, so a later
   * call for the key runs `fn` again. The caller owns this judgement; claim it
   * only for an error raised before `fn`'s first effect. Absent: every
   * rejection is `failed:error` (terminal for the key).
   */
  readonly noEffect?: (err: unknown) => boolean;
  /** Defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

/** What a handler receives: the event, and work steps keyed under `event:<id>:`. */
export interface EventContext {
  readonly event: QueuedEvent;
  readonly store: Store;
  /** `runStep(store, "event:<id>:<name>", fn, opts)`. */
  runStep<T>(name: string, fn: () => T, opts?: StepOptions): T;
  /**
   * `runStepAsync(store, "event:<id>:<name>", fn, opts)`, where an
   * `AdmissionRefusedError` also counts as `noEffect` (admission refuses
   * before any side effect), so a step refused by admission runs again when
   * the parked event is delivered again. Start the session first in such a
   * step: an effect made before the refusal would be repeated.
   */
  runStepAsync<T>(name: string, fn: () => Promise<T>, opts?: StepOptions): Promise<T>;
}

/**
 * Handles one queued event. Injected by the caller (AC6): the loop has no
 * handler of its own and invents no behaviour for an event nobody handles.
 *
 * Delivery is at least once. The loop marks the event `done` only after the
 * handler resolves, so a crash after the handler's effects and before `done`
 * delivers the event again. A handler must therefore make its own effects
 * idempotent through `ctx.runStep` / `ctx.runStepAsync`, whose keys are scoped
 * to the event id: a repeated delivery then returns each step's stored result
 * instead of doing the work twice.
 *
 * Outcomes: resolve ⇒ `done`; throw `AdmissionRefusedError` ⇒ parked
 * (`pending` until its `retryAt`), and a `ctx.runStepAsync` step it came out
 * of is released, not failed, so the redelivery runs it again; throw anything
 * else ⇒ `failed`, one `notify`, and the loop moves on to the next event.
 */
export type EventHandler = (ctx: EventContext) => void | Promise<void>;

export type EventHandlers = Partial<Record<EventKind, EventHandler>>;

export interface EventLoopOptions {
  readonly store: Store;
  readonly handlers: EventHandlers;
}

export interface EventLoopDeps {
  /** Defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** Schedules the next tick. Defaults to `setTimeout`/`clearTimeout`. */
  readonly schedule?: (fn: () => void, ms: number) => CancelTimer;
  /** Delay between ticks once `start()` is called. Default 1 000 ms. */
  readonly tickMs?: number;
}

/** What one `tick()` did. */
export interface TickResult {
  /** Wake-ups fired into the queue by this tick. */
  readonly wakeupsFired: number;
  /** Queue rows marked `done` after their handler resolved. */
  readonly done: number;
  /** Queue rows marked `done` because no handler was given for their kind. */
  readonly unhandled: number;
  /** Queue rows parked by an admission refusal. */
  readonly parked: number;
  readonly failed: number;
}
