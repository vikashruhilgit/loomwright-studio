// Store helpers shared by the meter, the cap tracker and admission. Not part
// of the module's public surface.
import type { Store } from "../store/store.js";
import { agentDailyTokenLimit, validateApiKeyFallbackPolicy } from "./types.js";
import type {
  AgentLimitsLookup,
  AgentSettingsRefusalReason,
  ApiKeyFallbackPolicy,
  BudgetAuth,
  BudgetConfig,
  BudgetDeps,
} from "./types.js";

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

/**
 * The `budget.playbook` value of playbook `id`: the column is TEXT
 * (migration 1), so the id is written and compared as its decimal string.
 */
export function playbookKey(id: number): string {
  return String(id);
}

/** Counted tokens (input + output + cache writes, D26) playbook `id`'s sessions used on `day`. */
export function playbookCountedTokens(store: Store, id: number, day: string): number {
  return (
    store
      .prepare<[string, string], number>("SELECT COALESCE(SUM(counted_tokens), 0) FROM budget WHERE playbook = ? AND day = ?")
      .pluck()
      .get(playbookKey(id), day) ?? 0
  );
}

/**
 * A stored `playbooks.token_limit_per_day`: `null` when unset, the limit when
 * it is a positive safe integer, `undefined` when it is anything else (the
 * playbooks feature validates its writes, so that is a damaged row). The
 * meter skips a damaged limit; admission refuses on it (fail closed).
 */
