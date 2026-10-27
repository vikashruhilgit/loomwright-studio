import type Database from "better-sqlite3";
import type { Migration } from "./types.js";

// ISO-8601 UTC text, millisecond precision (same as migrations 7, 11, 12, 13, 14 and 16).
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

const TABLES = `
CREATE TABLE IF NOT EXISTS connectors (
  id                   INTEGER PRIMARY KEY,
  kind                 TEXT NOT NULL,
  status               TEXT NOT NULL,
  account_login        TEXT,
  permissions_json     TEXT,
  reachable_repos_json TEXT,
  expires_at           TEXT,
  verified_at          TEXT,
  created_at           TEXT NOT NULL DEFAULT ${NOW},
  updated_at           TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS draft_outputs (
  id           INTEGER PRIMARY KEY,
  session      INTEGER NOT NULL REFERENCES sessions(id),
  agent        TEXT NOT NULL,
  playbook     INTEGER REFERENCES playbooks(id),
  playbook_run INTEGER REFERENCES playbook_runs(id),
  item_ref     TEXT,
  tool         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT ${NOW}
);
`;

/** The columns migration 17 adds to existing tables, in the order it adds them. */
const COLUMNS: ReadonlyArray<{ readonly table: string; readonly column: string; readonly definition: string }> = [
  { table: "playbooks", column: "mode", definition: "TEXT NOT NULL DEFAULT 'draft'" },
  { table: "playbooks", column: "mode_set_by", definition: "TEXT" },
  { table: "playbook_runs", column: "item_ref", definition: "TEXT" },
  { table: "playbook_runs", column: "item_revision", definition: "TEXT" },
];

/**
 * The phase 6 foundation schema: the tables and columns every later phase 6
 * item codes against. The integrations and playbooks features own their
 * writes and validate their values: every value set below is closed in code
 * (no SQL CHECK), so a later item adds a value without a table rebuild.
 *
 * - `connectors`: one row per connector. `kind` is one of `CONNECTOR_KINDS`
 *   and `status` one of `CONNECTOR_STATUSES` (`src/integrations/types.ts`).
 *   `account_login`, `permissions_json`, `reachable_repos_json`,
 *   `expires_at` and `verified_at` are what the connector last verified, null
 *   until then. It never holds a secret: a connector's token lives only in the
 *   Keychain.
 * - `draft_outputs`: one row per outward call a draft-mode session recorded
 *   instead of sending: the session, its agent, the playbook and run it
 *   belongs to (null outside a playbook run), the item it was about, the tool
 *   and its (bounded) payload as JSON.
 * - `playbooks.mode`: `draft` or `live` (`PLAYBOOK_MODES`); SQLite fills every
 *   existing row with `'draft'`. `playbooks.mode_set_by`: `wright` or
 *   `owner` like the other `*_set_by` columns, null while unset.
 * - `playbook_runs.item_ref` / `item_revision`: the source item a run is for
 *   (e.g. `github:<owner>/<repo>#<n>` and its head SHA), null for every run
 *   that is not an item's.
 *
 * Does not touch `events` or its triggers. Creates no SQL trigger: the
 * integrity check refuses any trigger the kernel does not list. Safe to
 * re-run: the tables use `IF NOT EXISTS`, and since `ALTER TABLE ... ADD
 * COLUMN` has no `IF NOT EXISTS` and fails on a re-run ("duplicate column
 * name"), `up` adds each column only when `PRAGMA table_info` does not already
 * list it. The store's integrity check re-runs the top migrations when their
 * `schema_migrations` rows were deleted.
 */
export const phase6Foundation: Migration = {
  version: 17,
  name: "phase_6_foundation",
  up: (db: Database.Database) => {
    db.exec(TABLES);
    const existing = db.prepare<[string], string>("SELECT name FROM pragma_table_info(?)").pluck();
    for (const { table, column, definition } of COLUMNS) {
      if (existing.all(table).includes(column)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  },
};
