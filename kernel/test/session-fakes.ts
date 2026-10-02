// A minimal fake spawner and SDK query for the loopback-API, stop-all and
// daemon tests, modelled on the harness in sessions.test.ts (which stays as
// it is). Never the real SDK, a model or a real process: fake pids are above
// any real pid_max, and every process-group call is answered from memory.
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { Options, SDKMessage, SDKUserMessage, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import type { AuthProvider } from "../src/auth/index.js";
import type { CancelTimer, QueryFn, QueryHandle, SessionManagerDeps, SpawnFn, StartSessionParams } from "../src/sessions/index.js";

export class FakeChild extends EventEmitter {
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

/** A controllable message stream standing in for the SDK's `Query`. */
export class FakeStream implements QueryHandle {
  readonly #queue: SDKMessage[] = [];
  readonly #waiters: ((r: IteratorResult<SDKMessage>) => void)[] = [];
  #ended = false;
  onEnd: () => void = () => {};

  push(message: SDKMessage): void {
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) waiter({ value: message, done: false });
    else this.#queue.push(message);
  }

  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    for (const w of this.#waiters.splice(0)) w({ value: undefined, done: true });
    this.onEnd();
  }

  close(): void {
    this.end();
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: () => {
        const message = this.#queue.shift();
        if (message !== undefined) return Promise.resolve({ value: message, done: false });
        if (this.#ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
      return: () => {
        this.end();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

export interface FakeCall {
  readonly options: Options;
  readonly stream: FakeStream;
  readonly child: FakeChild;
}

export const fakeMsg = {
  init: (sessionId: string): SDKMessage => ({ type: "system", subtype: "init", session_id: sessionId }) as unknown as SDKMessage,
  apiRetry401: (): SDKMessage =>
    ({ type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: 401, error: "authentication_failed" }) as unknown as SDKMessage,
};

export interface FakeSessionsOptions {
  /**
   * Whether the fake CLI exits when its input ends. Default false: a CLI that
   * ignores stdin EOF, so a stop has to kill its group.
   */
  readonly exitOnInputEnd?: boolean;
  /** Called synchronously inside each fake `query()`, after the spawn. Default: push `system/init`. */
  readonly script?: (call: FakeCall, n: number) => void;
}

/** Injected session-manager deps plus what they recorded. `isGroupAlive` answers from the fake children. */
export function fakeSessions(o: FakeSessionsOptions = {}) {
  const calls: FakeCall[] = [];
  const children = new Map<number, FakeChild>();
  const killed: [number, string][] = [];
  let nextPid = 2_000_000_000;
  let nextUuid = 1;

  const spawn: SpawnFn = (_options, hooks) => {
    const child = new FakeChild(nextPid++);
    children.set(child.pid, child);
    hooks.onSpawn?.(child.pid);
    return child as unknown as SpawnedProcess;
  };

  const query: QueryFn = ({ prompt, options }) => {
    const stream = new FakeStream();
    // Like the SDK: the spawn runs synchronously at query() creation.
    const child = options.spawnClaudeCodeProcess?.({
      command: "claude",
      args: [],
      cwd: options.cwd,
      env: options.env ?? {},
      signal: new AbortController().signal,
    }) as unknown as FakeChild;
    stream.onEnd = () => child.exit(0, null);
    // The SDK ends the stream when the CLI exits.
    child.once("exit", () => stream.end());
    const inputEnded = (async () => {
      for await (const _m of prompt as AsyncIterable<SDKUserMessage>) {
        // Read and drop the prompt, like the CLI.
      }
    })();
    if (o.exitOnInputEnd === true) void inputEnded.then(() => stream.end());
    const call: FakeCall = { options, stream, child };
    calls.push(call);
    if (o.script !== undefined) o.script(call, calls.length);
    else stream.push(fakeMsg.init(options.sessionId ?? options.resume ?? "unknown"));
    return stream;
  };

  const killGroup = (pgid: number, signal: NodeJS.Signals): boolean => {
    killed.push([pgid, signal]);
    const child = children.get(pgid);
    if (child === undefined || child.exited) return false;
    child.exit(null, signal);
    return true;
  };

  const isGroupAlive = (pgid: number): boolean => {
    const child = children.get(pgid);
    return child !== undefined && !child.exited;
  };

  const deps: SessionManagerDeps = {
    query,
    spawn,
    killGroup,
    isGroupAlive,
    readGroupLeader: () => ({ status: "absent" }),
    sleep: async () => {},
    randomUUID: () => `00000000-0000-4000-8000-${String(nextUuid++).padStart(12, "0")}`,
  };
  /** Every recorded group is gone. */
  const allGroupsGone = (): boolean => [...children.keys()].every((pgid) => !isGroupAlive(pgid));
  return { deps, calls, children, killed, isGroupAlive, allGroupsGone };
}

/** A scheduler that runs callbacks on the next macrotask (bounded waits and kill rounds pass at once). */
export const immediate = (fn: () => void, _ms: number): CancelTimer => {
  const t = setImmediate(fn);
  return () => clearImmediate(t);
};

/** A Loomwright install the manager accepts as `loomwrightPath`. */
export function makePluginDir(root: string): string {
  const dir = join(root, "plugin-cache", "15.115.0");
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), '{"name":"loomwright"}\n');
  return dir;
}

export function stubProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    id: "stub-provider",
    account: "owner@example.test",
    buildEnv: () => ({ PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-ant-test-secret-value" }),
    health: () => ({ status: "ok" }),
    ...overrides,
  };
}

export function startParams(cwd: string, overrides: Partial<StartSessionParams> = {}): StartSessionParams {
  return {
    agent: "wright",
    prompt: "Say hi.",
    model: "claude-haiku-4-5",
    permissionMode: "default",
    cwd,
    policy: { allowedTools: ["Read"], allowedBashPrefixes: ["echo"] },
    ...overrides,
  };
}

/** Let pending timers, immediates and microtasks run. */
export async function flush(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
