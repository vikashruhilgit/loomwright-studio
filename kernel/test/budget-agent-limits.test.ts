// Per-agent limits read from each agent's own settings file (phase 4 item
// 04): `limits.tokens_per_day` and `limits.sessions_at_once` in
// `<dataDir>/config/agents/<id>.json`, read through the kernel's lookup
// (`agentLimitsFor`, the one reader `readAgentSettings`) at every admission
// check and metered result, and enforced at session admission. A settings
// file that is invalid or missing refuses (fail closed), never reads as
// unlimited; a label that fails the crew-id grammar gets no per-agent check.
//
// The first half drives `Budget` directly on a temp store, with the kernel's
// own lookup over real files and a UTC-day clock (budget-helpers.ts). The
// second half drives a real kernel from `startKernel` (so the shipped wiring
// is what is under test) on the fake spawner/query (session-fakes.ts), with
// no contributions and a test `wakeup` handler standing in for whatever
// starts the session: never the real SDK, a model or the network.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeychainError } from "../src/auth/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { AGENT_REFUSAL_NOTIFY_MS, Budget, SESSIONS_AT_ONCE_RECHECK_MS, localDay } from "../src/budget/index.js";
import type { AgentLimitsLookup } from "../src/budget/index.js";
import { agentLimitsFor, startKernel } from "../src/kernel.js";
import type { Kernel } from "../src/kernel.js";
import { enqueueEvent } from "../src/loop/index.js";
import type { EventContext } from "../src/loop/index.js";
import { createPlaybook } from "../src/playbooks/index.js";
import { AdmissionRefusedError } from "../src/sessions/index.js";
import type { AdmissionRequest, SessionHandle } from "../src/sessions/index.js";
import type { Store } from "../src/store/index.js";
import { AUTH, errorResult, events, insertSession, nextUtcMidnight, result, testEnv } from "./budget-helpers.js";
import type { TestEnv } from "./budget-helpers.js";
import type { FakeCall } from "./session-fakes.js";
import { fakeMsg, fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

const START = "2026-10-18T10:00:00.000Z";
const WAIT = { timeout: 10_000, interval: 10 };

/** A crew member's minimal valid settings file, plus `extra` (for example `limits`). */
function crewSettings(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { model: "claude-haiku-4-5", permission_mode: "default", tool_policy: { allowedTools: [], allowedBashPrefixes: [] }, ...extra };
}

/** Write `<dataDir>/config/agents/<id>.json`; a string is written as is (for a broken file). */
function writeAgentSettings(dataDir: string, id: string, settings: Record<string, unknown> | string): string {
  const file = join(dataDir, "config", "agents", `${id}.json`);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, typeof settings === "string" ? settings : `${JSON.stringify(settings, null, 2)}\n`);
  return file;
}

const notifies = (store: Store, reason: string) => events(store, "notify").filter((e) => e.payload.reason === reason);

// ---- Budget with the kernel's lookup ---------------------------------------------

