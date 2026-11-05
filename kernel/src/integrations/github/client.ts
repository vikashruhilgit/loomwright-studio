// The real `GitHubClient` (phase 6, item 03): GETs against
// `https://api.github.com` on Node's built-in `fetch` (and the GitHub App's two
// setup POSTs and the three write POSTs, below). Items 04 and 06 only
// call it; tests inject `fetch` (and the token source), so none reaches the
// network or the Keychain.
//
// The client sends nothing but GETs and five allowlisted POSTs
// (`GITHUB_ALLOWED_NON_GET`): the GitHub App's own two setup calls (minting an
// installation token, converting an App Manifest) and the three writes (a reply
// in a review thread, a comment on an issue or pull request, a reviewer
// request). `isAllowedGitHubRequest` is the one authority for what may be sent,
// checked with the origin before every request. Every request, GET or POST,
// goes through the one `sendRequest` below (timeout, rate limit, bounded read,
// no redirects). The mint may carry a JSON body (`repositories`, `permissions`:
// a down-scoped token); the writes carry their own JSON body; no other request
// has one. The writes are sent only with an App installation credential: the
// owner's token (PAT) path stays read-only, so a write with it sends nothing
// and answers `unreachable`.
//
// The `studio` CLI loads the feature registry, which loads this feature, so
// this file imports only types and the Keychain module: never the Agent SDK,
// the session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts`).
//
// A token never leaves this module except in the `authorization` header:
//   - its shape is checked (`WRITE_ARG`, the shape the Keychain writer takes)
//     before it reaches a header, so `Headers` never throws a `TypeError`
//     quoting it;
//   - every throw (Keychain, `fetch`, body read, JSON, shape) is caught here and
//     answered as `unreachable`, which carries no message at all;
//   - nothing here logs.
// That holds for the three kinds of bearer the client handles: the PAT, an App
// installation token (both from a `GitHubTokenProvider`) and the App's JWT
// (`mintInstallationToken`). The App's `pem` passes through `convertManifest`
// once, as its return value; it is never kept, and `client_secret` and
// `webhook_secret` are never read out of the response.
//
// What `unreachable` covers here: no usable answer from GitHub, so no request
// was made (no token, a malformed token, a malformed repo or number) or none
// came back that the client can use (network error, timeout, a body over the
// bound, a body that is not the JSON shape GitHub documents). `GitHubFailure`
// has no other variant for these, and none of them carries a rate limit.
//
// Permissions: `getTokenInfo` always reports `permissions: null`. How GitHub
// exposes a fine-grained token's own permissions is unverified (the owner-run
// probe `probes/p12-github-token-permissions.mjs`), and this client never
// infers them, least of all from a write attempt. An App installation token's
// permissions are different: GitHub reports them in the mint response
// (`mintInstallationToken`).
import { securityCliKeychain, WRITE_ARG } from "../../auth/keychain.js";
import type { KeychainReader } from "../../auth/keychain.js";
import type {
  ConnectorMethod,
  GitHubAppConversion,
  GitHubBranchProtection,
  GitHubCiState,
  GitHubClient,
  GitHubCommentResult,
  GitHubFailure,
  GitHubIssueFilters,
  GitHubIssueSummary,
  GitHubPrComment,
  GitHubPull,
  GitHubPullComment,
  GitHubPullDiff,
  GitHubPullFile,
  GitHubPullFilters,
  GitHubPullMergeState,
  GitHubPullSummary,
  GitHubRateLimit,
  GitHubRepo,
  GitHubRepoInfo,
  GitHubRepoPolicyReads,
  GitHubResponse,
  GitHubTokenInfo,
} from "../types.js";

/** The only origin the client sends a request to. */
export const GITHUB_API_ORIGIN = "https://api.github.com";

/** The Keychain item (generic password, by service) the GitHub token lives in. */
export const GITHUB_KEYCHAIN_SERVICE = "loomwright-studio-github";

/** The REST API version every request asks for. */
export const GITHUB_API_VERSION = "2022-11-28";

/** Each request's timeout, including reading its body. */
export const GITHUB_DEFAULT_TIMEOUT_MS = 15_000;

/** The most bytes of one JSON response body the client reads. */
export const GITHUB_DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

/** The most pages one listing reads (100 items a page). */
export const GITHUB_DEFAULT_MAX_PAGES = 10;

const PER_PAGE = 100;

/** A token is no longer than this (GitHub's fine-grained tokens are ~93 characters). */
const MAX_TOKEN_LENGTH = 255;

/** An installation token is no longer than this (GitHub's are ~40 characters today and may grow). */
const MAX_INSTALLATION_TOKEN_LENGTH = 1024;

/** The App's JWT (header.claims.signature) is no longer than this: an RS256 JWT for a 4096-bit key is ~700 characters. */
const MAX_APP_JWT_LENGTH = 2048;

const APP_JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** An owner or repository name segment: GitHub's characters, never `.` or `..`. Also the characters of a reviewer login. */
export const NAME_SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;

/** An owner or repository name as one allowlisted path segment: `NAME_SEGMENT`, and never `.` or `..`. */
const NAME_PATH_SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;

/** A positive number (an installation id, a pull request or issue number, a comment id) as one allowlisted path segment. */
const NUMBER_PATH_SEGMENT = /^[1-9]\d{0,14}$/;

/** The most characters of a comment body the client sends (GitHub's own limit). */
export const GITHUB_MAX_COMMENT_CHARS = 65_536;

/** The most reviewers one request names (GitHub's own limit is 15 users and 15 teams; the kernel allows the validated 100 and lets GitHub refuse the rest). */
export const GITHUB_MAX_REVIEWERS = 100;

/** The one method the allowlist names besides GET. */
type PostMethod = "POST";

/**
 * What may be sent besides a GET: one entry per allowlisted request. `path` is
 * the request's whole path as its segments in order: a string is a literal
 * segment, a `RegExp` is a variable one (an installation id, a manifest code, a
 * repository name, a number) that must match in full.
 */
export interface GitHubAllowedRequest {
  readonly method: PostMethod;
  readonly path: readonly (string | RegExp)[];
}

function allowed(path: readonly (string | RegExp)[]): GitHubAllowedRequest {
  return Object.freeze({ method: "POST", path: Object.freeze([...path]) });
}

/** A manifest conversion's single-use code as one allowlisted path segment. */
const MANIFEST_CODE = /^[A-Za-z0-9_-]{1,128}$/;

