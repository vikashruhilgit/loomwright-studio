// The MCP connector's OAuth 2.1 connect (phase 8 item 06, `mcp/oauth.ts`): the
// discovery order, dynamic registration, PKCE `S256`, the single-use `state`,
// the loopback listener (bound to 127.0.0.1 only, one window, closed on settle,
// expiry and cancel) and the token refresh's failure classes. Run against the
// fake MCP and authorization server in `fixtures/mcp-fake.ts`, over real
// loopback HTTP. Never the real network, the Keychain, the SDK or a model.
import { createHash } from "node:crypto";
import { request } from "node:http";
import { Server, connect, type AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardedFetch, mcpUrlAllowed } from "../src/integrations/mcp/client.js";
import { McpRefreshError, createMcpOAuth, refreshMcpTokens, MCP_CALLBACK_PATH } from "../src/integrations/mcp/oauth.js";
import type { McpGrant, McpOAuth, McpWindowOutcome } from "../src/integrations/mcp/oauth.js";
import { startFakeMcp } from "./fixtures/mcp-fake.js";
import type { FakeMcp, FakeMcpOptions } from "./fixtures/mcp-fake.js";
import { loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

const T0 = "2026-11-03T10:00:00.000Z";

let env: LoopEnv;
let fake: FakeMcp | undefined;
const windows: McpOAuth[] = [];

beforeEach(() => {
  env = loopEnv(T0);
});

afterEach(async () => {
  // A window left open would hold its listener past the test.
  for (const w of windows.splice(0)) w.cancel("jira");
  if (fake !== undefined) await fake.close();
  fake = undefined;
  vi.restoreAllMocks();
  env.cleanup();
});

async function server(options: FakeMcpOptions = {}): Promise<FakeMcp> {
  fake = await startFakeMcp(options);
  return fake;
}

function oauth(deps: Parameters<typeof createMcpOAuth>[0] = {}): McpOAuth {
  const o = createMcpOAuth({ allowLoopbackHttp: true, ...deps });
  windows.push(o);
  return o;
}

type Return = (grant: McpGrant) => Promise<McpWindowOutcome<string>>;
const stored: Return = () => Promise.resolve({ ok: true, value: "stored" });

/** Open a window on the fake server for jira. */
function open(o: McpOAuth, f: FakeMcp, onReturn: Return = stored, extra: { scope?: string; kind?: "jira" | "clickup" } = {}) {
  return o.open<string>({ kind: extra.kind ?? "jira", serverUrl: f.mcpUrl, now: env.now, onReturn, ...(extra.scope === undefined ? {} : { scope: extra.scope }) });
}

/** Whether something accepts a TCP connection on 127.0.0.1:`port`. */
function accepts(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/** The redirect URI the window registered, from the fake's registration body. */
function redirectOf(f: FakeMcp): URL {
  const uris = f.registrations.at(-1)?.["redirect_uris"] as string[];
  return new URL(uris[0] as string);
}

/** A raw GET with a chosen Host header (`fetch` will not send one). */
function rawGet(port: number, path: string, host: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers: { host }, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function openOk(o: McpOAuth, f: FakeMcp, onReturn: Return = stored) {
  const opened = await open(o, f, onReturn);
  if (!opened.ok) throw new Error(`open refused: ${opened.error}`);
  return opened;
}

describe("the connect: discovery, registration and the authorization request (AC6)", () => {
  it("reads the protected-resource metadata first, then the authorization-server metadata, then registers", async () => {
    const f = await server();
    const opened = await openOk(oauth(), f);
    const order = f.paths.filter((p) => p.includes(".well-known") || p === "POST /register");
    expect(order.at(0)).toMatch(/^GET \/\.well-known\/oauth-protected-resource/);
    const as = order.findIndex((p) => p === "GET /.well-known/oauth-authorization-server");
    expect(as).toBeGreaterThan(0);
    expect(order.at(-1)).toBe("POST /register");
    expect(opened.expires_at).toBe(new Date(env.now().getTime() + 10 * 60 * 1000).toISOString());
  });

  it("registers dynamically with the loopback redirect, as a public client for the authorization-code and refresh grants", async () => {
    const f = await server();
    await openOk(oauth(), f);
    expect(f.registrations).toHaveLength(1);
    const body = f.registrations[0] as Record<string, unknown>;
    const redirect = redirectOf(f);
    expect(redirect.protocol).toBe("http:");
    expect(redirect.hostname).toBe("127.0.0.1");
    expect(redirect.pathname).toBe(MCP_CALLBACK_PATH);
    expect(Number(redirect.port)).toBeGreaterThan(0);
    expect(body["grant_types"]).toEqual(["authorization_code", "refresh_token"]);
    expect(body["response_types"]).toEqual(["code"]);
    expect(body["token_endpoint_auth_method"]).toBe("none");
    expect(body["client_name"]).toBe("Loomwright Studio");
  });

  it("sends the authorization request with PKCE S256, the client id, the redirect, a 256-bit state and the resource", async () => {
    const f = await server();
    const opened = await openOk(oauth(), f);
    const url = new URL(opened.authorize_url);
    expect(url.origin).toBe(f.origin);
    expect(url.pathname).toBe("/authorize");
    const q = Object.fromEntries(url.searchParams.entries());
    expect(q["response_type"]).toBe("code");
    expect(q["client_id"]).toBe("fake-client-1");
    expect(q["code_challenge_method"]).toBe("S256");
    expect(q["code_challenge"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q["redirect_uri"]).toBe(redirectOf(f).toString());
    expect(q["state"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q["resource"]).toBe(f.mcpUrl);
    expect(q["scope"]).toBeUndefined();
  });

  it("asks for the scope the connector's definition names, in the registration and the request", async () => {
    const f = await server();
    const opened = await open(oauth(), f, stored, { scope: "read:jira-work offline_access" });
    if (!opened.ok) throw new Error("refused");
    expect(new URL(opened.authorize_url).searchParams.get("scope")).toBe("read:jira-work offline_access");
    expect(f.registrations[0]?.["scope"]).toBe("read:jira-work offline_access");
  });

  it("the challenge is the S256 of the verifier the token call then proves", async () => {
    const f = await server();
    const opened = await openOk(oauth(), f);
    const challenge = new URL(opened.authorize_url).searchParams.get("code_challenge");
    const res = await f.browse(opened.authorize_url);
    expect(res.status).toBe(200);
    const outcome = await opened.done;
    expect(outcome).toEqual({ ok: true, value: "stored" });
    const verifier = f.tokenRequests[0]?.["code_verifier"] as string;
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
    const token = f.tokenRequests[0] as Record<string, string>;
    expect(token["grant_type"]).toBe("authorization_code");
    expect(token["redirect_uri"]).toBe(redirectOf(f).toString());
    expect(token["resource"]).toBe(f.mcpUrl);
  });

  it("hands onReturn the grant (tokens, client id, the authorization server, an expiry from the clock) and shows a page that echoes nothing", async () => {
    const f = await server();
    const seen: McpGrant[] = [];
    const opened = await openOk(oauth(), f, (grant) => {
      seen.push(grant);
      return Promise.resolve({ ok: true, value: "stored" });
    });
    const res = await f.browse(opened.authorize_url);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Done");
    for (const secret of f.secrets()) expect(res.text).not.toContain(secret);
    expect(res.text).not.toContain(new URL(opened.authorize_url).searchParams.get("state") as string);
    await opened.done;
    expect(seen).toHaveLength(1);
    const grant = seen[0] as McpGrant;
    expect(grant.accessToken).toBe(f.access());
    expect(grant.refreshToken).toBe(f.refresh());
    expect(grant.clientId).toBe("fake-client-1");
    expect(grant.authorizationServerUrl).toBe(f.origin);
    expect(grant.expiresAt).toBe(new Date(env.now().getTime() + 3600 * 1000).toISOString());
    expect(grant.kind).toBe("jira");
  });

  it("refuses a server whose metadata lists PKCE methods without S256, and one with no authorization-server metadata", async () => {
    const noS256 = await server({ noS256: true });
    expect(await open(oauth(), noS256)).toEqual({ ok: false, error: "discovery_failed" });
    await noS256.close();
    const none = await server({ noAuthServerMetadata: true });
    expect(await open(oauth(), none)).toEqual({ ok: false, error: "discovery_failed" });
  });

  it("refuses a server with no registration endpoint (registration_unsupported) and closes the listener it opened", async () => {
    const f = await server({ registration: false });
    const o = oauth();
    expect(await open(o, f)).toEqual({ ok: false, error: "registration_unsupported" });
    expect(o.isOpen()).toBe(false);
    expect(f.registrations).toEqual([]);
    // The window is gone: a second connect is not "in progress".
    const again = await server();
    expect((await open(o, again)).ok).toBe(true);
  });

  it("refuses an http server address that is not loopback-allowed, before calling it", async () => {
    const f = await server();
    const strict = createMcpOAuth({});
    expect(await strict.open({ kind: "jira", serverUrl: f.mcpUrl, now: env.now, onReturn: stored })).toEqual({ ok: false, error: "server_url_refused" });
    expect(f.paths).toEqual([]);
    expect(strict.isOpen()).toBe(false);
  });
});

describe("the loopback listener (AC6)", () => {
  it("is bound to 127.0.0.1 only", async () => {
    const f = await server();
    const o = oauth();
    await openOk(o, f);
    const address = o.listenerAddress() as AddressInfo;
    expect(address.address).toBe("127.0.0.1");
    expect(address.family).toBe("IPv4");
    // Nothing answers on a non-loopback address of this machine, when it has one.
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((i) => i !== undefined && i.family === "IPv4" && !i.internal);
    if (lan !== undefined) expect(await accepts(address.port, lan.address)).toBe(false);
  });

  it("refuses a second connect while a window is open, then lets one open once the first is cancelled", async () => {
    const f = await server();
    const o = oauth();
    const first = await openOk(o, f);
    expect(await open(o, f, stored, { kind: "clickup" })).toEqual({ ok: false, error: "connect_in_progress" });
    expect(await open(o, f)).toEqual({ ok: false, error: "connect_in_progress" });
    // Refusing did not disturb the open window: it still takes the return.
    expect(o.cancel("jira")).toBe(true);
    expect(await first.done).toEqual({ ok: false, reason: "cancelled" });
    expect((await open(o, f, stored, { kind: "clickup" })).ok).toBe(true);
  });

  it("closes the listener on cancel, and only for the window's own kind", async () => {
    const f = await server();
    const o = oauth();
    const opened = await openOk(o, f);
    const port = (o.listenerAddress() as AddressInfo).port;
    expect(await accepts(port)).toBe(true);
    expect(o.cancel("clickup")).toBe(false);
    expect(o.isOpen()).toBe(true);
    expect(await accepts(port)).toBe(true);
    expect(o.cancel("jira")).toBe(true);
    expect(o.isOpen()).toBe(false);
    expect(await accepts(port)).toBe(false);
    expect(await opened.done).toEqual({ ok: false, reason: "cancelled" });
    expect(o.cancel("jira")).toBe(false);
  });

  it("closes the listener when the window expires, and the outcome says so", async () => {
    const f = await server();
    const o = oauth({ windowMs: 40 });
    const opened = await openOk(o, f);
    const port = (o.listenerAddress() as AddressInfo).port;
    expect(await opened.done).toEqual({ ok: false, reason: "window_expired" });
    expect(o.isOpen()).toBe(false);
    expect(await accepts(port)).toBe(false);
  });

  it("treats a window past its life as closed even before its timer fires: a return finds it expired and a new connect replaces it", async () => {
    const f = await server();
    const o = oauth();
    const first = await openOk(o, f);
    const port = (o.listenerAddress() as AddressInfo).port;
    env.advance(11 * 60 * 1000);
    const late = await f.browse(first.authorize_url);
    expect(late.status).toBe(400);
    expect(late.text).toContain("timed out");
    expect(await first.done).toEqual({ ok: false, reason: "window_expired" });
    expect(await accepts(port)).toBe(false);
    expect((await open(o, f)).ok).toBe(true);
  });

  it("closes the listener once the return settles the window", async () => {
    const f = await server();
    const o = oauth();
    const opened = await openOk(o, f);
    const port = (o.listenerAddress() as AddressInfo).port;
    await f.browse(opened.authorize_url);
    await opened.done;
    expect(o.isOpen()).toBe(false);
    expect(await accepts(port)).toBe(false);
  });

  it("answers only GET on its one path", async () => {
    const f = await server();
    const o = oauth();
    await openOk(o, f);
    const port = (o.listenerAddress() as AddressInfo).port;
    expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}${MCP_CALLBACK_PATH}`, { method: "POST" })).status).toBe(404);
    expect(o.isOpen()).toBe(true);
  });

  it("refuses a request whose Host is not the listener's own address (DNS rebinding), leaving the window as it was", async () => {
    const f = await server();
    const o = oauth();
    const opened = await openOk(o, f);
    const port = (o.listenerAddress() as AddressInfo).port;
    const callback = await f.authorize(opened.authorize_url);
    const path = `${new URL(callback).pathname}${new URL(callback).search}`;
    const evil = await rawGet(port, path, "evil.example");
    expect(evil.status).toBe(400);
    expect(o.isOpen()).toBe(true);
    const good = await rawGet(port, path, `127.0.0.1:${port}`);
    expect(good.status).toBe(200);
    expect(await opened.done).toEqual({ ok: true, value: "stored" });
  });
});

describe("the state (AC1, AC6)", () => {
  it("a wrong or missing state is refused and the window stays as it was; the right one still works", async () => {
    const f = await server();
    const o = oauth();
    const opened = await openOk(o, f);
    const port = (o.listenerAddress() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}${MCP_CALLBACK_PATH}`;
    const wrong = await fetch(`${base}?code=abc&state=${"A".repeat(43)}`);
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).not.toContain("A".repeat(43));
    expect((await fetch(`${base}?code=abc`)).status).toBe(400);
    expect(o.isOpen()).toBe(true);
    expect(f.tokenRequests).toEqual([]);
    const ok = await f.browse(opened.authorize_url);
    expect(ok.status).toBe(200);
    expect(await opened.done).toEqual({ ok: true, value: "stored" });
  });

  it("a second use of the same state is refused: only one code exchange happens", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await server({ tokenGate: gate });
    const o = oauth();
    const opened = await openOk(o, f);
    const callback = await f.authorize(opened.authorize_url);
    // The first use is mid-exchange (the token endpoint is held); the replay arrives now.
    const first = fetch(callback);
    await vi.waitFor(() => expect(f.tokenRequests).toHaveLength(1));
    const replay = await fetch(callback);
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("not valid");
    release();
    expect((await first).status).toBe(200);
    expect(await opened.done).toEqual({ ok: true, value: "stored" });
    expect(f.tokenRequests).toHaveLength(1);
  });

  it("a second use after the window settled finds no listener at all", async () => {
    const f = await server();
    const o = oauth();
    const opened = await openOk(o, f);
    const callback = await f.authorize(opened.authorize_url);
    expect((await fetch(callback)).status).toBe(200);
    await opened.done;
    await expect(fetch(callback)).rejects.toThrow();
  });

  it("mints a fresh state for every window", async () => {
    const f = await server();
    const o = oauth();
    const a = await openOk(o, f);
    o.cancel("jira");
    const b = await openOk(o, f);
    const stateOf = (u: string): string => new URL(u).searchParams.get("state") as string;
    expect(stateOf(a.authorize_url)).not.toBe(stateOf(b.authorize_url));
  });
});

describe("how a window ends", () => {
  it("an authorization the service denied settles authorization_denied and closes the listener", async () => {
    const f = await server();
    const o = oauth();
    const opened = await openOk(o, f);
    const port = (o.listenerAddress() as AddressInfo).port;
    const state = new URL(opened.authorize_url).searchParams.get("state") as string;
    const res = await fetch(`http://127.0.0.1:${port}${MCP_CALLBACK_PATH}?error=access_denied&state=${state}`);
    expect(res.status).toBe(400);
    expect(await opened.done).toEqual({ ok: false, reason: "authorization_denied" });
    expect(await accepts(port)).toBe(false);
    expect(f.tokenRequests).toEqual([]);
  });

  it("a code the token endpoint refuses settles token_exchange_failed, calls onReturn never, and echoes nothing", async () => {
    const f = await server();
    const onReturn = vi.fn(stored);
    const o = oauth();
    const opened = await openOk(o, f, onReturn);
    const port = (o.listenerAddress() as AddressInfo).port;
    const state = new URL(opened.authorize_url).searchParams.get("state") as string;
    const res = await fetch(`http://127.0.0.1:${port}${MCP_CALLBACK_PATH}?code=not-a-code&state=${state}`);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("not-a-code");
    expect(text).not.toContain(state);
    expect(await opened.done).toEqual({ ok: false, reason: "token_exchange_failed" });
    expect(onReturn).not.toHaveBeenCalled();
  });

  it("a return that is missing its code settles token_exchange_failed without calling the token endpoint", async () => {
    const f = await server();
    const o = oauth();
    const opened = await openOk(o, f);
    const port = (o.listenerAddress() as AddressInfo).port;
    const state = new URL(opened.authorize_url).searchParams.get("state") as string;
    expect((await fetch(`http://127.0.0.1:${port}${MCP_CALLBACK_PATH}?state=${state}`)).status).toBe(400);
    expect(await opened.done).toEqual({ ok: false, reason: "token_exchange_failed" });
    expect(f.tokenRequests).toEqual([]);
  });

  it("a failing onReturn settles with its reason and shows its fixed page; a throwing one is connect_failed", async () => {
    const f = await server();
    const o = oauth();
    const failing = await openOk(o, f, () => Promise.resolve({ ok: false, reason: "tools_list_failed" }));
    const res = await f.browse(failing.authorize_url);
    expect(res.status).toBe(502);
    expect(res.text).toContain("could not read the service&#39;s tools");
    expect(await failing.done).toEqual({ ok: false, reason: "tools_list_failed" });

    const throwing = await openOk(o, f, () => Promise.reject(new Error(`boom ${f.access()}`)));
    const second = await f.browse(throwing.authorize_url);
    expect(second.status).toBe(502);
    expect(second.text).not.toContain(f.access());
    expect(await throwing.done).toEqual({ ok: false, reason: "connect_failed" });
  });

  it("a cancel during the exchange stores nothing: onReturn is never called", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await server({ tokenGate: gate });
    const onReturn = vi.fn(stored);
    const o = oauth();
    const opened = await openOk(o, f, onReturn);
    const callback = await f.authorize(opened.authorize_url);
    const pending = fetch(callback);
    await vi.waitFor(() => expect(f.tokenRequests).toHaveLength(1));
    expect(o.cancel("jira")).toBe(true);
    release();
    // The cancel closed the listener and every connection on it, the browser's included.
    await expect(pending).rejects.toThrow();
    expect(await opened.done).toEqual({ ok: false, reason: "cancelled" });
    expect(onReturn).not.toHaveBeenCalled();
  });

  it("once the sign-in is being stored a cancel no longer ends the window, and the connect completes", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await server();
    const o = oauth();
    const opened = await openOk(o, f, async () => {
      await gate;
      return { ok: true, value: "stored" };
    });
    const pending = f.browse(opened.authorize_url);
    await vi.waitFor(() => expect(f.tokenRequests).toHaveLength(1));
    await vi.waitFor(() => expect(o.cancel("jira")).toBe(false));
    expect(o.isOpen()).toBe(true);
    release();
    expect((await pending).status).toBe(200);
    expect(await opened.done).toEqual({ ok: true, value: "stored" });
  });

  it("a token answer with no expires_in leaves the grant with no expiry", async () => {
    const f = await server({ accessTtlSeconds: null });
    const seen: McpGrant[] = [];
    const opened = await openOk(oauth(), f, (grant) => {
      seen.push(grant);
      return Promise.resolve({ ok: true, value: "stored" });
    });
    await f.browse(opened.authorize_url);
    await opened.done;
    expect(seen[0]?.expiresAt).toBeUndefined();
  });

  it("a client secret the registration returns reaches the grant, never the page", async () => {
    const f = await server({ clientSecret: "client-secret-0123456789" });
    const seen: McpGrant[] = [];
    const opened = await openOk(oauth(), f, (grant) => {
      seen.push(grant);
      return Promise.resolve({ ok: true, value: "stored" });
    });
    const res = await f.browse(opened.authorize_url);
    expect(res.text).not.toContain("client-secret-0123456789");
    await opened.done;
    expect(seen[0]?.clientSecret).toBe("client-secret-0123456789");
  });
});

