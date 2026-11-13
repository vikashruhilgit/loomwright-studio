// The playbook's target repository (phase 8 item 20h, migration 25): the one
// `owner/name` a playbook's pull requests go to. A ClickUp or Jira ticket poll
// names no repository (`parsePollSpec` gives a `jira.issues` / `clickup.tasks`
// spec no `repos`), so the playbook carries it. This module holds the rule and
// nothing else:
//
//   - `checkTargetRepo`: the shape (`isRepoName`: `owner/name` in GitHub's
//     characters, neither part `.` or `..`), refusing `invalid_input` naming
//     `target_repo`. The store calls it on every create and update.
//   - `targetRepoRefusal`: the enable's refusal, as a value (the enable turns
//     it into its own `EnableRefused`, so this module never imports `enable.ts`):
//     `no_target_repo` for a playbook whose linked poll is `jira.issues` or
//     `clickup.tasks` and whose `target_repo` is null; `target_repo_not_reachable`
//     for a set `target_repo` the GitHub connector does not reach (no usable
//     `github` connector row, or the repo is not in its `reachable_repos_json`).
//
// Mechanism only (invariant 1): the owner or Wright's draft sets the value; the
// kernel checks it and never fills it in. It reuses `isRepoName`
// (`../integrations/github/repo-policy.ts`) and `githubConnectorState`
// (`../triggers/poll.ts`); neither is changed and no repo-name or reach helper
// is written here. The reach test reads the connector at the call, so the
// apply sees what changed after the hold.
import { isRepoName } from "../integrations/github/repo-policy.js";
import type { Store } from "../store/store.js";
import { githubConnectorState } from "../triggers/poll.js";
import { PlaybookError, linkedTriggerOf } from "./store.js";
import type { PlaybookRow } from "./store.js";

/** The poll sources that list tickets and so name no repository. */
const TRACKER_SOURCES: readonly string[] = Object.freeze(["jira.issues", "clickup.tasks"]);

/** The enable refusals this module decides. */
export type TargetRepoRefusalReason = "no_target_repo" | "target_repo_not_reachable";

/** A refusal as a value: the enable's reason token and the one-line sentence. */
export interface TargetRepoRefusal {
  readonly reason: TargetRepoRefusalReason;
  readonly message: string;
}

/** A value from the input, short and quoted, for a refusal's message. */
function shown(value: unknown): string {
  const s = JSON.stringify(typeof value === "string" ? value : (value ?? null)) ?? "undefined";
  return s.length > 66 ? `${s.slice(0, 64)}…` : s;
}

/**
 * `value` as `playbooks.target_repo` stores it: `owner/name`, as given (the
 * case is kept; the reach test compares case-insensitively). Throws
 * `PlaybookError("invalid_input")` naming `target_repo` for anything else.
 */
export function checkTargetRepo(value: unknown): string {
  if (!isRepoName(value)) throw new PlaybookError("invalid_input", `target_repo must be owner/name, with neither part . or .. (got ${shown(value)})`);
  return value;
}

/** The source of `row`'s linked poll trigger, or null when it has none (or another kind of trigger). */
function polledSource(store: Store, row: PlaybookRow): string | null {
  const trigger = linkedTriggerOf(store, row);
  if (trigger === null || trigger.kind !== "poll") return null;
  const source = (trigger.spec as { source?: unknown } | null)?.source;
  return typeof source === "string" ? source : null;
}

/**
 * The refusal when `row` cannot be enabled for want of a target repository, or
 * `undefined`. Checked in this order: a tracker playbook (its linked poll is
 * `jira.issues` or `clickup.tasks`) with no `target_repo` is `no_target_repo`;
 * a set `target_repo` (any playbook) the GitHub connector does not reach is
 * `target_repo_not_reachable`, naming the repo. A playbook with no target repo
 * and any other trigger is never refused here.
 */
export function targetRepoRefusal(store: Store, row: PlaybookRow): TargetRepoRefusal | undefined {
  const repo = row.target_repo;
  if (repo === null || repo === undefined) {
    const source = polledSource(store, row);
    if (source === null || !TRACKER_SOURCES.includes(source)) return undefined;
    return {
      reason: "no_target_repo",
      message: `playbook ${row.id} polls ${source}, which names no repository, so it has nowhere to open pull requests; set its target repository (kernel_playbook_update with changes {target_repo: "owner/name"}), then ask again`,
    };
  }
  const connector = githubConnectorState(store);
  if (connector.usable && connector.reachable.has(repo.toLowerCase())) return undefined;
  const why = connector.usable ? "the GitHub App does not reach it" : "no GitHub connector is connected";
  return {
    reason: "target_repo_not_reachable",
    message: `target repository ${repo} is not reachable (${why}); set a repository the GitHub App reaches, or have the owner grant the App access to it`,
  };
}
