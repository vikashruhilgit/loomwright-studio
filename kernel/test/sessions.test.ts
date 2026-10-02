// Unit tests for the session manager. Never the real SDK, a model or a real
// process: `query` and the spawner are fakes, and every process-group call is
// injected (fake pids are above any real pid_max, so even a stray real signal
// could only hit ESRCH).
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import type { HookCallback, HookInput, Options, SDKMessage, SDKUserMessage, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProviderError, KeychainError } from "../src/auth/index.js";
import type { AuthProvider } from "../src/auth/index.js";
import { DEFAULT_RESUME_PROMPT, LeaderProbeError, SessionError, SessionManager, resolveLoomwrightPath } from "../src/sessions/index.js";
import type {
  CancelTimer,
  GroupLeader,
  QueryFn,
  QueryHandle,
  SessionManagerDeps,
  SessionManagerOptions,
  SessionRow,
  SpawnFn,
  SpawnHooks,
  StartSessionParams,
} from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";

const SESSIONS_SRC = fileURLToPath(new URL("../src/sessions/", import.meta.url));
const SECRET = "sk-ant-test-secret-value";
const UUID = "11111111-2222-4333-8444-555555555555";

let tmp: string;
let pluginDir: string;
const stores: Store[] = [];
const streams: FakeStream[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-sessions-"));
  pluginDir = makePluginVersion(join(tmp, "plugin-cache"), "15.115.0");
});

afterEach(() => {
  for (const s of streams.splice(0)) s.end();
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

// ---- fixtures -------------------------------------------------------------

function makePluginVersion(cacheRoot: string, version: string, withManifest = true): string {
  const dir = join(cacheRoot, version);
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  if (withManifest) writeFileSync(join(dir, ".claude-plugin", "plugin.json"), '{"name":"loomwright"}\n');
  return dir;
}

function openStore(): Store {
  const store = new Store({ dataDir: join(tmp, "data") });
  stores.push(store);
  return store;
}

function stubProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    id: "stub-provider",
    account: "owner@example.test",
    buildEnv: () => ({ PATH: "/usr/bin", ANTHROPIC_API_KEY: SECRET }),
    health: () => ({ status: "ok" }),
    ...overrides,
  };
}

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  exited = false;

  constructor(readonly pid: number) {
    super();
  }

  kill(signal: NodeJS.Signals): boolean {
    this.killed = true;
    this.exit(null, signal);
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exited) return;
    this.exited = true;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
}

type Item = { message: SDKMessage } | { error: Error };

/** A controllable message stream standing in for the SDK's `Query`. */
class FakeStream implements QueryHandle {
  readonly #queue: Item[] = [];
  readonly #waiters: ((r: IteratorResult<SDKMessage>) => void)[] = [];
  readonly #rejecters: ((e: Error) => void)[] = [];
  #ended = false;
  closeCalls = 0;
  onEnd: () => void = () => {};

  push(message: SDKMessage): void {
    this.#deliver({ message });
  }

  fail(error: Error): void {
    this.#deliver({ error });
  }

  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    for (const w of this.#waiters.splice(0)) w({ value: undefined, done: true });
    this.#rejecters.splice(0);
    this.onEnd();
  }

  close(): void {
    this.closeCalls++;
    this.end();
  }

  #deliver(item: Item): void {
    const waiter = this.#waiters.shift();
    const rejecter = this.#rejecters.shift();
    if (waiter === undefined || rejecter === undefined) {
      this.#queue.push(item);
      return;
    }
    if ("message" in item) waiter({ value: item.message, done: false });
    else {
      this.#ended = true;
      rejecter(item.error);
      this.onEnd();
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: () => {
        const item = this.#queue.shift();
        if (item !== undefined) {
          if ("message" in item) return Promise.resolve({ value: item.message, done: false });
          this.#ended = true;
          this.onEnd();
          return Promise.reject(item.error);
        }
        if (this.#ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => {
          this.#waiters.push(resolve);
          this.#rejecters.push(reject);
        });
      },
      return: () => {
        this.end();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

interface QueryCall {
  readonly prompt: AsyncIterable<SDKUserMessage>;
  readonly options: Options;
  readonly stream: FakeStream;
  readonly child: FakeChild;
  /** Every prompt message the fake CLI read, in order. */
  readonly promptMessages: SDKUserMessage[];
  /** Resolves when the input ended (the SDK would then close the CLI's stdin). */
  readonly inputEnded: Promise<void>;
}

const msg = {
  init: (sessionId: string): SDKMessage => ({ type: "system", subtype: "init", session_id: sessionId }) as unknown as SDKMessage,
  assistant: (): SDKMessage =>
    ({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] }, parent_tool_use_id: null }) as unknown as SDKMessage,
  assistantAuthError: (): SDKMessage =>
    ({ type: "assistant", message: { content: [] }, parent_tool_use_id: null, error: "authentication_failed" }) as unknown as SDKMessage,
  success: (): SDKMessage => ({ type: "result", subtype: "success", is_error: false, result: "DONE" }) as unknown as SDKMessage,
  errorResult: (errors: string[]): SDKMessage =>
    ({ type: "result", subtype: "error_during_execution", is_error: true, errors }) as unknown as SDKMessage,
  apiRetry401: (attempt = 1): SDKMessage =>
    ({
      type: "system",
      subtype: "api_retry",
      attempt,
      max_retries: 10,
      retry_delay_ms: 500,
      error_status: 401,
      error: "authentication_failed",
    }) as unknown as SDKMessage,
};

interface HarnessOptions {
  readonly options?: Partial<SessionManagerOptions>;
  readonly deps?: Partial<SessionManagerDeps>;
  /** Called synchronously inside each fake `query()`, after the spawn. */
  readonly script?: (call: QueryCall, n: number) => void;
  /** Stderr the fake CLI writes on spawn. */
  readonly stderr?: string;
  readonly store?: Store;
  /** Whether the fake CLI's stream ends when its input ends (default true). */
  readonly endOnInputEnd?: boolean;
}

function harness(h: HarnessOptions = {}) {
  const store = h.store ?? openStore();
  const calls: QueryCall[] = [];
  const children = new Map<number, FakeChild>();
  const spawnCalls: { hooks: SpawnHooks }[] = [];
  const killed: [number, string][] = [];
  const delays: number[] = [];
  let nextPid = 2_000_000_000;

  const spawn: SpawnFn = (_o, hooks) => {
    const child = new FakeChild(nextPid++);
    children.set(child.pid, child);
    spawnCalls.push({ hooks });
    if (h.stderr !== undefined) hooks.stderrTail?.append(h.stderr);
    hooks.onSpawn?.(child.pid);
    return child as unknown as SpawnedProcess;
  };

  const query: QueryFn = ({ prompt, options }) => {
    const stream = new FakeStream();
    streams.push(stream);
    // Like the SDK: the spawn runs synchronously at query() creation (probe 2).
    const spawned = options.spawnClaudeCodeProcess?.({
      command: "claude",
      args: [],
      cwd: options.cwd,
      env: options.env ?? {},
      signal: new AbortController().signal,
    });
    const child = spawned as unknown as FakeChild;
    stream.onEnd = () => child.exit(0, null);
    // Like the SDK + CLI: read the prompt; when the input ends, the CLI
    // finishes and the stream ends after anything already queued.
    const promptMessages: SDKUserMessage[] = [];
    const inputEnded = (async () => {
      for await (const m of prompt) promptMessages.push(m);
    })();
    if (h.endOnInputEnd !== false) void inputEnded.then(() => stream.end());
    const call: QueryCall = { prompt, options, stream, child, promptMessages, inputEnded };
    calls.push(call);
    h.script?.(call, calls.length);
    return stream;
  };

  const killGroup = (pgid: number, signal: NodeJS.Signals): boolean => {
    killed.push([pgid, signal]);
    const child = children.get(pgid);
    if (child === undefined || child.exited) return false;
    child.exit(null, signal);
    return true;
  };

  const manager = new SessionManager(
    {
      store,
      authProvider: stubProvider(),
      loomwrightPath: pluginDir,
      stopGraceMs: 30,
      baseEnv: { PATH: "/usr/bin" },
      ...h.options,
    },
    {
      query,
      spawn,
      killGroup,
      isGroupAlive: () => false,
      readGroupLeader: () => ({ status: "absent" }),
      sleep: async (ms) => {
        delays.push(ms);
      },
      randomUUID: () => UUID,
      ...h.deps,
    },
  );
  return { store, manager, calls, children, spawnCalls, killed, delays };
}

