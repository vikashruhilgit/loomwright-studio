// The `integrations` feature's shared types (phase 6): the contract every
// later phase 6 item codes against. Types and frozen lists only: the `studio`
// CLI loads the feature registry, which loads this feature, so nothing here
// may pull in the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph), and
// `features/contribution.ts` imports `ConnectorKind` from here type-only.
//
// Mechanism only (invariant 1): what to poll, how often and which filters are
// the user's, set per playbook; the kernel stores them as given.
import type { ConsolePart } from "../console/types.js";

// ---- Connectors --------------------------------------------------------------

/** Every connector kind the kernel knows, closed in code (no SQL CHECK on `connectors.kind`). */
export const CONNECTOR_KINDS = Object.freeze(["github"] as const);

/** One of `CONNECTOR_KINDS`. */
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

/**
 * Every `connectors.status`, closed in code: `connected` (verified),
 * `rejected` (the last token offered was refused), `disconnected` (the owner
 * removed it), `expiring` (verified, and its token expires soon) and
 * `expired`.
 */
export const CONNECTOR_STATUSES = Object.freeze(["connected", "rejected", "disconnected", "expiring", "expired"] as const);

/** One of `CONNECTOR_STATUSES`. */
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];

/** A `connectors` row (migration 17). It never holds a secret: a connector's token lives only in the Keychain. */
export interface ConnectorRow {
  readonly id: number;
  readonly kind: ConnectorKind;
  readonly status: ConnectorStatus;
  readonly account_login: string | null;
  readonly permissions_json: string | null;
  readonly reachable_repos_json: string | null;
  readonly expires_at: string | null;
  readonly verified_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * A `draft_outputs` row (migration 17): one outward call a draft-mode session
 * recorded instead of sending. `payload_json` is the call's (bounded) input
 * as JSON, and untrusted data like every tool input (invariant 3).
 */
export interface DraftOutputRow {
  readonly id: number;
  readonly session: number;
  readonly agent: string;
  readonly playbook: number | null;
  readonly playbook_run: number | null;
  readonly item_ref: string | null;
  readonly tool: string;
  readonly payload_json: string;
  readonly created_at: string;
}

// ---- Poll sources --------------------------------------------------------------

/**
 * A `poll` trigger's spec (its `spec_json`): which source to list, on which
 * repos, with which filters, how often. Every value is the user's, stored as
 * given (D4); the trigger validates it when it is created (item 04).
 */
export interface PollSpec {
  readonly source: "github.pulls";
  /** `<owner>/<repo>` names. */
  readonly repos: readonly string[];
  readonly filters: {
    readonly state?: string;
    readonly draft?: boolean;
    /** A GitHub login. */
    readonly author?: string;
  };
  readonly interval_seconds: number;
}

/**
 * One item a poll found: what a per-item playbook run is about. `ref` is
 * stable for the item (`github:<owner>/<repo>#<n>`) and `revision` changes
 * when it does (a PR's head SHA); they are the dedupe-key fields `item.id` and
 * `item.revision`. `title` is author-controlled text: untrusted data.
 */
export interface SourceItem {
  readonly ref: string;
  readonly revision: string;
  readonly title: string;
  readonly url: string;
  readonly updated_at: string;
}

// ---- The GitHub client ----------------------------------------------------------

/** GitHub's rate-limit headers (`x-ratelimit-limit`, `-remaining`, `-reset`), as of one response. */
export interface GitHubRateLimit {
  readonly limit: number;
  readonly remaining: number;
  /** ISO-8601 UTC: when `remaining` resets. */
  readonly reset_at: string;
}

/**
 * A GitHub call that did not answer with data. `rate_limited` (a 403 or 429
 * with a rate-limit reason) is returned, never thrown, so a caller backs off
 * until `resets_at`. `http_error` is any other non-2xx status. `unreachable`
 * is no response at all (network error or timeout), so it carries no rate
 * limit.
 */
export type GitHubFailure =
  | { readonly ok: false; readonly error: "rate_limited"; readonly resets_at: string; readonly rateLimit: GitHubRateLimit }
  | { readonly ok: false; readonly error: "http_error"; readonly status: number; readonly rateLimit: GitHubRateLimit }
  | { readonly ok: false; readonly error: "unreachable"; readonly rateLimit: null };

/** Every GitHub response: the data with the rate limit it was served under, or a failure. */
export type GitHubResponse<T> = { readonly ok: true; readonly data: T; readonly rateLimit: GitHubRateLimit } | GitHubFailure;

/**
 * What GitHub says about the token in use: its user, its expiry (null when it
 * has none) and its permissions (null when GitHub does not report them; how
 * it reports a fine-grained token's permissions is item 03's probe, NEEDS
 * VERIFICATION).
 */
export interface GitHubTokenInfo {
  readonly login: string;
  readonly expires_at: string | null;
  readonly permissions: Readonly<Record<string, string>> | null;
}

/** A repository the token can reach. */
export interface GitHubRepo {
  /** `<owner>/<repo>`. */
  readonly full_name: string;
  readonly private: boolean;
}

/** One open pull request as a listing shows it. `title` and `author` are author-controlled: untrusted data. */
export interface GitHubPullSummary {
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly draft: boolean;
  readonly head_sha: string;
  readonly url: string;
  readonly updated_at: string;
}

/** One pull request in full. Every text field but `url` and `head_sha` is author-controlled: untrusted data. */
export interface GitHubPull extends GitHubPullSummary {
  readonly body: string;
  readonly state: string;
  readonly base_ref: string;
  readonly head_ref: string;
  readonly labels: readonly string[];
}

/** A pull request's unified diff, cut at the byte bound asked for (`truncated` says whether it was). */
export interface GitHubPullDiff {
  readonly diff: string;
  readonly truncated: boolean;
}

/** One file a pull request changes. `path` is author-controlled: untrusted data. */
export interface GitHubPullFile {
  readonly path: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
}

/** One comment on a pull request: an issue comment, or a review comment on a file (`path`). */
export interface GitHubPullComment {
  readonly kind: "issue" | "review";
  readonly author: string;
  readonly body: string;
  readonly created_at: string;
  readonly path: string | null;
}

/** The open-pull listing's filters: `PollSpec.filters`, applied as given. */
export type GitHubPullFilters = PollSpec["filters"];

/**
 * The GitHub calls phase 6 makes, every one read-only: the token's user and
 * permissions and the repos it reaches (item 03), open pulls by repo and
 * filter (item 04), and a pull's detail, diff, files and comments (item 06).
 * Every response carries the rate limit it was served under. `repo` is
 * `<owner>/<repo>`. The real client is item 03's; tests use
 * `FakeGitHubClient` (`kernel/test/fixtures/github-fake.ts`), which never
 * reaches the network.
 */
export interface GitHubClient {
  getTokenInfo(): Promise<GitHubResponse<GitHubTokenInfo>>;
  listReachableRepos(): Promise<GitHubResponse<readonly GitHubRepo[]>>;
  listOpenPulls(repo: string, filters: GitHubPullFilters): Promise<GitHubResponse<readonly GitHubPullSummary[]>>;
  getPull(repo: string, number: number): Promise<GitHubResponse<GitHubPull>>;
  getPullDiff(repo: string, number: number, maxBytes: number): Promise<GitHubResponse<GitHubPullDiff>>;
  listPullFiles(repo: string, number: number): Promise<GitHubResponse<readonly GitHubPullFile[]>>;
  listPullComments(repo: string, number: number): Promise<GitHubResponse<readonly GitHubPullComment[]>>;
}

// ---- The feature's parts ----------------------------------------------------------

/**
 * One sub-file's share of the `integrations` contribution: the same shape as
 * a console part, merged by the same `mergeConsoleParts`
 * (`src/console/index.ts`). Each phase 6 item fills in only the part it owns
 * (`github/connector.ts` and `github/routes.ts` item 03, `github/tools.ts`
 * item 06, `drafts.ts` item 07); a part is empty until then.
 */
export type IntegrationsPart = ConsolePart;
