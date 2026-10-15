// Opt-in live harness for the phase 2 exit check (item 08): the
// machine-observable parts of live steps 1, 3, 4 and 5 of
// docs/evidence/phase-2-exit-runbook.md. Never runs in CI or by default. The
// owner runs it on his Mac, after the runbook's setup (the kernel built, the
// launchd service installed with `studio service install`, Wright's model set
// in `config/agents/wright.json`):
//
//   cd kernel && npm run build && STUDIO_LIVE=1 npx vitest run test/phase-2-exit-live.test.ts
//
// Steps 1, 3 and 5 run against the launchd service the owner installed, on
// its own data dir (`STUDIO_DATA_DIR`, else `~/.loomwright-studio`), through
// the built `studio` CLI (`kernel/dist/cli/index.js`). They write reminder
// triggers into the owner's real store (Wright creates them from `studio
// ask`) and step 5 `kill -9`s the service's kernel (its pid read from
// `api.json` and checked against `launchctl print` first) so launchd restarts
// it. The harness never stops, uninstalls or reinstalls the service.
//
//   1. `studio ask "remind me at <HH:MM, 3 to 4 minutes ahead> to check X <tag>"`:
//      Wright's reply, the trigger row it created, and the notification row
//      at that minute with its deep link and delivery status.
//   3. A third reminder, turned off with `studio triggers off <id>` before
//      its time: no notification and no fire, ever.
//   5. A reminder, then `kill -9` of the service's kernel before its time;
//      launchd's restart (a new pid answering `studio status`); the reminder
//      fires exactly once.
//
// Step 4 runs against a kernel the harness starts itself, in this process,
// under a temp data dir: `installedPluginsPath` points at a temp
// `installed_plugins.json` that the harness switches between two temp
// installs holding copies of the active Loomwright's real `capabilities.json`
// (install B: `plugin_version` changed, one command added, one skill
// removed). It records the note file and the notification. That kernel posts
// through the real notifier (so one real notification appears) and runs no
// session (stub auth, an in-memory Keychain, fake sessions): it never reads
// a credential.
//
// What only the owner can see (the notification popping up, the click
// opening Terminal on `studio notifications show <id>`, the literal
// `remind me at 5pm` reminder at 17:00, step 2) is not here: the runbook
// lists it as fields he fills in.
//
// Every reminder the harness asks for carries a tag unique to the run and the
// step (`phase2-exit-<run>-step<N>`, so the text is `check X <tag>`, never the
// owner's step 2 `check X`), and is never for 17:00 local (the owner's step 2
// minute; see `harnessReminderMinute`), so an owner off of a harness trigger
// can't block the owner's reminder even if Wright drops the tag. A trigger
// counts as the harness's only when its owning agent is `wright` and either (a) the kernel recorded its
// `trigger_registered` event under the session of a Wright `ask` message whose
// text (the harness's own input, kept in `brain_messages`) carries the tag, or
// (b) its own text carries the tag. (a) is the kernel's provenance and does
// not depend on Wright copying the tag; (b) is the fallback. Any other trigger
// that appears on the service meanwhile (another agent's, the owner's, or one
// from a session the harness did not start, without the tag) is recorded in
// the summary and never touched.
//
// Cleanup: `afterEach` re-reads the current step's triggers by that rule (so
// one Wright registers after `studio ask` gave up, or once a parked ask runs,
// is caught) and turns off each one that is on (`studio triggers off <id>`);
// `afterAll` does the same for the run's tag (a late registration after its
// step ended). A trigger that is already off (a spent `once`, or one step 3
// turned off) is never written to: an owner off of it would record a turn-off
// the owner never made. It is listed in the cleanup as skipped, with why; a
// failed re-read is listed too, never skipped silently. The step 4 kernel is
// stopped and its temp dir removed. Nothing the harness did not start or
// create is stopped, turned off or removed.
//
// A run summary (timings, row counts, event kinds, the commit, the run tag;
// never env or tokens, and any `sk-ant-…` string redacted) is written after
// every step to the path printed at the start; the owner copies what he needs
// into the evidence file.
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { ASK_AGENT } from "../src/brain/index.js";
import { SHIPPED_CONTRIBUTIONS } from "../src/features/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel } from "../src/kernel.js";
import { resolveLoomwrightInstallWithText } from "../src/loomwright/active-install.js";
import { VERSION_NOTES_DIR, VERSION_NOTE_SOURCE, defaultInstalledPluginsPath } from "../src/loomwright/index.js";
import { createDeliveryDueWork, notificationsContribution } from "../src/notifications/index.js";
import { deepLinkFor } from "../src/notifications/record.js";
import { LAUNCHCTL_PATH, SERVICE_LABEL, parseLaunchctlPrint } from "../src/service/index.js";
import { resolveDataDir } from "../src/store/index.js";
import { tryDb, waitFor, withDb } from "./crash-helpers.js";
import { userEntry, writeInstalledPlugins, writeLoomwrightInstall } from "./fixtures/loomwright/helpers.js";
import { fakeSessions, stubProvider } from "./session-fakes.js";

