// The PR tracker (phase 8 item 10): a due work that keeps `pr_tracks` and the
// linked `tasks` row current, with one `pr_state_changed` event per change, so
// Tasks shows each ticket's pull request truthfully (state, approvals against the
// repo's policy, CI, who owns it). It reads and records; it never acts on what it
// finds (invariants 1 and 4): the kernel pushes and merges nothing here.
//
// Which pull requests it follows: every PR a Loomwright run file names in the
// workspaces of the registered agents (the current item's `pr:` URL, found by the
// run-state reader, and only for a repo the workspace is a clone of; a `closed` row
// is re-read while a running or paused run names it, a `merged` one never), and
// every `pr_tracks` row not yet `merged` or `closed` (re-read until it ends).
//
// When it reads GitHub (the cadence is the owner's): a pass runs only when a
// `trigger_fired` event was appended since its last pass, so the owner's own
// trigger cadence drives the refresh and the kernel ships no polling interval.
// The high-water event id is kept in memory, so a restart re-reads on the first
// tick that finds a trigger ever fired (the pass is idempotent: an unchanged read
// writes nothing). A pass reads at most `MAX_TRACKED_PER_PASS` pull requests,
// least recently attempted first (then oldest `updated`), so a read that keeps
// failing cannot starve the rest: a rate guard, not a cadence.
//
// State, in this precedence: GitHub `merged` is `merged`; GitHub `closed` is
// `closed`; a parked item (`ownerOf`) is `parked`; a run item naming the PR with a
// full `ready_sha` equal to the PR's head is `ready`; a draft is `draft`; else
// `open`. Approvals come from the repo's policy and `getPullMergeState`
// (`approvalsWordOf`); the owner of a PR is `ownerOf` (`routing.ts`, its one home).
//
// Writes, one transaction per PR: the `pr_tracks` upsert, the linked task (the
// `tasks` row whose `dedupe_key` is `pr:<repo>#<n>`; created, with one
// `task_created`, when none exists and the PR has a ticket ref) and, when the
// state, head, approvals, requirement, CI or owner kind changed, exactly one
// `pr_state_changed`. A GitHub read that fails changes nothing for that PR.
// `merged_by_gate` is shown, never acted on: it is 1 only when GitHub reports the
// PR merged and a run file's current item names it `done` with a full `ready_sha`
// equal to the merged head.
//
// A ticket ref is read from the item's `- dedupe ref:` line, only under
// `.supervisor/requirements/studio/`, size-capped, as untrusted text (a plain-token
// check, never an instruction). The GitHub client is injected, else
// `createRepoPolicyClient()` (never `DueWorkContext.github`).
//
// The `studio` CLI loads this module through the feature registry, so it imports
// only types, the feature seam, the agent settings and registry readers, the
// repo-policy module, the loop's store helpers, node `fs`/`path` and this
// feature's files: never the Agent SDK, the session manager or `kernel.ts`.
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { listAgents } from "../agents/registry.js";
import { readAgentSettings } from "../agents/settings.js";
import type { ConsolePart } from "../console/types.js";
import type { DueWorkFn } from "../features/contribution.js";
import { getRepoPolicy } from "../integrations/github/repo-policy.js";
import type { RepoPolicyKind } from "../integrations/github/repo-policy.js";
import type { GitHubCiState, GitHubPull, GitHubPullMergeState } from "../integrations/types.js";
import { appendEvent, clip } from "../loop/internal.js";
import type { DueWorkContext } from "../loop/types.js";
import type { Store } from "../store/store.js";
import { remoteRepos } from "./checkout.js";
import { githubClientOf, identityOf, ownerOf, parkedItemOf, pullUrlOf } from "./routing.js";
import type { OwnerIdentity, PrGitHubClient } from "./routing.js";
import { parsePullUrl, readRunState } from "./run-state.js";
import type { CurrentItem, RunFile, RunStateRead } from "./run-state.js";
import { REF_PATTERN, STUDIO_ITEMS_DIR, cleanTitle } from "./tickets-to-items.js";

// ---- Closed sets ----------------------------------------------------------------------

/** Every state a tracked pull request is in, closed in code (`pr_tracks.state` has no SQL CHECK). */
export const PR_TRACK_STATES = Object.freeze(["open", "draft", "ready", "parked", "merged", "closed"] as const);

/** One of `PR_TRACK_STATES`. */
export type PrTrackState = (typeof PR_TRACK_STATES)[number];

/** Who holds a pull request, closed in code (mirrors the contract's `PrOwnerKind`). */
export const PR_OWNER_KINDS = Object.freeze(["automate_live", "automate_parked", "owner", "other"] as const);

