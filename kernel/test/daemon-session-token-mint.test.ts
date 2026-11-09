// Phase 8 item 15: the session token minter the shipped kernel wires. `daemonKernelDeps`
// builds a `SessionTokenMint` over the kernel's own store (`mintSessionToken`), `startKernel`
// hands it to the session manager, and a composition without it stays fail closed (`no_minter`).
//
// Driven through the real `startKernel` over the fake spawner/query (session-fakes.ts), a fake
// Keychain holding a stored GitHub App and a fake GitHub (`fetch`): no network, no real
// Keychain, never the real SDK. The App is stored and installed through the port, as the setup
// flow does, so the connector row is exactly what `mintSessionToken` reads.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentSettingsPath } from "../src/agents/index.js";
import { KeychainError } from "../src/auth/index.js";
import type { AuthProvider, KeychainDeleter, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { daemonKernelDeps, daemonSessionTokenMint, toSessionTokenMintResult } from "../src/daemon-deps.js";
import { GITHUB_APP_PERMISSIONS, SESSION_TOKEN_PERMISSIONS, createGitHubAppTokens } from "../src/integrations/github/app-token.js";
import { createGitHubAppPort } from "../src/integrations/github/app-port.js";
import type { GitHubSessionTokenError } from "../src/integrations/github/app-port.js";
import { createGitHubClient } from "../src/integrations/github/client.js";
import { githubConnectorRow } from "../src/integrations/github/connector.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel, KernelDeps } from "../src/kernel.js";
import { SessionError } from "../src/sessions/index.js";
import type { SessionTokenMint } from "../src/sessions/github-session-auth.js";
import type { ToolPolicy } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { events } from "./loop-helpers.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

const NOW = new Date("2026-11-09T10:00:00.000Z");
const HOUR = 3_600_000;
const APP_ID = 987654;
const INSTALLATION = 4242;
const REACHED = ["o/r", "o/other"];
const LIVE_POLICY: ToolPolicy = { allowedTools: [], allowedBashPrefixes: ["gh", "git push"] };
const AGENT_BASE = { model: "claude-haiku-4-5", permission_mode: "default", tool_policy: { allowedTools: [], allowedBashPrefixes: [] } };

const KEY = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs1", format: "pem" } });
const PEM = KEY.privateKey;

let tmp: string;
let dataDir: string;
let pluginDir: string;
const kernels: Kernel[] = [];
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-daemon-mint-"));
  dataDir = join(tmp, "data");
  pluginDir = makePluginDir(tmp);
});

afterEach(async () => {
  for (const k of kernels.splice(0)) await k.stop();
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** An in-memory Keychain with the real one's rules (add never overwrites); `reads` records every service read. */
class FakeKeychain implements KeychainReader, KeychainWriter, KeychainDeleter {
  readonly items = new Map<string, string>();
  readonly reads: string[] = [];

  read(service: string): string | undefined {
    this.reads.push(service);
    return this.items.get(service);
  }

  add(service: string, _account: string, secret: string): void {
    if (this.items.has(service)) throw new KeychainError(service, 45, null, "write");
    this.items.set(service, secret);
  }

  delete(service: string): boolean {
    return this.items.delete(service);
  }
}

/** A fake GitHub: App installation `INSTALLATION`, reaching `REACHED`, issuing a distinct token per mint. */
function fakeGitHub() {
  const requests: { method: string; path: string; body: string | undefined }[] = [];
  const issued: string[] = [];
  const state = { mintStatus: undefined as number | undefined };
  const json = (body: unknown, status: number): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const bearer = (new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer /, "");
    const body = typeof init?.body === "string" ? init.body : undefined;
    requests.push({ method, path: url.pathname, body });
    const mint = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname);
    if (method === "POST" && mint !== null) {
      const claims = bearer.split(".")[1] ?? "";
      const iss = (JSON.parse(Buffer.from(claims, "base64url").toString("utf8")) as { iss?: string }).iss;
      if (iss !== String(APP_ID)) return json({ message: "A JSON web token could not be decoded" }, 401);
      if (state.mintStatus !== undefined) return json({ message: "no" }, state.mintStatus);
      if (mint[1] !== String(INSTALLATION)) return json({ message: "Not Found" }, 404);
      const token = `ghs_${String(issued.length + 1).padStart(36, "x")}`;
      issued.push(token);
      const requested = body === undefined ? undefined : (JSON.parse(body) as { permissions?: Record<string, string> }).permissions;
      // An unscoped mint (the install's own) reports the whole App; a scoped one exactly what was asked, plus GitHub's implicit metadata.
      const permissions = requested === undefined ? { ...GITHUB_APP_PERMISSIONS } : { ...requested, metadata: "read" };
      return json({ token, expires_at: new Date(NOW.getTime() + HOUR).toISOString(), permissions, repository_selection: "selected" }, 201);
    }
    if (!issued.includes(bearer)) return json({ message: "Bad credentials" }, 401);
    if (url.pathname === "/installation/repositories") {
      return json({ total_count: REACHED.length, repositories: REACHED.map((full_name) => ({ full_name, private: true })) }, 200);
    }
    return json({ message: "Not Found" }, 404);
  }) as typeof fetch;
  /** The access-token POSTs seen so far. */
  const mints = () => requests.filter((r) => r.method === "POST" && /\/access_tokens$/.test(r.path));
  return { fetch: fetchFn, requests, issued, state, mints };
}

