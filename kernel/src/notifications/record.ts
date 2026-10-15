// The `notifications` table's record (migration 11): one row per
// notification, created by `recordNotification`, which other features call.
// Mechanism only (invariant 1): the row stores the text as given and never
// interprets it (invariant 3); what is worth notifying is the caller's policy.
// The value sets are closed here, in code (migration 11 has no SQL CHECK).
import { appendEvent } from "../loop/internal.js";
import type { Store } from "../store/store.js";

/** `notifications.delivery_status`: `pending` until the delivery due work settles it, once. */
export const NOTIFICATION_STATUSES = ["pending", "delivered", "failed", "unsupported"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Every notification's deep link is this prefix plus its row id (the phase 5 app registers the scheme). */
export const DEEP_LINK_PREFIX = "loomwright-studio://notifications/";

export const MAX_NOTIFICATION_TITLE = 200;
export const MAX_NOTIFICATION_BODY = 4_000;
export const MAX_NOTIFICATION_SOURCE = 200;

/** One `notifications` row. */
export interface NotificationRow {
  readonly id: number;
  readonly source: string;
  readonly title: string;
  readonly body: string;
  readonly deep_link: string;
  readonly created_at: string;
  readonly delivery_status: NotificationStatus;
  readonly delivery_detail: string | null;
  readonly delivered_at: string | null;
}

export interface NotificationInput {
  /** `trigger:<id>`, `agent:<name>` or `kernel:<reason>`. */
  readonly source: string;
  readonly title: string;
  readonly body: string;
  /** The session the `notification_created` event is linked to (an agent's), if any. */
  readonly sessionId?: number | null;
}

/** A notification the record refuses (bad source, title or body): nothing was written. */
export class InvalidNotificationError extends Error {
  readonly code = "invalid_notification";

  constructor(reason: string) {
    super(`invalid notification: ${reason}`);
    this.name = "InvalidNotificationError";
  }
}

// A trigger id is a row id; an agent name or a kernel reason is one line of printable text.
const SOURCE = /^(?:trigger:[1-9][0-9]{0,15}|agent:[^\u0000-\u001f\u007f]+|kernel:[^\u0000-\u001f\u007f]+)$/u;

/** Whether `source` is a `trigger:<id>`, `agent:<name>` or `kernel:<reason>` source. */
export function isNotificationSource(source: unknown): source is string {
  return typeof source === "string" && source.length <= MAX_NOTIFICATION_SOURCE && SOURCE.test(source);
}

/** The deep link of notification `id`. */
export function deepLinkFor(id: number): string {
  if (!Number.isSafeInteger(id) || id < 1) throw new RangeError(`a notification id must be a positive integer, got ${String(id)}`);
  return `${DEEP_LINK_PREFIX}${id}`;
}

const COLUMNS = "id, source, title, body, deep_link, created_at, delivery_status, delivery_detail, delivered_at";

/**
 * Record one notification: exactly one `pending` row whose `deep_link` is
 * `loomwright-studio://notifications/<its id>`, committed in one transaction
 * with one `notification_created` event (`{id, source}`, linked to
 * `input.sessionId` when given). Delivery happens after the commit, on a later
 * loop tick (`deliver.ts`). Throws `InvalidNotificationError` before writing
 * anything when the source is not `trigger:<id>`, `agent:<name>` or
 * `kernel:<reason>`, the title is empty or longer than 200 characters, the
 * body is longer than 4000, or either holds a NUL (the title is always an
 * argv item, and so is osascript's body; an argv item cannot hold a NUL, so
 * the spawn would fail and the row end `failed`).
 * Nested in a caller's transaction, it joins it.
 */
export function recordNotification(store: Store, input: NotificationInput, now: Date): NotificationRow {
  const { source, title, body } = input;
  if (!isNotificationSource(source)) {
    throw new InvalidNotificationError(`source ${JSON.stringify(source)} must be trigger:<id>, agent:<name> or kernel:<reason>`);
  }
  if (typeof title !== "string" || title.length === 0 || title.length > MAX_NOTIFICATION_TITLE) {
    throw new InvalidNotificationError(`the title must be 1-${MAX_NOTIFICATION_TITLE} characters`);
  }
  if (typeof body !== "string" || body.length > MAX_NOTIFICATION_BODY) {
    throw new InvalidNotificationError(`the body must be at most ${MAX_NOTIFICATION_BODY} characters`);
  }
  if (title.includes("\u0000") || body.includes("\u0000")) throw new InvalidNotificationError("the title and body must not contain a NUL character");
  const at = now.toISOString();
  return store.transaction(() => {
    // The deep link names the inserted row's own id, so it is written in the same transaction.
    const id = Number(
      store
        .prepare("INSERT INTO notifications (source, title, body, deep_link, created_at, delivery_status) VALUES (?, ?, ?, '', ?, 'pending')")
        .run(source, title, body, at).lastInsertRowid,
    );
    store.prepare("UPDATE notifications SET deep_link = ? WHERE id = ?").run(deepLinkFor(id), id);
    appendEvent(store, "notification_created", { sessionId: input.sessionId ?? null, taskId: null }, { id, source }, at);
    return getNotification(store, id) as NotificationRow;
  });
}

/** Notification `id`, or `undefined`. */
export function getNotification(store: Store, id: number): NotificationRow | undefined {
  return store.prepare<[number], NotificationRow>(`SELECT ${COLUMNS} FROM notifications WHERE id = ?`).get(id);
}

/** At most `limit` notifications, newest first. */
export function listNotifications(store: Store, limit: number): NotificationRow[] {
  return store.prepare<[number], NotificationRow>(`SELECT ${COLUMNS} FROM notifications ORDER BY id DESC LIMIT ?`).all(limit);
}

/** The ids of up to `limit` `pending` notifications, oldest first. */
export function pendingNotificationIds(store: Store, limit: number): number[] {
  return store.prepare<[number], number>("SELECT id FROM notifications WHERE delivery_status = 'pending' ORDER BY id LIMIT ?").pluck().all(limit);
}
