// The `automate` feature's launch (phase 8 item 20b, D44, which supersedes D43's
// "the playbook's own run session runs `/automate`; no kernel tool or approval
// starts a session"): the KERNEL starts Loomwright's commands for a live
// playbook's crew member, as ordinary kernel-owned SDK sessions. Three kinds
// (phase 8 item 22g), one path, one payload key and one work step:
//   - `backlog`: `/automate` over the tickets `kernel_automate_prepare` wrote
//     (the default when the payload names no `kind`, so an event queued before
//     the kinds existed still launches);
//   - `review_pr`: `/loomwright:review-pr <pr url>`, queued by `kernel_pr_route`
//     on an `automate_fix` or `review_pr` answer (`./routing.ts`);
//   - `merge_parked`: `/loomwright:automate --merge-parked <run_id>`, queued by
//     `kernel_automate_merge_check` on a `go` (`./runner.ts`).
//
// The path, end to end:
//   1. a crew session's kernel tool queues ONE `message` event whose payload is
//      `{agent, automate_run: KernelRunPayload}`: the kind, the repo, the
//      checkout, the attribution and, per kind, the backlog path, the PR number
//      or the run id. Nothing from a ticket, a comment or a PR is in it;
//   2. the brain's `message` handler routes a payload with `automate_run` here
//      (`handleAutomateRun`), beside its `playbook` route (a plain message never
//      carries the key); it routes on the key, never on the kind;
//   3. the handler starts the session through the session manager the loop gave
//      it (`EventContext.sessions`, never imported). The prompt is kernel-built
//      from checked fields only: `/loomwright:automate --backlog <path>
//      --inline-phases` (safe mode: no auto merge, no fan out); or
//      `/loomwright:review-pr <url>` with the URL built from the repo and number
//      (`pullUrlOf`); or the merge command with the run id and, only where
//      `loomwrightMergeFlags` returns it for the repo at launch, the owner's
//      recorded trust flag (never a flag from the payload). cwd the crew member's
//      checkout, agent the crew member, playbook, version and task the calling
//      session's, model the calling session's (the playbook version's model:
//      invariant 1, never the crew member's settings model), and the kind's run
//      policy with the crew member's own `never` list. The session is therefore
//      one of the playbook's: Stop and Kill, the budget and the cap, the rail and
//      the approval gate all apply (invariants 2 and 3), and its events and
//      tokens count against the crew member and the playbook.
//
// The run policies (`AUTOMATE_RUN_POLICY`, `REVIEW_PR_RUN_POLICY`,
// `MERGE_PARKED_RUN_POLICY`) are frozen kernel constants. None is ever read
// from, or written into, a charter or a settings file, and the crew member's
// own policy holds none of them (the crew session has no `Skill` and no shell
// grant). The kernel never merges (invariant 4): the only merge is Loomwright's
// own gate inside the merge command, which its driver script runs and the rail
// sees only as `bash <driver>`; a direct merge stays `merge_blocked`. All
// three grant the same Claude tools and the same subcommand prefixes, what
// `/automate --inline-phases` and `/review-pr` need to ask for (never bare `git`
// or `gh`: `git config core.fsmonitor`, `git -c`,
// `gh release`, `gh secret`, `gh workflow` and `gh repo edit` would run or write
// past the rail in a session that reads untrusted ticket or PR text), and differ
// only in their driver script names. None changes
// the rail or the gate: a push is held, a merge denied, the crew
// member's `never` boundary applies. What each DOES allow is exactly its list. Three
// exposures remain, all for the rail and not for these policies: `gh api` is
// matched on the prefix, so `gh api -X POST ...` is allowed and the rail does not
// hold it; `gh pr ready|reopen|update-branch|lock` and `gh issue` writes are
// not in the rail's outward set; and a listed git subcommand still has forms that
// run a program or write a file the rail does not read (`git fetch --upload-pack=<cmd>`,
// `git diff --output=<path>`, hooks on `git commit` / `git checkout`). `git fetch`
// stays listed because Loomwright's Supervisor ACQUIRE runs `git fetch origin <base>`.
// The rail would have to read arguments (follow-up). See the open points in
// `docs/architecture/automate.md`. The rail still denies any Bash command with a
// shell metacharacter, which a real run may hit (also an open point there).
// Loomwright's own driver and helper scripts are admitted by exact path only
// (`loomwrightScripts`, phase 8 item 22g): the session manager builds the paths
// under the install the session loads, so this module never resolves an install.
// When that install cannot be resolved, or its `scripts/` cannot be read, the
// manager refuses the start with a Loomwright `SessionError` (a code starting
// `loomwright_`, no row); the step stores `loomwright_unresolved: <code>:
// <message>` and starts nothing (fail closed, never a broader grant). Every
// other error, an admission (budget or cap) refusal among them, is rethrown.
//
// Single drain (invariant 4): the handler starts nothing while Loomwright's run
// state reads live or cannot be read, or while a run session it started (of any
// kind) for the same crew member and checkout has not ended (Loomwright's lock
// lags the start), and stores why. It is idempotent: ONE work step, so a
// redelivery returns the stored result and starts no second session.
//
// This module starts no process, calls no GitHub endpoint and merges nothing:
// the only effect is one start call on the session manager the loop passes in. The `studio` CLI loads it
// through the brain's handler, so it imports only types, the status helpers and
// `SessionError` in `sessions/types.ts`, the loop's `internal.ts` leaf, node
// `path`, the agent readers, the repo-policy module (`isRepoName`,
// `loomwrightMergeFlags`) and this feature's files: never the Agent SDK, the
// session manager or `kernel.ts`.
import { resolve, sep } from "node:path";
import { getAgent } from "../agents/registry.js";
import { readAgentSettings } from "../agents/settings.js";
import { isRepoName, loomwrightMergeFlags } from "../integrations/github/repo-policy.js";
import { isPositiveId, messageOf } from "../loop/internal.js";
import type { EventContext, EventSessions } from "../loop/types.js";
import { resolvedPath } from "../protected-paths.js";
import { SessionError, TERMINAL_STATUSES, isTerminalStatus } from "../sessions/types.js";
import type { SessionHandle, ToolPolicy } from "../sessions/types.js";
import { isRunId, readRunState, summarizeRuns } from "./run-state.js";
import { automateInvocation } from "./tickets-to-items.js";

