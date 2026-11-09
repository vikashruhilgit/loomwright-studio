// Opt-in live harness for the phase 8 exit check (item 14): the machine-observable
// half of docs/evidence/phase-8-exit-runbook.md. Phase 8 is done when acceptance
// test 2 passes live on the owner's throwaway repo: tickets become PRs through
// Loomwright's /automate, comments are triaged, a reviewer is re-requested and each
// merge goes through Loomwright's gate under its repo's policy. The deterministic
// proof is `kernel/test/phase-8-exit.test.ts` (CI, fakes); this is the live check.
// It never runs live in CI or by default: the live stage is
// `describe.skipIf(!LIVE)`, and the exported checkers are tested against canned
// stores in the sections that run in CI.
//
//   cd kernel && STUDIO_LIVE=1 STUDIO_LIVE_GITHUB_ACCOUNT=<login> STUDIO_LIVE_SANDBOX_REPO=<login>/studio-sandbox \
//     npx vitest run test/phase-8-exit-live.test.ts
//
// THE RUN ONLY READS. It opens the installed service's store (`STUDIO_DATA_DIR`, else
// `~/.loomwright-studio`) through a read-only SQLite connection (`withDb`). It
// writes nothing to the store or to GitHub, calls no CLI, posts to no API route, and
// decides no approval: the owner (or an agent on the owner's word, D35) does every
// step in the app. It holds no GitHub token and makes no network request.
//
// When it begins it records a run start (the highest `events` id). Only what comes
// after that counts. It then polls the store every few seconds and checks three
// things, each from the store, never from what a reply says:
//
//   1. pr_states        each tracked PR's `pr_state_changed` events appear in order
//                       (the first from a new track, each from the previous to, no
//                       change after `merged`), the PR ends `merged`, and
//                       `pr_tracks` agrees with the last change
//   2. merged_by_gate   every merged PR has `merged_by_gate` = 1 (D40: only
//                       Loomwright's gate merges)
//   3. no_kernel_merge  no merge call was allowed: every `gh pr merge` attempt in a
//                       session's `tool_decision` events was denied `merge_blocked`
//
// Each check is `pass`, `fail` (something is wrong) or `not_exercised` (the run
// has not got there yet). Only an all-`pass` run is `passed`.
//
// A summary (never env or tokens; the home dir written as `~`) is written to the
// path printed at the start, mode 0600, after every change. The evidence file the
// owner commits at the close has the shape `checkEvidenceShape` accepts.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PR_TRACK_STATES } from "../src/automate/tracker.js";
import { appendEvent } from "../src/loop/internal.js";
import { resolveDataDir } from "../src/store/index.js";
import { withDb } from "./crash-helpers.js";
import { loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

const LIVE = process.env.STUDIO_LIVE === "1";

const REPO_DIR = fileURLToPath(new URL("../..", import.meta.url));
const MINUTE = 60_000;
/** How often the run re-reads the store while the owner works in the app. */
const POLL_MS = 5_000;
/** The default wait for all three checks (`STUDIO_LIVE_WAIT_MIN` overrides it). */
const DEFAULT_WAIT_MIN = 120;
const MAX_WAIT_MIN = 240;
/** The walk tracks two PRs: PR A (Solo) and PR B (Approve in Studio). */
export const EXPECTED_PRS = 2;

// ---- The sandbox: the personal account and the one repo ---------------------------

export type RepoCheck = { readonly ok: true; readonly repo: string; readonly account: string } | { readonly ok: false; readonly reason: string };

const EMPLOYER_OWNER = /^vendsy/i;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Whether the harness may read for `repo` at all: the configured personal `account`
 * is named, the repo's owner is that account, and neither is an employer (`vendsy*`).
 * Pure, and called before the store is read.
 */
export function checkSandboxRepo(repo: string | undefined, account: string | undefined): RepoCheck {
  if (account === undefined || account.trim() === "") return { ok: false, reason: "STUDIO_LIVE_GITHUB_ACCOUNT is not set: name the owner's personal GitHub account" };
  if (!LOGIN.test(account)) return { ok: false, reason: "STUDIO_LIVE_GITHUB_ACCOUNT is not a GitHub login" };
  if (EMPLOYER_OWNER.test(account)) return { ok: false, reason: "STUDIO_LIVE_GITHUB_ACCOUNT names an employer account: this check runs on a personal account only" };
  if (repo === undefined || repo.trim() === "") return { ok: false, reason: "STUDIO_LIVE_SANDBOX_REPO is not set (owner/name of the sandbox repo)" };
  const parts = repo.split("/");
  const [owner, name] = parts;
  if (parts.length !== 2 || owner === undefined || name === undefined || !LOGIN.test(owner) || !REPO_NAME.test(name) || name === "." || name === "..") {
    return { ok: false, reason: "STUDIO_LIVE_SANDBOX_REPO is not an owner/name string" };
  }
  if (EMPLOYER_OWNER.test(owner)) return { ok: false, reason: `the sandbox repo's owner ${owner} is an employer account: never run this on an employer repository` };
  if (owner.toLowerCase() !== account.toLowerCase()) return { ok: false, reason: `the sandbox repo's owner ${owner} is not the configured personal account ${account}` };
  return { ok: true, repo, account };
}

// ---- Outcomes, the run start and the summary --------------------------------------

export const CHECK_NAMES = ["pr_states", "merged_by_gate", "no_kernel_merge"] as const;
export type CheckName = (typeof CHECK_NAMES)[number];
export type Outcome = "pass" | "fail" | "not_exercised";

/** One check's verdict: its outcome, what the harness read and why it did not pass. */
export interface Check {
  readonly outcome: Outcome;
  readonly harness: Record<string, unknown>;
  readonly findings: readonly string[];
}

export type Checks = Readonly<Record<CheckName, Check>>;

const pass = (harness: Record<string, unknown>): Check => ({ outcome: "pass", harness, findings: [] });
const fail = (harness: Record<string, unknown>, findings: readonly string[]): Check => ({ outcome: "fail", harness, findings });
const notExercised = (harness: Record<string, unknown>, finding: string): Check => ({ outcome: "not_exercised", harness, findings: [finding] });

/** `passed` only when every check passed; any `fail` is `failed`; otherwise the run is not over (`incomplete`). */
export function runResult(checks: Checks): "passed" | "failed" | "incomplete" {
  const outcomes = CHECK_NAMES.map((n) => checks[n].outcome);
  if (outcomes.includes("fail")) return "failed";
  return outcomes.every((o) => o === "pass") ? "passed" : "incomplete";
}

/** What the store held when the run began: only events after this id count. */
export interface RunStart {
  readonly at: string;
  readonly event_id: number;
}

/** The run start: the highest event id now and the time. */
export function readRunStart(db: Database.Database, now: Date = new Date()): RunStart {
  return { at: now.toISOString(), event_id: db.prepare<[], number>("SELECT COALESCE(MAX(id), 0) FROM events").pluck().get() ?? 0 };
}

/** The minutes to wait: `STUDIO_LIVE_WAIT_MIN` when it is a whole number 1-240, else the default. */
export function waitMinutes(raw: string | undefined): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return DEFAULT_WAIT_MIN;
  const n = Number(raw.trim());
  return n >= 1 && n <= MAX_WAIT_MIN ? n : DEFAULT_WAIT_MIN;
}

