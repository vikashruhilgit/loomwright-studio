import { randomUUID as nodeRandomUUID } from "node:crypto";
import { homedir } from "node:os";
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
import { isProtectedPath, protectedLocationsText } from "../protected-paths.js";
import type { Store } from "../store/store.js";
import { resolveLoomwrightPath } from "./loomwright-path.js";
import { latestOrphanReason } from "./orphans.js";
import { bashCommandOf, decideToolUse, freezePolicy } from "./policy.js";
import {
  KILL_GROUP_DEADLINE_MS,
  LEADER_EXIT_WAIT_MS,
  StderrTail,
  descendantGroups,
  isProcessGroupAlive,
  isValidPgid,
  killGroupUntilGone,
  killProcessGroup,
  leaderBasename,
  readGroupLeader,
  readGroupLeaderAsync,
  snapshotProcessTable,
  spawnInNewProcessGroup,
} from "./spawner.js";
import {
  AdmissionRefusedError,
  DEFAULT_RESUME_PROMPT,
  DEFAULT_STOP_GRACE_MS,
  MAX_RESUME_ATTEMPTS,
  SessionError,
  TERMINAL_STATUSES,
  isTerminalStatus,
} from "./types.js";
import type {
  AdmissionDecision,
  AdmissionRequest,
  AllowedPermissionMode,
  CancelTimer,
  GroupLeader,
  ProcessEntry,
  ProcessTable,
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
/**
 * How often the kernel walks every running CLI's descendants for the process
 * groups its tools started (H08, `session_groups`). One `ps -A` per tick for
 * all sessions, never more than one in flight.
 */
const TOOL_GROUP_POLL_MS = 1_000;

/**
 * Every permission mode the kernel accepts. The keys come from the SDK's
 * `PermissionMode` union (`@anthropic-ai/claude-agent-sdk` sdk.d.ts, verified on
 * 0.3.284) minus `bypassPermissions` (D5). `satisfies Record<AllowedPermissionMode, true>`
 * makes a mismatch a compile error in both directions: a mode the SDK adds is a
 * missing key, and one it drops (or a typo) is an excess key.
 */
const PERMISSION_MODE_SET = {
  default: true,
  acceptEdits: true,
  plan: true,
  dontAsk: true,
  auto: true,
} as const satisfies Record<AllowedPermissionMode, true>;

const ALLOWED_PERMISSION_MODES = Object.keys(PERMISSION_MODE_SET) as readonly AllowedPermissionMode[];

function isAllowedPermissionMode(mode: unknown): mode is AllowedPermissionMode {
  return typeof mode === "string" && Object.hasOwn(PERMISSION_MODE_SET, mode);
}

/** What the identity check found for a recorded group (shared by the reaper and resume). */
type GroupCheck = "no_pgid" | "group_gone" | "pgid_reused" | "leader_unverified" | "ours";

/**
 * One reaper decision: the row is now `status` for `reason`. The group is gone
 * or proven foreign ⇒ `interrupted`; it may still be the session's and alive
 * (`leader_unverified`, `kill_incomplete`, `reap_error`) ⇒ `orphaned`.
 */
export interface ReapResult {
  readonly sessionId: number;
  readonly pgid: number | null;
  readonly status: "interrupted" | "orphaned";
  readonly reason:
    | "no_pgid"
    | "group_gone"
    | "pgid_reused"
    | "leader_unverified"
    | "group_killed"
    | "kill_incomplete"
    | "reap_error";
}

/**
 * What `stopAll` did for one session: the status the stop returned, or
 * `stop_failed` when the stop call itself rejected. `stop_failed` labels the
 * call, never a session status: the row keeps whatever the manager recorded.
 *
 * `ended_on_its_own: true` (present only when true) marks a session that had
 * already ended before the stop (its stream had ended, or it was already
 * `failed:auth`) AND whose groups (the CLI's and every recorded tool group)
 * the stop settled: the stop stopped nothing that was running. Never on a
 * `failed` with reason `kill_incomplete`.
 */
export type StopAllOutcome =
  | { readonly id: number; readonly status: SessionStatus; readonly ended_on_its_own?: true }
  | { readonly id: number; readonly status: "stop_failed"; readonly error: string };

/** Who released an `orphaned` row with `abandonSession`: the CLI (through the API) or another API caller. */
export type AbandonVia = "cli" | "api";

/**
 * Why a session is being stopped. `stop` (a `stopSession`, the kill switch)
 * ends it `stopped`. `shutdown` (a graceful kernel stop) runs the same kill
 * but ends it `interrupted` (`kernel_shutdown`), so it is resumable after the
 * restart, exactly as a `kill -9` of the kernel would leave it once reaped.
 */
type StopIntent = "stop" | "shutdown";

/**
 * Why a recorded tool group was not signalled. `ps_failed`: its ownership
 * could not be checked (the group stays flagged and is checked again by the
 * next reap). Every other reason settles the group for good: `group_gone`
 * (nothing left to kill), `leader_gone` (its leader exited, so nothing can
 * prove the pgid still names this group), `command_differs` and
 * `start_differs` (the pgid now names another process: never signalled).
 */
type GroupSkipReason = "group_gone" | "leader_gone" | "command_differs" | "start_differs" | "no_pgid" | "ps_failed";

/** One unsettled `session_groups` row. */
interface RecordedGroup {
  readonly pgid: number;
  readonly leader_command: string;
  readonly leader_started_at: string;
}

/** Reap reasons that leave a group that may still be the session's alive. */
const LEFT_ALIVE: ReadonlySet<ReapResult["reason"]> = new Set(["leader_unverified", "kill_incomplete", "reap_error"]);

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
  /** A kill of this group gave up or errored and flagged the row (`kill_incomplete_at`). */
  killFlagged: boolean;
  /** Node reaped the CLI (it emitted `exit`): its pid may be reused, so the tool-group poll stops walking it. */
  leaderExited: boolean;
  /** Every recorded tool group of the session is confirmed gone or proven not the session's (`session_groups`). */
  toolGroupsDone: boolean;
  readonly exited: Promise<void>;
  markExited: () => void;
  sawInit: boolean;
  firstResult: SDKResultMessage | undefined;
  lastResult: SDKResultMessage | undefined;
  authTimer: CancelTimer | undefined;
}

/** The outcome computed from a finished stream, before the group cleanup. */
interface Verdict {
  readonly to: SessionStatus;
  readonly payload: Record<string, unknown>;
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
  /**
   * Set once the stream has ended and its outcome is computed, before the
   * group cleanup is awaited: a stop arriving during that cleanup finishes
   * with it instead of `stopped` (the session had already ended).
   */
  verdict: Verdict | undefined;
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
  /** The row's agent and task, for the `mcpServers` factory. */
  readonly agent: string | null;
  readonly task: number | null;
}

