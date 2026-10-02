import { AdmissionRefusedError } from "../sessions/types.js";
import type { CancelTimer } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { appendEvent, clip, errorMessage, NO_REF, normalizeInstant } from "./internal.js";
import type { EventRef } from "./internal.js";
import { nextPendingRow, toQueuedEvent } from "./queue.js";
import type { QueueRow } from "./queue.js";
import { getWorkStep, runStep, runStepAsync } from "./steps.js";
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
 *   unknown) + `event_parked`; admission already notified, so no second
 *   notify (D17: park, no retry loop). The `ctx.runStepAsync` step whose own
 *   work threw the refusal is released, not failed, so the redelivery runs it
 *   again. An outer step the refusal only passed through is `failed:error`
 *   (it may have had an effect before the inner step; see `steps.ts`), so the
 *   event can never complete: it is `failed` + `notify` now, not parked;
 * - it throws anything else ⇒ `failed` (`attempts + 1`, `last_error`) +
 *   `event_failed` + one `notify`, and the loop goes on with the next row: a
 *   failing event never blocks the queue.
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
    this.#cancel = this.#schedule(this.#loop, 0);
  }

  /** Cancel the next tick and wait for a running one to finish its current event. Idempotent. */
  async stop(): Promise<void> {
    this.#started = false;
    this.#abortTick = true;
    this.#cancel?.();
    this.#cancel = undefined;
    await this.#running?.catch(() => undefined);
  }

  readonly #loop = (): void => {
    this.#cancel = undefined;
    if (!this.#started) return;
    void this.tick()
      .catch((err: unknown) => this.#recordSafely("loop_error", NO_REF, { error: clip(errorMessage(err)) }))
      .finally(() => {
        if (this.#started) this.#cancel = this.#schedule(this.#loop, this.#tickMs);
      });
  };

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

  #park(row: QueueRow, ref: EventRef, err: AdmissionRefusedError): Outcome {
    const now = this.#now();
    const notBefore = normalizeInstant(err.retryAt) ?? new Date(now.getTime() + DEFAULT_PARK_MS).toISOString();
    const at = now.toISOString();
    this.#store.transaction(() => {
      this.#store
        .prepare("UPDATE event_queue SET not_before = ?, attempts = attempts + 1, last_error = ? WHERE id = ? AND status = 'pending'")
        .run(notBefore, clip(err.message), row.id);
      appendEvent(this.#store, "event_parked", ref, { queue_id: row.id, kind: row.kind, reason: err.reason, retry_at: err.retryAt, not_before: notBefore }, at);
    });
    return "parked";
  }

  #fail(row: QueueRow, ref: EventRef, err: unknown): Outcome {
    const at = this.#now().toISOString();
    const error = clip(errorMessage(err));
    this.#store.transaction(() => {
      this.#store
        .prepare("UPDATE event_queue SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ? AND status = 'pending'")
        .run(error, row.id);
      appendEvent(this.#store, "event_failed", ref, { queue_id: row.id, kind: row.kind, error }, at);
      appendEvent(this.#store, "notify", ref, { reason: "event_failed", queue_id: row.id, kind: row.kind, error }, at);
    });
    return "failed";
  }

  #recordSafely(kind: string, ref: EventRef, payload: Record<string, unknown>): void {
    try {
      appendEvent(this.#store, kind, ref, payload, this.#now().toISOString());
    } catch {
      // The store itself is failing; the next tick tries again.
    }
  }
}
