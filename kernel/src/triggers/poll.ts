// The `poll` trigger kind (phase 6 item 04): a playbook's trigger that lists
// a source (GitHub open pull requests, issues or PR comments on the user's
// repos; Jira issues or ClickUp tasks through the owner's MCP connection), with
// the user's filters, every `interval_seconds`, and queues one playbook
// `message` per item it finds. Mechanism only (invariant 1): the interval,
// repos and filters are the user's, stored as given; the kernel adds only the
// safety bounds below (the 60 s floor, `MAX_POLL_ITEMS`), and an LLM never
// decides when to look (invariant 2): the deterministic kernel fires it from
// the triggers contribution's due work.
//
// Validation (`checkPollSpec`, called by `registerTrigger` /
// `updateTriggerSpec` in `store.ts` before any write): the spec is the
// `PollSpec` as JSON text, with no `tz`. Shape errors are `invalid_spec`; the
// named refusals are `poll_filter_unknown`, `poll_interval_below_floor`,
// `poll_connector_missing` and `poll_repo_not_reachable`. A GitHub spec names
// `repos`; a `jira.issues` or `clickup.tasks` spec takes no `repos` and its
// per-source checks live in `./sources/jira-issues.ts` and
// `./sources/clickup-tasks.ts` (`docs/architecture/mcp-connectors.md`). The
// GitHub connector is read with raw SQL over `connectors` (migration 17),
// never through the integrations feature's values: usable means a `github` row
// whose status is `connected`, `expiring` or `needs_permissions`, and the
// repos it reaches are its `reachable_repos_json`, a JSON array of
// `owner/name` strings compared case-insensitively (unparseable: none). A
// tracker connection is read through `mcpConnectorGate`: usable means `open`,
// and a tracker spec has no reachable-repo check.
//
// Firing (`firePollTriggers`) is two-phase, because `GitHubClient` is async
// and `runStep` is one synchronous transaction:
// - Phase A writes nothing: it decides whether to fetch (the linked playbook
//   is `enabled`, the instant is outside every kill-switch and pause window,
//   the connector is usable and a client is wired), then lists every repo in
//   spec order, one after the other, outside any transaction. The first
//   failure stops the fetch.
// - Phase B is one `runStep` keyed `trigger:<id>:<instant>` that re-reads the
//   row (still enabled and due at the instant, else `skipped`), re-checks the
//   kill switch, the playbook, the windows and the connector, then writes the
//   effect (one `message` and one `poll_item_queued` per item), the
//   bookkeeping and its one `trigger_*` event.
// So a `kill -9` during Phase A leaves nothing on disk (the next tick fetches
// the same instant again), during Phase B commits all or nothing, and after
// it the done step replays, while `enqueueEvent`'s per-`source_ref`
// idempotency makes a second queue row for an item impossible.
//
// The next fire is always `now + interval_seconds` (never the scheduled
// instant plus the interval, so downtime coalesces into one poll), or
// `max(now + interval_seconds, resets_at)` after `rate_limited`. A
// `connector_missing` instant notifies the owner once per outage: only when
// the trigger's previous `last_result` was not already `connector_missing`. A
// Phase B that throws (other than a deferral) still moves the trigger off the
// instant, to `now + interval_seconds` or parked, so a failure that repeats
// never refetches the source on every tick (`movePollAfterFailure`).
//
// Imports: its own `fire-shared.ts` (never `store.ts` at runtime, so the two
// form no cycle), `../loop/*`, `../api/kill-switch.js`,
// `../notifications/record.js`, `../integrations/types.js` type-only, the
// source files, and from the integrations feature `mcpConnectorGate`
// (`../integrations/mcp/connector.js`) and the default ticket reader
// (`../integrations/mcp/trackers.js`): the MCP SDK client may load in this
// graph, the Agent SDK never.
import { isKillSwitchEngaged } from "../api/kill-switch.js";
import { mcpConnectorGate } from "../integrations/mcp/connector.js";
import type { McpKind } from "../integrations/mcp/rows.js";
import { MCP_TRACKERS, createMcpTicketReader } from "../integrations/mcp/trackers.js";
import type { McpTicketReader } from "../integrations/mcp/trackers.js";
import type { GitHubClient, GithubPollSpec, PollSpec, SourceItem } from "../integrations/types.js";
import { appendEvent, clip, errorMessage } from "../loop/internal.js";
import { enqueueEvent } from "../loop/queue.js";
import type { EnqueueParams } from "../loop/queue.js";
import { getWorkStep, runStep } from "../loop/steps.js";
import { InvalidNotificationError, MAX_NOTIFICATION_TITLE, recordNotification } from "../notifications/record.js";
import type { Store } from "../store/store.js";
import { TriggerError, fireStepKey, inKillSwitchWindow, inPauseWindow, killSwitchWindows, linkedPlaybook, pauseWindows } from "./fire-shared.js";
import type { LinkedPlaybook } from "./fire-shared.js";
import { checkClickupFilters, fetchClickupTasks } from "./sources/clickup-tasks.js";
import { fetchGithubIssues } from "./sources/github-issues.js";
import { fetchGithubPrComments } from "./sources/github-pr-comments.js";
import { fetchGithubPulls } from "./sources/github-pulls.js";
import type { SourceFetch } from "./sources/github-pulls.js";
import { checkJiraFilters, fetchJiraIssues } from "./sources/jira-issues.js";
import type { TriggerResult } from "./store.js";

