// The GitHub connector (phase 6, item 03): set, replace and disconnect the
// token, the three refusals, the expiry check, the four `/connectors` routes
// and `studio connectors`. Every test injects a fake Keychain and a
// `FakeGitHubClient` (or the real client over a fake `fetch`), so none reaches
// the real Keychain, GitHub or a notifier: the expiry check only records
// notification rows (delivery is the notifications feature's due work, never
// run here). A temp data dir and an injected clock; the CLI runs through
// `runCli` against a real loopback API server.
//
// The token never appears anywhere: every test that sets one checks every
// table of the store, every response body and the CLI's output for it.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { securityCliKeychainDeleter } from "../src/auth/keychain.js";
import type { ExecFileSyncLike, KeychainDeleter, KeychainReader, KeychainWriter } from "../src/auth/keychain.js";
import { API_TOKEN_KEYCHAIN_SERVICE, startApiServer } from "../src/api/index.js";
import type { ApiServer } from "../src/api/index.js";
import { runCli } from "../src/cli/index.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import type { CliApiClient, ContributedRoute, ContributedRouteResponse, FeatureContribution } from "../src/features/index.js";
import { CONNECTORS_HELP, connectorsSubcommand } from "../src/integrations/cli.js";
import type { SecretRead } from "../src/integrations/cli.js";
import { GITHUB_KEYCHAIN_SERVICE, createGitHubClient } from "../src/integrations/github/client.js";
import {
  GITHUB_KEYCHAIN_ACCOUNT,
  checkGitHubExpiry,
  createGitHubConnector,
  githubConnectorPart,
  githubConnectorRow,
  githubExpiryDueWork,
  writeScopedMessage,
} from "../src/integrations/github/connector.js";
import type { GitHubConnector, GitHubConnectorDeps } from "../src/integrations/github/connector.js";
import { githubRoutes, githubRoutesPart } from "../src/integrations/github/routes.js";
import { draftsPart, githubToolsPart, integrationsContributionOf } from "../src/integrations/index.js";
import type { GitHubFailure } from "../src/integrations/types.js";
import type { Store } from "../src/store/index.js";
import { FAKE_RATE_LIMIT, FakeGitHubClient } from "./fixtures/github-fake.js";
import type { FakeGitHubData } from "./fixtures/github-fake.js";
import { events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const T0 = "2026-10-27T10:00:00.000Z";
const DAY = 86_400_000;
const API_TOKEN = "0123456789abcdef".repeat(4);

// Tokens in GitHub's fine-grained shape; each is a distinct secret the tests look for.
const GOOD = `github_pat_11GOOD${"A".repeat(70)}`;
const GOOD2 = `github_pat_11SECOND${"B".repeat(68)}`;
const WRITE = `github_pat_11WRITE${"C".repeat(69)}`;
const UNKNOWN = `github_pat_11UNKNOWN${"D".repeat(67)}`;
const BAD = `github_pat_11BADTOKEN${"E".repeat(66)}`;
const ALL_TOKENS = [GOOD, GOOD2, WRITE, UNKNOWN, BAD];

const EXPIRES = new Date(Date.parse(T0) + 30 * DAY).toISOString();
const READ_ONLY = { metadata: "read", contents: "read", pull_requests: "read" };

/** What GitHub answers for each token (a token missing here answers 401 to everything). */
const GITHUB: Record<string, FakeGitHubData> = {
  [GOOD]: {
    tokenInfo: { login: "owner-one", expires_at: EXPIRES, permissions: READ_ONLY },
    repos: [
      { full_name: "owner-one/studio-sandbox", private: true },
      { full_name: "owner-one/loomwright", private: false },
    ],
  },
  [GOOD2]: {
    tokenInfo: { login: "owner-one", expires_at: new Date(Date.parse(T0) + 60 * DAY).toISOString(), permissions: { metadata: "read", pull_requests: "read" } },
    repos: [{ full_name: "owner-one/ntfs-tool", private: false }],
  },
  [WRITE]: {
    tokenInfo: { login: "owner-one", expires_at: EXPIRES, permissions: { metadata: "read", pull_requests: "write", contents: "admin", issues: "none" } },
    repos: [{ full_name: "owner-one/studio-sandbox", private: true }],
  },
  [UNKNOWN]: {
    tokenInfo: { login: "owner-one", expires_at: EXPIRES, permissions: null },
    repos: [{ full_name: "owner-one/studio-sandbox", private: true }],
  },
};

const UNAUTHORIZED: GitHubFailure = { ok: false, error: "http_error", status: 401, rateLimit: FAKE_RATE_LIMIT };

/** An in-memory Keychain with the real one's rules: add never overwrites; delete answers whether an item was there. */
class FakeKeychain implements KeychainReader, KeychainWriter, KeychainDeleter {
  readonly items = new Map<string, { account: string; secret: string }>();
  /** Every call, without the secret. */
  readonly calls: string[] = [];
  /** `add` exits "0" but stores nothing (the `security -i` failure mode). */
  silentAddFailure = false;
  deleteThrows: Error | undefined;

  read(service: string): string | undefined {
    this.calls.push(`read ${service}`);
    return this.items.get(service)?.secret;
  }

  add(service: string, account: string, secret: string): void {
    this.calls.push(`add ${service} ${account}`);
    if (this.items.has(service)) throw new Error("The specified item already exists in the keychain.");
    if (this.silentAddFailure) return;
    this.items.set(service, { account, secret });
  }

  delete(service: string): boolean {
    this.calls.push(`delete ${service}`);
    if (this.deleteThrows !== undefined) throw this.deleteThrows;
    return this.items.delete(service);
  }

  writes(): string[] {
    return this.calls.filter((c) => !c.startsWith("read"));
  }
}

let env: LoopEnv;
let keychain: FakeKeychain;
let clients: FakeGitHubClient[];

/** A client for whatever token `readToken` (or the Keychain) gives, answering from `GITHUB`. */
function fakeClientFor(data: Record<string, FakeGitHubData> = GITHUB): NonNullable<GitHubConnectorDeps["clientFor"]> {
  return (readToken, kc) => {
    const token = readToken !== undefined ? readToken() : kc.read(GITHUB_KEYCHAIN_SERVICE);
    const answers = token !== undefined ? data[token] : undefined;
    const client = new FakeGitHubClient(answers ?? { failures: { getTokenInfo: UNAUTHORIZED, listReachableRepos: UNAUTHORIZED } });
    clients.push(client);
    return client;
  };
}

function connector(overrides: GitHubConnectorDeps = {}): GitHubConnector {
  return createGitHubConnector({ keychain, writer: keychain, deleter: keychain, clientFor: fakeClientFor(), ...overrides });
}

beforeEach(() => {
  env = loopEnv(T0);
  keychain = new FakeKeychain();
  clients = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  env.cleanup();
});

/** Every value in every table of the store, as one string. */
function everythingStored(store: Store): string {
  const tables = store.prepare<[], string>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all();
  return tables.map((t) => JSON.stringify(store.prepare(`SELECT * FROM ${t}`).all())).join("\n");
}

/** None of the tokens appears in the store or in any of `texts`. */
function expectNoToken(...texts: unknown[]): void {
  const haystacks = [everythingStored(env.store), ...texts.map((t) => (typeof t === "string" ? t : JSON.stringify(t) ?? ""))];
  for (const token of ALL_TOKENS) {
    for (const h of haystacks) expect(h.includes(token), "a token was found").toBe(false);
    // A fragment is enough to leak it.
    for (const h of haystacks) expect(h.includes(token.slice(11, 30)), "a token fragment was found").toBe(false);
  }
}

function route(routes: readonly ContributedRoute[], method: string, path: string): ContributedRoute {
  const r = routes.find((x) => x.method === method && x.path === path);
  if (r === undefined) throw new Error(`no route ${method} ${path}`);
  return r;
}

/** Calls one route handler directly, the way the API server does. */
async function call(c: GitHubConnector, method: string, path: string, body?: unknown, query: Record<string, string> = {}): Promise<ContributedRouteResponse> {
  return route(githubRoutes(c), method, path).handler({ params: {}, query, body, store: env.store, now: env.now });
}

function statusEvents(): Record<string, unknown>[] {
  return events(env.store, "connector_status").map((e) => e.payload);
}

function rowNow(): Record<string, unknown> | undefined {
  return env.store.prepare("SELECT * FROM connectors WHERE kind = 'github'").get() as Record<string, unknown> | undefined;
}

const CONNECTOR_KEYS = ["account_login", "created_at", "expires_at", "id", "kind", "permissions", "permissions_declared_at", "permissions_source", "reachable_repos", "status", "updated_at", "verified_at"];

// ---------------------------------------------------------------------------
// AC1: set a valid read-only token (route)
// ---------------------------------------------------------------------------

describe("set a valid read-only token through POST /connectors/github/token (AC1)", () => {
  it("validates, writes the Keychain item, and answers the row connected in the Connector shape, with one event", async () => {
    const res = await call(connector(), "POST", "/connectors/github/token", { token: GOOD });
    expect(res.status).toBe(200);
    const c = (res.body as { connector: Record<string, unknown> }).connector;
    expect(Object.keys(c).sort()).toEqual(CONNECTOR_KEYS);
    expect(c).toMatchObject({
      kind: "github",
      status: "connected",
      account_login: "owner-one",
      permissions: READ_ONLY,
      reachable_repos: ["owner-one/studio-sandbox", "owner-one/loomwright"],
      permissions_source: "reported",
      permissions_declared_at: null,
      expires_at: EXPIRES,
      verified_at: T0,
    });
    expect(keychain.items.get(GITHUB_KEYCHAIN_SERVICE)).toEqual({ account: GITHUB_KEYCHAIN_ACCOUNT, secret: GOOD });
    expect(rowNow()).toMatchObject({
      status: "connected",
      account_login: "owner-one",
      permissions_json: JSON.stringify(READ_ONLY),
      reachable_repos_json: JSON.stringify(["owner-one/studio-sandbox", "owner-one/loomwright"]),
      expires_at: EXPIRES,
      verified_at: T0,
      permissions_source: "reported",
      permissions_declared_at: null,
    });
    expect(statusEvents()).toEqual([{ connector_id: c.id, kind: "github", status: "connected", permissions_source: "reported" }]);
    // Validated through the candidate token, before anything was written.
    expect(clients[0]?.calls.map((x) => x.method)).toEqual(["getTokenInfo", "listReachableRepos"]);
    expectNoToken(res.body);
  });
});

// ---------------------------------------------------------------------------
// AC2-AC4: the three refusals, with and without a good token in place
// ---------------------------------------------------------------------------

describe("refusals write nothing to the Keychain (AC2, AC3, AC4)", () => {
  async function connectGood(c: GitHubConnector): Promise<Record<string, unknown>> {
    const res = await call(c, "POST", "/connectors/github/token", { token: GOOD });
    expect(res.status).toBe(200);
    keychain.calls.length = 0;
    return rowNow() as Record<string, unknown>;
  }

  it("AC2: a write-scoped token is refused token_write_scoped, naming every write permission and the setting to change; the row reads rejected", async () => {
    const res = await call(connector(), "POST", "/connectors/github/token", { token: WRITE });
    expect(res.status).toBe(422);
    const body = res.body as Record<string, unknown>;
    expect(body["error"]).toBe("token_write_scoped");
    expect(body["write_permissions"]).toEqual([
      { permission: "pull_requests", level: "write" },
      { permission: "contents", level: "admin" },
    ]);
    expect(body["message"]).toContain("pull_requests: write → set to read");
    expect(body["message"]).toContain("contents: admin → set to read");
    expect(body["message"]).not.toContain("issues");
    expect(body["message"]).not.toContain("metadata");
    expect(keychain.writes()).toEqual([]);
    expect(keychain.items.size).toBe(0);
    expect((body["connector"] as Record<string, unknown>)["status"]).toBe("rejected");
    expect(rowNow()).toMatchObject({ status: "rejected", account_login: null, permissions_json: null });
    expect(statusEvents()).toEqual([{ connector_id: rowNow()?.["id"], kind: "github", status: "rejected", refused: "token_write_scoped" }]);
    expectNoToken(res.body);
  });

  it("AC2: with a good token connected, a write-scoped one leaves its Keychain item and its connected row unchanged", async () => {
    const c = connector();
    const before = await connectGood(c);
    env.advance(60_000);
    const res = await call(c, "POST", "/connectors/github/token", { token: WRITE });
    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toBe("token_write_scoped");
    expect(keychain.writes()).toEqual([]);
    expect(keychain.items.get(GITHUB_KEYCHAIN_SERVICE)?.secret).toBe(GOOD);
    expect(rowNow()).toEqual(before);
    expect(((res.body as { connector: Record<string, unknown> }).connector)["status"]).toBe("connected");
    expect(statusEvents().at(-1)).toEqual({ connector_id: before["id"], kind: "github", status: "connected", refused: "token_write_scoped" });
    expectNoToken(res.body);
  });

  it("AC3: a token GitHub rejects (401) is refused token_invalid, and the good token and its row stay", async () => {
    const c = connector();
    const before = await connectGood(c);
    const res = await call(c, "POST", "/connectors/github/token", { token: BAD });
    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toBe("token_invalid");
    expect(keychain.writes()).toEqual([]);
    expect(keychain.items.get(GITHUB_KEYCHAIN_SERVICE)?.secret).toBe(GOOD);
    expect(rowNow()).toEqual(before);
    expectNoToken(res.body);
  });

  it("AC3: a value that is not a token's shape is refused token_invalid before GitHub is asked", async () => {
    const res = await call(connector(), "POST", "/connectors/github/token", { token: `${GOOD} trailing` });
    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toBe("token_invalid");
    expect(clients).toEqual([]);
    expect(keychain.writes()).toEqual([]);
    expect(rowNow()?.["status"]).toBe("rejected");
    expectNoToken(res.body);
  });

  it("AC4: a token whose permissions GitHub does not report (null) is refused token_permissions_unknown; nothing is written and the good token stays", async () => {
    const c = connector();
    const before = await connectGood(c);
    const res = await call(c, "POST", "/connectors/github/token", { token: UNKNOWN });
    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toBe("token_permissions_unknown");
    expect(keychain.writes()).toEqual([]);
    expect(keychain.items.get(GITHUB_KEYCHAIN_SERVICE)?.secret).toBe(GOOD);
    expect(rowNow()).toEqual(before);
    expectNoToken(res.body);
  });

  it("AC4: with no token in place, a null-permission token is refused and the row reads rejected; an empty permission map is unknown too", async () => {
    const c = createGitHubConnector({
      keychain,
      writer: keychain,
      deleter: keychain,
      clientFor: fakeClientFor({ ...GITHUB, [GOOD]: { ...GITHUB[GOOD], tokenInfo: { login: "owner-one", expires_at: null, permissions: {} } } }),
    });
    for (const token of [UNKNOWN, GOOD]) {
      const res = await call(c, "POST", "/connectors/github/token", { token });
      expect((res.body as { error: string }).error).toBe("token_permissions_unknown");
    }
    expect(keychain.writes()).toEqual([]);
    expect(keychain.items.size).toBe(0);
    expect(rowNow()?.["status"]).toBe("rejected");
  });

  it("AC4: over the real client (its permissions are always null), a token GitHub accepts is refused token_permissions_unknown after one GET /user", async () => {
    const requests: { url: string; method: string | undefined }[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), method: init?.method });
      return new Response(JSON.stringify({ login: "owner-one" }), {
        status: 200,
        headers: { "content-type": "application/json", "github-authentication-token-expiration": "2026-11-26 10:00:00 UTC", "x-ratelimit-remaining": "4999" },
      });
    }) as typeof fetch;
    const c = createGitHubConnector({
      keychain,
      writer: keychain,
      deleter: keychain,
      clientFor: (readToken, kc) => createGitHubClient({ ...(readToken !== undefined ? { readToken } : { keychain: kc }), fetch: fakeFetch }),
    });
    const res = await call(c, "POST", "/connectors/github/token", { token: GOOD });
    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toBe("token_permissions_unknown");
    expect(requests).toEqual([{ url: "https://api.github.com/user", method: "GET" }]);
    expect(keychain.writes()).toEqual([]);
    expectNoToken(res.body);
  });

  it("the default clientFor (no clientFor given) validates the candidate over the real client: its Bearer header to api.github.com only, the Keychain neither read for it nor written", async () => {
    const requests: { url: string; method: string | undefined; redirect: string | undefined; authorization: string | null }[] = [];
    // The global `fetch` is stubbed (restored in afterEach): nothing reaches the network.
    vi.stubGlobal("fetch", (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), method: init?.method, redirect: init?.redirect, authorization: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ login: "owner-one" }), {
        status: 200,
        headers: { "content-type": "application/json", "github-authentication-token-expiration": "2026-11-26 10:00:00 UTC", "x-ratelimit-remaining": "4999" },
      });
    }) as typeof fetch);
    const c = createGitHubConnector({ keychain, writer: keychain, deleter: keychain });
    const res = await call(c, "POST", "/connectors/github/token", { token: GOOD });
    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toBe("token_permissions_unknown");
    expect(requests).toEqual([{ url: "https://api.github.com/user", method: "GET", redirect: "manual", authorization: `Bearer ${GOOD}` }]);
    expect(keychain.calls).toEqual([]);
    expectNoToken(res.body);
  });

  it("writeScopedMessage names each permission in the form '<name>: <level> → set to read'", () => {
    expect(writeScopedMessage([{ permission: "pull_requests", level: "write" }])).toMatch(/pull_requests: write → set to read$/);
  });
});

