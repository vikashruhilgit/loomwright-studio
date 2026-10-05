// Unit tests for the admission gate and its session-manager hook (item 06,
// AC2, AC4, AC6-AC8). The manager runs on a fake `query`/spawn: never the real
// SDK, a model or a real process (fake pids are above any real pid_max).
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { SDKMessage, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthProvider } from "../src/auth/index.js";
import {
  Budget,
  BudgetAdmission,
  BudgetConfigError,
  CAP_RECHECK_MS,
  CapTracker,
  DEFAULT_BUDGET_CONFIG,
  apiKeyFallbackActive,
  validateBudgetConfig,
} from "../src/budget/index.js";
import type { BudgetConfig } from "../src/budget/index.js";
import { AdmissionRefusedError, SessionError, SessionManager } from "../src/sessions/index.js";
import type { AdmissionDecision, AdmissionRequest, QueryFn, SpawnFn, StartSessionParams } from "../src/sessions/index.js";
import {
  AUTH,
  assistantError,
  errorResult,
  events,
  fixture,
  insertSession,
  isErrorSuccessResult,
  result,
  testEnv,
} from "./budget-helpers.js";
import type { TestEnv } from "./budget-helpers.js";

// Before the p6 event's five_hour reset (2026-09-29T16:20:00Z).
const START = "2026-09-29T12:00:00.000Z";
const FIVE_HOUR_RESET = "2026-09-29T16:20:00.000Z";
const CAP_TEXT = "You've hit your limit · resets 6am (UTC)";
const LIMITED: BudgetConfig = { ...DEFAULT_BUDGET_CONFIG, agentDailyTokenLimits: { wright: 1_000 } };

let env: TestEnv;

beforeEach(() => {
  env = testEnv(START);
});

afterEach(() => env.cleanup());

function admission(config: BudgetConfig = DEFAULT_BUDGET_CONFIG): BudgetAdmission {
  return new BudgetAdmission({ store: env.store, authProvider: AUTH, config }, env.deps);
}

function tracker(): CapTracker {
  return new CapTracker({ store: env.store, authProvider: AUTH }, env.deps);
}

function request(overrides: Partial<AdmissionRequest> = {}): AdmissionRequest {
  return { kind: "start", agent: "wright", account: AUTH.account, provider: AUTH.id, task: null, ...overrides };
}

function spend(agent: string, counted: number, day = "2026-09-29"): void {
  env.store.prepare("INSERT INTO budget (day, agent, model, input_tokens) VALUES (?, ?, 'haiku', ?)").run(day, agent, counted);
}