/** The payload key that marks a `message` event as a kernel-started Loomwright run (any kind). */
export const AUTOMATE_RUN_KEY = "automate_run";

/** The kinds of kernel-started run, closed in code. An `automate_run` payload with no `kind` is a `backlog` run. */
export const AUTOMATE_RUN_KINDS = Object.freeze(["backlog", "review_pr", "merge_parked"] as const);

/** One of `AUTOMATE_RUN_KINDS`. */
export type AutomateRunKind = (typeof AUTOMATE_RUN_KINDS)[number];

/** What every kind carries: the repo, the cwd and who the session is attributed to. */
interface RunAttribution {
  readonly repo: string;
  /** The crew member's checkout of the repo (the run's cwd). */
  readonly checkout: string;
  readonly playbook: number;
  readonly playbook_version: number | null;
  readonly task: number | null;
  /** The crew session whose tool call queued the run: its row names the model the run uses. */
  readonly source_session: number;
}

/** What `kernel_automate_prepare` queues under `AUTOMATE_RUN_KEY`. Kernel-built; ticket text is never in it. */
export interface AutomateRunPayload extends RunAttribution {
  /** Absent (an event queued before the kinds existed) or `backlog`. */
  readonly kind?: "backlog";
  /** Absolute path of the `_BACKLOG.md` the run reads. */
  readonly backlog: string;
}

/** What `kernel_pr_route` queues for a fix: the PR by repo and number only (comment and PR text are never in it). */
export interface ReviewPrRunPayload extends RunAttribution {
  readonly kind: "review_pr";
  readonly pr: number;
}

