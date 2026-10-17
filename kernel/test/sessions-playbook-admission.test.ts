// The per-playbook daily token limit in session admission (phase 3 exit
// check, AC1, AC2): the kernel's `admission` wiring (`admissionFor` in
// kernel/src/kernel.ts) asks the budget's playbook gate for every start and
// resume, so a playbook at its `token_limit_per_day` starts no session, and a
// session that is not a playbook's is admitted exactly as `Budget.check`
// admits it.
//
// Every test drives a real kernel from `startKernel` (so the shipped wiring
// is what is under test) with the fake spawner/query (session-fakes.ts):
// never the real SDK, a model or the network. One mutable clock is read by
// `KernelDeps.now`, `loopDeps.now` and the brain's message handler; the
// notifications feature's due work posts through a recording stub, so no
// real notification is ever shown. The budget day is the host's local day,
// so every expected day and retry time is computed with the budget's own
// `localDay` / `startOfNextLocalDay`, never written as a literal.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeychainError } from "../src/auth/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { brainContribution, brainMessageHandler, defaultWrightSettingsJson, wrightSettingsPath } from "../src/brain/index.js";
import type { LoomwrightSummary } from "../src/brain/index.js";
import { Budget, localDay, startOfNextLocalDay } from "../src/budget/index.js";
import { SHIPPED_CONTRIBUTIONS } from "../src/features/index.js";
import type { FeatureContribution } from "../src/features/index.js";
import { admissionFor, startKernel } from "../src/kernel.js";
import type { Kernel, KernelDeps } from "../src/kernel.js";
import type { DueWorkContext } from "../src/loop/types.js";
import { createDeliveryDueWork, notificationsContribution } from "../src/notifications/index.js";
import type { NotifierExec } from "../src/notifications/index.js";
import { createPlaybook } from "../src/playbooks/index.js";
import { AdmissionRefusedError } from "../src/sessions/index.js";
import type { ResumeSessionParams } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { errorResult, events } from "./budget-helpers.js";
import type { EventRow } from "./budget-helpers.js";
import type { FakeCall } from "./session-fakes.js";
import { fakeMsg, fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

/** 08:00 UTC: before the AC2 playbook's 09:00 UTC fire. */
const START = "2026-10-14T08:00:00.000Z";
const FIRE_AT = "2026-10-14T09:00:00.000Z";
/** A cap park's reset, when a test parks the provider. */
const RESET = "2026-10-14T13:00:00.000Z";
const MODEL = "claude-haiku-4-5";
const PLAYBOOK_MODEL = "claude-playbook-model-x";
const LIMIT = 1_000;
/** A trigger that never comes due in these tests (1 January), so only AC2's playbook fires. */
const NEVER_CRON = "0 0 1 1 *";
const UNAVAILABLE: LoomwrightSummary = { ok: false, reason: "not_installed (test)" };
const WAIT = { timeout: 10_000, interval: 10 };
const PROVIDER = stubProvider();

let tmp: string;
const kernels: Kernel[] = [];
const extraStores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-playbook-admission-"));
});

