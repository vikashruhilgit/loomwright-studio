// The token pin (Criterion 8): `kernel-connection.ts` never puts the API
// token in a log line (its own log, the console, stdout or stderr) or in
// anything it returns to the bridge, on any path: connected, a refusal, a
// failed or timed-out call, the feed. It also pins the CLI's order (api.json,
// the pid check, then the token) and that it connects only to 127.0.0.1.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_HOST, contractPath, createKernelConnection, resolveDataDir, tokenReaderFor } from "./kernel-connection";
import type { FeedSocket, KernelConnectionDeps } from "./kernel-connection";

/** A token of the kernel's shape that appears nowhere else, so any leak of it is visible. */
const TOKEN = "5ec2e7".padEnd(64, "a");

const logged: string[] = [];
let dataDir: string;

function writeApiInfo(info: unknown): void {
  writeFileSync(join(dataDir, "api.json"), typeof info === "string" ? info : JSON.stringify(info));
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const calls: { url: string; init: RequestInit }[] = [];

function deps(overrides: Partial<KernelConnectionDeps> = {}): KernelConnectionDeps {
  return {
    dataDir,
    readToken: async () => TOKEN,
    isPidAlive: () => true,
    fetch: (async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(200, { ok: "yes" });
    }) as typeof fetch,
    log: (line) => logged.push(line),
    ...overrides,
  };
}

