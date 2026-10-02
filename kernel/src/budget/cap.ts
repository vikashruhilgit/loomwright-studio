import { USAGE_LIMIT_ERROR_PREFIXES } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Store } from "../store/store.js";
import { MAX_EVENT_TEXT, activeParks, appendEvent, appendNotify, clockOf, scheduleWakeupOnce } from "./internal.js";
import type { Clock, EventRef } from "./internal.js";
import type { BudgetAuth, BudgetDeps, BudgetOptions } from "./types.js";

/** An unknown reset (text fallback, or `rejected` without `resetsAt`) is re-checked after this long (AC6). */
export const CAP_RECHECK_MS = 60 * 60 * 1_000;

/** The `cap_state.rate_limit_type` of a park found from cap text alone. */
export const TEXT_FALLBACK_TYPE = "text_fallback";

/** The `cap_state.rate_limit_type` of an event that named no `rateLimitType`. */
export const UNKNOWN_LIMIT_TYPE = "unknown";

const TRANSIENT_BACKOFF_BASE_MS = 1_000;
const TRANSIENT_BACKOFF_MAX_MS = 60_000;

/**
 * The backoff hint for the `attempt`-th transient `rate_limit` error of a
 * session: 1 s, 2 s, 4 s, … capped at 60 s. A hint only: retrying belongs to
 * the caller (the event loop, item 07), and the CLI's own `api_retry` retries
 * too. `attempt` below 1 or not an integer reads as 1.
 */
export function transientBackoffMs(attempt: number): number {
  const n = Number.isInteger(attempt) && attempt >= 1 ? attempt : 1;
  return Math.min(TRANSIENT_BACKOFF_MAX_MS, TRANSIENT_BACKOFF_BASE_MS * 2 ** Math.min(n - 1, 16));
}

/** Where a usage-limit prefix was found (AC6). */
export type CapTextSource = "result_errors" | "result_text" | "assistant_text";

/** The first text of `message` that starts with one of the SDK's usage-limit prefixes, or `undefined`. */
export function findUsageLimitText(message: SDKMessage): { source: CapTextSource; text: string } | undefined {
  for (const candidate of capTextCandidates(message)) {
    const text = candidate.text.trimStart();
    if (USAGE_LIMIT_ERROR_PREFIXES.some((prefix) => text.startsWith(prefix))) return { source: candidate.source, text };
  }
  return undefined;
}

function capTextCandidates(message: SDKMessage): { source: CapTextSource; text: string }[] {
  const out: { source: CapTextSource; text: string }[] = [];
  const m = message as unknown as Record<string, unknown>;
  if (m.type === "result") {
    // (a) an error result's `errors[]`.
    if (Array.isArray(m.errors)) {
      for (const e of m.errors) if (typeof e === "string") out.push({ source: "result_errors", text: e });
    }
    // (b) a success-typed result that carries a failure: `is_error` with the error text in `result`.
    if (m.subtype === "success" && m.is_error === true && typeof m.result === "string") {
      out.push({ source: "result_text", text: m.result });
    }
  } else if (m.type === "assistant" && m.error !== undefined && m.error !== null) {
    // (c) the text of an assistant message that has `error` set.
    const inner = m.message as { content?: unknown } | undefined;
    const content = inner?.content;
    if (typeof content === "string") out.push({ source: "assistant_text", text: content });
    else if (Array.isArray(content)) {
      for (const block of content) {
        const b = block as { type?: unknown; text?: unknown } | null;
        if (b !== null && typeof b === "object" && b.type === "text" && typeof b.text === "string") {
          out.push({ source: "assistant_text", text: b.text });
        }
      }
    }
  }
  return out;
}

/** `JSON.stringify` that never throws and maps an unserializable value to `null`. */
function safeJson(value: unknown): string | null {
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? json : null;
  } catch {
    return null;
  }
}

/** A JSON-safe copy of `value` for an event payload, or `null` when it cannot be serialized. */
function jsonCopy(value: unknown): unknown {
  const json = safeJson(value);
  return json === null ? null : (JSON.parse(json) as unknown);
}

/** Epoch seconds to ISO-8601, or `null` when the value is not a usable time. */
function epochSecondsToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

interface CapRow {
  readonly status: string;
  readonly resets_at: string | null;
  readonly reset_source: string | null;
  readonly notified_resets_at: string | null;
  readonly warned_resets_at: string | null;
}

const RATE_LIMIT_STATUSES: ReadonlySet<string> = new Set(["allowed", "allowed_warning", "rejected"]);

