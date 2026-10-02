// Unit tests for the cap tracker (item 06, AC3-AC6, AC9). Replays the
// recorded p6 `rate_limit_event` and its synthesized variants; never the real
// SDK or a model.
import { USAGE_LIMIT_ERROR_PREFIXES } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CAP_RECHECK_MS, CapTracker, findUsageLimitText, transientBackoffMs } from "../src/budget/index.js";
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
        account: AUTH.account,
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

  it("an allowed event after a rejected one updates the status", () => {
    const id = insertSession(env.store);
    tracker.observe(id, fixture("p6-rate-limit-rejected.json"));
    tracker.observe(id, fixture("p6-rate-limit-event.json"));
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
    expect(wakeups()).toEqual([{ due_at: FIVE_HOUR_RESET, reason: `cap_reset:${AUTH.account}`, status: "pending" }]);

    // A new window (a later reset) is a new rejection: notified again.
    tracker.observe(id, rateLimitEvent({ status: "rejected", rateLimitType: "five_hour", resetsAt: 1790716800 }));
    expect(events(env.store, "notify")).toHaveLength(2);
    expect(wakeups()).toHaveLength(2);
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
    expect(wakeups()).toEqual([{ due_at: recheck, reason: `cap_recheck:${AUTH.account}`, status: "pending" }]);
  });
});

describe("allowed_warning (AC5)", () => {
  it("emits exactly one cap_warning per window per account", () => {
    const id = insertSession(env.store);
    const warning = fixture("p6-rate-limit-warning.json");
    tracker.observe(id, warning);
    tracker.observe(id, warning);
    expect(events(env.store, "cap_warning")).toHaveLength(1);
    expect(events(env.store, "cap_warning")[0]?.payload).toMatchObject({ rate_limit_type: "seven_day", resets_at: SEVEN_DAY_RESET, utilization: 0.8 });
    expect(capRows()[0]).toMatchObject({ status: "allowed_warning", warned_resets_at: SEVEN_DAY_RESET });
    expect(events(env.store, "notify")).toEqual([]);
    expect(wakeups()).toEqual([]);

    // Another account warns separately; a new window warns again.
    const other = insertSession(env.store, { account: "second@example.test" });
    tracker.observe(other, warning);
    tracker.observe(id, rateLimitEvent({ status: "allowed_warning", rateLimitType: "seven_day", resetsAt: 1791820800 }));
    expect(events(env.store, "cap_warning")).toHaveLength(3);
  });
});

describe("transient rate_limit (AC4)", () => {
  it("records a cap_transient event with a growing backoff hint and no park", () => {
    const id = insertSession(env.store);
    tracker.observe(id, assistantError("rate_limit"));
    tracker.observe(id, assistantError("rate_limit", "Rate limited, try again shortly"));
    expect(events(env.store, "cap_transient").map((e) => e.payload)).toEqual([
      { account: AUTH.account, error: "rate_limit", attempt: 1, backoffMs: 1_000 },
      { account: AUTH.account, error: "rate_limit", attempt: 2, backoffMs: 2_000 },
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
    expect(wakeups()).toEqual([{ due_at: recheck, reason: `cap_recheck:${AUTH.account}`, status: "pending" }]);
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
    tracker.observe(id, errorResult([CAP_TEXT]));
    env.clock.at = new Date(env.clock.at.getTime() + CAP_RECHECK_MS + 1);
    const second = inAnHour();
    tracker.observe(id, errorResult([CAP_TEXT]));
    expect(capRows()[0]).toMatchObject({ resets_at: second });
    expect(events(env.store, "notify")).toHaveLength(2);
    expect(wakeups().map((w) => w.due_at)).toHaveLength(2);
  });

  it("a session row with a null auth_account falls back to the auth provider's account", () => {
    const id = insertSession(env.store, { account: null });
    tracker.observe(id, errorResult([CAP_TEXT]));
    tracker.observe(id, fixture("p6-rate-limit-warning.json"));
    expect(capRows().map((r) => r.account)).toEqual([AUTH.account, AUTH.account]);
    expect(wakeups()[0]?.reason).toBe(`cap_recheck:${AUTH.account}`);
  });
});
