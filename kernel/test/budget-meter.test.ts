// Unit tests for the budget meter (item 06, AC1, AC2, AC9). Recorded and
// synthetic `result` messages only; never the real SDK or a model.
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BudgetMeter, DEFAULT_BUDGET_CONFIG, validateBudgetConfig } from "../src/budget/index.js";
import type { BudgetConfig } from "../src/budget/index.js";
import { AUTH, events, fixture, insertSession, result, testEnv } from "./budget-helpers.js";
import type { TestEnv } from "./budget-helpers.js";

let env: TestEnv;

beforeEach(() => {
  env = testEnv();
});

afterEach(() => env.cleanup());

interface BudgetRow {
  day: string;
  session_id: number;
  agent: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  thinking_tokens: number;
  counted_tokens: number;
  cost_usd: number;
}

function budgetRows(): BudgetRow[] {
  return env.store
    .prepare<[], BudgetRow>(
      `SELECT day, session_id, agent, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens,
              thinking_tokens, counted_tokens, cost_usd FROM budget ORDER BY id`,
    )
    .all();
}

function storedTotals(id: number): Record<string, Record<string, number>> {
  const json = env.store.prepare<[number], string | null>("SELECT model_usage_json FROM sessions WHERE id = ?").pluck().get(id);
  return json === null || json === undefined ? {} : JSON.parse(json);
}

function meter(config: BudgetConfig = DEFAULT_BUDGET_CONFIG): BudgetMeter {
  return new BudgetMeter({ store: env.store, authProvider: AUTH, config }, env.deps);
}

