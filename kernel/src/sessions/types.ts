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
import type { UsageTotals } from "../budget/types.js";
import type { Store } from "../store/store.js";
import type { NeverCategory } from "./policy.js";

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
 * - `abandoned`: an `orphaned` row whose latest orphaning reason was
 *   `leader_unverified`, released by the owner (`abandonSession`). Terminal:
 *   the kernel never resumes it, re-examines it or signals its group (it
 *   cannot tell that group from a foreign one).
 */
export type SessionStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "failed:auth"
  | "stopped"
  | "interrupted"
  | "orphaned"
  | "abandoned";

/** The statuses a session never leaves (`interrupted` and `orphaned` are left only by a reap, an explicit resume or, for `orphaned`, an abandon). */
export const TERMINAL_STATUSES: readonly SessionStatus[] = ["completed", "failed", "failed:auth", "stopped", "abandoned"];

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
 *   shell control or substitution character (see `policy.ts`). That stops
 *   chaining (`echo hi; rm x`), NOT a program that runs other programs:
 *   allowing one grants arbitrary execution through its own arguments, for
 *   example `find` (`-exec`), `xargs`, `env`, `git` (aliases, `-c`, hooks),
 *   `npx`, `npm` (scripts), `sed` (`e`/`w`), `awk` (`system()`), `sh` and
 *   `bash`. The kernel adds no blocklist: which programs a session may run
 *   is the user's policy (invariant 1), and allowing one of these is a
 *   decision to allow anything it can run.
 *
 * Held in kernel memory, frozen at session start; the brain has no path to it
 * (invariant 3). Not persisted in phase 1: a resume passes it again.
 */
export interface ToolPolicy {
  readonly allowedTools: readonly string[];
  readonly allowedBashPrefixes: readonly string[];
  /**
   * The outward categories this session never takes (`NEVER_CATEGORIES` in
   * `policy.ts`), set by the owner per crew member (invariant 1). Optional:
   * absent means no boundary. A call in one is denied (`agent_boundary`),
   * never held; the matching is phase 4 item 03's `boundaryDecision`.
   */
  readonly never?: readonly NeverCategory[];
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
  /**
   * The playbook this session runs for (`playbooks.id`, migration 13), recorded
   * on its row as `sessions.playbook`. A positive integer naming an existing
   * playbook; absent for a session that is not a playbook's (the row reads null).
   */
  readonly playbook?: number;
  /** The playbook version it runs, recorded as `sessions.playbook_version`. A positive integer; absent ⇒ null. */
  readonly playbookVersion?: number;
  /**
   * A dry run (`docs/architecture/dry-run.md`): the gate runs only read-only
   * calls (`sessions/dry-run.ts`), denies every other call the policy and the
   * rail would let through with reason `dry_run` and records it as a would-do
   * entry, and `SessionHandle.dryRun` resolves to the report. It only narrows
   * the policy and the rail: never an approval, never a grant consumed. Recorded
   * as one `session_dry_run` event, so every resume of the session is a dry run
   * too. A boolean when given; absent or `false` ⇒ a real run.
   */
  readonly dryRun?: boolean;
}

