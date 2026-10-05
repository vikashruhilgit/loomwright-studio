// Store helpers shared by the meter, the cap tracker and admission. Not part
// of the module's public surface.
import type { Store } from "../store/store.js";
import type { BudgetAuth, BudgetDeps } from "./types.js";

/** Cap for free text copied into an event (a cap message, for example). */
export const MAX_EVENT_TEXT = 500;

export interface Clock {
  readonly now: () => Date;
  readonly dayOf: (at: Date) => string;
  readonly startOfNextDay: (at: Date) => Date;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** The host's local calendar day, `YYYY-MM-DD`. */
export function localDay(at: Date): string {
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
}

/** The host's next local midnight after `at`. */
export function startOfNextLocalDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1);
}

export function clockOf(deps: BudgetDeps): Clock {
  return {
    now: deps.now ?? (() => new Date()),
    dayOf: deps.dayOf ?? localDay,
    startOfNextDay: deps.startOfNextDay ?? startOfNextLocalDay,
  };
}

export interface EventRef {
  readonly sessionId: number | null;
  readonly taskId: number | null;
}

export function appendEvent(store: Store, kind: string, ref: EventRef, payload: Record<string, unknown>, at: string): void {
  store
    .prepare("INSERT INTO events (at, kind, actor, task_id, session_id, payload_json) VALUES (?, ?, 'kernel', ?, ?, ?)")
    .run(at, kind, ref.taskId, ref.sessionId, JSON.stringify(payload));
}

/** A `notify` event, shaped like the session manager's (`provider`, `account` first). */
export function appendNotify(
  store: Store,
  auth: BudgetAuth,
  account: string,
  ref: EventRef,
  payload: Record<string, unknown>,
  at: string,
): void {
  appendEvent(store, "notify", ref, { provider: auth.id, account, ...payload }, at);
}

/** Counted tokens (input + output + cache writes, D26) an agent used on `day`. */
export function agentCountedTokens(store: Store, agent: string, day: string): number {
  return (
    store
      .prepare<[string, string], number>("SELECT COALESCE(SUM(counted_tokens), 0) FROM budget WHERE agent = ? AND day = ?")
      .pluck()
      .get(agent, day) ?? 0
  );
}

/**
 * Record that `agent` reached its daily limit on `day`: one
 * `budget_limit_reached` event and one `notify`, once per agent-day (whether
 * the meter saw the crossing or admission found it first). Call inside a
 * transaction. Returns whether anything was written.
 */
export function noteAgentLimitReached(
  store: Store,
  auth: BudgetAuth,
  details: { agent: string; day: string; countedTokens: number; limit: number; retryAt: string; ref: EventRef },
  at: string,
): boolean {
  const seen = store
    .prepare<[string, string], number>(
      `SELECT 1 FROM events WHERE kind = 'budget_limit_reached'
          AND json_extract(payload_json, '$.agent') = ? AND json_extract(payload_json, '$.day') = ?`,
    )
    .pluck()
    .get(details.agent, details.day);
  if (seen !== undefined) return false;
  const payload = {
    agent: details.agent,
    day: details.day,
    counted_tokens: details.countedTokens,
    limit: details.limit,
    retry_at: details.retryAt,
  };
  appendEvent(store, "budget_limit_reached", details.ref, payload, at);
  appendNotify(store, auth, auth.account, details.ref, { reason: "agent_daily_limit", ...payload }, at);
  return true;
}

/** One `cap_state` row the kernel is parked on: `rejected`, reset unknown or still ahead. */
export interface ActivePark {
  readonly rate_limit_type: string;
  readonly resets_at: string | null;
  readonly reset_source: string | null;
}

/**
 * Every unexpired park of the provider `key` (its stable id, never its label)
 * at `nowIso` (`resets_at` null counts as unexpired).
 */
export function activeParks(store: Store, key: string, nowIso: string): ActivePark[] {
  return store
    .prepare<[string, string], ActivePark>(
      `SELECT rate_limit_type, resets_at, reset_source FROM cap_state
        WHERE account = ? AND status = 'rejected' AND (resets_at IS NULL OR resets_at > ?)
        ORDER BY rate_limit_type`,
    )
    .all(key, nowIso);
}

/** Schedule a `wakeups` row unless a pending one with the same reason and due time exists. */
export function scheduleWakeupOnce(store: Store, reason: string, dueAt: string, at: string): boolean {
  const exists = store
    .prepare<[string, string], number>("SELECT 1 FROM wakeups WHERE reason = ? AND due_at = ? AND status = 'pending'")
    .pluck()
    .get(reason, dueAt);
  if (exists !== undefined) return false;
  store
    .prepare("INSERT INTO wakeups (due_at, reason, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)")
    .run(dueAt, reason, at, at);
  return true;
}

/** The two kinds of cap wake-up: a known reset, or the re-check of an unknown one. */
export type CapWakeupKind = "cap_reset" | "cap_recheck";

/** The reason of a cap wake-up: `<kind>:<providerId>:<rate_limit_type>`. */
export function capWakeupReason(kind: CapWakeupKind, key: string, type: string): string {
  return `${kind}:${key}:${type}`;
}

/**
 * Schedule the cap wake-up `<kind>:<key>:<type>` at `dueAt`, superseding every
 * earlier pending cap wake-up of the same provider and limit type (AC3): both
 * kinds of `<key>:<type>`, the same for each of `alsoSupersede`'s types, and
 * the provider's legacy untyped `cap_reset:<key>` / `cap_recheck:<key>` rows
 * (the form migration 9 leaves). Superseded rows get `status = 'superseded'`
 * and never fire (`fireDueWakeups` reads `pending` only); this is the only
 * writer of that status. A pending row with the same reason and due time is
 * kept, not duplicated (`scheduleWakeupOnce`'s rule). Call inside a
 * transaction, so the supersede and the insert commit together. A cap
 * wake-up means "ask admission again", never "the park ended".
 */
export function scheduleCapWakeup(
  store: Store,
  wakeup: {
    readonly kind: CapWakeupKind;
    readonly key: string;
    readonly type: string;
    readonly dueAt: string;
    readonly alsoSupersede?: readonly string[];
  },
  at: string,
): boolean {
  const { kind, key, type, dueAt } = wakeup;
  const reason = capWakeupReason(kind, key, type);
  const stale = [`cap_reset:${key}`, `cap_recheck:${key}`];
  for (const t of [type, ...(wakeup.alsoSupersede ?? [])]) {
    stale.push(capWakeupReason("cap_reset", key, t), capWakeupReason("cap_recheck", key, t));
  }
  const supersede = store.prepare<[string, string, string, string]>(
    "UPDATE wakeups SET status = 'superseded', updated_at = ? WHERE status = 'pending' AND reason = ? AND NOT (reason = ? AND due_at = ?)",
  );
  for (const r of stale) supersede.run(at, r, reason, dueAt);
  return scheduleWakeupOnce(store, reason, dueAt, at);
}

export function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
