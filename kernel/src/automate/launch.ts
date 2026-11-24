// The `automate` feature's launch (phase 8 item 20b, D44, which supersedes D43's
// "the playbook's own run session runs `/automate`; no kernel tool or approval
// starts a session"): the KERNEL starts Loomwright's commands for a live
// playbook's crew member, as ordinary kernel-owned SDK sessions. Four kinds
// (D44, extended by D45 to `review_pr` and `merge_parked`; phase 8
// item 22g; `resume`, item 23j), one path, one payload key and one work step:
//   - `backlog`: `/automate` over the tickets `kernel_automate_prepare` wrote
//     (the default when the payload names no `kind`, so an event queued before
//     the kinds existed still launches);
//   - `review_pr`: `/loomwright:review-pr <pr url>`, queued by `kernel_pr_route`
//     on an `automate_fix` or `review_pr` answer (`./routing.ts`);
//   - `merge_parked`: `/loomwright:automate --merge-parked <run_id>`, queued by
//     `kernel_automate_merge_check` on a `go` (`./runner.ts`);
//   - `resume`: `/loomwright:automate --resume <run_id> --inline-phases`, queued
//     by the owner's Resume on a paused or stranded run (`../gui/paused-runs.ts`),
//     attributed to the kernel run that last drained the checkout; it starts only
//     while that run is still `paused`, or `running` with no live lock holder
//     (23l, `run_not_paused`), and no other run is live (`run_live`).
//
// The path, end to end:
//   1. a crew session's kernel tool (for `resume`, the owner's route) queues ONE `message` event whose payload is
//      `{agent, automate_run: KernelRunPayload}`: the kind, the repo, the
//      checkout, the attribution and, per kind, the backlog path, the PR number
//      (and, for a fix, at most one owner comment by kind, id and kernel-built URL)
//      or the run id. No text from a ticket, a comment or a PR is in it;
//   2. the brain's `message` handler routes a payload with `automate_run` here
//      (`handleAutomateRun`), beside its `playbook` route (a plain message never
//      carries the key); it routes on the key, never on the kind;
//   3. the handler starts the session through the session manager the loop gave
//      it (`EventContext.sessions`, never imported). The prompt is kernel-built
//      from checked fields only: `/loomwright:automate --backlog <path>
//      --inline-phases` (safe mode: no auto merge, no fan out); or
//      `/loomwright:review-pr <url>` with the URL built from the repo and number
//      (`pullUrlOf`), followed, when the payload names the owner's comment and
//      the launch's own re-read finds it still the owner's, by the kernel's fixed
//      instruction line and that comment's body wrapped as data and bounded
//      (`./owner-comment.ts`, phase 8 item 26a); or the merge command with the run id and, only where
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
// Declared checks (phase 8 item 25d): a `backlog`, `resume` or `review_pr` run's policy carries the checks the repo
// declares on its base branch (`declaredChecks`, `./declared-checks.ts`), read at each launch or continuation from the
// base commit current then through the checkout's committed reads (`committedReads`,
// `loomwright/run-state-checkout.ts`), never the working tree. The session gate admits exactly those command lines
// (`declared_check`); the merge kinds get none. Each start appends one `run_declared_checks` event for the run session,
// which also names each admitted check whose executable the kernel's own PATH (the env every run session inherits)
// cannot find (`unrunnable`, phase 8 item 27a): the check stays admitted, the owner reads the gap before the run hits it.
//
// This module starts no process and merges nothing. Its one GitHub call is a
// read: a `review_pr` run whose payload names the owner's comment reads that one
// comment through the loop's client (`EventContext.github`, never built here) in
// the step, before the start call; its body goes into the prompt only wrapped as
// data and bounded, and into nothing stored. Its only effect is one start call on
// the session manager the loop passes in, then the run's
// `run_declared_checks` event, which cannot fail the step. The `studio` CLI loads it
// through the brain's handler, so it imports only types, the status helpers and
// `SessionError` in `sessions/types.ts`, the loop's `internal.ts` leaf, node
// `path`, the agent readers, the repo-policy module (`isRepoName`,
// `loomwrightMergeFlags`, `getRepoPolicy`), the Loomwright checkout readers and this feature's files
// (`./owner-comment.ts` among them, which brings the GitHub connector row and the brain's
// `wrapUntrusted` and `cutChars`): never the Agent SDK, the session manager or `kernel.ts`.
import { resolve, sep } from "node:path";
import { getAgent } from "../agents/registry.js";
import { readAgentSettings } from "../agents/settings.js";
import { getRepoPolicy, isRepoName, loomwrightMergeFlags, TRUST_UNPROTECTED_FLAG } from "../integrations/github/repo-policy.js";
import { handRequiredChecks } from "../loomwright/required-checks.js";
import { versionModelOf } from "../playbooks/runs.js";
import type { Store } from "../store/index.js";
import { appendEvent, isPositiveId, messageOf } from "../loop/internal.js";
import type { EventContext, EventSessions } from "../loop/types.js";
import { resolvedPath } from "../protected-paths.js";
import { SessionError, TERMINAL_STATUSES, isContinuableStatus, isTerminalStatus } from "../sessions/types.js";
import type { SessionHandle, ToolPolicy } from "../sessions/types.js";
import { isRunId, pausedRuns, readRunState, resumeWouldDoubleDrain, summarizeRuns } from "./run-state.js";
import { deadLockOf, releaseKernelLock } from "../loomwright/run-lock.js";
import { committedReads } from "../loomwright/run-state-checkout.js";
import { declaredCheckWords, readDeclaredChecks, unrunnableDeclaredChecks } from "./declared-checks.js";
import type { DeclaredChecksRead } from "./declared-checks.js";
import { automateInvocation } from "./tickets-to-items.js";
import { commentUrlOf, fixCommentPrompt, identityOf, isFixCommentKind, readOwnerComment } from "./owner-comment.js";
import type { FixCommentOutcome, FixCommentRef } from "./owner-comment.js";

