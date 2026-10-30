// The GitHub App connect's setup flow (D36): the one setup window, its
// single-use `state`s, the manifest page, the manifest conversion and the five
// routes, driven over a real API server on 127.0.0.1 against a fake GitHub (an
// injected `fetch`) and a fake `GitHubAppPort`. Never the real GitHub, the
// Keychain, the SDK or a model. The mechanism (the no-token exception) is
// pinned in `api-unauthenticated-routes.test.ts`; here is what the routes do
// with it.
import { request } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startApiServer } from "../src/api/index.js";
import type { ApiServer } from "../src/api/index.js";
import { mergeContributions } from "../src/features/index.js";
import type { ContributedRouteRequest } from "../src/features/index.js";
import { GITHUB_APP_SETUP_STATUS, GITHUB_APP_SETUP_WINDOW_MS, createGitHubAppSetup } from "../src/integrations/github/app-setup.js";
import { githubAppPort } from "../src/integrations/github/app-port.js";
import { githubAppRoutes } from "../src/integrations/github/app-routes.js";
import { GITHUB_APP_SETUP_REFUSALS } from "../src/integrations/index.js";
import type { ConnectorRow, GitHubAppPort, GitHubAppPortError, GitHubAppPortResult, GitHubAppSetupRefusal } from "../src/integrations/index.js";
import { events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const T0 = "2026-10-30T10:00:00.000Z";
const API_TOKEN = "0123456789abcdef".repeat(4);
const SETUP = "/connectors/github/app/setup";
const CANCEL = "/connectors/github/app/setup/cancel";
const START = "/connectors/github/app/start";
const RETURN = "/connectors/github/app/return";
const INSTALLED = "/connectors/github/app/installed";

// Every secret string the flow handles: none may reach a page, an event or a log line.
const PEM_BODY = "MIIEowIBAAKCAQEA-PEM-BODY-NOT-FOR-ANY-PAGE";
const PEM = `-----BEGIN RSA PRIVATE KEY-----\n${PEM_BODY}\n-----END RSA PRIVATE KEY-----\n`;
const CLIENT_SECRET = "client-secret-0f1e2d3c4b5a";
const WEBHOOK_SECRET = "webhook-secret-9a8b7c6d5e4f";
const CODE = "code-0123456789abcdef0123";

const CONVERSION_BODY = {
  id: 4242,
  slug: "loomwright-studio-ab12cd",
  name: "loomwright-studio-ab12cd",
  owner: { login: "owner-one" },
  html_url: "https://github.com/apps/loomwright-studio-ab12cd",
  client_id: "Iv1.0123456789abcdef",
  client_secret: CLIENT_SECRET,
  webhook_secret: WEBHOOK_SECRET,
  pem: PEM,
  permissions: { pull_requests: "read", contents: "read", metadata: "read" },
};

const ROW: ConnectorRow = {
  id: 1,
  kind: "github",
  status: "connected",
  account_login: null,
  permissions_json: null,
  reachable_repos_json: null,
  expires_at: null,
  verified_at: null,
  permissions_source: null,
  permissions_declared_at: null,
  created_at: T0,
  updated_at: T0,
};

let env: LoopEnv;
const servers: ApiServer[] = [];
let logs: string[];

beforeEach(() => {
  env = loopEnv(T0);
  logs = [];
  // Every line the flow could write to the console or the process streams.
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
  }
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => void logs.push(String(chunk)) as unknown as boolean) as never);
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => void logs.push(String(chunk)) as unknown as boolean) as never);
});

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  vi.restoreAllMocks();
  env.cleanup();
});

const ok = <T>(value: T): Promise<GitHubAppPortResult<T>> => Promise.resolve({ ok: true, value });
const fail = (error: GitHubAppPortError): Promise<GitHubAppPortResult<never>> => Promise.resolve({ ok: false, error, message: `the port said ${error}` });

/** A fake port; each method is a spy, overridable. */
function fakePort(overrides: Partial<GitHubAppPort> = {}) {
  const storeApp = vi.fn<GitHubAppPort["storeApp"]>(() => ok(ROW));
  const recordInstallation = vi.fn<GitHubAppPort["recordInstallation"]>(() => ok(ROW));
  const removeApp = vi.fn<GitHubAppPort["removeApp"]>(() => ok(ROW));
  const port: GitHubAppPort = { storeApp, recordInstallation, removeApp, ...overrides };
  return { port, storeApp, recordInstallation, removeApp };
}

type Fetch = typeof globalThis.fetch;

/** A fake GitHub: the conversion answers 201 with the full body (secrets included) unless told otherwise. */
function fakeGitHub(answer: () => Promise<Response> = () => Promise.resolve(new Response(JSON.stringify(CONVERSION_BODY), { status: 201 }))) {
  return vi.fn<Fetch>(() => answer());
}

interface Seen {
  readonly status: number;
  readonly text: string;
  readonly headers: Headers;
}

interface Flow {
  readonly api: ApiServer;
  readonly seen: Seen[];
  readonly origin: string;
  open(): Promise<{ setup_url: string; expires_at: string; startState: string }>;
  get(path: string, query?: Record<string, string>): Promise<Seen>;
  startPage(startState: string): Promise<Seen>;
  ret(query: Record<string, string>): Promise<Seen>;
  installed(query: Record<string, string>): Promise<Seen>;
  post(path: string): Promise<Response>;
}

/** The setup routes over a real API server (the clock is the test's). */
async function flow(port: GitHubAppPort, github: Fetch): Promise<Flow> {
  const setup = createGitHubAppSetup({ port, fetch: github });
  const api = await startApiServer(
    {
      store: env.store,
      sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
      loop: { start: () => {}, stop: async () => {} },
      authProviders: [stubProvider()],
      token: API_TOKEN,
      routes: mergeContributions([{ name: "setup", routes: setup.routes }], { tools: [], routes: [], subcommands: [] }).routes,
    },
    { now: env.now },
  );
  servers.push(api);
  const origin = `http://127.0.0.1:${api.port}`;
  const seen: Seen[] = [];
  const get = async (path: string, query: Record<string, string> = {}): Promise<Seen> => {
    const qs = new URLSearchParams(query).toString();
    const res = await fetch(`${origin}${path}${qs === "" ? "" : `?${qs}`}`, { redirect: "manual" });
    const answer = { status: res.status, text: await res.text(), headers: res.headers };
    seen.push(answer);
    return answer;
  };
  const post = (path: string): Promise<Response> => fetch(`${origin}${path}`, { method: "POST", headers: { Authorization: `Bearer ${API_TOKEN}` } });
  return {
    api,
    seen,
    origin,
    post,
    get,
    startPage: (startState) => get(START, { state: startState }),
    ret: (query) => get(RETURN, query),
    installed: (query) => get(INSTALLED, query),
    async open() {
      const res = await post(SETUP);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { setup_url: string; expires_at: string };
      return { ...body, startState: new URL(body.setup_url).searchParams.get("state") as string };
    },
  };
}

