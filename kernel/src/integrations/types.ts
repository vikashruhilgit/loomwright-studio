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
export const CONNECTOR_KINDS = Object.freeze(["github", "jira", "clickup"] as const);

/** One of `CONNECTOR_KINDS`. */
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

/**
 * Every `connectors.status`, closed in code: `connected` (verified),
 * `rejected` (the last token offered was refused), `disconnected` (the owner
 * removed it), `expiring` (verified, and its token expires soon),
 * `expired`, and `needs_permissions` (a GitHub App install that works but
 * reports fewer permissions than the App asks for: the owner accepts them on
 * github.com; the credential is still in use).
 */
export const CONNECTOR_STATUSES = Object.freeze(["connected", "rejected", "disconnected", "expiring", "expired", "needs_permissions"] as const);

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
 * A GitHub poll trigger's spec (its `spec_json`): which source to list, on which
 * repos, with which filters, how often. Every value is the user's, stored as
 * given (D4); the trigger validates it when it is created (item 04).
 */
export interface GithubPollSpec {
  /** The GitHub sources. */
  readonly source: "github.pulls" | "github.issues" | "github.pr_comments";
  /** `<owner>/<repo>` names. */
  readonly repos: readonly string[];
  /** Which keys a source takes is the poll's check (`parsePollSpec`): `github.pulls` takes `state`/`draft`/`author`, `github.issues` takes `state`/`labels`/`assignee`, `github.pr_comments` none. */
  readonly filters: {
    readonly state?: string;
    readonly draft?: boolean;
    /** A GitHub login. */
    readonly author?: string;
    /** Label names an issue must all carry (`github.issues`). */
    readonly labels?: readonly string[];
    /** A GitHub login an issue is assigned to (`github.issues`). */
    readonly assignee?: string;
  };
  readonly interval_seconds: number;
}

/**
 * A `jira.issues` poll's spec (phase 8 item 07): no `repos`; the Atlassian
 * `site` is the owner's, per poll, and goes to the server as `cloudId`. Every
 * other filter is optional. The kernel builds the JQL from these only.
 */
export interface JiraPollSpec {
  readonly source: "jira.issues";
  readonly filters: {
    /** The Atlassian site, for example `acme.atlassian.net`. */
    readonly site: string;
    readonly project?: string;
    readonly status?: string;
    readonly assignee?: string;
    /** Label names an issue must all carry. */
    readonly labels?: readonly string[];
  };
  readonly interval_seconds: number;
}

/**
 * A `clickup.tasks` poll's spec (phase 8 item 07): no `repos`; exactly one of
 * `list` or `space` scopes it (the parse enforces that; the type cannot).
 */
export interface ClickupPollSpec {
  readonly source: "clickup.tasks";
  readonly filters: {
    /** A ClickUp list id. */
    readonly list?: string;
    /** A ClickUp space id. */
    readonly space?: string;
    readonly status?: string;
    readonly assignee?: string;
    /** Tag names a task must all carry; the kernel applies them again on the parsed tasks. */
    readonly tags?: readonly string[];
  };
  readonly interval_seconds: number;
}

/** A `poll` trigger's spec: one of the three source families. */
export type PollSpec = GithubPollSpec | JiraPollSpec | ClickupPollSpec;

/**
 * One item a poll found: what a per-item playbook run is about. `ref` is
 * stable for the item (`github:<owner>/<repo>#<n>`, or
 * `…#<pr>:<kind>:<comment id>` for a PR comment; `jira:<site>/<KEY>`;
 * `clickup:<task id>`) and `revision` changes when it does (a PR's head SHA, an
 * issue's, a comment's or a ticket's updated time); they are the dedupe-key
 * fields `item.id` and `item.revision`. `title`, `text` (an issue's, a comment's
 * or a ticket's body), `author` and `status` are author-controlled text:
 * untrusted data. `text`, `author`, `kind` and `pr` are set by the issue and
 * comment sources only; a ticket source sets `text` and `status`.
 */