// The payload key that marks a `message` event as a kernel-started Loomwright run (any kind); it lives in the
// SQL-only leaf `./run-sessions.ts` so the approvals store can name it without importing this module.
import { AUTOMATE_RUN_KEY, laterRunSessionOf, runLaunchOf } from "./run-sessions.js";
export { AUTOMATE_RUN_KEY };

/** The kinds of kernel-started run, closed in code. An `automate_run` payload with no `kind` is a `backlog` run. */
export const AUTOMATE_RUN_KINDS = Object.freeze(["backlog", "review_pr", "merge_parked", "resume"] as const);

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

/**
 * What `kernel_pr_route` queues for a fix: the PR by repo and number and, when the
 * route found the owner's triaged comment (phase 8 item 26a), that comment by kind,
 * id and kernel-built URL. Comment and PR text are never in it: the launch re-reads
 * the comment (`./owner-comment.ts`).
 */
export interface ReviewPrRunPayload extends RunAttribution {
  readonly kind: "review_pr";
  readonly pr: number;
  readonly comment?: FixCommentRef;
}

/** What `kernel_automate_merge_check` queues on `go`: the parked run's id (`isRunId`). No flag: the trust flag is read again at launch. */
export interface MergeParkedRunPayload extends RunAttribution {
  readonly kind: "merge_parked";
  readonly pr: number;
  readonly run_id: string;
}

/**
 * What the owner's Resume queues (phase 8 item 23j): one paused run by its id
 * (`isRunId`), attributed to the crew member, playbook and source session of the
 * kernel run that last drained the checkout (`./resume.ts`). The run continues
 * with `/loomwright:automate --resume <run_id> --inline-phases`, safe mode.
 */
export interface ResumeRunPayload extends RunAttribution {
  readonly kind: "resume";
  readonly run_id: string;
}

/** Any `automate_run` payload. */
export type KernelRunPayload = AutomateRunPayload | ReviewPrRunPayload | MergeParkedRunPayload | ResumeRunPayload;

/** A checked payload: its kind always set, and the event's agent. */
type Run =
  | (Omit<AutomateRunPayload, "kind"> & { readonly kind: "backlog"; readonly agent: string })
  | (ReviewPrRunPayload & { readonly agent: string })
  | (MergeParkedRunPayload & { readonly agent: string })
  | (ResumeRunPayload & { readonly agent: string });

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
  // 25c: reads (`git remote -v` only as the whole command, `EXACT_RUN_PREFIXES`), and the confined forms: `git rm` /
  // `git mv` inside the checkout and its worktrees, `git merge <local-branch> [--no-ff] [-m <msg>]`
  // (`sessions/run-confinement.ts`, checked by the session gate). `git -C <dir>` is no prefix: the policy judges
  // `git -C <dir> <rest>` as `git <rest>` with `<dir>` confined.
  "git ls-tree", "git ls-remote", "git remote -v", "git merge", "git rm", "git mv",
  // gh: reads and the PR / issue work; no release, secret, workflow or repo edit / delete.
  "gh pr", "gh issue", "gh api", "gh repo view", "gh auth status", "gh run view",
  "ls", "cat", "pwd", "date", "mkdir", "test", "wc", "head", "tail", "grep", "sleep", "jq", "od",
  // 25c: file operations, each confined to the checkout and its worktrees with a closed option set.
  "rm", "mv", "chmod",
]);

/**
 * The Claude tools every run policy grants. 25c: `TaskOutput` (the Execute Manager waits on a background worker)
 * and `Monitor`, admitted only as a shell watch whose `command` is decided as a Bash call (`ws`, an outward
 * WebSocket, is refused). `SendMessage` is not granted (`RUN_TOOL_DENIALS_OBSERVED`, `run-exclusions.ts`).
 */
const RUN_TOOLS: readonly string[] = Object.freeze(["Skill", "Read", "Write", "Edit", "Glob", "Grep", "Bash", "Agent", "AskUserQuestion", "TaskOutput", "Monitor"]);

/**
 * The Loomwright driver and helper scripts the `/automate` run calls, by basename
 * under the active install's `scripts/` (phase 8 item 22g, AC15). Derived from the
 * 17.38.0 install with `grep -ohE 'scripts/[A-Za-z0-9_.-]+\.sh'` over
 * `commands/automate.md`, `skills/automate-loop/` and `scripts/automate-next-step.sh`,
 * leaving out `test-*.sh`, the Loomwright-repo-only scripts (`bump-version.sh`,
 * `release-refold.sh`, `check-doc-currency.sh`, `build-capabilities.sh`) and the
 * host project's `ci-local.sh`; plus `review-heal-next-step.sh`, which the run's
 * review-heal drain calls. Also left out, because each acts past the kernel when
 * the session calls it directly and safe mode (inline phases, no lanes)
 * never needs it: `automate-lanes.sh` (`lane-launch` starts headless `claude -p`
 * lanes, invariant 2; 25c admits its read-only `scope-outside` alone, to the inline
 * phases only, `INLINE_PHASE_SCRIPTS`), `automate-wave.sh` (`wave-build` pushes and opens a PR
 * past the approval gate), `automate-merge-watch.sh` (a detached
 * watcher whose close-out pushes a trail PR and posts a webhook; the driver arms
 * it itself) and `lane-sampler.sh` (a `--parallel` lane sampler that posts a
 * webhook). An admitted script's own merging, pushing or spawning subcommands are
 * refused too (`LOOMWRIGHT_DENIED_SUBCOMMANDS`, `sessions/loomwright-scripts.ts`).
 * A script the run calls by another path, or that is not listed, stays denied (a
 * live-run finding, never a wider grant).
 */
