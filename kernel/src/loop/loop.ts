import { AdmissionRefusedError } from "../sessions/types.js";
import type { CancelTimer } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { appendEvent, clip, errorMessage, NO_REF, normalizeInstant } from "./internal.js";
import type { EventRef } from "./internal.js";
import { nextPendingRow, toQueuedEvent } from "./queue.js";
import type { QueueRow } from "./queue.js";
import { WorkStepInterruptedError, getWorkStep, runStep, runStepAsync } from "./steps.js";
import { isEventKind } from "./types.js";
import type { EventContext, EventHandlers, EventLoopDeps, EventLoopOptions, QueuedEvent, TickResult } from "./types.js";
import { fireDueWakeups } from "./wakeups.js";

export const DEFAULT_TICK_MS = 1_000;
/** How long a parked event waits when admission gave no `retryAt` (an unknown reset). */
export const DEFAULT_PARK_MS = 60 * 60 * 1_000;

const defaultSchedule = (fn: () => void, ms: number): CancelTimer => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

type Outcome = "done" | "unhandled" | "parked" | "failed";

/**
 * The kernel's main loop (AC1, AC5, AC6): mechanism only. Each `tick()` fires
 * the wake-ups that are due into the queue, then processes `pending` queue
 * rows in id order, calling the injected handler for each row's kind:
 *
 * - the handler resolves ⇒ `done` + `event_done`, committed together, only
 *   after the handler's own effects were committed;
 * - no handler for the kind ⇒ `done` + `event_unhandled` (no default
 *   behaviour is invented);
 * - it throws `AdmissionRefusedError` ⇒ the row stays `pending` with
 *   `not_before` = the refusal's `retryAt` (or now + `DEFAULT_PARK_MS` when
 *   unknown, or when it is not later than now: a park never ends in the past,
 *   see `#park`) + `event_parked`; admission already notified, so no second
 *   notify (D17: park, no retry loop). The `ctx.runStepAsync` step whose own
 *   work threw the refusal is released, not failed, so the redelivery runs it
 *   again. An outer step the refusal only passed through is `failed:error`
 *   (it may have had an effect before the inner step; see `steps.ts`), so the
 *   event can never complete: it is `failed` + `notify` now, not parked;
 * - it throws anything else ⇒ `failed` (`attempts + 1`, `last_error`) +
 *   `event_failed` + one `notify`, and the loop goes on with the next row: a
 *   failing event never blocks the queue. A `WorkStepInterruptedError` whose
 *   step committed its `failed:interrupted` mark already sent that one
 *   `notify` (see `#fail`), so the loop records `event_failed` with the step's
 *   key and adds none.
 *
 * `start()` / `stop()` run one timer chain at a time: each call starts a new
 * generation, and a tick only reschedules while its chain's generation is
 * still current. So a tick still running across `stop()` → `start()` (the
 * stop not awaited) does not leave a second chain beside the new one.
 *
 * There is no ordering other than the row id, and no dedupe policy beyond a
 * derived row's `source_ref`. A row left `pending` by a crash is processed
 * again after the restart (see `EventHandler` for what that asks of handlers).
 */
export class EventLoop {
  readonly #store: Store;
  readonly #handlers: EventHandlers;
  readonly #now: () => Date;
  readonly #schedule: (fn: () => void, ms: number) => CancelTimer;
  readonly #tickMs: number;
  #running: Promise<TickResult> | undefined;
  #cancel: CancelTimer | undefined;
  #started = false;
  /** Bumped by `start()` and `stop()`: a chain reschedules only while its generation is current. */
  #generation = 0;
  #abortTick = false;

  constructor(options: EventLoopOptions, deps: EventLoopDeps = {}) {
    this.#store = options.store;
    // A copy: the caller cannot swap handlers under a running loop.
    this.#handlers = { ...options.handlers };
    this.#now = deps.now ?? (() => new Date());
    this.#schedule = deps.schedule ?? defaultSchedule;
    const tickMs = deps.tickMs ?? DEFAULT_TICK_MS;
    if (!Number.isFinite(tickMs) || tickMs <= 0) throw new RangeError("tickMs must be a positive number");
    this.#tickMs = tickMs;
  }

