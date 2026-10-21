// The console's event part (phase 5 item 02): the `GET /events` gap read and
// the row-to-frame code the live feed shares with it. The feed's socket
// handler itself is `handleEventFeed` in `../api/feed.ts`, which imports the
// read and the frame from here.
//
//   GET /events[?after=N][&limit=M]   every event with id > N (0 when absent),
//                                     oldest first, M 1-500 (default 500)
//
// Mechanism only (invariant 1), and read-only. A payload is untrusted data
// (invariant 3): it is parsed as JSON and passed on, never interpreted.
// Type-only imports beside `./types.js`: the `studio` CLI loads this part.
import type { ContributedRoute, ContributedRouteResponse } from "../features/contribution.js";
import type { Store } from "../store/store.js";
import { emptyConsolePart } from "./types.js";
import type { ConsolePart } from "./types.js";

/** One backlog page on the feed: it reads and sends at most this many rows at a time. */
export const EVENT_PAGE_SIZE = 500;

/** `GET /events`'s largest `limit`. */
export const MAX_EVENTS_LIMIT = 500;

/** `GET /events`'s `limit` when none is given. */
export const DEFAULT_EVENTS_LIMIT = 500;

/** The columns of an `events` row the feed and `GET /events` read (never `actor`). */
export interface EventRow {
  readonly id: number;
  readonly at: string;
  readonly kind: string;
  readonly session_id: number | null;
  readonly task_id: number | null;
  readonly payload_json: string | null;
}

/** One event, as the feed and `GET /events` send it (the contract's `EventFrame`). */
export interface EventFrame {
  readonly type: "event";
  readonly id: number;
  readonly at: string;
  readonly kind: string;
  readonly session_id: number | null;
  readonly task_id: number | null;
  readonly payload: unknown;
}

/**
 * The events with id > `after`, oldest first, at most `limit`. Ids follow
 * append order (the table is append-only), so reading on from the last id
 * seen misses nothing and repeats nothing.
 */
export function readEventsAfter(store: Store, after: number, limit: number): EventRow[] {
  return store
    .prepare<[number, number], EventRow>("SELECT id, at, kind, session_id, task_id, payload_json FROM events WHERE id > ? ORDER BY id LIMIT ?")
    .all(after, limit);
}

/** The id of the newest event; 0 when there is none. */
export function latestEventId(store: Store): number {
  return store.prepare<[], number>("SELECT coalesce(max(id), 0) FROM events").pluck().get() ?? 0;
}

/**
 * The stored payload as a JSON value: `null` for a null column, the parsed
 * value otherwise. Text that does not parse (no writer produces it: each one
 * uses `JSON.stringify`) is passed on as the raw string, never dropped.
 */
function payloadOf(payloadJson: string | null): unknown {
  if (payloadJson === null) return null;
  try {
    return JSON.parse(payloadJson) as unknown;
  } catch {
    return payloadJson;
  }
}

/** `row` as an untruncated `EventFrame`. */
export function eventFrameOf(row: EventRow): EventFrame {
  return {
    type: "event",
    id: row.id,
    at: row.at,
    kind: row.kind,
    session_id: row.session_id,
    task_id: row.task_id,
    payload: payloadOf(row.payload_json),
  };
}

const NON_NEGATIVE_INT = /^(?:0|[1-9][0-9]{0,15})$/;
const POSITIVE_INT = /^[1-9][0-9]{0,15}$/;

const eventsRoute: ContributedRoute = {
  method: "GET",
  path: "/events",
  handler: async (req): Promise<ContributedRouteResponse> => {
    const rawAfter = req.query.after;
    if (rawAfter !== undefined && (!NON_NEGATIVE_INT.test(rawAfter) || !Number.isSafeInteger(Number(rawAfter)))) {
      return { status: 400, body: { error: "invalid_after" } };
    }
    const rawLimit = req.query.limit;
    if (rawLimit !== undefined && (!POSITIVE_INT.test(rawLimit) || Number(rawLimit) > MAX_EVENTS_LIMIT)) {
      return { status: 400, body: { error: "invalid_limit" } };
    }
    const after = rawAfter === undefined ? 0 : Number(rawAfter);
    const limit = rawLimit === undefined ? DEFAULT_EVENTS_LIMIT : Number(rawLimit);
    // Always in full: only the feed truncates a frame over 1 MiB.
    return { status: 200, body: { events: readEventsAfter(req.store, after, limit).map(eventFrameOf) } };
  },
};

export const eventsPart: ConsolePart = Object.freeze({ ...emptyConsolePart("events"), routes: Object.freeze([eventsRoute]) });
