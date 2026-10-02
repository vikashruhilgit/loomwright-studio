import type { Migration } from "./types.js";

/**
 * When a live kernel's kill of a session's process group gave up at its
 * deadline or errored, so the group may still be alive. The row is often
 * terminal by then (`failed`/`kill_incomplete`, or `failed:auth`), which the
 * orphan reaper never selects; while this is set, every `reapOrphans` retries
 * the kill without changing the status, and clears it once the group is gone
 * or proven foreign (PR #13 review). Nullable: unset means no kill is pending.
 */
export const sessionKillIncompleteAt: Migration = {
  version: 5,
  name: "session_kill_incomplete_at",
  up: "ALTER TABLE sessions ADD COLUMN kill_incomplete_at TEXT;",
};