const AUTOMATE_SCRIPTS: readonly string[] = Object.freeze([
  "automate-dismissed.sh", "automate-helpers.sh", "automate-next-step.sh", "classify-risk.sh", "fix-floor.sh",
  "guard-lane-wait-armed.sh", "lane-policy.sh", "meta-sync.sh", "progress-line-match.sh", "read-token-ledger.sh",
  "resolve-base-branch.sh", "review-heal-next-step.sh", "rules-gate-verdict.sh", "run-lock.sh",
]);

/**
 * The scripts the inline phases call (phase 8 item 23k, owner-approved 2026-11-17).
 * Under `--inline-phases` the run executes `/autonomous --single-iteration`, which
 * runs `/launch-pad` and `/supervisor` in the same session; the first live resume
 * was denied `supervisor-next-step.sh` and `launch-pad-phase.sh`. Derived from the
 * 17.38.0 install with the same grep over `commands/{autonomous,launch-pad,supervisor}.md`,
 * `agents/{supervisor,launch-pad,execute-manager,worker,context-keeper,code-reviewer,plan-reviewer,orchestrator,rubric-grader}.md`,
 * `skills/{autonomous-loop,async-orchestration,supervisor-readiness,state-management,workflow-management,supervisor-config,qa-gates}/`,
 * `scripts/supervisor-next-step.sh` and `scripts/launch-pad-phase.sh` (44 names
 * beyond `AUTOMATE_SCRIPTS`), each read one by one. Admitted: local bookkeeping
 * under `.supervisor/`, readers, local checks, and the Supervisor driver, which
 * only checks out branches locally and hands `git push` / `gh pr create` back to
 * the session, where the rail and the approval gate see them. Left out, each for
 * its reason (a kernel-owned path for each is 23m):
 * - start a `claude` process the kernel does not own (invariant 2):
 *   `dispatch-pr-review.sh`, `hook-dispatch-on-pr-create.sh`, and every `automate-lanes.sh`
 *   subcommand but `scope-outside` (`lane-launch`, `phase-launch`; the allow-only
 *   `LOOMWRIGHT_ALLOWED_SUBCOMMANDS` admits `scope-outside` alone, 25c);
 * - post outward past the approval gate (invariant 3): `send-webhook.sh`;
 * - run shell command lines read from files the session can write (the brief, the
 *   rules), which the per-command rail never sees (invariant 3): `run-ground-truth.sh`
 *   (`bash -c` of the brief's lines), `rules-check.sh` and `worker-rule-selfcheck.sh`
 *   (`bash -c` of each rule's check);
 * - run project code (25d's class, not admitted here): `run-pin-mutations.sh` runs the
 *   pinned test files (`bash "$1"`), no `eval` or `bash -c` (corrected in 25c);
 * - not needed by any step a kernel run takes: `run-benchmark.sh`, which runs no `claude`
 *   and no file-borne command line (18.1.2 validates a fixed corpus with `jq`; corrected
 *   in 25c), and only feeds an advisory `benchmark_result`;
 * - persistent memory and contract writes Loomwright keeps for a human-approved
 *   fact (invariant 3): `write-project-memory.sh`, `write-agent-memory.sh`, `write-system-contract.sh`;
 * - a hook the harness fires, never the session: `reproject-state-on-terminal.sh`;
 * - repo-only, or not in the install: `bump-version.sh`, `check-doc-currency.sh`, `ci-local.sh`, `validate-version.sh`.
 * `release-refold.sh` was left out here until 23q on the belief that the driver runs it; it does not: FINALIZE
 * tells the session to run it before any push (seen live in session 224, `release_refold_refused`). It is admitted
 * now, and the session gate refuses it while the project has a `scripts/bump-version.sh` for it to run
 * (`loomwright/release-refold-gate.ts`).
 * A session's own `--skip-children-check` or `--skip-preflight-sync` is refused
 * (`LOOMWRIGHT_DENIED_SUBCOMMANDS`): those are the owner's flags, never the run's.
 *
 * 25c (read from 18.1.2, 2026-11-22) adds four the inline Launch Pad and Supervisor call,
 * for the backlog and resume kinds only (they run those phases; `review_pr` and the merge
 * kinds do not):
 * - `gate-auto.sh` `decide|record|list` only (`LOOMWRIGHT_ALLOWED_SUBCOMMANDS`): it starts
 *   no `claude`; it answers a lane-catalog `auto` gate from fixed reads and records the
 *   answer through `automate-helpers.sh progress-append` (live: LP-SAVE answered by the
 *   model instead, event 37984);
 * - `phase45-ci-read.sh`: one read of a PR's required checks (gh reads, no write);
 * - `reconcile-jobs.sh`: moves a stranded brief within `.supervisor/jobs/` (in-progress to
 *   done or failed) and reads `.supervisor/automate/` run files; it writes nothing under
 *   `.supervisor/automate/`, never stamps a requirement, pushes nothing and starts no
 *   `claude` (its base-branch lookup is `resolve-base-branch.sh`, already admitted);
 * - `automate-lanes.sh` `scope-outside` only (`LOOMWRIGHT_ALLOWED_SUBCOMMANDS`): Launch Pad's
 *   LP-SCOPE read of a brief's paths outside the item's Touches.
 */