/** One of `PR_OWNER_KINDS`. */
export type PrOwnerKind = (typeof PR_OWNER_KINDS)[number];

/** The states a pull request never leaves: a row in one is not read again. */
const ENDED: readonly PrTrackState[] = ["merged", "closed"];

/** The most pull requests one pass reads (a rate guard against GitHub, not a polling interval). */
export const MAX_TRACKED_PER_PASS = 25;

/** The largest requirement item the tracker reads for a ticket ref (a ticket body is at most 20000 characters). */
const MAX_ITEM_BYTES = 128 * 1024;

const FULL_SHA = /^[0-9a-f]{40}$/;

// ---- Approvals ----------------------------------------------------------------------------

/**
 * How a pull request's approvals read against its repo's policy: `n/N` for a
 * `reviews` policy, `solo`, `studio_approval`, or `no_policy` (no policy kind).
 * Pure: the kernel's one wording, reused by `GET /tasks`.
 */
export function approvalsWordOf(policyKind: RepoPolicyKind | null, approvals: number, required: number | null): string {
  if (policyKind === null) return "no_policy";
  if (policyKind === "solo" || policyKind === "studio_approval") return policyKind;
  return required === null ? `${approvals}` : `${approvals}/${required}`;
}

// ---- What the tracker reads ---------------------------------------------------------------

/** One agent workspace that is a clone of at least one GitHub repo, with its run state read once per pass. */
interface Checkout {
  readonly agent: string;
  readonly workspace: string;
  readonly repos: readonly string[];
  readonly read: RunStateRead;
}

/** A run file's current item that names a pull request, and the checkout it was read in. */
interface Named {
  readonly run: RunFile;
  readonly item: CurrentItem;
  readonly checkout: Checkout;
}

/** One `pr_tracks` row as stored. */
interface TrackRow {
  readonly id: number;
  readonly repo: string;
  readonly number: number;
  readonly head_sha: string | null;
  readonly state: string;
  readonly ticket_ref: string | null;
  readonly approvals: number;
  readonly required: number | null;
  readonly ci_state: string | null;
  readonly owner_kind: string | null;
  readonly run_file: string | null;
  readonly item_id: string | null;
  readonly merged_by_gate: number;
  readonly updated: string;
}

const TRACK_COLUMNS = "id, repo, number, head_sha, state, ticket_ref, approvals, required, ci_state, owner_kind, run_file, item_id, merged_by_gate, updated";

/** A pull request the pass will read. */
interface Candidate {
  readonly repo: string;
  readonly number: number;
  /** Every run item that names it, best first. */
  readonly named: readonly Named[];
  /** The checkout whose run state decides its owner; `undefined` when no workspace is a clone of the repo. */
  readonly checkout: Checkout | undefined;
  readonly row: TrackRow | undefined;
}

const keyOf = (repo: string, number: number): string => `${repo.toLowerCase()}#${number}`;

/** The workspaces of every registered agent whose settings list some, one entry per workspace and git remote set (the first agent to list it owns it). */
function checkoutsOf(store: Store): Checkout[] {
  const found: Checkout[] = [];
  const seen = new Set<string>();
  for (const agent of listAgents(store)) {
    const settings = readAgentSettings(store.dataDir, agent.id);
    if (!settings.ok) continue;
    for (const workspace of settings.settings.workspaces ?? []) {
      if (seen.has(workspace)) continue;
      seen.add(workspace);
      const repos = remoteRepos(workspace);
      if (repos.length > 0) found.push({ agent: agent.id, workspace, repos, read: readRunState(workspace) });
    }
  }
  return found;
}

/** How strongly a run item holds a PR: a running run, then a paused run, then a finished one. */
function rankOf(n: Named): number {
  return n.run.status === "running" ? 2 : n.run.status === "paused" ? 1 : 0;
}

/**
 * What the pass remembers of its own reads, in memory only (a restart starts
 * empty, and the pass is idempotent): the order each pull request was last
 * attempted, so a read that keeps failing (it never updates its row) cannot hold
 * a slot under the per-pass cap every pass.
 */
interface Attempts {
  seq: number;
  readonly last: Map<string, number>;
}

/**
 * The pull requests this pass follows: those run files name, plus every row not
 * ended; least recently attempted first (never attempted first), then oldest
 * `updated`, at most `MAX_TRACKED_PER_PASS`. A `merged` row is final; a `closed`
 * row is re-read only while a running or paused run names it (a closed PR can be
 * reopened and picked up again), and a row no run names is not read once ended.
 */
