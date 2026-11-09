import type Database from "better-sqlite3";
import type { Migration } from "./types.js";

// ISO-8601 UTC text, millisecond precision (same as migrations 7, 11, 12, 13, 14, 16, 17 and 20).
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

const TABLES = `
CREATE TABLE IF NOT EXISTS brain_threads (
  id              INTEGER PRIMARY KEY REFERENCES brain_messages(id),
  agent           TEXT NOT NULL,
  title           TEXT,
  summarized_into INTEGER REFERENCES brain_threads(id),
  continued_from  INTEGER REFERENCES brain_threads(id),
  created_at      TEXT NOT NULL DEFAULT ${NOW},
  updated_at      TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS brain_message_threads (
  message_id      INTEGER PRIMARY KEY REFERENCES brain_messages(id),
  thread_id       INTEGER NOT NULL REFERENCES brain_threads(id),
  continues       INTEGER REFERENCES brain_messages(id),
  continuation    TEXT,
  references_json TEXT,
  replay_queue_id INTEGER REFERENCES event_queue(id),
  created_at      TEXT NOT NULL DEFAULT ${NOW},
  updated_at      TEXT NOT NULL DEFAULT ${NOW}
);

CREATE INDEX IF NOT EXISTS brain_message_threads_thread ON brain_message_threads (thread_id, message_id);
`;

/** The columns migration 22 owns, per table, in order: `up` adds any a partial earlier run left out. */
const COLUMNS: ReadonlyArray<{ readonly table: string; readonly column: string; readonly definition: string }> = [
  { table: "brain_threads", column: "title", definition: "TEXT" },
  { table: "brain_threads", column: "summarized_into", definition: "INTEGER REFERENCES brain_threads(id)" },
  { table: "brain_threads", column: "continued_from", definition: "INTEGER REFERENCES brain_threads(id)" },
  { table: "brain_message_threads", column: "continuation", definition: "TEXT" },
  { table: "brain_message_threads", column: "references_json", definition: "TEXT" },
  { table: "brain_message_threads", column: "replay_queue_id", definition: "INTEGER REFERENCES event_queue(id)" },
];

/**
 * Thread continuity (phase 8 item 17b). Thread data lives in its own two
 * tables, so `brain_messages` (migration 12 and 14) and every route that
 * answers its rows stay byte-identical: a message with no thread data has no
 * row here, and its thread is itself (its own id).
 *
 * - `brain_threads`: one row per thread that has more than its first message,
 *   a rename, or a summary link. `id` is the thread's first `brain_messages`
 *   row id (the thread's stable id); `agent` the agent it talks to; `title`
 *   the owner's rename (null until set; a derived title is never stored);
 *   `summarized_into` the thread a start-fresh began from this one's summary
 *   (null until then); `continued_from` the thread this one was started fresh
 *   from (null for any other thread).
 * - `brain_message_threads`: one row per message that carries thread data
 *   (`POST /ask` with `continues` or `references`). `thread_id` is the
 *   thread it belongs to; `continues` the `brain_messages` row it replies
 *   to (null for a thread's first message); `continuation` how its session
 *   continued the thread: `resumed` or `replayed`, null until a session
 *   starts (and for a message that only carries references); `references_json`
 *   the references as sent (`[{thread, use}]`, JSON text) or null;
 *   `replay_queue_id` the one `message` event the handler queued to replay
 *   the thread after a resume found its SDK conversation gone, or null.
 *
 * Every value set is closed in code (`kernel/src/brain/threads.ts`), with no
 * SQL CHECK. Does not touch `events` or its triggers. Creates no SQL trigger:
 * the integrity check refuses any trigger the kernel does not list. Safe to
 * re-run: every table and index uses `IF NOT EXISTS`, and a column is added
 * only when `pragma_table_info` does not list it (the guard of migration 21),
 * so a re-run never fails on "duplicate column name".
 */
export const threadContinuity: Migration = {
  version: 22,
  name: "thread_continuity",
  up: (db: Database.Database) => {
    db.exec(TABLES);
    const existing = db.prepare<[string], string>("SELECT name FROM pragma_table_info(?)").pluck();
    for (const { table, column, definition } of COLUMNS) {
      if (existing.all(table).includes(column)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  },
};
