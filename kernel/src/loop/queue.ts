// The durable event queue (AC1). An event is written to SQLite before
// anything acts on it: an `event_queue` row plus an `event_enqueued` audit row
// in `events`, in one transaction.
import type { Store } from "../store/store.js";
import { appendEvent } from "./internal.js";
import { isEventKind } from "./types.js";
import type { EventKind, QueueStatus, QueuedEvent } from "./types.js";

export interface EnqueueParams {
  /** Checked against `EVENT_KINDS`; anything else is refused. */
  readonly kind: EventKind;
  readonly payload: Record<string, unknown>;
  readonly taskId?: number | null;
  readonly sessionId?: number | null;
  /**
   * The dedupe anchor of a row derived from something else (`wakeup:<id>`).
   * A second enqueue with the same `sourceRef` inserts nothing and returns
   * the first row's id.
   */
  readonly sourceRef?: string | null;
}

export interface EnqueueResult {
  readonly id: number;
  /** `false` when `sourceRef` already had a row (nothing was written). */
  readonly created: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Write one event to the queue: the row and its `event_enqueued` audit row in
 * one transaction (nested as a savepoint when the caller holds one). Throws a
 * `TypeError` for an unknown kind or a non-object payload, before any write.
 */
export function enqueueEvent(store: Store, params: EnqueueParams, at: Date = new Date()): EnqueueResult {
  if (!isEventKind(params.kind)) throw new TypeError(`unknown event kind ${JSON.stringify(params.kind)}`);
  if (!isPlainObject(params.payload)) throw new TypeError("an event payload must be a JSON object");
  const sourceRef = params.sourceRef ?? null;
  if (sourceRef !== null && (typeof sourceRef !== "string" || sourceRef === "")) {
    throw new TypeError("sourceRef must be a non-empty string or null");
  }
  const payloadJson = JSON.stringify(params.payload);
  const iso = at.toISOString();
  const taskId = params.taskId ?? null;
  const sessionId = params.sessionId ?? null;

  return store.transaction((): EnqueueResult => {
    if (sourceRef !== null) {
      const existing = store
        .prepare<[string], number>("SELECT id FROM event_queue WHERE source_ref = ?")
        .pluck()
        .get(sourceRef);
      if (existing !== undefined) return { id: existing, created: false };
    }
    const id = Number(
      store
        .prepare(
          `INSERT INTO event_queue (kind, payload_json, source_ref, status, task_id, session_id, enqueued_at)
           VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(params.kind, payloadJson, sourceRef, taskId, sessionId, iso).lastInsertRowid,
    );
    appendEvent(store, "event_enqueued", { sessionId, taskId }, { queue_id: id, kind: params.kind, source_ref: sourceRef }, iso);
    return { id, created: true };
  });
}

export interface MessageParams {
  readonly text: string;
  /** The agent the message is addressed to, or `null`/absent for whoever handles it. */
  readonly agent?: string | null;
  readonly taskId?: number | null;
}

/**
 * Queue a user message (`kind: 'message'`, payload `{ text, agent }`): the
 * entry point the API and CLI (item 08) call.
 */
export function enqueueMessage(store: Store, params: MessageParams, at: Date = new Date()): EnqueueResult {
  if (typeof params.text !== "string" || params.text.trim() === "") throw new TypeError("a message needs non-empty text");
  const agent = params.agent ?? null;
  if (agent !== null && (typeof agent !== "string" || agent === "")) throw new TypeError("agent must be a non-empty string or null");
  return enqueueEvent(store, { kind: "message", payload: { text: params.text, agent }, taskId: params.taskId ?? null }, at);
}

/** One `event_queue` row as stored. */
export interface QueueRow {
  readonly id: number;
  readonly kind: string;
  readonly payload_json: string;
  readonly source_ref: string | null;
  readonly status: QueueStatus;
  readonly not_before: string | null;
  readonly attempts: number;
  readonly last_error: string | null;
  readonly task_id: number | null;
  readonly session_id: number | null;
  readonly enqueued_at: string;
  readonly done_at: string | null;
}

const ROW_COLUMNS =
  "id, kind, payload_json, source_ref, status, not_before, attempts, last_error, task_id, session_id, enqueued_at, done_at";

/** The stored queue row, or `undefined`. */
export function getQueueRow(store: Store, id: number): QueueRow | undefined {
  return store.prepare<[number], QueueRow>(`SELECT ${ROW_COLUMNS} FROM event_queue WHERE id = ?`).get(id);
}

/** The first `pending` row after `afterId` that is not parked past `nowIso`, in id order. */
export function nextPendingRow(store: Store, afterId: number, nowIso: string): QueueRow | undefined {
  return store
    .prepare<[number, string], QueueRow>(
      `SELECT ${ROW_COLUMNS} FROM event_queue
        WHERE status = 'pending' AND id > ? AND (not_before IS NULL OR not_before <= ?)
        ORDER BY id LIMIT 1`,
    )
    .get(afterId, nowIso);
}

/** The handler's view of a row whose kind is known. Throws when its payload is not a JSON object. */
export function toQueuedEvent(row: QueueRow, kind: EventKind): QueuedEvent {
  const payload: unknown = JSON.parse(row.payload_json);
  if (!isPlainObject(payload)) throw new TypeError(`event ${row.id} has a payload that is not a JSON object`);
  return {
    id: row.id,
    kind,
    payload,
    sourceRef: row.source_ref,
    taskId: row.task_id,
    sessionId: row.session_id,
    attempts: row.attempts,
    enqueuedAt: row.enqueued_at,
  };
}