describe("BudgetAdmission: agent daily limit (AC2)", () => {
  it("refuses a start for an agent at its limit with retryAt the next day, but admits a resume", () => {
    const gate = admission(LIMITED);
    spend("wright", 999);
    expect(gate.check(request())).toEqual({ admitted: true });
    spend("wright", 1);
    expect(gate.check(request({ task: 7 }))).toEqual({ admitted: false, reason: "agent_daily_limit", retryAt: "2026-09-30T00:00:00.000Z" });
    expect(gate.check(request({ kind: "resume" }))).toEqual({ admitted: true });

    const refused = events(env.store, "admission_refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      task_id: 7,
      payload: {
        kind: "start",
        agent: "wright",
        account: AUTH.account,
        provider: AUTH.id,
        task: 7,
        reason: "agent_daily_limit",
        retry_at: "2026-09-30T00:00:00.000Z",
      },
    });
  });

  it("notifies once per agent-day, shared with the meter's crossing", () => {
    const gate = admission(LIMITED);
    spend("wright", 5_000);
    gate.check(request());
    gate.check(request());
    expect(events(env.store, "admission_refused")).toHaveLength(2);
    expect(events(env.store, "notify")).toHaveLength(1);
    expect(events(env.store, "budget_limit_reached")).toHaveLength(1);

    // The meter crossing the limit first: admission adds no second notify.
    const budget = new Budget({ store: env.store, authProvider: AUTH, config: { ...DEFAULT_BUDGET_CONFIG, agentDailyTokenLimits: { scout: 10 } } }, env.deps);
    const id = insertSession(env.store, { agent: "scout" });
    budget.observe(id, result({ haiku: { input: 50 } }));
    expect(events(env.store, "notify")).toHaveLength(2);
    expect(budget.check(request({ agent: "scout" }))).toMatchObject({ admitted: false, reason: "agent_daily_limit" });
    expect(events(env.store, "notify")).toHaveLength(2);
  });

  it("admits again on the next day, and never limits an agent with no configured limit or a null agent", () => {
    const gate = admission(LIMITED);
    spend("wright", 5_000);
    spend("scout", 10_000_000);
    expect(gate.check(request({ agent: "scout" }))).toEqual({ admitted: true });
    expect(gate.check(request({ agent: null }))).toEqual({ admitted: true });
    env.clock.at = new Date("2026-09-30T00:00:00.000Z");
    expect(gate.check(request())).toEqual({ admitted: true });
  });

  it("an agent named like an Object.prototype member has no limit unless one is configured for it", () => {
    const gate = admission(LIMITED);
    for (const agent of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      spend(agent, 10_000_000);
      expect(gate.check(request({ agent }))).toEqual({ admitted: true });
    }
    expect(gate.check(request({ agent: "constructor" }))).toEqual({ admitted: true });
    expect(admission(DEFAULT_BUDGET_CONFIG).check(request({ agent: "constructor" }))).toEqual({ admitted: true });
    expect(events(env.store, "admission_refused")).toEqual([]);
    expect(events(env.store, "notify")).toEqual([]);

    const own = admission({ ...DEFAULT_BUDGET_CONFIG, agentDailyTokenLimits: JSON.parse('{"constructor": 5}') });
    expect(own.check(request({ agent: "constructor" }))).toMatchObject({ admitted: false, reason: "agent_daily_limit" });
  });
});

