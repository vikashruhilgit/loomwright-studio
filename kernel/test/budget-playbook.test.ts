// Unit tests for per-playbook metering, the playbook gate and its D28 API-key
// fallback decision, and the per-playbook usage read (phase 3, AC1-AC5).
// Stubbed provider identities only: never a real key, the Keychain or the SDK.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Budget,
  BudgetConfigError,
  DEFAULT_BUDGET_CONFIG,
  parseApiKeyFallbackPolicy,
  playbookTokensToday,
} from "../src/budget/index.js";
import type { BudgetAuth, BudgetConfig, PlaybookAdmissionRequest } from "../src/budget/index.js";
import type { Store } from "../src/store/index.js";
import { AUTH, events, insertSession, result, testEnv } from "./budget-helpers.js";
import type { TestEnv } from "./budget-helpers.js";

const START = "2026-10-02T10:00:00.000Z";
const DAY = "2026-10-02";
const NEXT_DAY = "2026-10-03T00:00:00.000Z";
const RESET = "2026-10-02T15:00:00.000Z";
const API_KEY: BudgetAuth = { id: "api-key", account: "api-key" };
const OPTED_IN = '{"enabled":true,"dollarCeilingUsd":5}';

let env: TestEnv;

beforeEach(() => {
  env = testEnv(START);
});

afterEach(() => env.cleanup());

function budget(
  options: { config?: BudgetConfig; apiKeyProvider?: BudgetAuth | null } = {},
  store: Store = env.store,
): Budget {
  const apiKeyProvider = options.apiKeyProvider === undefined ? API_KEY : options.apiKeyProvider;
  return new Budget(
    {
      store,
      authProvider: AUTH,
      ...(apiKeyProvider === null ? {} : { apiKeyProvider }),
      ...(options.config === undefined ? {} : { config: options.config }),
    },
    env.deps,
  );
}

function insertPlaybook(
  fields: { slug?: string; limit?: number | null; fallback?: string | null } = {},
  store: Store = env.store,
): number {
  return Number(
    store
      .prepare(
        `INSERT INTO playbooks (slug, name, owning_agent, intent, token_limit_per_day, api_key_fallback_json)
         VALUES (?, ?, 'wright', 'test intent', ?, ?)`,
      )
      .run(fields.slug ?? "pr-review", fields.slug ?? "PR review", fields.limit ?? null, fields.fallback ?? null).lastInsertRowid,
  );
}

function playbookSession(playbook: number, agent = "wright"): number {
  const id = insertSession(env.store, { agent });
  env.store.prepare("UPDATE sessions SET playbook = ? WHERE id = ?").run(playbook, id);
  return id;
}

/** A metered `budget` row: counted tokens on `day` (input only) and a cost estimate. */
function spend(
  fields: { playbook?: number | null; agent?: string; counted?: number; costUsd?: number; day?: string },
  store: Store = env.store,
): void {
  store
    .prepare("INSERT INTO budget (day, agent, playbook, model, input_tokens, cost_usd) VALUES (?, ?, ?, 'haiku', ?, ?)")
    .run(
      fields.day ?? DAY,
      fields.agent ?? "wright",
      fields.playbook === undefined || fields.playbook === null ? null : String(fields.playbook),
      fields.counted ?? 0,
      fields.costUsd ?? 0,
    );
}

/** Park the subscription provider at its cap until `resetsAt` (`null`: unknown reset). */
function park(resetsAt: string | null = RESET, store: Store = env.store): void {
  store
    .prepare("INSERT INTO cap_state (account, rate_limit_type, status, resets_at, reset_source) VALUES (?, 'five_hour', 'rejected', ?, 'event')")
    .run(AUTH.id, resetsAt);
}

function request(overrides: Partial<PlaybookAdmissionRequest> = {}): PlaybookAdmissionRequest {
  return { kind: "start", agent: "wright", account: AUTH.account, provider: AUTH.id, task: null, playbook: null, ...overrides };
}