function startParams(overrides: Partial<StartSessionParams> = {}): StartSessionParams {
  return {
    agent: "wright",
    prompt: "Say hi.",
    model: "claude-haiku-4-5",
    permissionMode: "default",
    cwd: tmp,
    policy: { allowedTools: ["Read"], allowedBashPrefixes: ["echo"] },
    ...overrides,
  };
}

function row(store: Store, id: number): SessionRow {
  const r = store.prepare<[number], SessionRow>("SELECT * FROM sessions WHERE id = ?").get(id);
  if (r === undefined) throw new Error(`no session ${id}`);
  return r;
}

interface EventRow {
  kind: string;
  actor: string | null;
  session_id: number | null;
  payload: Record<string, unknown>;
  raw: string;
}

function events(store: Store, kind?: string): EventRow[] {
  const rows = store
    .prepare<[], { kind: string; actor: string | null; session_id: number | null; payload_json: string }>(
      "SELECT kind, actor, session_id, payload_json FROM events ORDER BY id",
    )
    .all();
  return rows
    .filter((r) => kind === undefined || r.kind === kind)
    .map((r) => ({ kind: r.kind, actor: r.actor, session_id: r.session_id, payload: JSON.parse(r.payload_json), raw: r.payload_json }));
}

function sessionCount(store: Store): number {
  return store.prepare<[], number>("SELECT count(*) FROM sessions").pluck().get() ?? 0;
}

function gateOf(call: QueryCall): HookCallback {
  const matcher = call.options.hooks?.PreToolUse?.[0];
  const hook = matcher?.hooks[0];
  if (hook === undefined) throw new Error("no PreToolUse hook");
  return hook;
}

function preToolUse(toolName: string, toolInput: unknown): HookInput {
  return {
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "toolu_1",
    session_id: UUID,
    transcript_path: "/dev/null",
    cwd: "/tmp",
  } as unknown as HookInput;
}

async function decide(call: QueryCall, input: HookInput) {
  const out = (await gateOf(call)(input, "toolu_1", { signal: new AbortController().signal })) as {
    hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };
  };
  return out.hookSpecificOutput;
}

async function firstPrompt(call: QueryCall): Promise<SDKUserMessage> {
  await vi.waitFor(() => expect(call.promptMessages.length).toBeGreaterThan(0));
  return call.promptMessages[0] as SDKUserMessage;
}

