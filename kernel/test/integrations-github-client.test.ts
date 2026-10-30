// The real `GitHubClient` (phase 6, item 03, AC4 client half, AC9a, AC9). Every
// test injects `fetch` and the token source: none reaches the network or the
// Keychain. Answers are shaped like GitHub's REST responses and checked
// against the shapes `FakeGitHubClient` models.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import type { KeychainReader } from "../src/auth/index.js";
import {
  convertManifest,
  createGitHubClient,
  GITHUB_ALLOWED_NON_GET,
  GITHUB_API_ORIGIN,
  GITHUB_DEFAULT_MAX_BODY_BYTES,
  GITHUB_DEFAULT_MAX_PAGES,
  GITHUB_KEYCHAIN_SERVICE,
  isAllowedGitHubRequest,
  mintInstallationToken,
  parseTokenExpiration,
} from "../src/integrations/github/client.js";
import type { GitHubClientDeps, GitHubTokenProvider } from "../src/integrations/github/client.js";
import type { GitHubClient, GitHubResponse } from "../src/integrations/types.js";
import { FakeGitHubClient } from "./fixtures/github-fake.js";

const TOKEN = "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd";
const NOW = new Date("2026-10-27T12:00:00.000Z");
const RESET_EPOCH = 1_793_106_000; // 2026-10-27T13:00:00Z, an hour after NOW
const RESET_ISO = new Date(RESET_EPOCH * 1000).toISOString();
const RL_HEADERS = { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "4990", "x-ratelimit-reset": String(RESET_EPOCH) };
const RATE_LIMIT = { limit: 5000, remaining: 4990, reset_at: RESET_ISO };

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

type Route = (url: URL) => Response | Promise<Response>;

/** A `fetch` that answers from `route` and records every call. */
function fakeFetch(route: Route): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return route(new URL(url));
  }) as typeof fetch;
  return { fetch: f, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...RL_HEADERS, ...headers } });
}

function client(route: Route, extra: Partial<GitHubClientDeps> = {}): { gh: GitHubClient; calls: Call[] } {
  const { fetch, calls } = fakeFetch(route);
  return { gh: createGitHubClient({ readToken: () => TOKEN, fetch, now: () => NOW, ...extra }), calls };
}

function headerOf(call: Call | undefined, name: string): string | null {
  return new Headers(call?.init.headers).get(name);
}

const user = (login: string) => ({ login, id: 1, type: "User" });

function apiPull(n: number, over: Record<string, unknown> = {}) {
  return {
    number: n,
    title: `PR ${n}`,
    user: user("alice"),
    draft: false,
    head: { sha: `sha${n}`, ref: `feature-${n}` },
    base: { ref: "main" },
    html_url: `https://github.com/o/r/pull/${n}`,
    updated_at: "2026-10-26T10:00:00Z",
    body: `body ${n}`,
    state: "open",
    labels: [{ name: "bug", color: "red" }],
    ...over,
  };
}

function repos(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({ full_name: `owner/repo-${from + i}`, private: (from + i) % 2 === 0, id: from + i }));
}

/** Every one of the seven methods, called with plain arguments. */
const METHODS: ReadonlyArray<readonly [keyof GitHubClient, (gh: GitHubClient) => Promise<GitHubResponse<unknown>>]> = [
  ["getTokenInfo", (gh) => gh.getTokenInfo()],
  ["listReachableRepos", (gh) => gh.listReachableRepos()],
  ["listOpenPulls", (gh) => gh.listOpenPulls("o/r", {})],
  ["getPull", (gh) => gh.getPull("o/r", 1)],
  ["getPullDiff", (gh) => gh.getPullDiff("o/r", 1, 1000)],
  ["listPullFiles", (gh) => gh.listPullFiles("o/r", 1)],
  ["listPullComments", (gh) => gh.listPullComments("o/r", 1)],
];

// ---------------------------------------------------------------------------
// AC9a: the seven methods
// ---------------------------------------------------------------------------