const SECRET_SHAPES: ReadonlyArray<readonly [RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-[REDACTED]"],
  [/github_pat_[A-Za-z0-9_]+/g, "[REDACTED-GITHUB-TOKEN]"],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, "[REDACTED-GITHUB-TOKEN]"],
];

/** Replace anything token-shaped and the home dir before text is written anywhere. */
export function redact(text: string, home: string = homedir()): string {
  let out = text;
  for (const [shape, replacement] of SECRET_SHAPES) out = out.replace(shape, replacement);
  return home.length > 1 ? out.split(home).join("~") : out;
}

/** Write `summary` to `path`, redacted, mode 0600 (a fresh path per run, so the mode is set at creation). */
export function writeSummary(path: string, summary: unknown, home: string = homedir()): void {
  writeFileSync(path, `${redact(JSON.stringify(summary, null, 2), home)}\n`, { mode: 0o600 });
}

// ---- Store reads (read-only) -----------------------------------------------------

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function payloadOf(json: string | null): Record<string, unknown> {
  if (json === null) return {};
  try {
    const v = JSON.parse(json) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

interface EventRow {
  readonly id: number;
  readonly session_id: number | null;
  readonly payload: Record<string, unknown>;
}

function eventsSince(db: Database.Database, start: RunStart, kind: string): EventRow[] {
  return db
    .prepare<[number, string], { id: number; session_id: number | null; payload_json: string | null }>("SELECT id, session_id, payload_json FROM events WHERE id > ? AND kind = ? ORDER BY id")
    .all(start.event_id, kind)
    .map((r) => ({ id: r.id, session_id: r.session_id, payload: payloadOf(r.payload_json) }));
}

interface TrackRow {
  readonly number: number;
  readonly state: string;
  readonly merged_by_gate: number;
  readonly ticket_ref: string | null;
}

const tracksOf = (db: Database.Database, repo: string): TrackRow[] =>
  db.prepare<[string], TrackRow>("SELECT number, state, merged_by_gate, ticket_ref FROM pr_tracks WHERE repo = ? ORDER BY number").all(repo);

/** One `pr_state_changed` event of `repo`, in id order, grouped by PR number. */
function stateChangesOf(db: Database.Database, start: RunStart, repo: string): Map<number, { id: number; from: string | null; to: string }[]> {
  const byPr = new Map<number, { id: number; from: string | null; to: string }[]>();
  for (const e of eventsSince(db, start, "pr_state_changed")) {
    const pr = num(e.payload.pr);
    const to = str(e.payload.to);
    if (e.payload.repo !== repo || pr === null || to === null) continue;
    byPr.set(pr, [...(byPr.get(pr) ?? []), { id: e.id, from: str(e.payload.from), to }]);
  }
  return byPr;
}

// ---- The three checks ------------------------------------------------------------

/**
 * 1. Each tracked PR's states appear in order: the first change comes from a new track
 * (`from` null), each change starts from the previous change's `to`, every state is a
 * known one, nothing follows `merged`, a `closed` PR fails, and the `pr_tracks` row
 * holds the last state. `pass` once `expected` PRs have all ended `merged`;
 * `not_exercised` while fewer have been tracked or one has not merged yet.
 */
export function checkPrStates(db: Database.Database, start: RunStart, repo: string, expected: number = EXPECTED_PRS): Check {
  const byPr = stateChangesOf(db, start, repo);
  const rows = tracksOf(db, repo);
  const problems: string[] = [];
  const prs: { pr: number; states: string[]; merged: boolean }[] = [];
  for (const [pr, changes] of [...byPr.entries()].sort((a, b) => a[0] - b[0])) {
    const states = changes.map((c) => c.to);
    const first = changes[0];
    if (first !== undefined && first.from !== null) problems.push(`#${pr}: the first change starts from "${first.from}", not from a new track`);
    changes.forEach((c, i) => {
      const before = changes[i - 1];
      if (before !== undefined && c.from !== before.to) problems.push(`#${pr}: change ${c.id} starts from "${c.from ?? "null"}" but the previous change ended "${before.to}"`);
      if (!(PR_TRACK_STATES as readonly string[]).includes(c.to)) problems.push(`#${pr}: "${c.to}" is not a known PR state`);
    });
    const mergedAt = states.indexOf("merged");
    if (mergedAt !== -1 && mergedAt !== states.length - 1) problems.push(`#${pr}: a state change follows merged (${states.join(" > ")})`);
    if (states.includes("closed")) problems.push(`#${pr}: closed without merging (${states.join(" > ")})`);
    const row = rows.find((r) => r.number === pr);
    const last = states[states.length - 1];
    if (row === undefined) problems.push(`#${pr}: no pr_tracks row`);
    else if (row.state !== last) problems.push(`#${pr}: pr_tracks says "${row.state}" but the last change ended "${last ?? "none"}"`);
    prs.push({ pr, states, merged: last === "merged" });
  }
  const harness = { repo, expected, prs };
  if (problems.length > 0) return fail(harness, problems);
  if (prs.length < expected) return notExercised(harness, `${prs.length} of ${expected} PRs tracked since the run start`);
  const open = prs.filter((p) => !p.merged);
  if (open.length > 0) return notExercised(harness, `not merged yet: ${open.map((p) => `#${p.pr}`).join(", ")}`);
  return pass(harness);
}

/**
 * 2. Every PR that changed since the run start and is `merged` has `merged_by_gate` = 1.
 * `fail` on any merged PR with 0; `not_exercised` until `expected` PRs have merged.
 */
export function checkMergedByGate(db: Database.Database, start: RunStart, repo: string, expected: number = EXPECTED_PRS): Check {
  const touched = new Set(stateChangesOf(db, start, repo).keys());
  const merged = tracksOf(db, repo).filter((r) => touched.has(r.number) && r.state === "merged");
  const harness = { repo, merged: merged.map((r) => ({ pr: r.number, merged_by_gate: r.merged_by_gate, ticket_ref: r.ticket_ref })) };
  const bad = merged.filter((r) => r.merged_by_gate !== 1);
  if (bad.length > 0) return fail(harness, bad.map((r) => `#${r.number} is merged with merged_by_gate = ${r.merged_by_gate}: not merged through Loomwright's gate`));
  if (merged.length < expected) return notExercised(harness, `${merged.length} of ${expected} PRs merged since the run start`);
  return pass(harness);
}

/**
 * A direct `gh` merge, as wide as the rail it audits (`kernel/src/sessions/policy.ts`, `merge_blocked`):
 * - `gh pr merge`, with gh's flags (and a flag's value) allowed between `pr` and `merge`
 *   (`gh pr -R o/r merge 5`); a subcommand word other than `merge` first (`gh pr view 5`) is no merge;
 * - `gh api` reaching a pull request's `…/pulls/<n>/merge` endpoint, or naming the GraphQL
 *   `mergePullRequest` / `enablePullRequestAutoMerge` / `enqueuePullRequest` (no word boundary needed).
 */
const GH_PR_MERGE = /\bgh\s+pr(?:\s+-{1,2}[\w-]+(?:=\S+)?(?:\s+[^-\s]\S*)?)*\s+merge(?![\w-])/;
const GH_API_MERGE = /\bgh\s+api\b[^\n|;&]*?(?:\/pulls\/[^/\s]+\/merge(?![\w-])|mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest)/i;
const GH_MERGE = { test: (command: string): boolean => GH_PR_MERGE.test(command) || GH_API_MERGE.test(command) };
/** Kernel tools that read or record a merge (D43), never merge. */
const MERGE_SAFE_TOOL = /merge_check|merge_approval/;

export interface MergeAttempt {
  readonly event_id: number;
  readonly session_id: number | null;
  readonly tool: string | null;
  readonly command: string | null;
  readonly decision: string | null;
  readonly reason: string | null;
}

/** Whether a `tool_decision` event is a merge attempt, and what the rail answered. */
export function mergeAttemptOf(e: EventRow): MergeAttempt | null {
  const tool = str(e.payload.tool);
  const command = str(e.payload.command);
  const reason = str(e.payload.reason);
  const direct = tool === "Bash" && command !== null && GH_MERGE.test(command);
  const namedTool = tool !== null && tool !== "Bash" && /merge/i.test(tool) && !MERGE_SAFE_TOOL.test(tool);
  if (!direct && !namedTool && reason !== "merge_blocked") return null;
  return { event_id: e.id, session_id: e.session_id, tool, command: command === null ? null : command.slice(0, 300), decision: str(e.payload.decision), reason };
}

/**
 * 3. The store records no kernel merge call. Every `gh pr merge` attempt was denied
 * `merge_blocked`, and no other merge-named tool was allowed. `not_exercised` when no
 * merge attempt was recorded (the runbook's merge-block step has not run).
 */
export function checkNoKernelMerge(db: Database.Database, start: RunStart): Check {
  const attempts = eventsSince(db, start, "tool_decision").flatMap((e) => {
    const a = mergeAttemptOf(e);
    return a === null ? [] : [a];
  });
  const harness = { attempts };
  const bad = attempts.filter((a) => (a.tool === "Bash" ? a.decision !== "deny" || a.reason !== "merge_blocked" : a.decision !== "deny"));
  if (bad.length > 0) {
    return fail(
      harness,
      bad.map((a) => `event ${a.event_id}: ${a.tool ?? "?"} ${a.command ?? ""} was ${a.decision ?? "?"} (${a.reason ?? "no reason"}), not denied merge_blocked`.replace(/\s+/g, " ")),
    );
  }
  if (attempts.length === 0) return notExercised(harness, "no merge attempt was recorded: the merge-block step has not run");
  return pass(harness);
}

/** All three checks over one store. */
export function checkStore(db: Database.Database, start: RunStart, repo: string): Checks {
  return { pr_states: checkPrStates(db, start, repo), merged_by_gate: checkMergedByGate(db, start, repo), no_kernel_merge: checkNoKernelMerge(db, start) };
}

// ---- The evidence file's shape (AC4) -------------------------------------------------

/** D35: how the evidence records a click the agent made. */
export const AGENT_ON_WORD = "the agent, on the owner's word";
export const OWNER_CLICK = "the owner";

export type ShapeCheck = { readonly ok: true } | { readonly ok: false; readonly problems: readonly string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const STEP_OUTCOMES = ["passed", "failed", "not_exercised"];

/** A `run_by` is the owner's, or exactly the agent's D35 wording: an agent without it is rejected. */
function runByProblem(where: string, runBy: unknown): string | null {
  if (!nonEmpty(runBy)) return `${where}.run_by is missing`;
  if (runBy === OWNER_CLICK || runBy === AGENT_ON_WORD) return null;
  return /agent/i.test(runBy) ? `${where}.run_by names the agent without "${AGENT_ON_WORD}" (D35)` : `${where}.run_by must be "${OWNER_CLICK}" or "${AGENT_ON_WORD}"`;
}

function ownerProblem(where: string, owner: unknown): string | null {
  if (!isRecord(owner)) return `${where}.owner must be an object (what the owner reports seeing)`;
  if (!(owner.seen === null || typeof owner.seen === "boolean")) return `${where}.owner.seen must be true, false or null`;
  if (typeof owner.notes !== "string") return `${where}.owner.notes must be a string`;
  return null;
}

/**
 * Whether `evidence` has the shape `docs/evidence/phase-8-exit-runbook.md` names for
 * `docs/evidence/phase-8-exit-live-<date>.json`: `run_by`, every click the agent made
 * recorded as "the agent, on the owner's word" (D35), `owner` fields that hold only
 * what the owner reports seeing, and `jira` as `not_exercised`.
 */
export function checkEvidenceShape(evidence: unknown): ShapeCheck {
  if (!isRecord(evidence)) return { ok: false, problems: ["the evidence is not an object"] };
  const problems: string[] = [];
  const add = (p: string | null): void => {
    if (p !== null) problems.push(p);
  };
  if (evidence.test !== "phase-8-exit-live") problems.push('test must be "phase-8-exit-live"');
  if (typeof evidence.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(evidence.date)) problems.push("date must be YYYY-MM-DD");
  if (!nonEmpty(evidence.result)) problems.push("result is missing");
  if (!nonEmpty(evidence.run_by)) problems.push("run_by is missing (who ran it)");
  if (!nonEmpty(evidence.commit)) problems.push("commit is missing");
  if (evidence.jira !== "not_exercised") problems.push('jira must be "not_exercised" (the owner\'s work account is never exercised)');
  const clicks = evidence.clicks;
  if (!Array.isArray(clicks)) problems.push("clicks must be an array (every in-app click, or [] when the owner made them all)");
  else {
    clicks.forEach((c: unknown, i: number) => {
      const where = `clicks[${i}]`;
      if (!isRecord(c)) return void problems.push(`${where} is not an object`);
      if (!nonEmpty(c.step)) problems.push(`${where}.step is missing`);
      add(runByProblem(where, c.run_by));
      add(ownerProblem(where, c.owner));
    });
  }
  if (!isRecord(evidence.steps)) problems.push("steps must be an object");
  else {
    for (const [name, step] of Object.entries(evidence.steps)) {
      const where = `steps.${name}`;
      if (!isRecord(step)) {
        problems.push(`${where} is not an object`);
        continue;
      }
      if (typeof step.outcome !== "string" || !STEP_OUTCOMES.includes(step.outcome)) problems.push(`${where}.outcome must be one of ${STEP_OUTCOMES.join(", ")}`);
      if (name === "jira" && step.outcome !== "not_exercised") problems.push("steps.jira.outcome must be not_exercised");
      if (!nonEmpty(step.reason)) problems.push(`${where}.reason is missing`);
      add(runByProblem(where, step.run_by));
      add(ownerProblem(where, step.owner));
    }
  }
  if (!isRecord(evidence.owner) || typeof evidence.owner.every_decision_made_by !== "string" || typeof evidence.owner.notes !== "string") problems.push("owner must hold every_decision_made_by and notes (strings)");
  if (!Array.isArray(evidence.findings)) problems.push("findings must be an array");
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

// ---- Close only on a pass (AC6) ----------------------------------------------------

const EVIDENCE_FILE = /^phase-8-exit-live-\d{4}-\d{2}-\d{2}\.json$/;

export type CloseCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** ROADMAP's phase 8 row carries `✓` only when a `phase-8-exit-live-<date>.json` exists. */
export function checkRoadmapClose(roadmap: string, evidenceFiles: readonly string[]): CloseCheck {
  const row = roadmap.split("\n").find((line) => /^\|\s*8\s*\|/.test(line));
  if (row === undefined) return { ok: false, reason: "docs/ROADMAP.md has no phase 8 row" };
  if (row.includes("✓") && !evidenceFiles.some((f) => EVIDENCE_FILE.test(f))) {
    return { ok: false, reason: "ROADMAP's phase 8 row carries ✓ but no docs/evidence/phase-8-exit-live-<date>.json exists: close only after a passing live run" };
  }
  return { ok: true };
}

/** The OPEN_QUESTIONS entry is ticked `[x]` only when the evidence file exists. */
export function checkOpenQuestionsClose(openQuestions: string, evidenceFiles: readonly string[]): CloseCheck {
  const entry = openQuestions.split("\n").find((line) => line.includes("Phase 8 exit: live run (item 14, owner)"));
  if (entry === undefined) return { ok: false, reason: 'docs/OPEN_QUESTIONS.md has no "Phase 8 exit: live run (item 14, owner)" entry' };
  if (/^- \[[xX]\]/.test(entry) && !evidenceFiles.some((f) => EVIDENCE_FILE.test(f))) {
    return { ok: false, reason: "the phase 8 exit entry is ticked but no docs/evidence/phase-8-exit-live-<date>.json exists" };
  }
  return { ok: true };
}

// ---- Canned stores (CI) ------------------------------------------------------------

const REPO = "vikashruhilgit/studio-sandbox";

describe("phase 8 live checkers against a canned store", () => {
  let env: LoopEnv;

  beforeEach(() => {
    env = loopEnv("2026-11-10T10:00:00.000Z");
  });

  afterEach(() => {
    env.cleanup();
  });

  const at = (): string => env.now().toISOString();
  const track = (n: number, state: string, gate: number, ticket = `cu-${n}`): void => {
    env.store
      .prepare("INSERT INTO pr_tracks (repo, number, state, ticket_ref, merged_by_gate) VALUES (?, ?, ?, ?, ?) ON CONFLICT (repo, number) DO UPDATE SET state = excluded.state, merged_by_gate = excluded.merged_by_gate")
      .run(REPO, n, state, ticket, gate);
  };
  const change = (n: number, from: string | null, to: string): void => {
    appendEvent(env.store, "pr_state_changed", { sessionId: null, taskId: null }, { repo: REPO, pr: n, from, to }, at());
  };
  const decision = (payload: Record<string, unknown>): void => {
    appendEvent(env.store, "tool_decision", { sessionId: null, taskId: null }, payload, at());
  };
  const START: RunStart = { at: "2026-11-10T10:00:00.000Z", event_id: 0 };
  const run = <T>(fn: (db: Database.Database) => T): T => withDb(env.dataDir, fn);

  /** The whole walk: PR A (#21) open > parked > ready > merged, PR B (#22) open > ready > merged, one denied merge. */
  const goodWalk = (): void => {
    change(21, null, "open");
    change(22, null, "open");
    change(21, "open", "parked");
    change(21, "parked", "ready");
    change(22, "open", "ready");
    change(21, "ready", "merged");
    change(22, "ready", "merged");
    track(21, "merged", 1);
    track(22, "merged", 1);
    decision({ tool: "Bash", decision: "deny", reason: "merge_blocked", command: "gh pr merge 21 --squash" });
  };

  describe("the three checks and the run result", () => {
    it("passes a store holding the whole walk, reading through a connection that cannot write", () => {
      goodWalk();
      const checks = run((db) => checkStore(db, START, REPO));
      for (const n of CHECK_NAMES) expect(checks[n].findings, n).toEqual([]);
      expect(CHECK_NAMES.map((n) => checks[n].outcome)).toEqual(["pass", "pass", "pass"]);
      expect(runResult(checks)).toBe("passed");
      expect(checks.pr_states.harness).toMatchObject({ prs: [{ pr: 21, states: ["open", "parked", "ready", "merged"] }, { pr: 22, states: ["open", "ready", "merged"] }] });
      expect(() => run((db) => db.prepare("INSERT INTO events (kind) VALUES ('x')").run())).toThrow(/readonly/i);
    });

    it("leaves the store byte for byte as it was", () => {
      goodWalk();
      env.restart();
      env.store.close();
      const file = join(env.dataDir, "studio.db");
      const before = createHash("sha256").update(readFileSync(file)).digest("hex");
      run((db) => checkStore(db, START, REPO));
      expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe(before);
      env.restart();
    });

    it("counts nothing from before the run start: every check is not_exercised", () => {
      goodWalk();
      const start = run((db) => readRunStart(db, env.now()));
      expect(start.event_id).toBeGreaterThan(0);
      const checks = run((db) => checkStore(db, start, REPO));
      expect(CHECK_NAMES.map((n) => checks[n].outcome)).toEqual(["not_exercised", "not_exercised", "not_exercised"]);
      expect(runResult(checks)).toBe("incomplete");
    });

    it("pr_states: fails a state change that does not follow the previous one, a change after merged, a closed PR and a stale pr_tracks row", () => {
      change(21, null, "open");
      change(21, "parked", "ready");
      track(21, "ready", 0);
      const gap = run((db) => checkPrStates(db, START, REPO));
      expect(gap.outcome).toBe("fail");
      expect(gap.findings.join(" ")).toContain('starts from "parked" but the previous change ended "open"');
    });

    it("pr_states: fails a change after merged", () => {
      change(21, null, "open");
      change(21, "open", "merged");
      change(21, "merged", "open");
      track(21, "open", 1);
      const after = run((db) => checkPrStates(db, START, REPO));
      expect(after.outcome).toBe("fail");
      expect(after.findings.join(" ")).toContain("follows merged");
    });

    it("pr_states: fails a closed PR, an unknown state and a pr_tracks row that disagrees", () => {
      change(21, null, "open");
      change(21, "open", "closed");
      track(21, "closed", 0);
      expect(run((db) => checkPrStates(db, START, REPO)).findings.join(" ")).toContain("closed without merging");
      change(22, null, "open");
      change(22, "open", "limbo");
      track(22, "open", 0);
      const f = run((db) => checkPrStates(db, START, REPO));
      expect(f.findings.join(" ")).toContain('"limbo" is not a known PR state');
      expect(f.findings.join(" ")).toContain('pr_tracks says "open" but the last change ended "limbo"');
    });

    it("pr_states: fails a first change that is not a new track", () => {
      change(21, "open", "merged");
      track(21, "merged", 1);
      expect(run((db) => checkPrStates(db, START, REPO)).findings.join(" ")).toContain("not from a new track");
    });

    it("pr_states: is not_exercised until both PRs are tracked and both have merged", () => {
      change(21, null, "open");
      track(21, "open", 0);
      expect(run((db) => checkPrStates(db, START, REPO)).outcome).toBe("not_exercised");
      change(22, null, "open");
      track(22, "open", 0);
      const two = run((db) => checkPrStates(db, START, REPO));
      expect(two.outcome).toBe("not_exercised");
      expect(two.findings.join(" ")).toContain("#21, #22");
    });

    it("pr_states: ignores another repo's PRs", () => {
      goodWalk();
      appendEvent(env.store, "pr_state_changed", { sessionId: null, taskId: null }, { repo: "someone/else", pr: 7, from: "ready", to: "open" }, at());
      expect(run((db) => checkPrStates(db, START, REPO)).outcome).toBe("pass");
    });

    it("merged_by_gate: fails a merged PR whose merged_by_gate is 0", () => {
      goodWalk();
      track(22, "merged", 0);
      const c = run((db) => checkMergedByGate(db, START, REPO));
      expect(c.outcome).toBe("fail");
      expect(c.findings.join(" ")).toContain("#22 is merged with merged_by_gate = 0");
      expect(run((db) => checkStore(db, START, REPO)).pr_states.outcome).toBe("pass");
    });

    it("merged_by_gate: is not_exercised while fewer than two PRs have merged", () => {
      change(21, null, "open");
      change(21, "open", "merged");
      track(21, "merged", 1);
      const c = run((db) => checkMergedByGate(db, START, REPO));
      expect(c.outcome).toBe("not_exercised");
      expect(c.findings.join(" ")).toContain("1 of 2");
    });

    it("no_kernel_merge: fails an allowed gh pr merge, and a merge denied for another reason", () => {
      goodWalk();
      decision({ tool: "Bash", decision: "allow", reason: "policy_allow", command: "gh pr merge 22 --squash" });
      const allowed = run((db) => checkNoKernelMerge(db, START));
      expect(allowed.outcome).toBe("fail");
      expect(allowed.findings.join(" ")).toContain("gh pr merge 22 --squash was allow");
    });

    it("no_kernel_merge: fails a merge denied for another reason", () => {
      decision({ tool: "Bash", decision: "deny", reason: "approval_required", command: "gh pr merge 21" });
      expect(run((db) => checkNoKernelMerge(db, START)).outcome).toBe("fail");
    });

    it("no_kernel_merge: fails an allowed merge-named tool", () => {
      decision({ tool: "mcp__kernel__kernel_github_pr_merge", decision: "allow", reason: "policy_allow" });
      expect(run((db) => checkNoKernelMerge(db, START)).outcome).toBe("fail");
    });

    it("no_kernel_merge: does not count the merge-check and merge-approval tools as merges", () => {
      decision({ tool: "mcp__kernel__kernel_automate_merge_check", decision: "allow", reason: "policy_allow" });
      decision({ tool: "mcp__kernel__kernel_merge_approval_request", decision: "allow", reason: "policy_allow" });
      const safe = run((db) => checkNoKernelMerge(db, START));
      expect(safe.outcome).toBe("not_exercised");
      expect(safe.harness).toEqual({ attempts: [] });
    });

    it("no_kernel_merge: sees a gh api call that merges and passes once every attempt was denied merge_blocked", () => {
      decision({ tool: "Bash", decision: "deny", reason: "merge_blocked", command: "gh api -X PUT repos/o/r/pulls/21/merge" });
      decision({ tool: "Bash", decision: "allow", reason: "policy_allow", command: "gh pr view 21" });
      const c = run((db) => checkNoKernelMerge(db, START));
      expect(c.outcome).toBe("pass");
      expect((c.harness as { attempts: unknown[] }).attempts).toHaveLength(1);
    });

    const MERGE_FORMS = [
      "gh pr merge 5",
      "gh pr -R o/r merge 5",
      "gh pr --repo o/r merge 5 --squash",
      "gh pr --repo=o/r merge 5",
      "cd x && gh pr -R o/r merge 5",
      "gh api -X PUT repos/o/r/pulls/5/merge",
      "gh api repos/o/r/pulls/5/merge -X PUT",
      "gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"x\"}) { clientMutationId } }'",
      "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {pullRequestId: \"x\"}) { clientMutationId } }'",
      "gh api graphql -f query='mutation { enqueuePullRequest(input: {pullRequestId: \"x\"}) { clientMutationId } }'",
    ];
    const NOT_MERGES = [
      "gh pr view 5",
      "gh pr checks 5",
      "gh pr -R o/r view 5",
      "gh pr comment 5 --body 'ready to merge'",
      "gh api repos/o/r/pulls/5/comments",
      "gh api repos/o/r/pulls/5",
      "gh issue view 5",
    ];

    it.each(MERGE_FORMS)("no_kernel_merge: fails an ALLOWED merge in this form: %s", (command) => {
      decision({ tool: "Bash", decision: "allow", reason: "policy_allow", command });
      const c = run((db) => checkNoKernelMerge(db, START));
      expect(c.outcome).toBe("fail");
      expect((c.harness as { attempts: unknown[] }).attempts).toHaveLength(1);
    });

    it.each(MERGE_FORMS)("no_kernel_merge: passes a merge denied merge_blocked in this form: %s", (command) => {
      decision({ tool: "Bash", decision: "deny", reason: "merge_blocked", command });
      expect(run((db) => checkNoKernelMerge(db, START)).outcome).toBe("pass");
    });

    it.each(NOT_MERGES)("no_kernel_merge: does not count this as a merge attempt: %s", (command) => {
      decision({ tool: "Bash", decision: "allow", reason: "policy_allow", command });
      const c = run((db) => checkNoKernelMerge(db, START));
      expect(c.outcome).toBe("not_exercised");
      expect(c.harness).toEqual({ attempts: [] });
    });

    it("runResult: any fail is failed, a run with a gap is incomplete", () => {
      const ok = pass({});
      expect(runResult({ pr_states: ok, merged_by_gate: ok, no_kernel_merge: ok })).toBe("passed");
      expect(runResult({ pr_states: ok, merged_by_gate: notExercised({}, "x"), no_kernel_merge: ok })).toBe("incomplete");
      expect(runResult({ pr_states: ok, merged_by_gate: notExercised({}, "x"), no_kernel_merge: fail({}, ["y"]) })).toBe("failed");
    });
  });

  it("readRunStart records the highest event id and the time", () => {
    expect(run((db) => readRunStart(db, env.now()))).toEqual({ at: "2026-11-10T10:00:00.000Z", event_id: 0 });
    change(21, null, "open");
    expect(run((db) => readRunStart(db, env.now())).event_id).toBe(1);
  });
});

describe("phase 8 live: the sandbox guard and the wait", () => {
  it("accepts the owner's own repo", () => {
    expect(checkSandboxRepo(REPO, "vikashruhilgit")).toEqual({ ok: true, repo: REPO, account: "vikashruhilgit" });
  });

  it.each([
    ["no account", REPO, undefined],
    ["no repo", undefined, "vikashruhilgit"],
    ["an employer account", "vendsy/hub", "vendsy"],
    ["an employer repo under a personal login", "vendsy/hub", "vikashruhilgit"],
    ["another owner's repo", "someone/else", "vikashruhilgit"],
    ["a malformed repo", "studio-sandbox", "vikashruhilgit"],
    ["a path-like repo name", "vikashruhilgit/..", "vikashruhilgit"],
  ])("refuses %s", (_name, repo, account) => {
    expect(checkSandboxRepo(repo, account).ok).toBe(false);
  });

  it("waits the default unless STUDIO_LIVE_WAIT_MIN is a whole number 1-240", () => {
    expect(waitMinutes(undefined)).toBe(DEFAULT_WAIT_MIN);
    expect(waitMinutes("30")).toBe(30);
    expect(waitMinutes("0")).toBe(DEFAULT_WAIT_MIN);
    expect(waitMinutes("241")).toBe(DEFAULT_WAIT_MIN);
    expect(waitMinutes("1e2")).toBe(DEFAULT_WAIT_MIN);
  });
});

describe("phase 8 live: the summary", () => {
  it("redacts token shapes and the home dir, and writes mode 0600", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-phase8-live-"));
    try {
      const path = join(dir, "summary.json");
      writeSummary(path, { note: "/Users/someone/x ghp_abcdefghijklmnopqrstuvwxyz0123456789 sk-ant-abc123" }, "/Users/someone");
      const text = readFileSync(path, "utf8");
      expect(text).toContain("~/x");
      expect(text).not.toMatch(/ghp_abcdef|sk-ant-abc123|\/Users\/someone/);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- The evidence shape (AC4) -------------------------------------------------------

/** A valid evidence object in the runbook's shape; each case below breaks one thing. */
function evidence(): Record<string, unknown> {
  return {
    test: "phase-8-exit-live",
    date: "2026-11-12",
    result: "passed — two tickets became two PRs, both merged through the gate",
    run_by: "the agent, at the owner's request with the owner watching (D33)",
    commit: "0123456789abcdef0123456789abcdef01234567",
    dirty_worktree: false,
    machine: { macos: "26.0", node: "v22.0.0" },
    service: "pid 123, running",
    sandbox: { repo: REPO },
    harness: { summary: "~/tmp/studio-phase-8-exit-live-summary.json", checks: { pr_states: "pass", merged_by_gate: "pass", no_kernel_merge: "pass" } },
    clicks: [
      { step: "approve the crew member's charter", value: "Create", run_by: AGENT_ON_WORD, owner: { seen: true, notes: "the card appeared" } },
      { step: "connect ClickUp in the browser", run_by: OWNER_CLICK, owner: { seen: null, notes: "" } },
    ],
    steps: {
      tickets: { outcome: "passed", reason: "two tasks, two PRs", run_by: AGENT_ON_WORD, owner: { seen: true, notes: "" } },
      jira: { outcome: "not_exercised", reason: "the owner's work account", run_by: OWNER_CLICK, owner: { seen: null, notes: "" } },
    },
    jira: "not_exercised",
    findings: [],
    owner: { every_decision_made_by: "", notes: "" },
    cleanup: "the sandbox PRs closed",
  };
}

const stepOf = (e: Record<string, unknown>, name: string): Record<string, unknown> => (e.steps as Record<string, Record<string, unknown>>)[name] as Record<string, unknown>;

describe("phase 8 live: the evidence shape", () => {
  const problems = (e: unknown): string => {
    const r = checkEvidenceShape(e);
    return r.ok ? "" : r.problems.join("; ");
  };

  it("accepts the runbook's shape", () => {
    expect(problems(evidence())).toBe("");
    expect(checkEvidenceShape(evidence())).toEqual({ ok: true });
  });

  it.each([
    ["an agent click without the D35 wording", (e: Record<string, unknown>) => ((e.clicks as Record<string, unknown>[])[0] = { step: "approve", run_by: "the agent", owner: { seen: null, notes: "" } }), "without"],
    ["an agent click worded as the owner's own", (e: Record<string, unknown>) => ((e.clicks as Record<string, unknown>[])[0] = { step: "approve", run_by: "Claude", owner: { seen: null, notes: "" } }), 'must be "the owner"'],
    ["an agent step without the wording", (e: Record<string, unknown>) => (stepOf(e, "tickets").run_by = "agent"), "steps.tickets.run_by names the agent"],
    ["jira exercised", (e: Record<string, unknown>) => (e.jira = "exercised"), "jira must be"],
    ["jira missing", (e: Record<string, unknown>) => delete e.jira, "jira must be"],
    ["jira step passed", (e: Record<string, unknown>) => (stepOf(e, "jira").outcome = "passed"), "steps.jira.outcome"],
    ["no run_by", (e: Record<string, unknown>) => delete e.run_by, "run_by is missing"],
    ["clicks not an array", (e: Record<string, unknown>) => (e.clicks = {}), "clicks must be an array"],
    ["an owner field that is not an object", (e: Record<string, unknown>) => ((e.clicks as Record<string, unknown>[])[1] = { step: "x", run_by: OWNER_CLICK, owner: "saw it" }), "owner must be an object"],
    ["an owner.seen that is not a boolean", (e: Record<string, unknown>) => ((e.clicks as Record<string, unknown>[])[1] = { step: "x", run_by: OWNER_CLICK, owner: { seen: "yes", notes: "" } }), "owner.seen"],
    ["the wrong test name", (e: Record<string, unknown>) => (e.test = "phase-7-exit-live"), "test must be"],
    ["a bad date", (e: Record<string, unknown>) => (e.date = "12/11/2026"), "date must be"],
  ])("rejects %s", (_name, mutate, expected) => {
    const e = evidence();
    mutate(e);
    const r = checkEvidenceShape(e);
    expect(r.ok).toBe(false);
    expect(problems(e)).toContain(expected);
  });

  it("rejects a value that is not an object", () => {
    expect(checkEvidenceShape(null).ok).toBe(false);
    expect(checkEvidenceShape([]).ok).toBe(false);
  });

  it("checks every phase 8 evidence file in the repo against the shape and its own file name", () => {
    const dir = join(REPO_DIR, "docs", "evidence");
    for (const name of readdirSync(dir).filter((f) => EVIDENCE_FILE.test(f))) {
      const parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
      expect(problems(parsed), name).toBe("");
      expect(name, "the file name's date is the evidence's date").toBe(`phase-8-exit-live-${String(parsed.date)}.json`);
    }
  });
});

// ---- Close only on a pass (AC6) ------------------------------------------------------

describe("phase 8 live: close only on a pass", () => {
  const row = (tail: string): string => `| 7 | **GUI v2** | Each screen passes ✓ |\n| 8 | **Acceptance test 2:** tickets → PRs | A PR is tracked; merges only through the gated path${tail} |\n| 9 | **Hooks** | x |\n`;

  it("fails a ✓ on the phase 8 row with no evidence file, passes it with one, and passes an unticked row", () => {
    const ticked = checkRoadmapClose(row(" ✓"), ["phase-7-exit-live-2026-11-02.json", "phase-8-exit-runbook.md"]);
    expect(ticked.ok).toBe(false);
    expect(checkRoadmapClose(row(" ✓"), ["phase-8-exit-live-2026-11-12.json"])).toEqual({ ok: true });
    expect(checkRoadmapClose(row(""), [])).toEqual({ ok: true });
  });

  it("is not fooled by a ✓ on another row, and fails when the phase 8 row is gone", () => {
    expect(checkRoadmapClose(row(""), [])).toEqual({ ok: true });
    expect(checkRoadmapClose("| 7 | x | y ✓ |\n", []).ok).toBe(false);
  });

  it("fails an evidence file whose name is not phase-8-exit-live-<date>.json", () => {
    expect(checkRoadmapClose(row(" ✓"), ["phase-8-exit-live-notes.json", "phase-8-exit-live-2026-11-12.json.bak"]).ok).toBe(false);
  });

  it("ROADMAP's phase 8 row carries no ✓ unless a phase-8-exit-live-<date>.json exists", () => {
    const roadmap = readFileSync(join(REPO_DIR, "docs", "ROADMAP.md"), "utf8");
    const result = checkRoadmapClose(roadmap, readdirSync(join(REPO_DIR, "docs", "evidence")));
    expect(result.ok ? "" : result.reason).toBe("");
  });

  it("the OPEN_QUESTIONS entry is ticked only with an evidence file, and exists", () => {
    const ticked = "- [x] **Phase 8 exit: live run (item 14, owner).** done\n";
    expect(checkOpenQuestionsClose(ticked, []).ok).toBe(false);
    expect(checkOpenQuestionsClose(ticked, ["phase-8-exit-live-2026-11-12.json"]).ok).toBe(true);
    expect(checkOpenQuestionsClose("- [ ] **Phase 8 exit: live run (item 14, owner).** open\n", []).ok).toBe(true);
    expect(checkOpenQuestionsClose("nothing\n", []).ok).toBe(false);
    const real = readFileSync(join(REPO_DIR, "docs", "OPEN_QUESTIONS.md"), "utf8");
    const result = checkOpenQuestionsClose(real, readdirSync(join(REPO_DIR, "docs", "evidence")));
    expect(result.ok ? "" : result.reason).toBe("");
  });
});

// ---- The live run (STUDIO_LIVE=1) ----------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!LIVE)("live phase 8 exit: tickets to PRs, merged through the gate, the store only read (STUDIO_LIVE=1)", () => {
  const dataDir = resolveDataDir(process.env);
  const summaryPath = join(tmpdir(), `studio-phase-8-exit-live-summary-${Date.now()}.json`);
  const waitMs = waitMinutes(process.env.STUDIO_LIVE_WAIT_MIN) * MINUTE;
  let repo = "";
  let start: RunStart | undefined;
  let last: Checks | undefined;
  const summary: Record<string, unknown> = { test: "phase-8-exit-live", result: "running", run_by: null, clicks: [], jira: "not_exercised" };
  const save = (): void => writeSummary(summaryPath, summary);

  beforeAll(() => {
    const configured = checkSandboxRepo(process.env.STUDIO_LIVE_SANDBOX_REPO, process.env.STUDIO_LIVE_GITHUB_ACCOUNT);
    expect(configured.ok ? "" : configured.reason).toBe("");
    if (!configured.ok) return;
    repo = configured.repo;
    expect(existsSync(join(dataDir, "studio.db")), `no store at ${redact(dataDir)}: install the service first (runbook setup)`).toBe(true);
    start = withDb(dataDir, (db) => readRunStart(db));
    Object.assign(summary, { date: start.at.slice(0, 10), run_start: start, sandbox: { repo }, harness_summary: summaryPath, wait_minutes: waitMs / MINUTE });
    save();
    console.log(`phase-8-exit-live summary: ${summaryPath} (run start: event ${start.event_id}, ${start.at})`);
    console.log("phase-8-exit-live: do the walk in Loomwright Studio.app now; this harness only reads the store and never decides an approval.");
  }, 60_000);

  afterAll(() => {
    if (start === undefined) return;
    summary.finished_at = new Date().toISOString();
    summary.result = last === undefined ? "failed" : runResult(last);
    save();
    console.log(`phase-8-exit-live summary: ${summaryPath} (${String(summary.result)})`);
  }, 60_000);

  it(
    "each tracked PR's states appear in order, each merge has merged_by_gate, and the store records no kernel merge",
    async () => {
      const runStart = start as RunStart;
      const deadline = Date.now() + waitMs;
      let shown = "";
      let pollErrors = 0;
      for (;;) {
        try {
          last = withDb(dataDir, (db) => checkStore(db, runStart, repo));
          summary.checks = last;
          const line = CHECK_NAMES.map((n) => `${n}:${(last as Checks)[n].outcome}`).join(" ");
          if (line !== shown) {
            shown = line;
            console.log(`phase-8-exit-live ${new Date().toISOString()} ${line}`);
          }
          summary.result = runResult(last);
          save();
          if (runResult(last) !== "incomplete") break;
        } catch (err) {
          pollErrors += 1;
          summary.poll_errors = { count: pollErrors, last: redact(err instanceof Error ? err.message : String(err)) };
        }
        if (Date.now() > deadline) break;
        await sleep(POLL_MS);
      }
      if (last === undefined) throw new Error(`the store could not be read once in ${waitMs / MINUTE} minutes (see poll_errors in the summary)`);
      for (const n of CHECK_NAMES) expect(last[n].outcome, `${n}: ${last[n].findings.join("; ")}`).toBe("pass");
    },
    waitMs + 5 * MINUTE,
  );
});
