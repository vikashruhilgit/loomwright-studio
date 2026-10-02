import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Store } from "../store/store.js";
import { agentCountedTokens, appendEvent, clockOf, finiteNonNegative, noteAgentLimitReached } from "./internal.js";
import type { Clock, EventRef } from "./internal.js";
import { DEFAULT_BUDGET_CONFIG, agentDailyTokenLimit, validateBudgetConfig } from "./types.js";
import type { BudgetAuth, BudgetConfig, BudgetDeps, BudgetOptions, UsageTotals } from "./types.js";

/** The token components compared to tell a running total from a fresh baseline. */
const MONOTONIC_KEYS = ["inputTokens", "outputTokens", "cacheCreationInputTokens", "cacheReadInputTokens"] as const;

const ZERO: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  thinkingTokens: 0,
  costUSD: 0,
};

type Totals = Record<string, UsageTotals>;

/** Normalise one `ModelUsage` (or a stored total): unknown or bad numbers read as 0, tokens as integers. */
function readTotals(value: unknown): UsageTotals {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const tokens = (key: string): number => Math.trunc(finiteNonNegative(v[key]));
  return {
    inputTokens: tokens("inputTokens"),
    outputTokens: tokens("outputTokens"),
    cacheCreationInputTokens: tokens("cacheCreationInputTokens"),
    cacheReadInputTokens: tokens("cacheReadInputTokens"),
    thinkingTokens: tokens("thinkingTokens"),
    costUSD: finiteNonNegative(v.costUSD),
  };
}

/**
 * A null-prototype totals map: model names come from the stream, so a model
 * named `constructor` or `__proto__` is an ordinary own key, never an
 * inherited member read back as a stored total (or a prototype written).
 */
function emptyTotals(): Totals {
  return Object.create(null) as Totals;
}

function readTotalsMap(value: unknown): Totals {
  const out = emptyTotals();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  for (const [model, usage] of Object.entries(value)) out[model] = readTotals(usage);
  return out;
}

function isZero(t: UsageTotals): boolean {
  return (
    t.inputTokens === 0 &&
    t.outputTokens === 0 &&
    t.cacheCreationInputTokens === 0 &&
    t.cacheReadInputTokens === 0 &&
    t.thinkingTokens === 0 &&
    t.costUSD === 0
  );
}

function minus(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    inputTokens: a.inputTokens - b.inputTokens,
    outputTokens: a.outputTokens - b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens - b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens - b.cacheReadInputTokens,
    // Not compared for the baseline: `thinkingTokens` can be absent on a
    // resumed session that began on an older CLI (sdk.d.ts), and the cost is
    // a float estimate. Neither may go negative.
    thinkingTokens: Math.max(0, a.thinkingTokens - b.thinkingTokens),
    costUSD: Math.max(0, a.costUSD - b.costUSD),
  };
}

interface SessionUsageRow {
  readonly agent: string | null;
  readonly task_id: number | null;
  readonly model_usage_json: string | null;
}

/**
 * Meters every session's token use from `result.modelUsage` (D24, D26, Q3).
 *
 * `modelUsage` is per model and cumulative for the SDK session, across
 * resumes (OPEN_QUESTIONS Q3/p7), so each result carries the running total.
 * The meter keeps the last totals per session in `sessions.model_usage_json`
 * and writes only the delta to `budget`, attributed to the budget day the
 * result arrived on. Per-message usage is never read (it under-reports).
 *
 * - A model whose new total is lower than the stored one in any token
 *   component is a fresh baseline (for example a mid-session `/clear`): the
 *   new total is added in full and a `budget_baseline_reset` event recorded.
 * - A result whose `modelUsage` is empty or all zero is ignored with a
 *   `budget_usage_ignored` event. `@anthropic-ai/claude-agent-sdk` 0.3.284
 *   `sdk.d.ts` (the `modelUsage` and `total_cost_usd` docs on `SDKResultSuccess`
 *   / `SDKResultError`) says crash/startup-error results may carry zeroed
 *   values; that is not probed live yet, and ignoring a zeroed result is the
 *   safe choice either way: taking 0 as the baseline would count the next real
 *   total twice.
 * - A model missing from a new result keeps its stored total.
 *
 * Limit of the design (`kill -9`): tokens spent after the last `result` the
 * kernel recorded (a kernel killed mid-stream, or before this transaction
 * committed) are not in `budget` yet. A resume of the same SDK session
 * reports them inside its first result's cumulative total, so the delta
 * catches up then (p7); a session that is never resumed loses them.
 *
 * After recording, when the session's agent has a configured daily limit and
 * its counted tokens for the day reach it, one `budget_limit_reached` event
 * and one `notify` are appended, once per agent-day. The running session is
 * not touched: it finishes its current turn, and admission refuses the
 * agent's next start (AC2).
 */