interface ResumeContext {
  readonly prompt: string;
  readonly model: string;
  readonly permissionMode: AllowedPermissionMode;
  readonly cwd: string;
  readonly loomwrightPath: string;
  readonly closeInputOnResult: boolean;
  readonly sdkSessionId: string;
  /** The row's agent and task, for the admission request of every retry attempt. */
  readonly agent: string | null;
  readonly taskId: number | null;
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
  if (!isAllowedPermissionMode(mode)) {
    throw new SessionError("invalid_params", `permissionMode is required and must be one of ${ALLOWED_PERMISSION_MODES.join(", ")}`);
  }
  return mode;
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

/**
 * The attempt spawned a group and no kill has settled all of the session's
 * groups: the CLI's own group was not seen gone, or a recorded tool group
 * (H08) was neither confirmed gone nor proven not the session's (its kill gave
 * up or errored, or `ps` failed: flagged in `session_groups`). Either may
 * still be alive, so the session never reads as cleanly ended or stopped.
 */
function groupMayBeAlive(attempt: Attempt | undefined): attempt is Attempt {
  return attempt !== undefined && attempt.pgid !== undefined && (!attempt.groupGone || !attempt.toolGroupsDone);
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
  readonly #admission: ((request: AdmissionRequest) => AdmissionDecision) | undefined;
  readonly #mcpServers: SessionManagerOptions["mcpServers"];

  readonly #query: QueryFn;
  readonly #spawn: SpawnFn;
  readonly #killGroup: (pgid: number, signal: NodeJS.Signals) => boolean;
  readonly #isGroupAlive: (pgid: number) => boolean;
  readonly #readLeader: (pgid: number) => GroupLeader;
  readonly #readLeaderAsync: (pgid: number) => Promise<GroupLeader>;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #schedule: (fn: () => void, ms: number) => CancelTimer;
  readonly #now: () => Date;
  readonly #randomUUID: () => string;
  readonly #homeDir: string;
  /** `undefined`: no tool-group poll and no reaper walk (a test fake without a snapshot). */
  readonly #snapshot: (() => Promise<ProcessTable>) | undefined;

  readonly #live = new Map<number, LiveSession>();
  /** The pending tool-group poll tick, if any. */
  #pollTimer: CancelTimer | undefined;
  /** The `ps -A` snapshot walk in flight (never more than one). Never rejects. */
  #pollInFlight: Promise<void> | undefined;
  #reaping: Promise<ReapResult[]> | undefined;
  /** The orphan row `#reapAll` is examining or killing right now (reaps are sequential), for `abandonSession`. */
  #reapingRow: number | undefined;

  constructor(options: SessionManagerOptions, deps: SessionManagerDeps = {}) {
    this.#store = options.store;
    this.#auth = options.authProvider;
    this.#configuredLoomwrightPath = options.loomwrightPath;
    this.#pluginCacheRoot = options.pluginCacheRoot;
    this.#baseEnv = options.baseEnv ?? process.env;
    this.#stopGraceMs = options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
    this.#authTimeoutMs = options.authTimeoutMs ?? 30_000;
    this.#resumeBackoffMs = options.resumeBackoffMs ?? [1_000, 2_000, 4_000];
    this.#onMessage = options.onMessage;
    this.#admission = options.admission;
    this.#mcpServers = options.mcpServers;

    this.#query = deps.query ?? sdkQuery;
    this.#spawn = deps.spawn ?? spawnInNewProcessGroup;
    this.#killGroup = deps.killGroup ?? killProcessGroup;
    this.#isGroupAlive = deps.isGroupAlive ?? isProcessGroupAlive;
    this.#readLeader = deps.readGroupLeader ?? readGroupLeader;
    const injectedLeader = deps.readGroupLeader;
    // A test that injects only the sync probe never reaches the real `ps`.
    this.#readLeaderAsync =
      deps.readGroupLeaderAsync ?? (injectedLeader === undefined ? readGroupLeaderAsync : async (pgid) => injectedLeader(pgid));
    // Like the async leader probe: a test that injects only the sync probe never reaches the real `ps`.
    this.#snapshot = deps.snapshotProcesses ?? (injectedLeader === undefined ? snapshotProcessTable : undefined);
    this.#sleep = deps.sleep ?? defaultSleep;
    this.#schedule = deps.schedule ?? defaultSchedule;
    this.#now = deps.now ?? (() => new Date());
    this.#randomUUID = deps.randomUUID ?? nodeRandomUUID;
    this.#homeDir = deps.homeDir ?? homedir();
  }

  /** The stored row, or `undefined`. */
  getSession(id: number): SessionRow | undefined {
    return this.#store
      .prepare<[number], SessionRow>(
        `SELECT id, agent, task_id, sdk_session_id, status, model, pgid, auth_account, loomwright_path,
                leader_started_at, kill_incomplete_at, started_at, ended_at, updated_at
           FROM sessions WHERE id = ?`,
      )
      .get(id);
  }

  /**
   * Start a session (AC1, AC2, AC8). Throws `SessionError` before any row or
   * spawn for invalid params, `bypassPermissions`, a `cwd` in a protected
   * folder (`protected_cwd`, D31: one `session_refused` event, no row) or a
   * missing Loomwright install, and `AdmissionRefusedError` when the `admission` check refuses
   * (budget or cap, item 06). An auth failure while building the env spawns
   * nothing: the row is inserted as `failed:auth` with one `notify` event, and
   * the error is rethrown.
   */
  async startSession(params: StartSessionParams): Promise<SessionHandle> {
    const permissionMode = checkPermissionMode(params.permissionMode);
    if (!isNonEmptyString(params.model)) throw new SessionError("invalid_params", "model is required (no default: the CLI default is Opus, Q1)");
    if (!isNonEmptyString(params.agent)) throw new SessionError("invalid_params", "agent is required");
    if (!isNonEmptyString(params.cwd)) throw new SessionError("invalid_params", "cwd is required");
    this.#refuseProtectedCwd(params.cwd, null);
    if (!isNonEmptyString(params.prompt)) throw new SessionError("invalid_params", "prompt is required");
    if (params.task !== undefined && !Number.isInteger(params.task)) throw new SessionError("invalid_params", "task must be an integer id");
    const policy = checkPolicy(params.policy);

    const loomwrightPath = resolveLoomwrightPath({
      configured: this.#configuredLoomwrightPath,
      cacheRoot: this.#pluginCacheRoot,
    });

    this.#admit({ kind: "start", agent: params.agent, account: this.#auth.account, provider: this.#auth.id, task: params.task ?? null });

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
        agent: params.agent,
        task: params.task ?? null,
      });
    } catch (err) {
      if (live.attempt !== undefined) await this.#killAttemptGroup(live, live.attempt);
      this.#finishAfterKill(live, live.attempt, "failed", { reason: "spawn_failed", error: errorMessage(err) });
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
   * returned. A stop that arrives after the stream has ended (while its group
   * is being cleaned up) still kills the group, but the session ends with the
   * outcome its stream produced (`stop_requested_after_end: true` in the
   * event), never `stopped`: it was no longer running.
   */
  stopSession(id: number): Promise<SessionStatus> {
    return this.#stopLive(id, "stop");
  }

  /**
   * Stop every session this manager is running, concurrently, and report each
   * outcome; one stop that rejects never skips another (`stop_failed`).
   *
   * - `mode: "stop"` (default, the kill switch): `stopSession` for each, so a
   *   running session ends `stopped`.
   * - `mode: "shutdown"` (graceful kernel stop): the same kill sequence, but a
   *   session whose stream had not ended finishes `interrupted` with reason
   *   `kernel_shutdown`, resumable after the restart (its group is confirmed
   *   gone). Through the same entry guards as `stopSession`, so the session's
   *   own background path never overwrites it afterwards.
   *
   * In both modes a kill that cannot confirm the CLI's group gone, or that
   * leaves a recorded tool group unsettled (H08: flagged in `session_groups`,
   * listed under `/status`'s `kill_unconfirmed`), ends `failed`
   * (`kill_incomplete`), a stream that had already ended keeps its outcome, and
   * a stop already in flight is shared. A session that already ended
   * `failed:auth` but whose group is still waiting for its auth kill timer gets
   * that kill now and its pending auth timer is cancelled (the kernel keeps
   * running in kill-switch mode, so the timer would otherwise fire later),
   * then is settled as the timer would settle it. Its outcome is `failed:auth`
   * only once its groups are settled; otherwise it is `stop_failed`
   * (`kill_incomplete`): the row keeps `failed:auth` with `kill_incomplete_at`
   * set (or its tool group flagged), so every later `reapOrphans` retries the
   * kill.
   *
   * An outcome carries `ended_on_its_own: true` when the session had already
   * ended before the stop (its stream had ended, or it was already
   * `failed:auth`) and the stop settled its groups.
   */
  async stopAll(options: { readonly mode?: "stop" | "shutdown" } = {}): Promise<StopAllOutcome[]> {
    const mode = options.mode ?? "stop";
    const ids = [...this.#live.keys()];
    const results = await Promise.allSettled(ids.map((id) => this.#stopForAll(id, mode)));
    return results.map((result, i): StopAllOutcome => {
      const id = ids[i] as number;
      if (result.status === "rejected") return { id, status: "stop_failed", error: errorMessage(result.reason) };
      const { status, endedOnItsOwn } = result.value;
      return endedOnItsOwn ? { id, status, ended_on_its_own: true } : { id, status };
    });
  }

  async #stopForAll(id: number, mode: StopIntent): Promise<{ readonly status: SessionStatus; readonly endedOnItsOwn: boolean }> {
    const live = this.#live.get(id);
    if (live !== undefined && isTerminalStatus(live.status) && live.stopPromise === undefined) {
      // Ended (e.g. `failed:auth`) but not settled: its group may still be alive.
      const attempt = live.attempt;
      if (attempt !== undefined) {
        await this.#killAttemptGroup(live, attempt);
        this.#closeQuery(attempt);
        // The kernel keeps running after a kill switch: the timer's own kill is
        // no longer needed, and it must not run after this stop returned.
        attempt.authTimer?.();
        // As the auth kill timer does: settle after the kill whatever it found,
        // so this live entry no longer hides the flagged row from `reapOrphans`.
        this.#settle(live);
        // A kill that gave up (or errored) already flagged the row
        // (`kill_incomplete_at`) or the tool group (`session_groups`); never
        // report the session as ended.
        if (groupMayBeAlive(attempt)) throw new Error("kill_incomplete");
      }
      return { status: live.status, endedOnItsOwn: true };
    }
    const status = await (mode === "stop" ? this.stopSession(id) : this.#stopLive(id, "shutdown"));
    // A verdict is set only when the stream ended before any stop began
    // (`#conclude`); a group (the CLI's or a tool's) the stop could not settle never counts.
    const endedOnItsOwn = live !== undefined && live.verdict !== undefined && !groupMayBeAlive(live.attempt);
    return { status, endedOnItsOwn };
  }

  /** `stopSession`'s entry guards, for either intent. */
  async #stopLive(id: number, intent: StopIntent): Promise<SessionStatus> {
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
    live.stopPromise = this.#stop(live, intent);
    return live.stopPromise;
  }

  /**
   * Resume an `interrupted` (or `orphaned`) session by its SDK session id
   * (AC6), with the same isolation options as a start: the env is rebuilt from
   * the auth provider, the row's `model` and `loomwright_path` are reused, and
   * the caller passes the policy, `permissionMode` and `cwd` again (the policy
   * is not persisted in phase 1).
   *
   * The `admission` check (item 06) runs after the row checks and before the
   * group check: a refusal throws `AdmissionRefusedError` and leaves the row's
   * status and its events unchanged.
   *
   * Never while the session's previous group may still be alive: before
   * launching anything the recorded group is re-checked exactly as the reaper
   * checks it. Gone, never recorded, or proven foreign (`pgid_reused`) ⇒ the
   * resume goes ahead (an `orphaned` row first becomes `interrupted`). Alive
   * and not proven foreign, or a failed `ps` ⇒ `not_resumable`, and an
   * `interrupted` row becomes `orphaned` (with the reason in its event) so the
   * next `reapOrphans` re-examines it.
   *
   * Retryable: up to `MAX_RESUME_ATTEMPTS` attempts with `resumeBackoffMs`
   * between them. An attempt fails when its stream ends or rejects before it
   * produced assistant output or a successful result (this includes ending
   * before `system/init`, and a first result that is an error). Each failure
   * appends `session_resume_failed` with the full error message, the stack
   * and the stderr tail. All attempts failing ⇒ `failed` (`resume_failed`).
   * A failed attempt whose group cannot be confirmed gone ends the resume:
   * `failed` (`kill_incomplete`), no further attempt. An auth failure is
   * never retried (AC7).
   *
   * Every retry attempt asks `admission` again before it launches (item 06):
   * an earlier attempt may have hit the cap and parked the account. A refusal
   * (or a check that throws: fail closed) launches nothing and returns the
   * session to `interrupted` (`admission_refused` / `admission_error`, with
   * the refusal reason and `retry_at` in the status event), so it can be
   * resumed once the park ends; `done` then settles with `interrupted`.
   */
  async resumeSession(id: number, params: ResumeSessionParams): Promise<SessionHandle> {
    const permissionMode = checkPermissionMode(params.permissionMode);
    if (!isNonEmptyString(params.cwd)) throw new SessionError("invalid_params", "cwd is required");
    // Before admission and the group check: the row is not touched, only the refusal is logged.
    this.#refuseProtectedCwd(params.cwd, this.getSession(id) === undefined ? null : id);
    if (params.prompt !== undefined && !isNonEmptyString(params.prompt)) throw new SessionError("invalid_params", "prompt must be non-empty");
    const policy = checkPolicy(params.policy);

    if (this.#live.has(id)) throw new SessionError("not_resumable", `session ${id} is already running`);
    const row = this.getSession(id);
    if (row === undefined) throw new SessionError("not_found", `no session ${id}`);
    if ((row.status !== "interrupted" && row.status !== "orphaned") || !isNonEmptyString(row.sdk_session_id)) {
      throw new SessionError(
        "not_resumable",
        `session ${id} is ${row.status} and resumable only when interrupted or orphaned with an SDK session id`,
      );
    }
    if (!isNonEmptyString(row.model) || !isNonEmptyString(row.loomwright_path)) {
      throw new SessionError("not_resumable", `session ${id} has no recorded model or Loomwright path`);
    }
    // Before the group check: a refused resume leaves the row and its events untouched.
    this.#admit({ kind: "resume", agent: row.agent, account: this.#auth.account, provider: this.#auth.id, task: row.task_id });

    // Synchronous from here to the launch: no reap or other resume interleaves.
    let check: GroupCheck;
    let probeError: string | undefined;
    try {
      check = this.#checkGroup(row.pgid, row.leader_started_at);
    } catch (err) {
      check = "leader_unverified";
      probeError = errorMessage(err);
    }
    if (check === "ours" || check === "leader_unverified") {
      const reason = probeError !== undefined ? "reap_error" : check === "ours" ? "group_alive" : "leader_unverified";
      const details = { reason, pgid: row.pgid, ...(probeError === undefined ? {} : { error: probeError }) };
      if (row.status === "interrupted") this.#markRow(id, "interrupted", "orphaned", { ...details, by: "resume" });
      else this.#recordSafely("session_resume_refused", id, details);
      throw new SessionError("not_resumable", `session ${id}'s process group ${String(row.pgid)} may still be alive (${reason})`);
    }
    if (row.status === "orphaned" && !this.#markRow(id, "orphaned", "interrupted", { reason: check, pgid: row.pgid, by: "resume" })) {
      throw new SessionError("not_resumable", `session ${id} changed status while being resumed`);
    }

    const ctx: ResumeContext = {
      prompt: params.prompt ?? DEFAULT_RESUME_PROMPT,
      model: row.model,
      permissionMode,
      cwd: params.cwd,
      loomwrightPath: row.loomwright_path,
      closeInputOnResult: params.closeInputOnResult ?? true,
      sdkSessionId: row.sdk_session_id,
      agent: row.agent,
      taskId: row.task_id,
    };
    const live = this.#newLive(id, row.sdk_session_id, policy, "interrupted");

    let first: Attempt;
    try {
      first = this.#launchResumeAttempt(live, ctx, 1);
    } catch (err) {
      if (!isTerminalStatus(live.status)) {
        // Not an auth failure: count it as the first failed attempt and retry,
        // unless its group may still be alive.
        if (live.attempt !== undefined) await this.#killAttemptGroup(live, live.attempt);
        this.#recordResumeFailure(live, 1, err, undefined);
        if (this.#endIfGroupMayBeAlive(live)) return { id, sdkSessionId: ctx.sdkSessionId, pgid: live.attempt?.pgid, done: live.done };
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
   * The owner's explicit release of an `orphaned` row the kernel cannot
   * verify (AC4 of H04): its latest orphaning reason (the newest
   * `session_status` to `orphaned`, `session_reap_deferred` or
   * `session_resume_refused` event) is `leader_unverified`, so the reaper will
   * neither kill its group nor let it go. The row becomes `abandoned`
   * (terminal) with a `session_status` event recording `by: "owner"` and
   * `via`, and `kill_incomplete_at` cleared in the same transaction, so no
   * later reap or kill retry ever signals that group. The kernel never
   * signals or probes the group here: it may not be the session's.
   *
   * Refuses with `SessionError`, writing nothing: `invalid_params` (a bad id
   * or `via`), `not_found`, and `not_abandonable` for a row this manager is
   * running, a row that is not `orphaned`, or an `orphaned` row whose latest
   * orphaning reason is anything else (`reap_error`, `kill_incomplete`, ...),
   * and for a row a reap is examining at that moment (its kill may be in
   * flight and would keep signalling the group after the abandon): retry once
   * the reap is done.
   */
  abandonSession(id: number, options: { readonly via: AbandonVia }): "abandoned" {
    if (!Number.isSafeInteger(id) || id < 1) throw new SessionError("invalid_params", "id must be a positive integer");
    if (options.via !== "cli" && options.via !== "api") throw new SessionError("invalid_params", "via must be cli or api");
    if (this.#live.has(id)) throw new SessionError("not_abandonable", `session ${id} is running in this kernel`);
    if (this.#reapingRow === id) throw new SessionError("not_abandonable", `session ${id} is being reaped; retry once the reap is done`);
    const row = this.getSession(id);
    if (row === undefined) throw new SessionError("not_found", `no session ${id}`);
    if (row.status !== "orphaned") {
      throw new SessionError("not_abandonable", `session ${id} is ${row.status}; only an orphaned row can be abandoned`);
    }
    const reason = latestOrphanReason(this.#store, id);
    if (reason !== "leader_unverified") {
      throw new SessionError(
        "not_abandonable",
        `session ${id} is orphaned for ${String(reason)}; only a leader_unverified row can be abandoned`,
      );
    }
    const moved = this.#markRow(id, "orphaned", "abandoned", {
      reason: "abandoned_by_owner",
      by: "owner",
      via: options.via,
      pgid: row.pgid,
      orphaned_reason: reason,
    });
    // A reap or resume moved it between the read and the write.
    if (!moved) throw new SessionError("not_abandonable", `session ${id} changed status while being abandoned`);
    return "abandoned";
  }

  /**
   * Reap process groups left by a previous kernel (AC5). For every row in
   * `starting`/`running`/`orphaned` that this manager is not running:
   *
   * - no pgid ⇒ `interrupted` (`no_pgid`); group gone ⇒ `interrupted` (`group_gone`);
   * - group alive and its leader alive: the group is killed ONLY when the leader
   *   is provably the session's own CLI — basename `claude` AND the start time
   *   recorded with the pgid (`leader_started_at`) matches `ps`. A leader with
   *   another name or another start time means the pgid was reused (the owner's
   *   own interactive `claude` processes are `claude` group leaders too): NOT
   *   killed, `interrupted` (`pgid_reused`). No recorded start time ⇒ NOT
   *   killed, `orphaned` (`leader_unverified`);
   * - group alive and `ps` positively reports no such leader (a pid is never
   *   reused while its group exists, so the group is still the session's) ⇒
   *   killed;
   * - `ps` failed ⇒ NOT killed, `orphaned` (`reap_error`): a failed probe is
   *   never read as "the leader exited";
   * - a kill sends SIGKILL until the group is gone (`killGroupUntilGone`,
   *   where `EPERM` means "not gone yet"): `interrupted` (`group_killed`), or
   *   `orphaned` (`kill_incomplete`) plus a `session_kill_incomplete` event when
   *   it outlives the deadline; any other error ⇒ `orphaned` (`reap_error`).
   *
   * A row is `interrupted` (resumable) only when its group is gone or proven
   * foreign. `orphaned` means the group may still be the session's and alive:
   * it is never resumed while that holds, and every reap re-examines it (a
   * re-examination that changes nothing appends `session_reap_deferred`
   * instead of a second status event) until its group is gone or the owner
   * abandons it (`abandonSession`, `abandoned` is never re-examined). Each
   * row is re-read just before it is examined and skipped, unprobed and
   * unsignalled, when it no longer has the status and pgid the reap read
   * (an abandon or resume landed while an earlier row's kill was awaited).
   * The loop always continues. Each
   * marking is one transaction with its `session_status` event, which carries
   * the pgid, and is written only if the row still has the status the reap
   * read. A call made while a reap is running returns that reap. The manager
   * never calls this itself: the daemon calls it once at start-up, before
   * accepting work (item 09).
   *
   * Then it retries every terminal row whose group a live kernel could not
   * confirm gone (`kill_incomplete_at` set by a kill that gave up or errored),
   * with the same identity check and kill, never changing the terminal status:
   * one `session_kill_retried` event each, and the flag is cleared once the
   * group is gone or proven foreign. Those rows are not in the returned list.
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
        "SELECT id, pgid, status, leader_started_at FROM sessions WHERE status IN ('starting', 'running', 'orphaned') ORDER BY id",
      )
      .all();
    const results: ReapResult[] = [];
    /** Sessions whose recorded tool groups this reap already tried: retried once per reap. */
    const handled = new Set<number>();
    for (const row of rows) {
      if (this.#live.has(row.id)) continue;
      // The rows were read once, before any await: an abandon (or a resume
      // that has since ended) may have moved this row while an earlier row's
      // kill was awaited. Never probe or signal a row that is no longer what
      // was read.
      const current = this.getSession(row.id);
      if (current === undefined || current.status !== row.status || current.pgid !== row.pgid) continue;
      let reason: ReapResult["reason"];
      let error: string | undefined;
      this.#reapingRow = row.id;
      handled.add(row.id);
      try {
        reason = await this.#reapOne(row.id, row.pgid, row.leader_started_at);
      } catch (err) {
        // A failed `ps`, or a kill error other than ESRCH/EPERM: nothing proves the group gone.
        reason = "reap_error";
        error = errorMessage(err);
      } finally {
        this.#reapingRow = undefined;
      }
      const status: ReapResult["status"] = LEFT_ALIVE.has(reason) ? "orphaned" : "interrupted";
      const payload = { reason, pgid: row.pgid, ...(error === undefined ? {} : { error }) };
      // A resume may have taken the row while the kill was awaited: write only over what was read.
      if (this.#live.has(row.id)) continue;
      if (status === row.status) {
        if (this.getSession(row.id)?.status !== row.status) continue;
        this.#appendEvent("session_reap_deferred", row.id, payload, this.#nowIso());
      } else if (!this.#markRow(row.id, row.status, status, payload)) {
        continue;
      }
      results.push({ sessionId: row.id, pgid: row.pgid, status, reason });
    }
    await this.#retryTerminalKills(handled);
    return results;
  }

  /**
   * Terminal rows whose group a live kernel could not confirm gone
   * (`kill_incomplete_at` set): run the same identity check and kill as for an
   * orphan, WITHOUT changing the terminal status, and append one
   * `session_kill_retried` event each. The flag is cleared once the group is
   * confirmed gone or proven foreign, so each row is retried only while its
   * group may still be the session's. Each row is re-read just before its
   * retry and skipped (no probe, no signal, no event) unless it still has the
   * status, pgid and flag that were read.
   *
   * Then every session (any status but `abandoned`, not run by this manager)
   * with a recorded tool group still flagged (`session_groups.kill_incomplete_at`)
   * gets its unsettled groups killed again, with the ownership check. The
   * session's own flag is keyed on the CLI's pgid; a tool group keeps its own,
   * so a session stays retried until the CLI's group AND every recorded group
   * are confirmed gone or skipped.
   */
  async #retryTerminalKills(handled: Set<number>): Promise<void> {
    const placeholders = TERMINAL_STATUSES.map(() => "?").join(", ");
    const rows = this.#store
      .prepare<string[], { id: number; pgid: number | null; status: string; leader_started_at: string | null }>(
        `SELECT id, pgid, status, leader_started_at FROM sessions
          WHERE kill_incomplete_at IS NOT NULL AND status IN (${placeholders}) ORDER BY id`,
      )
      .all(...TERMINAL_STATUSES);
    for (const row of rows) {
      // A session this manager still runs (e.g. `failed:auth` awaiting its kill) owns its own kill.
      if (this.#live.has(row.id)) continue;
      // Read once, before any await: a live kill that has since confirmed the
      // group gone (flag cleared) or a new attempt (new pgid) may have changed
      // the row while an earlier row's kill was awaited. Retry only what is
      // still flagged for the group that was read.
      const current = this.getSession(row.id);
      if (
        current === undefined ||
        current.status !== row.status ||
        current.pgid !== row.pgid ||
        current.kill_incomplete_at === null
      ) {
        continue;
      }
      let reason: ReapResult["reason"];
      let error: string | undefined;
      handled.add(row.id);
      try {
        reason = await this.#reapOne(row.id, row.pgid, row.leader_started_at);
      } catch (err) {
        reason = "reap_error";
        error = errorMessage(err);
      }
      const confirmed = !LEFT_ALIVE.has(reason);
      const at = this.#nowIso();
      // The status is never written: only the event and, once confirmed, the flag.
      this.#store.transaction(() => {
        this.#appendEvent(
          "session_kill_retried",
          row.id,
          { status: row.status, reason, pgid: row.pgid, ...(error === undefined ? {} : { error }) },
          at,
        );
        if (confirmed) {
          this.#store
            .prepare("UPDATE sessions SET kill_incomplete_at = NULL, updated_at = ? WHERE id = ? AND pgid IS ?")
            .run(at, row.id, row.pgid);
        }
      });
    }
    const flagged = this.#store
      .prepare<[], number>(
        `SELECT DISTINCT g.session_id FROM session_groups g JOIN sessions s ON s.id = g.session_id
          WHERE g.kill_incomplete_at IS NOT NULL AND g.resolved_at IS NULL AND s.status <> 'abandoned'
          ORDER BY g.session_id`,
      )
      .pluck()
      .all();
    for (const id of flagged) {
      if (handled.has(id) || this.#live.has(id)) continue;
      await this.#killRecordedGroups(id);
    }
  }

  /**
   * One orphan (or flagged terminal row): the CLI's group, then the process
   * groups its tools started (`session_groups`, H08), each killed only after
   * its own ownership check, whatever the CLI's outcome (`group_gone`,
   * `no_pgid`, `pgid_reused`, `leader_unverified`, a failed `ps`). The result
   * is the CLI group's; a tool group that survives its kill stays flagged for
   * the next reap.
   *
   * When the CLI is still alive and proven the session's, its descendants are
   * walked once more first (one snapshot), so a group started since the dead
   * kernel's last poll is recorded and killed too.
   *
   * Honest limit (B5): a tool group started after the kernel died whose CLI
   * then exited before this restart cannot be found: once the CLI is gone
   * nothing links that group to the session (its parent chain is broken and
   * it was never recorded). launchd restarts the kernel within seconds, so
   * the window is small, not zero. A group living less than one poll interval
   * (`TOOL_GROUP_POLL_MS`) may also never be recorded (it is gone anyway
   * unless something in it outlives that), and a group whose leader exited
   * before it was first seen is never recorded (`descendantGroups`).
   */
  async #reapOne(sessionId: number, pgid: number | null, recordedStart: string | null): Promise<ReapResult["reason"]> {
    let check: GroupCheck;
    try {
      // Throws when `ps` failed: the caller records `reap_error` and kills nothing of the CLI's.
      check = this.#checkGroup(pgid, recordedStart);
    } catch (err) {
      await this.#killRecordedGroups(sessionId);
      throw err;
    }
    if (check !== "ours") {
      await this.#killRecordedGroups(sessionId);
      return check;
    }
    // Not awaited at all without a snapshot: the first SIGKILL then stays synchronous.
    if (this.#snapshot !== undefined) await this.#walkOrphan(sessionId, pgid as number, recordedStart);
    // The leader is the session's CLI, or it exited while its group lives on.
    // `killGroupUntilGone` reads EPERM as "not gone yet", never as "foreign":
    // a group proven foreign was returned above and is never signalled.
    const killed = await this.#killUntilGone(pgid as number);
    await this.#killRecordedGroups(sessionId);
    if (killed) return "group_killed";
    this.#recordKillIncomplete(sessionId, pgid as number);
    return "kill_incomplete";
  }

  /**
   * Whether a recorded group may still be the session's and alive. Throws when
   * `ps` failed (never read as "the leader exited"). `ours` means alive and
   * either led by the session's CLI (basename `claude` with the recorded start
   * time) or leaderless (a pid is never reused while its group exists).
   */
  #checkGroup(pgid: number | null, recordedStart: string | null): GroupCheck {
    if (pgid === null || !isValidPgid(pgid)) return "no_pgid";
    if (!this.#isGroupAlive(pgid)) return "group_gone";
    const leader = this.#readLeader(pgid);
    if (leader.status === "present") {
      if (leaderBasename(leader.command) !== CLI_BASENAME) return "pgid_reused";
      const recordedMs = recordedStart === null ? Number.NaN : Date.parse(recordedStart);
      if (!Number.isFinite(recordedMs)) return "leader_unverified";
      if (Math.abs(leader.startedAtMs - recordedMs) > LEADER_START_TOLERANCE_MS) return "pgid_reused";
    }
    return "ours";
  }

  /**
   * Move a row this manager is not running from `from` to `to`, with its
   * `session_status` event, in one transaction, only if it is still `from`.
   * Returns whether it moved.
   */
  #markRow(id: number, from: string, to: SessionStatus, payload: Record<string, unknown>): boolean {
    const at = this.#nowIso();
    return this.#store.transaction(() => {
      const changed = this.#store
        .prepare(
          `UPDATE sessions SET status = ?, updated_at = ?, ended_at = CASE WHEN ? THEN ? ELSE ended_at END,
                  kill_incomplete_at = CASE WHEN ? THEN NULL ELSE kill_incomplete_at END
            WHERE id = ? AND status = ?`,
        )
        // `interrupted` means the group is gone or proven foreign: no kill is
        // pending. `abandoned`: the kernel never signals that group again.
        .run(to, at, isTerminalStatus(to) ? 1 : 0, at, to === "interrupted" || to === "abandoned" ? 1 : 0, id, from).changes;
      if (changed !== 1) return false;
      this.#appendStatusEvent(id, from, to, payload, at);
      return true;
    });
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
      verdict: undefined,
      settled: false,
      done,
      resolveDone,
    };
    this.#live.set(id, live);
    return live;
  }

  /** Build the attempt, call `query()` (which spawns synchronously) and push the prompt. */
  #launch(live: LiveSession, config: LaunchConfig): Attempt {
    // Fresh servers for every launch attempt (a server instance cannot reconnect).
    const mcpServers = this.#mcpServers?.({ sessionId: live.id, agent: config.agent, task: config.task });
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
      killFlagged: false,
      leaderExited: false,
      toolGroupsDone: false,
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
      ...(mcpServers === undefined ? {} : { mcpServers }),
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
        // Synchronous, inside query(): on disk before any message is awaited
        // (AC2), and before the `ps` below, so a kernel that dies during that
        // probe still leaves a findable group. The stale start time and kill
        // flag of an earlier attempt are cleared with it: a row never pairs a
        // pgid with another process's start time or kill state (a resume only
        // launches once the earlier group is gone or proven foreign).
        this.#store
          .prepare("UPDATE sessions SET pgid = ?, leader_started_at = NULL, kill_incomplete_at = NULL, updated_at = ? WHERE id = ?")
          .run(pgid, this.#nowIso(), live.id);
        // The leader's start time lets a later reaper tell this CLI from an
        // unrelated process that reuses the pgid. Read without blocking the
        // event loop and not awaited: it lands a moment later. Unreadable (or
        // a kernel killed first) ⇒ null, and the reaper then never kills the
        // group (the row ends `orphaned`, `leader_unverified`).
        void this.#recordLeaderStart(live.id, pgid);
        // From now on the tool-group poll walks this CLI's descendants (H08).
        this.#ensurePoll();
      },
    });
    attempt.child = child;
    child.once("exit", () => {
      attempt.leaderExited = true;
      attempt.markExited();
    });
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
      agent: ctx.agent,
      task: ctx.taskId,
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
        // Synchronous from the check to the launch: nothing interleaves.
        if (this.#parkIfRefused(live, ctx, n)) return;
        try {
          next = this.#launchResumeAttempt(live, ctx, n);
        } catch (err) {
          if (isTerminalStatus(live.status)) {
            this.#settle(live);
            return;
          }
          if (live.attempt !== undefined) await this.#killAttemptGroup(live, live.attempt);
          this.#recordResumeFailure(live, n, err, undefined);
          if (live.stopping) return this.#afterStop(live);
          // Never launch the next attempt while this one's group may be alive.
          if (this.#endIfGroupMayBeAlive(live)) return;
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
      // Never launch the next attempt while this one's group may be alive.
      if (this.#endIfGroupMayBeAlive(live)) return;
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

  /**
   * Ask `admission` before resume attempt `n` (n >= 2; attempt 1 was admitted
   * by `resumeSession`). Called only once the previous attempt's group is
   * gone, so a refusal, or a check that throws (fail closed), launches nothing
   * and moves the session back to `interrupted`, which stays resumable, then
   * settles. Never throws for a refusal. Returns whether it parked the session.
   */
  #parkIfRefused(live: LiveSession, ctx: ResumeContext, n: number): boolean {
    if (this.#admission === undefined) return false;
    let payload: Record<string, unknown>;
    try {
      const decision = this.#admission({
        kind: "resume",
        agent: ctx.agent,
        account: this.#auth.account,
        provider: this.#auth.id,
        task: ctx.taskId,
      });
      if (decision.admitted) return false;
      payload = { reason: "admission_refused", refusal: decision.reason, retry_at: decision.retryAt, attempt: n };
    } catch (err) {
      payload = { reason: "admission_error", error: errorMessage(err), attempt: n };
    }
    this.#transition(live, "interrupted", payload);
    this.#settle(live);
    return true;
  }

  /** Ask the `admission` check; a refusal throws before any side effect. */
  #admit(request: AdmissionRequest): void {
    if (this.#admission === undefined) return;
    const decision = this.#admission(request);
    if (decision.admitted) return;
    throw new AdmissionRefusedError(
      decision.reason,
      decision.retryAt,
      `${request.kind} refused for agent ${String(request.agent)} on account ${request.account}: ${decision.reason}` +
        (decision.retryAt === null ? " (retry time unknown)" : ` until ${decision.retryAt}`),
    );
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

  /**
   * After the stream ended: clean up the group, then write the terminal
   * status (`failed`/`kill_incomplete` when the group cannot be confirmed
   * gone), settle `done`.
   */
  async #conclude(live: LiveSession, attempt: Attempt, outcome: ConsumeOutcome): Promise<void> {
    if (live.stopping && live.stopPromise !== undefined) await live.stopPromise;
    let verdict: Verdict | undefined;
    if (!live.stopping && !live.authFailed) {
      if (outcome.kind === "ended") {
        const result = attempt.closeInputOnResult ? attempt.firstResult : attempt.lastResult;
        if (result === undefined) verdict = { to: "failed", payload: { reason: "ended_without_result" } };
        else if (isSuccessResult(result)) verdict = { to: "completed", payload: { reason: "result_success" } };
        else verdict = { to: "failed", payload: { reason: "result_error", error: resultErrorText(result).slice(0, MAX_RECORDED_TEXT) } };
      } else {
        const error = outcome.error;
        verdict = {
          to: "failed",
          payload: {
            reason: "stream_error",
            error: errorMessage(error),
            stack: errorStack(error),
            stderr: tail(attempt.stderrTail.text()),
          },
        };
      }
      // Synchronously, before any await: a stop that arrives during the
      // cleanup below finishes with this verdict instead of losing it.
      live.verdict = verdict;
    }
    // The CLI has exited or is exiting; kill whatever is left in its group
    // (background shells outlive the leader, Q5) before saying it ended.
    await this.#reapAttemptGroup(live, attempt);
    attempt.authTimer?.();
    if (live.stopping) {
      // A stop that arrived during the cleanup writes the status itself, from `live.verdict`.
      if (live.stopPromise !== undefined) await live.stopPromise;
    } else if (verdict !== undefined) {
      this.#finishAfterKill(live, attempt, verdict.to, verdict.payload);
    }
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
    await killed;
    try {
      // A verdict computed before the crash is kept as `outcome`, never dropped.
      const v = live.verdict;
      this.#finishAfterKill(live, attempt, "failed", {
        reason: "kernel_error",
        error: errorMessage(err),
        ...(v === undefined ? {} : { outcome: { to: v.to, reason: v.payload["reason"] ?? null } }),
      });
    } catch {
      // The store is unusable; the in-memory status still reaches `done`.
      if (!isTerminalStatus(live.status)) live.status = "failed";
    }
    this.#settle(live);
  }

  async #stop(live: LiveSession, intent: StopIntent): Promise<SessionStatus> {
    const attempt = live.attempt;
    if (attempt !== undefined) {
      attempt.input.close();
      await this.#waitFor(attempt.exited, this.#stopGraceMs);
      // One last walk of the CLI's descendants: a tool group started since the
      // last poll tick is recorded, and so killed below with the rest.
      if (this.#snapshot !== undefined) await this.#walkNow([{ live, attempt }]);
      await this.#killAttemptGroup(live, attempt);
      // Until Node reaps the killed leader it is a zombie holding the pgid.
      await this.#waitFor(attempt.exited, LEADER_EXIT_WAIT_MS);
      this.#closeQuery(attempt);
      attempt.authTimer?.();
    }
    // A group (the CLI's or a recorded tool group) that outlived the kill is
    // not "stopped": `failed` (`kill_incomplete`).
    // A stream that had already ended keeps its computed outcome: the stop only
    // raced the cleanup of a session that was no longer running. A shutdown
    // ends a running session `interrupted` (non-terminal, resumable): `stopping`
    // is set, so the session's own background path writes nothing after this.
    const verdict = live.verdict;
    if (verdict === undefined && intent === "shutdown") {
      this.#finishAfterKill(live, attempt, "interrupted", { reason: "kernel_shutdown" });
    } else if (verdict === undefined) this.#finishAfterKill(live, attempt, "stopped", { reason: "stop_requested" });
    else this.#finishAfterKill(live, attempt, verdict.to, { ...verdict.payload, stop_requested_after_end: true });
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
   * SIGKILL can miss a child forked during it), then every process group the
   * session's tools started (`session_groups`, H08), each after its ownership
   * check (`#killRecordedGroups`). The first SIGKILL is sent synchronously.
   * Concurrent callers share one run; once the CLI's group is gone it is never
   * signalled again, and a run that gave up at the deadline
   * (`session_kill_incomplete`) is retried by the next caller, as is a tool
   * group not yet settled. A failure is recorded (`session_kill_error`), never
   * thrown: the promise never rejects.
   */
  #killAttemptGroup(live: LiveSession, attempt: Attempt): Promise<void> {
    const pgid = attempt.pgid;
    if (pgid === undefined || (attempt.groupGone && attempt.toolGroupsDone)) return Promise.resolve();
    if (attempt.killing !== undefined) return attempt.killing;
    const run = async (): Promise<void> => {
      if (!attempt.groupGone) await this.#killCliGroup(live, attempt, pgid);
      // A snapshot taken before the kill may still record a group: let it land first.
      if (this.#pollInFlight !== undefined) await this.#pollInFlight;
      attempt.toolGroupsDone = await this.#killRecordedGroups(live.id);
    };
    const killing = run().finally(() => {
      if (attempt.killing === killing) attempt.killing = undefined;
    });
    attempt.killing = killing;
    return killing;
  }

  /** The CLI's own group: kill until gone, or record and flag (`kill_incomplete_at`) why not. Never rejects. */
  async #killCliGroup(live: LiveSession, attempt: Attempt, pgid: number): Promise<void> {
    try {
      if (await this.#killUntilGone(pgid)) {
        attempt.groupGone = true;
        // A retry confirmed the group gone: the reaper need not retry it.
        if (attempt.killFlagged) this.#flagKillIncomplete(live.id, pgid, false);
        return;
      }
      this.#recordKillIncomplete(live.id, pgid);
    } catch (err) {
      this.#recordSafely("session_kill_error", live.id, { pgid, error: errorMessage(err), code: errnoCode(err) ?? null });
    }
    attempt.killFlagged = true;
    this.#flagKillIncomplete(live.id, pgid, true);
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

  /**
   * Set (or clear) `kill_incomplete_at` for the row's recorded group `pgid`:
   * set, every later `reapOrphans` retries the kill even once the row is
   * terminal. Only while the row still records that pgid. Never throws.
   */
  #flagKillIncomplete(sessionId: number, pgid: number, flagged: boolean): void {
    try {
      const at = this.#nowIso();
      this.#store
        .prepare("UPDATE sessions SET kill_incomplete_at = ?, updated_at = ? WHERE id = ? AND pgid = ?")
        .run(flagged ? at : null, at, sessionId, pgid);
    } catch {
      // The store is gone; nothing more can be done.
    }
  }

  // ---- tool process groups (H08) -------------------------------------------
  //
  // The CLI's tools (the Bash tool above all) run their commands in a new
  // session and process group, outside the CLI's own group, so `kill(-pgid)`
  // of the CLI's group leaves them running. While a CLI runs, one manager-wide
  // poll walks every running CLI's descendants in a `ps -A` snapshot and
  // records each new group in `session_groups` with its leader's identity;
  // every kill of a session's CLI group then kills those groups too, each only
  // while its leader still has the recorded executable and start time.

  /** Schedule the next poll tick unless one is pending or in flight, or no CLI runs. */
  #ensurePoll(): void {
    if (this.#snapshot === undefined || this.#pollTimer !== undefined || this.#pollInFlight !== undefined) return;
    if (this.#pollTargets().length === 0) return;
    this.#pollTimer = this.#schedule(() => {
      this.#pollTimer = undefined;
      void this.#pollTick();
    }, TOOL_GROUP_POLL_MS);
  }

  async #pollTick(): Promise<void> {
    const targets = this.#pollTargets();
    // No CLI runs: the poll stops until the next spawn starts it again.
    if (targets.length === 0) return;
    await this.#walkNow(targets);
    this.#ensurePoll();
  }

  /** Every live session's current attempt whose CLI has not exited and whose groups no kill has started on. */
  #pollTargets(): { readonly live: LiveSession; readonly attempt: Attempt }[] {
    const targets: { live: LiveSession; attempt: Attempt }[] = [];
    for (const live of this.#live.values()) {
      const attempt = live.attempt;
      if (attempt === undefined || attempt.pgid === undefined || attempt.leaderExited) continue;
      if (attempt.killing !== undefined || attempt.groupGone) continue;
      targets.push({ live, attempt });
    }
    return targets;
  }

  /** Walk `targets` in one fresh snapshot, after any walk in flight (one at a time). Never rejects. */
  async #walkNow(targets: readonly { readonly live: LiveSession; readonly attempt: Attempt }[]): Promise<void> {
    while (this.#pollInFlight !== undefined) await this.#pollInFlight;
    const run = this.#walkLive(targets);
    this.#pollInFlight = run;
    try {
      await run;
    } finally {
      if (this.#pollInFlight === run) this.#pollInFlight = undefined;
    }
  }

  /**
   * Record the new descendant groups of each running CLI in one snapshot. A
   * CLI is walked only when Node had not reaped it when the snapshot began
   * (its pid could not have been reused yet), and only while the snapshot's
   * process at that pid has the start time the row recorded (when it is
   * recorded yet). A failed snapshot records nothing. Never rejects.
   */
  async #walkLive(targets: readonly { readonly live: LiveSession; readonly attempt: Attempt }[]): Promise<void> {
    const snapshot = this.#snapshot;
    const ready = targets.filter((t) => !t.attempt.leaderExited && t.attempt.pgid !== undefined);
    if (snapshot === undefined || ready.length === 0) return;
    let table: ProcessTable;
    try {
      table = await snapshot();
    } catch {
      // `ps` failed: nothing is recorded this tick; the next tick tries again.
      return;
    }
    for (const { live, attempt } of ready) {
      const pgid = attempt.pgid as number;
      const leader = table.find((p) => p.pid === pgid);
      if (leader === undefined || !this.#matchesRecordedStart(live.id, pgid, leader)) continue;
      this.#recordGroups(live.id, descendantGroups(table, pgid));
    }
  }

  /** The snapshot's `leader` has the start time the row recorded for `pgid`, or none is recorded yet. Fails closed on a store error. */
  #matchesRecordedStart(sessionId: number, pgid: number, leader: ProcessEntry): boolean {
    try {
      const row = this.#store
        .prepare<[number, number], { leader_started_at: string | null }>("SELECT leader_started_at FROM sessions WHERE id = ? AND pgid = ?")
        .get(sessionId, pgid);
      if (row === undefined) return false;
      if (row.leader_started_at === null) return true;
      const recordedMs = Date.parse(row.leader_started_at);
      return Number.isFinite(recordedMs) && Math.abs(leader.startedAtMs - recordedMs) <= LEADER_START_TOLERANCE_MS;
    } catch {
      return false;
    }
  }

  /**
   * B3: before the reaper kills an orphan's CLI (already proven the session's
   * by `#checkGroup`), walk its descendants in one snapshot and record any new
   * group. Only when the snapshot's process at `pgid` is still that CLI (basename
   * `claude`, the recorded start time); a leaderless CLI group has nothing to
   * walk from. A failed snapshot records nothing. Never rejects.
   */
  async #walkOrphan(sessionId: number, pgid: number, recordedStart: string | null): Promise<void> {
    const snapshot = this.#snapshot;
    if (snapshot === undefined) return;
    let table: ProcessTable;
    try {
      table = await snapshot();
    } catch {
      return;
    }
    const leader = table.find((p) => p.pid === pgid);
    const recordedMs = recordedStart === null ? Number.NaN : Date.parse(recordedStart);
    if (leader === undefined || leaderBasename(leader.command) !== CLI_BASENAME || !Number.isFinite(recordedMs)) return;
    if (Math.abs(leader.startedAtMs - recordedMs) > LEADER_START_TOLERANCE_MS) return;
    this.#recordGroups(sessionId, descendantGroups(table, pgid));
  }

  /**
   * Record each group not seen before (`session_group_recorded`), in one
   * transaction, committed before the next poll. A group seen again whose
   * leader has since exec'd another program (same pid and start time) gets its
   * new executable: the walk just proved it the session's, and the kill's
   * ownership check compares the executable as last seen. Never throws.
   */
  #recordGroups(sessionId: number, groups: readonly ProcessEntry[]): void {
    if (groups.length === 0) return;
    try {
      const at = this.#nowIso();
      const find = this.#store.prepare<[number, number, string], { leader_command: string; resolved_at: string | null }>(
        "SELECT leader_command, resolved_at FROM session_groups WHERE session_id = ? AND pgid = ? AND leader_started_at = ?",
      );
      this.#store.transaction(() => {
        for (const g of groups) {
          const startedAt = new Date(g.startedAtMs).toISOString();
          const existing = find.get(sessionId, g.pgid, startedAt);
          const payload = { pgid: g.pgid, command: g.command, leader_started_at: startedAt };
          if (existing === undefined) {
            this.#store
              .prepare(
                `INSERT INTO session_groups (session_id, pgid, leader_command, leader_started_at, first_seen)
                 VALUES (?, ?, ?, ?, ?)`,
              )
              .run(sessionId, g.pgid, g.command, startedAt, at);
            this.#appendEvent("session_group_recorded", sessionId, payload, at);
          } else if (existing.resolved_at === null && existing.leader_command !== g.command) {
            this.#store
              .prepare("UPDATE session_groups SET leader_command = ? WHERE session_id = ? AND pgid = ? AND leader_started_at = ?")
              .run(g.command, sessionId, g.pgid, startedAt);
            this.#appendEvent("session_group_command_changed", sessionId, { ...payload, previous: existing.leader_command }, at);
          }
        }
      });
    } catch {
      // The store is gone; the next tick (or the reaper's walk) records it.
    }
  }

  /**
   * Kill every unsettled recorded group of `sessionId` (B2), each only after
   * its ownership check (`#killRecordedGroup`). An `abandoned` session's groups
   * are never signalled. Resolves whether every recorded group is now settled
   * (confirmed gone or proven not the session's). Never rejects.
   */
  async #killRecordedGroups(sessionId: number): Promise<boolean> {
    let groups: RecordedGroup[];
    try {
      const status = this.#store.prepare<[number], string>("SELECT status FROM sessions WHERE id = ?").pluck().get(sessionId);
      if (status === "abandoned") return true;
      groups = this.#store
        .prepare<[number], RecordedGroup>(
          `SELECT pgid, leader_command, leader_started_at FROM session_groups
            WHERE session_id = ? AND resolved_at IS NULL ORDER BY first_seen, pgid`,
        )
        .all(sessionId);
    } catch {
      return false;
    }
    let settled = true;
    for (const g of groups) {
      if (!(await this.#killRecordedGroup(sessionId, g))) settled = false;
    }
    return settled;
  }

  /**
   * One recorded group: signalled ONLY while `readGroupLeader(pgid)` shows its
   * leader with the recorded executable (exact `comm`; both sides are read on
   * the same host) and start time (within `LEADER_START_TOLERANCE_MS`).
   * Otherwise it is skipped (`session_group_skipped` with `reason`) and never
   * signalled: another executable or start time is a reused pgid; an absent
   * leader (`leader_gone`) leaves nothing that proves the pgid is still this
   * group, even when members of it live on; a failed `ps` (`ps_failed`) proves
   * nothing either way and keeps the group flagged. A kill that confirms the
   * group gone settles it (`session_group_killed`); one that gives up
   * (`session_group_kill_incomplete`) or errors (`session_group_kill_error`)
   * flags it for the next reap. Resolves whether the group is settled.
   */
  async #killRecordedGroup(sessionId: number, g: RecordedGroup): Promise<boolean> {
    const base = { pgid: g.pgid, command: g.leader_command, leader_started_at: g.leader_started_at };
    if (!isValidPgid(g.pgid)) return this.#skipGroup(sessionId, g, base, "no_pgid");
    let leader: GroupLeader;
    try {
      if (!this.#isGroupAlive(g.pgid)) return this.#skipGroup(sessionId, g, base, "group_gone");
      leader = this.#readLeader(g.pgid);
    } catch (err) {
      return this.#skipGroup(sessionId, g, { ...base, error: errorMessage(err) }, "ps_failed");
    }
    const mismatch = recordedGroupMismatch(g, leader);
    if (mismatch !== undefined) return this.#skipGroup(sessionId, g, base, mismatch);
    try {
      if (await this.#killUntilGone(g.pgid)) {
        this.#settleGroup(sessionId, g, "session_group_killed", base, "killed");
        return true;
      }
      this.#settleGroup(sessionId, g, "session_group_kill_incomplete", { ...base, deadline_ms: KILL_GROUP_DEADLINE_MS }, undefined);
    } catch (err) {
      this.#settleGroup(sessionId, g, "session_group_kill_error", { ...base, error: errorMessage(err), code: errnoCode(err) ?? null }, undefined);
    }
    return false;
  }

  #skipGroup(sessionId: number, g: RecordedGroup, payload: Record<string, unknown>, reason: GroupSkipReason): boolean {
    const resolution = reason === "ps_failed" ? undefined : reason;
    this.#settleGroup(sessionId, g, "session_group_skipped", { ...payload, reason }, resolution);
    return resolution !== undefined;
  }

  /**
   * Append `kind` and, in the same transaction, settle the group
   * (`resolution`: never examined again, its flag cleared) or flag it
   * (`undefined`: `kill_incomplete_at`, retried by the next reap). Never throws.
   */
  #settleGroup(sessionId: number, g: RecordedGroup, kind: string, payload: Record<string, unknown>, resolution: string | undefined): void {
    try {
      const at = this.#nowIso();
      this.#store.transaction(() => {
        this.#appendEvent(kind, sessionId, payload, at);
        if (resolution === undefined) {
          this.#store
            .prepare("UPDATE session_groups SET kill_incomplete_at = ? WHERE session_id = ? AND pgid = ? AND leader_started_at = ?")
            .run(at, sessionId, g.pgid, g.leader_started_at);
        } else {
          this.#store
            .prepare(
              `UPDATE session_groups SET resolved_at = ?, resolution = ?, kill_incomplete_at = NULL
                WHERE session_id = ? AND pgid = ? AND leader_started_at = ?`,
            )
            .run(at, resolution, sessionId, g.pgid, g.leader_started_at);
        }
      });
    } catch {
      // The store is gone; nothing more can be done.
    }
  }

  /**
   * D31: a `cwd` inside a protected folder (`isProtectedPath`, after symlink
   * resolution) is refused before admission, auth or any spawn. Appends one
   * `session_refused` event (`session_id` null for a start, the session's id
   * for a resume) and throws `SessionError("protected_cwd")`. A fixed safety
   * check, never a playbook setting.
   */
  #refuseProtectedCwd(cwd: string, sessionId: number | null): void {
    if (!isProtectedPath(cwd, this.#homeDir)) return;
    this.#recordSafely("session_refused", sessionId, { reason: "protected_cwd", cwd });
    throw new SessionError(
      "protected_cwd",
      `cwd ${cwd} is inside a macOS-protected folder (${protectedLocationsText()}); agents work only on repos outside them (D31)`,
    );
  }

  /** Append an event; a store failure is swallowed (nothing more can be done). */
  #recordSafely(kind: string, sessionId: number | null, payload: Record<string, unknown>): void {
    try {
      this.#appendEvent(kind, sessionId, payload, this.#nowIso());
    } catch {
      // Nothing more can be done.
    }
  }

  /**
   * Write the leader's start time once the async probe resolves, only while
   * the row still records `pgid` (a later attempt's group is never paired
   * with this leader). A failed, timed-out or `absent` probe leaves it null.
   * Never rejects: a store closed meanwhile is swallowed.
   */
  async #recordLeaderStart(sessionId: number, pgid: number): Promise<void> {
    try {
      const leader = await this.#readLeaderAsync(pgid);
      if (leader.status !== "present") return;
      const startedAt = new Date(leader.startedAtMs).toISOString();
      this.#store
        .prepare("UPDATE sessions SET leader_started_at = ?, updated_at = ? WHERE id = ? AND pgid = ?")
        .run(startedAt, this.#nowIso(), sessionId, pgid);
    } catch {
      // `ps` failed, or the store is gone: the start time stays null.
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

  /**
   * `#finish` for a status written after the attempt's group was killed: when
   * that kill did not confirm the group gone (it gave up at the deadline or
   * errored, already recorded as `session_kill_incomplete`/`session_kill_error`)
   * or left a recorded tool group unsettled (H08:
   * `session_group_kill_incomplete`/`_kill_error`, or a `ps_failed` skip;
   * `tool_groups_unsettled: true` in the payload), the session is `failed`
   * with reason `kill_incomplete` and `cause` the intended outcome, never a
   * status that claims the session ended cleanly. The kill already flagged the
   * row (`kill_incomplete_at`) or the group (`session_groups.kill_incomplete_at`),
   * so every later `reapOrphans` retries it and `/status` lists the session
   * under `kill_unconfirmed` until then.
   */
  #finishAfterKill(
    live: LiveSession,
    attempt: Attempt | undefined,
    to: SessionStatus,
    payload: Record<string, unknown>,
  ): boolean {
    if (!groupMayBeAlive(attempt)) return this.#finish(live, to, payload);
    return this.#finish(live, "failed", {
      ...payload,
      reason: "kill_incomplete",
      cause: { to, reason: payload["reason"] ?? null },
      pgid: attempt.pgid,
      ...(attempt.toolGroupsDone ? {} : { tool_groups_unsettled: true }),
    });
  }

  /**
   * After a failed resume attempt's group was killed: when it may still be
   * alive, end the session `failed` (`kill_incomplete`) and settle instead of
   * launching another CLI for the same SDK session. Returns whether it ended.
   */
  #endIfGroupMayBeAlive(live: LiveSession): boolean {
    if (!groupMayBeAlive(live.attempt)) return false;
    this.#finishAfterKill(live, live.attempt, "failed", { reason: "resume_attempt_failed" });
    this.#settle(live);
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

  /** `sessionId` null: an event about no session row (a refused start). */
  #appendEvent(kind: string, sessionId: number | null, payload: Record<string, unknown>, at: string): void {
    this.#store
      .prepare("INSERT INTO events (at, kind, actor, session_id, payload_json) VALUES (?, ?, 'kernel', ?, ?)")
      .run(at, kind, sessionId, JSON.stringify(payload));
  }

  #nowIso(): string {
    return this.#now().toISOString();
  }
}

/**
 * Why `leader` (read now) is not the recorded group's leader, or `undefined`
 * when it is: the same executable (`comm`, exact) and a start time within
 * `LEADER_START_TOLERANCE_MS` of the recorded one.
 */
function recordedGroupMismatch(g: RecordedGroup, leader: GroupLeader): GroupSkipReason | undefined {
  if (leader.status === "absent") return "leader_gone";
  if (leader.command !== g.leader_command) return "command_differs";
  const recordedMs = Date.parse(g.leader_started_at);
  if (!Number.isFinite(recordedMs) || Math.abs(leader.startedAtMs - recordedMs) > LEADER_START_TOLERANCE_MS) return "start_differs";
  return undefined;
}

/** A stable, secret-free code for an env-build failure. */
function authErrorCode(err: unknown): string {
  if (err instanceof AuthProviderError) return err.code;
  if (err instanceof KeychainError) return "keychain_error";
  return "auth_env_error";
}