/**
 * The sources a poll can list, closed in code. All five are built: the three
 * GitHub ones, and `jira.issues` and `clickup.tasks` (phase 8 item 07, through
 * the owner's MCP connection: `docs/architecture/mcp-connectors.md`).
 */
export const POLL_SOURCES = ["github.pulls", "github.issues", "github.pr_comments", "jira.issues", "clickup.tasks"] as const;

/** The sources that are built, in `POLL_SOURCES` order: the ones `PollSpec.source` names (and `parsePollSpec` parses). */
const BUILT_SOURCES = ["github.pulls", "github.issues", "github.pr_comments", "jira.issues", "clickup.tasks"] as const;
type BuiltSource = (typeof BUILT_SOURCES)[number];

/** The filter keys a poll can take, across every source: the union of `SOURCE_FILTER_KEYS` (`playbooks/drafts.ts` joins it as text). */
export const POLL_FILTER_KEYS = ["state", "draft", "author", "labels", "assignee", "site", "project", "status", "list", "space", "tags"] as const;

/**
 * The filter keys each built source takes (checked per source): `github.pulls`
 * takes `state` and `author` (strings) and `draft` (a boolean); `github.issues`
 * takes `state` and `assignee` (strings) and `labels` (a non-empty array of
 * strings); `github.pr_comments` takes none; `jira.issues` takes `site`
 * (required), `project`, `status` and `assignee` (strings) and `labels`;
 * `clickup.tasks` takes exactly one of `list` or `space`, and `status`,
 * `assignee` and `tags` (a non-empty array of strings).
 */
const SOURCE_FILTER_KEYS: Readonly<Record<BuiltSource, readonly (typeof POLL_FILTER_KEYS)[number][]>> = Object.freeze({
  "github.pulls": ["state", "draft", "author"],
  "github.issues": ["state", "labels", "assignee"],
  "github.pr_comments": [],
  "jira.issues": ["site", "project", "status", "labels", "assignee"],
  "clickup.tasks": ["list", "space", "status", "assignee", "tags"],
});

/** The fields of a GitHub poll spec, in the order it is stored. */
const POLL_SPEC_FIELDS = ["source", "repos", "filters", "interval_seconds"] as const;

/** The fields of a tracker poll spec (`jira.issues`, `clickup.tasks`): no `repos`. */
const TRACKER_SPEC_FIELDS = ["source", "filters", "interval_seconds"] as const;

/** The two ticket sources: the MCP connector kind each reads through. A tracker poll has no repos and no GitHub connector. */
const TRACKER_SOURCES: Readonly<Record<"jira.issues" | "clickup.tasks", McpKind>> = Object.freeze({ "jira.issues": "jira", "clickup.tasks": "clickup" });

/** The tracker a poll `source` reads (`kind` and the owner's name for it), or `undefined` for a GitHub source. */
export function trackerOf(source: string): { readonly kind: McpKind; readonly label: string } | undefined {
  if (!Object.hasOwn(TRACKER_SOURCES, source)) return undefined;
  const kind = TRACKER_SOURCES[source as keyof typeof TRACKER_SOURCES];
  return { kind, label: MCP_TRACKERS[kind].label };
}

/**
 * The most items one instant queues: a kernel safety bound (like
 * `MAX_COUNTED_INSTANTS`), not a policy. Beyond it the rest are dropped and
 * `trigger_fired` carries `items_capped: true` and `items_found`.
 */
export const MAX_POLL_ITEMS = 100;

/** Longest filter string (`state`, `author`, `assignee`, and each of `labels`). */
const MAX_FILTER_LENGTH = 200;

/** `owner/name`, each part GitHub's own characters, neither `.` nor `..` (checked apart). */
const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

/** A value from the input, quoted and clipped for a refusal message. */
function shown(value: unknown): string {
  return clip(JSON.stringify(value) ?? String(value), 80);
}

