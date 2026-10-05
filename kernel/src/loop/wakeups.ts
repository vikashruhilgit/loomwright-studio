// Scheduled wake-ups (AC5). A `wakeups` row fires once by id: its status moves
// `pending` → `fired` in the same transaction that queues its `wakeup` event,
// so a missed wake-up (due while the kernel was down) fires on the first tick
// after the restart, and never twice.
import type { Store } from "../store/store.js";
import { appendEvent, normalizeInstant } from "./internal.js";
import { enqueueEvent } from "./queue.js";

/** Cap for a wake-up's free-text reason. */
export const MAX_WAKEUP_REASON = 500;

/**
 * Reason prefixes only the kernel writes: the budget module's cap wake-ups
 * (`cap_reset:<provider id>:<type>`, `cap_recheck:…`, and the legacy untyped
 * `cap_reset:<id>` / `cap_recheck:<id>`). The budget supersedes pending rows
 * by reason, and a handler reads a `cap_*` reason as "ask admission again",
 * so a session-chosen reason in this namespace could be dropped as
 * `superseded` or pass for a budget wake-up. `scheduleWakeup` refuses them.
 */
export const RESERVED_WAKEUP_REASON_PREFIXES: readonly string[] = ["cap_reset:", "cap_recheck:"];

/** Whether `reason` lies in the kernel-reserved namespace (`RESERVED_WAKEUP_REASON_PREFIXES`). */
export function isReservedWakeupReason(reason: string): boolean {
  return RESERVED_WAKEUP_REASON_PREFIXES.some((prefix) => reason.startsWith(prefix));
}

export interface ScheduleWakeupParams {
  /** An ISO-8601 instant with `Z` or an offset. A past time is allowed and fires on the next tick. */
  readonly at: string;
  readonly reason: string;
  readonly taskId?: number | null;
  /** The session that asked, for the audit row. */
  readonly sessionId?: number | null;
}

export interface ScheduledWakeup {
  readonly wakeupId: number;
  /** `at`, normalized to UTC with milliseconds. */
  readonly dueAt: string;
}

/**
 * Insert a `pending` wake-up and a `wakeup_scheduled` audit row (one
 * transaction). Throws a `TypeError` for an unparseable `at`, an empty or
 * over-long reason, a reason in the kernel-reserved namespace (`cap_reset:…`,
 * `cap_recheck:…`: `RESERVED_WAKEUP_REASON_PREFIXES`), or a task that does
 * not exist, before any write. This is the path for session-chosen reasons;
 * the budget module writes its cap wake-ups through its own insert.
 */
export function scheduleWakeup(store: Store, params: ScheduleWakeupParams, now: Date = new Date()): ScheduledWakeup {
  const dueAt = normalizeInstant(params.at);
  if (dueAt === undefined) throw new TypeError(`wake-up time ${JSON.stringify(params.at)} is not an ISO-8601 instant with a time zone`);
  if (typeof params.reason !== "string" || params.reason.trim() === "" || params.reason.length > MAX_WAKEUP_REASON) {
    throw new TypeError(`a wake-up reason must be 1-${MAX_WAKEUP_REASON} characters`);
  }
  if (isReservedWakeupReason(params.reason)) {
    throw new TypeError(
      `a wake-up reason may not start with ${RESERVED_WAKEUP_REASON_PREFIXES.map((p) => JSON.stringify(p)).join(" or ")}: reserved for the kernel's cap wake-ups`,
    );
  }
  const taskId = params.taskId ?? null;
  const at = now.toISOString();
  return store.transaction((): ScheduledWakeup => {
    if (taskId !== null && store.prepare<[number], number>("SELECT 1 FROM tasks WHERE id = ?").pluck().get(taskId) === undefined) {
      throw new TypeError(`no task ${taskId}`);
    }
    const wakeupId = Number(
      store
        .prepare("INSERT INTO wakeups (due_at, reason, task_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)")
        .run(dueAt, params.reason, taskId, at, at).lastInsertRowid,
    );
    appendEvent(store, "wakeup_scheduled", { sessionId: params.sessionId ?? null, taskId }, { wakeup_id: wakeupId, due_at: dueAt, reason: params.reason }, at);
    return { wakeupId, dueAt };
  });
}

export interface FiredWakeup {
  readonly wakeupId: number;
  /** The `wakeup` queue row it became. */
  readonly queueId: number;
}

interface DueRow {
  readonly id: number;
  readonly due_at: string;
  readonly reason: string;
  readonly task_id: number | null;
}

/**
 * Fire every `pending` wake-up due at or before `now`, oldest first: for each,
 * one transaction moves it to `fired` (guarded on `status = 'pending'`) and,
 * only when that changed the row, queues a `wakeup` event (payload
 * `{ wakeupId, reason, dueAt }`, `sourceRef: 'wakeup:<id>'`). The status guard
 * plus the unique `source_ref` make each fire exactly once, even across a
 * crash or two racing ticks. Only `pending` rows fire: a `superseded` row
 * (the budget module replaced it with a later cap wake-up) never does.
 *
 * Rows the budget module writes (reason `cap_reset:…` / `cap_recheck:…`, a
 * namespace `scheduleWakeup` refuses, so only the kernel writes it) fire the
 * same way. A `cap_*` wake-up means "ask admission again", never "the
 * park ended": a handler must not release parked work on it, because the park
 * ends only when admission admits (a park can be extended, or another limit
 * type can still be in force, after the wake-up was scheduled). Beyond that,
 * what a wake-up means is the handler's.
 */
export function fireDueWakeups(store: Store, now: Date = new Date()): FiredWakeup[] {
  const at = now.toISOString();
  const due = store
    .prepare<[string], DueRow>("SELECT id, due_at, reason, task_id FROM wakeups WHERE status = 'pending' AND due_at <= ? ORDER BY due_at, id")
    .all(at);
  const fired: FiredWakeup[] = [];
  for (const w of due) {
    const queueId = store.transaction((): number | undefined => {
      const changed = store
        .prepare("UPDATE wakeups SET status = 'fired', fired_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
        .run(at, at, w.id).changes;
      if (changed !== 1) return undefined;
      return enqueueEvent(
        store,
        { kind: "wakeup", payload: { wakeupId: w.id, reason: w.reason, dueAt: w.due_at }, taskId: w.task_id, sourceRef: `wakeup:${w.id}` },
        now,
      ).id;
    });
    if (queueId !== undefined) fired.push({ wakeupId: w.id, queueId });
  }
  return fired;
}
