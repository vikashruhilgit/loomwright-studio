import { randomUUID as nodeRandomUUID } from "node:crypto";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type {
  HookCallback,
  HookJSONOutput,
  Options,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
  SpawnOptions,
  SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import { KeychainError } from "../auth/keychain.js";
import { AuthProviderError } from "../auth/types.js";
import type { AuthProvider, BaseEnv, ChildEnv } from "../auth/types.js";
import type { Store } from "../store/store.js";
import { resolveLoomwrightPath } from "./loomwright-path.js";
import { bashCommandOf, decideToolUse, freezePolicy } from "./policy.js";
import {
  KILL_GROUP_DEADLINE_MS,
  StderrTail,
  isProcessGroupAlive,
  isValidPgid,
  killGroupUntilGone,
  killProcessGroup,
  leaderBasename,
  readGroupLeader,
  spawnInNewProcessGroup,
} from "./spawner.js";
import {
  DEFAULT_RESUME_PROMPT,
  MAX_RESUME_ATTEMPTS,
  SessionError,
  isTerminalStatus,
} from "./types.js";
import type {
  AllowedPermissionMode,
  CancelTimer,
  GroupLeader,
  QueryFn,
  QueryHandle,
  ResumeSessionParams,
  SessionHandle,
  SessionManagerDeps,
  SessionManagerOptions,
  SessionRow,
  SessionStatus,
  SpawnFn,
  StartSessionParams,
  ToolPolicy,
} from "./types.js";

/** After a SIGKILL (or a stream end), how long to wait for the leader's `exit`. */
const LEADER_EXIT_WAIT_MS = 1_000;
/** Cap for a recorded stack or stderr tail. The error message itself is never truncated. */
const MAX_RECORDED_TEXT = 64 * 1024;
/** A Bash command in a `tool_decision` event is truncated to this many characters. */
const MAX_EVENT_COMMAND_CHARS = 500;
/** The bundled CLI's executable name; the reaper kills only groups led by it (or leaderless). */
const CLI_BASENAME = "claude";
/**
 * The reaper treats a live leader as the session's own CLI only when its start
 * time is within this of the recorded one. `ps` prints whole seconds, so the
 * same process always reads the same value; the slack only absorbs rounding.
 */
const LEADER_START_TOLERANCE_MS = 1_000;

const ALLOWED_PERMISSION_MODES: readonly string[] = ["default", "acceptEdits", "plan", "dontAsk", "auto"];

/** One reaper decision: the row was marked `interrupted` for `reason`. */
export interface ReapResult {
  readonly sessionId: number;
  readonly pgid: number | null;
  readonly reason:
    | "no_pgid"
    | "group_gone"
    | "pgid_reused"
    | "leader_unverified"
    | "group_killed"
    | "kill_incomplete"
    | "group_not_ours"
    | "reap_error";
}

/**
 * The prompt channel: a push-based async iterable the SDK reads as streaming
 * input (required for in-process kernel tools, Q5). `close()` ends it; the SDK
 * then ends the CLI's stdin.
 */
class InputChannel implements AsyncIterable<SDKUserMessage> {
  readonly #queue: SDKUserMessage[] = [];
  readonly #waiters: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
  #closed = false;

  get closed(): boolean {
    return this.#closed;
  }

  push(message: SDKUserMessage): boolean {
    if (this.#closed) return false;
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) waiter({ value: message, done: false });
    else this.#queue.push(message);
    return true;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const queued = this.#queue.shift();
        if (queued !== undefined) return Promise.resolve({ value: queued, done: false });
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

/** One `query()` run: the start, or one resume attempt. */
interface Attempt {
  readonly number: number;
  readonly input: InputChannel;
  readonly abortController: AbortController;
  readonly stderrTail: StderrTail;
  readonly closeInputOnResult: boolean;
  /** Resume attempts are not confirmed until assistant output or a successful result. */
  confirmed: boolean;
  query: QueryHandle | undefined;
  child: SpawnedProcess | undefined;
  pgid: number | undefined;
  /** The group was killed until `ESRCH`: it is gone and is never signalled again. */
  groupGone: boolean;
  /** The kill-until-gone in flight, shared by concurrent callers. */
  killing: Promise<void> | undefined;
  readonly exited: Promise<void>;
  markExited: () => void;
  sawInit: boolean;
  firstResult: SDKResultMessage | undefined;
  lastResult: SDKResultMessage | undefined;
  authTimer: CancelTimer | undefined;
}

interface LiveSession {
  readonly id: number;
  sdkSessionId: string;
  readonly policy: ToolPolicy;
  status: SessionStatus;
  attempt: Attempt | undefined;
  stopping: boolean;
  stopPromise: Promise<SessionStatus> | undefined;
  authFailed: boolean;
  settled: boolean;
  readonly done: Promise<SessionStatus>;
  resolveDone: (status: SessionStatus) => void;
}

type ConsumeOutcome =
  | { readonly kind: "ended" }
  | { readonly kind: "rejected"; readonly error: unknown }
  /** A resume attempt failed before it was confirmed; the resume loop retries. */
  | { readonly kind: "attempt_failed"; readonly error: unknown };

interface LaunchConfig {
  readonly number: number;
  readonly prompt: string;
  readonly model: string;
  readonly permissionMode: AllowedPermissionMode;
  readonly cwd: string;
  readonly env: ChildEnv;
  readonly loomwrightPath: string;
  readonly closeInputOnResult: boolean;
  /** `{sessionId}` for a start, `{resume}` for a resume. */
  readonly sessionOptions: Pick<Options, "sessionId" | "resume">;
  readonly resumeMode: boolean;
}

interface ResumeContext {
  readonly prompt: string;
  readonly model: string;
  readonly permissionMode: AllowedPermissionMode;
  readonly cwd: string;
  readonly loomwrightPath: string;
  readonly closeInputOnResult: boolean;
  readonly sdkSessionId: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorStack(err: unknown): string | undefined {
  return err instanceof Error && typeof err.stack === "string" ? err.stack.slice(0, MAX_RECORDED_TEXT) : undefined;
}

function errnoCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined;
}

/** The last `MAX_RECORDED_TEXT` characters. */
function tail(text: string): string {
  return text.length > MAX_RECORDED_TEXT ? text.slice(text.length - MAX_RECORDED_TEXT) : text;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Refuse `bypassPermissions` and any missing/unknown mode, before any row or spawn. */
function checkPermissionMode(mode: unknown): AllowedPermissionMode {
  if (mode === "bypassPermissions") {
    throw new SessionError("forbidden_permission_mode", "permissionMode bypassPermissions is never allowed (D5)");
  }
  if (typeof mode !== "string" || !ALLOWED_PERMISSION_MODES.includes(mode)) {
    throw new SessionError("invalid_params", `permissionMode is required and must be one of ${ALLOWED_PERMISSION_MODES.join(", ")}`);
  }
  return mode as AllowedPermissionMode;
}

function checkPolicy(policy: unknown): ToolPolicy {
  const p = policy as Partial<ToolPolicy> | undefined;
  if (typeof p !== "object" || p === null || !isStringArray(p.allowedTools) || !isStringArray(p.allowedBashPrefixes)) {
    throw new SessionError("invalid_params", "policy must have string arrays allowedTools and allowedBashPrefixes");
  }
  return freezePolicy(p as ToolPolicy);
}

function userMessage(prompt: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: prompt }, parent_tool_use_id: null };
}

function isSuccessResult(result: SDKResultMessage): boolean {
  return result.subtype === "success" && result.is_error !== true;
}

function resultErrorText(result: SDKResultMessage): string {
  const errors = "errors" in result ? result.errors.join("; ") : "";
  return `result ${result.subtype}${result.is_error ? " (is_error)" : ""}${errors === "" ? "" : `: ${errors}`}`;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const defaultSchedule = (fn: () => void, ms: number): CancelTimer => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

/**
 * Owns every Claude session's lifecycle (invariant 2): start, gate, stop,
 * reap, resume. Each session is an SDK `query()` whose CLI the kernel spawns
 * itself in a new process group, with:
 *
 * - isolation: `settingSources: []`, one local Loomwright plugin, the auth
 *   provider's env, explicit `model` and `permissionMode` (never
 *   `bypassPermissions`), streaming input, `includeHookEvents: true`;
 * - a kernel `PreToolUse` hook that decides every tool call from the
 *   session's frozen policy and records each decision (invariant 3);
 * - the group id written to `sessions.pgid` before the first message is
 *   awaited, and the SDK session id pre-assigned, so a kernel killed at any
 *   point leaves a reapable group and a resumable id.
 *
 * Every status change is written to the row and appended to `events`
 * (`session_status`) in one transaction.
 */
export class SessionManager {
  readonly #store: Store;
  readonly #auth: AuthProvider;
  readonly #configuredLoomwrightPath: string | undefined;
  readonly #pluginCacheRoot: string | undefined;
  readonly #baseEnv: BaseEnv;
  readonly #stopGraceMs: number;
  readonly #authTimeoutMs: number;
  readonly #resumeBackoffMs: readonly number[];
  readonly #onMessage: ((sessionId: number, message: SDKMessage) => void) | undefined;

  readonly #query: QueryFn;
  readonly #spawn: SpawnFn;
  readonly #killGroup: (pgid: number, signal: NodeJS.Signals) => boolean;
  readonly #isGroupAlive: (pgid: number) => boolean;
  readonly #readLeader: (pgid: number) => GroupLeader;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #schedule: (fn: () => void, ms: number) => CancelTimer;
  readonly #now: () => Date;
  readonly #randomUUID: () => string;

  readonly #live = new Map<number, LiveSession>();
  #reaping: Promise<ReapResult[]> | undefined;

  constructor(options: SessionManagerOptions, deps: SessionManagerDeps = {}) {
    this.#store = options.store;
    this.#auth = options.authProvider;
    this.#configuredLoomwrightPath = options.loomwrightPath;
    this.#pluginCacheRoot = options.pluginCacheRoot;
    this.#baseEnv = options.baseEnv ?? process.env;
    this.#stopGraceMs = options.stopGraceMs ?? 2_000;
    this.#authTimeoutMs = options.authTimeoutMs ?? 30_000;
    this.#resumeBackoffMs = options.resumeBackoffMs ?? [1_000, 2_000, 4_000];
    this.#onMessage = options.onMessage;

    this.#query = deps.query ?? sdkQuery;
    this.#spawn = deps.spawn ?? spawnInNewProcessGroup;
    this.#killGroup = deps.killGroup ?? killProcessGroup;
    this.#isGroupAlive = deps.isGroupAlive ?? isProcessGroupAlive;
    this.#readLeader = deps.readGroupLeader ?? readGroupLeader;
    this.#sleep = deps.sleep ?? defaultSleep;
    this.#schedule = deps.schedule ?? defaultSchedule;
    this.#now = deps.now ?? (() => new Date());
    this.#randomUUID = deps.randomUUID ?? nodeRandomUUID;
  }

  /** The stored row, or `undefined`. */
  getSession(id: number): SessionRow | undefined {
    return this.#store
      .prepare<[number], SessionRow>(
        `SELECT id, agent, task_id, sdk_session_id, status, model, pgid, auth_account, loomwright_path,
                leader_started_at, started_at, ended_at, updated_at
           FROM sessions WHERE id = ?`,
      )
      .get(id);
  }

  /**
   * Start a session (AC1, AC2, AC8). Throws `SessionError` before any row or
   * spawn for invalid params, `bypassPermissions` or a missing Loomwright
   * install. An auth failure while building the env spawns nothing: the row
   * is inserted as `failed:auth` with one `notify` event, and the error is
   * rethrown.
   */
  async startSession(params: StartSessionParams): Promise<SessionHandle> {
    const permissionMode = checkPermissionMode(params.permissionMode);
    if (!isNonEmptyString(params.model)) throw new SessionError("invalid_params", "model is required (no default: the CLI default is Opus, Q1)");
    if (!isNonEmptyString(params.agent)) throw new SessionError("invalid_params", "agent is required");
    if (!isNonEmptyString(params.cwd)) throw new SessionError("invalid_params", "cwd is required");
    if (!isNonEmptyString(params.prompt)) throw new SessionError("invalid_params", "prompt is required");
    if (params.task !== undefined && !Number.isInteger(params.task)) throw new SessionError("invalid_params", "task must be an integer id");
    const policy = checkPolicy(params.policy);

    const loomwrightPath = resolveLoomwrightPath({
      configured: this.#configuredLoomwrightPath,
      cacheRoot: this.#pluginCacheRoot,
    });

    let env: ChildEnv;
    try {
      env = this.#auth.buildEnv(this.#baseEnv);
    } catch (err) {
      const at = this.#nowIso();
      this.#store.transaction(() => {
        const id = this.#insertRow(params.agent, params.task, params.model, loomwrightPath, null, "failed:auth", at);
        this.#appendStatusEvent(id, null, "failed:auth", { reason: "auth_failed", code: authErrorCode(err) }, at);
        this.#appendNotify(id, { reason: "auth_failed", code: authErrorCode(err) }, at);
      });
      throw err;
    }

    const sdkSessionId = this.#randomUUID();
    const at = this.#nowIso();
    const id = this.#store.transaction(() => {
      const rowId = this.#insertRow(params.agent, params.task, params.model, loomwrightPath, sdkSessionId, "starting", at);
      this.#appendStatusEvent(rowId, null, "starting", {}, at);
      return rowId;
    });

    const live = this.#newLive(id, sdkSessionId, policy, "starting");
    let attempt: Attempt;
    try {
      attempt = this.#launch(live, {
        number: 1,
        prompt: params.prompt,
        model: params.model,
        permissionMode,
        cwd: params.cwd,
        env,
        loomwrightPath,
        closeInputOnResult: params.closeInputOnResult ?? true,
        sessionOptions: { sessionId: sdkSessionId },
        resumeMode: false,
      });
    } catch (err) {
      const killed = live.attempt !== undefined ? this.#killAttemptGroup(live, live.attempt) : Promise.resolve();
      this.#finish(live, "failed", { reason: "spawn_failed", error: errorMessage(err) });
      await killed;
      this.#settle(live);
      throw err;
    }

    void this.#runStart(live, attempt).catch((err: unknown) => this.#crash(live, err));
    return { id, sdkSessionId, pgid: attempt.pgid, done: live.done };
  }

  /**
   * Stop a session (AC4): close its input, wait up to `stopGraceMs` for the
   * CLI to exit, then SIGKILL its whole process group unconditionally (the
   * group can hold background shells that outlive the leader, Q5), wait for
   * the leader's `exit`, close the query, and mark it `stopped`. Idempotent:
   * a session already in a terminal status keeps it, and that status is
   * returned.
   */
  async stopSession(id: number): Promise<SessionStatus> {
    const live = this.#live.get(id);
    if (live === undefined) {
      const row = this.getSession(id);
      if (row === undefined) throw new SessionError("not_found", `no session ${id}`);
      if (isTerminalStatus(row.status)) return row.status as SessionStatus;
      throw new SessionError("not_live", `session ${id} is ${row.status} and not running in this kernel`);
    }
    if (isTerminalStatus(live.status)) return live.status;
    if (live.stopPromise !== undefined) return live.stopPromise;
    live.stopping = true;
    live.stopPromise = this.#stop(live);
    return live.stopPromise;
  }

  /**
   * Resume an `interrupted` session by its SDK session id (AC6), with the same
   * isolation options as a start: the env is rebuilt from the auth provider,
   * the row's `model` and `loomwright_path` are reused, and the caller passes
   * the policy, `permissionMode` and `cwd` again (the policy is not persisted
   * in phase 1).
   *
   * Retryable: up to `MAX_RESUME_ATTEMPTS` attempts with `resumeBackoffMs`
   * between them. An attempt fails when its stream ends or rejects before it
   * produced assistant output or a successful result (this includes ending
   * before `system/init`, and a first result that is an error). Each failure
   * appends `session_resume_failed` with the full error message, the stack
   * and the stderr tail. All attempts failing ⇒ `failed` (`resume_failed`).
   * An auth failure is never retried (AC7).
   */
  async resumeSession(id: number, params: ResumeSessionParams): Promise<SessionHandle> {
    const permissionMode = checkPermissionMode(params.permissionMode);
    if (!isNonEmptyString(params.cwd)) throw new SessionError("invalid_params", "cwd is required");
    if (params.prompt !== undefined && !isNonEmptyString(params.prompt)) throw new SessionError("invalid_params", "prompt must be non-empty");
    const policy = checkPolicy(params.policy);

    if (this.#live.has(id)) throw new SessionError("not_resumable", `session ${id} is already running`);
    const row = this.getSession(id);
    if (row === undefined) throw new SessionError("not_found", `no session ${id}`);
    if (row.status !== "interrupted" || !isNonEmptyString(row.sdk_session_id)) {
      throw new SessionError("not_resumable", `session ${id} is ${row.status} and resumable only when interrupted with an SDK session id`);
    }
    if (!isNonEmptyString(row.model) || !isNonEmptyString(row.loomwright_path)) {
      throw new SessionError("not_resumable", `session ${id} has no recorded model or Loomwright path`);
    }

    const ctx: ResumeContext = {
      prompt: params.prompt ?? DEFAULT_RESUME_PROMPT,
      model: row.model,
      permissionMode,
      cwd: params.cwd,
      loomwrightPath: row.loomwright_path,
      closeInputOnResult: params.closeInputOnResult ?? true,
      sdkSessionId: row.sdk_session_id,
    };
    const live = this.#newLive(id, row.sdk_session_id, policy, "interrupted");

    let first: Attempt;
    try {
      first = this.#launchResumeAttempt(live, ctx, 1);
    } catch (err) {
      if (!isTerminalStatus(live.status)) {
        // Not an auth failure: count it as the first failed attempt and retry.
        if (live.attempt !== undefined) await this.#killAttemptGroup(live, live.attempt);
        this.#recordResumeFailure(live, 1, err, undefined);
        void this.#resumeLoop(live, ctx, undefined).catch((e: unknown) => this.#crash(live, e));
        return { id, sdkSessionId: ctx.sdkSessionId, pgid: undefined, done: live.done };
      }
      this.#settle(live);
      throw err;
    }
    void this.#resumeLoop(live, ctx, first).catch((err: unknown) => this.#crash(live, err));
    return { id, sdkSessionId: ctx.sdkSessionId, pgid: first.pgid, done: live.done };
  }

  /**
   * Reap process groups left by a previous kernel (AC5). For every row in
   * `starting`/`running` that this manager is not running:
   *
   * - no pgid ⇒ `interrupted` (`no_pgid`); group gone ⇒ `interrupted` (`group_gone`);
   * - group alive and its leader alive: the group is killed ONLY when the leader
   *   is provably the session's own CLI — basename `claude` AND the start time
   *   recorded with the pgid (`leader_started_at`) matches `ps`. A leader with
   *   another name or another start time means the pgid was reused (the owner's
   *   own interactive `claude` processes are `claude` group leaders too): NOT
   *   killed, `pgid_reused`. No recorded start time ⇒ NOT killed,
   *   `leader_unverified`;
   * - group alive and `ps` positively reports no such leader (a pid is never
   *   reused while its group exists, so the group is still the session's) ⇒
   *   killed;
   * - `ps` failed ⇒ NOT killed, `reap_error` (a failed probe is never read as
   *   "the leader exited");
   * - a kill sends SIGKILL until the group is gone (`killGroupUntilGone`):
   *   `group_killed`, or `kill_incomplete` plus a `session_kill_incomplete`
   *   event when it outlives the deadline. `EPERM` on the first SIGKILL ⇒ NOT
   *   killed, `group_not_ours`; any other error ⇒ `reap_error`.
   *
   * Every row ends `interrupted`; the loop always continues. Each marking is
   * one transaction with its `session_status` event, which carries the pgid. A
   * call made while a reap is running returns that reap. The manager never
   * calls this itself: the daemon calls it once at start-up, before accepting
   * work (item 09).
   */
  reapOrphans(): Promise<ReapResult[]> {
    if (this.#reaping !== undefined) return this.#reaping;
    const run = this.#reapAll().finally(() => {
      this.#reaping = undefined;
    });
    this.#reaping = run;
    return run;
  }

  async #reapAll(): Promise<ReapResult[]> {
    const rows = this.#store
      .prepare<[], { id: number; pgid: number | null; status: string; leader_started_at: string | null }>(
        "SELECT id, pgid, status, leader_started_at FROM sessions WHERE status IN ('starting', 'running') ORDER BY id",
      )
      .all();
    const results: ReapResult[] = [];
    for (const row of rows) {
      if (this.#live.has(row.id)) continue;
      let reason: ReapResult["reason"];
      let error: string | undefined;
      try {
        reason = await this.#reapOne(row.id, row.pgid, row.leader_started_at);
      } catch (err) {
        if (errnoCode(err) === "EPERM") reason = "group_not_ours";
        else {
          reason = "reap_error";
          error = errorMessage(err);
        }
      }
      const at = this.#nowIso();
      this.#store.transaction(() => {
        this.#updateStatus(row.id, "interrupted", at);
        this.#appendStatusEvent(row.id, row.status, "interrupted", { reason, pgid: row.pgid, ...(error === undefined ? {} : { error }) }, at);
      });
      results.push({ sessionId: row.id, pgid: row.pgid, reason });
    }
    return results;
  }

  async #reapOne(sessionId: number, pgid: number | null, recordedStart: string | null): Promise<ReapResult["reason"]> {
    if (pgid === null || !isValidPgid(pgid)) return "no_pgid";
    if (!this.#isGroupAlive(pgid)) return "group_gone";
    // Throws when `ps` failed: the caller records `reap_error` and kills nothing.
    const leader = this.#readLeader(pgid);
    if (leader.status === "present") {
      if (leaderBasename(leader.command) !== CLI_BASENAME) return "pgid_reused";
      const recordedMs = recordedStart === null ? Number.NaN : Date.parse(recordedStart);
      if (!Number.isFinite(recordedMs)) return "leader_unverified";
      if (Math.abs(leader.startedAtMs - recordedMs) > LEADER_START_TOLERANCE_MS) return "pgid_reused";
    }
    // The leader is the session's CLI, or it exited while its group lives on.
    // The first SIGKILL rethrows EPERM (the caller records `group_not_ours`).
    if (!this.#killGroup(pgid, "SIGKILL")) return "group_gone";
    if (await this.#killUntilGone(pgid)) return "group_killed";
    this.#recordKillIncomplete(sessionId, pgid);
    return "kill_incomplete";
  }

  // ---- launching -----------------------------------------------------------

  #newLive(id: number, sdkSessionId: string, policy: ToolPolicy, status: SessionStatus): LiveSession {
    let resolveDone!: (status: SessionStatus) => void;
    const done = new Promise<SessionStatus>((resolve) => {
      resolveDone = resolve;
    });
    const live: LiveSession = {
      id,
      sdkSessionId,
      policy,
      status,
      attempt: undefined,
      stopping: false,
      stopPromise: undefined,
      authFailed: false,
      settled: false,
      done,
      resolveDone,
    };
    this.#live.set(id, live);
    return live;
  }

  /** Build the attempt, call `query()` (which spawns synchronously) and push the prompt. */
  #launch(live: LiveSession, config: LaunchConfig): Attempt {
    let markExited!: () => void;
    const exited = new Promise<void>((resolve) => {
      markExited = resolve;
    });
    const attempt: Attempt = {
      number: config.number,
      input: new InputChannel(),
      abortController: new AbortController(),
      stderrTail: new StderrTail(),
      closeInputOnResult: config.closeInputOnResult,
      confirmed: !config.resumeMode,
      query: undefined,
      child: undefined,
      pgid: undefined,
      groupGone: false,
      killing: undefined,
      exited,
      markExited,
      sawInit: false,
      firstResult: undefined,
      lastResult: undefined,
      authTimer: undefined,
    };
    live.attempt = attempt;

    const options: Options = {
      model: config.model,
      permissionMode: config.permissionMode,
      cwd: config.cwd,
      settingSources: [],
      plugins: [{ type: "local", path: config.loomwrightPath }],
      env: config.env,
      includeHookEvents: true,
      hooks: { PreToolUse: [{ hooks: [this.#gate(live)] }] },
      abortController: attempt.abortController,
      spawnClaudeCodeProcess: (o: SpawnOptions) => this.#spawnFor(live, attempt, o),
      ...config.sessionOptions,
    };
    attempt.query = this.#query({ prompt: attempt.input, options });
    attempt.input.push(userMessage(config.prompt));
    return attempt;
  }

  #spawnFor(live: LiveSession, attempt: Attempt, options: SpawnOptions): SpawnedProcess {
    const child = this.#spawn(options, {
      stderrTail: attempt.stderrTail,
      onSpawn: (pgid) => {
        attempt.pgid = pgid;
        // The leader's start time lets a later reaper tell this CLI from an
        // unrelated process that reuses the pgid. Unreadable ⇒ null, and the
        // reaper then never kills the group.
        const leaderStartedAt = this.#leaderStartIso(pgid);
        // Synchronous, inside query(): on disk before any message is awaited (AC2).
        this.#store
          .prepare("UPDATE sessions SET pgid = ?, leader_started_at = ?, updated_at = ? WHERE id = ?")
          .run(pgid, leaderStartedAt, this.#nowIso(), live.id);
      },
    });
    attempt.child = child;
    child.once("exit", () => attempt.markExited());
    return child;
  }

  #launchResumeAttempt(live: LiveSession, ctx: ResumeContext, number: number): Attempt {
    let env: ChildEnv;
    try {
      env = this.#auth.buildEnv(this.#baseEnv);
    } catch (err) {
      this.#finish(live, "failed:auth", { reason: "auth_failed", code: authErrorCode(err), attempt: number }, {
        reason: "auth_failed",
        code: authErrorCode(err),
      });
      throw err;
    }
    if (live.status !== "starting") this.#transition(live, "starting", { reason: "resume_attempt", attempt: number });
    return this.#launch(live, {
      number,
      prompt: ctx.prompt,
      model: ctx.model,
      permissionMode: ctx.permissionMode,
      cwd: ctx.cwd,
      env,
      loomwrightPath: ctx.loomwrightPath,
      closeInputOnResult: ctx.closeInputOnResult,
      sessionOptions: { resume: ctx.sdkSessionId },
      resumeMode: true,
    });
  }

  // ---- running -------------------------------------------------------------

  async #runStart(live: LiveSession, attempt: Attempt): Promise<void> {
    const outcome = await this.#consume(live, attempt);
    await this.#conclude(live, attempt, outcome);
  }

  async #resumeLoop(live: LiveSession, ctx: ResumeContext, first: Attempt | undefined): Promise<void> {
    let next = first;
    for (let n = first === undefined ? 2 : 1; n <= MAX_RESUME_ATTEMPTS; n++) {
      if (n > 1) {
        await this.#sleep(this.#backoffBefore(n));
        if (live.stopping) return this.#afterStop(live);
        try {
          next = this.#launchResumeAttempt(live, ctx, n);
        } catch (err) {
          if (isTerminalStatus(live.status)) {
            this.#settle(live);
            return;
          }
          if (live.attempt !== undefined) await this.#killAttemptGroup(live, live.attempt);
          this.#recordResumeFailure(live, n, err, undefined);
          continue;
        }
      }
      const attempt = next as Attempt;
      const outcome = await this.#consume(live, attempt);
      if (outcome.kind !== "attempt_failed") {
        await this.#conclude(live, attempt, outcome);
        return;
      }
      this.#recordResumeFailure(live, n, outcome.error, attempt.stderrTail.text());
      attempt.input.close();
      this.#closeQuery(attempt);
      await this.#reapAttemptGroup(live, attempt);
      if (live.stopping) return this.#afterStop(live);
    }
    this.#finish(live, "failed", { reason: "resume_failed", attempts: MAX_RESUME_ATTEMPTS });
    this.#settle(live);
  }

  /** The delay before attempt `n` (n >= 2). */
  #backoffBefore(n: number): number {
    const list = this.#resumeBackoffMs;
    return list[n - 2] ?? list[list.length - 1] ?? 0;
  }

  async #afterStop(live: LiveSession): Promise<void> {
    if (live.stopPromise !== undefined) await live.stopPromise;
    this.#settle(live);
  }

  /** Iterate the stream to its end. Never throws. */
  async #consume(live: LiveSession, attempt: Attempt): Promise<ConsumeOutcome> {
    const stream = attempt.query;
    if (stream === undefined) return { kind: "rejected", error: new Error("no query") };
    try {
      for await (const message of stream) {
        this.#observe(live, message);
        const failure = this.#handleMessage(live, attempt, message);
        if (failure !== undefined) return { kind: "attempt_failed", error: failure };
      }
    } catch (err) {
      if (!attempt.confirmed && !live.stopping && !live.authFailed) return { kind: "attempt_failed", error: err };
      return { kind: "rejected", error: err };
    }
    if (!attempt.confirmed && !live.stopping && !live.authFailed) {
      return {
        kind: "attempt_failed",
        error: new Error(
          attempt.sawInit
            ? "resume stream ended without assistant output or a successful result"
            : "resume stream ended before system/init",
        ),
      };
    }
    return { kind: "ended" };
  }

  /** Returns an error when an unconfirmed resume attempt has failed. */
  #handleMessage(live: LiveSession, attempt: Attempt, message: SDKMessage): Error | undefined {
    if (message.type === "system" && message.subtype === "init") {
      attempt.sawInit = true;
      if (message.session_id !== live.sdkSessionId) {
        const expected = live.sdkSessionId;
        live.sdkSessionId = message.session_id;
        const at = this.#nowIso();
        this.#store.transaction(() => {
          this.#store
            .prepare("UPDATE sessions SET sdk_session_id = ?, updated_at = ? WHERE id = ?")
            .run(message.session_id, at, live.id);
          this.#appendEvent("session_id_changed", live.id, { expected, actual: message.session_id }, at);
        });
      }
      if (live.status === "starting" && !live.stopping && !live.authFailed) this.#transition(live, "running", {});
      return undefined;
    }
    if (message.type === "system" && message.subtype === "api_retry") {
      if (message.error_status === 401 || message.error === "authentication_failed") {
        this.#authFail(live, attempt, message.error_status, message.error);
      }
      return undefined;
    }
    if (message.type === "assistant") {
      if (message.error === "authentication_failed") this.#authFail(live, attempt, null, message.error);
      else if (message.error === undefined) attempt.confirmed = true;
      return undefined;
    }
    if (message.type === "result") {
      attempt.lastResult = message;
      if (attempt.firstResult === undefined) {
        attempt.firstResult = message;
        if (attempt.closeInputOnResult) attempt.input.close();
        if (!attempt.confirmed && !live.stopping && !live.authFailed) {
          if (!isSuccessResult(message)) return new Error(`resume attempt failed: ${resultErrorText(message)}`);
          attempt.confirmed = true;
        }
      }
    }
    return undefined;
  }

  #observe(live: LiveSession, message: SDKMessage): void {
    if (this.#onMessage === undefined) return;
    try {
      this.#onMessage(live.id, message);
    } catch (err) {
      try {
        this.#appendEvent("observer_error", live.id, { error: errorMessage(err) }, this.#nowIso());
      } catch {
        // The store is gone; the session loop must still not break.
      }
    }
  }

  /**
   * First auth signal (AC7): close the input, abort, arm a kill after
   * `authTimeoutMs`, mark `failed:auth` and notify once. Never retried.
   */
  #authFail(live: LiveSession, attempt: Attempt, errorStatus: number | null, error: string | undefined): void {
    if (live.authFailed || live.stopping || isTerminalStatus(live.status)) return;
    live.authFailed = true;
    attempt.input.close();
    attempt.abortController.abort();
    attempt.authTimer = this.#schedule(() => {
      const killed = this.#killAttemptGroup(live, attempt);
      this.#closeQuery(attempt);
      void killed.then(() => this.#settle(live));
    }, this.#authTimeoutMs);
    const details = {
      reason: "auth_failed",
      provider: this.#auth.id,
      account: this.#auth.account,
      error_status: errorStatus,
      error: error ?? null,
    };
    this.#finish(live, "failed:auth", { ...details, attempt: attempt.number }, details);
  }

  /** After the stream ended: write the terminal status, clean up the group, settle `done`. */
  async #conclude(live: LiveSession, attempt: Attempt, outcome: ConsumeOutcome): Promise<void> {
    if (live.stopping) {
      if (live.stopPromise !== undefined) await live.stopPromise;
    } else if (!live.authFailed) {
      if (outcome.kind === "ended") {
        const result = attempt.closeInputOnResult ? attempt.firstResult : attempt.lastResult;
        if (result === undefined) this.#finish(live, "failed", { reason: "ended_without_result" });
        else if (isSuccessResult(result)) this.#finish(live, "completed", { reason: "result_success" });
        else this.#finish(live, "failed", { reason: "result_error", error: resultErrorText(result).slice(0, MAX_RECORDED_TEXT) });
      } else {
        const error = outcome.error;
        this.#finish(live, "failed", {
          reason: "stream_error",
          error: errorMessage(error),
          stack: errorStack(error),
          stderr: tail(attempt.stderrTail.text()),
        });
      }
    }
    // The CLI has exited or is exiting; kill whatever is left in its group
    // (background shells outlive the leader, Q5).
    await this.#reapAttemptGroup(live, attempt);
    attempt.authTimer?.();
    this.#settle(live);
  }

  /**
   * A background loop threw (for example the store failed). Never leave a
   * group running or `done` pending: kill the group, record what can still be
   * recorded, and settle once the group is gone (or the kill gave up). Never
   * rejects.
   */
  async #crash(live: LiveSession, err: unknown): Promise<void> {
    const attempt = live.attempt;
    let killed: Promise<void> = Promise.resolve();
    if (attempt !== undefined) {
      killed = this.#killAttemptGroup(live, attempt);
      this.#closeQuery(attempt);
      attempt.authTimer?.();
    }
    try {
      this.#finish(live, "failed", { reason: "kernel_error", error: errorMessage(err) });
    } catch {
      // The store is unusable; the in-memory status still reaches `done`.
      if (!isTerminalStatus(live.status)) live.status = "failed";
    }
    await killed;
    this.#settle(live);
  }

  async #stop(live: LiveSession): Promise<SessionStatus> {
    const attempt = live.attempt;
    if (attempt !== undefined) {
      attempt.input.close();
      await this.#waitFor(attempt.exited, this.#stopGraceMs);
      await this.#killAttemptGroup(live, attempt);
      // Until Node reaps the killed leader it is a zombie holding the pgid.
      await this.#waitFor(attempt.exited, LEADER_EXIT_WAIT_MS);
      this.#closeQuery(attempt);
      attempt.authTimer?.();
    }
    this.#finish(live, "stopped", { reason: "stop_requested" });
    this.#settle(live);
    return live.status;
  }

  // ---- process groups ------------------------------------------------------

  /** Wait (bounded) for the leader to exit, kill the group until gone, wait again (bounded). */
  async #reapAttemptGroup(live: LiveSession, attempt: Attempt): Promise<void> {
    if (attempt.pgid === undefined) return;
    await this.#waitFor(attempt.exited, LEADER_EXIT_WAIT_MS);
    await this.#killAttemptGroup(live, attempt);
    await this.#waitFor(attempt.exited, LEADER_EXIT_WAIT_MS);
  }

  /**
   * Kill the attempt's group until it is gone (`killGroupUntilGone`; one
   * SIGKILL can miss a child forked during it). The first SIGKILL is sent
   * synchronously. Concurrent callers share one run; once the group is gone it
   * is never signalled again, and a run that gave up at the deadline
   * (`session_kill_incomplete`) is retried by the next caller. A failure is
   * recorded (`session_kill_error`), never thrown: the promise never rejects.
   */
  #killAttemptGroup(live: LiveSession, attempt: Attempt): Promise<void> {
    const pgid = attempt.pgid;
    if (pgid === undefined || attempt.groupGone) return Promise.resolve();
    if (attempt.killing !== undefined) return attempt.killing;
    const run = async (): Promise<void> => {
      try {
        if (await this.#killUntilGone(pgid)) attempt.groupGone = true;
        else this.#recordKillIncomplete(live.id, pgid);
      } catch (err) {
        this.#recordSafely("session_kill_error", live.id, { pgid, error: errorMessage(err), code: errnoCode(err) ?? null });
      }
    };
    const killing = run().finally(() => {
      if (attempt.killing === killing) attempt.killing = undefined;
    });
    attempt.killing = killing;
    return killing;
  }

  /** `killGroupUntilGone` over the injected primitives, sleeping through the injected scheduler. */
  #killUntilGone(pgid: number): Promise<boolean> {
    return killGroupUntilGone(pgid, {
      kill: this.#killGroup,
      isAlive: this.#isGroupAlive,
      sleep: (ms) =>
        new Promise<void>((resolve) => {
          this.#schedule(resolve, ms);
        }),
    });
  }

  #recordKillIncomplete(sessionId: number, pgid: number): void {
    this.#recordSafely("session_kill_incomplete", sessionId, { pgid, deadline_ms: KILL_GROUP_DEADLINE_MS });
  }

  /** Append an event; a store failure is swallowed (nothing more can be done). */
  #recordSafely(kind: string, sessionId: number, payload: Record<string, unknown>): void {
    try {
      this.#appendEvent(kind, sessionId, payload, this.#nowIso());
    } catch {
      // Nothing more can be done.
    }
  }

  /** The leader's start time as ISO-8601, or `null` when `ps` cannot say. Never throws. */
  #leaderStartIso(pgid: number): string | null {
    try {
      const leader = this.#readLeader(pgid);
      return leader.status === "present" ? new Date(leader.startedAtMs).toISOString() : null;
    } catch {
      return null;
    }
  }

  #closeQuery(attempt: Attempt): void {
    try {
      attempt.query?.close();
    } catch {
      // Already closed.
    }
  }

  /** Resolves `true` when `promise` settles first, `false` after `ms`. */
  #waitFor(promise: Promise<void>, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      let finished = false;
      const cancel = this.#schedule(() => {
        if (finished) return;
        finished = true;
        resolve(false);
      }, ms);
      void promise.then(() => {
        if (finished) return;
        finished = true;
        cancel();
        resolve(true);
      });
    });
  }

  // ---- the tool gate (AC3) -------------------------------------------------

  /**
   * The kernel's `PreToolUse` hook callback for one session. Decides from the
   * session's frozen policy, records one `tool_decision` event per call, and
   * fails closed: any exception (including failing to record an allow) denies
   * with `kernel_gate_error`. The hook runs for read-only commands too, which
   * `canUseTool` skips (Q5; probed 2026-10-02).
   */
  #gate(live: LiveSession): HookCallback {
    return async (input): Promise<HookJSONOutput> => {
      let decision: "allow" | "deny" = "deny";
      let reason = "kernel_gate_error";
      let tool: string | null = null;
      let command: string | undefined;
      try {
        if (input.hook_event_name === "PreToolUse") {
          tool = input.tool_name;
          if (tool === "Bash") command = bashCommandOf(input.tool_input);
          const d = decideToolUse(live.policy, input.tool_name, input.tool_input);
          decision = d.decision;
          reason = d.reason;
        }
      } catch {
        decision = "deny";
        reason = "kernel_gate_error";
      }
      const record = (): void =>
        this.#appendEvent(
          "tool_decision",
          live.id,
          {
            tool,
            decision,
            reason,
            ...(command === undefined ? {} : { command: command.slice(0, MAX_EVENT_COMMAND_CHARS) }),
          },
          this.#nowIso(),
        );
      try {
        record();
      } catch {
        if (decision === "allow") {
          // No tool runs without a recorded kernel decision.
          decision = "deny";
          reason = "kernel_gate_error";
          try {
            record();
          } catch {
            // The store is gone; deny regardless.
          }
        }
      }
      return {
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason },
      };
    };
  }

  // ---- status and events ---------------------------------------------------

  /** Move to a terminal status once (first writer wins). `notify` adds one `notify` event in the same transaction. */
  #finish(live: LiveSession, to: SessionStatus, payload: Record<string, unknown>, notify?: Record<string, unknown>): boolean {
    if (isTerminalStatus(live.status)) return false;
    this.#transition(live, to, payload, notify);
    return true;
  }

  #transition(live: LiveSession, to: SessionStatus, payload: Record<string, unknown>, notify?: Record<string, unknown>): void {
    const from = live.status;
    live.status = to;
    const at = this.#nowIso();
    this.#store.transaction(() => {
      this.#updateStatus(live.id, to, at);
      this.#appendStatusEvent(live.id, from, to, payload, at);
      if (notify !== undefined) this.#appendNotify(live.id, notify, at);
    });
  }

  #settle(live: LiveSession): void {
    if (live.settled) return;
    live.settled = true;
    this.#live.delete(live.id);
    live.resolveDone(live.status);
  }

  #recordResumeFailure(live: LiveSession, attempt: number, err: unknown, stderr: string | undefined): void {
    this.#appendEvent(
      "session_resume_failed",
      live.id,
      {
        attempt,
        error: errorMessage(err),
        stack: errorStack(err) ?? null,
        stderr: stderr === undefined ? null : tail(stderr),
      },
      this.#nowIso(),
    );
  }

  #insertRow(
    agent: string,
    task: number | undefined,
    model: string,
    loomwrightPath: string,
    sdkSessionId: string | null,
    status: SessionStatus,
    at: string,
  ): number {
    const info = this.#store
      .prepare(
        `INSERT INTO sessions (agent, task_id, sdk_session_id, status, model, auth_account, loomwright_path, started_at, ended_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        agent,
        task ?? null,
        sdkSessionId,
        status,
        model,
        this.#auth.account,
        loomwrightPath,
        at,
        isTerminalStatus(status) ? at : null,
        at,
      );
    return Number(info.lastInsertRowid);
  }

  #updateStatus(id: number, to: SessionStatus, at: string): void {
    this.#store
      .prepare("UPDATE sessions SET status = ?, updated_at = ?, ended_at = CASE WHEN ? THEN ? ELSE ended_at END WHERE id = ?")
      .run(to, at, isTerminalStatus(to) ? 1 : 0, at, id);
  }

  #appendStatusEvent(id: number, from: string | null, to: SessionStatus, payload: Record<string, unknown>, at: string): void {
    this.#appendEvent("session_status", id, { from, to, ...payload }, at);
  }

  #appendNotify(id: number, payload: Record<string, unknown>, at: string): void {
    this.#appendEvent("notify", id, { provider: this.#auth.id, account: this.#auth.account, ...payload }, at);
  }

  #appendEvent(kind: string, sessionId: number, payload: Record<string, unknown>, at: string): void {
    this.#store
      .prepare("INSERT INTO events (at, kind, actor, session_id, payload_json) VALUES (?, ?, 'kernel', ?, ?)")
      .run(at, kind, sessionId, JSON.stringify(payload));
  }

  #nowIso(): string {
    return this.#now().toISOString();
  }
}

/** A stable, secret-free code for an env-build failure. */
function authErrorCode(err: unknown): string {
  if (err instanceof AuthProviderError) return err.code;
  if (err instanceof KeychainError) return "keychain_error";
  return "auth_env_error";
}
