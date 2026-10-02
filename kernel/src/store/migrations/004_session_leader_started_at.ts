import type { Migration } from "./types.js";

/**
 * The start time of each session's process-group leader, recorded with its
 * pgid, so the boot-time reaper can tell the session's own CLI from an
 * unrelated process that later reused the pgid (item 05 review). Nullable:
 * rows written before this migration, or whose start time could not be read,
 * are never killed by the reaper.
 */
export const sessionLeaderStartedAt: Migration = {
  version: 4,
  name: "session_leader_started_at",
  up: "ALTER TABLE sessions ADD COLUMN leader_started_at TEXT;",
};