/**
 * Tracks the subscription cap per auth account from what each session's
 * stream says (D17, D28, OPEN_QUESTIONS Q6), into `cap_state`, `events` and
 * `wakeups`. Keyed on the session row's `auth_account`, or the auth
 * provider's account when that is null (admission is keyed on the same).
 *
 * Per message, in this order (one real hit makes one park):
 *
 * 1. Text fallback (AC6): an error result's `errors[]`, the `result` text of a
 *    success-typed `is_error` result, or the text of an assistant message
 *    with `error` set, starting with one of the SDK's
 *    `USAGE_LIMIT_ERROR_PREFIXES`. Unless the account already has an
 *    unexpired park (from a `rejected` event or an earlier text hit), the
 *    account is parked with an unknown reset: `text_fallback` row, re-checked
 *    after `CAP_RECHECK_MS`, one `notify`, one `cap_recheck:<account>`
 *    wake-up. A match is never also classified as transient.
 * 2. `rate_limit_event` (AC3-AC5): `cap_state` upserted with status,
 *    `rateLimitType`, `resetsAt` (epoch seconds, stored as ISO), utilization
 *    and the untyped `unifiedWindows` verbatim. `rejected` notifies and
 *    schedules a `cap_reset:<account>` wake-up once per window;
 *    `allowed_warning` appends one `cap_warning` per window.
 * 3. An assistant `error: "rate_limit"` with no cap text while the account
 *    is not parked is transient (AC4): one `cap_transient` event with a
 *    backoff hint, no park.
 *
 * Admission (`BudgetAdmission`) reads the parks; this class only records.
 */
export class CapTracker {
  readonly #store: Store;
  readonly #auth: BudgetAuth;
  readonly #clock: Clock;

  constructor(options: BudgetOptions, deps: BudgetDeps = {}) {
    this.#store = options.store;
    this.#auth = options.authProvider;
    this.#clock = clockOf(deps);
  }

