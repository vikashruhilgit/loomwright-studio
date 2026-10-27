// The real `GitHubClient` (phase 6, item 03): read-only GETs against
// `https://api.github.com` on Node's built-in `fetch`. Items 04 and 06 only
// call it; tests inject `fetch` (and the token source), so none reaches the
// network or the Keychain.
//
// The `studio` CLI loads the feature registry, which loads this feature, so
// this file imports only types and the Keychain module: never the Agent SDK,
// the session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts`).
//
// The token never leaves this module except in the `authorization` header:
//   - its shape is checked (`WRITE_ARG`, the shape the Keychain writer takes)
//     before it reaches a header, so `Headers` never throws a `TypeError`
//     quoting it;
//   - every throw (Keychain, `fetch`, body read, JSON, shape) is caught here and
//     answered as `unreachable`, which carries no message at all;
//   - nothing here logs.
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
// infers them, least of all from a write attempt.
import { securityCliKeychain, WRITE_ARG } from "../../auth/keychain.js";
import type { KeychainReader } from "../../auth/keychain.js";
import type {
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

/** An owner or repository name segment: GitHub's characters, never `.` or `..`. */
const NAME_SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;

export interface GitHubClientDeps {
  /**
   * Where the token comes from, read fresh on every call. Default: the
   * Keychain item `GITHUB_KEYCHAIN_SERVICE` through `keychain`. The connector
   * passes a candidate token here to validate it before writing it.
   */
  readonly readToken?: () => string | undefined;
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

/** Builds the real client. Nothing runs (no Keychain read, no request) until a method is called. */
export function createGitHubClient(deps: GitHubClientDeps = {}): GitHubClient {
  const timeoutMs = deps.timeoutMs ?? GITHUB_DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = deps.maxBodyBytes ?? GITHUB_DEFAULT_MAX_BODY_BYTES;
  const maxPages = deps.maxPages ?? GITHUB_DEFAULT_MAX_PAGES;
  const now = deps.now ?? (() => new Date());
  let keychain: KeychainReader | undefined = deps.keychain;

  /** The token, read fresh, or `undefined` when there is none usable. Never throws. */
  function token(): string | undefined {
    try {
      let t: string | undefined;
      if (deps.readToken !== undefined) {
        t = deps.readToken();
      } else {
        keychain ??= securityCliKeychain();
        t = keychain.read(GITHUB_KEYCHAIN_SERVICE);
      }
      return isUsableToken(t) ? t : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * One GET. `path` is built here from checked parts only; the URL's origin
   * is checked again before the request. Redirects are never followed, so no
   * request (and no token) goes anywhere but `GITHUB_API_ORIGIN`. Never throws.
   */
  async function get(tok: string, path: string, accept: string, maxBytes: number): Promise<Answer> {
    try {
      const url = new URL(path, GITHUB_API_ORIGIN);
      if (url.origin !== GITHUB_API_ORIGIN) return { kind: "failure", failure: UNREACHABLE };
      const doFetch = deps.fetch ?? globalThis.fetch;
      const res = await doFetch(url.href, {
        method: "GET",
        redirect: "manual",
        headers: {
          accept,
          authorization: `Bearer ${tok}`,
          "user-agent": "loomwright-studio",
          "x-github-api-version": GITHUB_API_VERSION,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const at = now();
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

  /** One JSON GET mapped by `map`. A body over the bound or off the documented shape is `unreachable`. */
  async function getJson<T>(path: string, map: (body: unknown, headers: Headers) => T): Promise<GitHubResponse<T>> {
    const tok = token();
    if (tok === undefined) return unreachable();
    const answer = await get(tok, path, "application/vnd.github+json", maxBodyBytes);
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
   * page fails the listing.
   */
  async function getPages<T>(path: string, map: (item: unknown) => T): Promise<GitHubResponse<readonly T[]>> {
    const tok = token();
    if (tok === undefined) return unreachable();
    const items: T[] = [];
    let rateLimit: GitHubRateLimit | undefined;
    const sep = path.includes("?") ? "&" : "?";
    for (let page = 1; page <= maxPages; page++) {
      const answer = await get(tok, `${path}${sep}per_page=${PER_PAGE}&page=${page}`, "application/vnd.github+json", maxBodyBytes);
      if (answer.kind === "failure") return answer.failure;
      if (answer.over) return unreachable();
      rateLimit = answer.rateLimit;
      let pageItems: readonly unknown[];
      try {
        pageItems = list(JSON.parse(Buffer.from(answer.body).toString("utf8")) as unknown);
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

    listReachableRepos(): Promise<GitHubResponse<readonly GitHubRepo[]>> {
      return getPages("/user/repos", repoOf);
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
      const tok = token();
      if (tok === undefined) return unreachable();
      // Never more than the body bound, whatever the caller asks.
      const bound = Math.min(maxBytes, maxBodyBytes);
      const answer = await get(tok, `/repos/${r}/pulls/${number}`, "application/vnd.github.diff", bound);
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
