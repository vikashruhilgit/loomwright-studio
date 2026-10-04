# Supervisor Job: H03 — the store refuses a broken audit log or a newer schema, keeps `events` in append order, and retries its lock

## Environment
- **Project:** loomwright-studio (repo root)
- **CLAUDE.md:** ✓ Found (fresh — invariant 3 applies: the kill switch's durable state is derived from `events`, so the store's append-only guarantees are part of the fixed safety kernel; invariant 2: durable state lives on disk)
- **Git:** clean except the automate engine's run file (`.supervisor/automate/automate-2026-10-03-180512.md`, modified) and two untracked owner files (`.supervisor/requirements/h01-launchd-start-failure-and-reinstall-plan.md`, `.supervisor/requirements/phase-1-hardening/_BACKLOG.md`). Never stage any of them in this job; commit with explicit paths only. Branch: main @ 056f59e
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Node / npm (local):** v22.14.0 (CI: ubuntu-latest, `node-version: 22`; `.github/workflows/ci.yml` runs `bash scripts/check-docs.sh`, then in `kernel/` `npm ci`, `npm run typecheck`, `npm test`, `npm run build` — tests run BEFORE the build, so no test may depend on `kernel/dist`)
- **Blockers:** 0 | **Warnings:** 1 (dirty automate trail files — commit with explicit paths only)
- **Source requirement:** .supervisor/requirements/phase-1-hardening/03-store-integrity.md
- **Base commit:** 056f59e126049d8e42b8f783178b5b5b500e07c9

## Feasibility
- **Verdict:** GO
- Tech stack — GO: strict TypeScript kernel (NodeNext, vitest), better-sqlite3 13; no new package.
- Dependencies — GO: none new. `node --experimental-strip-types` imports `kernel/src/store/lock.ts` directly on Node 22.14 (probed at planning time: `import("./src/store/lock.ts")` → `StoreLockedError`, `acquireStoreLock`), which is how AC7's child can import the real module without a build.
- Architecture fit — GO: invariant 3 (kill switch derived from `events`, `docs/ARCHITECTURE.md:109`); migrations are append-only TS modules (`kernel/src/store/migrations/index.ts:12` "never edit a shipped one").
- Scope — GO: one worker; ~7 files modified, 1–2 created.
- Hard blockers — none.

## Task
**Goal:** Opening the store refuses — with a typed error, writing nothing — a database whose `events` table or append-only triggers are missing or altered, or whose `schema_migrations` holds a version this kernel doesn't know; `events` ids always follow append order (an explicit id is refused); `Store.exec`'s DDL hole is documented or removed; the store lock retries a BUSY result a few times with jittered backoff and says the recorded PID may be stale; the store tests cover the four untested paths and the lock-holding test child imports the real `lock.ts`.

## Acceptance Criteria
- [ ] AC1 — Given a database whose `events` table, or any of its three append-only triggers (`events_no_update`, `events_no_delete`, `events_no_replace`), is missing or altered, when the store opens, then it refuses with a typed error naming what's missing or altered and writes nothing. A test drops each trigger in turn, and the table, and asserts the refusal (and that nothing was written: no new `schema_migrations` row, no new object).
- [ ] AC2 — Given `Store.exec`, when someone reads its doc, then the doc says the triggers block DML, not DDL, and that `exec` can defeat them — OR `exec` is removed from the public surface. The implementer decides after a grep of callers and records the choice in the commit message and PR body. (Planning-time grep: zero callers of `Store.exec` in `kernel/src` and `kernel/test`; removal is the recommended choice.)
- [ ] AC3 — Given any sequence of inserts into `events`, including an attempted insert with an explicit id up to max-int (9223372036854775807), when the rows are read `ORDER BY id`, then the order equals append order. Fix is either (a) a new migration that adds a guard trigger refusing any explicit positive id (recommended — see Implementation Notes), or (b) a migration that rebuilds `events` with AUTOINCREMENT keeping every row, id and trigger. A test covers the max-int case — binding the id as a BigInt (`9223372036854775807n`) or a SQL literal, never a JS Number (which rounds to 2^63, out of int64 range, and would fail with a datatype error for the wrong reason) — asserting the guard's own message (`/append-only/`), then appending auto-id rows and asserting `ORDER BY id` equals append order; and a test seeds `events` rows on a v7 database (migrations 1–7 only), reopens with the default list (applying the new migration) and asserts every row — id and all columns — is byte-for-byte unchanged (cheap under (a), required under (b)).
- [ ] AC4 — Given a database whose `schema_migrations` holds a version newer than this kernel knows (e.g. 99), when the store opens, then it refuses with a typed error and doesn't migrate or write (no new `schema_migrations` row, no new table).
- [ ] AC5 — Given two starters racing for the store lock, when they start, then one acquires it; the loser retries 3–5 times with 10–100 ms of jittered backoff, using the same acquisition sequence, before refusing; there are still never two holders. The refusal message says the recorded PID may be stale. Tests are deterministic: they inject a BUSY result followed by success (acquires), and a BUSY result on every attempt (refuses after the bounded retries, sleeps within 10–100 ms each).
- [ ] AC6 — Given the store tests, when they run, then they cover: the non-BUSY rethrow (`lock.ts:76`), the did-not-enter-WAL throw (`store.ts:66-68`), a missing PID file while the holder is alive, and an explicit double `close()` (Store) and double `release()` (lock).
- [ ] AC7 — Given the test child that holds the competing lock, when it takes the lock, then it imports the real `kernel/src/store/lock.ts` (via `node --experimental-strip-types`), so it can't drift from the kernel's steps; the hand-copied `CHILD_SCRIPT` lock steps go away.

