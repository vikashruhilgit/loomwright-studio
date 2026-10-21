// The console's session output log (phase 5 item 03): the recorder
// (`createSessionOutputRecorder`, and `recordSessionOutput` the kernel wires),
// its rows, caps, decision matching, write-failure rule and throttled feed
// event; the `GET /sessions` and `GET /sessions/:id/output` routes; and the
// `studio sessions` verbs. A temp data dir, an in-memory Keychain, the fake
// spawner/query (session-fakes.ts), stub auth, an injected clock and timer:
// never the real SDK, a model, the Keychain or wall-clock waits.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallback, HookInput, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_TOKEN_KEYCHAIN_SERVICE } from "../src/api/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import {
  ASSISTANT_TEXT_CUT,
  MAX_OUTPUT_LIMIT,
  MAX_RECORDER_SESSIONS,
  MAX_SESSION_OUTPUT_BYTES,
  MAX_SESSION_OUTPUT_ROWS,
  OUTPUT_FEED_INTERVAL_MS,
  SESSIONS_HELP,
  TOOL_JSON_CUT,
  createSessionOutputRecorder,
  followSessionOutput,
  outputPart,
  sessionsSubcommand,
} from "../src/console/output.js";
import type { OutputTimer, SessionOutputRecorder } from "../src/console/output.js";
import { compileRoutePath, matchRoutePath } from "../src/features/index.js";
import type { CliApiClient, CliSubcommandOutput, ContributedRouteResponse, RouteMethod } from "../src/features/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel } from "../src/kernel.js";
import { SessionManager } from "../src/sessions/manager.js";
import type { ToolPolicy } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";
import type { FakeCall } from "./session-fakes.js";

let tmp: string;
const stores: Store[] = [];
const kernels: Kernel[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-output-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const k of kernels.splice(0)) await k.stop();
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

// ---- SDK messages (untyped stand-ins, as the fake CLI sends them) -------------

const as = (m: unknown): SDKMessage => m as SDKMessage;
const msg = {
  init: (model = "claude-haiku-4-5", tools: string[] = ["Bash", "Read"]) => as({ type: "system", subtype: "init", session_id: "s", model, tools }),
  text: (...texts: string[]) =>
    as({ type: "assistant", parent_tool_use_id: null, session_id: "s", message: { role: "assistant", content: texts.map((text) => ({ type: "text", text })) } }),
  toolUse: (id: string, name: string, input: unknown) =>
    as({ type: "assistant", parent_tool_use_id: null, session_id: "s", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } }),
  toolResult: (id: string, content: unknown, isError?: boolean) =>
    as({
      type: "user",
      parent_tool_use_id: null,
      session_id: "s",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, ...(isError === undefined ? {} : { is_error: isError }) }] },
    }),
  result: (usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 3, cache_read_input_tokens: 100 }) =>
    as({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
      session_id: "s",
      usage,
      modelUsage: { "claude-haiku-4-5": { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 3, cacheReadInputTokens: 100, costUSD: 0 } },
    }),
  streamEvent: () => as({ type: "stream_event", event: { type: "message_start" }, session_id: "s" }),
};

// ---- Store helpers -------------------------------------------------------------

type Row = { seq: number; kind: string; payload: Record<string, unknown> };

function openStore(name = "data"): Store {
  const store = new Store({ dataDir: join(tmp, name) });
  stores.push(store);
  return store;
}

function addSession(store: Store, fields: { agent?: string; status?: string; model?: string; cwd?: string; started?: string } = {}): number {
  return Number(
    store
      .prepare("INSERT INTO sessions (agent, status, model, cwd, started_at) VALUES (?, ?, ?, ?, ?)")
      .run(fields.agent ?? "wright", fields.status ?? "running", fields.model ?? "claude-haiku-4-5", fields.cwd ?? "/work", fields.started ?? "2026-10-21T09:00:00.000Z")
      .lastInsertRowid,
  );
}

function rows(store: Store, sessionId: number): Row[] {
  return store
    .prepare<[number], { seq: number; kind: string; payload_json: string }>("SELECT seq, kind, payload_json FROM session_output WHERE session_id = ? ORDER BY seq")
    .all(sessionId)
    .map((r) => ({ seq: r.seq, kind: r.kind, payload: JSON.parse(r.payload_json) as Record<string, unknown> }));
}

function eventsOf(store: Store, kind: string, sessionId: number): { id: number; at: string; payload: Record<string, unknown> }[] {
  return store
    .prepare<[string, number], { id: number; at: string; payload_json: string }>("SELECT id, at, payload_json FROM events WHERE kind = ? AND session_id = ? ORDER BY id")
    .all(kind, sessionId)
    .map((e) => ({ id: e.id, at: e.at, payload: JSON.parse(e.payload_json) as Record<string, unknown> }));
}

function addDecision(store: Store, sessionId: number, payload: Record<string, unknown>): void {
  store.prepare("INSERT INTO events (kind, actor, session_id, payload_json) VALUES ('tool_decision', 'kernel', ?, ?)").run(sessionId, JSON.stringify(payload));
}

/** An injected clock and timer: `advance` moves the clock and fires every due timer in order. */
function fakeTime(start = "2026-10-21T09:00:00.000Z") {
  const clock = { t: Date.parse(start) };
  const timers: { at: number; fn: () => void; cancelled: boolean; fired: boolean }[] = [];
  const setTimer = (fn: () => void, ms: number): OutputTimer => {
    const t = { at: clock.t + ms, fn, cancelled: false, fired: false };
    timers.push(t);
    return {
      cancel: () => {
        t.cancelled = true;
      },
    };
  };
  const live = () => timers.filter((t) => !t.cancelled && !t.fired);
  const advance = (ms: number): void => {
    const end = clock.t + ms;
    for (;;) {
      const next = live()
        .filter((t) => t.at <= end)
        .sort((a, b) => a.at - b.at)[0];
      if (next === undefined) break;
      clock.t = Math.max(clock.t, next.at);
      next.fired = true;
      next.fn();
    }
    clock.t = end;
  };
  return { now: () => new Date(clock.t), setTimer, advance, live, timers };
}

function recorderHarness() {
  const store = openStore();
  const time = fakeTime();
  const warn = vi.fn<(line: string) => void>();
  const recorder = createSessionOutputRecorder({ now: time.now, setTimer: time.setTimer, warn });
  const id = addSession(store);
  const record = (m: SDKMessage, sessionId = id): void => recorder.record(store, sessionId, m);
  return { store, time, warn, recorder, id, record };
}

// ---- The loopback API, without a socket: the output part's routes over a store ----