/** What `kernel_automate_merge_check` queues on `go`: the parked run's id (`isRunId`). No flag: the trust flag is read again at launch. */
export interface MergeParkedRunPayload extends RunAttribution {
  readonly kind: "merge_parked";
  readonly pr: number;
  readonly run_id: string;
}

/** Any `automate_run` payload. */
export type KernelRunPayload = AutomateRunPayload | ReviewPrRunPayload | MergeParkedRunPayload;

/** A checked payload: its kind always set, and the event's agent. */
type Run =
  | (Omit<AutomateRunPayload, "kind"> & { readonly kind: "backlog"; readonly agent: string })
  | (ReviewPrRunPayload & { readonly agent: string })
  | (MergeParkedRunPayload & { readonly agent: string });

/** The web URL of a pull request, built from a checked repo name and number (never taken from GitHub's answer or a comment). */
export function pullUrlOf(repo: string, pr: number): string {
  return `https://github.com/${repo}/pull/${pr}`;
}

/** The Bash prefixes every run policy grants (never bare `git` or `gh`; see the module comment). */
const RUN_BASH_PREFIXES: readonly string[] = Object.freeze([
  // git: the subcommands the run uses and the rail reads. A prefix matches on a
  // word boundary (`git commit` admits `git commit -m x`, not `git commit-tree`).
  "git status", "git diff", "git log", "git show", "git add", "git commit", "git checkout", "git switch", "git branch", "git fetch",
  "git push", "git rev-parse", "git worktree", "git stash", "git merge-base", "git ls-files",
  // gh: reads and the PR / issue work; no release, secret, workflow or repo edit / delete.
  "gh pr", "gh issue", "gh api", "gh repo view", "gh auth status", "gh run view",
  "ls", "cat", "pwd", "date", "mkdir", "test", "wc", "head", "tail", "grep", "sleep", "jq",
]);

/** The Claude tools every run policy grants. */
const RUN_TOOLS: readonly string[] = Object.freeze(["Skill", "Read", "Write", "Edit", "Glob", "Grep", "Bash", "Agent", "AskUserQuestion"]);

/**
 * The Loomwright driver and helper scripts the `/automate` run calls, by basename
 * under the active install's `scripts/` (phase 8 item 22g, AC15). Derived from the
 * 17.38.0 install with `grep -ohE 'scripts/[A-Za-z0-9_.-]+\.sh'` over
 * `commands/automate.md`, `skills/automate-loop/` and `scripts/automate-next-step.sh`,
 * leaving out `test-*.sh`, the Loomwright-repo-only scripts (`bump-version.sh`,
 * `release-refold.sh`, `check-doc-currency.sh`, `build-capabilities.sh`) and the
 * host project's `ci-local.sh`; plus `review-heal-next-step.sh`, which the run's
 * review-heal drain calls. A script the run calls by another path, or that is not
 * listed, stays denied (a live-run finding, never a wider grant).
 */
const AUTOMATE_RUN_SCRIPTS: readonly string[] = Object.freeze([
  "automate-dismissed.sh", "automate-helpers.sh", "automate-lanes.sh", "automate-merge-watch.sh", "automate-next-step.sh",
  "automate-wave.sh", "classify-risk.sh", "fix-floor.sh", "guard-lane-wait-armed.sh", "lane-policy.sh", "lane-sampler.sh",
  "meta-sync.sh", "progress-line-match.sh", "read-token-ledger.sh", "resolve-base-branch.sh", "review-heal-next-step.sh",
  "rules-gate-verdict.sh", "run-lock.sh",
]);

/**
 * The run session's policy: what `/automate --inline-phases` is allowed to ask for.
 * Frozen, and never written into a charter. The rail and the approval gate run on
 * top of it unchanged, and the crew member's `never` list is added at the start.
 * Bash is gated by the prefixes and by `loomwrightScripts`: the session manager
 * admits `bash <path>` for each listed script only at its exact path under the
 * install the session loads (`sessions/loomwright-scripts.ts`), never `bash` as a
 * prefix (that would let `bash -c` run anything past the rail), and refuses the
 * start when that install's `scripts/` cannot be read.
 */
