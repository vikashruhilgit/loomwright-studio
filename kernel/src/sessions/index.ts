// Public surface of the session layer (item 05).
export { SessionManager } from "./manager.js";
export type { ReapResult, StopAllOutcome } from "./manager.js";
export { decideToolUse, freezePolicy } from "./policy.js";
export type { ToolDecision, ToolDecisionReason } from "./policy.js";
export {
  KILL_GROUP_DEADLINE_MS,
  KILL_GROUP_INTERVAL_MS,
  LeaderProbeError,
  STDERR_TAIL_BYTES,
  StderrTail,
  isProcessGroupAlive,
  isValidPgid,
  killGroupUntilGone,
  killProcessGroup,
  leaderBasename,
  parseLeaderLine,
  readGroupLeader,
  spawnInNewProcessGroup,
} from "./spawner.js";
export type { KillGroupUntilGoneOptions } from "./spawner.js";
export { defaultPluginCacheRoot, resolveLoomwrightPath } from "./loomwright-path.js";
export type { ResolveLoomwrightPathOptions } from "./loomwright-path.js";
export {
  AdmissionRefusedError,
  DEFAULT_RESUME_PROMPT,
  MAX_RESUME_ATTEMPTS,
  SessionError,
  TERMINAL_STATUSES,
  isTerminalStatus,
} from "./types.js";
export type {
  AdmissionDecision,
  AdmissionKind,
  AdmissionRefusalReason,
  AdmissionRequest,
  AllowedPermissionMode,
  CancelTimer,
  GroupLeader,
  McpServersContext,
  QueryFn,
  QueryHandle,
  ResumeSessionParams,
  SessionErrorCode,
  SessionHandle,
  SessionManagerDeps,
  SessionManagerOptions,
  SessionRow,
  SessionStatus,
  SpawnFn,
  SpawnHooks,
  StartSessionParams,
  StderrSink,
  ToolPolicy,
} from "./types.js";