export interface ResumeSessionParams {
  /** Defaults to `DEFAULT_RESUME_PROMPT`. */
  readonly prompt?: string;
  readonly permissionMode: AllowedPermissionMode;
  readonly cwd: string;
  /** The policy is not persisted in phase 1, so the caller passes it again. */
  readonly policy: ToolPolicy;
  readonly closeInputOnResult?: boolean;
  /**
   * Written to the row's `sessions.playbook` / `sessions.playbook_version` when
   * given (same rules as `StartSessionParams`), once the resume goes ahead; an
   * absent one leaves the row's value unchanged.
   */
  readonly playbook?: number;
  readonly playbookVersion?: number;
  /**
   * Resume as a dry run (same meaning as `StartSessionParams.dryRun`). A dry
   * run only narrows, so a session that STARTED as a dry run (its
   * `session_dry_run` event) resumes as one whatever this says; `true` makes
   * this resume of a real session a dry run too (that resume only).
   */
  readonly dryRun?: boolean;
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
  /**
   * Settles when `done` settles. Never rejects. The `result` text of the
   * session's last successful `result` message (`subtype` `success`, not
   * `is_error`) from its last attempt, when the session ended `completed`;
   * `null` for any other terminal status (failed, stopped, interrupted, …) or
   * when no successful result came. Held in memory only: nothing is persisted.
   */
  readonly result: Promise<string | null>;
  /**
   * Settles when `done` settles. Never rejects. The dry-run report for a
   * dry-run session (`StartSessionParams.dryRun`, or a resume that runs as
   * one), `null` for a real run. Held in memory only, per handle: it covers
   * this `startSession`/`resumeSession` call's attempts, so a resume's report
   * starts empty. Always set by `SessionManager`; optional in the type only
   * so a stand-in handle need not carry it.
   */
  readonly dryRun?: Promise<DryRunReport | null>;
}

/**
 * One call a dry-run session would have made, recorded instead of run
 * (`sessions/dry-run.ts` `classifyDryRunCall`). Untrusted data throughout.
 *
 * - `tool`: the tool name.
 * - `input_summary`: the Bash command, or the tool input as JSON, truncated to
 *   `DRY_RUN_INPUT_SUMMARY_CHARS` (500). Data only: never executed or interpolated.
 * - `would`: `held` when a real run would have held it for the owner's
 *   approval (the rail's outward set), `run` when it would have run.
 * - `reason`: always `dry_run`, the reason its `tool_decision` event records.
 * - `action`: for `held`, the rail's approval action (for example `gh pr comment`).
 */
export interface WouldDoEntry {
  readonly tool: string;
  readonly input_summary: string;
  readonly would: "run" | "held";
  readonly reason: "dry_run";
  readonly action?: string;
}

/**
 * What a dry-run session reports when it ends (`SessionHandle.dryRun`).
 *
 * - `wouldDo`: every would-do entry, in call order, from every launch attempt
 *   of this `startSession`/`resumeSession` call. A resume's report starts
 *   empty: entries from before a kernel restart survive only as
 *   `tool_decision` events with reason `dry_run`.
 * - `finalText`: the same text `SessionHandle.result` resolves to.
 * - `usage`: the LAST `result` message's `modelUsage`, normalised per model
 *   as the budget meter reads it (`UsageTotals`). It is the SDK session's
 *   cumulative total, so results are never added together; empty when no
 *   result came. Advisory: the budget meter observes a dry-run session's
 *   messages like any session's and stays the accounting source.
 */
export interface DryRunReport {
  readonly wouldDo: readonly WouldDoEntry[];
  readonly finalText: string | null;
  readonly usage: Readonly<Record<string, UsageTotals>>;
}

export type SessionErrorCode =
  | "invalid_params"
  | "forbidden_permission_mode"
  | "loomwright_not_found"
  /**
   * The Loomwright install's `capabilities.json` contract is missing, unreadable,
   * not JSON, invalid or too old, or its host switch would overwrite an auth
   * variable (D32): refused before anything starts, one `session_refused` event.
   */
  | "loomwright_contract"
  /** The Loomwright install's contract has no `host_switch`, and Studio runs Loomwright only in host mode (D32): refused before anything starts, one `session_refused` event. */
  | "loomwright_no_host_switch"
  | "not_resumable"
  | "not_found"
  | "not_live"
  | "not_abandonable"
  | "admission_refused"
  /** `cwd` is inside a macOS-protected folder (D31, `PROTECTED_LOCATIONS`): refused before anything starts. */
  | "protected_cwd"
  /**
   * A resume's `cwd` resolves (`resolvedPath`) to another folder than the one
   * recorded on the session's row (`sessions.cwd`, migration 15): refused
   * before admission, auth or any spawn, one `session_refused` event, the row
   * unchanged. A row with no recorded cwd (from before migration 15) is never
   * compared.
   */
  | "cwd_changed";

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
 * provider: there is one provider, so a refusal never makes the kernel try
 * another (no rotation, D28).
 */
