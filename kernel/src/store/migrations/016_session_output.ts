import type { Migration } from "./types.js";

// ISO-8601 UTC text, millisecond precision (same as migrations 7, 11, 12, 13 and 14).
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

/**
 * The phase 5 session output log: what each session said and did, as the
 * kernel recorded it from the SDK's message stream (the console feature's
 * `recordSessionOutput`, `src/console/output.ts`, owns its writes).
 *
 * - `session_output`: one row per recorded message part. `session_id` is the
 *   session it belongs to; `seq` its position in that session's output,
 *   unique per session (`UNIQUE (session_id, seq)`); `kind` one of the closed
 *   `SESSION_OUTPUT_KINDS` (`src/console/output.ts`), validated in code (no
 *   SQL CHECK), so a later item adds a kind without a table rebuild;
 *   `payload_json` the part as JSON; `created_at` when it was recorded.
 *
 * Does not touch `events` or its triggers. Creates no SQL trigger: the
 * integrity check refuses any trigger the kernel does not list. Safe to
 * re-run: the table uses `IF NOT EXISTS` (its unique key is part of the
 * table, so there is no separate index to recreate). The store's integrity
 * check re-runs the top migrations when their `schema_migrations` rows were
 * deleted.
 */
export const sessionOutput: Migration = {
  version: 16,
  name: "session_output",
  up: `
CREATE TABLE IF NOT EXISTS session_output (
  id           INTEGER PRIMARY KEY,
  session_id   INTEGER NOT NULL REFERENCES sessions(id),
  seq          INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (session_id, seq)
);
`,
};
