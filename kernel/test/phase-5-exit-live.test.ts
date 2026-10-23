// Opt-in live harness for the phase 5 exit check (item 18): the
// machine-observable half of docs/evidence/phase-5-exit-runbook.md. Phase 5
// is done when everything in phases 2-4 can be done from the app, with
// nothing typed in a terminal (the criterion starts after setup). The
// deterministic proof is `app/e2e/phase-5-exit.spec.ts` (CI); this is the
// live check. Never runs in CI or by default. The owner starts it on his Mac
// after the runbook's setup, before he opens the packaged app:
//
//   cd kernel && STUDIO_LIVE=1 npx vitest run test/phase-5-exit-live.test.ts
//
// It ONLY READS. It opens the installed service's store (`STUDIO_DATA_DIR`,
// else `~/.loomwright-studio`) through a read-only SQLite connection
// (`withDb`) and reads `config/agents/wright.json` as a file. It never calls
// the `studio` CLI, never posts to the API, never decides an approval and
// never writes the store or a settings file. The owner does every step in
// `Loomwright Studio.app`; every decision is his (D33).
//
// When it begins it records a run start: the highest id in `events`,
// `approvals`, `sessions`, `playbook_runs` and `notifications`, and Wright's
// model. Only what comes after that counts. It then polls the store every few
// seconds and checks the six flows the e2e walks, each from the store (rows,
// events, decisions), never from what a reply says:
//
//   1. Phase 2: a trigger Wright registered (an agent trigger, no playbook)
//      fired at its instant: a `trigger_fired` event, the instant's work step
//      recorded `fired`, and the notification row the fire names.
//   2. Phase 3: a playbook Wright drafted, its priority set by the owner
//      (`playbook_updated` by `owner` naming `priority`, the row's
//      `priority_set_by = 'owner'`), a dry run `done`, the enable approved
//      `once` by the owner and applied by the kernel (`playbook_enabled`
//      naming that approval, the row `enabled`), and a run now with a session.
//   3. Phase 4: a crew member Wright drafted and the kernel created on the
//      owner's `once` (the row `active`, its charter's `never` lists
//      `git_push`); in its own session a push denied `agent_boundary`
//      (category `git_push`) and that decision in the session's output log
//      (what the Sessions screen shows); no approval row and no allow for a
//      push; its `gh pr comment` held and denied by the owner.
//   4. Sessions: an owner Stop ending its session `stopped` (`owner_stop`),
//      and an owner Kill ending another `stopped` (`owner_kill`), each after
//      its `session_stop_requested` `{by: "owner", mode}`.
//   5. Menu bar: a pause from the app (`pause_engaged`, `via: "api"`), a
//      trigger instant recorded `missed_paused` while paused (a
//      `trigger_missed`, reason `paused`, never fired), that same pause released
//      from the app, and the kill switch engaged (`kill_switch_engaged`).
//   6. Team: Wright's model set by the owner (`agent_settings_set` for
//      `wright`, field `model`), and `wright.json` carrying that model.
//
// Each flow is `pass`, `fail` (the flow started but an effect is missing or
// wrong) or `not_exercised` (nothing of it happened since the run start). The
// run passes only when all six pass: a flow the owner did not do fails the
// run, never passing silently. The harness ends as soon as all six pass, or
// at the deadline (`STUDIO_LIVE_WAIT_MIN`, default 90 minutes).
//
// What only the owner can see (that nothing was typed in a terminal, the
// notification on screen, the approve and deny decisions, which screen or
// tray item he used) is not here: the summary carries `owner` fields, null,
// for him to fill in the evidence file.
//
// Cleanup writes nothing: the harness lists what the run left (its playbook,
// triggers and crew member still on, approvals still pending, a pause or the
// kill switch still engaged) under `cleanup`, and the owner turns them off in
// the app.
//
// A run summary (the evidence file's shape: per-flow outcome, the rows and
// events read, findings, and null `owner` fields; never env or tokens, any
// `sk-ant-...` string redacted and the home dir written as `~`) is written to
// the path printed at the start, mode 0600, after every change.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agents/index.js";
import { engageKillSwitch, releaseKillSwitch } from "../src/api/kill-switch.js";
import { ASK_AGENT, wrightSettingsPath } from "../src/brain/index.js";
import { SESSION_STOP_REQUESTED } from "../src/console/control.js";
import { PAUSE_ENGAGED, PAUSE_RELEASED, engagePause, releasePause } from "../src/console/pause.js";
import { NO_REF, appendEvent } from "../src/loop/internal.js";
import { createPlaybook, enablePlaybook, setPlaybookPolicy } from "../src/playbooks/store.js";
import { LAUNCHCTL_PATH, SERVICE_LABEL, parseLaunchctlPrint } from "../src/service/index.js";
import { classifyToolCall, neverCategoriesOf } from "../src/sessions/policy.js";
import type { RailContext } from "../src/sessions/policy.js";
import { resolveDataDir } from "../src/store/index.js";
import { fireDueTriggers, registerTrigger } from "../src/triggers/store.js";
import { withDb } from "./crash-helpers.js";
import { loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

const LIVE = process.env.STUDIO_LIVE === "1";

const REPO_DIR = fileURLToPath(new URL("../..", import.meta.url));
const MINUTE = 60_000;
/** How often the harness re-reads the store while the owner works in the app. */
const POLL_MS = 5_000;
/** The default wait for all six flows (`STUDIO_LIVE_WAIT_MIN` overrides it). */
const DEFAULT_WAIT_MIN = 90;
const MAX_WAIT_MIN = 240;

// ---- Run start, outcomes and the summary ------------------------------------------

/** The six flows, in the order the runbook and the e2e walk them; also the keys of the summary's `steps` (the evidence file's, as in phase 4). */
export const FLOW_NAMES = [
  "1_reminder_fires",
  "2_playbook_priority_enable_run",
  "3_reviewer_cannot_push",
  "4_sessions_stop_and_kill",
  "5_menu_bar_pause_and_kill_switch",
  "6_team_sets_wright_model",
] as const;
export type FlowName = (typeof FLOW_NAMES)[number];

export type FlowOutcome = "pass" | "fail" | "not_exercised";

/** One flow's verdict: its outcome, what the harness read (for the evidence file's `harness` block) and why it did not pass. */
export interface FlowCheck {
  readonly outcome: FlowOutcome;
  readonly harness: Record<string, unknown>;
  readonly findings: readonly string[];
}

/** What the store held when the harness began: only rows and events after these ids count. */
export interface RunStart {
  readonly at: string;
  readonly event_id: number;
  readonly approval_id: number;
  readonly session_id: number;
  readonly playbook_run_id: number;
  readonly notification_id: number;
  /** Wright's model in `wright.json` at the start, or null (no file, unreadable, or no model). */
  readonly wright_model: string | null;
}

/** What only the owner can see, per flow: the evidence file's `owner` fields, null until he fills them in (D33). */
export const OWNER_FIELDS: Readonly<Record<FlowName, readonly string[]>> = {
  "1_reminder_fires": ["asked_in_chat", "fired_card_seen_in_chat", "notification_appeared_on_screen", "notification_click_opened_thread"],
  "2_playbook_priority_enable_run": ["draft_card_seen_in_chat", "priority_set_from_card", "dry_run_seen", "approved_in_approvals_by", "approved_at", "run_now_pressed"],
  "3_reviewer_cannot_push": ["charter_card_seen", "create_pressed_by", "push_deny_seen_in_sessions_output", "comment_held_seen_in_approvals", "denied_by", "denied_at"],
  "4_sessions_stop_and_kill": ["stop_pressed_in_sessions", "kill_confirm_shown", "kill_confirmed"],
  "5_menu_bar_pause_and_kill_switch": ["pause_all_from_tray", "resume_from_tray", "kill_switch_from_tray", "kill_switch_confirm_shown", "resumed_after_kill_switch"],
  "6_team_sets_wright_model": ["set_in_team_inspector", "model_chosen"],
};

/** The run's own owner fields (D33): the criterion itself is his observation. */
export const RUN_OWNER_FIELDS: readonly string[] = ["nothing_typed_in_a_terminal_after_setup", "app_opened_from", "notes"];

/** Replace anything token-shaped, and the home dir, before it is written anywhere. */
export function redact(text: string, home: string = homedir()): string {
  const tokenFree = text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-[REDACTED]");
  return home.length > 1 ? tokenFree.split(home).join("~") : tokenFree;
}

/** Write `summary` to `path`, redacted, mode 0600 (a fresh path per run, so the mode is set at creation). */
export function writeSummary(path: string, summary: unknown, home: string = homedir()): void {
  writeFileSync(path, `${redact(JSON.stringify(summary, null, 2), home)}\n`, { mode: 0o600 });
}

/** The minutes to wait for the six flows: `STUDIO_LIVE_WAIT_MIN` when it is a whole number 1-240, else the default. */
export function waitMinutes(raw: string | undefined): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return DEFAULT_WAIT_MIN;
  const n = Number(raw.trim());
  return n >= 1 && n <= MAX_WAIT_MIN ? n : DEFAULT_WAIT_MIN;
}