type Github = ReturnType<typeof fakeGitHub>;

function agentSettings(agent: string, content: unknown): void {
  const file = agentSettingsPath(dataDir, agent);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(content));
}

interface RigOptions {
  /** Whether the kernel gets the daemon's deps (over the fake Keychain and GitHub). */
  readonly daemon: boolean;
  /** The App the Keychain holds and the connector row records: stored and installed through the port ("app"), a PAT row ("token") or no row at all (default). */
  readonly connector?: "app" | "token" | "none";
  readonly sessions?: Record<string, unknown>;
}

/** A started kernel over the fakes, and what the test needs to drive a live, write-granted playbook session. */
async function rig(o: RigOptions) {
  const github = fakeGitHub();
  const appKeychain = new FakeKeychain();
  const apiKeychain = new FakeKeychain();
  const fakes = fakeSessions();
  const daemon = o.daemon ? daemonKernelDeps({ keychain: appKeychain, fetch: github.fetch, now: () => NOW }) : {};
  const d: KernelDeps = {
    ...daemon,
    keychain: apiKeychain,
    keychainWriter: apiKeychain,
    sessionDeps: fakes.deps,
    selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
    availableProviderIds: async () => ["api-key"],
  };
  const sessionOptions = { loomwrightPath: pluginDir, stopGraceMs: 10, ...o.sessions };
  agentSettings("mason", { ...AGENT_BASE, connectors: { github: "write" } });
  // No shipped contribution: nothing but the session manager and the store is under test.
  const kernel = await startKernel({ dataDir, env: { PATH: "/usr/bin" }, sessions: sessionOptions, contributions: [] }, d);
  kernels.push(kernel);
  const store = kernel.store;

  if (o.connector === "app") {
    // The setup flow's two steps over the port (its own holder, over the same fakes).
    const port = createGitHubAppPort({
      keychain: appKeychain,
      writer: appKeychain,
      deleter: appKeychain,
      tokens: createGitHubAppTokens({ keychain: appKeychain, fetch: github.fetch, now: () => NOW }),
      clientFor: (tokenProvider) => createGitHubClient({ tokenProvider, fetch: github.fetch, now: () => NOW }),
    });
    const conversion = { app_id: APP_ID, slug: "studio-writer", name: "Studio Writer", owner_login: "o", html_url: "https://github.com/apps/studio-writer", client_id: "Iv1.0123456789abcdef" };
    const stored = await port.storeApp(store, conversion, PEM, () => NOW);
    if (!stored.ok) throw new Error(`storeApp: ${stored.error}`);
    const installed = await port.recordInstallation(store, INSTALLATION, () => NOW);
    if (!installed.ok) throw new Error(`recordInstallation: ${installed.error}`);
    expect(githubConnectorRow(store)).toMatchObject({ method: "app", status: "connected" });
  } else if (o.connector === "token") {
    const at = NOW.toISOString();
    store
      .prepare(
        `INSERT INTO connectors (kind, status, account_login, permissions_json, reachable_repos_json, method, created_at, updated_at)
         VALUES ('github', 'connected', 'o', ?, ?, 'token', ?, ?)`,
      )
      .run(JSON.stringify(SESSION_TOKEN_PERMISSIONS), JSON.stringify(REACHED), at, at);
  }
  // What the install itself asked of GitHub is not the session's: count from here.
  github.requests.length = 0;

  /** A live playbook of agent mason whose linked poll trigger names `repos`. */
  const playbook = (repos: readonly string[]): number => {
    const slug = "ship";
    const id = Number(
      store.prepare("INSERT INTO playbooks (slug, name, owning_agent, intent, version, mode) VALUES (?, ?, 'mason', 'Ship', 1, 'live')").run(slug, slug).lastInsertRowid,
    );
    const spec = JSON.stringify({ source: "github.pulls", repos, filters: {}, interval_seconds: 300 });
    store
      .prepare("INSERT INTO triggers (owning_agent, playbook, kind, spec_json, action, action_payload, created_by) VALUES ('mason', ?, 'poll', ?, 'wake_agent', '{}', 'owner')")
      .run(slug, spec);
    return id;
  };
  const start = (pb: number) => kernel.sessions.startSession(startParams(tmp, { agent: "mason", policy: LIVE_POLICY, playbook: pb, playbookVersion: 1 }));
  const dirOf = (id: number) => join(dataDir, "session-github", `session-${id}`);
  return { kernel, store, github, appKeychain, fakes, playbook, start, dirOf };
}