describe("getTokenInfo (AC9a, AC4 client half)", () => {
  it("GET /user: the login, the expiry from github-authentication-token-expiration, and permissions always null", async () => {
    const { gh, calls } = client(() =>
      json(user("octo-owner"), 200, { "github-authentication-token-expiration": "2026-11-26 09:30:00 UTC" }),
    );
    const res = await gh.getTokenInfo();
    expect(res).toEqual({
      ok: true,
      data: { login: "octo-owner", expires_at: "2026-11-26T09:30:00.000Z", permissions: null },
      rateLimit: RATE_LIMIT,
    });
    expect(calls.map((c) => c.url)).toEqual([`${GITHUB_API_ORIGIN}/user`]);
    expect(headerOf(calls[0], "authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headerOf(calls[0], "accept")).toBe("application/vnd.github+json");
    expect(headerOf(calls[0], "x-github-api-version")).toBe("2022-11-28");
  });

  it("permissions stay null whatever the answer suggests: the client never infers them", async () => {
    const { gh, calls } = client(() =>
      json({ ...user("octo"), permissions: { pull_requests: "read" } }, 200, {
        "x-oauth-scopes": "repo",
        "x-accepted-github-permissions": "metadata=read",
      }),
    );
    const res = await gh.getTokenInfo();
    expect(res.ok && res.data.permissions).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls.every((c) => c.init.method === "GET")).toBe(true);
  });

  it("no expiry header, or one it cannot read, is expires_at null, never a throw", async () => {
    for (const header of [undefined, "next tuesday", "2026-13-45 99:99:99 UTC"]) {
      const { gh } = client(() =>
        json(user("octo"), 200, header === undefined ? {} : { "github-authentication-token-expiration": header }),
      );
      const res = await gh.getTokenInfo();
      expect(res.ok && res.data.expires_at).toBeNull();
    }
  });

  it("parseTokenExpiration reads the documented form and an offset", () => {
    expect(parseTokenExpiration("2026-11-26 09:30:00 UTC")).toBe("2026-11-26T09:30:00.000Z");
    expect(parseTokenExpiration("2026-11-26 09:30:00 +0200")).toBe("2026-11-26T07:30:00.000Z");
    expect(parseTokenExpiration("2026-11-26T09:30:00Z")).toBe("2026-11-26T09:30:00.000Z");
    expect(parseTokenExpiration(null)).toBeNull();
    expect(parseTokenExpiration("")).toBeNull();
  });

  it("a 401 is http_error 401 with the rate limit", async () => {
    const { gh } = client(() => json({ message: "Bad credentials" }, 401));
    expect(await gh.getTokenInfo()).toEqual({ ok: false, error: "http_error", status: 401, rateLimit: RATE_LIMIT });
  });
});

describe("listReachableRepos (AC9a)", () => {
  it("GET /user/repos, 100 a page, until a short page", async () => {
    const { gh, calls } = client((url) => (url.searchParams.get("page") === "1" ? json(repos(0, 100)) : json(repos(100, 3))));
    const res = await gh.listReachableRepos();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toHaveLength(103);
    expect(res.data[0]).toEqual({ full_name: "owner/repo-0", private: true });
    expect(res.data[101]).toEqual({ full_name: "owner/repo-101", private: false });
    expect(calls.map((c) => c.url)).toEqual([
      `${GITHUB_API_ORIGIN}/user/repos?per_page=100&page=1`,
      `${GITHUB_API_ORIGIN}/user/repos?per_page=100&page=2`,
    ]);
  });

  it("stops at the page cap", async () => {
    const { gh, calls } = client((url) => json(repos(Number(url.searchParams.get("page")) * 100, 100)), { maxPages: 3 });
    const res = await gh.listReachableRepos();
    expect(calls).toHaveLength(3);
    expect(res.ok && res.data.length).toBe(300);
  });

  it(`stops at the default page cap (${GITHUB_DEFAULT_MAX_PAGES}) when none is given`, async () => {
    const { gh, calls } = client((url) => json(repos(Number(url.searchParams.get("page")) * 100, 100)));
    const res = await gh.listReachableRepos();
    expect(calls).toHaveLength(GITHUB_DEFAULT_MAX_PAGES);
    expect(res.ok && res.data.length).toBe(GITHUB_DEFAULT_MAX_PAGES * 100);
  });

  it("a failed page fails the listing", async () => {
    const { gh } = client((url) => (url.searchParams.get("page") === "1" ? json(repos(0, 100)) : json({}, 502)));
    expect(await gh.listReachableRepos()).toEqual({ ok: false, error: "http_error", status: 502, rateLimit: RATE_LIMIT });
  });
});

describe("listOpenPulls (AC9a)", () => {
  const pulls = [apiPull(1), apiPull(2, { draft: true }), apiPull(3, { user: user("bob") })];

  it("maps each pull to the summary shape FakeGitHubClient answers", async () => {
    const { gh, calls } = client(() => json(pulls));
    const res = await gh.listOpenPulls("o/r", {});
    const fake = new FakeGitHubClient({
      pulls: {
        "o/r": pulls.map((p) => ({
          number: p.number,
          title: p.title,
          author: p.user.login,
          draft: p.draft,
          head_sha: p.head.sha,
          url: p.html_url,
          updated_at: p.updated_at,
          body: p.body,
          state: p.state,
          base_ref: p.base.ref,
          head_ref: p.head.ref,
          labels: ["bug"],
        })),
      },
    });
    const expected = await fake.listOpenPulls("o/r", {});
    expect(res.ok && expected.ok && res.data).toEqual(expected.ok && expected.data);
    expect(calls.map((c) => c.url)).toEqual([`${GITHUB_API_ORIGIN}/repos/o/r/pulls?per_page=100&page=1`]);
  });

  it("applies the filters as given: state to GitHub, draft and author here", async () => {
    const { gh, calls } = client(() => json(pulls));
    const drafts = await gh.listOpenPulls("o/r", { state: "open", draft: true });
    expect(drafts.ok && drafts.data.map((p) => p.number)).toEqual([2]);
    const bobs = await gh.listOpenPulls("o/r", { author: "bob" });
    expect(bobs.ok && bobs.data.map((p) => p.number)).toEqual([3]);
    const ready = await gh.listOpenPulls("o/r", { draft: false, author: "alice" });
    expect(ready.ok && ready.data.map((p) => p.number)).toEqual([1]);
    expect(new URL(calls[0]?.url ?? "").searchParams.get("state")).toBe("open");
    expect(new URL(calls[1]?.url ?? "").searchParams.has("state")).toBe(false);
  });

  it("a deleted author (user null) reads as ghost", async () => {
    const { gh } = client(() => json([apiPull(9, { user: null })]));
    const res = await gh.listOpenPulls("o/r", {});
    expect(res.ok && res.data[0]?.author).toBe("ghost");
  });
});

describe("getPull (AC9a)", () => {
  it("GET /repos/o/r/pulls/n in the GitHubPull shape", async () => {
    const { gh, calls } = client(() => json(apiPull(7, { body: null, labels: [{ name: "a" }, { name: "b" }] })));
    expect(await gh.getPull("o/r", 7)).toEqual({
      ok: true,
      data: {
        number: 7,
        title: "PR 7",
        author: "alice",
        draft: false,
        head_sha: "sha7",
        url: "https://github.com/o/r/pull/7",
        updated_at: "2026-10-26T10:00:00Z",
        body: "",
        state: "open",
        base_ref: "main",
        head_ref: "feature-7",
        labels: ["a", "b"],
      },
      rateLimit: RATE_LIMIT,
    });
    expect(calls.map((c) => c.url)).toEqual([`${GITHUB_API_ORIGIN}/repos/o/r/pulls/7`]);
  });

  it("a missing pull is http_error 404, as FakeGitHubClient answers it", async () => {
    const { gh } = client(() => json({ message: "Not Found" }, 404));
    const res = await gh.getPull("o/r", 99);
    const fake = await new FakeGitHubClient().getPull("o/r", 99);
    expect(res).toMatchObject({ ok: false, error: "http_error", status: 404 });
    expect(fake).toMatchObject({ ok: false, error: "http_error", status: 404 });
  });
});

describe("getPullDiff (AC9a)", () => {
  const DIFF = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n";

  it("asks for the diff media type and answers it whole when it fits", async () => {
    const { gh, calls } = client(() => new Response(DIFF, { headers: RL_HEADERS }));
    expect(await gh.getPullDiff("o/r", 4, 10_000)).toEqual({ ok: true, data: { diff: DIFF, truncated: false }, rateLimit: RATE_LIMIT });
    expect(calls[0]?.url).toBe(`${GITHUB_API_ORIGIN}/repos/o/r/pulls/4`);
    expect(headerOf(calls[0], "accept")).toBe("application/vnd.github.diff");
  });

  it("cuts a long diff at maxBytes and says so, as FakeGitHubClient does", async () => {
    const { gh } = client(() => new Response(DIFF, { headers: RL_HEADERS }));
    const res = await gh.getPullDiff("o/r", 4, 10);
    expect(res).toEqual({ ok: true, data: { diff: DIFF.slice(0, 10), truncated: true }, rateLimit: RATE_LIMIT });
    const fake = await new FakeGitHubClient({ diffs: { "o/r#4": DIFF } }).getPullDiff("o/r", 4, 10);
    expect(res.ok && fake.ok && res.data).toEqual(fake.ok && fake.data);
  });

  it("exactly maxBytes is not truncated", async () => {
    const { gh } = client(() => new Response(DIFF, { headers: RL_HEADERS }));
    const res = await gh.getPullDiff("o/r", 4, Buffer.byteLength(DIFF));
    expect(res.ok && res.data).toEqual({ diff: DIFF, truncated: false });
  });

  it("never reads more than the body bound, whatever maxBytes asks", async () => {
    const big = "x".repeat(5000);
    const { gh } = client(() => new Response(big, { headers: RL_HEADERS }), { maxBodyBytes: 1000 });
    const res = await gh.getPullDiff("o/r", 4, 1_000_000);
    expect(res.ok && res.data.diff.length).toBe(1000);
    expect(res.ok && res.data.truncated).toBe(true);
  });
});

describe("listPullFiles (AC9a)", () => {
  it("GET /repos/o/r/pulls/n/files in the GitHubPullFile shape", async () => {
    const { gh, calls } = client(() =>
      json([
        { filename: "src/a.ts", status: "modified", additions: 3, deletions: 1, patch: "@@" },
        { filename: "README.md", status: "added", additions: 10, deletions: 0 },
      ]),
    );
    expect(await gh.listPullFiles("o/r", 5)).toEqual({
      ok: true,
      data: [
        { path: "src/a.ts", status: "modified", additions: 3, deletions: 1 },
        { path: "README.md", status: "added", additions: 10, deletions: 0 },
      ],
      rateLimit: RATE_LIMIT,
    });
    expect(calls.map((c) => c.url)).toEqual([`${GITHUB_API_ORIGIN}/repos/o/r/pulls/5/files?per_page=100&page=1`]);
  });
});

describe("listPullComments (AC9a)", () => {
  it("issue comments then review comments, each with its kind; only a review comment has a path", async () => {
    const { gh, calls } = client((url) =>
      url.pathname.includes("/issues/")
        ? json([{ user: user("alice"), body: "LGTM", created_at: "2026-10-26T11:00:00Z" }])
        : json([{ user: user("bob"), body: "nit", created_at: "2026-10-26T10:00:00Z", path: "src/a.ts", line: 3 }]),
    );
    expect(await gh.listPullComments("o/r", 6)).toEqual({
      ok: true,
      data: [
        { kind: "issue", author: "alice", body: "LGTM", created_at: "2026-10-26T11:00:00Z", path: null },
        { kind: "review", author: "bob", body: "nit", created_at: "2026-10-26T10:00:00Z", path: "src/a.ts" },
      ],
      rateLimit: RATE_LIMIT,
    });
    expect(calls.map((c) => c.url)).toEqual([
      `${GITHUB_API_ORIGIN}/repos/o/r/issues/6/comments?per_page=100&page=1`,
      `${GITHUB_API_ORIGIN}/repos/o/r/pulls/6/comments?per_page=100&page=1`,
    ]);
  });

  it("a failed issue-comment read fails the whole call without reading review comments", async () => {
    const { gh, calls } = client(() => json({}, 500));
    expect(await gh.listPullComments("o/r", 6)).toMatchObject({ ok: false, error: "http_error", status: 500 });
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC9: rate limits, timeouts, bounds, origin, the token
// ---------------------------------------------------------------------------

describe("rate limits (AC9)", () => {
  it.each(METHODS)("%s: a 403 with x-ratelimit-remaining 0 is rate_limited, resets_at from x-ratelimit-reset, never a throw", async (_, call) => {
    const { gh } = client(() => json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0" }));
    expect(await call(gh)).toEqual({
      ok: false,
      error: "rate_limited",
      resets_at: RESET_ISO,
      rateLimit: { limit: 5000, remaining: 0, reset_at: RESET_ISO },
    });
  });

  it.each(METHODS)("%s: a 429 is rate_limited", async (_, call) => {
    const { gh } = client(() => json({ message: "Too Many Requests" }, 429));
    expect(await call(gh)).toMatchObject({ ok: false, error: "rate_limited", resets_at: RESET_ISO });
  });

  it("a 403 secondary limit (retry-after, no reset header) resets retry-after seconds from now", async () => {
    const { gh } = client(
      () => new Response("{}", { status: 403, headers: { "retry-after": "120", "x-ratelimit-remaining": "17" } }),
    );
    expect(await gh.getTokenInfo()).toMatchObject({ ok: false, error: "rate_limited", resets_at: "2026-10-27T12:02:00.000Z" });
  });

  it("a 429 with no reset and no retry-after resets one minute from now", async () => {
    const { gh } = client(() => new Response("{}", { status: 429 }));
    expect(await gh.getTokenInfo()).toEqual({
      ok: false,
      error: "rate_limited",
      resets_at: "2026-10-27T12:01:00.000Z",
      rateLimit: { limit: 0, remaining: 0, reset_at: NOW.toISOString() },
    });
  });

  it("a 403 that is not a rate limit is http_error 403", async () => {
    const { gh } = client(() => json({ message: "Resource not accessible by personal access token" }, 403));
    expect(await gh.getPull("o/r", 1)).toEqual({ ok: false, error: "http_error", status: 403, rateLimit: RATE_LIMIT });
  });

  it("every answer carries x-ratelimit-* as rateLimit", async () => {
    const { gh } = client(() => json([]));
    for (const [, call] of METHODS.filter(([m]) => m !== "getTokenInfo" && m !== "getPull" && m !== "getPullDiff")) {
      expect(await call(gh)).toMatchObject({ ok: true, rateLimit: RATE_LIMIT });
    }
  });
});

describe("failures never throw and never carry the token (AC9)", () => {
  it.each(METHODS)("%s: a fetch that throws (its message holding the token) is unreachable", async (_, call) => {
    const { gh } = client(() => {
      throw new TypeError(`Headers.append: "Bearer ${TOKEN}" is an invalid header value.`);
    });
    const res = await call(gh);
    expect(res).toEqual({ ok: false, error: "unreachable", rateLimit: null });
    expect(JSON.stringify(res)).not.toContain(TOKEN);
    expect(inspect(res)).not.toContain(TOKEN);
  });

  it("each call has a timeout: a request that never answers is unreachable once it fires", async () => {
    const { fetch, calls } = fakeFetch(() => new Promise<Response>(() => undefined));
    const hanging = (async (input: unknown, init?: RequestInit) => {
      void fetch(input as string, init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    }) as typeof fetch;
    const gh = createGitHubClient({ readToken: () => TOKEN, fetch: hanging, timeoutMs: 20 });
    expect(await gh.getTokenInfo()).toEqual({ ok: false, error: "unreachable", rateLimit: null });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("a body over the bound is unreachable, and the rest of it is never read", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 1000) controller.close();
        else controller.enqueue(new Uint8Array(512).fill(0x20));
      },
    });
    const { gh } = client(() => new Response(stream, { headers: RL_HEADERS }), { maxBodyBytes: 2048 });
    expect(await gh.getTokenInfo()).toEqual({ ok: false, error: "unreachable", rateLimit: null });
    expect(pulled).toBeLessThan(10);
  });

  it(`the default body bound (${GITHUB_DEFAULT_MAX_BODY_BYTES} bytes) applies when none is given: a longer body is unreachable, read no further`, async () => {
    const CHUNK = 64 * 1024;
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 1000) controller.close();
        else controller.enqueue(new Uint8Array(CHUNK).fill(0x20));
      },
    });
    const { gh } = client(() => new Response(stream, { headers: RL_HEADERS }));
    expect(await gh.getTokenInfo()).toEqual({ ok: false, error: "unreachable", rateLimit: null });
    expect(pulled).toBeLessThan(GITHUB_DEFAULT_MAX_BODY_BYTES / CHUNK + 5);
  });

  it("a body that is not JSON, or not the documented shape, is unreachable", async () => {
    expect(await client(() => new Response("<html>", { headers: RL_HEADERS })).gh.getTokenInfo()).toMatchObject({ error: "unreachable" });
    expect(await client(() => json({ id: 1 })).gh.getTokenInfo()).toMatchObject({ error: "unreachable" });
    expect(await client(() => json({ not: "a list" })).gh.listReachableRepos()).toMatchObject({ error: "unreachable" });
    expect(await client(() => json([{ full_name: 7 }])).gh.listReachableRepos()).toMatchObject({ error: "unreachable" });
  });

  it.each([
    ["no token", undefined],
    ["an empty token", ""],
    ["a token with a newline", `${TOKEN}\n`],
    ["a token with a space", `Bearer ${TOKEN}`],
    ["a token with a control character", `${TOKEN}\u0000`],
    ["a token too long", "a".repeat(256)],
  ])("%s: unreachable, and no request is made", async (_, token) => {
    const { fetch, calls } = fakeFetch(() => json(user("x")));
    const gh = createGitHubClient({ readToken: () => token, fetch });
    for (const [, call] of METHODS) {
      const res = await call(gh);
      expect(res).toEqual({ ok: false, error: "unreachable", rateLimit: null });
      if (token) expect(JSON.stringify(res)).not.toContain(token);
    }
    expect(calls).toEqual([]);
  });

  it("a token source that throws is unreachable", async () => {
    const { fetch, calls } = fakeFetch(() => json(user("x")));
    const gh = createGitHubClient({
      readToken: () => {
        throw new Error(`keychain said ${TOKEN}`);
      },
      fetch,
    });
    const res = await gh.getTokenInfo();
    expect(res).toEqual({ ok: false, error: "unreachable", rateLimit: null });
    expect(calls).toEqual([]);
  });

  it.each([
    ["no slash", "o", 1],
    ["three parts", "o/r/x", 1],
    ["a dot-dot segment", "../user", 1],
    ["a query", "o/r?x=1", 1],
    ["number zero", "o/r", 0],
    ["a fractional number", "o/r", 1.5],
  ])("a malformed argument (%s) is unreachable, and no request is made", async (_, repo, n) => {
    const { gh, calls } = client(() => json([]));
    expect(await gh.getPull(repo, n)).toMatchObject({ error: "unreachable" });
    expect(await gh.getPullDiff(repo, n, 100)).toMatchObject({ error: "unreachable" });
    expect(await gh.listPullFiles(repo, n)).toMatchObject({ error: "unreachable" });
    expect(await gh.listPullComments(repo, n)).toMatchObject({ error: "unreachable" });
    if (n === 1) expect(await gh.listOpenPulls(repo, {})).toMatchObject({ error: "unreachable" });
    expect(calls).toEqual([]);
  });

  it("a negative maxBytes is unreachable", async () => {
    const { gh, calls } = client(() => new Response("x"));
    expect(await gh.getPullDiff("o/r", 1, -1)).toMatchObject({ error: "unreachable" });
    expect(calls).toEqual([]);
  });
});