/** Whether the input has ended within `ms`. */
async function inputEndedWithin(call: QueryCall, ms: number): Promise<boolean> {
  return Promise.race([call.inputEnded.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
}

// ---- AC1: isolation options -----------------------------------------------

describe("startSession: query options (AC1)", () => {
  it("passes isolated options, the provider env, explicit model/permissionMode and a streaming prompt", async () => {
    const { manager, calls, store } = harness({
      script: ({ stream }) => {
        stream.push(msg.init(UUID));
        stream.push(msg.assistant());
        stream.push(msg.success());
      },
    });
    const handle = await manager.startSession(startParams());
    expect(calls).toHaveLength(1);
    const { options, prompt } = calls[0] as QueryCall;

    expect(options.settingSources).toEqual([]);
    expect(options.plugins).toEqual([{ type: "local", path: pluginDir }]);
    expect(options.env).toEqual({ PATH: "/usr/bin", ANTHROPIC_API_KEY: SECRET });
    expect(options.model).toBe("claude-haiku-4-5");
    expect(options.permissionMode).toBe("default");
    expect(options.cwd).toBe(tmp);
    expect(options.includeHookEvents).toBe(true);
    expect(options.sessionId).toBe(UUID);
    expect(options.resume).toBeUndefined();
    expect(options.abortController).toBeInstanceOf(AbortController);
    expect(typeof options.spawnClaudeCodeProcess).toBe("function");
    expect(options.hooks?.PreToolUse).toHaveLength(1);
    expect(options.hooks?.PreToolUse?.[0]?.matcher).toBeUndefined();
    expect(options.hooks?.PreToolUse?.[0]?.hooks).toHaveLength(1);
    expect(Object.keys(options.hooks ?? {})).toEqual(["PreToolUse"]);
    for (const forbidden of ["allowedTools", "canUseTool", "allowDangerouslySkipPermissions", "disallowedTools"]) {
      expect(options).not.toHaveProperty(forbidden);
    }

    // A streaming async-iterable prompt, never a string.
    expect(typeof prompt).not.toBe("string");
    expect(typeof prompt[Symbol.asyncIterator]).toBe("function");
    expect(await firstPrompt(calls[0] as QueryCall)).toEqual({
      type: "user",
      message: { role: "user", content: "Say hi." },
      parent_tool_use_id: null,
    });

    expect(await handle.done).toBe("completed");
    const r = row(store, handle.id);
    expect(r).toMatchObject({
      agent: "wright",
      status: "completed",
      model: "claude-haiku-4-5",
      auth_account: "owner@example.test",
      sdk_session_id: UUID,
      loomwright_path: pluginDir,
    });
    expect(r.started_at).not.toBeNull();
    expect(r.ended_at).not.toBeNull();
    expect(events(store, "session_status").map((e) => [e.payload.from, e.payload.to])).toEqual([
      [null, "starting"],
      ["starting", "running"],
      ["running", "completed"],
    ]);
    for (const e of events(store)) {
      expect(e.actor).toBe("kernel");
      expect(e.raw).not.toContain(SECRET);
    }
  });

  it("closes the input after the first result by default, and keeps it open with closeInputOnResult: false", async () => {
    const h1 = harness({ script: ({ stream }) => stream.push(msg.success()) });
    const a = await h1.manager.startSession(startParams());
    expect(await a.done).toBe("completed");
    expect(await inputEndedWithin(h1.calls[0] as QueryCall, 0)).toBe(true);
    expect((h1.calls[0] as QueryCall).promptMessages).toHaveLength(1);

    const h2 = harness({
      store: h1.store,
      script: ({ stream }) => {
        stream.push(msg.init(UUID));
        stream.push(msg.success());
      },
    });
    const b = await h2.manager.startSession(startParams({ closeInputOnResult: false }));
    await vi.waitFor(() => expect(h2.manager.getSession(b.id)?.status).toBe("running"));
    expect(await inputEndedWithin(h2.calls[0] as QueryCall, 50)).toBe(false);
    expect(await h2.manager.stopSession(b.id)).toBe("stopped");
  });

  it("refuses a missing or empty model and a missing permissionMode before any row or spawn", async () => {
    const { manager, calls, store } = harness();
    for (const bad of [{ model: "" }, { model: "  " }, { model: undefined }]) {
      const err = await manager.startSession(startParams(bad as Partial<StartSessionParams>)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SessionError);
      expect((err as SessionError).code).toBe("invalid_params");
    }
    const err = await manager
      .startSession(startParams({ permissionMode: undefined } as unknown as Partial<StartSessionParams>))
      .catch((e: unknown) => e);
    expect((err as SessionError).code).toBe("invalid_params");
    expect(calls).toHaveLength(0);
    expect(sessionCount(store)).toBe(0);
  });

  it("refuses bypassPermissions before any row or spawn (AC3)", async () => {
    const { manager, calls, spawnCalls, store } = harness();
    const err = await manager
      .startSession(startParams({ permissionMode: "bypassPermissions" } as unknown as Partial<StartSessionParams>))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionError);
    expect((err as SessionError).code).toBe("forbidden_permission_mode");
    expect(calls).toHaveLength(0);
    expect(spawnCalls).toHaveLength(0);
    expect(sessionCount(store)).toBe(0);
    expect(events(store)).toHaveLength(0);
  });

  it("calls the onMessage observer for every message and survives one that throws", async () => {
    const seen: string[] = [];
    const { manager, store } = harness({
      options: {
        onMessage: (_id, m) => {
          seen.push(m.type);
          if (m.type === "assistant") throw new Error("observer bug");
        },
      },
      script: ({ stream }) => {
        stream.push(msg.init(UUID));
        stream.push(msg.assistant());
        stream.push(msg.success());
      },
    });
    const handle = await manager.startSession(startParams());
    expect(await handle.done).toBe("completed");
    expect(seen).toEqual(["system", "assistant", "result"]);
    const errs = events(store, "observer_error");
    expect(errs).toHaveLength(1);
    expect(errs[0]?.payload.error).toBe("observer bug");
  });

  it("records a changed SDK session id from system/init instead of keeping the wrong one", async () => {
    const other = "99999999-8888-4777-8666-555555555555";
    const { manager, store } = harness({
      script: ({ stream }) => {
        stream.push(msg.init(other));
        stream.push(msg.success());
      },
    });
    const handle = await manager.startSession(startParams());
    await handle.done;
    expect(row(store, handle.id).sdk_session_id).toBe(other);
    expect(events(store, "session_id_changed")[0]?.payload).toEqual({ expected: UUID, actual: other });
  });

  it("marks a session failed with the error text and stderr tail when the stream rejects", async () => {
    const { manager, store } = harness({
      stderr: "fatal: something broke\n",
      script: ({ stream }) => {
        stream.push(msg.init(UUID));
        stream.fail(new Error("Claude Code process exited with code 1"));
      },
    });
    const handle = await manager.startSession(startParams());
    expect(await handle.done).toBe("failed");
    const last = events(store, "session_status").at(-1);
    expect(last?.payload).toMatchObject({
      to: "failed",
      reason: "stream_error",
      error: "Claude Code process exited with code 1",
      stderr: "fatal: something broke\n",
    });
  });

  it("marks a session failed when its result is an error", async () => {
    const { manager, store } = harness({
      script: ({ stream }) => {
        stream.push(msg.init(UUID));
        stream.push(msg.errorResult(["max turns"]));
      },
    });
    const handle = await manager.startSession(startParams());
    expect(await handle.done).toBe("failed");
    expect(events(store, "session_status").at(-1)?.payload).toMatchObject({ reason: "result_error" });
  });

  it("kills what is left of the group once the session has ended", async () => {
    const { manager, killed } = harness({ script: ({ stream }) => stream.push(msg.success()) });
    const handle = await manager.startSession(startParams());
    expect(await handle.done).toBe("completed");
    expect(killed).toEqual([[handle.pgid, "SIGKILL"]]);
  });
});

// ---- AC2: process group recorded before the first message ------------------

describe("startSession: process group (AC2)", () => {
  it("has sessions.pgid set when the fake query yields its first message", async () => {
    const store = openStore();
    let pgidAtFirstYield: number | null | undefined;
    let firstYielded = false;
    let childRef: FakeChild | undefined;
    const query: QueryFn = ({ options }) => {
      childRef = options.spawnClaudeCodeProcess?.({
        command: "claude",
        args: [],
        env: {},
        signal: new AbortController().signal,
      }) as unknown as FakeChild;
      const gen = (async function* () {
        try {
          pgidAtFirstYield = store.prepare<[], number | null>("SELECT pgid FROM sessions").pluck().get();
          firstYielded = true;
          yield msg.init(UUID);
          yield msg.success();
        } finally {
          childRef?.exit(0, null);
        }
      })();
      return Object.assign(gen, { close: () => {} });
    };
    const spawn: SpawnFn = (_o, hooks) => {
      const child = new FakeChild(2_000_000_123);
      hooks.onSpawn?.(child.pid);
      return child as unknown as SpawnedProcess;
    };
    const manager = new SessionManager(
      { store, authProvider: stubProvider(), loomwrightPath: pluginDir },
      { query, spawn, killGroup: () => false, randomUUID: () => UUID },
    );
    const handle = await manager.startSession(startParams());
    expect(handle.pgid).toBe(2_000_000_123);
    // The spawn ran synchronously inside query(), before any message was awaited.
    expect(row(store, handle.id).pgid).toBe(2_000_000_123);
    expect(await handle.done).toBe("completed");
    expect(firstYielded).toBe(true);
    expect(pgidAtFirstYield).toBe(2_000_000_123);
  });

  it("passes the spawner a stderr sink and an onSpawn hook", async () => {
    const { manager, spawnCalls } = harness({ script: ({ stream }) => stream.push(msg.success()) });
    await (await manager.startSession(startParams())).done;
    expect(spawnCalls).toHaveLength(1);
    expect(typeof spawnCalls[0]?.hooks.onSpawn).toBe("function");
    expect(typeof spawnCalls[0]?.hooks.stderrTail?.append).toBe("function");
  });

  it("exactly one file under src/sessions/ imports node:child_process, and it spawns detached", () => {
    const files = readdirSync(SESSIONS_SRC).filter((f) => f.endsWith(".ts"));
    const importers = files.filter((f) => /from\s+["']node:child_process["']/.test(readFileSync(join(SESSIONS_SRC, f), "utf8")));
    expect(importers).toEqual(["spawner.ts"]);
    const spawner = readFileSync(join(SESSIONS_SRC, "spawner.ts"), "utf8");
    expect(spawner).toMatch(/detached:\s*true/);
    expect(spawner).not.toMatch(/\.unref\(\)/);
  });
});

// ---- AC3: the tool gate -----------------------------------------------------

describe("the PreToolUse gate (AC3)", () => {
  it("allows allowlisted tools and Bash prefixes, denies the rest, one event per decision", async () => {
    const { manager, calls, store } = harness();
    const handle = await manager.startSession(startParams({ policy: { allowedTools: ["Read"], allowedBashPrefixes: ["echo"] } }));
    const call = calls[0] as QueryCall;

    const cases: [HookInput, string, string][] = [
      [preToolUse("Read", { file_path: "/x" }), "allow", "tool_allowed"],
      [preToolUse("Bash", { command: "echo hi" }), "allow", "bash_prefix_allowed"],
      [preToolUse("Bash", { command: "echo hi; touch x" }), "deny", "bash_shell_metacharacter"],
      [preToolUse("Bash", { command: "touch gated.txt" }), "deny", "bash_prefix_not_allowed"],
      [preToolUse("Write", { file_path: "/x" }), "deny", "tool_not_allowed"],
      [preToolUse("mcp__evil__tool", {}), "deny", "tool_not_allowed"],
    ];
    for (const [input, decision, reason] of cases) {
      expect(await decide(call, input)).toEqual({
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      });
    }
    const decisions = events(store, "tool_decision");
    expect(decisions).toHaveLength(cases.length);
    expect(decisions.map((e) => [e.payload.tool, e.payload.decision, e.payload.reason])).toEqual(
      cases.map(([input, d, r]) => [(input as { tool_name: string }).tool_name, d, r]),
    );
    expect(decisions.every((e) => e.session_id === handle.id && e.actor === "kernel")).toBe(true);
    expect(decisions[1]?.payload.command).toBe("echo hi");
    expect(decisions[0]?.payload).not.toHaveProperty("command");
    await manager.stopSession(handle.id);
  });

  it("denies echo when echo is not allowlisted", async () => {
    const { manager, calls } = harness();
    const handle = await manager.startSession(startParams({ policy: { allowedTools: [], allowedBashPrefixes: [] } }));
    expect((await decide(calls[0] as QueryCall, preToolUse("Bash", { command: "echo probe-hi" }))).permissionDecision).toBe("deny");
    await manager.stopSession(handle.id);
  });

  it("truncates a long Bash command in the event to 500 characters", async () => {
    const { manager, calls, store } = harness();
    const handle = await manager.startSession(startParams());
    const long = `echo ${"a".repeat(2_000)}`;
    await decide(calls[0] as QueryCall, preToolUse("Bash", { command: long }));
    expect((events(store, "tool_decision")[0]?.payload.command as string).length).toBe(500);
    await manager.stopSession(handle.id);
  });

  it("freezes the policy at start: changing the caller's arrays later changes nothing", async () => {
    const { manager, calls } = harness();
    const tools: string[] = [];
    const prefixes: string[] = [];
    const handle = await manager.startSession(startParams({ policy: { allowedTools: tools, allowedBashPrefixes: prefixes } }));
    tools.push("Write");
    prefixes.push("touch");
    const call = calls[0] as QueryCall;
    expect((await decide(call, preToolUse("Write", {}))).permissionDecision).toBe("deny");
    expect((await decide(call, preToolUse("Bash", { command: "touch x" }))).permissionDecision).toBe("deny");
    await manager.stopSession(handle.id);
  });

  it("denies a non-PreToolUse hook input with kernel_gate_error", async () => {
    const { manager, calls, store } = harness();
    const handle = await manager.startSession(startParams());
    const out = await decide(calls[0] as QueryCall, { hook_event_name: "PostToolUse" } as unknown as HookInput);
    expect(out).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "kernel_gate_error" });
    expect(events(store, "tool_decision")[0]?.payload).toMatchObject({ decision: "deny", reason: "kernel_gate_error" });
    await manager.stopSession(handle.id);
  });

  it("fails closed: an allow it cannot record becomes a deny", async () => {
    const { manager, calls, store } = harness();
    const handle = await manager.startSession(startParams());
    store.close();
    const out = await decide(calls[0] as QueryCall, preToolUse("Read", { file_path: "/x" }));
    expect(out).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "kernel_gate_error" });
    (calls[0] as QueryCall).stream.end();
    // The background loop cannot write either; `done` still settles.
    expect(await handle.done).toBe("failed");
  });
});