const INLINE_PHASE_SCRIPTS: readonly string[] = Object.freeze([
  "supervisor-next-step.sh", "launch-pad-phase.sh",
  // 25c: allow-only subcommands for the first and last (`LOOMWRIGHT_ALLOWED_SUBCOMMANDS`).
  "gate-auto.sh", "phase45-ci-read.sh", "reconcile-jobs.sh", "automate-lanes.sh",
  "build-state.sh", "emit-progress-event.sh", "check-children-settled.sh", "guard-finalize-publish.sh",
  "reconcile-resume-state.sh", "heal-review-scope.sh", "checkpoint.sh", "worktree-audit.sh", "worktree-salvage.sh",
  // 23q: FINALIZE runs it before any push; the session gate admits it only while the project has no bump script.
  "release-refold.sh",
  "verify-provides.sh", "exec-acceptance-hash.sh", "module-shape-facts.sh",
  "read-lessons.sh", "read-orientation.sh", "read-postmortem.sh", "read-project-memory.sh", "read-rules.sh", "read-system-contract.sh",
  "twin-graph.sh", "build-repo-map.sh", "build-context-digest.sh", "build-insights.sh",
]);

/** A `/automate --inline-phases` run's scripts: the engine's and its inline phases' (23k). */
const AUTOMATE_RUN_SCRIPTS: readonly string[] = Object.freeze([...AUTOMATE_SCRIPTS, ...INLINE_PHASE_SCRIPTS]);

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
  // Safe mode (D44): the driver never takes `--merge-parked`, the trust flag or a mode but `safe` (`LOOMWRIGHT_DRIVER_ARGUMENTS`).
  loomwrightDriverProfile: "automate_run",
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
 * `automate-helpers.sh`'s merging, pushing and spawning subcommands are refused
 * here as in every run policy (`LOOMWRIGHT_DENIED_SUBCOMMANDS`).
 */
const REVIEW_PR_RUN_SCRIPTS: readonly string[] = Object.freeze([
  "automate-helpers.sh", "ci-run-probe.sh", "classify-bot-review.sh", "drain-gh-read.sh", "drain-rounds.sh",
  "drain-subfloor-decision.sh", "fix-floor.sh", "guard-arm.sh", "notify-desktop.sh", "pr-postmortem-gather.sh",
  "review-heal-next-step.sh", "rules-gate-verdict.sh", "wait-for-checks.sh", "wrap-external-text.sh",
  // 23q: the drain runs it before each push; the session gate admits it only while the project has no bump script.
  "release-refold.sh",
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
 * (AC15). `AUTOMATE_SCRIPTS` (the same command file, skill and driver, and the
 * same exclusions) without `review-heal-next-step.sh` (a merge runs no drain) and
 * without the inline phases' scripts (a merge runs no phase). The
 * merge itself is Loomwright's `gate-eval` inside the driver; the session's own
 * `automate-helpers.sh gate-eval` is refused (`LOOMWRIGHT_DENIED_SUBCOMMANDS`).
 */
const MERGE_PARKED_RUN_SCRIPTS: readonly string[] = Object.freeze(
  AUTOMATE_SCRIPTS.filter((name) => name !== "review-heal-next-step.sh"),
);

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
  // The driver's `--merge-parked` entry only: no `--start` / `--resume`, no mode, no trust flag (`LOOMWRIGHT_DRIVER_ARGUMENTS`).
  loomwrightDriverProfile: "merge_parked",
});

/**
 * `MERGE_PARKED_RUN_POLICY` for a repo whose owner recorded the trust-unprotected
 * choice: the same, except the driver may take the trust flag, which the skill
 * passes on as the command received it. The launch picks it only when the
 * prompt it builds carries the flag (`loomwrightMergeFlags`, read at launch), so
 * a session can never add the flag the owner did not record (AC2).
 */
export const MERGE_PARKED_TRUSTED_RUN_POLICY: ToolPolicy = Object.freeze({
  ...MERGE_PARKED_RUN_POLICY,
  loomwrightDriverProfile: "merge_parked_trust_unprotected",
});