describe("BudgetAdmission: cap park (AC4, AC6, AC8)", () => {
  it("a rejected event refuses starts and resumes on that account until resetsAt, then admits", () => {
    const id = insertSession(env.store);
    tracker().observe(id, fixture("p6-rate-limit-rejected.json"));
    const gate = admission();
    for (const kind of ["start", "resume"] as const) {
      expect(gate.check(request({ kind }))).toEqual({ admitted: false, reason: "cap_parked", retryAt: FIVE_HOUR_RESET });
      expect(gate.check(request({ kind, agent: null }))).toMatchObject({ admitted: false, reason: "cap_parked" });
    }
    // The same provider under another label is still parked: parks key on the id, never the label (F06-1).
    const relabelled = { id: AUTH.id, account: "second@example.test" };
    expect(new BudgetAdmission({ store: env.store, authProvider: relabelled }, env.deps).check(request({ account: relabelled.account }))).toEqual({
      admitted: false,
      reason: "cap_parked",
      retryAt: FIVE_HOUR_RESET,
    });
    // Another provider (another id, even under the same label) is not parked.
    const other = { id: "other-provider", account: AUTH.account };
    expect(new BudgetAdmission({ store: env.store, authProvider: other }, env.deps).check(request({ provider: other.id }))).toEqual({ admitted: true });
    // A request naming a provider other than the budget's fails closed; the label is never compared.
    expect(() => gate.check(request({ provider: "other-provider" }))).toThrow(/fail closed/);
    expect(gate.check(request({ account: "anything@example.test" }))).toMatchObject({ admitted: false, reason: "cap_parked" });
    // The refusal adds no notify: the cap's went out once, when it parked.
    expect(events(env.store, "notify")).toHaveLength(1);
    expect(events(env.store, "admission_refused")[0]?.payload).toMatchObject({ reason: "cap_parked", rate_limit_types: ["five_hour"] });

    env.clock.at = new Date(FIVE_HOUR_RESET);
    expect(gate.check(request())).toEqual({ admitted: true });
  });

  it("the cap is checked before the agent limit and refuses even an unlimited agent", () => {
    const id = insertSession(env.store);
    tracker().observe(id, fixture("p6-rate-limit-rejected.json"));
    spend("wright", 5_000);
    expect(admission(LIMITED).check(request())).toMatchObject({ reason: "cap_parked" });
    expect(admission(LIMITED).check(request({ agent: "scout" }))).toMatchObject({ reason: "cap_parked" });
  });

  it("a text-fallback park refuses with retryAt the re-check time, then admits after the hour", () => {
    const id = insertSession(env.store);
    tracker().observe(id, errorResult([CAP_TEXT]));
    const recheck = new Date(env.clock.at.getTime() + CAP_RECHECK_MS).toISOString();
    expect(admission().check(request({ kind: "resume" }))).toEqual({ admitted: false, reason: "cap_parked", retryAt: recheck });
    env.clock.at = new Date(env.clock.at.getTime() + CAP_RECHECK_MS);
    expect(admission().check(request())).toEqual({ admitted: true });
  });

  it("a park with an unknown reset (null resets_at) refuses with retryAt null; the latest reset wins otherwise", () => {
    const insert = env.store.prepare("INSERT INTO cap_state (account, rate_limit_type, status, resets_at) VALUES (?, ?, 'rejected', ?)");
    // Parks are keyed on the provider id (migration 9).
    insert.run(AUTH.id, "five_hour", "2026-09-29T13:00:00.000Z");
    insert.run(AUTH.id, "seven_day", "2026-10-01T00:00:00.000Z");
    expect(admission().check(request())).toEqual({ admitted: false, reason: "cap_parked", retryAt: "2026-10-01T00:00:00.000Z" });
    insert.run(AUTH.id, "overage", null);
    expect(admission().check(request())).toEqual({ admitted: false, reason: "cap_parked", retryAt: null });
  });

  it("a null auth_account park and admission resolve to the same (provider) account", () => {
    const id = insertSession(env.store, { account: null });
    tracker().observe(id, fixture("p6-rate-limit-rejected.json"));
    expect(admission().check(request({ account: AUTH.account }))).toMatchObject({ admitted: false, reason: "cap_parked" });
  });
});

describe("API-key fallback config (AC7)", () => {
  it("defaults off with no ceiling, and stays off", () => {
    expect(DEFAULT_BUDGET_CONFIG.apiKeyFallback).toEqual({ enabled: false, dollarCeilingUsd: null });
    expect(DEFAULT_BUDGET_CONFIG.agentDailyTokenLimits).toEqual({});
    expect(apiKeyFallbackActive(DEFAULT_BUDGET_CONFIG)).toBe(false);
    expect(new Budget({ store: env.store, authProvider: AUTH }).config).toEqual(DEFAULT_BUDGET_CONFIG);
    expect(Object.isFrozen(DEFAULT_BUDGET_CONFIG.apiKeyFallback)).toBe(true);
  });

  it("is active only when enabled AND a positive ceiling is set", () => {
    const with_ = (enabled: boolean, dollarCeilingUsd: number | null) => ({ ...DEFAULT_BUDGET_CONFIG, apiKeyFallback: { enabled, dollarCeilingUsd } });
    expect(apiKeyFallbackActive(with_(true, null))).toBe(false);
    expect(apiKeyFallbackActive(with_(false, 50))).toBe(false);
    expect(apiKeyFallbackActive(with_(true, 50))).toBe(true);
  });

  it("validates limits and the ceiling at construction", () => {
    const bad: unknown[] = [
      { ...DEFAULT_BUDGET_CONFIG, agentDailyTokenLimits: { wright: 0 } },
      { ...DEFAULT_BUDGET_CONFIG, agentDailyTokenLimits: { wright: 1.5 } },
      { ...DEFAULT_BUDGET_CONFIG, agentDailyTokenLimits: { wright: -1 } },
      { ...DEFAULT_BUDGET_CONFIG, agentDailyTokenLimits: { " ": 10 } },
      { ...DEFAULT_BUDGET_CONFIG, agentDailyTokenLimits: [] },
      { ...DEFAULT_BUDGET_CONFIG, apiKeyFallback: { enabled: true, dollarCeilingUsd: 0 } },
      { ...DEFAULT_BUDGET_CONFIG, apiKeyFallback: { enabled: true, dollarCeilingUsd: Number.POSITIVE_INFINITY } },
      { ...DEFAULT_BUDGET_CONFIG, apiKeyFallback: { enabled: "yes", dollarCeilingUsd: null } },
    ];
    for (const config of bad) {
      expect(() => validateBudgetConfig(config as BudgetConfig)).toThrow(BudgetConfigError);
      expect(() => new BudgetAdmission({ store: env.store, authProvider: AUTH, config: config as BudgetConfig })).toThrow(BudgetConfigError);
    }
    expect(validateBudgetConfig(LIMITED)).toEqual(LIMITED);
  });

  it("a cap refusal under the default config switches nothing: same reason, no provider in the decision, no fallback event", () => {
    const id = insertSession(env.store);
    tracker().observe(id, fixture("p6-rate-limit-rejected.json"));
    const decision = admission().check(request());
    expect(decision).toEqual({ admitted: false, reason: "cap_parked", retryAt: FIVE_HOUR_RESET });
    expect(events(env.store).map((e) => e.kind).filter((k) => /fallback|provider|api_key/.test(k))).toEqual([]);
  });
});