function isBuiltSource(source: string): source is BuiltSource {
  return (BUILT_SOURCES as readonly string[]).includes(source);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkRepos(value: unknown): string[] {
  const invalid = (why: string): TriggerError => new TriggerError("invalid_spec", why);
  if (!Array.isArray(value) || value.length === 0) throw invalid("a poll spec's repos must be a non-empty array of owner/name strings");
  const seen = new Set<string>();
  const repos: string[] = [];
  for (const repo of value) {
    if (typeof repo !== "string" || !REPO_PATTERN.test(repo) || repo.split("/").some((part) => part === "." || part === "..")) {
      throw invalid(`poll repo ${shown(repo)} is not an owner/name string`);
    }
    const folded = repo.toLowerCase();
    if (seen.has(folded)) throw invalid(`poll repo ${shown(repo)} is listed twice`);
    seen.add(folded);
    repos.push(repo);
  }
  return repos;
}

/** The filters object of a spec: `{}` when absent, an object whose every key `source` takes, else `invalid_spec` / `poll_filter_unknown`. */
function filterObject(value: unknown, source: BuiltSource): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new TriggerError("invalid_spec", "a poll spec's filters must be an object");
  const allowed: readonly string[] = SOURCE_FILTER_KEYS[source];
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    const takes = allowed.length === 0 ? "none" : allowed.join(", ");
    throw new TriggerError("poll_filter_unknown", `poll_filter_unknown: unknown poll filter ${unknown.map(shown).join(", ")}; the filters of ${source} are ${takes}`);
  }
  return value;
}

function checkGithubFilters(value: Record<string, unknown>): GithubPollSpec["filters"] {
  const text = (key: "state" | "author" | "assignee"): string | undefined => {
    const v = value[key];
    if (v === undefined) return undefined;
    if (typeof v !== "string" || v === "" || v.length > MAX_FILTER_LENGTH) {
      throw new TriggerError("invalid_spec", `poll filter ${key} must be a string of 1-${MAX_FILTER_LENGTH} characters`);
    }
    return v;
  };
  const state = text("state");
  const draft = value.draft;
  if (draft !== undefined && typeof draft !== "boolean") throw new TriggerError("invalid_spec", "poll filter draft must be true or false");
  const author = text("author");
  const assignee = text("assignee");
  const labels = value.labels;
  if (
    labels !== undefined &&
    (!Array.isArray(labels) || labels.length === 0 || labels.some((l) => typeof l !== "string" || l === "" || l.length > MAX_FILTER_LENGTH))
  ) {
    throw new TriggerError("invalid_spec", `poll filter labels must be a non-empty array of strings of 1-${MAX_FILTER_LENGTH} characters`);
  }
  return {
    ...(state === undefined ? {} : { state }),
    ...(draft === undefined ? {} : { draft }),
    ...(author === undefined ? {} : { author }),
    ...(labels === undefined ? {} : { labels: [...(labels as string[])] }),
    ...(assignee === undefined ? {} : { assignee }),
  };
}

/** `interval_seconds`: a whole number of seconds, at least the 60 s floor. */
function checkInterval(interval: unknown): number {
  if (typeof interval !== "number" || !Number.isSafeInteger(interval)) {
    throw new TriggerError("invalid_spec", `a poll spec's interval_seconds must be a whole number of seconds (got ${shown(interval)})`);
  }
  if (interval < 60) {
    throw new TriggerError("poll_interval_below_floor", `poll_interval_below_floor: interval_seconds ${interval} is below the 60 second floor`);
  }
  return interval;
}

/**
 * The `PollSpec` that JSON text `text` holds, normalized for storage
 * (`{source, repos, filters, interval_seconds}` for a GitHub source, repos and
 * filter values as given; `{source, filters, interval_seconds}` for
 * `jira.issues` and `clickup.tasks`, which take no `repos`). Throws
 * `TriggerError`: `invalid_spec` for a shape error, `poll_filter_unknown`
 * naming a filter key the spec's source does not take,
 * `poll_interval_below_floor` for an interval under 60 seconds.
 */
export function parsePollSpec(text: string): PollSpec {
  const invalid = (why: string): TriggerError => new TriggerError("invalid_spec", why);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    parsed = undefined;
  }
  if (!isPlainObject(parsed)) throw invalid("a poll spec must be JSON text of an object {source, repos, filters, interval_seconds}");
  const fields: readonly string[] = typeof parsed.source === "string" && trackerOf(parsed.source) !== undefined ? TRACKER_SPEC_FIELDS : POLL_SPEC_FIELDS;
  const extra = Object.keys(parsed).filter((key) => !fields.includes(key));
  if (extra.length > 0) throw invalid(`a poll spec has unknown field ${extra.map(shown).join(", ")}; its fields are ${fields.join(", ")}`);
  if (!(POLL_SOURCES as readonly unknown[]).includes(parsed.source)) throw invalid(`a poll spec's source must be one of ${POLL_SOURCES.join(", ")} (got ${shown(parsed.source)})`);
  const source = parsed.source as (typeof POLL_SOURCES)[number];
  if (!isBuiltSource(source)) throw invalid(`a poll spec's source ${shown(source)} has no parser`);
  if (source === "jira.issues") {
    const filters = checkJiraFilters(filterObject(parsed.filters, source));
    return { source, filters, interval_seconds: checkInterval(parsed.interval_seconds) };
  }
  if (source === "clickup.tasks") {
    const filters = checkClickupFilters(filterObject(parsed.filters, source));
    return { source, filters, interval_seconds: checkInterval(parsed.interval_seconds) };
  }
  const repos = checkRepos(parsed.repos);
  const filters = checkGithubFilters(filterObject(parsed.filters, source));
  return { source, repos, filters, interval_seconds: checkInterval(parsed.interval_seconds) };
}