export const AUTOMATE_RUN_POLICY: ToolPolicy = Object.freeze({
  allowedTools: RUN_TOOLS,
  allowedBashPrefixes: RUN_BASH_PREFIXES,
  loomwrightScripts: AUTOMATE_RUN_SCRIPTS,
});

/**
 * The scripts `/loomwright:review-pr` calls, by basename (AC15). Derived from the
 * 17.38.0 install with the same `grep -ohE 'scripts/[A-Za-z0-9_.-]+\.sh'` over
 * `commands/review-pr.md`, `skills/review-heal/` and
 * `scripts/review-heal-next-step.sh`, leaving out the repo-only scripts
 * (`bump-version.sh`, `release-refold.sh`) and three that act past the kernel:
 * `dispatch-pr-review.sh` and `dispatch-pr-postmortem.sh` each start a detached
 * headless `claude` process (a session the kernel does not own, invariant 2),
 * and `send-webhook.sh` posts outward past the approval gate (invariant 3).
 */
const REVIEW_PR_RUN_SCRIPTS: readonly string[] = Object.freeze([
  "automate-helpers.sh", "ci-run-probe.sh", "classify-bot-review.sh", "drain-gh-read.sh", "drain-rounds.sh",
  "drain-subfloor-decision.sh", "fix-floor.sh", "guard-arm.sh", "notify-desktop.sh", "pr-postmortem-gather.sh",
  "review-heal-next-step.sh", "rules-gate-verdict.sh", "wait-for-checks.sh", "wrap-external-text.sh",
]);

/**
 * The `review_pr` run session's policy: what `/loomwright:review-pr <url>` (the
 * triage fix: it heals and never merges) is allowed to ask for. The same tools and
 * prefixes as `AUTOMATE_RUN_POLICY`; its own driver scripts. Frozen, never written
 * into a charter; the rail, the gate and the crew member's `never` list apply.
 */
export const REVIEW_PR_RUN_POLICY: ToolPolicy = Object.freeze({
  allowedTools: RUN_TOOLS,
  allowedBashPrefixes: RUN_BASH_PREFIXES,
  loomwrightScripts: REVIEW_PR_RUN_SCRIPTS,
});

/**
 * The scripts `/loomwright:automate --merge-parked <run_id>` calls, by basename
 * (AC15). The same derivation as `AUTOMATE_RUN_SCRIPTS` (the same command file,
 * skill and driver), without `review-heal-next-step.sh` (a merge runs no drain) and
 * without `automate-lanes.sh`, which starts headless `claude` lane processes: the
 * driver refuses a merge of a lane or a `--parallel` parent, so a merge never needs it.
 */
const MERGE_PARKED_RUN_SCRIPTS: readonly string[] = Object.freeze([
  "automate-dismissed.sh", "automate-helpers.sh", "automate-merge-watch.sh", "automate-next-step.sh",
  "automate-wave.sh", "classify-risk.sh", "fix-floor.sh", "guard-lane-wait-armed.sh", "lane-policy.sh", "lane-sampler.sh",
  "meta-sync.sh", "progress-line-match.sh", "read-token-ledger.sh", "resolve-base-branch.sh",
  "rules-gate-verdict.sh", "run-lock.sh",
]);

/**
 * The `merge_parked` run session's policy: what Loomwright's merge of ONE parked
 * item through its own gate is allowed to ask for. The same tools and prefixes as
 * `AUTOMATE_RUN_POLICY`; its own driver scripts. The gate's merge runs inside the
 * driver; a direct merge is still `merge_blocked` (D40). Frozen, never written into
 * a charter; the rail, the gate and the crew member's `never` list apply.
 */
export const MERGE_PARKED_RUN_POLICY: ToolPolicy = Object.freeze({
  allowedTools: RUN_TOOLS,
  allowedBashPrefixes: RUN_BASH_PREFIXES,
  loomwrightScripts: MERGE_PARKED_RUN_SCRIPTS,
});

