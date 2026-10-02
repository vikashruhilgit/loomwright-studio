import type {
  McpServerConfig,
  PermissionMode,
  SDKMessage,
  SDKUserMessage,
  Options,
  SpawnOptions,
  SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import type { AuthProvider, BaseEnv } from "../auth/types.js";
import type { Store } from "../store/store.js";

/**
 * A session row's `status`. `failed:auth` is its own status so an auth failure
 * parks the session instead of being retried like an ordinary failure (AC7).
 *
 * - `interrupted`: the kernel that ran it is gone and its process group is
 *   gone or proven foreign; resumable.
 * - `orphaned`: the kernel that ran it is gone and its process group may still
 *   be alive (the reaper could not prove it gone or foreign, nor kill it).
 *   Never resumed while that holds: every `reapOrphans` re-examines it, and a
 *   resume re-checks the group first. Non-terminal.
 */
export type SessionStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "failed:auth"
  | "stopped"
  | "interrupted"
  | "orphaned";

/** The statuses a session never leaves (`interrupted` and `orphaned` are left only by a reap or an explicit resume). */
export const TERMINAL_STATUSES: readonly SessionStatus[] = ["completed", "failed", "failed:auth", "stopped"];

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * The per-session tool policy the kernel's `PreToolUse` gate enforces. Deny by
 * default: a tool runs only when this policy allows it.
 *
 * - `allowedTools`: exact tool names (for example `Read`, `mcp__kernel__kernel_task_create`).
 *   Listing `Bash` here does NOT allow any shell command: Bash is gated by
 *   `allowedBashPrefixes` only.
 * - `allowedBashPrefixes`: command prefixes matched on a word boundary (`echo`
 *   allows `echo hi`, never `echoX`), and only for commands that contain no
 *   shell control or substitution character (see `policy.ts`).
 *
 * Held in kernel memory, frozen at session start; the brain has no path to it
 * (invariant 3). Not persisted in phase 1: a resume passes it again.
 */
export interface ToolPolicy {
  readonly allowedTools: readonly string[];
  readonly allowedBashPrefixes: readonly string[];
}

/** Every permission mode except `bypassPermissions`, which the kernel never sets (D5). */
export type AllowedPermissionMode = Exclude<PermissionMode, "bypassPermissions">;

export interface StartSessionParams {
  readonly agent: string;
  readonly task?: number;
  readonly prompt: string;
  /** Required, no default: the CLI's default model is Opus (Q1). */
  readonly model: string;
  /** Required, no default (Q5). `bypassPermissions` is refused at runtime too. */
  readonly permissionMode: AllowedPermissionMode;
  readonly cwd: string;
  readonly policy: ToolPolicy;
  /**
   * Close the input after the first `result`, so the CLI finishes and exits
   * (default `true`). A caller that keeps the session open passes `false`.
   */
  readonly closeInputOnResult?: boolean;
}

export interface ResumeSessionParams {
  /** Defaults to `DEFAULT_RESUME_PROMPT`. */
  readonly prompt?: string;
  readonly permissionMode: AllowedPermissionMode;
  readonly cwd: string;
  /** The policy is not persisted in phase 1, so the caller passes it again. */
  readonly policy: ToolPolicy;
  readonly closeInputOnResult?: boolean;
}

/** Resume is retryable, up to this many attempts in total (AC6). */
export const MAX_RESUME_ATTEMPTS = 3;

/** `SessionManagerOptions.stopGraceMs` when unset. */
export const DEFAULT_STOP_GRACE_MS = 2_000;

export const DEFAULT_RESUME_PROMPT = "The kernel restarted. Continue the task from where you left off.";

export interface SessionHandle {
  /** `sessions.id`. */
  readonly id: number;
  readonly sdkSessionId: string;
  /** The process group id, when the spawn ran synchronously inside `query()` (it does with the real SDK). */
  readonly pgid: number | undefined;
  /**
   * Settles with the terminal status. Never rejects. `failed` with reason
   * `kill_incomplete` when the kernel could not confirm the group gone.
   * A resume whose retry attempt was refused admission (item 06) settles with
   * `interrupted`: nothing was launched and the session stays resumable.
   */
  readonly done: Promise<SessionStatus>;
}

export type SessionErrorCode =
  | "invalid_params"
  | "forbidden_permission_mode"
  | "loomwright_not_found"
  | "not_resumable"
  | "not_found"
  | "not_live"
  | "admission_refused";

/** A session request the kernel refused. `code` is stable; the message is for humans. */
export class SessionError extends Error {
  readonly code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string) {
    super(message);
    this.name = "SessionError";
    this.code = code;
  }
}