export interface SourceItem {
  readonly ref: string;
  readonly revision: string;
  readonly title: string;
  readonly url: string;
  readonly updated_at: string;
  /** The issue's, comment's or ticket's body: untrusted data. */
  readonly text?: string;
  /** The issue's or comment's author login: untrusted data. */
  readonly author?: string;
  /** A PR comment's kind (`github.pr_comments`). */
  readonly kind?: GitHubPrComment["kind"];
  /** The pull request a comment is on (`github.pr_comments`). */
  readonly pr?: number;
  /** A ticket's status name (`jira.issues`, `clickup.tasks`): untrusted data. */
  readonly status?: string;
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

/** The open-pull listing's filters: `GithubPollSpec.filters`, applied as given. */
export type GitHubPullFilters = GithubPollSpec["filters"];

/** The issue listing's filters (`state`, `labels`, `assignee`): the slice of `GithubPollSpec.filters` a `github.issues` poll takes, passed to GitHub as given. */
export type GitHubIssueFilters = Pick<GithubPollSpec["filters"], "state" | "labels" | "assignee">;

/** One issue as a listing shows it (a pull request is never one). `title`, `body`, `author` and `labels` are author-controlled: untrusted data. */
export interface GitHubIssueSummary {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly author: string;
  readonly labels: readonly string[];
  readonly url: string;
  readonly updated_at: string;
}

/**
 * One comment, or one review, on an open pull request, as the comment source
 * reads it. The three kinds are three GitHub id spaces, so `id` is unique only
 * within a `kind`. `updated_at` is the comment's own, and a review's
 * `submitted_at` (a review has no `updated_at`). `author` and `body` are
 * author-controlled: untrusted data.
 */
export interface GitHubPrComment {
  readonly kind: "issue_comment" | "review_comment" | "review";
  readonly id: number;
  /** The pull request's number. */
  readonly pr: number;
  readonly author: string;
  readonly body: string;
  readonly url: string;
  readonly updated_at: string;
}

/** What GitHub answers a created comment: kernel values only, the new comment's numeric id and its `html_url`. */
export interface GitHubCommentResult {
  readonly id: number;
  readonly url: string;
}

/**
 * The GitHub calls the kernel makes. The reads: the token's user and
 * permissions and the repos it reaches (phase 6 item 03), open pulls by repo
 * and filter (item 04), a pull's detail, diff, files and comments (item 06),
 * and the issue and the open-PR comment listings the `github.issues` and
 * `github.pr_comments` poll sources read (phase 8 item 05). The writes (the
 * last four, phase 8 item 05) are sent only with a GitHub App installation
 * credential: with the owner's token (PAT) they send nothing and answer
 * `unreachable` (the token path stays read-only). Every response carries the
 * rate limit it was served under. `repo` is `<owner>/<repo>`. The real client
 * is item 03's; tests use `FakeGitHubClient`
 * (`kernel/test/fixtures/github-fake.ts`), which never reaches the network.
 */
export interface GitHubClient {
  getTokenInfo(): Promise<GitHubResponse<GitHubTokenInfo>>;
  listReachableRepos(): Promise<GitHubResponse<readonly GitHubRepo[]>>;
  listOpenPulls(repo: string, filters: GitHubPullFilters): Promise<GitHubResponse<readonly GitHubPullSummary[]>>;
  getPull(repo: string, number: number): Promise<GitHubResponse<GitHubPull>>;
  getPullDiff(repo: string, number: number, maxBytes: number): Promise<GitHubResponse<GitHubPullDiff>>;
  listPullFiles(repo: string, number: number): Promise<GitHubResponse<readonly GitHubPullFile[]>>;
  listPullComments(repo: string, number: number): Promise<GitHubResponse<readonly GitHubPullComment[]>>;
  /** Issues (never pull requests) by repo, `state`/`labels`/`assignee` passed to GitHub as given. */
  listIssues(repo: string, filters: GitHubIssueFilters): Promise<GitHubResponse<readonly GitHubIssueSummary[]>>;
  /** For every open pull request: its conversation comments, its review comments and its reviews. */
  listOpenPullComments(repo: string): Promise<GitHubResponse<readonly GitHubPrComment[]>>;
  /** Write: reply in a review comment's thread. App credential only. */
  replyToReviewComment(repo: string, pull: number, commentId: number, body: string): Promise<GitHubResponse<GitHubCommentResult>>;
  /** Write: a conversation comment on a pull request. App credential only. */
  createPullComment(repo: string, pull: number, body: string): Promise<GitHubResponse<GitHubCommentResult>>;
  /** Write: a comment on an issue. App credential only. */
  createIssueComment(repo: string, issue: number, body: string): Promise<GitHubResponse<GitHubCommentResult>>;
  /** Write: ask for (or re-request) reviews from `reviewers` (logins). App credential only; answers the pull request's number. */
  requestReviewers(repo: string, pull: number, reviewers: readonly string[]): Promise<GitHubResponse<{ readonly pull: number }>>;
}

// ---- The repo-policy reads (phase 8 item 08) --------------------------------------------

/** What `GET /repos/{r}` says that detection needs: the default branch and whether the repo is private. */
export interface GitHubRepoInfo {
  readonly default_branch: string;
  readonly private: boolean;
}

/**
 * A branch's protection as GitHub reports it. `required_approving_review_count`
 * is `null` when protection has no pull-request review rule (a rule asking for
 * 0 approvals reads 0). `required_checks` are the required status checks' names.
 */
export interface GitHubBranchProtection {
  readonly required_approving_review_count: number | null;
  readonly required_checks: readonly string[];
}

/**
 * A head commit's CI as `getPullMergeState` derives it: `green` (every check run
 * finished `success`, `neutral` or `skipped`, and the combined status is `success`
 * or there are no statuses), `pending`, `failing`, or `none` (no check runs and no statuses at all).
 */
export type GitHubCiState = "green" | "pending" | "failing" | "none";

/**
 * What decides whether a pull request may merge, read at one moment. `head_sha`
 * is the pull's current head. `approvals` counts distinct reviewers whose latest
 * deciding review is `APPROVED` and was made on `head_sha` (a stale approval never
 * counts); `changes_requested` is whether any reviewer's latest deciding review is `CHANGES_REQUESTED`.
 */
export interface GitHubPullMergeState {
  readonly head_sha: string;
  readonly approvals: number;
  readonly changes_requested: boolean;
  readonly ci: GitHubCiState;
}

/**
 * The extra GitHub reads the repo merge policy makes (phase 8 item 08), all GETs.
 * A separate interface, not more members of `GitHubClient`, so a test's own
 * `GitHubClient` implementation keeps compiling. `createGitHubClient` and
 * `FakeGitHubClient` implement both. Every read answers `unreachable` for a bad
 * repo path and never throws; a 403 or 404 arrives as `http_error` with its status.
 */
export interface GitHubRepoPolicyReads {
  /** `GET /repos/{r}`. */
  getRepoInfo(repo: string): Promise<GitHubResponse<GitHubRepoInfo>>;
  /** `GET /repos/{r}/branches/{b}/protection`: 404 when the branch is not protected, 403 where GitHub cannot enforce protection (a private repo on GitHub Free). */
  getBranchProtection(repo: string, branch: string): Promise<GitHubResponse<GitHubBranchProtection>>;
  /** `GET /repos/{r}/collaborators?permission=push`: the logins that can push. */
  listPushCollaborators(repo: string): Promise<GitHubResponse<readonly string[]>>;
  /** A pull request's head, approvals at the head, requested changes and CI, read fresh. */
  getPullMergeState(repo: string, number: number): Promise<GitHubResponse<GitHubPullMergeState>>;
}

// ---- The GitHub App connect (D36) ------------------------------------------------------

/**
 * Every way the App setup refuses or fails, closed in code: `setup_not_open`
 * (no setup window is open, or it was cancelled), `state_mismatch` (a return's
 * `state` is not the open window's single-use one), `setup_expired` (the window
 * is past its short life), `conversion_failed` (GitHub's manifest conversion
 * did not answer a usable app), `install_failed` (the installation or its first
 * token could not be recorded) and `token_write_scoped` (kept in the closed
 * set; the App path no longer answers it, because the App may write, D39: only
 * the token path refuses a write). A new list, apart from the token path's
 * `GITHUB_TOKEN_REFUSALS`.
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
  /** Record the installation, mint the first installation token and record the permissions GitHub reports: `connected` when it holds every `GITHUB_APP_PERMISSIONS`, else `needs_permissions`. */
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