/** The next fire of a poll processed (or registered) at `now`: `now + interval_seconds`. Throws `invalid_spec` past the last date. */
export function nextPollFire(now: Date, intervalSeconds: number): string {
  const next = new Date(now.getTime() + intervalSeconds * 1000);
  if (!Number.isFinite(next.getTime())) throw new TriggerError("invalid_spec", `a poll spec's interval_seconds ${intervalSeconds} puts its next fire past the last date`);
  return next.toISOString();
}

/** A poll spec's identity for the owner's-off re-registration check: its stored form (repos and filters as given). */
export function pollIdentity(spec: PollSpec): string {
  return `poll ${JSON.stringify(spec)}`;
}

/** The identity of a stored poll spec, or `undefined` when it cannot be read. */
export function storedPollIdentity(specJson: string): string | undefined {
  try {
    return pollIdentity(parsePollSpec(specJson));
  } catch {
    return undefined;
  }
}

/** What the kernel knows of the GitHub connector, from the `connectors` table. */
export interface ConnectorState {
  /** A `github` row whose status is `connected`, `expiring` or `needs_permissions`. */
  readonly usable: boolean;
  /** The newest `github` row's status, or `null` when there is none. */
  readonly status: string | null;
  /** The usable row's reachable repos, lower-cased. */
  readonly reachable: ReadonlySet<string>;
}

/**
 * The GitHub connector's state. Raw SQL over `connectors` (migration 17): the
 * triggers feature never imports the integrations feature's values. The
 * newest usable row decides; `reachable_repos_json` is a JSON array of
 * `owner/name` strings, and anything else reads as no repo.
 */
export function githubConnectorState(store: Store): ConnectorState {
  const rows = store
    .prepare<[], { status: string; reachable_repos_json: string | null }>("SELECT status, reachable_repos_json FROM connectors WHERE kind = 'github' ORDER BY id DESC")
    .all();
  const usable = rows.find((r) => r.status === "connected" || r.status === "expiring" || r.status === "needs_permissions");
  const reachable = new Set<string>();
  if (usable !== undefined && usable.reachable_repos_json !== null) {
    try {
      const parsed = JSON.parse(usable.reachable_repos_json) as unknown;
      if (Array.isArray(parsed)) for (const repo of parsed) if (typeof repo === "string") reachable.add(repo.toLowerCase());
    } catch {
      // Unparseable: no repo is reachable.
    }
  }
  return { usable: usable !== undefined, status: rows[0]?.status ?? null, reachable };
}

/**
 * The spec's own checks, with no store read: `tz` absent (`invalid_spec`),
 * then `parsePollSpec`. A re-schedule runs these first and the connector
 * checks only when the spec changes, so an unchanged re-save stays no change
 * while GitHub is disconnected.
 */
export function checkPollShape(spec: string, tz: string | undefined): PollSpec {
  if (tz !== undefined) throw new TriggerError("invalid_spec", "a poll spec takes no tz: its interval_seconds is a duration");
  return parsePollSpec(spec);
}

/** A validated poll spec: what is stored, its identity and its first fire. */
export interface CheckedPollSpec {
  readonly spec: PollSpec;
  readonly identity: string;
  readonly nextFireAt: string;
}

/**
 * Validate a poll spec at `now` (see `parsePollSpec`), then the connector:
 * `poll_connector_missing` when no `github` connector is usable (a tracker
 * spec: when its kind's MCP row is not usable, named with its status), and
 * `poll_repo_not_reachable` naming every repo it does not reach (a tracker
 * spec has no repos to check). `tz` must be absent (`invalid_spec`). Reads
 * only; the caller writes after it returns.
 */
export function checkPollSpec(store: Store, spec: string, tz: string | undefined, now: Date): CheckedPollSpec {
  const parsed = checkPollShape(spec, tz);
  if (parsed.source === "jira.issues" || parsed.source === "clickup.tasks") {
    const kind = TRACKER_SOURCES[parsed.source];
    const gate = mcpConnectorGate(store, kind);
    if (gate.kind !== "open") {
      throw new TriggerError(
        "poll_connector_missing",
        `poll_connector_missing: no connected ${kind} connector (status ${gate.status ?? "none"}); connect ${MCP_TRACKERS[kind].label} before creating a poll`,
      );
    }
    return { spec: parsed, identity: pollIdentity(parsed), nextFireAt: nextPollFire(now, parsed.interval_seconds) };
  }
  const connector = githubConnectorState(store);
  if (!connector.usable) {
    throw new TriggerError("poll_connector_missing", `poll_connector_missing: no connected GitHub connector (status ${connector.status ?? "none"}); connect GitHub before creating a poll`);
  }
  const unreachable = parsed.repos.filter((repo) => !connector.reachable.has(repo.toLowerCase()));
  if (unreachable.length > 0) throw new TriggerError("poll_repo_not_reachable", `poll_repo_not_reachable: the GitHub connector does not reach ${unreachable.join(", ")}`);
  return { spec: parsed, identity: pollIdentity(parsed), nextFireAt: nextPollFire(now, parsed.interval_seconds) };
}