describe("per-playbook metering (AC1)", () => {
  it("writes the session's playbook on its budget row; the playbook's counted total excludes cache reads", () => {
    const pb = insertPlaybook();
    const id = playbookSession(pb);
    budget().observe(id, result({ haiku: { input: 1_000, output: 200, cacheWrite: 300, cacheRead: 5_000 } }));

    const rows = env.store
      .prepare<[], { playbook: string | null; agent: string; counted_tokens: number }>(
        "SELECT playbook, agent, counted_tokens FROM budget",
      )
      .all();
    expect(rows).toEqual([{ playbook: String(pb), agent: "wright", counted_tokens: 1_500 }]);
    expect(playbookTokensToday(env.store, DAY)).toEqual([
      { playbook: pb, slug: "pr-review", countedTokens: 1_500, tokenLimitPerDay: null },
    ]);
  });

  it("a session without a playbook writes NULL, and is in no playbook's total", () => {
    const id = insertSession(env.store);
    budget().observe(id, result({ haiku: { input: 10 } }));
    expect(env.store.prepare("SELECT playbook FROM budget").pluck().all()).toEqual([null]);
    expect(playbookTokensToday(env.store, DAY)).toEqual([]);
  });

  it("the meter notes the playbook's limit once per playbook-day, and the gate adds no second notify", () => {
    const pb = insertPlaybook({ limit: 100 });
    const id = playbookSession(pb);
    const b = budget();
    b.observe(id, result({ haiku: { input: 60 } }));
    expect(events(env.store, "playbook_limit_reached")).toEqual([]);
    b.observe(id, result({ haiku: { input: 120 } }));
    b.observe(id, result({ haiku: { input: 200 } }));
    expect(events(env.store, "playbook_limit_reached")).toHaveLength(1);
    expect(events(env.store, "playbook_limit_reached")[0]).toMatchObject({
      session_id: id,
      payload: { playbook: pb, slug: "pr-review", day: DAY, counted_tokens: 120, limit: 100, retry_at: NEXT_DAY },
    });
    expect(events(env.store, "notify")).toHaveLength(1);
    expect(events(env.store, "notify")[0]?.payload).toMatchObject({ provider: AUTH.id, account: AUTH.account, reason: "playbook_daily_limit" });

    expect(b.checkPlaybook(request({ playbook: pb }))).toMatchObject({ admitted: false, reason: "playbook_daily_limit" });
    expect(events(env.store, "notify")).toHaveLength(1);
  });

  it("skips a playbook row that no longer exists, writing only the budget rows", () => {
    env.store.prepare("PRAGMA foreign_keys = OFF").run();
    const id = playbookSession(4242);
    budget().observe(id, result({ haiku: { input: 10_000, cost: 99 } }));
    expect(env.store.prepare("SELECT playbook FROM budget").pluck().all()).toEqual(["4242"]);
    expect(events(env.store)).toEqual([]);
  });

  it("skips a damaged stored limit without throwing, and still checks the ceiling", () => {
    const pb = insertPlaybook({ fallback: OPTED_IN });
    env.store.prepare("UPDATE playbooks SET token_limit_per_day = 'lots' WHERE id = ?").run(pb);
    const id = playbookSession(pb);
    budget().observe(id, result({ haiku: { input: 10_000, cost: 5 } }));
    expect(events(env.store, "playbook_limit_reached")).toEqual([]);
    expect(events(env.store, "api_key_ceiling_reached")).toHaveLength(1);
    expect(playbookTokensToday(env.store, DAY)).toEqual([
      { playbook: pb, slug: "pr-review", countedTokens: 10_000, tokenLimitPerDay: null },
    ]);
  });
});

