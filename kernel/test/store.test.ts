import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DB_FILENAME,
  LOCK_PID_FILENAME,
  Store,
  StoreLockedError,
  migrations,
  resolveDataDir,
} from "../src/store/index.js";
import type { Migration } from "../src/store/index.js";

const KERNEL_DIR = fileURLToPath(new URL("..", import.meta.url));
// Absolute path, so the child works whatever the cwd the suite is run from.
const BETTER_SQLITE3 = createRequire(import.meta.url).resolve("better-sqlite3");

const PHASE1_TABLES = [
  "budget",
  "cap_state",
  "events",
  "schema_migrations",
  "sessions",
  "tasks",
  "wakeups",
  "work_steps",
];

let tmp: string;
const stores: Store[] = [];
const children: ChildProcess[] = [];

function open(options: { dataDir?: string; migrations?: readonly Migration[] } = {}): Store {
  const store = new Store({ dataDir: tmp, ...options });
  stores.push(store);
  return store;
}

/** A read-only inspection connection on studio.db, outside the Store. */
function inspect<T>(dataDir: string, fn: (db: Database.Database) => T): T {
  const db = new Database(join(dataDir, DB_FILENAME), { readonly: true, fileMustExist: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const TABLES_SQL =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";

function tableNames(src: Store | Database.Database): string[] {
  return src instanceof Store
    ? src.prepare<[], string>(TABLES_SQL).pluck().all()
    : src.prepare<[], string>(TABLES_SQL).pluck().all();
}

function columns(store: Store, table: string): string[] {
  return store.prepare<[], string>(`SELECT name FROM pragma_table_info('${table}')`).pluck().all();
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-store-"));
});

afterEach(async () => {
  for (const s of stores.splice(0)) s.close();
  for (const c of children.splice(0)) {
    if (c.exitCode === null && c.signalCode === null) {
      const exited = new Promise((r) => c.once("exit", r));
      c.kill("SIGKILL");
      await exited;
    }
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe("resolveDataDir", () => {
  it("defaults to ~/.loomwright-studio", () => {
    expect(resolveDataDir({}, "/home/u")).toBe(join("/home/u", ".loomwright-studio"));
  });

  it("honours STUDIO_DATA_DIR", () => {
    expect(resolveDataDir({ STUDIO_DATA_DIR: "/srv/studio" }, "/home/u")).toBe("/srv/studio");
  });

  it("ignores an empty STUDIO_DATA_DIR", () => {
    expect(resolveDataDir({ STUDIO_DATA_DIR: "" }, "/home/u")).toBe(
      join("/home/u", ".loomwright-studio"),
    );
  });
});

describe("Store: open", () => {
  it("creates a not-yet-existing data dir with mode 0700", () => {
    const dataDir = join(tmp, "nested", "studio");
    expect(existsSync(dataDir)).toBe(false);
    open({ dataDir });
    expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    expect(existsSync(join(dataDir, DB_FILENAME))).toBe(true);
  });

  it("tightens an existing data dir to 0700", () => {
    const dataDir = join(tmp, "loose");
    mkdirSync(dataDir);
    chmodSync(dataDir, 0o755);
    open({ dataDir });
    expect(statSync(dataDir).mode & 0o777).toBe(0o700);
  });

  it("uses WAL and foreign_keys=ON", () => {
    const store = open();
    expect(store.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(store.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("persists data across close and reopen", () => {
    const a = open();
    a.prepare("INSERT INTO tasks (title, state) VALUES (?, ?)").run("write me", "open");
    a.close();

    const b = open();
    const row = b.prepare<[], { title: string; state: string }>("SELECT title, state FROM tasks").get();
    expect(row).toEqual({ title: "write me", state: "open" });
    expect(b.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});

describe("Store.transaction", () => {
  it("commits nothing when the function throws", () => {
    const store = open();
    expect(() =>
      store.transaction(() => {
        store.prepare("INSERT INTO tasks (title, state) VALUES ('a', 'open')").run();
        store.prepare("INSERT INTO work_steps (key, status) VALUES ('k1', 'started')").run();
        throw new Error("crash mid-transaction");
      }),
    ).toThrow("crash mid-transaction");

    expect(store.prepare("SELECT count(*) FROM tasks").pluck().get()).toBe(0);
    expect(store.prepare("SELECT count(*) FROM work_steps").pluck().get()).toBe(0);
  });

  it("commits and returns the value when the function returns", () => {
    const store = open();
    const id = store.transaction(
      () => store.prepare("INSERT INTO tasks (title, state) VALUES ('a', 'open')").run().lastInsertRowid,
    );
    expect(store.prepare("SELECT id FROM tasks").pluck().get()).toBe(Number(id));
  });
});

describe("migrations", () => {
  it("has versions strictly increasing and contiguous from 1", () => {
    expect(migrations.map((m) => m.version)).toEqual(migrations.map((_, i) => i + 1));
    expect(migrations[0]?.version).toBe(1);
  });

  it("migration 1 creates exactly the phase-1 tables", () => {
    const store = open();
    expect(tableNames(store)).toEqual(PHASE1_TABLES);
    for (const later of ["agents", "playbooks", "triggers", "approvals", "hooks_installed", "connectors"]) {
      expect(tableNames(store)).not.toContain(later);
    }
    expect(store.appliedMigrations().map((m) => [m.version, m.name])).toEqual([[1, "initial"]]);
  });

  it("gives sessions, work_steps and cap_state their required columns", () => {
    const store = open();
    expect(columns(store, "sessions")).toEqual(
      expect.arrayContaining(["pgid", "auth_account", "sdk_session_id", "status", "model"]),
    );
    expect(columns(store, "work_steps")).toEqual(
      expect.arrayContaining(["key", "status", "result_json", "created_at", "updated_at"]),
    );
    expect(columns(store, "cap_state")).toEqual(
      expect.arrayContaining(["account", "rate_limit_type", "status", "resets_at", "updated_at"]),
    );
    expect(columns(store, "wakeups")).toEqual(
      expect.arrayContaining(["id", "due_at", "reason", "status", "fired_at"]),
    );
  });

  it("enforces work_steps.key UNIQUE and the status CHECK", () => {
    const store = open();
    const insert = store.prepare("INSERT INTO work_steps (key, status) VALUES (?, ?)");
    insert.run("k", "started");
    expect(() => insert.run("k", "done")).toThrow(/UNIQUE/);
    expect(() => insert.run("k2", "bogus")).toThrow(/CHECK/);
    for (const status of ["started", "done", "failed"]) insert.run(`s-${status}`, status);
  });

  it("counts input + output + cache-write tokens in budget, not cache reads (D26)", () => {
    const store = open();
    store
      .prepare(
        "INSERT INTO budget (day, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens) VALUES ('2026-10-01', 'm', 10, 20, 30, 1000)",
      )
      .run();
    expect(store.prepare("SELECT counted_tokens FROM budget").pluck().get()).toBe(60);
  });

  it("reopening is a no-op", () => {
    const a = open();
    const before = a.appliedMigrations();
    a.close();
    const b = open();
    expect(b.appliedMigrations()).toEqual(before);
  });

  it("applies only pending migrations, in ascending order", () => {
    const order: number[] = [];
    const m = (version: number): Migration => ({
      version,
      name: `m${version}`,
      up: (db) => {
        order.push(version);
        db.exec(`CREATE TABLE t${version} (x)`);
      },
    });
    open({ migrations: [m(1)] }).close();
    open({ migrations: [m(1), m(2), m(3)] });
    expect(order).toEqual([1, 2, 3]);
  });

  it("refuses a list that is not strictly increasing", () => {
    const m = (version: number): Migration => ({ version, name: `m${version}`, up: "SELECT 1" });
    expect(() => new Store({ dataDir: tmp, migrations: [m(2), m(1)] })).toThrow(/strictly increasing/);
  });

  it("a migration that throws leaves no table and no schema_migrations row", () => {
    const failing: Migration[] = [
      { version: 1, name: "ok", up: "CREATE TABLE first_ok (x)" },
      {
        version: 2,
        name: "boom",
        up: (db) => {
          db.exec("CREATE TABLE partial (x)");
          throw new Error("migration 2 failed");
        },
      },
    ];
    expect(() => new Store({ dataDir: tmp, migrations: failing })).toThrow("migration 2 failed");

    inspect(tmp, (db) => {
      expect(tableNames(db)).toEqual(["first_ok", "schema_migrations"]);
      expect(db.prepare("SELECT version FROM schema_migrations").pluck().all()).toEqual([1]);
    });

    // The failed open released its lock: the next open succeeds.
    open({ migrations: [failing[0] as Migration] }).close();
  });

  it("a failing first migration leaves the database with no tables at all", () => {
    const failing: Migration[] = [
      {
        version: 1,
        name: "boom",
        up: (db) => {
          db.exec("CREATE TABLE partial (x)");
          throw new Error("migration 1 failed");
        },
      },
    ];
    expect(() => new Store({ dataDir: tmp, migrations: failing })).toThrow("migration 1 failed");
    inspect(tmp, (db) => expect(tableNames(db)).toEqual([]));
  });
});

describe("events (append-only audit log)", () => {
  function seed(store: Store): { id: number; kind: string; payload_json: string } {
    store.prepare("INSERT INTO events (kind, payload_json) VALUES ('task.created', '{\"a\":1}')").run();
    return store
      .prepare<[], { id: number; kind: string; payload_json: string }>(
        "SELECT id, kind, payload_json FROM events",
      )
      .get() as { id: number; kind: string; payload_json: string };
  }

  it("defines BEFORE UPDATE and BEFORE DELETE triggers", () => {
    const store = open();
    const triggers = store
      .prepare<[], string>("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'events'")
      .pluck()
      .all()
      .join("\n");
    expect(triggers).toMatch(/BEFORE UPDATE ON events/);
    expect(triggers).toMatch(/BEFORE DELETE ON events/);
  });

  it("rejects UPDATE and leaves the row unchanged", () => {
    const store = open();
    const row = seed(store);
    expect(() => store.prepare("UPDATE events SET kind = 'tampered'").run()).toThrow(/append-only/);
    expect(store.prepare("SELECT id, kind, payload_json FROM events").get()).toEqual(row);
  });

  it("rejects DELETE and leaves the row unchanged", () => {
    const store = open();
    const row = seed(store);
    expect(() => store.prepare("DELETE FROM events").run()).toThrow(/append-only/);
    expect(store.prepare("SELECT id, kind, payload_json FROM events").get()).toEqual(row);
  });

  it("rejects INSERT OR REPLACE over an existing row", () => {
    const store = open();
    const row = seed(store);
    expect(() =>
      store.prepare("INSERT OR REPLACE INTO events (id, kind) VALUES (?, 'tampered')").run(row.id),
    ).toThrow(/append-only/);
    expect(store.prepare("SELECT id, kind, payload_json FROM events").get()).toEqual(row);
  });

  it("rejects an upsert over an existing row", () => {
    const store = open();
    const row = seed(store);
    expect(() =>
      store
        .prepare("INSERT INTO events (id, kind) VALUES (?, 'tampered') ON CONFLICT(id) DO UPDATE SET kind = 'tampered'")
        .run(row.id),
    ).toThrow(/append-only/);
    expect(store.prepare("SELECT id, kind, payload_json FROM events").get()).toEqual(row);
  });

  // In a BEFORE INSERT trigger SQLite reports an auto-assigned id as NEW.id = -1,
  // so a stored -1 (or 0) row would make every later auto-id append look like a replace.
  it.each([-1, 0])("rejects an explicit id of %i and still accepts auto-id appends after it", (id) => {
    const store = open();
    expect(() => store.prepare("INSERT INTO events (id, kind) VALUES (?, 'x')").run(id)).toThrow(/CHECK/);
    expect(() =>
      store.prepare("INSERT OR REPLACE INTO events (id, kind) VALUES (?, 'x')").run(id),
    ).toThrow(/CHECK/);
    expect(store.prepare("SELECT count(*) FROM events").pluck().get()).toBe(0);
    seed(store);
    store.prepare("INSERT INTO events (id, kind) VALUES (NULL, 'explicit-null')").run();
    const ids = store.prepare<[], number>("SELECT id FROM events ORDER BY id").pluck().all();
    expect(ids).toEqual([1, 2]);
  });

  it("allows appends", () => {
    const store = open();
    seed(store);
    seed(store);
    expect(store.prepare("SELECT count(*) FROM events").pluck().get()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Single-writer lock. Never skipped on any platform.
// ---------------------------------------------------------------------------

// Takes the lock exactly as src/store/lock.ts does.
const CHILD_SCRIPT = `
const Database = require(process.env.BSQ_PATH);
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const dir = process.env.LOCK_DIR;
let db;
try {
  db = new Database(join(dir, "studio.lock"), { timeout: 0 });
  db.pragma("locking_mode = EXCLUSIVE");
  db.exec("CREATE TABLE IF NOT EXISTS owner(pid INTEGER, started_at TEXT); DELETE FROM owner;");
  db.prepare("INSERT INTO owner(pid, started_at) VALUES (?, ?)").run(process.pid, new Date().toISOString());
} catch (err) {
  if (db) db.close();
  if (err && typeof err.code === "string" && err.code.startsWith("SQLITE_BUSY")) {
    console.log("BUSY");
    process.exit(0);
  }
  console.log("ERROR " + (err && err.message));
  process.exit(1);
}
writeFileSync(join(dir, "studio.lock.pid"), process.pid + "\\n");
if (process.env.MODE === "hold") {
  console.log("READY");
  setInterval(() => {}, 1000);
} else {
  db.close();
  console.log("ACQUIRED");
}
`;

function spawnLockChild(dir: string, mode: "hold" | "try"): { child: ChildProcess; line: Promise<string> } {
  const child = spawn(process.execPath, ["-e", CHILD_SCRIPT], {
    cwd: KERNEL_DIR,
    env: { ...process.env, BSQ_PATH: BETTER_SQLITE3, LOCK_DIR: dir, MODE: mode },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const line = new Promise<string>((resolveLine, reject) => {
    let out = "";
    let err = "";
    const timer = setTimeout(() => reject(new Error(`lock child timed out; stderr: ${err}`)), 10_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const nl = out.indexOf("\n");
      if (nl !== -1) {
        clearTimeout(timer);
        resolveLine(out.slice(0, nl).trim());
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`lock child exited (code ${code}, signal ${signal}) before a line; stderr: ${err}`));
    });
  });
  return { child, line };
}

async function childTry(dir: string): Promise<string> {
  return spawnLockChild(dir, "try").line;
}

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a throw");
}

describe("single-writer lock", () => {
  it("refuses while a live child holds the lock, then opens after kill -9", async () => {
    const { child, line } = spawnLockChild(tmp, "hold");
    expect(await line).toBe("READY");

    const err = catchError(() => new Store({ dataDir: tmp }));
    expect(err).toBeInstanceOf(StoreLockedError);
    expect((err as StoreLockedError).holderPid).toBe(child.pid);
    expect((err as StoreLockedError).message).toContain(`held by pid ${child.pid} (as last recorded)`);
    // The lock is taken before studio.db is opened: the loser created nothing.
    expect(existsSync(join(tmp, DB_FILENAME))).toBe(false);

    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGKILL");
    await exited;

    const store = open();
    expect(store.isOpen).toBe(true);
    expect(existsSync(join(tmp, DB_FILENAME))).toBe(true);
  });

  it("refuses a second Store in the same process, and the refusal keeps the holder's lock", async () => {
    open();

    const err = catchError(() => new Store({ dataDir: tmp }));
    expect(err).toBeInstanceOf(StoreLockedError);
    expect((err as StoreLockedError).holderPid).toBe(process.pid);

    // Store B's failed lock connection was closed above; A must still hold the lock.
    expect(await childTry(tmp)).toBe("BUSY");
  });

  it("lets another process acquire the lock after a clean close", async () => {
    const a = open();
    expect(await childTry(tmp)).toBe("BUSY");
    a.close();
    expect(await childTry(tmp)).toBe("ACQUIRED");
  });

  it("reports an unknown holder when the recorded PID is unreadable", () => {
    open();
    writeFileSync(join(tmp, LOCK_PID_FILENAME), "not-a-pid\n");
    const err = catchError(() => new Store({ dataDir: tmp }));
    expect(err).toBeInstanceOf(StoreLockedError);
    expect((err as StoreLockedError).holderPid).toBeUndefined();
  });
});
