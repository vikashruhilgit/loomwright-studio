import type Database from "better-sqlite3";
import type { Migration } from "./types.js";

/** The columns migration 23 adds to existing tables, in the order it adds them. */
const COLUMNS: ReadonlyArray<{ readonly table: string; readonly column: string; readonly definition: string }> = [{ table: "playbooks", column: "jobs_json", definition: "TEXT" }];

/**
 * The jobs a playbook names (phase 8 item 16): `playbooks.jobs_json` is a JSON
 * array of job ids from the kernel's closed job vocabulary (`TOOL_JOBS`,
 * `src/features/catalogue.ts`), checked in code (`src/playbooks/store.ts`)
 * with no SQL CHECK. Wright proposes it from the owner's words; the playbook
 * fit check (`src/playbooks/fit.ts`) reads it against the playbook's crew
 * member's `tool_policy`. A change field like `name` and `intent`, not a
 * policy field: it has no `*_set_by` column. Nullable, no default: null is
 * "names no jobs", so a row from before this migration reads null and the
 * kernel never backfills it (invariant 1).
 *
 * Does not touch `events` or its triggers. Creates no SQL trigger: the
 * integrity check refuses any trigger the kernel does not list. Safe to
 * re-run: `up` adds the column only when `PRAGMA table_info` does not already
 * list it (the pattern of migrations 15, 17, 18, 19 and 21).
 */
export const playbookJobs: Migration = {
  version: 23,
  name: "playbook_jobs",
  up: (db: Database.Database) => {
    const existing = db.prepare<[string], string>("SELECT name FROM pragma_table_info(?)").pluck();
    for (const { table, column, definition } of COLUMNS) {
      if (existing.all(table).includes(column)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  },
};
