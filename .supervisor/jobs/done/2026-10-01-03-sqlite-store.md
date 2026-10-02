# Supervisor Job: SQLite store, migrations and the append-only audit log

## Environment
- **Project:** loomwright-studio (repo root)
- **CLAUDE.md:** ✓ Found (fresh — describes kernel/)
- **Git:** clean except the tracked automate run file (`.supervisor/automate/*.md`, written by the engine — never stage it in this job), branch: main @ ecfa9ae
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Node / npm (local):** v22.14.0 / 10.9.2
- **Blockers:** 0 | **Warnings:** 1 (dirty tracked run file — commit with explicit paths only)
- **Source requirement:** .supervisor/requirements/phase-1/03-sqlite-store.md
- **Base commit:** ecfa9ae

## Feasibility
- **Verdict:** CAUTION — `better-sqlite3` ^13 is already a dependency (D30) and this is the first item whose tests load the native module, in CI too (13.0.3 ships bundled prebuilds and no install script). A PID-file single-writer lock has two real holes (double takeover of a dead lock; PID reuse after a reboot blocking restart) — the brief uses an OS-held lock instead (probed below).

## Task
**Goal:** Implement `kernel/src/store/`: a `Store` class that opens `studio.db` in the Studio data dir (WAL, `foreign_keys=ON`, dir mode 0700), applies numbered migrations transactionally, enforces one writer per data dir with an OS-held SQLite exclusive lock on `<dataDir>/studio.lock` (released by the OS when the holder dies), and creates the phase-1 schema with an append-only `events` audit log.

**Problem Statement:**
The kernel (invariant 2, D2) needs durable state that survives `kill -9`, and the safety kernel (invariant 3) needs an audit trail of everything it did.
Currently `kernel/src/store/index.ts` exports nothing; there is no database, no schema and no enforcement of "one writer: the kernel" (`docs/ARCHITECTURE.md` §Data model).
Success looks like a tested `Store` that every later item (04–09) writes through, whose `events` rows cannot be updated or deleted, and which refuses a second live writer and lets the next open succeed after the holder dies (including `kill -9`), with no stale-lock cleanup.