describe("per-playbook metering: the API-key ceiling crossing (D28)", () => {
  it("records api_key_ceiling_reached and one notify once per playbook when its spend reaches the ceiling", () => {
    const pb = insertPlaybook({ fallback: OPTED_IN });
    const id = playbookSession(pb);
    const b = budget();
    b.observe(id, result({ haiku: { input: 10, cost: 4 } }));
    expect(events(env.store, "api_key_ceiling_reached")).toEqual([]);
    b.observe(id, result({ haiku: { input: 20, cost: 6 } }));
    b.observe(id, result({ haiku: { input: 30, cost: 7 } }));
    expect(events(env.store, "api_key_ceiling_reached")).toHaveLength(1);
    expect(events(env.store, "api_key_ceiling_reached")[0]).toMatchObject({
      session_id: id,
      payload: { playbook: pb, slug: "pr-review", spend_usd: 6, ceiling_usd: 5 },
    });
    expect(events(env.store, "notify").map((e) => e.payload)).toEqual([
      expect.objectContaining({ provider: AUTH.id, reason: "api_key_ceiling_reached", playbook: pb, ceiling_usd: 5 }),
    ]);

    // The gate finds the same crossing at the cap: refused, no second record or notify.
    park();
    expect(b.checkPlaybook(request({ playbook: pb }))).toMatchObject({ admitted: false, reason: "cap_parked" });
    expect(events(env.store, "api_key_ceiling_reached")).toHaveLength(1);
    expect(events(env.store, "notify")).toHaveLength(1);

    // A raised ceiling is a new one: reaching it is recorded once more.
    env.store.prepare("UPDATE playbooks SET api_key_fallback_json = ? WHERE id = ?").run('{"enabled":true,"dollarCeilingUsd":8}', pb);
    b.observe(id, result({ haiku: { input: 40, cost: 8 } }));
    b.observe(id, result({ haiku: { input: 50, cost: 9 } }));
    expect(events(env.store, "api_key_ceiling_reached").map((e) => e.payload.ceiling_usd)).toEqual([5, 8]);
    expect(events(env.store, "notify")).toHaveLength(2);
  });

  it("records nothing for a playbook that does not opt in, whatever it spends", () => {
    const pb = insertPlaybook({ fallback: '{"enabled":false,"dollarCeilingUsd":5}' });
    budget().observe(playbookSession(pb), result({ haiku: { input: 10, cost: 500 } }));
    expect(events(env.store, "api_key_ceiling_reached")).toEqual([]);
    expect(events(env.store, "notify")).toEqual([]);
  });

  it("the gate records the crossing first when it finds the ceiling reached", () => {
    park();
    const pb = insertPlaybook({ fallback: OPTED_IN });
    spend({ playbook: pb, costUsd: 5 });
    const b = budget();
    b.checkPlaybook(request({ playbook: pb }));
    b.checkPlaybook(request({ playbook: pb }));
    expect(events(env.store, "api_key_ceiling_reached")).toHaveLength(1);
    expect(events(env.store, "api_key_ceiling_reached")[0]?.payload).toMatchObject({ playbook: pb, spend_usd: 5, ceiling_usd: 5 });
    expect(events(env.store, "notify")).toHaveLength(1);
    expect(events(env.store, "admission_refused")).toHaveLength(2);
  });
});

