// The owner's declaration (phase 6, item 14): GitHub publishes no permissions
// for a fine-grained token, so the owner may declare that every permission
// they gave it is Read. The kernel records that as the OWNER's word
// (`permissions_source: "declared"` and `permissions_declared_at`), never as
// verified. Covers migration 18, the connector's declared path (the write
// check first), the route's `declared_read_only`, and the CLI's declaration
// (the answer after the token, `status`'s wording).
//
// Every test injects a fake Keychain and a `FakeGitHubClient`; none reaches the
// real Keychain, GitHub or a notifier. The token is a needle on every path:
// each response, every table of the store, the CLI's output and every
// captured log line.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { KeychainDeleter, KeychainReader, KeychainWriter } from "../src/auth/keychain.js";
import type { CliApiClient, ContributedRoute, ContributedRouteResponse } from "../src/features/index.js";
import { DECLARATION_PROMPT, connectorsSubcommand, formatGitHubStatus, isDeclaration } from "../src/integrations/cli.js";
import { GITHUB_KEYCHAIN_SERVICE } from "../src/integrations/github/client.js";
import { GITHUB_KEYCHAIN_ACCOUNT, createGitHubConnector } from "../src/integrations/github/connector.js";
import type { GitHubConnector, GitHubConnectorDeps } from "../src/integrations/github/connector.js";
import { githubRoutes } from "../src/integrations/github/routes.js";
import { CONNECTOR_PERMISSIONS_SOURCES } from "../src/integrations/index.js";
import type { ConnectorPermissionsSource, GitHubFailure } from "../src/integrations/index.js";
import { checkAfterMigrating } from "../src/store/integrity.js";
import { DB_FILENAME, Store, migrations } from "../src/store/index.js";
import { connectorPermissionsSource } from "../src/store/migrations/018_connector_permissions_source.js";
import { FAKE_RATE_LIMIT, FakeGitHubClient } from "./fixtures/github-fake.js";
import type { FakeGitHubData } from "./fixtures/github-fake.js";
import { events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

const T0 = "2026-10-29T10:00:00.000Z";
const DAY = 86_400_000;
const EXPIRES = new Date(Date.parse(T0) + 30 * DAY).toISOString();
const READ_ONLY = { metadata: "read", contents: "read", pull_requests: "read" };

// Each token is a distinct secret the tests look for.
const FINE = `github_pat_11FINEGRAINED${"A".repeat(65)}`;
const FINE2 = `github_pat_11SECONDFINE${"B".repeat(67)}`;
const CLASSIC = `github_pat_11REPORTEDREAD${"C".repeat(64)}`;
const WRITE = `github_pat_11REPORTEDWRITE${"D".repeat(63)}`;
const BAD = `github_pat_11NOTACCEPTED${"E".repeat(65)}`;
const ALL_TOKENS = [FINE, FINE2, CLASSIC, WRITE, BAD];

const REPOS = [
  { full_name: "owner-one/studio-sandbox", private: true },
  { full_name: "owner-one/loomwright", private: false },
];

/** What GitHub answers for each token (one missing here answers 401). `FINE` reports no permissions, as a real fine-grained token does. */
const GITHUB: Record<string, FakeGitHubData> = {
  [FINE]: { tokenInfo: { login: "owner-one", expires_at: EXPIRES, permissions: null }, repos: REPOS },
  [FINE2]: { tokenInfo: { login: "owner-one", expires_at: EXPIRES, permissions: {} }, repos: [{ full_name: "owner-one/ntfs-tool", private: false }] },
  [CLASSIC]: { tokenInfo: { login: "owner-one", expires_at: EXPIRES, permissions: READ_ONLY }, repos: REPOS },
  [WRITE]: { tokenInfo: { login: "owner-one", expires_at: EXPIRES, permissions: { metadata: "read", pull_requests: "write" } }, repos: REPOS },
};

const UNAUTHORIZED: GitHubFailure = { ok: false, error: "http_error", status: 401, rateLimit: FAKE_RATE_LIMIT };

/** An in-memory Keychain with the real one's rules: add never overwrites; delete answers whether an item was there. */
class FakeKeychain implements KeychainReader, KeychainWriter, KeychainDeleter {
  readonly items = new Map<string, { account: string; secret: string }>();
  readonly calls: string[] = [];

  read(service: string): string | undefined {
    this.calls.push(`read ${service}`);
    return this.items.get(service)?.secret;
  }

  add(service: string, account: string, secret: string): void {
    this.calls.push(`add ${service} ${account}`);
    if (this.items.has(service)) throw new Error("The specified item already exists in the keychain.");
    this.items.set(service, { account, secret });
  }

  delete(service: string): boolean {
    this.calls.push(`delete ${service}`);
    return this.items.delete(service);
  }

  writes(): string[] {
    return this.calls.filter((c) => !c.startsWith("read"));
  }
}

let env: LoopEnv;
let keychain: FakeKeychain;
let captured: string[];
let spies: MockInstance[];

beforeEach(() => {
  env = loopEnv(T0);
  keychain = new FakeKeychain();
  captured = [];
  // Every console line and stdout/stderr write the code under test makes is kept, so the token can be looked for in them.
  const keep = (...args: unknown[]): boolean => {
    captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a) ?? "")).join(" "));
    return true;
  };
  spies = [
    ...(["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(keep)),
    vi.spyOn(process.stdout, "write").mockImplementation(keep),
    vi.spyOn(process.stderr, "write").mockImplementation(keep),
  ];
});