describe("per-agent limits from settings, at admission (Budget with agentLimitsFor)", () => {
  let env: TestEnv;
  let dataDir: string;

  beforeEach(() => {
    env = testEnv(START);
    dataDir = env.store.dataDir;
  });
  afterEach(() => env.cleanup());

  const budget = (lookup: ((agent: string) => AgentLimitsLookup) | undefined = agentLimitsFor(dataDir)): Budget =>
    new Budget({ store: env.store, authProvider: AUTH, ...(lookup === undefined ? {} : { agentLimits: lookup }) }, env.deps);

  const request = (overrides: Partial<AdmissionRequest> = {}): AdmissionRequest => ({
    kind: "start",
    agent: "mason",
    account: AUTH.account,
    provider: AUTH.id,
    task: null,
    ...overrides,
  });

  const spend = (agent: string, counted: number): void => {
    env.store.prepare("INSERT INTO budget (day, agent, model, input_tokens) VALUES (?, ?, 'haiku', ?)").run(START.slice(0, 10), agent, counted);
  };

  it("AC1: tokens_per_day from mason.json refuses a start at the limit until the next day, one notify that day; no limits admits whatever the count", () => {
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { tokens_per_day: 1_000 } }));
    const b = budget();
    spend("mason", 999);
    expect(b.check(request())).toEqual({ admitted: true });
    spend("mason", 1);
    const nextDay = nextUtcMidnight(env.clock.at).toISOString();
    expect(b.check(request())).toEqual({ admitted: false, reason: "agent_daily_limit", retryAt: nextDay });
    expect(b.check(request({ task: 3 }))).toEqual({ admitted: false, reason: "agent_daily_limit", retryAt: nextDay });
    expect(events(env.store, "admission_refused").map((e) => e.payload)).toEqual([
      expect.objectContaining({ kind: "start", agent: "mason", reason: "agent_daily_limit", retry_at: nextDay, counted_tokens: 1_000, limit: 1_000 }),
      expect.objectContaining({ kind: "start", agent: "mason", reason: "agent_daily_limit", task: 3 }),
    ]);
    expect(events(env.store, "notify")).toHaveLength(1);
    expect(notifies(env.store, "agent_daily_limit")).toHaveLength(1);

    // The static map is not consulted once a lookup is given: no file limit, no limit.
    writeAgentSettings(dataDir, "mason", crewSettings());
    spend("mason", 10_000_000);
    expect(b.check(request())).toEqual({ admitted: true });
    expect(events(env.store, "notify")).toHaveLength(1);
  });

  it("AC1: an edit to the file applies at the next check (read afresh, never cached)", () => {
    writeAgentSettings(dataDir, "mason", crewSettings());
    const b = budget();
    spend("mason", 500);
    expect(b.check(request())).toEqual({ admitted: true });
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { tokens_per_day: 500 } }));
    expect(b.check(request())).toMatchObject({ admitted: false, reason: "agent_daily_limit" });
  });

  it("AC2: sessions_at_once 1 with one running mason session refuses a second start, retryAt now + SESSIONS_AT_ONCE_RECHECK_MS; one notify per agent per hour", () => {
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { sessions_at_once: 1 } }));
    const b = budget();
    expect(SESSIONS_AT_ONCE_RECHECK_MS).toBe(60_000);
    expect(b.check(request())).toEqual({ admitted: true });
    const running = insertSession(env.store, { agent: "mason", status: "running" });
    // Other agents' sessions and finished mason sessions never count.
    insertSession(env.store, { agent: "wright", status: "running" });
    for (const status of ["completed", "failed", "failed:auth", "stopped", "interrupted", "abandoned"]) insertSession(env.store, { agent: "mason", status });

    const retryAt = new Date(env.clock.at.getTime() + SESSIONS_AT_ONCE_RECHECK_MS).toISOString();
    expect(b.check(request())).toEqual({ admitted: false, reason: "agent_sessions_at_once", retryAt });
    expect(b.check(request())).toMatchObject({ admitted: false, reason: "agent_sessions_at_once" });
    const refused = events(env.store, "admission_refused");
    expect(refused).toHaveLength(2);
    expect(refused[0]?.payload).toEqual({
      kind: "start",
      agent: "mason",
      account: AUTH.account,
      provider: AUTH.id,
      task: null,
      reason: "agent_sessions_at_once",
      retry_at: retryAt,
      live: 1,
      limit: 1,
      live_sessions: [running],
    });
    expect(notifies(env.store, "agent_sessions_at_once")).toHaveLength(1);
    expect(notifies(env.store, "agent_sessions_at_once")[0]?.payload).toMatchObject({ provider: AUTH.id, agent: "mason", live: 1, limit: 1 });

    // An hour later the next refusal notifies again.
    env.clock.at = new Date(env.clock.at.getTime() + AGENT_REFUSAL_NOTIFY_MS);
    expect(b.check(request())).toMatchObject({ reason: "agent_sessions_at_once" });
    expect(notifies(env.store, "agent_sessions_at_once")).toHaveLength(2);

    // A `starting` row is live too; once nothing is live the start is admitted.
    env.store.prepare("UPDATE sessions SET status = 'starting' WHERE id = ?").run(running);
    expect(b.check(request())).toMatchObject({ reason: "agent_sessions_at_once" });
    env.store.prepare("UPDATE sessions SET status = 'completed' WHERE id = ?").run(running);
    expect(b.check(request())).toEqual({ admitted: true });
  });

  it("AC2: a limit above the live count admits (refused only at or over it)", () => {
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { sessions_at_once: 2 } }));
    insertSession(env.store, { agent: "mason", status: "running" });
    expect(budget().check(request())).toEqual({ admitted: true });
    insertSession(env.store, { agent: "mason", status: "running" });
    expect(budget().check(request())).toMatchObject({ admitted: false, reason: "agent_sessions_at_once" });
  });

  it("AC3: an orphaned mason row counts as live; the refusal names its id and studio session abandon", () => {
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { sessions_at_once: 1 } }));
    const orphan = insertSession(env.store, { agent: "mason", status: "orphaned" });
    expect(budget().check(request())).toMatchObject({ admitted: false, reason: "agent_sessions_at_once" });
    const payload = events(env.store, "admission_refused")[0]?.payload;
    expect(payload).toMatchObject({ reason: "agent_sessions_at_once", live: 1, limit: 1, live_sessions: [orphan], orphaned_sessions: [orphan] });
    expect(payload?.hint).toContain(`studio session abandon ${orphan}`);
  });

  it("AC5: Wright's wright.json limits apply, model set or not; no limits leaves Wright unlimited", () => {
    const base = { permission_mode: "default", tool_policy: { status: "proposed", allowedTools: [], allowedBashPrefixes: [] } };
    writeAgentSettings(dataDir, "wright", { ...base, model: "claude-haiku-4-5", limits: { sessions_at_once: 1 } });
    insertSession(env.store, { agent: "wright", status: "running" });
    const wright = request({ agent: "wright" });
    expect(budget().check(wright)).toMatchObject({ admitted: false, reason: "agent_sessions_at_once" });
    // A model-less file (model_unset) still has its limits applied: a missing model is the session's refusal, not the budget's.
    writeAgentSettings(dataDir, "wright", { ...base, model: null, limits: { sessions_at_once: 1 } });
    expect(budget().check(wright)).toMatchObject({ admitted: false, reason: "agent_sessions_at_once" });
    writeAgentSettings(dataDir, "wright", { ...base, model: null });
    spend("wright", 10_000_000);
    expect(budget().check(wright)).toEqual({ admitted: true });
  });

  it("AC6: an invalid mason.json refuses settings_invalid and a deleted one settings_missing, start and resume, never admitted as unlimited", () => {
    const file = writeAgentSettings(dataDir, "mason", "{ not json");
    const b = budget();
    for (const kind of ["start", "resume"] as const) {
      expect(b.check(request({ kind }))).toEqual({ admitted: false, reason: "settings_invalid", retryAt: null });
    }
    expect(events(env.store, "admission_refused")[0]?.payload).toMatchObject({ reason: "settings_invalid", retry_at: null, file, message: `${file}: not JSON` });
    // A misspelt limit is invalid too (the crew schema is strict), never an unenforced one.
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { session_at_once: 1 } }));
    expect(b.check(request())).toMatchObject({ admitted: false, reason: "settings_invalid" });
    expect(notifies(env.store, "settings_invalid")).toHaveLength(1);

    rmSync(file);
    expect(b.check(request())).toEqual({ admitted: false, reason: "settings_missing", retryAt: null });
    expect(b.check(request({ kind: "resume" }))).toEqual({ admitted: false, reason: "settings_missing", retryAt: null });
    expect(events(env.store, "admission_refused").at(-1)?.payload).toMatchObject({ reason: "settings_missing", file });
    expect(notifies(env.store, "settings_missing")).toHaveLength(1);
    expect(notifies(env.store, "settings_missing")[0]?.payload).toMatchObject({ agent: "mason", file });

    // The cap is still checked first.
    env.store.prepare("INSERT INTO cap_state (account, rate_limit_type, status, resets_at) VALUES (?, 'five_hour', 'rejected', NULL)").run(AUTH.id);
    expect(b.check(request())).toMatchObject({ reason: "cap_parked" });
  });

  it("AC6: a lookup answer with a limit that is not a positive integer refuses settings_invalid (fail closed)", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(budget(() => ({ ok: true, sessionsAtOnce: bad })).check(request()), String(bad)).toMatchObject({ admitted: false, reason: "settings_invalid" });
      expect(budget(() => ({ ok: true, tokensPerDay: bad })).check(request()), String(bad)).toMatchObject({ admitted: false, reason: "settings_invalid" });
    }
  });

  it("AC7: a playbook owned by mason at its sessions-at-once limit is refused agent_sessions_at_once by checkPlaybook, in the agent-limit slot (step 4)", () => {
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { sessions_at_once: 1 } }));
    const p = createPlaybook(
      env.store,
      { agent: "mason", name: "Mason digest", intent: "Summarise.", trigger: { kind: "cron", spec: "0 0 1 1 *", tz: "UTC" }, model: "m", token_limit: 1_000 },
      env.clock.at,
    ).playbook;
    insertSession(env.store, { agent: "mason", status: "running" });
    const b = budget();
    const fire = { ...request(), playbook: p.id };
    const retryAt = new Date(env.clock.at.getTime() + SESSIONS_AT_ONCE_RECHECK_MS).toISOString();
    expect(b.checkPlaybook(fire)).toEqual({ admitted: false, reason: "agent_sessions_at_once", retryAt });
    expect(events(env.store, "admission_refused").at(-1)?.payload).toMatchObject({ playbook: p.id, reason: "agent_sessions_at_once", live: 1, limit: 1 });

    // Step 2 (the playbook's own daily limit) comes before it.
    env.store.prepare("INSERT INTO budget (day, agent, playbook, model, input_tokens) VALUES (?, 'mason', ?, 'm', 1000)").run(START.slice(0, 10), String(p.id));
    expect(b.checkPlaybook(fire)).toMatchObject({ reason: "playbook_daily_limit" });
    // A resume is not refused by the playbook's daily limit, but it is by sessions at once.
    expect(b.checkPlaybook({ ...fire, kind: "resume" })).toMatchObject({ reason: "agent_sessions_at_once" });
    // Step 3 (the cap) comes before it too.
    env.store.prepare("INSERT INTO cap_state (account, rate_limit_type, status, resets_at) VALUES (?, 'five_hour', 'rejected', NULL)").run(AUTH.id);
    expect(b.checkPlaybook({ ...fire, kind: "resume" })).toMatchObject({ reason: "cap_parked" });
  });

  it("AC8: a resume adds a live session (refused by sessions at once), but is never refused by tokens_per_day", () => {
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { sessions_at_once: 1 } }));
    insertSession(env.store, { agent: "mason", status: "running" });
    const interrupted = insertSession(env.store, { agent: "mason", status: "interrupted" });
    expect(budget().check(request({ kind: "resume", session: interrupted }))).toMatchObject({ admitted: false, reason: "agent_sessions_at_once" });

    env.store.prepare("UPDATE sessions SET status = 'completed' WHERE agent = 'mason' AND status = 'running'").run();
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { tokens_per_day: 1_000 } }));
    spend("mason", 1_000);
    expect(budget().check(request())).toMatchObject({ admitted: false, reason: "agent_daily_limit" });
    expect(budget().check(request({ kind: "resume", session: interrupted }))).toEqual({ admitted: true });
  });

  it("AC10: a resume request leaves its own session's row out of the count; one without `session` counts every live row (fail closed)", () => {
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { sessions_at_once: 1 } }));
    const own = insertSession(env.store, { agent: "mason", status: "starting" });
    const b = budget();
    expect(b.check(request({ kind: "resume", session: own }))).toEqual({ admitted: true });
    expect(b.check(request({ kind: "resume" }))).toMatchObject({ admitted: false, reason: "agent_sessions_at_once" });
    // A start never excludes a row, even when a hand-built request names one.
    expect(b.check(request({ session: own }))).toMatchObject({ admitted: false, reason: "agent_sessions_at_once" });
    // An orphan's own resume is admitted too.
    env.store.prepare("UPDATE sessions SET status = 'orphaned' WHERE id = ?").run(own);
    expect(b.check(request({ kind: "resume", session: own }))).toEqual({ admitted: true });
  });

  it("AC11: a label that fails the crew-id grammar gets no per-agent check, as a null agent; the cap still applies", () => {
    let asked: string[] = [];
    const kernelLookup = agentLimitsFor(dataDir);
    const b = budget((agent) => {
      asked.push(agent);
      return kernelLookup(agent);
    });
    for (const agent of ["exit-test:event-1", "Mason", "shared", "_unassigned"]) {
      spend(agent, 10_000_000);
      insertSession(env.store, { agent, status: "running" });
      expect(b.check(request({ agent })), agent).toEqual({ admitted: true });
    }
    expect(events(env.store, "admission_refused")).toEqual([]);
    expect(events(env.store, "notify")).toEqual([]);
    // A null agent never asks the lookup.
    asked = [];
    expect(b.check(request({ agent: null }))).toEqual({ admitted: true });
    expect(asked).toEqual([]);
    env.store.prepare("INSERT INTO cap_state (account, rate_limit_type, status, resets_at) VALUES (?, 'five_hour', 'rejected', NULL)").run(AUTH.id);
    expect(b.check(request({ agent: "exit-test:event-1" }))).toMatchObject({ reason: "cap_parked" });
  });

  it("the meter reads tokens_per_day through the same lookup, and never throws (nor loses the result) on a settings refusal or a lookup throw", () => {
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { tokens_per_day: 10 } }));
    const id = insertSession(env.store, { agent: "mason" });
    budget().observe(id, result({ haiku: { input: 50 } }));
    expect(events(env.store, "budget_limit_reached").map((e) => e.payload)).toEqual([expect.objectContaining({ agent: "mason", limit: 10, counted_tokens: 50 })]);

    const broken = insertSession(env.store, { agent: "scout" });
    writeAgentSettings(dataDir, "scout", "{ not json");
    expect(() => budget().observe(broken, result({ haiku: { input: 70 } }))).not.toThrow();
    const thrower = budget(() => {
      throw new Error("settings dir unreadable");
    });
    const third = insertSession(env.store, { agent: "rook" });
    expect(() => thrower.observe(third, result({ haiku: { input: 30 } }))).not.toThrow();

    const counted = env.store.prepare<[], { agent: string; counted: number }>("SELECT agent, SUM(counted_tokens) AS counted FROM budget GROUP BY agent ORDER BY agent").all();
    expect(counted).toEqual([
      { agent: "mason", counted: 50 },
      { agent: "rook", counted: 30 },
      { agent: "scout", counted: 70 },
    ]);
    expect(events(env.store, "budget_limit_reached")).toHaveLength(1);
    expect(events(env.store, "observer_error")).toEqual([]);
  });

  it("without a lookup the static agentDailyTokenLimits still apply and there is no sessions-at-once check", () => {
    const b = new Budget({ store: env.store, authProvider: AUTH, config: { agentDailyTokenLimits: { mason: 5 }, apiKeyFallback: { enabled: false, dollarCeilingUsd: null } } }, env.deps);
    for (let i = 0; i < 3; i++) insertSession(env.store, { agent: "mason", status: "running" });
    expect(b.check(request())).toEqual({ admitted: true });
    spend("mason", 5);
    expect(b.check(request())).toMatchObject({ reason: "agent_daily_limit" });
  });
});

