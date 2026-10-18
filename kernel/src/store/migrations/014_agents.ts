import type Database from "better-sqlite3";
import type { Migration } from "./types.js";

// ISO-8601 UTC text, millisecond precision (same as migrations 7, 11, 12 and 13).
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

const TABLES = `
CREATE TABLE IF NOT EXISTS agents (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_shape TEXT NOT NULL,
  avatar_hue   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  created_by   TEXT NOT NULL,
  approval_id  INTEGER REFERENCES approvals(id),
  charter_json TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT ${NOW},
  updated_at   TEXT NOT NULL DEFAULT ${NOW}
);
`;

/** The columns migration 14 adds to existing tables, in the order it adds them. */
const COLUMNS: ReadonlyArray<{ readonly table: string; readonly column: string; readonly definition: string }> = [
  { table: "brain_messages", column: "from_agent", definition: "TEXT" },
  { table: "brain_messages", column: "depth", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "brain_messages", column: "reply_to", definition: "INTEGER REFERENCES brain_messages(id)" },
  { table: "brain_messages", column: "workspace", definition: "TEXT" },
];

/**
 * The phase 4 agent registry and the columns that tie a brain message to the
 * agent that sent it. The agents feature owns their writes and validates their
 * values: every value set below is closed in code (no SQL CHECK), so a later
 * item adds a value without a table rebuild.
 *
 * - `agents`: one row per crew member, keyed on its id (never reused, even
 *   after `off`). `status` is `active` or `off`; `created_by` is `owner` or
 *   `wright`; `avatar_shape` / `avatar_hue` come from the closed lists in
 *   `src/agents/types.ts`; `approval_id` is the approval that created it, null
 *   for an owner-made row; `charter_json` is the charter the owner saw. The
 *   enforced settings live in `config/agents/<id>.json`, the charter prose in
 *   `memory/<id>/role.md`.
 * - `brain_messages.from_agent` (the sending agent, null for the owner or a
 *   trigger), `depth` (the delegation depth; SQLite fills every existing row
 *   with `0`), `reply_to` (the message this one answers, null otherwise) and
 *   `workspace` (the folder the work is scoped to, null otherwise).
 *
 * Does not touch `events` or its triggers. Creates no SQL trigger: the
 * integrity check refuses any trigger the kernel does not list. Safe to
 * re-run: the table uses `IF NOT EXISTS`, and since `ALTER TABLE ... ADD
 * COLUMN` has no `IF NOT EXISTS` and fails on a re-run ("duplicate column
 * name"), `up` adds each column only when `PRAGMA table_info` does not already
 * list it. The store's integrity check re-runs the top migrations when their
 * `schema_migrations` rows were deleted.
 */
export const agentRegistry: Migration = {
  version: 14,
  name: "agents",
  up: (db: Database.Database) => {
    db.exec(TABLES);
    const existing = db.prepare<[string], string>("SELECT name FROM pragma_table_info(?)").pluck();
    for (const { table, column, definition } of COLUMNS) {
      if (existing.all(table).includes(column)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  },
};
