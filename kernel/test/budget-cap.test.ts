// Unit tests for the cap tracker (item 06, AC3-AC6, AC9). Replays the
// recorded p6 `rate_limit_event` and its synthesized variants; never the real
// SDK or a model.
import { USAGE_LIMIT_ERROR_PREFIXES } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordTokenCreated } from "../src/auth/index.js";
// Tests may import the subscription provider directly; src/ must not (D29).
import { createSubscriptionTokenProvider } from "../src/auth/subscription-token.js";
import {
  BudgetAdmission,
  CAP_RECHECK_MS,
  CapTracker,
  MAX_RESET_AHEAD_MS,
  findUsageLimitText,
  transientBackoffMs,
} from "../src/budget/index.js";
import type { AdmissionRequest } from "../src/sessions/index.js";
import {
  AUTH,
  assistantError,
  errorResult,
  events,
  fixture,
  insertSession,
  isErrorSuccessResult,
  rateLimitEvent,
  testEnv,
} from "./budget-helpers.js";
import type { TestEnv } from "./budget-helpers.js";

// Before the p6 event's five_hour reset (2026-09-29T16:20:00Z).
const START = "2026-09-29T12:00:00.000Z";
const FIVE_HOUR_RESET = "2026-09-29T16:20:00.000Z";
const SEVEN_DAY_RESET = "2026-10-05T16:00:00.000Z";
const CAP_TEXT = "You've hit your limit · resets 6am (UTC)";

let env: TestEnv;
let tracker: CapTracker;

beforeEach(() => {
  env = testEnv(START);
  tracker = new CapTracker({ store: env.store, authProvider: AUTH }, env.deps);
});

afterEach(() => env.cleanup());

interface CapRow {
  account: string;
  rate_limit_type: string;
  status: string;
  resets_at: string | null;
  utilization: number | null;
  unified_windows_json: string | null;
  reset_source: string | null;
  notified_resets_at: string | null;
  warned_resets_at: string | null;
}

function capRows(): CapRow[] {
  return env.store
    .prepare<[], CapRow>(
      `SELECT account, rate_limit_type, status, resets_at, utilization, unified_windows_json, reset_source,
              notified_resets_at, warned_resets_at FROM cap_state ORDER BY account, rate_limit_type`,
    )
    .all();
}

function wakeups(): { due_at: string; reason: string; status: string }[] {
  return env.store.prepare<[], { due_at: string; reason: string; status: string }>("SELECT due_at, reason, status FROM wakeups ORDER BY id").all();
}

function inAnHour(): string {
  return new Date(env.clock.at.getTime() + CAP_RECHECK_MS).toISOString();
}