const unescapeHtml = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** The start page's form: the create `state` GitHub is given, and the manifest it is posted. */
function formOf(page: Seen): { action: string; createState: string; manifest: Record<string, unknown> } {
  const action = /<form id="f" method="post" action="([^"]*)"/.exec(page.text)?.[1];
  const value = /name="manifest" value="([^"]*)"/.exec(page.text)?.[1];
  expect(action).toBeDefined();
  expect(value).toBeDefined();
  const unescapedAction = unescapeHtml(action as string);
  return {
    action: unescapedAction,
    createState: new URL(unescapedAction).searchParams.get("state") as string,
    manifest: JSON.parse(unescapeHtml(value as string)) as Record<string, unknown>,
  };
}

/** Open, load the start page and read its create `state`. */
async function toCreate(f: Flow): Promise<{ startState: string; createState: string }> {
  const { startState } = await f.open();
  const page = await f.startPage(startState);
  expect(page.status).toBe(200);
  return { startState, createState: formOf(page).createState };
}

/** The install `state` the return's redirect carries. */
const installStateOf = (res: Seen): string => new URL(res.headers.get("location") as string).searchParams.get("state") as string;

/** Open, start, return: the install `state` the return handed out. */
async function toInstall(f: Flow): Promise<string> {
  const { createState } = await toCreate(f);
  const res = await f.ret({ code: CODE, state: createState });
  expect(res.status).toBe(302);
  return installStateOf(res);
}

const connectorEvents = () => events(env.store, "connector_status");

/** The heading of a fixed page (its `<h1>`). */
const headingOf = (page: Seen): string | undefined => /<h1>([^<]*)<\/h1>/.exec(page.text)?.[1];