describe("playbook gate: daily token limit (AC2)", () => {
  it("refuses a start at counted == limit until the next budget day, notifying once per playbook-day", () => {
    const pb = insertPlaybook({ limit: 1_500 });
    const b = budget();
    spend({ playbook: pb, counted: 1_499 });
    expect(b.checkPlaybook(request({ playbook: pb }))).toEqual({ admitted: true, provider: AUTH.id });
    spend({ playbook: pb, counted: 1 });

    const refused = { admitted: false, reason: "playbook_daily_limit", retryAt: NEXT_DAY };
    expect(b.checkPlaybook(request({ playbook: pb, task: 7 }))).toEqual(refused);
    expect(events(env.store, "admission_refused")).toHaveLength(1);
    expect(events(env.store, "admission_refused")[0]).toMatchObject({
      task_id: 7,
      payload: {
        kind: "start",
        agent: "wright",
        account: AUTH.account,
        provider: AUTH.id,
        task: 7,
        playbook: pb,
        reason: "playbook_daily_limit",
        retry_at: NEXT_DAY,
        day: DAY,
        counted_tokens: 1_500,
        limit: 1_500,
      },
    });
    expect(events(env.store, "playbook_limit_reached")).toHaveLength(1);
    expect(events(env.store, "notify")).toHaveLength(1);

    // The same day: still refused, its own admission_refused, no second limit event or notify.
    expect(b.checkPlaybook(request({ playbook: pb }))).toEqual(refused);
    expect(events(env.store, "admission_refused")).toHaveLength(2);
    expect(events(env.store, "playbook_limit_reached")).toHaveLength(1);
    expect(events(env.store, "notify")).toHaveLength(1);
  });

  it("admits a resume past the limit, admits again the next day, and never limits a playbook with no limit", () => {
    const limited = insertPlaybook({ slug: "limited", limit: 10 });
    const open = insertPlaybook({ slug: "open" });
    spend({ playbook: limited, counted: 50 });
    spend({ playbook: open, counted: 10_000_000 });
    const b = budget();
    expect(b.checkPlaybook(request({ playbook: limited, kind: "resume" }))).toEqual({ admitted: true, provider: AUTH.id });
    expect(b.checkPlaybook(request({ playbook: open }))).toEqual({ admitted: true, provider: AUTH.id });
    env.clock.at = new Date(NEXT_DAY);
    expect(b.checkPlaybook(request({ playbook: limited }))).toEqual({ admitted: true, provider: AUTH.id });
  });

  it("fails closed on an unknown playbook or a damaged stored limit, writing nothing", () => {
    const b = budget();
    expect(() => b.checkPlaybook(request({ playbook: 999 }))).toThrow(/unknown playbook 999/);
    const damaged = insertPlaybook({ slug: "damaged" });
    env.store.prepare("UPDATE playbooks SET token_limit_per_day = 0 WHERE id = ?").run(damaged);
    expect(() => b.checkPlaybook(request({ playbook: damaged }))).toThrow(/damaged token_limit_per_day/);
    expect(() => b.checkPlaybook(request({ playbook: damaged, provider: "other" }))).toThrow(/fail closed/);
    expect(events(env.store)).toEqual([]);
  });
});