describe("rate_limit_event (AC3)", () => {
  it("replays the recorded p6 event into cap_state: seconds stored as ISO, utilization, unifiedWindows verbatim", () => {
    const id = insertSession(env.store);
    const event = fixture("p6-rate-limit-event.json");
    tracker.observe(id, event);
    expect(capRows()).toEqual([
      {
        // Keyed on the provider id, never its label (F06-1).
        account: AUTH.id,
        rate_limit_type: "five_hour",
        status: "allowed",
        resets_at: FIVE_HOUR_RESET,
        utilization: 0.01,
        unified_windows_json: JSON.stringify((event as unknown as { rate_limit_info: { unifiedWindows: unknown } }).rate_limit_info.unifiedWindows),
        reset_source: "event",
        notified_resets_at: null,
        warned_resets_at: null,
      },
    ]);
    // 0-1 scale, as recorded live.
    expect(JSON.parse(capRows()[0]?.unified_windows_json ?? "null")).toMatchObject({ five_hour: { utilization: 0.01 }, seven_day: { utilization: 0.07 } });
    expect(events(env.store)).toEqual([]);
    expect(wakeups()).toEqual([]);
  });

  it("stores an event with no rateLimitType, resetsAt or unifiedWindows, and an odd unifiedWindows, without throwing", () => {
    const id = insertSession(env.store);
    tracker.observe(id, rateLimitEvent({ status: "allowed" }));
    expect(capRows()[0]).toMatchObject({ rate_limit_type: "unknown", resets_at: null, utilization: null, unified_windows_json: null, reset_source: null });

    tracker.observe(id, rateLimitEvent({ status: "allowed", rateLimitType: "seven_day", unifiedWindows: "odd", resetsAt: "soon" }));
    expect(capRows().find((r) => r.rate_limit_type === "seven_day")).toMatchObject({ unified_windows_json: '"odd"', resets_at: null });

    tracker.observe(id, rateLimitEvent({ status: "allowed", rateLimitType: "overage", unifiedWindows: { big: 1n }, resetsAt: Number.POSITIVE_INFINITY }));
    expect(capRows().find((r) => r.rate_limit_type === "overage")).toMatchObject({ unified_windows_json: null, resets_at: null });
  });

  it("ignores a malformed event with a recorded reason", () => {
    const id = insertSession(env.store);
    tracker.observe(id, { type: "rate_limit_event" } as never);
    tracker.observe(id, rateLimitEvent({ status: "throttled" }));
    expect(capRows()).toEqual([]);
    expect(events(env.store, "cap_event_ignored").map((e) => e.payload.reason)).toEqual(["no_rate_limit_info", "unknown_status"]);
  });

  it("an allowed event never clears an unexpired park (fail closed); after resetsAt it updates the status", () => {
    const a = insertSession(env.store);
    const b = insertSession(env.store);
    tracker.observe(a, fixture("p6-rate-limit-rejected.json"));
    // Another session's allowed for the same type while the park is in force.
    tracker.observe(b, fixture("p6-rate-limit-event.json"));
    tracker.observe(b, rateLimitEvent({ status: "allowed_warning", rateLimitType: "five_hour", resetsAt: 1790698800, utilization: 0.9 }));
    expect(capRows()[0]).toMatchObject({ status: "rejected", resets_at: FIVE_HOUR_RESET, reset_source: "event", notified_resets_at: FIVE_HOUR_RESET, utilization: 0.9 });
    expect(events(env.store, "cap_allowed_while_parked").map((e) => e.payload.status)).toEqual(["allowed", "allowed_warning"]);
    expect(events(env.store, "cap_warning")).toEqual([]);
    const gate = new BudgetAdmission({ store: env.store, authProvider: AUTH }, env.deps);
    expect(gate.check({ kind: "start", agent: "wright", account: AUTH.account, provider: AUTH.id, task: null })).toMatchObject({ admitted: false, retryAt: FIVE_HOUR_RESET });

    env.clock.at = new Date(FIVE_HOUR_RESET);
    tracker.observe(b, rateLimitEvent({ status: "allowed", rateLimitType: "five_hour", resetsAt: 1790716800, utilization: 0.01 }));
    expect(capRows()[0]).toMatchObject({ status: "allowed", notified_resets_at: FIVE_HOUR_RESET });
  });
});

