// A `GitHubClient` for tests: it answers from canned data and records every
// call, and never reaches the network (no `fetch`, no socket). Phase 6 items
// 03, 04 and 06 code against `GitHubClient` and test against this.
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
} from "../../src/integrations/types.js";

/** A `GitHubClient` method's name. */
export type GitHubCallName = keyof GitHubClient;

/** One call the fake answered, with its arguments as given. */
export interface GitHubCall {
  readonly method: GitHubCallName;
  readonly args: readonly unknown[];
}

/** The rate limit every canned answer carries unless a test sets another. */
export const FAKE_RATE_LIMIT: GitHubRateLimit = Object.freeze({ limit: 5000, remaining: 4999, reset_at: "2026-10-27T13:00:00.000Z" });

/** What the fake answers. Every field is optional: an absent one answers empty data (or `http_error` 404 for one pull). */
export interface FakeGitHubData {
  readonly tokenInfo?: GitHubTokenInfo;
  readonly repos?: readonly GitHubRepo[];
  /** Pulls by `<owner>/<repo>`: `listOpenPulls` answers the summaries, `getPull` one by number. */
  readonly pulls?: Readonly<Record<string, readonly GitHubPull[]>>;
  /** Diffs by `<owner>/<repo>#<n>`. */
  readonly diffs?: Readonly<Record<string, string>>;
  /** Files by `<owner>/<repo>#<n>`. */
  readonly files?: Readonly<Record<string, readonly GitHubPullFile[]>>;
  /** Comments by `<owner>/<repo>#<n>`. */
  readonly comments?: Readonly<Record<string, readonly GitHubPullComment[]>>;
  readonly rateLimit?: GitHubRateLimit;
  /** A method answering this failure instead of data (e.g. `rate_limited`). */
  readonly failures?: Partial<Record<GitHubCallName, GitHubFailure>>;
}

/** The token info the fake answers by default. */
export const FAKE_TOKEN_INFO: GitHubTokenInfo = Object.freeze({ login: "studio-tester", expires_at: null, permissions: null });

/**
 * A canned `GitHubClient`. `calls` lists every call in order. Filters are
 * applied as given (`draft`, `author`); `state` is recorded but every canned
 * pull is open. Answers are copies: a test mutating one never changes the
 * canned data.
 */
export class FakeGitHubClient implements GitHubClient {
  readonly calls: GitHubCall[] = [];
  readonly #data: FakeGitHubData;

  constructor(data: FakeGitHubData = {}) {
    this.#data = data;
  }

  #answer<T>(method: GitHubCallName, args: readonly unknown[], data: () => T): Promise<GitHubResponse<T>> {
    this.calls.push({ method, args: [...args] });
    const failure = this.#data.failures?.[method];
    if (failure !== undefined) return Promise.resolve(failure);
    return Promise.resolve({ ok: true, data: structuredClone(data()), rateLimit: this.#data.rateLimit ?? FAKE_RATE_LIMIT });
  }

  #pull(repo: string, number: number): GitHubPull | undefined {
    return this.#data.pulls?.[repo]?.find((p) => p.number === number);
  }

  getTokenInfo(): Promise<GitHubResponse<GitHubTokenInfo>> {
    return this.#answer("getTokenInfo", [], () => this.#data.tokenInfo ?? FAKE_TOKEN_INFO);
  }

  listReachableRepos(): Promise<GitHubResponse<readonly GitHubRepo[]>> {
    return this.#answer("listReachableRepos", [], () => this.#data.repos ?? []);
  }

  listOpenPulls(repo: string, filters: GitHubPullFilters): Promise<GitHubResponse<readonly GitHubPullSummary[]>> {
    return this.#answer("listOpenPulls", [repo, filters], () =>
      (this.#data.pulls?.[repo] ?? [])
        .filter((p) => (filters.draft === undefined || p.draft === filters.draft) && (filters.author === undefined || p.author === filters.author))
        .map(({ number, title, author, draft, head_sha, url, updated_at }) => ({ number, title, author, draft, head_sha, url, updated_at })),
    );
  }

  getPull(repo: string, number: number): Promise<GitHubResponse<GitHubPull>> {
    const pull = this.#pull(repo, number);
    if (pull === undefined && this.#data.failures?.getPull === undefined) {
      this.calls.push({ method: "getPull", args: [repo, number] });
      return Promise.resolve({ ok: false, error: "http_error", status: 404, rateLimit: this.#data.rateLimit ?? FAKE_RATE_LIMIT });
    }
    return this.#answer("getPull", [repo, number], () => pull as GitHubPull);
  }

  getPullDiff(repo: string, number: number, maxBytes: number): Promise<GitHubResponse<GitHubPullDiff>> {
    return this.#answer("getPullDiff", [repo, number, maxBytes], () => {
      const whole = Buffer.from(this.#data.diffs?.[`${repo}#${number}`] ?? "", "utf8");
      const truncated = whole.length > maxBytes;
      return { diff: truncated ? whole.subarray(0, Math.max(0, maxBytes)).toString("utf8") : whole.toString("utf8"), truncated };
    });
  }

  listPullFiles(repo: string, number: number): Promise<GitHubResponse<readonly GitHubPullFile[]>> {
    return this.#answer("listPullFiles", [repo, number], () => this.#data.files?.[`${repo}#${number}`] ?? []);
  }

  listPullComments(repo: string, number: number): Promise<GitHubResponse<readonly GitHubPullComment[]>> {
    return this.#answer("listPullComments", [repo, number], () => this.#data.comments?.[`${repo}#${number}`] ?? []);
  }
}