// ---- Firing ------------------------------------------------------------------

/** A `triggers` row as a poll fire reads it. */
interface PollRow {
  readonly id: number;
  readonly owning_agent: string;
  readonly playbook: string | null;
  readonly kind: string;
  readonly spec_json: string;
  readonly action: string;
  readonly enabled: number;
  readonly next_fire_at: string | null;
  readonly last_result: string | null;
}

const POLL_COLUMNS = "id, owning_agent, playbook, kind, spec_json, action, enabled, next_fire_at, last_result";

function readPollRow(store: Store, id: number): PollRow | undefined {
  return store.prepare<[number], PollRow>(`SELECT ${POLL_COLUMNS} FROM triggers WHERE id = ?`).get(id);
}

/** What one due poll came to. */
export interface PollFireOutcome {
  readonly trigger_id: number;
  /** The due instant: the work step's key (`trigger:<id>:<scheduled_at>`). */
  readonly scheduled_at: string;
  /**
   * `skipped`: no longer due there, or its linked playbook is not `enabled` (recorded as a miss).
   * `already_done`: the instant's step was already done, so the trigger was moved past it.
   * `deferred`: something changed during the fetch that the fetch did not cover (the kill switch was engaged, or
   * the instant became fetchable after Phase A decided not to fetch); nothing was written, the next tick redoes it.
   */
  readonly result: TriggerResult | "skipped" | "already_done" | "deferred";
  /** How many messages were queued (`fired` only). */
  readonly items?: number;
}

/** What Phase A's fetch came to: the items (capped) and how many were found, or the first repo's failure. */
export type Fetched =
  | { readonly ok: true; readonly items: readonly SourceItem[]; readonly found: number }
  | { readonly ok: false; readonly error: "rate_limited"; readonly repo: string; readonly resets_at: string }
  | { readonly ok: false; readonly error: "http_error" | "unreachable" | "client_error"; readonly repo: string; readonly status?: number; readonly message?: string };

/** A GitHub source asked to fetch with no client: a fixed failure, never a throw. Callers gate on the client first, so this is a guard. */
function noGithubClient(spec: GithubPollSpec): SourceFetch {
  return { ok: false, error: "client_error", repo: spec.repos[0] ?? "", message: "no_github_client" };
}

/** A tracker source asked to fetch with no store to read its connection from: a fixed failure, never a throw. */
function noStore(scope: string): SourceFetch {
  return { ok: false, error: "client_error", repo: scope, message: "connector_missing" };
}

/** The fetch of `spec.source`, from `./sources/<source>.ts`: the one dispatch on the source. */
function fetchSource(github: GitHubClient | undefined, spec: PollSpec, tickets: McpTicketReader, store: Store | undefined): Promise<SourceFetch> {
  switch (spec.source) {
    case "github.issues":
      return github === undefined ? Promise.resolve(noGithubClient(spec)) : fetchGithubIssues(github, spec);
    case "github.pr_comments":
      return github === undefined ? Promise.resolve(noGithubClient(spec)) : fetchGithubPrComments(github, spec);
    case "github.pulls":
      return github === undefined ? Promise.resolve(noGithubClient(spec)) : fetchGithubPulls(github, spec);
    case "jira.issues":
      return store === undefined ? Promise.resolve(noStore(`jira:${spec.filters.site}`)) : fetchJiraIssues(tickets, store, spec, MAX_POLL_ITEMS);
    case "clickup.tasks":
      return store === undefined ? Promise.resolve(noStore("clickup")) : fetchClickupTasks(tickets, store, spec);
  }
}

/**
 * Phase A's fetch: dispatches by `spec.source` to `./sources/<source>.ts`.
 * Items are repos in spec order, then each source's own order (pulls and
 * issues by ascending number, comments by pull request, kind and id; tickets
 * by updated time, then ref), at most `MAX_POLL_ITEMS`; `found` counts them
 * before the cap. The first failure stops it. A GitHub source needs `github`
 * (its callers gate on it first); a tracker source uses only `tickets` (the
 * kernel's reader, default the real one, whose Keychain is read only when a
 * fetch gets that far) and the `store` its connection row is read from.
 */