const MINT_REQUEST: GitHubAllowedRequest = allowed(["app", "installations", NUMBER_PATH_SEGMENT, "access_tokens"]);

const CONVERT_REQUEST: GitHubAllowedRequest = allowed(["app-manifests", MANIFEST_CODE, "conversions"]);

/** `POST /repos/{owner}/{repo}/pulls/{n}/comments/{id}/replies`: a reply in a review comment's thread. */
const REPLY_REQUEST: GitHubAllowedRequest = allowed(["repos", NAME_PATH_SEGMENT, NAME_PATH_SEGMENT, "pulls", NUMBER_PATH_SEGMENT, "comments", NUMBER_PATH_SEGMENT, "replies"]);

/** `POST /repos/{owner}/{repo}/issues/{n}/comments`: a comment on an issue or (a pull request is an issue to this endpoint) on a pull request's conversation. */
const COMMENT_REQUEST: GitHubAllowedRequest = allowed(["repos", NAME_PATH_SEGMENT, NAME_PATH_SEGMENT, "issues", NUMBER_PATH_SEGMENT, "comments"]);

/** `POST /repos/{owner}/{repo}/pulls/{n}/requested_reviewers`: ask for (or re-request) reviews. */
const REVIEWERS_REQUEST: GitHubAllowedRequest = allowed(["repos", NAME_PATH_SEGMENT, NAME_PATH_SEGMENT, "pulls", NUMBER_PATH_SEGMENT, "requested_reviewers"]);

/**
 * Every request the client may send that is not a GET: minting an installation
 * token (`POST /app/installations/{id}/access_tokens`), converting an App
 * Manifest (`POST /app-manifests/{code}/conversions`), and the three GitHub
 * writes (a reply in a review thread, a comment on an issue or pull request,
 * a reviewer request). Nothing else: no PUT, PATCH or DELETE, and no other POST.
 */
export const GITHUB_ALLOWED_NON_GET: readonly GitHubAllowedRequest[] = Object.freeze([
  MINT_REQUEST,
  CONVERT_REQUEST,
  REPLY_REQUEST,
  COMMENT_REQUEST,
  REVIEWERS_REQUEST,
]);

/**
 * Whether the client may send `method` to `url`: the URL's origin is
 * `GITHUB_API_ORIGIN` (no credentials in it), and the method is GET, or the
 * request is exactly one of `GITHUB_ALLOWED_NON_GET` (no query, no fragment).
 * Any other input is refused. Never throws.
 */
export function isAllowedGitHubRequest(method: string, url: string | URL): boolean {
  try {
    const u = typeof url === "string" ? new URL(url) : url;
    if (u.origin !== GITHUB_API_ORIGIN || u.username !== "" || u.password !== "") return false;
    if (method === "GET") return true;
    if (u.search !== "" || u.hash !== "") return false;
    const segments = u.pathname.split("/");
    // A path starts with "/", so its first segment is empty; a trailing slash leaves an empty last one, which no entry matches.
    if (segments[0] !== "") return false;
    const rest = segments.slice(1);
    return GITHUB_ALLOWED_NON_GET.some(
      (a) => a.method === method && a.path.length === rest.length && a.path.every((want, i) => (typeof want === "string" ? rest[i] === want : want.test(rest[i] as string))),
    );
  } catch {
    return false;
  }
}

/**
 * Where a request's bearer comes from. `method` says which credential it is
 * (`token`: the owner's PAT, `app`: an App installation token). `token()` is
 * read fresh on every client call and resolves `undefined` when there is none;
 * `renew()`, when present, is asked for a new one after GitHub answers 401, at
 * most once per client call. Neither rejects: a failure is `undefined`.
 */
export interface GitHubTokenProvider {
  readonly method: ConnectorMethod;
  token(): Promise<string | undefined>;
  renew?(): Promise<string | undefined>;
}

/** Picks the provider for one client call, or `undefined` when no credential is stored. Never reads at construction. */
export type GitHubTokenProviderResolver = () => GitHubTokenProvider | undefined;

/**
 * The slice of the App's token holder (`githubAppTokens`, `app-token.ts`) that
 * the resolver needs. Declared here so this file never imports `app-token.ts`
 * (which imports this one).
 */
export interface GitHubAppTokenSource {
  /** Whether the App's installation id and key are both in the Keychain. Never throws. */
  configured(): boolean;
  /** A current installation token, minting one when there is none or it is within the renewal window. Never throws. */
  current(): Promise<{ readonly ok: true; readonly token: string } | { readonly ok: false }>;
  /** Forgets the held token, so the next `current()` mints. */
  invalidate(): void;
}

/**
 * The per-call method rule: the PAT item (`GITHUB_KEYCHAIN_SERVICE`) present
 * means `token`; otherwise the App's items present means `app`; otherwise no
 * provider. Nothing is read when this is called, only when the returned
 * resolver is. A Keychain read that fails is no provider (fail closed: the
 * client cannot tell which credential is current).
 */
export function resolveGitHubTokenProvider(keychain: KeychainReader, tokens: GitHubAppTokenSource): GitHubTokenProviderResolver {
  return () => {
    try {
      const pat = keychain.read(GITHUB_KEYCHAIN_SERVICE);
      if (pat !== undefined) return patProvider(() => pat);
      if (!tokens.configured()) return undefined;
      return {
        method: "app",
        token: async () => {
          const res = await tokens.current();
          return res.ok ? res.token : undefined;
        },
        renew: async () => {
          tokens.invalidate();
          const res = await tokens.current();
          return res.ok ? res.token : undefined;
        },
      };
    } catch {
      return undefined;
    }
  };
}

function patProvider(read: () => string | undefined): GitHubTokenProvider {
  return { method: "token", token: () => Promise.resolve(read()) };
}

export interface GitHubClientDeps {
  /**
   * Where the token comes from, read fresh on every call. Default: the
   * Keychain item `GITHUB_KEYCHAIN_SERVICE` through `keychain`. The connector
   * passes a candidate token here to validate it before writing it. The PAT
   * shorthand: ignored when `tokenProvider` is given.
   */
  readonly readToken?: () => string | undefined;
  /**
   * Picks the credential per call (`resolveGitHubTokenProvider`): the PAT or an
   * App installation token. Default: none, which is the PAT through
   * `readToken` / `keychain`, as before the App existed.
   */
  readonly tokenProvider?: GitHubTokenProviderResolver;
  /** The Keychain reader the default token source uses. Default: `securityCliKeychain()`, built only when a call runs. */
  readonly keychain?: KeychainReader;
  /** Default: the global `fetch`. */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
  readonly maxPages?: number;
  /** The clock, for a rate limit whose reset is unknown. */
  readonly now?: () => Date;
}

