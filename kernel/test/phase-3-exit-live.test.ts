// Opt-in live harness for the phase 3 exit check (item 09): the
// machine-observable parts of docs/evidence/phase-3-exit-runbook.md. Never
// runs in CI or by default. The owner runs it on his Mac, after the runbook's
// setup (the kernel built, the launchd service installed with `studio service
// install`, Wright's model set in `config/agents/wright.json` and its tool
// policy listing the six `mcp__kernel__kernel_playbook_*` names):
//
//   cd kernel && npm run build && STUDIO_LIVE=1 npx vitest run test/phase-3-exit-live.test.ts
//
// Everything runs against the launchd service the owner installed, on its own
// data dir (`STUDIO_DATA_DIR`, else `~/.loomwright-studio`), through the built
// `studio` CLI (`kernel/dist/cli/index.js`). It writes one playbook (with its
// linked cron trigger and mirror file) into the owner's real store, through
// Wright. One flow, in order, each stage recorded in the summary:
//
//   1. `studio ask` a plain-English request for a playbook that runs every day
//      at two minutes of one local hour (the first at least 15 minutes ahead,
//      the second 5 minutes later; see `harnessFireMinutes`), named with the
//      run tag, and only drafted: the draft row, its cron trigger due at the
//      first minute, and its mirror file.
//   2. The owner's values, set with `studio playbooks set` before any dry run
//      (a set makes a new version): the model from `wright.json`, priority
//      `high`, dedupe key `date` (so both minutes share one key; never
//      `trigger.scheduled_at`).
//   3. `studio ask` Wright to dry-run it and ask to enable it: a `done` dry run
//      of the current version, shown on the mirror's "Last dry run" line and in
//      the held enable's `studio approvals` display.
//   4. The owner approves that enable (`studio approve <id> once`, in another
//      terminal; the harness prints the id and never decides an approval):
//      Wright's retry enables the playbook before the first minute.
//   5. At the first minute the trigger fires: one `fire` run, its queue row at
//      the playbook's priority, its session on the playbook's model and
//      version, ended `done` before the second minute.
//   6. At the second minute the same dedupe key is a duplicate: a second
//      `fire` run `skipped_duplicate` with no session.
//
// The checks read stored rows (`playbooks`, `playbook_runs`, `approvals`,
// `event_queue`, `sessions`, events), never Wright's reply text: a real model
// may phrase or schedule the playbook differently from the request, and the
// rows say what it actually did.
//
// What only the owner can see (the approval and fire notifications popping up,
// the `studio approvals` display he reads before approving, no notification at
// the second minute) is not here: the runbook lists it as fields he fills in.
//
// A playbook counts as the harness's only when its owning agent is `wright`
// and either (a) the kernel recorded its `playbook_created` event under the
// session of a Wright `ask` message whose text (the harness's own input, kept
// in `brain_messages`) carries the run tag, or (b) its own name, intent or
// slug carries the tag. (a) is the kernel's provenance and does not depend on
// Wright copying the tag; (b) is the fallback. Any other playbook that appears
// meanwhile is recorded in the summary and never touched.
//
// Cleanup (`afterAll`) re-reads the harness's playbooks by that rule (so one
// Wright created after `studio ask` gave up is caught) and turns off each one
// that is not already off (`studio playbooks off <id>`). A playbook that is
// already off is never written to: an owner off of it would record a turn-off
// the owner never made (and make an agent's off final). It is listed in the
// cleanup as skipped, with who turned it off; a failed re-read is listed too,
// never skipped silently. Nothing else is changed: the playbook's linked
// trigger stays as it is (it starts no work while its playbook is off), and an
// enable approval still pending is left for the owner to deny; both are listed
// in the cleanup entry. The harness never stops, uninstalls or reinstalls the
// service and never decides an approval.
//
// A run summary (timings, row counts, event kinds, the commit, the run tag;
// never env or tokens, and any `sk-ant-…` string redacted) is written after
// every stage to the path printed at the start; the owner copies what he needs
// into the evidence file.
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ASK_AGENT, PROPOSED_ALLOWED_TOOLS, wrightSettingsPath } from "../src/brain/index.js";
import { createPlaybook, mirrorPath, mirrorRelativePath } from "../src/playbooks/index.js";
import { LAUNCHCTL_PATH, SERVICE_LABEL, parseLaunchctlPrint } from "../src/service/index.js";
import { resolveDataDir } from "../src/store/index.js";
import { tryDb, waitFor, withDb } from "./crash-helpers.js";
import { loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

const LIVE = process.env.STUDIO_LIVE === "1";

const KERNEL_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_DIR = fileURLToPath(new URL("../..", import.meta.url));
const CLI_PATH = join(KERNEL_DIR, "dist", "cli", "index.js");
const MINUTE = 60_000;
/** The first minute is at least this far ahead: two asks, the dry run, the owner's approval and Wright's retry all come before it. */
export const FIRST_FIRE_LEAD_MS = 15 * MINUTE;
/** Between the two minutes: the first fire's session must end `done` before the second (only a `done` run with the same key makes a duplicate). */
export const FIRE_GAP_MS = 5 * MINUTE;
/** How long after a minute the harness waits for its fire to be queued and recorded. */
const FIRE_SLACK_MS = 90_000;
/** How long after the first minute's slack the harness waits for the fire's session to end. */
const RUN_END_MS = 3 * MINUTE;
const FLOW_TIMEOUT_MS = 45 * MINUTE;
/** The reply wait for the draft ask (the CLI's own default, made explicit). */
const ASK_TIMEOUT_S = 120;
/** The reply wait for the dry-run ask: the dry run is a whole session inside Wright's tool call. */
const DRY_RUN_ASK_TIMEOUT_S = 600;
/** A `studio ask` process timeout: above the CLI's own wait, so the CLI always reports its own outcome. */
const askProcessTimeoutMs = (timeoutS: number): number => (timeoutS + 30) * 1_000;

/** The six phase 3 playbook tools' full SDK names, as the proposed policy lists them. */
export const PLAYBOOK_TOOLS: readonly string[] = PROPOSED_ALLOWED_TOOLS.filter((t) => t.startsWith("mcp__kernel__kernel_playbook_"));

/** The owner's values the harness sets with `studio playbooks set` (the model is `wright.json`'s). */
const OWNER_PRIORITY = "high";
const OWNER_DEDUPE_KEY = "date";

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

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `ms` as a local `HH:MM` (24-hour), the form the harness puts in its request. */
const localHHMM = (ms: number): string => `${pad2(new Date(ms).getHours())}:${pad2(new Date(ms).getMinutes())}`;

/** The two minutes a harness playbook runs at, local, and the 5-field cron expression for both. */
export interface HarnessFireMinutes {
  readonly first: { readonly hhmm: string; readonly at: string };
  readonly second: { readonly hhmm: string; readonly at: string };
  readonly cron: string;
}

/**
 * The two local minutes the harness asks Wright to run its playbook at, from
 * `now`: the first is the next whole minute at least `FIRST_FIRE_LEAD_MS`
 * ahead, the second `FIRE_GAP_MS` after it, both in one local hour (so one
 * cron expression, `M1,M2 H * * *`, names exactly these two minutes a day):
 * when the second would fall in the next hour, both move to the next hour's
 * first minutes. Refuses (throws) when either minute would fall on another
 * local day than `now` (the dedupe key is the date, and the harness never
 * rolls into tomorrow), or in another local hour (a clock change).
 */
export function harnessFireMinutes(now: number): HarnessFireMinutes {
  let first = Math.ceil((now + FIRST_FIRE_LEAD_MS) / MINUTE) * MINUTE;
  const minute = new Date(first).getMinutes();
  if (minute + FIRE_GAP_MS / MINUTE > 59) first += (60 - minute) * MINUTE;
  const second = first + FIRE_GAP_MS;
  const day = new Date(now).toDateString();
  if (new Date(first).toDateString() !== day || new Date(second).toDateString() !== day) {
    throw new Error("the playbook's minutes would fall after midnight; start the harness by 23:39 local time");
  }
  if (new Date(first).getHours() !== new Date(second).getHours()) {
    throw new Error("the playbook's two minutes would fall in different local hours (a clock change); run the harness at another time");
  }
  return {
    first: { hhmm: localHHMM(first), at: new Date(first).toISOString() },
    second: { hhmm: localHHMM(second), at: new Date(second).toISOString() },
    cron: `${new Date(first).getMinutes()},${new Date(second).getMinutes()} ${new Date(first).getHours()} * * *`,
  };
}

/** The six playbook tool names `settings` (a parsed `wright.json`) does not list in `tool_policy.allowedTools`. */
export function missingPlaybookTools(settings: unknown): string[] {
  const policy = typeof settings === "object" && settings !== null ? (settings as { tool_policy?: unknown }).tool_policy : undefined;
  const allowed = typeof policy === "object" && policy !== null ? (policy as { allowedTools?: unknown }).allowedTools : undefined;
  const listed = Array.isArray(allowed) ? allowed.filter((t): t is string => typeof t === "string") : [];
  return PLAYBOOK_TOOLS.filter((t) => !listed.includes(t));
}

// Deterministic (runs in CI, no service): the minute picker's guarantees.
describe("harnessFireMinutes", () => {
  const local = (h: number, m: number, s = 0): number => new Date(2026, 9, 17, h, m, s).getTime();

  it("keeps the first minute at least 15 minutes ahead and the second 5 minutes later, in one local hour, for every start from 09:00 to 11:00", () => {
    for (let now = local(9, 0); now <= local(11, 0); now += 5_000) {
      const { first, second, cron } = harnessFireMinutes(now);
      const f = Date.parse(first.at);
      const s = Date.parse(second.at);
      expect(f - now, new Date(now).toString()).toBeGreaterThanOrEqual(FIRST_FIRE_LEAD_MS);
      expect(f - now).toBeLessThan(FIRST_FIRE_LEAD_MS + 6 * MINUTE);
      expect(s - f).toBe(FIRE_GAP_MS);
      expect(new Date(f).getHours()).toBe(new Date(s).getHours());
      expect(first.hhmm).toBe(localHHMM(f));
      expect(second.hhmm).toBe(localHHMM(s));
      expect(cron).toBe(`${new Date(f).getMinutes()},${new Date(s).getMinutes()} ${new Date(f).getHours()} * * *`);
    }
  });

  it("moves both minutes to the next hour when the second would cross it, and leaves them alone when it would not", () => {
    expect(harnessFireMinutes(local(10, 0))).toMatchObject({ first: { hhmm: "10:15" }, second: { hhmm: "10:20" }, cron: "15,20 10 * * *" });
    expect(harnessFireMinutes(local(10, 39))).toMatchObject({ first: { hhmm: "10:54" }, second: { hhmm: "10:59" }, cron: "54,59 10 * * *" });
    expect(harnessFireMinutes(local(10, 39, 1))).toMatchObject({ first: { hhmm: "11:00" }, second: { hhmm: "11:05" }, cron: "0,5 11 * * *" });
    expect(harnessFireMinutes(local(10, 44, 30))).toMatchObject({ first: { hhmm: "11:00" }, second: { hhmm: "11:05" } });
  });

  it("refuses minutes after midnight instead of rolling into the next day", () => {
    expect(harnessFireMinutes(local(23, 39)).second.hhmm).toBe("23:59");
    expect(() => harnessFireMinutes(local(23, 39, 1))).toThrow(/after midnight/);
    expect(() => harnessFireMinutes(local(23, 59, 59))).toThrow(/after midnight/);
  });
});

describe("missingPlaybookTools", () => {
  it("names the six playbook tools the proposed policy lists", () => {
    expect(PLAYBOOK_TOOLS).toEqual([
      "mcp__kernel__kernel_playbook_create",
      "mcp__kernel__kernel_playbook_update",
      "mcp__kernel__kernel_playbook_list",
      "mcp__kernel__kernel_playbook_disable",
      "mcp__kernel__kernel_playbook_dry_run",
      "mcp__kernel__kernel_playbook_enable",
    ]);
  });

  it("lists every playbook tool a phase 2 wright.json lacks, and none for a policy that has them", () => {
    const phase2 = { model: "m", tool_policy: { allowedTools: ["mcp__kernel__kernel_trigger_register", "Read"], allowedBashPrefixes: [] } };
    expect(missingPlaybookTools(phase2)).toEqual(PLAYBOOK_TOOLS);
    const full = { tool_policy: { allowedTools: [...PROPOSED_ALLOWED_TOOLS], allowedBashPrefixes: [] } };
    expect(missingPlaybookTools(full)).toEqual([]);
    const partial = { tool_policy: { allowedTools: PLAYBOOK_TOOLS.filter((t) => !t.endsWith("_enable")), allowedBashPrefixes: [] } };
    expect(missingPlaybookTools(partial)).toEqual(["mcp__kernel__kernel_playbook_enable"]);
    expect(missingPlaybookTools(null)).toEqual(PLAYBOOK_TOOLS);
    expect(missingPlaybookTools({ tool_policy: { allowedTools: "Read" } })).toEqual(PLAYBOOK_TOOLS);
  });
});

/** A playbook the harness counts as its own, and which rule matched it. */
export interface HarnessPlaybookRow {
  readonly id: number;
  readonly slug: string;
  readonly owning_agent: string;
  readonly status: string;
  readonly version: number;
  /** The linked trigger (`triggers.playbook` = the slug), or null. */
  readonly trigger_id: number | null;
  /** 1: created (per its `playbook_created` event) by the session of a Wright `ask` whose text carries the tag. */
  readonly by_session: number;
  /** 1: its own name, intent or slug carries the tag. */
  readonly by_tag: number;
}

/**
 * The harness's playbooks for `tag`: owned by `agent`, and either created by
 * the session of an `ask` message to `agent` whose text (the harness's own
 * input) carries the tag, or whose own name, intent or slug carries it. The
 * session rule is kernel-recorded provenance (`brain_messages.session_id`,
 * set when the session starts; the session id on the `playbook_created`
 * event row) and holds when Wright drops the tag; an `ask` without a session
 * yet (queued or parked) selects nothing until its session runs, so callers
 * re-read. Every `ask` starts its own session, so the owner's untagged ask
 * never shares a session with the harness's.
 */
export const HARNESS_PLAYBOOKS_SQL = `
WITH harness_sessions AS (
  SELECT DISTINCT session_id FROM brain_messages
   WHERE agent = :agent AND source = 'ask' AND session_id IS NOT NULL AND instr(lower(text), :tag) > 0
),
session_playbooks AS (
  SELECT DISTINCT json_extract(payload_json, '$.playbook_id') AS playbook_id FROM events
   WHERE kind = 'playbook_created' AND json_valid(payload_json) AND session_id IN (SELECT session_id FROM harness_sessions)
)
SELECT p.id, p.slug, p.owning_agent, p.status, p.version,
       (SELECT t.id FROM triggers t WHERE t.playbook = p.slug ORDER BY t.id LIMIT 1) AS trigger_id,
       (p.id IN (SELECT playbook_id FROM session_playbooks)) AS by_session,
       (instr(lower(p.name), :tag) > 0 OR instr(lower(p.intent), :tag) > 0 OR instr(lower(p.slug), :tag) > 0) AS by_tag
  FROM playbooks p
 WHERE p.owning_agent = :agent
   AND (p.id IN (SELECT playbook_id FROM session_playbooks)
        OR instr(lower(p.name), :tag) > 0 OR instr(lower(p.intent), :tag) > 0 OR instr(lower(p.slug), :tag) > 0)
 ORDER BY p.id`;

export function harnessPlaybookRows(db: Database.Database, agent: string, tag: string): HarnessPlaybookRow[] {
  return db.prepare<[{ agent: string; tag: string }], HarnessPlaybookRow>(HARNESS_PLAYBOOKS_SQL).all({ agent, tag: tag.toLowerCase() });
}

// Deterministic (runs in CI, no service): the provenance rule against the real schema.
describe("harnessPlaybookRows", () => {
  let env: LoopEnv;
  const TAG = "phase3-exit-abc123";

  beforeEach(() => {
    env = loopEnv("2026-10-17T10:00:00.000Z");
  });

  afterEach(() => {
    env.cleanup();
  });

  const session = (agent: string): number => Number(env.store.prepare("INSERT INTO sessions (agent, status) VALUES (?, 'completed')").run(agent).lastInsertRowid);

  /** A `studio ask` as the kernel keeps it: a queue row and its `brain_messages` row, with the session that ran it. */
  const ask = (agent: string, text: string, sessionId: number | null): void => {
    const queueId = Number(env.store.prepare("INSERT INTO event_queue (kind, payload_json, status) VALUES ('message', '{}', 'done')").run().lastInsertRowid);
    env.store.prepare("INSERT INTO brain_messages (queue_id, agent, source, text, session_id) VALUES (?, ?, 'ask', ?, ?)").run(queueId, agent, text, sessionId);
  };

  const draft = (agent: string, name: string, sessionId: number | null) =>
    createPlaybook(env.store, { agent, name, intent: "send a notification", trigger: { kind: "cron", spec: "15,20 10 * * *", tz: "UTC" }, sessionId }, env.now());

  const rows = (): HarnessPlaybookRow[] => withDb(env.dataDir, (db) => harnessPlaybookRows(db, ASK_AGENT, TAG));

  it("selects Wright's playbooks created by a tagged ask's session or carrying the tag, and no other", () => {
    const tagged = session(ASK_AGENT);
    ask(ASK_AGENT, `Create a playbook named "${TAG.toUpperCase()}": every day at 10:15 and 10:20`, tagged);
    const untagged = session(ASK_AGENT);
    ask(ASK_AGENT, "remind me at 5pm to check X", untagged);
    const bySession = draft(ASK_AGENT, "daily check", tagged); // Wright dropped the tag
    const byTag = draft(ASK_AGENT, `Check ${TAG.toUpperCase()}`, untagged);
    draft(ASK_AGENT, "the owner's own", untagged);
    draft(ASK_AGENT, "no session", null);
    draft("scout", `scout ${TAG}`, tagged); // another agent's, even from the tagged session
    const got = rows();
    expect(got.map((r) => [r.id, r.by_session, r.by_tag])).toEqual([
      [bySession.playbook.id, 1, 0],
      [byTag.playbook.id, 0, 1],
    ]);
    expect(got[0]).toMatchObject({ owning_agent: ASK_AGENT, status: "draft", version: 1, trigger_id: bySession.trigger?.id });
    expect(got[1]?.trigger_id).toBe(byTag.trigger?.id);
    expect(withDb(env.dataDir, (db) => harnessPlaybookRows(db, ASK_AGENT, TAG.toUpperCase()))).toEqual(got);
  });

  it("selects nothing for an ask whose session has not started yet, then the playbook once it has", () => {
    ask(ASK_AGENT, `make a playbook ${TAG}`, null);
    draft(ASK_AGENT, "unrelated", session(ASK_AGENT));
    expect(rows()).toEqual([]);
    const later = session(ASK_AGENT);
    env.store.prepare("UPDATE brain_messages SET session_id = ? WHERE session_id IS NULL").run(later);
    const created = draft(ASK_AGENT, "late draft", later);
    expect(rows().map((r) => r.id)).toEqual([created.playbook.id]);
  });
});

/** The playbook columns the harness checks. */
interface PlaybookCheckRow {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly status: string;
  readonly version: number;
  readonly model: string | null;
  readonly model_set_by: string | null;
  readonly priority: string;
  readonly priority_set_by: string | null;
  readonly dedupe_key_spec: string | null;
  readonly dedupe_key_set_by: string | null;
  readonly token_limit_per_day: number | null;
  readonly token_limit_set_by: string | null;
}

interface RunRow {
  readonly id: number;
  readonly version: number;
  readonly kind: string;
  readonly status: string;
  readonly session_id: number | null;
  readonly dedupe_key: string | null;
  readonly result_json: string | null;
  readonly tokens: number | null;
  readonly started_at: string;
  readonly ended_at: string | null;
}

interface EnableApprovalRow {
  readonly id: number;
  readonly status: string;
  readonly decision: string | null;
  readonly decided_by: string | null;
  readonly requested_at: string;
  readonly decided_at: string | null;
  readonly requesting_session: number | null;
  readonly subject_version: number | null;
  readonly display: string | null;
}

interface QueueRow {
  readonly id: number;
  readonly source_ref: string;
  readonly priority: string;
  readonly status: string;
  readonly enqueued_at: string;
  readonly done_at: string | null;
}

describe.skipIf(!LIVE)("live phase 3 exit: a plain-English playbook on the launchd service, dry-run, approved, fired once per dedupe key (STUDIO_LIVE=1)", () => {
  const dataDir = resolveDataDir(process.env);
  const summaryPath = join(tmpdir(), `studio-phase-3-exit-live-summary-${Date.now()}.json`);
  const summary: Record<string, unknown> & { steps: Record<string, Record<string, unknown>> } = { test: "phase-3-exit-live", steps: {} };
  /** Unique to this run; every request the harness sends carries it (lowercase, so a case change by Wright still matches). */
  const runTag = `phase3-exit-${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  summary.run_tag = runTag;
  /** Every playbook the harness counted as its own and what cleanup did with it: turned off, skipped (already off, so never written), or a re-read that failed. */
  const cleanup: (
    | { playbook_id: number; off_exit: number; off_output: string; status_before: string; left_as_is: Record<string, unknown> }
    | { playbook_id: number; skipped: "already_off" | "gone"; disabled_by?: string | null; left_as_is?: Record<string, unknown> }
    | { reread_failed: string }
  )[] = [];
  /** `wright.json`'s model: what the harness sets as the playbook's model, as the owner. */
  let wrightModel = "";

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

  /** The playbooks provably the harness's (see `HARNESS_PLAYBOOKS_SQL`). Nothing else is ever turned off. */
  const harnessPlaybooks = (): HarnessPlaybookRow[] => withDb(dataDir, (db) => harnessPlaybookRows(db, ASK_AGENT, runTag));

  const playbookRowIn = (db: Database.Database, id: number): PlaybookCheckRow | undefined =>
    db
      .prepare<[number], PlaybookCheckRow>(
        `SELECT id, slug, name, status, version, model, model_set_by, priority, priority_set_by, dedupe_key_spec, dedupe_key_set_by,
                token_limit_per_day, token_limit_set_by FROM playbooks WHERE id = ?`,
      )
      .get(id);

  const playbookRow = (id: number): PlaybookCheckRow | undefined => withDb(dataDir, (db) => playbookRowIn(db, id));

  const linkedTriggerIn = (db: Database.Database, slug: string) =>
    db
      .prepare<[string], { id: number; kind: string; spec_json: string; enabled: number; next_fire_at: string | null; last_fired_at: string | null; last_result: string | null }>(
        "SELECT id, kind, spec_json, enabled, next_fire_at, last_fired_at, last_result FROM triggers WHERE playbook = ? ORDER BY id LIMIT 1",
      )
      .get(slug);

  const linkedTrigger = (slug: string) => withDb(dataDir, (db) => linkedTriggerIn(db, slug));

  const runsIn = (db: Database.Database, id: number): RunRow[] =>
    db
      .prepare<[number], RunRow>(
        "SELECT id, version, kind, status, session_id, dedupe_key, result_json, tokens, started_at, ended_at FROM playbook_runs WHERE playbook = ? ORDER BY id",
      )
      .all(id);

  const runsOf = (id: number): RunRow[] => withDb(dataDir, (db) => runsIn(db, id));

  /** A run row for the summary: its `result_json` clipped. */
  const runRecord = (r: RunRow) => ({ ...r, result_json: r.result_json === null ? null : clipped(r.result_json, 1_500) });

  /** Every enable approval for playbook `id` (its held input names the playbook), with the hold's `subject_version` and display. */
  const enableApprovalsIn = (db: Database.Database, id: number): EnableApprovalRow[] =>
    db
      .prepare<[number], EnableApprovalRow>(
        `SELECT a.id, a.status, a.decision, a.decided_by, a.requested_at, a.decided_at, a.requesting_session,
                (SELECT json_extract(r.payload_json, '$.subject_version') FROM events r
                  WHERE r.kind = 'approval_requested' AND json_valid(r.payload_json) AND json_extract(r.payload_json, '$.id') = a.id ORDER BY r.id LIMIT 1) AS subject_version,
                (SELECT json_extract(r.payload_json, '$.display') FROM events r
                  WHERE r.kind = 'approval_requested' AND json_valid(r.payload_json) AND json_extract(r.payload_json, '$.id') = a.id ORDER BY r.id LIMIT 1) AS display
           FROM approvals a
          WHERE a.action = 'kernel_playbook_enable' AND json_valid(a.payload_json) AND json_extract(a.payload_json, '$.input.id') = ?
          ORDER BY a.id`,
      )
      .all(id);

  const enableApprovals = (id: number): EnableApprovalRow[] => withDb(dataDir, (db) => enableApprovalsIn(db, id));

  /** An approval row for the summary: its display clipped. */
  const approvalRecord = (a: EnableApprovalRow) => ({ ...a, display: a.display === null ? null : clipped(a.display, 2_000) });

  /** Events of `kind` whose payload's `field` is `value`, with their session. */
  const eventsWhere = (kind: string, field: string, value: number): { id: number; session_id: number | null; payload: unknown }[] =>
    withDb(dataDir, (db) =>
      db
        .prepare<[string, number], { id: number; session_id: number | null; payload_json: string }>(
          `SELECT id, session_id, payload_json FROM events WHERE kind = ? AND json_valid(payload_json) AND json_extract(payload_json, '$.${field}') = ? ORDER BY id`,
        )
        .all(kind, value),
    ).map((e) => ({ id: e.id, session_id: e.session_id, payload: JSON.parse(e.payload_json) as unknown }));

  /** The queue rows of playbook `id`'s messages (`sourceRef` `playbook:<id>:<instant>`). */
  const queueOf = (id: number): QueueRow[] =>
    withDb(dataDir, (db) =>
      db
        .prepare<[string], QueueRow>("SELECT id, source_ref, priority, status, enqueued_at, done_at FROM event_queue WHERE source_ref LIKE ? ORDER BY id")
        .all(`playbook:${id}:%`),
    );

  /** The instant a playbook message's `sourceRef` names, as epoch ms. */
  const instantOf = (id: number, row: QueueRow | undefined): number => (row === undefined ? Number.NaN : Date.parse(row.source_ref.slice(`playbook:${id}:`.length)));

  /** Wright's notifications (`agent:wright`) created at or after `fromIso`: titles only, clipped. */
  const wrightNotificationsSince = (fromIso: string) =>
    withDb(dataDir, (db) =>
      db
        .prepare<[string, string], { id: number; title: string; created_at: string; delivery_status: string }>(
          "SELECT id, title, created_at, delivery_status FROM notifications WHERE source = ? AND created_at >= ? ORDER BY id",
        )
        .all(`agent:${ASK_AGENT}`, fromIso),
    ).map((n) => ({ ...n, title: clipped(n.title, 200) }));

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

  /** `studio ask` with the run tag in `text`; the reply is recorded, never checked. */
  async function ask(rec: Record<string, unknown>, text: string, timeoutS: number): Promise<{ code: number }> {
    const t = Date.now();
    const r = await studio(["ask", text, "--timeout", String(timeoutS)], askProcessTimeoutMs(timeoutS));
    rec.ask = { text, exit: r.code, reply: clipped(r.stdout.trim()), stderr: clipped(r.stderr.trim()), took_ms: Date.now() - t };
    return { code: r.code };
  }

  /** The mirror's `Last dry run:` line for `slug`, or null when the file or the line is missing. */
  function mirrorDryRunLine(slug: string): string | null {
    const path = mirrorPath(dataDir, slug);
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8").split("\n").find((l) => l.startsWith("Last dry run:")) ?? null;
  }

  /** Run one stage, recording its outcome (and the failure, as a finding) in the summary. */
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

  /**
   * `studio playbooks off <id>`, as the owner, for each harness playbook that
   * is not off when re-read just before; one already off is never written to.
   * Every id is recorded in the cleanup list with its linked trigger and any
   * enable approval still pending (both left as they are), or a re-read that
   * failed (no write then).
   */
  async function turnOffIfOn(ids: Iterable<number>): Promise<void> {
    for (const id of ids) {
      const read = tryDb(dataDir, (db) => {
        const row = playbookRowIn(db, id);
        const disabledBy = db
          .prepare<[number], string | null>(
            "SELECT json_extract(payload_json, '$.by') FROM events WHERE kind = 'playbook_disabled' AND json_valid(payload_json) AND json_extract(payload_json, '$.playbook_id') = ? ORDER BY id DESC LIMIT 1",
          )
          .pluck()
          .get(id);
        const trigger = row === undefined ? undefined : linkedTriggerIn(db, row.slug);
        const pending = enableApprovalsIn(db, id).filter((a) => a.status === "pending").map((a) => a.id);
        return { row, disabledBy, trigger, pending };
      });
      if (read === undefined) {
        cleanup.push({ reread_failed: `playbook:${id}` });
        continue;
      }
      const leftAsIs = {
        linked_trigger: read.trigger === undefined ? null : { id: read.trigger.id, enabled: read.trigger.enabled, next_fire_at: read.trigger.next_fire_at },
        pending_enable_approvals: read.pending,
      };
      if (read.row === undefined) {
        cleanup.push({ playbook_id: id, skipped: "gone" });
        continue;
      }
      if (read.row.status === "disabled") {
        cleanup.push({ playbook_id: id, skipped: "already_off", disabled_by: read.disabledBy ?? null, left_as_is: leftAsIs });
        continue;
      }
      const r = await studio(["playbooks", "off", String(id)], 30_000);
      cleanup.push({ playbook_id: id, status_before: read.row.status, off_exit: r.code, off_output: clipped((r.stdout + r.stderr).trim(), 300), left_as_is: leftAsIs });
    }
  }

  beforeAll(async () => {
    console.log(`phase-3-exit-live summary: ${summaryPath} (run tag ${runTag})`);
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
    // Wright's settings, read only: the model and whether the policy lists the six playbook tools (never the whole file).
    let settings: unknown = null;
    let settingsError: string | null = null;
    try {
      settings = JSON.parse(readFileSync(wrightSettingsPath(dataDir), "utf8")) as unknown;
    } catch (err) {
      settingsError = clipped(err instanceof Error ? err.message : String(err), 300);
    }
    const model = typeof settings === "object" && settings !== null ? (settings as { model?: unknown }).model : undefined;
    wrightModel = typeof model === "string" ? model : "";
    const missing = missingPlaybookTools(settings);
    Object.assign(summary, {
      at: new Date().toISOString(),
      commit,
      dirty_worktree: dirty,
      service: { launchd_pid: launchd ?? null, api_json_pid: api ?? null, status_pid: status ?? null },
      wright_settings: { model: wrightModel === "" ? null : wrightModel, missing_playbook_tools: missing, read_error: settingsError },
    });
    writeSummary();
    expect(launchd, `${SERVICE_LABEL} is not running under launchd: install it with studio service install (runbook setup)`).toBeDefined();
    expect(api, "api.json names another kernel than launchd runs").toBe(launchd);
    expect(status, "studio status did not answer with the service's pid").toBe(launchd);
    expect(settingsError, "config/agents/wright.json could not be read (runbook setup step 3)").toBeNull();
    expect(wrightModel, "config/agents/wright.json has no model (runbook setup step 3)").not.toBe("");
    expect(missing, "config/agents/wright.json's tool_policy.allowedTools lacks playbook tools (runbook setup step 3)").toEqual([]);
  }, 60_000);

  afterAll(async () => {
    // Re-read: a playbook Wright created after `studio ask` returned (no reply in time, or a parked ask whose session ran later) is the harness's too.
    const rows = tryDb(dataDir, (db) => harnessPlaybookRows(db, ASK_AGENT, runTag));
    if (rows === undefined) cleanup.push({ reread_failed: runTag });
    await turnOffIfOn((rows ?? []).map((row) => row.id));
    summary.finished_at = new Date().toISOString();
    writeSummary();
    console.log(`phase-3-exit-live summary: ${summaryPath} (run tag ${runTag})`);
  }, 120_000);

  it(
    "a plain-English request becomes a draft, is dry-run and shown, is enabled on the owner's approval, fires at its minute, and skips the second minute with the same dedupe key",
    async () => {
      const firstEvent = Number(scalar("SELECT coalesce(max(id), 0) FROM events"));
      const minutes = harnessFireMinutes(Date.now());
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      summary.fire_minutes = { first: minutes.first, second: minutes.second, expected_cron: minutes.cron, zone };
      writeSummary();
      let id = 0;
      let slug = "";
      let approvalId = 0;
      let enabledVersion = 0;
      let firstRun: RunRow | undefined;

      await step("1_draft", async (rec) => {
        const before = Number(scalar("SELECT coalesce(max(id), 0) FROM playbooks"));
        const text =
          `Create a playbook named "${runTag}": every day at ${minutes.first.hhmm} and at ${minutes.second.hhmm} (${zone} time), ` +
          `send me a notification titled "${runTag}" that says the playbook ran. Only draft it for now: don't dry-run it or ask me to enable it yet.`;
        const r = await ask(rec, text, ASK_TIMEOUT_S);
        const rows = harnessPlaybooks();
        rec.playbooks_created = rows;
        // Not the harness's (neither the ask's session nor the tag): ids, owners and status only, left as they are.
        rec.other_new_playbooks = withDb(dataDir, (db) =>
          db.prepare<[number], { id: number; owning_agent: string; status: string }>("SELECT id, owning_agent, status FROM playbooks WHERE id > ? ORDER BY id").all(before),
        ).filter((o) => !rows.some((x) => x.id === o.id));
        expect(r.code, "studio ask did not answer in time (exit 3) or failed").toBe(0);
        expect(rows, "exactly one Wright playbook from the ask (its session or its tag)").toHaveLength(1);
        const created = rows[0] as HarnessPlaybookRow;
        id = created.id;
        slug = created.slug;
        const row = playbookRow(id);
        const trigger = linkedTrigger(slug);
        rec.row = row ?? null;
        rec.trigger = trigger ?? null;
        const mirror = mirrorPath(dataDir, slug);
        rec.mirror = { relative_path: mirrorRelativePath(slug), exists: existsSync(mirror), first_lines: existsSync(mirror) ? readFileSync(mirror, "utf8").split("\n").slice(0, 12).map((l) => clipped(l, 300)) : [] };
        const shown = await studio(["playbooks", "show", String(id)], 15_000);
        rec.studio_playbooks_show = { exit: shown.code, output: clipped(shown.stdout.trim(), 2_000) };
        // Wright was asked only to draft: a dry run or enable request now is recorded (step 3 uses only one for the version it dry-runs).
        rec.early = { dry_runs: runsOf(id).filter((x) => x.kind === "dry_run").map(runRecord), enable_approvals: enableApprovals(id).map(approvalRecord) };
        expect(row?.status).toBe("draft");
        expect(trigger?.kind, "the playbook's trigger is not a cron trigger").toBe("cron");
        expect(Date.parse(trigger?.next_fire_at ?? ""), "the playbook's next fire is not the first minute asked").toBe(Date.parse(minutes.first.at));
        expect(existsSync(mirror), "the mirror file is missing").toBe(true);
      });

      await step("2_owner_sets", async (rec) => {
        const sets: [string, string][] = [
          ["model", wrightModel],
          ["priority", OWNER_PRIORITY],
          ["dedupe_key", OWNER_DEDUPE_KEY],
        ];
        const results: Record<string, unknown>[] = [];
        rec.sets = results;
        for (const [field, value] of sets) {
          const r = await studio(["playbooks", "set", String(id), field, value], 30_000);
          results.push({ field, value, exit: r.code, output: clipped((r.stdout + r.stderr).trim(), 300) });
          expect(r.code, `studio playbooks set ${id} ${field} failed`).toBe(0);
        }
        const row = playbookRow(id);
        rec.row = row ?? null;
        expect(row).toMatchObject({
          status: "draft",
          model: wrightModel,
          model_set_by: "owner",
          priority: OWNER_PRIORITY,
          priority_set_by: "owner",
          dedupe_key_spec: JSON.stringify([OWNER_DEDUPE_KEY]),
          dedupe_key_set_by: "owner",
        });
      });

      await step("3_dry_run_and_enable_request", async (rec) => {
        const startApproval = Number(scalar("SELECT coalesce(max(id), 0) FROM approvals"));
        const version = playbookRow(id)?.version ?? 0;
        rec.version = version;
        const r = await ask(rec, `Dry-run the playbook "${runTag}" (id ${id}) now, then ask me to enable it.`, DRY_RUN_ASK_TIMEOUT_S);
        rec.ask_exit_note = r.code === 0 ? "replied" : "no reply in time or failed; the stored rows decide";
        // The stored rows decide, never the reply: a done dry run of this version, and a new enable approval held for it.
        const found = await waitFor(
          "a done dry run of the current version and an enable approval held for it",
          () => {
            const got = tryDb(dataDir, (db) => ({
              dry: runsIn(db, id).filter((x) => x.kind === "dry_run" && x.version === version && x.status === "done").at(-1),
              approval: enableApprovalsIn(db, id).find((a) => a.id > startApproval && a.subject_version === version),
            }));
            return got?.dry !== undefined && got.approval !== undefined ? { dry: got.dry, approval: got.approval } : undefined;
          },
          Math.max(0, Date.parse(minutes.first.at) - Date.now() - 2 * MINUTE),
          2_000,
        );
        approvalId = found.approval.id;
        rec.dry_run = runRecord(found.dry);
        rec.approval = approvalRecord(found.approval);
        rec.enable_approvals = enableApprovals(id).map(approvalRecord);
        const listed = await studio(["approvals", "--all", "--json"], 15_000);
        try {
          const entry = (JSON.parse(listed.stdout) as { approvals?: { id?: unknown; display?: unknown; status?: unknown; playbook?: unknown }[] }).approvals?.find((a) => a.id === approvalId);
          rec.studio_approvals_entry = entry === undefined ? null : { id: entry.id, status: entry.status, playbook: entry.playbook, display: typeof entry.display === "string" ? clipped(entry.display, 2_000) : null };
        } catch {
          rec.studio_approvals_entry = { unreadable: clipped(listed.stdout, 300), exit: listed.code };
        }
        const mirrorLine = mirrorDryRunLine(slug);
        rec.mirror_last_dry_run = mirrorLine === null ? null : clipped(mirrorLine, 1_000);
        const shown = `Dry run ${found.dry.id} of version ${version} completed`;
        expect(found.approval.display ?? "", "the enable approval's display does not show the dry run").toContain(`dry run: ${shown}`);
        expect(mirrorLine ?? "", "the mirror's Last dry run line does not show the dry run").toContain(shown);
        expect(playbookRow(id)?.status).toBe("draft");
        console.log(`phase-3-exit-live: read it with studio approvals, then approve the enable: studio approve ${approvalId} once (before ${minutes.first.hhmm})`);
      });

      await step("4_owner_approves", async (rec) => {
        rec.approval_id = approvalId;
        const enabled = await waitFor(
          "the owner's approval and Wright's retry enabling the playbook",
          () => {
            const row = tryDb(dataDir, (db) => playbookRowIn(db, id));
            return row?.status === "enabled" ? row : undefined;
          },
          Math.max(0, Date.parse(minutes.first.at) - Date.now() - 30_000),
          2_000,
        );
        enabledVersion = enabled.version;
        rec.enabled_at = new Date().toISOString();
        rec.row = enabled;
        // Every enable approval for the playbook: one more after the approved one means Wright asked again instead of repeating the held call.
        rec.enable_approvals = enableApprovals(id).map(approvalRecord);
        const decided = eventsWhere("approval_decided", "id", approvalId);
        const used = eventsWhere("approval_used", "id", approvalId);
        const enabledEvents = eventsWhere("playbook_enabled", "playbook_id", id);
        Object.assign(rec, { approval_decided: decided, approval_used: used, playbook_enabled: enabledEvents });
        expect(decided.map((e) => e.payload), "the approval was not decided once by the owner").toMatchObject([{ decision: "once", by: "owner" }]);
        expect(enabledEvents.map((e) => e.payload)).toMatchObject([{ playbook_id: id, version: enabledVersion, approval_id: approvalId, by: "owner" }]);
        expect(Date.now(), "enabled after the first minute").toBeLessThan(Date.parse(minutes.first.at));
      });

      await step("5_fires_at_its_minute", async (rec) => {
        const run = await waitFor(
          "the first minute's fire run, ended",
          () => {
            const fire = tryDb(dataDir, (db) => runsIn(db, id))?.filter((x) => x.kind === "fire")[0];
            return fire !== undefined && fire.status !== "running" ? fire : undefined;
          },
          Date.parse(minutes.first.at) - Date.now() + FIRE_SLACK_MS + RUN_END_MS,
          2_000,
        );
        firstRun = run;
        const queue = queueOf(id);
        const sessionId = run.session_id;
        const session =
          sessionId === null
            ? null
            : withDb(dataDir, (db) =>
                db
                  .prepare<[number], { id: number; agent: string | null; status: string; model: string | null; playbook: number | null; playbook_version: number | null; started_at: string | null; ended_at: string | null }>(
                    "SELECT id, agent, status, model, playbook, playbook_version, started_at, ended_at FROM sessions WHERE id = ?",
                  )
                  .get(sessionId),
              ) ?? null;
        const trigger = linkedTrigger(slug);
        Object.assign(rec, {
          run: runRecord(run),
          queue,
          session,
          trigger: trigger ?? null,
          trigger_events: trigger === undefined ? {} : triggerEvents(trigger.id),
          notifications: wrightNotificationsSince(minutes.first.at),
          fired_late_ms: Date.parse(run.started_at) - Date.parse(minutes.first.at),
        });
        expect(instantOf(id, queue[0]), "the first queued message is not for the first minute").toBe(Date.parse(minutes.first.at));
        expect(queue[0]?.priority, "the message was not queued at the playbook's priority").toBe(OWNER_PRIORITY);
        expect(run).toMatchObject({ status: "done", version: enabledVersion });
        expect(run.dedupe_key, "the run has no dedupe key").not.toBeNull();
        expect(session).toMatchObject({ agent: ASK_AGENT, model: wrightModel, playbook: id, playbook_version: enabledVersion });
        expect(Date.now(), "the first run ended after the second minute, so its key could not make the second a duplicate").toBeLessThan(Date.parse(minutes.second.at));
      });

      await step("6_second_minute_skipped", async (rec) => {
        await waitFor(
          "the second minute's fire run",
          () => {
            const second = tryDb(dataDir, (db) => runsIn(db, id))?.filter((x) => x.kind === "fire")[1];
            return second !== undefined && second.status !== "running" ? second : undefined;
          },
          Date.parse(minutes.second.at) - Date.now() + FIRE_SLACK_MS,
          2_000,
        );
        // A little longer: a session started for the second minute would show up here.
        await sleep(15_000);
        const runs = runsOf(id);
        const fires = runs.filter((x) => x.kind === "fire");
        const dryRunSessions = new Set(runs.filter((x) => x.kind === "dry_run").map((x) => x.session_id));
        const sessions = withDb(dataDir, (db) =>
          db.prepare<[number], { id: number; status: string; started_at: string | null }>("SELECT id, status, started_at FROM sessions WHERE playbook = ? ORDER BY id").all(id),
        );
        const queue = queueOf(id);
        const trigger = linkedTrigger(slug);
        Object.assign(rec, {
          fire_runs: fires.map(runRecord),
          queue,
          playbook_sessions: sessions,
          trigger: trigger ?? null,
          trigger_events: trigger === undefined ? {} : triggerEvents(trigger.id),
          notifications_since_second: wrightNotificationsSince(minutes.second.at),
          event_kinds: eventKindsSince(firstEvent),
        });
        expect(fires).toHaveLength(2);
        expect(instantOf(id, queue[1]), "the second queued message is not for the second minute").toBe(Date.parse(minutes.second.at));
        expect(fires[1]).toMatchObject({ status: "skipped_duplicate", session_id: null, dedupe_key: firstRun?.dedupe_key });
        expect(
          sessions.filter((s) => !dryRunSessions.has(s.id)).map((s) => s.id),
          "a session other than the first fire's (and the dry run's) ran for the playbook",
        ).toEqual([firstRun?.session_id]);
      });
    },
    FLOW_TIMEOUT_MS,
  );
});
