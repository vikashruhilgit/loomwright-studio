// A `GitHubClient` for tests: it answers from canned data and records every
// call, and never reaches the network (no `fetch`, no socket). Phase 6 items
// 03, 04 and 06 code against `GitHubClient` and test against this.
import type {
  GitHubBranchProtection,
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
} from "../../src/integrations/types.js";

/** A `GitHubClient` or `GitHubRepoPolicyReads` method's name. */
export type GitHubCallName = keyof (GitHubClient & GitHubRepoPolicyReads);

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
  /** Issues by `<owner>/<repo>`: `listIssues` answers them (every entry is an issue, never a pull request). */
  readonly issues?: Readonly<Record<string, readonly GitHubIssueSummary[]>>;
  /** Comments and reviews on open pulls by `<owner>/<repo>`: `listOpenPullComments` answers them. */
  readonly prComments?: Readonly<Record<string, readonly GitHubPrComment[]>>;
  /** Repo info by `<owner>/<repo>`: `getRepoInfo` answers it (`http_error` 404 for a repo not listed). */
  readonly repoInfo?: Readonly<Record<string, GitHubRepoInfo>>;
  /**
   * Branch protection by `<owner>/<repo>`: `getBranchProtection` answers the protection (any branch), or an HTTP
   * status as `http_error` (403: GitHub cannot enforce protection here; 404: the branch is unprotected). A repo not listed is 404.
   */
  readonly protection?: Readonly<Record<string, GitHubBranchProtection | number>>;
  /** Push collaborators' logins by `<owner>/<repo>`: `listPushCollaborators` answers them (none for a repo not listed). */
  readonly pushers?: Readonly<Record<string, readonly string[]>>;
  /** Merge state by `<owner>/<repo>#<n>`: `getPullMergeState` answers it (`http_error` 404 for one not listed). A test moves it with `setMergeState`. */
  readonly mergeStates?: Readonly<Record<string, GitHubPullMergeState>>;
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
export class FakeGitHubClient implements GitHubClient, GitHubRepoPolicyReads {
  readonly calls: GitHubCall[] = [];
  readonly #data: FakeGitHubData;
  /** The merge states, mutable mid-test (a head moving, an approval landing): seeded from `data.mergeStates`. */
  readonly #mergeStates: Map<string, GitHubPullMergeState>;
  readonly #protection: Map<string, GitHubBranchProtection | number>;

  constructor(data: FakeGitHubData = {}) {
    this.#data = data;
    this.#mergeStates = new Map(Object.entries(data.mergeStates ?? {}));
    this.#protection = new Map(Object.entries(data.protection ?? {}));
  }

  /** Replaces pull `number`'s merge state from now on (the head moves, an approval lands). */
  setMergeState(repo: string, number: number, state: GitHubPullMergeState): void {
    this.#mergeStates.set(`${repo}#${number}`, state);
  }

  /** Replaces `repo`'s branch protection from now on: the protection, or an HTTP status it fails with. */
  setProtection(repo: string, protection: GitHubBranchProtection | number): void {
    this.#protection.set(repo, protection);
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

  /** Filters are recorded as given; `labels` is applied (an issue must carry every one), `state` and `assignee` are not (an issue summary has neither). */
  listIssues(repo: string, filters: GitHubIssueFilters): Promise<GitHubResponse<readonly GitHubIssueSummary[]>> {
    return this.#answer("listIssues", [repo, filters], () =>
      (this.#data.issues?.[repo] ?? []).filter((i) => (filters.labels ?? []).every((l) => i.labels.includes(l))),
    );
  }

  listOpenPullComments(repo: string): Promise<GitHubResponse<readonly GitHubPrComment[]>> {
    return this.#answer("listOpenPullComments", [repo], () => this.#data.prComments?.[repo] ?? []);
  }

  // ---- The repo-policy reads (`GitHubRepoPolicyReads`) ----

  /** An `http_error` answer, recorded; a `failures` entry for the method still wins. */
  #httpError(method: GitHubCallName, args: readonly unknown[], status: number): Promise<GitHubResponse<never>> {
    this.calls.push({ method, args: [...args] });
    return Promise.resolve(this.#data.failures?.[method] ?? { ok: false, error: "http_error", status, rateLimit: this.#data.rateLimit ?? FAKE_RATE_LIMIT });
  }

  getRepoInfo(repo: string): Promise<GitHubResponse<GitHubRepoInfo>> {
    const info = this.#data.repoInfo?.[repo];
    if (info === undefined) return this.#httpError("getRepoInfo", [repo], 404);
    return this.#answer("getRepoInfo", [repo], () => info);
  }

  getBranchProtection(repo: string, branch: string): Promise<GitHubResponse<GitHubBranchProtection>> {
    const p = this.#protection.get(repo);
    if (p === undefined || typeof p === "number") return this.#httpError("getBranchProtection", [repo, branch], p ?? 404);
    return this.#answer("getBranchProtection", [repo, branch], () => p);
  }

  listPushCollaborators(repo: string): Promise<GitHubResponse<readonly string[]>> {
    return this.#answer("listPushCollaborators", [repo], () => this.#data.pushers?.[repo] ?? []);
  }

  getPullMergeState(repo: string, number: number): Promise<GitHubResponse<GitHubPullMergeState>> {
    const state = this.#mergeStates.get(`${repo}#${number}`);
    if (state === undefined) return this.#httpError("getPullMergeState", [repo, number], 404);
    return this.#answer("getPullMergeState", [repo, number], () => state);
  }

  // The writes are recorded in `calls` with their arguments as given (a test asserts "exactly that request" or "nothing sent"); none reaches a network.

  replyToReviewComment(repo: string, pull: number, commentId: number, body: string): Promise<GitHubResponse<GitHubCommentResult>> {
    return this.#answer("replyToReviewComment", [repo, pull, commentId, body], () => this.#created(repo, `pull/${pull}#discussion_r`));
  }

  createPullComment(repo: string, pull: number, body: string): Promise<GitHubResponse<GitHubCommentResult>> {
    return this.#answer("createPullComment", [repo, pull, body], () => this.#created(repo, `pull/${pull}#issuecomment-`));
  }

  createIssueComment(repo: string, issue: number, body: string): Promise<GitHubResponse<GitHubCommentResult>> {
    return this.#answer("createIssueComment", [repo, issue, body], () => this.#created(repo, `issues/${issue}#issuecomment-`));
  }

  requestReviewers(repo: string, pull: number, reviewers: readonly string[]): Promise<GitHubResponse<{ readonly pull: number }>> {
    return this.#answer("requestReviewers", [repo, pull, reviewers], () => ({ pull }));
  }

  /** The calls to `method`, in order. */
  callsTo(method: GitHubCallName): GitHubCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  #nextId = 5000;

  /** A new comment's canned answer: ids count up from 5000. */
  #created(repo: string, tail: string): GitHubCommentResult {
    const id = this.#nextId++;
    return { id, url: `https://github.com/${repo}/${tail}${id}` };
  }
}