afterEach(async () => {
  for (const k of kernels.splice(0)) await k.stop();
  for (const s of extraStores.splice(0)) if (s.isOpen) s.close();
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
  const posts: string[] = [];
  const exec: NotifierExec = async (file) => {
    posts.push(file);
    return { status: 0, signal: null, timedOut: false, stdout: "", stderr: "" };
  };
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
  return { contributions, posts, state };
}

async function startTestKernel(o: { clock: ReturnType<typeof mutableClock>; script?: (call: FakeCall, n: number) => void }) {
  const dataDir = join(tmp, "data");
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
  return { kernel, fakes, stub, pluginDir, cwd };
}

/** Wait until at least two more loop ticks have started after now. */
async function twoMoreTicks(state: { ticks: number }): Promise<void> {
  const from = state.ticks;
  await vi.waitFor(() => expect(state.ticks).toBeGreaterThanOrEqual(from + 2), WAIT);
}

/** A playbook drafted through the store with `limit` tokens per day; `enabled` puts it in `enabled` directly. */
function playbook(
  store: Store,
  now: Date,
  o: { name?: string; limit?: number; cron?: string; enabled?: boolean } = {},
): { id: number; slug: string } {
  const change = createPlaybook(
    store,
    {
      agent: "wright",
      name: o.name ?? "Daily repo summary",
      intent: "Summarise what changed in repo X.",
      trigger: { kind: "cron", spec: o.cron ?? NEVER_CRON, tz: "UTC" },
      model: PLAYBOOK_MODEL,
      ...(o.limit === undefined ? {} : { token_limit: o.limit }),
    },
    now,
  );
  if (o.enabled === true) store.prepare("UPDATE playbooks SET status = 'enabled' WHERE id = ?").run(change.playbook.id);
  return { id: change.playbook.id, slug: change.playbook.slug };
}

/** A metered `budget` row for `playbook` on `day`: `counted` tokens (input only). */
function spend(store: Store, playbookId: number, day: string, counted: number): void {
  store
    .prepare("INSERT INTO budget (day, agent, playbook, model, input_tokens, cost_usd) VALUES (?, 'wright', ?, ?, ?, 0)")
    .run(day, String(playbookId), PLAYBOOK_MODEL, counted);
}

/** Park `PROVIDER` at its cap until `resetsAt`. */
function park(store: Store, resetsAt: string = RESET): void {
  store
    .prepare("INSERT INTO cap_state (account, rate_limit_type, status, resets_at, reset_source) VALUES (?, 'five_hour', 'rejected', ?, 'event')")
    .run(PROVIDER.id, resetsAt);
}

const sessionCount = (store: Store): number => store.prepare<[], number>("SELECT count(*) FROM sessions").pluck().get() ?? 0;

const playbookNotifies = (store: Store): EventRow[] => events(store, "notify").filter((e) => e.payload.reason === "playbook_daily_limit");

const RESUME: Omit<ResumeSessionParams, "cwd"> = { permissionMode: "default", policy: { allowedTools: ["Read"], allowedBashPrefixes: [] } };

/** An `interrupted` row the kernel can resume, run for `playbookId` when given. */
function interruptedRow(store: Store, pluginDir: string, playbookId: number | null): number {
  return Number(
    store
      .prepare(
        `INSERT INTO sessions (agent, status, sdk_session_id, model, loomwright_path, auth_account, playbook, playbook_version)
         VALUES ('wright', 'interrupted', 'sid', ?, ?, ?, ?, ?)`,
      )
      .run(MODEL, pluginDir, PROVIDER.account, playbookId, playbookId === null ? null : 1).lastInsertRowid,
  );
}

// ---- AC1: start ----------------------------------------------------------------

describe("the kernel's admission asks the playbook gate for a playbook's session (AC1)", () => {
  it("a playbook at its limit is refused playbook_daily_limit at start", async () => {
    const clock = mutableClock(START);
    const { kernel, fakes, cwd } = await startTestKernel({ clock });
    const store = kernel.store;
    const today = localDay(clock.now());
    const nextDay = startOfNextLocalDay(clock.now()).toISOString();
    const limited = playbook(store, clock.now(), { limit: LIMIT });
    const open = playbook(store, clock.now(), { name: "Weekly digest", limit: LIMIT });
    spend(store, limited.id, today, LIMIT);
    spend(store, open.id, today, LIMIT - 1);

    // A real start and a dry run alike: refused before any row or spawn.
    for (const dryRun of [false, true]) {
      const err = await kernel.sessions
        .startSession(startParams(cwd, { model: PLAYBOOK_MODEL, playbook: limited.id, playbookVersion: 1, dryRun }))
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AdmissionRefusedError);
      expect(err).toMatchObject({ code: "admission_refused", reason: "playbook_daily_limit", retryAt: nextDay });
    }
    expect(sessionCount(store)).toBe(0);
    expect(fakes.calls).toHaveLength(0);
    expect(events(store, "admission_refused").map((e) => e.payload)).toEqual([
      expect.objectContaining({ kind: "start", agent: "wright", provider: PROVIDER.id, playbook: limited.id, reason: "playbook_daily_limit", retry_at: nextDay }),
      expect.objectContaining({ kind: "start", agent: "wright", provider: PROVIDER.id, playbook: limited.id, reason: "playbook_daily_limit", retry_at: nextDay }),
    ]);

    // A playbook under its limit starts, recorded with its playbook.
    const handle = await kernel.sessions.startSession(startParams(cwd, { model: PLAYBOOK_MODEL, playbook: open.id, playbookVersion: 1 }));
    expect(await handle.done).toBe("completed");
    expect(kernel.sessions.getSession(handle.id)).toMatchObject({ playbook: open.id, playbook_version: 1 });
    expect(fakes.calls).toHaveLength(1);

    // The next budget day the limited playbook starts again (its counted tokens are the new day's).
    clock.set(nextDay);
    const later = await kernel.sessions.startSession(startParams(cwd, { model: PLAYBOOK_MODEL, playbook: limited.id, playbookVersion: 1 }));
    expect(await later.done).toBe("completed");
    expect(fakes.calls).toHaveLength(2);
  }, 30_000);

  it("a non-playbook start is admitted with exactly Budget.check's verdict and events", async () => {
    const clock = mutableClock(START);
    const { kernel, fakes, cwd } = await startTestKernel({ clock });
    const store = kernel.store;
    // A playbook at its limit exists: it does not touch a session that is not its own.
    const limited = playbook(store, clock.now(), { limit: LIMIT });
    spend(store, limited.id, localDay(clock.now()), LIMIT);

    const handle = await kernel.sessions.startSession(startParams(cwd));
    expect(await handle.done).toBe("completed");
    expect(kernel.sessions.getSession(handle.id)).toMatchObject({ playbook: null });
    expect(fakes.calls).toHaveLength(1);
    expect(events(store, "admission_refused")).toEqual([]);
    expect(events(store, "playbook_limit_reached")).toEqual([]);

    // At the cap: the kernel's refusal is `Budget.check`'s, verdict and events, on a fresh store in the same state.
    park(store);
    const err = await kernel.sessions.startSession(startParams(cwd)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdmissionRefusedError);
    const ref = new Store({ dataDir: join(tmp, "reference") });
    extraStores.push(ref);
    park(ref);
    const verdict = new Budget({ store: ref, authProvider: PROVIDER }, { now: clock.now }).check({
      kind: "start",
      agent: "wright",
      account: PROVIDER.account,
      provider: PROVIDER.id,
      task: null,
    });
    expect(verdict).toEqual({ admitted: false, reason: "cap_parked", retryAt: RESET });
    expect(err).toMatchObject({ reason: verdict.admitted ? undefined : verdict.reason, retryAt: verdict.admitted ? undefined : verdict.retryAt });
    const admissionEvents = (s: Store): EventRow[] => events(s).filter((e) => ["admission_refused", "notify", "playbook_limit_reached"].includes(e.kind));
    expect(admissionEvents(store)).toEqual(admissionEvents(ref));
    expect(admissionEvents(store)).toHaveLength(1);
    expect(admissionEvents(store)[0]?.payload).not.toHaveProperty("playbook");
    expect(fakes.calls).toHaveLength(1);
  }, 30_000);

  it("one playbook_limit_reached and one notify per playbook-day (a second refused start records neither)", async () => {
    const clock = mutableClock(START);
    const { kernel, fakes, cwd } = await startTestKernel({ clock });
    const store = kernel.store;
    const today = localDay(clock.now());
    const nextDay = startOfNextLocalDay(clock.now()).toISOString();
    const p = playbook(store, clock.now(), { limit: LIMIT });
    spend(store, p.id, today, LIMIT + 5);
    const start = () =>
      kernel.sessions.startSession(startParams(cwd, { model: PLAYBOOK_MODEL, playbook: p.id, playbookVersion: 1 })).catch((e: unknown) => e);

    expect(await start()).toMatchObject({ reason: "playbook_daily_limit" });
    expect(await start()).toMatchObject({ reason: "playbook_daily_limit" });
    clock.advance(60 * 60_000);
    expect(await start()).toMatchObject({ reason: "playbook_daily_limit" });

    expect(events(store, "admission_refused")).toHaveLength(3);
    const reached = events(store, "playbook_limit_reached");
    expect(reached).toHaveLength(1);
    expect(reached[0]?.payload).toEqual({ playbook: p.id, slug: p.slug, day: today, counted_tokens: LIMIT + 5, limit: LIMIT, retry_at: nextDay });
    expect(playbookNotifies(store)).toHaveLength(1);
    expect(playbookNotifies(store)[0]?.payload).toMatchObject({ provider: PROVIDER.id, reason: "playbook_daily_limit" });
    expect(fakes.calls).toHaveLength(0);

    // A new budget day at its limit again is a new playbook-day: one more of each.
    clock.set(nextDay);
    spend(store, p.id, localDay(clock.now()), LIMIT);
    expect(await start()).toMatchObject({ reason: "playbook_daily_limit", retryAt: startOfNextLocalDay(clock.now()).toISOString() });
    expect(await start()).toMatchObject({ reason: "playbook_daily_limit" });
    expect(events(store, "playbook_limit_reached")).toHaveLength(2);
    expect(playbookNotifies(store)).toHaveLength(2);
    expect(sessionCount(store)).toBe(0);
  }, 30_000);
});

