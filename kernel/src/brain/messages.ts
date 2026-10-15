// The `brain_messages` table (migration 12): one row per handled `message`
// event for an agent the brain owns, keyed on its `event_queue` row. The
// brain owns every write and closes every value set here, in code (the table
// has no SQL CHECK). Imports only types (the `studio` CLI loads this module).
import type { Store } from "../store/store.js";

/** A message row's states. `parked` is not final: the queue delivers the event again once admission allows. */
export const BRAIN_MESSAGE_STATUSES = ["queued", "running", "replied", "failed", "parked"] as const;
export type BrainMessageStatus = (typeof BRAIN_MESSAGE_STATUSES)[number];

/** The statuses a row never leaves. */
export const FINAL_MESSAGE_STATUSES: readonly BrainMessageStatus[] = ["replied", "failed"];

/** The agents the brain handles messages for (later phases add crew members). */
export const BRAIN_AGENTS: readonly string[] = ["wright"];

/** One `brain_messages` row as stored (and as `GET /messages/:id` answers). */
export interface BrainMessageRow {
  readonly id: number;
  readonly queue_id: number;
  readonly agent: string;
  /** `ask`, `trigger:<id>`, `approval:<id>` or `message`. */
  readonly source: string;
  readonly text: string;
  readonly status: BrainMessageStatus;
  readonly session_id: number | null;
  readonly reply_text: string | null;
  /** A refusal or failure reason. */
  readonly detail: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const COLUMNS = "id, queue_id, agent, source, text, status, session_id, reply_text, detail, created_at, updated_at";

const ID = /^[1-9]\d*$/;

/** A positive integer id from the payload (a number or its decimal string), or `undefined`. */
function idOf(value: unknown): number | undefined {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !ID.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : undefined;
}

/**
 * The source of a `message` payload that has no row yet: `trigger:<id>` when
 * a trigger queued it (`trigger_id`), `approval:<id>` for an approval
 * (`approval_id`), else `message`. `ask` is never derived: `POST /ask` writes
 * its row in the same transaction as the event.
 */
export function messageSourceOf(payload: Readonly<Record<string, unknown>>): string {
  const trigger = idOf(payload.trigger_id);
  if (trigger !== undefined) return `trigger:${trigger}`;
  const approval = idOf(payload.approval_id);
  if (approval !== undefined) return `approval:${approval}`;
  return "message";
}

export function getBrainMessage(store: Store, id: number): BrainMessageRow | undefined {
  return store.prepare<[number], BrainMessageRow>(`SELECT ${COLUMNS} FROM brain_messages WHERE id = ?`).get(id);
}

export function getBrainMessageByQueueId(store: Store, queueId: number): BrainMessageRow | undefined {
  return store.prepare<[number], BrainMessageRow>(`SELECT ${COLUMNS} FROM brain_messages WHERE queue_id = ?`).get(queueId);
}

/**
 * The row for queue row `queueId`, inserted (`queued`) when there is none.
 * Idempotent on `queue_id`: a redelivered event, or one `POST /ask` already
 * wrote, finds its row and changes nothing.
 */
export function ensureBrainMessage(
  store: Store,
  params: { readonly queueId: number; readonly agent: string; readonly source: string; readonly text: string },
  at: Date,
): BrainMessageRow {
  const iso = at.toISOString();
  store
    .prepare(
      `INSERT INTO brain_messages (queue_id, agent, source, text, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?) ON CONFLICT(queue_id) DO NOTHING`,
    )
    .run(params.queueId, params.agent, params.source, params.text, iso, iso);
  return getBrainMessageByQueueId(store, params.queueId) as BrainMessageRow;
}

/**
 * Move row `id` to `status`, setting the given fields, only while it is in
 * one of `from` (so a final row is never reopened, and a late write never
 * overrides a later one). Returns whether it moved.
 */
export function updateBrainMessage(
  store: Store,
  id: number,
  from: readonly BrainMessageStatus[],
  to: { readonly status: BrainMessageStatus; readonly sessionId?: number | null; readonly replyText?: string | null; readonly detail?: string | null },
  at: Date,
): boolean {
  const sets = ["status = ?", "updated_at = ?"];
  const values: unknown[] = [to.status, at.toISOString()];
  if (to.sessionId !== undefined) {
    sets.push("session_id = ?");
    values.push(to.sessionId);
  }
  if (to.replyText !== undefined) {
    sets.push("reply_text = ?");
    values.push(to.replyText);
  }
  if (to.detail !== undefined) {
    sets.push("detail = ?");
    values.push(to.detail);
  }
  const placeholders = from.map(() => "?").join(", ");
  const r = store.prepare(`UPDATE brain_messages SET ${sets.join(", ")} WHERE id = ? AND status IN (${placeholders})`).run(...values, id, ...from);
  return r.changes > 0;
}