/** Thrown inside the client only, and always caught: a body that is not the documented shape. */
class ShapeError extends Error {}

type Answer =
  | { readonly kind: "ok"; readonly body: Uint8Array; readonly over: boolean; readonly rateLimit: GitHubRateLimit; readonly headers: Headers }
  | { readonly kind: "failure"; readonly failure: GitHubFailure };

const UNREACHABLE: GitHubFailure = Object.freeze({ ok: false, error: "unreachable", rateLimit: null });

function unreachable<T>(): GitHubResponse<T> {
  return UNREACHABLE;
}

function isUsableToken(token: string | undefined): token is string {
  return typeof token === "string" && token.length <= MAX_TOKEN_LENGTH && WRITE_ARG.test(token);
}

function isInstallationToken(token: string | undefined): token is string {
  return typeof token === "string" && token.length <= MAX_INSTALLATION_TOKEN_LENGTH && WRITE_ARG.test(token);
}

/** Three base64url segments, at most `MAX_APP_JWT_LENGTH` characters: what the mint sends as its bearer. */
function isAppJwtShape(jwt: unknown): jwt is string {
  return typeof jwt === "string" && jwt.length <= MAX_APP_JWT_LENGTH && APP_JWT_SHAPE.test(jwt);
}

/** Whether `token` may go in a header for a credential of kind `method`. */
function isUsableFor(method: ConnectorMethod, token: string | undefined): token is string {
  return method === "app" ? isInstallationToken(token) : isUsableToken(token);
}

/** `<owner>/<repo>` as two URL path segments, or `undefined` when it is not one. */
function repoPath(repo: string): string | undefined {
  if (typeof repo !== "string") return undefined;
  const parts = repo.split("/");
  if (parts.length !== 2) return undefined;
  const [owner, name] = parts as [string, string];
  for (const seg of [owner, name]) {
    if (!NAME_SEGMENT.test(seg) || seg === "." || seg === "..") return undefined;
  }
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function isPullNumber(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0;
}

function headerInt(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || !/^\d+$/.test(raw.trim())) return undefined;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) ? n : undefined;
}

/**
 * The `x-ratelimit-*` headers as one `GitHubRateLimit`. A missing count reads
 * 0 and a missing reset reads as now: unknown, never a reason to wait.
 */
function rateLimitOf(headers: Headers, now: Date): GitHubRateLimit {
  const reset = headerInt(headers, "x-ratelimit-reset");
  return {
    limit: headerInt(headers, "x-ratelimit-limit") ?? 0,
    remaining: headerInt(headers, "x-ratelimit-remaining") ?? 0,
    reset_at: reset !== undefined ? new Date(reset * 1000).toISOString() : now.toISOString(),
  };
}

/**
 * GitHub's documented rate-limit answers: a 429, or a 403 with
 * `x-ratelimit-remaining: 0` (primary) or a `retry-after` (secondary).
 * `resets_at` is `x-ratelimit-reset`; failing that, `retry-after` seconds from
 * now; failing that, one minute from now (GitHub's advice for a secondary limit).
 */
function rateLimitedOf(status: number, headers: Headers, rateLimit: GitHubRateLimit, now: Date): GitHubFailure | undefined {
  const retryAfter = headerInt(headers, "retry-after");
  const limited = status === 429 || (status === 403 && (headerInt(headers, "x-ratelimit-remaining") === 0 || retryAfter !== undefined));
  if (!limited) return undefined;
  const reset = headerInt(headers, "x-ratelimit-reset");
  const resetsAt =
    reset !== undefined ? new Date(reset * 1000) : new Date(now.getTime() + (retryAfter !== undefined ? retryAfter : 60) * 1000);
  return { ok: false, error: "rate_limited", resets_at: resetsAt.toISOString(), rateLimit };
}

