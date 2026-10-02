import type { Migration } from "./types.js";

// ISO-8601 UTC text, millisecond precision.
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

/**
 * The event loop and kernel tools (item 07):
 *
 * - `event_queue`: the durable queue the loop processes in id order. `events`
 *   is append-only (migration 1), so an event's processing state cannot live
 *   there: each queue row's transitions are audited in `events` instead.
 *   `status` is `pending` until its handler's effects are committed, then
 *   `done`; a handler that throws leaves it `failed` (`attempts`,
 *   `last_error`). `not_before` parks a row (an admission refusal) until that
 *   time. `source_ref` is the dedupe anchor for rows the kernel derives from
 *   something else (`wakeup:<id>`); user messages leave it null. `kind` is
 *   checked in code, not here, so a later phase adds kinds without a rebuild.
 * - `work_steps.failure_reason`: why a step is `failed` (`interrupted`: a
 *   crash left it `started` and it was not declared re-runnable; `error`: its
 *   work threw). The status CHECK is untouched; the API reports
 *   `failed:<reason>`.
 * - `work_steps.rerunnable`: whether the step was declared re-runnable (its
 *   effect is idempotent) when it was started.
 */
export const eventLoop: Migration = {
  version: 7,
  name: "event_loop",
  up: `
CREATE TABLE event_queue (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_ref   TEXT UNIQUE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  not_before   TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  task_id      INTEGER,
  session_id   INTEGER,
  enqueued_at  TEXT NOT NULL DEFAULT ${NOW},
  done_at      TEXT
);

CREATE INDEX event_queue_status_id ON event_queue (status, id);

ALTER TABLE work_steps ADD COLUMN failure_reason TEXT;
ALTER TABLE work_steps ADD COLUMN rerunnable INTEGER NOT NULL DEFAULT 0;
`,
};