// ---- AC4: stop --------------------------------------------------------------

describe("stopSession (AC4, fakes)", () => {
  it("closes the input, kills the group, closes the query and marks stopped", async () => {
    const { manager, calls, killed, store } = harness({ script: ({ stream }) => stream.push(msg.init(UUID)) });
    const handle = await manager.startSession(startParams());
    const call = calls[0] as QueryCall;
    await vi.waitFor(() => expect(row(store, handle.id).status).toBe("running"));
    expect(await inputEndedWithin(call, 0)).toBe(false);

    expect(await manager.stopSession(handle.id)).toBe("stopped");
    expect(await inputEndedWithin(call, 0)).toBe(true);
    expect(killed).toContainEqual([handle.pgid, "SIGKILL"]);
    expect(call.stream.closeCalls).toBeGreaterThanOrEqual(1);
    expect(await handle.done).toBe("stopped");
    expect(row(store, handle.id).status).toBe("stopped");
    expect(row(store, handle.id).ended_at).not.toBeNull();
    expect(events(store, "session_status").at(-1)?.payload).toMatchObject({ from: "running", to: "stopped" });

    // Idempotent.
    expect(await manager.stopSession(handle.id)).toBe("stopped");
    expect(events(store, "session_status").filter((e) => e.payload.to === "stopped")).toHaveLength(1);
  });

  it("is a no-op returning the terminal status of a finished session, and refuses unknown ids", async () => {
    const { manager } = harness({ script: ({ stream }) => stream.push(msg.success()) });
    const handle = await manager.startSession(startParams());
    expect(await handle.done).toBe("completed");
    expect(await manager.stopSession(handle.id)).toBe("completed");
    const err = await manager.stopSession(9_999).catch((e: unknown) => e);
    expect((err as SessionError).code).toBe("not_found");
  });
});

// ---- AC5: reaper --------------------------------------------------------------