## Implementation Notes (verified at planning time, main @ 056f59e)
**Files read:**
- `kernel/src/store/lock.ts` (115 lines): `acquireStoreLock(dataDir)` opens `new Database(path, { timeout: 0 })` (:60), `locking_mode = EXCLUSIVE` (:61), one write (:62-68); on error closes and maps `SQLITE_BUSY*` to `StoreLockedError` (:69-77), else rethrows (:76). `StoreLockedError` message `held by pid N (as last recorded)` / `another writer (pid unknown)` (:20-29). PID file written best-effort (:83-87). `release()` is `if (held.open) held.close()` (:92-94). Header "Honest limit" (:51-52) describes the no-retry behaviour — update it. Imports only `node:fs`, `node:path`, `better-sqlite3`: **keep it free of relative imports and use erasable TypeScript only** (no enums, parameter properties or namespaces — the new AC5 deps type included) so AC7's strip-types child can import it (strip-types does not map `./x.js` to `./x.ts` and rejects non-erasable syntax; the repo's tsconfig has no `erasableSyntaxOnly` to enforce it). Say so in the file header.
- `kernel/src/store/store.ts` (169 lines): constructor = `ensureDataDir` → `acquireStoreLock` → open `studio.db` → `journal_mode = WAL` check (:65-68) → `foreign_keys = ON` → `applyMigrations` (:71); any throw closes db and releases lock (:72-76). `exec` (:90-92). `close()` idempotent (:112-115). `applyMigrations` (:136-169) validates the list is contiguous from 1, reads applied versions, skips applied ones, accepts unknown ones (F03-4).
- `kernel/src/store/migrations/001_initial.ts` (136 lines): `events` with `id INTEGER PRIMARY KEY CHECK (id > 0)` (:54-62) and triggers `events_no_update` (:64-67), `events_no_delete` (:69-72), `events_no_replace` (:78-82, `WHEN NEW.id > 0 AND EXISTS(...)`). In a BEFORE INSERT trigger an auto-assigned id reads `NEW.id = -1` (:52-53, :76-77), so `NEW.id > 0` means "explicit id given".
- `kernel/src/store/migrations/index.ts`: ordered list 001–007, "Append only; never edit a shipped one". The next free number is **008** (H05 also adds a migration; whichever lands second renumbers).
- `kernel/src/store/index.ts`: public exports (`Store`, `StoreLockedError`, …). `acquireStoreLock` is NOT re-exported.
- `kernel/src/api/kill-switch.ts`: state = latest of `kill_switch_engaged`/`kill_switch_released` `ORDER BY id DESC` (:22-37). All six production writers omit `id`: `auth/notify.ts:53`, `sessions/manager.ts:1595`, `api/kill-switch.ts:45`, `api/server.ts:275`, `loop/internal.ts:18`, `budget/internal.ts:44`.
- `kernel/src/daemon-exit.ts`: `permanentReason` allowlist (:57-62) — `StoreLockedError` ⇒ permanent (launchd does not restart). New store errors fall to "transient" by default (see Risks; not changed in this job).
- `kernel/test/store.test.ts` (552 lines): events trigger tests (~:333-408, incl. explicit-id tamper attempts at :372, :382, :392, :398 that must stay green), `CHILD_SCRIPT` (:416-444) hand-copies the lock steps, `spawnLockChild` (:446+), lock tests (:489-552) incl. `toContain("held by pid ${child.pid} (as last recorded)")` (:497) and holder-unknown cases (:528-551).
- `kernel/test/daemon-exit.test.ts:88` asserts the exact `StoreLockedError` message line — update it if the wording changes.