describe("rejected (AC4)", () => {
  it("logs the full payload, notifies once and schedules one wake-up at resetsAt, per window", () => {
    const id = insertSession(env.store, { task: null });
    const rejected = fixture("p6-rate-limit-rejected.json");
    tracker.observe(id, rejected);
    tracker.observe(id, rejected);

    expect(capRows()[0]).toMatchObject({ status: "rejected", resets_at: FIVE_HOUR_RESET, reset_source: "event", notified_resets_at: FIVE_HOUR_RESET, utilization: 1 });
    const logged = events(env.store, "cap_rejected");
    expect(logged).toHaveLength(1);
    expect(logged[0]?.payload.rate_limit_info).toEqual((rejected as unknown as { rate_limit_info: unknown }).rate_limit_info);
    expect(events(env.store, "notify")).toEqual([
      expect.objectContaining({
        session_id: id,
        payload: { provider: AUTH.id, account: AUTH.account, reason: "cap_reached", rate_limit_type: "five_hour", resets_at: FIVE_HOUR_RESET },
      }),
    ]);
    expect(wakeups()).toEqual([{ due_at: FIVE_HOUR_RESET, reason: `cap_reset:${AUTH.id}:five_hour`, status: "pending" }]);

    // A new window (a later reset) is a new rejection: notified again, and its wake-up supersedes the first.
    tracker.observe(id, rateLimitEvent({ status: "rejected", rateLimitType: "five_hour", resetsAt: 1790716800 }));
    expect(events(env.store, "notify")).toHaveLength(2);
    expect(wakeups()).toEqual([
      { due_at: FIVE_HOUR_RESET, reason: `cap_reset:${AUTH.id}:five_hour`, status: "superseded" },
      { due_at: "2026-09-29T21:20:00.000Z", reason: `cap_reset:${AUTH.id}:five_hour`, status: "pending" },
    ]);
  });

  it("a millisecond-scale resetsAt (past year 9999) is an unknown reset: parked with an hourly re-check, admission refuses", () => {
    const id = insertSession(env.store);
    tracker.observe(id, rateLimitEvent({ status: "rejected", rateLimitType: "five_hour", resetsAt: 1790698800000 }));
    const recheck = inAnHour();
    expect(capRows()[0]).toMatchObject({ status: "rejected", resets_at: recheck, reset_source: "recheck" });
    expect(events(env.store, "notify")[0]?.payload).toMatchObject({ resets_at: null, recheck_at: recheck });
    expect(wakeups()).toEqual([{ due_at: recheck, reason: `cap_recheck:${AUTH.id}:five_hour`, status: "pending" }]);
    const gate = new BudgetAdmission({ store: env.store, authProvider: AUTH }, env.deps);
    expect(gate.check({ kind: "resume", agent: "wright", account: AUTH.account, provider: AUTH.id, task: null })).toEqual({
      admitted: false,
      reason: "cap_parked",
      retryAt: recheck,
    });
  });

  it("an implausibly distant or already-passed resetsAt on a rejected event is an unknown reset; an allowed one stores none", () => {
    const id = insertSession(env.store);
    const now = env.clock.at.getTime() / 1_000;
    tracker.observe(id, rateLimitEvent({ status: "rejected", rateLimitType: "seven_day", resetsAt: now + MAX_RESET_AHEAD_MS / 1_000 + 60 }));
    tracker.observe(id, rateLimitEvent({ status: "rejected", rateLimitType: "five_hour", resetsAt: now - 60 }));
    tracker.observe(id, rateLimitEvent({ status: "allowed", rateLimitType: "overage", resetsAt: 253_402_300_800 }));
    const recheck = inAnHour();
    expect(capRows()).toEqual([
      expect.objectContaining({ rate_limit_type: "five_hour", resets_at: recheck, reset_source: "recheck" }),
      expect.objectContaining({ rate_limit_type: "overage", resets_at: null, reset_source: null }),
      expect.objectContaining({ rate_limit_type: "seven_day", resets_at: recheck, reset_source: "recheck" }),
    ]);
    // Every stored reset is a 4-digit-year ISO string, so text order is time order.
    expect(capRows().every((r) => r.resets_at === null || /^\d{4}-/.test(r.resets_at))).toBe(true);
  });

  it("a rejected event with no usable resetsAt parks with an hourly re-check, not moved by a repeat", () => {
    const id = insertSession(env.store);
    tracker.observe(id, rateLimitEvent({ status: "rejected", rateLimitType: "seven_day" }));
    const recheck = inAnHour();
    env.clock.at = new Date(env.clock.at.getTime() + 60_000);
    tracker.observe(id, rateLimitEvent({ status: "rejected", rateLimitType: "seven_day", resetsAt: Number.NaN }));
    expect(capRows()[0]).toMatchObject({ status: "rejected", resets_at: recheck, reset_source: "recheck" });
    expect(events(env.store, "notify")).toHaveLength(1);
    expect(events(env.store, "notify")[0]?.payload).toMatchObject({ resets_at: null, recheck_at: recheck });
    expect(wakeups()).toEqual([{ due_at: recheck, reason: `cap_recheck:${AUTH.id}:seven_day`, status: "pending" }]);
  });

  it("a known park is never moved earlier or re-notified by a later rejected with no usable, a ms-scale or an earlier resetsAt", () => {
    const a = insertSession(env.store);
    const b = insertSession(env.store);
    const now = env.clock.at.getTime() / 1_000;
    const fourHours = new Date(env.clock.at.getTime() + 4 * 3_600_000).toISOString();
    tracker.observe(a, rateLimitEvent({ status: "rejected", rateLimitType: "five_hour", resetsAt: now + 4 * 3_600 }));
    tracker.observe(b, rateLimitEvent({ status: "rejected", rateLimitType: "five_hour" }));
    tracker.observe(b, rateLimitEvent({ status: "rejected", rateLimitType: "five_hour", resetsAt: (now + 3_600) * 1_000 }));
    tracker.observe(b, rateLimitEvent({ status: "rejected", rateLimitType: "five_hour", resetsAt: now + MAX_RESET_AHEAD_MS / 1_000 + 60 }));
    tracker.observe(b, rateLimitEvent({ status: "rejected", rateLimitType: "five_hour", resetsAt: now + 2 * 3_600 }));
    expect(capRows()).toEqual([
      expect.objectContaining({ rate_limit_type: "five_hour", status: "rejected", resets_at: fourHours, reset_source: "event", notified_resets_at: fourHours }),
    ]);
    expect(events(env.store, "notify")).toHaveLength(1);
    expect(events(env.store, "cap_rejected")).toHaveLength(1);
    expect(wakeups()).toEqual([{ due_at: fourHours, reason: `cap_reset:${AUTH.id}:five_hour`, status: "pending" }]);
    // Past the hour a re-check would have ended, admission still refuses until the known reset.
    env.clock.at = new Date(env.clock.at.getTime() + CAP_RECHECK_MS + 1_000);
    const gate = new BudgetAdmission({ store: env.store, authProvider: AUTH }, env.deps);
    expect(gate.check({ kind: "start", agent: "wright", account: AUTH.account, provider: AUTH.id, task: null })).toEqual({
      admitted: false,
      reason: "cap_parked",
      retryAt: fourHours,
    });
  });

  it("a known reset later than a re-check park extends it and notifies the known window once", () => {
    const id = insertSession(env.store);
    const now = env.clock.at.getTime() / 1_000;
    const fourHours = new Date(env.clock.at.getTime() + 4 * 3_600_000).toISOString();
    tracker.observe(id, rateLimitEvent({ status: "rejected", rateLimitType: "five_hour" }));
    tracker.observe(id, rateLimitEvent({ status: "rejected", rateLimitType: "five_hour", resetsAt: now + 4 * 3_600 }));
    tracker.observe(id, rateLimitEvent({ status: "rejected", rateLimitType: "five_hour", resetsAt: now + 4 * 3_600 }));
    expect(capRows()[0]).toMatchObject({ resets_at: fourHours, reset_source: "event", notified_resets_at: fourHours });
    expect(events(env.store, "notify").map((n) => n.payload.resets_at)).toEqual([null, fourHours]);
    expect(events(env.store, "cap_rejected")[1]?.payload).toMatchObject({ extended_from: inAnHour() });
    // The re-check wake-up is superseded by the known reset's: one pending per provider and type.
    expect(wakeups()).toEqual([
      { due_at: inAnHour(), reason: `cap_recheck:${AUTH.id}:five_hour`, status: "superseded" },
      { due_at: fourHours, reason: `cap_reset:${AUTH.id}:five_hour`, status: "pending" },
    ]);
  });
});

