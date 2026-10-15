import type { Migration } from "./types.js";

// ISO-8601 UTC text, millisecond precision (same as migration 7).
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

/**
 * `brain_messages`: one row per handled `message` event for an agent the
 * brain owns, keyed on its `event_queue` row (`queue_id`, UNIQUE, so a
 * redelivered event finds its row instead of adding one). The brain feature
 * owns its writes and validates its values: every value set below is closed in
 * code (no SQL CHECK), so a later item adds a value without a table rebuild.
 *
 * - `source`: `ask`, `trigger:<id>`, `approval:<id>` or `message`.
 * - `status`: `queued`, `running`, `replied`, `failed` or `parked`.
 * - `session_id`: the session started (or resumed) for it, null until then.
 * - `reply_text`: the session's final reply; `detail`: a refusal or failure reason.
 *
 * Creates no SQL trigger: the integrity check refuses any trigger the kernel
 * does not list. Safe to re-run (`IF NOT EXISTS`): the store's integrity check
 * re-runs the top migrations when their `schema_migrations` rows were deleted.
 */
export const brainMessages: Migration = {
  version: 12,
  name: "brain_messages",
  up: `
CREATE TABLE IF NOT EXISTS brain_messages (
  id         INTEGER PRIMARY KEY,
  queue_id   INTEGER NOT NULL UNIQUE REFERENCES event_queue(id),
  agent      TEXT NOT NULL,
  source     TEXT NOT NULL,
  text       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued',
  session_id INTEGER REFERENCES sessions(id),
  reply_text TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
`,
};
