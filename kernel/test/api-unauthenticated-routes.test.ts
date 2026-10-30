// The unauthenticated browser-route mechanism (GitHub App connect, item 3): a
// route may be served without the API token only as a GET on exactly one of
// three listed paths. Pinned here with fixture routes, and over the shipped
// route table at the end of the file: the merge refusals, the server's
// own re-check of the method and the list (a hand-built `OwnedRoute` passed
// straight to `startApiServer`), the WebSocket upgrade keeping its 401, the
// browser answers (HTML page, 302) and their headers, the request's `origin`
// from the server's `address()` and the body of an unauthenticated request
// never being read. A real server on 127.0.0.1 and a temp data dir: never the
// real SDK, a model or the Keychain.
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { PHASE1_ROUTES, UNAUTHENTICATED_ROUTE_PATHS as SERVED_PATHS, startApiServer } from "../src/api/server.js";
import type { ApiServer } from "../src/api/server.js";
import { InvalidContributionError, UNAUTHENTICATED_ROUTE_PATHS, mergeContributions } from "../src/features/contribution.js";
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse, OwnedRoute } from "../src/features/contribution.js";
import { PHASE1_SUBCOMMANDS, SHIPPED_CONTRIBUTIONS } from "../src/features/index.js";
import { Store } from "../src/store/index.js";
import { KERNEL_TOOL_NAMES } from "../src/tools/server.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const TOKEN = "0123456789abcdef".repeat(4);
const NOW = new Date("2026-10-30T10:00:00.000Z");
const START = "/connectors/github/app/start";
const RETURN = "/connectors/github/app/return";
const INSTALLED = "/connectors/github/app/installed";
const PHASE1 = { tools: KERNEL_TOOL_NAMES, routes: PHASE1_ROUTES, subcommands: PHASE1_SUBCOMMANDS };

let tmp: string;
let store: Store;
const servers: ApiServer[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-unauth-"));
  store = new Store({ dataDir: join(tmp, "data") });
});

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  store.close();
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const page = (html: string): ContributedRouteResponse => ({ status: 200, body: null, browser: { html } });

/** A fixture route; `owner` is the contribution name `mergeContributions` would give it. */
function owned(method: ContributedRoute["method"], path: string, extra: Partial<OwnedRoute> = {}): OwnedRoute {
  return { owner: "fixture", method, path, handler: async () => page("<p>ok</p>"), ...extra };
}

async function serve(routes: readonly OwnedRoute[]): Promise<ApiServer> {
  const server = await startApiServer(
    {
      store,
      sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
      loop: { start: () => undefined, stop: async () => undefined },
      authProviders: [stubProvider()],
      token: TOKEN,
      port: 0,
      routes,
    },
    { now: () => NOW },
  );
  servers.push(server);
  return server;
}

interface Answer {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly text: string;
}

/** A raw request: any method, any headers (a `Host` of our own choosing), an optional body. */
function raw(server: ApiServer, method: string, path: string, init: { auth?: boolean; headers?: Record<string, string>; body?: string } = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...init.headers };
    if (init.auth === true) headers["Authorization"] = `Bearer ${TOKEN}`;
    // Node sends a GET's body unframed otherwise (the parser then reads it as a second request).
    if (init.body !== undefined) headers["Content-Length"] = String(Buffer.byteLength(init.body));
    const req = request({ host: "127.0.0.1", port: server.port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(init.body);
  });
}

function routeFailures(): { contributor: string; method: string; path: string; error: string }[] {
  return store
    .prepare<[], string>("SELECT payload_json FROM events WHERE kind = 'route_failed' ORDER BY id")
    .pluck()
    .all()
    .map((p) => JSON.parse(p) as { contributor: string; method: string; path: string; error: string });
}

function refusal(routes: readonly ContributedRoute[]): InvalidContributionError {
  try {
    mergeContributions([{ name: "probe", routes }], PHASE1);
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidContributionError);
    expect((err as InvalidContributionError).part).toBe("route");
    return err as InvalidContributionError;
  }
  throw new Error("expected the merge to refuse");
}

const fixture = (method: ContributedRoute["method"], path: string, extra: Partial<ContributedRoute> = {}): ContributedRoute => ({
  method,
  path,
  handler: async () => page("<p>ok</p>"),
  ...extra,
});