describe("allowed_warning (AC5)", () => {
  it("emits exactly one cap_warning per window per provider, whatever its label", () => {
    const id = insertSession(env.store);
    const warning = fixture("p6-rate-limit-warning.json");
    tracker.observe(id, warning);
    tracker.observe(id, warning);
    expect(events(env.store, "cap_warning")).toHaveLength(1);
    expect(events(env.store, "cap_warning")[0]?.payload).toMatchObject({ rate_limit_type: "seven_day", resets_at: SEVEN_DAY_RESET, utilization: 0.8 });
    expect(capRows()[0]).toMatchObject({ status: "allowed_warning", warned_resets_at: SEVEN_DAY_RESET });
    expect(events(env.store, "notify")).toEqual([]);
    expect(wakeups()).toEqual([]);

    // The same provider relabelled is the same key: no second warning for the window.
    new CapTracker({ store: env.store, authProvider: { id: AUTH.id, account: "second@example.test" } }, env.deps).observe(id, warning);
    expect(events(env.store, "cap_warning")).toHaveLength(1);
    // Another provider (another id, even under the same label) warns separately; a new window warns again.
    new CapTracker({ store: env.store, authProvider: { id: "other-provider", account: AUTH.account } }, env.deps).observe(id, warning);
    tracker.observe(id, rateLimitEvent({ status: "allowed_warning", rateLimitType: "seven_day", resetsAt: 1791820800 }));
    expect(events(env.store, "cap_warning")).toHaveLength(3);
    expect(events(env.store, "cap_warning").map((e) => [e.payload.provider, e.payload.account])).toEqual([
      [AUTH.id, AUTH.account],
      ["other-provider", AUTH.account],
      [AUTH.id, AUTH.account],
    ]);
  });
});