export async function fetchPollItems(github: GitHubClient | undefined, spec: PollSpec, tickets: McpTicketReader = createMcpTicketReader(), store?: Store): Promise<Fetched> {
  const fetched = await fetchSource(github, spec, tickets, store);
  if (!fetched.ok) return fetched;
  return { ok: true, items: fetched.items.slice(0, MAX_POLL_ITEMS), found: fetched.items.length };
}

/** Whether a due poll may fetch now, or which miss its instant is. */
type Gate =
  | { readonly kind: "playbook_not_enabled"; readonly status: string | null }
  | { readonly kind: "kill_switch" }
  | { readonly kind: "paused" }
  | { readonly kind: "connector_missing"; readonly status: string | null; readonly client: boolean; readonly tracker?: { readonly kind: McpKind; readonly label: string } }
  | { readonly kind: "open"; readonly playbook: LinkedPlaybook; readonly github: GitHubClient | undefined };

/**
 * The checks before a fetch, in order (the same in Phase A and Phase B): the
 * linked playbook is `enabled`; the instant is outside every kill-switch
 * window, then every pause window (or the kernel is not paused); a `github`
 * connector is usable and a client is wired (a tracker poll: its MCP
 * connection is `open` in `mcpConnectorGate`, and no GitHub is involved).
 */
function gateOf(store: Store, row: PollRow, spec: PollSpec, scheduledAt: string, github: GitHubClient | undefined): Gate {
  const linked = row.playbook === null ? undefined : linkedPlaybook(store, row.playbook);
  if (linked === undefined || linked.status !== "enabled") return { kind: "playbook_not_enabled", status: linked?.status ?? null };
  if (inKillSwitchWindow(killSwitchWindows(store), scheduledAt)) return { kind: "kill_switch" };
  if (inPauseWindow(pauseWindows(store), scheduledAt)) return { kind: "paused" };
  if (spec.source === "jira.issues" || spec.source === "clickup.tasks") {
    const kind = TRACKER_SOURCES[spec.source];
    const mcp = mcpConnectorGate(store, kind);
    if (mcp.kind !== "open") return { kind: "connector_missing", status: mcp.status, client: false, tracker: { kind, label: MCP_TRACKERS[kind].label } };
    return { kind: "open", playbook: linked, github: undefined };
  }
  const connector = githubConnectorState(store);
  if (!connector.usable || github === undefined) return { kind: "connector_missing", status: connector.status, client: github !== undefined };
  return { kind: "open", playbook: linked, github };
}

/** Thrown inside Phase B's step to roll it back with nothing written: the next tick redoes the instant. */
class PollDeferred extends Error {
  constructor(why: string) {
    super(why);
    this.name = "PollDeferred";
  }
}

/** The `connector_missing` notification's title (`label` names the tracker; GitHub's text is unchanged): clipped to `MAX_NOTIFICATION_TITLE`. */
function missingTitle(id: number, label: string = "GitHub"): string {
  return clip(`Poll trigger ${id}: ${label} not connected`, MAX_NOTIFICATION_TITLE - 1);
}

/**
 * Phase B: the instant's work step, inside `runStep`'s transaction. Re-reads
 * the row (`skipped` unless still enabled and due at `scheduledAt`), defers
 * while the kill switch is engaged, re-runs the gate, then writes the miss or
 * the fire with its bookkeeping and one `trigger_*` event.
 */
