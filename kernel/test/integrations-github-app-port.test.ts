// The GitHub App port (GitHub App 2, subtask 2: AC1, AC5, AC9, AC10, AC11, AC12
// over the port, the connector row, the routes' view, the events and the rows).
//
// Every test injects a fake Keychain, a fake GitHub (`fetch`) and the clock: none
// reaches the network, the real Keychain or a notifier (a notification is a row;
// delivery is another due work, never run here). Never call the shipped
// `githubAppPort` with valid input here: its default Keychain is the real one.
// The fake GitHub verifies nothing about the JWT but its shape and `iss`
// (`integrations-github-app-token.test.ts` verifies the signature and skew), and
// issues a distinct installation token per mint. Every secret string (the `pem`,
// its encoding, each JWT and each installation token) is a needle on every
// result, row, event, notification and Keychain call.
import { generateKeyPairSync } from "node:crypto";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeychainDeleter, KeychainReader, KeychainWriter } from "../src/auth/keychain.js";
import { daemonKernelDeps } from "../src/daemon-deps.js";
import {
  GITHUB_APP_ID_SERVICE,
  GITHUB_APP_INSTALLATION_SERVICE,
  GITHUB_APP_KEY_SERVICE,
  GITHUB_APP_PERMISSIONS,
  GITHUB_APP_SLUG_SERVICE,
  SESSION_TOKEN_PERMISSIONS,
  createGitHubAppTokens,
  decodeAppKey,
  encodeAppKey,
} from "../src/integrations/github/app-token.js";
import type { GitHubAppTokens } from "../src/integrations/github/app-token.js";
import { createGitHubAppPort, githubAppPort, mintSessionToken } from "../src/integrations/github/app-port.js";
import { GITHUB_KEYCHAIN_SERVICE, createGitHubClient } from "../src/integrations/github/client.js";
import {
  GITHUB_APP_REJECTED_SOURCE,
  GITHUB_KEYCHAIN_ACCOUNT,
  applyGitHubAppMintFailure,
  checkGitHubAppMint,
  createGitHubConnector,
  createResolvingGitHubClient,
  githubConnectorPart,
  githubConnectorRow,
  listConnectors,
} from "../src/integrations/github/connector.js";
import { createGitHubCredentialLock } from "../src/integrations/github/credential-lock.js";
import type { GitHubCredentialLock } from "../src/integrations/github/credential-lock.js";
import { createGitHubAppPort as exportedCreate, githubAppPort as exportedPort } from "../src/integrations/index.js";
import type { GitHubAppConversion, GitHubAppPort, GitHubAppPortResult } from "../src/integrations/index.js";
import { events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { FakeGitHubClient } from "./fixtures/github-fake.js";
import type { FakeGitHubData } from "./fixtures/github-fake.js";

const T0 = "2026-10-30T12:00:00.000Z";
const HOUR = 3_600_000;
const APP_ID = 987654;
const INSTALLATION = 4242;
const SLUG = "studio-reader";
const PAT = "github_pat_11PATPATPAT0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd";

const KEY = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs1", format: "pem" } });
const PEM = KEY.privateKey;
const ENCODED = encodeAppKey(PEM) ?? "";
const READ_ONLY = { metadata: "read", contents: "read", pull_requests: "read" };
/** What a fully upgraded install reports (D39): the whole pinned constant. */
const FULL: Record<string, string> = { ...GITHUB_APP_PERMISSIONS };

const CONVERSION: GitHubAppConversion = {
  app_id: APP_ID,
  slug: SLUG,
  name: "Studio Reader",
  owner_login: "owner-one",
  html_url: `https://github.com/apps/${SLUG}`,
  client_id: "Iv1.0123456789abcdef",
};

/** An in-memory Keychain with the real one's rules: add never overwrites; delete answers whether an item was there. */
class FakeKeychain implements KeychainReader, KeychainWriter, KeychainDeleter {
  readonly items = new Map<string, { account: string; secret: string }>();
  /** Every call, without the secret. */
  readonly calls: string[] = [];
  /** `add` of these services exits "0" but stores nothing (the `security -i` failure mode). */
  readonly silentAddFailure = new Set<string>();
  readonly deleteThrows = new Set<string>();
  readThrows: Error | undefined;

  read(service: string): string | undefined {
    this.calls.push(`read ${service}`);
    if (this.readThrows !== undefined) throw this.readThrows;
    return this.items.get(service)?.secret;
  }

  add(service: string, account: string, secret: string): void {
    this.calls.push(`add ${service} ${account}`);
    if (this.items.has(service)) throw new Error("The specified item already exists in the keychain.");
    if (this.silentAddFailure.has(service)) return;
    this.items.set(service, { account, secret });
  }

  delete(service: string): boolean {
    this.calls.push(`delete ${service}`);
    if (this.deleteThrows.has(service)) throw new Error(`security: could not delete ${service} (${ENCODED})`);
    return this.items.delete(service);
  }

  has(service: string): boolean {
    return this.items.has(service);
  }
}

interface World {
  env: LoopEnv;
  keychain: FakeKeychain;
  tokens: GitHubAppTokens;
  port: GitHubAppPort;
  /** Every request the fake GitHub saw: `METHOD path` and the bearer. */
  calls: Array<{ method: string; path: string; bearer: string }>;
  jwts: string[];
  issued: string[];
  /** Every mint request's body (`undefined` when it sent none) and content type. */
  mintRequests: Array<{ body: string | undefined; contentType: string | null }>;
  /** What a down-scoped mint (one that sends `permissions`) reports; default the requested set plus `metadata: read`. */
  scopedReport: Record<string, string> | undefined;
  /** What the next mints report. */
  permissions: Record<string, string>;
  /** Mints answer this status instead of 201, when set. */
  mintStatus: number | undefined;
  /** `/installation/repositories` answers this status instead of 200, when set. */
  reposStatus: number | undefined;
  /** A mint, or the whole network, throws this. */
  fetchThrows: Error | undefined;
  repos: string[];
  /** Every request waits on this first, when set. */
  hold: Promise<void> | undefined;
  fetch: typeof fetch;
}

let w: World;

function makeWorld(): World {
  const env = loopEnv(T0);
  const keychain = new FakeKeychain();
  const world = {
    env,
    keychain,
    calls: [] as World["calls"],
    jwts: [] as string[],
    issued: [] as string[],
    mintRequests: [] as World["mintRequests"],
    scopedReport: undefined as Record<string, string> | undefined,
    permissions: { ...FULL },
    mintStatus: undefined as number | undefined,
    reposStatus: undefined as number | undefined,
    fetchThrows: undefined as Error | undefined,
    repos: ["owner-one/studio-sandbox", "owner-one/loomwright"],
  } as unknown as World;
  const json = (body: unknown, status: number): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  world.fetch = (async (input: unknown, init?: RequestInit) => {
    if (world.hold !== undefined) await world.hold;
    if (world.fetchThrows !== undefined) throw world.fetchThrows;
    const url = new URL(String(input));
    const bearer = (new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer /, "");
    const method = init?.method ?? "GET";
    world.calls.push({ method, path: url.pathname, bearer });
    const mint = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname);
    if (method === "POST" && mint !== null) {
      world.jwts.push(bearer);
      const sent = typeof init?.body === "string" ? init.body : undefined;
      world.mintRequests.push({ body: sent, contentType: new Headers(init?.headers).get("content-type") });
      const [header, claims, signature] = bearer.split(".");
      const iss = (JSON.parse(Buffer.from(claims ?? "", "base64url").toString("utf8")) as { iss?: string }).iss;
      if (header === undefined || signature === undefined || iss !== String(APP_ID)) return json({ message: "A JSON web token could not be decoded" }, 401);
      if (world.mintStatus !== undefined) return json({ message: "no" }, world.mintStatus);
      if (mint[1] !== String(INSTALLATION)) return json({ message: "Not Found" }, 404);
      const token = `ghs_${String(world.issued.length + 1).padStart(36, "x")}`;
      world.issued.push(token);
      const requested = sent === undefined ? undefined : (JSON.parse(sent) as { permissions?: Record<string, string> }).permissions;
      const reported = requested === undefined ? world.permissions : (world.scopedReport ?? { ...requested, metadata: "read" });
      return json({ token, expires_at: new Date(env.now().getTime() + HOUR).toISOString(), permissions: reported, repository_selection: "selected" }, 201);
    }
    const authorised = world.issued.includes(bearer) || bearer === PAT;
    if (!authorised) return json({ message: "Bad credentials" }, 401);
    if (url.pathname === "/installation/repositories") {
      if (world.reposStatus !== undefined) return json({ message: "no" }, world.reposStatus);
      return json({ total_count: world.repos.length, repositories: world.repos.map((full_name) => ({ full_name, private: true })) }, 200);
    }
    if (url.pathname === "/repos/o/r/pulls") {
      return json([{ number: 1, title: "PR 1", user: { login: "alice" }, draft: false, head: { sha: "sha1", ref: "b1" }, html_url: "https://github.com/o/r/pull/1", updated_at: "2026-10-30T09:00:00Z" }], 200);
    }
    return json({ message: "Not Found" }, 404);
  }) as typeof fetch;
  world.tokens = createGitHubAppTokens({ keychain, fetch: world.fetch, now: env.now });
  world.port = createGitHubAppPort({
    keychain,
    writer: keychain,
    deleter: keychain,
    tokens: world.tokens,
    clientFor: (tokenProvider) => createGitHubClient({ tokenProvider, fetch: world.fetch, now: env.now }),
  });
  return world;
}