/** What a session is about to do when admission is asked: begin new work, or continue existing work. */
export type AdmissionKind = "start" | "resume";

/**
 * What the manager asks its `admission` check before a start or resume. Built
 * from the start params (or, for a resume, the stored row) and the auth
 * provider's account: there is one provider, so a refusal never makes the
 * kernel try another (no rotation, D28).
 */
export interface AdmissionRequest {
  readonly kind: AdmissionKind;
  /** Nullable because `sessions.agent` is: a resume of a row with no agent. */
  readonly agent: string | null;
  readonly account: string;
  readonly task: number | null;
}

/** Why admission refused: the account is parked at its cap, or the agent reached its daily token limit. */
export type AdmissionRefusalReason = "cap_parked" | "agent_daily_limit";

/**
 * The admission verdict. A refusal carries when to try again (ISO-8601), or
 * `null` when the reset time is unknown.
 */
export type AdmissionDecision =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: AdmissionRefusalReason; readonly retryAt: string | null };

/**
 * Admission refused a start or resume (budget or cap, item 06). Thrown before
 * any row, status change or spawn; the caller parks the work until `retryAt`.
 */
export class AdmissionRefusedError extends SessionError {
  readonly reason: AdmissionRefusalReason;
  readonly retryAt: string | null;

  constructor(reason: AdmissionRefusalReason, retryAt: string | null, message: string) {
    super("admission_refused", message);
    this.name = "AdmissionRefusedError";
    this.reason = reason;
    this.retryAt = retryAt;
  }
}

/** One `sessions` row as stored. */
export interface SessionRow {
  readonly id: number;
  readonly agent: string | null;
  readonly task_id: number | null;
  readonly sdk_session_id: string | null;
  readonly status: string;
  readonly model: string | null;
  readonly pgid: number | null;
  readonly auth_account: string | null;
  readonly loomwright_path: string | null;
  /**
   * The group leader's start time (ISO-8601, 1 s resolution) read with `ps`
   * just after `pgid` was written; `null` when it could not be read (or the
   * kernel died before it was). The reaper kills a live group only when its
   * leader still has this start time (migration 4); with `null` a live group
   * is left alone and the row `orphaned`.
   */
  readonly leader_started_at: string | null;
  /**
   * When a live kernel's kill of the recorded group last gave up or errored
   * (ISO-8601), or `null`. While set on a terminal row, every `reapOrphans`
   * retries the kill (migration 5); cleared once the group is confirmed gone
   * or proven foreign, and whenever a new group is recorded.
   */
  readonly kill_incomplete_at: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly updated_at: string;
}

/**
 * Process `pgid` as `ps` reports it. `absent` only when `ps` positively said
 * there is no such process; a failed `ps` throws instead (see `readGroupLeader`).
 */
export type GroupLeader =
  | { readonly status: "absent" }
  | { readonly status: "present"; readonly command: string; readonly startedAtMs: number };

/** What `spawnClaudeCodeProcess` receives from the kernel besides the SDK's own options. */
export interface SpawnHooks {
  /** Called synchronously with the new group's id (the leader's pid), right after the spawn. */
  readonly onSpawn?: (pgid: number) => void;
  /** Receives everything the child writes to stderr. The spawner drains stderr either way. */
  readonly stderrTail?: StderrSink;
}

/** Where the spawner copies the child's stderr. */
export interface StderrSink {
  append(chunk: Buffer | string): void;
}

export type SpawnFn = (options: SpawnOptions, hooks: SpawnHooks) => SpawnedProcess;