type Rig = Awaited<ReturnType<typeof rig>>;

/** The refusal `start(pb)` ends in: the error, and the one `session_refused` event it recorded. */
async function refusal(r: Rig, pb: number): Promise<{ readonly err: SessionError; readonly payload: Record<string, unknown> }> {
  const err: unknown = await r.start(pb).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SessionError);
  expect((err as SessionError).code).toBe("github_token_unavailable");
  const refused = events(r.store, "session_refused");
  expect(refused).toHaveLength(1);
  return { err: err as SessionError, payload: refused[0]?.payload ?? {} };
}

/** A refused start left nothing: no row, no spawn, no token directory. */
function expectNothingStarted(r: Rig): void {
  expect(r.store.prepare("SELECT count(*) FROM sessions").pluck().get()).toBe(0);
  expect(r.fakes.calls).toHaveLength(0);
  expect(existsSync(join(dataDir, "session-github"))).toBe(false);
}

/** Every event payload and refusal detail in the store, as one string, plus the secrets that must not be in it. */
function expectNoSecretStored(r: Rig): void {
  const stored = JSON.stringify(events(r.store));
  for (const secret of [...r.github.issued, PEM]) expect(stored.includes(secret), "a secret was found in an event").toBe(false);
}

describe("the daemon's deps mint a live session's GitHub token (AC1)", () => {
  it("a qualifying session gets its token directory, no refusal, and the fake sees exactly one scoped mint naming the repo", async () => {
    const r = await rig({ daemon: true, connector: "app" });
    const handle = await r.start(r.playbook(["o/r"]));
    const dir = r.dirOf(handle.id);

    expect(existsSync(dir)).toBe(true);
    expect(readFileSync(join(dir, "token"), "utf8")).toMatch(/^ghs_x+\d+$/);
    expect(readFileSync(join(dir, "gh", "hosts.yml"), "utf8")).toContain("oauth_token: ghs_");
    expect(events(r.store, "session_refused")).toEqual([]);

    const mints = r.github.mints();
    expect(mints).toHaveLength(1);
    expect(JSON.parse(mints[0]?.body ?? "null")).toEqual({ repositories: ["r"], permissions: { ...SESSION_TOKEN_PERMISSIONS } });
    // The token is in the two files and nowhere else.
    expectNoSecretStored(r);
  });
});

describe("a mint that fails refuses the start with a fixed, token-free reason (AC2)", () => {
  for (const connector of ["none", "token"] as const) {
    it(`(a) no App in use (${connector === "none" ? "no connector row" : "a row whose method is not app"}) is no_credentials`, async () => {
      const r = await rig({ daemon: true, connector });
      const { payload } = await refusal(r, r.playbook(["o/r"]));
      expect(payload).toEqual({
        reason: "github_token_unavailable",
        detail: "mint_failed: no_credentials: no GitHub App is connected and in use, or its credentials are missing from the Keychain",
      });
      expect(r.github.mints()).toEqual([]);
      expectNothingStarted(r);
      expectNoSecretStored(r);
    });
  }

  it("(b) a repo the App's installation does not reach is repo_not_reached", async () => {
    const r = await rig({ daemon: true, connector: "app" });
    const { payload } = await refusal(r, r.playbook(["o/outside"]));
    expect(payload).toEqual({
      reason: "github_token_unavailable",
      detail: "mint_failed: repo_not_reached: a repo the playbook names is not one the GitHub App's installation reaches",
    });
    expect(r.github.mints()).toEqual([]);
    expectNothingStarted(r);
    expectNoSecretStored(r);
  });

  it("(c) an HTTP error from GitHub's access-token endpoint is http_error with its status", async () => {
    const r = await rig({ daemon: true, connector: "app" });
    r.github.state.mintStatus = 500;
    const { payload } = await refusal(r, r.playbook(["o/r"]));
    expect(payload).toEqual({ reason: "github_token_unavailable", detail: "mint_failed: http_error: GitHub refused the token request (HTTP 500)" });
    expect(r.github.mints()).toHaveLength(1);
    expectNothingStarted(r);
    expectNoSecretStored(r);
  });
});