describe("the merge (Mechanism AC1)", () => {
  it("lists exactly three browser paths, frozen, and the server serves the same list", () => {
    expect(UNAUTHENTICATED_ROUTE_PATHS).toEqual([START, RETURN, INSTALLED]);
    expect(Object.isFrozen(UNAUTHENTICATED_ROUTE_PATHS)).toBe(true);
    expect(SERVED_PATHS).toBe(UNAUTHENTICATED_ROUTE_PATHS);
  });

  it("refuses a non-GET unauthenticated route, whatever its path", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const err = refusal([fixture(method, START, { unauthenticated: true })]);
      expect(err.message).toContain("only a GET");
    }
  });

  it("refuses an unauthenticated route whose path is off the list", () => {
    for (const path of ["/connectors/github/app/other", "/connectors/github/app/start/:id", "/status-page", "/connectors/github/app"]) {
      const err = refusal([fixture("GET", path, { unauthenticated: true })]);
      expect(err.message).toContain("not one of");
    }
  });

  it("refuses an unauthenticated flag that is not true", () => {
    refusal([fixture("GET", START, { unauthenticated: false as unknown as true })]);
  });

  it("accepts a GET on each listed path and carries the flag onto the merged route", () => {
    const routes = UNAUTHENTICATED_ROUTE_PATHS.map((path) => fixture("GET", path, { unauthenticated: true }));
    const merged = mergeContributions([{ name: "probe", routes }, { name: "gated", routes: [fixture("GET", "/gated")] }], PHASE1);
    expect(merged.routes.filter((r) => r.unauthenticated === true).map((r) => `${r.owner} ${r.method} ${r.path}`)).toEqual([
      `probe GET ${START}`,
      `probe GET ${RETURN}`,
      `probe GET ${INSTALLED}`,
    ]);
    const gated = merged.routes.find((r) => r.path === "/gated") as OwnedRoute;
    expect("unauthenticated" in gated).toBe(false);
  });

  it("keeps a route without the flag token-gated even on a listed path", () => {
    const merged = mergeContributions([{ name: "probe", routes: [fixture("POST", START), fixture("GET", RETURN)] }], PHASE1);
    expect(merged.routes.map((r) => r.unauthenticated)).toEqual([undefined, undefined]);
  });
});

