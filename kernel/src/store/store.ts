import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { checkAfterMigrating, checkBeforeMigrating } from "./integrity.js";
import { acquireStoreLock } from "./lock.js";
import type { StoreLock } from "./lock.js";
import { migrations as defaultMigrations } from "./migrations/index.js";
import type { Migration } from "./migrations/index.js";

export const DATA_DIR_ENV = "STUDIO_DATA_DIR";
export const DEFAULT_DATA_DIR_NAME = ".loomwright-studio";
export const DB_FILENAME = "studio.db";

/**
 * The Studio data dir: `STUDIO_DATA_DIR` when set and non-empty, otherwise
 * `~/.loomwright-studio`. Pure: pass the environment in.
 */
export function resolveDataDir(
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string = homedir(),
): string {
  const override = env[DATA_DIR_ENV];
  if (override !== undefined && override !== "") return resolve(override);
  return join(homeDir, DEFAULT_DATA_DIR_NAME);
}

export interface StoreOptions {
  /** Defaults to `resolveDataDir(process.env)`. */
  readonly dataDir?: string;
  /** Defaults to the real ordered migration list. */
  readonly migrations?: readonly Migration[];
}

/**
 * Test seam only: the kernel never passes it (`kernel.ts` builds a `Store`
 * from `StoreOptions` alone) and it is not exported from `store/index.ts`.
 */
export interface StoreTestSeam {
  /** Opens `studio.db`; defaults to `new Database(path)`. */
  readonly openDatabase?: (path: string) => Database.Database;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly applied_at: string;
}

/**
 * The kernel's only writer to `studio.db`. Opening one takes the data dir's
 * single-writer lock; a second live `Store` on the same data dir, in this or
 * any other process, is refused with `StoreLockedError`.
 *
 * Open order: create/chmod the data dir, take the lock, then open `studio.db`,
 * set pragmas, check the database (a schema newer than this kernel, or a
 * missing or altered `events` table or trigger, is refused with a typed error
 * before anything is written), apply pending migrations and check again. A
 * refused opener never creates `studio.db`; any refusal after the lock closes
 * the database and releases the lock.
 *
 * The `events` triggers block DML, not DDL. There is no raw multi-statement
 * `exec`, but `prepare` still runs any single statement, DDL included, so a
 * caller could drop a trigger; the next open then refuses the database
 * (`integrity.ts`). Schema changes belong in a migration, never in `prepare`.
 */
export class Store {
  readonly dataDir: string;
  readonly dbPath: string;
  readonly #db: Database.Database;
  readonly #lock: StoreLock;

  constructor(options: StoreOptions = {}, seam: StoreTestSeam = {}) {
    this.dataDir = options.dataDir ?? resolveDataDir(process.env);
    this.dbPath = join(this.dataDir, DB_FILENAME);

    ensureDataDir(this.dataDir);
    this.#lock = acquireStoreLock(this.dataDir);

    let db: Database.Database | undefined;
    try {
      db = (seam.openDatabase ?? ((path: string) => new Database(path)))(this.dbPath);
      const mode = db.pragma("journal_mode = WAL", { simple: true });
      if (mode !== "wal") {
        throw new Error(`studio.db did not enter WAL mode (journal_mode=${String(mode)})`);
      }
      // Per connection, so set on every open.
      db.pragma("foreign_keys = ON");
      const list = options.migrations ?? defaultMigrations;
      validateMigrationList(list);
      const applied = appliedVersions(db);
      checkBeforeMigrating(db, this.dbPath, list, applied);
      applyMigrations(db, list, applied);
      checkAfterMigrating(db, this.dbPath, list);
    } catch (err) {
      db?.close();
      this.#lock.release();
      throw err;
    }
    this.#db = db;
  }

  get isOpen(): boolean {
    return this.#db.open;
  }

  prepare<BindParameters extends unknown[] = unknown[], Result = unknown>(
    sql: string,
  ): Database.Statement<BindParameters, Result> {
    return this.#db.prepare<BindParameters, Result>(sql);
  }

  pragma(source: string, options?: Database.PragmaOptions): unknown {
    return this.#db.pragma(source, options);
  }

  /** Run `fn` in one transaction: it commits when `fn` returns and rolls back if it throws. */
  transaction<T>(fn: () => T): T {
    return this.#db.transaction(fn)();
  }

  appliedMigrations(): AppliedMigration[] {
    return this.#db
      .prepare<[], AppliedMigration>(
        "SELECT version, name, applied_at FROM schema_migrations ORDER BY version",
      )
      .all();
  }

  /** Close the database, then release the lock. Idempotent. */
  close(): void {
    if (this.#db.open) this.#db.close();
    this.#lock.release();
  }
}

function ensureDataDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // The mode option is masked by umask and ignored for an existing dir.
  chmodSync(dir, 0o700);
}

const CREATE_SCHEMA_MIGRATIONS = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

/**
 * Validate the whole list before touching the database: versions must be
 * contiguous from 1 (1, 2, 3, ...), as documented on `Migration.version`.
 */
function validateMigrationList(list: readonly Migration[]): void {
  list.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(
        `migrations must be strictly increasing and contiguous from 1 (expected version ${i + 1} at position ${i}, got ${m.version})`,
      );
    }
  });
}

/** Every version recorded in `schema_migrations`; none when the table does not exist yet. */
function appliedVersions(db: Database.Database): number[] {
  const hasTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  return hasTable === undefined
    ? []
    : db.prepare<[], number>("SELECT version FROM schema_migrations").pluck().all();
}

/**
 * Apply every migration of `list` whose version is not in `applied`,
 * ascending, each in its own transaction together with its `schema_migrations`
 * row. A migration that throws rolls back entirely (including, on a fresh
 * database, the `schema_migrations` table itself).
 */
function applyMigrations(
  db: Database.Database,
  list: readonly Migration[],
  applied: readonly number[],
): void {
  const done = new Set(applied);
  for (const m of list) {
    if (done.has(m.version)) continue;
    db.transaction(() => {
      db.exec(CREATE_SCHEMA_MIGRATIONS);
      if (typeof m.up === "string") db.exec(m.up);
      else m.up(db);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
    })();
  }
}