async function callRoute(store: Store, method: RouteMethod, pathWithQuery: string): Promise<ContributedRouteResponse> {
  const url = new URL(pathWithQuery, "http://127.0.0.1");
  const parts = url.pathname.slice(1).split("/");
  for (const route of outputPart.routes) {
    if (route.method !== method) continue;
    const params = matchRoutePath(compileRoutePath(route.path), parts);
    if (params === undefined) continue;
    return route.handler({ params, query: Object.fromEntries(url.searchParams), body: undefined, store, now: () => new Date() });
  }
  return { status: 404, body: { error: "no_route" } };
}

function routeClient(store: Store, onRequest?: (path: string) => void): CliApiClient {
  return {
    async request(method, path) {
      onRequest?.(path);
      return callRoute(store, method, path);
    },
  };
}

function capture(): CliSubcommandOutput & { out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    stdout: { write: (c: string) => (out += c) },
    stderr: { write: (c: string) => (err += c) },
    out: () => out,
    err: () => err,
  };
}

// ---- A kernel with fake sessions --------------------------------------------------

async function kernelWithFakes() {
  const items = new Map<string, string>();
  const keychain: KeychainReader = { read: (service) => items.get(service) };
  const writer: KeychainWriter = {
    add(service, _account, secret) {
      items.set(service, secret);
    },
  };
  const fakes = fakeSessions();
  const kernel = await startKernel(
    { dataDir: join(tmp, "kdata"), env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: makePluginDir(tmp), stopGraceMs: 10 } },
    {
      keychain,
      keychainWriter: writer,
      sessionDeps: fakes.deps,
      selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
      availableProviderIds: async () => ["api-key"],
    },
  );
  kernels.push(kernel);
  const get = async (path: string): Promise<{ status: number; body: unknown }> => {
    const res = await fetch(`http://127.0.0.1:${kernel.api.port}${path}`, { headers: { Authorization: `Bearer ${items.get(API_TOKEN_KEYCHAIN_SERVICE) as string}` } });
    return { status: res.status, body: await res.json() };
  };
  return { kernel, fakes, get };
}

/** Call `call`'s PreToolUse gate as the CLI would. */
async function gate(call: FakeCall, tool: string, input: unknown, cwd: string): Promise<{ permissionDecision: string; permissionDecisionReason: string }> {
  const hook = call.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
  const hookInput = { hook_event_name: "PreToolUse", tool_name: tool, tool_input: input, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd } as unknown as HookInput;
  const out = (await hook(hookInput, "toolu_1", { signal: new AbortController().signal })) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  };
  return out.hookSpecificOutput;
}

const kinds = (list: readonly { kind: string }[]): string[] => list.map((r) => r.kind);

// ---- AC1: a stand-in session's rows, in order, whichever of hook and message comes first ----

describe("a session's output log through the kernel (AC1)", () => {
  for (const order of ["after", "before"] as const) {
    it(`GET /sessions/:id/output answers system, assistant_text, tool_call, tool_decision (the gate's deny), result, seq increasing: hook called ${order} the tool_use message`, async () => {
      const { kernel, fakes, get } = await kernelWithFakes();
      const handle = await kernel.sessions.startSession(startParams(tmp));
      const call = fakes.calls[0] as FakeCall;
      const count = (): number => kernel.store.prepare<[number], number>("SELECT count(*) FROM session_output WHERE session_id = ?").pluck().get(handle.id) ?? 0;
      await vi.waitFor(() => expect(count()).toBe(1)); // the fake CLI's system/init
      call.stream.push(msg.text("Listing the directory."));
      await vi.waitFor(() => expect(count()).toBe(2));
      const command = { command: "ls /tmp", description: "list" };
      let decision: { permissionDecision: string; permissionDecisionReason: string } | undefined;
      if (order === "before") decision = await gate(call, "Bash", command, tmp);
      call.stream.push(msg.toolUse("toolu_1", "Bash", command));
      await vi.waitFor(() => expect(kinds(rows(kernel.store, handle.id))).toContain("tool_call"));
      if (order === "after") decision = await gate(call, "Bash", command, tmp);
      expect(decision).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "bash_prefix_not_allowed" });
      call.stream.push(msg.result());
      call.stream.end();
      expect(await handle.done).toBe("completed");

      const res = await get(`/sessions/${handle.id}/output`);
      expect(res.status).toBe(200);
      const body = res.body as { rows: { id: number; session_id: number; seq: number; kind: string; payload: Record<string, unknown>; created_at: string }[] };
      expect(kinds(body.rows)).toEqual(["system", "assistant_text", "tool_call", "tool_decision", "result"]);
      const seqs = body.rows.map((r) => r.seq);
      for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
      expect(body.rows.every((r) => r.session_id === handle.id)).toBe(true);
      expect(body.rows[0]?.payload).toEqual({ subtype: "init", model: null, tool_count: 0 });
      expect(body.rows[1]?.payload).toEqual({ text: "Listing the directory." });
      expect(body.rows[2]?.payload).toEqual({ tool_use_id: "toolu_1", name: "Bash", input_json: JSON.stringify(command) });
      // Copied whole from the kernel's own tool_decision event, never re-derived.
      const [event] = eventsOf(kernel.store, "tool_decision", handle.id);
      expect(body.rows[3]?.payload).toEqual(event?.payload);
      expect(body.rows[3]?.payload).toEqual({ tool: "Bash", decision: "deny", reason: "bash_prefix_not_allowed", command: "ls /tmp" });
      expect(body.rows[4]?.payload).toEqual({ subtype: "success", counted_tokens: 18 });
      expect(kernel.store.prepare("SELECT count(*) FROM events WHERE kind = 'observer_error'").pluck().get()).toBe(0);
    });
  }
});