beforeEach(() => {
  w = makeWorld();
});

afterEach(() => {
  w.env.cleanup();
});

const store = (): LoopEnv["store"] => w.env.store;
const rowNow = (): Record<string, unknown> | undefined => store().prepare("SELECT * FROM connectors WHERE kind = 'github'").get() as Record<string, unknown> | undefined;
const statusEvents = (): Record<string, unknown>[] => events(store(), "connector_status").map((e) => e.payload);
const notifications = (): { source: string; title: string; body: string }[] =>
  store().prepare("SELECT source, title, body FROM notifications ORDER BY id").all() as { source: string; title: string; body: string }[];

function ok<T>(result: GitHubAppPortResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}: ${result.message}`);
  return result.value;
}

function seedPat(status: "connected" | "rejected" = "connected"): void {
  w.keychain.items.set(GITHUB_KEYCHAIN_SERVICE, { account: GITHUB_KEYCHAIN_ACCOUNT, secret: PAT });
  store()
    .prepare(
      `INSERT INTO connectors (kind, status, account_login, permissions_json, reachable_repos_json, expires_at, verified_at, permissions_source, method, created_at, updated_at)
       VALUES ('github', ?, 'pat-user', ?, ?, ?, ?, 'reported', 'token', ?, ?)`,
    )
    .run(status, JSON.stringify(READ_ONLY), JSON.stringify(["pat-user/repo"]), "2027-01-01T00:00:00.000Z", T0, T0, T0);
}

async function installApp(): Promise<void> {
  ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
  ok(await w.port.recordInstallation(store(), INSTALLATION, w.env.now));
}

/** Every value in every table of the store, as one string. */
function everythingStored(): string {
  const tables = store().prepare<[], string>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all();
  return tables.map((t) => JSON.stringify(store().prepare(`SELECT * FROM ${t}`).all())).join("\n");
}

/** The pem, its encoding (and halves of both), every JWT and every installation token seen so far. */
function secrets(): string[] {
  const body = PEM.split("\n").filter((l) => l !== "" && !l.startsWith("-----"));
  return [PEM, ENCODED, ENCODED.slice(40, 120), body[3] ?? "", ...w.jwts, ...w.jwts.map((j) => j.split(".")[2] ?? ""), ...w.issued].filter((s) => s.length > 10);
}

function expectNoSecret(...values: unknown[]): void {
  const haystacks = [everythingStored(), w.keychain.calls.join("\n"), ...values.map((v) => `${JSON.stringify(v) ?? ""}\n${inspect(v, { depth: 10 })}`)];
  for (const secret of secrets()) for (const h of haystacks) expect(h.includes(secret), "a secret was found").toBe(false);
}

// ---------------------------------------------------------------------------
// The shipped port
// ---------------------------------------------------------------------------

describe("the shipped port", () => {
  it("is frozen, is the one the integrations index exports, and has three methods", () => {
    expect(exportedPort).toBe(githubAppPort);
    expect(exportedCreate).toBe(createGitHubAppPort);
    expect(Object.isFrozen(githubAppPort)).toBe(true);
    expect(Object.keys(githubAppPort).sort()).toEqual(["recordInstallation", "removeApp", "storeApp"]);
    expect(Object.isFrozen(w.port)).toBe(true);
  });

  it("building a port reads, writes and requests nothing", () => {
    createGitHubAppPort({ keychain: w.keychain, writer: w.keychain, deleter: w.keychain, tokens: w.tokens });
    expect(w.keychain.calls).toEqual([]);
    expect(w.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC1: store the App, record the installation
// ---------------------------------------------------------------------------

describe("storeApp (AC1)", () => {
  it("writes the id, slug and encoded key with read-back, creates the row disconnected with its slug, one event", async () => {
    const row = ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    expect(w.keychain.items.get(GITHUB_APP_ID_SERVICE)).toEqual({ account: GITHUB_KEYCHAIN_ACCOUNT, secret: String(APP_ID) });
    expect(w.keychain.items.get(GITHUB_APP_SLUG_SERVICE)?.secret).toBe(SLUG);
    // The key item is the encoding, never the PEM, and it decodes back.
    expect(w.keychain.items.get(GITHUB_APP_KEY_SERVICE)?.secret).toBe(ENCODED);
    expect(decodeAppKey(w.keychain.items.get(GITHUB_APP_KEY_SERVICE)?.secret ?? "")).toBe(PEM);
    expect(w.keychain.has(GITHUB_APP_INSTALLATION_SERVICE)).toBe(false);
    expect(row).toMatchObject({ status: "disconnected", app_slug: SLUG, method: "token", installation_id: null });
    expect(statusEvents()).toEqual([{ connector_id: row.id, kind: "github", status: "disconnected" }]);
    expect(w.calls).toEqual([]);
    expectNoSecret(row);
  });

  it("with a token connected, records the slug and leaves method, status, the PAT item and the permissions as they were", async () => {
    seedPat();
    const before = rowNow();
    const row = ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    expect(row).toMatchObject({ status: "connected", method: "token", app_slug: SLUG });
    expect(w.keychain.items.get(GITHUB_KEYCHAIN_SERVICE)?.secret).toBe(PAT);
    expect({ ...rowNow(), app_slug: null, updated_at: null }).toEqual({ ...before, app_slug: null, updated_at: null });
    // The step-2 signal: one event, the status as it is (no `refused`, no secret), so the setup dialog moves on.
    expect(statusEvents()).toEqual([{ connector_id: row.id, kind: "github", status: "connected" }]);
    expectNoSecret(row, statusEvents());
  });

  it("over an existing row (disconnected), one connector_status event", async () => {
    store()
      .prepare("INSERT INTO connectors (kind, status, method, created_at, updated_at) VALUES ('github', 'disconnected', 'token', ?, ?)")
      .run(T0, T0);
    const before = rowNow();
    const row = ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    expect(row).toMatchObject({ status: "disconnected", method: "token", app_slug: SLUG, installation_id: null });
    expect({ ...rowNow(), app_slug: null, updated_at: null }).toEqual({ ...before, app_slug: null, updated_at: null });
    expect(w.keychain.has(GITHUB_KEYCHAIN_SERVICE)).toBe(false);
    expect(statusEvents()).toEqual([{ connector_id: row.id, kind: "github", status: "disconnected" }]);
    expectNoSecret(row, statusEvents());
  });

  it("a second App replaces the first (delete, then add) and drops the held installation token", async () => {
    await installApp();
    await w.tokens.current();
    const other = { ...CONVERSION, app_id: APP_ID + 1, slug: "other-app" };
    ok(await w.port.storeApp(store(), other, PEM, w.env.now));
    expect(w.keychain.items.get(GITHUB_APP_ID_SERVICE)?.secret).toBe(String(APP_ID + 1));
    expect(w.keychain.items.get(GITHUB_APP_SLUG_SERVICE)?.secret).toBe("other-app");
    expect(rowNow()).toMatchObject({ app_slug: "other-app" });
    const before = w.issued.length;
    await w.tokens.current();
    // The new App's id is in the Keychain, so the next token is minted afresh (this App's id is not the fake's `iss`).
    expect(w.issued.length).toBe(before);
    expect(w.calls.filter((c) => c.method === "POST").length).toBeGreaterThan(1);
  });

  it.each([
    ["a pem that is not PEM-shaped", { ...CONVERSION }, "not a pem"],
    ["an empty pem", { ...CONVERSION }, ""],
    ["a slug the Keychain writer would refuse", { ...CONVERSION, slug: "has space" }, PEM],
    ["a slug starting with a dash", { ...CONVERSION, slug: "-x" }, PEM],
    ["an App id of zero", { ...CONVERSION, app_id: 0 }, PEM],
    ["a fractional App id", { ...CONVERSION, app_id: 1.5 }, PEM],
    ["an App id past the holder's bound", { ...CONVERSION, app_id: 10 ** 16 }, PEM],
  ])("%s is conversion_failed and nothing is written", async (_name, conversion, pem) => {
    const result = await w.port.storeApp(store(), conversion, pem, w.env.now);
    expect(result).toMatchObject({ ok: false, error: "conversion_failed" });
    expect(w.keychain.calls.filter((c) => !c.startsWith("read"))).toEqual([]);
    expect(rowNow()).toBeUndefined();
    expectNoSecret(result);
  });

  it("a write whose read-back does not match (security -i exiting 0 on failure) is conversion_failed, and the partial items are removed", async () => {
    w.keychain.silentAddFailure.add(GITHUB_APP_KEY_SERVICE);
    const result = await w.port.storeApp(store(), CONVERSION, PEM, w.env.now);
    expect(result).toMatchObject({ ok: false, error: "conversion_failed" });
    for (const s of [GITHUB_APP_ID_SERVICE, GITHUB_APP_SLUG_SERVICE, GITHUB_APP_KEY_SERVICE]) expect(w.keychain.has(s)).toBe(false);
    expect(rowNow()).toBeUndefined();
    expectNoSecret(result);
  });

  it("a Keychain that throws (quoting the key) is conversion_failed with a fixed message", async () => {
    const throwing = { ...w.keychain, add: () => void 0 } as unknown as KeychainWriter;
    w.keychain.deleteThrows.add(GITHUB_APP_ID_SERVICE);
    const port = createGitHubAppPort({ keychain: w.keychain, writer: throwing, deleter: w.keychain, tokens: w.tokens });
    const result = await port.storeApp(store(), CONVERSION, PEM, w.env.now);
    expect(result).toMatchObject({ ok: false, error: "conversion_failed" });
    expectNoSecret(result);
  });
});

describe("recordInstallation (AC1)", () => {
  it("mints, reads the reach list, and leaves the row connected as method app with permissions_source reported and only the installed repos", async () => {
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    const row = ok(await w.port.recordInstallation(store(), INSTALLATION, w.env.now));
    expect(row).toMatchObject({
      status: "connected",
      method: "app",
      permissions_source: "reported",
      permissions_declared_at: null,
      app_slug: SLUG,
      installation_id: INSTALLATION,
      account_login: "owner-one",
      expires_at: new Date(Date.parse(T0) + HOUR).toISOString(),
      verified_at: T0,
    });
    expect(JSON.parse(row.permissions_json ?? "null")).toEqual(FULL);
    expect(JSON.parse(row.reachable_repos_json ?? "null")).toEqual(["owner-one/studio-sandbox", "owner-one/loomwright"]);
    expect(w.keychain.items.get(GITHUB_APP_INSTALLATION_SERVICE)?.secret).toBe(String(INSTALLATION));
    // One mint, then the reach list through that token: `/installation/repositories`, never `/user/repos`.
    expect(w.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST /app/installations/${INSTALLATION}/access_tokens`, "GET /installation/repositories"]);
    expect(w.calls[1]?.bearer).toBe(w.issued[0]);
    expect(statusEvents()).toEqual([
      { connector_id: row.id, kind: "github", status: "disconnected" },
      { connector_id: row.id, kind: "github", status: "connected", permissions_source: "reported" },
    ]);
    expectNoSecret(row);
  });

  it("GET /connectors shows method, app_slug, installation_id and the reach list", async () => {
    await installApp();
    const [view] = listConnectors(store());
    expect(view).toMatchObject({
      status: "connected",
      method: "app",
      app_slug: SLUG,
      installation_id: INSTALLATION,
      permissions: FULL,
      permissions_source: "reported",
      reachable_repos: ["owner-one/studio-sandbox", "owner-one/loomwright"],
    });
    expectNoSecret(view);
  });

  it("works for a first-ever connect with no row: the row is created by storeApp and the second step only updates it", async () => {
    await installApp();
    expect(store().prepare("SELECT count(*) FROM connectors").pluck().get()).toBe(1);
  });

  it("an installation with no repositories is connected with an empty reach list and no account", async () => {
    w.repos = [];
    await installApp();
    expect(rowNow()).toMatchObject({ status: "connected", account_login: null, reachable_repos_json: "[]" });
  });

  it("the shown reach list is exactly the installed repos on a re-install: a repo no longer installed is gone", async () => {
    await installApp();
    w.repos = ["owner-one/only-one"];
    ok(await w.port.recordInstallation(store(), INSTALLATION, w.env.now));
    expect(listConnectors(store())[0]?.reachable_repos).toEqual(["owner-one/only-one"]);
  });
});

