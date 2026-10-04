import type Database from "better-sqlite3";
import { initial } from "./migrations/001_initial.js";
import { eventsExplicitIdGuard } from "./migrations/008_events_explicit_id_guard.js";
import type { Migration } from "./migrations/index.js";

/**
 * Thrown when opening the store finds the append-only audit log (`events`
 * and its triggers) missing or altered, or a `schema_migrations` record that
 * cannot be trusted. The open writes nothing before refusing.
 */
export class StoreIntegrityError extends Error {
  readonly code = "STORE_INTEGRITY";
  readonly dbPath: string;
  /** One line per problem, each naming the object or record at fault. */
  readonly problems: readonly string[];

  constructor(dbPath: string, problems: readonly string[]) {
    super(`Studio database ${dbPath} failed its integrity check: ${problems.join("; ")}`);
    this.name = "StoreIntegrityError";
    this.dbPath = dbPath;
    this.problems = problems;
  }
}

/**
 * Thrown when `schema_migrations` records a version this kernel does not know
 * (a newer kernel wrote the database). The open migrates and writes nothing.
 */
export class StoreSchemaTooNewError extends Error {
  readonly code = "STORE_SCHEMA_TOO_NEW";
  readonly dbPath: string;
  readonly unknownVersions: readonly number[];
  /** The highest version this kernel's migration list knows. */
  readonly knownVersion: number;

  constructor(dbPath: string, unknownVersions: readonly number[], knownVersion: number) {
    super(
      `Studio database ${dbPath} records schema version ${unknownVersions.join(", ")}, newer than this kernel knows (up to ${knownVersion}); refusing to open it`,
    );
    this.name = "StoreSchemaTooNewError";
    this.dbPath = dbPath;
    this.unknownVersions = unknownVersions;
    this.knownVersion = knownVersion;
  }
}

export interface AppendOnlyObject {
  readonly type: "table" | "trigger";
  readonly name: string;
  /** The exact `sqlite_master.sql` SQLite stores for it (the statement as written, without its `;`). */
  readonly sql: string;
}

/**
 * Per kernel migration, the append-only objects it creates and their exact
 * stored text. A test pins every string against a fresh store.
 *
 * Each object has exactly one expected text: the one its creating migration
 * wrote, checked at every version from that migration on. A future migration
 * that ALTERs or recreates one of these objects (`ALTER TABLE events ADD COLUMN
 * ...` rewrites the table's stored text) therefore cannot be handled by editing
 * a string here: the old text is still what a database awaiting that migration
 * holds, and the new text is what it holds afterwards, so either single text
 * refuses one side of the upgrade. Such a migration must first extend the
 * check itself to expect per-version text (the text as of the version the
 * database has reached), and the v7 -> v8 upgrade test pattern in
 * `test/store.test.ts` must cover it (a database at the previous version opens
 * and migrates, and one at the new version reopens).
 */
export const APPEND_ONLY_OBJECTS: ReadonlyArray<{
  readonly migration: Migration;
  readonly objects: readonly AppendOnlyObject[];
}> = [
  {
    migration: initial,
    objects: [
      {
        type: "table",
        name: "events",
        sql: `CREATE TABLE events (
  id           INTEGER PRIMARY KEY CHECK (id > 0),
  at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  kind         TEXT NOT NULL,
  actor        TEXT,
  task_id      INTEGER,
  session_id   INTEGER,
  payload_json TEXT
)`,
      },
      {
        type: "trigger",
        name: "events_no_update",
        sql: `CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events is append-only');
END`,
      },
      {
        type: "trigger",
        name: "events_no_delete",
        sql: `CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events is append-only');
END`,
      },
      {
        type: "trigger",
        name: "events_no_replace",
        sql: `CREATE TRIGGER events_no_replace BEFORE INSERT ON events
WHEN NEW.id > 0 AND EXISTS (SELECT 1 FROM events WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'events is append-only');
END`,
      },
    ],
  },
  {
    migration: eventsExplicitIdGuard,
    objects: [
      {
        type: "trigger",
        name: "events_no_explicit_id",
        sql: `CREATE TRIGGER events_no_explicit_id BEFORE INSERT ON events
WHEN NEW.id > 0
BEGIN
  SELECT RAISE(ABORT, 'events is append-only');
END`,
      },
    ],
  },
];

