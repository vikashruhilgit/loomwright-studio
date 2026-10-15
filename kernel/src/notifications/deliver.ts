// Delivery: the notifications feature's due work. Each loop tick posts every
// `pending` notification (oldest first, at most `DELIVERY_BATCH`) once, and
// writes the outcome to its row: `delivered`, `failed` or `unsupported`, with
// `delivery_detail`.
//
// At most once, by construction: the post runs inside a work step keyed
// `notification:<id>:deliver` that is NOT re-runnable (`runStepAsync`). The
// step commits `started` before the notifier runs and `done` (with the
// outcome) after it; the row is written from the step's stored outcome.
//
// - A crash between the post and `done` leaves the step `started`: the next
//   tick's claim marks it `failed:interrupted` (one `notify`, steps.ts) and
//   never runs the notifier again, so the row ends `failed`, detail
//   `interrupted`. The notification may or may not have been shown; it is
//   never shown twice (stricter than the requirement's "one duplicate after
//   a crash is acceptable").
// - A crash between `done` and the row write leaves the row `pending`: the next
//   tick's step returns the stored outcome without posting, and the row is
//   written from it.
//
// A row is settled once: the write is conditional on `pending`, so a `failed`
// row gets exactly one `notification_delivery_failed` event, and no later
// tick selects it again (D17: no retry loop).
import { appendEvent, clip, errorMessage, NO_REF } from "../loop/internal.js";
import { WorkStepFailedError, WorkStepInterruptedError, runStepAsync } from "../loop/steps.js";
import type { DueWorkContext } from "../loop/types.js";
import type { Store } from "../store/store.js";
import { postNotification } from "./notifier.js";
import type { DeliveryOutcome, NotifierDeps } from "./notifier.js";
import { getNotification, pendingNotificationIds } from "./record.js";

/** At most this many notifications are posted per tick; the rest wait for the next one. */
export const DELIVERY_BATCH = 20;

/** The work-step key of notification `id`'s one delivery. */
export function deliveryStepKey(id: number): string {
  return `notification:${id}:deliver`;
}

/** Whether the step's stored value is an outcome (a crash leftover from another build is not trusted blindly). */
function isOutcome(value: unknown): value is DeliveryOutcome {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (v.status === "delivered" || v.status === "failed" || v.status === "unsupported") && typeof v.detail === "string" && typeof v.posted === "boolean";
}

/**
 * Write `outcome` to row `id` if it is still `pending`, in one transaction
 * with, for a `failed` outcome, one `notification_delivery_failed` event
 * (`{id, error}`). Returns whether it wrote.
 */
function settle(store: Store, id: number, outcome: DeliveryOutcome, at: string): boolean {
  return store.transaction(() => {
    const changed = store
      .prepare("UPDATE notifications SET delivery_status = ?, delivery_detail = ?, delivered_at = ? WHERE id = ? AND delivery_status = 'pending'")
      .run(outcome.status, outcome.detail, outcome.posted ? at : null, id).changes;
    if (changed !== 1) return false;
    if (outcome.status === "failed") appendEvent(store, "notification_delivery_failed", NO_REF, { id, error: clip(outcome.detail) }, at);
    return true;
  });
}

/** Deliver notification `id` (pending) once; see the header. Never throws for a failed delivery. */
async function deliverOne(store: Store, id: number, now: () => Date, deps: NotifierDeps): Promise<void> {
  const row = getNotification(store, id);
  if (row === undefined || row.delivery_status !== "pending") return;
  let outcome: DeliveryOutcome;
  try {
    const stored = await runStepAsync(store, deliveryStepKey(id), () => postNotification(row, store.dataDir, deps), { now });
    outcome = isOutcome(stored) ? stored : { status: "failed", detail: "error: the delivery step stored no outcome", posted: false };
  } catch (err) {
    const interrupted = err instanceof WorkStepInterruptedError || (err instanceof WorkStepFailedError && err.reason === "interrupted");
    outcome = { status: "failed", detail: interrupted ? "interrupted" : clip(`error: ${errorMessage(err)}`), posted: false };
  }
  settle(store, id, outcome, now().toISOString());
}

/** Post each pending notification once (see the header), oldest first, at most `DELIVERY_BATCH` per call. */
export async function deliverPendingNotifications(ctx: DueWorkContext, deps: NotifierDeps = {}): Promise<void> {
  for (const id of pendingNotificationIds(ctx.store, DELIVERY_BATCH)) await deliverOne(ctx.store, id, ctx.now, deps);
}

/** The due-work function: `deliverPendingNotifications` with `deps` (tests inject a stub notifier). */
export function createDeliveryDueWork(deps: NotifierDeps = {}): (ctx: DueWorkContext) => Promise<void> {
  return (ctx) => deliverPendingNotifications(ctx, deps);
}

/** The shipped due work: the real notifier. */
export const deliveryDueWork = createDeliveryDueWork();
