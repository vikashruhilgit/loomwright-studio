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
import type { Store } from "../store/store.js";

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

/**
 * Every `connectors.permissions_source`, closed in code (no SQL CHECK): who
 * vouched for the token's permissions. `reported` is GitHub's own answer;
 * `declared` is the owner's word, recorded as theirs and never as verified
 * (GitHub publishes no permissions for a fine-grained token). A row from
 * before migration 18 reads null.
 */
export const CONNECTOR_PERMISSIONS_SOURCES = Object.freeze(["reported", "declared"] as const);

/** One of `CONNECTOR_PERMISSIONS_SOURCES`. */
export type ConnectorPermissionsSource = (typeof CONNECTOR_PERMISSIONS_SOURCES)[number];

/**
 * Every way a connector is connected, closed in code (no SQL CHECK): `token`
 * is a token the owner pasted, `app` is a GitHub App Studio created through
 * the App Manifest flow (D36) and installed. A row with no method reads `token`.
 */
export const CONNECTOR_METHODS = Object.freeze(["token", "app"] as const);

/** One of `CONNECTOR_METHODS`. */
export type ConnectorMethod = (typeof CONNECTOR_METHODS)[number];

/**
 * A `connectors` row (migrations 17 and 18). It never holds a secret: a connector's token lives only in the Keychain.
 *
 * `method`, `app_slug` and `installation_id` are optional because the table gets
 * those columns only in the GitHub App tokens item's migration 19; until then a
 * row has none and reads as `token`. For `method: app`, `permissions_source` is
 * always `reported` and `expires_at` is the current installation token's
 * expiry, which renews.
 */
export interface ConnectorRow {
  readonly id: number;
  readonly kind: ConnectorKind;
  readonly status: ConnectorStatus;
  readonly account_login: string | null;
  readonly permissions_json: string | null;
  readonly reachable_repos_json: string | null;
  readonly expires_at: string | null;
  readonly verified_at: string | null;
  /** Who vouched for `permissions_json` (migration 18); null before it, and while nothing was connected. */
  readonly permissions_source: ConnectorPermissionsSource | null;
  /** When the owner declared the permissions (ISO time); set only when `permissions_source` is `declared`. */
  readonly permissions_declared_at: string | null;
  /** How the connector is connected (migration 19); absent before it, which reads `token`. */
  readonly method?: ConnectorMethod;
  /** The App's slug, for `method: app` (migration 19); null or absent otherwise. */
  readonly app_slug?: string | null;
  /** The installation's id, for `method: app` (migration 19); null or absent otherwise. */
  readonly installation_id?: number | null;
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
 * has none) and its permissions (null when GitHub does not report them,
 * which is always so for a fine-grained token: probe p12, 2026-10-29, found
 * GitHub publishes none, so the owner may declare them instead; see
 * `ConnectorRow.permissions_source`).
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

// ---- The GitHub App connect (D36) ------------------------------------------------------

/**
 * Every way the App setup refuses or fails, closed in code: `setup_not_open`
 * (no setup window is open, or it was cancelled), `state_mismatch` (a return's
 * `state` is not the open window's single-use one), `setup_expired` (the window
 * is past its short life), `conversion_failed` (GitHub's manifest conversion
 * did not answer a usable app), `install_failed` (the installation or its first
 * token could not be recorded) and `token_write_scoped` (an installation token
 * carries a write permission: Studio stays read-only). A new list, apart from
 * the token path's `GITHUB_TOKEN_REFUSALS`.
 */
export const GITHUB_APP_SETUP_REFUSALS = Object.freeze([
  "setup_not_open",
  "state_mismatch",
  "setup_expired",
  "conversion_failed",
  "install_failed",
  "token_write_scoped",
] as const);

/** One of `GITHUB_APP_SETUP_REFUSALS`. */
export type GitHubAppSetupRefusal = (typeof GITHUB_APP_SETUP_REFUSALS)[number];

/**
 * The non-secret fields of GitHub's manifest conversion
 * (`POST /app-manifests/{code}/conversions`). The conversion's secrets are never
 * part of this type: `pem` is handed to the port apart and goes to the
 * Keychain, `client_secret` (and `webhook_secret`) is never stored, logged or returned.
 */
export interface GitHubAppConversion {
  readonly app_id: number;
  readonly slug: string;
  readonly name: string;
  readonly owner_login: string;
  readonly html_url: string;
  readonly client_id: string;
}

/**
 * Why a port method did not do its work: one of the setup refusals, or
 * `not_implemented` (a value the real port, `github/app-port.ts`, no longer answers).
 */
export type GitHubAppPortError = GitHubAppSetupRefusal | "not_implemented";

/** A port method's outcome: the connector row after the change, or a typed failure. Never a throw. */
export type GitHubAppPortResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: GitHubAppPortError; readonly message: string };

/**
 * The GitHub App connect's storage side: the real port is `github/app-port.ts`
 * (built by the kernel tokens item) and the setup flow calls it. Every method
 * resolves a `GitHubAppPortResult` and never throws or rejects. Dependencies
 * (the store, the clock) are parameters, as in `GitHubConnector`.
 */
export interface GitHubAppPort {
  /** Store the converted app (its `pem` goes to the Keychain, never to the store) and record it on the connector row. */
  storeApp(store: Store, conversion: GitHubAppConversion, pem: string, now: () => Date): Promise<GitHubAppPortResult<ConnectorRow>>;
  /** Record the installation, mint the first installation token and verify its permissions are read-only. */
  recordInstallation(store: Store, installationId: number, now: () => Date): Promise<GitHubAppPortResult<ConnectorRow>>;
  /** Remove the App connect: delete its Keychain item; the row reads `disconnected`. */
  removeApp(store: Store, now: () => Date): Promise<GitHubAppPortResult<ConnectorRow>>;
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