// ---- AC1: resume and resume retries carry the playbook ------------------------------

describe("a playbook session's resume and resume retries ask the gate with its playbook (AC1)", () => {
  it("a refused resume's admission_refused event names the row's playbook; a non-playbook resume's names none", async () => {
    const clock = mutableClock(START);
    const { kernel, cwd, pluginDir } = await startTestKernel({ clock });
    const store = kernel.store;
    const p = playbook(store, clock.now(), { limit: LIMIT });
    // The limit gates starts only: a resume at the limit is not refused for it.
    spend(store, p.id, localDay(clock.now()), LIMIT);
    park(store);
    const withPlaybook = interruptedRow(store, pluginDir, p.id);
    const without = interruptedRow(store, pluginDir, null);

    for (const id of [withPlaybook, without]) {
      const before = kernel.sessions.getSession(id);
      const err = await kernel.sessions.resumeSession(id, { ...RESUME, cwd }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AdmissionRefusedError);
      expect(err).toMatchObject({ reason: "cap_parked", retryAt: RESET });
      expect(kernel.sessions.getSession(id)).toEqual(before);
    }
    const [first, second, ...more] = events(store, "admission_refused");
    expect(more).toEqual([]);
    expect(first?.payload).toMatchObject({ kind: "resume", playbook: p.id, reason: "cap_parked", api_key_fallback: "not_opted_in" });
    expect(second?.payload).toMatchObject({ kind: "resume", reason: "cap_parked" });
    expect(second?.payload).not.toHaveProperty("playbook");
    expect(events(store, "playbook_limit_reached")).toEqual([]);
  }, 30_000);

  it("a resume retry asks the gate with the row's playbook: refused at the cap, the session returns to interrupted", async () => {
    const clock = mutableClock(START);
    let parkOnFirst: (() => void) | undefined;
    const script = (call: FakeCall, n: number): void => {
      call.stream.push(fakeMsg.init("sid"));
      // Attempt 1 fails; the provider is parked before the retry asks admission.
      if (n === 1) parkOnFirst?.();
      call.stream.push(errorResult(["boom"]));
      call.stream.end();
    };
    const { kernel, cwd, pluginDir, fakes } = await startTestKernel({ clock, script });
    const store = kernel.store;
    parkOnFirst = () => park(store);
    const p = playbook(store, clock.now(), { limit: LIMIT });
    const id = interruptedRow(store, pluginDir, p.id);

    const handle = await kernel.sessions.resumeSession(id, { ...RESUME, cwd });
    expect(await handle.done).toBe("interrupted");
    expect(fakes.calls).toHaveLength(1);
    const status = events(store, "session_status").filter((e) => e.session_id === id);
    expect(status.at(-1)?.payload).toMatchObject({ to: "interrupted", reason: "admission_refused", refusal: "cap_parked", attempt: 2 });
    expect(events(store, "admission_refused").map((e) => e.payload)).toEqual([
      expect.objectContaining({ kind: "resume", playbook: p.id, reason: "cap_parked", api_key_fallback: "not_opted_in" }),
    ]);
  }, 30_000);
});