describe("the happy path (AC1)", () => {
  it("follows start, return and installed: storeApp and recordInstallation once each with the right values, the window closes, the browser sees Done", async () => {
    const { port, storeApp, recordInstallation, removeApp } = fakePort();
    const github = fakeGitHub();
    const f = await flow(port, github);
    const { startState } = await f.open();

    const start = await f.startPage(startState);
    expect(start.status).toBe(200);
    expect(start.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(github).not.toHaveBeenCalled();
    const { action, createState } = formOf(start);
    expect(action).toBe(`https://github.com/settings/apps/new?state=${createState}`);

    const returned = await f.ret({ code: CODE, state: createState });
    expect(returned.status).toBe(302);
    const location = new URL(returned.headers.get("location") as string);
    expect(`${location.origin}${location.pathname}`).toBe("https://github.com/apps/loomwright-studio-ab12cd/installations/new");
    const installState = installStateOf(returned);
    expect(installState).not.toBe(createState);
    expect(returned.text).toBe("");
    expect(github).toHaveBeenCalledTimes(1);
    expect(storeApp).toHaveBeenCalledTimes(1);
    expect(storeApp).toHaveBeenCalledWith(
      env.store,
      { app_id: 4242, slug: "loomwright-studio-ab12cd", name: "loomwright-studio-ab12cd", owner_login: "owner-one", html_url: "https://github.com/apps/loomwright-studio-ab12cd", client_id: "Iv1.0123456789abcdef" },
      PEM,
      env.now,
    );
    // The secrets the conversion carried are not passed on: only the six fields and the pem.
    expect(JSON.stringify(storeApp.mock.calls[0]?.[1])).not.toContain(CLIENT_SECRET);
    expect(recordInstallation).not.toHaveBeenCalled();

    const done = await f.installed({ installation_id: "987654", setup_action: "install", state: installState });
    expect(done.status).toBe(200);
    expect(done.text).toContain("Done");
    expect(done.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(recordInstallation).toHaveBeenCalledTimes(1);
    expect(recordInstallation).toHaveBeenCalledWith(env.store, 987654, env.now);
    expect(storeApp).toHaveBeenCalledTimes(1);
    expect(removeApp).not.toHaveBeenCalled();
    expect(connectorEvents()).toEqual([]);

    // The window is closed: nothing opens it again but a new setup.
    const later = await f.installed({ installation_id: "987654", state: installState });
    expect(later.status).toBe(400);
    expect(headingOf(later)).toBe("No setup is open");
    expect(recordInstallation).toHaveBeenCalledTimes(1);
  });

  it("answers every browser page with no-store and no-referrer, and the redirect too", async () => {
    const f = await flow(fakePort().port, fakeGitHub());
    const { createState } = await toCreate(f);
    await f.ret({ code: CODE, state: createState });
    await f.ret({ code: CODE, state: createState });
    expect(f.seen).toHaveLength(3);
    for (const answer of f.seen) {
      expect(answer.headers.get("cache-control")).toBe("no-store");
      expect(answer.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });
});

describe("the start page (AC2)", () => {
  it("posts a manifest with no hook_attributes, exactly the three read permissions and return addresses on the loopback API's port", async () => {
    const f = await flow(fakePort().port, fakeGitHub());
    const { startState } = await f.open();
    const { manifest } = formOf(await f.startPage(startState));
    expect("hook_attributes" in manifest).toBe(false);
    expect(manifest["default_permissions"]).toEqual({ pull_requests: "read", contents: "read", metadata: "read" });
    expect(manifest["default_events"]).toEqual([]);
    expect(manifest["public"]).toBe(false);
    expect(manifest["name"]).toMatch(/^loomwright-studio-[0-9a-f]{6}$/);
    expect(manifest["redirect_url"]).toBe(`${f.origin}${RETURN}`);
    expect(manifest["setup_url"]).toBe(`${f.origin}${INSTALLED}`);
    expect(new URL(manifest["redirect_url"] as string).port).toBe(String(f.api.port));
  });

  it("builds its return addresses from the server's address, never the Host header", async () => {
    const f = await flow(fakePort().port, fakeGitHub());
    const { startState } = await f.open();
    // fetch() may not set Host, so a raw request.
    const text = await new Promise<string>((resolve, reject) => {
      request({ host: "127.0.0.1", port: f.api.port, path: `${START}?state=${startState}`, headers: { Host: "evil.example:9" } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      })
        .on("error", reject)
        .end();
    });
    const { manifest } = formOf({ status: 200, text, headers: new Headers() });
    expect(manifest["redirect_url"]).toBe(`${f.origin}${RETURN}`);
    expect(manifest["setup_url"]).toBe(`${f.origin}${INSTALLED}`);
  });

  it("draws a different app name on each load, and does not echo the start state", async () => {
    const f = await flow(fakePort().port, fakeGitHub());
    const { startState } = await f.open();
    const names = new Set<unknown>();
    for (let i = 0; i < 8; i++) {
      const page = await f.startPage(startState);
      expect(page.text).not.toContain(startState);
      names.add(formOf(page).manifest["name"]);
    }
    expect(names.size).toBeGreaterThan(1);
  });

  it("calls nothing on GitHub or the port and writes nothing", async () => {
    const { port, storeApp, recordInstallation, removeApp } = fakePort();
    const github = fakeGitHub();
    const f = await flow(port, github);
    const { startState } = await f.open();
    await f.startPage(startState);
    await f.startPage(startState);
    expect(github).not.toHaveBeenCalled();
    expect([storeApp, recordInstallation, removeApp].map((m) => m.mock.calls.length)).toEqual([0, 0, 0]);
    expect(events(env.store)).toEqual([]);
  });

  it("can be reloaded, and each load mints a fresh single-use create state that replaces the previous one", async () => {
    const { port, storeApp } = fakePort();
    const github = fakeGitHub();
    const f = await flow(port, github);
    const { startState } = await f.open();
    const first = formOf(await f.startPage(startState)).createState;
    const second = formOf(await f.startPage(startState)).createState;
    expect(second).not.toBe(first);

    const stale = await f.ret({ code: CODE, state: first });
    expect(stale.status).toBe(400);
    expect(headingOf(stale)).toBe("This link is not valid");
    expect(github).not.toHaveBeenCalled();
    expect(storeApp).not.toHaveBeenCalled();

    expect((await f.ret({ code: CODE, state: second })).status).toBe(302);
  });

  it("refuses a load once the return has spent the create state: the start state is for reloads until then", async () => {
    const f = await flow(fakePort().port, fakeGitHub());
    const { startState, createState } = await toCreate(f);
    expect((await f.ret({ code: CODE, state: createState })).status).toBe(302);
    const again = await f.startPage(startState);
    expect(again.status).toBe(400);
    expect(headingOf(again)).toBe("This link is not valid");
  });

  it("mints every state from at least 128 random bits, different each time", async () => {
    const f = await flow(fakePort().port, fakeGitHub());
    const states: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { startState } = await f.open();
      states.push(startState);
      states.push(formOf(await f.startPage(startState)).createState);
    }
    states.push(await toInstall(f));
    for (const state of states) expect(Buffer.from(state, "base64url").length).toBeGreaterThanOrEqual(16);
    expect(new Set(states).size).toBe(states.length);
  });
});

describe("the window (AC3, AC4, AC5)", () => {
  it("answers {setup_url, expires_at} with the clock plus 10 minutes, on the API's own origin (Mechanism AC2)", async () => {
    const f = await flow(fakePort().port, fakeGitHub());
    const opened = await f.open();
    expect(GITHUB_APP_SETUP_WINDOW_MS).toBe(10 * 60 * 1000);
    expect(opened.expires_at).toBe("2026-10-30T10:10:00.000Z");
    expect(opened.setup_url).toBe(`${f.origin}${START}?state=${opened.startState}`);
    env.advance(3 * 60 * 1000);
    expect((await f.open()).expires_at).toBe("2026-10-30T10:13:00.000Z");
  });

  it("closes the first window when a second opens: its state is refused afterwards", async () => {
    const { port, storeApp } = fakePort();
    const github = fakeGitHub();
    const f = await flow(port, github);
    const first = await toCreate(f);
    const second = await f.open();
    expect((await f.startPage(first.startState)).status).toBe(400);
    const stale = await f.ret({ code: CODE, state: first.createState });
    expect(stale.status).toBe(400);
    expect(headingOf(stale)).toBe("This link is not valid");
    expect(github).not.toHaveBeenCalled();
    expect(storeApp).not.toHaveBeenCalled();
    expect((await f.startPage(second.startState)).status).toBe(200);
  });

  it("is refused setup_not_open after cancel, and cancel answers {cancelled}", async () => {
    const { port, storeApp } = fakePort();
    const github = fakeGitHub();
    const f = await flow(port, github);
    const { createState } = await toCreate(f);
    const cancelled = await f.post(CANCEL);
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toEqual({ cancelled: true });
    const refused = await f.ret({ code: CODE, state: createState });
    expect(refused.status).toBe(400);
    expect(headingOf(refused)).toBe("No setup is open");
    expect(github).not.toHaveBeenCalled();
    expect(storeApp).not.toHaveBeenCalled();
    expect(connectorEvents().map((e) => e.payload["refused"])).toEqual(["setup_not_open"]);
    expect(await (await f.post(CANCEL)).json()).toEqual({ cancelled: false });
  });

  it("refuses a replayed create state as state_mismatch and calls nothing more on GitHub or the port", async () => {
    const { port, storeApp } = fakePort();
    const github = fakeGitHub();
    const f = await flow(port, github);
    const { createState } = await toCreate(f);
    expect((await f.ret({ code: CODE, state: createState })).status).toBe(302);
    const replay = await f.ret({ code: CODE, state: createState });
    expect(replay.status).toBe(400);
    expect(headingOf(replay)).toBe("This link is not valid");
    expect(github).toHaveBeenCalledTimes(1);
    expect(storeApp).toHaveBeenCalledTimes(1);
    expect(connectorEvents().map((e) => e.payload["refused"])).toEqual(["state_mismatch"]);
  });

  it("spends the create state before the conversion is awaited: a replay while it is in flight is refused and converts nothing", async () => {
    const { port, storeApp } = fakePort();
    let release: () => void = () => undefined;
    const github = fakeGitHub(() => new Promise<Response>((resolve) => (release = () => resolve(new Response(JSON.stringify(CONVERSION_BODY), { status: 201 })))));
    const f = await flow(port, github);
    const { createState } = await toCreate(f);
    const first = f.ret({ code: CODE, state: createState });
    await vi.waitFor(() => expect(github).toHaveBeenCalledTimes(1));
    const replay = await f.ret({ code: CODE, state: createState });
    expect(replay.status).toBe(400);
    expect(headingOf(replay)).toBe("This link is not valid");
    release();
    expect((await first).status).toBe(302);
    expect(github).toHaveBeenCalledTimes(1);
    expect(storeApp).toHaveBeenCalledTimes(1);
  });

  it("refuses a start-page reload while the conversion is in flight: no second create state, conversion or storeApp", async () => {
    const { port, storeApp } = fakePort();
    let release: () => void = () => undefined;
    const github = fakeGitHub(() => new Promise<Response>((resolve) => (release = () => resolve(new Response(JSON.stringify(CONVERSION_BODY), { status: 201 })))));
    const f = await flow(port, github);
    const { startState, createState } = await toCreate(f);
    const first = f.ret({ code: CODE, state: createState });
    await vi.waitFor(() => expect(github).toHaveBeenCalledTimes(1));
    const reload = await f.startPage(startState);
    expect(reload.status).toBe(400);
    expect(headingOf(reload)).toBe("This link is not valid");
    release();
    expect((await first).status).toBe(302);
    expect(github).toHaveBeenCalledTimes(1);
    expect(storeApp).toHaveBeenCalledTimes(1);
  });

  it("refuses a replayed install state: it is spent, and the window with it", async () => {
    const { port, recordInstallation } = fakePort();
    const f = await flow(port, fakeGitHub());
    const installState = await toInstall(f);
    expect((await f.installed({ installation_id: "5", state: installState })).status).toBe(200);
    expect((await f.installed({ installation_id: "5", state: installState })).status).toBe(400);
    expect(recordInstallation).toHaveBeenCalledTimes(1);
  });

  it("keeps the window open after a wrong state: a guess cannot end a setup", async () => {
    const { port, storeApp } = fakePort();
    const f = await flow(port, fakeGitHub());
    const { startState, createState } = await toCreate(f);
    for (const state of ["", "guess", createState.slice(0, -1), `${createState}x`, startState]) {
      expect((await f.ret({ code: CODE, state })).status).toBe(400);
    }
    expect((await f.ret({ code: CODE })).status).toBe(400);
    expect(storeApp).not.toHaveBeenCalled();
    expect((await f.ret({ code: CODE, state: createState })).status).toBe(302);
  });

  it("refuses the create state on the install route and the install state on the return", async () => {
    const { port, recordInstallation } = fakePort();
    const f = await flow(port, fakeGitHub());
    const { createState } = await toCreate(f);
    expect((await f.installed({ installation_id: "7", state: createState })).status).toBe(400);
    const returned = await f.ret({ code: CODE, state: createState });
    const installState = installStateOf(returned);
    expect((await f.ret({ code: CODE, state: installState })).status).toBe(400);
    expect((await f.installed({ installation_id: "7", state: createState })).status).toBe(400);
    expect(recordInstallation).not.toHaveBeenCalled();
    expect((await f.installed({ installation_id: "7", state: installState })).status).toBe(200);
  });

  it("refuses an expired window setup_expired on every browser route: open for 10 minutes less a millisecond, expired at 10", async () => {
    const { port, storeApp, recordInstallation } = fakePort();
    const github = fakeGitHub();
    const f = await flow(port, github);
    const { startState, createState } = await toCreate(f);
    env.advance(GITHUB_APP_SETUP_WINDOW_MS - 1);
    expect((await f.startPage(startState)).status).toBe(200);
    env.advance(1);
    for (const answer of [await f.startPage(startState), await f.ret({ code: CODE, state: createState }), await f.installed({ installation_id: "9", state: createState })]) {
      expect(answer.status).toBe(400);
      expect(headingOf(answer)).toBe("Setup timed out");
    }
    expect(github).not.toHaveBeenCalled();
    expect(storeApp).not.toHaveBeenCalled();
    expect(recordInstallation).not.toHaveBeenCalled();
    expect(connectorEvents().map((e) => e.payload["refused"])).toEqual(["setup_expired", "setup_expired", "setup_expired"]);
    // An expired window is not an open one: cancel reports it, and a new setup opens normally.
    expect(await (await f.post(CANCEL)).json()).toEqual({ cancelled: false });
    expect((await f.startPage((await f.open()).startState)).status).toBe(200);
  });

  it("stores nothing when the window is cancelled, replaced or expires while the conversion is in flight", async () => {
    const { port, storeApp } = fakePort();
    let release: () => void = () => undefined;
    const github = fakeGitHub(() => new Promise<Response>((resolve) => (release = () => resolve(new Response(JSON.stringify(CONVERSION_BODY), { status: 201 })))));
    const f = await flow(port, github);

    const { createState } = await toCreate(f);
    const pending = f.ret({ code: CODE, state: createState });
    await vi.waitFor(() => expect(github).toHaveBeenCalledTimes(1));
    await f.post(CANCEL);
    release();
    const afterCancel = await pending;
    expect(afterCancel.status).toBe(400);
    expect(headingOf(afterCancel)).toBe("No setup is open");

    const second = await toCreate(f);
    const pendingReplaced = f.ret({ code: CODE, state: second.createState });
    await vi.waitFor(() => expect(github).toHaveBeenCalledTimes(2));
    await f.open();
    release();
    expect((await pendingReplaced).status).toBe(400);

    const third = await toCreate(f);
    const pendingExpired = f.ret({ code: CODE, state: third.createState });
    await vi.waitFor(() => expect(github).toHaveBeenCalledTimes(3));
    env.advance(GITHUB_APP_SETUP_WINDOW_MS);
    release();
    expect(headingOf(await pendingExpired)).toBe("Setup timed out");
    expect(storeApp).not.toHaveBeenCalled();
  });

  /** A port whose storeApp waits for `release`, so a window can change while the App is being stored. */
  function gatedStore() {
    let release: () => void = () => undefined;
    const fake = fakePort();
    fake.storeApp.mockImplementation(() => new Promise((resolve) => (release = () => resolve({ ok: true, value: ROW }))));
    return { ...fake, release: () => release() };
  }

  it("answers setup_not_open, not the install redirect, when the window is cancelled while the App is being stored", async () => {
    const { port, storeApp, release } = gatedStore();
    const f = await flow(port, fakeGitHub());
    const { startState, createState } = await toCreate(f);
    const pending = f.ret({ code: CODE, state: createState });
    await vi.waitFor(() => expect(storeApp).toHaveBeenCalledTimes(1));
    await f.post(CANCEL);
    release();
    const answer = await pending;
    expect(answer.status).toBe(400);
    expect(answer.headers.get("location")).toBeNull();
    expect(headingOf(answer)).toBe("No setup is open");
    expect(headingOf(await f.startPage(startState))).toBe("No setup is open");
    expect(storeApp).toHaveBeenCalledTimes(1);
  });

  it("answers setup_not_open when a replacement opens while the App is being stored, and leaves the replacement window open", async () => {
    const { port, storeApp, release } = gatedStore();
    const f = await flow(port, fakeGitHub());
    const { createState } = await toCreate(f);
    const pending = f.ret({ code: CODE, state: createState });
    await vi.waitFor(() => expect(storeApp).toHaveBeenCalledTimes(1));
    const replacement = await f.open();
    release();
    const answer = await pending;
    expect([answer.status, answer.headers.get("location")]).toEqual([400, null]);
    expect(headingOf(answer)).toBe("No setup is open");
    // The old answer did not close the new window.
    expect((await f.startPage(replacement.startState)).status).toBe(200);
  });

  it("answers setup_expired when the window expires while the App is being stored", async () => {
    const { port, storeApp, release } = gatedStore();
    const f = await flow(port, fakeGitHub());
    const { createState } = await toCreate(f);
    const pending = f.ret({ code: CODE, state: createState });
    await vi.waitFor(() => expect(storeApp).toHaveBeenCalledTimes(1));
    env.advance(GITHUB_APP_SETUP_WINDOW_MS);
    release();
    const answer = await pending;
    expect([answer.status, answer.headers.get("location")]).toEqual([400, null]);
    expect(headingOf(answer)).toBe("Setup timed out");
  });

  it("spends the install state before recordInstallation is awaited: a concurrent second /installed is refused and records nothing", async () => {
    const { port, recordInstallation } = fakePort();
    let release: () => void = () => undefined;
    recordInstallation.mockImplementation(() => new Promise((resolve) => (release = () => resolve({ ok: true, value: ROW }))));
    const f = await flow(port, fakeGitHub());
    const installState = await toInstall(f);
    const first = f.installed({ installation_id: "5", state: installState });
    await vi.waitFor(() => expect(recordInstallation).toHaveBeenCalledTimes(1));
    const second = await f.installed({ installation_id: "5", state: installState });
    expect(second.status).toBe(400);
    release();
    expect((await first).status).toBe(200);
    expect(recordInstallation).toHaveBeenCalledTimes(1);
  });

  it("does not remove the App on token_write_scoped when a replacement window has stored its own during the call", async () => {
    const { port, recordInstallation, removeApp } = fakePort();
    let release: () => void = () => undefined;
    recordInstallation.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ ok: false, error: "token_write_scoped", message: "write" }))));
    const f = await flow(port, fakeGitHub());
    const installState = await toInstall(f);
    const pending = f.installed({ installation_id: "5", state: installState });
    await vi.waitFor(() => expect(recordInstallation).toHaveBeenCalledTimes(1));
    await toInstall(f);
    release();
    const answer = await pending;
    expect(answer.status).toBe(422);
    expect(removeApp).not.toHaveBeenCalled();
  });
});