function recordInstant(store: Store, id: number, scheduledAt: string, spec: PollSpec, fetched: Fetched | undefined, github: GitHubClient | undefined, now: Date): PollFireOutcome {
  const skipped: PollFireOutcome = { trigger_id: id, scheduled_at: scheduledAt, result: "skipped" };
  const row = readPollRow(store, id);
  if (row === undefined || row.enabled !== 1 || row.kind !== "poll") return skipped;
  if (row.next_fire_at !== scheduledAt) return skipped;
  if (isKillSwitchEngaged(store)) throw new PollDeferred("the kill switch was engaged during the fetch");
  const at = now.toISOString();
  const ref = { sessionId: null, taskId: null };
  const gate = gateOf(store, row, spec, scheduledAt, github);
  let next = nextPollFire(now, spec.interval_seconds);
  const missed = (result: TriggerResult | null, payload: Record<string, unknown>): PollFireOutcome => {
    // `playbook_not_enabled` leaves `last_result` as it was (as the cron path does).
    if (result === null) store.prepare("UPDATE triggers SET next_fire_at = ? WHERE id = ?").run(next, id);
    else store.prepare("UPDATE triggers SET last_result = ?, next_fire_at = ? WHERE id = ?").run(result, next, id);
    appendEvent(store, "trigger_missed", ref, { trigger_id: id, ...payload, scheduled_at: scheduledAt, enabled: true, next_fire_at: next }, at);
    return result === null ? skipped : { trigger_id: id, scheduled_at: scheduledAt, result };
  };

  if (gate.kind === "playbook_not_enabled") return missed(null, { reason: "playbook_not_enabled", playbook: row.playbook, playbook_status: gate.status });
  if (gate.kind === "kill_switch") return missed("missed_kill_switch", { reason: "kill_switch" });
  if (gate.kind === "paused") return missed("missed_paused", { reason: "paused" });
  if (gate.kind === "connector_missing") {
    // Notify once per outage: only the first missing instant after any other result.
    let notification: { notification_id: number } | Record<string, never> = {};
    const label = gate.tracker?.label ?? "GitHub";
    const body =
      gate.tracker !== undefined
        ? `Trigger ${id} (playbook ${row.playbook ?? "-"}) found no connected ${label} connector at ${scheduledAt}. It fetches nothing and records each instant connector_missing until ${label} is connected again.`
        : `Trigger ${id} (playbook ${row.playbook ?? "-"}) found ${gate.client ? "no connected GitHub connector" : "no GitHub client in the kernel"} at ${scheduledAt}. It fetches nothing and records each instant connector_missing until GitHub is connected again.`;
    if (row.last_result !== "connector_missing") notification = { notification_id: recordNotification(store, { source: `trigger:${id}`, title: missingTitle(id, label), body }, now).id };
    const who = gate.tracker === undefined ? { client: gate.client } : { connector: gate.tracker.kind };
    return missed("connector_missing", { reason: "connector_missing", connector_status: gate.status, ...who, ...notification });
  }
  // Open now, but Phase A decided not to fetch: fetch on the next tick rather than guess.
  if (fetched === undefined) throw new PollDeferred("the poll became fetchable after the fetch was decided");
  if (!fetched.ok) {
    if (fetched.error === "rate_limited") {
      const resetMs = Date.parse(fetched.resets_at);
      next = new Date(Math.max(Date.parse(next), Number.isFinite(resetMs) ? resetMs : 0)).toISOString();
      return missed("rate_limited", { reason: "rate_limited", repo: fetched.repo, resets_at: fetched.resets_at });
    }
    return missed("source_error", {
      reason: "source_error",
      repo: fetched.repo,
      error: fetched.error,
      ...(fetched.status === undefined ? {} : { status: fetched.status }),
      ...(fetched.message === undefined ? {} : { message: fetched.message }),
    });
  }

  const playbook = gate.playbook;
  for (const item of fetched.items) {
    // A stored priority outside the closed set makes `enqueueEvent` throw: this step fails, never a guessed priority.
    const queued = enqueueEvent(
      store,
      {
        kind: "message",
        payload: { agent: playbook.owning_agent, playbook: playbook.id, version: playbook.version, trigger_id: id, scheduled_at: scheduledAt, item },
        priority: playbook.priority as EnqueueParams["priority"],
        sourceRef: `playbook:${playbook.id}:${scheduledAt}:${item.ref}`,
      },
      now,
    );
    appendEvent(store, "poll_item_queued", ref, { trigger_id: id, playbook_id: playbook.id, item_ref: item.ref, revision: item.revision, queue_id: queued.id }, at);
  }
  const capped = fetched.found > fetched.items.length;
  store.prepare("UPDATE triggers SET last_fired_at = ?, last_result = 'fired', next_fire_at = ? WHERE id = ?").run(at, next, id);
  appendEvent(
    store,
    "trigger_fired",
    ref,
    {
      trigger_id: id,
      action: row.action,
      playbook: row.playbook,
      playbook_id: playbook.id,
      scheduled_at: scheduledAt,
      items: fetched.items.length,
      ...(capped ? { items_capped: true, items_found: fetched.found } : {}),
      enabled: true,
      next_fire_at: next,
    },
    at,
  );
  return { trigger_id: id, scheduled_at: scheduledAt, result: "fired", items: fetched.items.length };
}

/**
 * A due poll whose step for `scheduledAt` was already done (the clock stepped
 * back, or the row was put back): the step replayed and nothing moved it.
 * Moves it to `now + interval_seconds` with one `trigger_missed` (reason
 * `already_done`), in one transaction, if it is still enabled and due there.
 */
function movePollPastDone(store: Store, id: number, scheduledAt: string, spec: PollSpec, now: Date): PollFireOutcome {
  const at = now.toISOString();
  return store.transaction((): PollFireOutcome => {
    const current = readPollRow(store, id);
    if (current === undefined || current.enabled !== 1 || current.next_fire_at !== scheduledAt) return { trigger_id: id, scheduled_at: scheduledAt, result: "skipped" };
    const next = nextPollFire(now, spec.interval_seconds);
    store.prepare("UPDATE triggers SET next_fire_at = ? WHERE id = ?").run(next, id);
    appendEvent(store, "trigger_missed", { sessionId: null, taskId: null }, { trigger_id: id, reason: "already_done", scheduled_at: scheduledAt, enabled: true, next_fire_at: next }, at);
    return { trigger_id: id, scheduled_at: scheduledAt, result: "already_done" };
  });
}