/**
 * Check `studio.db` before any pending migration runs, so a refusal writes
 * nothing. `applied` is every version recorded in `schema_migrations`.
 *
 * - Refuses with `StoreSchemaTooNewError` when a recorded version is beyond
 *   `list` (every list).
 * - Refuses with `StoreIntegrityError` when the recorded versions are not a
 *   contiguous run from 1 (every list): `schema_migrations` has no triggers, so
 *   a deleted row would otherwise re-run its migration.
 * - Only when `list` holds the kernel's real migration 1 (gated on code, never
 *   on a `schema_migrations` row, which DML can forge): refuses when nothing is
 *   recorded but the database has objects; when an append-only object of a
 *   recorded version is missing or altered; when one of a version not yet
 *   recorded already exists (its row was deleted); or when the database has
 *   any trigger the kernel did not create, on any table or view (one on
 *   `events` could swallow appends; one elsewhere could forge them, such as a
 *   kill-switch event).
 *
 * Objects of versions not yet recorded are not required, so an older database
 * whose later migrations are simply pending opens normally.
 *
 * Honest limits: deleting the top `schema_migrations` row(s) together with the
 * objects those migrations created is byte-identical to an older database
 * awaiting them, so it cannot be refused; the pending migration then recreates
 * the object (fail-safe: the guard is restored, nothing is lost). Deleting
 * only a top row whose migration created ordinary objects (007's
 * `event_queue`) re-runs it, which fails on `already exists`: the migration's
 * transaction rolls back and nothing is written, but that error is untyped.
 */
export function checkBeforeMigrating(
  db: Database.Database,
  dbPath: string,
  list: readonly Migration[],
  applied: readonly number[],
): void {
  const sorted = [...applied].sort((a, b) => a - b);
  const tooNew = sorted.filter((v) => v > list.length);
  if (tooNew.length > 0) throw new StoreSchemaTooNewError(dbPath, tooNew, list.length);

  const problems: string[] = [];
  if (sorted.some((v, i) => v !== i + 1)) {
    problems.push(
      `schema_migrations records versions ${sorted.join(", ")}, not a contiguous run from 1`,
    );
  }

  const expected = expectedObjects(list);
  if (expected !== undefined) {
    if (sorted.length === 0) {
      const existing = db
        .prepare<[], string>(
          "SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name",
        )
        .pluck()
        .all();
      if (existing.length > 0) {
        problems.push(
          `schema_migrations records no migration, but the database already has ${existing.join(", ")}`,
        );
      }
    }
    problems.push(...objectProblems(db, expected, sorted.at(-1) ?? 0));
  }

  if (problems.length > 0) throw new StoreIntegrityError(dbPath, problems);
}

/**
 * Check `studio.db` once every migration in `list` is applied: every
 * append-only object of the list's versions must exist exactly as created. A
 * refusal here means a migration broke the audit log (a kernel bug); the
 * migrations it ran stay committed.
 */
export function checkAfterMigrating(
  db: Database.Database,
  dbPath: string,
  list: readonly Migration[],
): void {
  const expected = expectedObjects(list);
  if (expected === undefined) return;
  const problems = objectProblems(db, expected, list.length);
  if (problems.length > 0) {
    throw new StoreIntegrityError(dbPath, problems.map((p) => `after migrating, ${p}`));
  }
}

/**
 * The append-only objects `list` creates, by version, or undefined when `list`
 * does not start with the kernel's real migration 1. A version counts only when
 * the kernel's own migration object sits at its position in `list`.
 */
function expectedObjects(
  list: readonly Migration[],
): ReadonlyMap<number, readonly AppendOnlyObject[]> | undefined {
  if (list[0] !== initial) return undefined;
  const byVersion = new Map<number, readonly AppendOnlyObject[]>();
  for (const { migration, objects } of APPEND_ONLY_OBJECTS) {
    if (list[migration.version - 1] === migration) byVersion.set(migration.version, objects);
  }
  return byVersion;
}

/** Problems with the expected objects, given the database claims versions 1..`reached`. */
function objectProblems(
  db: Database.Database,
  expected: ReadonlyMap<number, readonly AppendOnlyObject[]>,
  reached: number,
): string[] {
  const lookup = db.prepare<[string], { type: string; sql: string | null }>(
    "SELECT type, sql FROM sqlite_master WHERE name = ?",
  );
  const problems: string[] = [];
  const known = new Set<string>(); // kernel trigger names, lowercase
  for (const [version, objects] of expected) {
    for (const object of objects) {
      if (object.type === "trigger") known.add(object.name.toLowerCase());
      const found = lookup.get(object.name);
      if (version <= reached) {
        if (found === undefined) problems.push(`${object.type} ${object.name} is missing`);
        else if (found.type !== object.type || found.sql !== object.sql) {
          problems.push(`${object.type} ${object.name} is altered`);
        }
      } else if (found !== undefined) {
        problems.push(`${object.name} exists but migration ${version} is not recorded`);
      }
    }
  }

  // Every trigger, whatever table or view it is on: the kernel creates
  // triggers only on events, but a trigger elsewhere can still write into
  // events. Trigger names are case-insensitive in SQLite, hence lowercase. A
  // future migration that creates any trigger must list it above (the pinning
  // test in test/store.test.ts fails on a fresh store otherwise).
  const triggers = db
    .prepare<[], { name: string; tbl_name: string }>(
      "SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    )
    .all();
  for (const { name, tbl_name } of triggers) {
    if (!known.has(name.toLowerCase())) {
      problems.push(`trigger ${name} on ${tbl_name} was not created by the kernel`);
    }
  }
  return problems;
}
