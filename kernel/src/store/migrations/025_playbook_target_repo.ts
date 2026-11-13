import type Database from "better-sqlite3";
import type { Migration } from "./types.js";

/** The columns migration 25 adds to existing tables, in the order it adds them. */
const COLUMNS: ReadonlyArray<{ readonly table: string; readonly column: string; readonly definition: string }> = [{ table: "playbooks", column: "target_repo", definition: "TEXT" }];

/**
 * The repository a playbook's work goes to (phase 8 item 20h):
 * `playbooks.target_repo` is one `owner/name`, checked in code
 * (`src/playbooks/target-repo.ts`) with no SQL CHECK. A ClickUp or Jira ticket
 * poll names no repository, so the playbook carries it: the enable refuses a
 * ticket playbook without one (`no_target_repo`) or with one the GitHub App
 * does not reach (`target_repo_not_reachable`), and a live session's GitHub
 * token is minted for it (`playbookRepos`, `src/sessions/github-session-auth.ts`).
 * A change field like `name`, `intent` and `jobs` (migration 23), not a policy
 * field: it has no `*_set_by` column. Nullable, no default: null is "names no
 * repository", so a row from before this migration reads null and the kernel
 * never backfills it (invariant 1).
 *
 * Does not touch `events` or its triggers. Creates no SQL trigger: the
 * integrity check refuses any trigger the kernel does not list. Safe to
 * re-run: `up` adds the column only when `PRAGMA table_info` does not already
 * list it (the pattern of migrations 15, 17, 18, 19, 21 and 23).
 */
export const playbookTargetRepo: Migration = {
  version: 25,
  name: "playbook_target_repo",
  up: (db: Database.Database) => {
    const existing = db.prepare<[string], string>("SELECT name FROM pragma_table_info(?)").pluck();
    for (const { table, column, definition } of COLUMNS) {
      if (existing.all(table).includes(column)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  },
};