function candidatesOf(store: Store, checkouts: readonly Checkout[], attempts: Attempts): Candidate[] {
  const rows = new Map<string, TrackRow>();
  for (const row of store.prepare<[], TrackRow>(`SELECT ${TRACK_COLUMNS} FROM pr_tracks`).all()) rows.set(keyOf(row.repo, row.number), row);
  const named = new Map<string, { repo: string; number: number; items: Named[] }>();
  for (const checkout of checkouts) {
    if (!checkout.read.ok) continue;
    for (const run of checkout.read.runs) {
      const item = run.current;
      const at = parsePullUrl(item?.pr ?? null);
      // Only a repo this workspace is a clone of: a PR URL in a run file is data, not a place to read.
      if (item === null || at === undefined || !checkout.repos.some((r) => r.toLowerCase() === at.repo.toLowerCase())) continue;
      const entry = named.get(keyOf(at.repo, at.number)) ?? { repo: at.repo, number: at.number, items: [] };
      entry.items.push({ run, item, checkout });
      named.set(keyOf(at.repo, at.number), entry);
    }
  }
  const candidates = new Map<string, Candidate>();
  for (const [key, entry] of named) {
    const items = [...entry.items].sort((a, b) => rankOf(b) - rankOf(a) || b.run.run_id.localeCompare(a.run.run_id));
    candidates.set(key, { repo: entry.repo, number: entry.number, named: items, checkout: items[0]?.checkout, row: rows.get(key) });
  }
  for (const [key, row] of rows) {
    if (!candidates.has(key)) {
      const checkout = checkouts.find((c) => c.repos.some((r) => r.toLowerCase() === row.repo.toLowerCase()));
      candidates.set(key, { repo: row.repo, number: row.number, named: [], checkout, row });
    }
  }
  const live = (c: Candidate): boolean => c.named.some((n) => rankOf(n) > 0);
  const followed = [...candidates.values()].filter((c) => c.row === undefined || !(ENDED as readonly string[]).includes(c.row.state) || (c.row.state === "closed" && live(c)));
  // Forget what a pull request no longer followed was last attempted at: the map never outgrows the candidates.
  const keys = new Set(followed.map((c) => keyOf(c.repo, c.number)));
  for (const key of [...attempts.last.keys()]) if (!keys.has(key)) attempts.last.delete(key);
  return followed
    .sort(
      (a, b) =>
        (attempts.last.get(keyOf(a.repo, a.number)) ?? 0) - (attempts.last.get(keyOf(b.repo, b.number)) ?? 0) ||
        (a.row?.updated ?? "").localeCompare(b.row?.updated ?? "") ||
        keyOf(a.repo, a.number).localeCompare(keyOf(b.repo, b.number)),
    )
    .slice(0, MAX_TRACKED_PER_PASS);
}

// ---- The ticket ----------------------------------------------------------------------------

/** What a requirement item says about its ticket. */
interface TicketItem {
  readonly ref: string;
  readonly title: string | null;
}

/**
 * The ticket behind a `kernel_automate_prepare` item: its `- dedupe ref:` line
 * under `## Source ticket` and its `# ` heading. Read only from a regular file
 * directly in `<workspace>/.supervisor/requirements/studio/` (a path outside it,
 * a symlink or a file over `MAX_ITEM_BYTES` reads as none), and the ref must be a
 * plain token. `null` for anything else.
 */