describe("transient rate_limit (AC4)", () => {
  it("records a cap_transient event with a growing backoff hint and no park", () => {
    const id = insertSession(env.store);
    tracker.observe(id, assistantError("rate_limit"));
    tracker.observe(id, assistantError("rate_limit", "Rate limited, try again shortly"));
    expect(events(env.store, "cap_transient").map((e) => e.payload)).toEqual([
      { account: AUTH.account, provider: AUTH.id, error: "rate_limit", attempt: 1, backoffMs: 1_000 },
      { account: AUTH.account, provider: AUTH.id, error: "rate_limit", attempt: 2, backoffMs: 2_000 },
    ]);
    expect(capRows()).toEqual([]);
    expect(events(env.store, "notify")).toEqual([]);
  });

  it("is not recorded while the account is parked by a rejected event", () => {
    const id = insertSession(env.store);
    tracker.observe(id, fixture("p6-rate-limit-rejected.json"));
    tracker.observe(id, assistantError("rate_limit"));
    expect(events(env.store, "cap_transient")).toEqual([]);
  });

  it("other assistant errors are not cap signals", () => {
    const id = insertSession(env.store);
    tracker.observe(id, assistantError("overloaded"));
    expect(events(env.store)).toEqual([]);
  });

  it("transientBackoffMs doubles from 1 s and caps at 60 s", () => {
    expect([1, 2, 3, 4, 6, 7, 50].map(transientBackoffMs)).toEqual([1_000, 2_000, 4_000, 8_000, 32_000, 60_000, 60_000]);
    expect(transientBackoffMs(0)).toBe(1_000);
    expect(transientBackoffMs(1.5)).toBe(1_000);
  });
});

describe("text fallback (AC6)", () => {
  function expectOneRecheckPark(sessionId: number, recheck: string): void {
    expect(capRows()).toEqual([
      expect.objectContaining({ rate_limit_type: "text_fallback", status: "rejected", resets_at: recheck, reset_source: "recheck" }),
    ]);
    const notify = events(env.store, "notify");
    expect(notify).toHaveLength(1);
    expect(notify[0]).toMatchObject({ session_id: sessionId, payload: { reason: "cap_reached", resets_at: null, recheck_at: recheck } });
    expect(wakeups()).toEqual([{ due_at: recheck, reason: `cap_recheck:${AUTH.id}:text_fallback`, status: "pending" }]);
    expect(events(env.store, "cap_transient")).toEqual([]);
  }

  it("matches every one of the SDK's runtime USAGE_LIMIT_ERROR_PREFIXES, and nothing else", () => {
    expect(USAGE_LIMIT_ERROR_PREFIXES.length).toBeGreaterThan(0);
    for (const prefix of USAGE_LIMIT_ERROR_PREFIXES) {
      expect(findUsageLimitText(errorResult([`${prefix} and more`]))).toMatchObject({ source: "result_errors" });
    }
    expect(findUsageLimitText(errorResult(["boom", "API Error: 500"]))).toBeUndefined();
    expect(findUsageLimitText(isErrorSuccessResult("I said: You've hit your limit"))).toBeUndefined();
    // A non-error success result is the model's own answer, never a cap signal.
    expect(findUsageLimitText({ type: "result", subtype: "success", is_error: false, result: CAP_TEXT } as never)).toBeUndefined();
    // An assistant message without `error` is the model talking.
    expect(findUsageLimitText({ type: "assistant", message: { content: [{ type: "text", text: CAP_TEXT }] } } as never)).toBeUndefined();
  });

  it("(a) an error result's errors[] parks for an hour with a re-check wake-up", () => {
    const id = insertSession(env.store);
    tracker.observe(id, errorResult(["something else", CAP_TEXT]));
    expectOneRecheckPark(id, inAnHour());
    expect(events(env.store, "cap_text_fallback")[0]?.payload).toMatchObject({ source: "result_errors", text: CAP_TEXT });
  });

  it("(b) a success-typed is_error result parks", () => {
    const id = insertSession(env.store);
    tracker.observe(id, isErrorSuccessResult(CAP_TEXT));
    expectOneRecheckPark(id, inAnHour());
    expect(events(env.store, "cap_text_fallback")[0]?.payload).toMatchObject({ source: "result_text" });
  });

  it("(c) an assistant error message's text parks", () => {
    const id = insertSession(env.store);
    tracker.observe(id, assistantError("unknown", CAP_TEXT));
    expectOneRecheckPark(id, inAnHour());
    expect(events(env.store, "cap_text_fallback")[0]?.payload).toMatchObject({ source: "assistant_text" });
  });

  it("one hit delivered as an assistant rate_limit message with cap text AND an is_error result: one park, one notify, one wake-up, no transient", () => {
    const id = insertSession(env.store);
    const recheck = inAnHour();
    tracker.observe(id, assistantError("rate_limit", CAP_TEXT));
    env.clock.at = new Date(env.clock.at.getTime() + 500);
    tracker.observe(id, isErrorSuccessResult(CAP_TEXT));
    expectOneRecheckPark(id, recheck);
    expect(events(env.store, "cap_text_fallback")).toHaveLength(1);
  });

  it("is suppressed when a rejected event already parked the account (any of its sessions)", () => {
    const a = insertSession(env.store);
    const b = insertSession(env.store);
    tracker.observe(a, fixture("p6-rate-limit-rejected.json"));
    tracker.observe(a, isErrorSuccessResult(CAP_TEXT));
    tracker.observe(b, errorResult([CAP_TEXT]));
    expect(capRows().map((r) => r.rate_limit_type)).toEqual(["five_hour"]);
    expect(events(env.store, "notify")).toHaveLength(1);
    expect(events(env.store, "cap_text_fallback")).toEqual([]);
  });

  it("after the hour a new hit re-parks for another hour (re-check hourly)", () => {
    const id = insertSession(env.store);
    const first = inAnHour();
    tracker.observe(id, errorResult([CAP_TEXT]));
    env.clock.at = new Date(env.clock.at.getTime() + CAP_RECHECK_MS + 1);
    const second = inAnHour();
    tracker.observe(id, errorResult([CAP_TEXT]));
    expect(capRows()[0]).toMatchObject({ resets_at: second });
    expect(events(env.store, "notify")).toHaveLength(2);
    expect(wakeups().map((w) => [w.due_at, w.status])).toEqual([
      // The first re-check (due, never fired here) is superseded by the new one.
      [first, "superseded"],
      [second, "pending"],
    ]);
  });

  it("keys on the auth provider's id whatever the session row's auth_account label (null or stale)", () => {
    for (const label of [null, "stub-provider"]) {
      const id = insertSession(env.store, { account: label });
      tracker.observe(id, errorResult([CAP_TEXT]));
      tracker.observe(id, fixture("p6-rate-limit-warning.json"));
    }
    expect(capRows().map((r) => r.account)).toEqual([AUTH.id, AUTH.id]);
    expect(wakeups().map((w) => w.reason)).toEqual([`cap_recheck:${AUTH.id}:text_fallback`]);
    expect(events(env.store, "notify")).toHaveLength(1);
  });
});