describe("playbook gate: API-key fallback at the cap (AC3)", () => {
  it("admits an opted-in playbook under its ceiling on the API-key provider", () => {
    park();
    const pb = insertPlaybook({ fallback: OPTED_IN });
    spend({ playbook: pb, costUsd: 4.99 });
    expect(budget().checkPlaybook(request({ playbook: pb, task: 3 }))).toEqual({ admitted: true, provider: API_KEY.id });
    expect(events(env.store, "admission_refused")).toEqual([]);
    const admitted = events(env.store, "api_key_fallback_admitted");
    expect(admitted).toHaveLength(1);
    expect(admitted[0]).toMatchObject({
      task_id: 3,
      payload: { playbook: pb, provider: API_KEY.id, kind: "start", agent: "wright", task: 3, spend_usd: 4.99, ceiling_usd: 5 },
    });
  });

  it("admits a resume of an opted-in playbook under its ceiling on the API-key provider", () => {
    park();
    const pb = insertPlaybook({ fallback: OPTED_IN });
    expect(budget().checkPlaybook(request({ playbook: pb, kind: "resume" }))).toEqual({ admitted: true, provider: API_KEY.id });
    expect(events(env.store, "api_key_fallback_admitted").map((e) => e.payload)).toEqual([
      expect.objectContaining({ kind: "resume", playbook: pb, provider: API_KEY.id, spend_usd: 0, ceiling_usd: 5 }),
    ]);
  });

  it("admits on the subscription provider when it is not parked, whatever the policy", () => {
    const pb = insertPlaybook({ fallback: OPTED_IN });
    expect(budget().checkPlaybook(request({ playbook: pb }))).toEqual({ admitted: true, provider: AUTH.id });
    expect(events(env.store)).toEqual([]);
  });

  it.each([
    ["no policy", null],
    ["enabled: false", '{"enabled":false,"dollarCeilingUsd":5}'],
    ["a null ceiling", '{"enabled":true,"dollarCeilingUsd":null}'],
    ["unparseable JSON", '{"enabled":true,'],
    ["a zero ceiling", '{"enabled":true,"dollarCeilingUsd":0}'],
    ["a string ceiling", '{"enabled":true,"dollarCeilingUsd":"5"}'],
    ["a missing ceiling", '{"enabled":true}'],
    ["a string enabled", '{"enabled":"true","dollarCeilingUsd":5}'],
    ["a JSON null", "null"],
  ])("waits for the reset (cap_parked) with %s", (_label, fallback) => {
    park();
    const pb = insertPlaybook({ fallback });
    expect(budget().checkPlaybook(request({ playbook: pb }))).toEqual({ admitted: false, reason: "cap_parked", retryAt: RESET });
    expect(events(env.store, "admission_refused").map((e) => e.payload)).toEqual([
      expect.objectContaining({ playbook: pb, reason: "cap_parked", retry_at: RESET, api_key_fallback: "not_opted_in" }),
    ]);
    expect(events(env.store, "api_key_fallback_admitted")).toEqual([]);
  });

  it("waits when the playbook's spend equals its ceiling", () => {
    park(null);
    const pb = insertPlaybook({ fallback: OPTED_IN });
    spend({ playbook: pb, costUsd: 2 });
    spend({ playbook: pb, costUsd: 3, day: "2026-09-01" });
    // Another playbook's and a playbook-less session's spend are not this playbook's.
    spend({ playbook: insertPlaybook({ slug: "other" }), costUsd: 100 });
    spend({ costUsd: 100 });
    expect(budget().checkPlaybook(request({ playbook: pb }))).toEqual({ admitted: false, reason: "cap_parked", retryAt: null });
    expect(events(env.store, "admission_refused")[0]?.payload).toMatchObject({ api_key_fallback: "ceiling_reached" });
  });

  it("waits when the Budget was given no API-key provider, or a resume when the playbook does not opt in", () => {
    park();
    const pb = insertPlaybook({ fallback: OPTED_IN });
    expect(budget({ apiKeyProvider: null }).checkPlaybook(request({ playbook: pb }))).toEqual({
      admitted: false,
      reason: "cap_parked",
      retryAt: RESET,
    });
    expect(events(env.store, "admission_refused")[0]?.payload).toMatchObject({ api_key_fallback: "no_api_key_provider" });
    const off = insertPlaybook({ slug: "off" });
    expect(budget().checkPlaybook(request({ playbook: off, kind: "resume" }))).toMatchObject({ admitted: false, reason: "cap_parked" });
  });

  it("refuses agent_daily_limit for an opted-in playbook under its ceiling when its agent is at its limit", () => {
    park();
    const pb = insertPlaybook({ fallback: OPTED_IN });
    spend({ agent: "wright", counted: 1_000 });
    const b = budget({ config: { ...DEFAULT_BUDGET_CONFIG, agentDailyTokenLimits: { wright: 1_000 } } });
    expect(b.checkPlaybook(request({ playbook: pb }))).toEqual({ admitted: false, reason: "agent_daily_limit", retryAt: NEXT_DAY });
    expect(events(env.store, "api_key_fallback_admitted")).toEqual([]);
    expect(events(env.store, "admission_refused")[0]?.payload).toMatchObject({ playbook: pb, reason: "agent_daily_limit" });
    expect(events(env.store, "budget_limit_reached")).toHaveLength(1);
  });

  it("refuses an API-key provider that shares the subscription provider's id", () => {
    expect(() => budget({ apiKeyProvider: { id: AUTH.id, account: "x" } })).toThrow(BudgetConfigError);
  });

  it("parses a stored policy with validateBudgetConfig's rules, failing toward off", () => {
    expect(parseApiKeyFallbackPolicy(OPTED_IN)).toEqual({ enabled: true, dollarCeilingUsd: 5 });
    expect(parseApiKeyFallbackPolicy(null)).toEqual({ enabled: false, dollarCeilingUsd: null });
    expect(parseApiKeyFallbackPolicy('{"enabled":true,"dollarCeilingUsd":-1}')).toEqual({ enabled: false, dollarCeilingUsd: null });
    expect(parseApiKeyFallbackPolicy("[]")).toEqual({ enabled: false, dollarCeilingUsd: null });
  });
});

