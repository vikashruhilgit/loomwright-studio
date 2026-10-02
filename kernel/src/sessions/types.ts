import type { PermissionMode, SDKMessage, SDKUserMessage, Options, SpawnOptions, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import type { AuthProvider, BaseEnv } from "../auth/types.js";
import type { Store } from "../store/store.js";

/**
 * A session row's `status`. `failed:auth` is its own status so an auth failure
 * parks the session instead of being retried like an ordinary failure (AC7).
 */
export type SessionStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "failed:auth"
  | "stopped"
  | "interrupted";

/** The statuses a session never leaves (`interrupted` is left only by an explicit resume). */
export const TERMINAL_STATUSES: readonly SessionStatus[] = ["completed", "failed", "failed:auth", "stopped"];

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * The per-session tool policy the kernel's `PreToolUse` gate enforces. Deny by
 * default: a tool runs only when this policy allows it.
 *
 * - `allowedTools`: exact tool names (for example `Read`, `mcp__studio__kernel_record_task`).
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

export const DEFAULT_RESUME_PROMPT = "The kernel restarted. Continue the task from where you left off.";

export interface SessionHandle {
  /** `sessions.id`. */
  readonly id: number;
  readonly sdkSessionId: string;
  /** The process group id, when the spawn ran synchronously inside `query()` (it does with the real SDK). */
  readonly pgid: number | undefined;
  /** Settles with the terminal status. Never rejects. */
  readonly done: Promise<SessionStatus>;
}

export type SessionErrorCode =
  | "invalid_params"
  | "forbidden_permission_mode"
  | "loomwright_not_found"
  | "not_resumable"
  | "not_found"
  | "not_live";

/** A session request the kernel refused. `code` is stable; the message is for humans. */
export class SessionError extends Error {
  readonly code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string) {
    super(message);
    this.name = "SessionError";
    this.code = code;
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
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly updated_at: string;
}

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
  /** Defaults to `readGroupLeaderCommand`. */
  readonly readGroupLeaderCommand?: (pgid: number) => string | undefined;
  /** Resume backoff. Defaults to a real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Bounded waits and the auth kill timer. Defaults to `setTimeout`/`clearTimeout`. */
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
  /** How long `stopSession` waits after closing the input before killing the group. Default 2 000 ms. */
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
}