describe("decision matching (the recorder, both arrival orders)", () => {
  it("holds a decision until a tool_call of its tool is recorded, matches FIFO per tool, and writes one with no call before the result", () => {
    const h = recorderHarness();
    h.record(msg.init());
    // Two decisions arrive before any call: Read's, then Bash's.
    addDecision(h.store, h.id, { tool: "Read", decision: "allow", reason: "tool_allowed" });
    addDecision(h.store, h.id, { tool: "Bash", decision: "deny", reason: "bash_prefix_not_allowed", command: "ls" });
    h.record(msg.text("thinking out loud"));
    expect(kinds(rows(h.store, h.id))).toEqual(["system", "assistant_text"]);
    h.record(msg.toolUse("t1", "Bash", { command: "ls" }));
    h.record(msg.toolUse("t2", "Bash", { command: "pwd" }));
    // The second Bash decision arrives after its call: written before the next message's rows.
    addDecision(h.store, h.id, { tool: "Bash", decision: "deny", reason: "bash_prefix_not_allowed", command: "pwd" });
    h.record(msg.toolResult("t1", "denied", true));
    // A decision for a tool never called (the Read one) is kept, before the result.
    h.record(msg.result());
    const all = rows(h.store, h.id);
    expect(all.map((r) => [r.kind, r.payload.command ?? r.payload.tool ?? r.payload.name ?? r.payload.subtype ?? null])).toEqual([
      ["system", "init"],
      ["assistant_text", null],
      ["tool_call", "Bash"],
      ["tool_decision", "ls"],
      ["tool_call", "Bash"],
      ["tool_decision", "pwd"],
      ["tool_result", null],
      ["tool_decision", "Read"],
      ["result", "success"],
    ]);
    expect(all.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(h.warn).not.toHaveBeenCalled();
  });

  it("copies each decision once: a second message drains nothing already copied", () => {
    const h = recorderHarness();
    h.record(msg.toolUse("t1", "Read", { file_path: "/x" }));
    addDecision(h.store, h.id, { tool: "Read", decision: "allow", reason: "tool_allowed" });
    h.record(msg.toolResult("t1", "contents"));
    h.record(msg.text("done"));
    h.record(msg.result());
    expect(kinds(rows(h.store, h.id))).toEqual(["tool_call", "tool_decision", "tool_result", "assistant_text", "result"]);
  });
});

// ---- AC2: the caps -------------------------------------------------------------------

describe("the caps (AC2)", () => {
  it(`a session of 2,500 one-row messages keeps ${MAX_SESSION_OUTPUT_ROWS} rows and one output_cut note, writes nothing after it, and ends normally with no observer_error`, async () => {
    const { kernel, fakes } = await kernelWithFakes();
    const handle = await kernel.sessions.startSession(startParams(tmp));
    const call = fakes.calls[0] as FakeCall;
    // The fake CLI's init is the first of the 2,500 one-row messages.
    for (let i = 1; i < 2_500; i++) call.stream.push(msg.text(`line ${i}`));
    call.stream.push(msg.result());
    call.stream.end();
    expect(await handle.done).toBe("completed");
    const all = rows(kernel.store, handle.id);
    expect(MAX_SESSION_OUTPUT_ROWS).toBe(2_000);
    expect(all).toHaveLength(2_001);
    expect(all.filter((r) => !(r.kind === "system" && r.payload.subtype === "output_cut"))).toHaveLength(2_000);
    expect(all.at(-1)).toEqual({ seq: 2_001, kind: "system", payload: { subtype: "output_cut", reason: "rows" } });
    expect(all.filter((r) => r.payload.subtype === "output_cut")).toHaveLength(1);
    expect(all.some((r) => r.kind === "result")).toBe(false);
    expect(kernel.store.prepare("SELECT status FROM sessions WHERE id = ?").pluck().get(handle.id)).toBe("completed");
    expect(kernel.store.prepare("SELECT count(*) FROM events WHERE kind = 'observer_error'").pluck().get()).toBe(0);
  }, 60_000);

  it(`stops at ${MAX_SESSION_OUTPUT_BYTES} bytes with one bytes cut note, and later messages never touch the store`, () => {
    const h = recorderHarness();
    const big = "x".repeat(7_000);
    for (let i = 0; i < 400; i++) h.record(msg.text(big));
    const all = rows(h.store, h.id);
    const content = all.slice(0, -1);
    expect(all.at(-1)).toMatchObject({ kind: "system", payload: { subtype: "output_cut", reason: "bytes" } });
    expect(content.length).toBeLessThan(MAX_SESSION_OUTPUT_ROWS);
    const bytes = h.store
      .prepare<[number], number>("SELECT sum(length(CAST(payload_json AS BLOB))) FROM session_output WHERE session_id = ? AND kind = 'assistant_text'")
      .pluck()
      .get(h.id) as number;
    expect(bytes).toBeLessThanOrEqual(MAX_SESSION_OUTPUT_BYTES);
    // The row that would have come next passes the cap.
    expect(bytes + Buffer.byteLength(JSON.stringify({ text: big }))).toBeGreaterThan(MAX_SESSION_OUTPUT_BYTES);
    const prepare = vi.spyOn(h.store, "prepare");
    h.record(msg.text("after the cut"));
    h.record(msg.result());
    expect(prepare).not.toHaveBeenCalled();
    expect(rows(h.store, h.id)).toHaveLength(all.length);
  });

  it("a recorder that restarts on the same store continues the log: next seq, row and byte totals, cut state, and no decision copied twice", () => {
    const h = recorderHarness();
    h.record(msg.toolUse("t1", "Read", { file_path: "/x" }));
    addDecision(h.store, h.id, { tool: "Read", decision: "allow", reason: "tool_allowed" });
    h.record(msg.toolResult("t1", "ok"));
    // The first recorder announced row 1; rows 2-3 wait on its trailing timer, which a restart never fires.
    expect(eventsOf(h.store, "session_output_appended", h.id).map((e) => e.payload)).toEqual([{ from_seq: 1, to_seq: 1 }]);
    const later = fakeTime();
    const again = createSessionOutputRecorder({ now: later.now, setTimer: later.setTimer, warn: h.warn });
    again.record(h.store, h.id, msg.text("resumed"));
    expect(rows(h.store, h.id).map((r) => [r.seq, r.kind])).toEqual([
      [1, "tool_call"],
      [2, "tool_decision"],
      [3, "tool_result"],
      [4, "assistant_text"],
    ]);
    // Its throttle was loaded too: within 250 ms of the last event it waits, then covers rows 2-4 in one event.
    expect(eventsOf(h.store, "session_output_appended", h.id)).toHaveLength(1);
    later.advance(OUTPUT_FEED_INTERVAL_MS);
    expect(eventsOf(h.store, "session_output_appended", h.id).map((e) => e.payload)).toEqual([
      { from_seq: 1, to_seq: 1 },
      { from_seq: 2, to_seq: 4 },
    ]);
  });

  it("a cut log stays cut after a restart: a new recorder writes nothing more", () => {
    const h = recorderHarness();
    for (let i = 0; i < 400; i++) h.record(msg.text("x".repeat(7_000)));
    const before = rows(h.store, h.id).length;
    const again = createSessionOutputRecorder({ now: h.time.now, setTimer: h.time.setTimer, warn: h.warn });
    again.record(h.store, h.id, msg.text("more"));
    again.record(h.store, h.id, msg.result());
    expect(rows(h.store, h.id)).toHaveLength(before);
  });
});

// ---- The recorder's state rebuilt from disk: a restart, or a dropped state ------------------

describe("the recorder's state rebuilt from disk", () => {
  const LOAD_SQL = "max(seq) AS max_seq";
  const loads = (spy: { mock: { calls: unknown[][] } }): number => spy.mock.calls.filter((c) => String(c[0]).includes(LOAD_SQL)).length;

  it("a restart mid-turn copies each decision once and loses none, though decisions were copied out of event order", () => {
    const h = recorderHarness();
    h.record(msg.toolUse("b", "Bash", { command: "ls" }));
    // Read's decision (hook before its message) is event r1, then Bash's b1.
    addDecision(h.store, h.id, { tool: "Read", decision: "allow", reason: "tool_allowed" });
    addDecision(h.store, h.id, { tool: "Bash", decision: "deny", reason: "bash_prefix_not_allowed", command: "ls" });
    h.record(msg.text("waiting"));
    // b1 is copied, r1 waits for its call.
    expect(kinds(rows(h.store, h.id))).toEqual(["tool_call", "tool_decision", "assistant_text"]);
    const again = createSessionOutputRecorder({ now: h.time.now, setTimer: h.time.setTimer, warn: h.warn });
    again.record(h.store, h.id, msg.toolUse("r", "Read", { file_path: "/x" }));
    again.record(h.store, h.id, msg.toolUse("b2", "Bash", { command: "pwd" }));
    again.record(h.store, h.id, msg.result());
    const all = rows(h.store, h.id);
    expect(all.map((r) => [r.kind, r.payload.name ?? r.payload.tool ?? r.payload.subtype ?? null])).toEqual([
      ["tool_call", "Bash"],
      ["tool_decision", "Bash"],
      ["assistant_text", null],
      ["tool_call", "Read"],
      ["tool_decision", "Read"],
      ["tool_call", "Bash"],
      ["result", "success"],
    ]);
    // Each event copied exactly once.
    const copied = all.filter((r) => r.kind === "tool_decision").map((r) => r.payload);
    expect(copied).toHaveLength(2);
    expect(new Set(copied.map((p) => JSON.stringify(p))).size).toBe(2);
  });

  it("a restart keeps a recorded call with no decision yet: its decision arriving later is written after it", () => {
    const h = recorderHarness();
    h.record(msg.toolUse("b", "Bash", { command: "ls" }));
    const again = createSessionOutputRecorder({ now: h.time.now, setTimer: h.time.setTimer, warn: h.warn });
    addDecision(h.store, h.id, { tool: "Bash", decision: "deny", reason: "bash_prefix_not_allowed", command: "ls" });
    again.record(h.store, h.id, msg.toolResult("b", "denied", true));
    expect(kinds(rows(h.store, h.id))).toEqual(["tool_call", "tool_decision", "tool_result"]);
  });

  for (const restart of [false, true]) {
    it(`a result ends the turn's calls with no decision: state ${restart ? "rebuilt" : "kept"}`, () => {
      const h = recorderHarness();
      h.record(msg.toolUse("b", "Bash", { command: "ls" }));
      // The result is within the interval: the state is kept, its timer armed.
      h.record(msg.result());
      const r = restart ? createSessionOutputRecorder({ now: h.time.now, setTimer: h.time.setTimer, warn: h.warn }) : h.recorder;
      addDecision(h.store, h.id, { tool: "Bash", decision: "allow", reason: "tool_allowed" });
      r.record(h.store, h.id, msg.toolUse("b2", "Bash", { command: "pwd" }));
      // The new decision belongs to the new call, not the finished turn's.
      expect(kinds(rows(h.store, h.id))).toEqual(["tool_call", "result", "tool_call", "tool_decision"]);
    });
  }

  it(`keeps at most ${MAX_RECORDER_SESSIONS} idle states: a dropped one is rebuilt with its pending decision and throttle`, () => {
    const h = recorderHarness();
    addDecision(h.store, h.id, { tool: "Read", decision: "allow", reason: "tool_allowed" });
    h.record(msg.text("first")); // drains Read's decision into pending
    h.time.advance(OUTPUT_FEED_INTERVAL_MS);
    for (let i = 0; i < MAX_RECORDER_SESSIONS; i++) h.record(msg.text("other"), addSession(h.store));
    expect(h.time.live()).toHaveLength(0);
    const prepare = vi.spyOn(h.store, "prepare");
    h.record(msg.toolUse("r", "Read", { file_path: "/x" }));
    expect(loads(prepare)).toBe(1);
    expect(kinds(rows(h.store, h.id))).toEqual(["assistant_text", "tool_call", "tool_decision"]);
    expect(eventsOf(h.store, "session_output_appended", h.id).map((e) => e.payload)).toEqual([
      { from_seq: 1, to_seq: 1 },
      { from_seq: 2, to_seq: 3 },
    ]);
    // A kept state is not reloaded.
    h.record(msg.text("again"));
    expect(loads(prepare)).toBe(1);
  });

  it("never drops a state with an armed timer: its range is announced, then a state past the bound is dropped", () => {
    const h = recorderHarness();
    h.record(msg.text("one"));
    h.record(msg.text("two")); // within the interval: the timer is armed
    // Every other session's timer is armed too, so none can be dropped: the map is one past the bound.
    for (let i = 0; i < MAX_RECORDER_SESSIONS; i++) {
      const other = addSession(h.store);
      h.record(msg.text("other"), other);
      h.record(msg.text("other again"), other);
    }
    expect(h.time.live()).toHaveLength(MAX_RECORDER_SESSIONS + 1);
    h.time.advance(OUTPUT_FEED_INTERVAL_MS);
    expect(eventsOf(h.store, "session_output_appended", h.id).map((e) => e.payload)).toEqual([
      { from_seq: 1, to_seq: 1 },
      { from_seq: 2, to_seq: 2 },
    ]);
    const prepare = vi.spyOn(h.store, "prepare");
    h.record(msg.text("three"));
    expect(loads(prepare)).toBe(1);
    expect(rows(h.store, h.id).map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it("a dropped cut state is rebuilt cut: nothing more is written", () => {
    const h = recorderHarness();
    for (let i = 0; i < 400; i++) h.record(msg.text("x".repeat(7_000)));
    const before = rows(h.store, h.id).length;
    h.time.advance(OUTPUT_FEED_INTERVAL_MS);
    for (let i = 0; i < MAX_RECORDER_SESSIONS; i++) h.record(msg.text("other"), addSession(h.store));
    h.record(msg.text("more"));
    h.record(msg.result());
    expect(rows(h.store, h.id)).toHaveLength(before);
  });
});

// ---- AC3: a failing store never fails a session ------------------------------------------

describe("a failing output log write (AC3)", () => {
  it("the session completes normally, warn is called exactly once for it, and no observer_error is written", async () => {
    const store = openStore();
    // The injected fault: every session_output write is refused.
    store.prepare("CREATE TRIGGER refuse_output BEFORE INSERT ON session_output BEGIN SELECT RAISE(ABORT, 'refused by test'); END").run();
    const warn = vi.fn<(line: string) => void>();
    const recorder = createSessionOutputRecorder({ warn });
    const fakes = fakeSessions();
    const manager = new SessionManager(
      { store, authProvider: stubProvider(), loomwrightPath: makePluginDir(tmp), stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" }, onOutput: (id, m) => recorder.record(store, id, m) },
      fakes.deps,
    );
    const handle = await manager.startSession(startParams(tmp));
    const call = fakes.calls[0] as FakeCall;
    for (let i = 0; i < 5; i++) call.stream.push(msg.text(`part ${i}`));
    call.stream.push(msg.result());
    call.stream.end();
    expect(await handle.done).toBe("completed");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe(`studio: session ${handle.id} output log write failed: refused by test`);
    expect(store.prepare("SELECT count(*) FROM session_output").pluck().get()).toBe(0);
    expect(store.prepare("SELECT count(*) FROM events WHERE kind = 'observer_error'").pluck().get()).toBe(0);
  });

  it("warns once per session: a second failing session warns once more, and the warning text is escaped", () => {
    const h = recorderHarness();
    const other = addSession(h.store);
    h.store.prepare("CREATE TRIGGER refuse_output BEFORE INSERT ON session_output BEGIN SELECT RAISE(ABORT, 'bad \u001b[31m end'); END").run();
    for (let i = 0; i < 3; i++) h.record(msg.text("a"));
    for (let i = 0; i < 3; i++) h.record(msg.text("b"), other);
    expect(h.warn.mock.calls.map((c) => c[0])).toEqual([
      `studio: session ${h.id} output log write failed: bad \\x1b[31m end`,
      `studio: session ${other} output log write failed: bad \\x1b[31m end`,
    ]);
  });

  it(`keeps at most ${MAX_RECORDER_SESSIONS} warned sessions: the oldest forgotten one warns once more`, () => {
    const h = recorderHarness();
    h.store.prepare("CREATE TRIGGER refuse_output BEFORE INSERT ON session_output BEGIN SELECT RAISE(ABORT, 'no'); END").run();
    h.record(msg.text("a"));
    for (let i = 0; i < MAX_RECORDER_SESSIONS; i++) h.record(msg.text("b"), addSession(h.store));
    expect(h.warn).toHaveBeenCalledTimes(MAX_RECORDER_SESSIONS + 1);
    h.record(msg.text("a again"));
    expect(h.warn).toHaveBeenCalledTimes(MAX_RECORDER_SESSIONS + 2);
  });

  it("a warn that throws is swallowed too: record never throws", () => {
    const store = openStore();
    const id = addSession(store);
    store.prepare("CREATE TRIGGER refuse_output BEFORE INSERT ON session_output BEGIN SELECT RAISE(ABORT, 'no'); END").run();
    const recorder: SessionOutputRecorder = createSessionOutputRecorder({
      warn: () => {
        throw new Error("stderr closed");
      },
    });
    expect(() => recorder.record(store, id, msg.text("x"))).not.toThrow();
  });
});

// ---- AC4: the CLI prints stored strings escaped ----------------------------------------------

describe("studio sessions output (AC4)", () => {
  it("prints an assistant_text row's escape sequence and bidi control escaped, never raw", async () => {
    const h = recorderHarness();
    h.record(msg.text("before \u001b[31mred\u001b[0m and \u202Eevil\u202C after\nsecond line"));
    const out = capture();
    expect(await sessionsSubcommand.run(["output", String(h.id)], routeClient(h.store), out)).toBe(0);
    const printed = out.out();
    expect(printed).toContain("\\x1b[31m");
    expect(printed).toContain("\\u202e");
    expect(printed).not.toContain("\u001b");
    expect(printed).not.toContain("\u202E");
    expect(printed).not.toContain("\u202C");
    // One line per row: the stored newline is shown, not printed.
    expect(printed).toBe("1  assistant_text  before \\x1b[31mred\\x1b[0m and \\u202eevil\\u202c after\\nsecond line\n");
    expect(out.err()).toBe("");
  });

  it("prints every row kind on one escaped line, the cut note and approval id included", async () => {
    const h = recorderHarness();
    h.record(msg.init("model-\u001b"));
    h.record(msg.toolUse("t1", "Bash", { command: "git push \u001b[2J" }));
    addDecision(h.store, h.id, { tool: "Bash", decision: "deny", reason: "approval_required", command: "git push \u001b[2J", approval_id: 7 });
    h.record(msg.toolResult("t1", "held \u0007", true));
    h.record(msg.text("y".repeat(ASSISTANT_TEXT_CUT + 5)));
    h.record(msg.result());
    const out = capture();
    expect(await sessionsSubcommand.run(["output", String(h.id)], routeClient(h.store), out)).toBe(0);
    const lines = out.out().trimEnd().split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe("1  system  init  model model-\\x1b  tools 2");
    // The input is stored as JSON text, so its escape is already the six characters `\u001b`.
    expect(lines[1]).toBe('2  tool_call  Bash {"command":"git push \\u001b[2J"}');
    expect(lines[2]).toBe("3  tool_decision  Bash deny (approval_required)  approval 7  command git push \\x1b[2J");
    expect(lines[3]).toBe("4  tool_result  t1 error held \\x07");
    expect(lines[4]).toMatch(new RegExp(`^5  assistant_text  y{${ASSISTANT_TEXT_CUT}} \\[cut from ${ASSISTANT_TEXT_CUT + 5} chars\\]$`));
    expect(lines[5]).toBe("6  result  success  tokens 18");
    expect(out.out()).not.toMatch(/[\u0000-\u0009\u000b-\u001f]/);
  });
});

// ---- AC5: the throttled feed event --------------------------------------------------------------

describe("session_output_appended (AC5)", () => {
  it("events for a session are at least 250 ms apart, each covers new rows only, and together they cover every row (the trailing timer announces the last batch)", () => {
    const h = recorderHarness();
    expect(OUTPUT_FEED_INTERVAL_MS).toBe(250);
    let maxTimers = 0;
    h.record(msg.init());
    for (let i = 0; i < 50; i++) {
      h.time.advance(20);
      h.record(msg.text(`chunk ${i}`));
      maxTimers = Math.max(maxTimers, h.time.live().length);
    }
    h.record(msg.result());
    maxTimers = Math.max(maxTimers, h.time.live().length);
    h.time.advance(OUTPUT_FEED_INTERVAL_MS);
    expect(maxTimers).toBe(1);
    expect(h.time.live()).toHaveLength(0);
    const events = eventsOf(h.store, "session_output_appended", h.id);
    const last = rows(h.store, h.id).at(-1)?.seq as number;
    expect(last).toBe(52);
    expect(events.length).toBeGreaterThan(2);
    let covered = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i] as (typeof events)[number];
      expect(e.payload.from_seq).toBe(covered + 1);
      expect(e.payload.to_seq as number).toBeGreaterThanOrEqual(e.payload.from_seq as number);
      covered = e.payload.to_seq as number;
      if (i > 0) expect(Date.parse(e.at) - Date.parse((events[i - 1] as (typeof events)[number]).at)).toBeGreaterThanOrEqual(OUTPUT_FEED_INTERVAL_MS);
    }
    expect(covered).toBe(last);
    // Within 1 s of rows: no more than one event per 250 ms.
    expect(events.length).toBeLessThanOrEqual(Math.ceil((h.time.now().getTime() - Date.parse("2026-10-21T09:00:00.000Z")) / OUTPUT_FEED_INTERVAL_MS) + 1);
  });

  it("a result after the interval announces at once; a session's first rows announce at once", () => {
    const h = recorderHarness();
    h.record(msg.init());
    expect(eventsOf(h.store, "session_output_appended", h.id).map((e) => e.payload)).toEqual([{ from_seq: 1, to_seq: 1 }]);
    h.time.advance(OUTPUT_FEED_INTERVAL_MS);
    h.record(msg.result());
    expect(eventsOf(h.store, "session_output_appended", h.id).map((e) => e.payload)).toEqual([
      { from_seq: 1, to_seq: 1 },
      { from_seq: 2, to_seq: 2 },
    ]);
    expect(h.time.live()).toHaveLength(0);
  });

  it("a wall clock stepped back an hour announces at once: the feed never waits longer than one interval", () => {
    const h = recorderHarness();
    h.record(msg.init());
    h.time.advance(-60 * 60 * 1_000);
    h.record(msg.text("after the step"));
    expect(eventsOf(h.store, "session_output_appended", h.id).map((e) => e.payload)).toEqual([
      { from_seq: 1, to_seq: 1 },
      { from_seq: 2, to_seq: 2 },
    ]);
    // Within the interval of the new stamp: the trailing timer is armed for at most one interval.
    h.record(msg.text("next"));
    const armed = h.time.live();
    expect(armed).toHaveLength(1);
    expect((armed[0] as (typeof armed)[number]).at - h.time.now().getTime()).toBeLessThanOrEqual(OUTPUT_FEED_INTERVAL_MS);
    h.time.advance(OUTPUT_FEED_INTERVAL_MS);
    expect(eventsOf(h.store, "session_output_appended", h.id)).toHaveLength(3);
  });

  it("a trailing timer that fires after the store closed writes nothing and does not warn", () => {
    const h = recorderHarness();
    h.record(msg.init());
    h.record(msg.text("pending"));
    expect(h.time.live()).toHaveLength(1);
    h.store.close();
    stores.splice(stores.indexOf(h.store), 1);
    expect(() => h.time.advance(OUTPUT_FEED_INTERVAL_MS)).not.toThrow();
    expect(h.warn).not.toHaveBeenCalled();
  });

  it("a message that writes nothing (a stream event) touches neither the log nor the feed", () => {
    const h = recorderHarness();
    const prepare = vi.spyOn(h.store, "prepare");
    h.record(msg.streamEvent());
    // Not an object at all: ignored the same way, never a warning.
    for (const junk of [null, undefined, 42, "text", []]) h.record(junk as unknown as SDKMessage);
    expect(prepare).not.toHaveBeenCalled();
    expect(h.warn).not.toHaveBeenCalled();
    expect(h.store.prepare("SELECT count(*) FROM events").pluck().get()).toBe(0);
  });
});

// ---- AC6: cut strings --------------------------------------------------------------------------

describe("cut strings (AC6)", () => {
  it(`cuts text to ${ASSISTANT_TEXT_CUT} and tool JSON to ${TOOL_JSON_CUT} characters with the original length, and a tool_result keeps is_error`, () => {
    const h = recorderHarness();
    expect([ASSISTANT_TEXT_CUT, TOOL_JSON_CUT]).toEqual([8_000, 4_000]);
    const longText = "t".repeat(9_000);
    const input = { content: "i".repeat(5_000) };
    const resultText = "r".repeat(6_000);
    h.record(msg.text(longText, "short"));
    h.record(msg.toolUse("t1", "Write", input));
    h.record(msg.toolResult("t1", resultText, true));
    h.record(msg.toolResult("t2", [{ type: "text", text: "fine" }, { type: "image", source: {} }]));
    const [text, short, call, failed, ok] = rows(h.store, h.id);
    expect(text?.payload).toEqual({ text: "t".repeat(8_000), cut: { original_chars: 9_000 } });
    expect(short?.payload).toEqual({ text: "short" });
    const inputJson = JSON.stringify(input);
    expect(call?.payload).toEqual({ tool_use_id: "t1", name: "Write", input_json: inputJson.slice(0, 4_000), cut: { original_chars: inputJson.length } });
    expect(failed?.payload).toEqual({ tool_use_id: "t1", is_error: true, content: "r".repeat(4_000), cut: { original_chars: 6_000 } });
    expect(ok?.payload).toEqual({ tool_use_id: "t2", is_error: false, content: "fine\n[image]" });
  });

  it("never splits a surrogate pair at the cut", () => {
    const h = recorderHarness();
    h.record(msg.text(`${"a".repeat(ASSISTANT_TEXT_CUT - 1)}\u{1F600}tail`));
    const [row] = rows(h.store, h.id);
    expect(row?.payload.text).toBe("a".repeat(ASSISTANT_TEXT_CUT - 1));
    expect(row?.payload.cut).toEqual({ original_chars: ASSISTANT_TEXT_CUT + 1 + 4 });
  });
});

// ---- AC7: a held decision's approval id -------------------------------------------------------

describe("a held decision (AC7)", () => {
  it("its tool_decision row carries the approval_id from the kernel's event", async () => {
    const store = openStore();
    const home = join(tmp, "home");
    mkdirSync(home);
    const recorder = createSessionOutputRecorder({ warn: () => {} });
    const fakes = fakeSessions();
    const manager = new SessionManager(
      { store, authProvider: stubProvider(), loomwrightPath: makePluginDir(tmp), stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" }, onOutput: (id, m) => recorder.record(store, id, m) },
      { ...fakes.deps, homeDir: home },
    );
    const policy: ToolPolicy = { allowedTools: [], allowedBashPrefixes: ["git push"] };
    const handle = await manager.startSession(startParams(tmp, { policy }));
    const call = fakes.calls[0] as FakeCall;
    const command = { command: "git push origin main", description: "push" };
    call.stream.push(msg.toolUse("toolu_1", "Bash", command));
    await vi.waitFor(() => expect(kinds(rows(store, handle.id))).toContain("tool_call"));
    const decision = await gate(call, "Bash", command, tmp);
    expect(decision.permissionDecision).toBe("deny");
    expect(decision.permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    call.stream.push(msg.result());
    call.stream.end();
    expect(await handle.done).toBe("completed");
    const decisionRow = rows(store, handle.id).find((r) => r.kind === "tool_decision");
    expect(decisionRow?.payload).toEqual({ tool: "Bash", decision: "deny", reason: "approval_required", command: "git push origin main", approval_id: 1 });
    expect(decisionRow?.payload).toEqual(eventsOf(store, "tool_decision", handle.id)[0]?.payload);
    expect(kinds(rows(store, handle.id))).toEqual(["system", "tool_call", "tool_decision", "result"]);
  });

  it("copies an agent_boundary deny's category whole", () => {
    const h = recorderHarness();
    h.record(msg.toolUse("t1", "Bash", { command: "gh pr create" }));
    addDecision(h.store, h.id, { tool: "Bash", decision: "deny", reason: "agent_boundary", command: "gh pr create", category: "gh_pr_create" });
    h.record(msg.result());
    expect(rows(h.store, h.id)[1]?.payload).toEqual({ tool: "Bash", decision: "deny", reason: "agent_boundary", command: "gh pr create", category: "gh_pr_create" });
  });
});

// ---- AC8: the routes ------------------------------------------------------------------------------

describe("GET /sessions and GET /sessions/:id/output (AC8)", () => {
  function seeded() {
    const store = openStore();
    const a = addSession(store, { status: "completed", agent: "wright" });
    const b = addSession(store, { status: "running", agent: "scout" });
    const c = addSession(store, { status: "starting", agent: "wright" });
    const d = addSession(store, { status: "running", agent: "wright", cwd: "/repo" });
    store.prepare("UPDATE sessions SET ended_at = '2026-10-21T10:00:00.000Z' WHERE id = ?").run(a);
    store
      .prepare("INSERT INTO budget (day, session_id, agent, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("2026-10-21", d, "wright", "m", 100, 20, 5, 1_000);
    store
      .prepare("INSERT INTO budget (day, session_id, agent, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("2026-10-21", d, "wright", "m", 1, 2, 3, 4);
    const recorder = createSessionOutputRecorder({ warn: () => {} });
    for (let i = 0; i < 6; i++) recorder.record(store, d, msg.text(`row ${i + 1}`));
    return { store, ids: { a, b, c, d } };
  }

  it("GET /sessions?status=running&limit=1 answers the newest running session as a SessionSummary", async () => {
    const { store, ids } = seeded();
    const res = await callRoute(store, "GET", "/sessions?status=running&limit=1");
    expect(res).toEqual({
      status: 200,
      body: {
        sessions: [
          { id: ids.d, agent: "wright", status: "running", model: "claude-haiku-4-5", started: "2026-10-21T09:00:00.000Z", ended: null, tokens: 131, cwd: "/repo", playbook: null },
        ],
      },
    });
    const all = (await callRoute(store, "GET", "/sessions")).body as { sessions: { id: number; tokens: number | null; ended: string | null }[] };
    expect(all.sessions.map((s) => s.id)).toEqual([ids.d, ids.c, ids.b, ids.a]);
    expect(all.sessions.find((s) => s.id === ids.b)?.tokens).toBeNull();
    expect(all.sessions.find((s) => s.id === ids.a)?.ended).toBe("2026-10-21T10:00:00.000Z");
    expect(((await callRoute(store, "GET", "/sessions?status=running")).body as { sessions: unknown[] }).sessions).toHaveLength(2);
    expect(((await callRoute(store, "GET", "/sessions?status=nope")).body as { sessions: unknown[] }).sessions).toEqual([]);
    expect(((await callRoute(store, "GET", "/sessions?limit=500")).body as { sessions: unknown[] }).sessions).toHaveLength(4);
  });

  it("GET /sessions/:id/output?after=<seq>&limit=<n> answers SessionOutputRows after that seq, in seq order", async () => {
    const { store, ids } = seeded();
    const res = await callRoute(store, "GET", `/sessions/${ids.d}/output?after=2&limit=3`);
    expect(res.status).toBe(200);
    const body = res.body as { rows: Record<string, unknown>[] };
    expect(body.rows.map((r) => Object.keys(r))).toEqual(Array(3).fill(["id", "session_id", "seq", "kind", "payload", "created_at"]));
    expect(body.rows.map((r) => [r.session_id, r.seq, r.kind, r.payload])).toEqual([
      [ids.d, 3, "assistant_text", { text: "row 3" }],
      [ids.d, 4, "assistant_text", { text: "row 4" }],
      [ids.d, 5, "assistant_text", { text: "row 5" }],
    ]);
    expect(body.rows.every((r) => typeof r.id === "number" && typeof r.created_at === "string")).toBe(true);
    expect(((await callRoute(store, "GET", `/sessions/${ids.d}/output`)).body as { rows: unknown[] }).rows).toHaveLength(6);
    expect(((await callRoute(store, "GET", `/sessions/${ids.d}/output?after=6`)).body as { rows: unknown[] }).rows).toEqual([]);
    expect(await callRoute(store, "GET", `/sessions/${ids.a}/output?limit=${MAX_OUTPUT_LIMIT}`)).toEqual({ status: 200, body: { rows: [] } });
  });

  it("refuses a bad id (400 invalid_id), a bad limit or after (400 invalid_query), and an unknown session (404 not_found)", async () => {
    const { store, ids } = seeded();
    for (const path of ["/sessions?limit=0", "/sessions?limit=501", "/sessions?limit=abc", "/sessions?limit=1.5", "/sessions?limit=-1", "/sessions?limit="]) {
      expect(await callRoute(store, "GET", path), path).toEqual({ status: 400, body: { error: "invalid_query" } });
    }
    for (const id of ["abc", "0", "-1", "1.0", "01", "99999999999999999"]) {
      expect(await callRoute(store, "GET", `/sessions/${id}/output`), id).toEqual({ status: 400, body: { error: "invalid_id" } });
    }
    for (const q of ["after=x", "after=-1", "after=1.5", "limit=0", "limit=501", "limit=x"]) {
      expect(await callRoute(store, "GET", `/sessions/${ids.d}/output?${q}`), q).toEqual({ status: 400, body: { error: "invalid_query" } });
    }
    expect(await callRoute(store, "GET", "/sessions/999/output")).toEqual({ status: 404, body: { error: "not_found" } });
  });
});

// ---- The `studio sessions` verbs ------------------------------------------------------------------

describe("studio sessions", () => {
  it("lists one escaped line per session, newest first; --json prints the API's answer as JSON with no raw control or bidi character", async () => {
    const store = openStore();
    addSession(store, { agent: "plain", status: "completed" });
    addSession(store, { agent: "evil\u001b[2J\u202E", model: "m\u0085", cwd: "/tmp/\u001b]0;title\u0007" });
    const out = capture();
    expect(await sessionsSubcommand.run([], routeClient(store), out)).toBe(0);
    expect(out.out()).toBe(
      "#2  running  agent evil\\x1b[2J\\u202e  model m\\x85  started 2026-10-21T09:00:00.000Z  ended -  tokens -  playbook -  cwd /tmp/\\x1b]0;title\\x07\n" +
        "#1  completed  agent plain  model claude-haiku-4-5  started 2026-10-21T09:00:00.000Z  ended -  tokens -  playbook -  cwd /work\n",
    );
    const json = capture();
    expect(await sessionsSubcommand.run(["--json"], routeClient(store), json)).toBe(0);
    expect(json.out()).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202A-\u202E]/);
    const parsed = JSON.parse(json.out()) as { sessions: { agent: string }[] };
    expect(parsed.sessions.map((s) => s.agent)).toEqual(["evil\u001b[2J\u202E", "plain"]);
    const none = capture();
    expect(await sessionsSubcommand.run([], routeClient(openStore("empty")), none)).toBe(0);
    expect(none.out()).toBe("no sessions\n");
  });

  it("an unknown verb or bad id prints the usage on stderr and exits 2; an API refusal prints one escaped line and exits 1", async () => {
    const store = openStore();
    for (const args of [["bogus"], ["--json", "--json"], ["output"], ["output", "abc"], ["output", "0"], ["output", "1", "--bad"], ["output", "1", "--follow", "x"]]) {
      const out = capture();
      expect(await sessionsSubcommand.run(args, routeClient(store), out), args.join(" ")).toBe(2);
      expect(out.err()).toBe(`usage: ${SESSIONS_HELP}\n`);
      expect(out.out()).toBe("");
    }
    const missing = capture();
    expect(await sessionsSubcommand.run(["output", "999"], routeClient(store), missing)).toBe(1);
    expect(missing.err()).toBe("studio: kernel API answered 404 to GET /sessions/999/output?after=0&limit=500: not_found\n");
    const hostile: CliApiClient = { request: async () => ({ status: 500, body: { error: "boom\u001b[2J" } }) };
    const refused = capture();
    expect(await sessionsSubcommand.run([], hostile, refused)).toBe(1);
    expect(refused.err()).toBe("studio: kernel API answered 500 to GET /sessions?limit=500: boom\\x1b[2J\n");
    expect(SESSIONS_HELP.length).toBeLessThan(200);
  });

  it("--follow polls after the last seq at the injected interval and stops once the session is neither starting nor running and a final read is empty", async () => {
    const h = recorderHarness();
    h.record(msg.init());
    const paths: string[] = [];
    const out = capture();
    const sleeps: number[] = [];
    let tick = 0;
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
      tick += 1;
      h.time.advance(OUTPUT_FEED_INTERVAL_MS);
      if (tick === 1) h.record(msg.text("first"));
      if (tick === 2) h.record(msg.text("second"), h.id);
      if (tick === 3) {
        h.record(msg.result());
        h.store.prepare("UPDATE sessions SET status = 'completed' WHERE id = ?").run(h.id);
      }
    };
    const code = await followSessionOutput(routeClient(h.store, (p) => paths.push(p)), out, h.id, { follow: true, intervalMs: 7, sleep });
    expect(code).toBe(0);
    expect(sleeps).toEqual([7, 7, 7]);
    expect(out.out().trimEnd().split("\n")).toEqual(["1  system  init  model claude-haiku-4-5  tools 2", "2  assistant_text  first", "3  assistant_text  second", "4  result  success  tokens 18"]);
    expect(paths.filter((p) => p.includes("/output"))).toContain(`/sessions/${h.id}/output?after=3&limit=500`);
    // The end: neither starting nor running, then one final read that brought nothing.
    expect(paths.slice(-3)).toEqual(["/sessions?status=starting&limit=500", "/sessions?status=running&limit=500", `/sessions/${h.id}/output?after=4&limit=500`]);
  });

  it("prints a row of a kind it does not know as escaped JSON on one line, and lets a request that got no answer reject", async () => {
    const unknown: CliApiClient = {
      request: async () => ({ status: 200, body: { rows: [{ id: 1, session_id: 1, seq: 1, kind: "future_kind", payload: { a: "x\u001b[2J", b: [1] }, created_at: "t" }] } }),
    };
    const out = capture();
    expect(await sessionsSubcommand.run(["output", "1"], unknown, out)).toBe(0);
    expect(out.out()).toBe('1  future_kind  {   "a": "x\\x1b[2J",   "b": [     1   ] }\n');
    const down: CliApiClient = { request: async () => Promise.reject(new Error("connection refused")) };
    await expect(sessionsSubcommand.run(["output", "1"], down, capture())).rejects.toThrow("connection refused");
  });

  it("without --follow reads once and pages through more than one answer's worth of rows", async () => {
    const h = recorderHarness();
    for (let i = 0; i < MAX_OUTPUT_LIMIT + 3; i++) h.record(msg.text(`r${i}`));
    const out = capture();
    const paths: string[] = [];
    expect(await sessionsSubcommand.run(["output", String(h.id)], routeClient(h.store, (p) => paths.push(p)), out)).toBe(0);
    expect(out.out().trimEnd().split("\n")).toHaveLength(MAX_OUTPUT_LIMIT + 3);
    expect(paths).toEqual([`/sessions/${h.id}/output?after=0&limit=500`, `/sessions/${h.id}/output?after=500&limit=500`]);
  });
});