// ---- AC2: a playbook fire at its limit is parked ------------------------------------

describe("a playbook fire at its limit is parked by the loop (AC2)", () => {
  it("the fire's run row keeps {parked, retry_at}, the event is parked until retry_at, no session starts and no second notify", async () => {
    const clock = mutableClock(START);
    const { kernel, fakes, stub } = await startTestKernel({ clock });
    const store = kernel.store;
    const nextDay = startOfNextLocalDay(clock.now()).toISOString();
    const p = playbook(store, clock.now(), { limit: LIMIT, cron: "0 9 * * *", enabled: true });
    spend(store, p.id, localDay(clock.now()), LIMIT);
    await twoMoreTicks(stub.state);
    expect(events(store, "trigger_fired")).toEqual([]);

    clock.set(FIRE_AT);
    await vi.waitFor(() => expect(events(store, "event_parked")).toHaveLength(1), WAIT);

    const message = store
      .prepare<[], { id: number; status: string; not_before: string | null }>("SELECT id, status, not_before FROM event_queue WHERE kind = 'message'")
      .all();
    expect(message).toEqual([{ id: expect.any(Number), status: "pending", not_before: nextDay }]);
    expect(events(store, "event_parked")[0]?.payload).toMatchObject({
      queue_id: message[0]?.id,
      kind: "message",
      reason: "playbook_daily_limit",
      retry_at: nextDay,
      not_before: nextDay,
    });
    const runs = store
      .prepare<[], { playbook: number; kind: string; status: string; session_id: number | null; result_json: string | null }>(
        "SELECT playbook, kind, status, session_id, result_json FROM playbook_runs",
      )
      .all();
    expect(runs).toEqual([{ playbook: p.id, kind: "fire", status: "running", session_id: null, result_json: JSON.stringify({ parked: "playbook_daily_limit", retry_at: nextDay }) }]);
    expect(sessionCount(store)).toBe(0);
    expect(fakes.calls).toHaveLength(0);
    expect(events(store, "playbook_limit_reached")).toHaveLength(1);
    expect(playbookNotifies(store)).toHaveLength(1);

    // Later ticks before retry_at redeliver nothing: still one park, one refusal, one notify (D17).
    for (let i = 0; i < 3; i++) {
      clock.advance(60_000);
      await twoMoreTicks(stub.state);
    }
    expect(events(store, "event_parked")).toHaveLength(1);
    expect(events(store, "admission_refused")).toHaveLength(1);
    expect(playbookNotifies(store)).toHaveLength(1);
    expect(fakes.calls).toHaveLength(0);
    expect(stub.posts).toEqual([]);
  }, 30_000);
});

// ---- admissionFor ------------------------------------------------------------------

describe("admissionFor", () => {
  it("fails closed on an admit naming another provider, and passes a request with no playbook as playbook: null", () => {
    const seen: unknown[] = [];
    const request = { kind: "start" as const, agent: "wright", account: PROVIDER.account, provider: PROVIDER.id, task: null };
    const other = admissionFor(
      {
        checkPlaybook: (r) => {
          seen.push(r);
          return { admitted: true, provider: "api-key" };
        },
      },
      PROVIDER.id,
    );
    expect(() => other(request)).toThrow(/fail closed/);
    expect(seen).toEqual([{ ...request, playbook: null }]);

    const same = admissionFor({ checkPlaybook: () => ({ admitted: true, provider: PROVIDER.id }) }, PROVIDER.id);
    expect(same({ ...request, playbook: 7 })).toEqual({ admitted: true });
    const refused = admissionFor({ checkPlaybook: () => ({ admitted: false, reason: "playbook_daily_limit", retryAt: null }) }, PROVIDER.id);
    expect(refused(request)).toEqual({ admitted: false, reason: "playbook_daily_limit", retryAt: null });
  });
});