function ticketOf(workspace: string, itemPath: string): TicketItem | null {
  try {
    const dir = join(workspace, STUDIO_ITEMS_DIR);
    const file = resolve(workspace, itemPath);
    if (resolve(file, "..") !== dir) return null;
    if (!(realpathSync(dir) + sep).startsWith(realpathSync(workspace) + sep)) return null;
    const st = lstatSync(file);
    if (!st.isFile() || st.size > MAX_ITEM_BYTES) return null;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    const heading = lines.find((l) => l.startsWith("# "));
    const at = lines.findIndex((l) => l.trim() === "## Source ticket");
    if (at < 0) return null;
    let ref: string | null = null;
    for (const line of lines.slice(at + 1)) {
      if (line.startsWith("## ")) break;
      const m = /^- dedupe ref: `([^`]+)`$/.exec(line);
      if (m !== null) {
        ref = m[1] as string;
        break;
      }
    }
    if (ref === null || !REF_PATTERN.test(ref)) return null;
    const title = heading === undefined ? "" : cleanTitle(heading.slice(2));
    return { ref, title: title === "" ? null : title };
  } catch {
    return null;
  }
}

// ---- A pass ----------------------------------------------------------------------------------

/** What one pull request reads as now. */
interface Observed {
  readonly state: PrTrackState;
  readonly head_sha: string;
  readonly approvals: number;
  readonly required: number | null;
  readonly word: string;
  readonly ci: GitHubCiState;
  readonly owner_kind: PrOwnerKind;
  readonly ticket: string | null;
  readonly title: string | null;
  readonly agent: string | null;
  readonly run_file: string | null;
  readonly item_id: string | null;
  readonly merged_by_gate: boolean;
  readonly reason: string | null;
}

/** The state `pull` is in, in the precedence the page above gives. */
function stateOf(pull: GitHubPull, owner: PrOwnerKind, named: readonly Named[]): PrTrackState {
  if (pull.merged === true) return "merged";
  if (pull.state === "closed") return "closed";
  if (owner === "automate_parked") return "parked";
  if (named.some((n) => n.item.ready_sha !== null && FULL_SHA.test(n.item.ready_sha) && n.item.ready_sha === pull.head_sha)) return "ready";
  return pull.draft ? "draft" : "open";
}

/** Reads `candidate` from GitHub and the run files. `undefined` when a read failed or the run state cannot be trusted (nothing changes for it). */
async function observe(store: Store, client: PrGitHubClient, candidate: Candidate, identity: OwnerIdentity): Promise<Observed | undefined> {
  const { repo, number: pr } = candidate;
  const read = candidate.checkout?.read;
  if (read !== undefined && !read.ok) return undefined;
  let pull: GitHubPull;
  let merge: GitHubPullMergeState;
  try {
    const gotPull = await client.getPull(repo, pr);
    if (!gotPull.ok) return undefined;
    const gotMerge = await client.getPullMergeState(repo, pr);
    if (!gotMerge.ok) return undefined;
    pull = gotPull.data;
    merge = gotMerge.data;
  } catch {
    return undefined;
  }
  const owner = ownerOf(read, repo, pr, pull.author, identity);
  const state = stateOf(pull, owner, candidate.named);
  const policy = getRepoPolicy(store, repo);
  const required = policy.kind === "reviews" ? policy.required_reviews : null;
  const primary = candidate.named[0];
  const ticket = primary === undefined ? null : ticketOf(primary.checkout.workspace, primary.item.item);
  const parked = read !== undefined && read.ok ? parkedItemOf(read, repo, pr) : undefined;
  const gate = state === "merged" && candidate.named.some((n) => n.item.status === "done" && n.item.ready_sha !== null && FULL_SHA.test(n.item.ready_sha) && n.item.ready_sha === pull.head_sha);
  return {
    state,
    head_sha: pull.head_sha,
    approvals: merge.approvals,
    required,
    word: approvalsWordOf(policy.kind, merge.approvals, required),
    ci: merge.ci,
    owner_kind: owner,
    ticket: ticket?.ref ?? null,
    title: ticket?.title ?? null,
    agent: candidate.checkout?.agent ?? null,
    run_file: primary?.run.run_id ?? null,
    item_id: primary?.item.item ?? null,
    merged_by_gate: gate,
    reason: state === "parked" ? (parked?.reason ?? parked?.status ?? null) : null,
  };
}

/** The `pr_tracks` row of `repo`#`number` (the repo compared without case). */
function rowOf(store: Store, repo: string, number: number): TrackRow | undefined {
  return store.prepare<[string, number], TrackRow>(`SELECT ${TRACK_COLUMNS} FROM pr_tracks WHERE lower(repo) = lower(?) AND number = ?`).get(repo, number);
}

/**
 * Records `obs`: the row, the linked task and, when something the owner reads
 * changed, the one event. One transaction. An unchanged read writes nothing.
 */
function record(store: Store, repo: string, number: number, obs: Observed, at: string): void {
  store.transaction(() => {
    const row = rowOf(store, repo, number);
    const changed = row === undefined || row.state !== obs.state || row.head_sha !== obs.head_sha || row.approvals !== obs.approvals || row.required !== obs.required || row.ci_state !== obs.ci || row.owner_kind !== obs.owner_kind;
    const ticket = obs.ticket ?? row?.ticket_ref ?? null;
    const runFile = obs.run_file ?? row?.run_file ?? null;
    const itemId = obs.item_id ?? row?.item_id ?? null;
    const gate = obs.merged_by_gate ? 1 : 0;
    if (!changed && row !== undefined && row.ticket_ref === ticket && row.run_file === runFile && row.item_id === itemId && row.merged_by_gate === gate) return;
    store
      .prepare(
        `INSERT INTO pr_tracks (repo, number, head_sha, state, ticket_ref, approvals, required, ci_state, owner_kind, run_file, item_id, merged_by_gate, updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (repo, number) DO UPDATE SET head_sha = excluded.head_sha, state = excluded.state, ticket_ref = excluded.ticket_ref, approvals = excluded.approvals,
           required = excluded.required, ci_state = excluded.ci_state, owner_kind = excluded.owner_kind, run_file = excluded.run_file, item_id = excluded.item_id,
           merged_by_gate = excluded.merged_by_gate, updated = excluded.updated`,
      )
      .run(row?.repo ?? repo, number, obs.head_sha, obs.state, ticket, obs.approvals, obs.required, obs.ci, obs.owner_kind, runFile, itemId, gate, at);
    const dedupe = `pr:${repo}#${number}`;
    const links = JSON.stringify({
      ticket,
      pr: { repo, number, url: pullUrlOf(repo, number) },
      state: obs.state,
      approvals: obs.word,
      ci: obs.ci,
      owner_kind: obs.owner_kind,
      ...(obs.reason === null ? {} : { reason: obs.reason }),
    });
    let taskId = store.prepare<[string], number>("SELECT id FROM tasks WHERE dedupe_key = ? ORDER BY id LIMIT 1").pluck().get(dedupe) ?? null;
    if (taskId === null && ticket !== null) {
      const title = obs.title ?? `${repo}#${number}`;
      taskId = Number(
        store
          .prepare("INSERT INTO tasks (title, kind, state, assignee_agent, links_json, dedupe_key, created_at, updated_at) VALUES (?, 'ticket_pr', ?, ?, ?, ?, ?, ?)")
          .run(title, obs.state, obs.agent, links, dedupe, at, at).lastInsertRowid,
      );
      appendEvent(store, "task_created", { sessionId: null, taskId }, { title: clip(title), state: obs.state }, at);
    } else if (taskId !== null) {
      store.prepare("UPDATE tasks SET state = ?, links_json = ?, updated_at = ? WHERE id = ?").run(obs.state, links, at, taskId);
    }
    if (!changed) return;
    appendEvent(
      store,
      "pr_state_changed",
      { sessionId: null, taskId },
      {
        repo,
        pr: number,
        from: row?.state ?? null,
        to: obs.state,
        head_sha: obs.head_sha,
        approvals: obs.approvals,
        ci: obs.ci,
        owner_kind: obs.owner_kind,
        ...(obs.reason === null ? {} : { reason: obs.reason }),
      },
      at,
    );
  });
}

