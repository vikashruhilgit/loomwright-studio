// The notifications API routes (bearer token, like every route):
//
//   GET /notifications[?limit=N]   newest first; N 1-500, default 50
//   GET /notifications/:id         one notification, with its source's details
//
// They read the kernel's store through the route seam (`req.store`).
import type { ContributedRoute, ContributedRouteResponse } from "../features/contribution.js";
import type { Store } from "../store/store.js";
import { getNotification, listNotifications } from "./record.js";
import type { NotificationRow } from "./record.js";

export const DEFAULT_NOTIFICATION_LIST = 50;
export const MAX_NOTIFICATION_LIST = 500;

/** The `trigger:<id>` source's trigger, or `null` when that row no longer exists. */
export interface NotificationTrigger {
  readonly id: number;
  readonly action: string;
  readonly next_fire_at: string | null;
}

/** The session an `agent:<name>` notification came from (the `notification_created` event's), or `null` when unknown. */
export interface NotificationSession {
  readonly id: number;
  readonly status: string | null;
}

/** `GET /notifications/:id`. `trigger` only for a `trigger:<id>` source, `session` only for an `agent:` one. */
export interface NotificationDetail {
  readonly notification: NotificationRow;
  readonly trigger?: NotificationTrigger | null;
  readonly session?: NotificationSession | null;
}

const POSITIVE_INT = /^[1-9][0-9]{0,15}$/;

function triggerOf(store: Store, source: string): NotificationTrigger | null {
  const id = Number(source.slice("trigger:".length));
  return store.prepare<[number], NotificationTrigger>("SELECT id, action, next_fire_at FROM triggers WHERE id = ?").get(id) ?? null;
}

function sessionOf(store: Store, notificationId: number): NotificationSession | null {
  const sessionId = store
    .prepare<[number], number | null>(
      "SELECT session_id FROM events WHERE kind = 'notification_created' AND json_extract(payload_json, '$.id') = ? ORDER BY id LIMIT 1",
    )
    .pluck()
    .get(notificationId);
  if (sessionId === undefined || sessionId === null) return null;
  const status = store.prepare<[number], string>("SELECT status FROM sessions WHERE id = ?").pluck().get(sessionId);
  return { id: sessionId, status: status ?? null };
}

/** `notification` with its source's details. */
export function notificationDetail(store: Store, notification: NotificationRow): NotificationDetail {
  if (notification.source.startsWith("trigger:")) return { notification, trigger: triggerOf(store, notification.source) };
  if (notification.source.startsWith("agent:")) return { notification, session: sessionOf(store, notification.id) };
  return { notification };
}

export const notificationRoutes: readonly ContributedRoute[] = Object.freeze([
  {
    method: "GET",
    path: "/notifications",
    handler: async (req): Promise<ContributedRouteResponse> => {
      const raw = req.query.limit;
      if (raw !== undefined && (!POSITIVE_INT.test(raw) || Number(raw) > MAX_NOTIFICATION_LIST)) {
        return { status: 400, body: { error: "invalid_limit" } };
      }
      const limit = raw === undefined ? DEFAULT_NOTIFICATION_LIST : Number(raw);
      return { status: 200, body: { notifications: listNotifications(req.store, limit) } };
    },
  },
  {
    method: "GET",
    path: "/notifications/:id",
    handler: async (req): Promise<ContributedRouteResponse> => {
      const raw = req.params.id ?? "";
      if (!POSITIVE_INT.test(raw) || !Number.isSafeInteger(Number(raw))) return { status: 400, body: { error: "invalid_id" } };
      const row = getNotification(req.store, Number(raw));
      if (row === undefined) return { status: 404, body: { error: "no_such_notification" } };
      return { status: 200, body: notificationDetail(req.store, row) };
    },
  },
]);