  /** Fire due wake-ups, then process every eligible pending row. Single-flight: an overlapping call gets the running tick. */
  tick(): Promise<TickResult> {
    if (this.#running !== undefined) return this.#running;
    this.#abortTick = false;
    const running = this.#runTick().finally(() => {
      this.#running = undefined;
    });
    this.#running = running;
    return running;
  }

  /** Tick now, then every `tickMs` after each tick ends, until `stop()`. Idempotent. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    const generation = ++this.#generation;
    this.#cancel = this.#schedule(() => this.#loop(generation), 0);
  }

  /** Cancel the next tick and wait for a running one to finish its current event. Idempotent. */
  async stop(): Promise<void> {
    this.#started = false;
    // Ends the current chain: a tick still running does not reschedule it.
    this.#generation++;
    this.#abortTick = true;
    this.#cancel?.();
    this.#cancel = undefined;
    await this.#running?.catch(() => undefined);
  }

  /**
   * One step of the timer chain started under `generation`. A chain that
   * `stop()` (or a later `start()`) superseded neither ticks nor reschedules,
   * and never touches `#cancel`, which belongs to the current chain.
   */
  #loop(generation: number): void {
    if (generation !== this.#generation) return;
    this.#cancel = undefined;
    void this.tick()
      .catch((err: unknown) => this.#recordSafely("loop_error", NO_REF, { error: clip(errorMessage(err)) }))
      .finally(() => {
        if (generation === this.#generation) this.#cancel = this.#schedule(() => this.#loop(generation), this.#tickMs);
      });
  }

  async #runTick(): Promise<TickResult> {
    const wakeupsFired = fireDueWakeups(this.#store, this.#now()).length;
    const counts: Record<Outcome, number> = { done: 0, unhandled: 0, parked: 0, failed: 0 };
    // Strictly increasing id: a row parked this tick is not seen again in it,
    // while a row a handler enqueues (a higher id) is processed in it.
    let lastId = 0;
    for (;;) {
      // `stop()` during a tick: finish the current event, start no other.
      if (this.#abortTick) break;
      const row = nextPendingRow(this.#store, lastId, this.#now().toISOString());
      if (row === undefined) break;
      lastId = row.id;
      counts[await this.#process(row)]++;
    }
    return { wakeupsFired, ...counts };
  }

  async #process(row: QueueRow): Promise<Outcome> {
    const ref: EventRef = { sessionId: row.session_id, taskId: row.task_id };
    const kind = row.kind;
    const handler = isEventKind(kind) && Object.hasOwn(this.#handlers, kind) ? this.#handlers[kind] : undefined;
    if (handler === undefined) {
      this.#finish(row, ref, "event_unhandled", { queue_id: row.id, kind });
      return "unhandled";
    }

    // Keys of this delivery's ctx.runStepAsync steps that a refusal left `failed`.
    const failedByRefusal: string[] = [];
    try {
      const event = toQueuedEvent(row, kind as QueuedEvent["kind"]);
      await handler(this.#contextFor(event, failedByRefusal));
    } catch (err) {
      if (!(err instanceof AdmissionRefusedError)) return this.#fail(row, ref, err);
      if (failedByRefusal.length === 0) return this.#park(row, ref, err);
      // A redelivery would only hit WorkStepFailedError: fail visibly now instead.
      return this.#fail(
        row,
        ref,
        new Error(`${err.message}; not parked: work step ${failedByRefusal.join(", ")} passed the refusal on from an inner step and is failed:error`),
      );
    }
    this.#finish(row, ref, "event_done", { queue_id: row.id, kind, attempt: row.attempts + 1 });
    return "done";
  }

  #contextFor(event: QueuedEvent, failedByRefusal: string[]): EventContext {
    const store = this.#store;
    const now = this.#now;
    const prefix = `event:${event.id}:`;
    return {
      event,
      store,
      runStep: (name, fn, opts) => runStep(store, prefix + name, fn, { now, ...opts }),
      runStepAsync: (name, fn, opts) => {
        const key = prefix + name;
        return runStepAsync(store, key, fn, {
          now,
          ...opts,
          // An admission refusal is thrown before any side effect: release the
          // step whose own work threw it, so the parked event's redelivery runs
          // it again (D17). runStepAsync applies this to that innermost step only.
          noEffect: (err) => err instanceof AdmissionRefusedError || (opts?.noEffect?.(err) ?? false),
        }).catch((err: unknown) => {
          if (err instanceof AdmissionRefusedError) {
            let failed: boolean;
            try {
              failed = getWorkStep(store, key)?.status === "failed";
            } catch {
              failed = true; // Unknown state: never park on it.
            }
            if (failed && !failedByRefusal.includes(key)) failedByRefusal.push(key);
          }
          throw err;
        });
      },
    };
  }

  #finish(row: QueueRow, ref: EventRef, auditKind: string, payload: Record<string, unknown>): void {
    const at = this.#now().toISOString();
    const handled = auditKind === "event_done" ? 1 : 0;
    this.#store.transaction(() => {
      this.#store
        .prepare("UPDATE event_queue SET status = 'done', done_at = ?, attempts = attempts + ? WHERE id = ? AND status = 'pending'")
        .run(at, handled, row.id);
      appendEvent(this.#store, auditKind, ref, payload, at);
    });
  }

  /**
   * Park the row until `not_before`. A `retryAt` that is not strictly later
   * than now (or not an instant at all) is treated as an unknown reset: now +
   * `DEFAULT_PARK_MS`. Taken as given, it would leave the row due at once, so
   * every tick would redeliver it and append another `event_parked`. The
   * `event_parked` row keeps the refusal's raw `retry_at` for the audit next
   * to the effective `not_before`.
   */
  #park(row: QueueRow, ref: EventRef, err: AdmissionRefusedError): Outcome {
    const now = this.#now();
    const retryAt = normalizeInstant(err.retryAt);
    const notBefore =
      retryAt !== undefined && Date.parse(retryAt) > now.getTime() ? retryAt : new Date(now.getTime() + DEFAULT_PARK_MS).toISOString();
    const at = now.toISOString();
    this.#store.transaction(() => {
      this.#store
        .prepare("UPDATE event_queue SET not_before = ?, attempts = attempts + 1, last_error = ? WHERE id = ? AND status = 'pending'")
        .run(notBefore, clip(err.message), row.id);
      appendEvent(this.#store, "event_parked", ref, { queue_id: row.id, kind: row.kind, reason: err.reason, retry_at: err.retryAt, not_before: notBefore }, at);
    });
    return "parked";
  }

  /**
   * Fail the row: `event_failed` plus exactly one `notify` for the failure.
   *
   * A `WorkStepInterruptedError` names a step whose `failed:interrupted` mark
   * came with its own `notify` (`work_step_interrupted`, keyed on the step).
   * When that mark is committed (read back here), the owner was already told,
   * so `event_failed` carries the step's key to link the two and the loop adds
   * no notify of its own. When it is not (the handler ran the step inside its
   * own transaction or another `ctx.runStep`, whose rollback undid the mark
   * and its notify, leaving the row `started`), or the read fails, the loop
   * notifies as for any failure: never zero notifications.
   */
  #fail(row: QueueRow, ref: EventRef, err: unknown): Outcome {
    const at = this.#now().toISOString();
    const error = clip(errorMessage(err));
    const step = err instanceof WorkStepInterruptedError ? err.key : undefined;
    const notified = step !== undefined && this.#interruptedMarkCommitted(step);
    this.#store.transaction(() => {
      this.#store
        .prepare("UPDATE event_queue SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ? AND status = 'pending'")
        .run(error, row.id);
      appendEvent(this.#store, "event_failed", ref, { queue_id: row.id, kind: row.kind, error, ...(step === undefined ? {} : { step }) }, at);
      if (!notified) appendEvent(this.#store, "notify", ref, { reason: "event_failed", queue_id: row.id, kind: row.kind, error }, at);
    });
    return "failed";
  }

  /** Whether step `key` is committed as `failed:interrupted` (its notify with it). A read failure ⇒ false: notify rather than risk none. */
  #interruptedMarkCommitted(key: string): boolean {
    try {
      return getWorkStep(this.#store, key)?.label === "failed:interrupted";
    } catch {
      return false;
    }
  }

  #recordSafely(kind: string, ref: EventRef, payload: Record<string, unknown>): void {
    try {
      appendEvent(this.#store, kind, ref, payload, this.#now().toISOString());
    } catch {
      // The store itself is failing; the next tick tries again.
    }
  }
}