describe("BudgetMeter: recording result.modelUsage (AC1)", () => {
  it("replays the recorded p3 result: every token kind and costUSD per model, cache reads not counted", () => {
    const id = insertSession(env.store);
    meter().observe(id, fixture("p3-result.json"));
    expect(budgetRows()).toEqual([
      {
        day: "2026-10-02",
        session_id: id,
        agent: "wright",
        model: "claude-haiku-4-5",
        input_tokens: 955,
        output_tokens: 281,
        cache_write_tokens: 7_788,
        cache_read_tokens: 48_986,
        thinking_tokens: 0,
        counted_tokens: 955 + 281 + 7_788,
        cost_usd: 0.0229,
      },
    ]);
    expect(storedTotals(id)["claude-haiku-4-5"]).toMatchObject({ inputTokens: 955, cacheReadInputTokens: 48_986 });
  });

  it("ignores every message that is not a result, including per-message usage", () => {
    const id = insertSession(env.store);
    const m = meter();
    m.observe(id, { type: "assistant", message: { usage: { input_tokens: 5, output_tokens: 4 } } } as never);
    m.observe(id, fixture("p6-rate-limit-event.json"));
    expect(budgetRows()).toEqual([]);
    expect(events(env.store)).toEqual([]);
  });

  it("records only the delta of a cumulative total, across a second result and a resume", () => {
    const id = insertSession(env.store);
    const m = meter();
    m.observe(id, result({ haiku: { input: 100, output: 10, cacheWrite: 1_000, cacheRead: 5_000, cost: 0.01 } }));
    m.observe(id, result({ haiku: { input: 150, output: 30, cacheWrite: 1_200, cacheRead: 9_000, cost: 0.015 } }));
    // The resume reports the session's running total, including the earlier turns (p7).
    m.observe(id, result({ haiku: { input: 160, output: 40, cacheWrite: 1_300, cacheRead: 9_500, cost: 0.02 } }));
    const rows = budgetRows();
    expect(rows.map((r) => [r.input_tokens, r.output_tokens, r.cache_write_tokens, r.cache_read_tokens])).toEqual([
      [100, 10, 1_000, 5_000],
      [50, 20, 200, 4_000],
      [10, 10, 100, 500],
    ]);
    expect(rows.reduce((s, r) => s + r.counted_tokens, 0)).toBe(160 + 40 + 1_300);
    expect(rows.reduce((s, r) => s + r.cost_usd, 0)).toBeCloseTo(0.02, 10);
    expect(storedTotals(id).haiku).toMatchObject({ inputTokens: 160, outputTokens: 40 });
    expect(events(env.store, "budget_baseline_reset")).toEqual([]);
  });

  it("writes no row for an unchanged total", () => {
    const id = insertSession(env.store);
    const m = meter();
    m.observe(id, result({ haiku: { input: 100, output: 10 } }));
    m.observe(id, result({ haiku: { input: 100, output: 10 } }));
    expect(budgetRows()).toHaveLength(1);
  });

  it("treats a lower total as a fresh baseline: added in full, with one event", () => {
    const id = insertSession(env.store);
    const m = meter();
    m.observe(id, result({ haiku: { input: 500, output: 50, cacheWrite: 2_000 } }));
    m.observe(id, result({ haiku: { input: 20, output: 5, cacheWrite: 100 } }));
    expect(budgetRows().map((r) => r.counted_tokens)).toEqual([2_550, 125]);
    const resets = events(env.store, "budget_baseline_reset");
    expect(resets).toHaveLength(1);
    expect(resets[0]).toMatchObject({ session_id: id, payload: { model: "haiku", previous: { inputTokens: 500 }, current: { inputTokens: 20 } } });
    expect(storedTotals(id).haiku).toMatchObject({ inputTokens: 20 });
  });

  it("ignores an empty or all-zero modelUsage (a crash result) without resetting the baseline", () => {
    const id = insertSession(env.store);
    const m = meter();
    m.observe(id, result({ haiku: { input: 100, output: 10 } }));
    m.observe(id, result({ haiku: {} }, { subtype: "error_during_execution", is_error: true, errors: [] }));
    m.observe(id, result({}));
    m.observe(id, result({ haiku: { input: 120, output: 12 } }));
    expect(budgetRows().map((r) => [r.input_tokens, r.output_tokens])).toEqual([
      [100, 10],
      [20, 2],
    ]);
    expect(events(env.store, "budget_usage_ignored").map((e) => e.payload.reason)).toEqual([
      "zeroed_model_usage",
      "empty_model_usage",
    ]);
    expect(events(env.store, "budget_baseline_reset")).toEqual([]);
  });

  it("keeps a missing model's stored total and meters several models per result", () => {
    const id = insertSession(env.store);
    const m = meter();
    m.observe(id, result({ opus: { input: 10, output: 5 }, haiku: { input: 900, output: 1, cost: 0.001 } }));
    m.observe(id, result({ opus: { input: 30, output: 15 } }));
    m.observe(id, result({ opus: { input: 30, output: 15 }, haiku: { input: 950, output: 3, cost: 0.002 } }));
    expect(budgetRows().map((r) => [r.model, r.input_tokens, r.output_tokens])).toEqual([
      ["opus", 10, 5],
      ["haiku", 900, 1],
      ["opus", 20, 10],
      ["haiku", 50, 2],
    ]);
    expect(Object.keys(storedTotals(id)).sort()).toEqual(["haiku", "opus"]);
    expect(events(env.store, "budget_baseline_reset")).toEqual([]);
  });

  it("records thinking tokens in their own column, never in counted_tokens (already inside output)", () => {
    const id = insertSession(env.store);
    meter().observe(id, result({ haiku: { input: 10, output: 300, thinking: 200 } }));
    expect(budgetRows()[0]).toMatchObject({ output_tokens: 300, thinking_tokens: 200, counted_tokens: 310 });
  });

  it("attributes each delta to the day its result arrived, across midnight (injected clock)", () => {
    const id = insertSession(env.store);
    const m = meter();
    env.clock.at = new Date("2026-10-02T23:59:00.000Z");
    m.observe(id, result({ haiku: { input: 100 } }));
    env.clock.at = new Date("2026-10-03T00:01:00.000Z");
    m.observe(id, result({ haiku: { input: 130 } }));
    expect(budgetRows().map((r) => [r.day, r.input_tokens])).toEqual([
      ["2026-10-02", 100],
      ["2026-10-03", 30],
    ]);
  });

  it("an unknown session writes nothing but an event; an unreadable stored total is a recorded fresh baseline", () => {
    meter().observe(999, result({ haiku: { input: 1 } }));
    expect(budgetRows()).toEqual([]);
    expect(events(env.store, "budget_usage_ignored")[0]?.payload).toMatchObject({ reason: "unknown_session" });

    const id = insertSession(env.store);
    env.store.prepare("UPDATE sessions SET model_usage_json = '{not json' WHERE id = ?").run(id);
    meter().observe(id, result({ haiku: { input: 40 } }));
    expect(budgetRows().map((r) => r.input_tokens)).toEqual([40]);
    expect(events(env.store, "budget_baseline_reset")[0]?.payload).toEqual({ reason: "stored_totals_unreadable" });
  });

  it("meters a session with no agent without a limit check", () => {
    const id = insertSession(env.store, { agent: null });
    meter({ ...DEFAULT_BUDGET_CONFIG, agentDailyTokenLimits: { wright: 1 } }).observe(id, result({ haiku: { input: 10 } }));
    expect(budgetRows()[0]?.agent).toBeNull();
    expect(events(env.store, "notify")).toEqual([]);
  });
});