/** Each kind's run policy. */
const RUN_POLICIES: Readonly<Record<AutomateRunKind, ToolPolicy>> = Object.freeze({
  backlog: AUTOMATE_RUN_POLICY,
  review_pr: REVIEW_PR_RUN_POLICY,
  merge_parked: MERGE_PARKED_RUN_POLICY,
  // The same `/automate` command, scripts and safe-mode driver profile as a backlog run: only the entry differs.
  resume: AUTOMATE_RUN_POLICY,
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

/**
 * 23o: a continuation of a run session, queued when the owner decides an
 * approval that session asked for (`approvals/store.ts`): the payload is the
 * session's own launch with `kind: "continue"`, `of` (the kind it was launched
 * as, whose policy it keeps), `session` (the run session to continue) and
 * `prompt` (the kernel's decision text). It starts that session's SDK
 * conversation again (`StartSessionParams.continueFrom`), so the Supervisor
 * carries on from the held step instead of the item restarting.
 */
interface Continuation {
  readonly session: number;
  readonly prompt: string;
}

/** The longest decision text a continuation carries (the kernel writes it; a longer one is refused, never cut). */
const CONTINUE_PROMPT_MAX = 8000;

/**
 * What became of a `review_pr` run's named comment at launch (26a): the comment, the
 * outcome of the launch's own read (`carried`, `comment_gone`, `comment_not_owner` or
 * `comment_unreadable`) and, when the body was over the bound, how many characters were cut.
 */
export interface LaunchCommentRecord extends FixCommentRef {
  readonly outcome: FixCommentOutcome;
  readonly cut_chars?: number;
}

/** What the `automate-run` step stores: the run session's id, or no session and why. */
export type AutomateRunResult =
  /** `released_lock_of`: the ended kernel session whose run lock the launch released first (D46). `comment`: a `review_pr` run's named comment (26a). */
  | { readonly session_id: number; readonly released_lock_of?: number; readonly comment?: LaunchCommentRecord }
  | { readonly session_id: null; readonly skipped: string };

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
  // A resume names the run, never a PR.
  if (kind === "resume") {
    if (!isRunId(r.run_id)) throw bad("run_id, a Loomwright run id");
    return { kind, ...common, run_id: r.run_id };
  }
  if (!isPositiveId(r.pr)) throw bad("pr, a positive integer");
  if (kind === "review_pr") {
    if (r.comment === undefined) return { kind, ...common, pr: r.pr };
    return { kind, ...common, pr: r.pr, comment: commentRefOf(r.comment, r.repo, r.pr, bad) };
  }
  if (!isRunId(r.run_id)) throw bad("run_id, a Loomwright run id");
  return { kind: "merge_parked", ...common, pr: r.pr, run_id: r.run_id };
}

/**
 * A `review_pr` payload's `comment`, checked: exactly `kind` (one of the comment
 * kinds), `id` (a positive integer) and `url` (the URL the kernel builds from the
 * repo, number, kind and id). Anything else, a body among them, is malformed.
 */
function commentRefOf(raw: unknown, repo: string, pr: number, bad: (what: string) => TypeError): FixCommentRef {
  const what = "comment, absent or exactly {kind, id, url} naming a comment on the pull request";
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw bad(what);
  const c = raw as Record<string, unknown>;
  if (Object.keys(c).some((k) => k !== "kind" && k !== "id" && k !== "url")) throw bad(what);
  if (!isFixCommentKind(c.kind) || !isPositiveId(c.id)) throw bad(what);
  if (c.url !== commentUrlOf(pullUrlOf(repo, pr), c.kind, c.id)) throw bad(what);
  return { kind: c.kind, id: c.id, url: c.url };
}

/** The prompt a `resume` run starts with: `/loomwright:automate --resume <run_id> --inline-phases`, and nothing else (safe mode). */
export function resumeRunPrompt(runId: string): string {
  return [AUTOMATE_RUN_COMMAND, "--resume", runId, "--inline-phases"].join(" ");
}

/** The prompt the run starts with: `/loomwright:automate --backlog <path> --inline-phases`. Throws `RangeError` for a path that cannot be quoted. */
export function automateRunPrompt(backlog: string): string {
  return automateInvocation(backlog).replace(/^\/automate /, `${AUTOMATE_RUN_COMMAND} `);
}

/** The id of a non-terminal session this handler started (an `automate-run` step's stored `session_id`) for `agent` in `checkout`, if any. */
function liveRunSession(store: EventContext["store"], sessions: EventSessions, agent: string, checkout: string, except?: number): number | undefined {
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
    if (!isPositiveId(id) || id === except) continue;
    const row = sessions.getSession(id);
    if (row === undefined || row.agent !== agent || row.cwd === null || resolvedPath(row.cwd) !== want) continue;
    if (!isTerminalStatus(row.status)) return id;
  }
  return undefined;
}

/**
 * The kind's kernel-built prompt and its run policy, or why there is none. A
 * merge's policy follows the flags its prompt carries, read once here: the
 * trust flag in the prompt ⇔ `MERGE_PARKED_TRUSTED_RUN_POLICY`. Only checked fields go in:
 * the backlog path (inside the checkout), the repo and number, the run id, and the
 * repo's merge flags read from the store now (`loomwrightMergeFlags`), never from
 * the payload. Comment, PR and ticket text are in none of them (invariant 3): a
 * fix's owner comment is added after this, from the launch's own read, wrapped as
 * data (`startRun`, 26a).
 */
function promptOf(store: EventContext["store"], run: Run, checkout: string): { readonly prompt: string; readonly policy: ToolPolicy } | { readonly skipped: string } {
  switch (run.kind) {
    case "backlog":
      if (!resolve(run.backlog).startsWith(`${checkout}${sep}`)) return { skipped: "backlog_outside_checkout" };
      try {
        return { prompt: automateRunPrompt(run.backlog), policy: RUN_POLICIES.backlog };
      } catch (err) {
        return { skipped: messageOf(err) };
      }
    case "review_pr":
      return { prompt: reviewPrRunPrompt(run.repo, run.pr), policy: RUN_POLICIES.review_pr };
    case "resume":
      return { prompt: resumeRunPrompt(run.run_id), policy: RUN_POLICIES.resume };
    case "merge_parked": {
      const flags = loomwrightMergeFlags(store, run.repo);
      const base = flags.includes(TRUST_UNPROTECTED_FLAG) ? MERGE_PARKED_TRUSTED_RUN_POLICY : RUN_POLICIES.merge_parked;
      // Pinned to the checked run id: the session's driver calls may name no other run (`ToolPolicy.loomwrightRunId`).
      return { prompt: mergeParkedRunPrompt(run.run_id, flags), policy: Object.freeze({ ...base, loomwrightRunId: run.run_id }) };
    }
  }
}

/**
 * Why a live playbook may not launch a run now, or `undefined`: turned off
 * (`disabled`), or a `draft` at a newer version than the session the launch
 * came from, which is a change waiting for the owner's review (any change
 * makes the playbook a draft until its version is enabled again, and a
 * playbook's own runs skip it then, `playbooks/runs.ts`). A draft at the same
 * version is how a playbook the owner's ask starts runs (the phase 8 exit
 * flow), and is not refused. Seen live 2026-11-17: the owner raised playbook
 * 18's limit, version 3 became a draft, and a Resume queued from version 2's
 * run waited behind it. Pure.
 */