export interface AdmissionRequest {
  readonly kind: AdmissionKind;
  /** Nullable because `sessions.agent` is: a resume of a row with no agent. */
  readonly agent: string | null;
  /** The auth provider's live account label: display text only, never a key. */
  readonly account: string;
  /** The auth provider's stable `id`: the key admission checks parks on. */
  readonly provider: string;
  readonly task: number | null;
  /**
   * The playbook the session runs for (`sessions.playbook`, a positive id): on
   * a start its `StartSessionParams.playbook`, on a resume and on every resume
   * retry the playbook it resumes for. The manager sets the key only for a
   * playbook's session and leaves it out otherwise, so a request that is not a
   * playbook's keeps exactly the five fields above. `null` reads as absent; it
   * is allowed so the playbook gate's request (`PlaybookAdmissionRequest`,
   * `playbook: number | null`) extends this one.
   */
  readonly playbook?: number | null;
  /**
   * The id of the session a `resume` request resumes (on the resume and on
   * every resume retry); absent on a `start`. Admission leaves that session's
   * own row out of the agent's live-session count, so a session's own retry
   * (its row `starting`) or the resume of its own `orphaned` row never
   * refuses itself on `sessions_at_once`. A `resume` without it counts every
   * live row (fail closed).
   */
  readonly session?: number;
}

/**
 * Why admission refused: the account is parked at its cap, the agent reached
 * its daily token limit or its sessions-at-once limit, the agent's settings
 * file is invalid or missing (its limits cannot be read, so it is refused
 * rather than read as unlimited), the session's playbook reached its own
 * daily token limit (`token_limit_per_day`), or the owner paused new work
 * (`paused`, the kernel's check before the budget's; `retryAt` is `null`).
 */
export type AdmissionRefusalReason =
  | "cap_parked"
  | "agent_daily_limit"
  | "agent_sessions_at_once"
  | "settings_invalid"
  | "settings_missing"
  | "playbook_daily_limit"
  | "paused";

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
   * after `pgid` was written (asynchronously: it lands a moment later); `null`
   * when it could not be read (or the kernel died before it was). The reaper kills a live group only when its
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
  /** The playbook the session runs for (`playbooks.id`, migration 13), or `null` for a session that is not a playbook's. */
  readonly playbook: number | null;
  /** The playbook version it runs, or `null`. */
  readonly playbook_version: number | null;
  /**
   * The session's working directory as a realpath (`resolvedPath`: symlinks
   * resolved as far as it exists, a `/System/Volumes/Data` prefix removed),
   * written by the insert that creates the row (migration 15); `null` for a
   * row from before migration 15. The SDK gets the cwd as given; only this
   * record is resolved.
   */
  readonly cwd: string | null;
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

/** One process in a `snapshotProcessTable` snapshot (`ps -A`). */
export interface ProcessEntry {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  /** From `lstart` (1 s resolution, read with `TZ=UTC`). */
  readonly startedAtMs: number;
  /** `comm`: the full executable path on macOS, a name of at most 15 characters on Linux procps. */
  readonly command: string;
}