// ---- the session manager's admission hook -----------------------------------

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  constructor(readonly pid: number) {
    super();
  }

  kill(): boolean {
    this.killed = true;
    this.exit();
    return true;
  }

  exit(): void {
    if (this.exitCode !== null) return;
    this.exitCode = 0;
    this.emit("exit", 0, null);
  }
}

const UUID = "11111111-2222-4333-8444-555555555555";

interface ManagerHarnessOptions {
  readonly admission?: (r: AdmissionRequest) => AdmissionDecision;
  readonly onMessage?: (id: number, m: SDKMessage) => void;
  /** The messages the fake CLI streams, then it exits. */
  readonly script?: readonly SDKMessage[];
}

function managerHarness(h: ManagerHarnessOptions) {
  const pluginDir = join(env.store.dataDir, "..", "plugin");
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), '{"name":"loomwright"}\n');

  const counts = { query: 0, spawn: 0, buildEnv: 0, groupProbe: 0 };
  const requests: AdmissionRequest[] = [];
  let nextPid = 2_000_000_000;
  const spawn: SpawnFn = (_o, hooks) => {
    counts.spawn++;
    const child = new FakeChild(nextPid++);
    hooks.onSpawn?.(child.pid);
    return child as unknown as SpawnedProcess;
  };
  const query: QueryFn = ({ options }) => {
    counts.query++;
    const child = options.spawnClaudeCodeProcess?.({
      command: "claude",
      args: [],
      cwd: options.cwd,
      env: options.env ?? {},
      signal: new AbortController().signal,
    }) as unknown as FakeChild;
    const messages = h.script ?? [];
    return {
      close: () => child.exit(),
      async *[Symbol.asyncIterator]() {
        for (const m of messages) yield m;
        child.exit();
      },
    };
  };
  const authProvider: AuthProvider = {
    id: AUTH.id,
    account: AUTH.account,
    buildEnv: () => {
      counts.buildEnv++;
      return { PATH: "/usr/bin" };
    },
    health: () => ({ status: "ok" }),
  };
  const manager = new SessionManager(
    {
      store: env.store,
      authProvider,
      loomwrightPath: pluginDir,
      baseEnv: { PATH: "/usr/bin" },
      ...(h.onMessage === undefined ? {} : { onMessage: h.onMessage }),
      ...(h.admission === undefined
        ? {}
        : {
            admission: (r: AdmissionRequest) => {
              requests.push(r);
              return (h.admission as (r: AdmissionRequest) => AdmissionDecision)(r);
            },
          }),
    },
    {
      query,
      spawn,
      killGroup: () => false,
      isGroupAlive: () => {
        counts.groupProbe++;
        return false;
      },
      readGroupLeader: () => {
        counts.groupProbe++;
        return { status: "absent" };
      },
      sleep: async () => {},
      now: () => env.clock.at,
      randomUUID: () => UUID,
    },
  );
  return { manager, counts, requests, pluginDir };
}

