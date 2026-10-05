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
   * run again. Without it such a row becomes `failed:interrupted`. Stored on
   * the row by the call that first starts the step (the first claim) and only
   * then: the stored value decides every later replay, whatever a later call
   * passes here.
   */
  readonly rerunnable?: boolean;
  /**
   * `runStepAsync` only: returns true for an error that proves `fn` had no
   * effect at all (nothing written, spawned or sent). Such a rejection
   * releases the step's claim instead of recording `failed:error`, so a later
   * call for the key runs `fn` again. The caller owns this judgement; claim it
   * only for an error raised before `fn`'s first effect. It is consulted only
   * for an error `fn` raised itself: one passed on from an inner work step
   * (or a non-object) is `failed:error` regardless, since `fn` may have had an
   * effect before the inner step. Absent: every rejection is `failed:error`
   * (terminal for the key).
   */
  readonly noEffect?: (err: unknown) => boolean;
  /** Defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

/**
 * What a handler receives: the event, and work steps keyed under `event:<id>:`.
 *
 * A step returns its result in JSON form, on the first call as on a repeat
 * (`JSON.parse(JSON.stringify(value))`: a `Date` is its ISO string both times,
 * an `undefined` property is dropped, a class instance is a plain object), so
 * a redelivery sees exactly what the first delivery saw. `T` is not narrowed
 * to JSON-safe types: return JSON-shaped values.
 *
 * A step left `started` by a crash and not stored re-runnable throws
 * `WorkStepInterruptedError` after committing `failed:interrupted` with one
 * `notify` (`work_step_interrupted`, the step's key). A handler that rethrows
 * it fails the event with exactly that one `notify`: the loop's
 * `event_failed` row carries the step's key (`step`) and the queue id, and
 * the loop adds no notify of its own. A step run inside the handler's own
 * `store.transaction` (or inside another `ctx.runStep`) nests as a savepoint:
 * the outer rollback undoes its interrupted mark and its notify, so the row
 * stays `started` and the loop sends the one `notify` instead; the
 * `event_failed` row (step key and the interrupted error) is then the only
 * record of the interrupted step.
 */
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
   *
   * Only the innermost step the refusal came out of is released. A step that
   * nests it (calls it from its own `fn`) may already have had an effect, so
   * it records `failed:error`, and the loop then fails the event (one
   * `notify`) instead of parking it: its redelivery could not complete.
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
 * (`pending` until its `retryAt`), and the `ctx.runStepAsync` step whose own
 * work threw it is released, not failed, so the redelivery runs it again
 * (when an outer `ctx.runStepAsync` step it passed through is left
 * `failed:error` instead, the event is `failed`, not parked); throw anything
 * else ⇒ `failed`, one `notify`, and the loop moves on to the next event.
 *
 * One notify per failure holds for an interrupted step only when the handler
 * rethrows the step's own `WorkStepInterruptedError` (see `EventContext`): the
 * step already notified, and the loop links `event_failed` to it by the step
 * key. A handler that wraps it in a different error reports its own failure,
 * which gets the loop's notify too (two notifies, two facts).
 *
 * A `wakeup` event whose reason is `cap_reset:…` / `cap_recheck:…` (scheduled
 * by the budget module) means "ask admission again", never "the park ended":
 * a handler must not release parked work on it. The park ends only when
 * admission admits; a handler that wants to retry parked work asks admission
 * (directly or by starting the session) and treats a refusal as still parked.
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