export function pausedPlaybook(pb: { readonly status: string; readonly version: number }, fromVersion: number | null | undefined): string | undefined {
  if (pb.status === "disabled") return "turned off";
  if (pb.status === "draft" && typeof fromVersion === "number" && pb.version > fromVersion) return `a draft at version ${pb.version} waiting for review`;
  return undefined;
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
async function startRun(ctx: EventContext, run: Run, continuation?: Continuation): Promise<AutomateRunResult> {
  const { store } = ctx;
  const skip = (why: string): AutomateRunResult => ({ session_id: null, skipped: why });
  const sessions = ctx.sessions;
  if (sessions === undefined) return skip("no_session_manager");

  // The playbook is still live and the crew member still on: either may have changed since the event was queued.
  const pb = store.prepare<[number], { mode: string; status: string; version: number }>("SELECT mode, status, version FROM playbooks WHERE id = ?").get(run.playbook);
  if (pb === undefined) return skip("playbook_gone");
  if (pb.mode !== "live") return skip(`playbook_not_live: playbook ${run.playbook} is in ${pb.mode} mode`);
  if (getAgent(store, run.agent)?.status !== "active") return skip(`agent_not_active: ${run.agent}`);

  // The calling session: its row names the model (the playbook version's), the playbook version and the task.
  const caller = sessions.getSession(run.source_session);
  if (caller === undefined) return skip("source_session_gone");
  if (caller.agent !== run.agent || caller.playbook !== run.playbook) return skip("source_session_mismatch");
  if (caller.model === null || caller.model === "") return skip("model_unset: the calling session has no model");
  // Not turned off, and not a change waiting for the owner's review (`pausedPlaybook`).
  const paused = pausedPlaybook(pb, caller.playbook_version);
  if (paused !== undefined) return skip(`playbook_not_enabled: playbook ${run.playbook} is ${paused}`);

  const read = readAgentSettings(store.dataDir, run.agent);
  if (!read.ok) return skip(`${read.error}: ${read.message}`);
  const settings = read.settings;

  // The checkout is one of the crew member's workspaces (and a backlog run's backlog is inside it).
  const checkout = resolve(run.checkout);
  if (!(settings.workspaces ?? []).some((w) => resolve(w) === checkout)) return skip(`workspace_not_listed: ${run.checkout}`);
  const built = promptOf(store, run, checkout);
  if ("skipped" in built) return skip(built.skipped);
  const { policy: runPolicy } = built;
  // A continuation keeps its launch kind's policy (and a merge's run-id pin) and says only the owner's decision: its
  // prompt is set below, with a fix's comment (26a), just before the start.

  // 23o: the session to continue is this crew member's, in this checkout, and has ended (a live one can repeat the
  // held call itself: a `once` grant matches its next identical call). One the kernel's own restart ended is
  // `interrupted`, its group confirmed dead: `continueFrom` does not take it, so it is resumed in place instead
  // (the manager's resume, as the brain resumes an interrupted crew session). An `orphaned` one, or an `abandoned` one
  // (the owner released an orphaned row the kernel could not verify), may still be running, so nothing continues it
  // (PR #291 reviews). "Ended" is the manager's own list (`isContinuableStatus`), so the two cannot disagree.
  let resumeInterrupted = false;
  // The session resumed in place, as a version and model pair: a resume keeps its session's model, so the version it
  // records is paired with that session, not with the run's source session (unchanged along a continuation chain).
  let resumed: { readonly playbook_version?: number | null; readonly model?: string | null } | undefined;
  if (continuation !== undefined) {
    const earlier = sessions.getSession(continuation.session);
    if (earlier === undefined) return skip(`continue_session_gone: session ${continuation.session}`);
    if (earlier.agent !== run.agent || earlier.cwd === null || earlier.cwd === undefined || resolvedPath(earlier.cwd) !== resolvedPath(checkout)) {
      return skip(`continue_session_mismatch: session ${continuation.session}`);
    }
    if (earlier.status === "orphaned" || earlier.status === "abandoned") {
      return skip(`continue_session_${earlier.status}: session ${continuation.session} may still be running; the kernel settles it before anything continues it`);
    }
    resumeInterrupted = earlier.status === "interrupted";
    if (resumeInterrupted) resumed = { playbook_version: earlier.playbook_version, model: earlier.model };
    if (!resumeInterrupted && !isContinuableStatus(earlier.status)) return skip(`continue_session_live: session ${continuation.session} can repeat the call itself`);
    // 23s gap 3: a later run session of the same run (a later Resume, or a continuation already carrying it) means the
    // run moved on; continuing this one again would fork it from a stale point (live: approval 56 of session 226).
    const launch = runLaunchOf(store, continuation.session);
    const later = launch === undefined ? undefined : laterRunSessionOf(store, continuation.session, launch);
    if (later !== undefined) return skip(`continue_session_superseded: session ${continuation.session}'s run went on in session ${later}`);
  }

  // D46 (23n): a run lock whose holder is dead. The kernel's own (a run session of ours that has ended) is released
  // here with Loomwright's `run-lock.sh` (host mode's SessionEnd close-out never releases it); any other is left to
  // Loomwright's reclaim age, and no run starts before it, since Loomwright would only park it `run_lock_held`.
  const dead = deadLockOf(store, checkout);
  let releasedLockOf: number | undefined;
  if (dead.kind === "kernel") {
    if (!releaseKernelLock(checkout, dead)) return skip(`lock_release_failed: session ${dead.session}'s run lock`);
    releasedLockOf = dead.session;
  } else if (dead.kind === "foreign" && (dead.reclaimAt === null || Date.now() / 1000 < dead.reclaimAt)) {
    return skip(`lock_settling: ${dead.reclaimAt === null ? "the lock's age cannot be read" : `Loomwright reclaims it at ${new Date(dead.reclaimAt * 1000).toISOString()}`}`);
  }

  // Single drain: Loomwright's run state is the authority, and an unreadable one reads as live.
  const state = readRunState(checkout);
  if (!state.ok) return skip(`run_state_unreadable: ${state.reason}`);
  if (continuation !== undefined) {
    // The run file still reads `running` (the session ended its turn mid-item, holding the approval): that is this
    // run, not a second drain. Another live kernel run session for the checkout still blocks it (below).
  } else if (run.kind === "resume") {
    // 23j: a resume continues exactly the run the owner chose, paused or stranded (23l); one that has since
    // finished or gone, or that a live lock holder is running, is not resumed. Its own stranded `running` status
    // is not a second drain; a held lock or another `running` run file is.
    if (!pausedRuns(state).some((p) => p.run_id === run.run_id)) return skip(`run_not_paused: ${run.run_id}`);
    if (resumeWouldDoubleDrain(state, run.run_id)) {
      const other = state.runs.find((r) => r.status === "running" && r.run_id !== run.run_id);
      return skip(`run_live: ${state.lock.held ? "run lock held" : (other?.run_id ?? "run lock held")}`);
    }
  } else {
    const summary = summarizeRuns(state);
    if (summary.state === "live") return skip(`run_live: ${summary.run_id ?? "run lock held"}`);
  }

  // Loomwright writes its lock after the session starts, so the run state lags: also refuse while a run session
  // this handler started for the same crew member and checkout is still live. The `automate-run` steps are the
  // record of those sessions (the sessions table keeps no prompt), and a session that has ended no longer blocks.
  // The interrupted session being resumed is not another live run: its group is confirmed dead.
  const live = liveRunSession(store, sessions, run.agent, checkout, resumeInterrupted ? continuation?.session : undefined);
  if (live !== undefined) return skip(`run_session_live: session ${live}`);

  // 26a: a fix naming the owner's comment re-reads it now through the loop's client (it may have been edited or
  // deleted since the route) and re-checks its author; only the owner's own is carried, as data, into the prompt.
  // Any other outcome launches the plain command. A continuation keeps its own prompt and reads nothing.
  let prompt = continuation?.prompt ?? built.prompt;
  let comment: LaunchCommentRecord | undefined;
  if (run.kind === "review_pr" && run.comment !== undefined && continuation === undefined) {
    const ref = run.comment;
    const read = await readOwnerComment(ctx.github, identityOf(store), { repo: run.repo, pr: run.pr, kind: ref.kind, id: ref.id }, "comment_gone");
    if (read.outcome === "carried") {
      const carried = fixCommentPrompt(built.prompt, { url: ref.url, body: read.comment.body });
      prompt = carried.prompt;
      comment = { ...ref, outcome: "carried", ...(carried.cut_chars > 0 ? { cut_chars: carried.cut_chars } : {}) };
    } else {
      comment = { ...ref, outcome: read.outcome };
    }
  }

  // 23t: the repo's required checks, which the session's down-scoped token can't read from branch protection, handed to
  // the run's drain through the checkout's own Loomwright config (`required-checks.ts`, which records the outcome). It
  // runs before admission: a launch refused below leaves the current detected list, which the next launch writes anyway
  // (23u: the kernel's own list follows the detection, so it is never left stale).
  handRequiredChecks(store, run.repo, checkout);

  // 25d: the checks the repo declares on its base branch, read now from the base commit (a continuation re-reads them),
  // for the kinds whose sessions run project work; a merge run gets none, so its policy and prompt are as before.
  const declared = DECLARED_CHECK_KINDS.includes(run.kind) ? readDeclaredChecks(defaultBranchOf(store, run.repo), committedReads(checkout)) : undefined;

  // The session is the step's last effectful call, so an admission refusal leaves nothing to repeat; the
  // `run_declared_checks` event follows it and cannot fail the step (`recordDeclaredChecks`). The manager's
  // Loomwright refusal (no install, or no readable `scripts/`) wrote no row, so it is stored, never retried as is.
  let handle: SessionHandle;
  const policy = {
    ...runPolicy,
    ...(settings.never !== undefined ? { never: settings.never } : {}),
    ...(declared === undefined ? {} : { declaredChecks: declaredCheckWords(declared), ...(declared.base_sha === null ? {} : { declaredChecksBase: declared.base_sha }) }),
  };
  // An enabled playbook's run runs under the version the owner enabled, not the one the run was first prepared under: a
  // resume or continuation carried the source session's version forward, so after the owner re-enabled playbook 18 at
  // v3 its run sessions were still v2, and "always" on their held calls was refused as not the current version (live:
  // approval 62, 2026-11-18). A draft keeps the source session's version (`pausedPlaybook` already refused a newer one).
  // The version and its model are one pair (23u): a newer version runs on its own snapshot's model, as a playbook run
  // does. With no readable snapshot model, the source session's pair is kept. A resume in place can't change its
  // session's model, so it keeps the resumed session's own pair, not the source session's (review of PR #294: asked
  // under v1, continued on v2, interrupted, resumed after v3: it recorded v1), unless the newer version's model is its own.
  const { version, model } = runVersionOf(store, run.playbook, pb, caller, resumed);
  const playbookVersion = version === null || version === undefined ? {} : { playbookVersion: version };
  try {
    handle = resumeInterrupted && continuation !== undefined
      ? await sessions.resumeSession(continuation.session, { prompt, permissionMode: settings.permissionMode, cwd: checkout, policy, playbook: run.playbook, ...playbookVersion })
      : await sessions.startSession({
      agent: run.agent,
      prompt,
      model,
      permissionMode: settings.permissionMode,
      cwd: checkout,
      policy,
      playbook: run.playbook,
      ...playbookVersion,
      ...(caller.task_id === null || caller.task_id === undefined ? {} : { task: caller.task_id }),
      ...(continuation === undefined ? {} : { continueFrom: continuation.session }),
    });
  } catch (err) {
    if (isLoomwrightRefusal(err)) return skip(`loomwright_unresolved: ${err.code}: ${err.message}`);
    // The manager re-checks a continuation's session (a status the gate above passed can still be refused, e.g. a
    // `stopped` row whose kill was never confirmed): its refusal is the answer, stored, never a failed event.
    if (continuation !== undefined && err instanceof SessionError && err.code === "not_resumable") return skip(`continue_session_refused: ${err.message}`);
    throw err;
  }
  // 27a: the run session inherits the kernel's env (the manager sets no PATH of its own), so the kernel's PATH is the run's.
  if (declared !== undefined) recordDeclaredChecks(store, handle.id, caller.task_id ?? null, run, checkout, declared, process.env.PATH);
  return { session_id: handle.id, ...(releasedLockOf === undefined ? {} : { released_lock_of: releasedLockOf }), ...(comment === undefined ? {} : { comment }) };
}

/** The run kinds whose policy carries the repo's declared checks (25d): never a merge. */
const DECLARED_CHECK_KINDS: readonly AutomateRunKind[] = Object.freeze(["backlog", "resume", "review_pr"]);

/** The stored repo policy's detected default branch (`getRepoPolicy`), or `null` when none is recorded. */
function defaultBranchOf(store: Store, repo: string): string | null {
  const branch = getRepoPolicy(store, repo).detected?.["default_branch"];
  return typeof branch === "string" && branch !== "" ? branch : null;
}

/** The most admitted checks, skipped lines and unrunnable checks one `run_declared_checks` event lists (the counts are always whole). */
const MAX_EVENT_DECLARATIONS = 100;

/**
 * Appends the run session's ONE `run_declared_checks` event (25d): the repo, the checkout, the base ref and commit
 * (or `null` and the reason), the admitted checks (command text and source) and the skipped lines (text, source and
 * reason), and the admitted checks whose executable `runPath` cannot find (command, executable and the owner's line,
 * 27a). It never throws: the session has started, so a failed append is swallowed and the step still stores the
 * session's id.
 */
function recordDeclaredChecks(store: Store, sessionId: number, taskId: number | null, run: Run, checkout: string, read: DeclaredChecksRead, runPath: string | undefined): void {
  try {
    const unrunnable = unrunnableDeclaredChecks(read, runPath);
    appendEvent(
      store,
      "run_declared_checks",
      { sessionId, taskId },
      {
        repo: run.repo,
        checkout,
        kind: run.kind,
        base_ref: read.base_ref,
        base_sha: read.base_sha,
        ...(read.reason === undefined ? {} : { reason: read.reason }),
        admitted: read.admitted.slice(0, MAX_EVENT_DECLARATIONS).map((c) => ({ command: c.command, source: c.source })),
        admitted_count: read.admitted.length,
        skipped: read.skipped.slice(0, MAX_EVENT_DECLARATIONS).map((s) => ({ text: s.text, source: s.source, reason: s.reason })),
        skipped_count: read.skipped.length,
        unrunnable: unrunnable.slice(0, MAX_EVENT_DECLARATIONS).map((u) => ({ command: u.command, executable: u.executable, line: u.line })),
        unrunnable_count: unrunnable.length,
      },
      new Date().toISOString(),
    );
  } catch {
    // The session runs either way; the audit row is what is lost (fail open on the record, never on the grant).
  }
}

/**
 * The playbook version a run session records and the model it runs on, chosen together (see the call site). The base
 * pair is the session resumed in place, when there is one, else the source session (`caller`).
 */
function runVersionOf(
  store: Store,
  playbook: number,
  pb: { readonly status: string; readonly version: number },
  caller: { readonly playbook_version?: number | null; readonly model?: string | null },
  resumed: { readonly playbook_version?: number | null; readonly model?: string | null } | undefined,
): { version: number | null | undefined; model: string } {
  const base = resumed ?? caller;
  const kept = { version: base.playbook_version, model: base.model as string };
  if (pb.status !== "enabled") return kept;
  if (pb.version === base.playbook_version) return { ...kept, version: pb.version };
  const model = versionModelOf(store, playbook, pb.version);
  // A resume in place runs on its session's own model: the newer version only when that model is the version's.
  if (resumed !== undefined) return model !== undefined && model === kept.model ? { version: pb.version, model } : kept;
  // A source session that records no version: the enabled one, on its model when the snapshot names one.
  if (base.playbook_version === null || base.playbook_version === undefined) return { version: pb.version, model: model ?? kept.model };
  if (model === undefined) return kept;
  return { version: pb.version, model };
}

/**
 * The brain's route for a `message` event whose payload carries `automate_run`:
 * start the kind's run session once for the event (see the module comment).
 * Resolves when the step is stored; it never awaits the session itself.
 */
export async function handleAutomateRun(ctx: EventContext): Promise<void> {
  const { run, continuation } = launchOf(ctx.event.id, ctx.event.payload);
  await ctx.runStepAsync("automate-run", () => startRun(ctx, run, continuation));
}

/** The event's run, and for a `continue` payload (23o) the session to continue and its prompt; the run is the launch's own kind (`of`). */
function launchOf(eventId: number, payload: Readonly<Record<string, unknown>>): { run: Run; continuation?: Continuation } {
  const raw = payload[AUTOMATE_RUN_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || (raw as Record<string, unknown>).kind !== "continue") {
    return { run: automateRunOf(eventId, payload) };
  }
  const r = raw as Record<string, unknown>;
  const bad = (what: string): TypeError => new TypeError(`event ${eventId}: a run continuation needs ${what}`);
  if (!isPositiveId(r.session)) throw bad("session, a positive integer");
  if (typeof r.prompt !== "string" || r.prompt === "" || r.prompt.length > CONTINUE_PROMPT_MAX) throw bad(`prompt, a string of 1 to ${CONTINUE_PROMPT_MAX} characters`);
  if (typeof r.of !== "string" || !(AUTOMATE_RUN_KINDS as readonly string[]).includes(r.of)) throw bad(`of, one of ${AUTOMATE_RUN_KINDS.join(", ")}`);
  return { run: automateRunOf(eventId, { ...payload, [AUTOMATE_RUN_KEY]: { ...r, kind: r.of } }), continuation: { session: r.session, prompt: r.prompt } };
}