export function playbookTokenLimit(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * Record that playbook `id` reached its daily limit on `day`: one
 * `playbook_limit_reached` event and one `notify`, once per playbook-day
 * (whether the meter saw the crossing or admission found it first), the
 * playbook twin of `noteAgentLimitReached`. Call inside a transaction.
 * Returns whether anything was written.
 */
export function notePlaybookLimitReached(
  store: Store,
  auth: BudgetAuth,
  details: {
    playbook: number;
    slug: string;
    day: string;
    countedTokens: number;
    limit: number;
    retryAt: string;
    ref: EventRef;
  },
  at: string,
): boolean {
  const seen = store
    .prepare<[number, string], number>(
      `SELECT 1 FROM events WHERE kind = 'playbook_limit_reached'
          AND json_extract(payload_json, '$.playbook') = ? AND json_extract(payload_json, '$.day') = ?`,
    )
    .pluck()
    .get(details.playbook, details.day);
  if (seen !== undefined) return false;
  const payload = {
    playbook: details.playbook,
    slug: details.slug,
    day: details.day,
    counted_tokens: details.countedTokens,
    limit: details.limit,
    retry_at: details.retryAt,
  };
  appendEvent(store, "playbook_limit_reached", details.ref, payload, at);
  appendNotify(store, auth, auth.account, details.ref, { reason: "playbook_daily_limit", ...payload }, at);
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

/**
 * The admission gates' provider check: parks are keyed on the auth
 * provider's stable id, so a request naming another provider is a wiring
 * error and throws (fail closed). Returns the id. The label is never compared.
 */
export function admissionProvider(auth: BudgetAuth, requested: string): string {
  const provider = auth.id;
  if (requested !== provider) {
    throw new Error(
      `admission asked for provider ${requested} but the budget's auth provider is ${provider}: refusing (fail closed)`,
    );
  }
  return provider;
}

/** When a cap refusal may try again: the latest `resets_at` of `parks`, or `null` when one is unknown. */
export function capRetryAt(parks: readonly ActivePark[]): string | null {
  return parks.some((p) => p.resets_at === null)
    ? null
    : parks.map((p) => p.resets_at as string).reduce((a, b) => (b > a ? b : a));
}

/**
 * How long an `agent_sessions_at_once` refusal waits before admission is
 * asked again (its `retryAt` is now + this): a live session can end at any
 * moment, so the event loop parks the work this long rather than its
 * one-hour default. A recheck interval, not a limit (invariant 1).
 */
export const SESSIONS_AT_ONCE_RECHECK_MS = 60 * 1_000;

/**
 * The window of the hourly `notify` for an `agent_sessions_at_once`,
 * `settings_invalid` or `settings_missing` refusal: the first refusal of an
 * agent for a reason notifies, the next ones within this window do not (each
 * still appends its `admission_refused` event).
 */
export const AGENT_REFUSAL_NOTIFY_MS = 60 * 60 * 1_000;

/** One agent's limits for one check, or why they cannot be read. */
export type ResolvedAgentLimits =
  | { readonly ok: true; readonly tokensPerDay: number | undefined; readonly sessionsAtOnce: number | undefined }
  | { readonly ok: false; readonly reason: AgentSettingsRefusalReason; readonly file: string | null; readonly message: string };

function isLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * `agent`'s limits: from the `agentLimits` lookup when one is given (read
 * now, so an edit to the agent's settings applies at its next check), else
 * the config's static `agentDailyTokenLimits` and no sessions-at-once limit.
 * A lookup answer that is not `ok: true`, or a limit that is not a positive
 * safe integer, is a refusal (fail closed): only `settings_missing` keeps its
 * reason, anything else reads as `settings_invalid`. A lookup that throws
 * throws.
 */
export function resolveAgentLimits(
  config: BudgetConfig,
  lookup: ((agent: string) => AgentLimitsLookup) | undefined,
  agent: string,
): ResolvedAgentLimits {
  if (lookup === undefined) return { ok: true, tokensPerDay: agentDailyTokenLimit(config, agent), sessionsAtOnce: undefined };
  const answer = lookup(agent);
  if (answer.ok !== true) {
    return {
      ok: false,
      reason: answer.reason === "settings_missing" ? "settings_missing" : "settings_invalid",
      file: typeof answer.file === "string" ? answer.file : null,
      message: String(answer.message).slice(0, MAX_EVENT_TEXT),
    };
  }
  for (const key of ["tokensPerDay", "sessionsAtOnce"] as const) {
    const value = answer[key];
    if (value !== undefined && !isLimit(value)) {
      return { ok: false, reason: "settings_invalid", file: null, message: `agent ${agent}'s ${key} limit ${String(value)} is not a positive integer` };
    }
  }
  return { ok: true, tokensPerDay: answer.tokensPerDay, sessionsAtOnce: answer.sessionsAtOnce };
}

/**
 * One `notify` for `agent` refused for `reason`, unless one was appended for
 * the same agent and reason within the last `AGENT_REFUSAL_NOTIFY_MS`. Call
 * inside a transaction. Returns whether it notified.
 */
function notifyAgentRefusalHourly(
  store: Store,
  auth: BudgetAuth,
  details: { agent: string; reason: string; payload: Record<string, unknown>; ref: EventRef },
  now: Date,
  at: string,
): boolean {
  const since = new Date(now.getTime() - AGENT_REFUSAL_NOTIFY_MS).toISOString();
  const seen = store
    .prepare<[string, string, string], number>(
      `SELECT 1 FROM events WHERE kind = 'notify' AND at > ?
          AND json_extract(payload_json, '$.reason') = ? AND json_extract(payload_json, '$.agent') = ?`,
    )
    .pluck()
    .get(since, details.reason, details.agent);
  if (seen !== undefined) return false;
  appendNotify(store, auth, auth.account, details.ref, { reason: details.reason, agent: details.agent, ...details.payload }, at);
  return true;
}

/** An agent-limit refusal: when to try again and the `admission_refused` details. */
export interface AgentLimitRefusal {
  readonly retryAt: string;
  readonly details: { readonly day: string; readonly counted_tokens: number; readonly limit: number };
}

/**
 * The admission gates' agent token limit (AC2): a `start` whose agent's
 * counted tokens for today reached `limit` (its `tokens_per_day`, see
 * `resolveAgentLimits`) is refused until the next budget day, recorded once
 * per agent-day (`noteAgentLimitReached`). A resume, a `null` agent or an
 * agent with no limit passes (`null`). Call inside a transaction.
 */
export function agentLimitRefusal(
  store: Store,
  auth: BudgetAuth,
  limit: number | undefined,
  clock: Clock,
  request: { readonly kind: string; readonly agent: string | null },
  now: Date,
  ref: EventRef,
  at: string,
): AgentLimitRefusal | null {
  if (request.kind !== "start" || request.agent === null) return null;
  if (limit === undefined) return null;
  const day = clock.dayOf(now);
  const counted = agentCountedTokens(store, request.agent, day);
  if (counted < limit) return null;
  const retryAt = clock.startOfNextDay(now).toISOString();
  noteAgentLimitReached(store, auth, { agent: request.agent, day, countedTokens: counted, limit, retryAt, ref }, at);
  return { retryAt, details: { day, counted_tokens: counted, limit } };
}

/** One live session of an agent, as the sessions-at-once count reads it. */
interface LiveSessionRow {
  readonly id: number;
  readonly status: string;
}

/**
 * The admission gates' sessions-at-once limit: a `start` or `resume` of an
 * agent whose live sessions (`sessions` rows of that agent with status
 * `starting`, `running` or `orphaned`) number `limit` or more is refused
 * `agent_sessions_at_once`, with `retryAt` now + `SESSIONS_AT_ONCE_RECHECK_MS`.
 * Counted in the caller's transaction, the one the admit is decided in; the
 * session manager inserts the admitted start's `starting` row with no await
 * after the admit, so the count includes every session this kernel admitted.
 * An `orphaned` row counts (its process group may still be alive), and the
 * refusal names it with the `studio session abandon <id>` hint. A `resume`
 * that names its own session (`AdmissionRequest.session`, a safe integer)
 * leaves that row out, so a session's own retry or the resume of its own
 * orphan never refuses itself. The first refusal per agent per hour appends
 * one `notify`. A `null` agent or an agent with no limit passes (`null`).
 * Call inside a transaction.
 */
export function sessionsAtOnceRefusal(
  store: Store,
  auth: BudgetAuth,
  limit: number | undefined,
  request: { readonly kind: string; readonly agent: string | null; readonly session?: number },
  now: Date,
  ref: EventRef,
  at: string,
): AgentRefusalOf<"agent_sessions_at_once"> | null {
  if (request.agent === null || limit === undefined) return null;
  const own = request.kind === "resume" && Number.isSafeInteger(request.session) ? (request.session as number) : null;
  const live = store
    .prepare<[string, number | null, number | null], LiveSessionRow>(
      `SELECT id, status FROM sessions
        WHERE agent = ? AND status IN ('starting', 'running', 'orphaned') AND (? IS NULL OR id <> ?)
        ORDER BY id`,
    )
    .all(request.agent, own, own);
  if (live.length < limit) return null;
  const retryAt = new Date(now.getTime() + SESSIONS_AT_ONCE_RECHECK_MS).toISOString();
  const orphaned = live.filter((r) => r.status === "orphaned").map((r) => r.id);
  const details = {
    live: live.length,
    limit,
    live_sessions: live.map((r) => r.id),
    ...(orphaned.length === 0
      ? {}
      : {
          orphaned_sessions: orphaned,
          hint: `an orphaned session counts as live until it is resumed or abandoned: ${orphaned.map((id) => `studio session abandon ${id}`).join(", ")}`,
        }),
  };
  notifyAgentRefusalHourly(
    store,
    auth,
    { agent: request.agent, reason: "agent_sessions_at_once", payload: { ...details, retry_at: retryAt }, ref },
    now,
    at,
  );
  return { reason: "agent_sessions_at_once", retryAt, details };
}

/** Why the per-agent checks refused. */
export type AgentRefusalReason = AgentSettingsRefusalReason | "agent_daily_limit" | "agent_sessions_at_once";

/** A per-agent refusal: its reason, when to try again (`null`: the loop's default recheck) and the `admission_refused` details. */
export interface AgentRefusalOf<R extends AgentRefusalReason> {
  readonly reason: R;
  readonly retryAt: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

export type AgentRefusal = AgentRefusalOf<AgentRefusalReason>;

/**
 * The admission gates' per-agent checks, in order, the first refusal winning:
 *
 * 1. Settings: an agent whose limits cannot be read (`resolveAgentLimits`
 *    refused) is refused `settings_invalid` / `settings_missing`, start and
 *    resume alike, with `retryAt` `null` (the event loop's default recheck)
 *    and one `notify` per agent per hour. Never read as "no limit".
 * 2. Token limit (`agentLimitRefusal`): `start` only.
 * 3. Sessions at once (`sessionsAtOnceRefusal`): start and resume.
 *
 * A `null` agent skips all three. Call inside a transaction.
 */
export function agentRefusal(
  store: Store,
  auth: BudgetAuth,
  config: BudgetConfig,
  lookup: ((agent: string) => AgentLimitsLookup) | undefined,
  clock: Clock,
  request: { readonly kind: string; readonly agent: string | null; readonly session?: number },
  now: Date,
  ref: EventRef,
  at: string,
): AgentRefusal | null {
  if (request.agent === null) return null;
  const limits = resolveAgentLimits(config, lookup, request.agent);
  if (!limits.ok) {
    const details = { file: limits.file, message: limits.message };
    notifyAgentRefusalHourly(store, auth, { agent: request.agent, reason: limits.reason, payload: details, ref }, now, at);
    return { reason: limits.reason, retryAt: null, details };
  }
  const tokens = agentLimitRefusal(store, auth, limits.tokensPerDay, clock, request, now, ref, at);
  if (tokens !== null) return { reason: "agent_daily_limit", retryAt: tokens.retryAt, details: tokens.details };
  return sessionsAtOnceRefusal(store, auth, limits.sessionsAtOnce, request, now, ref, at);
}

/** No fallback: what a missing, unparseable or invalid stored policy reads as. */
const FALLBACK_OFF: ApiKeyFallbackPolicy = Object.freeze({ enabled: false, dollarCeilingUsd: null });

/**
 * A playbook's stored `api_key_fallback_json`, checked with the rules
 * `validateBudgetConfig` applies to the kernel-wide placeholder. NULL,
 * unparseable JSON or an invalid policy read as off: a damaged policy fails
 * toward waiting for the reset, never toward spending.
 */
export function parseApiKeyFallbackPolicy(json: string | null): ApiKeyFallbackPolicy {
  if (json === null) return FALLBACK_OFF;
  try {
    return validateApiKeyFallbackPolicy(JSON.parse(json));
  } catch {
    return FALLBACK_OFF;
  }
}

/** Whether a policy opts in: enabled AND a positive dollar ceiling set (D28). */
export function fallbackOptedIn(
  policy: ApiKeyFallbackPolicy,
): policy is ApiKeyFallbackPolicy & { dollarCeilingUsd: number } {
  return policy.enabled && policy.dollarCeilingUsd !== null && policy.dollarCeilingUsd > 0;
}

/**
 * The dollars the fallback ceiling is compared with: the SDK's `cost_usd`
 * estimate summed over ALL of the playbook's `budget` rows, all time. No row
 * records which provider a session ran on (`sessions.auth_account` is a
 * display label and is never read), so subscription sessions' list-price
 * estimates are counted too. That can only overcount, so the ceiling is
 * reached early, never late. Both choices (what counts, and that it never
 * resets) are open owner decisions, see `docs/architecture/budget.md`.
 */
export function playbookApiKeySpendUsd(store: Store, id: number): number {
  return (
    store
      .prepare<[string], number>("SELECT COALESCE(SUM(cost_usd), 0) FROM budget WHERE playbook = ?")
      .pluck()
      .get(playbookKey(id)) ?? 0
  );
}

/**
 * Record that playbook `id`'s spend reached its API-key fallback ceiling: one
 * `api_key_ceiling_reached` event and one `notify`, once per playbook and
 * ceiling (spend never resets, so a crossing is final until the user raises
 * the ceiling; a new ceiling value can be reached, and recorded, again).
 * Written whether the meter saw the crossing or the gate found it first.
 * Call inside a transaction. Returns whether anything was written.
 */
export function noteApiKeyCeilingReached(
  store: Store,
  auth: BudgetAuth,
  details: { playbook: number; slug: string; spendUsd: number; ceilingUsd: number; ref: EventRef },
  at: string,
): boolean {
  const seen = store
    .prepare<[number, number], number>(
      `SELECT 1 FROM events WHERE kind = 'api_key_ceiling_reached'
          AND json_extract(payload_json, '$.playbook') = ? AND json_extract(payload_json, '$.ceiling_usd') = ?`,
    )
    .pluck()
    .get(details.playbook, details.ceilingUsd);
  if (seen !== undefined) return false;
  const payload = {
    playbook: details.playbook,
    slug: details.slug,
    spend_usd: details.spendUsd,
    ceiling_usd: details.ceilingUsd,
  };
  appendEvent(store, "api_key_ceiling_reached", details.ref, payload, at);
  appendNotify(store, auth, auth.account, details.ref, { reason: "api_key_ceiling_reached", ...payload }, at);
  return true;
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
 * (the form migration 9 leaves). Only rows the budget module wrote are
 * superseded: `scheduleWakeup` refuses the `cap_reset:` / `cap_recheck:`
 * prefixes, and a row it wrote before that (it has a `wakeup_scheduled`
 * audit event) is left pending. Superseded rows get `status = 'superseded'`
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
  // Only rows the budget wrote: a row with a `wakeup_scheduled` audit event came from a
  // session through `scheduleWakeup` (before the `cap_*` prefixes were reserved) and is never dropped.
  const supersede = store.prepare<[string, string, string, string]>(
    `UPDATE wakeups SET status = 'superseded', updated_at = ?
      WHERE status = 'pending' AND reason = ? AND NOT (reason = ? AND due_at = ?)
        AND NOT EXISTS (SELECT 1 FROM events e WHERE e.kind = 'wakeup_scheduled'
                          AND json_extract(e.payload_json, '$.wakeup_id') = wakeups.id)`,
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