const LIVE = process.env.STUDIO_LIVE === "1";

const KERNEL_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_DIR = fileURLToPath(new URL("../..", import.meta.url));
const CLI_PATH = join(KERNEL_DIR, "dist", "cli", "index.js");
const MINUTE = 60_000;
/** How long after a reminder's minute the harness waits for its notification (one tick, the delivery, slack). */
const FIRE_SLACK_MS = 90_000;
const STEP_TIMEOUT_MS = 15 * MINUTE;
/** The reply wait passed to every harness `studio ask` (the CLI's own default, made explicit). */
const ASK_TIMEOUT_S = 120;
/** The `studio ask` process timeout: above the CLI's own wait, so the CLI always reports its own outcome. */
const ASK_PROCESS_TIMEOUT_MS = (ASK_TIMEOUT_S + 30) * 1_000;

/** Replace anything token-shaped before it is written anywhere. */
function redact(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-[REDACTED]");
}

/** At most `max` characters of model or CLI output for the summary, redacted. */
function clipped(text: string, max = 1_000): string {
  const r = redact(text);
  return r.length > max ? `${r.slice(0, max)}…` : r;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The local minute of the owner's step 2 reminder (`remind me at 5pm`). The harness never asks for a reminder at it. */
export const OWNER_STEP2_HHMM = "17:00";

/** `ms` as a local `HH:MM` (24-hour), the form the harness puts in its `remind me at …` text. */
const localHHMM = (ms: number): string => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));

/**
 * The minute every harness reminder (steps 1, 3 and 5) is for, from `now`:
 * the next whole local minute at least 3 minutes ahead, as `HH:MM` and its
 * instant, moved one minute later when that is 17:00 local. A harness trigger
 * is turned off by the owner (step 3, and cleanup of rows still on), and the
 * kernel refuses a Wright registration that matches an owner-off trigger's
 * kind, schedule, action and text (`owner_off`); a harness reminder whose tag
 * Wright dropped is stored as plain `check X`, so at 17:00 it would match the
 * owner's step 2 reminder and block it. Never at 17:00, it can't. Refuses
 * (throws) when the minute, after that move, would fall on another local day
 * than `now`: it never rolls into tomorrow.
 */
export function harnessReminderMinute(now: number): { hhmm: string; at: string } {
  let ms = Math.ceil((now + 3 * MINUTE) / MINUTE) * MINUTE;
  if (localHHMM(ms) === OWNER_STEP2_HHMM) ms += MINUTE;
  if (new Date(ms).toDateString() !== new Date(now).toDateString()) {
    throw new Error("the reminder minute would fall after midnight; run the harness between 00:00 and 23:55 local time");
  }
  return { hhmm: localHHMM(ms), at: new Date(ms).toISOString() };
}

// Deterministic (runs in CI, no service): the reminder minute's guarantees.
describe("harnessReminderMinute", () => {
  const local = (h: number, m: number, s = 0): number => new Date(2026, 9, 15, h, m, s).getTime();

  it("never returns 17:00 local, and stays at least 3 minutes and at most 5 minutes ahead, for every start from 16:50 to 17:05", () => {
    for (let now = local(16, 50); now <= local(17, 5); now += 5_000) {
      const { hhmm, at } = harnessReminderMinute(now);
      expect(hhmm, new Date(now).toString()).not.toBe(OWNER_STEP2_HHMM);
      expect(hhmm).toBe(localHHMM(Date.parse(at)));
      expect(Date.parse(at) - now).toBeGreaterThanOrEqual(3 * MINUTE);
      expect(Date.parse(at) - now).toBeLessThan(5 * MINUTE);
    }
  });

  it("moves a 17:00 minute to 17:01, and leaves 16:59 and 17:02 alone", () => {
    expect(harnessReminderMinute(local(16, 56, 30)).hhmm).toBe("17:01");
    expect(harnessReminderMinute(local(16, 57)).hhmm).toBe("17:01");
    expect(harnessReminderMinute(local(16, 55, 30)).hhmm).toBe("16:59");
    expect(harnessReminderMinute(local(16, 58, 30)).hhmm).toBe("17:02");
  });

  it("refuses a minute after midnight instead of rolling into the next day", () => {
    expect(harnessReminderMinute(local(23, 56)).hhmm).toBe("23:59");
    expect(() => harnessReminderMinute(local(23, 56, 1))).toThrow(/after midnight/);
    expect(() => harnessReminderMinute(local(23, 59, 59))).toThrow(/after midnight/);
  });
});