function startParams(overrides: Partial<StartSessionParams> = {}): StartSessionParams {
  return {
    agent: "wright",
    task: undefined,
    prompt: "Say hi.",
    model: "claude-haiku-4-5",
    permissionMode: "default",
    cwd: env.store.dataDir,
    policy: { allowedTools: [], allowedBashPrefixes: [] },
    ...overrides,
  };
}

const RESUME = { permissionMode: "default" as const, cwd: "/tmp", policy: { allowedTools: [], allowedBashPrefixes: [] } };

function sessionEvents(id: number): string[] {
  return env.store
    .prepare<[number], string>("SELECT kind || ':' || payload_json FROM events WHERE session_id = ? ORDER BY id")
    .pluck()
    .all(id);
}

describe("SessionManager admission hook", () => {
  const refuseCap = (): AdmissionDecision => ({ admitted: false, reason: "cap_parked", retryAt: FIVE_HOUR_RESET });

  it("refuses a start before any row, auth env or spawn, with AdmissionRefusedError carrying reason and retryAt", async () => {
    const { manager, counts, requests } = managerHarness({ admission: refuseCap });
    const err = await manager.startSession(startParams({ task: undefined })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdmissionRefusedError);
    expect(err).toBeInstanceOf(SessionError);
    expect(err).toMatchObject({ code: "admission_refused", reason: "cap_parked", retryAt: FIVE_HOUR_RESET });
    expect(counts).toEqual({ query: 0, spawn: 0, buildEnv: 0, groupProbe: 0 });
    expect(env.store.prepare("SELECT count(*) FROM sessions").pluck().get()).toBe(0);
    expect(requests).toEqual([{ kind: "start", agent: "wright", account: AUTH.account, provider: AUTH.id, task: null }]);
  });

  it("validates params before asking admission", async () => {
    const { manager, requests } = managerHarness({ admission: refuseCap });
    const err = await manager.startSession(startParams({ model: "" })).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "invalid_params" });
    expect(requests).toEqual([]);
  });

  for (const status of ["orphaned", "interrupted"] as const) {
    it(`refuses a resume of an ${status} row leaving its status and events unchanged, before the group check`, async () => {
      const { manager, counts, requests, pluginDir } = managerHarness({ admission: refuseCap });
      const id = Number(
        env.store
          .prepare(
            "INSERT INTO sessions (agent, task_id, status, sdk_session_id, model, loomwright_path, pgid, auth_account) VALUES ('wright', NULL, ?, 'sid', 'claude-haiku-4-5', ?, 4242, ?)",
          )
          .run(status, pluginDir, AUTH.account).lastInsertRowid,
      );
      env.store.prepare("INSERT INTO events (kind, session_id, payload_json) VALUES ('session_status', ?, '{}')").run(id);
      const before = { row: manager.getSession(id), events: sessionEvents(id) };

      const err = await manager.resumeSession(id, RESUME).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AdmissionRefusedError);
      expect(err).toMatchObject({ reason: "cap_parked", retryAt: FIVE_HOUR_RESET });
      expect(manager.getSession(id)).toEqual(before.row);
      expect(sessionEvents(id)).toEqual(before.events);
      expect(counts).toEqual({ query: 0, spawn: 0, buildEnv: 0, groupProbe: 0 });
      expect(requests).toEqual([{ kind: "resume", agent: "wright", account: AUTH.account, provider: AUTH.id, task: null }]);
    });
  }

  it("a resume of a row with no agent asks admission with agent null", async () => {
    const { manager, requests, pluginDir } = managerHarness({ admission: refuseCap });
    const id = Number(
      env.store
        .prepare(
          "INSERT INTO sessions (agent, status, sdk_session_id, model, loomwright_path) VALUES (NULL, 'interrupted', 'sid', 'claude-haiku-4-5', ?)",
        )
        .run(pluginDir).lastInsertRowid,
    );
    await expect(manager.resumeSession(id, RESUME)).rejects.toBeInstanceOf(AdmissionRefusedError);
    expect(requests[0]).toMatchObject({ kind: "resume", agent: null });
  });

  it("an admission check that throws fails the start closed with its error, before any row", async () => {
    const { manager, counts } = managerHarness({
      admission: () => {
        throw new Error("store gone");
      },
    });
    await expect(manager.startSession(startParams())).rejects.toThrow("store gone");
    expect(counts.query).toBe(0);
    expect(env.store.prepare("SELECT count(*) FROM sessions").pluck().get()).toBe(0);
  });

  it("without the option every start is admitted as before", async () => {
    const { manager, counts } = managerHarness({ script: [{ type: "system", subtype: "init", session_id: UUID } as never, result({ haiku: { input: 1 } })] });
    const handle = await manager.startSession(startParams());
    expect(await handle.done).toBe("completed");
    expect(counts.query).toBe(1);
  });

  it("end to end with Budget wired in: meters the result, parks on a rejected event, and refuses the next start (one provider, no rotation)", async () => {
    const budget = new Budget({ store: env.store, authProvider: AUTH, config: LIMITED }, env.deps);
    const { manager, counts } = managerHarness({
      admission: budget.check,
      onMessage: budget.observe,
      script: [
        { type: "system", subtype: "init", session_id: UUID } as never,
        fixture("p6-rate-limit-rejected.json"),
        fixture("p3-result.json"),
      ],
    });
    const handle = await manager.startSession(startParams({ task: undefined }));
    expect(await handle.done).toBe("completed");
    expect(env.store.prepare("SELECT sum(counted_tokens) FROM budget").pluck().get()).toBe(955 + 281 + 7_788);
    expect(events(env.store, "observer_error")).toEqual([]);

    const err = await manager.startSession(startParams()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "admission_refused", reason: "cap_parked", retryAt: FIVE_HOUR_RESET });
    // The one provider built one env (the first start); the refusal tried no other.
    expect(counts.buildEnv).toBe(1);
    expect(counts.query).toBe(1);
    const notify = events(env.store, "notify");
    expect(notify.map((n) => n.payload.reason)).toEqual(["cap_reached", "agent_daily_limit"]);
    expect(notify.every((n) => n.payload.provider === AUTH.id && n.payload.account === AUTH.account)).toBe(true);
  });

  // A resume attempt starts unconfirmed, so a cap hit on attempt 1 fails it; the retry must not launch on the parked account.
  const CAP_HIT_SCRIPT: readonly SDKMessage[] = [
    { type: "system", subtype: "init", session_id: "sid" } as never,
    assistantError("rate_limit", CAP_TEXT),
    isErrorSuccessResult(CAP_TEXT),
  ];

  function interruptedRow(pluginDir: string, label: string = AUTH.account): number {
    return Number(
      env.store
        .prepare(
          "INSERT INTO sessions (agent, task_id, status, sdk_session_id, model, loomwright_path, auth_account) VALUES ('wright', NULL, 'interrupted', 'sid', 'claude-haiku-4-5', ?, ?)",
        )
        .run(pluginDir, label).lastInsertRowid,
    );
  }

  function statusEvents(id: number): Record<string, unknown>[] {
    return events(env.store, "session_status")
      .filter((e) => e.session_id === id)
      .map((e) => e.payload);
  }

  it("a resume whose attempt 1 hits the cap launches no retry: the retry is refused and the session returns to interrupted", async () => {
    const budget = new Budget({ store: env.store, authProvider: AUTH }, env.deps);
    const { manager, counts, requests, pluginDir } = managerHarness({ admission: budget.check, onMessage: budget.observe, script: CAP_HIT_SCRIPT });
    const id = interruptedRow(pluginDir);

    const handle = await manager.resumeSession(id, RESUME);
    expect(await handle.done).toBe("interrupted");
    expect(counts.query).toBe(1);
    expect(counts.spawn).toBe(1);
    expect(requests).toEqual([
      { kind: "resume", agent: "wright", account: AUTH.account, provider: AUTH.id, task: null },
      { kind: "resume", agent: "wright", account: AUTH.account, provider: AUTH.id, task: null },
    ]);
    const recheck = new Date(env.clock.at.getTime() + CAP_RECHECK_MS).toISOString();
    expect(manager.getSession(id)?.status).toBe("interrupted");
    expect(statusEvents(id).at(-1)).toEqual({
      from: "running",
      to: "interrupted",
      reason: "admission_refused",
      refusal: "cap_parked",
      retry_at: recheck,
      attempt: 2,
    });
    expect(events(env.store, "session_resume_failed").filter((e) => e.session_id === id)).toHaveLength(1);
    expect(events(env.store, "admission_refused").map((e) => e.payload.reason)).toEqual(["cap_parked"]);
    // One hit, one notify (the cap tracker's); the parked retry adds none.
    expect(events(env.store, "notify").map((n) => n.payload.reason)).toEqual(["cap_reached"]);

    // Still resumable: once the park ends a resume is admitted and launches again.
    env.clock.at = new Date(env.clock.at.getTime() + CAP_RECHECK_MS);
    const again = await manager.resumeSession(id, RESUME);
    expect(await again.done).toBe("interrupted");
    expect(counts.query).toBe(2);
  });

  it("a row whose auth_account label differs from the provider's account: the cap hit parks the provider's id, the retry and a new start are refused", async () => {
    const budget = new Budget({ store: env.store, authProvider: AUTH }, env.deps);
    const { manager, counts, pluginDir } = managerHarness({ admission: budget.check, onMessage: budget.observe, script: CAP_HIT_SCRIPT });
    const id = interruptedRow(pluginDir, "stub-provider");

    const handle = await manager.resumeSession(id, RESUME);
    expect(await handle.done).toBe("interrupted");
    expect(counts.query).toBe(1);
    expect(env.store.prepare("SELECT DISTINCT account FROM cap_state").pluck().all()).toEqual([AUTH.id]);
    expect(statusEvents(id).at(-1)).toMatchObject({ to: "interrupted", reason: "admission_refused", refusal: "cap_parked", attempt: 2 });

    const err = await manager.startSession(startParams()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "admission_refused", reason: "cap_parked" });
    expect(counts.query).toBe(1);
  });

  it("a retry whose admission check throws fails closed: nothing launched, the session returns to interrupted", async () => {
    let calls = 0;
    const { manager, counts, pluginDir } = managerHarness({
      admission: () => {
        calls++;
        if (calls > 1) throw new Error("store gone");
        return { admitted: true };
      },
      script: [{ type: "system", subtype: "init", session_id: "sid" } as never, errorResult(["boom"])],
    });
    const id = interruptedRow(pluginDir);
    const handle = await manager.resumeSession(id, RESUME);
    expect(await handle.done).toBe("interrupted");
    expect(counts.query).toBe(1);
    expect(statusEvents(id).at(-1)).toMatchObject({ to: "interrupted", reason: "admission_error", error: "store gone", attempt: 2 });
  });

  it("an admitted retry launches as before: every attempt runs and each asks admission", async () => {
    const { manager, counts, requests, pluginDir } = managerHarness({
      admission: () => ({ admitted: true }),
      script: [{ type: "system", subtype: "init", session_id: "sid" } as never, errorResult(["boom"])],
    });
    const id = interruptedRow(pluginDir);
    const handle = await manager.resumeSession(id, RESUME);
    expect(await handle.done).toBe("failed");
    expect(counts.query).toBe(3);
    expect(requests).toHaveLength(3);
  });
});