**Design (recommended; the worker may deviate with a recorded reason):**
1. **AC3 via guard trigger (option a), migration `008_events_explicit_id_guard.ts`:** `CREATE TRIGGER events_no_explicit_id BEFORE INSERT ON events WHEN NEW.id > 0 BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;`. Why over AUTOINCREMENT: no table rebuild on the audit table (the requirement's top risk), rows untouched by construction, and it is strictly stronger — AUTOINCREMENT still accepts an explicit id into a gap below the max, which breaks append order. `INSERT … (id) VALUES (NULL, …)` stays allowed (`NEW.id = -1`), the `CHECK (id > 0)` still rejects non-positive explicit ids (the :392 test), the existing upsert/replace tests keep failing for the same reason. Append it to `migrations/index.ts`; update the store test that lists the default migrations (~:175).
2. **One integrity/compatibility check, split around migrations (AC1 + AC4 + the "older DB mid-migration" risk):** a function (e.g. `kernel/src/store/integrity.ts`, no relative imports needed by lock.ts) that knows, per kernel migration version, the append-only objects it creates (v1: table `events` + its 3 triggers; v8: `events_no_explicit_id`) and their exact `sqlite_master.sql` text. In `Store`'s constructor, after the WAL/foreign_keys pragmas and BEFORE applying pending migrations: (i) refuse (AC4) if any applied version is not in the kernel's list (`> list.length`); (ii) refuse (AC1) if any object created by an ALREADY-APPLIED migration is missing or its `sql` differs. Then apply pending migrations, then re-check the full set (a failure there is a migration bug). This writes nothing on a tampered/newer DB (the pre-check throws before any migration runs) and never refuses an older DB whose later migrations are simply pending. On refusal: close db, release lock (existing catch path), throw.
   - **Typed errors** (exported from `store/index.ts`), e.g. `StoreIntegrityError` (`code = "STORE_INTEGRITY"`, lists each missing/altered object by name) and `StoreSchemaTooNewError` (`code = "STORE_SCHEMA_TOO_NEW"`, names the unknown version(s)); names are the worker's call.
   - **Gate on code, not on DB contents:** run the AC1 object check only when the Store's migration list contains the real `initial` migration (identity/`version 1 && name "initial"` from the code-side list) — tests that open with fake lists (`m(1)`, `{name: "ok"}`) must keep passing. Never gate on a `schema_migrations` row name (DML-tamperable). The AC4 check applies to every list.
   - **Don't trust `schema_migrations` alone (it has no triggers, so it is DML-tamperable like everything else).** Before the object check, also refuse with the integrity error when: (iii) the applied versions are not a contiguous prefix `{1..k}` (a deleted middle or first row — e.g. row 1 deleted while `events` exists would otherwise re-run 001 and fail with an untyped `table tasks already exists`); (iv) `schema_migrations` is absent or empty while `events` (or any other v1 table) exists; (v) a known append-only object of a NOT-yet-applied version already exists (e.g. `events_no_explicit_id` present while version 8 is not recorded — a deleted top row). Honest limits, documented in `integrity.ts` and the PR body: deleting the TOP row(s) together with the objects those migrations created is byte-identical to an older database awaiting them, so it cannot be refused; the pending migration then recreates the object, which is the fail-safe outcome (the guard is restored, nothing is lost). Deleting only a top row whose migration created non-append-only objects (e.g. 007's `event_queue`) makes that migration re-run and fail with an untyped `already exists`: fail-closed, the transaction rolls back and nothing is written, but the error is untyped. Test: delete a middle `schema_migrations` row (or row 1) and drop the matching trigger ⇒ typed refusal, nothing written.
   - **Alterations, not only creations:** document in `integrity.ts` that a future migration which ALTERs an append-only object (e.g. `ALTER TABLE events ADD COLUMN`) must update that object's expected text for its version, or every open after it would be refused.
   - **Pin the expected text:** a test opens a fresh store and asserts every expected `sql` string equals what SQLite stored, so the constants can't drift from 001/008.
   - **Record the deviation:** the requirement's Risks say "the check runs after migrations are applied"; this design checks applied-version objects BEFORE migrating (so a tampered/newer DB is refused with nothing written, per AC1/AC4) and the full set after. The PR body states this split and why.