describe("playbook gate: a request with no playbook is check() (AC4)", () => {
  const PLACEHOLDER_ON: BudgetConfig = {
    agentDailyTokenLimits: { wright: 1_000 },
    apiKeyFallback: { enabled: true, dollarCeilingUsd: 50 },
  };

  function rawEvents(store: Store): unknown[] {
    return store.prepare("SELECT at, kind, actor, task_id, session_id, payload_json FROM events ORDER BY id").all();
  }

  /**
   * Run the same scenario on two fresh stores: through `checkPlaybook` on one,
   * `check` on the other. Returns the gate store's events.
   */
  function twin(setup: (store: Store) => void, req: PlaybookAdmissionRequest): ReturnType<typeof events> {
    const gate = testEnv(START);
    const plainEnv = testEnv(START);
    try {
      setup(gate.store);
      setup(plainEnv.store);
      const { playbook: _none, ...plain } = req;
      const viaGate = budget({ config: PLACEHOLDER_ON }, gate.store).checkPlaybook(req);
      const viaCheck = budget({ config: PLACEHOLDER_ON }, plainEnv.store).check(plain);
      if (viaCheck.admitted) expect(viaGate).toEqual({ admitted: true, provider: AUTH.id });
      else expect(viaGate).toEqual(viaCheck);
      expect(rawEvents(gate.store)).toEqual(rawEvents(plainEnv.store));
      return events(gate.store);
    } finally {
      gate.cleanup();
      plainEnv.cleanup();
    }
  }

  it("matches check() at the cap with the placeholder active: refused cap_parked, never the API key", () => {
    const parked = twin((s) => park(RESET, s), request({ task: 4 }));
    expect(parked.map((e) => [e.kind, e.payload.reason])).toEqual([["admission_refused", "cap_parked"]]);
    twin((s) => park(null, s), request({ kind: "resume" }));
  });

  it("matches check() on the agent limit, and on an admit", () => {
    const limited = twin((s) => spend({ agent: "wright", counted: 1_000 }, s), request());
    expect(limited.map((e) => e.kind)).toEqual(["budget_limit_reached", "notify", "admission_refused"]);
    expect(twin(() => undefined, request())).toEqual([]);
    twin(() => undefined, request({ agent: null }));
    twin((s) => spend({ agent: "wright", counted: 1_000 }, s), request({ kind: "resume" }));
  });

  it("throws as check() does on a provider mismatch", () => {
    const req = request({ provider: "someone-else" });
    expect(() => budget().checkPlaybook(req)).toThrow(/fail closed/);
    expect(events(env.store)).toEqual([]);
  });
});

describe("playbookTokensToday (AC5)", () => {
  it("lists one entry per playbook with usage that day: id, slug, counted tokens and limit", () => {
    const review = insertPlaybook({ slug: "pr-review", limit: 50_000 });
    const triage = insertPlaybook({ slug: "triage" });
    insertPlaybook({ slug: "idle", limit: 10 });
    const b = budget();
    b.observe(playbookSession(review), result({ haiku: { input: 1_000, output: 200, cacheWrite: 300, cacheRead: 5_000 } }));
    b.observe(playbookSession(review, "scout"), result({ sonnet: { input: 100, cacheWrite: 1 } }));
    b.observe(playbookSession(triage), result({ haiku: { output: 7 } }));
    b.observe(insertSession(env.store), result({ haiku: { input: 999 } }));
    spend({ playbook: triage, counted: 5_000, day: "2026-10-01" });

    expect(playbookTokensToday(env.store, DAY)).toEqual([
      { playbook: review, slug: "pr-review", countedTokens: 1_601, tokenLimitPerDay: 50_000 },
      { playbook: triage, slug: "triage", countedTokens: 7, tokenLimitPerDay: null },
    ]);
    expect(playbookTokensToday(env.store, "2026-10-01")).toEqual([
      { playbook: triage, slug: "triage", countedTokens: 5_000, tokenLimitPerDay: null },
    ]);
    expect(playbookTokensToday(env.store, "2026-09-30")).toEqual([]);
  });
});