// ---------------------------------------------------------------------------
// GitHub failures change nothing
// ---------------------------------------------------------------------------

describe("a GitHub failure while validating changes nothing", () => {
  it("rate_limited answers 429 with resets_at; unreachable 502; another HTTP status 502 github_error; no row, no event, no Keychain write", async () => {
    const cases: [GitHubFailure, number, string][] = [
      [{ ok: false, error: "rate_limited", resets_at: "2026-10-27T11:00:00.000Z", rateLimit: FAKE_RATE_LIMIT }, 429, "rate_limited"],
      [{ ok: false, error: "unreachable", rateLimit: null }, 502, "github_unreachable"],
      [{ ok: false, error: "http_error", status: 500, rateLimit: FAKE_RATE_LIMIT }, 502, "github_error"],
    ];
    for (const [failure, status, error] of cases) {
      const c = createGitHubConnector({
        keychain,
        writer: keychain,
        deleter: keychain,
        clientFor: () => new FakeGitHubClient({ ...GITHUB[GOOD], failures: { listReachableRepos: failure } }),
      });
      const res = await call(c, "POST", "/connectors/github/token", { token: GOOD });
      expect([res.status, (res.body as { error: string }).error]).toEqual([status, error]);
      if (error === "rate_limited") expect((res.body as { resets_at: string }).resets_at).toBe("2026-10-27T11:00:00.000Z");
      expectNoToken(res.body);
    }
    expect(rowNow()).toBeUndefined();
    expect(statusEvents()).toEqual([]);
    expect(keychain.writes()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC6: replace
// ---------------------------------------------------------------------------

describe("replace a connected token (AC6)", () => {
  it("validates the new token first, then deletes the old item and adds the new one (never an overwrite), reads it back, and updates the row", async () => {
    const c = connector();
    await call(c, "POST", "/connectors/github/token", { token: GOOD });
    const id = rowNow()?.["id"];
    keychain.calls.length = 0;
    env.advance(DAY);
    const res = await call(c, "POST", "/connectors/github/token", { token: GOOD2 });
    expect(res.status).toBe(200);
    expect(keychain.calls).toEqual([
      `delete ${GITHUB_KEYCHAIN_SERVICE}`,
      `add ${GITHUB_KEYCHAIN_SERVICE} ${GITHUB_KEYCHAIN_ACCOUNT}`,
      `read ${GITHUB_KEYCHAIN_SERVICE}`,
    ]);
    expect(keychain.items.get(GITHUB_KEYCHAIN_SERVICE)?.secret).toBe(GOOD2);
    expect(rowNow()).toMatchObject({ id, status: "connected", reachable_repos_json: JSON.stringify(["owner-one/ntfs-tool"]), verified_at: env.now().toISOString() });
    expect(statusEvents()).toEqual([
      { connector_id: id, kind: "github", status: "connected", permissions_source: "reported" },
      { connector_id: id, kind: "github", status: "connected", permissions_source: "reported" },
    ]);
    expectNoToken(res.body);
  });

  it("a refused second token leaves the first in use", async () => {
    const c = connector();
    await call(c, "POST", "/connectors/github/token", { token: GOOD });
    for (const token of [WRITE, BAD, UNKNOWN]) await call(c, "POST", "/connectors/github/token", { token });
    expect(keychain.items.get(GITHUB_KEYCHAIN_SERVICE)?.secret).toBe(GOOD);
    expect(rowNow()?.["status"]).toBe("connected");
  });

  it("a read-back that does not hold the new token (security -i exiting 0 on failure) is keychain_failed and the row reads disconnected, never connected", async () => {
    const c = connector();
    await call(c, "POST", "/connectors/github/token", { token: GOOD });
    keychain.silentAddFailure = true;
    const res = await call(c, "POST", "/connectors/github/token", { token: GOOD2 });
    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toBe("keychain_failed");
    expect(rowNow()?.["status"]).toBe("disconnected");
    expect(statusEvents().map((e) => e["status"])).toEqual(["connected", "disconnected"]);
    expectNoToken(res.body);
  });

  it("AC10: a first-ever set whose read-back fails creates the row disconnected with exactly one connector_status event", async () => {
    keychain.silentAddFailure = true;
    const res = await call(connector(), "POST", "/connectors/github/token", { token: GOOD });
    expect((res.body as { error: string }).error).toBe("keychain_failed");
    expect(((res.body as { connector: Record<string, unknown> }).connector)["status"]).toBe("disconnected");
    expect(rowNow()?.["status"]).toBe("disconnected");
    expect(statusEvents()).toEqual([{ connector_id: rowNow()?.["id"], kind: "github", status: "disconnected" }]);
    expectNoToken(res.body);
  });

  it("AC10: a failed read-back from a rejected row appends one disconnected event; from a disconnected row (no change) none", async () => {
    const c = connector();
    await call(c, "POST", "/connectors/github/token", { token: WRITE });
    keychain.silentAddFailure = true;
    await call(c, "POST", "/connectors/github/token", { token: GOOD });
    expect(statusEvents().map((e) => e["status"])).toEqual(["rejected", "disconnected"]);
    await call(c, "POST", "/connectors/github/token", { token: GOOD2 });
    expect(statusEvents().map((e) => e["status"])).toEqual(["rejected", "disconnected"]);
    expect(rowNow()?.["status"]).toBe("disconnected");
  });

  it("an add that throws an error quoting the token: the read-back decides, and the error's text is never kept", async () => {
    const throwingWriter: KeychainWriter = {
      add: (_s, _a, secret) => {
        throw new Error(`security: could not add ${secret}`);
      },
    };
    const res = await call(connector({ writer: throwingWriter }), "POST", "/connectors/github/token", { token: GOOD });
    expect((res.body as { error: string }).error).toBe("keychain_failed");
    expect(rowNow()?.["status"]).toBe("disconnected");
    expectNoToken(res.body);
  });
});

// ---------------------------------------------------------------------------
// AC7: disconnect
// ---------------------------------------------------------------------------

describe("disconnect (AC7)", () => {
  it("deletes the Keychain item, sets disconnected and keeps the row; a second disconnect (already gone) answers the same row with no new event", async () => {
    const c = connector();
    await call(c, "POST", "/connectors/github/token", { token: GOOD });
    const id = rowNow()?.["id"];
    const res = await call(c, "POST", "/connectors/github/disconnect");
    expect(res.status).toBe(200);
    expect(keychain.items.has(GITHUB_KEYCHAIN_SERVICE)).toBe(false);
    expect((res.body as { connector: Record<string, unknown> }).connector).toMatchObject({ id, status: "disconnected" });
    expect(rowNow()).toMatchObject({ id, status: "disconnected" });
    const again = await call(c, "POST", "/connectors/github/disconnect");
    expect(again.status).toBe(200);
    expect(statusEvents().map((e) => e["status"])).toEqual(["connected", "disconnected"]);
    expectNoToken(res.body, again.body);
  });

  it("the real deleter's exit status 44 (item not found) counts as already gone", async () => {
    const exec: ExecFileSyncLike = () => {
      throw Object.assign(new Error("security: The specified item could not be found in the keychain."), { status: 44, signal: null });
    };
    const c = connector({ deleter: securityCliKeychainDeleter(exec) });
    await call(c, "POST", "/connectors/github/token", { token: GOOD });
    const res = await call(c, "POST", "/connectors/github/disconnect");
    expect(res.status).toBe(200);
    expect(rowNow()?.["status"]).toBe("disconnected");
  });

  it("a Keychain delete failure answers keychain_failed and changes nothing; with no row, disconnect answers 404 no_connector", async () => {
    const c = connector();
    expect(await call(c, "POST", "/connectors/github/disconnect")).toMatchObject({ status: 404, body: { error: "no_connector" } });
    await call(c, "POST", "/connectors/github/token", { token: GOOD });
    keychain.deleteThrows = new Error(`delete failed for ${GOOD}`);
    const res = await call(c, "POST", "/connectors/github/disconnect");
    expect(res).toMatchObject({ status: 500, body: { error: "keychain_failed" } });
    expect(rowNow()?.["status"]).toBe("connected");
    expect(keychain.items.get(GITHUB_KEYCHAIN_SERVICE)?.secret).toBe(GOOD);
    expectNoToken(res.body);
  });
});

// ---------------------------------------------------------------------------
// AC8: expiry
// ---------------------------------------------------------------------------

describe("the expiry check (AC8)", () => {
  function notifications(): { source: string; title: string; body: string }[] {
    return env.store.prepare("SELECT source, title, body FROM notifications ORDER BY id").all() as { source: string; title: string; body: string }[];
  }

  async function connectExpiringIn(ms: number, token = GOOD): Promise<void> {
    const expires = new Date(env.now().getTime() + ms).toISOString();
    const data = { ...GITHUB, [token]: { ...GITHUB[token], tokenInfo: { login: "owner-one", expires_at: expires, permissions: READ_ONLY } } };
    const c = createGitHubConnector({ keychain, writer: keychain, deleter: keychain, clientFor: fakeClientFor(data) });
    expect((await call(c, "POST", "/connectors/github/token", { token })).status).toBe(200);
  }

  it("14 days ahead: one notification and expiring; again that day and the next, none; at 1 day a second, once; after expires_at, expired", async () => {
    await connectExpiringIn(14 * DAY);
    const runDue = (): void => void githubExpiryDueWork({ store: env.store, now: env.now });
    runDue();
    expect(notifications().map((n) => n.source)).toEqual(["kernel:github_token_expiring_14d"]);
    expect(notifications()[0]?.title).toBe("GitHub token expires in 14 days");
    expect(rowNow()?.["status"]).toBe("expiring");
    env.advance(3_600_000);
    runDue();
    env.advance(DAY);
    runDue();
    expect(notifications()).toHaveLength(1);
    env.advance(12 * DAY - 3_600_000);
    runDue();
    runDue();
    expect(notifications().map((n) => n.source)).toEqual(["kernel:github_token_expiring_14d", "kernel:github_token_expiring_1d"]);
    expect(notifications()[1]?.title).toBe("GitHub token expires in 1 day");
    env.advance(DAY);
    runDue();
    expect(rowNow()?.["status"]).toBe("expired");
    env.advance(DAY);
    runDue();
    expect(notifications()).toHaveLength(2);
    expect(statusEvents().map((e) => e["status"])).toEqual(["connected", "expiring", "expired"]);
    expectNoToken(notifications());
  });

  it("a token set with 1 day left gets the 1-day notification only, never the 14-day one after it", async () => {
    await connectExpiringIn(DAY - 60_000);
    checkGitHubExpiry(env.store, env.now());
    env.advance(3_600_000);
    checkGitHubExpiry(env.store, env.now());
    expect(notifications().map((n) => n.source)).toEqual(["kernel:github_token_expiring_1d"]);
  });

  it("a replacement token with a new expiry is warned afresh; more than 14 days ahead nothing happens", async () => {
    await connectExpiringIn(10 * DAY);
    checkGitHubExpiry(env.store, env.now());
    await connectExpiringIn(13 * DAY, GOOD2);
    expect(rowNow()?.["status"]).toBe("connected");
    checkGitHubExpiry(env.store, env.now());
    expect(notifications()).toHaveLength(2);
    await connectExpiringIn(20 * DAY);
    checkGitHubExpiry(env.store, env.now());
    expect(notifications()).toHaveLength(2);
    expect(rowNow()?.["status"]).toBe("connected");
  });

  it("does nothing for a disconnected or rejected row, or an unknown expiry; touches neither the Keychain nor GitHub", async () => {
    checkGitHubExpiry(env.store, env.now());
    const noExpiry = { ...GITHUB, [GOOD]: { ...GITHUB[GOOD], tokenInfo: { login: "owner-one", expires_at: null, permissions: READ_ONLY } } };
    const c = createGitHubConnector({ keychain, writer: keychain, deleter: keychain, clientFor: fakeClientFor(noExpiry) });
    await call(c, "POST", "/connectors/github/token", { token: GOOD });
    keychain.calls.length = 0;
    const clientCount = clients.length;
    env.advance(400 * DAY);
    checkGitHubExpiry(env.store, env.now());
    expect(rowNow()?.["status"]).toBe("connected");
    expect(keychain.calls).toEqual([]);
    expect(clients).toHaveLength(clientCount);
    expect(notifications()).toEqual([]);
  });

  it("the shipped connector part's due work is the expiry check", () => {
    expect(githubConnectorPart.dueWork).toEqual([githubExpiryDueWork]);
  });
});

// ---------------------------------------------------------------------------
// AC10: events
// ---------------------------------------------------------------------------

describe("connector_status events (AC10)", () => {
  it("one per change (set, refused, replace, disconnect), each {connector_id, kind, status} (plus refused for a refusal, or permissions_source for a successful set), never a secret", async () => {
    const c = connector();
    await call(c, "POST", "/connectors/github/token", { token: WRITE });
    await call(c, "POST", "/connectors/github/token", { token: GOOD });
    await call(c, "POST", "/connectors/github/token", { token: GOOD2 });
    await call(c, "POST", "/connectors/github/disconnect");
    const id = rowNow()?.["id"];
    expect(statusEvents()).toEqual([
      { connector_id: id, kind: "github", status: "rejected", refused: "token_write_scoped" },
      { connector_id: id, kind: "github", status: "connected", permissions_source: "reported" },
      { connector_id: id, kind: "github", status: "connected", permissions_source: "reported" },
      { connector_id: id, kind: "github", status: "disconnected" },
    ]);
    expect(events(env.store, "connector_status").every((e) => e.actor === "kernel" && e.session_id === null)).toBe(true);
    expectNoToken();
  });
});

// ---------------------------------------------------------------------------
// AC11: routes
// ---------------------------------------------------------------------------

describe("the four routes (AC11)", () => {
  it("GET /connectors answers [] with none, then every row in the Connector shape", async () => {
    const c = connector();
    expect(await call(c, "GET", "/connectors")).toEqual({ status: 200, body: { connectors: [] } });
    await call(c, "POST", "/connectors/github/token", { token: GOOD });
    const res = await call(c, "GET", "/connectors");
    const list = (res.body as { connectors: Record<string, unknown>[] }).connectors;
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0] as object).sort()).toEqual(CONNECTOR_KEYS);
    expect(list[0]).toMatchObject({ kind: "github", status: "connected", reachable_repos: ["owner-one/studio-sandbox", "owner-one/loomwright"] });
    expectNoToken(res.body);
  });

  it("GET /connectors/github/repos answers the stored repos; ?refresh=1 re-reads them from GitHub (the stored token) first", async () => {
    const data: Record<string, FakeGitHubData> = { ...GITHUB };
    const c = createGitHubConnector({ keychain, writer: keychain, deleter: keychain, clientFor: fakeClientFor(data) });
    expect(await call(c, "GET", "/connectors/github/repos")).toEqual({ status: 200, body: { repos: [], verified_at: null } });
    await call(c, "POST", "/connectors/github/token", { token: GOOD });
    expect(await call(c, "GET", "/connectors/github/repos")).toEqual({ status: 200, body: { repos: ["owner-one/studio-sandbox", "owner-one/loomwright"], verified_at: T0 } });
    data[GOOD] = { ...GITHUB[GOOD], repos: [{ full_name: "owner-one/new-repo", private: true }] };
    env.advance(3_600_000);
    const refreshed = await call(c, "GET", "/connectors/github/repos", undefined, { refresh: "1" });
    expect(refreshed).toEqual({ status: 200, body: { repos: ["owner-one/new-repo"], verified_at: env.now().toISOString() } });
    expect(clients.at(-1)?.calls.map((x) => x.method)).toEqual(["listReachableRepos"]);
    expect(statusEvents()).toHaveLength(1);
    expectNoToken(refreshed.body);
  });

  it("?refresh=1 with no token in use answers 409 not_connected; a 401 on refresh answers token_invalid and changes nothing", async () => {
    const data: Record<string, FakeGitHubData> = { ...GITHUB };
    const c = createGitHubConnector({ keychain, writer: keychain, deleter: keychain, clientFor: fakeClientFor(data) });
    expect(await call(c, "GET", "/connectors/github/repos", undefined, { refresh: "1" })).toMatchObject({ status: 404, body: { error: "no_connector" } });
    await call(c, "POST", "/connectors/github/token", { token: GOOD });
    delete data[GOOD];
    const before = rowNow();
    expect(await call(c, "GET", "/connectors/github/repos", undefined, { refresh: "1" })).toMatchObject({ status: 422, body: { error: "token_invalid" } });
    expect(rowNow()).toEqual(before);
    await call(c, "POST", "/connectors/github/disconnect");
    expect(await call(c, "GET", "/connectors/github/repos", undefined, { refresh: "1" })).toMatchObject({ status: 409, body: { error: "not_connected" } });
  });

  it("?refresh=1 with the Keychain item gone answers keychain_failed; a rate limit on refresh answers 429; neither changes the row", async () => {
    const data: Record<string, FakeGitHubData> = { ...GITHUB };
    const c = createGitHubConnector({ keychain, writer: keychain, deleter: keychain, clientFor: fakeClientFor(data) });
    await call(c, "POST", "/connectors/github/token", { token: GOOD });
    const before = rowNow();
    data[GOOD] = { ...GITHUB[GOOD], failures: { listReachableRepos: { ok: false, error: "rate_limited", resets_at: "2026-10-27T12:00:00.000Z", rateLimit: FAKE_RATE_LIMIT } } };
    expect(await call(c, "GET", "/connectors/github/repos", undefined, { refresh: "1" })).toMatchObject({ status: 429, body: { error: "rate_limited", resets_at: "2026-10-27T12:00:00.000Z" } });
    keychain.items.clear();
    expect(await call(c, "GET", "/connectors/github/repos", undefined, { refresh: "1" })).toMatchObject({ status: 500, body: { error: "keychain_failed" } });
    expect(rowNow()).toEqual(before);
  });

  it("a refusal after the token expired sets rejected (no token in use); the expiry check then leaves the row alone", async () => {
    const c = connector();
    await call(c, "POST", "/connectors/github/token", { token: GOOD });
    env.advance(31 * DAY);
    checkGitHubExpiry(env.store, env.now());
    expect(rowNow()?.["status"]).toBe("expired");
    const res = await call(c, "POST", "/connectors/github/token", { token: WRITE });
    expect((res.body as { connector: Record<string, unknown> }).connector["status"]).toBe("rejected");
    checkGitHubExpiry(env.store, env.now());
    expect(statusEvents().map((e) => e["status"])).toEqual(["connected", "expired", "rejected"]);
  });

  it("a body without a string token answers 400 invalid_body and changes nothing", async () => {
    const c = connector();
    for (const body of [undefined, null, [], { token: 5 }, { tok: GOOD }]) {
      expect(await call(c, "POST", "/connectors/github/token", body)).toMatchObject({ status: 400, body: { error: "invalid_body" } });
    }
    expect(await call(c, "POST", "/connectors/github/disconnect", [GOOD])).toMatchObject({ status: 400, body: { error: "invalid_body" } });
    expect(rowNow()).toBeUndefined();
    expect(keychain.calls).toEqual([]);
  });

  it("a handler never throws: a client that throws an error quoting the token answers connector_failed, and the message is not kept", async () => {
    const c = connector({
      clientFor: (readToken) => {
        throw new Error(`TypeError: invalid header value Bearer ${readToken?.() ?? ""}`);
      },
    });
    const res = await call(c, "POST", "/connectors/github/token", { token: GOOD });
    expect(res).toMatchObject({ status: 500, body: { error: "connector_failed" } });
    expectNoToken(res.body);
  });

  it("the shipped routes part serves exactly the contract's four p6-item-03 routes", async () => {
    const { readFileSync } = await import("node:fs");
    const contract = readFileSync(new URL("../../app/src/api/contract.ts", import.meta.url), "utf8");
    const item03 = [...contract.matchAll(/\{ method: "([A-Z]+)", path: "([^"]+)", origin: "p6-item-03" \}/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(item03).toHaveLength(4);
    // The integrations feature also serves item 07's two drafts routes (the drafts part, merged last).
    const item07 = [...contract.matchAll(/\{ method: "([A-Z]+)", path: "([^"]+)", origin: "p6-item-07" \}/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(item07).toEqual(["GET /drafts", "GET /drafts/:id"]);
    const merged = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED);
    const served = merged.routes.filter((r) => r.owner === "integrations").map((r) => `${r.method} ${r.path}`);
    expect(served).toEqual([...item03, ...item07]);
    expect(githubRoutesPart.routes.map((r) => `${r.method} ${r.path}`)).toEqual(item03);
  });
});

// ---------------------------------------------------------------------------
// AC5 and AC1 (CLI): `studio connectors` against a live API server
// ---------------------------------------------------------------------------

describe("studio connectors (AC1 via the CLI, AC5)", () => {
  let server: ApiServer;
  let secret: SecretRead;
  let contribution: FeatureContribution;
  let fetchCalls: string[];

  beforeEach(async () => {
    secret = { ok: true, token: GOOD };
    fetchCalls = [];
    const c = connector();
    contribution = integrationsContributionOf([
      { ...githubConnectorPart, subcommands: [connectorsSubcommand({ readSecret: async () => secret })] },
      { ...githubRoutesPart, routes: githubRoutes(c) },
      githubToolsPart,
      draftsPart,
    ]);
    server = await startApiServer(
      {
        store: env.store,
        sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
        loop: { start: () => {}, stop: async () => {} },
        authProviders: [stubProvider()],
        token: API_TOKEN,
        routes: mergeContributions([contribution], PHASE1_RESERVED).routes,
      },
      { now: env.now },
    );
    writeFileSync(join(env.dataDir, "api.json"), JSON.stringify({ port: server.port, host: "127.0.0.1", pid: process.pid, started_at: T0 }));
  });

  afterEach(async () => {
    await server.close();
  });

  async function studio(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const out: string[] = [];
    const err: string[] = [];
    const recordingFetch = ((url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push(`${init?.method ?? "GET"} ${new URL(String(url)).pathname}`);
      return fetch(url, init);
    }) as typeof fetch;
    const code = await runCli(argv, {
      dataDir: env.dataDir,
      keychain: { read: (s) => (s === API_TOKEN_KEYCHAIN_SERVICE ? API_TOKEN : undefined) },
      isPidAlive: () => true,
      fetch: recordingFetch,
      contributions: [contribution],
      stdout: { write: (chunk: string) => out.push(chunk) },
      stderr: { write: (chunk: string) => err.push(chunk) },
    });
    return { code, stdout: out.join(""), stderr: err.join("") };
  }

  it("AC1: set (token on stdin) writes the Keychain item and the row reads connected; the token is in no output, row or event", async () => {
    const r = await studio("connectors", "github", "set");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`studio: GitHub connected as owner-one: 2 reachable repos; expires ${EXPIRES}\n`);
    expect(keychain.items.get(GITHUB_KEYCHAIN_SERVICE)?.secret).toBe(GOOD);
    expect(rowNow()).toMatchObject({ status: "connected", account_login: "owner-one", expires_at: EXPIRES, verified_at: T0 });
    expect(fetchCalls).toEqual(["POST /connectors/github/token"]);
    expectNoToken(r.stdout, r.stderr);
  });

  it("AC5: set with the token as an argument exits 2 without contacting the kernel and without echoing it", async () => {
    const r = await studio("connectors", "github", "set", BAD);
    expect(r.code).toBe(2);
    expect(fetchCalls).toEqual([]);
    expect(r.stderr).toContain("takes no argument");
    expect(r.stderr).toContain(CONNECTORS_HELP);
    expectNoToken(r.stdout, r.stderr);
    // An unknown word is not echoed either.
    const odd = await studio("connectors", BAD);
    expect(odd.code).toBe(2);
    expect(fetchCalls).toEqual([]);
    expectNoToken(odd.stdout, odd.stderr);
    expect(rowNow()).toBeUndefined();
  });

  it("AC5: a refusal prints its code and message on stderr and exits 1; an empty stdin sends nothing", async () => {
    secret = { ok: true, token: WRITE };
    const r = await studio("connectors", "github", "set");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("studio: token not stored: token_write_scoped:");
    expect(r.stderr).toContain("pull_requests: write → set to read");
    secret = { ok: false, reason: "empty" };
    fetchCalls.length = 0;
    const empty = await studio("connectors", "github", "set");
    expect(empty.code).toBe(1);
    expect(fetchCalls).toEqual([]);
    expectNoToken(r.stdout, r.stderr, empty.stdout, empty.stderr);
  });

  it("AC5: studio connectors and github status call GET /connectors; github disconnect calls POST /connectors/github/disconnect", async () => {
    expect((await studio("connectors")).stdout).toBe("no connectors (studio connectors github set connects GitHub)\n");
    expect((await studio("connectors", "github", "status")).stdout).toBe("github: not connected (studio connectors github set connects it)\n");
    await studio("connectors", "github", "set");
    fetchCalls.length = 0;
    const list = await studio("connectors");
    expect(list.stdout).toBe(`github: connected as owner-one; expires ${EXPIRES}; verified ${T0}; 2 reachable repos\n`);
    const status = await studio("connectors", "github", "status");
    expect(status.stdout).toContain("github: connected\n  account: owner-one\n  permissions: metadata: read, contents: read, pull_requests: read\n");
    expect(status.stdout).toContain("reachable repos (2): owner-one/studio-sandbox, owner-one/loomwright\n");
    const json = await studio("connectors", "--json");
    expect(JSON.parse(json.stdout).connectors[0].status).toBe("connected");
    const off = await studio("connectors", "github", "disconnect");
    expect(off.code).toBe(0);
    expect(off.stdout).toContain("GitHub disconnected");
    expect(keychain.items.has(GITHUB_KEYCHAIN_SERVICE)).toBe(false);
    expect(fetchCalls).toEqual(["GET /connectors", "GET /connectors", "GET /connectors", "POST /connectors/github/disconnect"]);
    expectNoToken(list.stdout, status.stdout, json.stdout, off.stdout);
  });

  it("through the live API server, a forced failure records no route_failed event and no token", async () => {
    const throwing = connector({
      clientFor: (readToken) => {
        throw new Error(`invalid header value Bearer ${readToken?.() ?? ""}`);
      },
    });
    await server.close();
    server = await startApiServer(
      {
        store: env.store,
        sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
        loop: { start: () => {}, stop: async () => {} },
        authProviders: [stubProvider()],
        token: API_TOKEN,
        routes: mergeContributions([integrationsContributionOf([{ ...githubRoutesPart, routes: githubRoutes(throwing) }])], PHASE1_RESERVED).routes,
      },
      { now: env.now },
    );
    const res = await fetch(`http://127.0.0.1:${server.port}/connectors/github/token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ token: GOOD }),
    });
    const body = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(body)).toMatchObject({ error: "connector_failed" });
    expect(events(env.store, "route_failed")).toEqual([]);
    expectNoToken(body);
  });

  it("github status --json answers the connector or null; disconnect with nothing to disconnect exits 1 naming the refusal; an unknown verb exits 2", async () => {
    expect(JSON.parse((await studio("connectors", "github", "status", "--json")).stdout)).toEqual({ connector: null });
    const off = await studio("connectors", "github", "disconnect");
    expect(off.code).toBe(1);
    expect(off.stderr).toBe("studio: GitHub not disconnected: no_connector: GitHub is not connected: studio connectors github set connects it\n");
    const odd = await studio("connectors", "github", "rotate");
    expect(odd.code).toBe(2);
    expect(odd.stderr).toBe(`studio: unknown connectors command\nusage: ${CONNECTORS_HELP}\n`);
    await studio("connectors", "github", "set");
    const json = JSON.parse((await studio("connectors", "github", "status", "--json")).stdout) as { connector: Record<string, unknown> };
    expect(json.connector).toMatchObject({ kind: "github", status: "connected" });
  });

  it("a token that cannot be read sends nothing: too long, or the prompt aborted", async () => {
    for (const reason of ["too_long", "aborted"] as const) {
      secret = { ok: false, reason };
      const r = await studio("connectors", "github", "set");
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/nothing was sent/);
    }
    expect(fetchCalls).toEqual([]);
  });

  it("a subcommand run with a recording client: set with an argument makes no request at all", async () => {
    const requests: string[] = [];
    const client: CliApiClient = {
      request: async (method, path) => {
        requests.push(`${method} ${path}`);
        return { status: 200, body: {} };
      },
    };
    const out: string[] = [];
    const sub = connectorsSubcommand({ readSecret: async () => ({ ok: true, token: GOOD }) });
    expect(await sub.run(["github", "set", "--token", GOOD], client, { stdout: { write: (c: string) => out.push(c) }, stderr: { write: (c: string) => out.push(c) } })).toBe(2);
    expect(requests).toEqual([]);
    expectNoToken(out.join(""));
  });
});