/** A poll whose stored spec cannot be read is parked (no next fire): reported once, never every tick. The owner's off/on recomputes it. */
function parkPoll(store: Store, id: number, scheduledAt: string): void {
  try {
    store.prepare("UPDATE triggers SET next_fire_at = NULL WHERE id = ? AND next_fire_at = ?").run(id, scheduledAt);
  } catch {
    // The store is failing too: the next tick tries again.
  }
}

/**
 * A poll whose Phase B threw (rolled back, nothing written for the instant)
 * would stay due there and refetch the source on every tick, spending the
 * shared GitHub quota on a failure that may repeat each time (a stored
 * playbook priority `enqueueEvent` refuses). So it moves off the instant here:
 * parked (no next fire) when the notification record refused the row, as the
 * time-based fire does, or when no next fire can be computed; otherwise to
 * `now + interval_seconds`, so a repeating failure refetches at the user's
 * interval, never every tick. Answers what it did, for the failure message.
 */
function movePollAfterFailure(store: Store, id: number, scheduledAt: string, spec: PollSpec, now: Date, err: unknown): string {
  let next: string | undefined;
  if (!(err instanceof InvalidNotificationError)) {
    try {
      next = nextPollFire(now, spec.interval_seconds);
    } catch {
      // Past the last date: parked below.
    }
  }
  if (next === undefined) {
    parkPoll(store, id, scheduledAt);
    return "parked: no next fire";
  }
  try {
    store.prepare("UPDATE triggers SET next_fire_at = ? WHERE id = ? AND next_fire_at = ?").run(next, id, scheduledAt);
  } catch {
    // The store is failing too: the next tick tries again.
  }
  return `next fire ${next}`;
}

/** Phase A then Phase B for one due poll. */
async function fireOnePoll(store: Store, github: GitHubClient | undefined, row: PollRow, now: Date, tickets: McpTicketReader): Promise<PollFireOutcome> {
  const scheduledAt = row.next_fire_at as string;
  const key = fireStepKey(row.id, scheduledAt);
  let spec: PollSpec;
  try {
    spec = parsePollSpec(row.spec_json);
  } catch (err) {
    parkPoll(store, row.id, scheduledAt);
    throw new Error(`${errorMessage(err)} (parked: no next fire)`);
  }
  // Phase A: no writes. An instant whose step is already done is never fetched again.
  let fetched: Fetched | undefined;
  if (getWorkStep(store, key) === undefined) {
    const gate = gateOf(store, row, spec, scheduledAt, github);
    if (gate.kind === "open") fetched = await fetchPollItems(gate.github, spec, tickets, store);
  }
  // Phase B: one transaction.
  let outcome: PollFireOutcome;
  try {
    outcome = runStep(store, key, () => recordInstant(store, row.id, scheduledAt, spec, fetched, github, now), { now: () => now });
  } catch (err) {
    if (err instanceof PollDeferred) return { trigger_id: row.id, scheduled_at: scheduledAt, result: "deferred" };
    // Still reported (the loop's `due_work_failed`), once per move rather than once per tick.
    throw new Error(`${errorMessage(err)} (${movePollAfterFailure(store, row.id, scheduledAt, spec, now, err)})`);
  }
  // Every recorded instant moves the trigger past it: still due there means the step replayed a done result.
  const after = readPollRow(store, row.id);
  return after?.enabled === 1 && after.next_fire_at === scheduledAt ? movePollPastDone(store, row.id, scheduledAt, spec, now) : outcome;
}

/**
 * Fire every enabled `poll` trigger whose next fire is at or before `now`,
 * earliest first, each instant at most once (see the header). Nothing runs
 * while the kill switch is engaged. `github` is the kernel's client
 * (`DueWorkContext.github`); without one, a due poll records
 * `connector_missing` and never throws. `tickets` is the kernel's reader of
 * the Jira and ClickUp connections (default the real one). One trigger's failure never stops the
 * others: they all run, then the failures are thrown as one error naming
 * each (one `due_work_failed` from the loop).
 */
export async function firePollTriggers(
  store: Store,
  github: GitHubClient | undefined,
  now: Date = new Date(),
  tickets: McpTicketReader = createMcpTicketReader(),
): Promise<PollFireOutcome[]> {
  if (isKillSwitchEngaged(store)) return [];
  const due = store
    .prepare<[string], PollRow>(
      `SELECT ${POLL_COLUMNS} FROM triggers WHERE kind = 'poll' AND enabled = 1 AND next_fire_at IS NOT NULL AND next_fire_at <= ? ORDER BY next_fire_at, id`,
    )
    .all(now.toISOString());
  const outcomes: PollFireOutcome[] = [];
  const failures: string[] = [];
  for (const row of due) {
    try {
      outcomes.push(await fireOnePoll(store, github, row, now, tickets));
    } catch (err) {
      failures.push(`trigger ${row.id}: ${errorMessage(err)}`);
    }
  }
  if (failures.length > 0) throw new Error(clip(failures.join("; ")));
  return outcomes;
}