/**
 * The part of the SDK's `Query` the manager uses. The real `query()` returns a
 * `Query`, which satisfies this; tests pass a fake.
 */
export interface QueryHandle extends AsyncIterable<SDKMessage> {
  close(): void;
}

export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => QueryHandle;

/** Cancel a scheduled callback. */
export type CancelTimer = () => void;

/** Every side effect the manager has, injectable for tests. */
export interface SessionManagerDeps {
  /** Defaults to the SDK's `query`. */
  readonly query?: QueryFn;
  /** Defaults to `spawnInNewProcessGroup`. */
  readonly spawn?: SpawnFn;
  /** Defaults to `killProcessGroup`: `true` when signalled, `false` when the group is already gone. */
  readonly killGroup?: (pgid: number, signal: NodeJS.Signals) => boolean;
  /** Defaults to `isProcessGroupAlive`. */
  readonly isGroupAlive?: (pgid: number) => boolean;
  /** Defaults to `readGroupLeader`: throws when `ps` failed, never reports that as `absent`. */
  readonly readGroupLeader?: (pgid: number) => GroupLeader;
  /** Resume backoff. Defaults to a real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Bounded waits, the kill-until-gone rounds and the auth kill timer. Defaults to `setTimeout`/`clearTimeout`. */
  readonly schedule?: (fn: () => void, ms: number) => CancelTimer;
  /** Defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** Defaults to `node:crypto` `randomUUID`. */
  readonly randomUUID?: () => string;
}

export interface SessionManagerOptions {
  readonly store: Store;
  readonly authProvider: AuthProvider;
  /** The configured Loomwright plugin dir. When unset, the newest valid cached install is used. */
  readonly loomwrightPath?: string;
  /** Defaults to `~/.claude/plugins/cache/atelier/loomwright`. */
  readonly pluginCacheRoot?: string;
  /** The environment the auth provider builds the child's from. Defaults to `process.env`. */
  readonly baseEnv?: BaseEnv;
  /** How long `stopSession` waits after closing the input before killing the group. Default `DEFAULT_STOP_GRACE_MS` (2 000 ms). */
  readonly stopGraceMs?: number;
  /** After the first auth-failure signal, the group is killed within this long. Default 30 000 ms. */
  readonly authTimeoutMs?: number;
  /**
   * Backoff before each resume retry: attempt `n + 1` waits `resumeBackoffMs[n - 1]`.
   * Default `[1_000, 2_000, 4_000]`; with at most `MAX_RESUME_ATTEMPTS` (3) attempts
   * only the first two delays are used.
   */
  readonly resumeBackoffMs?: readonly number[];
  /**
   * Called for every SDK message of every session. An observer that throws is
   * recorded as an `observer_error` event and never breaks the session.
   */
  readonly onMessage?: (sessionId: number, message: SDKMessage) => void;
  /**
   * Asked before every start and resume, after the request is validated and
   * before anything else happens (no auth env, row, status change or spawn).
   * A refusal throws `AdmissionRefusedError`; a check that throws fails the
   * request closed with its own error. Asked again (as a `resume`) before each
   * retry attempt of a resume, where a refusal or a throw returns the session
   * to `interrupted` instead of launching. Absent: every request is admitted.
   */
  readonly admission?: (request: AdmissionRequest) => AdmissionDecision;
  /**
   * The in-process MCP servers a session gets (item 07: the `kernel` server).
   * Called once per launch attempt, never once per start or resume: a resume
   * retries launches, and an SDK server instance holds a live connection that
   * cannot be reused, so every `query()` gets fresh servers. The result is
   * passed as `options.mcpServers`. Absent: no `mcpServers` option at all.
   * Tool gating is unchanged: the `PreToolUse` gate and the session's
   * `ToolPolicy` (which lists e.g. `mcp__kernel__kernel_task_create`).
   */
  readonly mcpServers?: (ctx: McpServersContext) => Record<string, McpServerConfig>;
}

/** What the `mcpServers` factory is told about the launch it builds servers for. */
export interface McpServersContext {
  /** The `sessions` row id (kept by a resume). */
  readonly sessionId: number;
  readonly agent: string | null;
  readonly task: number | null;
}