describe("reapOrphans (AC5)", () => {
  const STARTED = "2026-10-02T05:30:54.000Z";
  const STARTED_MS = Date.parse(STARTED);

  function insert(store: Store, status: string, pgid: number | null, leaderStartedAt: string | null = STARTED): number {
    return Number(
      store
        .prepare("INSERT INTO sessions (agent, status, pgid, sdk_session_id, leader_started_at) VALUES ('wright', ?, ?, 'sid', ?)")
        .run(status, pgid, leaderStartedAt).lastInsertRowid,
    );
  }

  /** A scheduler that runs every callback on the next turn, so kill-until-gone rounds cost no real time. */
  const immediate = (fn: () => void): CancelTimer => {
    const t = setImmediate(fn);
    return () => clearImmediate(t);
  };

  it("marks a row interrupted only when its group is gone or proven foreign, killing only groups proven to be the session's CLI", async () => {
    const store = openStore();
    const alive = new Set([300, 400, 500, 600, 700, 900, 1000, 1100, 1200]);
    const present = (command: string, startedAtMs = STARTED_MS): GroupLeader => ({ status: "present", command, startedAtMs });
    const leaders: Record<number, GroupLeader | "ps_failed"> = {
      300: present("/usr/bin/vim"), // pgid reused by an unrelated process
      400: present("/opt/sdk/claude", STARTED_MS + 400), // our CLI (same second, within tolerance)
      500: { status: "absent" }, // leader gone, group lives on
      600: present("claude"),
      700: present("claude"),
      900: present("/usr/local/bin/claude", STARTED_MS + 3_600_000), // the owner's interactive claude reusing the pgid
      1000: present("claude"), // its row has no recorded start time
      1100: "ps_failed",
      1200: present("claude"), // a group that never empties
    };
    const killed: number[] = [];
    const { manager } = harness({
      store,
      deps: {
        schedule: immediate,
        isGroupAlive: (pgid) => alive.has(pgid),
        readGroupLeader: (pgid) => {
          const leader = leaders[pgid];
          if (leader === "ps_failed") throw new LeaderProbeError("ps failed for pid 1100: ps: not found");
          return leader ?? { status: "absent" };
        },
        killGroup: (pgid) => {
          // EPERM is "not gone yet" (a zombie or a fork race), never "foreign".
          if (pgid === 600) throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
          if (pgid === 700) throw Object.assign(new Error("kill EINVAL"), { code: "EINVAL" });
          killed.push(pgid);
          const was = alive.has(pgid);
          if (pgid !== 1200) alive.delete(pgid);
          return was;
        },
      },
    });
    const ids = {
      noPgid: insert(store, "running", null),
      init: insert(store, "running", 1),
      gone: insert(store, "starting", 200),
      reused: insert(store, "running", 300),
      ours: insert(store, "running", 400),
      leaderless: insert(store, "starting", 500),
      eperm: insert(store, "running", 600),
      odd: insert(store, "running", 700),
      done: insert(store, "completed", 800),
      startDiffers: insert(store, "running", 900),
      noStart: insert(store, "running", 1000, null),
      psFailed: insert(store, "running", 1100),
      survives: insert(store, "running", 1200),
      later: insert(store, "running", null),
    };

    const results = await manager.reapOrphans();
    expect(results.map((r) => [r.sessionId, r.reason, r.status])).toEqual([
      [ids.noPgid, "no_pgid", "interrupted"],
      [ids.init, "no_pgid", "interrupted"],
      [ids.gone, "group_gone", "interrupted"],
      [ids.reused, "pgid_reused", "interrupted"],
      [ids.ours, "group_killed", "interrupted"],
      [ids.leaderless, "group_killed", "interrupted"],
      [ids.eperm, "kill_incomplete", "orphaned"],
      [ids.odd, "reap_error", "orphaned"],
      [ids.startDiffers, "pgid_reused", "interrupted"],
      [ids.noStart, "leader_unverified", "orphaned"],
      [ids.psFailed, "reap_error", "orphaned"],
      [ids.survives, "kill_incomplete", "orphaned"],
      [ids.later, "no_pgid", "interrupted"],
    ]);
    // Never signalled: a reused pgid, a foreign start time, an unrecorded start time, a failed ps.
    expect([...new Set(killed)].sort((a, b) => a - b)).toEqual([400, 500, 1200]);
    // A group that keeps answering is re-killed until the deadline, not signalled once.
    expect(killed.filter((p) => p === 1200).length).toBeGreaterThan(2);
    for (const r of results) expect(row(store, r.sessionId).status).toBe(r.status);
    expect(row(store, ids.done).status).toBe("completed");
    const statusEvents = events(store, "session_status");
    expect(statusEvents).toHaveLength(13);
    expect(statusEvents.find((e) => e.session_id === ids.ours)?.payload).toEqual({
      from: "running",
      to: "interrupted",
      reason: "group_killed",
      pgid: 400,
    });
    expect(statusEvents.find((e) => e.session_id === ids.odd)?.payload).toMatchObject({
      to: "orphaned",
      reason: "reap_error",
      error: "kill EINVAL",
    });
    expect(statusEvents.find((e) => e.session_id === ids.psFailed)?.payload).toMatchObject({
      to: "orphaned",
      reason: "reap_error",
      error: "ps failed for pid 1100: ps: not found",
    });
    expect(events(store, "session_kill_incomplete").map((e) => [e.session_id, e.payload])).toEqual([
      [ids.eperm, { pgid: 600, deadline_ms: 2_000 }],
      [ids.survives, { pgid: 1200, deadline_ms: 2_000 }],
    ]);

    // The next reap re-examines only the orphaned rows: a group now gone frees
    // its row, the rest stay orphaned with one deferral event each, no second status event.
    alive.delete(1000);
    alive.delete(1100);
    const again = await manager.reapOrphans();
    expect(again.map((r) => [r.sessionId, r.reason, r.status])).toEqual([
      [ids.eperm, "kill_incomplete", "orphaned"],
      [ids.odd, "reap_error", "orphaned"],
      [ids.noStart, "group_gone", "interrupted"],
      [ids.psFailed, "group_gone", "interrupted"],
      [ids.survives, "kill_incomplete", "orphaned"],
    ]);
    expect(events(store, "session_status")).toHaveLength(15);
    expect(events(store, "session_reap_deferred").map((e) => e.session_id)).toEqual([ids.eperm, ids.odd, ids.survives]);
    expect(row(store, ids.noStart).status).toBe("interrupted");
    expect(row(store, ids.survives).status).toBe("orphaned");
  });

  it("never kills when ps failed, even for a group whose leader may have exited", async () => {
    const store = openStore();
    const killed: number[] = [];
    const { manager } = harness({
      store,
      deps: {
        isGroupAlive: () => true,
        readGroupLeader: () => {
          throw new LeaderProbeError("ps failed for pid 4242: spawn /bin/ps ENOENT");
        },
        killGroup: (pgid) => {
          killed.push(pgid);
          return true;
        },
      },
    });
    const id = insert(store, "running", 4242);
    expect(await manager.reapOrphans()).toEqual([{ sessionId: id, pgid: 4242, status: "orphaned", reason: "reap_error" }]);
    expect(killed).toEqual([]);
    expect(row(store, id).status).toBe("orphaned");
  });

  it("never kills a claude leader whose start time differs from the recorded one", async () => {
    const store = openStore();
    const killed: number[] = [];
    const { manager } = harness({
      store,
      deps: {
        isGroupAlive: () => true,
        readGroupLeader: () => ({ status: "present", command: "claude", startedAtMs: STARTED_MS + 1_001 }),
        killGroup: (pgid) => {
          killed.push(pgid);
          return true;
        },
      },
    });
    const id = insert(store, "running", 4243);
    expect(await manager.reapOrphans()).toEqual([{ sessionId: id, pgid: 4243, status: "interrupted", reason: "pgid_reused" }]);
    expect(killed).toEqual([]);
  });

  it("returns the running reap to a concurrent caller instead of reaping twice", async () => {
    const store = openStore();
    let reads = 0;
    const { manager } = harness({
      store,
      deps: {
        isGroupAlive: () => true,
        readGroupLeader: () => {
          reads++;
          return { status: "present", command: "/usr/bin/vim", startedAtMs: STARTED_MS };
        },
      },
    });
    insert(store, "running", 4244);
    const first = manager.reapOrphans();
    expect(manager.reapOrphans()).toBe(first);
    expect(await first).toHaveLength(1);
    expect(reads).toBe(1);
    expect(events(store, "session_status")).toHaveLength(1);
    expect(await manager.reapOrphans()).toEqual([]);
  });

  it("leaves sessions this manager is running alone", async () => {
    const { manager, store } = harness();
    const handle = await manager.startSession(startParams());
    expect(await manager.reapOrphans()).toEqual([]);
    expect(row(store, handle.id).status).toBe("starting");
    await manager.stopSession(handle.id);
  });
});

describe("process-group kill until gone (fakes)", () => {
  const immediate = (fn: () => void): CancelTimer => {
    const t = setImmediate(fn);
    return () => clearImmediate(t);
  };

  it("records the leader's start time with the pgid", async () => {
    const startedAtMs = Date.parse("2026-10-02T05:30:54.000Z");
    const ok = harness({ deps: { readGroupLeader: () => ({ status: "present", command: "claude", startedAtMs }) } });
    const h1 = await ok.manager.startSession(startParams());
    expect(row(ok.store, h1.id).leader_started_at).toBe("2026-10-02T05:30:54.000Z");
    expect(ok.manager.getSession(h1.id)?.leader_started_at).toBe("2026-10-02T05:30:54.000Z");
    await ok.manager.stopSession(h1.id);
  });

  it("records a null leader start time when ps cannot read it, still writing the pgid", async () => {
    const failing = harness({
      deps: {
        readGroupLeader: () => {
          throw new LeaderProbeError("ps failed");
        },
      },
    });
    const h2 = await failing.manager.startSession(startParams());
    expect(row(failing.store, h2.id).pgid).toBe(h2.pgid);
    expect(row(failing.store, h2.id).leader_started_at).toBeNull();
    await failing.manager.stopSession(h2.id);
  });

  /**
   * A harness whose `killGroup` always reports "signalled" (the group still has
   * members) and kills the fake CLI, so only `isGroupAlive` says when the group is gone.
   */
  function stubbornHarness(isGroupAlive: (pgid: number) => boolean) {
    const kills: number[] = [];
    const h: ReturnType<typeof harness> = harness({
      deps: {
        schedule: immediate,
        isGroupAlive,
        killGroup: (pgid) => {
          kills.push(pgid);
          h.children.get(pgid)?.exit(null, "SIGKILL");
          return true;
        },
      },
      script: ({ stream }) => stream.push(msg.init(UUID)),
    });
    return { ...h, kills };
  }

  it("stop re-kills a group that still answers after the first SIGKILL (a child forked during it)", async () => {
    let probes = 0;
    const { manager, kills, store } = stubbornHarness(() => ++probes <= 2);
    const handle = await manager.startSession(startParams());
    await vi.waitFor(() => expect(row(store, handle.id).status).toBe("running"));
    expect(await manager.stopSession(handle.id)).toBe("stopped");
    expect(await handle.done).toBe("stopped");
    // SIGKILL, probe (alive), SIGKILL, probe (alive), SIGKILL, probe (gone); never signalled after that.
    expect(kills).toEqual([handle.pgid, handle.pgid, handle.pgid]);
    expect(events(store, "session_kill_incomplete")).toEqual([]);
  });

  it("gives up at the deadline with session_kill_incomplete, and stop finishes failed (kill_incomplete), never stopped", async () => {
    const { manager, kills: killed, store } = stubbornHarness(() => true);
    const handle = await manager.startSession(startParams());
    await vi.waitFor(() => expect(row(store, handle.id).status).toBe("running"));
    expect(await manager.stopSession(handle.id)).toBe("failed");
    expect(await handle.done).toBe("failed");
    const incomplete = events(store, "session_kill_incomplete");
    expect(incomplete.length).toBeGreaterThanOrEqual(1);
    expect(incomplete[0]?.payload).toEqual({ pgid: handle.pgid, deadline_ms: 2_000 });
    // Bounded: 2 000 ms / 25 ms = 80 re-kills after the first, per kill call.
    expect(killed.length).toBeLessThanOrEqual(81 * incomplete.length);
    expect(row(store, handle.id).status).toBe("failed");
    const terminal = events(store, "session_status").filter((e) => e.payload.from === "running");
    expect(terminal.map((e) => e.payload)).toEqual([
      {
        from: "running",
        to: "failed",
        reason: "kill_incomplete",
        cause: { to: "stopped", reason: "stop_requested" },
        pgid: handle.pgid,
      },
    ]);
  });

  it("a session whose result succeeded but whose group outlives the cleanup ends failed (kill_incomplete), not completed", async () => {
    const kills: number[] = [];
    const h: ReturnType<typeof harness> = harness({
      deps: {
        schedule: immediate,
        isGroupAlive: () => true,
        killGroup: (pgid) => {
          kills.push(pgid);
          h.children.get(pgid)?.exit(null, "SIGKILL");
          return true;
        },
      },
      script: ({ stream }) => {
        stream.push(msg.init(UUID));
        stream.push(msg.success());
      },
    });
    const handle = await h.manager.startSession(startParams());
    expect(await handle.done).toBe("failed");
    expect(events(h.store, "session_status").at(-1)?.payload).toMatchObject({
      from: "running",
      to: "failed",
      reason: "kill_incomplete",
      cause: { to: "completed", reason: "result_success" },
    });
    expect(events(h.store, "session_kill_incomplete").length).toBeGreaterThanOrEqual(1);
  });
});

