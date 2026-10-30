// The real `GitHubClient` (phase 6, item 03): read-only GETs against
// `https://api.github.com` on Node's built-in `fetch` (and the GitHub App's two
// setup POSTs, below). Items 04 and 06 only
// call it; tests inject `fetch` (and the token source), so none reaches the
// network or the Keychain.
//
// The client sends nothing but GETs and two allowlisted POSTs, both of which
// are the GitHub App's own setup calls (`GITHUB_ALLOWED_NON_GET`): minting an
// installation token and converting an App Manifest. `isAllowedGitHubRequest`
// is the one authority for what may be sent, checked with the origin before
// every request. Every request, GET or POST, goes through the one `sendRequest`
// below (timeout, rate limit, bounded read, no redirects).
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
  GitHubClient,
  GitHubFailure,
  GitHubPull,
  GitHubPullComment,
  GitHubPullDiff,
  GitHubPullFile,
  GitHubPullFilters,
  GitHubPullSummary,
  GitHubRateLimit,
  GitHubRepo,
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

/** An owner or repository name segment: GitHub's characters, never `.` or `..`. */
const NAME_SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;

/** The one method the allowlist names besides GET. */
type PostMethod = "POST";

/** What may be sent besides a GET: one entry per allowlisted request. */
export interface GitHubAllowedRequest {
  readonly method: PostMethod;
  /** The path up to the one variable segment. */
  readonly prefix: string;
  /** The shape of the variable segment (an installation id, a manifest code). */
  readonly segment: RegExp;
  /** The path after the variable segment. */
  readonly suffix: string;
}

const MINT_REQUEST: GitHubAllowedRequest = Object.freeze({
  method: "POST",
  prefix: "/app/installations/",
  segment: /^[1-9]\d{0,14}$/,
  suffix: "/access_tokens",
});

const CONVERT_REQUEST: GitHubAllowedRequest = Object.freeze({
  method: "POST",
  prefix: "/app-manifests/",
  segment: /^[A-Za-z0-9_-]{1,128}$/,
  suffix: "/conversions",
});

/**
 * Every request the client may send that is not a GET: minting an installation
 * token (`POST /app/installations/{id}/access_tokens`) and converting an App
 * Manifest (`POST /app-manifests/{code}/conversions`). Nothing else: no PUT,
 * PATCH or DELETE, and no other POST.
 */
export const GITHUB_ALLOWED_NON_GET: readonly GitHubAllowedRequest[] = Object.freeze([MINT_REQUEST, CONVERT_REQUEST]);

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
    return GITHUB_ALLOWED_NON_GET.some((a) => {
      const path = u.pathname;
      if (a.method !== method || path.length < a.prefix.length + a.suffix.length) return false;
      if (!path.startsWith(a.prefix) || !path.endsWith(a.suffix)) return false;
      return a.segment.test(path.slice(a.prefix.length, path.length - a.suffix.length));
    });
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

type GitHubMethod = "GET" | PostMethod;

/** The slice of `GitHubClientDeps` one request needs; `mintInstallationToken` and `convertManifest` take exactly this. */
type RequestDeps = Pick<GitHubClientDeps, "fetch" | "timeoutMs" | "maxBodyBytes" | "now">;

/**
 * One request. `path` is built by the caller from checked parts only; the
 * URL's origin and the method are checked (`isAllowedGitHubRequest`) before the
 * request. Redirects are never followed, so no request (and no token) goes
 * anywhere but `GITHUB_API_ORIGIN`. `bearer` is the caller's already-checked
 * credential; with none, no `authorization` header is sent at all. Never throws.
 */
async function sendRequest(
  deps: RequestDeps,
  method: GitHubMethod,
  path: string,
  accept: string,
  maxBytes: number,
  bearer: string | undefined,
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
        "user-agent": "loomwright-studio",
        "x-github-api-version": GITHUB_API_VERSION,
      },
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
 * `POST /app/installations/{id}/access_tokens`, authenticated by the App's own
 * `jwt` (as its bearer, checked by shape: three base64url segments, not the
 * PAT's 255-character bound). The answer must carry a token of an acceptable
 * shape, a valid `expires_at` and a `permissions` object of strings, or the
 * result is `unreachable`. A 401 or 404 arrives as `http_error` with its
 * status. Never throws; nothing in the result but `token` is a secret.
 */
export async function mintInstallationToken(installationId: number, jwt: string, deps: RequestDeps = {}): Promise<InstallationTokenResult> {
  try {
    if (!Number.isSafeInteger(installationId) || installationId < 1 || !isAppJwtShape(jwt)) return SETUP_UNREACHABLE;
    const maxBytes = deps.maxBodyBytes ?? GITHUB_DEFAULT_MAX_BODY_BYTES;
    const path = `${MINT_REQUEST.prefix}${installationId}${MINT_REQUEST.suffix}`;
    const answer = await sendRequest(deps, "POST", path, "application/vnd.github+json", maxBytes, jwt);
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
    if (typeof code !== "string" || !CONVERT_REQUEST.segment.test(code)) return SETUP_UNREACHABLE;
    const maxBytes = deps.maxBodyBytes ?? GITHUB_DEFAULT_MAX_BODY_BYTES;
    const path = `${CONVERT_REQUEST.prefix}${code}${CONVERT_REQUEST.suffix}`;
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
export function createGitHubClient(deps: GitHubClientDeps = {}): GitHubClient {
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
   * One GET with the session's token. A 401 asks the provider to renew (when
   * it can) and retries once: at most one renewal per client call, however
   * many pages it reads. Never throws.
   */
  async function get(s: Session, path: string, accept: string, maxBytes: number): Promise<Answer> {
    const first = await sendRequest(deps, "GET", path, accept, maxBytes, s.tok);
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
    return sendRequest(deps, "GET", path, accept, maxBytes, s.tok);
  }

  /** One JSON GET mapped by `map`. A body over the bound or off the documented shape is `unreachable`. */
  async function getJson<T>(path: string, map: (body: unknown, headers: Headers) => T): Promise<GitHubResponse<T>> {
    const s = await begin();
    if (s === undefined) return unreachable();
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
  };
}
