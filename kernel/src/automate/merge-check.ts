// The merge check (phase 8 item 09): the decision behind `kernel_automate_merge_check`.
// It answers whether Loomwright may merge ONE parked pull request through its own
// gate, and with what. Read-only and mechanism only (invariant 1): the repo's
// policy is the owner's (`policyMet`, item 08), and the kernel never merges
// (invariant 4): nothing in `kernel/src/automate/` calls a GitHub merge endpoint,
// runs the GitHub CLI or starts a process (`kernel/test/automate-merge-check.test.ts`
// scans the sources for each).
// A `go` carries the invocation the playbook's own session runs,
// `/loomwright:automate --merge-parked <run_id>` (probe p14, Loomwright 17.34.2 or
// later), and Loomwright's seven gate conditions still decide.
//
// It answers `go` only when, in this order:
//   1. the repo has a policy (else `park: no_policy`; GitHub is not read);
//   2. no run is live (`wait: run_live`: a live run's drain owns the PR);
//   3. a paused run file parks exactly one `awaiting_merge` item for this PR,
//      with a `ready_sha` (else `park`);
//   4. `policyMet` holds for that PR at the item's `ready_sha` (so a moved head,
//      red CI, a missing approval or review are `wait`/`park` with its reason),
//      with the calling playbook's `merge_requirement` as its `playbookRequirement`
//      (a playbook may only ask for more, never less);
//   5. when an approved merge approval exists at that head, its `ready_at` is the
//      item's `ready_at` (else `wait: ready_at_mismatch`: the approval was for an
//      earlier READY of the same head).
// Anything unreadable answers `wait`/`park` with a reason, never `go`.
//
// GitHub is read through `policyMet`'s own client: production passes none, so it
// uses `createRepoPolicyClient()` (the stored credential, as `detectRepoPolicy`
// does). Tests inject a client through `deps.client`. This module never reads
// `ContributedToolContext.github`.
//
// The `studio` CLI loads this module through the feature registry, so it imports
// only types, the store type, the repo-policy module and `./run-state.js`: never
// the Agent SDK, the session manager or `kernel.ts`.
import { MERGE_APPROVAL_ACTION, getRepoPolicy, loomwrightMergeFlags, policyMet } from "../integrations/github/repo-policy.js";
import type { PolicyMetDeps, PolicyNotMetReason } from "../integrations/github/repo-policy.js";
import { parsePullUrl, readRunState, summarizeRuns } from "./run-state.js";
import type { ParkedItem } from "./run-state.js";

/** The three answers: `go` (run the invocation), `wait` (ask again later) and `park` (a person has to act). */
export const MERGE_CHECK_ANSWERS = Object.freeze(["go", "wait", "park"] as const);

/** One of `MERGE_CHECK_ANSWERS`. */
export type MergeCheckAnswerKind = (typeof MERGE_CHECK_ANSWERS)[number];

/** Why a check does not answer `go`: `policyMet`'s reasons, then the run-state ones. */
export const MERGE_CHECK_REASONS = Object.freeze([
  "no_policy",
  "head_moved",
  "ci_not_green",
  "awaiting_owner_approval",
  "reviews_short",
  "changes_requested",
  "unreadable",
  "run_live",
  "run_state_unreadable",
  "not_parked",
  "not_awaiting_merge",
  "ambiguous_runs",
  "ready_sha_missing",
  "ready_at_mismatch",
] as const);

/** One of `MERGE_CHECK_REASONS`. */
export type MergeCheckReason = (typeof MERGE_CHECK_REASONS)[number];

/** `kernel_automate_merge_check`'s answer. */
export type MergeCheckAnswer =
  | { readonly answer: "go"; readonly run_id: string; readonly ready_sha: string; readonly invocation: string }
  | { readonly answer: "wait" | "park"; readonly reason: MergeCheckReason; readonly detail: string };

/** What a check is asked. */
export interface MergeCheckInput {
  readonly repo: string;
  readonly pr: number;
  /** The repo's checkout (the calling agent's workspace for it). */
  readonly checkout: string;
  /** The calling playbook's `merge_requirement` (`none`, `studio_approval`, `reviews:<N>`), or `null` for none. */
  readonly playbookRequirement: string | null;
}

const wait = (reason: MergeCheckReason, detail: string): MergeCheckAnswer => ({ answer: "wait", reason, detail });
const park = (reason: MergeCheckReason, detail: string): MergeCheckAnswer => ({ answer: "park", reason, detail });

/**
 * How each `policyMet` reason reads: `park` where a person has to act (no policy
 * is set, a reviewer asked for changes), `wait` where time or a push resolves it
 * (a moved head, CI running or red, an approval or review still to come, a read
 * that failed).
 */