/** Each kind's run policy. */
const RUN_POLICIES: Readonly<Record<AutomateRunKind, ToolPolicy>> = Object.freeze({
  backlog: AUTOMATE_RUN_POLICY,
  review_pr: REVIEW_PR_RUN_POLICY,
  merge_parked: MERGE_PARKED_RUN_POLICY,
});

/** The command the run starts with: Loomwright's `/automate` over the backlog, inline phases, safe mode. */
export const AUTOMATE_RUN_COMMAND = "/loomwright:automate";

/** The command a `review_pr` run starts with: Loomwright's `/review-pr`, which heals and never merges. */
export const REVIEW_PR_RUN_COMMAND = "/loomwright:review-pr";

/** The prompt a `review_pr` run starts with: exactly `/loomwright:review-pr <url>`, the URL built from the repo and number, no flag. */
export function reviewPrRunPrompt(repo: string, pr: number): string {
  return `${REVIEW_PR_RUN_COMMAND} ${pullUrlOf(repo, pr)}`;
}

/** The merge command for `runId`: `/loomwright:automate --merge-parked <run_id>`, then `flags` (only `loomwrightMergeFlags`' answer for the repo). */
export function mergeParkedRunPrompt(runId: string, flags: readonly string[]): string {
  return [AUTOMATE_RUN_COMMAND, "--merge-parked", runId, ...flags].join(" ");
}

/** What the `automate-run` step stores: the run session's id, or no session and why. */
export type AutomateRunResult = { readonly session_id: number } | { readonly session_id: null; readonly skipped: string };