afterEach(() => {
  for (const s of spies) s.mockRestore();
  env.cleanup();
});

function fakeClientFor(data: Record<string, FakeGitHubData> = GITHUB): NonNullable<GitHubConnectorDeps["clientFor"]> {
  return (readToken, kc) => {
    const token = readToken !== undefined ? readToken() : kc.read(GITHUB_KEYCHAIN_SERVICE);
    const answers = token !== undefined ? data[token] : undefined;
    return new FakeGitHubClient(answers ?? { failures: { getTokenInfo: UNAUTHORIZED, listReachableRepos: UNAUTHORIZED } });
  };
}

function connector(overrides: GitHubConnectorDeps = {}): GitHubConnector {
  return createGitHubConnector({ keychain, writer: keychain, deleter: keychain, clientFor: fakeClientFor(), ...overrides });
}

/** Every value in every table of the store, as one string. */
function everythingStored(): string {
  const tables = env.store.prepare<[], string>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all();
  return tables.map((t) => JSON.stringify(env.store.prepare(`SELECT * FROM ${t}`).all())).join("\n");
}

/** No token (nor a fragment of one) is in the store, any captured log line or any of `texts`. */
function expectNoToken(...texts: unknown[]): void {
  const haystacks = [everythingStored(), ...captured, ...texts.map((t) => (typeof t === "string" ? t : JSON.stringify(t) ?? ""))];
  for (const token of ALL_TOKENS) {
    for (const h of haystacks) {
      expect(h.includes(token), "a token was found").toBe(false);
      expect(h.includes(token.slice(11, 30)), "a token fragment was found").toBe(false);
    }
  }
}

function route(routes: readonly ContributedRoute[], method: string, path: string): ContributedRoute {
  const r = routes.find((x) => x.method === method && x.path === path);
  if (r === undefined) throw new Error(`no route ${method} ${path}`);
  return r;
}

async function call(c: GitHubConnector, method: string, path: string, body?: unknown): Promise<ContributedRouteResponse> {
  return route(githubRoutes(c), method, path).handler({ params: {}, query: {}, body, store: env.store, now: env.now });
}

function post(c: GitHubConnector, body: unknown): Promise<ContributedRouteResponse> {
  return call(c, "POST", "/connectors/github/token", body);
}

function statusEvents(): Record<string, unknown>[] {
  return events(env.store, "connector_status").map((e) => e.payload);
}

function rowNow(): Record<string, unknown> | undefined {
  return env.store.prepare("SELECT * FROM connectors WHERE kind = 'github'").get() as Record<string, unknown> | undefined;
}

function errorOf(res: ContributedRouteResponse): string {
  return (res.body as { error: string }).error;
}

function connectorOf(res: ContributedRouteResponse): Record<string, unknown> {
  return (res.body as { connector: Record<string, unknown> }).connector;
}

// ---------------------------------------------------------------------------
// AC6: migration 18
// ---------------------------------------------------------------------------