// ---- AC6: resume ----------------------------------------------------------------

describe("resumeSession (AC6)", () => {
  const SID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const resumeParams = { permissionMode: "default" as const, cwd: "/tmp", policy: { allowedTools: [], allowedBashPrefixes: [] } };

  function interrupted(store: Store, overrides: { status?: string; sid?: string | null } = {}): number {
    return Number(
      store
        .prepare(
          "INSERT INTO sessions (agent, status, sdk_session_id, model, loomwright_path, pgid) VALUES ('wright', ?, ?, 'claude-haiku-4-5', ?, 4242)",
        )
        .run(overrides.status ?? "interrupted", overrides.sid === undefined ? SID : overrides.sid, pluginDir).lastInsertRowid,
    );
  }

  it("retries up to 3 attempts with backoff, recording each failure's full error text", async () => {
    const longMessage = `resume failed: ${"x".repeat(5_000)} END`;
    const store = openStore();
    const { manager, calls, delays, killed } = harness({
      store,
      stderr: "minified stack noise\n",
      script: ({ stream }, n) => {
        if (n === 1) stream.fail(new Error(longMessage));
        if (n === 2) {
          stream.push(msg.init(SID));
          stream.push(msg.errorResult(["No conversation found with session ID"]));
        }
        if (n === 3) {
          stream.push(msg.init(SID));
          stream.push(msg.assistant());
          stream.push(msg.success());
        }
      },
    });
    const id = interrupted(store);
    const handle = await manager.resumeSession(id, resumeParams);
    expect(await handle.done).toBe("completed");

    expect(calls).toHaveLength(3);
    expect(delays).toEqual([1_000, 2_000]);
    for (const call of calls) {
      expect(call.options.resume).toBe(SID);
      expect(call.options).not.toHaveProperty("sessionId");
      expect(call.options.settingSources).toEqual([]);
      expect(call.options.plugins).toEqual([{ type: "local", path: pluginDir }]);
      expect(call.options.model).toBe("claude-haiku-4-5");
      expect(call.options.permissionMode).toBe("default");
      expect(call.options.includeHookEvents).toBe(true);
      expect(call.options.env).toEqual({ PATH: "/usr/bin", ANTHROPIC_API_KEY: SECRET });
      expect(call.options.hooks?.PreToolUse).toHaveLength(1);
    }
    expect((await firstPrompt(calls[0] as QueryCall)).message).toEqual({ role: "user", content: DEFAULT_RESUME_PROMPT });

    const failures = events(store, "session_resume_failed");
    expect(failures).toHaveLength(2);
    expect(failures[0]?.payload).toMatchObject({ attempt: 1, error: longMessage, stderr: "minified stack noise\n" });
    expect(failures[0]?.payload.stack).toContain(longMessage.slice(0, 50));
    expect(failures[1]?.payload).toMatchObject({ attempt: 2 });
    expect(failures[1]?.payload.error).toContain("No conversation found with session ID");
    // Each failed attempt's group is killed.
    expect(killed.map(([p]) => p)).toEqual(expect.arrayContaining([calls[0]?.child.pid, calls[1]?.child.pid]));
    expect(row(store, id).status).toBe("completed");
  });

  it("marks the session failed (resume_failed) after 3 failing attempts", async () => {
    const store = openStore();
    const { manager, calls, delays } = harness({
      store,
      script: ({ stream }, n) => stream.fail(new Error(`attempt ${n} broke`)),
    });
    const id = interrupted(store);
    const handle = await manager.resumeSession(id, resumeParams);
    expect(await handle.done).toBe("failed");
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([1_000, 2_000]);
    expect(events(store, "session_resume_failed").map((e) => e.payload.error)).toEqual([
      "attempt 1 broke",
      "attempt 2 broke",
      "attempt 3 broke",
    ]);
    expect(events(store, "session_status").at(-1)?.payload).toMatchObject({ to: "failed", reason: "resume_failed" });
  });

  it("does not retry an auth failure during resume", async () => {
    const store = openStore();
    const { manager, calls, delays } = harness({
      store,
      script: ({ stream }) => {
        stream.push(msg.init(SID));
        stream.push(msg.apiRetry401());
      },
    });
    const id = interrupted(store);
    const handle = await manager.resumeSession(id, resumeParams);
    expect(await handle.done).toBe("failed:auth");
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
    expect(events(store, "notify")).toHaveLength(1);
    expect(events(store, "session_resume_failed")).toHaveLength(0);
  });

  /** Leader probes for a recorded group that is still alive. */
  const claudeLeader = (startedAtMs = Date.parse("2026-10-02T05:30:54.000Z")): GroupLeader => ({
    status: "present",
    command: "claude",
    startedAtMs,
  });

  it("refuses an interrupted row whose group is alive and not proven foreign, and marks it orphaned (no second CLI)", async () => {
    const cases: [string, Partial<SessionManagerDeps>, string][] = [
      ["no recorded start time", { readGroupLeader: () => claudeLeader() }, "leader_unverified"],
      ["leader gone, group alive", { readGroupLeader: () => ({ status: "absent" }) }, "group_alive"],
      [
        "ps failed",
        {
          readGroupLeader: () => {
            throw new LeaderProbeError("ps failed for pid 4242: timeout");
          },
        },
        "reap_error",
      ],
    ];
    for (const [name, deps, reason] of cases) {
      const store = new Store({ dataDir: join(tmp, `data-${reason}`) });
      stores.push(store);
      const { manager, calls, spawnCalls } = harness({ store, deps: { isGroupAlive: () => true, ...deps } });
      const id = interrupted(store);
      const err = await manager.resumeSession(id, resumeParams).catch((e: unknown) => e);
      expect((err as SessionError).code, name).toBe("not_resumable");
      expect(calls, name).toHaveLength(0);
      expect(spawnCalls, name).toHaveLength(0);
      expect(row(store, id).status, name).toBe("orphaned");
      expect(events(store, "session_status").at(-1)?.payload, name).toMatchObject({
        from: "interrupted",
        to: "orphaned",
        reason,
        pgid: 4242,
        by: "resume",
      });
      // Refused again while it holds, with an event, and no further status change.
      const again = await manager.resumeSession(id, resumeParams).catch((e: unknown) => e);
      expect((again as SessionError).code, name).toBe("not_resumable");
      expect(events(store, "session_resume_refused").map((e) => e.payload.reason), name).toEqual([reason]);
      expect(events(store, "session_status"), name).toHaveLength(1);
    }
  });

  it("resumes a row whose live group is proven foreign (pgid_reused)", async () => {
    const store = openStore();
    const { manager, calls } = harness({
      store,
      deps: { isGroupAlive: () => true, readGroupLeader: () => ({ status: "present", command: "/usr/bin/vim", startedAtMs: 0 }) },
      script: ({ stream }) => {
        stream.push(msg.init(SID));
        stream.push(msg.assistant());
        stream.push(msg.success());
      },
    });
    const id = interrupted(store);
    expect(await (await manager.resumeSession(id, resumeParams)).done).toBe("completed");
    expect(calls).toHaveLength(1);
  });

  it("resumes an orphaned row once its group is gone, moving it back to interrupted first", async () => {
    const store = openStore();
    let groupAlive = true;
    const { manager, calls } = harness({
      store,
      deps: { isGroupAlive: () => groupAlive, readGroupLeader: () => claudeLeader() },
      script: ({ stream }) => {
        stream.push(msg.init(SID));
        stream.push(msg.assistant());
        stream.push(msg.success());
      },
    });
    const id = interrupted(store, { status: "orphaned" });
    const err = await manager.resumeSession(id, resumeParams).catch((e: unknown) => e);
    expect((err as SessionError).code).toBe("not_resumable");
    expect(calls).toHaveLength(0);
    expect(row(store, id).status).toBe("orphaned");

    groupAlive = false;
    expect(await (await manager.resumeSession(id, resumeParams)).done).toBe("completed");
    expect(calls).toHaveLength(1);
    expect(events(store, "session_status").map((e) => [e.payload.from, e.payload.to, e.payload.reason])).toEqual([
      ["orphaned", "interrupted", "group_gone"],
      ["interrupted", "starting", "resume_attempt"],
      ["starting", "running", undefined],
      ["running", "completed", "result_success"],
    ]);
  });

  it("reviewer repro: a spawn-time ps failure, a kernel restart and a reap never let a resume start a second group", async () => {
    const store = openStore();
    // Kernel A: the leader's start time cannot be read at spawn.
    const a = harness({
      store,
      deps: {
        readGroupLeader: () => {
          throw new LeaderProbeError("ps failed");
        },
      },
      script: ({ stream }) => stream.push(msg.init(UUID)),
    });
    const handle = await a.manager.startSession(startParams());
    await vi.waitFor(() => expect(row(store, handle.id).status).toBe("running"));
    expect(row(store, handle.id).leader_started_at).toBeNull();
    // Kernel A dies (its in-memory state is gone; the group lives on). Kernel B boots.
    const pgid = handle.pgid as number;
    const b = harness({
      store,
      deps: { isGroupAlive: (p) => p === pgid, readGroupLeader: () => claudeLeader() },
    });
    expect(await b.manager.reapOrphans()).toEqual([{ sessionId: handle.id, pgid, status: "orphaned", reason: "leader_unverified" }]);
    expect(b.killed).toEqual([]);
    const err = await b.manager.resumeSession(handle.id, resumeParams).catch((e: unknown) => e);
    expect((err as SessionError).code).toBe("not_resumable");
    expect(b.calls).toHaveLength(0);
    expect(b.spawnCalls).toHaveLength(0);
  });

  it("stops with failed (kill_incomplete) instead of launching the next attempt when a failed attempt's group outlives the kill", async () => {
    const store = openStore();
    const immediate = (fn: () => void): CancelTimer => {
      const t = setImmediate(fn);
      return () => clearImmediate(t);
    };
    const spawned = new Set<number>();
    const { manager, calls, delays } = harness({
      store,
      deps: {
        schedule: immediate,
        // The row's old group (4242) is gone; every attempt's new group never empties.
        isGroupAlive: (pgid) => spawned.has(pgid),
        killGroup: () => true,
      },
      script: ({ stream, child }) => {
        spawned.add(child.pid);
        stream.fail(new Error("resume broke"));
      },
    });
    const id = interrupted(store);
    const handle = await manager.resumeSession(id, resumeParams);
    expect(await handle.done).toBe("failed");
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
    expect(events(store, "session_resume_failed")).toHaveLength(1);
    expect(events(store, "session_kill_incomplete").length).toBeGreaterThanOrEqual(1);
    expect(events(store, "session_status").at(-1)?.payload).toMatchObject({
      to: "failed",
      reason: "kill_incomplete",
      cause: { to: "failed", reason: "resume_attempt_failed" },
      pgid: calls[0]?.child.pid,
    });
  });

  it("does not retry a first attempt whose launch threw after spawning a group that outlives the kill", async () => {
    const store = openStore();
    const immediate = (fn: () => void): CancelTimer => {
      const t = setImmediate(fn);
      return () => clearImmediate(t);
    };
    const spawned = new Set<number>();
    const { manager, calls } = harness({
      store,
      deps: { schedule: immediate, isGroupAlive: (pgid) => spawned.has(pgid), killGroup: () => true },
      script: ({ child }) => {
        spawned.add(child.pid);
        throw new Error("query() threw after the spawn");
      },
    });
    const id = interrupted(store);
    const handle = await manager.resumeSession(id, resumeParams);
    expect(await handle.done).toBe("failed");
    expect(calls).toHaveLength(1);
    expect(events(store, "session_status").at(-1)?.payload).toMatchObject({ to: "failed", reason: "kill_incomplete" });
  });

  it("a reap that awaited a kill never overwrites a row a resume took meanwhile", async () => {
    const store = openStore();
    let alive = true;
    let releaseKill: (() => void) | undefined;
    const { manager } = harness({
      store,
      deps: {
        isGroupAlive: () => alive,
        readGroupLeader: () => ({ status: "absent" }),
        killGroup: () => true,
        // The reaper's first kill-until-gone sleep (25 ms) waits here until released.
        schedule: (fn, ms) => {
          if (releaseKill === undefined && ms === 25) {
            releaseKill = fn;
            return () => {};
          }
          const t = setImmediate(fn);
          return () => clearImmediate(t);
        },
      },
      script: ({ stream }) => stream.push(msg.init(SID)),
      endOnInputEnd: false,
    });
    const id = interrupted(store, { status: "orphaned" });
    const reap = manager.reapOrphans();
    await vi.waitFor(() => expect(releaseKill).not.toBe(undefined));
    // The group goes away by itself while the reaper waits; a resume takes the row.
    alive = false;
    const handle = await manager.resumeSession(id, resumeParams);
    expect(["starting", "running"]).toContain(row(store, id).status);
    releaseKill?.();
    expect(await reap).toEqual([]);
    expect(events(store, "session_status").filter((e) => e.payload.to === "interrupted")).toHaveLength(1);
    await vi.waitFor(() => expect(row(store, id).status).toBe("running"));
    expect(await manager.stopSession(handle.id)).toBe("stopped");
  });

  it("refuses rows that are not interrupted, have no SDK session id, or do not exist", async () => {
    const store = openStore();
    const { manager, calls } = harness({ store });
    for (const id of [interrupted(store, { status: "completed" }), interrupted(store, { sid: null }), interrupted(store, { status: "running" })]) {
      const err = await manager.resumeSession(id, resumeParams).catch((e: unknown) => e);
      expect((err as SessionError).code).toBe("not_resumable");
    }
    expect(((await manager.resumeSession(9_999, resumeParams).catch((e: unknown) => e)) as SessionError).code).toBe("not_found");
    const bypass = await manager
      .resumeSession(interrupted(store), { ...resumeParams, permissionMode: "bypassPermissions" } as never)
      .catch((e: unknown) => e);
    expect((bypass as SessionError).code).toBe("forbidden_permission_mode");
    expect(calls).toHaveLength(0);
  });
});