/** The event's `automate_run` payload, checked; a `TypeError` names what is wrong (the loop fails the event, one notify). */
function automateRunOf(eventId: number, payload: Readonly<Record<string, unknown>>): Run {
  const bad = (what: string): TypeError => new TypeError(`event ${eventId}: an automate run needs ${what}`);
  const raw = payload[AUTOMATE_RUN_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw bad("automate_run, an object");
  const r = raw as Record<string, unknown>;
  // Only an absent `kind` is a backlog run (an event queued before the kinds existed); `null` or any other value is malformed.
  const kind = r.kind === undefined ? "backlog" : r.kind;
  if (typeof kind !== "string" || !(AUTOMATE_RUN_KINDS as readonly string[]).includes(kind)) throw bad(`kind, absent or one of ${AUTOMATE_RUN_KINDS.join(", ")}`);
  if (typeof payload.agent !== "string" || payload.agent === "") throw bad("agent, a string");
  if (typeof r.repo !== "string" || r.repo === "") throw bad("repo, a string");
  if (typeof r.checkout !== "string" || !r.checkout.startsWith("/")) throw bad("checkout, an absolute path");
  if (!isPositiveId(r.playbook)) throw bad("playbook, a positive integer");
  if (r.playbook_version !== null && r.playbook_version !== undefined && !isPositiveId(r.playbook_version)) throw bad("playbook_version, absent, null or a positive integer");
  if (r.task !== null && r.task !== undefined && !isPositiveId(r.task)) throw bad("task, absent, null or a positive integer");
  if (!isPositiveId(r.source_session)) throw bad("source_session, a positive integer");
  const common = {
    agent: payload.agent,
    repo: r.repo,
    checkout: r.checkout,
    playbook: r.playbook,
    playbook_version: r.playbook_version ?? null,
    task: r.task ?? null,
    source_session: r.source_session,
  };
  if (kind === "backlog") {
    if (typeof r.backlog !== "string" || !r.backlog.startsWith("/")) throw bad("backlog, an absolute path");
    return { kind, ...common, backlog: r.backlog };
  }
  // The PR's repo and number go into a prompt: a checked `<owner>/<name>` and a positive integer, nothing else.
  if (!isRepoName(r.repo)) throw bad("repo, <owner>/<name>");
  if (!isPositiveId(r.pr)) throw bad("pr, a positive integer");
  if (kind === "review_pr") return { kind, ...common, pr: r.pr };
  if (!isRunId(r.run_id)) throw bad("run_id, a Loomwright run id");
  return { kind: "merge_parked", ...common, pr: r.pr, run_id: r.run_id };
}

/** The prompt the run starts with: `/loomwright:automate --backlog <path> --inline-phases`. Throws `RangeError` for a path that cannot be quoted. */
export function automateRunPrompt(backlog: string): string {
  return automateInvocation(backlog).replace(/^\/automate /, `${AUTOMATE_RUN_COMMAND} `);
}

/** The id of a non-terminal session this handler started (an `automate-run` step's stored `session_id`) for `agent` in `checkout`, if any. */
function liveRunSession(store: EventContext["store"], sessions: EventSessions, agent: string, checkout: string): number | undefined {
  // `sessions.cwd` is the REALPATH of the start cwd (the manager's `resolvedPath`), so compare realpaths: a symlinked
  // workspace (or macOS /tmp, /var) never matches on `resolve()` alone. `resolvedPath` never throws (a missing path
  // resolves as far as it exists), so a deleted checkout compares lexically instead of wedging the event.
  const want = resolvedPath(checkout);
  // The candidates are scoped in SQL, so the answer never depends on how many other `automate-run` steps exist: the
  // run sessions this handler started (the steps' stored `session_id`) that are this agent's and not terminal. The
  // `CASE json_valid` keeps a malformed `result_json` from raising (SQLite does not order AND operands). The cwd
  // (a realpath compare) and the terminal check are then made on the session row itself.
  const placeholders = TERMINAL_STATUSES.map(() => "?").join(", ");
  const ids = store
    .prepare<unknown[], number>(
      `SELECT s.id FROM sessions s WHERE s.agent = ? AND s.status NOT IN (${placeholders}) AND s.id IN (
         SELECT CASE WHEN json_valid(w.result_json) THEN json_extract(w.result_json, '$.session_id') END
         FROM work_steps w WHERE w.key LIKE 'event:%:automate-run' AND w.status = 'done' AND w.result_json IS NOT NULL)
       ORDER BY s.id DESC`,
    )
    .pluck()
    .all(agent, ...TERMINAL_STATUSES);
  for (const id of ids) {
    if (!isPositiveId(id)) continue;
    const row = sessions.getSession(id);
    if (row === undefined || row.agent !== agent || row.cwd === null || resolvedPath(row.cwd) !== want) continue;
    if (!isTerminalStatus(row.status)) return id;
  }
  return undefined;
}

/**
 * The kind's kernel-built prompt, or why there is none. Only checked fields go in:
 * the backlog path (inside the checkout), the repo and number, the run id, and the
 * repo's merge flags read from the store now (`loomwrightMergeFlags`), never from
 * the payload. Comment, PR and ticket text are in none of them (invariant 3).
 */
function promptOf(store: EventContext["store"], run: Run, checkout: string): { readonly prompt: string } | { readonly skipped: string } {
  switch (run.kind) {
    case "backlog":
      if (!resolve(run.backlog).startsWith(`${checkout}${sep}`)) return { skipped: "backlog_outside_checkout" };
      try {
        return { prompt: automateRunPrompt(run.backlog) };
      } catch (err) {
        return { skipped: messageOf(err) };
      }
    case "review_pr":
      return { prompt: reviewPrRunPrompt(run.repo, run.pr) };
    case "merge_parked":
      return { prompt: mergeParkedRunPrompt(run.run_id, loomwrightMergeFlags(store, run.repo)) };
  }
}

/** Whether `err` is the session manager's refusal of a Loomwright it cannot run with (`loomwright_not_found`, `loomwright_contract`, ...: no row was written). */
function isLoomwrightRefusal(err: unknown): err is SessionError {
  return err instanceof SessionError && err.code.startsWith("loomwright_");
}

/**
 * The `automate-run` step: decide whether the run may start, and start it. Every
 * refusal of ours is a return that stores why, so a redelivery replays it and
 * decides nothing again. So is the manager's Loomwright refusal (an install it
 * cannot resolve, or whose `scripts/` it cannot read): `loomwright_unresolved:
 * <code>: <message>`, the start having written no row. An admission refusal
 * (budget or cap) is not caught here: it comes out of the start call inside the
 * step, so the loop parks the event and releases the step for the redelivery.
 */
async function startRun(ctx: EventContext, run: Run): Promise<AutomateRunResult> {
  const { store } = ctx;
  const skip = (why: string): AutomateRunResult => ({ session_id: null, skipped: why });
  const sessions = ctx.sessions;
  if (sessions === undefined) return skip("no_session_manager");

  // The playbook is still live and the crew member still on: either may have changed since prepare queued the event.
  const mode = store.prepare<[number], string>("SELECT mode FROM playbooks WHERE id = ?").pluck().get(run.playbook);
  if (mode === undefined) return skip("playbook_gone");
  if (mode !== "live") return skip(`playbook_not_live: playbook ${run.playbook} is in ${mode} mode`);
  if (getAgent(store, run.agent)?.status !== "active") return skip(`agent_not_active: ${run.agent}`);

  // The calling session: its row names the model (the playbook version's), the playbook version and the task.
  const caller = sessions.getSession(run.source_session);
  if (caller === undefined) return skip("source_session_gone");
  if (caller.agent !== run.agent || caller.playbook !== run.playbook) return skip("source_session_mismatch");
  if (caller.model === null || caller.model === "") return skip("model_unset: the calling session has no model");

  const read = readAgentSettings(store.dataDir, run.agent);
  if (!read.ok) return skip(`${read.error}: ${read.message}`);
  const settings = read.settings;

  // The checkout is one of the crew member's workspaces (and a backlog run's backlog is inside it).
  const checkout = resolve(run.checkout);
  if (!(settings.workspaces ?? []).some((w) => resolve(w) === checkout)) return skip(`workspace_not_listed: ${run.checkout}`);
  const built = promptOf(store, run, checkout);
  if ("skipped" in built) return skip(built.skipped);
  const { prompt } = built;
  const runPolicy = RUN_POLICIES[run.kind];

  // Single drain: Loomwright's run state is the authority, and an unreadable one reads as live.
  const state = readRunState(checkout);
  if (!state.ok) return skip(`run_state_unreadable: ${state.reason}`);
  const summary = summarizeRuns(state);
  if (summary.state === "live") return skip(`run_live: ${summary.run_id ?? "run lock held"}`);

  // Loomwright writes its lock after the session starts, so the run state lags: also refuse while a run session
  // this handler started for the same crew member and checkout is still live. The `automate-run` steps are the
  // record of those sessions (the sessions table keeps no prompt), and a session that has ended no longer blocks.
  const live = liveRunSession(store, sessions, run.agent, checkout);
  if (live !== undefined) return skip(`run_session_live: session ${live}`);

  // The session is the step's last effect, so an admission refusal leaves nothing to repeat. The manager's
  // Loomwright refusal (no install, or no readable `scripts/`) wrote no row, so it is stored, never retried as is.
  let handle: SessionHandle;
  try {
    handle = await sessions.startSession({
      agent: run.agent,
      prompt,
      model: caller.model,
      permissionMode: settings.permissionMode,
      cwd: checkout,
      policy: { ...runPolicy, ...(settings.never !== undefined ? { never: settings.never } : {}) },
      playbook: run.playbook,
      ...(caller.playbook_version === null || caller.playbook_version === undefined ? {} : { playbookVersion: caller.playbook_version }),
      ...(caller.task_id === null || caller.task_id === undefined ? {} : { task: caller.task_id }),
    });
  } catch (err) {
    if (isLoomwrightRefusal(err)) return skip(`loomwright_unresolved: ${err.code}: ${err.message}`);
    throw err;
  }
  return { session_id: handle.id };
}

/**
 * The brain's route for a `message` event whose payload carries `automate_run`:
 * start the kind's run session once for the event (see the module comment).
 * Resolves when the step is stored; it never awaits the session itself.
 */
export async function handleAutomateRun(ctx: EventContext): Promise<void> {
  const run = automateRunOf(ctx.event.id, ctx.event.payload);
  await ctx.runStepAsync("automate-run", () => startRun(ctx, run));
}