describe("migration 18: connector_permissions_source (AC6)", () => {
  const V17 = migrations.slice(0, 17);
  let dir: string;
  const stores: Store[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-m18-"));
  });

  afterEach(() => {
    for (const s of stores.splice(0)) {
      try {
        s.close();
      } catch {
        // already closed
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });

  function open(list?: typeof migrations): Store {
    const s = new Store({ dataDir: dir, ...(list === undefined ? {} : { migrations: list }) });
    stores.push(s);
    return s;
  }

  function inspect<T>(fn: (db: Database.Database) => T): T {
    const db = new Database(join(dir, DB_FILENAME), { readonly: true, fileMustExist: true });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  const columnsOf = (db: Store): string[] => db.prepare<[], string>("SELECT name FROM pragma_table_info('connectors')").pluck().all();

  it("is version 18 (second to last: migration 19 sits above it), and the shipped list is contiguous from 1", () => {
    expect(migrations.at(-2)).toBe(connectorPermissionsSource);
    expect([connectorPermissionsSource.version, connectorPermissionsSource.name]).toEqual([18, "connector_permissions_source"]);
    expect(migrations.map((m) => m.version)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
  });

  it("upgrades a v17 store: both columns are added (nullable TEXT, no default, no CHECK), the existing row keeps its values and reads null for both, and the integrity check passes", () => {
    const v17 = open(V17);
    v17
      .prepare("INSERT INTO connectors (kind, status, account_login, permissions_json, reachable_repos_json, verified_at) VALUES ('github', 'connected', 'someone', ?, '[\"o/r\"]', ?)")
      .run(JSON.stringify(READ_ONLY), T0);
    expect(columnsOf(v17)).not.toContain("permissions_source");
    v17.close();

    const store = open();
    expect(store.appliedMigrations().map((m) => [m.version, m.name]).find(([v]) => v === 18)).toEqual([18, "connector_permissions_source"]);
    // Checked by name, not by tail position: migration 19 adds its columns after these.
    const at = columnsOf(store).indexOf("permissions_source");
    expect(at).toBeGreaterThan(-1);
    expect(columnsOf(store).slice(at, at + 2)).toEqual(["permissions_source", "permissions_declared_at"]);
    for (const column of ["permissions_source", "permissions_declared_at"]) {
      expect(store.prepare(`SELECT type, "notnull", dflt_value FROM pragma_table_info('connectors') WHERE name = ?`).get(column), column).toEqual({ type: "TEXT", notnull: 0, dflt_value: null });
    }
    expect(store.prepare("SELECT account_login, permissions_json, verified_at, permissions_source, permissions_declared_at FROM connectors").all()).toEqual([
      { account_login: "someone", permissions_json: JSON.stringify(READ_ONLY), verified_at: T0, permissions_source: null, permissions_declared_at: null },
    ]);
    const sql = store.prepare<[string], string>("SELECT sql FROM sqlite_master WHERE name = ?").pluck().get("connectors") ?? "";
    expect(sql).not.toMatch(/CHECK/i);
    expect(store.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name <> 'events'").pluck().get()).toBe(0);
    store.close();

    inspect((db) => expect(() => checkAfterMigrating(db, dir, migrations)).not.toThrow());
  });

  it("is safe to re-run: with its record deleted (and 19's, which sits above it), migration 18 runs again as a no-op and every row stays", () => {
    const first = open();
    first.prepare("INSERT INTO connectors (kind, status, permissions_source, permissions_declared_at) VALUES ('github', 'connected', 'declared', ?)").run(T0);
    first.close();

    const db = new Database(join(dir, DB_FILENAME));
    // Deleting 18 alone would leave 19 above a gap: 18 and 19 re-run together.
    db.exec("DELETE FROM schema_migrations WHERE version >= 18");
    db.close();

    const rerun = open();
    expect(rerun.appliedMigrations().map((m) => [m.version, m.name]).find(([v]) => v === 18)).toEqual([18, "connector_permissions_source"]);
    expect(rerun.prepare("SELECT permissions_source, permissions_declared_at FROM connectors").all()).toEqual([{ permissions_source: "declared", permissions_declared_at: T0 }]);
    expect(columnsOf(rerun).filter((c) => c.startsWith("permissions_"))).toEqual(["permissions_json", "permissions_source", "permissions_declared_at"]);
  });
});

describe("CONNECTOR_PERMISSIONS_SOURCES", () => {
  it("is the closed pair reported and declared, frozen", () => {
    expect([...CONNECTOR_PERMISSIONS_SOURCES]).toEqual(["reported", "declared"]);
    expect(Object.isFrozen(CONNECTOR_PERMISSIONS_SOURCES)).toBe(true);
    const source: ConnectorPermissionsSource = CONNECTOR_PERMISSIONS_SOURCES[1];
    expect(source).toBe("declared");
  });
});

// ---------------------------------------------------------------------------
// AC1: unknown permissions and no declaration are refused
// ---------------------------------------------------------------------------

describe("unknown permissions with no declaration are refused (AC1)", () => {
  it.each([
    ["body {token}", { token: FINE }],
    ["declared_read_only: false (the same as absent)", { token: FINE, declared_read_only: false }],
  ])("%s: 422 token_permissions_unknown naming the declaration; no Keychain call; the row is rejected, not connected", async (_name, body) => {
    const res = await post(connector(), body);
    expect(res.status).toBe(422);
    expect(errorOf(res)).toBe("token_permissions_unknown");
    const message = (res.body as { message: string }).message;
    expect(message).toContain("declared_read_only: true");
    expect(message).toContain("confirmation");
    expect(message).toContain("yes");
    expect(message).not.toMatch(/OPEN_QUESTIONS|probe/);
    expect(keychain.calls).toEqual([]);
    expect(rowNow()).toMatchObject({ status: "rejected", permissions_json: null, permissions_source: null, permissions_declared_at: null });
    expect(statusEvents()).toEqual([expect.objectContaining({ status: "rejected", refused: "token_permissions_unknown" })]);
    expectNoToken(res.body);
  });

  it("an empty permission map is unknown too", async () => {
    const res = await post(connector(), { token: FINE2 });
    expect(errorOf(res)).toBe("token_permissions_unknown");
    expect(keychain.calls).toEqual([]);
    expectNoToken(res.body);
  });

  it("an existing connected token's Keychain item and row stay unchanged", async () => {
    const c = connector();
    await post(c, { token: CLASSIC });
    const before = rowNow();
    keychain.calls.length = 0;
    const res = await post(c, { token: FINE });
    expect(errorOf(res)).toBe("token_permissions_unknown");
    expect(keychain.writes()).toEqual([]);
    expect(keychain.items.get(GITHUB_KEYCHAIN_SERVICE)?.secret).toBe(CLASSIC);
    expect(rowNow()).toEqual(before);
    expectNoToken(res.body);
  });
});

// ---------------------------------------------------------------------------
// AC2: a declared connect
// ---------------------------------------------------------------------------

describe("a declared connect (AC2)", () => {
  it("writes the Keychain item; the row and the answer read connected with permissions null, source declared and the write time; the event carries the source", async () => {
    const c = connector();
    env.advance(DAY);
    const res = await post(c, { token: FINE, declared_read_only: true });
    expect(res.status).toBe(200);
    const at = env.now().toISOString();
    expect(at).not.toBe(T0);
    expect(connectorOf(res)).toMatchObject({
      kind: "github",
      status: "connected",
      account_login: "owner-one",
      permissions: null,
      permissions_source: "declared",
      permissions_declared_at: at,
      reachable_repos: ["owner-one/studio-sandbox", "owner-one/loomwright"],
      expires_at: EXPIRES,
      verified_at: at,
    });
    expect(keychain.items.get(GITHUB_KEYCHAIN_SERVICE)).toEqual({ account: GITHUB_KEYCHAIN_ACCOUNT, secret: FINE });
    expect(rowNow()).toMatchObject({ status: "connected", permissions_json: null, permissions_source: "declared", permissions_declared_at: at });
    expect(statusEvents()).toEqual([{ connector_id: connectorOf(res)["id"], kind: "github", status: "connected", permissions_source: "declared" }]);
    expectNoToken(res.body);
  });

  it("an empty permission map with a declaration connects declared too", async () => {
    const res = await post(connector(), { token: FINE2, declared_read_only: true });
    expect(res.status).toBe(200);
    expect(connectorOf(res)).toMatchObject({ permissions: null, permissions_source: "declared", permissions_declared_at: T0 });
    expectNoToken(res.body);
  });

  it("the rest is validated as ever: a token GitHub refuses is token_invalid even when declared, and nothing is written", async () => {
    const res = await post(connector(), { token: BAD, declared_read_only: true });
    expect(res.status).toBe(422);
    expect(errorOf(res)).toBe("token_invalid");
    expect(keychain.calls).toEqual([]);
    expect(rowNow()).toMatchObject({ status: "rejected", permissions_source: null, permissions_declared_at: null });
    expectNoToken(res.body);
  });

  it("a GitHub failure while reading the reachable repos changes nothing, declared or not", async () => {
    const failing = connector({
      clientFor: (readToken) => new FakeGitHubClient({ ...(GITHUB[readToken?.() ?? ""] ?? {}), failures: { listReachableRepos: { ok: false, error: "unreachable", rateLimit: null } } }),
    });
    const res = await post(failing, { token: FINE, declared_read_only: true });
    expect(res.status).toBe(502);
    expect(errorOf(res)).toBe("github_unreachable");
    expect(keychain.calls).toEqual([]);
    expect(rowNow()?.["status"]).not.toBe("connected");
    expectNoToken(res.body);
  });

  it("a later reported connect clears the declaration: source reported, declared_at null, the reported permissions stored", async () => {
    const c = connector();
    await post(c, { token: FINE, declared_read_only: true });
    expect(rowNow()).toMatchObject({ permissions_source: "declared", permissions_declared_at: T0 });
    env.advance(DAY);
    const res = await post(c, { token: CLASSIC });
    expect(res.status).toBe(200);
    expect(connectorOf(res)).toMatchObject({ permissions: READ_ONLY, permissions_source: "reported", permissions_declared_at: null });
    expect(rowNow()).toMatchObject({ permissions_json: JSON.stringify(READ_ONLY), permissions_source: "reported", permissions_declared_at: null });
    expect(statusEvents().map((e) => e["permissions_source"])).toEqual(["declared", "reported"]);
    expectNoToken(res.body);
  });

  it("a later declared connect replaces reported permissions with null and records the new time", async () => {
    const c = connector();
    await post(c, { token: CLASSIC });
    env.advance(DAY);
    const res = await post(c, { token: FINE, declared_read_only: true });
    expect(connectorOf(res)).toMatchObject({ permissions: null, permissions_source: "declared", permissions_declared_at: env.now().toISOString() });
    expect(rowNow()?.["permissions_json"]).toBeNull();
    expectNoToken(res.body);
  });

  it("disconnect and refresh leave both columns unchanged", async () => {
    const c = connector();
    await post(c, { token: FINE, declared_read_only: true });
    env.advance(DAY);
    const refreshed = await route(githubRoutes(c), "GET", "/connectors/github/repos").handler({
      params: {},
      query: { refresh: "1" },
      body: undefined,
      store: env.store,
      now: env.now,
    });
    expect(refreshed.status).toBe(200);
    expect(rowNow()).toMatchObject({ status: "connected", permissions_source: "declared", permissions_declared_at: T0, verified_at: env.now().toISOString() });
    const off = await call(c, "POST", "/connectors/github/disconnect");
    expect(off.status).toBe(200);
    expect(rowNow()).toMatchObject({ status: "disconnected", permissions_source: "declared", permissions_declared_at: T0 });
    expect(connectorOf(off)).toMatchObject({ permissions: null, permissions_source: "declared", permissions_declared_at: T0 });
    expectNoToken(refreshed.body, off.body);
  });

  it("GET /connectors answers the declared row with both fields, and a pre-migration style row (null columns) with both null", async () => {
    const c = connector();
    await post(c, { token: FINE, declared_read_only: true });
    env.store.prepare("INSERT INTO connectors (kind, status) VALUES ('later_kind', 'connected')").run();
    const res = await call(c, "GET", "/connectors");
    const list = (res.body as { connectors: Record<string, unknown>[] }).connectors;
    expect(list[0]).toMatchObject({ permissions_source: "declared", permissions_declared_at: T0 });
    expect(list[1]).toMatchObject({ permissions_source: null, permissions_declared_at: null });
    expectNoToken(res.body);
  });

  it("an unknown value in the source column is never passed on", async () => {
    const c = connector();
    await post(c, { token: FINE, declared_read_only: true });
    env.store.prepare("UPDATE connectors SET permissions_source = 'verified-by-magic'").run();
    const res = await call(c, "GET", "/connectors");
    expect((res.body as { connectors: Record<string, unknown>[] }).connectors[0]?.["permissions_source"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC3: the write check comes first
// ---------------------------------------------------------------------------

describe("a reported write permission is refused, declared or not (AC3)", () => {
  it.each([
    ["no declaration", { token: WRITE }],
    ["declared_read_only: true", { token: WRITE, declared_read_only: true }],
  ])("%s: 422 token_write_scoped naming the permission; nothing is written", async (_name, body) => {
    const res = await post(connector(), body);
    expect(res.status).toBe(422);
    expect(errorOf(res)).toBe("token_write_scoped");
    expect((res.body as { message: string }).message).toContain("pull_requests: write → set to read");
    expect((res.body as { write_permissions: unknown }).write_permissions).toEqual([{ permission: "pull_requests", level: "write" }]);
    expect(keychain.calls).toEqual([]);
    expect(rowNow()).toMatchObject({ status: "rejected", permissions_source: null, permissions_declared_at: null });
    expectNoToken(res.body);
  });

  it("a declared connected token's Keychain item and row stay unchanged when a write-scoped token is offered with a declaration", async () => {
    const c = connector();
    await post(c, { token: FINE, declared_read_only: true });
    const before = rowNow();
    keychain.calls.length = 0;
    const res = await post(c, { token: WRITE, declared_read_only: true });
    expect(errorOf(res)).toBe("token_write_scoped");
    expect(keychain.writes()).toEqual([]);
    expect(keychain.items.get(GITHUB_KEYCHAIN_SERVICE)?.secret).toBe(FINE);
    expect(rowNow()).toEqual(before);
    expectNoToken(res.body);
  });

  it.each([
    ["no declaration", { token: CLASSIC }],
    ["declared_read_only: true", { token: CLASSIC, declared_read_only: true }],
  ])("reported read levels with %s connect with source reported and no declared_at", async (_name, body) => {
    const res = await post(connector(), body);
    expect(res.status).toBe(200);
    expect(connectorOf(res)).toMatchObject({ status: "connected", permissions: READ_ONLY, permissions_source: "reported", permissions_declared_at: null });
    expect(rowNow()).toMatchObject({ permissions_json: JSON.stringify(READ_ONLY), permissions_source: "reported", permissions_declared_at: null });
    expect(statusEvents()).toEqual([expect.objectContaining({ status: "connected", permissions_source: "reported" })]);
    expectNoToken(res.body);
  });
});

// ---------------------------------------------------------------------------
// AC5: the route's body
// ---------------------------------------------------------------------------

describe("POST /connectors/github/token declared_read_only (AC5)", () => {
  it.each([
    ['the string "true"', "true"],
    ["the number 1", 1],
    ["the number 0", 0],
    ["null", null],
    ["an object", {}],
    ["an array", [true]],
  ])("%s answers 400 invalid_body and the connector is not called", async (_name, value) => {
    const setToken = vi.fn(() => Promise.reject(new Error("must not be called")));
    const spy: GitHubConnector = { setToken, disconnect: vi.fn(), refreshRepos: vi.fn() };
    const res = await post(spy, { token: FINE, declared_read_only: value });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toBe("invalid_body");
    expect(setToken).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain(FINE);
    expectNoToken(res.body);
  });

  it("a boolean is handed on as declaredReadOnly (only true declares); a body without it declares nothing", async () => {
    const seen: unknown[] = [];
    const spy: GitHubConnector = {
      setToken: async (_s, _t, _n, opts) => {
        seen.push(opts);
        return { ok: true, connector: { id: 1 } as never };
      },
      disconnect: vi.fn(),
      refreshRepos: vi.fn(),
    };
    for (const body of [{ token: FINE, declared_read_only: true }, { token: FINE, declared_read_only: false }, { token: FINE }]) {
      expect((await post(spy, body)).status).toBe(200);
    }
    expect(seen).toEqual([{ declaredReadOnly: true }, { declaredReadOnly: false }, { declaredReadOnly: false }]);
  });

  it("a body that is not an object or has no token string is still 400 invalid_body", async () => {
    for (const body of [undefined, "x", [FINE], { declared_read_only: true }, { token: 5, declared_read_only: true }]) {
      const res = await post(connector(), body);
      expect(res.status).toBe(400);
      expect(errorOf(res)).toBe("invalid_body");
    }
    expect(keychain.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC4, AC4b and the CLI's declaration
// ---------------------------------------------------------------------------

/** A client that calls the shipped routes directly, recording each request. */
function routeClient(c: GitHubConnector, requests: { method: string; path: string; body: unknown }[] = []): CliApiClient {
  return {
    request: async (method, path, body) => {
      requests.push({ method, path, body });
      const res = await route(githubRoutes(c), method, path).handler({ params: {}, query: {}, body, store: env.store, now: env.now });
      return { status: res.status, body: JSON.parse(JSON.stringify(res.body)) as unknown };
    },
  };
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly requests: { method: string; path: string; body: unknown }[];
}

async function studio(c: GitHubConnector, args: string[], answer: string | undefined, token: string = FINE): Promise<Run> {
  const requests: Run["requests"] = [];
  const out: string[] = [];
  const err: string[] = [];
  const sub = connectorsSubcommand({ readSecret: async () => ({ ok: true, token }), readDeclaration: async () => answer });
  const code = await sub.run(args, routeClient(c, requests), { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } });
  return { code, stdout: out.join(""), stderr: err.join(""), requests };
}

describe("studio connectors github set: the declaration (AC1, AC2, AC4)", () => {
  it.each(["yes", "y", "YES", "Y", "  Yes \n", "yEs"])("the answer %j declares: the body carries declared_read_only: true and the row reads declared", async (answer) => {
    const r = await studio(connector(), ["github", "set"], answer);
    expect(r.code).toBe(0);
    expect(r.requests).toEqual([{ method: "POST", path: "/connectors/github/token", body: { token: FINE, declared_read_only: true } }]);
    expect(r.stdout).toContain("GitHub connected as owner-one");
    expect(r.stdout).toContain("declared by you");
    expect(rowNow()).toMatchObject({ status: "connected", permissions_json: null, permissions_source: "declared", permissions_declared_at: T0 });
    expectNoToken(r.stdout, r.stderr);
  });

  it.each([undefined, "", "no", "n", "yess", "yes please", "true", "1", "ok", "yes yes"])("the answer %j does not declare: the body is {token} alone and the token is refused naming the declaration", async (answer) => {
    const r = await studio(connector(), ["github", "set"], answer);
    expect(r.code).toBe(1);
    expect(r.requests).toEqual([{ method: "POST", path: "/connectors/github/token", body: { token: FINE } }]);
    expect(r.stderr).toContain("token_permissions_unknown");
    expect(r.stderr).toContain("yes at the studio connectors github set prompt");
    expect(keychain.calls).toEqual([]);
    expect(rowNow()?.["status"]).toBe("rejected");
    expectNoToken(r.stdout, r.stderr);
  });

  it("an answer is never echoed", async () => {
    const r = await studio(connector(), ["github", "set"], "SECRET-ANSWER-TEXT");
    expect(r.stdout + r.stderr).not.toContain("SECRET-ANSWER-TEXT");
  });

  it("a declaration reader that throws is no answer: the token is sent alone and refused", async () => {
    const requests: Run["requests"] = [];
    const out: string[] = [];
    const sub = connectorsSubcommand({
      readSecret: async () => ({ ok: true, token: FINE }),
      readDeclaration: async () => {
        throw new Error(`boom ${FINE}`);
      },
    });
    const code = await sub.run(["github", "set"], routeClient(connector(), requests), { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => out.push(s) } });
    expect(code).toBe(1);
    expect(requests[0]?.body).toEqual({ token: FINE });
    expectNoToken(out.join(""));
  });

  it("a reported-read token answered yes still connects as reported (the declaration is consulted only when GitHub reports nothing)", async () => {
    const r = await studio(connector(), ["github", "set"], "yes", CLASSIC);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("declared");
    expect(rowNow()).toMatchObject({ permissions_source: "reported", permissions_declared_at: null });
    expectNoToken(r.stdout, r.stderr);
  });

  it("a write-scoped token answered yes is refused token_write_scoped", async () => {
    const r = await studio(connector(), ["github", "set"], "yes", WRITE);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("token_write_scoped");
    expect(keychain.calls).toEqual([]);
    expectNoToken(r.stdout, r.stderr);
  });

  it.each([["--declared-read-only"], ["--declared-read-only", "yes"], ["yes"], ["--declared-read-only=true"]])(
    "set with the argument(s) %j exits 2, contacts no route, prints no argument and connects nothing",
    async (...args) => {
      let reads = 0;
      const requests: Run["requests"] = [];
      const out: string[] = [];
      const sub = connectorsSubcommand({
        readSecret: async () => {
          reads += 1;
          return { ok: true, token: FINE };
        },
        readDeclaration: async () => {
          reads += 1;
          return "yes";
        },
      });
      const code = await sub.run(["github", "set", ...args], routeClient(connector(), requests), { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => out.push(s) } });
      expect(code).toBe(2);
      expect(requests).toEqual([]);
      expect(reads).toBe(0);
      for (const a of args) expect(out.join("")).not.toContain(a);
      expect(keychain.calls).toEqual([]);
      expect(rowNow()).toBeUndefined();
    },
  );

  it("isDeclaration accepts only yes or y, trimmed, in any case", () => {
    expect(["yes", "y", " YES ", "Y\n"].map(isDeclaration)).toEqual([true, true, true, true]);
    expect([undefined, "", " ", "n", "no", "yes!", "ye", "yes yes", "true"].map(isDeclaration)).toEqual([false, false, false, false, false, false, false, false, false]);
  });

  it("the prompt names the fine-grained token and Read, and asks for yes", () => {
    expect(DECLARATION_PROMPT).toBe("Is this a fine-grained token, and is every permission you gave it Read? Type yes to declare it: ");
  });
});

describe("studio connectors github status for a declared row (AC4b)", () => {
  it("prints 'read-only, declared by the owner at <time>', never '-' and never a checked-by-GitHub wording for the permissions", async () => {
    const c = connector();
    await studio(c, ["github", "set"], "yes");
    const r = await studio(c, ["github", "status"], undefined);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`  permissions: read-only, declared by the owner at ${T0}\n`);
    expect(r.stdout).not.toMatch(/permissions: -/);
    for (const line of r.stdout.split("\n")) {
      if (line.includes("permissions")) expect(line).not.toMatch(/verified|checked|read from GitHub/i);
    }
    expectNoToken(r.stdout);
  });

  it("a reported row lists the reported permissions as before", async () => {
    const c = connector();
    await studio(c, ["github", "set"], undefined, CLASSIC);
    const r = await studio(c, ["github", "status"], undefined);
    expect(r.stdout).toContain("  permissions: metadata: read, contents: read, pull_requests: read\n");
    expect(r.stdout).not.toContain("declared");
  });

  it("formatGitHubStatus: the source decides; a declared row with no time says so with '-'; a null-source row with null permissions prints '-'", () => {
    const base = { kind: "github", status: "connected", account_login: "o", reachable_repos: [] };
    expect(formatGitHubStatus({ ...base, permissions: null, permissions_source: "declared", permissions_declared_at: T0 })).toContain(`  permissions: read-only, declared by the owner at ${T0}\n`);
    expect(formatGitHubStatus({ ...base, permissions: null, permissions_source: "declared", permissions_declared_at: null })).toContain("  permissions: read-only, declared by the owner at -\n");
    expect(formatGitHubStatus({ ...base, permissions: null, permissions_source: null, permissions_declared_at: null })).toContain("  permissions: -\n");
    expect(formatGitHubStatus({ ...base, permissions: { metadata: "read" }, permissions_source: "reported", permissions_declared_at: null })).toContain("  permissions: metadata: read\n");
  });

  it("GitHub text in the declared time is shown safely (no control characters)", () => {
    const text = formatGitHubStatus({ kind: "github", status: "connected", permissions: null, permissions_source: "declared", permissions_declared_at: "x\u001b[31my" });
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/\u001b/);
  });
});
