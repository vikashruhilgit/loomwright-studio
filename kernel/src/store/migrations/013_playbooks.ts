import type Database from "better-sqlite3";
import type { Migration } from "./types.js";

// ISO-8601 UTC text, millisecond precision (same as migrations 7, 11 and 12).
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

const TABLES = `
CREATE TABLE IF NOT EXISTS playbooks (
  id                      INTEGER PRIMARY KEY,
  slug                    TEXT NOT NULL UNIQUE,
  name                    TEXT NOT NULL,
  owning_agent            TEXT NOT NULL,
  intent                  TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'draft',
  version                 INTEGER NOT NULL DEFAULT 1,
  dedupe_key_spec         TEXT,
  dedupe_key_set_by       TEXT,
  priority                TEXT NOT NULL DEFAULT 'normal',
  priority_set_by         TEXT,
  model                   TEXT,
  model_set_by            TEXT,
  effort                  TEXT,
  effort_set_by           TEXT,
  token_limit_per_day     INTEGER,
  token_limit_set_by      TEXT,
  api_key_fallback_json   TEXT,
  api_key_fallback_set_by TEXT,
  created_at              TEXT NOT NULL DEFAULT ${NOW},
  updated_at              TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS playbook_versions (
  playbook      INTEGER NOT NULL REFERENCES playbooks(id),
  version       INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (playbook, version)
);

CREATE TABLE IF NOT EXISTS playbook_runs (
  id          INTEGER PRIMARY KEY,
  playbook    INTEGER NOT NULL REFERENCES playbooks(id),
  version     INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'running',
  session_id  INTEGER REFERENCES sessions(id),
  dedupe_key  TEXT,
  result_json TEXT,
  tokens      INTEGER,
  started_at  TEXT NOT NULL DEFAULT ${NOW},
  ended_at    TEXT
);
CREATE INDEX IF NOT EXISTS playbook_runs_playbook_kind_id ON playbook_runs (playbook, kind, id);
`;

/** The columns migration 13 adds to existing tables, in the order it adds them. */
const COLUMNS: ReadonlyArray<{ readonly table: string; readonly column: string; readonly definition: string }> = [
  { table: "sessions", column: "playbook", definition: "INTEGER REFERENCES playbooks(id)" },
  { table: "sessions", column: "playbook_version", definition: "INTEGER" },
  { table: "approvals", column: "playbook", definition: "INTEGER REFERENCES playbooks(id)" },
  { table: "event_queue", column: "priority", definition: "TEXT NOT NULL DEFAULT 'normal'" },
];

/**
 * The phase 3 playbook tables and the columns that tie existing rows to a
 * playbook. The playbooks feature owns their writes and validates their
 * values: every value set below is closed in code (no SQL CHECK), so a later
 * item adds a value without a table rebuild.
 *
 * - `playbooks`: one row per playbook. `status` is `draft`, `enabled` or
 *   `disabled`; `priority` is `low`, `normal` or `high`; `version` is the
 *   current version. Each policy field (`dedupe_key_spec`, `priority`,
 *   `model`, `effort` (recorded only), `token_limit_per_day`,
 *   `api_key_fallback_json` (the `ApiKeyFallbackPolicy` shape in
 *   `src/budget/types.ts`)) has a `*_set_by` of `wright` or `owner`, null
 *   while the field is unset.
 * - `playbook_versions`: the full playbook row as `snapshot_json`, once per
 *   version, keyed on `(playbook, version)`.
 * - `playbook_runs`: one row per dry run, fire or run-now (`kind` is
 *   `dry_run`, `fire` or `run_now`), with the session it started, its dedupe
 *   key, result and tokens.
 * - `sessions.playbook` / `sessions.playbook_version`, `approvals.playbook`:
 *   null for every row that is not a playbook's. `event_queue.priority`:
 *   SQLite fills every existing row with `'normal'`. `triggers.playbook`
 *   (migration 11, TEXT) is not changed here.
 *
 * Creates no SQL trigger: the integrity check refuses any trigger the kernel
 * does not list. Safe to re-run: the tables and index use `IF NOT EXISTS`, and
 * since `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` and fails on a
 * re-run ("duplicate column name"), `up` adds each column only when
 * `PRAGMA table_info` does not already list it. The store's integrity check
 * re-runs the top migrations when their `schema_migrations` rows were deleted.
 */
export const playbooks: Migration = {
  version: 13,
  name: "playbooks",
  up: (db: Database.Database) => {
    db.exec(TABLES);
    const existing = db.prepare<[string], string>("SELECT name FROM pragma_table_info(?)").pluck();
    for (const { table, column, definition } of COLUMNS) {
      if (existing.all(table).includes(column)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  },
};
