// The `brain_messages` table (migration 12, and migration 14's phase 4
// fields): one row per handled `message` event for an agent (Wright or a crew
// member), keyed on its `event_queue` row. The brain owns every write and
// closes every value set here, in code (the table has no SQL CHECK). Imports
// only types and `../agents/types.js` (the id grammar; `node:*` only beneath
// it): the `studio` CLI loads this module.
import { isValidAgentId } from "../agents/types.js";
import type { Store } from "../store/store.js";

/** A message row's states. `parked` is not final: the queue delivers the event again once admission allows. */
export const BRAIN_MESSAGE_STATUSES = ["queued", "running", "replied", "failed", "parked"] as const;
export type BrainMessageStatus = (typeof BRAIN_MESSAGE_STATUSES)[number];

/** The statuses a row never leaves. */
export const FINAL_MESSAGE_STATUSES: readonly BrainMessageStatus[] = ["replied", "failed"];

/**
 * The lead agent. The message handler routes Wright and every `active` crew
 * member (`isRoutable`, `../agents/registry.ts`); this list no longer decides
 * routing, and only a playbook run (`../playbooks/runs.ts`) still reads it.
 */
export const BRAIN_AGENTS: readonly string[] = ["wright"];

/** One `brain_messages` row as stored (and as `GET /messages/:id` answers). */
export interface BrainMessageRow {
  readonly id: number;
  readonly queue_id: number;
  readonly agent: string;
  /** `ask`, `trigger:<id>`, `approval:<id>`, `agent:<id>` or `message`. */
  readonly source: string;
  readonly text: string;
  readonly status: BrainMessageStatus;
  readonly session_id: number | null;
  readonly reply_text: string | null;
  /** A refusal or failure reason. */
  readonly detail: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  /** The sending agent (`wright` or a crew id); null for the owner, a trigger or an approval. */
  readonly from_agent: string | null;
  /** The delegation depth: 0 for a message no agent delegated. */
  readonly depth: number;
  /** The row this message answers (a delegation's reply or failure); null otherwise. */
  readonly reply_to: number | null;
  /** The folder the message names as its session's cwd; null for the agent's memory folder. */
  readonly workspace: string | null;
}

const COLUMNS = "id, queue_id, agent, source, text, status, session_id, reply_text, detail, created_at, updated_at, from_agent, depth, reply_to, workspace";

const ID = /^[1-9]\d*$/;

/** A positive integer id from the payload (a number or its decimal string), or `undefined`. */
function idOf(value: unknown): number | undefined {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !ID.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : undefined;
}

/** The payload's `from_agent` when it names an agent (`wright` or a valid crew id), else null. */
function fromAgentOf(value: unknown): string | null {
  return value === "wright" || isValidAgentId(value) ? (value as string) : null;
}

/**
 * The source of a `message` payload that has no row yet: `agent:<id>` when
 * an agent sent it (a valid `from_agent`, checked first), `trigger:<id>` when
 * a trigger queued it (`trigger_id`), `approval:<id>` for an approval
 * (`approval_id`), else `message`. `ask` is never derived: `POST /ask` writes
 * its row in the same transaction as the event.
 */
export function messageSourceOf(payload: Readonly<Record<string, unknown>>): string {
  const from = fromAgentOf(payload.from_agent);
  if (from !== null) return `agent:${from}`;
  const trigger = idOf(payload.trigger_id);
  if (trigger !== undefined) return `trigger:${trigger}`;
  const approval = idOf(payload.approval_id);
  if (approval !== undefined) return `approval:${approval}`;
  return "message";
}

/** A message's phase 4 fields as `ensureBrainMessage` takes them. */
export interface MessageFields {
  readonly fromAgent: string | null;
  readonly depth: number;
  readonly replyTo: number | null;
  readonly workspace: string | null;
}

/**
 * The phase 4 fields of a `message` payload: `from_agent` a string that is
 * `wright` or a valid crew id, else null; `depth` a non-negative safe
 * integer, else 0; `reply_to` a positive id naming a row that exists (the
 * column references `brain_messages`), else null; `workspace` a string, else
 * null. Only the kernel queues these (`kernel_agent_message` and the brain's
 * reply-back): anything else in the payload is never trusted as one.
 */
export function messageFieldsOf(store: Store, payload: Readonly<Record<string, unknown>>): MessageFields {
  const depth = payload.depth;
  const replyTo = idOf(payload.reply_to);
  return {
    fromAgent: fromAgentOf(payload.from_agent),
    depth: typeof depth === "number" && Number.isSafeInteger(depth) && depth >= 0 ? depth : 0,
    replyTo: replyTo !== undefined && getBrainMessage(store, replyTo) !== undefined ? replyTo : null,
    workspace: typeof payload.workspace === "string" ? payload.workspace : null,
  };
}

export function getBrainMessage(store: Store, id: number): BrainMessageRow | undefined {
  return store.prepare<[number], BrainMessageRow>(`SELECT ${COLUMNS} FROM brain_messages WHERE id = ?`).get(id);
}

export function getBrainMessageByQueueId(store: Store, queueId: number): BrainMessageRow | undefined {
  return store.prepare<[number], BrainMessageRow>(`SELECT ${COLUMNS} FROM brain_messages WHERE queue_id = ?`).get(queueId);
}

/**
 * The newest `limit` rows (of `agent` only, when given), newest last: what
 * `GET /messages` answers.
 */
export function listBrainMessages(store: Store, params: { readonly agent?: string; readonly limit: number }): BrainMessageRow[] {
  const rows =
    params.agent === undefined
      ? store.prepare<[number], BrainMessageRow>(`SELECT ${COLUMNS} FROM brain_messages ORDER BY id DESC LIMIT ?`).all(params.limit)
      : store.prepare<[string, number], BrainMessageRow>(`SELECT ${COLUMNS} FROM brain_messages WHERE agent = ? ORDER BY id DESC LIMIT ?`).all(params.agent, params.limit);
  return rows.reverse();
}

/**
 * The row for queue row `queueId`, inserted (`queued`) when there is none,
 * with the phase 4 fields given (absent: `from_agent` null, `depth` 0,
 * `reply_to` null, `workspace` null). Idempotent on `queue_id`: a redelivered
 * event, or one `POST /ask` already wrote, finds its row and changes nothing.
 */
export function ensureBrainMessage(
  store: Store,
  params: {
    readonly queueId: number;
    readonly agent: string;
    readonly source: string;
    readonly text: string;
    readonly fromAgent?: string | null;
    readonly depth?: number;
    readonly replyTo?: number | null;
    readonly workspace?: string | null;
  },
  at: Date,
): BrainMessageRow {
  const iso = at.toISOString();
  store
    .prepare(
      `INSERT INTO brain_messages (queue_id, agent, source, text, status, created_at, updated_at, from_agent, depth, reply_to, workspace)
       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?) ON CONFLICT(queue_id) DO NOTHING`,
    )
    .run(params.queueId, params.agent, params.source, params.text, iso, iso, params.fromAgent ?? null, params.depth ?? 0, params.replyTo ?? null, params.workspace ?? null);
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