describe("no window, a wrong state, an expired window (Error AC1)", () => {
  it("answers each browser route its fixed page and one event, calling nothing on GitHub or the port and writing nothing else", async () => {
    const { port, storeApp, recordInstallation, removeApp } = fakePort();
    const github = fakeGitHub();
    const f = await flow(port, github);
    const query = { code: CODE, state: "CANARY_STATE", installation_id: "1", setup_action: "install", extra: "CANARY_QUERY<script>" };

    // No window at all.
    const noWindow = [await f.get(START, query), await f.get(RETURN, query), await f.get(INSTALLED, query)];
    // A window with a state that is not its own.
    await toCreate(f);
    const wrong = [await f.get(START, query), await f.get(RETURN, query), await f.get(INSTALLED, query)];
    for (const answer of noWindow) {
      expect(answer.status).toBe(400);
      expect(headingOf(answer)).toBe("No setup is open");
    }
    for (const answer of wrong) {
      expect(answer.status).toBe(400);
      expect(headingOf(answer)).toBe("This link is not valid");
    }
    // One fixed page per reason, whatever was asked.
    expect(new Set(noWindow.map((a) => a.text)).size).toBe(1);
    expect(new Set(wrong.map((a) => a.text)).size).toBe(1);
    for (const answer of [...noWindow, ...wrong]) {
      expect(answer.text).not.toMatch(/CANARY|script>|install/i);
      expect(answer.headers.get("cache-control")).toBe("no-store");
    }
    expect(github).not.toHaveBeenCalled();
    expect([storeApp, recordInstallation, removeApp].map((m) => m.mock.calls.length)).toEqual([0, 0, 0]);
    expect(count("SELECT COUNT(*) FROM connectors")).toBe(0);
    // Exactly one connector_status event per refusal, and nothing else was written.
    expect(events(env.store).map((e) => e.kind)).toEqual(Array(6).fill("connector_status"));
    expect(connectorEvents().map((e) => e.payload)).toEqual([
      ...Array(3).fill({ connector_id: null, kind: "github", status: null, refused: "setup_not_open" }),
      ...Array(3).fill({ connector_id: null, kind: "github", status: null, refused: "state_mismatch" }),
    ]);
  });

  it("takes connector_id and status from the GitHub row when there is one", async () => {
    env.store.prepare("INSERT INTO connectors (kind, status, created_at, updated_at) VALUES ('github', 'rejected', ?, ?)").run(T0, T0);
    const f = await flow(fakePort().port, fakeGitHub());
    await f.get(RETURN, { state: "x" });
    expect(connectorEvents().map((e) => e.payload)).toEqual([{ connector_id: 1, kind: "github", status: "rejected", refused: "setup_not_open" }]);
  });

  it("maps each refusal to its HTTP status and renders it as its own fixed page", async () => {
    expect(GITHUB_APP_SETUP_STATUS).toEqual({ setup_not_open: 400, state_mismatch: 400, setup_expired: 400, conversion_failed: 502, install_failed: 502, token_write_scoped: 422 });
    expect(Object.keys(GITHUB_APP_SETUP_STATUS)).toEqual([...GITHUB_APP_SETUP_REFUSALS]);
    expect(Object.isFrozen(GITHUB_APP_SETUP_STATUS)).toBe(true);

    const reached = new Map<GitHubAppSetupRefusal, Seen>();
    const f = await flow(
      fakePort({ recordInstallation: () => fail("token_write_scoped") }).port,
      fakeGitHub(() => Promise.resolve(new Response("{}", { status: 500 }))),
    );
    reached.set("setup_not_open", await f.get(RETURN, { state: "x" }));
    const { startState } = await f.open();
    reached.set("state_mismatch", await f.get(RETURN, { state: "x" }));
    reached.set("conversion_failed", await f.ret({ code: CODE, state: formOf(await f.startPage(startState)).createState }));
    const g = await flow(fakePort({ recordInstallation: () => fail("token_write_scoped") }).port, fakeGitHub());
    reached.set("token_write_scoped", await g.installed({ installation_id: "3", state: await toInstall(g) }));
    const h = await flow(fakePort({ storeApp: () => fail("not_implemented") }).port, fakeGitHub());
    reached.set("install_failed", await h.ret({ code: CODE, state: (await toCreate(h)).createState }));
    const i = await flow(fakePort().port, fakeGitHub());
    const expired = await i.open();
    env.advance(GITHUB_APP_SETUP_WINDOW_MS);
    reached.set("setup_expired", await i.startPage(expired.startState));

    for (const reason of GITHUB_APP_SETUP_REFUSALS) {
      expect([reason, reached.get(reason)?.status]).toEqual([reason, GITHUB_APP_SETUP_STATUS[reason]]);
    }
    expect(new Set([...reached.values()].map(headingOf)).size).toBe(GITHUB_APP_SETUP_REFUSALS.length);
  });

  it("answers a non-GET to a browser path 401 without the token and 405 with it", async () => {
    const f = await flow(fakePort().port, fakeGitHub());
    for (const path of [START, RETURN, INSTALLED]) {
      const bare = await fetch(`${f.origin}${path}`, { method: "POST" });
      expect(bare.status).toBe(401);
      const gated = await fetch(`${f.origin}${path}`, { method: "POST", headers: { Authorization: `Bearer ${API_TOKEN}` } });
      expect(gated.status).toBe(405);
    }
    expect(events(env.store)).toEqual([]);
  });
});