/** Everything the module could have printed or handed back, as one string. */
function everythingSeen(results: readonly unknown[]): string {
  return [...logged, ...results.map((r) => JSON.stringify(r))].join("\n");
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "studio-app-conn-"));
  logged.length = 0;
  calls.length = 0;
  for (const method of ["log", "info", "warn", "error", "debug", "trace"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    vi.spyOn(stream, "write").mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
      logged.push(String(chunk));
      return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the token never leaves kernel-connection.ts", () => {
  it("connected: the token goes only into the Authorization header, never into the result or a log", async () => {
    writeApiInfo({ pid: 4242, port: 51_234 });
    const conn = createKernelConnection(deps());
    const results = [await conn.connection(), await conn.request({ method: "GET", path: "/status" })];
    expect(results[0]).toEqual({ state: "connected", port: 51_234 });
    expect(results[1]).toEqual({ ok: true, status: 200, body: { ok: "yes" } });
    expect(calls.map((c) => (c.init.headers as Record<string, string>).Authorization)).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
    expect(everythingSeen(results)).not.toContain(TOKEN);
  });

  it("a refusal, a 401, a failed call and a timeout: no token in any result or log", async () => {
    writeApiInfo({ pid: 4242, port: 51_234 });
    const answers: (() => Promise<Response>)[] = [
      async () => jsonResponse(409, { error: "not_running", status: "completed" }),
      async () => jsonResponse(401, { error: "unauthorized" }),
      async () => {
        // An error that (wrongly) carries the token must not carry it any further.
        throw new TypeError(`fetch failed for Bearer ${TOKEN}`);
      },
      async () => {
        throw Object.assign(new Error(`timed out with ${TOKEN}`), { name: "TimeoutError" });
      },
    ];
    const results: unknown[] = [];
    for (const answer of answers) {
      const conn = createKernelConnection(deps({ fetch: answer as unknown as typeof fetch }));
      results.push(await conn.request({ method: "POST", path: "/sessions/:id/stop", params: { id: 5 } }), await conn.connection());
    }
    expect(results[0]).toEqual({ ok: false, status: 409, body: { error: "not_running", status: "completed" } });
    expect(results[3]).toEqual({ state: "unreachable", reason: "token_rejected" });
    expect(results[5]).toEqual({ state: "unreachable", reason: "connection_failed" });
    expect(results[6]).toEqual({ ok: false, status: 0, connection: { state: "unreachable", reason: "timeout" } });
    expect(everythingSeen(results)).not.toContain(TOKEN);
  });

  it("the feed: the token goes only into the socket's headers, never into a frame, the result or a log", async () => {
    writeApiInfo({ pid: 4242, port: 51_234 });
    const on: Record<string, (...a: unknown[]) => void> = {};
    const sent: string[] = [];
    let opened: { url: string; headers: Readonly<Record<string, string>> } | undefined;
    const socket: FeedSocket = {
      on: ((event: string, listener: (...a: unknown[]) => void) => {
        on[event] = listener;
      }) as FeedSocket["on"],
      send: (data) => void sent.push(data),
      close: () => undefined,
    };
    const frames: unknown[] = [];
    const conn = createKernelConnection(
      deps({
        openSocket: (url, headers) => {
          opened = { url, headers };
          return socket;
        },
      }),
    );
    const result = await conn.openFeed(7, (frame) => frames.push(frame));
    on.open?.();
    on.message?.(JSON.stringify({ type: "event", id: 8, at: "2026-10-21T00:00:00.000Z", kind: "k", session_id: null, task_id: null, payload: {} }));
    on.message?.("not json");
    on.error?.(new Error(`socket error ${TOKEN}`));
    on.close?.(1013, Buffer.from("not yet"));
    expect(opened).toEqual({ url: `ws://${API_HOST}:51234/events/stream`, headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(sent).toEqual([JSON.stringify({ type: "subscribe", after: 7 })]);
    expect(frames).toEqual([
      { type: "event", id: 8, at: "2026-10-21T00:00:00.000Z", kind: "k", session_id: null, task_id: null, payload: {} },
      { type: "closed", code: 1013, reason: "not yet" },
    ]);
    expect(everythingSeen([result.state, ...frames])).not.toContain(TOKEN);
  });
});

describe("the CLI's order and the loopback-only rule", () => {
  it("no api.json: not installed, and the token is never read", async () => {
    const readToken = vi.fn(async () => TOKEN);
    const conn = createKernelConnection(deps({ readToken }));
    expect(await conn.connection()).toEqual({ state: "not_installed", dataDir });
    expect(readToken).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("a dead pid: unreachable, and the token is never read or sent", async () => {
    writeApiInfo({ pid: 4242, port: 51_234 });
    const readToken = vi.fn(async () => TOKEN);
    const conn = createKernelConnection(deps({ readToken, isPidAlive: () => false }));
    expect(await conn.request({ method: "GET", path: "/status" })).toEqual({ ok: false, status: 0, connection: { state: "unreachable", reason: "daemon_not_running" } });
    expect(readToken).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("an unreadable api.json, a missing item and a token of the wrong shape: unreachable, nothing sent", async () => {
    const cases: [unknown, () => Promise<string | undefined>, string][] = [
      ["{not json", async () => TOKEN, "api_info_unreadable"],
      [{ pid: 4242, port: 70_000 }, async () => TOKEN, "api_info_unreadable"],
      [{ pid: 4242, port: 51_234 }, async () => undefined, "token_unavailable"],
      [{ pid: 4242, port: 51_234 }, async () => `${TOKEN}\n`, "token_unavailable"],
      [
        { pid: 4242, port: 51_234 },
        async () => {
          throw new Error("the Keychain read failed");
        },
        "token_unavailable",
      ],
    ];
    for (const [info, readToken, reason] of cases) {
      writeApiInfo(info);
      expect(await createKernelConnection(deps({ readToken })).connection()).toEqual({ state: "unreachable", reason });
    }
    expect(calls).toEqual([]);
  });

  it("connects only to 127.0.0.1, and only to a contract route", async () => {
    writeApiInfo({ pid: 4242, port: 51_234 });
    const conn = createKernelConnection(deps());
    await conn.request({ method: "POST", path: "/approvals/:id/approve", params: { id: 12 }, body: { decision: "once" }, query: { x: "1" } });
    expect(calls[0]?.url).toBe("http://127.0.0.1:51234/approvals/12/approve?x=1");
    expect(calls[0]?.init.body).toBe(JSON.stringify({ decision: "once" }));
    for (const path of ["//evil.example/status", "/status/../stop-all", "/events/stream", "/nope", "http://127.0.0.1:1/status"]) {
      expect(await conn.request({ method: "GET", path })).toEqual({ ok: false, status: 400, body: { error: "not_in_contract" } });
    }
    expect(await conn.request({ method: "POST", path: "/approvals/:id/approve" })).toEqual({ ok: false, status: 400, body: { error: "not_in_contract" } });
    expect(calls).toHaveLength(1);
  });

  it("an answer that is not JSON, or a refusal with no error code, reads as invalid_response", async () => {
    writeApiInfo({ pid: 4242, port: 51_234 });
    const answers = [new Response("<html>", { status: 200 }), jsonResponse(500, { oops: true }), new Response("", { status: 502 })];
    const results = [];
    for (const answer of answers) results.push(await createKernelConnection(deps({ fetch: (async () => answer) as unknown as typeof fetch })).request({ method: "GET", path: "/agents" }));
    expect(results).toEqual([
      { ok: false, status: 200, body: { error: "invalid_response" } },
      { ok: false, status: 500, body: { error: "invalid_response" } },
      { ok: false, status: 502, body: { error: "invalid_response" } },
    ]);
  });

  it("fills a param URL-encoded, so a param can never add a path segment", () => {
    expect(contractPath({ method: "GET", path: "/threads/:agent", params: { agent: "../stop-all" } })).toBe("/threads/..%2Fstop-all");
    expect(contractPath({ method: "GET", path: "/playbooks/:ref", params: { ref: "pr review" } })).toBe("/playbooks/pr%20review");
  });

  it("refuses a param that is a dot-segment, which URL parsing would remove", async () => {
    // Each would otherwise be sent as POST /kill, POST /approvals/revoke, GET /agents/.
    const dotted = [
      { method: "POST", path: "/sessions/:id/kill", params: { id: ".." } },
      { method: "POST", path: "/approvals/grants/:id/revoke", params: { id: ".." } },
      { method: "GET", path: "/agents/:id", params: { id: "." } },
      { method: "GET", path: "/agents/:id", params: { id: { toString: () => ".." } } },
    ] as const;
    for (const req of dotted) expect(contractPath(req as never)).toBeUndefined();
    writeApiInfo({ pid: 4242, port: 51_234 });
    const conn = createKernelConnection(deps());
    for (const req of dotted) expect(await conn.request(req as never)).toEqual({ ok: false, status: 400, body: { error: "not_in_contract" } });
    expect(calls).toEqual([]);
    // Only the exact values `.` and `..` are dot-segments: an id with a dot in it still goes through.
    expect(contractPath({ method: "GET", path: "/agents/:id", params: { id: "v1.2" } })).toBe("/agents/v1.2");
    expect(contractPath({ method: "GET", path: "/agents/:id", params: { id: "..." } })).toBe("/agents/...");
    expect(contractPath({ method: "GET", path: "/agents/:id", params: { id: ".hidden" } })).toBe("/agents/.hidden");
    // Percent-encoded dots are encoded again, so they stay literal text.
    expect(contractPath({ method: "GET", path: "/agents/:id", params: { id: "%2e%2e" } })).toBe("/agents/%252e%252e");
  });

  it("refuses a param URL encoding cannot carry (a lone surrogate) or that cannot be coerced: not_in_contract, never a rejection", async () => {
    const unencodable = [
      { method: "GET", path: "/agents/:id", params: { id: "\ud800" } },
      { method: "POST", path: "/sessions/:id/kill", params: { id: "a\udfffb" } },
      {
        method: "GET",
        path: "/agents/:id",
        params: {
          id: {
            toString: () => {
              throw new Error("no");
            },
          },
        },
      },
    ] as const;
    for (const req of unencodable) expect(contractPath(req as never)).toBeUndefined();
    writeApiInfo({ pid: 4242, port: 51_234 });
    const conn = createKernelConnection(deps());
    for (const req of unencodable) expect(await conn.request(req as never)).toEqual({ ok: false, status: 400, body: { error: "not_in_contract" } });
    expect(calls).toEqual([]);
    // A paired surrogate is a whole character and still goes through.
    expect(contractPath({ method: "GET", path: "/agents/:id", params: { id: "😀" } })).toBe("/agents/%F0%9F%98%80");
  });

  it("a body JSON cannot carry (a cycle, a BigInt) answers invalid_json and sends nothing, never a rejection", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    writeApiInfo({ pid: 4242, port: 51_234 });
    const conn = createKernelConnection(deps());
    for (const body of [cyclic, { n: 1n }]) {
      expect(await conn.request({ method: "POST", path: "/stop-all", body })).toEqual({ ok: false, status: 400, body: { error: "invalid_json" } });
    }
    expect(calls).toEqual([]);
    expect(logged.join("\n")).not.toContain(TOKEN);
  });
});

describe("the fixture seam lives only in the main process's environment", () => {
  it("honours STUDIO_APP_FIXTURE_TOKEN only in an unpackaged run", async () => {
    const keychain = () => async () => "from-the-keychain";
    expect(await tokenReaderFor({ STUDIO_APP_FIXTURE_TOKEN: TOKEN }, false, keychain)()).toBe(TOKEN);
    // Packaged: the Keychain reader, whatever the environment says.
    expect(await tokenReaderFor({ STUDIO_APP_FIXTURE_TOKEN: TOKEN }, true, keychain)()).toBe("from-the-keychain");
    expect(await tokenReaderFor({}, false, keychain)()).toBe("from-the-keychain");
  });

  it("resolves the data dir exactly as the kernel does", () => {
    expect(resolveDataDir({}, "/Users/o")).toBe("/Users/o/.loomwright-studio");
    expect(resolveDataDir({ STUDIO_DATA_DIR: "/tmp/x" }, "/Users/o")).toBe("/tmp/x");
    expect(resolveDataDir({ STUDIO_DATA_DIR: "" }, "/Users/o")).toBe("/Users/o/.loomwright-studio");
  });
});