describe("BudgetMeter: agent daily limit (AC2)", () => {
  const limited: BudgetConfig = { ...DEFAULT_BUDGET_CONFIG, agentDailyTokenLimits: { wright: 1_000 } };

  it("emits budget_limit_reached and one notify when the day's counted total reaches the limit, once per agent-day", () => {
    const a = insertSession(env.store);
    const b = insertSession(env.store);
    const m = meter(limited);
    m.observe(a, result({ haiku: { input: 400, cacheRead: 100_000 } }));
    expect(events(env.store, "notify")).toEqual([]);
    m.observe(b, result({ haiku: { input: 300, output: 300 } }));
    expect(events(env.store, "notify")).toHaveLength(1);
    // Crossing again the same day (another session): no second notify.
    m.observe(a, result({ haiku: { input: 900, cacheRead: 100_000 } }));
    const notify = events(env.store, "notify");
    expect(notify).toHaveLength(1);
    expect(notify[0]?.payload).toEqual({
      provider: AUTH.id,
      account: AUTH.account,
      reason: "agent_daily_limit",
      agent: "wright",
      day: "2026-10-02",
      counted_tokens: 1_000,
      limit: 1_000,
      retry_at: "2026-10-03T00:00:00.000Z",
    });
    expect(events(env.store, "budget_limit_reached")).toHaveLength(1);
    // The running session is not touched.
    expect(env.store.prepare("SELECT status FROM sessions WHERE id = ?").pluck().get(a)).toBe("running");

    // The next day starts a new agent-day.
    env.clock.at = new Date("2026-10-03T09:00:00.000Z");
    m.observe(b, result({ haiku: { input: 1_600, output: 300 } }));
    expect(events(env.store, "notify")).toHaveLength(2);
  });

  it("an agent with no configured limit is never limited (the kernel invents none)", () => {
    const id = insertSession(env.store, { agent: "scout" });
    meter(limited).observe(id, result({ haiku: { input: 10_000_000 } }));
    expect(events(env.store, "budget_limit_reached")).toEqual([]);
    expect(events(env.store, "notify")).toEqual([]);
  });

  it("an agent named like an Object.prototype member has no limit unless one is configured for it", () => {
    for (const agent of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      const id = insertSession(env.store, { agent });
      meter(limited).observe(id, result({ haiku: { input: 10_000_000 } }));
    }
    expect(events(env.store, "budget_limit_reached")).toEqual([]);
    expect(events(env.store, "notify")).toEqual([]);

    // Configured as its own key, it is limited like any other agent.
    const own = validateBudgetConfig({ ...DEFAULT_BUDGET_CONFIG, agentDailyTokenLimits: JSON.parse('{"constructor": 5, "__proto__": 5}') });
    const id = insertSession(env.store, { agent: "__proto__" });
    meter(own).observe(id, result({ haiku: { input: 10 } }));
    expect(events(env.store, "budget_limit_reached").map((e) => e.payload.agent)).toEqual(["__proto__"]);
  });

  it("a model named like an Object.prototype member is metered as an ordinary model", () => {
    const id = insertSession(env.store, { agent: null });
    const m = meter();
    // JSON.parse, as the stream is parsed: `__proto__` is an own key, not the prototype.
    const usage = (a: number, b: number): SDKMessage =>
      ({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "ok",
        modelUsage: JSON.parse(`{"constructor": {"inputTokens": ${a}}, "__proto__": {"inputTokens": ${b}}}`),
      }) as unknown as SDKMessage;
    m.observe(id, usage(10, 20));
    m.observe(id, usage(15, 25));
    expect(events(env.store, "budget_baseline_reset")).toEqual([]);
    expect(budgetRows().map((r) => [r.model, r.input_tokens])).toEqual([
      ["constructor", 10],
      ["__proto__", 20],
      ["constructor", 5],
      ["__proto__", 5],
    ]);
    expect(Object.keys(storedTotals(id))).toEqual(["constructor", "__proto__"]);
  });
});