/** `passed` only when every flow passed; a `fail` or `not_exercised` flow fails the run. */
export function runResult(flows: Readonly<Record<FlowName, FlowCheck>>): "passed" | "failed" {
  return FLOW_NAMES.every((f) => flows[f].outcome === "pass") ? "passed" : "failed";
}

/** A summary in the evidence file's shape, every `owner` field null and `run_by` for the owner to fill in. */
export function newSummary(start: RunStart, summaryPath: string): Record<string, unknown> & { steps: Record<FlowName, Record<string, unknown>> } {
  const steps = Object.fromEntries(
    FLOW_NAMES.map((f) => [f, { outcome: "not_exercised", harness: {}, owner: Object.fromEntries(OWNER_FIELDS[f].map((k) => [k, null])), findings: [] }]),
  ) as unknown as Record<FlowName, Record<string, unknown>>;
  return {
    test: "phase-5-exit-live",
    date: start.at.slice(0, 10),
    result: "running",
    run_by: null,
    harness_summary: summaryPath,
    run_start: start,
    wright_model_at_start: start.wright_model,
    owner: Object.fromEntries(RUN_OWNER_FIELDS.map((k) => [k, null])),
    steps,
    cleanup: {},
  };
}

/** Put `checks` into `summary.steps`, keeping each flow's `owner` fields. */
export function recordChecks(summary: { steps: Record<FlowName, Record<string, unknown>> }, checks: Readonly<Record<FlowName, FlowCheck>>): void {
  for (const f of FLOW_NAMES) {
    const c = checks[f];
    summary.steps[f] = { ...summary.steps[f], outcome: c.outcome, harness: c.harness, findings: [...c.findings] };
  }
}

// ---- Store reads (read-only) -----------------------------------------------------

interface EventRow {
  readonly id: number;
  readonly at: string;
  readonly kind: string;
  readonly actor: string | null;
  readonly session_id: number | null;
  readonly payload: Record<string, unknown>;
}

interface ApprovalRow {
  readonly id: number;
  readonly requesting_agent: string;
  readonly requesting_session: number | null;
  readonly action: string;
  readonly status: string;
  readonly decision: string | null;
  readonly decided_by: string | null;
  readonly requested_at: string;
  readonly decided_at: string | null;
}