  observe(sessionId: number, message: SDKMessage): void {
    const capText = findUsageLimitText(message);
    const isRateLimitEvent = message.type === "rate_limit_event";
    const isRateLimitError = message.type === "assistant" && message.error === "rate_limit";
    if (capText === undefined && !isRateLimitEvent && !isRateLimitError) return;

    const now = this.#clock.now();
    const at = now.toISOString();
    this.#store.transaction(() => {
      const row = this.#store
        .prepare<[number], { auth_account: string | null; task_id: number | null }>(
          "SELECT auth_account, task_id FROM sessions WHERE id = ?",
        )
        .get(sessionId);
      const account = row?.auth_account ?? this.#auth.account;
      const ref: EventRef = { sessionId, taskId: row?.task_id ?? null };
      if (capText !== undefined) this.#textFallback(account, capText, ref, now, at);
      else if (isRateLimitEvent) this.#rateLimitEvent(account, message.rate_limit_info as unknown, ref, now, at);
      else this.#transient(account, ref, at);
    });
  }

  #textFallback(account: string, hit: { source: CapTextSource; text: string }, ref: EventRef, now: Date, at: string): void {
    // One hit, one park: any unexpired park of the account (a `rejected`
    // event's, or an earlier text hit's) already covers this one.
    if (activeParks(this.#store, account, at).length > 0) return;
    const resetsAt = new Date(now.getTime() + CAP_RECHECK_MS).toISOString();
    this.#upsert(
      account,
      TEXT_FALLBACK_TYPE,
      { status: "rejected", resetsAt, resetSource: "recheck", utilization: null, unifiedWindowsJson: null },
      at,
    );
    this.#setColumn(account, TEXT_FALLBACK_TYPE, "notified_resets_at", resetsAt);
    const text = hit.text.slice(0, MAX_EVENT_TEXT);
    appendEvent(
      this.#store,
      "cap_text_fallback",
      ref,
      { account, source: hit.source, text, resets_at: resetsAt, reset_source: "recheck" },
      at,
    );
    appendNotify(
      this.#store,
      this.#auth,
      account,
      ref,
      { reason: "cap_reached", rate_limit_type: TEXT_FALLBACK_TYPE, resets_at: null, recheck_at: resetsAt, text },
      at,
    );
    scheduleWakeupOnce(this.#store, `cap_recheck:${account}`, resetsAt, at);
  }

  #rateLimitEvent(account: string, info: unknown, ref: EventRef, now: Date, at: string): void {
    if (typeof info !== "object" || info === null) {
      appendEvent(this.#store, "cap_event_ignored", ref, { account, reason: "no_rate_limit_info" }, at);
      return;
    }
    const i = info as Record<string, unknown>;
    const status = i.status;
    if (typeof status !== "string" || !RATE_LIMIT_STATUSES.has(status)) {
      appendEvent(this.#store, "cap_event_ignored", ref, { account, reason: "unknown_status", status: safeJson(status) }, at);
      return;
    }
    const type = typeof i.rateLimitType === "string" && i.rateLimitType !== "" ? i.rateLimitType : UNKNOWN_LIMIT_TYPE;
    const utilization = typeof i.utilization === "number" && Number.isFinite(i.utilization) ? i.utilization : null;
    // Untyped (observed live, absent from sdk.d.ts): stored verbatim, never read.
    const unifiedWindowsJson = i.unifiedWindows === undefined ? null : safeJson(i.unifiedWindows);
    let resetsAt = epochSecondsToIso(i.resetsAt);
    let resetSource: string | null = resetsAt === null ? null : "event";
    const existing = this.#row(account, type);

    if (status === "rejected" && resetsAt === null) {
      // A `rejected` with no usable reset is an unknown reset: re-check hourly,
      // keeping an unexpired re-check time rather than moving it.
      const unexpired =
        existing !== undefined &&
        existing.status === "rejected" &&
        existing.reset_source === "recheck" &&
        existing.resets_at !== null &&
        existing.resets_at > at;
      resetsAt = unexpired ? existing.resets_at : new Date(now.getTime() + CAP_RECHECK_MS).toISOString();
      resetSource = "recheck";
    }
    this.#upsert(account, type, { status, resetsAt, resetSource, utilization, unifiedWindowsJson }, at);

    if (status === "rejected" && resetsAt !== null && existing?.notified_resets_at !== resetsAt) {
      this.#setColumn(account, type, "notified_resets_at", resetsAt);
      // Q6: the live `rejected` shape has never been seen, so its full payload is logged on first sight.
      const known = resetSource === "event";
      appendEvent(
        this.#store,
        "cap_rejected",
        ref,
        { account, rate_limit_type: type, resets_at: resetsAt, reset_source: resetSource, rate_limit_info: jsonCopy(info) },
        at,
      );
      appendNotify(
        this.#store,
        this.#auth,
        account,
        ref,
        { reason: "cap_reached", rate_limit_type: type, resets_at: known ? resetsAt : null, ...(known ? {} : { recheck_at: resetsAt }) },
        at,
      );
      scheduleWakeupOnce(this.#store, `${known ? "cap_reset" : "cap_recheck"}:${account}`, resetsAt, at);
    } else if (status === "allowed_warning") {
      const window = resetsAt ?? "unknown";
      if (existing?.warned_resets_at !== window) {
        this.#setColumn(account, type, "warned_resets_at", window);
        appendEvent(this.#store, "cap_warning", ref, { account, rate_limit_type: type, resets_at: resetsAt, utilization }, at);
      }
    }
  }

  #transient(account: string, ref: EventRef, at: string): void {
    // Part of a hit already parked (the `rejected` event came first): not transient.
    if (activeParks(this.#store, account, at).length > 0) return;
    const previous =
      ref.sessionId === null
        ? 0
        : (this.#store
            .prepare<[number], number>("SELECT count(*) FROM events WHERE kind = 'cap_transient' AND session_id = ?")
            .pluck()
            .get(ref.sessionId) ?? 0);
    const attempt = previous + 1;
    appendEvent(this.#store, "cap_transient", ref, { account, error: "rate_limit", attempt, backoffMs: transientBackoffMs(attempt) }, at);
  }

  #row(account: string, type: string): CapRow | undefined {
    return this.#store
      .prepare<[string, string], CapRow>(
        "SELECT status, resets_at, reset_source, notified_resets_at, warned_resets_at FROM cap_state WHERE account = ? AND rate_limit_type = ?",
      )
      .get(account, type);
  }

  #upsert(
    account: string,
    type: string,
    v: { status: string; resetsAt: string | null; resetSource: string | null; utilization: number | null; unifiedWindowsJson: string | null },
    at: string,
  ): void {
    this.#store
      .prepare(
        `INSERT INTO cap_state (account, rate_limit_type, status, resets_at, utilization, unified_windows_json, reset_source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (account, rate_limit_type) DO UPDATE SET
           status = excluded.status, resets_at = excluded.resets_at, utilization = excluded.utilization,
           unified_windows_json = excluded.unified_windows_json, reset_source = excluded.reset_source,
           updated_at = excluded.updated_at`,
      )
      .run(account, type, v.status, v.resetsAt, v.utilization, v.unifiedWindowsJson, v.resetSource, at);
  }

  #setColumn(account: string, type: string, column: "notified_resets_at" | "warned_resets_at", value: string): void {
    this.#store
      .prepare(`UPDATE cap_state SET ${column} = ? WHERE account = ? AND rate_limit_type = ?`)
      .run(value, account, type);
  }
}