// ---- The due work ------------------------------------------------------------------------------

/** What the tracker reads GitHub through. */
export interface TrackerDeps {
  /** The GitHub client. Default: none, so `createRepoPolicyClient()` (the stored credential), built on first use. */
  readonly client?: () => PrGitHubClient;
}

/** One pass: the candidates, each read and recorded in turn. Nothing is built (no client, no Keychain read) when there are none. */
async function pass(ctx: DueWorkContext, deps: TrackerDeps, attempts: Attempts): Promise<void> {
  const candidates = candidatesOf(ctx.store, checkoutsOf(ctx.store), attempts);
  if (candidates.length === 0) return;
  const client = githubClientOf(deps.client);
  const identity = identityOf(ctx.store);
  for (const candidate of candidates) {
    attempts.seq += 1;
    attempts.last.set(keyOf(candidate.repo, candidate.number), attempts.seq);
    const obs = await observe(ctx.store, client, candidate, identity);
    if (obs !== undefined) record(ctx.store, candidate.repo, candidate.number, obs, ctx.now().toISOString());
  }
}

/**
 * The tracker's due work: it runs `pass` only when a `trigger_fired` event was
 * appended since the last tick it looked. The in-memory watermark is the highest
 * event id examined, so each tick scans only the new rows.
 */
export function createTrackerDueWork(deps: TrackerDeps = {}): DueWorkFn {
  let watermark = 0;
  const attempts: Attempts = { seq: 0, last: new Map() };
  return async (ctx) => {
    const top = ctx.store.prepare<[], number | null>("SELECT max(id) FROM events").pluck().get() ?? 0;
    if (top <= watermark) return;
    const fired = ctx.store.prepare<[number, number], 1>("SELECT 1 FROM events WHERE kind = 'trigger_fired' AND id > ? AND id <= ? LIMIT 1").pluck().get(watermark, top);
    watermark = top;
    if (fired === undefined) return;
    await pass(ctx, deps, attempts);
  };
}

/** The tracker part: one due work, no tool, route, handler or subcommand. */
export const trackerPart: ConsolePart = Object.freeze({
  name: "tracker",
  tools: Object.freeze([]),
  routes: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([createTrackerDueWork()]),
});