describe("the port's default token holder", () => {
  it("given only a Keychain (no token holder), the port mints through its own holder over that Keychain, never the process-wide one", async () => {
    // Regression: the default holder was the process-wide one, which reads the real Keychain, even with a reader injected.
    // A holder built from `keychain` alone takes the global fetch, so the fake GitHub stands in for it here.
    vi.stubGlobal("fetch", w.fetch);
    try {
      const port = createGitHubAppPort({
        keychain: w.keychain,
        writer: w.keychain,
        deleter: w.keychain,
        clientFor: (tokenProvider) => createGitHubClient({ tokenProvider, fetch: w.fetch, now: w.env.now }),
      });
      ok(await port.storeApp(store(), CONVERSION, PEM, w.env.now));
      const row = ok(await port.recordInstallation(store(), INSTALLATION, w.env.now));
      expect(row).toMatchObject({ status: "connected", method: "app", installation_id: INSTALLATION });
      expect(w.issued.length).toBeGreaterThanOrEqual(1);
      expect(w.calls.some((c) => c.method === "POST" && c.path === `/app/installations/${INSTALLATION}/access_tokens`)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the credential in use after the port (AC2 wiring)", () => {
  it("with the App connected, the method-resolving client, the daemon's client and the tokens use the installation token", async () => {
    await installApp();
    w.calls.length = 0;
    const client = createResolvingGitHubClient({ keychain: w.keychain, fetch: w.fetch, now: w.env.now }, w.tokens);
    expect((await client.listOpenPulls("o/r", {})).ok).toBe(true);
    // The daemon's client builds its own holder over the same deps; it mints for itself.
    const daemon = daemonKernelDeps({ keychain: w.keychain, fetch: w.fetch, now: w.env.now }).githubClient;
    expect((await daemon?.listOpenPulls("o/r", {}))?.ok).toBe(true);
    const gets = w.calls.filter((c) => c.path === "/repos/o/r/pulls");
    expect(gets).toHaveLength(2);
    expect(gets[0]?.bearer).toBe(w.issued[0]);
    expect(w.issued).toContain(gets[1]?.bearer);
    expect(gets.every((c) => c.bearer !== PAT)).toBe(true);
    expectNoSecret();
  });

  it("with a token stored beside a half-set-up App (storeApp only), the PAT is still the credential", async () => {
    seedPat();
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    const client = createResolvingGitHubClient({ keychain: w.keychain, fetch: w.fetch, now: w.env.now }, w.tokens);
    expect((await client.listOpenPulls("o/r", {})).ok).toBe(true);
    expect(w.calls.at(-1)).toEqual({ method: "GET", path: "/repos/o/r/pulls", bearer: PAT });
  });
});

// ---------------------------------------------------------------------------
// AC5: the App replaces the token
// ---------------------------------------------------------------------------

describe("the App replaces the token (AC5)", () => {
  it("recordInstallation deletes the PAT item last, the row reads method app, and the App is now the credential", async () => {
    seedPat();
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    w.keychain.calls.length = 0;
    const row = ok(await w.port.recordInstallation(store(), INSTALLATION, w.env.now));
    expect(w.keychain.has(GITHUB_KEYCHAIN_SERVICE)).toBe(false);
    expect(w.keychain.calls.filter((c) => c.startsWith("delete")).at(-1)).toBe(`delete ${GITHUB_KEYCHAIN_SERVICE}`);
    expect(row).toMatchObject({ status: "connected", method: "app", account_login: "owner-one" });
    expect(JSON.parse(row.reachable_repos_json ?? "null")).toEqual(["owner-one/studio-sandbox", "owner-one/loomwright"]);
    w.calls.length = 0;
    const client = createResolvingGitHubClient({ keychain: w.keychain, fetch: w.fetch, now: w.env.now }, w.tokens);
    await client.listOpenPulls("o/r", {});
    expect(w.calls.at(-1)?.bearer).toBe(w.issued[0]);
    expect(w.calls.at(-1)?.bearer).not.toBe(PAT);
  });

  it("the PAT item is not deleted when the App is refused (the token stays in use)", async () => {
    seedPat();
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    w.mintStatus = 404;
    const result = await w.port.recordInstallation(store(), INSTALLATION, w.env.now);
    expect(result).toMatchObject({ ok: false, error: "install_failed" });
    expect(w.keychain.items.get(GITHUB_KEYCHAIN_SERVICE)?.secret).toBe(PAT);
    expect(rowNow()).toMatchObject({ status: "connected", method: "token", account_login: "pat-user" });
  });

  it("a PAT item that cannot be deleted keeps the token the credential and answers install_failed, never a connected App row", async () => {
    seedPat();
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    w.keychain.deleteThrows.add(GITHUB_KEYCHAIN_SERVICE);
    const result = await w.port.recordInstallation(store(), INSTALLATION, w.env.now);
    expect(result).toMatchObject({ ok: false, error: "install_failed" });
    expect(rowNow()).toMatchObject({ status: "connected", method: "token" });
    expectNoSecret(result);
  });
});

// ---------------------------------------------------------------------------
// D39: the App may write; short of GITHUB_APP_PERMISSIONS it reads needs_permissions
// ---------------------------------------------------------------------------

describe("a mint reporting write permissions is accepted (D39)", () => {
  const APP_ITEMS = [GITHUB_APP_ID_SERVICE, GITHUB_APP_SLUG_SERVICE, GITHUB_APP_INSTALLATION_SERVICE, GITHUB_APP_KEY_SERVICE];

  it("the whole pinned set connects the App: the Keychain items are kept, the reach list is read, one connected event, no refusal", async () => {
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    const row = ok(await w.port.recordInstallation(store(), INSTALLATION, w.env.now));
    expect(row).toMatchObject({ status: "connected", method: "app", app_slug: SLUG, installation_id: INSTALLATION });
    for (const s of APP_ITEMS) expect(w.keychain.has(s)).toBe(true);
    expect(w.calls.map((c) => c.path)).toContain("/installation/repositories");
    expect(statusEvents().at(-1)).toEqual({ connector_id: row.id, kind: "github", status: "connected", permissions_source: "reported" });
    expect(statusEvents().some((e) => "refused" in e)).toBe(false);
    expect(await w.tokens.current()).toMatchObject({ ok: true, permissions: FULL });
  });

  it("a level above the pinned one (an admin where the constant has write) still counts as holding it", async () => {
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    w.permissions = { ...FULL, repository_projects: "admin", contents: "admin" };
    expect(ok(await w.port.recordInstallation(store(), INSTALLATION, w.env.now))).toMatchObject({ status: "connected" });
  });

  it("a read-only install is recorded needs_permissions: one event, the App's items kept, the reach list read, the PAT replaced", async () => {
    seedPat();
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    w.permissions = { ...READ_ONLY };
    const row = ok(await w.port.recordInstallation(store(), INSTALLATION, w.env.now));
    expect(row).toMatchObject({ status: "needs_permissions", method: "app", app_slug: SLUG, installation_id: INSTALLATION, permissions_source: "reported" });
    expect(JSON.parse(row.permissions_json ?? "null")).toEqual(READ_ONLY);
    for (const s of APP_ITEMS) expect(w.keychain.has(s)).toBe(true);
    expect(w.keychain.has(GITHUB_KEYCHAIN_SERVICE)).toBe(false);
    expect(JSON.parse(row.reachable_repos_json ?? "null")).toEqual(["owner-one/studio-sandbox", "owner-one/loomwright"]);
    expect(statusEvents().filter((e) => e["status"] === "needs_permissions")).toEqual([
      { connector_id: row.id, kind: "github", status: "needs_permissions", permissions_source: "reported" },
    ]);
    expect(listConnectors(store())[0]).toMatchObject({ status: "needs_permissions", method: "app" });
    expectNoSecret(row);
  });

  it.each([
    ["a name missing", () => Object.fromEntries(Object.entries(FULL).filter(([name]) => name !== "workflows"))],
    ["read where the constant has write", () => ({ ...FULL, pull_requests: "read" })],
    ["a level this code does not know where the constant has write", () => ({ ...FULL, contents: "maintain" })],
  ])("%s: needs_permissions", async (_name, permissions) => {
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    w.permissions = permissions();
    expect(ok(await w.port.recordInstallation(store(), INSTALLATION, w.env.now))).toMatchObject({ status: "needs_permissions" });
  });

  it("installing again once GitHub reports the whole set moves needs_permissions to connected", async () => {
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    w.permissions = { ...READ_ONLY };
    expect(ok(await w.port.recordInstallation(store(), INSTALLATION, w.env.now))).toMatchObject({ status: "needs_permissions" });
    w.permissions = { ...FULL };
    expect(ok(await w.port.recordInstallation(store(), INSTALLATION, w.env.now))).toMatchObject({ status: "connected" });
  });

  it("a mint reporting no permissions at all cannot be compared: install_failed, nothing connected", async () => {
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    w.permissions = {};
    const result = await w.port.recordInstallation(store(), INSTALLATION, w.env.now);
    expect(result).toMatchObject({ ok: false, error: "install_failed" });
    expect(rowNow()?.["status"]).toBe("disconnected");
    expect(w.keychain.has(GITHUB_APP_INSTALLATION_SERVICE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Other install failures (AC11)
// ---------------------------------------------------------------------------

describe("recordInstallation failures are typed, never thrown (AC11)", () => {
  it.each([
    ["a mint answered 401 (the key is revoked)", () => void (w.mintStatus = 401)],
    ["a mint answered 404 (no such installation)", () => void (w.mintStatus = 404)],
    ["a mint answered 500", () => void (w.mintStatus = 500)],
    ["a network that throws a message quoting the key", () => void (w.fetchThrows = new Error(`connect failed ${PEM} ${ENCODED}`))],
    ["a reach list GitHub refuses", () => void (w.reposStatus = 403)],
  ])("%s is install_failed; the installation item is removed and the row is not connected", async (_name, arrange) => {
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    arrange();
    const result = await w.port.recordInstallation(store(), INSTALLATION, w.env.now);
    expect(result).toMatchObject({ ok: false, error: "install_failed" });
    expect(w.keychain.has(GITHUB_APP_INSTALLATION_SERVICE)).toBe(false);
    // The App itself stays stored, so the owner can install again.
    expect(w.keychain.has(GITHUB_APP_KEY_SERVICE)).toBe(true);
    expect(rowNow()).toMatchObject({ status: "disconnected", method: null });
    // Nothing was recorded on the holder either: the next due work does not reject an App that never connected.
    expect(w.tokens.lastMintFailure).toBeUndefined();
    expectNoSecret(result);
  });

  it("an installation id that is not a positive whole number is install_failed before any Keychain write", async () => {
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    w.keychain.calls.length = 0;
    for (const id of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10 ** 16, "4242" as unknown as number, null as unknown as number]) {
      expect(await w.port.recordInstallation(store(), id, w.env.now)).toMatchObject({ ok: false, error: "install_failed" });
    }
    expect(w.keychain.calls).toEqual([]);
    expect(w.calls).toEqual([]);
  });

  it("with no App stored it is install_failed and requests nothing", async () => {
    expect(await w.port.recordInstallation(store(), INSTALLATION, w.env.now)).toMatchObject({ ok: false, error: "install_failed" });
    expect(w.calls).toEqual([]);
    expect(w.keychain.calls.filter((c) => !c.startsWith("read"))).toEqual([]);
  });

  it("an installation id whose read-back does not match is install_failed", async () => {
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    w.keychain.silentAddFailure.add(GITHUB_APP_INSTALLATION_SERVICE);
    expect(await w.port.recordInstallation(store(), INSTALLATION, w.env.now)).toMatchObject({ ok: false, error: "install_failed" });
    expect(w.calls).toEqual([]);
  });

  it("a Keychain whose reads throw a message quoting the key is install_failed with a fixed message", async () => {
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    w.keychain.readThrows = new Error(`security said ${PEM} ${ENCODED}`);
    const result = await w.port.recordInstallation(store(), INSTALLATION, w.env.now);
    expect(result).toMatchObject({ ok: false, error: "install_failed" });
    expectNoSecret(result);
  });

  it("a stored key that is not an RSA private key cannot sign: install_failed, and the installation item is removed", async () => {
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    w.keychain.items.set(GITHUB_APP_KEY_SERVICE, { account: GITHUB_KEYCHAIN_ACCOUNT, secret: encodeAppKey("-----BEGIN RSA PRIVATE KEY-----\nstub\n-----END RSA PRIVATE KEY-----\n") ?? "" });
    const result = await w.port.recordInstallation(store(), INSTALLATION, w.env.now);
    expect(result).toMatchObject({ ok: false, error: "install_failed" });
    expect(w.calls).toEqual([]);
    expect(w.keychain.has(GITHUB_APP_INSTALLATION_SERVICE)).toBe(false);
  });

  it("a failed re-install of a connected App row leaves it rejected, never connected without credentials", async () => {
    await installApp();
    w.mintStatus = 404;
    expect(await w.port.recordInstallation(store(), INSTALLATION, w.env.now)).toMatchObject({ ok: false, error: "install_failed" });
    expect(rowNow()).toMatchObject({ status: "rejected", method: "app" });
  });
});

describe("removeApp", () => {
  it("deletes the four App items, drops the held token, nulls the App fields and reads disconnected with one event; again, no new event", async () => {
    await installApp();
    await w.tokens.current();
    const row = ok(await w.port.removeApp(store(), w.env.now));
    expect(row).toMatchObject({ status: "disconnected", app_slug: null, installation_id: null });
    expect([...w.keychain.items.keys()]).toEqual([]);
    expect((await w.tokens.current()).ok).toBe(false);
    expect(statusEvents().map((e) => e["status"])).toEqual(["disconnected", "connected", "disconnected"]);
    ok(await w.port.removeApp(store(), w.env.now));
    expect(statusEvents()).toHaveLength(3);
    expectNoSecret(row);
  });

  it("a token connection is not the App's to end: the PAT item, status and row stay; only the App fields clear", async () => {
    seedPat();
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    const row = ok(await w.port.removeApp(store(), w.env.now));
    expect(row).toMatchObject({ status: "connected", method: "token", app_slug: null, account_login: "pat-user" });
    expect(w.keychain.items.get(GITHUB_KEYCHAIN_SERVICE)?.secret).toBe(PAT);
    expect(w.keychain.has(GITHUB_APP_KEY_SERVICE)).toBe(false);
  });

  it("with no row it creates one disconnected (one event) and removes nothing else", async () => {
    const row = ok(await w.port.removeApp(store(), w.env.now));
    expect(row.status).toBe("disconnected");
    expect(statusEvents()).toHaveLength(1);
  });

  it("an item that cannot be deleted is install_failed and the row is unchanged", async () => {
    await installApp();
    w.keychain.deleteThrows.add(GITHUB_APP_KEY_SERVICE);
    const before = rowNow();
    const result = await w.port.removeApp(store(), w.env.now);
    expect(result).toMatchObject({ ok: false, error: "install_failed" });
    expect(rowNow()).toEqual(before);
    expectNoSecret(result);
  });
});

// ---------------------------------------------------------------------------
// AC10: a revoked key or a gone installation
// ---------------------------------------------------------------------------

describe("a revoked key or an uninstalled App reads rejected, with one notification (AC10)", () => {
  /** The held token has aged to its renewal window, and GitHub now answers the mint with `status`. */
  async function mintFails(status: number): Promise<void> {
    w.env.advance(HOUR - 60_000);
    w.mintStatus = status;
    expect((await w.tokens.current()).ok).toBe(false);
  }

  it.each([401, 404])("a mint answered %i: the due work marks the row rejected and notifies once, on the transition only", async (status) => {
    await installApp();
    await mintFails(status);
    expect(w.tokens.lastMintFailure).toMatchObject({ status });
    expect(rowNow()?.["status"]).toBe("connected");
    applyGitHubAppMintFailure(store(), w.env.now(), w.tokens);
    expect(rowNow()).toMatchObject({ status: "rejected", method: "app" });
    expect(notifications().map((n) => n.source)).toEqual([GITHUB_APP_REJECTED_SOURCE]);
    expect(notifications()[0]?.body).toContain(`HTTP ${status}`);
    expect(statusEvents().at(-1)).toMatchObject({ status: "rejected" });
    // Acted on once: the failure is cleared, and a later tick does nothing.
    expect(w.tokens.lastMintFailure).toBeUndefined();
    applyGitHubAppMintFailure(store(), w.env.now(), w.tokens);
    await mintFails(status);
    applyGitHubAppMintFailure(store(), w.env.now(), w.tokens);
    expect(notifications()).toHaveLength(1);
    expect(statusEvents().filter((e) => e["status"] === "rejected")).toHaveLength(1);
    expectNoSecret(notifications());
  });

  it("a renewal that reports write permissions is no failure: nothing is recorded, the row stays connected, no notification", async () => {
    await installApp();
    w.env.advance(HOUR - 60_000);
    w.permissions = { ...FULL, contents: "admin" };
    expect((await w.tokens.current()).ok).toBe(true);
    expect(w.tokens.lastMintFailure).toBeUndefined();
    applyGitHubAppMintFailure(store(), w.env.now(), w.tokens);
    expect(rowNow()).toMatchObject({ status: "connected", method: "app" });
    expect(notifications()).toEqual([]);
  });

  it("a failure other than 401 or 404 (a 500, the network) does not reject the row", async () => {
    await installApp();
    await mintFails(500);
    expect(w.tokens.lastMintFailure).toBeUndefined();
    applyGitHubAppMintFailure(store(), w.env.now(), w.tokens);
    expect(rowNow()?.["status"]).toBe("connected");
    expect(notifications()).toEqual([]);
  });

  it("a failure on a row that is not an App in use (token, disconnected, already rejected) is cleared and changes nothing", async () => {
    await installApp();
    await mintFails(401);
    store().prepare("UPDATE connectors SET method = 'token'").run();
    applyGitHubAppMintFailure(store(), w.env.now(), w.tokens);
    expect(rowNow()?.["status"]).toBe("connected");
    expect(w.tokens.lastMintFailure).toBeUndefined();
    store().prepare("UPDATE connectors SET method = 'app', status = 'disconnected'").run();
    await mintFails(401);
    applyGitHubAppMintFailure(store(), w.env.now(), w.tokens);
    expect(rowNow()?.["status"]).toBe("disconnected");
    store().prepare("UPDATE connectors SET status = 'rejected'").run();
    await mintFails(401);
    applyGitHubAppMintFailure(store(), w.env.now(), w.tokens);
    expect(notifications()).toEqual([]);
  });

  it("with no row at all the failure is cleared and nothing is recorded", async () => {
    await installApp();
    await mintFails(404);
    store().prepare("DELETE FROM connectors").run();
    applyGitHubAppMintFailure(store(), w.env.now(), w.tokens);
    expect(w.tokens.lastMintFailure).toBeUndefined();
    expect(notifications()).toEqual([]);
  });

  it("the shipped due work is in the connector part, and with nothing recorded on the process-wide holder it does nothing", () => {
    expect(githubConnectorPart.dueWork).toContain(checkGitHubAppMint);
    store().prepare("INSERT INTO connectors (kind, status, method, created_at, updated_at) VALUES ('github', 'connected', 'app', ?, ?)").run(T0, T0);
    checkGitHubAppMint({ store: store(), now: w.env.now });
    expect(githubConnectorRow(store())?.status).toBe("connected");
    expect(notifications()).toEqual([]);
  });

  it("a poll that finds the row rejected no longer counts the connector as connected", async () => {
    await installApp();
    await mintFails(401);
    applyGitHubAppMintFailure(store(), w.env.now(), w.tokens);
    expect(listConnectors(store())[0]).toMatchObject({ status: "rejected", method: "app" });
  });
});

// ---------------------------------------------------------------------------
// D39: mintSessionToken, a down-scoped token for a session
// ---------------------------------------------------------------------------

describe("mintSessionToken (D39)", () => {
  const REPO = "vikashruhilgit/studio-sandbox";
  const rows = (): Record<string, unknown>[] => store().prepare("SELECT * FROM connectors").all() as Record<string, unknown>[];
  const mint = (repos: readonly string[]): ReturnType<typeof mintSessionToken> => mintSessionToken(store(), repos, { tokens: w.tokens });

  /** An installed App whose account owns the sandbox repo. */
  async function installForSandbox(): Promise<void> {
    w.repos = [REPO, "vikashruhilgit/loomwright"];
    await installApp();
    w.calls.length = 0;
    w.mintRequests.length = 0;
  }

  it("is exported by name with the frozen session permissions (Pin: the mint body carries exactly these four)", () => {
    expect(SESSION_TOKEN_PERMISSIONS).toEqual({ pull_requests: "write", contents: "write", issues: "write", checks: "write" });
    expect(Object.isFrozen(SESSION_TOKEN_PERMISSIONS)).toBe(true);
  });

  it("sends one mint carrying exactly SESSION_TOKEN_PERMISSIONS and the one repo's name, and answers {ok, token, expires_at}", async () => {
    await installForSandbox();
    const result = await mint([REPO]);
    expect(w.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST /app/installations/${INSTALLATION}/access_tokens`]);
    expect(w.mintRequests).toHaveLength(1);
    expect(w.mintRequests[0]?.contentType).toBe("application/json");
    expect(JSON.parse(w.mintRequests[0]?.body ?? "null")).toEqual({
      permissions: { pull_requests: "write", contents: "write", issues: "write", checks: "write" },
      repositories: ["studio-sandbox"],
    });
    expect(Object.keys(JSON.parse(w.mintRequests[0]?.body ?? "{}") as object).sort()).toEqual(["permissions", "repositories"]);
    expect(result).toEqual({ ok: true, token: w.issued.at(-1), expires_at: new Date(w.env.now().getTime() + HOUR).toISOString() });
    // The bearer was the App's JWT, not a held installation token.
    expect(w.calls[0]?.bearer).toBe(w.jwts.at(-1));
  });

  it("the token is in no events, connectors or notifications row, in no console output, and is never held by the holder", async () => {
    await installForSandbox();
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const result = await mint([REPO]);
      if (!result.ok) throw new Error("expected a token");
      const token = result.token;
      const tables = ["events", "connectors", "notifications"] as const;
      for (const t of tables) expect(JSON.stringify(store().prepare(`SELECT * FROM ${t}`).all()).includes(token), `${t} holds the token`).toBe(false);
      expect(everythingStored().includes(token)).toBe(false);
      expect(w.keychain.calls.join("\n").includes(token)).toBe(false);
      for (const spy of [...spies, out, err]) expect(spy).not.toHaveBeenCalled();
      // Not cached: the holder's own token is another mint, and its reported permissions are the App's, not the session's.
      expect(w.tokens.lastReportedPermissions).toEqual(FULL);
      const own = await w.tokens.current();
      expect(own.ok && own.token).not.toBe(token);
    } finally {
      for (const spy of [...spies, out, err]) spy.mockRestore();
    }
  });

  it("matches the repo case-insensitively and sends the name as the reach list spells it; a repeated repo is sent once", async () => {
    await installForSandbox();
    const result = await mint(["VikashRuhilGit/Studio-Sandbox", REPO, "vikashruhilgit/loomwright"]);
    expect(result.ok).toBe(true);
    expect(JSON.parse(w.mintRequests[0]?.body ?? "null").repositories).toEqual(["studio-sandbox", "loomwright"]);
  });

  it.each([
    ["a repo the installation does not list", ["vikashruhilgit/not-installed"]],
    ["one listed and one not", [REPO, "vikashruhilgit/not-installed"]],
    ["an owner other than the installation's account", ["someone-else/studio-sandbox"]],
    ["no repo at all (an unscoped mint would reach every repo)", []],
    ["a name that is not owner/name", ["studio-sandbox"]],
    ["a name with extra segments", ["vikashruhilgit/studio-sandbox/x"]],
    ["a name that is not a string", [5 as unknown as string]],
  ])("%s: repo_not_reached, no request sent", async (_name, repos) => {
    await installForSandbox();
    expect(await mint(repos)).toEqual({ ok: false, error: "repo_not_reached" });
    expect(w.calls).toEqual([]);
  });

  it("a row with no account reaches nothing, and more than 100 repos are refused before any lookup", async () => {
    await installForSandbox();
    store().prepare("UPDATE connectors SET account_login = NULL").run();
    expect(await mint([REPO])).toEqual({ ok: false, error: "repo_not_reached" });
    store().prepare("UPDATE connectors SET account_login = 'vikashruhilgit'").run();
    const many = Array.from({ length: 101 }, (_, i) => `vikashruhilgit/r${i}`);
    expect(await mint(many)).toEqual({ ok: false, error: "repo_not_reached" });
    expect(await mintSessionToken(store(), "vikashruhilgit/studio-sandbox" as unknown as string[], { tokens: w.tokens })).toEqual({ ok: false, error: "repo_not_reached" });
    expect(w.calls).toEqual([]);
  });

  it("a row with no reach list reaches nothing: repo_not_reached", async () => {
    await installForSandbox();
    store().prepare("UPDATE connectors SET reachable_repos_json = NULL").run();
    expect(await mint([REPO])).toEqual({ ok: false, error: "repo_not_reached" });
    expect(w.calls).toEqual([]);
  });

  it.each([
    ["read where a session permission needs write", () => ({ ...FULL, checks: "read" })],
    ["a session permission missing", () => Object.fromEntries(Object.entries(FULL).filter(([name]) => name !== "issues"))],
    ["a read-only install", () => ({ ...READ_ONLY })],
  ])("%s: needs_permissions, no request sent", async (_name, permissions) => {
    w.permissions = permissions();
    await installForSandbox();
    expect(await mint([REPO])).toEqual({ ok: false, error: "needs_permissions" });
    expect(w.calls).toEqual([]);
  });

  it("a session mint needs only the four session permissions on the row, not the whole App set", async () => {
    w.permissions = { metadata: "read", pull_requests: "write", contents: "write", issues: "write", checks: "write" };
    await installForSandbox();
    expect(rowNow()?.["status"]).toBe("needs_permissions");
    expect((await mint([REPO])).ok).toBe(true);
  });

  it("a row without reported permissions is needs_permissions", async () => {
    await installForSandbox();
    store().prepare("UPDATE connectors SET permissions_json = NULL").run();
    expect(await mint([REPO])).toEqual({ ok: false, error: "needs_permissions" });
    expect(w.calls).toEqual([]);
  });

  it.each([
    ["no connector row", () => store().prepare("DELETE FROM connectors").run()],
    ["a token connection", () => store().prepare("UPDATE connectors SET method = 'token'").run()],
    ["a rejected App", () => store().prepare("UPDATE connectors SET status = 'rejected'").run()],
    ["a disconnected App", () => store().prepare("UPDATE connectors SET status = 'disconnected'").run()],
  ])("%s: no_credentials, no request sent", async (_name, change) => {
    await installForSandbox();
    change();
    expect(await mint([REPO])).toEqual({ ok: false, error: "no_credentials" });
    expect(w.calls).toEqual([]);
  });

  it("a down-scoped token that comes back reporting more than the session permissions is refused and not returned", async () => {
    await installForSandbox();
    w.scopedReport = { ...FULL };
    const result = await mint([REPO]);
    expect(result).toEqual({ ok: false, error: "scope_exceeded" });
    expect(JSON.stringify(result).includes(w.issued.at(-1) ?? "none")).toBe(false);
  });

  it("GitHub's implicit metadata: read is not an excess", async () => {
    await installForSandbox();
    w.scopedReport = { ...SESSION_TOKEN_PERMISSIONS, metadata: "read" };
    expect((await mint([REPO])).ok).toBe(true);
  });

  it("GitHub answering an error is a typed failure with its status; a network failure is unreachable; neither throws", async () => {
    await installForSandbox();
    w.mintStatus = 422;
    expect(await mint([REPO])).toEqual({ ok: false, error: "http_error", status: 422 });
    w.mintStatus = undefined;
    w.fetchThrows = new Error(`connect ECONNREFUSED ${ENCODED}`);
    const result = await mint([REPO]);
    expect(result).toEqual({ ok: false, error: "unreachable" });
    expectNoSecret(result);
  });

  it("a mint failing 401 or 404 does not mark the row rejected (only the holder's own mint does)", async () => {
    await installForSandbox();
    w.mintStatus = 404;
    await mint([REPO]);
    expect(w.tokens.lastMintFailure).toBeUndefined();
    expect(rows()[0]).toMatchObject({ status: "connected" });
  });

  it("with the App's Keychain items gone, it is no_credentials (a fixed value, no secret)", async () => {
    await installForSandbox();
    w.keychain.items.delete(GITHUB_APP_KEY_SERVICE);
    const result = await mint([REPO]);
    expect(result).toEqual({ ok: false, error: "no_credentials" });
    expect(w.calls).toEqual([]);
  });

  it("runs on the shared credential lock, and a store that throws is a closed failure, not a rejection", async () => {
    await installForSandbox();
    const run = vi.fn(<T>(fn: () => Promise<T>) => fn());
    const lock: GitHubCredentialLock = { run: run as GitHubCredentialLock["run"] };
    expect((await mintSessionToken(store(), [REPO], { tokens: w.tokens, lock })).ok).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    const broken = { prepare: () => { throw new Error("db down"); } } as unknown as Parameters<typeof mintSessionToken>[0];
    expect(await mintSessionToken(broken, [REPO], { tokens: w.tokens, lock })).toEqual({ ok: false, error: "unreachable" });
  });

  it("given only a Keychain (no holder), it mints through a holder over that Keychain", async () => {
    await installForSandbox();
    vi.stubGlobal("fetch", w.fetch);
    try {
      expect((await mintSessionToken(store(), [REPO], { keychain: w.keychain })).ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// AC11: never throws, whatever it is given
// ---------------------------------------------------------------------------

describe("never throws or rejects, whatever it is given (AC11)", () => {
  const WEIRD: unknown[][] = [
    [],
    [undefined],
    [null, null, null, null],
    [{}, "x", 1, "y"],
    [NaN, -1, Symbol("s")],
    [{ prepare: () => { throw new Error(`boom ${ENCODED}`); } }, CONVERSION, PEM, () => new Date(T0)],
    [{ prepare: () => { throw new Error(`boom ${ENCODED}`); } }, INSTALLATION, () => new Date(T0)],
    ["store", CONVERSION, PEM, () => new Date(Number.NaN)],
    ["store", INSTALLATION, () => new Date(Number.NaN)],
  ];

  for (const [method, code] of [
    ["storeApp", "conversion_failed"],
    ["recordInstallation", "install_failed"],
    ["removeApp", "install_failed"],
  ] as const) {
    it(`${method} resolves a typed failure for every odd input, with no Keychain write and no request`, async () => {
      const port = w.port as unknown as Record<string, (...args: unknown[]) => Promise<GitHubAppPortResult<unknown>>>;
      for (const args of WEIRD) {
        const result = await (port[method]?.(...args) as Promise<GitHubAppPortResult<unknown>>);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe(code);
          expect(result.message).not.toBe("");
          expectNoSecret(result);
        }
      }
      expect(w.keychain.calls.filter((c) => !c.startsWith("read"))).toEqual([]);
      expect(w.calls).toEqual([]);
    });
  }

  it("a store that fails mid-way after the Keychain steps still answers a typed failure", async () => {
    const real = store();
    const failing = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "transaction") return () => { throw new Error(`database said ${ENCODED}`); };
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    const result = await w.port.storeApp(failing, CONVERSION, PEM, w.env.now);
    expect(result).toMatchObject({ ok: false, error: "conversion_failed" });
    expectNoSecret(result);
  });

  it("calls are serialised: two concurrent installations settle in order, the second seeing the first's items", async () => {
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    const [a, b] = await Promise.all([w.port.recordInstallation(store(), INSTALLATION, w.env.now), w.port.removeApp(store(), w.env.now)]);
    expect(a.ok && b.ok).toBe(true);
    expect([...w.keychain.items.keys()]).toEqual([]);
    expect(rowNow()).toMatchObject({ status: "disconnected", app_slug: null, installation_id: null });
  });
});

// ---------------------------------------------------------------------------
// One queue for the token and App paths
// ---------------------------------------------------------------------------

/** A fake client whose `getTokenInfo` waits on `gate` first. */
class GatedClient extends FakeGitHubClient {
  readonly #gate: Promise<void>;

  constructor(data: FakeGitHubData, gate: Promise<void>) {
    super(data);
    this.#gate = gate;
  }

  override async getTokenInfo(): ReturnType<FakeGitHubClient["getTokenInfo"]> {
    await this.#gate;
    return super.getTokenInfo();
  }
}

describe("the token connector and the App port share one queue", () => {
  const PAT_DATA: FakeGitHubData = { tokenInfo: { login: "pat-user", expires_at: null, permissions: { ...READ_ONLY } }, repos: [{ full_name: "pat-user/repo", private: true }] };
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));
  /** Every Keychain write or delete after the first `from` calls. */
  const writesAfter = (from: number): string[] => w.keychain.calls.slice(from).filter((c) => !c.startsWith("read"));
  const APP_DELETES = [GITHUB_APP_ID_SERVICE, GITHUB_APP_SLUG_SERVICE, GITHUB_APP_INSTALLATION_SERVICE, GITHUB_APP_KEY_SERVICE].map((s) => `delete ${s}`);
  const SET_WRITES = [`delete ${GITHUB_KEYCHAIN_SERVICE}`, `add ${GITHUB_KEYCHAIN_SERVICE} ${GITHUB_KEYCHAIN_ACCOUNT}`, ...APP_DELETES];

  /** A connector and a port over the world's Keychain and holder, on `connectorLock` and `portLock` (each the default when absent); the connector's validation waits on `gate`. */
  function paths(gate: Promise<void>, connectorLock?: GitHubCredentialLock, portLock?: GitHubCredentialLock) {
    const connector = createGitHubConnector({
      keychain: w.keychain,
      writer: w.keychain,
      deleter: w.keychain,
      tokens: w.tokens,
      ...(connectorLock !== undefined ? { lock: connectorLock } : {}),
      clientFor: () => new GatedClient(PAT_DATA, gate),
    });
    const port = createGitHubAppPort({
      keychain: w.keychain,
      writer: w.keychain,
      deleter: w.keychain,
      tokens: w.tokens,
      ...(portLock !== undefined ? { lock: portLock } : {}),
      clientFor: (tokenProvider) => createGitHubClient({ tokenProvider, fetch: w.fetch, now: w.env.now }),
    });
    return { connector, port };
  }

  it("by default (the process-wide queue), a token set started first holds back an App removal until it settles: their Keychain steps never interleave", async () => {
    await installApp();
    let release = (): void => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { connector, port } = paths(gate);
    const from = w.keychain.calls.length;
    const set = connector.setToken(store(), PAT, w.env.now);
    const removal = port.removeApp(store(), w.env.now);
    await tick();
    // The set is waiting on GitHub; the removal has not touched the Keychain.
    expect(writesAfter(from)).toEqual([]);
    release();
    const [a, b] = await Promise.all([set, removal]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(writesAfter(from)).toEqual([...SET_WRITES, ...APP_DELETES]);
    expect(w.keychain.items.get(GITHUB_KEYCHAIN_SERVICE)?.secret).toBe(PAT);
    expect(rowNow()).toMatchObject({ status: "connected", method: "token", app_slug: null, installation_id: null });
  });

  it("the control: on two separate queues the removal runs while the set waits (what the shared queue prevents)", async () => {
    await installApp();
    let release = (): void => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { connector, port } = paths(gate, createGitHubCredentialLock(), createGitHubCredentialLock());
    const from = w.keychain.calls.length;
    const set = connector.setToken(store(), PAT, w.env.now);
    const removal = port.removeApp(store(), w.env.now);
    await tick();
    expect(writesAfter(from)).toEqual(APP_DELETES);
    release();
    await Promise.all([set, removal]);
  });

  it("an App installation started first holds back a token set: the set lands after it, so the token is current", async () => {
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    const lock = createGitHubCredentialLock();
    const { connector, port } = paths(Promise.resolve(), lock, lock);
    let release = (): void => undefined;
    w.hold = new Promise<void>((r) => (release = r));
    const from = w.keychain.calls.length;
    const install = port.recordInstallation(store(), INSTALLATION, w.env.now);
    const set = connector.setToken(store(), PAT, w.env.now);
    await tick();
    // The installation is waiting on its mint; the set has not touched the Keychain.
    expect(writesAfter(from)).toEqual([`delete ${GITHUB_APP_INSTALLATION_SERVICE}`, `add ${GITHUB_APP_INSTALLATION_SERVICE} ${GITHUB_KEYCHAIN_ACCOUNT}`]);
    release();
    w.hold = undefined;
    const [a, b] = await Promise.all([install, set]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(writesAfter(from)).toEqual([
      `delete ${GITHUB_APP_INSTALLATION_SERVICE}`,
      `add ${GITHUB_APP_INSTALLATION_SERVICE} ${GITHUB_KEYCHAIN_ACCOUNT}`,
      `delete ${GITHUB_KEYCHAIN_SERVICE}`,
      ...SET_WRITES,
    ]);
    expect([...w.keychain.items.keys()]).toEqual([GITHUB_KEYCHAIN_SERVICE]);
    expect(rowNow()).toMatchObject({ status: "connected", method: "token", app_slug: null, installation_id: null });
  });

  it("a call that throws or rejects never wedges the queue: the next one still runs, in order", async () => {
    const lock = createGitHubCredentialLock();
    const order: string[] = [];
    const first = lock.run(async () => {
      order.push("first");
      throw new Error("boom");
    });
    const second = lock.run(() => {
      order.push("second");
      return Promise.reject(new Error("again"));
    });
    const third = lock.run(async () => {
      order.push("third");
      return 3;
    });
    await expect(first).rejects.toThrow("boom");
    await expect(second).rejects.toThrow("again");
    await expect(third).resolves.toBe(3);
    expect(order).toEqual(["first", "second", "third"]);
  });
});

// ---------------------------------------------------------------------------
// AC12: no secret anywhere
// ---------------------------------------------------------------------------

describe("no secret on any path (AC12)", () => {
  it("the pem, its encoding, every JWT and every installation token are absent from every result, row, event, notification and Keychain call on a full lifecycle", async () => {
    const results: unknown[] = [];
    results.push(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    results.push(await w.port.recordInstallation(store(), INSTALLATION, w.env.now));
    results.push(listConnectors(store()));
    w.env.advance(HOUR - 60_000);
    // The holder hands its token to the client by design: it is the one result that may carry one.
    await w.tokens.current();
    w.mintStatus = 401;
    w.env.advance(HOUR);
    results.push({ ...(await w.tokens.current()), token: undefined });
    applyGitHubAppMintFailure(store(), w.env.now(), w.tokens);
    results.push(await w.port.removeApp(store(), w.env.now));
    expect(w.jwts.length).toBeGreaterThan(1);
    expect(w.issued.length).toBeGreaterThan(1);
    // The needles are real: each JWT has three segments and each token is the fake's.
    expect(secrets().length).toBeGreaterThan(8);
    expectNoSecret(results, events(store()), notifications());
    // The Keychain item is the only place the key exists, and only as the encoding.
    expect(w.keychain.calls.every((c) => !c.includes(ENCODED))).toBe(true);
  });

  it("the pem alone is stored once, encoded: no Keychain item holds the PEM text", async () => {
    ok(await w.port.storeApp(store(), CONVERSION, PEM, w.env.now));
    for (const { secret } of w.keychain.items.values()) expect(secret.includes("BEGIN")).toBe(false);
  });
});