3. **AC2:** recommended — remove `exec` from `Store` (zero callers); if kept, its doc must say the triggers block DML not DDL and `exec` can drop them (which the next open then refuses via AC1).
4. **AC5 retry in `acquireStoreLock`:** keep the exact acquisition sequence per attempt (new `Database(path, {timeout: 0})` → `locking_mode = EXCLUSIVE` → the write; close the failed handle each attempt). Retries: 3–5 after the first attempt, each preceded by a jittered sleep in [10, 100] ms; a non-BUSY error rethrows immediately (no retry). The constructor is synchronous, so sleep synchronously (e.g. `Atomics.wait` on a `SharedArrayBuffer`). Add an optional internal deps parameter (e.g. `{ open, sleep, random }`) for the deterministic tests; `acquireStoreLock` stays unexported from `store/index.ts`. Message: keep `pid N (as last recorded` and add that it may be stale, e.g. `held by pid N (as last recorded; may be stale)`; update `store.test.ts:497` and `daemon-exit.test.ts:88`.
5. **AC6:** non-BUSY rethrow — injected `open` throwing a non-BUSY coded error (or `studio.lock` as a directory); WAL throw — find a real trigger or add a narrow, documented test-only seam that cannot change production behaviour; missing PID file — hold the lock in a child, delete `studio.lock.pid`, assert `StoreLockedError` with `holderPid === undefined` and the stale/unknown wording; double close/release — call each twice explicitly, no throw, lock released (another opener then succeeds).
6. **AC7:** the child runs `process.execPath` with `--experimental-strip-types` and `--input-type=module -e` (or a small fixture `.mjs`) that `import`s `kernel/src/store/lock.ts` by absolute file URL and calls `acquireStoreLock`, printing `READY`/`ACQUIRED`/`BUSY` as today. Keep `spawnLockChild`'s protocol; drop the copied steps. Tolerate Node's ExperimentalWarning on stderr.

## Subtask Structure

| # | Title | Criteria | Est. Files | Skills | Status |
|---|-------|----------|-----------|--------|--------|
| 1 | Store integrity: open-time checks, explicit-id guard, lock retry, test coverage | AC1–AC7 | 7 modify, 1–2 create | unit-testing, error-handling | LAUNCHABLE |

## Subtask Contracts
```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/store/migrations/008_events_explicit_id_guard.ts"}
  - {kind: "symbol", path: "kernel/src/store/lock.ts", name: "acquireStoreLock"}
  - {kind: "symbol", path: "kernel/src/store/lock.ts", name: "StoreLockedError"}
  - {kind: "symbol", path: "kernel/src/store/store.ts", name: "Store"}
  - {kind: "symbol", path: "kernel/src/store/migrations/index.ts", name: "migrations"}
  - {kind: "file", path: "kernel/test/store.test.ts"}
requires: []
lanes:
  - "kernel/src/store/**"
  - "kernel/test/store.test.ts"
  - "kernel/test/daemon-exit.test.ts"
  - "docs/ARCHITECTURE.md"
external_requires:
  - "Node >= 22.6 --experimental-strip-types (AC7 child; probed on local 22.14; CI uses node-version 22)"
  - "better-sqlite3 13 trigger semantics: auto-assigned rowid reads NEW.id = -1 in BEFORE INSERT (documented in 001_initial.ts:52-53, already relied on)"
```
Modified (est.): `kernel/src/store/lock.ts`, `kernel/src/store/store.ts`, `kernel/src/store/index.ts`, `kernel/src/store/migrations/index.ts`, `kernel/test/store.test.ts`, `kernel/test/daemon-exit.test.ts`, `docs/ARCHITECTURE.md` (the `events` row and/or the kill-switch paragraph: the store refuses a broken audit log or a newer schema at open; explicit ids refused). Created (est.): `kernel/src/store/migrations/008_events_explicit_id_guard.ts`, optionally `kernel/src/store/integrity.ts`.

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
- `skills/unit-testing/SKILL.md` — vitest, temp data dirs, child processes for the lock, deterministic injected BUSY sequences (no timing races)
- `skills/error-handling/SKILL.md` — typed errors with stable `code`s, fail closed, release every resource on the refusal path