describe("failures while a window is being opened or served", () => {
  it("two connects racing each other open exactly one window", async () => {
    const f = await server();
    const o = oauth();
    const [a, b] = await Promise.all([open(o, f), open(o, f, stored, { kind: "clickup" })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((x) => !x.ok)).toEqual({ ok: false, error: "connect_in_progress" });
    expect(f.registrations).toHaveLength(1);
  });

  it("a listener that cannot bind is listener_failed, and leaves no window", async () => {
    const f = await server();
    const o = oauth();
    const spy = vi.spyOn(Server.prototype, "listen").mockImplementation(function (this: Server) {
      queueMicrotask(() => this.emit("error", new Error("EADDRINUSE")));
      return this;
    });
    expect(await open(o, f)).toEqual({ ok: false, error: "listener_failed" });
    spy.mockRestore();
    expect(o.isOpen()).toBe(false);
    expect(f.paths).toEqual([]);
    expect((await open(o, f)).ok).toBe(true);
  });

  it("a registration the server refuses is registration_failed, and closes the listener", async () => {
    const f = await server({ registrationFails: true });
    const o = oauth();
    expect(await open(o, f)).toEqual({ ok: false, error: "registration_failed" });
    expect(o.isOpen()).toBe(false);
  });

  it("a cancel while discovery is in flight stops the open: cancelled, nothing registered after", async () => {
    const f = await server();
    const o = oauth();
    const pending = open(o, f);
    // The window is taken before anything is awaited, so a cancel finds it.
    expect(o.cancel("jira")).toBe(true);
    expect(await pending).toEqual({ ok: false, error: "cancelled" });
    expect(o.isOpen()).toBe(false);
  });

  it("an unexpected throw while serving the return is one fixed page, ends the window and echoes nothing", async () => {
    const f = await server();
    const o = oauth();
    let calls = 0;
    const opened = await o.open<string>({
      kind: "jira",
      serverUrl: f.mcpUrl,
      now: () => {
        if (calls++ > 0) throw new Error("clock broke: secret-in-message");
        return env.now();
      },
      onReturn: stored,
    });
    if (!opened.ok) throw new Error("refused");
    const res = await f.browse(opened.authorize_url);
    expect(res.status).toBe(500);
    expect(res.text).not.toContain("secret-in-message");
    expect(await opened.done).toEqual({ ok: false, reason: "connect_failed" });
    expect(o.isOpen()).toBe(false);
  });

  it("an expires_in of zero is no expiry", async () => {
    const f = await server({ accessTtlSeconds: 0 });
    const seen: McpGrant[] = [];
    const opened = await openOk(oauth(), f, (grant) => {
      seen.push(grant);
      return Promise.resolve({ ok: true, value: "stored" });
    });
    await f.browse(opened.authorize_url);
    await opened.done;
    expect(seen[0]?.expiresAt).toBeUndefined();
  });
});

describe("the guarded fetch and the URL policy", () => {
  it("allows https, and http only on loopback and only when turned on; never a URL with credentials", () => {
    expect(mcpUrlAllowed("https://mcp.example.test/mcp")).toBe(true);
    expect(mcpUrlAllowed("http://mcp.example.test/mcp")).toBe(false);
    expect(mcpUrlAllowed("http://127.0.0.1:9/mcp")).toBe(false);
    expect(mcpUrlAllowed("http://127.0.0.1:9/mcp", true)).toBe(true);
    expect(mcpUrlAllowed("http://localhost:9/mcp", true)).toBe(true);
    expect(mcpUrlAllowed("http://mcp.example.test/mcp", true)).toBe(false);
    expect(mcpUrlAllowed("https://user:pw@mcp.example.test/mcp")).toBe(false);
    expect(mcpUrlAllowed("file:///etc/passwd", true)).toBe(false);
    expect(mcpUrlAllowed("not a url")).toBe(false);
  });

  it("refuses a URL the policy does not allow before any request, and never follows a POST's redirect", async () => {
    const calls: string[] = [];
    const stub = vi.fn((url: string | URL) => {
      calls.push(String(url));
      return Promise.resolve(new Response(null, { status: 307, headers: { location: "https://elsewhere.example.test/steal" } }));
    });
    const guarded = guardedFetch({ fetch: stub as unknown as typeof fetch });
    await expect(guarded("http://plain.example.test/token", { method: "POST" })).rejects.toMatchObject({ code: "refused_url" });
    expect(calls).toEqual([]);
    await expect(guarded("https://as.example.test/token", { method: "POST", body: "refresh_token=secret" })).rejects.toMatchObject({ code: "protocol" });
    expect(calls).toEqual(["https://as.example.test/token"]);
  });

  it("follows a GET redirect at most three hops, re-checking each", async () => {
    let n = 0;
    const stub = vi.fn(() => {
      n++;
      return Promise.resolve(new Response(null, { status: 302, headers: { location: `https://as.example.test/hop${n}` } }));
    });
    await expect(guardedFetch({ fetch: stub as unknown as typeof fetch })("https://as.example.test/start")).rejects.toMatchObject({ code: "protocol" });
    expect(stub).toHaveBeenCalledTimes(4);
    const toPlain = vi.fn(() => Promise.resolve(new Response(null, { status: 302, headers: { location: "http://plain.example.test/x" } })));
    await expect(guardedFetch({ fetch: toPlain as unknown as typeof fetch })("https://as.example.test/start")).rejects.toMatchObject({ code: "refused_url" });
  });

  it("hands back a status that has no body as a body-less response", async () => {
    const empty = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const res = await guardedFetch({ fetch: empty as unknown as typeof fetch })("https://as.example.test/x");
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it("reads an answer only up to its bound", async () => {
    const big = vi.fn(() => Promise.resolve(new Response("x".repeat(1024 * 1024 + 10), { status: 200 })));
    await expect(guardedFetch({ fetch: big as unknown as typeof fetch })("https://as.example.test/meta")).rejects.toMatchObject({ code: "protocol" });
    const small = vi.fn(() => Promise.resolve(new Response('{"a":1}', { status: 200, headers: { "content-type": "application/json" } })));
    const res = await guardedFetch({ fetch: small as unknown as typeof fetch })("https://as.example.test/meta");
    expect(await res.json()).toEqual({ a: 1 });
  });
});

describe("the token refresh (AC4, AC7)", () => {
  /** Run a connect through to a credential the way the connector builds it. */
  async function credentialFrom(f: FakeMcp) {
    const seen: McpGrant[] = [];
    const opened = await openOk(oauth(), f, (grant) => {
      seen.push(grant);
      return Promise.resolve({ ok: true, value: "stored" });
    });
    await f.browse(opened.authorize_url);
    await opened.done;
    const g = seen[0] as McpGrant;
    return {
      access_token: g.accessToken,
      ...(g.refreshToken === undefined ? {} : { refresh_token: g.refreshToken }),
      client_id: g.clientId,
      authorization_server_url: g.authorizationServerUrl,
    };
  }

  it("trades the refresh token for new tokens, with an expiry from the clock; the old refresh token is kept when none is reissued", async () => {
    const f = await server();
    const credential = await credentialFrom(f);
    const oldAccess = f.access();
    const renewed = await refreshMcpTokens(f.mcpUrl, credential, env.now(), { allowLoopbackHttp: true });
    expect(renewed.access_token).toBe(f.access());
    expect(renewed.access_token).not.toBe(oldAccess);
    expect(renewed.refresh_token).toBe(f.refresh());
    expect(renewed.expires_at).toBe(new Date(env.now().getTime() + 3600 * 1000).toISOString());
    const call = f.tokenRequests.at(-1) as Record<string, string>;
    expect(call["grant_type"]).toBe("refresh_token");
    expect(call["client_id"]).toBe("fake-client-1");
    expect(call["resource"]).toBe(f.mcpUrl);
  });

  it("classifies an invalid_grant answer as definitive, and a server error, a lost server or an unreadable answer as transient", async () => {
    const f = await server();
    const credential = await credentialFrom(f);
    f.refreshMode = "invalid_grant";
    await expect(refreshMcpTokens(f.mcpUrl, credential, env.now(), { allowLoopbackHttp: true })).rejects.toMatchObject({ name: "McpRefreshError", kind: "definitive" });
    f.refreshMode = "unavailable";
    await expect(refreshMcpTokens(f.mcpUrl, credential, env.now(), { allowLoopbackHttp: true })).rejects.toMatchObject({ kind: "transient" });
    await f.close();
    await expect(refreshMcpTokens(f.mcpUrl, credential, env.now(), { allowLoopbackHttp: true, timeoutMs: 2000 })).rejects.toBeInstanceOf(McpRefreshError);
    await expect(refreshMcpTokens(f.mcpUrl, credential, env.now(), { allowLoopbackHttp: true, timeoutMs: 2000 })).rejects.toMatchObject({ kind: "transient" });
  });

  it("a credential with no refresh token is a definitive failure, without calling anything", async () => {
    const f = await server({ refreshTokens: false });
    const credential = await credentialFrom(f);
    const before = f.tokenRequests.length;
    await expect(refreshMcpTokens(f.mcpUrl, credential, env.now(), { allowLoopbackHttp: true })).rejects.toMatchObject({ kind: "definitive" });
    expect(f.tokenRequests).toHaveLength(before);
  });

  it("carries no server text in the error it throws", async () => {
    const f = await server();
    const credential = await credentialFrom(f);
    f.refreshMode = "invalid_grant";
    const err = await refreshMcpTokens(f.mcpUrl, credential, env.now(), { allowLoopbackHttp: true }).then(
      () => new Error("no throw"),
      (e: unknown) => e as Error,
    );
    expect(err.message).not.toContain("revoked");
    for (const secret of f.secrets()) expect(`${err.message}${String(err.stack)}`).not.toContain(secret);
  });
});