/** A trigger the harness counts as its own, and which rule matched it. */
export interface HarnessTriggerRow {
  readonly id: number;
  readonly owning_agent: string;
  readonly kind: string;
  readonly action: string;
  readonly enabled: number;
  readonly next_fire_at: string | null;
  /** 1: registered (per its `trigger_registered` event) by the session of a Wright `ask` whose text carries the tag. */
  readonly by_session: number;
  /** 1: its own text carries the tag. */
  readonly by_tag: number;
}

/**
 * The harness's triggers for `tag` (a step's tag, or the run's tag for all of
 * them): owned by `agent`, and either registered by the session of an `ask`
 * message to `agent` whose text (the harness's own input) carries the tag, or
 * whose own text carries it. The session rule is kernel-recorded provenance
 * (`brain_messages.session_id`, set when the session starts; the session id on
 * the `trigger_registered` event row) and holds when Wright drops the tag; an
 * `ask` without a session yet (queued or parked) selects nothing until its
 * session runs, so callers re-read. Every `ask` starts its own session (no
 * task, so the brain never resumes one), so the owner's untagged ask never
 * shares a session with the harness's.
 */
export const HARNESS_TRIGGERS_SQL = `
WITH harness_sessions AS (
  SELECT DISTINCT session_id FROM brain_messages
   WHERE agent = :agent AND source = 'ask' AND session_id IS NOT NULL AND instr(lower(text), :tag) > 0
),
session_triggers AS (
  SELECT DISTINCT json_extract(payload_json, '$.trigger_id') AS trigger_id FROM events
   WHERE kind = 'trigger_registered' AND json_valid(payload_json) AND session_id IN (SELECT session_id FROM harness_sessions)
)
SELECT t.id, t.owning_agent, t.kind, t.action, t.enabled, t.next_fire_at,
       (t.id IN (SELECT trigger_id FROM session_triggers)) AS by_session,
       (instr(lower(t.action_payload), :tag) > 0) AS by_tag
  FROM triggers t
 WHERE t.owning_agent = :agent
   AND (t.id IN (SELECT trigger_id FROM session_triggers) OR instr(lower(t.action_payload), :tag) > 0)
 ORDER BY t.id`;

export function harnessTriggerRows(db: Database.Database, agent: string, tag: string): HarnessTriggerRow[] {
  return db.prepare<[{ agent: string; tag: string }], HarnessTriggerRow>(HARNESS_TRIGGERS_SQL).all({ agent, tag: tag.toLowerCase() });
}