describe("the no-token exception (Mechanism AC1, Error AC3)", () => {
  it("serves a GET to a browser route without the token: the page, with no-store and no-referrer", async () => {
    const server = await serve([owned("GET", START, { unauthenticated: true, handler: async () => page("<h1>Start</h1>") })]);
    const res = await raw(server, "GET", START);
    expect(res.status).toBe(200);
    expect(res.text).toBe("<h1>Start</h1>");
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["content-length"]).toBe(String(Buffer.byteLength("<h1>Start</h1>")));
    expect(res.headers["www-authenticate"]).toBeUndefined();
  });

  it("serves a wrong token as no token on a browser route (the browser never has one)", async () => {
    const server = await serve([owned("GET", START, { unauthenticated: true })]);
    const res = await raw(server, "GET", START, { headers: { Authorization: `Bearer ${"f".repeat(64)}` } });
    expect(res.status).toBe(200);
  });

  it("answers a redirect as 302 with its Location, no-store and no-referrer, and an empty body", async () => {
    const location = "https://github.com/apps/studio/installations/new?state=abc";
    const server = await serve([
      owned("GET", RETURN, { unauthenticated: true, handler: async () => ({ status: 302, body: null, browser: { redirect: location } }) }),
    ]);
    const res = await raw(server, "GET", RETURN);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe(location);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.text).toBe("");
  });

  it("hands the handler its query, a body of undefined and no params, and never reads an unauthenticated body", async () => {
    const seen: ContributedRouteRequest[] = [];
    const server = await serve([
      owned("GET", INSTALLED, {
        unauthenticated: true,
        handler: async (req) => {
          seen.push(req);
          return page("<p>fixed</p>");
        },
      }),
    ]);
    // A body that is not JSON: today's token-gated path would answer 400 invalid_json.
    const res = await raw(server, "GET", `${INSTALLED}?state=s1&code=c1`, { headers: { "Content-Type": "application/json" }, body: "{not json" });
    expect(res.status).toBe(200);
    expect(res.text).toBe("<p>fixed</p>");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.body).toBeUndefined();
    expect({ ...seen[0]?.query }).toEqual({ state: "s1", code: "c1" });
    expect(seen[0]?.params).toEqual({});
  });

  it("does not read an oversized unauthenticated body either (no 413)", async () => {
    const server = await serve([owned("GET", START, { unauthenticated: true })]);
    const res = await raw(server, "GET", START, { body: "x".repeat(1024 * 1024 + 10) });
    expect(res.status).toBe(200);
  });

  it("answers 401 to a POST to a browser path, even for a hand-built route {POST, unauthenticated} that skipped the merge", async () => {
    const handler = vi.fn(async () => page("<p>no</p>"));
    const server = await serve([owned("POST", START, { unauthenticated: true, handler })]);
    const res = await raw(server, "POST", START);
    expect(res.status).toBe(401);
    expect(res.text).toBe('{"error":"unauthorized"}');
    expect(res.headers["www-authenticate"]).toBe("Bearer");
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 401 to a HEAD to a browser path", async () => {
    const handler = vi.fn(async () => page("<p>no</p>"));
    const server = await serve([owned("GET", START, { unauthenticated: true, handler })]);
    const res = await raw(server, "HEAD", START);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 401 for a hand-built unauthenticated GET whose path is off the list", async () => {
    const handler = vi.fn(async () => page("<p>no</p>"));
    const server = await serve([owned("GET", "/connectors/github/app/other", { unauthenticated: true, handler }), owned("GET", "/things/:id", { unauthenticated: true, handler })]);
    expect((await raw(server, "GET", "/connectors/github/app/other")).status).toBe(401);
    expect((await raw(server, "GET", "/things/1")).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 401 for a listed path whose route does not declare the flag, and for a path variant", async () => {
    const handler = vi.fn(async () => page("<p>no</p>"));
    const server = await serve([owned("GET", START, { handler }), owned("GET", RETURN, { unauthenticated: true, handler })]);
    expect((await raw(server, "GET", START)).status).toBe(401);
    expect((await raw(server, "GET", `${RETURN}/`)).status).toBe(401);
    expect((await raw(server, "GET", `${RETURN}%2F`)).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 401 for every other route without the token, with a browser route registered", async () => {
    const gated = vi.fn(async () => ({ status: 200, body: { secret: true } }));
    const server = await serve([owned("GET", START, { unauthenticated: true }), owned("GET", "/gated", { handler: gated }), owned("POST", "/gated-post", { handler: gated })]);
    for (const [method, path] of [
      ["GET", "/status"],
      ["GET", "/gated"],
      ["POST", "/gated-post"],
      ["GET", "/nope"],
      ["POST", "/stop-all"],
    ] as const) {
      const res = await raw(server, method, path);
      expect([method, path, res.status, res.text]).toEqual([method, path, 401, '{"error":"unauthorized"}']);
    }
    expect(gated).not.toHaveBeenCalled();
  });

  it("answers 401 to a WebSocket upgrade to a browser path without the token", async () => {
    const handler = vi.fn(async () => page("<p>no</p>"));
    const server = await serve([owned("GET", START, { unauthenticated: true, handler })]);
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}${START}`);
    const refused = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      ws.on("unexpected-response", (_req, res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      });
      ws.on("open", () => reject(new Error("upgraded without the token")));
      ws.on("error", () => undefined);
    });
    expect(refused).toEqual({ status: 401, body: '{"error":"unauthorized"}' });
    expect(handler).not.toHaveBeenCalled();
  });

  it("still serves the token-gated routes and phase 1 with the token", async () => {
    const server = await serve([owned("GET", "/gated", { handler: async () => ({ status: 201, body: { ok: true } }) })]);
    const gated = await raw(server, "GET", "/gated", { auth: true });
    expect([gated.status, gated.text, gated.headers["content-type"]]).toEqual([201, '{"ok":true}', "application/json; charset=utf-8"]);
    expect((await raw(server, "GET", "/status", { auth: true })).status).toBe(200);
  });

  it("answers 404 / 405 only with the token on a browser path", async () => {
    const server = await serve([owned("GET", START, { unauthenticated: true })]);
    expect((await raw(server, "POST", START, { auth: true })).status).toBe(405);
    expect((await raw(server, "GET", RETURN, { auth: true })).status).toBe(404);
  });
});

describe("the browser answers", () => {
  const failing: [string, ContributedRouteResponse][] = [
    ["a redirect with a status other than 302", { status: 200, body: null, browser: { redirect: "https://github.com/x" } }],
    ["a redirect that is not absolute", { status: 302, body: null, browser: { redirect: "/connectors/github/app/start" } }],
    ["a redirect that is not http(s)", { status: 302, body: null, browser: { redirect: "javascript:alert(1)" } }],
    ["a redirect with a header-splitting address", { status: 302, body: null, browser: { redirect: "https://github.com/x\r\nSet-Cookie: a=b" } }],
    ["a page that is not a string", { status: 200, body: null, browser: { html: 42 as unknown as string } }],
    ["a browser form that is neither", { status: 200, body: null, browser: {} as unknown as { html: string } }],
    ["a page with a status that cannot carry a body", { status: 204, body: null, browser: { html: "<p>x</p>" } }],
  ];
  for (const [name, answer] of failing) {
    it(`is the route's 500 and one route_failed for ${name}`, async () => {
      const server = await serve([owned("GET", START, { unauthenticated: true, handler: async () => answer })]);
      const res = await raw(server, "GET", START);
      expect(res.status).toBe(500);
      expect(res.text).toBe('{"error":"internal_error"}');
      expect(res.headers["location"]).toBeUndefined();
      expect(routeFailures()).toHaveLength(1);
      expect(routeFailures()[0]).toMatchObject({ contributor: "fixture", method: "GET", path: START });
    });
  }

  it("is the 500 + route_failed for a token-gated route that answers the non-JSON form, and sends nothing of it", async () => {
    const server = await serve([owned("GET", "/gated", { handler: async () => page("<p>secret page</p>") })]);
    const res = await raw(server, "GET", "/gated", { auth: true });
    expect(res.status).toBe(500);
    expect(res.text).toBe('{"error":"internal_error"}');
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(routeFailures()).toHaveLength(1);
    expect(routeFailures()[0]).toMatchObject({ contributor: "fixture", method: "GET", path: "/gated" });
  });

  it("is the 500 + route_failed for a hand-built unauthenticated route off the {GET, listed path} rule that answers the non-JSON form, even with the token", async () => {
    const server = await serve([
      owned("POST", START, { unauthenticated: true, handler: async () => page("<p>x</p>") }),
      owned("GET", "/gated-too", { unauthenticated: true, handler: async () => page("<p>x</p>") }),
    ]);
    expect((await raw(server, "POST", START, { auth: true })).status).toBe(500);
    expect((await raw(server, "GET", "/gated-too", { auth: true })).status).toBe(500);
    expect(routeFailures()).toHaveLength(2);
  });

  it("answers an unauthenticated route that throws as a plain 500, with the cause only in the route_failed row", async () => {
    const server = await serve([
      owned("GET", START, {
        unauthenticated: true,
        handler: async () => {
          throw new Error("boom: internal detail");
        },
      }),
    ]);
    const res = await raw(server, "GET", START);
    expect(res.status).toBe(500);
    expect(res.text).toBe('{"error":"internal_error"}');
    expect(routeFailures()[0]?.error).toContain("boom");
  });

  it("leaves a JSON answer byte-identical, on an unauthenticated route too", async () => {
    const server = await serve([owned("GET", START, { unauthenticated: true, handler: async () => ({ status: 400, body: { error: "state_mismatch" } }) })]);
    const res = await raw(server, "GET", START);
    expect([res.status, res.text, res.headers["content-type"], res.headers["cache-control"]]).toEqual([
      400,
      '{"error":"state_mismatch"}',
      "application/json; charset=utf-8",
      "no-store",
    ]);
    expect(res.headers["referrer-policy"]).toBeUndefined();
  });
});

