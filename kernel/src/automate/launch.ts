// The `automate` feature's launch (phase 8 item 20b, D44, which supersedes D43's
// "the playbook's own run session runs `/automate`; no kernel tool or approval
// starts a session"): the KERNEL starts Loomwright's `/automate` run for a live
// ticket playbook's crew member, as an ordinary kernel-owned SDK session.
//
// The path, end to end:
//   1. the crew session calls `kernel_automate_prepare` (`./runner.ts`), which
//      writes the ticket items and `_BACKLOG.md` and queues ONE `message` event
//      whose payload is `{agent, automate_run: AutomateRunPayload}`. Nothing from
//      a ticket is in it;
//   2. the brain's `message` handler routes a payload with `automate_run` here
//      (`handleAutomateRun`), beside its `playbook` route (a plain message never
//      carries the key);
//   3. the handler starts the run through the session manager the loop gave it
//      (`EventContext.sessions`, never imported): prompt
//      `/loomwright:automate --backlog <path> --inline-phases` (safe mode: no
//      `--auto-merge`, no `--parallel`), cwd the crew member's checkout, agent
//      the crew member, playbook, version and task the calling session's, model
//      the calling session's (the playbook version's model: invariant 1, never
//      the crew member's settings model), and `AUTOMATE_RUN_POLICY` with the crew
//      member's own `never` list. The session is therefore one of the playbook's:
//      Stop and Kill, the budget and the cap, the rail and the approval gate all
//      apply (invariants 2 and 3), and its events and tokens count against the
//      crew member and the playbook.
//
// `AUTOMATE_RUN_POLICY` is a frozen kernel constant. It is never read from, or
// written into, a charter or a settings file, and the crew member's own policy
// holds none of it (the crew session has no `Skill` and no shell grant). It
// grants what `/automate --inline-phases` needs to ask for, as subcommand
// prefixes (never bare `git` or `gh`: `git config core.fsmonitor`, `git -c`,
// `gh release`, `gh secret`, `gh workflow` and `gh repo edit` would run or write
// past the rail in a session that reads untrusted ticket text). It changes
// neither the rail nor the gate: a push is held, a merge denied, the crew
// member's `never` boundary applies. What it DOES allow is exactly its list. Three
// exposures remain, all for the rail and not for this policy: `gh api` is
// matched on the prefix, so `gh api -X POST ...` is allowed and the rail does not
// hold it; `gh pr ready|reopen|update-branch|lock` and `gh issue` writes are
// not in the rail's outward set; and a listed git subcommand still has forms that
// run a program or write a file the rail does not read (`git fetch --upload-pack=<cmd>`,
// `git diff --output=<path>`, hooks on `git commit` / `git checkout`). `git fetch`
// stays listed because Loomwright's Supervisor ACQUIRE runs `git fetch origin <base>`.
// The rail would have to read arguments (follow-up). See the open points in
// `docs/architecture/automate.md`. The rail still denies any Bash command with a
// shell metacharacter, which a real run may hit (also an open point there).
//
// Single drain (invariant 4): the handler starts nothing while Loomwright's run
// state reads live or cannot be read, or while a run session it started for the
// same crew member and checkout has not ended (Loomwright's lock lags the start), and stores why. It is idempotent: ONE work
// step, so a redelivery returns the stored result and starts no second session.
//
// This module starts no process, calls no GitHub endpoint and merges nothing:
// the only effect is one start call on the session manager the loop passes in. The `studio` CLI loads it
// through the brain's handler, so it imports only types, the status helper in
// `sessions/types.ts`, the loop's `internal.ts` leaf, node `path`, the agent
// readers and this feature's files: never the Agent SDK, the session manager or
// `kernel.ts`.
import { resolve, sep } from "node:path";
import { getAgent } from "../agents/registry.js";
import { readAgentSettings } from "../agents/settings.js";
import { isPositiveId, messageOf } from "../loop/internal.js";
import type { EventContext, EventSessions } from "../loop/types.js";
import { resolvedPath } from "../protected-paths.js";
import { TERMINAL_STATUSES, isTerminalStatus } from "../sessions/types.js";
import type { ToolPolicy } from "../sessions/types.js";
import { readRunState, summarizeRuns } from "./run-state.js";
import { automateInvocation } from "./tickets-to-items.js";

/** The payload key that marks a `message` event as a kernel-started `/automate` run. */
export const AUTOMATE_RUN_KEY = "automate_run";

/** What `kernel_automate_prepare` queues under `AUTOMATE_RUN_KEY`. Kernel-built; ticket text is never in it. */
export interface AutomateRunPayload {
  readonly repo: string;
  /** Absolute path of the `_BACKLOG.md` the run reads. */
  readonly backlog: string;
  /** The crew member's checkout of the repo (the run's cwd). */
  readonly checkout: string;
  readonly playbook: number;
  readonly playbook_version: number | null;
  readonly task: number | null;
  /** The crew session that called prepare: its row names the model the run uses. */
  readonly source_session: number;
}

/**
 * The run session's policy: what `/automate --inline-phases` is allowed to ask for.
 * Frozen, and never written into a charter. The rail and the approval gate run on
 * top of it unchanged, and the crew member's `never` list is added at the start.
 * Bash is gated by the prefixes only; the Loomwright helper scripts are not listed
 * (their path is the install's, and `bash` as a prefix would let `bash -c` run
 * anything past the rail), so a denied helper call is a live-run finding.
 */
