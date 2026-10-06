import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DB_FILENAME,
  LOCK_PID_FILENAME,
  Store,
  StoreIntegrityError,
  StoreLockedError,
  StoreSchemaTooNewError,
  migrations,
  resolveDataDir,
} from "../src/store/index.js";
import type { Migration } from "../src/store/index.js";
import { APPEND_ONLY_OBJECTS } from "../src/store/integrity.js";
import { LOCK_RETRIES, LOCK_RETRY_MAX_MS, LOCK_RETRY_MIN_MS, acquireStoreLock } from "../src/store/lock.js";
import { initial } from "../src/store/migrations/001_initial.js";
import { KNOWN_PROVIDER_IDS, capKeysProviderId } from "../src/store/migrations/009_cap_keys_provider_id.js";
import { BudgetAdmission } from "../src/budget/index.js";
import { availableProviderIds } from "../src/auth/index.js";

const KERNEL_DIR = fileURLToPath(new URL("..", import.meta.url));
// The real lock module, imported by the lock child under --experimental-strip-types.
const LOCK_MODULE_URL = pathToFileURL(join(KERNEL_DIR, "src", "store", "lock.ts")).href;

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
    const store = open({ migrations: [initial] });
    expect(tableNames(store)).toEqual(PHASE1_TABLES);
    for (const later of ["agents", "playbooks", "triggers", "approvals", "hooks_installed", "connectors"]) {
      expect(tableNames(store)).not.toContain(later);
    }
    expect(store.appliedMigrations().map((m) => [m.version, m.name])).toEqual([[1, "initial"]]);
  });

  it("the default list adds auth_providers (migration 2), sessions.loomwright_path (migration 3), sessions.leader_started_at (migration 4), sessions.kill_incomplete_at (migration 5), the budget/cap_state details (migration 6), event_queue and the work_steps details (migration 7), the events explicit-id guard (migration 8), the cap keys on the provider id (migration 9), session_groups (migration 10) and no phase-2 table", () => {
    const store = open();
    expect(tableNames(store)).toEqual([...PHASE1_TABLES, "auth_providers", "event_queue", "session_groups"].sort());
    for (const later of ["agents", "playbooks", "triggers", "approvals", "hooks_installed", "connectors"]) {
      expect(tableNames(store)).not.toContain(later);
    }
    expect(store.appliedMigrations().map((m) => [m.version, m.name])).toEqual([
      [1, "initial"],
      [2, "auth_providers"],
      [3, "session_loomwright_path"],
      [4, "session_leader_started_at"],
      [5, "session_kill_incomplete_at"],
      [6, "budget_cap_details"],
      [7, "event_loop"],
      [8, "events_explicit_id_guard"],
      [9, "cap_keys_provider_id"],
      [10, "session_groups"],
    ]);
    expect(columns(store, "auth_providers")).toEqual(["id", "account", "token_created_at", "updated_at"]);
    expect(columns(store, "session_groups")).toEqual([
      "session_id",
      "pgid",
      "leader_command",
      "leader_started_at",
      "first_seen",
      "kill_incomplete_at",
      "resolved_at",
      "resolution",
    ]);
    expect(columns(store, "sessions").slice(-3)).toEqual(["loomwright_path", "leader_started_at", "kill_incomplete_at"]);
    expect(columns(store, "budget").slice(-1)).toEqual(["thinking_tokens"]);
    expect(columns(store, "cap_state").slice(-5)).toEqual([
      "utilization",
      "unified_windows_json",
      "reset_source",
      "notified_resets_at",
      "warned_resets_at",
    ]);
    expect(columns(store, "event_queue")).toEqual([
      "id",
      "kind",
      "payload_json",
      "source_ref",
      "status",
      "not_before",
      "attempts",
      "last_error",
      "task_id",
      "session_id",
      "enqueued_at",
      "done_at",
    ]);
    expect(columns(store, "work_steps").slice(-2)).toEqual(["failure_reason", "rerunnable"]);
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

  it("refuses a gapped list or one not starting at 1, before touching the database", () => {
    const m = (version: number): Migration => ({
      version,
      name: `m${version}`,
      up: `CREATE TABLE t${version} (x)`,
    });
    expect(() => new Store({ dataDir: tmp, migrations: [m(1), m(3)] })).toThrow(/contiguous from 1/);
    inspect(tmp, (db) => expect(tableNames(db)).toEqual([]));
    expect(() => new Store({ dataDir: tmp, migrations: [m(2), m(3)] })).toThrow(/contiguous from 1/);
    inspect(tmp, (db) => expect(tableNames(db)).toEqual([]));
    // Each refused open released its lock.
    open({ migrations: [m(1)] }).close();
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

  it("refuses any explicit positive id, up to max-int, so ids follow append order", () => {
    const store = open();
    seed(store);
    const insert = store.prepare("INSERT INTO events (id, kind) VALUES (?, 'explicit')");
    // BigInt: a JS Number rounds 2^63 - 1 up to 2^63, out of int64 range, and
    // would fail with a datatype error for the wrong reason. 2 is a free id
    // just above the last one, so only the explicit-id guard can refuse it.
    for (const id of [9223372036854775807n, 1000n, 2n]) {
      expect(() => insert.run(id)).toThrow(/append-only/);
    }
    expect(() =>
      store.prepare("INSERT INTO events (id, kind) VALUES (9223372036854775807, 'literal')").run(),
    ).toThrow(/append-only/);

    for (const kind of ["a", "b", "c"]) store.prepare("INSERT INTO events (kind) VALUES (?)").run(kind);
    store.prepare("INSERT INTO events (id, kind) VALUES (NULL, 'd')").run();
    expect(store.prepare("SELECT kind FROM events ORDER BY id").pluck().all()).toEqual([
      "task.created",
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(store.prepare("SELECT id FROM events ORDER BY id").pluck().all()).toEqual([1, 2, 3, 4, 5]);
  });

  it("migration 8 leaves every existing events row byte-for-byte unchanged", () => {
    const v7 = open({ migrations: migrations.slice(0, 7) });
    v7.prepare("INSERT INTO events (kind) VALUES ('first')").run();
    v7.prepare(
      "INSERT INTO events (at, kind, actor, task_id, session_id, payload_json) VALUES ('2026-01-01T00:00:00.000Z', 'second', 'wright', 7, 9, '{\"x\":\"\u00e9\"}')",
    ).run();
    v7.prepare("INSERT INTO events (kind, payload_json) VALUES ('third', NULL)").run();
    // quote() renders each value with its storage class, so equal output means equal bytes.
    const ROWS =
      "SELECT quote(id), quote(at), quote(kind), quote(actor), quote(task_id), quote(session_id), quote(payload_json) FROM events ORDER BY id";
    const before = v7.prepare(ROWS).raw().all();
    expect(before).toHaveLength(3);
    v7.close();

    const store = open();
    expect(store.appliedMigrations().map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(store.prepare(ROWS).raw().all()).toEqual(before);
  });
});

describe("migration 9: cap keys on the provider id", () => {
  const V8 = migrations.slice(0, 8);
  const CAP_ROWS =
    "SELECT account, rate_limit_type, status, resets_at, reset_source, notified_resets_at, warned_resets_at FROM cap_state ORDER BY account, rate_limit_type";
  const WAKEUPS = "SELECT id, due_at, reason, status, fired_at FROM wakeups ORDER BY id";

  function v8(seed: (store: Store) => void): void {
    const store = open({ migrations: V8 });
    seed(store);
    store.close();
  }

  function provider(store: Store, id: string, account: string): void {
    store.prepare("INSERT INTO auth_providers (id, account) VALUES (?, ?)").run(id, account);
  }

  function cap(store: Store, account: string, type: string, status: string, resetsAt: string | null, notified: string | null = null): void {
    store
      .prepare(
        "INSERT INTO cap_state (account, rate_limit_type, status, resets_at, reset_source, notified_resets_at) VALUES (?, ?, ?, ?, 'event', ?)",
      )
      .run(account, type, status, resetsAt, notified);
  }

  it("moves a label-keyed park and its pending wake-up to the provider id; fired wake-ups and every events row stay", () => {
    const RESET = "2026-10-02T16:20:00.000Z";
    v8((store) => {
      provider(store, "subscription-token", "owner@example.test");
      cap(store, "owner@example.test", "five_hour", "rejected", RESET, RESET);
      // A key no provider labels (the label's fallback, the id itself): untouched.
      cap(store, "subscription-token", "seven_day", "allowed", null);
      store.prepare("INSERT INTO wakeups (due_at, reason, status, fired_at) VALUES ('2026-10-01T10:00:00.000Z', 'cap_reset:owner@example.test', 'fired', '2026-10-01T10:00:01.000Z')").run();
      store.prepare("INSERT INTO wakeups (due_at, reason, status) VALUES (?, 'cap_reset:owner@example.test', 'pending')").run(RESET);
      store.prepare("INSERT INTO wakeups (due_at, reason, status) VALUES (?, 'cap_recheck:owner@example.test', 'pending')").run(RESET);
      store.prepare("INSERT INTO wakeups (due_at, reason, status) VALUES (?, 'unrelated', 'pending')").run(RESET);
      store.prepare("INSERT INTO events (kind, payload_json) VALUES ('cap_rejected', '{\"account\":\"owner@example.test\"}')").run();
      store.prepare("INSERT INTO sessions (agent, status, auth_account) VALUES ('wright', 'completed', 'owner@example.test')").run();
    });
    const EVENTS =
      "SELECT quote(id), quote(at), quote(kind), quote(actor), quote(task_id), quote(session_id), quote(payload_json) FROM events ORDER BY id";
    const before = inspect(tmp, (db) => db.prepare(EVENTS).raw().all());

    const store = open();
    expect(store.appliedMigrations().map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(store.prepare(CAP_ROWS).all()).toEqual([
      { account: "subscription-token", rate_limit_type: "five_hour", status: "rejected", resets_at: RESET, reset_source: "event", notified_resets_at: RESET, warned_resets_at: null },
      { account: "subscription-token", rate_limit_type: "seven_day", status: "allowed", resets_at: null, reset_source: "event", notified_resets_at: null, warned_resets_at: null },
    ]);
    expect(store.prepare(WAKEUPS).all()).toEqual([
      { id: 1, due_at: "2026-10-01T10:00:00.000Z", reason: "cap_reset:owner@example.test", status: "fired", fired_at: "2026-10-01T10:00:01.000Z" },
      { id: 2, due_at: RESET, reason: "cap_reset:subscription-token", status: "pending", fired_at: null },
      { id: 3, due_at: RESET, reason: "cap_recheck:subscription-token", status: "pending", fired_at: null },
      { id: 4, due_at: RESET, reason: "unrelated", status: "pending", fired_at: null },
    ]);
    expect(store.prepare(EVENTS).raw().all()).toEqual(before);
    expect(store.prepare("SELECT auth_account FROM sessions").pluck().all()).toEqual(["owner@example.test"]);

    // The moved park still refuses admission under the provider id.
    const gate = new BudgetAdmission(
      { store, authProvider: { id: "subscription-token", account: "owner@example.test" } },
      { now: () => new Date("2026-10-02T12:00:00.000Z") },
    );
    expect(gate.check({ kind: "start", agent: "wright", account: "owner@example.test", provider: "subscription-token", task: null })).toEqual({
      admitted: false,
      reason: "cap_parked",
      retryAt: RESET,
    });
  });

  /** Admission's answer for `provider` at 12:00 on the reset day. */
  function admit(store: Store, provider: string): unknown {
    const gate = new BudgetAdmission({ store, authProvider: { id: provider, account: "any" } }, { now: () => new Date("2026-10-02T12:00:00.000Z") });
    return gate.check({ kind: "start", agent: "wright", account: "any", provider, task: null });
  }

  /** Run migration 9's `up` again on the closed store's database, as the integrity check's re-run does. */
  function rerun9(): void {
    const db = new Database(join(tmp, DB_FILENAME));
    try {
      db.transaction(() => (capKeysProviderId.up as (d: Database.Database) => void)(db))();
    } finally {
      db.close();
    }
  }

  const PARKED = { admitted: false, reason: "cap_parked", retryAt: "2026-10-02T16:00:00.000Z" };

  it("copies a label equal to another provider's id (it has a row) to the label's providers and keeps it: both stay parked", () => {
    v8((store) => {
      provider(store, "api-key", "api-key");
      provider(store, "subscription-token", "api-key");
      cap(store, "api-key", "five_hour", "rejected", "2026-10-02T16:00:00.000Z");
      store.prepare("INSERT INTO wakeups (due_at, reason, status) VALUES ('2026-10-02T16:00:00.000Z', 'cap_reset:api-key', 'pending')").run();
    });
    const store = open();
    expect(store.prepare("SELECT account, rate_limit_type, status, resets_at FROM cap_state ORDER BY account").all()).toEqual([
      { account: "api-key", rate_limit_type: "five_hour", status: "rejected", resets_at: "2026-10-02T16:00:00.000Z" },
      { account: "subscription-token", rate_limit_type: "five_hour", status: "rejected", resets_at: "2026-10-02T16:00:00.000Z" },
    ]);
    expect(store.prepare("SELECT reason FROM wakeups WHERE status = 'pending' ORDER BY id").pluck().all()).toEqual([
      "cap_reset:api-key",
      "cap_reset:subscription-token",
    ]);
    // The reviewer's reproduction: subscription-token parked under the label before the upgrade.
    expect(admit(store, "subscription-token")).toEqual(PARKED);
    expect(admit(store, "api-key")).toEqual(PARKED);
  });

  it("copies and keeps a label equal to a known provider id that has no auth_providers row: that provider keeps its park", () => {
    expect(KNOWN_PROVIDER_IDS).toEqual(["api-key", "subscription-token"]);
    v8((store) => {
      // No api-key row: its label falls back to its id, so 'api-key' rows may be its own.
      provider(store, "subscription-token", "api-key");
      cap(store, "api-key", "five_hour", "rejected", "2026-10-02T16:00:00.000Z");
      store.prepare("INSERT INTO wakeups (due_at, reason, status) VALUES ('2026-10-02T16:00:00.000Z', 'cap_recheck:api-key', 'pending')").run();
    });
    const store = open();
    expect(store.prepare("SELECT account, status FROM cap_state ORDER BY account").all()).toEqual([
      { account: "api-key", status: "rejected" },
      { account: "subscription-token", status: "rejected" },
    ]);
    expect(store.prepare("SELECT reason FROM wakeups WHERE status = 'pending' ORDER BY id").pluck().all()).toEqual([
      "cap_recheck:api-key",
      "cap_recheck:subscription-token",
    ]);
    expect(admit(store, "api-key")).toEqual(PARKED);
    expect(admit(store, "subscription-token")).toEqual(PARKED);
  });

  it("KNOWN_PROVIDER_IDS covers every provider id this build registers", async () => {
    expect(KNOWN_PROVIDER_IDS).toEqual(expect.arrayContaining(await availableProviderIds()));
  });

  it("a re-run is safe: a moved label finds nothing, a kept label is copied again without duplicates or lifting a later park", () => {
    v8((store) => {
      provider(store, "subscription-token", "api-key");
      cap(store, "api-key", "five_hour", "rejected", "2026-10-02T16:00:00.000Z");
      store.prepare("INSERT INTO wakeups (due_at, reason, status) VALUES ('2026-10-02T16:00:00.000Z', 'cap_reset:api-key', 'pending')").run();
      provider(store, "p", "owner@example.test");
      cap(store, "owner@example.test", "seven_day", "rejected", "2026-10-03T00:00:00.000Z");
      store.prepare("INSERT INTO wakeups (due_at, reason, status) VALUES ('2026-10-03T00:00:00.000Z', 'cap_recheck:owner@example.test', 'pending')").run();
    });
    open().close();
    const ROWS = "SELECT account, rate_limit_type, status, resets_at FROM cap_state ORDER BY account, rate_limit_type";
    const PENDING = "SELECT id, reason, due_at FROM wakeups WHERE status = 'pending' ORDER BY id";
    const after = inspect(tmp, (db) => ({ cap: db.prepare(ROWS).all(), wakeups: db.prepare(PENDING).all() }));
    expect(after.wakeups).toEqual([
      { id: 1, reason: "cap_reset:api-key", due_at: "2026-10-02T16:00:00.000Z" },
      { id: 2, reason: "cap_recheck:p", due_at: "2026-10-03T00:00:00.000Z" },
      { id: 3, reason: "cap_reset:subscription-token", due_at: "2026-10-02T16:00:00.000Z" },
    ]);
    rerun9();
    expect(inspect(tmp, (db) => ({ cap: db.prepare(ROWS).all(), wakeups: db.prepare(PENDING).all() }))).toEqual(after);

    // The kernel extends subscription-token's park; a re-run never shortens it.
    const later = new Database(join(tmp, DB_FILENAME));
    later.prepare("UPDATE cap_state SET resets_at = '2026-10-02T18:00:00.000Z' WHERE account = 'subscription-token'").run();
    later.close();
    rerun9();
    const store = open();
    expect(store.prepare("SELECT resets_at FROM cap_state WHERE account = 'subscription-token'").pluck().get()).toBe("2026-10-02T18:00:00.000Z");
    expect(store.prepare(PENDING).all()).toEqual(after.wakeups);
  });

  it("leaves a session-scheduled wake-up (it has a wakeup_scheduled audit event) with a cap_* label reason as it is", () => {
    v8((store) => {
      provider(store, "subscription-token", "owner@example.test");
      store.prepare("INSERT INTO wakeups (due_at, reason, status) VALUES ('2026-10-02T16:00:00.000Z', 'cap_reset:owner@example.test', 'pending')").run();
      store.prepare("INSERT INTO events (kind, payload_json) VALUES ('wakeup_scheduled', json_object('wakeup_id', 1))").run();
      store.prepare("INSERT INTO wakeups (due_at, reason, status) VALUES ('2026-10-02T16:00:00.000Z', 'cap_reset:owner@example.test', 'pending')").run();
    });
    const store = open();
    expect(store.prepare("SELECT id, reason FROM wakeups ORDER BY id").all()).toEqual([
      { id: 1, reason: "cap_reset:owner@example.test" },
      { id: 2, reason: "cap_reset:subscription-token" },
    ]);
  });

  it("merges into an existing id row conservatively, and copies a label shared by several providers to each", () => {
    v8((store) => {
      provider(store, "p", "L");
      // rejected vs rejected: the later reset wins.
      cap(store, "L", "five_hour", "rejected", "2026-10-02T17:00:00.000Z");
      cap(store, "p", "five_hour", "rejected", "2026-10-02T16:00:00.000Z");
      // rejected beats non-rejected, whichever side holds it.
      cap(store, "L", "seven_day", "allowed", "2026-10-09T00:00:00.000Z");
      cap(store, "p", "seven_day", "rejected", "2026-10-03T00:00:00.000Z");
      cap(store, "L", "opus", "rejected", "2026-10-03T00:00:00.000Z");
      cap(store, "p", "opus", "allowed", null);
      // NULL (unknown) counts as latest, whichever side holds it.
      cap(store, "L", "overage", "rejected", null);
      cap(store, "p", "overage", "rejected", "2026-10-02T18:00:00.000Z");
      cap(store, "L", "unknown", "rejected", "2026-10-02T19:00:00.000Z");
      cap(store, "p", "unknown", "rejected", null);
      // One label, two providers: copied to each (fail closed).
      provider(store, "q1", "shared");
      provider(store, "q2", "shared");
      cap(store, "shared", "five_hour", "rejected", "2026-10-02T15:00:00.000Z");
      store.prepare("INSERT INTO wakeups (due_at, reason, status) VALUES ('2026-10-02T15:00:00.000Z', 'cap_reset:shared', 'pending')").run();
    });
    const store = open();
    expect(store.prepare("SELECT account, rate_limit_type, status, resets_at FROM cap_state ORDER BY account, rate_limit_type").all()).toEqual([
      { account: "p", rate_limit_type: "five_hour", status: "rejected", resets_at: "2026-10-02T17:00:00.000Z" },
      { account: "p", rate_limit_type: "opus", status: "rejected", resets_at: "2026-10-03T00:00:00.000Z" },
      { account: "p", rate_limit_type: "overage", status: "rejected", resets_at: null },
      { account: "p", rate_limit_type: "seven_day", status: "rejected", resets_at: "2026-10-03T00:00:00.000Z" },
      { account: "p", rate_limit_type: "unknown", status: "rejected", resets_at: null },
      { account: "q1", rate_limit_type: "five_hour", status: "rejected", resets_at: "2026-10-02T15:00:00.000Z" },
      { account: "q2", rate_limit_type: "five_hour", status: "rejected", resets_at: "2026-10-02T15:00:00.000Z" },
    ]);
    expect(store.prepare("SELECT reason FROM wakeups WHERE status = 'pending' ORDER BY reason").pluck().all()).toEqual([
      "cap_reset:q1",
      "cap_reset:q2",
    ]);
  });

  it("a database already at version 9 reopens unchanged", () => {
    const first = open();
    first.prepare("INSERT INTO auth_providers (id, account) VALUES ('subscription-token', 'owner@example.test')").run();
    cap(first, "subscription-token", "five_hour", "rejected", "2026-10-02T16:20:00.000Z");
    first.close();
    const store = open();
    expect(store.appliedMigrations().map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(store.prepare("SELECT account, status FROM cap_state").all()).toEqual([{ account: "subscription-token", status: "rejected" }]);
  });
});

describe("Store: integrity check at open", () => {
  const V7 = migrations.slice(0, 7);

  /** Change a closed store's database outside the Store, as a stray tool or an attacker could. */
  function tamper(sql: string): void {
    const db = new Database(join(tmp, DB_FILENAME));
    try {
      db.exec(sql);
    } finally {
      db.close();
    }
  }

  /** Everything an open could write: the schema and the migration records. */
  function snapshot(): unknown {
    return inspect(tmp, (db) => ({
      schema: db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all(),
      migrations: tableNames(db).includes("schema_migrations")
        ? db.prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version").all()
        : null,
    }));
  }

  /** Open must refuse with `type`, write nothing, and release the lock. */
  function refusal<E>(type: new (...args: never[]) => E, list?: readonly Migration[]): E {
    const before = snapshot();
    const err = catchError(() => new Store({ dataDir: tmp, ...(list ? { migrations: list } : {}) }));
    expect(err).toBeInstanceOf(type);
    expect(snapshot()).toEqual(before);
    acquireStoreLock(tmp).release();
    return err as E;
  }

  it("pins every expected object's text to what SQLite stores", () => {
    const store = open();
    const lookup = store.prepare<[string], { type: string; sql: string }>(
      "SELECT type, sql FROM sqlite_master WHERE name = ?",
    );
    const names: string[] = [];
    for (const { objects } of APPEND_ONLY_OBJECTS) {
      for (const o of objects) {
        names.push(o.name);
        expect(lookup.get(o.name)).toEqual({ type: o.type, sql: o.sql });
      }
    }
    // Every trigger in the database is one of them.
    const triggers = store
      .prepare<[], string>("SELECT name FROM sqlite_master WHERE type = 'trigger'")
      .pluck()
      .all();
    expect([...triggers].sort()).toEqual(names.filter((n) => n !== "events").sort());
  });

  it.each(["events_no_update", "events_no_delete", "events_no_replace"])(
    "refuses a database whose %s trigger was dropped, before running a pending migration",
    (trigger) => {
      open({ migrations: V7 }).close();
      tamper(`DROP TRIGGER ${trigger}`);
      const err = refusal(StoreIntegrityError);
      expect(err.code).toBe("STORE_INTEGRITY");
      expect(err.problems).toEqual([`trigger ${trigger} is missing`]);
      expect(err.message).toContain(trigger);
      // Migration 8 was pending and did not run.
      inspect(tmp, (db) => {
        expect(db.prepare("SELECT max(version) FROM schema_migrations").pluck().get()).toBe(7);
        expect(db.prepare("SELECT count(*) FROM sqlite_master WHERE name = 'events_no_explicit_id'").pluck().get()).toBe(0);
      });
    },
  );

  it("refuses a database whose explicit-id guard was dropped", () => {
    open().close();
    tamper("DROP TRIGGER events_no_explicit_id");
    expect(refusal(StoreIntegrityError).problems).toEqual(["trigger events_no_explicit_id is missing"]);
  });

  it("refuses a database whose events table was dropped, naming the table and its triggers", () => {
    open({ migrations: V7 }).close();
    tamper("DROP TABLE events");
    expect(refusal(StoreIntegrityError).problems).toEqual([
      "table events is missing",
      "trigger events_no_update is missing",
      "trigger events_no_delete is missing",
      "trigger events_no_replace is missing",
    ]);
  });

  it.each([
    [
      "a trigger with a different body",
      "DROP TRIGGER events_no_delete; CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT 1; END;",
      "trigger events_no_delete is altered",
    ],
    ["a column added to events", "ALTER TABLE events ADD COLUMN extra TEXT", "table events is altered"],
  ])("refuses %s", (_, sql, problem) => {
    open().close();
    tamper(sql);
    expect(refusal(StoreIntegrityError).problems).toEqual([problem]);
  });

  it("refuses a trigger on events that the kernel did not create (it could swallow appends)", () => {
    open().close();
    tamper("CREATE TRIGGER events_swallow BEFORE INSERT ON events BEGIN SELECT RAISE(IGNORE); END;");
    expect(refusal(StoreIntegrityError).problems).toEqual([
      "trigger events_swallow on events was not created by the kernel",
    ]);
  });

  it.each([
    [
      "a trigger on another table that inserts into events",
      "CREATE TABLE x (a); CREATE TRIGGER fwd AFTER INSERT ON x BEGIN INSERT INTO events (kind) VALUES ('kill_switch_engaged'); END;",
      "trigger fwd on x was not created by the kernel",
    ],
    [
      "an INSTEAD OF trigger on a view that inserts into events",
      "CREATE VIEW v AS SELECT 1 AS a; CREATE TRIGGER fwd_view INSTEAD OF INSERT ON v BEGIN INSERT INTO events (kind) VALUES ('kill_switch_engaged'); END;",
      "trigger fwd_view on v was not created by the kernel",
    ],
  ])("refuses %s (it could forge appends)", (_, sql, problem) => {
    open().close();
    tamper(sql);
    expect(refusal(StoreIntegrityError).problems).toEqual([problem]);
  });

  it("refuses a foreign trigger that borrows the events table's name", () => {
    open().close();
    tamper("CREATE TRIGGER events AFTER INSERT ON events BEGIN SELECT 1; END;");
    expect(refusal(StoreIntegrityError).problems).toContain(
      "trigger events on events was not created by the kernel",
    );
  });

  describe("does not trust schema_migrations alone", () => {
    it("refuses a deleted first row with its trigger dropped, instead of re-running migration 1", () => {
      open().close();
      tamper("DELETE FROM schema_migrations WHERE version = 1; DROP TRIGGER events_no_update;");
      expect(refusal(StoreIntegrityError).problems).toEqual([
        "schema_migrations records versions 2, 3, 4, 5, 6, 7, 8, 9, 10, not a contiguous run from 1",
        "trigger events_no_update is missing",
      ]);
    });

    it("refuses a deleted middle row", () => {
      open().close();
      tamper("DELETE FROM schema_migrations WHERE version = 3");
      expect(refusal(StoreIntegrityError).problems).toEqual([
        "schema_migrations records versions 1, 2, 4, 5, 6, 7, 8, 9, 10, not a contiguous run from 1",
      ]);
    });

    it("refuses a deleted top row whose append-only object is still there", () => {
      open().close();
      // The top two rows: 8 (with its trigger) and 9 (no append-only object) together stay a contiguous top.
      tamper("DELETE FROM schema_migrations WHERE version >= 8");
      expect(refusal(StoreIntegrityError).problems).toEqual([
        "events_no_explicit_id exists but migration 8 is not recorded",
      ]);
    });

    it.each([
      ["emptied", "DELETE FROM schema_migrations"],
      ["dropped", "DROP TABLE schema_migrations"],
    ])("refuses a schema_migrations table %s while the tables exist", (_, sql) => {
      open().close();
      tamper(sql);
      const [problem] = refusal(StoreIntegrityError).problems;
      expect(problem).toMatch(/^schema_migrations records no migration, but the database already has .*events/);
    });

    // Honest limit: indistinguishable from a v7 database awaiting migrations 8 to 10.
    // The pending migrations restore the guard (9 and 10 are no-op re-runs): fail-safe, nothing lost.
    it("opens after a deleted top row together with its object, and restores the guard", () => {
      open().close();
      tamper("DELETE FROM schema_migrations WHERE version >= 8; DROP TRIGGER events_no_explicit_id;");
      const store = open();
      expect(store.appliedMigrations().map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(() => store.prepare("INSERT INTO events (id, kind) VALUES (5, 'x')").run()).toThrow(/append-only/);
    });
  });

  it("refuses a schema version newer than the kernel knows, migrating and writing nothing", () => {
    open({ migrations: V7 }).close();
    tamper("INSERT INTO schema_migrations (version, name, applied_at) VALUES (99, 'from_the_future', '2027-01-01T00:00:00.000Z')");
    const err = refusal(StoreSchemaTooNewError);
    expect(err.code).toBe("STORE_SCHEMA_TOO_NEW");
    expect(err.unknownVersions).toEqual([99]);
    expect(err.knownVersion).toBe(10);
    expect(err.message).toContain("99");
    inspect(tmp, (db) =>
      expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").pluck().all()).toEqual([
        1, 2, 3, 4, 5, 6, 7, 99,
      ]),
    );
  });

  it("refuses a newer schema whatever the migration list", () => {
    const m = (version: number): Migration => ({ version, name: `m${version}`, up: `CREATE TABLE t${version} (x)` });
    open({ migrations: [m(1), m(2)] }).close();
    const err = refusal(StoreSchemaTooNewError, [m(1)]);
    expect(err.unknownVersions).toEqual([2]);
  });

  it("re-checks after migrating: a migration that breaks the audit log is refused and the lock released", () => {
    const breaking: Migration = { version: 11, name: "breaks_events", up: "DROP TRIGGER events_no_update" };
    const err = catchError(() => new Store({ dataDir: tmp, migrations: [...migrations, breaking] }));
    expect(err).toBeInstanceOf(StoreIntegrityError);
    expect((err as StoreIntegrityError).problems).toEqual(["after migrating, trigger events_no_update is missing"]);
    acquireStoreLock(tmp).release();
  });
});

// ---------------------------------------------------------------------------
// Single-writer lock. Never skipped on any platform.
// ---------------------------------------------------------------------------

// Takes the lock through the real src/store/lock.ts (under --experimental-strip-types),
// so the child cannot drift from the kernel's acquisition steps.
const CHILD_SCRIPT = `
const { acquireStoreLock, StoreLockedError } = await import(process.env.LOCK_MODULE);
let lock;
try {
  lock = acquireStoreLock(process.env.LOCK_DIR);
} catch (err) {
  if (err instanceof StoreLockedError) {
    console.log("BUSY");
    process.exit(0);
  }
  console.log("ERROR " + (err && err.message));
  process.exit(1);
}
if (process.env.MODE === "hold") {
  console.log("READY");
  // The callback keeps \`lock\` reachable: once the eval'd module's scope is
  // collected, GC closes the connection and silently drops the lock.
  setInterval(() => lock, 1000);
} else {
  lock.release();
  console.log("ACQUIRED");
}
`;

function spawnLockChild(dir: string, mode: "hold" | "try"): { child: ChildProcess; line: Promise<string> } {
  // Node's ExperimentalWarning for strip-types goes to stderr; only stdout is read.
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", CHILD_SCRIPT],
    {
      cwd: KERNEL_DIR,
      env: { ...process.env, LOCK_MODULE: LOCK_MODULE_URL, LOCK_DIR: dir, MODE: mode },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
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
    expect((err as StoreLockedError).message).toContain(`held by pid ${child.pid} (as last recorded; may be stale)`);
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

  it("opens and keeps the lock when the PID file cannot be written", () => {
    // A directory in place of studio.lock.pid makes the informational write throw (EISDIR).
    mkdirSync(join(tmp, LOCK_PID_FILENAME));
    const a = open();
    expect(a.isOpen).toBe(true);

    // The lock is held, not leaked or dropped: a second Store here is refused.
    const err = catchError(() => new Store({ dataDir: tmp }));
    expect(err).toBeInstanceOf(StoreLockedError);
    expect((err as StoreLockedError).holderPid).toBeUndefined();

    // Closing releases it: a fresh Store opens.
    a.close();
    const b = open();
    expect(b.isOpen).toBe(true);
  });

  it("reports an unknown holder when the recorded PID is unreadable", () => {
    open();
    writeFileSync(join(tmp, LOCK_PID_FILENAME), "not-a-pid\n");
    const err = catchError(() => new Store({ dataDir: tmp }));
    expect(err).toBeInstanceOf(StoreLockedError);
    expect((err as StoreLockedError).holderPid).toBeUndefined();
  });

  it("reports an unknown holder when the PID file is missing while the holder is alive", async () => {
    const { line } = spawnLockChild(tmp, "hold");
    expect(await line).toBe("READY");
    unlinkSync(join(tmp, LOCK_PID_FILENAME));

    const err = catchError(() => new Store({ dataDir: tmp }));
    expect(err).toBeInstanceOf(StoreLockedError);
    expect((err as StoreLockedError).holderPid).toBeUndefined();
    expect((err as StoreLockedError).message).toContain("held by another writer (pid unknown)");
    expect(existsSync(join(tmp, DB_FILENAME))).toBe(false);
  });

  it("never has two holders when several processes race for the lock", async () => {
    const racers = [0, 1, 2, 3].map(() => spawnLockChild(tmp, "hold").line);
    const lines = await Promise.all(racers);
    for (const l of lines) expect(["READY", "BUSY"]).toContain(l);
    expect(lines.filter((l) => l === "READY").length).toBeLessThanOrEqual(1);
  });

  it("Store.close() twice is harmless and never drops a later holder's lock", async () => {
    const a = open();
    a.close();
    expect(a.isOpen).toBe(false);
    const b = open();
    expect(() => a.close()).not.toThrow();
    expect(b.isOpen).toBe(true);
    expect(await childTry(tmp)).toBe("BUSY");
  });

  it("StoreLock.release() twice is harmless and never drops a later holder's lock", async () => {
    const first = acquireStoreLock(tmp);
    first.release();
    const second = acquireStoreLock(tmp);
    expect(() => first.release()).not.toThrow();
    expect(await childTry(tmp)).toBe("BUSY");
    second.release();
    expect(await childTry(tmp)).toBe("ACQUIRED");
  });

  it("refuses a studio.db that did not enter WAL mode, closing it and releasing the lock", () => {
    const opened: Database.Database[] = [];
    const err = catchError(
      () =>
        new Store(
          { dataDir: tmp },
          {
            // Stand-in for a filesystem where WAL is unsupported: SQLite then
            // keeps the old mode and reports it instead of throwing.
            openDatabase: (path) => {
              const db = new Database(path);
              opened.push(db);
              const real = db.pragma.bind(db);
              db.pragma = ((source: string, options?: Database.PragmaOptions) =>
                source.startsWith("journal_mode") ? "delete" : real(source, options)) as typeof db.pragma;
              return db;
            },
          },
        ),
    );
    expect((err as Error).message).toBe("studio.db did not enter WAL mode (journal_mode=delete)");
    expect(opened.map((db) => db.open)).toEqual([false]);
    inspect(tmp, (db) => expect(tableNames(db)).toEqual([]));
    open().close();
  });
});

describe("acquireStoreLock: bounded retry", () => {
  const coded = (code: string): Error => Object.assign(new Error(code), { code });
  const realOpen = (path: string): Database.Database => new Database(path, { timeout: 0 });

  it("retries a few times with 10-100 ms of backoff", () => {
    expect(LOCK_RETRIES).toBeGreaterThanOrEqual(3);
    expect(LOCK_RETRIES).toBeLessThanOrEqual(5);
    expect([LOCK_RETRY_MIN_MS, LOCK_RETRY_MAX_MS]).toEqual([10, 100]);
  });

  it("acquires after a BUSY attempt once the holder lets go, with the same steps", () => {
    const holder = acquireStoreLock(tmp);
    const sleeps: number[] = [];
    let opens = 0;
    const lock = acquireStoreLock(tmp, {
      open: (path) => {
        opens++;
        return realOpen(path);
      },
      // The first attempt hit a real BUSY; the holder lets go during the backoff.
      sleep: (ms) => {
        sleeps.push(ms);
        holder.release();
      },
      random: () => 0.5,
    });
    expect(opens).toBe(2);
    expect(sleeps).toEqual([55]);
    // The retry holds the real lock.
    expect(catchError(() => acquireStoreLock(tmp, { sleep: () => {} }))).toBeInstanceOf(StoreLockedError);
    lock.release();
  });

  it("treats an injected SQLITE_BUSY_* result as BUSY and acquires on the next attempt", () => {
    const sleeps: number[] = [];
    let opens = 0;
    const lock = acquireStoreLock(tmp, {
      open: (path) => {
        opens++;
        if (opens === 1) throw coded("SQLITE_BUSY_TIMEOUT");
        return realOpen(path);
      },
      sleep: (ms) => sleeps.push(ms),
      random: () => 0,
    });
    expect(opens).toBe(2);
    expect(sleeps).toEqual([10]);
    lock.release();
  });

  it("refuses after the bounded retries when every attempt is BUSY, sleeping 10-100 ms before each", () => {
    const holder = acquireStoreLock(tmp);
    const sleeps: number[] = [];
    const draws = [0, 0.999999, 0.5, Number.NaN, 0.25];
    let opens = 0;
    const err = catchError(() =>
      acquireStoreLock(tmp, {
        open: (path) => {
          opens++;
          return realOpen(path);
        },
        sleep: (ms) => sleeps.push(ms),
        random: () => draws.shift() ?? 0,
      }),
    );
    expect(err).toBeInstanceOf(StoreLockedError);
    expect((err as StoreLockedError).holderPid).toBe(process.pid);
    expect((err as StoreLockedError).message).toContain("may be stale");
    expect(opens).toBe(LOCK_RETRIES + 1);
    expect(sleeps).toHaveLength(LOCK_RETRIES);
    for (const ms of sleeps) {
      expect(ms).toBeGreaterThanOrEqual(LOCK_RETRY_MIN_MS);
      expect(ms).toBeLessThanOrEqual(LOCK_RETRY_MAX_MS);
    }
    expect(sleeps.slice(0, 2)).toEqual([10, 100]);
    holder.release();
  });

  it("rethrows a non-BUSY error at once, without retrying", () => {
    const ioerr = coded("SQLITE_IOERR");
    const sleeps: number[] = [];
    let opens = 0;
    const err = catchError(() =>
      acquireStoreLock(tmp, {
        open: () => {
          opens++;
          throw ioerr;
        },
        sleep: (ms) => sleeps.push(ms),
      }),
    );
    expect(err).toBe(ioerr);
    expect(opens).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("rethrows a real non-BUSY error (studio.lock is a directory) and creates no studio.db", () => {
    mkdirSync(join(tmp, "studio.lock"));
    const err = catchError(() => new Store({ dataDir: tmp }));
    expect(err).not.toBeInstanceOf(StoreLockedError);
    expect((err as { code?: unknown }).code).toMatch(/^SQLITE_/);
    expect((err as { code?: unknown }).code).not.toMatch(/^SQLITE_BUSY/);
    expect(existsSync(join(tmp, DB_FILENAME))).toBe(false);
  });
});