describe("read-only, one origin, a fresh token (AC9, AC9a)", () => {
  it("every request is a GET to https://api.github.com that never follows a redirect", async () => {
    const { gh, calls } = client((url) => {
      if (url.pathname === "/user") return json(user("x"));
      if (url.pathname.endsWith("/pulls/1")) return json(apiPull(1));
      return json([]);
    });
    for (const [, call] of METHODS) await call(gh);
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const c of calls) {
      expect(c.init.method).toBe("GET");
      expect(c.init.redirect).toBe("manual");
      expect(new URL(c.url).origin).toBe("https://api.github.com");
      expect(c.init.body).toBeUndefined();
    }
  });

  it("a redirect is an http_error, not followed", async () => {
    const { gh, calls } = client(() => new Response(null, { status: 301, headers: { location: "https://evil.example/x", ...RL_HEADERS } }));
    expect(await gh.getPull("o/r", 1)).toEqual({ ok: false, error: "http_error", status: 301, rateLimit: RATE_LIMIT });
    expect(calls).toHaveLength(1);
  });

  it("the token is read fresh on each call", async () => {
    const tokens = ["ghp_first111", "ghp_second22"];
    let reads = 0;
    const { fetch, calls } = fakeFetch(() => json(user("x")));
    const gh = createGitHubClient({ readToken: () => tokens[reads++], fetch });
    await gh.getTokenInfo();
    await gh.getTokenInfo();
    expect(reads).toBe(2);
    expect(calls.map((c) => headerOf(c, "authorization"))).toEqual(["Bearer ghp_first111", "Bearer ghp_second22"]);
  });

  it("by default the token comes from the Keychain item loomwright-studio-github, read on each call", async () => {
    const services: string[] = [];
    const keychain: KeychainReader = {
      read(service) {
        services.push(service);
        return TOKEN;
      },
    };
    const { fetch, calls } = fakeFetch(() => json(user("x")));
    const gh = createGitHubClient({ keychain, fetch });
    expect(services).toEqual([]);
    await gh.getTokenInfo();
    await gh.listReachableRepos();
    expect(GITHUB_KEYCHAIN_SERVICE).toBe("loomwright-studio-github");
    expect(services).toEqual(["loomwright-studio-github", "loomwright-studio-github"]);
    expect(headerOf(calls[0], "authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    ["no Keychain item", () => undefined],
    [
      "a Keychain read that fails",
      () => {
        throw new Error(`security said ${TOKEN}`);
      },
    ],
  ])("the default source with %s: unreachable, and no request is made", async (_, read) => {
    const { fetch, calls } = fakeFetch(() => json(user("x")));
    const gh = createGitHubClient({ keychain: { read }, fetch });
    const res = await gh.listReachableRepos();
    expect(res).toEqual({ ok: false, error: "unreachable", rateLimit: null });
    expect(JSON.stringify(res)).not.toContain(TOKEN);
    expect(calls).toEqual([]);
  });

  it("the source names no method but the allowlist's two POSTs, never infers permissions, and never logs", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/integrations/github/client.ts", import.meta.url)), "utf8");
    // Any other write method, quoted or as a property, fails here.
    expect(src).not.toMatch(/["'](PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE)["']/);
    expect(src).not.toMatch(/\bconsole\./);
    // Every `method: "X"` literal is an allowlist entry: exactly the two POSTs (a GET goes through the `method` argument).
    expect([...src.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1])).toEqual(["POST", "POST"]);
    expect([...src.matchAll(/prefix:\s*"([^"]+)"/g)].map((m) => m[1])).toEqual(["/app/installations/", "/app-manifests/"]);
    expect([...src.matchAll(/suffix:\s*"([^"]+)"/g)].map((m) => m[1])).toEqual(["/access_tokens", "/conversions"]);
    expect(src).toMatch(/permissions: null,/);
  });
});

// ---------------------------------------------------------------------------
// The allowlist (GitHub App 2, AC13)
// ---------------------------------------------------------------------------

describe("the request allowlist (AC13)", () => {
  const MINT = "https://api.github.com/app/installations/42/access_tokens";
  const CONVERT = "https://api.github.com/app-manifests/abc123def456/conversions";

  it("names exactly two POSTs, frozen: the mint and the manifest conversion", () => {
    expect(GITHUB_ALLOWED_NON_GET.map((a) => [a.method, a.prefix, a.suffix])).toEqual([
      ["POST", "/app/installations/", "/access_tokens"],
      ["POST", "/app-manifests/", "/conversions"],
    ]);
    expect(Object.isFrozen(GITHUB_ALLOWED_NON_GET)).toBe(true);
    for (const a of GITHUB_ALLOWED_NON_GET) expect(Object.isFrozen(a)).toBe(true);
  });

  it.each([
    ["GET", "https://api.github.com/user"],
    ["GET", "https://api.github.com/repos/o/r/pulls/1?per_page=1"],
    ["GET", "https://api.github.com/installation/repositories?per_page=100&page=2"],
    ["POST", MINT],
    ["POST", CONVERT],
    ["POST", "https://api.github.com/app/installations/9007199254740/access_tokens"],
  ])("allows %s %s", (method, url) => {
    expect(isAllowedGitHubRequest(method, url)).toBe(true);
    expect(isAllowedGitHubRequest(method, new URL(url))).toBe(true);
  });

  it.each(["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "post", "get", "Post", "GET ", "", "TRACE", "CONNECT"])("refuses the method %j on every URL, the allowlisted ones included", (method) => {
    expect(isAllowedGitHubRequest(method, MINT)).toBe(false);
    expect(isAllowedGitHubRequest(method, CONVERT)).toBe(false);
    expect(isAllowedGitHubRequest(method, "https://api.github.com/user")).toBe(false);
  });

  it.each([
    ["any other POST", "POST", "https://api.github.com/repos/o/r/issues"],
    ["a POST to the pulls", "POST", "https://api.github.com/repos/o/r/pulls/1/comments"],
    ["a POST to a different app path", "POST", "https://api.github.com/app/installations/42/suspended"],
    ["a POST to /app/ with the id in the wrong place", "POST", "https://api.github.com/app/42/access_tokens"],
    ["a POST with a non-numeric installation id", "POST", "https://api.github.com/app/installations/abc/access_tokens"],
    ["a POST with a zero installation id", "POST", "https://api.github.com/app/installations/0/access_tokens"],
    ["a POST with a negative installation id", "POST", "https://api.github.com/app/installations/-1/access_tokens"],
    ["a POST with no installation id", "POST", "https://api.github.com/app/installations//access_tokens"],
    ["a POST with no installation id and no slash", "POST", "https://api.github.com/app/installations/access_tokens"],
    ["a POST with extra segments", "POST", "https://api.github.com/app/installations/42/extra/access_tokens"],
    ["a POST with a trailing segment", "POST", "https://api.github.com/app/installations/42/access_tokens/more"],
    ["a POST with a query", "POST", `${MINT}?x=1`],
    ["a POST with a fragment", "POST", `${MINT}#x`],
    ["a POST with an encoded slash in the id", "POST", "https://api.github.com/app/installations/4%2F2/access_tokens"],
    ["a conversion with no code", "POST", "https://api.github.com/app-manifests//conversions"],
    ["a conversion with a path in the code", "POST", "https://api.github.com/app-manifests/a/b/conversions"],
    ["a conversion with a query", "POST", `${CONVERT}?x=1`],
  ])("refuses %s", (_, method, url) => {
    expect(isAllowedGitHubRequest(method, url)).toBe(false);
  });

  it.each([
    ["another host", "https://evil.example/app/installations/42/access_tokens"],
    ["a subdomain", "https://uploads.api.github.com/user"],
    ["a look-alike", "https://api.github.com.evil.example/user"],
    ["github.com itself", "https://github.com/app-manifests/abc/conversions"],
    ["plain http", "http://api.github.com/user"],
    ["another port", "https://api.github.com:8443/user"],
    ["userinfo", "https://user:pass@api.github.com/user"],
    ["a user name alone", "https://user@api.github.com/user"],
    ["a protocol-relative URL (no base)", "//api.github.com/user"],
    ["a path (no origin)", "/user"],
    ["not a URL", "not a url"],
    ["an empty string", ""],
  ])("refuses every method on %s", (_, url) => {
    for (const method of ["GET", "POST"]) expect(isAllowedGitHubRequest(method, url)).toBe(false);
  });

  it("never throws, whatever it is given", () => {
    for (const bad of [undefined, null, 1, {}, [], Symbol("x"), () => 1]) {
      expect(isAllowedGitHubRequest(bad as never, MINT)).toBe(false);
      expect(isAllowedGitHubRequest("GET", bad as never)).toBe(false);
      expect(isAllowedGitHubRequest(bad as never, bad as never)).toBe(false);
    }
  });

  it("the client's read methods send nothing to another host, whatever path they are given", async () => {
    const { gh, calls } = client(() => json({}));
    // A repo that tries to leave the origin or the path is refused before a request.
    for (const repo of ["//evil.example/x", "evil.example/x/y", "o/..", "../..", "o/r?x=1", "o/r#x", "o/r/../../x"]) {
      expect(await gh.getPull(repo, 1), repo).toMatchObject({ error: "unreachable" });
    }
    expect(calls).toEqual([]);
    // And every request it does make is a GET to the one origin.
    await gh.getPull("o/r", 1);
    expect(calls.map((c) => [c.init.method, new URL(c.url).origin])).toEqual([["GET", "https://api.github.com"]]);
  });
});

// ---------------------------------------------------------------------------
// The two POSTs (GitHub App 2, AC12, AC13)
// ---------------------------------------------------------------------------

describe("mintInstallationToken and convertManifest (AC12, AC13)", () => {
  const JWT = `eyJhbGciOiJSUzI1NiJ9.${"c".repeat(120)}.${"s".repeat(342)}`;
  const INSTALL_TOKEN = `ghs_${"T".repeat(36)}`;
  const EXPIRES = "2026-10-27T13:00:00Z";
  const mintBody = (over: Record<string, unknown> = {}) => ({
    token: INSTALL_TOKEN,
    expires_at: EXPIRES,
    permissions: { metadata: "read", pull_requests: "read" },
    repository_selection: "selected",
    ...over,
  });

  it("mint: one POST to /app/installations/{id}/access_tokens with the JWT as the bearer, no body, no redirect", async () => {
    const { fetch, calls } = fakeFetch(() => json(mintBody(), 201));
    const res = await mintInstallationToken(42, JWT, { fetch, now: () => NOW });
    expect(res).toEqual({ ok: true, token: INSTALL_TOKEN, expires_at: "2026-10-27T13:00:00.000Z", permissions: { metadata: "read", pull_requests: "read" } });
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c?.url).toBe("https://api.github.com/app/installations/42/access_tokens");
    expect(c?.init.method).toBe("POST");
    expect(c?.init.redirect).toBe("manual");
    expect(c?.init.body).toBeUndefined();
    expect(headerOf(c, "authorization")).toBe(`Bearer ${JWT}`);
    expect(headerOf(c, "x-github-api-version")).toBe("2022-11-28");
  });

  it("mint: a JWT longer than the PAT bound (255) is sent, one longer than 2048 or not three base64url segments is not", async () => {
    expect(JWT.length).toBeGreaterThan(255);
    const ok = fakeFetch(() => json(mintBody(), 201));
    expect((await mintInstallationToken(42, JWT, { fetch: ok.fetch })).ok).toBe(true);
    for (const bad of [`a.b.${"c".repeat(2048)}`, "a.b", "a.b.c.d", "a..c", `${JWT} `, `${JWT}\n`, "a.b.c d", "", "Bearer x", "github_pat_x"]) {
      const f = fakeFetch(() => json(mintBody(), 201));
      expect(await mintInstallationToken(42, bad, { fetch: f.fetch }), JSON.stringify(bad.slice(0, 20))).toEqual({ ok: false, error: "unreachable" });
      expect(f.calls).toEqual([]);
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2, "42" as unknown as number, undefined as unknown as number])("mint: an installation id of %j makes no request", async (id) => {
    const f = fakeFetch(() => json(mintBody(), 201));
    expect(await mintInstallationToken(id, JWT, { fetch: f.fetch })).toEqual({ ok: false, error: "unreachable" });
    expect(f.calls).toEqual([]);
  });

  it("mint: a 401 and a 404 arrive as http_error with the status; a rate limit as rate_limited; a network error as unreachable", async () => {
    for (const status of [401, 404, 422, 500]) {
      const { fetch } = fakeFetch(() => json({ message: `secret ${JWT}` }, status));
      expect(await mintInstallationToken(42, JWT, { fetch })).toEqual({ ok: false, error: "http_error", status });
    }
    const limited = fakeFetch(() => new Response("{}", { status: 429, headers: RL_HEADERS }));
    expect(await mintInstallationToken(42, JWT, { fetch: limited.fetch, now: () => NOW })).toEqual({ ok: false, error: "rate_limited" });
    const down = fakeFetch(() => {
      throw new Error(`boom ${JWT}`);
    });
    const res = await mintInstallationToken(42, JWT, { fetch: down.fetch });
    expect(res).toEqual({ ok: false, error: "unreachable" });
    expect(JSON.stringify(res)).not.toContain(JWT);
  });

  it.each([
    ["no token", { token: undefined }],
    ["a token that is not a string", { token: 5 }],
    ["a token with a space", { token: "ghs_a b" }],
    ["a token with a newline", { token: "ghs_a\nb" }],
    ["an empty token", { token: "" }],
    ["a token over the bound", { token: `ghs_${"x".repeat(1100)}` }],
    ["no expires_at", { expires_at: undefined }],
    ["an expires_at that is not a date", { expires_at: "soon" }],
    ["an expires_at that is not a string", { expires_at: 1793106000 }],
    ["no permissions", { permissions: undefined }],
    ["permissions that are not an object", { permissions: ["read"] }],
    ["a permission level that is not a string", { permissions: { metadata: 1 } }],
  ])("mint: %s is unreachable, never a throw", async (_, over) => {
    const { fetch } = fakeFetch(() => json(mintBody(over), 201));
    expect(await mintInstallationToken(42, JWT, { fetch })).toEqual({ ok: false, error: "unreachable" });
  });

  it("mint: a body that is not JSON, or over the bound, is unreachable", async () => {
    expect(await mintInstallationToken(42, JWT, { fetch: fakeFetch(() => new Response("<html>", { status: 201 })).fetch })).toEqual({ ok: false, error: "unreachable" });
    expect(await mintInstallationToken(42, JWT, { fetch: fakeFetch(() => json(mintBody(), 201)).fetch, maxBodyBytes: 10 })).toEqual({ ok: false, error: "unreachable" });
  });

  it("mint: the permissions are reported as GitHub gives them, write levels included (the caller refuses those)", async () => {
    const { fetch } = fakeFetch(() => json(mintBody({ permissions: { metadata: "read", pull_requests: "write" } }), 201));
    expect(await mintInstallationToken(42, JWT, { fetch })).toMatchObject({ ok: true, permissions: { pull_requests: "write" } });
  });

  it("mint: the result is frozen where it carries the permissions, and holds nothing else of the response", async () => {
    const { fetch } = fakeFetch(() => json(mintBody({ repositories: [{ full_name: "o/secret-repo" }], extra: "x" }), 201));
    const res = await mintInstallationToken(42, JWT, { fetch });
    expect(Object.keys(res).sort()).toEqual(["expires_at", "ok", "permissions", "token"]);
    if (res.ok) expect(Object.isFrozen(res.permissions)).toBe(true);
  });

  const CODE = "0123456789abcdef0123456789abcdef01234567";
  const conversionBody = () => ({
    id: 987,
    slug: "studio-reader",
    name: "Studio reader",
    owner: { login: "owner-one", id: 1 },
    html_url: "https://github.com/apps/studio-reader",
    client_id: "Iv1.abc123",
    client_secret: "CLIENT-SECRET-VALUE",
    webhook_secret: "WEBHOOK-SECRET-VALUE",
    pem: "-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----\n",
    permissions: { metadata: "read" },
  });

  it("convert: one unauthenticated POST to /app-manifests/{code}/conversions, no authorization header at all", async () => {
    const { fetch, calls } = fakeFetch(() => json(conversionBody(), 201));
    const res = await convertManifest(CODE, { fetch, now: () => NOW });
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c?.url).toBe(`https://api.github.com/app-manifests/${CODE}/conversions`);
    expect(c?.init.method).toBe("POST");
    expect(c?.init.redirect).toBe("manual");
    expect(c?.init.body).toBeUndefined();
    expect(new Headers(c?.init.headers).has("authorization")).toBe(false);
  });

  it("convert: returns the non-secret fields and the pem, and never client_secret or webhook_secret", async () => {
    const { fetch } = fakeFetch(() => json(conversionBody(), 201));
    const res = await convertManifest(CODE, { fetch });
    expect(res).toEqual({
      ok: true,
      conversion: { app_id: 987, slug: "studio-reader", name: "Studio reader", owner_login: "owner-one", html_url: "https://github.com/apps/studio-reader", client_id: "Iv1.abc123" },
      pem: conversionBody().pem,
    });
    const text = JSON.stringify(res);
    expect(text).not.toContain("CLIENT-SECRET-VALUE");
    expect(text).not.toContain("WEBHOOK-SECRET-VALUE");
    expect(text).not.toContain("client_secret");
  });

  it.each(["", "a b", "a/b", "../x", "a?b=1", "a#b", "é", "x".repeat(129), 5 as unknown as string, undefined as unknown as string])("convert: a code of %j makes no request", async (code) => {
    const f = fakeFetch(() => json(conversionBody(), 201));
    expect(await convertManifest(code, { fetch: f.fetch })).toEqual({ ok: false, error: "unreachable" });
    expect(f.calls).toEqual([]);
  });

  it.each([
    ["no id", { id: undefined }],
    ["no slug", { slug: undefined }],
    ["no owner", { owner: undefined }],
    ["no pem", { pem: undefined }],
    ["a pem that is not a string", { pem: 5 }],
    ["no client_id", { client_id: undefined }],
  ])("convert: a response with %s is unreachable", async (_, over) => {
    const { fetch } = fakeFetch(() => json({ ...conversionBody(), ...over }, 201));
    expect(await convertManifest(CODE, { fetch })).toEqual({ ok: false, error: "unreachable" });
  });

  it("convert: a refused or failed conversion is typed, and its body is dropped", async () => {
    expect(await convertManifest(CODE, { fetch: fakeFetch(() => json({ message: "Not Found" }, 404)).fetch })).toEqual({ ok: false, error: "http_error", status: 404 });
    const res = await convertManifest(CODE, {
      fetch: fakeFetch(() => {
        throw new Error("CLIENT-SECRET-VALUE");
      }).fetch,
    });
    expect(res).toEqual({ ok: false, error: "unreachable" });
  });

  it("neither POST follows a redirect: a 307 to another host is an http_error and nothing else is requested", async () => {
    const redirect = () => new Response(null, { status: 307, headers: { location: "https://evil.example/x", ...RL_HEADERS } });
    const a = fakeFetch(redirect);
    expect(await mintInstallationToken(42, JWT, { fetch: a.fetch })).toEqual({ ok: false, error: "http_error", status: 307 });
    expect(a.calls).toHaveLength(1);
    const b = fakeFetch(redirect);
    expect(await convertManifest(CODE, { fetch: b.fetch })).toEqual({ ok: false, error: "http_error", status: 307 });
    expect(b.calls).toHaveLength(1);
  });

  it("the PAT path's token bound is unchanged: a 256-character token is refused, a JWT-shaped one too", async () => {
    for (const t of ["x".repeat(256), JWT]) {
      const { gh, calls } = client(() => json(user("x")), { readToken: () => t });
      expect(await gh.getTokenInfo()).toEqual({ ok: false, error: "unreachable", rateLimit: null });
      expect(calls).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// The token provider: installation repos, one renewal on a 401 (AC2 client half, AC3)
// ---------------------------------------------------------------------------

describe("the token provider (AC2, AC3)", () => {
  const OLD = `ghs_${"O".repeat(36)}`;
  const FRESH = `ghs_${"F".repeat(36)}`;

  /** An `app` provider that hands out `OLD`, then `FRESH` after a renewal, and counts both. */
  function appProvider(over: Partial<GitHubTokenProvider> = {}): { provider: GitHubTokenProvider; renewals: () => number; reads: () => number } {
    let renewals = 0;
    let reads = 0;
    let current = OLD;
    const provider: GitHubTokenProvider = {
      method: "app",
      token: async () => {
        reads++;
        return current;
      },
      renew: async () => {
        renewals++;
        current = FRESH;
        return FRESH;
      },
      ...over,
    };
    return { provider, renewals: () => renewals, reads: () => reads };
  }

  const withProvider = (route: Route, provider: GitHubTokenProvider | undefined) => {
    const { fetch, calls } = fakeFetch(route);
    const gh = createGitHubClient({ tokenProvider: () => provider, fetch, now: () => NOW });
    return { gh, calls };
  };

  function installationRepos(n: number) {
    return (url: URL) => {
      expect(url.pathname).toBe("/installation/repositories");
      const page = Number(url.searchParams.get("page"));
      const from = (page - 1) * 100;
      return json({ total_count: n, repositories: repos(from + 1, Math.max(0, Math.min(100, n - from))) });
    };
  }

  it("method app: listReachableRepos reads GET /installation/repositories (the repositories array, paged) with the installation token", async () => {
    const { provider } = appProvider();
    const { gh, calls } = withProvider(installationRepos(150), provider);
    const res = await gh.listReachableRepos();
    expect(res.ok && res.data).toHaveLength(150);
    expect(res.ok && res.data[149]).toEqual({ full_name: "owner/repo-150", private: true });
    expect(calls.map((c) => new URL(c.url).pathname + new URL(c.url).search)).toEqual([
      "/installation/repositories?per_page=100&page=1",
      "/installation/repositories?per_page=100&page=2",
    ]);
    for (const c of calls) {
      expect(c.init.method).toBe("GET");
      expect(headerOf(c, "authorization")).toBe(`Bearer ${OLD}`);
    }
  });

  it("method app: an installation body that is not {repositories: [...]} is unreachable", async () => {
    const { provider } = appProvider();
    for (const body of [[], { total_count: 0 }, { repositories: "x" }, { repositories: [{ nope: 1 }] }]) {
      const { gh } = withProvider(() => json(body), provider);
      expect(await gh.listReachableRepos()).toEqual({ ok: false, error: "unreachable", rateLimit: null });
    }
  });

  it("method token: listReachableRepos still reads /user/repos with the PAT", async () => {
    const provider: GitHubTokenProvider = { method: "token", token: async () => TOKEN };
    const { gh, calls } = withProvider(() => json(repos(1, 2)), provider);
    const res = await gh.listReachableRepos();
    expect(res.ok && res.data).toHaveLength(2);
    expect(new URL(calls[0]?.url ?? "").pathname).toBe("/user/repos");
    expect(headerOf(calls[0], "authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("the other read methods use the installation token too (a poll, a dry run, a tool)", async () => {
    const { provider } = appProvider();
    const { gh, calls } = withProvider((url) => (url.pathname.endsWith("/pulls/1") ? json(apiPull(1)) : json([])), provider);
    await gh.listOpenPulls("o/r", {});
    await gh.getPull("o/r", 1);
    await gh.getPullDiff("o/r", 1, 100);
    await gh.listPullFiles("o/r", 1);
    await gh.listPullComments("o/r", 1);
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const c of calls) expect(headerOf(c, "authorization")).toBe(`Bearer ${OLD}`);
  });

  it("a 401 renews once and retries once with the new token (AC3)", async () => {
    const p = appProvider();
    let n = 0;
    const { gh, calls } = withProvider(() => (n++ === 0 ? json({ message: "Bad credentials" }, 401) : json(apiPull(1))), p.provider);
    const res = await gh.getPull("o/r", 1);
    expect(res.ok && res.data.number).toBe(1);
    expect(calls.map((c) => headerOf(c, "authorization"))).toEqual([`Bearer ${OLD}`, `Bearer ${FRESH}`]);
    expect(p.renewals()).toBe(1);
  });

  it("a second 401 is the answer: at most one renewal and one retry per call", async () => {
    const p = appProvider();
    const { gh, calls } = withProvider(() => json({ message: "Bad credentials" }, 401), p.provider);
    expect(await gh.getPull("o/r", 1)).toMatchObject({ ok: false, error: "http_error", status: 401 });
    expect(calls).toHaveLength(2);
    expect(p.renewals()).toBe(1);
  });

  it("a listing renews at most once however many pages it reads", async () => {
    const p = appProvider();
    let hits = 0;
    const route: Route = (url) => {
      hits++;
      // Page 1 passes with the old token, page 2 is rejected (renewal), page 2 retried passes, page 3 is rejected again.
      if (url.searchParams.get("page") === "2" && hits === 2) return json({ message: "expired" }, 401);
      if (url.searchParams.get("page") === "3") return json({ message: "expired again" }, 401);
      const page = Number(url.searchParams.get("page"));
      return json({ total_count: 300, repositories: repos((page - 1) * 100 + 1, 100) });
    };
    const { gh, calls } = withProvider(route, p.provider);
    expect(await gh.listReachableRepos()).toMatchObject({ ok: false, error: "http_error", status: 401 });
    expect(p.renewals()).toBe(1);
    expect(calls.map((c) => headerOf(c, "authorization"))).toEqual([`Bearer ${OLD}`, `Bearer ${OLD}`, `Bearer ${FRESH}`, `Bearer ${FRESH}`]);
  });

  it("a PAT (no renew) is never retried on a 401", async () => {
    const provider: GitHubTokenProvider = { method: "token", token: async () => TOKEN };
    const { gh, calls } = withProvider(() => json({ message: "Bad credentials" }, 401), provider);
    expect(await gh.getPull("o/r", 1)).toMatchObject({ error: "http_error", status: 401 });
    expect(calls).toHaveLength(1);
  });

  it("only a 401 renews: a 403, a 404 and a 500 do not", async () => {
    for (const status of [403, 404, 500]) {
      const p = appProvider();
      const { gh, calls } = withProvider(() => json({}, status), p.provider);
      expect(await gh.getPull("o/r", 1)).toMatchObject({ error: "http_error", status });
      expect(calls).toHaveLength(1);
      expect(p.renewals()).toBe(0);
    }
  });

  it.each([
    ["a renewal that finds no token", { renew: async () => undefined }],
    ["a renewal that returns an unusable token", { renew: async () => "has a space" }],
    [
      "a renewal that throws",
      {
        renew: async () => {
          throw new Error(`boom ${OLD}`);
        },
      },
    ],
  ])("%s: the 401 is the answer, no retry, no throw, no secret", async (_, over) => {
    const p = appProvider(over);
    const { gh, calls } = withProvider(() => json({ message: "Bad credentials" }, 401), p.provider);
    const res = await gh.getPull("o/r", 1);
    expect(res).toMatchObject({ ok: false, error: "http_error", status: 401 });
    expect(JSON.stringify(res)).not.toContain(OLD);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["no provider", () => undefined],
    ["a resolver that throws", () => { throw new Error(`boom ${OLD}`); }],
    ["a token() that resolves nothing", () => ({ method: "app" as const, token: async () => undefined })],
    ["a token() that rejects", () => ({ method: "app" as const, token: () => Promise.reject(new Error(`boom ${OLD}`)) })],
    ["a token() that throws", () => ({ method: "app" as const, token: () => { throw new Error(`boom ${OLD}`); } })],
    ["an installation token with a space", () => ({ method: "app" as const, token: async () => "ghs_a b" })],
    ["a PAT over its bound", () => ({ method: "token" as const, token: async () => "x".repeat(256) })],
  ])("%s: unreachable, no request, no secret in the result", async (_, resolve) => {
    const { fetch, calls } = fakeFetch(() => json({}));
    const gh = createGitHubClient({ tokenProvider: resolve as never, fetch });
    for (const call of [() => gh.getTokenInfo(), () => gh.listReachableRepos(), () => gh.getPull("o/r", 1), () => gh.getPullDiff("o/r", 1, 10), () => gh.listPullComments("o/r", 1)]) {
      const res = await call();
      expect(res).toEqual({ ok: false, error: "unreachable", rateLimit: null });
      expect(JSON.stringify(res)).not.toContain(OLD);
    }
    expect(calls).toEqual([]);
  });

  it("the provider is resolved on every call, never at construction", async () => {
    let resolved = 0;
    const p = appProvider();
    const { fetch } = fakeFetch(() => json([]));
    const gh = createGitHubClient({ tokenProvider: () => (resolved++, p.provider), fetch });
    expect(resolved).toBe(0);
    await gh.listOpenPulls("o/r", {});
    await gh.listOpenPulls("o/r", {});
    expect(resolved).toBe(2);
  });

  it("a given tokenProvider wins over readToken and keychain", async () => {
    let patReads = 0;
    const p = appProvider();
    const { fetch, calls } = fakeFetch(() => json([]));
    const gh = createGitHubClient({
      tokenProvider: () => p.provider,
      readToken: () => (patReads++, TOKEN),
      keychain: { read: () => (patReads++, TOKEN) },
      fetch,
    });
    await gh.listOpenPulls("o/r", {});
    expect(patReads).toBe(0);
    expect(headerOf(calls[0], "authorization")).toBe(`Bearer ${OLD}`);
  });
});