describe("keyed on the provider id, never its label (F06-1)", () => {
  const REJECTED = "p6-rate-limit-rejected.json";

  it("a relabel of the provider never lifts a park, and a second rejected for the window writes no second row or notify", () => {
    // A mutable BudgetAuth: the live label can change under a running kernel.
    const auth: { id: string; account: string } = { id: AUTH.id, account: AUTH.account };
    const live = new CapTracker({ store: env.store, authProvider: auth }, env.deps);
    const gate = new BudgetAdmission({ store: env.store, authProvider: auth }, env.deps);
    const ask = (): AdmissionRequest => ({ kind: "start", agent: "wright", account: auth.account, provider: auth.id, task: null });
    const id = insertSession(env.store);
    live.observe(id, fixture(REJECTED));
    expect(gate.check(ask())).toEqual({ admitted: false, reason: "cap_parked", retryAt: FIVE_HOUR_RESET });

    auth.account = "renamed@example.test";
    expect(gate.check(ask())).toEqual({ admitted: false, reason: "cap_parked", retryAt: FIVE_HOUR_RESET });
    live.observe(id, fixture(REJECTED));
    expect(capRows()).toEqual([expect.objectContaining({ account: AUTH.id, rate_limit_type: "five_hour", resets_at: FIVE_HOUR_RESET })]);
    expect(events(env.store, "notify")).toHaveLength(1);
    expect(wakeups()).toEqual([{ due_at: FIVE_HOUR_RESET, reason: `cap_reset:${AUTH.id}:five_hour`, status: "pending" }]);
    // Payloads carry the live label for display and the id the park is keyed on.
    expect(events(env.store, "admission_refused").at(-1)?.payload).toMatchObject({ account: "renamed@example.test", provider: AUTH.id });
  });

  it("the real trigger: recordTokenCreated relabels a subscription-token provider mid-park and admission still refuses", () => {
    // A faked Keychain: never the real one.
    const provider = createSubscriptionTokenProvider({ store: env.store, keychain: { read: () => undefined }, now: env.deps.now });
    // No metadata yet: the label falls back to the provider id.
    expect(provider.account).toBe(provider.id);
    const live = new CapTracker({ store: env.store, authProvider: provider }, env.deps);
    const gate = new BudgetAdmission({ store: env.store, authProvider: provider }, env.deps);
    const ask = (): AdmissionRequest => ({ kind: "resume", agent: "wright", account: provider.account, provider: provider.id, task: null });
    const id = insertSession(env.store);
    live.observe(id, fixture(REJECTED));

    recordTokenCreated(env.store, provider.id, "owner@example.test", "2026-09-01T00:00:00.000Z", env.clock.at);
    expect(provider.account).toBe("owner@example.test");
    expect(gate.check(ask())).toEqual({ admitted: false, reason: "cap_parked", retryAt: FIVE_HOUR_RESET });
    live.observe(id, fixture(REJECTED));
    expect(capRows()).toEqual([expect.objectContaining({ account: provider.id, rate_limit_type: "five_hour", resets_at: FIVE_HOUR_RESET })]);
    expect(events(env.store, "notify").map((n) => [n.payload.provider, n.payload.account])).toEqual([[provider.id, provider.id]]);

    env.clock.at = new Date(FIVE_HOUR_RESET);
    expect(gate.check(ask())).toEqual({ admitted: true });
  });
});