export class BudgetMeter {
  readonly #store: Store;
  readonly #auth: BudgetAuth;
  readonly #config: BudgetConfig;
  readonly #clock: Clock;

  constructor(options: BudgetOptions, deps: BudgetDeps = {}) {
    this.#store = options.store;
    this.#auth = options.authProvider;
    this.#config = validateBudgetConfig(options.config ?? DEFAULT_BUDGET_CONFIG);
    this.#clock = clockOf(deps);
  }

  /** Record a `result` message's usage for session `sessionId`. Every other message is ignored. */
  observe(sessionId: number, message: SDKMessage): void {
    if (message.type !== "result") return;
    const now = this.#clock.now();
    const at = now.toISOString();
    const day = this.#clock.dayOf(now);
    const raw = (message as { modelUsage?: unknown }).modelUsage;

    this.#store.transaction(() => {
      const row = this.#store
        .prepare<[number], SessionUsageRow>("SELECT agent, task_id, model_usage_json FROM sessions WHERE id = ?")
        .get(sessionId);
      const ref: EventRef = { sessionId, taskId: row?.task_id ?? null };
      if (row === undefined) {
        appendEvent(this.#store, "budget_usage_ignored", ref, { reason: "unknown_session", subtype: message.subtype }, at);
        return;
      }

      const incoming = readTotalsMap(raw);
      const models = Object.keys(incoming);
      if (models.length === 0 || models.every((m) => isZero(incoming[m] ?? ZERO))) {
        appendEvent(
          this.#store,
          "budget_usage_ignored",
          ref,
          { reason: models.length === 0 ? "empty_model_usage" : "zeroed_model_usage", subtype: message.subtype },
          at,
        );
        return;
      }

      const stored = this.#readStored(row.model_usage_json, ref, at);
      const merged: Totals = Object.assign(emptyTotals(), stored);
      const insert = this.#store.prepare(
        `INSERT INTO budget (day, session_id, agent, model, input_tokens, output_tokens, cache_write_tokens,
                             cache_read_tokens, thinking_tokens, cost_usd, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const model of models) {
        const next = incoming[model] ?? ZERO;
        // A zeroed entry beside real ones carries no information: keep the stored total.
        if (isZero(next)) continue;
        const prev = stored[model];
        let delta: UsageTotals;
        if (prev === undefined) delta = next;
        else if (MONOTONIC_KEYS.every((k) => next[k] >= prev[k])) delta = minus(next, prev);
        else {
          delta = next;
          appendEvent(this.#store, "budget_baseline_reset", ref, { model, previous: prev, current: next }, at);
        }
        merged[model] = next;
        if (isZero(delta)) continue;
        insert.run(
          day,
          sessionId,
          row.agent,
          model,
          delta.inputTokens,
          delta.outputTokens,
          delta.cacheCreationInputTokens,
          delta.cacheReadInputTokens,
          delta.thinkingTokens,
          delta.costUSD,
          at,
        );
      }
      this.#store
        .prepare("UPDATE sessions SET model_usage_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(merged), at, sessionId);

      if (row.agent !== null) this.#checkLimit(row.agent, day, now, ref, at);
    });
  }

  /** The stored totals; an unreadable value is a fresh baseline, recorded as such. */
  #readStored(json: string | null, ref: EventRef, at: string): Totals {
    if (json === null) return emptyTotals();
    try {
      return readTotalsMap(JSON.parse(json));
    } catch {
      appendEvent(this.#store, "budget_baseline_reset", ref, { reason: "stored_totals_unreadable" }, at);
      return emptyTotals();
    }
  }

  #checkLimit(agent: string, day: string, now: Date, ref: EventRef, at: string): void {
    const limit = agentDailyTokenLimit(this.#config, agent);
    if (limit === undefined) return;
    const counted = agentCountedTokens(this.#store, agent, day);
    if (counted < limit) return;
    noteAgentLimitReached(
      this.#store,
      this.#auth,
      { agent, day, countedTokens: counted, limit, retryAt: this.#clock.startOfNextDay(now).toISOString(), ref },
      at,
    );
  }
}