export const AUTOMATE_RUN_POLICY: ToolPolicy = Object.freeze({
  allowedTools: Object.freeze(["Skill", "Read", "Write", "Edit", "Glob", "Grep", "Bash", "Agent", "AskUserQuestion"]),
  allowedBashPrefixes: Object.freeze([
    // git: the subcommands the run uses and the rail reads. A prefix matches on a
    // word boundary (`git commit` admits `git commit -m x`, not `git commit-tree`).
    "git status", "git diff", "git log", "git show", "git add", "git commit", "git checkout", "git switch", "git branch", "git fetch",
    "git push", "git rev-parse", "git worktree", "git stash", "git merge-base", "git ls-files",
    // gh: reads and the PR / issue work; no release, secret, workflow or repo edit / delete.
    "gh pr", "gh issue", "gh api", "gh repo view", "gh auth status", "gh run view",
    "ls", "cat", "pwd", "date", "mkdir", "test", "wc", "head", "tail", "grep", "sleep", "jq",
  ]),
});

/** The command the run starts with: Loomwright's `/automate` over the backlog, inline phases, safe mode. */
export const AUTOMATE_RUN_COMMAND = "/loomwright:automate";

/** What the `automate-run` step stores: the run session's id, or no session and why. */
export type AutomateRunResult = { readonly session_id: number } | { readonly session_id: null; readonly skipped: string };

/** The event's `automate_run` payload, checked; a `TypeError` names what is wrong (the loop fails the event, one notify). */
function automateRunOf(eventId: number, payload: Readonly<Record<string, unknown>>): AutomateRunPayload & { readonly agent: string } {
  const bad = (what: string): TypeError => new TypeError(`event ${eventId}: an automate run needs ${what}`);
  const raw = payload[AUTOMATE_RUN_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw bad("automate_run, an object");
  const r = raw as Record<string, unknown>;
  if (typeof payload.agent !== "string" || payload.agent === "") throw bad("agent, a string");
  if (typeof r.repo !== "string" || r.repo === "") throw bad("repo, a string");
  if (typeof r.backlog !== "string" || !r.backlog.startsWith("/")) throw bad("backlog, an absolute path");
  if (typeof r.checkout !== "string" || !r.checkout.startsWith("/")) throw bad("checkout, an absolute path");
  if (!isPositiveId(r.playbook)) throw bad("playbook, a positive integer");
  if (r.playbook_version !== null && r.playbook_version !== undefined && !isPositiveId(r.playbook_version)) throw bad("playbook_version, absent, null or a positive integer");
  if (r.task !== null && r.task !== undefined && !isPositiveId(r.task)) throw bad("task, absent, null or a positive integer");
  if (!isPositiveId(r.source_session)) throw bad("source_session, a positive integer");
  return {
    agent: payload.agent,
    repo: r.repo,
    backlog: r.backlog,
    checkout: r.checkout,
    playbook: r.playbook,
    playbook_version: r.playbook_version ?? null,
    task: r.task ?? null,
    source_session: r.source_session,
  };
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
 * The `automate-run` step: decide whether the run may start, and start it. Every
 * refusal of ours is a return that stores why, so a redelivery replays it and
 * decides nothing again. An admission refusal (budget or cap) is not caught here:
 * it comes out of the start call inside the step, so the loop parks the event and
 * releases the step for the redelivery.
 */
async function startRun(ctx: EventContext, run: AutomateRunPayload & { readonly agent: string }): Promise<AutomateRunResult> {
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

  // The checkout is one of the crew member's workspaces and the backlog is inside it.
  const checkout = resolve(run.checkout);
  if (!(settings.workspaces ?? []).some((w) => resolve(w) === checkout)) return skip(`workspace_not_listed: ${run.checkout}`);
  if (!resolve(run.backlog).startsWith(`${checkout}${sep}`)) return skip("backlog_outside_checkout");
  let prompt: string;
  try {
    prompt = automateRunPrompt(run.backlog);
  } catch (err) {
    return skip(messageOf(err));
  }

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

  // The session is the step's last effect, so an admission refusal leaves nothing to repeat.
  const handle = await sessions.startSession({
    agent: run.agent,
    prompt,
    model: caller.model,
    permissionMode: settings.permissionMode,
    cwd: checkout,
    policy: { ...AUTOMATE_RUN_POLICY, ...(settings.never !== undefined ? { never: settings.never } : {}) },
    playbook: run.playbook,
    ...(caller.playbook_version === null || caller.playbook_version === undefined ? {} : { playbookVersion: caller.playbook_version }),
    ...(caller.task_id === null || caller.task_id === undefined ? {} : { task: caller.task_id }),
  });
  return { session_id: handle.id };
}

/**
 * The brain's route for a `message` event whose payload carries `automate_run`:
 * start the `/automate` run session once for the event (see the module comment).
 * Resolves when the step is stored; it never awaits the session itself.
 */
export async function handleAutomateRun(ctx: EventContext): Promise<void> {
  const run = automateRunOf(ctx.event.id, ctx.event.payload);
  await ctx.runStepAsync("automate-run", () => startRun(ctx, run));
}