/** `SELECT COUNT(*)` as a number. */
function count(sql: string): number {
  return env.store.prepare<[], number>(sql).pluck().get() ?? 0;
}

describe("the conversion (Error AC2)", () => {
  it("sends exactly one POST to api.github.com/app-manifests/<code>/conversions, with no body and no credential", async () => {
    const github = fakeGitHub();
    const f = await flow(fakePort().port, github);
    const { createState } = await toCreate(f);
    await f.ret({ code: CODE, state: createState });
    expect(github).toHaveBeenCalledTimes(1);
    const [url, init] = github.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.github.com/app-manifests/${CODE}/conversions`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe("manual");
    expect(Object.keys(init.headers as Record<string, string>).map((h) => h.toLowerCase()).sort()).toEqual(["accept", "user-agent", "x-github-api-version"]);
  });

  it("sends nothing for a code that is missing or not a short [A-Za-z0-9_-] string, and answers conversion_failed", async () => {
    const { port, storeApp } = fakePort();
    const github = fakeGitHub();
    const f = await flow(port, github);
    for (const code of [undefined, "", "a/b", "../app", "a b", "a?x=1", "a#b", "x".repeat(101), "é", "a%2Fb"]) {
      const { createState } = await toCreate(f);
      const res = await f.ret(code === undefined ? { state: createState } : { code, state: createState });
      expect([String(code), res.status, headingOf(res)]).toEqual([String(code), 502, "GitHub did not hand the App over"]);
    }
    expect(github).not.toHaveBeenCalled();
    expect(storeApp).not.toHaveBeenCalled();
  });

  const BAD: ReadonlyArray<readonly [string, () => Promise<Response>]> = [
    ["a 404", () => Promise.resolve(new Response(JSON.stringify({ message: `no ${CODE}`, client_secret: CLIENT_SECRET }), { status: 404 }))],
    ["a 200 where 201 is the documented answer", () => Promise.resolve(new Response(JSON.stringify(CONVERSION_BODY), { status: 200 }))],
    ["a body that is not JSON", () => Promise.resolve(new Response(`not json ${PEM} ${CLIENT_SECRET}`, { status: 201 }))],
    ["a body without the pem", () => Promise.resolve(new Response(JSON.stringify({ ...CONVERSION_BODY, pem: undefined }), { status: 201 }))],
    ["a body with a slug that is not a slug", () => Promise.resolve(new Response(JSON.stringify({ ...CONVERSION_BODY, slug: "../evil" }), { status: 201 }))],
    ["a body with a non-numeric id", () => Promise.resolve(new Response(JSON.stringify({ ...CONVERSION_BODY, id: "4242" }), { status: 201 }))],
    ["a body with no owner", () => Promise.resolve(new Response(JSON.stringify({ ...CONVERSION_BODY, owner: null }), { status: 201 }))],
    ["a body that is not an object", () => Promise.resolve(new Response("[]", { status: 201 }))],
    ["a body over the bound", () => Promise.resolve(new Response(JSON.stringify({ ...CONVERSION_BODY, description: "x".repeat(300 * 1024) }), { status: 201 }))],
    ["a network error carrying a secret", () => Promise.reject(new Error(`connect failed for ${CODE} ${CLIENT_SECRET}`))],
  ];
  for (const [name, answer] of BAD) {
    it(`answers conversion_failed (502) for ${name}, closes the window, and nothing of it is shown`, async () => {
      const { port, storeApp } = fakePort();
      const f = await flow(port, fakeGitHub(answer));
      const { startState, createState } = await toCreate(f);
      const res = await f.ret({ code: CODE, state: createState });
      expect(res.status).toBe(502);
      expect(headingOf(res)).toBe("GitHub did not hand the App over");
      expect(storeApp).not.toHaveBeenCalled();
      expect(connectorEvents().map((e) => e.payload["refused"])).toEqual(["conversion_failed"]);
      expect(headingOf(await f.startPage(startState))).toBe("No setup is open");
      expectNoSecrets(f);
    });
  }

  it("stops reading a conversion body past 256 KB and cancels the rest of the stream: conversion_failed, like any bad answer", async () => {
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    let pulled = 0;
    let cancelled = false;
    // An endless 201 body: only a bounded read ever finishes.
    const endless = (): Promise<Response> =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulled += 1;
              controller.enqueue(chunk);
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 201 },
        ),
      );
    const { port, storeApp } = fakePort();
    const f = await flow(port, fakeGitHub(endless));
    const { startState, createState } = await toCreate(f);
    const res = await f.ret({ code: CODE, state: createState });
    expect(res.status).toBe(502);
    expect(headingOf(res)).toBe("GitHub did not hand the App over");
    expect(cancelled).toBe(true);
    // 256 KB is four 64 KB chunks; the fifth crosses the bound (a stream may pull a chunk or two ahead).
    expect(pulled).toBeLessThanOrEqual(7);
    expect(storeApp).not.toHaveBeenCalled();
    expect(connectorEvents().map((e) => e.payload["refused"])).toEqual(["conversion_failed"]);
    expect(headingOf(await f.startPage(startState))).toBe("No setup is open");
    expectNoSecrets(f);
  });
});

describe("the port (Error AC2)", () => {
  it("ends the setup token_write_scoped (422) and calls removeApp once when recordInstallation reports a write permission", async () => {
    const { port, removeApp, recordInstallation } = fakePort();
    recordInstallation.mockImplementation(() => fail("token_write_scoped"));
    const f = await flow(port, fakeGitHub());
    const installState = await toInstall(f);
    const res = await f.installed({ installation_id: "42", state: installState });
    expect(res.status).toBe(422);
    expect(headingOf(res)).toBe("The App can write");
    expect(removeApp).toHaveBeenCalledTimes(1);
    expect(removeApp).toHaveBeenCalledWith(env.store, env.now);
    expect(recordInstallation).toHaveBeenCalledTimes(1);
    expect(connectorEvents().map((e) => e.payload["refused"])).toEqual(["token_write_scoped"]);
    // The setup is over.
    expect(headingOf(await f.installed({ installation_id: "42", state: installState }))).toBe("No setup is open");
  });

  it("does not call removeApp for any other failure, and shows a port refusal with its own reason", async () => {
    for (const reason of ["install_failed", "conversion_failed", "state_mismatch"] as const) {
      const { port, removeApp } = fakePort({ recordInstallation: () => fail(reason) });
      const f = await flow(port, fakeGitHub());
      const res = await f.installed({ installation_id: "42", state: await toInstall(f) });
      expect([reason, res.status]).toEqual([reason, GITHUB_APP_SETUP_STATUS[reason]]);
      expect(removeApp).not.toHaveBeenCalled();
    }
  });

  it("shows not_implemented as install_failed, from storeApp and from recordInstallation, and a throwing port the same", async () => {
    const stubbed = await flow(fakePort({ storeApp: () => fail("not_implemented") }).port, fakeGitHub());
    const fromStore = await stubbed.ret({ code: CODE, state: (await toCreate(stubbed)).createState });
    expect([fromStore.status, headingOf(fromStore)]).toEqual([502, "Setup did not finish"]);

    const second = await flow(fakePort({ recordInstallation: () => fail("not_implemented") }).port, fakeGitHub());
    const fromInstall = await second.installed({ installation_id: "42", state: await toInstall(second) });
    expect([fromInstall.status, headingOf(fromInstall)]).toEqual([502, "Setup did not finish"]);

    const throwing = await flow(
      fakePort({
        storeApp: () => {
          throw new Error(`the port threw with ${PEM_BODY}`);
        },
      }).port,
      fakeGitHub(),
    );
    const fromThrow = await throwing.ret({ code: CODE, state: (await toCreate(throwing)).createState });
    expect([fromThrow.status, headingOf(fromThrow)]).toEqual([502, "Setup did not finish"]);
    expectNoSecrets(throwing);
    expect(connectorEvents().map((e) => e.payload["refused"])).toEqual(["install_failed", "install_failed", "install_failed"]);
  });

  it("closes the window when storeApp fails: a start-page reload then says setup_not_open, not state_mismatch", async () => {
    const f = await flow(fakePort({ storeApp: () => fail("install_failed") }).port, fakeGitHub());
    const { startState, createState } = await toCreate(f);
    expect((await f.ret({ code: CODE, state: createState })).status).toBe(502);
    expect(headingOf(await f.startPage(startState))).toBe("No setup is open");
  });

  it("closes the window on a bad installation id: the same state then says setup_not_open, not state_mismatch", async () => {
    const { port, recordInstallation } = fakePort();
    const f = await flow(port, fakeGitHub());
    const installState = await toInstall(f);
    expect((await f.installed({ installation_id: "abc", state: installState })).status).toBe(502);
    expect(headingOf(await f.installed({ installation_id: "5", state: installState }))).toBe("No setup is open");
    expect(recordInstallation).not.toHaveBeenCalled();
  });

  it("refuses an installation id that is missing or not a positive integer install_failed, without calling the port", async () => {
    const { port, recordInstallation } = fakePort();
    const f = await flow(port, fakeGitHub());
    const queries: Record<string, string>[] = [{}, { installation_id: "" }, { installation_id: "abc" }, { installation_id: "0" }, { installation_id: "-1" }, { installation_id: "1.5" }, { installation_id: "9".repeat(20) }];
    for (const query of queries) {
      const res = await f.installed({ ...query, state: await toInstall(f) });
      expect([JSON.stringify(query), res.status]).toEqual([JSON.stringify(query), 502]);
    }
    expect(recordInstallation).not.toHaveBeenCalled();
  });
});

describe("no secret on any path (Error AC4)", () => {
  /** Run one setup to its end and return the flow. */
  async function run(port: GitHubAppPort, github: Fetch, stopAt: "return" | "installed" = "installed"): Promise<Flow> {
    const f = await flow(port, github);
    const { createState } = await toCreate(f);
    const returned = await f.ret({ code: CODE, state: createState });
    if (stopAt === "installed" && returned.status === 302) await f.installed({ installation_id: "4", state: installStateOf(returned) });
    return f;
  }

  it("the full happy path, the conversion failures, and every port failure carry no pem, client_secret, webhook_secret, code or token", async () => {
    const flows = [
      await run(fakePort().port, fakeGitHub()),
      await run(fakePort({ storeApp: () => fail("install_failed") }).port, fakeGitHub()),
      await run(fakePort({ recordInstallation: () => fail("token_write_scoped") }).port, fakeGitHub()),
      await run(fakePort({ recordInstallation: () => fail("install_failed") }).port, fakeGitHub()),
      await run(fakePort().port, fakeGitHub(() => Promise.resolve(new Response(JSON.stringify(CONVERSION_BODY), { status: 500 })))),
    ];
    for (const f of flows) expectNoSecrets(f);
    // The refusals did happen: this is not a vacuous pass.
    expect(connectorEvents().map((e) => e.payload["refused"])).toEqual(["install_failed", "token_write_scoped", "install_failed", "conversion_failed"]);
  });

  it("no refusal page, event or log line echoes the request's query string, a state or the API token", async () => {
    const f = await flow(fakePort().port, fakeGitHub());
    const { startState, createState } = await toCreate(f);
    // The start page carries the create state by design; the refusals after it must not.
    const refusalsFrom = f.seen.length;
    const queries: Record<string, string>[] = [
      { state: startState, code: CODE, token: API_TOKEN },
      { state: createState, code: "bad code", token: API_TOKEN },
      { state: "Bearer " + API_TOKEN, installation_id: "xyz" },
    ];
    for (const query of queries) {
      for (const path of [RETURN, INSTALLED]) await f.get(path, query);
    }
    expect(f.seen.length).toBe(refusalsFrom + 6);
    const out = JSON.stringify([f.seen.slice(refusalsFrom).map((s) => [s.text, [...s.headers]]), events(env.store), logs]);
    for (const secret of [startState, createState, API_TOKEN, CODE, "bad code", "xyz"]) expect(out).not.toContain(secret);
  });
});

/** None of the secret strings is in any answer (body or header), any event, or any log line this flow produced. */
function expectNoSecrets(f: Flow): void {
  const out = JSON.stringify([f.seen.map((s) => [s.status, s.text, [...s.headers]]), events(env.store), logs]);
  for (const secret of [PEM_BODY, "BEGIN RSA PRIVATE KEY", CLIENT_SECRET, WEBHOOK_SECRET, CODE, API_TOKEN]) {
    expect(out, secret).not.toContain(secret);
  }
}

describe("a request without the API's origin (design constraint 3)", () => {
  const request = (query: Record<string, string> = {}): ContributedRouteRequest => ({
    params: {},
    query,
    body: undefined,
    store: env.store,
    now: env.now,
  });

  it("answers a typed error from setup and a fixed refusal page from the start page, and never throws", async () => {
    const routes = githubAppRoutes({ port: fakePort().port, fetch: fakeGitHub() });
    const setup = routes.find((r) => r.method === "POST" && r.path === SETUP);
    const startRoute = routes.find((r) => r.path === START);
    expect(await setup?.handler(request())).toEqual({
      status: 500,
      body: { error: "setup_unavailable", message: expect.stringMatching(/own address/) },
    });
    // No window was opened by the failed setup.
    expect((await startRoute?.handler(request({ state: "x" })))?.status).toBe(400);
  });

  it("answers the start page of an open window a fixed install_failed page, not a manifest, when the request has no origin", async () => {
    const routes = githubAppRoutes({ port: fakePort().port, fetch: fakeGitHub() });
    const setup = routes.find((r) => r.method === "POST" && r.path === SETUP);
    const startRoute = routes.find((r) => r.path === START);
    const opened = await setup?.handler({ ...request(), origin: "http://127.0.0.1:1" });
    const startState = new URL((opened?.body as { setup_url: string }).setup_url).searchParams.get("state") as string;
    const res = await startRoute?.handler(request({ state: startState }));
    expect(res?.status).toBe(502);
    const html = res?.browser !== undefined && "html" in res.browser ? res.browser.html : "";
    expect(html).toContain("Setup did not finish");
    expect(html).not.toContain("<form");
  });
});

describe("the shipped routes", () => {
  it("default to the stub port: a full setup shows install_failed, never a throw", async () => {
    const setup = createGitHubAppSetup({ port: githubAppPort, fetch: fakeGitHub() });
    const f = await flow(githubAppPort, fakeGitHub());
    const { createState } = await toCreate(f);
    const res = await f.ret({ code: CODE, state: createState });
    expect([res.status, headingOf(res)]).toEqual([502, "Setup did not finish"]);
    expect(setup.routes.map((r) => `${r.method} ${r.path}`)).toEqual([`POST ${SETUP}`, `POST ${CANCEL}`, `GET ${START}`, `GET ${RETURN}`, `GET ${INSTALLED}`]);
    expect(setup.routes.filter((r) => r.unauthenticated === true).map((r) => r.path)).toEqual([START, RETURN, INSTALLED]);
  });
});