describe("without the daemon's deps the kernel stays fail closed (AC3)", () => {
  it("startKernel with no sessionTokenMintFor refuses a live, write-granted session no_minter, whatever the Keychain holds", async () => {
    const r = await rig({ daemon: false, connector: "app" });
    const { err, payload } = await refusal(r, r.playbook(["o/r"]));
    expect(payload).toEqual({ reason: "github_token_unavailable", detail: "no_minter" });
    expect((err as unknown as { detail: string }).detail).toBe("no_minter");
    expect(r.github.requests).toEqual([]);
    expectNothingStarted(r);
  });
});

describe("a minter passed through options.sessions wins over the daemon's (AC4)", () => {
  it("the options.sessions minter is called, the daemon default is not (no access-token POST)", async () => {
    const asked: (readonly string[])[] = [];
    const sessionTokenMint: SessionTokenMint = (repos) => {
      asked.push([...repos]);
      return { ok: true, token: "ghs_standinfixturetoken01", expires_at: new Date(NOW.getTime() + HOUR).toISOString() };
    };
    const r = await rig({ daemon: true, connector: "app", sessions: { sessionTokenMint } });
    const handle = await r.start(r.playbook(["o/r"]));

    expect(asked).toEqual([["o/r"]]);
    expect(r.github.mints()).toEqual([]);
    expect(readFileSync(join(r.dirOf(handle.id), "token"), "utf8")).toBe("ghs_standinfixturetoken01");
    expect(events(r.store, "session_refused")).toEqual([]);
  });
});

describe("building the daemon's deps and its minter factory reads and requests nothing (AC5)", () => {
  it("daemonKernelDeps(...).sessionTokenMintFor(store) leaves the Keychain unread and GitHub unasked until a mint runs", () => {
    const keychain = new FakeKeychain();
    const github = fakeGitHub();
    const d = daemonKernelDeps({ keychain, fetch: github.fetch, now: () => NOW });
    const store = new Store({ dataDir });
    stores.push(store);
    expect(typeof d.sessionTokenMintFor).toBe("function");
    const mint = d.sessionTokenMintFor?.(store);
    expect(typeof mint).toBe("function");
    expect(keychain.reads).toEqual([]);
    expect(github.requests).toEqual([]);
  });

  it("the process-wide default (no Keychain or fetch given) builds without a read either", () => {
    const store = new Store({ dataDir });
    stores.push(store);
    expect(typeof daemonKernelDeps().sessionTokenMintFor?.(store)).toBe("function");
    expect(typeof daemonSessionTokenMint(store, {})).toBe("function");
  });
});

describe("toSessionTokenMintResult: the port's shape from mintSessionToken's answer", () => {
  const CODES: readonly GitHubSessionTokenError[] = [
    "repo_not_reached",
    "needs_permissions",
    "no_credentials",
    "keychain_failed",
    "bad_key",
    "unreachable",
    "rate_limited",
    "http_error",
    "scope_exceeded",
  ];

  it("passes a token and its expiry through", () => {
    const expires = new Date(NOW.getTime() + HOUR).toISOString();
    expect(toSessionTokenMintResult({ ok: true, token: "ghs_sometokenvalue", expires_at: expires })).toEqual({ ok: true, token: "ghs_sometokenvalue", expires_at: expires });
  });

  it("gives every error code a short fixed text, with (HTTP <status>) only when a status came", () => {
    for (const error of CODES) {
      const plain = toSessionTokenMintResult({ ok: false, error });
      expect(plain).toMatchObject({ ok: false, error });
      const text = (plain as { message: string }).message;
      expect(text.length, error).toBeGreaterThan(0);
      expect(text.length, error).toBeLessThanOrEqual(120);
      expect(text, error).not.toContain("HTTP");
      const withStatus = toSessionTokenMintResult({ ok: false, error, status: 503 });
      expect((withStatus as { message: string }).message, error).toBe(`${text} (HTTP 503)`);
      // The refusal detail `mint_failed: <code>: <text> (HTTP nnn)` stays under the session auth's 200-character cut.
      expect(`mint_failed: ${error}: ${text} (HTTP 503)`.length, error).toBeLessThan(200);
    }
  });

  it("never carries the token or any extra field of a failure", () => {
    const hostile = { ok: false, error: "http_error", status: 500, token: "ghs_leakedtokenvalue", message: "ghs_leakedtokenvalue" } as unknown as Parameters<typeof toSessionTokenMintResult>[0];
    const out = toSessionTokenMintResult(hostile);
    expect(JSON.stringify(out)).not.toContain("ghs_leakedtokenvalue");
    expect(out).toEqual({ ok: false, error: "http_error", message: "GitHub refused the token request (HTTP 500)" });
  });
});