// ---- AC7: auth failure --------------------------------------------------------------

describe("auth failure (AC7)", () => {
  function capturingSchedule() {
    const timers: { ms: number; fn: () => void; cancelled: boolean }[] = [];
    const schedule = (fn: () => void, ms: number): CancelTimer => {
      if (ms !== 30_000) {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      }
      const timer = { ms, fn, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    };
    return { timers, schedule };
  }

  it("fails the session on the first api_retry 401: failed:auth, one notify, abort, kill after the timeout", async () => {
    const { timers, schedule } = capturingSchedule();
    const { manager, calls, store, killed } = harness({
      deps: { schedule },
      endOnInputEnd: false,
      script: ({ stream }) => {
        stream.push(msg.init(UUID));
        stream.push(msg.apiRetry401(1));
        stream.push(msg.apiRetry401(2)); // the CLI keeps retrying; the kernel does not wait
      },
    });
    const handle = await manager.startSession(startParams());
    const call = calls[0] as QueryCall;
    await vi.waitFor(() => expect(row(store, handle.id).status).toBe("failed:auth"));

    expect(call.options.abortController?.signal.aborted).toBe(true);
    const notify = events(store, "notify");
    expect(notify).toHaveLength(1);
    expect(notify[0]?.payload).toEqual({
      reason: "auth_failed",
      provider: "stub-provider",
      account: "owner@example.test",
      error_status: 401,
      error: "authentication_failed",
    });
    for (const e of events(store)) expect(e.raw).not.toContain(SECRET);
    expect(await inputEndedWithin(call, 0)).toBe(true);

    // The stream never ends; the kernel's own timer kills the group.
    expect(timers.map((t) => t.ms)).toEqual([30_000]);
    expect(killed).toEqual([]);
    timers[0]?.fn();
    expect(killed).toEqual([[handle.pgid, "SIGKILL"]]);
    expect(await handle.done).toBe("failed:auth");
    expect(events(store, "notify")).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("treats an assistant authentication_failed error the same way", async () => {
    const { manager, store } = harness({
      script: ({ stream }) => {
        stream.push(msg.init(UUID));
        stream.push(msg.assistantAuthError());
        stream.push(msg.success());
      },
    });
    const handle = await manager.startSession(startParams());
    expect(await handle.done).toBe("failed:auth");
    expect(events(store, "notify")).toHaveLength(1);
    expect(events(store, "notify")[0]?.payload).toMatchObject({ error_status: null, error: "authentication_failed" });
  });

  it("never arms the auth timer for a healthy session", async () => {
    const { timers, schedule } = capturingSchedule();
    const { manager } = harness({
      deps: { schedule },
      script: ({ stream }) => {
        stream.push(msg.init(UUID));
        stream.push(msg.success());
      },
    });
    expect(await (await manager.startSession(startParams())).done).toBe("completed");
    expect(timers).toEqual([]);
  });

  const buildEnvFailures: [string, () => Error, string][] = [
    ["AuthProviderError missing", () => new AuthProviderError("missing", "stub-provider", "not found"), "missing"],
    ["AuthProviderError invalid_shape", () => new AuthProviderError("invalid_shape", "stub-provider", "cut off"), "invalid_shape"],
    ["KeychainError", () => new KeychainError("loomwright-studio-oauth", 51, null), "keychain_error"],
  ];
  for (const [name, makeError, code] of buildEnvFailures) {
    it(`spawns nothing on ${name}: failed:auth row, one notify, rethrown`, async () => {
      const error = makeError();
      const { manager, calls, spawnCalls, store } = harness({
        options: {
          authProvider: stubProvider({
            buildEnv: () => {
              throw error;
            },
          }),
        },
      });
      await expect(manager.startSession(startParams())).rejects.toBe(error);
      expect(calls).toHaveLength(0);
      expect(spawnCalls).toHaveLength(0);
      const rows = store.prepare<[], SessionRow>("SELECT * FROM sessions").all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "failed:auth", pgid: null, loomwright_path: pluginDir });
      const notify = events(store, "notify");
      expect(notify).toHaveLength(1);
      expect(notify[0]?.payload).toEqual({
        provider: "stub-provider",
        account: "owner@example.test",
        reason: "auth_failed",
        code,
      });
    });
  }
});

// ---- AC8: Loomwright path ------------------------------------------------------------

describe("resolveLoomwrightPath (AC8)", () => {
  it("prefers a configured path, resolved to absolute", () => {
    const configured = makePluginVersion(join(tmp, "configured"), "dev");
    // A valid cache exists too (beforeEach); the configured path still wins.
    expect(resolveLoomwrightPath({ configured, cacheRoot: join(tmp, "plugin-cache") })).toBe(configured);
    const rel = relative(process.cwd(), configured);
    expect(isAbsolute(rel)).toBe(false);
    expect(resolveLoomwrightPath({ configured: rel, cacheRoot: join(tmp, "nowhere") })).toBe(configured);
    expect(resolveLoomwrightPath({ configured: `${configured}/.`, cacheRoot: join(tmp, "nowhere") })).toBe(configured);
  });

  it("never falls back from a configured path without a manifest", () => {
    const bad = makePluginVersion(join(tmp, "configured"), "broken", false);
    const err = (() => {
      try {
        resolveLoomwrightPath({ configured: bad, cacheRoot: join(tmp, "plugin-cache") });
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(SessionError);
    expect((err as SessionError).code).toBe("loomwright_not_found");
  });

  it("picks the numerically newest cached version that has a manifest", () => {
    const cache = join(tmp, "cache");
    makePluginVersion(cache, "15.98.0");
    const newest = makePluginVersion(cache, "15.115.0");
    makePluginVersion(cache, "15.61.0", false); // a stale leftover
    makePluginVersion(cache, "15.200.0", false);
    makePluginVersion(cache, "latest");
    mkdirSync(join(cache, "16.0.0-beta"), { recursive: true });
    writeFileSync(join(cache, "17.0.0"), "a file, not a dir");
    expect(resolveLoomwrightPath({ cacheRoot: cache })).toBe(newest);
    expect(resolveLoomwrightPath({ configured: "", cacheRoot: cache })).toBe(newest);
  });

  it("throws loomwright_not_found when nothing valid is cached", () => {
    const cache = join(tmp, "empty-cache");
    makePluginVersion(cache, "15.61.0", false);
    for (const cacheRoot of [cache, join(tmp, "missing")]) {
      expect(() => resolveLoomwrightPath({ cacheRoot })).toThrow(SessionError);
    }
  });

  it("records the resolved path on the session row and in the plugin option", async () => {
    const cache = join(tmp, "cache2");
    makePluginVersion(cache, "15.98.0");
    const newest = makePluginVersion(cache, "15.115.0");
    const { manager, calls, store } = harness({
      options: { loomwrightPath: undefined, pluginCacheRoot: cache },
      script: ({ stream }) => stream.push(msg.success()),
    });
    const handle = await manager.startSession(startParams());
    await handle.done;
    expect(row(store, handle.id).loomwright_path).toBe(newest);
    expect(calls[0]?.options.plugins).toEqual([{ type: "local", path: newest }]);
  });

  it("refuses to start, with no row, when no Loomwright install is found", async () => {
    const { manager, calls, store } = harness({ options: { loomwrightPath: join(tmp, "nope") } });
    const err = await manager.startSession(startParams()).catch((e: unknown) => e);
    expect((err as SessionError).code).toBe("loomwright_not_found");
    expect(calls).toHaveLength(0);
    expect(sessionCount(store)).toBe(0);
  });
});