## Risk Assessment
| Risk | Impact | Likelihood | Mitigation | Source |
|------|--------|-----------|------------|--------|
| A rebuild of `events` loses or reorders audit rows | HIGH | LOW | Recommended design adds a guard trigger instead (no rebuild); if option (b) is chosen, recreate triggers in the same transaction and assert rows byte-for-byte | Requirement "Risks" |
| The integrity check refuses an older DB mid-migration | HIGH | MEDIUM | Pre-check only objects of already-applied migrations; full re-check after migrating; test opens a v7 DB (no 008) and succeeds | Requirement "Risks" |
| A double tamper (delete a `schema_migrations` row + drop its object) re-runs a migration or fails untyped | MEDIUM | LOW | Contiguous-prefix + non-empty-when-`events`-exists guards refuse with the typed error; top-row deletion is indistinguishable from an older DB and the re-run restores the guard (documented honest limit) | Plan Review attempt 1 (MEDIUM) |
| The check writes before refusing (a pending migration runs on a tampered DB) | MEDIUM | MEDIUM | AC1/AC4 checks run BEFORE `applyMigrations`; tests assert no new `schema_migrations` row/object after refusal | Phase 3 |
| Fake-list tests (`m(1)`) start failing the events check | MEDIUM | HIGH | Gate the object check on the code-side list containing the real `initial`; never on DB rows | Phase 3 (`store.test.ts` migration tests) |
| Expected `sql` constants drift from 001/008 | MEDIUM | MEDIUM | A test pins each constant against a fresh store's `sqlite_master` | Phase 3 |
| Retry makes a busy open slow or flaky in tests | LOW | MEDIUM | Bounded ≤5 retries × ≤100 ms; deterministic tests inject `sleep`/`random`; real-child tests keep their 10 s timeout | Phase 3 |
| Two holders after the retry change | HIGH | LOW | Same acquisition sequence per attempt (EXCLUSIVE lock + write); the existing child-race tests stay green | Requirement AC5 |
| AC7 child breaks if `lock.ts` gains a relative import | MEDIUM | LOW | Keep `lock.ts` import-free of relative modules; note it in the file header | Phase 3 (strip-types probe) |
| New store errors are "transient" under launchd: a tampered DB restarts once a minute, each refusal writing nothing and one `kernel.err.log` line | LOW | LOW | Recorded choice: `daemon-exit.ts` unchanged (out of this requirement's scope); a follow-up may classify them permanent | Phase 3 (`daemon-exit.ts:57-62`) |
| `StoreLockedError` wording change breaks consumers | LOW | MEDIUM | Only `daemon-exit.test.ts:88` and `store.test.ts:497` assert it; both updated in the same PR | Phase 3 |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
/supervisor job: .supervisor/jobs/pending/2026-10-04-h03-store-integrity.md

## Outcome
- **Status:** completed
- **Completed:** 2026-10-04T15:16:02Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/27
- **Branch:** feature/hardening-h03-store-integrity
- **Files changed:** 9
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Store open refuses (typed, nothing written) missing/altered/foreign events objects, an untrustworthy schema_migrations, or a newer schema, and re-checks after migrating; migration 008 refuses explicit event ids; Store.exec removed; the lock retries BUSY 4x with 10-100 ms jitter and says the PID may be stale; four test gaps covered; the lock child imports the real lock.ts. Phase 4.5 code-reviewer PASS on the first pass (scratch repros held), 0 fix iterations; 6 findings dismissed below the fix floor (2 MEDIUM, 3 LOW, 1 nit).

## Not verified
- **launchd behaviour on a refused tampered or newer DB (transient restart loop)** — no launchd run; daemon-exit.ts unchanged by design, unit-tested only (subtask 1)
- **CI ubuntu Node 22 strip-types child** — verified on local macOS Node 22.14 only; Phase 4.5 reviewer reports CI run 37211998347 green on fb73aa6 (subtask 1)
