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
  createGitHubClient,
  GITHUB_API_ORIGIN,
  GITHUB_KEYCHAIN_SERVICE,
  parseTokenExpiration,
} from "../src/integrations/github/client.js";
import type { GitHubClientDeps } from "../src/integrations/github/client.js";
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

  it("the source never names a write method, never infers permissions, and never logs", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/integrations/github/client.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/["'](POST|PUT|PATCH|DELETE)["']/);
    expect(src).not.toMatch(/\bconsole\./);
    expect([...src.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1])).toEqual(["GET"]);
    expect(src).toMatch(/permissions: null,/);
  });
});