/** Reads at most `max + 1` bytes of `body`, then cancels the rest. */
async function readBounded(body: ReadableStream<Uint8Array> | null, max: number): Promise<{ bytes: Uint8Array; over: boolean }> {
  if (body === null) return { bytes: new Uint8Array(0), over: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const all = Buffer.concat(chunks);
  return { bytes: all.subarray(0, Math.min(all.byteLength, max + 1)), over: total > max };
}

/**
 * GitHub's `github-authentication-token-expiration` header as ISO-8601 UTC.
 * Its documented form is `YYYY-MM-DD HH:MM:SS UTC` (unverified against a real
 * token: the probe prints the raw header); an offset (`+0000`) is also read.
 * Anything else is `null` (unknown expiry), never a throw.
 */
export function parseTokenExpiration(raw: string | null): string | null {
  if (raw === null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}) ?(UTC|Z|[+-]\d{2}:?\d{2})$/.exec(raw.trim());
  if (m === null) return null;
  const zone = m[3] === "UTC" || m[3] === "Z" ? "Z" : (m[3] ?? "").replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
  const date = new Date(`${m[1]}T${m[2]}${zone}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ---- Shape checks: GitHub's answers are untrusted data --------------------------

function record(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new ShapeError();
  return v as Record<string, unknown>;
}

function list(v: unknown): readonly unknown[] {
  if (!Array.isArray(v)) throw new ShapeError();
  return v;
}

function str(v: unknown): string {
  if (typeof v !== "string") throw new ShapeError();
  return v;
}

function int(v: unknown): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new ShapeError();
  return v;
}

/** A user object's login; a deleted account (`user: null`) reads as GitHub shows it, `ghost`. */
function loginOf(v: unknown): string {
  return v === null || v === undefined ? "ghost" : str(record(v)["login"]);
}

function textOrEmpty(v: unknown): string {
  return v === null || v === undefined ? "" : str(v);
}

function pullSummaryOf(v: unknown): GitHubPullSummary {
  const p = record(v);
  return {
    number: int(p["number"]),
    title: textOrEmpty(p["title"]),
    author: loginOf(p["user"]),
    draft: p["draft"] === true,
    head_sha: str(record(p["head"])["sha"]),
    url: str(p["html_url"]),
    updated_at: str(p["updated_at"]),
  };
}

function pullOf(v: unknown): GitHubPull {
  const p = record(v);
  return {
    ...pullSummaryOf(p),
    body: textOrEmpty(p["body"]),
    state: str(p["state"]),
    base_ref: str(record(p["base"])["ref"]),
    head_ref: str(record(p["head"])["ref"]),
    labels: list(p["labels"] ?? []).map((l) => str(record(l)["name"])),
  };
}

function repoOf(v: unknown): GitHubRepo {
  const r = record(v);
  return { full_name: str(r["full_name"]), private: r["private"] === true };
}

function fileOf(v: unknown): GitHubPullFile {
  const f = record(v);
  return { path: str(f["filename"]), status: str(f["status"]), additions: int(f["additions"]), deletions: int(f["deletions"]) };
}

function commentOf(kind: "issue" | "review", v: unknown): GitHubPullComment {
  const c = record(v);
  return {
    kind,
    author: loginOf(c["user"]),
    body: textOrEmpty(c["body"]),
    created_at: str(c["created_at"]),
    path: kind === "review" ? str(c["path"]) : null,
  };
}

/** A label as the issues listing shows it: an object with a `name` (or, in older shapes, the name alone). */
function labelNameOf(v: unknown): string {
  return typeof v === "string" ? v : str(record(v)["name"]);
}

/** One entry of the issues listing, or `undefined` for a pull request (GitHub lists pull requests as issues; they carry a `pull_request` key). */
function issueOf(v: unknown): GitHubIssueSummary | undefined {
  const i = record(v);
  if (Object.prototype.hasOwnProperty.call(i, "pull_request")) return undefined;
  return {
    number: int(i["number"]),
    title: textOrEmpty(i["title"]),
    body: textOrEmpty(i["body"]),
    author: loginOf(i["user"]),
    labels: list(i["labels"] ?? []).map(labelNameOf),
    url: str(i["html_url"]),
    updated_at: str(i["updated_at"]),
  };
}

/**
 * One comment or review on pull request `pr`. A review has no `updated_at`, so
 * its `submitted_at` stands in for it; a review with none (a pending one, which
 * only its author sees) is `undefined`, not a failure.
 */
function prCommentOf(kind: GitHubPrComment["kind"], pr: number, v: unknown): GitHubPrComment | undefined {
  const c = record(v);
  const at = kind === "review" ? c["submitted_at"] : c["updated_at"];
  if (kind === "review" && (at === null || at === undefined)) return undefined;
  return {
    kind,
    id: int(c["id"]),
    pr,
    author: loginOf(c["user"]),
    body: textOrEmpty(c["body"]),
    url: str(c["html_url"]),
    updated_at: str(at),
  };
}

/** The longest branch name the client puts in a path (GitHub's own limit is 255 bytes). */
const MAX_BRANCH_LENGTH = 255;

/**
 * A branch name as URL path segments (`feature/x` keeps its slash), or `undefined`
 * when it is not one the client will send: empty, too long, a control character or
 * backslash, an empty segment, or a `.` or `..` segment.
 */
function branchPath(branch: string): string | undefined {
  if (typeof branch !== "string" || branch.length === 0 || branch.length > MAX_BRANCH_LENGTH) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(branch)) return undefined;
  const segments = branch.split("/");
  if (segments.some((seg) => seg === "" || seg === "." || seg === "..")) return undefined;
  return segments.map(encodeURIComponent).join("/");
}

/** A commit SHA as one path segment: hex, 7 to 64 characters (SHA-1 or SHA-256). */
const COMMIT_SHA = /^[0-9a-fA-F]{7,64}$/;

function repoInfoOf(v: unknown): GitHubRepoInfo {
  const r = record(v);
  return { default_branch: str(r["default_branch"]), private: r["private"] === true };
}

/**
 * Branch protection: the approvals its pull-request review rule needs (`null` with
 * no such rule) and its required status checks' names (`checks[].context`, else
 * the older `contexts`), each once.
 */
function protectionOf(v: unknown): GitHubBranchProtection {
  const p = record(v);
  const reviews = p["required_pull_request_reviews"];
  const checks = p["required_status_checks"];
  const names: string[] = [];
  if (checks !== undefined && checks !== null) {
    const c = record(checks);
    const detailed = c["checks"];
    const found = Array.isArray(detailed) ? detailed.map((x) => str(record(x)["context"])) : list(c["contexts"] ?? []).map(str);
    for (const name of found) if (!names.includes(name)) names.push(name);
  }
  return {
    required_approving_review_count: reviews === undefined || reviews === null ? null : int(record(reviews)["required_approving_review_count"] ?? 0),
    required_checks: names,
  };
}

/** The deciding review states: a `COMMENTED` or `PENDING` review leaves a reviewer's earlier decision as it was. */
const DECIDING_REVIEW_STATES: readonly string[] = ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"];

/** One review, reduced to what the merge state needs; `undefined` for a review that does not decide (commented, pending). */
function reviewOf(v: unknown): { readonly login: string; readonly state: string; readonly commit: string | null } | undefined {
  const r = record(v);
  const state = str(r["state"]).toUpperCase();
  if (!DECIDING_REVIEW_STATES.includes(state)) return undefined;
  const commit = r["commit_id"];
  return { login: loginOf(r["user"]), state, commit: typeof commit === "string" ? commit : null };
}

/** Check-run conclusions that count as passing. */
const PASSING_CONCLUSIONS: readonly string[] = ["success", "neutral", "skipped"];

/** A check run reduced to `ok`, `pending` or `failing`. */
function checkRunOf(v: unknown): "ok" | "pending" | "failing" {
  const c = record(v);
  if (c["status"] !== "completed") return "pending";
  const conclusion = c["conclusion"];
  return typeof conclusion === "string" && PASSING_CONCLUSIONS.includes(conclusion) ? "ok" : "failing";
}

/**
 * The head's CI from its check runs and its combined status. `total` is the
 * combined status's own count of statuses (0 reads as none: GitHub answers
 * `pending` for a commit with no statuses). A failing run or status wins over a
 * pending one; nothing at all is `none`.
 */
function ciOf(runs: readonly ("ok" | "pending" | "failing")[], combined: string, total: number): GitHubCiState {
  if (runs.length === 0 && total === 0) return "none";
  if (runs.includes("failing") || (total > 0 && (combined === "failure" || combined === "error"))) return "failing";
  if (runs.includes("pending") || (total > 0 && combined !== "success")) return "pending";
  return "green";
}

type GitHubMethod = "GET" | PostMethod;

/** The slice of `GitHubClientDeps` one request needs; `mintInstallationToken` and `convertManifest` take exactly this. */
type RequestDeps = Pick<GitHubClientDeps, "fetch" | "timeoutMs" | "maxBodyBytes" | "now">;

/**
 * One request. `path` is built by the caller from checked parts only; the
 * URL's origin and the method are checked (`isAllowedGitHubRequest`) before the
 * request. Redirects are never followed, so no request (and no token) goes
 * anywhere but `GITHUB_API_ORIGIN`. `bearer` is the caller's already-checked
 * credential; with none, no `authorization` header is sent at all. `jsonBody`,
 * when given, is sent as the request's JSON body with `content-type:
 * application/json`; with none, no body and no content type are sent at all.
 * Never throws.
 */
async function sendRequest(
  deps: RequestDeps,
  method: GitHubMethod,
  path: string,
  accept: string,
  maxBytes: number,
  bearer: string | undefined,
  jsonBody?: string,
): Promise<Answer> {
  try {
    const url = new URL(path, GITHUB_API_ORIGIN);
    if (url.origin !== GITHUB_API_ORIGIN) return { kind: "failure", failure: UNREACHABLE };
    if (!isAllowedGitHubRequest(method, url)) return { kind: "failure", failure: UNREACHABLE };
    const doFetch = deps.fetch ?? globalThis.fetch;
    const res = await doFetch(url.href, {
      method,
      redirect: "manual",
      headers: {
        accept,
        ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
        ...(jsonBody === undefined ? {} : { "content-type": "application/json" }),
        "user-agent": "loomwright-studio",
        "x-github-api-version": GITHUB_API_VERSION,
      },
      ...(jsonBody === undefined ? {} : { body: jsonBody }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? GITHUB_DEFAULT_TIMEOUT_MS),
    });
    const at = (deps.now ?? (() => new Date()))();
    const rateLimit = rateLimitOf(res.headers, at);
    if (res.status < 200 || res.status > 299) {
      await res.body?.cancel().catch(() => undefined);
      const limited = rateLimitedOf(res.status, res.headers, rateLimit, at);
      return { kind: "failure", failure: limited ?? { ok: false, error: "http_error", status: res.status, rateLimit } };
    }
    const { bytes, over } = await readBounded(res.body, maxBytes);
    return { kind: "ok", body: bytes, over, rateLimit, headers: res.headers };
  } catch {
    // A network error, a timeout or an abort mid-body. Its message is dropped:
    // nothing from it reaches the caller.
    return { kind: "failure", failure: UNREACHABLE };
  }
}

/** Why a mint or a conversion produced nothing: a `GitHubFailure`'s kind, with the status of an `http_error`. */
export type GitHubSetupFailure = { readonly ok: false; readonly error: "unreachable" | "rate_limited" | "http_error"; readonly status?: number };

function setupFailure(failure: GitHubFailure): GitHubSetupFailure {
  return failure.error === "http_error" ? { ok: false, error: "http_error", status: failure.status } : { ok: false, error: failure.error };
}

const SETUP_UNREACHABLE: GitHubSetupFailure = Object.freeze({ ok: false, error: "unreachable" });

/** What a successful mint carries: the token, its expiry (ISO-8601 UTC) and the permissions GitHub reports for it. */
export type InstallationTokenResult =
  | { readonly ok: true; readonly token: string; readonly expires_at: string; readonly permissions: Readonly<Record<string, string>> }
  | GitHubSetupFailure;

/**
 * What narrows a mint: `repositories` (repo names without the owner) and
 * `permissions` (name to level). With neither, the mint is unscoped and sends no
 * body: the token gets everything the installation holds.
 */
export interface InstallationTokenScope {
  readonly repositories?: readonly string[];
  readonly permissions?: Readonly<Record<string, string>>;
}

/** The JSON body of a scoped mint, or `undefined` when `scope` narrows nothing. Only the two known fields are ever sent. */
function scopeBody(scope: InstallationTokenScope | undefined): string | undefined {
  if (scope === undefined) return undefined;
  const body: { repositories?: readonly string[]; permissions?: Readonly<Record<string, string>> } = {};
  if (scope.repositories !== undefined) body.repositories = [...scope.repositories];
  if (scope.permissions !== undefined) body.permissions = { ...scope.permissions };
  return Object.keys(body).length === 0 ? undefined : JSON.stringify(body);
}

/**
 * `POST /app/installations/{id}/access_tokens`, authenticated by the App's own
 * `jwt` (as its bearer, checked by shape: three base64url segments, not the
 * PAT's 255-character bound). `scope`, when it narrows anything, is sent as the
 * request's JSON body (`repositories`, `permissions`); without it the request
 * carries no body, byte-identical to an unscoped mint. The answer must carry a
 * token of an acceptable shape, a valid `expires_at` and a `permissions` object
 * of strings, or the result is `unreachable`. A 401 or 404 arrives as
 * `http_error` with its status. Never throws; nothing in the result but `token`
 * is a secret.
 */
export async function mintInstallationToken(
  installationId: number,
  jwt: string,
  deps: RequestDeps = {},
  scope?: InstallationTokenScope,
): Promise<InstallationTokenResult> {
  try {
    if (!Number.isSafeInteger(installationId) || installationId < 1 || !isAppJwtShape(jwt)) return SETUP_UNREACHABLE;
    const maxBytes = deps.maxBodyBytes ?? GITHUB_DEFAULT_MAX_BODY_BYTES;
    const path = `/app/installations/${installationId}/access_tokens`;
    const answer = await sendRequest(deps, "POST", path, "application/vnd.github+json", maxBytes, jwt, scopeBody(scope));
    if (answer.kind === "failure") return setupFailure(answer.failure);
    if (answer.over) return SETUP_UNREACHABLE;
    const body = record(JSON.parse(Buffer.from(answer.body).toString("utf8")) as unknown);
    const token = str(body["token"]);
    if (!isInstallationToken(token)) return SETUP_UNREACHABLE;
    const expires = new Date(str(body["expires_at"]));
    if (Number.isNaN(expires.getTime())) return SETUP_UNREACHABLE;
    const permissions: Record<string, string> = {};
    for (const [name, level] of Object.entries(record(body["permissions"]))) permissions[name] = str(level);
    return { ok: true, token, expires_at: expires.toISOString(), permissions: Object.freeze(permissions) };
  } catch {
    return SETUP_UNREACHABLE;
  }
}

/** The result of `convertManifest`: the App's non-secret fields and its `pem`, or why there are none. */
export type ManifestConversionResult =
  | { readonly ok: true; readonly conversion: GitHubAppConversion; readonly pem: string }
  | GitHubSetupFailure;

/**
 * `POST /app-manifests/{code}/conversions`: unauthenticated (the single-use
 * `code` is the credential, so no `authorization` header is sent at all). The
 * result carries the non-secret `GitHubAppConversion` and the `pem`, which the
 * caller hands to the Keychain and drops. `client_secret` and `webhook_secret`
 * are never read out of the response. Never throws.
 */
export async function convertManifest(code: string, deps: RequestDeps = {}): Promise<ManifestConversionResult> {
  try {
    if (typeof code !== "string" || !MANIFEST_CODE.test(code)) return SETUP_UNREACHABLE;
    const maxBytes = deps.maxBodyBytes ?? GITHUB_DEFAULT_MAX_BODY_BYTES;
    const path = `/app-manifests/${code}/conversions`;
    const answer = await sendRequest(deps, "POST", path, "application/vnd.github+json", maxBytes, undefined);
    if (answer.kind === "failure") return setupFailure(answer.failure);
    if (answer.over) return SETUP_UNREACHABLE;
    const body = record(JSON.parse(Buffer.from(answer.body).toString("utf8")) as unknown);
    const conversion: GitHubAppConversion = {
      app_id: int(body["id"]),
      slug: str(body["slug"]),
      name: str(body["name"]),
      owner_login: str(record(body["owner"])["login"]),
      html_url: str(body["html_url"]),
      client_id: str(body["client_id"]),
    };
    return { ok: true, conversion, pem: str(body["pem"]) };
  } catch {
    return SETUP_UNREACHABLE;
  }
}

/** One client call's credential: the provider picked for it, and the token in use (replaced once, by a renewal). */
interface Session {
  readonly provider: GitHubTokenProvider;
  tok: string;
  renewed: boolean;
}

/** Builds the real client. Nothing runs (no Keychain read, no request) until a method is called. */
export function createGitHubClient(deps: GitHubClientDeps = {}): GitHubClient & GitHubRepoPolicyReads {
  const maxBodyBytes = deps.maxBodyBytes ?? GITHUB_DEFAULT_MAX_BODY_BYTES;
  const maxPages = deps.maxPages ?? GITHUB_DEFAULT_MAX_PAGES;
  let keychain: KeychainReader | undefined = deps.keychain;

  /** The PAT, read fresh. Throws when the source does; `begin` catches. */
  function readPat(): string | undefined {
    if (deps.readToken !== undefined) return deps.readToken();
    keychain ??= securityCliKeychain();
    return keychain.read(GITHUB_KEYCHAIN_SERVICE);
  }

  /**
   * This call's credential and its token, or `undefined` when there is none
   * usable (no provider, no token, a token not of an acceptable shape, or a
   * source that throws). Never throws.
   */
  async function begin(): Promise<Session | undefined> {
    try {
      const provider = deps.tokenProvider !== undefined ? deps.tokenProvider() : patProvider(readPat);
      if (provider === undefined) return undefined;
      const tok = await provider.token();
      return isUsableFor(provider.method, tok) ? { provider, tok, renewed: false } : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * One request with the session's token. A 401 asks the provider to renew
   * (when it can) and retries once: at most one renewal per client call,
   * however many pages it reads. A write follows the same rule (the retry
   * carries the same body). Never throws.
   */
  async function send(s: Session, method: GitHubMethod, path: string, accept: string, maxBytes: number, jsonBody?: string): Promise<Answer> {
    const first = await sendRequest(deps, method, path, accept, maxBytes, s.tok, jsonBody);
    const unauthorized = first.kind === "failure" && first.failure.error === "http_error" && first.failure.status === 401;
    if (!unauthorized || s.renewed || s.provider.renew === undefined) return first;
    s.renewed = true;
    let fresh: string | undefined;
    try {
      fresh = await s.provider.renew();
    } catch {
      return first;
    }
    if (!isUsableFor(s.provider.method, fresh)) return first;
    s.tok = fresh;
    return sendRequest(deps, method, path, accept, maxBytes, s.tok, jsonBody);
  }

  /** One GET with the session's token (see `send`). */
  function get(s: Session, path: string, accept: string, maxBytes: number): Promise<Answer> {
    return send(s, "GET", path, accept, maxBytes);
  }

  /**
   * One JSON POST, mapped by `map`: only with an App installation credential
   * (the token path stays read-only, so a PAT sends nothing and answers
   * `unreachable`), and `path` must be one of `GITHUB_ALLOWED_NON_GET` (the
   * request itself checks). A body over the bound or off the documented shape
   * is `unreachable`.
   */
  async function postJson<T>(path: string, body: unknown, map: (body: unknown) => T): Promise<GitHubResponse<T>> {
    const s = await begin();
    if (s === undefined || s.provider.method !== "app") return unreachable();
    const answer = await send(s, "POST", path, "application/vnd.github+json", maxBodyBytes, JSON.stringify(body));
    if (answer.kind === "failure") return answer.failure;
    if (answer.over) return unreachable();
    try {
      return { ok: true, data: map(JSON.parse(Buffer.from(answer.body).toString("utf8")) as unknown), rateLimit: answer.rateLimit };
    } catch {
      return unreachable();
    }
  }

  /** The comment POSTs' answer: the new comment's id and `html_url`, nothing else of GitHub's. */
  const commentResultOf = (body: unknown): GitHubCommentResult => {
    const c = record(body);
    return { id: int(c["id"]), url: str(c["html_url"]) };
  };

  /** Whether `body` is a comment body the client will send: a non-empty string within GitHub's limit. */
  const isCommentBody = (body: unknown): body is string => typeof body === "string" && body.length > 0 && body.length <= GITHUB_MAX_COMMENT_CHARS;

  /** One JSON GET mapped by `map`. A body over the bound or off the documented shape is `unreachable`. */
  async function getJson<T>(path: string, map: (body: unknown, headers: Headers) => T): Promise<GitHubResponse<T>> {
    const s = await begin();
    if (s === undefined) return unreachable();
    return getJsonOn(s, path, map);
  }

  /** `getJson` over a session already begun (one token read and at most one renewal for a read of several requests). */
  async function getJsonOn<T>(s: Session, path: string, map: (body: unknown, headers: Headers) => T): Promise<GitHubResponse<T>> {
    const answer = await get(s, path, "application/vnd.github+json", maxBodyBytes);
    if (answer.kind === "failure") return answer.failure;
    if (answer.over) return unreachable();
    try {
      const data = map(JSON.parse(Buffer.from(answer.body).toString("utf8")) as unknown, answer.headers);
      return { ok: true, data, rateLimit: answer.rateLimit };
    } catch {
      return unreachable();
    }
  }

  /**
   * A listing read `PER_PAGE` at a time, stopping at a short page or at
   * `maxPages` (whatever lies beyond the cap is not read). The token is read
   * once for the whole listing; the rate limit is the last page's. A failed
   * page fails the listing. `itemsOf` picks the array out of a page's body
   * (default: the body is the array; `/installation/repositories` wraps it in
   * `repositories`).
   */
  async function getPages<T>(
    path: string,
    map: (item: unknown) => T,
    itemsOf: (body: unknown) => readonly unknown[] = list,
    session?: Session,
  ): Promise<GitHubResponse<readonly T[]>> {
    const s = session ?? (await begin());
    if (s === undefined) return unreachable();
    const items: T[] = [];
    let rateLimit: GitHubRateLimit | undefined;
    const sep = path.includes("?") ? "&" : "?";
    for (let page = 1; page <= maxPages; page++) {
      const answer = await get(s, `${path}${sep}per_page=${PER_PAGE}&page=${page}`, "application/vnd.github+json", maxBodyBytes);
      if (answer.kind === "failure") return answer.failure;
      if (answer.over) return unreachable();
      rateLimit = answer.rateLimit;
      let pageItems: readonly unknown[];
      try {
        pageItems = itemsOf(JSON.parse(Buffer.from(answer.body).toString("utf8")) as unknown);
        for (const item of pageItems) items.push(map(item));
      } catch {
        return unreachable();
      }
      if (pageItems.length < PER_PAGE) break;
    }
    return rateLimit === undefined ? unreachable() : { ok: true, data: items, rateLimit };
  }

  return {
    getTokenInfo(): Promise<GitHubResponse<GitHubTokenInfo>> {
      return getJson("/user", (body, headers) => ({
        login: str(record(body)["login"]),
        expires_at: parseTokenExpiration(headers.get("github-authentication-token-expiration")),
        // Never inferred: see the file header (AC4, fail-closed in the connector).
        permissions: null,
      }));
    },

    async listReachableRepos(): Promise<GitHubResponse<readonly GitHubRepo[]>> {
      const s = await begin();
      if (s === undefined) return unreachable();
      // An installation token reaches exactly the repos chosen at install:
      // `/user/repos` is for a user's token and answers an installation's 403.
      if (s.provider.method === "app") {
        return getPages("/installation/repositories", repoOf, (body) => list(record(body)["repositories"]), s);
      }
      return getPages("/user/repos", repoOf, list, s);
    },

    async listOpenPulls(repo: string, filters: GitHubPullFilters): Promise<GitHubResponse<readonly GitHubPullSummary[]>> {
      const r = repoPath(repo);
      if (r === undefined) return unreachable();
      // `state` goes to GitHub as given (its default is `open`); the pulls
      // listing has no `draft` or `author` parameter, so those apply here.
      const query = filters.state !== undefined ? `?state=${encodeURIComponent(filters.state)}` : "";
      const res = await getPages(`/repos/${r}/pulls${query}`, pullSummaryOf);
      if (!res.ok) return res;
      const data = res.data.filter(
        (p) => (filters.draft === undefined || p.draft === filters.draft) && (filters.author === undefined || p.author === filters.author),
      );
      return { ok: true, data, rateLimit: res.rateLimit };
    },

    async getPull(repo: string, number: number): Promise<GitHubResponse<GitHubPull>> {
      const r = repoPath(repo);
      if (r === undefined || !isPullNumber(number)) return unreachable();
      return getJson(`/repos/${r}/pulls/${number}`, (body) => pullOf(body));
    },

    async getPullDiff(repo: string, number: number, maxBytes: number): Promise<GitHubResponse<GitHubPullDiff>> {
      const r = repoPath(repo);
      if (r === undefined || !isPullNumber(number) || !Number.isSafeInteger(maxBytes) || maxBytes < 0) return unreachable();
      const s = await begin();
      if (s === undefined) return unreachable();
      // Never more than the body bound, whatever the caller asks.
      const bound = Math.min(maxBytes, maxBodyBytes);
      const answer = await get(s, `/repos/${r}/pulls/${number}`, "application/vnd.github.diff", bound);
      if (answer.kind === "failure") return answer.failure;
      const truncated = answer.over;
      const diff = Buffer.from(answer.body.subarray(0, bound)).toString("utf8");
      return { ok: true, data: { diff, truncated }, rateLimit: answer.rateLimit };
    },

    async listPullFiles(repo: string, number: number): Promise<GitHubResponse<readonly GitHubPullFile[]>> {
      const r = repoPath(repo);
      if (r === undefined || !isPullNumber(number)) return unreachable();
      return getPages(`/repos/${r}/pulls/${number}/files`, fileOf);
    },

    async listPullComments(repo: string, number: number): Promise<GitHubResponse<readonly GitHubPullComment[]>> {
      const r = repoPath(repo);
      if (r === undefined || !isPullNumber(number)) return unreachable();
      // Issue comments (the conversation), then review comments (on a file's lines).
      const issue = await getPages(`/repos/${r}/issues/${number}/comments`, (c) => commentOf("issue", c));
      if (!issue.ok) return issue;
      const review = await getPages(`/repos/${r}/pulls/${number}/comments`, (c) => commentOf("review", c));
      if (!review.ok) return review;
      return { ok: true, data: [...issue.data, ...review.data], rateLimit: review.rateLimit };
    },

    async listIssues(repo: string, filters: GitHubIssueFilters): Promise<GitHubResponse<readonly GitHubIssueSummary[]>> {
      const r = repoPath(repo);
      if (r === undefined) return unreachable();
      // `state`, `labels` (comma-separated) and `assignee` go to GitHub as given.
      const query = new URLSearchParams();
      if (filters.state !== undefined) query.set("state", filters.state);
      if (filters.labels !== undefined && filters.labels.length > 0) query.set("labels", filters.labels.join(","));
      if (filters.assignee !== undefined) query.set("assignee", filters.assignee);
      const qs = query.toString();
      // GitHub's issues listing includes pull requests (an entry with a `pull_request` key): those are dropped, so a page can yield fewer items than it read.
      const res = await getPages(`/repos/${r}/issues${qs === "" ? "" : `?${qs}`}`, issueOf);
      if (!res.ok) return res;
      const data = res.data.filter((i): i is GitHubIssueSummary => i !== undefined);
      return { ok: true, data, rateLimit: res.rateLimit };
    },

    async listOpenPullComments(repo: string): Promise<GitHubResponse<readonly GitHubPrComment[]>> {
      const r = repoPath(repo);
      if (r === undefined) return unreachable();
      // One session for the whole walk: the token is read once and a renewal happens at most once.
      const s = await begin();
      if (s === undefined) return unreachable();
      const pulls = await getPages(`/repos/${r}/pulls?state=open`, pullSummaryOf, list, s);
      if (!pulls.ok) return pulls;
      const out: GitHubPrComment[] = [];
      let rateLimit = pulls.rateLimit;
      for (const { number } of pulls.data) {
        // The conversation's comments, the comments on files, then the reviews (a review's body is its summary).
        const pages: [string, (item: unknown) => GitHubPrComment | undefined][] = [
          [`/repos/${r}/issues/${number}/comments`, (c) => prCommentOf("issue_comment", number, c)],
          [`/repos/${r}/pulls/${number}/comments`, (c) => prCommentOf("review_comment", number, c)],
          [`/repos/${r}/pulls/${number}/reviews`, (c) => prCommentOf("review", number, c)],
        ];
        for (const [path, map] of pages) {
          const res = await getPages(path, map, list, s);
          if (!res.ok) return res;
          rateLimit = res.rateLimit;
          for (const c of res.data) if (c !== undefined) out.push(c);
        }
      }
      return { ok: true, data: out, rateLimit };
    },

    // ---- The repo-policy reads (phase 8 item 08): `GitHubRepoPolicyReads` ----

    async getRepoInfo(repo: string): Promise<GitHubResponse<GitHubRepoInfo>> {
      const r = repoPath(repo);
      if (r === undefined) return unreachable();
      return getJson(`/repos/${r}`, (body) => repoInfoOf(body));
    },

    async getBranchProtection(repo: string, branch: string): Promise<GitHubResponse<GitHubBranchProtection>> {
      const r = repoPath(repo);
      const b = branchPath(branch);
      if (r === undefined || b === undefined) return unreachable();
      return getJson(`/repos/${r}/branches/${b}/protection`, (body) => protectionOf(body));
    },

    async listPushCollaborators(repo: string): Promise<GitHubResponse<readonly string[]>> {
      const r = repoPath(repo);
      if (r === undefined) return unreachable();
      return getPages(`/repos/${r}/collaborators?permission=push`, (c) => str(record(c)["login"]));
    },

    async getPullMergeState(repo: string, number: number): Promise<GitHubResponse<GitHubPullMergeState>> {
      const r = repoPath(repo);
      if (r === undefined || !isPullNumber(number)) return unreachable();
      // One session for the whole read: the token is read once and a renewal happens at most once.
      const s = await begin();
      if (s === undefined) return unreachable();
      const pull = await getJsonOn(s, `/repos/${r}/pulls/${number}`, (body) => str(record(record(body)["head"])["sha"]));
      if (!pull.ok) return pull;
      const head = pull.data;
      if (!COMMIT_SHA.test(head)) return unreachable();
      const reviews = await getPages(`/repos/${r}/pulls/${number}/reviews`, reviewOf, list, s);
      if (!reviews.ok) return reviews;
      // Each reviewer's latest deciding review, in the order GitHub lists them (oldest first).
      const latest = new Map<string, { readonly state: string; readonly commit: string | null }>();
      for (const rev of reviews.data) if (rev !== undefined) latest.set(rev.login, rev);
      let approvals = 0;
      let changesRequested = false;
      for (const rev of latest.values()) {
        if (rev.state === "CHANGES_REQUESTED") changesRequested = true;
        else if (rev.state === "APPROVED" && rev.commit === head) approvals += 1;
      }
      const status = await getJsonOn(s, `/repos/${r}/commits/${head}/status`, (body) => {
        const b = record(body);
        const statuses = list(b["statuses"] ?? []);
        return { state: str(b["state"]), total: typeof b["total_count"] === "number" && Number.isSafeInteger(b["total_count"]) ? b["total_count"] : statuses.length };
      });
      if (!status.ok) return status;
      const runs = await getPages(`/repos/${r}/commits/${head}/check-runs`, checkRunOf, (body) => list(record(body)["check_runs"]), s);
      if (!runs.ok) return runs;
      return {
        ok: true,
        data: { head_sha: head, approvals, changes_requested: changesRequested, ci: ciOf(runs.data, status.data.state, status.data.total) },
        rateLimit: runs.rateLimit,
      };
    },

    async replyToReviewComment(repo: string, pull: number, commentId: number, body: string): Promise<GitHubResponse<GitHubCommentResult>> {
      const r = repoPath(repo);
      if (r === undefined || !isPullNumber(pull) || !isPullNumber(commentId) || !isCommentBody(body)) return unreachable();
      return postJson(`/repos/${r}/pulls/${pull}/comments/${commentId}/replies`, { body }, commentResultOf);
    },

    async createPullComment(repo: string, pull: number, body: string): Promise<GitHubResponse<GitHubCommentResult>> {
      const r = repoPath(repo);
      if (r === undefined || !isPullNumber(pull) || !isCommentBody(body)) return unreachable();
      // A pull request's conversation is its issue's comments.
      return postJson(`/repos/${r}/issues/${pull}/comments`, { body }, commentResultOf);
    },

    async createIssueComment(repo: string, issue: number, body: string): Promise<GitHubResponse<GitHubCommentResult>> {
      const r = repoPath(repo);
      if (r === undefined || !isPullNumber(issue) || !isCommentBody(body)) return unreachable();
      return postJson(`/repos/${r}/issues/${issue}/comments`, { body }, commentResultOf);
    },

    async requestReviewers(repo: string, pull: number, reviewers: readonly string[]): Promise<GitHubResponse<{ readonly pull: number }>> {
      const r = repoPath(repo);
      const valid =
        Array.isArray(reviewers) && reviewers.length >= 1 && reviewers.length <= GITHUB_MAX_REVIEWERS && reviewers.every((l) => typeof l === "string" && NAME_SEGMENT.test(l));
      if (r === undefined || !isPullNumber(pull) || !valid) return unreachable();
      // The answer is the pull request itself; only its number is kept, and that is the one asked about.
      return postJson(`/repos/${r}/pulls/${pull}/requested_reviewers`, { reviewers: [...reviewers] }, (b) => {
        record(b);
        return { pull };
      });
    },
  };
}