## Acceptance Criteria
- [ ] AC1 — Given a first start, when the store opens `~/.loomwright-studio/studio.db` (data dir overridable by `STUDIO_DATA_DIR`), then it creates the directory with mode 0700 and the database with `journal_mode=WAL` and `foreign_keys=ON`.
- [ ] AC2 — Given numbered migrations in `kernel/src/store/migrations/`, when the store opens, then it applies pending ones in ascending order, each inside its own transaction, records each in `schema_migrations`, and reopening is a no-op. A migration that throws leaves the database unchanged (no partial tables, no `schema_migrations` row).
- [ ] AC3 — Given migration 1, when applied, then it creates exactly these phase-1 tables: `tasks`; `sessions` (including `pgid`, `auth_account`, `sdk_session_id`, `status`, `model`); `events` (the audit log); `budget`; `work_steps` (`key` UNIQUE, `status` CHECK in `started`/`done`/`failed`, `result_json`, timestamps); `wakeups`; `cap_state` (`account`, `rate_limit_type`, `status`, `resets_at`, `updated_at`). No phase-2+ tables (agents, playbooks, triggers, approvals, hooks_installed, connectors).
- [ ] AC4 — Given the `events` table, when any code issues UPDATE or DELETE on it, then a trigger raises and the row is unchanged. INSERT is the only write.
- [ ] AC5 — Given the store API, when used, then every write goes through one `Store` class. A second process (or a second `Store` in the same process) opening the same data dir for writing while the holder is alive is refused with a typed `StoreLockedError` (naming the holder's last-recorded PID when available); after the holder dies — including `kill -9` — the next open succeeds with no manual cleanup.
- [ ] AC6 — Tests: write → close → reopen persists data; a throw inside `Store.transaction` commits nothing; a migration that throws leaves no table and no `schema_migrations` row (via an injected migrations list); `events` UPDATE and DELETE are rejected and the row is unchanged; a live child process holding the lock ⇒ `StoreLockedError`, then `kill -9` the child ⇒ open succeeds; same-process second `Store` ⇒ `StoreLockedError`.

## Outcomes Rubric
- `kernel/src/store/migrations/` contains a migration numbered 1 and the store records applied versions in a `schema_migrations` table.
- Migration 1 creates `tasks`, `sessions`, `events`, `budget`, `work_steps`, `wakeups`, `cap_state` and no table named `agents`, `playbooks`, `triggers`, `approvals`, `hooks_installed` or `connectors`.
- `sessions` has columns `pgid`, `auth_account`, `sdk_session_id`, `status`, `model`; `work_steps.key` is UNIQUE; `cap_state` has `account`, `rate_limit_type`, `status`, `resets_at`, `updated_at`.
- The schema defines BEFORE UPDATE and BEFORE DELETE triggers on `events` that RAISE.
- The store sets `journal_mode=WAL` and `foreign_keys=ON`, creates the data dir with mode 0700, and honours `STUDIO_DATA_DIR`.
- Tests cover: persistence across reopen, rollback on throw, failed-migration atomicity, events UPDATE/DELETE rejection, live-lock refusal (second process and same process), and a successful open after `kill -9` of the lock holder.

## Implementation Notes (verified at planning time)
- **Migrations as TypeScript modules, not `.sql` files.** `tsc` does not copy non-TS assets into `dist/`, so `.sql` files would vanish from the built daemon (and the new CI build + smoke steps would not catch it until runtime). Use e.g. `migrations/001_initial.ts` exporting `{ version: 1, name, up: string | (db) => void }` and an `index.ts` that exports the ordered list. Assert in a test that versions are strictly increasing and contiguous.
- **Transactions:** use `better-sqlite3`'s `db.transaction(fn)` (synchronous; rolls back on throw). Apply each migration + its `schema_migrations` insert in ONE transaction. Expose a `Store.transaction(fn)` for callers; AC6's crash test throws inside it.
- **WAL/foreign_keys:** `db.pragma('journal_mode = WAL')`, `db.pragma('foreign_keys = ON')` on every open (foreign_keys is per-connection). Assert both via `db.pragma(..., { simple: true })` in tests.
- **Data dir:** `fs.mkdirSync(dir, { recursive: true, mode: 0o700 })` then `chmodSync(dir, 0o700)` (the mode option is not applied to a pre-existing dir). The mode test must point at a NOT-yet-existing subdirectory of a `mkdtemp` dir (the `mkdtemp` dir itself is already 0700, so testing it passes trivially) and assert `(stat.mode & 0o777) === 0o700`. Every test uses its own `mkdtemp` dir — never the real home.
- **Single-writer lock (AC5 + requirement Risk) — an OS-held lock, NOT a PID file.** A PID file has two holes: two starters can both take over a dead lock (any rename/unlink/re-read scheme is still check-then-act), and after a crash + reboot the stale PID is often reused (even by the new kernel itself), so a fail-closed liveness check blocks restart — exactly what the requirement's Risks line forbids. Instead: a separate lock database `<dataDir>/studio.lock` opened with `better-sqlite3` (`{ timeout: 0 }`), `PRAGMA locking_mode = EXCLUSIVE`, then one write (`CREATE TABLE IF NOT EXISTS owner(pid INTEGER, started_at TEXT); DELETE FROM owner; INSERT …`) — that write takes SQLite's exclusive file lock and holds it for the life of the connection; the OS releases it when the process dies, so a stale lock cannot exist and there is no takeover logic at all. After acquiring, also write the PID to a plain `<dataDir>/studio.lock.pid` file — informational ONLY, never read to decide anything (an exclusive SQLite lock blocks readers of the lock DB too, so the PID can't be read from it). `SQLITE_BUSY` on that write ⇒ throw `StoreLockedError`, with the PID from `studio.lock.pid` when it parses (it may be stale or missing; the message says "held by pid N (as last recorded)"). The lock connection is kept open by the `Store` and closed in `close()`. **Pin the probed configuration:** the lock DB uses SQLite's default `journal_mode=DELETE` (the probe never set WAL) with exactly `{ timeout: 0 }` → `PRAGMA locking_mode = EXCLUSIVE` → the one write. Open it in `lock.ts` directly, never through the `studio.db` open helper. **Never open `studio.lock` (or its `-journal`) with `node:fs` or any non-SQLite API inside the kernel process.** It is a POSIX fcntl lock owned by the process, so closing ANY descriptor on that file drops the lock silently, and nothing would fail. Only `lock.ts` touches it, through better-sqlite3; the PID lives in the separate `studio.lock.pid`. **Order in `Store` open:** mkdir/chmod the data dir → acquire the lock → only then open `studio.db` → pragmas → migrations. On `StoreLockedError` the loser never opens or creates `studio.db`. It is a separate file so `studio.db` itself stays readable by inspection tools. **Probed on this Mac (2026-10-01, better-sqlite3 13.0.3):** holder alive ⇒ another process gets `SQLITE_BUSY`; after `kill -9` of the holder ⇒ the next process acquires immediately; a second connection in the SAME process ⇒ `SQLITE_BUSY`; no stale files. This satisfies the requirement's intent ("a lock file under the data dir … so the one-writer rule is enforced"; "a lock that goes stale after kill -9 must not block restart") with a stronger mechanism than its suggested live-PID check — the PID is still recorded, for the error message. Honest limit: SQLite file locks are advisory and unreliable on network filesystems; the data dir is local (`~/.loomwright-studio`).
- **Lock tests (AC5/AC6) — never skipped, on any platform (the probe was macOS-only; ubuntu CI is the Linux proof):** (1) live child: spawn a long-lived child (`node -e` script that takes the lock exactly as `lock.ts` does, writes `studio.lock.pid`, prints a ready line, then `setInterval`), wait for ready, assert `new Store({ dataDir })` throws `StoreLockedError` naming the child's PID AND that no `studio.db` was created in that fresh dir (lock is taken before the DB is opened), then `kill('SIGKILL')` the child, wait for exit, and assert the next open succeeds; (2) same process: Store A holds, Store B in the same process is refused and closes its failed connection, THEN a child process attempting the lock is still refused (the refused opener's close must not release A's lock); (3) clean close: after `A.close()` a child acquires the lock. Always close stores and kill children in `afterEach`.
- **Injection points:** `new Store({ dataDir?, migrations? })` — `dataDir` defaults to a pure `resolveDataDir(env)` (default `path.join(os.homedir(), '.loomwright-studio')`, `STUDIO_DATA_DIR` overrides) tested directly, never by mutating `process.env`; `migrations` defaults to the real ordered list, and the failed-migration test passes a list whose second migration throws.
- **ESM conventions in this package:** relative imports use the `.js` suffix (`./version.js`), type-only imports use `import type` (`verbatimModuleSyntax`), `noUncheckedIndexedAccess` is on.
- **events append-only:** `CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;` and the same for DELETE. Test both raise and the row is unchanged.
- **Scope of columns** beyond those AC3 names: follow `docs/ARCHITECTURE.md` §Data model for `tasks`/`sessions`/`budget` (a minimal faithful set; `budget` per D26 counts input+output+cache-write and records cache-read separately), keep `id INTEGER PRIMARY KEY` or TEXT ids consistently, and add `created_at`/`updated_at` as ISO text. Don't invent phase-2 columns that reference phase-2 tables (no FK to `agents`). `wakeups` needs at least `id`, `due_at`, `reason`, `status`/`fired_at` (item 07 fires each exactly once by id). `wakeups` and `cap_state` are not in ARCHITECTURE.md's Data model table yet — note that doc drift in the PR body (follow-up, outside this job's lanes). Also note in the PR that item 07's durable event queue (with a `done` status) needs its own table: the append-only `events` audit log must never be loosened for it.
- **No session code, no auth code, no SDK import** (requirement Out of scope; backlog rule: unit tests never call the SDK or a model).
- **CI:** existing `ci` job runs `npm ci`, typecheck, test, build, `--version` smoke for `kernel/`. Tests now load `better-sqlite3`'s native binary on `ubuntu-latest` — the PR's CI run is the proof.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Store, migrations, lock, schema, tests | AC 1–6 | 1 modify, 5 create | unit-testing, error-handling | LAUNCHABLE |

## Subtask Contracts

```yaml
# Subtask 1 — SQLite store (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/src/store/index.ts"}
  - {kind: "file", path: "kernel/src/store/store.ts"}
  - {kind: "file", path: "kernel/src/store/lock.ts"}
  - {kind: "file", path: "kernel/src/store/migrations/index.ts"}
  - {kind: "file", path: "kernel/src/store/migrations/001_initial.ts"}
  - {kind: "file", path: "kernel/test/store.test.ts"}
  - {kind: "symbol", path: "kernel/src/store/store.ts", name: "Store"}
  - {kind: "symbol", path: "kernel/src/store/lock.ts", name: "StoreLockedError"}
requires: []
lanes:
  - "kernel/src/store/**"
  - "kernel/test/**"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | — | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `unit-testing` (vitest, tmp dirs, child-process PID), `error-handling` (typed `StoreLockedError`). Read `CLAUDE.md` invariants 2/3, `docs/ARCHITECTURE.md` §Data model, `docs/DECISIONS.md` D2/D26/D30 |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): `better-sqlite3` native binary fails to load on CI | LOW | 13.0.3 loads a bundled `prebuilds/linux-x64.node` (no install script, no source build); `@types/better-sqlite3` ^9.6 is versioned separately — typecheck + this PR's CI run are the proof. Don't switch libraries without the owner (D30) |
| Feasibility (Phase 2.5): stale lock / takeover race / PID reuse | MEDIUM | OS-held SQLite exclusive lock (probed): released by the OS on any process death, so no stale state and no takeover code; live-child, `kill -9`, same-process and clean-close tests |
| A `node:fs` open+close of `studio.lock` in-process silently drops the POSIX lock | MEDIUM | Only `lock.ts` touches the file, through better-sqlite3; PID kept in `studio.lock.pid`; the same-process refusal test proves a refused opener's close keeps the holder's lock |
| `.sql` migrations missing from `dist/` | MEDIUM | Migrations are TS modules (Implementation Notes) |
| `mkdir` mode masked by umask / ignored for existing dir | LOW | `chmodSync` after create + a stat assertion |
| Tests touching the real `~/.loomwright-studio` | MEDIUM | Every test passes its own `mkdtemp` dir as `new Store({ dataDir })`; `resolveDataDir` is tested with a literal env object |
| Committing the engine's tracked run file with the feature | MEDIUM | Stage explicit `kernel/` paths only |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-01-03-sqlite-store.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-01T18:55:11Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/9
- **Branch:** feature/phase1-03-sqlite-store
- **Files changed:** 7
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Store (0700 data dir, WAL + foreign_keys, TS-module migrations in transactions), migration 1 with the 7 phase-1 tables, append-only events (UPDATE/DELETE/REPLACE triggers + positive-id CHECK), and an owner-approved OS-held SQLite single-writer lock. Review FAIL→fix (events -1 sentinel)→PASS; rubric 6/6; 7 MEDIUM/LOW findings dismissed for owner decision.

## Not verified
- **Linux (ubuntu-latest CI) lock behaviour and native better-sqlite3 load** — only run on macOS by the worker; the PR's CI run is the proof (subtask 1)