interface SessionRow {
  readonly id: number;
  readonly agent: string | null;
  readonly status: string;
  readonly playbook: number | null;
  readonly cwd: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function payloadOf(json: string | null): Record<string, unknown> {
  if (json === null) return {};
  try {
    const v = JSON.parse(json) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const maxId = (db: Database.Database, table: string): number => db.prepare<[], number>(`SELECT COALESCE(MAX(id), 0) FROM ${table}`).pluck().get() ?? 0;

/** Wright's model in `wright.json`, read as a file (never through the settings reader, which may create the file). */
export function wrightModelIn(dataDir: string): { readonly model: string | null; readonly error: string | null } {
  try {
    const parsed = JSON.parse(readFileSync(wrightSettingsPath(dataDir), "utf8")) as unknown;
    const model = typeof parsed === "object" && parsed !== null ? (parsed as { model?: unknown }).model : undefined;
    return { model: typeof model === "string" && model !== "" ? model : null, error: null };
  } catch (err) {
    return { model: null, error: (err as { code?: unknown }).code === "ENOENT" ? "missing" : "unreadable" };
  }
}

/** The run start: the highest ids now, the time and Wright's model. */
export function readRunStart(db: Database.Database, dataDir: string, now: Date = new Date()): RunStart {
  return {
    at: now.toISOString(),
    event_id: maxId(db, "events"),
    approval_id: maxId(db, "approvals"),
    session_id: maxId(db, "sessions"),
    playbook_run_id: maxId(db, "playbook_runs"),
    notification_id: maxId(db, "notifications"),
    wright_model: wrightModelIn(dataDir).model,
  };
}

function eventsSince(db: Database.Database, start: RunStart, kinds: readonly string[]): EventRow[] {
  return db
    .prepare<unknown[], { id: number; at: string; kind: string; actor: string | null; session_id: number | null; payload_json: string | null }>(
      `SELECT id, at, kind, actor, session_id, payload_json FROM events WHERE id > ? AND kind IN (${kinds.map(() => "?").join(", ")}) ORDER BY id`,
    )
    .all(start.event_id, ...kinds)
    .map((r) => ({ id: r.id, at: r.at, kind: r.kind, actor: r.actor, session_id: r.session_id, payload: payloadOf(r.payload_json) }));
}

const APPROVAL_COLUMNS = "id, requesting_agent, requesting_session, action, status, decision, decided_by, requested_at, decided_at";

const approvalById = (db: Database.Database, id: number): ApprovalRow | undefined =>
  db.prepare<[number], ApprovalRow>(`SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE id = ?`).get(id);

const SESSION_COLUMNS = "id, agent, status, playbook, cwd, started_at, ended_at";

/** A work step's status and its stored result's `result` field (a trigger instant's `fired` / `missed_*`). */
function stepOf(db: Database.Database, key: string): { readonly status: string; readonly result: string | null } | undefined {
  const row = db.prepare<[string], { status: string; result_json: string | null }>("SELECT status, result_json FROM work_steps WHERE key = ?").get(key);
  return row === undefined ? undefined : { status: row.status, result: str(payloadOf(row.result_json).result) };
}

const isOwnerOnce = (a: ApprovalRow | undefined): boolean => a !== undefined && a.status === "approved" && a.decision === "once" && a.decided_by === "owner";
const isOwnerDeny = (a: ApprovalRow | undefined): boolean => a !== undefined && a.status === "denied" && a.decision === "deny" && a.decided_by === "owner";

const pass = (harness: Record<string, unknown>): FlowCheck => ({ outcome: "pass", harness, findings: [] });
const fail = (harness: Record<string, unknown>, findings: readonly string[]): FlowCheck => ({ outcome: "fail", harness, findings });
const notExercised = (harness: Record<string, unknown>, finding: string): FlowCheck => ({ outcome: "not_exercised", harness, findings: [finding] });

/** The candidate with no problems, else the one with the fewest (the flow's findings). */
function best<T extends { readonly problems: readonly string[] }>(candidates: readonly T[]): T | undefined {
  return [...candidates].sort((a, b) => a.problems.length - b.problems.length)[0];
}

// ---- The six flow checkers -------------------------------------------------------

/** Flow 1 (phase 2): a trigger Wright registered fired at its instant, recorded `fired`, with its notification row. */
export function checkReminderFlow(db: Database.Database, start: RunStart): FlowCheck {
  const registered = eventsSince(db, start, ["trigger_registered"]).filter(
    (e) => e.payload.owning_agent === ASK_AGENT && e.payload.created_by === "agent" && e.payload.playbook === undefined && num(e.payload.trigger_id) !== null,
  );
  const harness: Record<string, unknown> = {
    registered: registered.map((e) => ({ event_id: e.id, at: e.at, trigger_id: e.payload.trigger_id, kind: e.payload.kind, action: e.payload.action, spec: e.payload.spec })),
  };
  if (registered.length === 0) return notExercised(harness, "Wright registered no trigger since the run started (ask Wright in Chat for a reminder)");
  const ids = new Set(registered.map((e) => num(e.payload.trigger_id)).filter((n): n is number => n !== null));
  const fires = eventsSince(db, start, ["trigger_fired"])
    .filter((e) => ids.has(num(e.payload.trigger_id) ?? -1))
    .map((e) => {
      const triggerId = num(e.payload.trigger_id) ?? 0;
      const scheduledAt = str(e.payload.scheduled_at);
      const notificationId = num(e.payload.notification_id);
      const notification =
        notificationId === null
          ? undefined
          : db
              .prepare<[number], { id: number; source: string; deep_link: string; delivery_status: string; created_at: string }>(
                "SELECT id, source, deep_link, delivery_status, created_at FROM notifications WHERE id = ?",
              )
              .get(notificationId);
      const step = scheduledAt === null ? undefined : stepOf(db, `trigger:${triggerId}:${scheduledAt}`);
      const problems: string[] = [];
      if (step?.status !== "done" || step.result !== "fired") {
        problems.push(`trigger ${triggerId}'s instant ${String(scheduledAt)} is not recorded fired (work step: ${step === undefined ? "none" : `${step.status}, ${String(step.result)}`})`);
      }
      if (notification === undefined) problems.push(`trigger ${triggerId}'s fire names no notification row (a reminder notifies)`);
      else if (notification.source !== `trigger:${triggerId}`) problems.push(`notification ${notification.id}'s source is ${notification.source}, not trigger:${triggerId}`);
      return { event_id: e.id, at: e.at, trigger_id: triggerId, scheduled_at: scheduledAt, notification: notification ?? null, step: step ?? null, problems };
    });
  harness.fires = fires;
  harness.misses = eventsSince(db, start, ["trigger_missed"])
    .filter((e) => ids.has(num(e.payload.trigger_id) ?? -1))
    .map((e) => ({ event_id: e.id, trigger_id: e.payload.trigger_id, reason: e.payload.reason, scheduled_at: e.payload.scheduled_at }));
  const chosen = best(fires);
  if (chosen !== undefined && chosen.problems.length === 0) return pass({ ...harness, passing_fire: chosen.event_id });
  return fail(harness, chosen === undefined ? [`trigger ${[...ids].join(", ")} registered but not fired since the run started (wait past its instant)`] : chosen.problems);
}

/** Flow 2 (phase 3): Wright's draft, the owner's priority, a dry run, the owner's `once` applied by the kernel, then a run now with a session. */
export function checkPlaybookFlow(db: Database.Database, start: RunStart): FlowCheck {
  const created = eventsSince(db, start, ["playbook_created"]).filter((e) => e.payload.by === "wright" && num(e.payload.playbook_id) !== null);
  const harness: Record<string, unknown> = { created: created.map((e) => ({ event_id: e.id, at: e.at, playbook_id: e.payload.playbook_id, slug: e.payload.slug })) };
  if (created.length === 0) return notExercised(harness, "Wright drafted no playbook since the run started (ask Wright in Chat for one)");
  const updates = eventsSince(db, start, ["playbook_updated", "playbook_dry_run", "playbook_enabled", "playbook_disabled"]);
  const candidates = created.map((c) => {
    const id = num(c.payload.playbook_id) ?? 0;
    const mine = updates.filter((e) => num(e.payload.playbook_id) === id);
    const row = db
      .prepare<[number], { id: number; slug: string; status: string; version: number; priority: string; priority_set_by: string | null }>(
        "SELECT id, slug, status, version, priority, priority_set_by FROM playbooks WHERE id = ?",
      )
      .get(id);
    const prioritySets = mine.filter((e) => e.kind === "playbook_updated" && e.payload.by === "owner" && Array.isArray(e.payload.fields) && e.payload.fields.includes("priority"));
    const dryRuns = mine.filter((e) => e.kind === "playbook_dry_run" && e.payload.status === "done");
    const enables = mine.filter((e) => e.kind === "playbook_enabled");
    const enable = enables.at(-1);
    const enableApprovalId = num(enable?.payload.approval_id);
    const approval = enableApprovalId === null ? undefined : approvalById(db, enableApprovalId);
    const runs = db
      .prepare<[number, number], { id: number; version: number; status: string; session_id: number | null; started_at: string }>(
        "SELECT id, version, status, session_id, started_at FROM playbook_runs WHERE playbook = ? AND kind = 'run_now' AND id > ? ORDER BY id",
      )
      .all(id, start.playbook_run_id);
    const runSessions = runs.flatMap((r) => (r.session_id === null ? [] : [db.prepare<[number], SessionRow>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`).get(r.session_id)]));
    const problems: string[] = [];
    if (row === undefined) problems.push(`playbook ${id} has no row`);
    if (prioritySets.length === 0) problems.push(`playbook ${id}: no priority set by the owner (Set priority on its card)`);
    else if (row?.priority_set_by !== "owner") problems.push(`playbook ${id}: the row's priority is not the owner's (priority_set_by ${String(row?.priority_set_by)})`);
    if (dryRuns.length === 0) problems.push(`playbook ${id}: no dry run done since the run started`);
    if (enable === undefined) problems.push(`playbook ${id}: the kernel never enabled it (no playbook_enabled)`);
    else if (approval?.action !== "kernel_playbook_enable" || !isOwnerOnce(approval)) {
      problems.push(`playbook ${id}: the enable's approval ${String(enableApprovalId)} is not a kernel_playbook_enable the owner approved once (${approval === undefined ? "no row" : `${approval.action}, ${approval.status}, ${String(approval.decision)}, by ${String(approval.decided_by)}`})`);
    }
    if (enable !== undefined && row !== undefined && row.status !== "enabled") problems.push(`playbook ${id} is ${row.status}, not enabled`);
    if (!runs.some((r) => r.session_id !== null)) problems.push(`playbook ${id}: no run now started a session (Run now on its card)`);
    return {
      playbook_id: id,
      row: row ?? null,
      priority_sets: prioritySets.map((e) => ({ event_id: e.id, at: e.at, version: e.payload.version })),
      dry_runs: dryRuns.map((e) => ({ event_id: e.id, at: e.at, version: e.payload.version, run_id: e.payload.run_id })),
      enabled: enable === undefined ? null : { event_id: enable.id, at: enable.at, version: enable.payload.version, approval_id: enableApprovalId },
      enable_approval: approval ?? null,
      run_now: runs,
      run_now_sessions: runSessions,
      problems,
    };
  });
  harness.playbooks = candidates;
  const chosen = best(candidates);
  if (chosen !== undefined && chosen.problems.length === 0) return pass({ ...harness, passing_playbook: chosen.playbook_id });
  return fail(harness, chosen?.problems ?? []);
}

/** Whether a Bash command is a push by the rail's own reading (`classifyToolCall`, `neverCategoriesOf`). */
function isPushCommand(command: string, ctx: RailContext): boolean {
  const rail = classifyToolCall("Bash", { command }, ctx);
  if (rail.kind !== "outward") return false;
  return [rail.action, ...(rail.alsoReads ?? [])].some((form) => neverCategoriesOf(form).includes("git_push"));
}

const isPushAction = (action: string): boolean => neverCategoriesOf(action).includes("git_push");
const isCommentAction = (action: string): boolean => neverCategoriesOf(action).includes("gh_pr_comment");

/** The `tool_policy.never` list of a stored charter (`agents.charter_json`), or null when it has none. */
function charterNever(json: string): string[] | null {
  const policy = payloadOf(json).tool_policy;
  const never = typeof policy === "object" && policy !== null ? (policy as { never?: unknown }).never : undefined;
  return Array.isArray(never) ? never.filter((c): c is string => typeof c === "string") : null;
}

/** Flow 3 (phase 4): the reviewer created on the owner's `once`, its push denied `agent_boundary` (in its output log too), its comment held and denied. */
export function checkReviewerFlow(db: Database.Database, start: RunStart, dataDir: string, home: string = homedir()): FlowCheck {
  const created = eventsSince(db, start, ["agent_created"]).filter((e) => e.payload.by === "wright" && str(e.payload.id) !== null);
  const harness: Record<string, unknown> = { created: created.map((e) => ({ event_id: e.id, at: e.at, id: e.payload.id, approval_id: e.payload.approval_id })) };
  if (created.length === 0) return notExercised(harness, "the kernel created no crew member Wright drafted since the run started (ask Wright in Chat for a comment-only reviewer, then press Create)");
  const candidates = created.map((c) => {
    const id = str(c.payload.id) ?? "";
    const row = db
      .prepare<[string], { id: string; status: string; created_by: string; approval_id: number | null; charter_json: string }>(
        "SELECT id, status, created_by, approval_id, charter_json FROM agents WHERE id = ?",
      )
      .get(id);
    const createApproval = row?.approval_id === null || row === undefined ? undefined : approvalById(db, row.approval_id);
    const never = row === undefined ? null : charterNever(row.charter_json);
    const sessions = db.prepare<[string, number], SessionRow>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE agent = ? AND id > ? ORDER BY id`).all(id, start.session_id);
    const sessionIds = new Set(sessions.map((s) => s.id));
    const decisions = eventsSince(db, start, ["tool_decision"]).filter((e) => e.session_id !== null && sessionIds.has(e.session_id));
    const boundary = decisions.filter((e) => e.payload.decision === "deny" && e.payload.reason === "agent_boundary" && e.payload.category === "git_push");
    const shown = db
      .prepare<[], { session_id: number; seq: number; payload_json: string }>("SELECT session_id, seq, payload_json FROM session_output WHERE kind = 'tool_decision' ORDER BY id")
      .all()
      .filter((r) => sessionIds.has(r.session_id))
      .map((r) => ({ session_id: r.session_id, seq: r.seq, payload: payloadOf(r.payload_json) }))
      .filter((r) => r.payload.decision === "deny" && r.payload.reason === "agent_boundary" && r.payload.category === "git_push");
    // The output log copies the decision event itself, so a shown deny must be in that deny's own session (and name its tool call when the event does).
    const shownFor = (e: EventRow): boolean =>
      shown.some((r) => r.session_id === e.session_id && (e.payload.tool_use_id === undefined || r.payload.tool_use_id === e.payload.tool_use_id));
    const boundaryShown = boundary.filter(shownFor);
    const cwdOf = (sessionId: number | null): string => sessions.find((s) => s.id === sessionId)?.cwd ?? "/";
    const allowedPushes = decisions.filter(
      (e) => e.payload.decision === "allow" && e.payload.tool === "Bash" && typeof e.payload.command === "string" && isPushCommand(e.payload.command, { dataDir, homeDir: home, cwd: cwdOf(e.session_id) }),
    );
    const approvals = db.prepare<[string, number], ApprovalRow>(`SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE requesting_agent = ? AND id > ? ORDER BY id`).all(id, start.approval_id);
    const pushApprovals = approvals.filter((a) => isPushAction(a.action));
    const comments = approvals.filter((a) => isCommentAction(a.action));
    const problems: string[] = [];
    if (row === undefined) problems.push(`crew member ${id} has no row`);
    else {
      if (row.created_by !== "wright") problems.push(`${id} was created by ${row.created_by}, not drafted by Wright`);
      if (createApproval?.action !== "kernel_agent_create" || !isOwnerOnce(createApproval)) problems.push(`${id}'s create approval ${String(row.approval_id)} is not a kernel_agent_create the owner approved once`);
      if (row.status !== "active") problems.push(`${id} is ${row.status}, not active`);
      if (never === null || !never.includes("git_push")) problems.push(`${id}'s charter never list does not cover git_push (${JSON.stringify(never)})`);
    }
    if (boundary.length === 0) problems.push(`no git push denied agent_boundary in ${id}'s sessions since the run started (ask it, in its thread, to push)`);
    else if (boundaryShown.length === 0) problems.push(`${id}'s agent_boundary deny is not in its own session's output log (what the Sessions screen shows)`);
    if (pushApprovals.length > 0) problems.push(`${id} has an approval row for a push (${pushApprovals.map((a) => `#${a.id} ${a.action} ${a.status}`).join(", ")})`);
    if (allowedPushes.length > 0) problems.push(`a push was allowed in ${id}'s sessions (events ${allowedPushes.map((e) => e.id).join(", ")})`);
    if (comments.length === 0) problems.push(`no gh pr comment held for ${id} since the run started (ask it, in its thread, to comment on a PR)`);
    else if (!comments.some(isOwnerDeny)) problems.push(`${id}'s held comment was not denied by the owner (${comments.map((a) => `#${a.id} ${a.status} ${String(a.decision)} by ${String(a.decided_by)}`).join(", ")})`);
    return {
      agent_id: id,
      row: row === undefined ? null : { id: row.id, status: row.status, created_by: row.created_by, approval_id: row.approval_id, never },
      create_approval: createApproval ?? null,
      sessions,
      boundary_denies: boundary.map((e) => ({ event_id: e.id, session_id: e.session_id, payload: e.payload, in_output: shownFor(e) })),
      output_rows: shown,
      allowed_pushes: allowedPushes.map((e) => ({ event_id: e.id, session_id: e.session_id, command: e.payload.command })),
      push_approvals: pushApprovals,
      comment_approvals: comments,
      problems,
    };
  });
  harness.members = candidates;
  const chosen = best(candidates);
  if (chosen !== undefined && chosen.problems.length === 0) return pass({ ...harness, passing_member: chosen.agent_id });
  return fail(harness, chosen?.problems ?? []);
}

/** Flow 4 (Sessions): an owner Stop ending `stopped` (`owner_stop`) and an owner Kill of another session ending `stopped` (`owner_kill`). */
export function checkSessionControlFlow(db: Database.Database, start: RunStart): FlowCheck {
  const requests = eventsSince(db, start, [SESSION_STOP_REQUESTED]).filter((e) => e.payload.by === "owner" && e.session_id !== null);
  const statuses = eventsSince(db, start, ["session_status"]);
  const records = requests.map((r) => {
    const sessionId = r.session_id as number;
    const end = statuses.filter((e) => e.session_id === sessionId && e.id > r.id).at(-1);
    const row = db.prepare<[number], SessionRow>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`).get(sessionId);
    return {
      event_id: r.id,
      at: r.at,
      session_id: sessionId,
      mode: r.payload.mode,
      ended: end === undefined ? null : { event_id: end.id, at: end.at, to: end.payload.to, reason: end.payload.reason },
      request_to_end_ms: end === undefined ? null : Date.parse(end.at) - Date.parse(r.at),
      row_status: row?.status ?? null,
    };
  });
  const harness: Record<string, unknown> = { requests: records };
  if (records.length === 0) return notExercised(harness, "the owner stopped and killed no session since the run started (Stop one and Kill another on the Sessions screen)");
  const endedAs = (r: (typeof records)[number], reason: string): boolean => r.ended?.to === "stopped" && r.ended.reason === reason && r.row_status === "stopped";
  const stop = records.find((r) => r.mode === "stop" && endedAs(r, "owner_stop"));
  const kill = records.find((r) => r.mode === "kill" && endedAs(r, "owner_kill") && r.session_id !== stop?.session_id);
  const problems: string[] = [];
  const shownEnds = (mode: string): string =>
    records
      .filter((r) => r.mode === mode)
      .map((r) => `session ${r.session_id}: ${r.ended === null ? "not ended" : `${String(r.ended.to)} (${String(r.ended.reason)})`}`)
      .join("; ") || "none requested";
  if (stop === undefined) problems.push(`no owner Stop ended its session stopped (owner_stop): ${shownEnds("stop")}`);
  if (kill === undefined) problems.push(`no owner Kill of another session ended it stopped (owner_kill): ${shownEnds("kill")}`);
  if (problems.length > 0) return fail(harness, problems);
  return pass({ ...harness, passing_stop: stop?.session_id, passing_kill: kill?.session_id });
}

/** Flow 5 (menu bar): a pause from the app, an instant missed while paused, the pause released from the app, then the kill switch engaged. */
export function checkMenuBarFlow(db: Database.Database, start: RunStart): FlowCheck {
  const pauses = eventsSince(db, start, [PAUSE_ENGAGED, PAUSE_RELEASED]);
  const kills = eventsSince(db, start, ["kill_switch_engaged", "kill_switch_released"]);
  const harness: Record<string, unknown> = {
    pause_events: pauses.map((e) => ({ event_id: e.id, at: e.at, kind: e.kind, by: e.payload.by, via: e.payload.via })),
    kill_switch_events: kills.map((e) => ({ event_id: e.id, at: e.at, kind: e.kind, actor: e.actor })),
  };
  if (pauses.length === 0 && kills.length === 0) return notExercised(harness, "no pause and no kill switch since the run started (Pause all, then Kill switch, from the menu bar)");
  const problems: string[] = [];
  // `via` is `cli` for the `studio` verbs and `api` for every other client (the app); a row with neither is not counted as the app's.
  const fromCli = pauses.filter((e) => e.payload.via === "cli");
  if (fromCli.length > 0) problems.push(`a pause or release came through the studio CLI, not the app (events ${fromCli.map((e) => e.id).join(", ")})`);
  const misses = eventsSince(db, start, ["trigger_missed"]).filter((e) => e.payload.reason === "paused");
  const fires = eventsSince(db, start, ["trigger_fired"]);
  const windows = pauses
    .filter((e) => e.kind === PAUSE_ENGAGED && e.payload.via === "api")
    .map((p) => {
      const release = pauses.find((e) => e.kind === PAUSE_RELEASED && e.id > p.id);
      const missed = misses
        .filter((m) => m.id > p.id && (release === undefined || m.id < release.id))
        .map((m) => {
          const triggerId = num(m.payload.trigger_id) ?? 0;
          const scheduledAt = str(m.payload.scheduled_at);
          const step = scheduledAt === null ? undefined : stepOf(db, `trigger:${triggerId}:${scheduledAt}`);
          const firedToo = fires.some((f) => num(f.payload.trigger_id) === triggerId && f.payload.scheduled_at === scheduledAt);
          return { event_id: m.id, trigger_id: triggerId, scheduled_at: scheduledAt, step: step ?? null, fired_too: firedToo, ok: step?.result === "missed_paused" && !firedToo };
        });
      return { engaged: p.id, released: release === undefined ? null : { event_id: release.id, via: release.payload.via }, missed };
    });
  harness.pause_windows = windows;
  // One window must hold both: a paused instant recorded missed_paused and that same pause's release from the app.
  const good = windows.find((w) => w.released !== null && w.released.via === "api" && w.missed.some((m) => m.ok));
  if (windows.length === 0) problems.push("no Pause all from the app since the run started");
  else if (good === undefined) {
    const before = problems.length;
    if (!windows.some((w) => w.missed.some((m) => m.ok))) {
      const near = windows.flatMap((w) => w.missed);
      problems.push(
        near.length === 0
          ? "no trigger instant was recorded missed_paused while paused (have a reminder come due during the pause)"
          : `no paused instant was recorded missed_paused and never fired (${near.map((m) => `trigger ${m.trigger_id} at ${String(m.scheduled_at)}: ${String(m.step?.result)}${m.fired_too ? ", fired too" : ""}`).join("; ")})`,
      );
    }
    if (!windows.some((w) => w.released !== null && w.released.via === "api")) problems.push("the pause was not released from the app (Resume in the menu bar)");
    // Each half happened, but in different pauses: no one pause had both.
    if (problems.length === before) problems.push("no pause from the app had a paused instant recorded missed_paused and then a release from the app (the miss and the release were in different pauses)");
  }
  const engaged = kills.filter((e) => e.kind === "kill_switch_engaged");
  if (engaged.length === 0) problems.push("the kill switch was not engaged since the run started (Kill switch in the menu bar, then confirm)");
  harness.kill_switch_engaged_at = engaged.map((e) => e.at);
  if (problems.length > 0) return fail(harness, problems);
  return pass({ ...harness, passing_pause: good?.engaged });
}

/** Flow 6 (Team): the owner set Wright's model, and `wright.json` carries it. */
export function checkWrightModelFlow(db: Database.Database, start: RunStart, dataDir: string): FlowCheck {
  const sets = eventsSince(db, start, ["agent_settings_set"]).filter((e) => e.payload.id === ASK_AGENT && e.payload.field === "model");
  const file = wrightModelIn(dataDir);
  const harness: Record<string, unknown> = {
    model_at_start: start.wright_model,
    sets: sets.map((e) => ({ event_id: e.id, at: e.at, old: e.payload.old, new: e.payload.new, by: e.payload.by })),
    wright_json_model: file.model,
    wright_json_error: file.error,
  };
  if (sets.length === 0) return notExercised(harness, "Wright's model was not set since the run started (Team, Wright's inspector)");
  const last = sets.at(-1) as EventRow;
  const problems: string[] = [];
  if (last.payload.by !== "owner") problems.push(`the last model set was by ${String(last.payload.by)}, not the owner`);
  if (file.error !== null) problems.push(`wright.json is ${file.error}`);
  else if (file.model !== last.payload.new) problems.push(`wright.json's model is ${String(file.model)}, not the ${String(last.payload.new)} the owner set`);
  if (problems.length > 0) return fail(harness, problems);
  return pass(harness);
}

/** Every flow's check, over one read-only connection. */
export function checkAllFlows(db: Database.Database, start: RunStart, dataDir: string, home: string = homedir()): Record<FlowName, FlowCheck> {
  return {
    "1_reminder_fires": checkReminderFlow(db, start),
    "2_playbook_priority_enable_run": checkPlaybookFlow(db, start),
    "3_reviewer_cannot_push": checkReviewerFlow(db, start, dataDir, home),
    "4_sessions_stop_and_kill": checkSessionControlFlow(db, start),
    "5_menu_bar_pause_and_kill_switch": checkMenuBarFlow(db, start),
    "6_team_sets_wright_model": checkWrightModelFlow(db, start, dataDir),
  };
}

/** What the run left on, for the owner to turn off in the app; read only, nothing is written. */
export function cleanupList(db: Database.Database, start: RunStart): Record<string, unknown> {
  const pauseKinds = db
    .prepare<[string, string], string>("SELECT kind FROM events WHERE kind IN (?, ?) ORDER BY id DESC LIMIT 1")
    .pluck()
    .get(PAUSE_ENGAGED, PAUSE_RELEASED);
  const killKinds = db.prepare<[], string>("SELECT kind FROM events WHERE kind IN ('kill_switch_engaged', 'kill_switch_released') ORDER BY id DESC LIMIT 1").pluck().get();
  const playbookIds = eventsSince(db, start, ["playbook_created"]).map((e) => num(e.payload.playbook_id)).filter((n): n is number => n !== null);
  const agentIds = eventsSince(db, start, ["agent_created"]).map((e) => str(e.payload.id)).filter((s): s is string => s !== null);
  const triggerIds = eventsSince(db, start, ["trigger_registered"]).map((e) => num(e.payload.trigger_id)).filter((n): n is number => n !== null);
  return {
    playbooks_not_off: playbookIds.flatMap((id) => db.prepare<[number], { id: number; slug: string; status: string }>("SELECT id, slug, status FROM playbooks WHERE id = ? AND status != 'disabled'").all(id)),
    triggers_still_on: triggerIds.flatMap((id) => db.prepare<[number], { id: number; kind: string; playbook: string | null }>("SELECT id, kind, playbook FROM triggers WHERE id = ? AND enabled = 1").all(id)),
    crew_still_active: agentIds.flatMap((id) => db.prepare<[string], { id: string; status: string }>("SELECT id, status FROM agents WHERE id = ? AND status = 'active'").all(id)),
    pending_approvals: db.prepare<[number], { id: number; requesting_agent: string; action: string }>("SELECT id, requesting_agent, action FROM approvals WHERE id > ? AND status = 'pending' ORDER BY id").all(start.approval_id),
    paused: pauseKinds === PAUSE_ENGAGED,
    kill_switch_engaged: killKinds === "kill_switch_engaged",
  };
}

// ---- Deterministic (runs in CI, no service): the checkers against a canned store ----

/** One effect a canned run can leave out, or get wrong, and the flow that must then fail. */
const OMISSIONS = {
  reminder_not_fired: "1_reminder_fires",
  reminder_wakes_agent: "1_reminder_fires",
  priority_not_set: "2_playbook_priority_enable_run",
  dry_run_missing: "2_playbook_priority_enable_run",
  enable_not_applied: "2_playbook_priority_enable_run",
  run_now_missing: "2_playbook_priority_enable_run",
  never_lacks_push: "3_reviewer_cannot_push",
  push_held: "3_reviewer_cannot_push",
  deny_not_in_output: "3_reviewer_cannot_push",
  deny_shown_in_other_session: "3_reviewer_cannot_push",
  comment_approved: "3_reviewer_cannot_push",
  push_also_allowed: "3_reviewer_cannot_push",
  comment_never_held: "3_reviewer_cannot_push",
  kill_ends_as_stop: "4_sessions_stop_and_kill",
  stop_ends_as_kill: "4_sessions_stop_and_kill",
  no_kill: "4_sessions_stop_and_kill",
  missed_as_kill_switch: "5_menu_bar_pause_and_kill_switch",
  pause_not_released: "5_menu_bar_pause_and_kill_switch",
  miss_and_release_in_different_pauses: "5_menu_bar_pause_and_kill_switch",
  paused_from_cli: "5_menu_bar_pause_and_kill_switch",
  no_kill_switch: "5_menu_bar_pause_and_kill_switch",
  wright_json_unchanged: "6_team_sets_wright_model",
  wright_json_removed: "6_team_sets_wright_model",
} as const satisfies Record<string, FlowName>;
type Omission = keyof typeof OMISSIONS;

const START_MODEL = "claude-sonnet-5";
const NEW_MODEL = "claude-opus-5-5";
const REVIEWER = "rowan";

function writeWrightJson(dataDir: string, model: string): void {
  const path = wrightSettingsPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ model, tool_policy: { allowedTools: [], allowedBashPrefixes: [] } }, null, 2)}\n`);
}

function insertSession(env: LoopEnv, s: { agent: string; status: string; playbook?: number; version?: number }): number {
  return Number(
    env.store
      .prepare("INSERT INTO sessions (agent, status, playbook, playbook_version, started_at) VALUES (?, ?, ?, ?, ?)")
      .run(s.agent, s.status, s.playbook ?? null, s.version ?? null, env.now().toISOString()).lastInsertRowid,
  );
}

function insertApproval(env: LoopEnv, a: { agent: string; session: number | null; action: string; status: string; decision: string | null; payload?: unknown }): number {
  return Number(
    env.store
      .prepare(
        "INSERT INTO approvals (requesting_agent, requesting_session, action, payload_json, requested_at, status, decision, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        a.agent,
        a.session,
        a.action,
        JSON.stringify(a.payload ?? {}),
        env.now().toISOString(),
        a.status,
        a.decision,
        a.status === "pending" ? null : "owner",
        a.status === "pending" ? null : env.now().toISOString(),
      ).lastInsertRowid,
  );
}

function endSession(env: LoopEnv, id: number, reason: string): void {
  env.store.prepare("UPDATE sessions SET status = 'stopped', ended_at = ? WHERE id = ?").run(env.now().toISOString(), id);
  appendEvent(env.store, "session_status", { sessionId: id, taskId: null }, { from: "running", to: "stopped", reason }, env.now().toISOString());
}

const reviewerCharter = (workspace: string, never: readonly string[]): Record<string, unknown> => ({
  id: REVIEWER,
  display_name: "Rowan",
  avatar: { shape: "crab", hue: "crew-teal" },
  persona: "A careful reviewer who comments on pull requests.",
  duties: ["Review the pull requests the owner sends and comment on them."],
  boundaries: ["Never push code."],
  model: "claude-sonnet-5",
  permission_mode: "default",
  tool_policy: { allowedTools: ["Read", "Bash"], allowedBashPrefixes: ["git", "gh pr comment"], never: [...never] },
  limits: { sessions_at_once: 1 },
  workspaces: [workspace],
});

/**
 * Write every flow's effects into `env`'s store the way the kernel does (its
 * own trigger, playbook, pause, kill-switch and agent writers where they are
 * plain functions; the rows a session, an approval decision or a route
 * leaves otherwise), leaving out or getting wrong each effect in `omit` and
 * every flow in `skip`.
 */
function cannedRun(env: LoopEnv, workspace: string, omit: ReadonlySet<Omission> = new Set(), skip: ReadonlySet<FlowName> = new Set()): void {
  const store = env.store;
  const at = (): string => env.now().toISOString();
  const later = (ms: number): string => new Date(env.now().getTime() + ms).toISOString();

  if (!skip.has("1_reminder_fires")) {
    registerTrigger(store, { agent: ASK_AGENT, kind: "once", spec: later(MINUTE), action: omit.has("reminder_wakes_agent") ? "wake_agent" : "notify", text: "Stretch your legs." }, env.now());
    env.advance(2 * MINUTE);
    if (!omit.has("reminder_not_fired")) fireDueTriggers(store, env.now());
  }

  if (!skip.has("2_playbook_priority_enable_run")) {
    const draft = createPlaybook(store, { agent: ASK_AGENT, name: "Morning digest", intent: "Summarise my morning.", trigger: { kind: "cron", spec: "0 9 * * *", tz: "UTC" } }, env.now()).playbook;
    env.advance(1_000);
    const set = omit.has("priority_not_set") ? draft : setPlaybookPolicy(store, { id: draft.id, field: "priority", value: "high" }, env.now()).playbook;
    env.advance(1_000);
    if (!omit.has("dry_run_missing")) {
      const session = insertSession(env, { agent: ASK_AGENT, status: "completed", playbook: set.id, version: set.version });
      const run = Number(
        store
          .prepare("INSERT INTO playbook_runs (playbook, version, kind, status, session_id, started_at, ended_at) VALUES (?, ?, 'dry_run', 'done', ?, ?, ?)")
          .run(set.id, set.version, session, at(), at()).lastInsertRowid,
      );
      appendEvent(store, "playbook_dry_run", { sessionId: session, taskId: null }, { playbook_id: set.id, version: set.version, run_id: run, status: "done", tokens: 10, would_do: 1 }, at());
    }
    env.advance(1_000);
    const approval = insertApproval(env, { agent: ASK_AGENT, session: null, action: "kernel_playbook_enable", status: "approved", decision: "once" });
    if (!omit.has("enable_not_applied")) enablePlaybook(store, { id: set.id, version: set.version, sessionId: null, approvalId: approval }, env.now());
    env.advance(1_000);
    if (!omit.has("run_now_missing")) {
      const session = insertSession(env, { agent: ASK_AGENT, status: "running", playbook: set.id, version: set.version });
      store
        .prepare("INSERT INTO playbook_runs (playbook, version, kind, status, session_id, started_at) VALUES (?, ?, 'run_now', 'running', ?, ?)")
        .run(set.id, set.version, session, at());
    }
  }

  if (!skip.has("3_reviewer_cannot_push")) {
    const charter = reviewerCharter(workspace, omit.has("never_lacks_push") ? ["gh_pr_create"] : ["git_push", "gh_pr_create"]);
    const createApproval = insertApproval(env, { agent: ASK_AGENT, session: null, action: "kernel_agent_create", status: "approved", decision: "once", payload: { input: { charter } } });
    const r = createAgent(store, env.dataDir, charter, { by: "wright", approvalId: createApproval, deferFiles: true }, env.now());
    if (!r.ok) throw new Error(`not created: ${r.message}`);
    env.advance(1_000);
    const session = insertSession(env, { agent: REVIEWER, status: "completed" });
    if (omit.has("push_held")) {
      const held = insertApproval(env, { agent: REVIEWER, session, action: "git push", status: "pending", decision: null });
      appendEvent(store, "tool_decision", { sessionId: session, taskId: null }, { tool: "Bash", decision: "deny", reason: "approval_required", command: "git push origin main", approval_id: held }, at());
    } else {
      const deny = { tool: "Bash", decision: "deny", reason: "agent_boundary", command: "git push origin main", category: "git_push", tool_use_id: "toolu_1" };
      appendEvent(store, "tool_decision", { sessionId: session, taskId: null }, deny, at());
      // `deny_shown_in_other_session`: the deny's output row sits in another of the reviewer's sessions, not the one the deny was in.
      const shownIn = omit.has("deny_shown_in_other_session") ? insertSession(env, { agent: REVIEWER, status: "completed" }) : session;
      if (!omit.has("deny_not_in_output")) store.prepare("INSERT INTO session_output (session_id, seq, kind, payload_json) VALUES (?, 1, 'tool_decision', ?)").run(shownIn, JSON.stringify(deny));
    }
    // A second push form the boundary missed: the rail reads `git -C . push` as a push, so the checker must too.
    if (omit.has("push_also_allowed")) appendEvent(store, "tool_decision", { sessionId: session, taskId: null }, { tool: "Bash", decision: "allow", reason: "policy_allow", command: "git -C . push origin main" }, at());
    env.advance(1_000);
    const approved = omit.has("comment_approved");
    if (!omit.has("comment_never_held")) insertApproval(env, { agent: REVIEWER, session, action: "gh pr comment", status: approved ? "approved" : "denied", decision: approved ? "once" : "deny" });
  }

  if (!skip.has("4_sessions_stop_and_kill")) {
    const a = insertSession(env, { agent: ASK_AGENT, status: "running" });
    const b = insertSession(env, { agent: ASK_AGENT, status: "running" });
    appendEvent(store, SESSION_STOP_REQUESTED, { sessionId: a, taskId: null }, { by: "owner", mode: "stop" }, at());
    env.advance(2_000);
    endSession(env, a, omit.has("stop_ends_as_kill") ? "owner_kill" : "owner_stop");
    if (!omit.has("no_kill")) {
      appendEvent(store, SESSION_STOP_REQUESTED, { sessionId: b, taskId: null }, { by: "owner", mode: "kill" }, at());
      env.advance(100);
      endSession(env, b, omit.has("kill_ends_as_stop") ? "owner_stop" : "owner_kill");
    }
  }

  if (!skip.has("5_menu_bar_pause_and_kill_switch") && omit.has("miss_and_release_in_different_pauses")) {
    // One pause from the app released from the app with no miss in it, then a second pause holding the miss, never released.
    engagePause(store, at(), "api");
    env.advance(1_000);
    releasePause(store, at(), "api");
    env.advance(1_000);
    registerTrigger(store, { agent: ASK_AGENT, kind: "once", spec: later(MINUTE), action: "notify", text: "Due while paused." }, env.now());
    engagePause(store, at(), "api");
    env.advance(2 * MINUTE);
    fireDueTriggers(store, env.now());
    env.advance(1_000);
    engageKillSwitch(store, at());
  } else if (!skip.has("5_menu_bar_pause_and_kill_switch")) {
    registerTrigger(store, { agent: ASK_AGENT, kind: "once", spec: later(MINUTE), action: "notify", text: "Due while paused." }, env.now());
    engagePause(store, at(), omit.has("paused_from_cli") ? "cli" : "api");
    if (omit.has("missed_as_kill_switch")) {
      engageKillSwitch(store, at());
      env.advance(2 * MINUTE);
      releaseKillSwitch(store, at());
    } else {
      env.advance(2 * MINUTE);
    }
    fireDueTriggers(store, env.now());
    env.advance(1_000);
    if (!omit.has("pause_not_released")) releasePause(store, at(), "api");
    env.advance(1_000);
    if (!omit.has("no_kill_switch")) engageKillSwitch(store, at());
  }

  if (!skip.has("6_team_sets_wright_model")) {
    env.advance(1_000);
    appendEvent(store, "agent_settings_set", NO_REF, { id: ASK_AGENT, field: "model", old: START_MODEL, new: NEW_MODEL, by: "owner" }, at());
    if (!omit.has("wright_json_unchanged")) writeWrightJson(env.dataDir, NEW_MODEL);
    if (omit.has("wright_json_removed")) rmSync(wrightSettingsPath(env.dataDir));
  }
}

describe("phase 5 live checkers against a canned store", () => {
  let env: LoopEnv;
  let workspace: string;

  beforeEach(() => {
    env = loopEnv("2026-10-23T10:00:00.000Z");
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "studio-phase5-live-ws-")));
    writeWrightJson(env.dataDir, START_MODEL);
  });

  afterEach(() => {
    env.cleanup();
    rmSync(workspace, { recursive: true, force: true });
  });

  const startNow = (): RunStart => withDb(env.dataDir, (db) => readRunStart(db, env.dataDir, env.now()));
  const check = (start: RunStart): Record<FlowName, FlowCheck> => withDb(env.dataDir, (db) => checkAllFlows(db, start, env.dataDir));
  const outcomes = (checks: Record<FlowName, FlowCheck>): Record<FlowName, FlowOutcome> =>
    Object.fromEntries(FLOW_NAMES.map((f) => [f, checks[f].outcome])) as Record<FlowName, FlowOutcome>;
  const all = (o: FlowOutcome): Record<FlowName, FlowOutcome> => Object.fromEntries(FLOW_NAMES.map((f) => [f, o])) as Record<FlowName, FlowOutcome>;

  it("passes every flow, and the run, on a store holding each flow's effects; the checkers read through a read-only connection", () => {
    const start = startNow();
    expect(start).toMatchObject({ event_id: 0, approval_id: 0, session_id: 0, playbook_run_id: 0, notification_id: 0, wright_model: START_MODEL });
    cannedRun(env, workspace);
    const checks = check(start);
    for (const f of FLOW_NAMES) expect(checks[f].findings, f).toEqual([]);
    expect(outcomes(checks)).toEqual(all("pass"));
    expect(runResult(checks)).toBe("passed");
    expect(checks["6_team_sets_wright_model"].harness).toMatchObject({ model_at_start: START_MODEL, wright_json_model: NEW_MODEL });
    expect(checks["3_reviewer_cannot_push"].harness).toMatchObject({ passing_member: REVIEWER });
    // The connection the checkers get cannot write.
    expect(() => withDb(env.dataDir, (db) => db.prepare("INSERT INTO events (kind) VALUES ('x')").run())).toThrow(/readonly/i);
  });

  it("counts nothing from before the run start: every flow is not_exercised, and the run fails", () => {
    cannedRun(env, workspace);
    const start = startNow();
    expect(start.event_id).toBeGreaterThan(0);
    const checks = check(start);
    expect(outcomes(checks)).toEqual(all("not_exercised"));
    for (const f of FLOW_NAMES) expect(checks[f].findings, f).toHaveLength(1);
    expect(runResult(checks)).toBe("failed");
  });

  it("records a flow the owner did not do as not_exercised, which fails the run even when the other five pass", () => {
    const start = startNow();
    cannedRun(env, workspace, new Set(), new Set<FlowName>(["6_team_sets_wright_model"]));
    const checks = check(start);
    expect(outcomes(checks)).toEqual({ ...all("pass"), "6_team_sets_wright_model": "not_exercised" });
    expect(runResult(checks)).toBe("failed");
  });

  it.each(Object.keys(OMISSIONS) as Omission[])("rejects a store missing an effect (%s): that flow fails, the others pass", (omission) => {
    const start = startNow();
    cannedRun(env, workspace, new Set([omission]));
    const checks = check(start);
    const target = OMISSIONS[omission];
    expect(outcomes(checks)).toEqual({ ...all("pass"), [target]: "fail" });
    expect(checks[target].findings.length).toBeGreaterThan(0);
    expect(runResult(checks)).toBe("failed");
  });

  it("fails the menu-bar flow when the miss and the app's release are in different pauses, naming that no one pause had both", () => {
    const start = startNow();
    cannedRun(env, workspace, new Set<Omission>(["miss_and_release_in_different_pauses"]));
    const menu = check(start)["5_menu_bar_pause_and_kill_switch"];
    expect(menu.outcome).toBe("fail");
    expect(menu.findings).toEqual([expect.stringMatching(/no pause from the app had a paused instant recorded missed_paused and then a release from the app/)]);
    expect(withDb(env.dataDir, (db) => cleanupList(db, start))).toMatchObject({ paused: true });
  });

  it("fails the reviewer flow when its push deny is shown only in another of its sessions' output", () => {
    const start = startNow();
    cannedRun(env, workspace, new Set<Omission>(["deny_shown_in_other_session"]));
    const reviewer = check(start)["3_reviewer_cannot_push"];
    expect(reviewer.outcome).toBe("fail");
    expect(reviewer.findings).toEqual([expect.stringMatching(/agent_boundary deny is not in its own session's output log/)]);
  });

  it("lists what the run left on for the owner's in-app cleanup, writing nothing", () => {
    const start = startNow();
    cannedRun(env, workspace, new Set<Omission>(["pause_not_released"]));
    const before = env.store.prepare<[], number>("SELECT count(*) FROM events").pluck().get();
    const list = withDb(env.dataDir, (db) => cleanupList(db, start));
    expect(list).toMatchObject({ paused: true, kill_switch_engaged: true, crew_still_active: [{ id: REVIEWER, status: "active" }] });
    expect((list.playbooks_not_off as unknown[]).length).toBe(1);
    expect(env.store.prepare<[], number>("SELECT count(*) FROM events").pluck().get()).toBe(before);
  });
});

describe("the live summary: redaction, mode 0600, the evidence shape", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "studio-phase5-live-summary-")));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  const START: RunStart = { at: "2026-10-23T10:00:00.000Z", event_id: 7, approval_id: 1, session_id: 2, playbook_run_id: 0, notification_id: 3, wright_model: "m" };

  it("redacts token-shaped strings and writes the home dir as ~", () => {
    expect(redact("key sk-ant-oat01-AbC_d-9 and /Users/someone/x and /Users/someone", "/Users/someone")).toBe("key sk-ant-[REDACTED] and ~/x and ~");
    expect(redact("no secrets here", "/")).toBe("no secrets here");
  });

  it("writes the summary redacted, mode 0600, with every flow and owner field present and null", () => {
    const path = join(scratch, "summary.json");
    const summary = newSummary(START, path);
    summary.steps["1_reminder_fires"].harness = { note: "sk-ant-abc123 at /Users/someone/data" };
    writeSummary(path, summary, "/Users/someone");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain("sk-ant-abc123");
    expect(text).not.toContain("/Users/someone");
    const read = JSON.parse(text) as { test: string; run_by: unknown; owner: Record<string, unknown>; steps: Record<string, { outcome: string; owner: Record<string, unknown>; findings: unknown[] }> };
    expect(read.test).toBe("phase-5-exit-live");
    expect(read.run_by).toBeNull();
    expect(Object.keys(read.owner)).toEqual([...RUN_OWNER_FIELDS]);
    expect(Object.keys(read.steps)).toEqual([...FLOW_NAMES]);
    for (const f of FLOW_NAMES) {
      expect(read.steps[f]?.outcome, f).toBe("not_exercised");
      expect(Object.keys(read.steps[f]?.owner ?? {}), f).toEqual([...OWNER_FIELDS[f]]);
      expect(Object.values(read.steps[f]?.owner ?? {}).every((v) => v === null), f).toBe(true);
    }
  });

  it("keeps the owner fields when the checks are recorded", () => {
    const summary = newSummary(START, "/tmp/x.json");
    const checks = Object.fromEntries(FLOW_NAMES.map((f) => [f, { outcome: "pass", harness: { f }, findings: [] }])) as unknown as Record<FlowName, FlowCheck>;
    recordChecks(summary, checks);
    expect(summary.steps["4_sessions_stop_and_kill"]).toMatchObject({ outcome: "pass", harness: { f: "4_sessions_stop_and_kill" }, owner: { kill_confirmed: null } });
    expect(runResult(checks)).toBe("passed");
  });

  it("reads the wait from STUDIO_LIVE_WAIT_MIN only when it is a whole number of minutes from 1 to 240", () => {
    expect(waitMinutes(undefined)).toBe(DEFAULT_WAIT_MIN);
    expect(waitMinutes("30")).toBe(30);
    expect(waitMinutes(" 240 ")).toBe(240);
    for (const bad of ["0", "241", "-5", "1.5", "soon", ""]) expect(waitMinutes(bad), bad).toBe(DEFAULT_WAIT_MIN);
  });
});

// ---- The live run ----------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!LIVE)("live phase 5 exit: phases 2-4 done from the packaged app, read from the store (STUDIO_LIVE=1)", () => {
  const dataDir = resolveDataDir(process.env);
  const summaryPath = join(tmpdir(), `studio-phase-5-exit-live-summary-${Date.now()}.json`);
  const waitMs = waitMinutes(process.env.STUDIO_LIVE_WAIT_MIN) * MINUTE;
  let start: RunStart | undefined;
  let summary: ReturnType<typeof newSummary> | undefined;
  let last: Record<FlowName, FlowCheck> | undefined;

  const save = (): void => {
    if (summary !== undefined) writeSummary(summaryPath, summary);
  };

  /** The service's kernel pid as `launchctl print` reports it, or `undefined` (a read; nothing is started or stopped). */
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

  /** Whether a process runs from a `Loomwright Studio.app` bundle (`ps -axo comm=`), or null when `ps` failed. */
  function appProcessSeen(): boolean | null {
    try {
      const table = execFileSync("/bin/ps", ["-axo", "comm="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 * 1024 * 1024 });
      return table.split("\n").some((line) => line.includes("Loomwright Studio.app/Contents/MacOS/"));
    } catch {
      return null;
    }
  }

  beforeAll(() => {
    expect(process.platform, "the live harness runs on macOS only").toBe("darwin");
    expect(existsSync(join(dataDir, "studio.db")), `no store at ${redact(dataDir)}: install the service first (runbook setup)`).toBe(true);
    start = withDb(dataDir, (db) => readRunStart(db, dataDir));
    summary = newSummary(start, summaryPath);
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
    Object.assign(summary, {
      commit,
      dirty_worktree: dirty,
      machine: { node: process.version, platform: process.platform },
      service: { launchd_pid: launchd ?? null, api_json_pid: api ?? null },
      app: { process_seen_at_start: appProcessSeen() },
      wait_minutes: waitMs / MINUTE,
    });
    save();
    console.log(`phase-5-exit-live summary: ${summaryPath} (run start: event ${start.event_id}, ${start.at})`);
    console.log("phase-5-exit-live: do the six flows in Loomwright Studio.app now; this harness only reads the store.");
    expect(launchd, `${SERVICE_LABEL} is not running under launchd: install it with studio service install (runbook setup)`).toBeDefined();
    expect(api, "api.json names another kernel than launchd runs").toBe(launchd);
  }, 60_000);

  afterAll(() => {
    if (summary === undefined || start === undefined) return;
    const runStart = start;
    try {
      summary.cleanup = { left_for_the_owner: withDb(dataDir, (db) => cleanupList(db, runStart)) };
    } catch (err) {
      summary.cleanup = { reread_failed: redact(err instanceof Error ? err.message : String(err)) };
    }
    summary.app = { ...(summary.app as Record<string, unknown>), process_seen_at_end: appProcessSeen() };
    summary.finished_at = new Date().toISOString();
    summary.result = last === undefined ? "failed" : runResult(last);
    save();
    console.log(`phase-5-exit-live summary: ${summaryPath} (${String(summary.result)}); cleanup in the app: see its cleanup.left_for_the_owner`);
  }, 60_000);

  it(
    "every phase 2-4 flow the owner does in the app leaves its rows, events and decisions in the store",
    async () => {
      const runStart = start as RunStart;
      const record = summary as ReturnType<typeof newSummary>;
      const deadline = Date.now() + waitMs;
      let shown = "";
      let pollErrors = 0;
      for (;;) {
        try {
          last = withDb(dataDir, (db) => checkAllFlows(db, runStart, dataDir));
        } catch (err) {
          pollErrors += 1;
          record.poll_errors = { count: pollErrors, last: redact(err instanceof Error ? err.message : String(err)) };
        }
        if (last !== undefined) {
          recordChecks(record, last);
          const line = FLOW_NAMES.map((f) => `${f.slice(0, 1)}:${(last as Record<FlowName, FlowCheck>)[f].outcome}`).join(" ");
          if (line !== shown) {
            shown = line;
            console.log(`phase-5-exit-live ${new Date().toISOString()} ${line}`);
          }
          record.result = runResult(last) === "passed" ? "passed" : "running";
          save();
          if (runResult(last) === "passed") break;
        }
        if (Date.now() > deadline) break;
        await sleep(POLL_MS);
      }
      const final = last;
      if (final === undefined) {
        record.result = "failed";
        save();
        throw new Error(`the store could not be read once in ${waitMs / MINUTE} minutes (see poll_errors in the summary)`);
      }
      record.result = runResult(final);
      save();
      for (const f of FLOW_NAMES) expect(final[f].outcome, `${f}: ${final[f].findings.join("; ")}`).toBe("pass");
    },
    waitMs + 5 * MINUTE,
  );
});