describe("the request origin", () => {
  it("is the server's own bound loopback origin, never the Host header", async () => {
    const origins: (string | undefined)[] = [];
    const handler = async (req: ContributedRouteRequest): Promise<ContributedRouteResponse> => {
      origins.push(req.origin);
      return page("<p>ok</p>");
    };
    const server = await serve([owned("GET", START, { unauthenticated: true, handler }), owned("GET", "/gated", { handler })]);
    const own = `http://127.0.0.1:${server.port}`;
    await raw(server, "GET", START, { headers: { Host: "evil.example:9" } });
    await raw(server, "GET", "/gated", { auth: true, headers: { Host: "localhost:1" } });
    await raw(server, "GET", START);
    expect(origins).toEqual([own, own, own]);
    expect(server.address()?.port).toBe(server.port);
  });
});

describe("the shipped route table (Error AC3)", () => {
  const shipped = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1).routes;
  const concrete = (path: string): string => path.replace(/:[A-Za-z_]+/g, "1");

  it("has exactly three unauthenticated routes: GET on the three browser paths, all the GitHub App setup's", () => {
    expect(shipped.filter((r) => r.unauthenticated === true).map((r) => `${r.owner} ${r.method} ${r.path}`)).toEqual([
      `integrations GET ${START}`,
      `integrations GET ${RETURN}`,
      `integrations GET ${INSTALLED}`,
    ]);
    // The two owner routes sit on the same prefix and stay token-gated.
    for (const path of ["/connectors/github/app/setup", "/connectors/github/app/setup/cancel"]) {
      const route = shipped.find((r) => r.path === path);
      expect(route?.method).toBe("POST");
      expect(route?.unauthenticated).toBeUndefined();
    }
  });

  it("answers 401 without the token to every other route, phase 1's and every contributed one, by its own method; only the three browser GETs are served", async () => {
    const server = await serve(shipped);
    const table = [...PHASE1_ROUTES, ...shipped].map((r) => [r.method, concrete(r.path)] as const);
    expect(table.length).toBeGreaterThan(30);
    const served: string[] = [];
    for (const [method, path] of table) {
      const res = await raw(server, method, path);
      if (res.status === 401) {
        expect(res.text).toBe('{"error":"unauthorized"}');
        continue;
      }
      served.push(`${method} ${path}`);
    }
    expect(served).toEqual([`GET ${START}`, `GET ${RETURN}`, `GET ${INSTALLED}`]);
  });
});
