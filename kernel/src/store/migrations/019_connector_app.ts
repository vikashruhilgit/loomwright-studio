import type Database from "better-sqlite3";
import type { Migration } from "./types.js";

/** The columns migration 19 adds to existing tables, in the order it adds them. */
const COLUMNS: ReadonlyArray<{ readonly table: string; readonly column: string; readonly definition: string }> = [
  { table: "connectors", column: "method", definition: "TEXT" },
  { table: "connectors", column: "app_slug", definition: "TEXT" },
  { table: "connectors", column: "installation_id", definition: "INTEGER" },
];

/**
 * How a connector is connected through the GitHub App (D36): `connectors.method`
 * is `token` (a token the owner pasted) or `app` (a GitHub App Studio created
 * and installed), one of `CONNECTOR_METHODS` (`src/integrations/types.ts`),
 * closed in code with no SQL CHECK. `connectors.app_slug` is the App's slug and
 * `connectors.installation_id` its installation's id, both set only for
 * `method: app`. Nullable, no default: a row from before this migration reads
 * null for all three (the kernel reads a null method as `token` and never
 * backfills it). None of them is a secret: the App's key and its installation
 * tokens live only in the Keychain and in memory.
 *
 * Does not touch `events` or its triggers. Creates no SQL trigger: the
 * integrity check refuses any trigger the kernel does not list. Safe to
 * re-run: `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` and fails on a
 * re-run ("duplicate column name"), so `up` adds each column only when
 * `PRAGMA table_info` does not already list it (the pattern of migrations 15,
 * 17 and 18).
 */
export const connectorApp: Migration = {
  version: 19,
  name: "connector_app",
  up: (db: Database.Database) => {
    const existing = db.prepare<[string], string>("SELECT name FROM pragma_table_info(?)").pluck();
    for (const { table, column, definition } of COLUMNS) {
      if (existing.all(table).includes(column)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  },
};