function fromPolicy(reason: PolicyNotMetReason): MergeCheckAnswer {
  switch (reason) {
    case "no_policy":
      return park("no_policy", "the repo has no merge policy; the owner sets one first, and until then its pull requests park");
    case "changes_requested":
      return park("changes_requested", "a reviewer's latest review asks for changes");
    case "head_moved":
      return wait("head_moved", "the pull request's head is not the head Loomwright marked READY; Loomwright's run decides what comes next");
    case "ci_not_green":
      return wait("ci_not_green", "CI is not green at the head");
    case "awaiting_owner_approval":
      return wait("awaiting_owner_approval", "the policy needs the owner's merge approval at this head; ask for it with kernel_merge_approval_request");
    case "reviews_short":
      return wait("reviews_short", "fewer approving reviews at the head than the policy needs");
    case "unreadable":
      return wait("unreadable", "the repo's policy or the pull request's state could not be read; ask again later");
  }
}

/** The `ready_at` values of every approved merge approval filed for `repo`#`pr` at `headSha` (the rail's `{tool, input, cwd}` payload). */
function approvedReadyAts(deps: PolicyMetDeps, repo: string, pr: number, headSha: string): readonly (string | null)[] {
  const rows = deps.store
    .prepare<[string, string, string, number, string], { readonly ready_at: string | null }>(
      `SELECT json_extract(payload_json, '$.input.ready_at') AS ready_at FROM approvals
       WHERE action = ? AND status = 'approved'
         AND CASE WHEN json_valid(payload_json)
               THEN json_extract(payload_json, '$.tool') = ? AND json_extract(payload_json, '$.input.repo') = ?
                AND json_extract(payload_json, '$.input.pr') = ? AND json_extract(payload_json, '$.input.head_sha') = ?
               ELSE 0 END`,
    )
    .all(MERGE_APPROVAL_ACTION, `mcp__kernel__${MERGE_APPROVAL_ACTION}`, repo, pr, headSha);
  return rows.map((r) => (typeof r.ready_at === "string" ? r.ready_at : null));
}

/** The one parked item for `repo`#`pr`, else the answer to give. */
function parkedFor(items: readonly ParkedItem[], repo: string, pr: number): ParkedItem | MergeCheckAnswer {
  const mine = items.filter((i) => {
    const at = parsePullUrl(i.pr);
    return at !== undefined && at.number === pr && at.repo.toLowerCase() === repo.toLowerCase();
  });
  if (mine.length === 0) return park("not_parked", `no paused /automate run in this checkout has ${repo}#${pr} as its current item`);
  const waiting = mine.filter((i) => i.status === "awaiting_merge");
  if (waiting.length > 1) return park("ambiguous_runs", `${waiting.length} paused runs park ${repo}#${pr} awaiting_merge; a person resolves which one stands`);
  const item = waiting[0];
  if (item === undefined) {
    const first = mine[0] as ParkedItem;
    return park("not_awaiting_merge", `${repo}#${pr} is parked as ${first.status}${first.reason === null ? "" : ` (${first.reason})`}, not awaiting_merge`);
  }
  return item;
}

/** Whether `parked` is an answer (not an item). */
function isAnswer(parked: ParkedItem | MergeCheckAnswer): parked is MergeCheckAnswer {
  return "answer" in parked;
}

/**
 * Whether Loomwright may merge `repo`#`pr` now. Read-only: it reads the checkout's run
 * state, the store and GitHub (through `policyMet`), and writes nothing. Never throws.
 */
export async function mergeCheck(input: MergeCheckInput, deps: PolicyMetDeps): Promise<MergeCheckAnswer> {
  try {
    const { repo, pr } = input;
    if (getRepoPolicy(deps.store, repo).kind === null) return fromPolicy("no_policy");
    const read = readRunState(input.checkout);
    if (!read.ok) return wait("run_state_unreadable", `Loomwright's run state could not be read (${read.reason})`);
    const summary = summarizeRuns(read);
    if (summary.state === "live") return wait("run_live", "an /automate run is live in this checkout; its drain owns the pull request");
    const parked = parkedFor(summary.parked, repo, pr);
    if (isAnswer(parked)) return parked;
    if (parked.ready_sha === null || !/^[0-9a-f]{40}$/.test(parked.ready_sha)) return park("ready_sha_missing", "the parked item records no READY head (ready_sha); a person decides");
    const met = await policyMet(repo, pr, parked.ready_sha, deps, input.playbookRequirement);
    if (!met.met) return fromPolicy(met.reason);
    const approved = approvedReadyAts(deps, repo, pr, parked.ready_sha);
    if (approved.length > 0 && !approved.includes(parked.ready_at)) return wait("ready_at_mismatch", "the merge approval at this head was for an earlier READY time; ask for it again with the current ready_at");
    const invocation = ["/loomwright:automate", "--merge-parked", parked.run_id, ...loomwrightMergeFlags(deps.store, repo)].join(" ");
    return { answer: "go", run_id: parked.run_id, ready_sha: parked.ready_sha, invocation };
  } catch {
    return wait("unreadable", "the check could not be completed; ask again later");
  }
}
