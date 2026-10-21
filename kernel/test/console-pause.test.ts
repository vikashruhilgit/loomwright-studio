// The console's pause part (phase 5 item 05): "pause all" pauses new work.
// `POST /pause` / `POST /unpause` and `studio pause` / `studio unpause`; the
// state derived from the `events` log (`pause_engaged` / `pause_released`),
// so a restart keeps it; triggers record their due instants `missed_paused`;
// admission refuses every start and resume `paused` (the loop parks the
// event once, no notify) while running sessions finish their turn; `POST
// /resume` releases it too, and the release wakes the work it parked.
//
// The trigger rules run on a temp store with `fireDueTriggers` and a fixed
// instant per call. Everything else drives a real kernel from `startKernel`
// (so the shipped wiring is what is under test) over the fake spawner/query
// (session-fakes.ts): never the real SDK, a model or the network. One
// mutable clock is read by `KernelDeps.now`, `loopDeps.now` and the brain's
// handler; the notifications feature's due work posts through a recording
// stub and counts the loop's ticks, so no real notification is ever shown.
// The route is pinned against the app contract here: `app/src/api/contract.ts`
// is read as text, never imported.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_TOKEN_KEYCHAIN_SERVICE, engageKillSwitch, releaseKillSwitch, startApiServer } from "../src/api/index.js";
import type { ApiServer, StatusBody } from "../src/api/index.js";
import { KeychainError } from "../src/auth/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { brainContribution, brainMessageHandler, defaultWrightSettingsJson, wrightSettingsPath } from "../src/brain/index.js";
import type { LoomwrightSummary } from "../src/brain/index.js";
import { runCli } from "../src/cli/index.js";
import { PAUSE_ENGAGED, PAUSE_RELEASED, engagePause, isPaused, pausePart, pauseState, releasePause } from "../src/console/pause.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import type { CliApiClient, ContributedRouteRequest, FeatureContribution } from "../src/features/index.js";
import { admissionFor, startKernel } from "../src/kernel.js";
import type { Kernel, KernelDeps } from "../src/kernel.js";
import { DEFAULT_PARK_MS } from "../src/loop/loop.js";
import { enqueueMessage } from "../src/loop/queue.js";
import type { DueWorkContext } from "../src/loop/types.js";
import { createDeliveryDueWork, notificationsContribution } from "../src/notifications/index.js";
import type { NotifierExec } from "../src/notifications/index.js";
import { AdmissionRefusedError } from "../src/sessions/index.js";
import type { ResumeSessionParams } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { TRIGGER_RESULTS, fireDueTriggers, registerTrigger } from "../src/triggers/store.js";
import { errorResult, events } from "./budget-helpers.js";
import type { FakeCall } from "./session-fakes.js";
import { fakeMsg, fakeSessions, makePluginDir, startParams, stubProvider, unexpectedAbandon } from "./session-fakes.js";

const START = "2026-10-21T10:00:00.000Z";
const MODEL = "claude-haiku-4-5";
const UNAVAILABLE: LoomwrightSummary = { ok: false, reason: "not_installed (test)" };
const WAIT = { timeout: 10_000, interval: 10 };
const PROVIDER = stubProvider();
const TOKEN = "p".repeat(64);
const CONTRACT = new URL("../../app/src/api/contract.ts", import.meta.url);
const contractText = readFileSync(CONTRACT, "utf8");

let tmp: string;
const kernels: Kernel[] = [];
const stores: Store[] = [];
const servers: ApiServer[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-console-pause-"));
});

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const k of kernels.splice(0)) await k.stop();
  for (const s of stores.splice(0)) if (s.isOpen) s.close();
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

// ---- Fixtures ------------------------------------------------------------------