describe.skipIf(!LIVE)("live phase 2 exit: reminders on the launchd service, a version change on a harness kernel (STUDIO_LIVE=1)", () => {
  const dataDir = resolveDataDir(process.env);
  const summaryPath = join(tmpdir(), `studio-phase-2-exit-live-summary-${Date.now()}.json`);
  const summary: Record<string, unknown> & { steps: Record<string, Record<string, unknown>> } = { test: "phase-2-exit-live", steps: {} };
  /** Unique to this run; every reminder text the harness asks for contains it (lowercase, so a case change by Wright still matches). */
  const runTag = `phase2-exit-${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  summary.run_tag = runTag;
  /** The per-step tags asked for in the current test (re-read in `afterEach`). */
  const stepTags = new Set<string>();
  /** Triggers this harness created on the service in the current test (turned off in `afterEach`). */
  const created = new Set<number>();
  type When = "after_each" | "after_all";
  /** Every trigger the harness created and what cleanup did with it: turned off, skipped (not on, so never written), or a re-read that failed. */
  const cleanup: (
    | { trigger_id: number; when: When; off_exit: number; off_output: string }
    | { trigger_id: number; when: When; skipped: "already_spent" | "already_off" | "gone"; last_result?: string | null; enabled_changed_by?: string | null }
    | { when: When; reread_failed: string }
  )[] = [];
  let ownKernel: Kernel | undefined;
  let ownTmp: string | undefined;

  function writeSummary(): void {
    writeFileSync(summaryPath, `${redact(JSON.stringify({ ...summary, cleanup }, null, 2))}\n`, { mode: 0o600 });
  }

  /** The built `studio` CLI against the service's data dir. Its env is never recorded. */
  function studio(args: readonly string[], timeoutMs = 200_000): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        [CLI_PATH, ...args],
        { env: { ...process.env, STUDIO_DATA_DIR: dataDir }, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const code = err === null ? 0 : typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1;
          resolve({ code, stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
  }

  /** The service's kernel pid as `launchctl print` reports it, or `undefined`. */
  function launchdPid(): number | undefined {
    try {
      const uid = process.getuid?.() ?? 0;
      const out = execFileSync(LAUNCHCTL_PATH, ["print", `gui/${uid}/${SERVICE_LABEL}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1024 * 1024 });
      return parseLaunchctlPrint(out).pid;
    } catch {
      return undefined;
    }
  }

  /** The pid `<dataDir>/api.json` names, or `undefined`. */
  function apiPid(): number | undefined {
    try {
      const pid = (JSON.parse(readFileSync(join(dataDir, "api.json"), "utf8")) as { pid?: unknown }).pid;
      return typeof pid === "number" ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  /** The pid `studio status --json` reports, or `undefined` when the kernel does not answer. */
  async function statusPid(): Promise<number | undefined> {
    const r = await studio(["status", "--json"], 15_000);
    if (r.code !== 0) return undefined;
    try {
      const pid = (JSON.parse(r.stdout) as { kernel?: { pid?: unknown } }).kernel?.pid;
      return typeof pid === "number" ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  const scalar = (sql: string, ...p: unknown[]): unknown => withDb(dataDir, (db) => db.prepare(sql).pluck().get(...p));

  /** The minute for a harness reminder asked for now (see `harnessReminderMinute`: never 17:00 local, never past midnight). */
  const reminderMinute = (): { hhmm: string; at: string } => harnessReminderMinute(Date.now());

  /** The triggers provably the harness's for `tag` (see `HARNESS_TRIGGERS_SQL`). Nothing else is ever turned off. */
  const harnessTriggers = (tag: string) => withDb(dataDir, (db) => harnessTriggerRows(db, ASK_AGENT, tag));

  /**
   * `studio triggers off <id>`, as the owner, for each id whose row is on when
   * re-read just before; a row that is not on (a spent `once`, one already
   * turned off) is never written to, since an owner off of it would record a
   * turn-off the owner never made. Every id is recorded in the cleanup list:
   * turned off, skipped with why, or a re-read that failed (no write then).
   */
  async function turnOffIfOn(ids: Iterable<number>, when: When): Promise<void> {
    for (const id of ids) {
      const read = tryDb(dataDir, (db) => ({
        row: db
          .prepare<[number], { enabled: number; kind: string; last_result: string | null; enabled_changed_by: string | null }>(
            "SELECT enabled, kind, last_result, enabled_changed_by FROM triggers WHERE id = ?",
          )
          .get(id),
      }));
      if (read === undefined) {
        cleanup.push({ when, reread_failed: `trigger:${id}` });
        continue;
      }
      const row = read.row;
      if (row === undefined) {
        cleanup.push({ trigger_id: id, when, skipped: "gone" });
        continue;
      }
      if (row.enabled !== 1) {
        const spent = row.kind === "once" && row.last_result !== null;
        cleanup.push({ trigger_id: id, when, skipped: spent ? "already_spent" : "already_off", last_result: row.last_result, enabled_changed_by: row.enabled_changed_by });
        continue;
      }
      const r = await studio(["triggers", "off", String(id)], 30_000);
      cleanup.push({ trigger_id: id, when, off_exit: r.code, off_output: clipped((r.stdout + r.stderr).trim(), 300) });
    }
  }

  /**
   * `studio ask` a reminder for `hhmm` whose text carries `step`'s unique tag;
   * returns the one trigger that is the harness's for that tag (registered by
   * that ask's session, or carrying the tag; tracked for cleanup). Other
   * triggers that appeared meanwhile are recorded, never touched.
   */
  async function askReminder(rec: Record<string, unknown>, hhmm: string, step: string): Promise<{ id: number; next_fire_at: string | null }> {
    const tag = `${runTag}-${step}`;
    stepTags.add(tag);
    const before = Number(scalar("SELECT coalesce(max(id), 0) FROM triggers"));
    const text = `remind me at ${hhmm} to check X ${tag}`;
    const t = Date.now();
    const r = await studio(["ask", text, "--timeout", String(ASK_TIMEOUT_S)], ASK_PROCESS_TIMEOUT_MS);
    rec.ask = { text, tag, exit: r.code, reply: clipped(r.stdout.trim()), stderr: clipped(r.stderr.trim()), took_ms: Date.now() - t };
    const rows = harnessTriggers(tag);
    for (const row of rows) created.add(row.id);
    rec.triggers_created = rows;
    // Not the harness's (no Wright owner, or neither the ask's session nor the tag): ids and owners only, left as they are.
    rec.other_new_triggers = withDb(dataDir, (db) =>
      db
        .prepare<[number], { id: number; owning_agent: string; kind: string; created_by: string; enabled: number }>(
          "SELECT id, owning_agent, kind, created_by, enabled FROM triggers WHERE id > ? ORDER BY id",
        )
        .all(before),
    ).filter((o) => !rows.some((x) => x.id === o.id));
    expect(r.code, clipped(r.stderr)).toBe(0);
    expect(rows, "exactly one Wright trigger from the step's ask (its session or its tag)").toHaveLength(1);
    const row = rows[0] as (typeof rows)[number];
    // `studio triggers --all --json`, this trigger only (the owner's other triggers are not recorded).
    const listed = await studio(["triggers", "--all", "--json"], 15_000);
    const entry = (JSON.parse(listed.stdout) as { triggers: { id: number }[] }).triggers.find((x) => x.id === row.id);
    rec.studio_triggers_entry = entry ?? null;
    return { id: row.id, next_fire_at: row.next_fire_at };
  }

  /** Notifications whose source is trigger `id`, read on `db` (the caller's one connection). */
  const triggerNotificationsIn = (db: Database.Database, id: number) =>
    db
      .prepare<[string], { id: number; source: string; title: string; deep_link: string; created_at: string; delivery_status: string; delivery_detail: string | null; delivered_at: string | null }>(
        "SELECT id, source, title, deep_link, created_at, delivery_status, delivery_detail, delivered_at FROM notifications WHERE source = ? ORDER BY id",
      )
      .all(`trigger:${id}`);

  /** Notifications whose source is trigger `id`. */
  const triggerNotifications = (id: number) => withDb(dataDir, (db) => triggerNotificationsIn(db, id));

  /** `trigger_*` audit events about trigger `id`, by kind. */
  const triggerEvents = (id: number): Record<string, number> =>
    Object.fromEntries(
      withDb(dataDir, (db) =>
        db
          .prepare<[number], { kind: string; n: number }>(
            "SELECT kind, count(*) AS n FROM events WHERE kind LIKE 'trigger_%' AND json_valid(payload_json) AND json_extract(payload_json, '$.trigger_id') = ? GROUP BY kind ORDER BY kind",
          )
          .all(id),
      ).map((k) => [k.kind, k.n]),
    );

  /** Event kinds the service recorded after event `fromId`, with counts. */
  const eventKindsSince = (fromId: number): Record<string, number> =>
    Object.fromEntries(
      withDb(dataDir, (db) => db.prepare<[number], { kind: string; n: number }>("SELECT kind, count(*) AS n FROM events WHERE id > ? GROUP BY kind ORDER BY kind").all(fromId)).map(
        (k) => [k.kind, k.n],
      ),
    );

  /** Run one step, recording its outcome (and the failure, as a finding) in the summary. */
  async function step(name: string, body: (rec: Record<string, unknown>) => Promise<void>): Promise<void> {
    const rec: Record<string, unknown> = { outcome: "running", started_at: new Date().toISOString() };
    summary.steps[name] = rec;
    const t = Date.now();
    try {
      await body(rec);
      rec.outcome = "passed";
    } catch (err) {
      rec.outcome = "failed";
      rec.finding = clipped(err instanceof Error ? err.message : String(err), 2_000);
      throw err;
    } finally {
      rec.took_ms = Date.now() - t;
      writeSummary();
    }
  }

  beforeAll(async () => {
    console.log(`phase-2-exit-live summary: ${summaryPath} (run tag ${runTag})`);
    expect(process.platform, "the live harness runs on macOS only").toBe("darwin");
    expect(existsSync(CLI_PATH), `${CLI_PATH} is missing: run npm run build first`).toBe(true);
    let commit = "unknown";
    let dirty: boolean | null = null;
    try {
      commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_DIR, encoding: "utf8" }).trim();
      dirty = execFileSync("git", ["status", "--porcelain"], { cwd: REPO_DIR, encoding: "utf8" }).trim() !== "";
    } catch {
      // Not a git checkout: recorded as unknown.
    }
    const launchd = launchdPid();
    const api = apiPid();
    const status = await statusPid();
    Object.assign(summary, { at: new Date().toISOString(), commit, dirty_worktree: dirty, service: { launchd_pid: launchd ?? null, api_json_pid: api ?? null, status_pid: status ?? null } });
    writeSummary();
    expect(launchd, `${SERVICE_LABEL} is not running under launchd: install it with studio service install (runbook setup)`).toBeDefined();
    expect(api, "api.json names another kernel than launchd runs").toBe(launchd);
    expect(status, "studio status did not answer with the service's pid").toBe(launchd);
  }, 60_000);

  afterEach(async () => {
    // Re-read: a trigger Wright registered after `studio ask` returned (no reply in time, or a parked ask whose session ran later) is the harness's too.
    for (const tag of stepTags) {
      const rows = tryDb(dataDir, (db) => harnessTriggerRows(db, ASK_AGENT, tag));
      if (rows === undefined) cleanup.push({ when: "after_each", reread_failed: tag });
      for (const row of rows ?? []) created.add(row.id);
    }
    stepTags.clear();
    await turnOffIfOn(created, "after_each");
    created.clear();
    if (ownKernel !== undefined) await ownKernel.stop();
    ownKernel = undefined;
    if (ownTmp !== undefined) rmSync(ownTmp, { recursive: true, force: true });
    ownTmp = undefined;
    writeSummary();
  }, 120_000);

  afterAll(async () => {
    // One of the harness's triggers still on here was registered after its step's cleanup (a session that outlived the step).
    const rows = tryDb(dataDir, (db) => harnessTriggerRows(db, ASK_AGENT, runTag));
    if (rows === undefined) cleanup.push({ when: "after_all", reread_failed: runTag });
    // Still on, or never seen by an `afterEach` (recorded as skipped when it is already spent or off).
    const recorded = new Set(cleanup.flatMap((c) => ("trigger_id" in c ? [c.trigger_id] : [])));
    await turnOffIfOn((rows ?? []).filter((row) => row.enabled === 1 || !recorded.has(row.id)).map((row) => row.id), "after_all");
    summary.finished_at = new Date().toISOString();
    writeSummary();
    console.log(`phase-2-exit-live summary: ${summaryPath} (run tag ${runTag})`);
  }, 120_000);

  it(
    "step 1: studio ask a reminder 3 minutes ahead; Wright's trigger fires one notification at that minute",
    () =>
      step("1_reminder_fires", async (rec) => {
        const firstEvent = Number(scalar("SELECT coalesce(max(id), 0) FROM events"));
        const { hhmm, at } = reminderMinute();
        rec.reminder = { hhmm, expected_fire_at: at };
        const trigger = await askReminder(rec, hhmm, "step1");
        expect(trigger.next_fire_at, "Wright's trigger is not for the minute asked").toBe(at);
        const notes = await waitFor(
          "the reminder's notification, delivered or settled",
          () => {
            const n = tryDb(dataDir, (db) => triggerNotificationsIn(db, trigger.id));
            return n !== undefined && n.length > 0 && n.every((x) => x.delivery_status !== "pending") ? n : undefined;
          },
          Date.parse(at) - Date.now() + FIRE_SLACK_MS,
          1_000,
        );
        rec.notifications = notes;
        rec.fired_late_ms = Date.parse(notes[0]?.created_at ?? at) - Date.parse(at);
        rec.trigger_events = triggerEvents(trigger.id);
        rec.event_kinds = eventKindsSince(firstEvent);
        expect(notes).toHaveLength(1);
        const note = notes[0] as (typeof notes)[number];
        expect(note.deep_link).toBe(deepLinkFor(note.id));
        expect(notes[0]?.delivery_status).toBe("delivered");
        expect(rec.trigger_events).toMatchObject({ trigger_fired: 1 });
      }),
    STEP_TIMEOUT_MS,
  );

  it(
    "step 3: a third reminder turned off with studio triggers off before its time never fires",
    () =>
      step("3_reminder_off", async (rec) => {
        const firstEvent = Number(scalar("SELECT coalesce(max(id), 0) FROM events"));
        const { hhmm, at } = reminderMinute();
        rec.reminder = { hhmm, expected_fire_at: at };
        const trigger = await askReminder(rec, hhmm, "step3");
        // An owner off of a row that is not on would be a write he never made: check first, and fail without writing.
        rec.enabled_before_off = withDb(dataDir, (db) => db.prepare("SELECT enabled FROM triggers WHERE id = ?").pluck().get(trigger.id)) ?? null;
        expect(rec.enabled_before_off, "the trigger is on before studio triggers off").toBe(1);
        const off = await studio(["triggers", "off", String(trigger.id)], 30_000);
        rec.off = { exit: off.code, output: clipped((off.stdout + off.stderr).trim(), 300), at: new Date().toISOString() };
        expect(off.code, clipped(off.stderr)).toBe(0);
        expect(Date.now(), "the off came after the reminder's time").toBeLessThan(Date.parse(at));
        // Past its minute, plus the slack a fire would have needed.
        await sleep(Math.max(0, Date.parse(at) - Date.now() + FIRE_SLACK_MS));
        rec.notifications = triggerNotifications(trigger.id);
        rec.trigger_events = triggerEvents(trigger.id);
        rec.trigger_row = withDb(dataDir, (db) =>
          db.prepare("SELECT id, enabled, enabled_changed_by, next_fire_at, last_fired_at, last_result FROM triggers WHERE id = ?").get(trigger.id),
        );
        rec.event_kinds = eventKindsSince(firstEvent);
        expect(rec.notifications).toEqual([]);
        expect(rec.trigger_events).not.toHaveProperty("trigger_fired");
        expect(rec.trigger_row).toMatchObject({ enabled: 0, enabled_changed_by: "owner", last_fired_at: null, last_result: null });
      }),
    STEP_TIMEOUT_MS,
  );

  it(
    "step 5: kill -9 of the service's kernel between a reminder and its time; launchd restarts it; the reminder fires once",
    () =>
      step("5_kill_9_restart", async (rec) => {
        const firstEvent = Number(scalar("SELECT coalesce(max(id), 0) FROM events"));
        const { hhmm, at } = reminderMinute();
        rec.reminder = { hhmm, expected_fire_at: at };
        const trigger = await askReminder(rec, hhmm, "step5");
        expect(trigger.next_fire_at, "Wright's trigger is not for the minute asked").toBe(at);
        const oldLaunchd = launchdPid();
        const oldApi = apiPid();
        rec.before_kill = { launchd_pid: oldLaunchd ?? null, api_json_pid: oldApi ?? null };
        // Only the pid launchd runs as this service, and only when api.json names the same one.
        expect(oldLaunchd).toBeDefined();
        expect(oldApi).toBe(oldLaunchd);
        const oldPid = oldLaunchd as number;
        expect(Date.now(), "no time left to kill before the reminder").toBeLessThan(Date.parse(at) - 30_000);
        const killedAt = Date.now();
        process.kill(oldPid, "SIGKILL");
        rec.killed = { pid: oldPid, at: new Date(killedAt).toISOString() };
        // launchd's ThrottleInterval is 60 s; allow for it plus the start.
        const newPid = await (async () => {
          const deadline = Date.now() + 3 * MINUTE;
          for (;;) {
            const l = launchdPid();
            if (l !== undefined && l !== oldPid && (await statusPid()) === l) return l;
            if (Date.now() > deadline) throw new Error("launchd did not restart the kernel within 3 minutes (no new pid answering studio status)");
            await sleep(1_000);
          }
        })();
        rec.restarted = { pid: newPid, api_json_pid: apiPid() ?? null, after_ms: Date.now() - killedAt };
        expect(Date.now(), "the restart came after the reminder's time").toBeLessThan(Date.parse(at));
        const notes = await waitFor(
          "the reminder's notification after the restart",
          () => {
            const n = tryDb(dataDir, (db) => triggerNotificationsIn(db, trigger.id));
            return n !== undefined && n.length > 0 && n.every((x) => x.delivery_status !== "pending") ? n : undefined;
          },
          Date.parse(at) - Date.now() + FIRE_SLACK_MS,
          1_000,
        );
        // A little longer: a second fire would show up here.
        await sleep(15_000);
        rec.notifications = triggerNotifications(trigger.id);
        rec.trigger_events = triggerEvents(trigger.id);
        rec.event_kinds = eventKindsSince(firstEvent);
        rec.fired_late_ms = Date.parse(notes[0]?.created_at ?? at) - Date.parse(at);
        expect(rec.notifications).toHaveLength(1);
        expect(rec.trigger_events).toMatchObject({ trigger_fired: 1 });
      }),
    STEP_TIMEOUT_MS,
  );

  it(
    "step 4: a harness kernel switched between two copies of the real contract writes one note and one notification",
    () =>
      step("4_version_change", async (rec) => {
        // The active Loomwright's real contract, read once (read-only).
        const real = resolveLoomwrightInstallWithText({ installedPluginsPath: defaultInstalledPluginsPath() });
        const contract = JSON.parse(real.contractText) as Record<string, unknown>;
        const fromVersion = String(contract.plugin_version);
        const toVersion = `${fromVersion}-phase2-exit-test`;
        const changed: Record<string, unknown> = { ...contract, plugin_version: toVersion };
        const commands = Array.isArray(contract.commands) ? [...(contract.commands as unknown[])] : [];
        commands.push({ name: "phase-2-exit-added", description: "Added by the phase 2 exit harness (a test copy, not a real release)." });
        changed.commands = commands;
        const skills = Array.isArray(contract.skills) ? (contract.skills as { name?: unknown }[]) : [];
        const removedSkill = skills[0]?.name ?? null;
        changed.skills = skills.slice(1);

        const dir = mkdtempSync(join(tmpdir(), "studio-phase2-exit-live-"));
        ownTmp = dir;
        const ownData = join(dir, "data");
        const pluginsFile = join(dir, "claude", "plugins", "installed_plugins.json");
        const installA = writeLoomwrightInstall(join(dir, "cache", "a"), { raw: real.contractText });
        const installB = writeLoomwrightInstall(join(dir, "cache", "b"), changed);
        writeInstalledPlugins(pluginsFile, { "loomwright@atelier": [userEntry(installA, fromVersion)] });
        rec.contract = { from_version: fromVersion, to_version: toVersion, added_command: "phase-2-exit-added", removed_skill: removedSkill, real_install_scope: real.scope };

        const items = new Map<string, string>();
        const keychain: KeychainReader = { read: (s) => items.get(s) };
        const writer: KeychainWriter = { add: (s, _a, secret) => void items.set(s, secret) };
        // The real notifier, with the click running this checkout's built CLI.
        const contributions = SHIPPED_CONTRIBUTIONS.map((c) =>
          c === notificationsContribution ? Object.freeze({ ...c, dueWork: Object.freeze([createDeliveryDueWork({ cliPath: CLI_PATH })]) }) : c,
        );
        const t0 = Date.now();
        ownKernel = await startKernel(
          { dataDir: ownData, env: { PATH: "/usr/bin" }, sessions: { installedPluginsPath: pluginsFile, stopGraceMs: 10 }, contributions },
          {
            keychain,
            keychainWriter: writer,
            sessionDeps: fakeSessions().deps,
            selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
            availableProviderIds: async () => ["api-key"],
          },
        );
        const store = ownKernel.store;
        const seen = () => store.prepare<[], { plugin_version: string }>("SELECT plugin_version FROM loomwright_contract_seen ORDER BY id").all();
        const versionNotes = () =>
          store
            .prepare<[string], { id: number; title: string; deep_link: string; delivery_status: string; delivery_detail: string | null }>(
              "SELECT id, title, deep_link, delivery_status, delivery_detail FROM notifications WHERE source = ? ORDER BY id",
            )
            .all(VERSION_NOTE_SOURCE);
        const notesDir = join(ownData, VERSION_NOTES_DIR);
        const noteFiles = (): string[] => (existsSync(notesDir) ? readdirSync(notesDir).sort() : []);

        await waitFor("the baseline row", () => (seen().length === 1 ? true : undefined), 30_000, 200);
        rec.baseline_ms = Date.now() - t0;
        expect(noteFiles()).toEqual([]);
        const switchedAt = Date.now();
        writeInstalledPlugins(pluginsFile, { "loomwright@atelier": [userEntry(installB, toVersion)] });
        // The watcher checks at most once a minute.
        const notes = await waitFor("the version notification, settled", () => {
          const n = versionNotes();
          return n.length > 0 && n.every((x) => x.delivery_status !== "pending") ? n : undefined;
        }, 3 * MINUTE, 500);
        rec.noted_after_switch_ms = Date.now() - switchedAt;
        // Another check later must add neither.
        await sleep(MINUTE + 10_000);
        rec.note_files = noteFiles();
        rec.notifications = versionNotes();
        rec.seen_versions = seen().map((s) => s.plugin_version);
        const note = noteFiles()[0];
        rec.note_first_lines = note === undefined ? [] : readFileSync(join(notesDir, note), "utf8").split("\n").slice(0, 12).map((l) => clipped(l, 300));
        expect(notes[0]?.delivery_status).toBe("delivered");
        expect(rec.note_files).toHaveLength(1);
        expect(rec.notifications).toHaveLength(1);
        expect(rec.seen_versions).toEqual([fromVersion, toVersion]);
      }),
    STEP_TIMEOUT_MS,
  );
});