// ---- A real kernel ---------------------------------------------------------------

describe("per-agent limits through the kernel's wiring (startKernel)", () => {
  let tmp: string;
  const kernels: Kernel[] = [];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "studio-agent-limits-"));
  });

  afterEach(async () => {
    for (const k of kernels.splice(0)) await k.stop();
    rmSync(tmp, { recursive: true, force: true });
  });

  function mutableClock(iso: string) {
    let ms = Date.parse(iso);
    return {
      now: (): Date => new Date(ms),
      advance: (by: number): void => {
        ms += by;
      },
    };
  }

  function memoryKeychain() {
    const items = new Map<string, string>();
    const reader: KeychainReader = { read: (service) => items.get(service) };
    const writer: KeychainWriter = {
      add(service, _account, secret) {
        if (items.has(service)) throw new KeychainError(service, 45, null, "write");
        items.set(service, secret);
      },
    };
    return { reader, writer };
  }

  const success = (text: string): SDKMessage =>
    ({ type: "result", subtype: "success", is_error: false, result: text, modelUsage: {} }) as unknown as SDKMessage;

  /** A session that stays running until the test ends it (`endCall`). */
  const runningScript = (call: FakeCall): void => {
    call.stream.push(fakeMsg.init(call.options.sessionId ?? call.options.resume ?? "unknown"));
  };

  function endCall(call: FakeCall | undefined): void {
    call?.stream.push(success("done"));
    call?.stream.end();
  }

  async function startTestKernel(o: {
    clock: ReturnType<typeof mutableClock>;
    script?: (call: FakeCall, n: number) => void;
    wakeup?: (ctx: EventContext) => Promise<void>;
  }) {
    const dataDir = join(tmp, "data");
    const keychain = memoryKeychain();
    const fakes = fakeSessions({ script: o.script ?? runningScript });
    const pluginDir = makePluginDir(tmp);
    const provider: AuthProvider = stubProvider();
    const kernel = await startKernel(
      {
        dataDir,
        env: { PATH: "/usr/bin" },
        sessions: { loomwrightPath: pluginDir, stopGraceMs: 10 },
        contributions: [],
        ...(o.wakeup === undefined ? {} : { handlers: { wakeup: o.wakeup } }),
      },
      {
        keychain: keychain.reader,
        keychainWriter: keychain.writer,
        sessionDeps: fakes.deps,
        selectAuthProvider: async () => provider,
        availableProviderIds: async () => ["api-key"],
        now: o.clock.now,
        loopDeps: { tickMs: 10, now: o.clock.now },
      },
    );
    kernels.push(kernel);
    const cwd = join(tmp, "work");
    mkdirSync(cwd, { recursive: true });
    return { kernel, fakes, pluginDir, cwd, dataDir, provider };
  }

  const masonCount = (store: Store): number => store.prepare<[], number>("SELECT count(*) FROM sessions WHERE agent = 'mason'").pluck().get() ?? 0;

  function storedRow(store: Store, o: { status: string; pluginDir: string; account: string; pgid?: number }): number {
    return Number(
      store
        .prepare(
          `INSERT INTO sessions (agent, status, sdk_session_id, model, loomwright_path, auth_account, pgid)
           VALUES ('mason', ?, 'sid', 'claude-haiku-4-5', ?, ?, ?)`,
        )
        .run(o.status, o.pluginDir, o.account, o.pgid ?? null).lastInsertRowid,
    );
  }

  const RESUME = { permissionMode: "default" as const, policy: { allowedTools: ["Read"], allowedBashPrefixes: [] } };

  it("AC2: through the event loop, a start past sessions_at_once is parked until the recheck (no second notify), then starts once the first session ended", async () => {
    const clock = mutableClock(START);
    const started: SessionHandle[] = [];
    let cwd = "";
    const { kernel, fakes, dataDir } = await startTestKernel({
      clock,
      wakeup: async (ctx) => {
        started.push(await (ctx.sessions as NonNullable<typeof ctx.sessions>).startSession(startParams(cwd, { agent: "mason" })));
      },
    });
    cwd = join(tmp, "work");
    mkdirSync(cwd, { recursive: true });
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { sessions_at_once: 1 } }));
    const store = kernel.store;
    const first = await kernel.sessions.startSession(startParams(cwd, { agent: "mason" }));

    const queued = enqueueEvent(store, { kind: "wakeup", payload: {} }, clock.now());
    await vi.waitFor(() => expect(events(store, "event_parked")).toHaveLength(1), WAIT);
    const notBefore = new Date(clock.now().getTime() + SESSIONS_AT_ONCE_RECHECK_MS).toISOString();
    expect(events(store, "event_parked")[0]?.payload).toMatchObject({ queue_id: queued.id, reason: "agent_sessions_at_once", retry_at: notBefore, not_before: notBefore });
    expect(store.prepare("SELECT status, not_before FROM event_queue WHERE id = ?").get(queued.id)).toEqual({ status: "pending", not_before: notBefore });
    expect(masonCount(store)).toBe(1);
    expect(fakes.calls).toHaveLength(1);
    expect(notifies(store, "agent_sessions_at_once")).toHaveLength(1);
    expect(events(store, "notify").map((e) => e.payload.reason)).toEqual(["agent_sessions_at_once"]);

    // The first session ends; once the recheck is due the parked event starts its session.
    endCall(fakes.calls[0]);
    expect(await first.done).toBe("completed");
    clock.advance(SESSIONS_AT_ONCE_RECHECK_MS);
    await vi.waitFor(() => expect(events(store, "event_done")).toHaveLength(1), WAIT);
    expect(started).toHaveLength(1);
    expect(masonCount(store)).toBe(2);
    expect(fakes.calls).toHaveLength(2);
    expect(notifies(store, "agent_sessions_at_once")).toHaveLength(1);
  }, 30_000);

  it("AC4: two starts for mason in the same tick admit exactly one", async () => {
    const clock = mutableClock(START);
    const { kernel, cwd, dataDir } = await startTestKernel({ clock });
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { sessions_at_once: 1 } }));
    const a = kernel.sessions.startSession(startParams(cwd, { agent: "mason" }));
    const b = kernel.sessions.startSession(startParams(cwd, { agent: "mason" }));
    const settled = await Promise.allSettled([a, b]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(AdmissionRefusedError);
    expect(rejected[0]?.reason).toMatchObject({ reason: "agent_sessions_at_once" });
    expect(masonCount(kernel.store)).toBe(1);
  }, 30_000);

  it("AC5: a second wright start is refused when wright.json sets sessions_at_once 1 and one wright session is live", async () => {
    const clock = mutableClock(START);
    const { kernel, cwd, dataDir } = await startTestKernel({ clock });
    writeAgentSettings(dataDir, "wright", {
      model: "claude-haiku-4-5",
      permission_mode: "default",
      tool_policy: { allowedTools: [], allowedBashPrefixes: [] },
      limits: { sessions_at_once: 1 },
    });
    await kernel.sessions.startSession(startParams(cwd));
    const err = await kernel.sessions.startSession(startParams(cwd)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdmissionRefusedError);
    expect(err).toMatchObject({ reason: "agent_sessions_at_once" });
  }, 30_000);

  it("AC6: a crew start with no settings file is refused settings_missing, before any row or spawn", async () => {
    const clock = mutableClock(START);
    const { kernel, cwd, fakes } = await startTestKernel({ clock });
    const err = await kernel.sessions.startSession(startParams(cwd, { agent: "mason" })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdmissionRefusedError);
    expect(err).toMatchObject({ reason: "settings_missing", retryAt: null });
    expect(masonCount(kernel.store)).toBe(0);
    expect(fakes.calls).toHaveLength(0);
  }, 30_000);

  it("AC7: a mason playbook's start at its sessions-at-once limit is parked by the loop, not dropped and not run", async () => {
    const clock = mutableClock(START);
    let playbookId = 0;
    let cwd = "";
    const { kernel, fakes, dataDir } = await startTestKernel({
      clock,
      // Stands in for the playbook fire: crew playbooks are not routed yet (`agent_not_routed`), so the fire's own handler never asks admission for mason.
      wakeup: async (ctx) => {
        await (ctx.sessions as NonNullable<typeof ctx.sessions>).startSession(startParams(cwd, { agent: "mason", playbook: playbookId, playbookVersion: 1 }));
      },
    });
    cwd = join(tmp, "work");
    mkdirSync(cwd, { recursive: true });
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { sessions_at_once: 1 } }));
    const store = kernel.store;
    playbookId = createPlaybook(
      store,
      { agent: "mason", name: "Mason digest", intent: "Summarise.", trigger: { kind: "cron", spec: "0 0 1 1 *", tz: "UTC" }, model: "m" },
      clock.now(),
    ).playbook.id;
    store.prepare("UPDATE playbooks SET status = 'enabled' WHERE id = ?").run(playbookId);
    await kernel.sessions.startSession(startParams(cwd, { agent: "mason" }));

    enqueueEvent(store, { kind: "wakeup", payload: {} }, clock.now());
    await vi.waitFor(() => expect(events(store, "event_parked")).toHaveLength(1), WAIT);
    expect(events(store, "event_parked")[0]?.payload).toMatchObject({ reason: "agent_sessions_at_once" });
    expect(events(store, "admission_refused")[0]?.payload).toMatchObject({ kind: "start", agent: "mason", playbook: playbookId, reason: "agent_sessions_at_once" });
    expect(events(store, "event_failed")).toEqual([]);
    expect(masonCount(store)).toBe(1);
    expect(fakes.calls).toHaveLength(1);
  }, 30_000);

  it("AC8: resuming an interrupted mason session beside a running one is refused; at the token limit with nothing else live a resume is admitted", async () => {
    const clock = mutableClock(START);
    const { kernel, cwd, pluginDir, dataDir, provider, fakes } = await startTestKernel({
      clock,
      script: (call) => {
        call.stream.push(fakeMsg.init("sid"));
        endCall(call);
      },
    });
    const store = kernel.store;
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { sessions_at_once: 1 } }));
    const running = storedRow(store, { status: "running", pluginDir, account: provider.account });
    const interrupted = storedRow(store, { status: "interrupted", pluginDir, account: provider.account });
    const err = await kernel.sessions.resumeSession(interrupted, { ...RESUME, cwd }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdmissionRefusedError);
    expect(err).toMatchObject({ reason: "agent_sessions_at_once" });
    expect(kernel.sessions.getSession(interrupted)?.status).toBe("interrupted");

    store.prepare("UPDATE sessions SET status = 'completed' WHERE id = ?").run(running);
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { tokens_per_day: 1_000 } }));
    store.prepare("INSERT INTO budget (day, agent, model, input_tokens) VALUES (?, 'mason', 'haiku', 1000)").run(localDay(clock.now()));
    expect(await kernel.sessions.startSession(startParams(cwd, { agent: "mason" })).catch((e: unknown) => e)).toMatchObject({ reason: "agent_daily_limit" });
    const handle = await kernel.sessions.resumeSession(interrupted, { ...RESUME, cwd });
    expect(await handle.done).toBe("completed");
    expect(fakes.calls).toHaveLength(1);
  }, 30_000);

  it("AC10: a resume's own retry is admitted at sessions_at_once 1 (its own row is not counted)", async () => {
    const clock = mutableClock(START);
    const { kernel, cwd, pluginDir, dataDir, provider, fakes } = await startTestKernel({
      clock,
      script: (call, n) => {
        call.stream.push(fakeMsg.init("sid"));
        // Attempt 1 fails; attempt 2 succeeds.
        call.stream.push(n === 1 ? errorResult(["boom"]) : success("done"));
        call.stream.end();
      },
    });
    const store = kernel.store;
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { sessions_at_once: 1 } }));
    const id = storedRow(store, { status: "interrupted", pluginDir, account: provider.account });
    const handle = await kernel.sessions.resumeSession(id, { ...RESUME, cwd });
    expect(await handle.done).toBe("completed");
    expect(fakes.calls).toHaveLength(2);
    expect(events(store, "admission_refused")).toEqual([]);
  }, 30_000);

  it("AC10: the initial resume of mason's own orphaned row is admitted at sessions_at_once 1", async () => {
    const clock = mutableClock(START);
    const { kernel, cwd, pluginDir, dataDir, provider, fakes } = await startTestKernel({
      clock,
      script: (call) => {
        call.stream.push(fakeMsg.init("sid"));
        endCall(call);
      },
    });
    const store = kernel.store;
    writeAgentSettings(dataDir, "mason", crewSettings({ limits: { sessions_at_once: 1 } }));
    const id = storedRow(store, { status: "orphaned", pluginDir, account: provider.account, pgid: 2_100_000_000 });
    const handle = await kernel.sessions.resumeSession(id, { ...RESUME, cwd });
    expect(await handle.done).toBe("completed");
    expect(fakes.calls).toHaveLength(1);
    expect(events(store, "admission_refused")).toEqual([]);
  }, 30_000);
});