/** Every process on the host at one instant. */
export type ProcessTable = readonly ProcessEntry[];

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
  /**
   * The leader probe at spawn, which must not block the event loop. Defaults
   * to `readGroupLeaderAsync`, or, when only `readGroupLeader` is injected, to
   * that function wrapped in a promise (so a fake never reaches the real `ps`).
   * Rejects when `ps` failed, never resolves that as `absent`.
   */
  readonly readGroupLeaderAsync?: (pgid: number) => Promise<GroupLeader>;
  /**
   * One `ps -A` snapshot of every process, without blocking the event loop:
   * the tool-group poll and the reaper walk the CLI's descendants in it
   * (H08). Rejects when `ps` failed. Defaults to `snapshotProcessTable`, or,
   * when `readGroupLeader` is injected without it, to nothing at all: no poll
   * runs and no descendant is ever recorded (a fake never reaches the real
   * `ps`, and a test that does not ask for the poll gets no timer).
   */
  readonly snapshotProcesses?: () => Promise<ProcessTable>;
  /** Resume backoff. Defaults to a real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Bounded waits, the kill-until-gone rounds and the auth kill timer. Defaults to `setTimeout`/`clearTimeout`. */
  readonly schedule?: (fn: () => void, ms: number) => CancelTimer;
  /** Defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** Defaults to `node:crypto` `randomUUID`. */
  readonly randomUUID?: () => string;
  /** The home dir `PROTECTED_LOCATIONS` are under (D31, the `protected_cwd` refusal). Defaults to `os.homedir()`. */
  readonly homeDir?: string;
}

export interface SessionManagerOptions {
  readonly store: Store;
  readonly authProvider: AuthProvider;
  /**
   * The configured Loomwright plugin dir. When set (non-empty) it wins, and it
   * must hold a valid `capabilities.json`; when unset, the active install named
   * by `installed_plugins.json` is used (D32). The plugin cache is never scanned.
   */
  readonly loomwrightPath?: string;
  /** Claude Code's record of installed plugins. Defaults to `~/.claude/plugins/installed_plugins.json`. */
  readonly installedPluginsPath?: string;
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
   * The session output observer (phase 5: the console's `recordSessionOutput`),
   * called for every SDK message of every session, right after `onMessage`.
   * An observer that throws is recorded as an `observer_error` event (its
   * payload names `observer: "onOutput"`) and never breaks the session; one
   * observer's throw never skips the other.
   */
  readonly onOutput?: (sessionId: number, message: SDKMessage) => void;
  /**
   * Asked before every start and resume, after the request is validated and
   * before anything else happens (no auth env, row, status change or spawn).
   * A refusal throws `AdmissionRefusedError`; a check that throws fails the
   * request closed with its own error. Asked again (as a `resume`) before each
   * retry attempt of a resume, where a refusal or a throw returns the session
   * to `interrupted` instead of launching. A playbook's session's request
   * names its playbook (`AdmissionRequest.playbook`); any other request
   * carries no `playbook` key. Absent: every request is admitted.
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
  /**
   * The pre-hold check for a call to a tool in `ALWAYS_HELD_TOOLS` (phase 3
   * item 07, `docs/architecture/approvals.md`). Asked by the gate only after
   * the policy allowed the call and the rail answered `outward`, before the
   * hold, and never in a dry-run session. It can only narrow: `refuse` denies
   * the call (`held_refused`, no approval, no grant consumed), `display` holds
   * it as today with that text on the `approval_requested` event, `undefined`
   * holds it as today. A throw, or any other answer, denies it
   * `kernel_gate_error`. Absent: every such call is held as today.
   */
  readonly heldToolCheck?: HeldToolCheck;
}

/**
 * A pre-hold check's answer: refuse the call (the text is what the model
 * sees), or hold it with `display` for the owner (and the version the held
 * call is about, when it has one).
 */
export type HeldToolVerdict = { readonly refuse: string } | { readonly display: string; readonly subjectVersion?: number };

/** `SessionManagerOptions.heldToolCheck`: synchronous, reads the store only. `undefined`: the tool declares no check. */
export type HeldToolCheck = (toolName: string, input: unknown, sessionId: number) => HeldToolVerdict | undefined;

/** What the `mcpServers` factory is told about the launch it builds servers for. */
export interface McpServersContext {
  /** The `sessions` row id (kept by a resume). */
  readonly sessionId: number;
  readonly agent: string | null;
  readonly task: number | null;
}