describe("a text hit then a rejected event for the same hit (AC2)", () => {
  const TWELVE_THIRTY = "2026-09-29T12:30:00.000Z";

  it("a later known reset replaces the text-fallback park: one row, notified again (the window extended), one pending wake-up", () => {
    const id = insertSession(env.store);
    const recheck = inAnHour();
    tracker.observe(id, errorResult([CAP_TEXT]));
    tracker.observe(id, fixture("p6-rate-limit-rejected.json"));
    expect(capRows()).toEqual([
      expect.objectContaining({
        account: AUTH.id,
        rate_limit_type: "five_hour",
        status: "rejected",
        resets_at: FIVE_HOUR_RESET,
        reset_source: "event",
        notified_resets_at: FIVE_HOUR_RESET,
      }),
    ]);
    expect(events(env.store, "notify").map((n) => [n.payload.resets_at, n.payload.recheck_at ?? null])).toEqual([
      [null, recheck],
      [FIVE_HOUR_RESET, null],
    ]);
    expect(events(env.store, "cap_park_superseded").map((e) => e.payload)).toEqual([
      expect.objectContaining({
        account: AUTH.account,
        provider: AUTH.id,
        rate_limit_type: "five_hour",
        resets_at: FIVE_HOUR_RESET,
        replaced: { rate_limit_type: "text_fallback", resets_at: recheck, reset_source: "recheck" },
        notified: true,
      }),
    ]);
    expect(wakeups()).toEqual([
      { due_at: recheck, reason: `cap_recheck:${AUTH.id}:text_fallback`, status: "superseded" },
      { due_at: FIVE_HOUR_RESET, reason: `cap_reset:${AUTH.id}:five_hour`, status: "pending" },
    ]);
    // The same rejected again is the same window: nothing new.
    tracker.observe(id, fixture("p6-rate-limit-rejected.json"));
    expect(events(env.store, "notify")).toHaveLength(2);
    expect(wakeups()).toHaveLength(2);
  });

  it("an earlier known reset still replaces the re-check guess: one row at the known reset, ONE notify, admission retries then", () => {
    const id = insertSession(env.store);
    const recheck = inAnHour();
    tracker.observe(id, errorResult([CAP_TEXT]));
    tracker.observe(id, rateLimitEvent({ status: "rejected", rateLimitType: "five_hour", resetsAt: Date.parse(TWELVE_THIRTY) / 1_000 }));
    expect(capRows()).toEqual([
      expect.objectContaining({ rate_limit_type: "five_hour", resets_at: TWELVE_THIRTY, reset_source: "event", notified_resets_at: TWELVE_THIRTY }),
    ]);
    expect(events(env.store, "notify")).toHaveLength(1);
    expect(events(env.store, "cap_park_superseded")[0]?.payload).toMatchObject({ resets_at: TWELVE_THIRTY, notified: false });
    expect(events(env.store, "cap_rejected")).toEqual([]);
    expect(wakeups()).toEqual([
      { due_at: recheck, reason: `cap_recheck:${AUTH.id}:text_fallback`, status: "superseded" },
      { due_at: TWELVE_THIRTY, reason: `cap_reset:${AUTH.id}:five_hour`, status: "pending" },
    ]);
    const gate = new BudgetAdmission({ store: env.store, authProvider: AUTH }, env.deps);
    const ask: AdmissionRequest = { kind: "start", agent: "wright", account: AUTH.account, provider: AUTH.id, task: null };
    expect(gate.check(ask)).toEqual({ admitted: false, reason: "cap_parked", retryAt: TWELVE_THIRTY });
    env.clock.at = new Date(TWELVE_THIRTY);
    expect(gate.check(ask)).toEqual({ admitted: true });
  });

  it("an unknown reset leaves the text-fallback park as it is: one row, one notify, one pending wake-up", () => {
    const id = insertSession(env.store);
    const recheck = inAnHour();
    tracker.observe(id, errorResult([CAP_TEXT]));
    env.clock.at = new Date(env.clock.at.getTime() + 60_000);
    tracker.observe(id, rateLimitEvent({ status: "rejected", rateLimitType: "five_hour" }));
    expect(capRows()).toEqual([expect.objectContaining({ rate_limit_type: "text_fallback", resets_at: recheck, reset_source: "recheck" })]);
    expect(events(env.store, "notify")).toHaveLength(1);
    expect(events(env.store, "cap_park_merged").map((e) => e.payload)).toEqual([
      expect.objectContaining({
        provider: AUTH.id,
        rate_limit_type: "five_hour",
        kept: { rate_limit_type: "text_fallback", resets_at: recheck, reset_source: "recheck" },
      }),
    ]);
    expect(wakeups()).toEqual([{ due_at: recheck, reason: `cap_recheck:${AUTH.id}:text_fallback`, status: "pending" }]);
  });
});

