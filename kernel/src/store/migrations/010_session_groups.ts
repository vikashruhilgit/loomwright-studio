import type { Migration } from "./types.js";

/**
 * `session_groups`: every process group a session's tools started outside the
 * CLI's own group (H08). The Bash tool runs its command in a new session and
 * group, so `kill(-pgid)` of the CLI's group leaves it running; the session
 * manager records each such group while the CLI runs, and kills it, after an
 * ownership check, whenever it kills the CLI's group (stop, kill switch,
 * natural end, crash cleanup, reaper).
 *
 * - `pgid`, `leader_command`, `leader_started_at`: the group and its leader's
 *   identity (`ps` `comm` and `lstart` as ISO-8601) when first seen. A
 *   recorded group is signalled only while its leader still has both, so a
 *   pgid reused by an unrelated process is never signalled.
 * - `first_seen`: when the poll first saw it.
 * - `kill_incomplete_at`: a kill of this group gave up at its deadline or
 *   errored, or `ps` failed so its ownership could not be checked: every
 *   `reapOrphans` retries it, whatever the session's status (except
 *   `abandoned`). Per group, never the session row's own flag, which is keyed
 *   on the CLI's pgid.
 * - `resolved_at` / `resolution`: the group was confirmed gone (`killed`,
 *   `group_gone`) or proven not the session's (`leader_gone`,
 *   `command_differs`, `start_differs`); it is never examined or signalled
 *   again.
 *
 * Safe to re-run (`IF NOT EXISTS`): the store's integrity check re-runs the top
 * migrations when their `schema_migrations` rows were deleted.
 */
export const sessionGroups: Migration = {
  version: 10,
  name: "session_groups",
  up: `
CREATE TABLE IF NOT EXISTS session_groups (
  session_id         INTEGER NOT NULL REFERENCES sessions(id),
  pgid               INTEGER NOT NULL,
  leader_command     TEXT NOT NULL,
  leader_started_at  TEXT NOT NULL,
  first_seen         TEXT NOT NULL,
  kill_incomplete_at TEXT,
  resolved_at        TEXT,
  resolution         TEXT,
  PRIMARY KEY (session_id, pgid, leader_started_at)
);
CREATE INDEX IF NOT EXISTS session_groups_pending ON session_groups (session_id) WHERE resolved_at IS NULL;
`,
};