/** One mutable instant, read by `KernelDeps.now`, `loopDeps.now` and the brain's handler alike. */
function mutableClock(iso: string) {
  let ms = Date.parse(iso);
  return {
    now: (): Date => new Date(ms),
    set: (to: string): void => {
      ms = Date.parse(to);
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
  return { items, reader, writer };
}

/** Wright's settings with `model` set (the rest as a fresh data dir has it). */
function setModel(dataDir: string): void {
  const file = wrightSettingsPath(dataDir);
  mkdirSync(join(file, ".."), { recursive: true });
  const settings = JSON.parse(defaultWrightSettingsJson()) as Record<string, unknown>;
  writeFileSync(file, `${JSON.stringify({ ...settings, model: MODEL }, null, 2)}\n`);
}

const success = (text: string): SDKMessage =>
  ({ type: "result", subtype: "success", is_error: false, result: text, modelUsage: {} }) as unknown as SDKMessage;

/** The default stand-in session: init, one successful result, then it ends. */
function finishingScript(call: FakeCall): void {
  call.stream.push(fakeMsg.init(call.options.sessionId ?? call.options.resume ?? "unknown"));
  call.stream.push(success("done"));
  call.stream.end();
}

/**
 * The shipped contributions with two swaps: the brain's `message` handler
 * reads the test's clock and zone, and the notifications feature's due work
 * posts through a recording stub and counts the loop's ticks.
 */
function testContributions(clock: ReturnType<typeof mutableClock>) {
  const exec: NotifierExec = async () => ({ status: 0, signal: null, timedOut: false, stdout: "", stderr: "" });
  const deliver = createDeliveryDueWork({ platform: "linux", exec });
  const state = { ticks: 0 };
  const counted = async (ctx: DueWorkContext): Promise<void> => {
    await deliver(ctx);
    state.ticks++;
  };
  const brain: FeatureContribution = Object.freeze({
    ...brainContribution,
    handlers: Object.freeze({ message: brainMessageHandler({ now: clock.now, timeZone: () => "UTC", loomwright: () => UNAVAILABLE }) }),
  });
  const contributions: readonly FeatureContribution[] = Object.freeze(
    SHIPPED_CONTRIBUTIONS.map((c) => {
      if (c === brainContribution) return brain;
      if (c === notificationsContribution) return Object.freeze({ ...c, dueWork: Object.freeze([counted]) });
      return c;
    }),
  );
  return { contributions, state };
}

/** A kernel over the test contributions, the fake sessions and `clock`, on `dataDir` (default `<tmp>/data`). */
async function startTestKernel(o: { clock: ReturnType<typeof mutableClock>; script?: (call: FakeCall, n: number) => void; dataDir?: string }) {
  const dataDir = o.dataDir ?? join(tmp, "data");
  setModel(dataDir);
  const keychain = memoryKeychain();
  const fakes = fakeSessions({ script: o.script ?? finishingScript });
  const stub = testContributions(o.clock);
  const pluginDir = makePluginDir(tmp);
  const d: KernelDeps = {
    keychain: keychain.reader,
    keychainWriter: keychain.writer,
    sessionDeps: fakes.deps,
    selectAuthProvider: async (): Promise<AuthProvider> => PROVIDER,
    availableProviderIds: async () => ["api-key"],
    now: o.clock.now,
    loopDeps: { tickMs: 10, now: o.clock.now },
  };
  const kernel = await startKernel(
    { dataDir, env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: pluginDir, stopGraceMs: 10 }, contributions: stub.contributions },
    d,
  );
  kernels.push(kernel);
  const cwd = join(tmp, "work");
  mkdirSync(cwd, { recursive: true });
  const token = keychain.items.get(API_TOKEN_KEYCHAIN_SERVICE) as string;
  const api = (method: string, path: string, init: { body?: string; headers?: Record<string, string> } = {}) =>
    fetch(`http://127.0.0.1:${kernel.api.port}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...init.headers }, ...(init.body === undefined ? {} : { body: init.body }) });
  const status = async (): Promise<StatusBody> => (await (await api("GET", "/status")).json()) as StatusBody;
  return { kernel, fakes, stub, pluginDir, cwd, keychain, dataDir, api, status };
}

/** Wait until at least two more loop ticks have started after now (so one ran wholly after any change made before the call). */
async function twoMoreTicks(state: { ticks: number }): Promise<void> {
  const from = state.ticks;
  await vi.waitFor(() => expect(state.ticks).toBeGreaterThanOrEqual(from + 2), WAIT);
}

/** `studio <argv>` against the running kernel on `dataDir`. */
async function studio(dataDir: string, keychain: { reader: KeychainReader }, argv: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(argv, {
    dataDir,
    keychain: keychain.reader,
    stdout: { write: (c: string) => stdout.push(c) },
    stderr: { write: (c: string) => stderr.push(c) },
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

function openStore(): Store {
  const store = new Store({ dataDir: join(tmp, "store") });
  stores.push(store);
  return store;
}

const count = (store: Store, sql: string): number => store.prepare<[], number>(sql).pluck().get() ?? 0;

const triggerRow = (store: Store, id: number) =>
  store.prepare<[number], { enabled: number; next_fire_at: string | null; last_result: string | null; last_fired_at: string | null }>(
    "SELECT enabled, next_fire_at, last_result, last_fired_at FROM triggers WHERE id = ?",
  ).get(id);

const RESUME: Omit<ResumeSessionParams, "cwd"> = { permissionMode: "default", policy: { allowedTools: ["Read"], allowedBashPrefixes: [] } };

/** An `interrupted` row the kernel can resume, for `taskId` when given. */
function interruptedRow(store: Store, pluginDir: string, taskId: number | null = null): number {
  return Number(
    store
      .prepare(
        `INSERT INTO sessions (agent, task_id, status, sdk_session_id, model, loomwright_path, auth_account)
         VALUES ('wright', ?, 'interrupted', 'sid', ?, ?, ?)`,
      )
      .run(taskId, MODEL, pluginDir, PROVIDER.account).lastInsertRowid,
  );
}

/** The admission-side records a pause must never write: the budget's refusal and any notify. */
const budgetRecords = (store: Store) => ({ admission_refused: events(store, "admission_refused"), notify: events(store, "notify") });

// ---- The state ------------------------------------------------------------------

describe("the pause state: derived from the events log", () => {
  it("is off with no pause event; on from the first pause_engaged since the last release; off after pause_released", () => {
    const store = openStore();
    expect(pauseState(store)).toEqual({ paused: false, since: null });
    expect(isPaused(store)).toBe(false);
    engagePause(store, "2026-10-21T10:00:00.000Z", "api");
    engagePause(store, "2026-10-21T10:05:00.000Z", "cli");
    expect(pauseState(store)).toEqual({ paused: true, since: "2026-10-21T10:00:00.000Z" });
    expect(isPaused(store)).toBe(true);
    expect(releasePause(store, "2026-10-21T10:10:00.000Z", "api")).toBe(0);
    expect(pauseState(store)).toEqual({ paused: false, since: null });
    engagePause(store, "2026-10-21T10:20:00.000Z", "api");
    expect(pauseState(store)).toEqual({ paused: true, since: "2026-10-21T10:20:00.000Z" });
    // Every call is audited, actor kernel, payload {by: "owner", via}.
    expect(store.prepare("SELECT kind, actor, payload_json FROM events ORDER BY id").all()).toEqual([
      { kind: PAUSE_ENGAGED, actor: "kernel", payload_json: '{"by":"owner","via":"api"}' },
      { kind: PAUSE_ENGAGED, actor: "kernel", payload_json: '{"by":"owner","via":"cli"}' },
      { kind: PAUSE_RELEASED, actor: "kernel", payload_json: '{"by":"owner","via":"api"}' },
      { kind: PAUSE_ENGAGED, actor: "kernel", payload_json: '{"by":"owner","via":"api"}' },
    ]);
  });

  it("the release wakes only pending rows whose latest event_parked is the pause's, in the release's transaction", () => {
    const store = openStore();
    const later = "2026-10-21T11:00:00.000Z";
    const insert = (status: string, notBefore: string | null): number =>
      Number(
        store
          .prepare("INSERT INTO event_queue (kind, payload_json, status, enqueued_at, not_before) VALUES ('message', '{}', ?, ?, ?)")
          .run(status, START, notBefore).lastInsertRowid,
      );
    const parked = (id: number, reason: string): void => {
      store
        .prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES (?, 'event_parked', 'kernel', ?)")
        .run(START, JSON.stringify({ queue_id: id, kind: "message", reason, retry_at: null, not_before: later }));
    };
    const byPause = insert("pending", later);
    parked(byPause, "paused");
    const byCap = insert("pending", later);
    parked(byCap, "cap_parked");
    const pauseThenCap = insert("pending", later);
    parked(pauseThenCap, "paused");
    parked(pauseThenCap, "cap_parked");
    const done = insert("done", later);
    parked(done, "paused");
    const never = insert("pending", null);
    engagePause(store, START, "api");
    const release = "2026-10-21T10:30:00.000Z";
    expect(releasePause(store, release, "cli")).toBe(1);
    const notBefore = (id: number) => store.prepare<[number], string | null>("SELECT not_before FROM event_queue WHERE id = ?").pluck().get(id);
    expect(notBefore(byPause)).toBe(release);
    expect(notBefore(byCap)).toBe(later);
    expect(notBefore(pauseThenCap)).toBe(later);
    expect(notBefore(done)).toBe(later);
    expect(notBefore(never)).toBeNull();
    expect(events(store, PAUSE_RELEASED).map((e) => e.payload)).toEqual([{ by: "owner", via: "cli" }]);
  });
});

// ---- AC1: triggers ------------------------------------------------------------------

describe("triggers while paused (AC1)", () => {
  it("a once and a cron trigger due while paused are recorded missed_paused, one trigger_missed each, nothing queued; after the release the cron's next instant fires", () => {
    const store = openStore();
    const now = new Date(START);
    const once = registerTrigger(store, { agent: "wright", kind: "once", spec: "2026-10-21T11:00:00Z", action: "notify", text: "once" }, now);
    const cron = registerTrigger(store, { agent: "wright", kind: "cron", spec: "0 * * * *", tz: "UTC", action: "wake_agent", text: "hourly" }, now);
    engagePause(store, "2026-10-21T10:45:00.000Z", "api");

    // Processed while paused (the loop runs): recorded at once, never fired later.
    expect(fireDueTriggers(store, new Date("2026-10-21T11:00:30.000Z"))).toEqual([
      { trigger_id: once.id, scheduled_at: "2026-10-21T11:00:00.000Z", result: "missed_paused" },
      { trigger_id: cron.id, scheduled_at: "2026-10-21T11:00:00.000Z", result: "missed_paused" },
    ]);
    expect(triggerRow(store, once.id)).toEqual({ enabled: 0, next_fire_at: null, last_result: "missed_paused", last_fired_at: null });
    expect(triggerRow(store, cron.id)).toEqual({ enabled: 1, next_fire_at: "2026-10-21T12:00:00.000Z", last_result: "missed_paused", last_fired_at: null });
    const missed = events(store, "trigger_missed");
    expect(missed.map((e) => e.payload)).toEqual([
      expect.objectContaining({ trigger_id: once.id, reason: "paused", scheduled_at: "2026-10-21T11:00:00.000Z", missed_paused: 1, enabled: false }),
      expect.objectContaining({ trigger_id: cron.id, reason: "paused", scheduled_at: "2026-10-21T11:00:00.000Z", missed_paused: 1, enabled: true }),
    ]);
    for (const e of missed) expect(e.payload).not.toHaveProperty("missed_kill_switch");
    expect(events(store, "trigger_fired")).toEqual([]);
    expect(count(store, "SELECT count(*) FROM notifications")).toBe(0);
    expect(count(store, "SELECT count(*) FROM event_queue")).toBe(0);
    expect(events(store, "notify")).toEqual([]);
    // Never fired later: the instant's step is done.
    expect(fireDueTriggers(store, new Date("2026-10-21T11:01:00.000Z"))).toEqual([]);

    releasePause(store, "2026-10-21T11:30:00.000Z", "api");
    expect(fireDueTriggers(store, new Date("2026-10-21T12:00:30.000Z"))).toMatchObject([{ trigger_id: cron.id, result: "fired", queue_id: 1 }]);
    expect(triggerRow(store, cron.id)).toMatchObject({ last_result: "fired", next_fire_at: "2026-10-21T13:00:00.000Z" });
    const fired = events(store, "trigger_fired");
    expect(fired).toHaveLength(1);
    expect(fired[0]?.payload).toMatchObject({ trigger_id: cron.id, scheduled_at: "2026-10-21T12:00:00.000Z", missed: 0 });
    expect(fired[0]?.payload).not.toHaveProperty("missed_paused");
    expect(TRIGGER_RESULTS).toEqual(["fired", "missed_kill_switch", "missed_paused"]);
  });

  it("a cron whose missed instants straddle a past pause fires once for the ones outside it, carrying missed_paused", () => {
    const store = openStore();
    const cron = registerTrigger(store, { agent: "wright", kind: "cron", spec: "0 * * * *", tz: "UTC", action: "notify", text: "hourly" }, new Date(START));
    engagePause(store, "2026-10-21T10:45:00.000Z", "api");
    releasePause(store, "2026-10-21T11:30:00.000Z", "api");
    // The kernel was down from 10:30 to 12:05: 11:00 fell in the pause, 12:00 did not.
    expect(fireDueTriggers(store, new Date("2026-10-21T12:05:00.000Z"))).toMatchObject([{ trigger_id: cron.id, result: "fired" }]);
    expect(events(store, "trigger_fired")[0]?.payload).toMatchObject({ missed: 0, missed_paused: 1, latest_due_at: "2026-10-21T12:00:00.000Z" });
    expect(events(store, "trigger_missed")).toEqual([]);
  });

  it("an instant in both a kill-switch and a pause window is the kill switch's; an instant due just before the pause, processed during it, is the pause's", () => {
    const store = openStore();
    const now = new Date(START);
    const both = registerTrigger(store, { agent: "wright", kind: "once", spec: "2026-10-21T11:00:00Z", action: "notify", text: "both" }, now);
    engagePause(store, "2026-10-21T10:45:00.000Z", "api");
    engageKillSwitch(store, "2026-10-21T10:50:00.000Z");
    releaseKillSwitch(store, "2026-10-21T11:10:00.000Z");
    releasePause(store, "2026-10-21T11:20:00.000Z", "api");
    expect(fireDueTriggers(store, new Date("2026-10-21T11:30:00.000Z"))).toMatchObject([{ trigger_id: both.id, result: "missed_kill_switch" }]);
    expect(events(store, "trigger_missed")[0]?.payload).toMatchObject({ reason: "kill_switch", missed_kill_switch: 1 });
    expect(events(store, "trigger_missed")[0]?.payload).not.toHaveProperty("missed_paused");

    const early = registerTrigger(store, { agent: "wright", kind: "once", spec: "2026-10-21T11:59:59Z", action: "notify", text: "early" }, new Date("2026-10-21T11:30:00.000Z"));
    engagePause(store, "2026-10-21T12:00:00.000Z", "api");
    expect(fireDueTriggers(store, new Date("2026-10-21T12:00:01.000Z"))).toMatchObject([{ trigger_id: early.id, result: "missed_paused" }]);
    expect(count(store, "SELECT count(*) FROM notifications")).toBe(0);
  });
});

// ---- AC2: admission -----------------------------------------------------------------

describe("admission while paused (AC2)", () => {
  it("admissionFor refuses paused before asking the budget; its two-argument form never asks", () => {
    const asked: unknown[] = [];
    const budget = {
      checkPlaybook: (request: unknown) => {
        asked.push(request);
        return { admitted: true as const, provider: PROVIDER.id };
      },
    };
    let paused = true;
    const check = admissionFor(budget, PROVIDER.id, () => paused);
    const request = { kind: "start" as const, agent: "wright", account: PROVIDER.account, provider: PROVIDER.id, task: null };
    expect(check(request)).toEqual({ admitted: false, reason: "paused", retryAt: null });
    expect(asked).toEqual([]);
    paused = false;
    expect(check(request)).toEqual({ admitted: true });
    expect(asked).toHaveLength(1);
    expect(admissionFor(budget, PROVIDER.id)(request)).toEqual({ admitted: true });
  });

  it("POST /ask still queues; the start is refused paused and parked once, with no notify and no admission_refused; after POST /unpause it starts on the next tick", async () => {
    const clock = mutableClock(START);
    const { kernel, fakes, stub, api } = await startTestKernel({ clock });
    const store = kernel.store;
    expect(await (await api("POST", "/pause")).json()).toEqual({ paused: true });

    const ask = await api("POST", "/ask", { body: JSON.stringify({ text: "hello" }) });
    expect(ask.status).toBe(202);
    await vi.waitFor(() => expect(events(store, "event_parked")).toHaveLength(1), WAIT);
    await twoMoreTicks(stub.state);
    const parked = events(store, "event_parked");
    // Exactly one park for a pause shorter than DEFAULT_PARK_MS (the clock never moves here).
    expect(parked).toHaveLength(1);
    expect(parked[0]?.payload).toMatchObject({ kind: "message", reason: "paused", retry_at: null, not_before: new Date(Date.parse(START) + DEFAULT_PARK_MS).toISOString() });
    expect(budgetRecords(store)).toEqual({ admission_refused: [], notify: [] });
    expect(fakes.calls).toHaveLength(0);
    expect(count(store, "SELECT count(*) FROM sessions")).toBe(0);
    const queueId = parked[0]?.payload.queue_id as number;
    expect(store.prepare("SELECT status FROM brain_messages WHERE queue_id = ?").pluck().get(queueId)).toBe("parked");

    const release = clock.now().toISOString();
    expect(await (await api("POST", "/unpause")).json()).toEqual({ paused: false });
    const notBefore = store.prepare<[number], string | null>("SELECT not_before FROM event_queue WHERE id = ?").pluck().get(queueId);
    expect(notBefore !== null && notBefore !== undefined && notBefore <= release).toBe(true);
    await vi.waitFor(() => expect(fakes.calls).toHaveLength(1), WAIT);
    await vi.waitFor(() => expect(store.prepare("SELECT status FROM brain_messages WHERE queue_id = ?").pluck().get(queueId)).toBe("replied"), WAIT);
    expect(events(store, "event_parked")).toHaveLength(1);
    expect(budgetRecords(store)).toEqual({ admission_refused: [], notify: [] });
  }, 30_000);

  it("a queued brain message whose agent has an interrupted session (the resume path) is refused paused the same way, and resumes after the release", async () => {
    const clock = mutableClock(START);
    const { kernel, fakes, stub, pluginDir, api } = await startTestKernel({ clock });
    const store = kernel.store;
    const taskId = Number(store.prepare("INSERT INTO tasks (title, state) VALUES ('t', 'open')").run().lastInsertRowid);
    const interrupted = interruptedRow(store, pluginDir, taskId);
    await api("POST", "/pause");
    enqueueMessage(store, { text: "carry on", agent: "wright", taskId }, clock.now());
    await vi.waitFor(() => expect(events(store, "event_parked")).toHaveLength(1), WAIT);
    await twoMoreTicks(stub.state);
    expect(events(store, "event_parked").map((e) => e.payload.reason)).toEqual(["paused"]);
    expect(budgetRecords(store)).toEqual({ admission_refused: [], notify: [] });
    expect(fakes.calls).toHaveLength(0);
    expect(kernel.sessions.getSession(interrupted)?.status).toBe("interrupted");

    await api("POST", "/unpause");
    await vi.waitFor(() => expect(fakes.calls).toHaveLength(1), WAIT);
    expect(fakes.calls[0]?.options.resume).toBe("sid");
    await vi.waitFor(() => expect(kernel.sessions.getSession(interrupted)?.status).toBe("completed"), WAIT);
  }, 30_000);

  it("a direct start or resume while paused throws AdmissionRefusedError paused, touching no row", async () => {
    const clock = mutableClock(START);
    const { kernel, cwd, pluginDir, fakes } = await startTestKernel({ clock });
    const store = kernel.store;
    const id = interruptedRow(store, pluginDir);
    engagePause(store, clock.now().toISOString(), "api");
    const before = kernel.sessions.getSession(id);
    const resumed = await kernel.sessions.resumeSession(id, { ...RESUME, cwd }).catch((e: unknown) => e);
    expect(resumed).toBeInstanceOf(AdmissionRefusedError);
    expect(resumed).toMatchObject({ reason: "paused", retryAt: null });
    expect(kernel.sessions.getSession(id)).toEqual(before);
    const started = await kernel.sessions.startSession(startParams(cwd)).catch((e: unknown) => e);
    expect(started).toMatchObject({ reason: "paused", retryAt: null });
    expect(count(store, "SELECT count(*) FROM sessions")).toBe(1);
    expect(fakes.calls).toHaveLength(0);
    expect(budgetRecords(store)).toEqual({ admission_refused: [], notify: [] });
  }, 30_000);
});

// ---- AC3: running sessions ----------------------------------------------------------

describe("running sessions are untouched (AC3)", () => {
  it("a session running when the owner pauses is not stopped and ends with its own outcome", async () => {
    const clock = mutableClock(START);
    let live: FakeCall | undefined;
    const script = (call: FakeCall): void => {
      call.stream.push(fakeMsg.init(call.options.sessionId ?? "unknown"));
      live = call;
    };
    const { kernel, cwd, api, status } = await startTestKernel({ clock, script });
    const store = kernel.store;
    const handle = await kernel.sessions.startSession(startParams(cwd));
    await vi.waitFor(() => expect(kernel.sessions.getSession(handle.id)?.status).toBe("running"), WAIT);

    expect(await (await api("POST", "/pause")).json()).toEqual({ paused: true });
    // Give any stop a chance to run (the grace is 10 ms).
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(kernel.sessions.getSession(handle.id)?.status).toBe("running");
    expect((await status()).sessions.map((s) => s.id)).toEqual([handle.id]);
    expect(events(store, "session_stop_requested")).toEqual([]);
    expect(live?.child.exited).toBe(false);

    live?.stream.push(success("finished"));
    live?.stream.end();
    expect(await handle.done).toBe("completed");
    expect(events(store, "session_stop_requested")).toEqual([]);
    expect(isPaused(store)).toBe(true);
  }, 30_000);

  it("an auto-resume retry asking admission while paused is refused paused: the session goes back to interrupted, not failed", async () => {
    const clock = mutableClock(START);
    let pauseOnFirst: (() => void) | undefined;
    const script = (call: FakeCall, n: number): void => {
      call.stream.push(fakeMsg.init("sid"));
      // Attempt 1 fails; the owner pauses before the retry asks admission.
      if (n === 1) pauseOnFirst?.();
      call.stream.push(errorResult(["boom"]));
      call.stream.end();
    };
    const { kernel, cwd, pluginDir, fakes } = await startTestKernel({ clock, script });
    const store = kernel.store;
    pauseOnFirst = () => engagePause(store, clock.now().toISOString(), "api");
    const id = interruptedRow(store, pluginDir);
    const handle = await kernel.sessions.resumeSession(id, { ...RESUME, cwd });
    expect(await handle.done).toBe("interrupted");
    expect(fakes.calls).toHaveLength(1);
    const statuses = events(store, "session_status").filter((e) => e.session_id === id);
    expect(statuses.at(-1)?.payload).toMatchObject({ to: "interrupted", reason: "admission_refused", refusal: "paused", retry_at: null, attempt: 2 });
    expect(kernel.sessions.getSession(id)?.status).toBe("interrupted");
    expect(budgetRecords(store)).toEqual({ admission_refused: [], notify: [] });
  }, 30_000);
});

// ---- AC4: restart and resume --------------------------------------------------------

describe("the pause survives a restart, and POST /resume releases it (AC4)", () => {
  it("a new kernel over the same data dir is still paused, and a trigger due then is still recorded missed_paused", async () => {
    const clock = mutableClock(START);
    const first = await startTestKernel({ clock });
    await first.api("POST", "/pause");
    const trigger = registerTrigger(first.kernel.store, { agent: "wright", kind: "once", spec: "2026-10-21T11:00:00Z", action: "notify", text: "x" }, clock.now());
    await first.kernel.stop();

    const second = await startTestKernel({ clock, dataDir: first.dataDir });
    expect((await second.status()).paused).toBe(true);
    clock.set("2026-10-21T11:00:30.000Z");
    await vi.waitFor(() => expect(triggerRow(second.kernel.store, trigger.id)?.last_result).toBe("missed_paused"), WAIT);
    expect(events(second.kernel.store, "trigger_missed").map((e) => e.payload)).toEqual([expect.objectContaining({ trigger_id: trigger.id, reason: "paused" })]);
    expect(count(second.kernel.store, "SELECT count(*) FROM notifications")).toBe(0);
  }, 30_000);

  it("POST /resume with both the kill switch and the pause engaged releases both; with only a pause it releases that, via the client header", async () => {
    const clock = mutableClock(START);
    const { kernel, api, status } = await startTestKernel({ clock });
    const store = kernel.store;
    await api("POST", "/pause");
    await api("POST", "/stop-all");
    expect(await status()).toMatchObject({ kill_switch: { engaged: true }, paused: true });

    expect(await (await api("POST", "/resume")).json()).toEqual({ engaged: false });
    const kinds = events(store).map((e) => e.kind).filter((k) => k.startsWith("kill_switch") || k.startsWith("pause"));
    expect(kinds).toEqual(["pause_engaged", "kill_switch_engaged", "kill_switch_released", "pause_released"]);
    expect(await status()).toMatchObject({ kill_switch: { engaged: false, since: null }, paused: false });
    expect(events(store, PAUSE_RELEASED).map((e) => e.payload)).toEqual([{ by: "owner", via: "api" }]);

    await api("POST", "/pause");
    expect(await (await api("POST", "/resume", { headers: { "x-studio-client": "cli" } })).json()).toEqual({ engaged: false });
    expect((await status()).paused).toBe(false);
    expect(events(store, PAUSE_RELEASED).map((e) => e.payload)).toEqual([
      { by: "owner", via: "api" },
      { by: "owner", via: "cli" },
    ]);
    expect(events(store, "kill_switch_released")).toHaveLength(1);
    // Nothing to release: nothing appended.
    await api("POST", "/resume");
    expect(events(store, PAUSE_RELEASED)).toHaveLength(2);
  }, 30_000);
});

// ---- AC5: routes, status, CLI and the contract ----------------------------------------

describe("POST /pause, POST /unpause and GET /status (AC5)", () => {
  async function serve(store: Store) {
    const stopAll = vi.fn(async () => []);
    const api = await startApiServer(
      {
        store,
        sessions: { stopAll, abandonSession: unexpectedAbandon },
        loop: { start: () => {}, stop: async () => {} },
        authProviders: [],
        token: TOKEN,
        port: 0,
        routes: mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).routes,
      },
      { now: () => new Date(START) },
    );
    servers.push(api);
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`http://127.0.0.1:${api.port}${path}`, {
        method,
        headers: { Authorization: `Bearer ${TOKEN}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    return { call, stopAll };
  }

  it("status shows paused false, then true; pause and unpause answer PauseResponse and record {by: owner, via}; a no-op unpause appends nothing", async () => {
    const store = openStore();
    const { call, stopAll } = await serve(store);
    expect((await call("GET", "/status")).body.paused).toBe(false);
    expect(await call("POST", "/pause")).toEqual({ status: 200, body: { paused: true } });
    expect((await call("GET", "/status")).body.paused).toBe(true);
    expect(await call("POST", "/pause", { via: "cli" })).toEqual({ status: 200, body: { paused: true } });
    expect(await call("POST", "/unpause", { via: "cli" })).toEqual({ status: 200, body: { paused: false } });
    expect((await call("GET", "/status")).body.paused).toBe(false);
    expect(await call("POST", "/unpause")).toEqual({ status: 200, body: { paused: false } });
    expect(events(store).map((e) => [e.kind, e.payload])).toEqual([
      [PAUSE_ENGAGED, { by: "owner", via: "api" }],
      [PAUSE_ENGAGED, { by: "owner", via: "cli" }],
      [PAUSE_RELEASED, { by: "owner", via: "cli" }],
    ]);
    // Only `{via: "cli"}` labels the CLI; any other body is the API.
    await call("POST", "/pause", { via: "app" });
    expect(events(store, PAUSE_ENGAGED).at(-1)?.payload).toEqual({ by: "owner", via: "api" });
    expect(stopAll).not.toHaveBeenCalled();
  });

  it("runs its change on the request's POST queue; with no queue it answers 503 serialized_unavailable and records nothing", async () => {
    const store = openStore();
    const order: string[] = [];
    const serialized = async <T>(fn: () => Promise<T>): Promise<T> => {
      order.push("queued");
      const value = await fn();
      order.push("done");
      return value;
    };
    const req = (o: Partial<ContributedRouteRequest> = {}): ContributedRouteRequest => ({ params: {}, query: {}, body: undefined, store, now: () => new Date(START), ...o });
    const [pause, unpause] = pausePart.routes;
    expect(await pause?.handler(req())).toEqual({ status: 503, body: { error: "serialized_unavailable" } });
    expect(await unpause?.handler(req())).toEqual({ status: 503, body: { error: "serialized_unavailable" } });
    expect(events(store)).toEqual([]);
    expect(await pause?.handler(req({ serialized }))).toEqual({ status: 200, body: { paused: true } });
    expect(await unpause?.handler(req({ serialized }))).toEqual({ status: 200, body: { paused: false } });
    expect(order).toEqual(["queued", "done", "queued", "done"]);
    expect(events(store).map((e) => e.kind)).toEqual([PAUSE_ENGAGED, PAUSE_RELEASED]);
  });

  it("serves both item-05 contract routes, owner console; PauseResponse is {paused}; StatusBody declares paused", () => {
    const entries = [...contractText.matchAll(/^\s*\{ method: "([A-Z]+)", path: "([^"]+)", origin: "item-05" \},$/gm)].map((m) => `${m[1]} ${m[2]}`);
    expect(entries).toEqual(["POST /pause", "POST /unpause"]);
    const served = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).routes.map((r) => `${r.owner} ${r.method} ${r.path}`);
    for (const entry of entries) expect(served).toContain(`console ${entry}`);
    expect(/export interface PauseResponse \{([^}]*)\}/.exec(contractText)?.[1]).toMatch(/^\s*readonly paused: boolean;\s*$/);
    expect(contractText).toMatch(/^\s*readonly paused\?: boolean;$/m);
  });

  it("studio pause and studio unpause call the routes with via cli, print the state and exit 0", async () => {
    const clock = mutableClock(START);
    const { kernel, keychain, dataDir, status } = await startTestKernel({ clock });
    const paused = await studio(dataDir, keychain, ["pause"]);
    expect(paused).toMatchObject({ code: 0, stderr: "" });
    expect(paused.stdout).toMatch(/^paused: /);
    expect((await status()).paused).toBe(true);
    const unpaused = await studio(dataDir, keychain, ["unpause"]);
    expect(unpaused).toEqual({ code: 0, stdout: "not paused: new work runs\n", stderr: "" });
    expect((await status()).paused).toBe(false);
    expect(events(kernel.store).filter((e) => e.kind.startsWith("pause")).map((e) => [e.kind, e.payload])).toEqual([
      [PAUSE_ENGAGED, { by: "owner", via: "cli" }],
      [PAUSE_RELEASED, { by: "owner", via: "cli" }],
    ]);
  }, 30_000);

  it("the verbs print a refusal on stderr and exit 1, and refuse arguments with their usage (exit 2)", async () => {
    const [pause, unpause] = pausePart.subcommands ?? [];
    expect(pausePart.subcommands?.map((s) => [s.name, s.help])).toEqual([
      ["pause", "studio pause"],
      ["unpause", "studio unpause"],
    ]);
    const requests: unknown[][] = [];
    const client = (answer: { status: number; body: unknown }): CliApiClient => ({
      request: async (...args) => {
        requests.push(args);
        return answer;
      },
    });
    const out = () => {
      const o = { stdout: [] as string[], stderr: [] as string[] };
      return { o, output: { stdout: { write: (c: string) => o.stdout.push(c) }, stderr: { write: (c: string) => o.stderr.push(c) } } };
    };
    const refused = out();
    expect(await pause?.run([], client({ status: 503, body: { error: "serialized_unavailable" } }), refused.output)).toBe(1);
    expect(refused.o).toEqual({ stdout: [], stderr: ["studio: kernel API answered 503 to POST /pause: serialized_unavailable\n"] });
    const odd = out();
    expect(await unpause?.run([], client({ status: 200, body: { error: "\u001b[2J" } }), odd.output)).toBe(1);
    expect(odd.o.stderr).toEqual(["studio: kernel API answered 200 to POST /unpause: unknown\n"]);
    expect(requests).toEqual([
      ["POST", "/pause", { via: "cli" }],
      ["POST", "/unpause", { via: "cli" }],
    ]);
    const usage = out();
    expect(await pause?.run(["now"], client({ status: 200, body: { paused: true } }), usage.output)).toBe(2);
    expect(usage.o.stderr).toEqual(["usage: studio pause\n"]);
    expect(requests).toHaveLength(2);
  });
});