describe("superseded cap wake-ups (AC3)", () => {
  const SEVENTEEN_TWENTY = "2026-09-29T17:20:00.000Z";

  it("an extended park leaves one pending wake-up for its provider and type; another type's park and wake-up are untouched", () => {
    const id = insertSession(env.store);
    tracker.observe(id, rateLimitEvent({ status: "rejected", rateLimitType: "seven_day", resetsAt: Date.parse(SEVEN_DAY_RESET) / 1_000 }));
    tracker.observe(id, fixture("p6-rate-limit-rejected.json"));
    tracker.observe(id, rateLimitEvent({ status: "rejected", rateLimitType: "five_hour", resetsAt: Date.parse(SEVENTEEN_TWENTY) / 1_000 }));
    // Two known limit types stay two rows.
    expect(capRows().map((r) => [r.rate_limit_type, r.resets_at])).toEqual([
      ["five_hour", SEVENTEEN_TWENTY],
      ["seven_day", SEVEN_DAY_RESET],
    ]);
    expect(wakeups()).toEqual([
      { due_at: SEVEN_DAY_RESET, reason: `cap_reset:${AUTH.id}:seven_day`, status: "pending" },
      { due_at: FIVE_HOUR_RESET, reason: `cap_reset:${AUTH.id}:five_hour`, status: "superseded" },
      { due_at: SEVENTEEN_TWENTY, reason: `cap_reset:${AUTH.id}:five_hour`, status: "pending" },
    ]);
  });

  it("a legacy untyped cap wake-up of the provider (migration 9's form) is superseded; another provider's is not", () => {
    const insert = env.store.prepare("INSERT INTO wakeups (due_at, reason, status) VALUES (?, ?, 'pending')");
    insert.run(FIVE_HOUR_RESET, `cap_reset:${AUTH.id}`);
    insert.run(FIVE_HOUR_RESET, "cap_reset:other-provider");
    tracker.observe(insertSession(env.store), fixture("p6-rate-limit-rejected.json"));
    expect(wakeups()).toEqual([
      { due_at: FIVE_HOUR_RESET, reason: `cap_reset:${AUTH.id}`, status: "superseded" },
      { due_at: FIVE_HOUR_RESET, reason: "cap_reset:other-provider", status: "pending" },
      { due_at: FIVE_HOUR_RESET, reason: `cap_reset:${AUTH.id}:five_hour`, status: "pending" },
    ]);
  });
});
