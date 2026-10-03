# H03: the store guarantees what the kill switch assumes

## Status: ready

**Priority:** MVP · **Safety kernel (invariant 3): the kill switch reads its state from `events`**

## Story

As the owner, I want the store to refuse to open when its append-only guarantees are broken, to keep `events` in append order, and to refuse a database from a newer kernel, so that the kill switch's durable state can't be silently erased, reordered or misread.

## Evidence (verified against `main` at 4429d4b on 2026-10-03)

PRs #11–#21 didn't touch `lock.ts`, `store.ts` or `001_initial.ts`; only PR #9's three commits did.

- **F03-2 (still present, reproduced).** The triggers at `kernel/src/store/migrations/001_initial.ts:64-82` cover only UPDATE, DELETE and REPLACE. `Store.exec` (`store.ts:90-92`) runs any SQL. In the reproduction, DROP TRIGGER followed by DELETE left 0 rows, and DROP COLUMN and DROP TABLE also succeeded. Nothing checks `sqlite_master` on open. No production code calls `Store.exec`. The kill switch's durable state is read from `events` (`kernel/src/api/kill-switch.ts:22-36`), so dropping that table silently releases the switch.
- **F03-6 (still present, reproduced).** `001_initial.ts:55` declares `id INTEGER PRIMARY KEY CHECK (id > 0)` without AUTOINCREMENT. After one explicit max-int insert, later ids come out random, and `ORDER BY id` no longer matches append order. All six production writers omit `id`:
  - `auth/notify.ts:46`
  - `sessions/manager.ts:1595`
  - `api/kill-switch.ts:45`
  - `api/server.ts:268`
  - `loop/internal.ts:18`
  - `budget/internal.ts:44`

  The kill switch orders by `id` (`kill-switch.ts:24,29,33`).
- **F03-4 (still present, reproduced).** `store.ts:136-168` skips versions it has already applied but accepts unknown ones. A DB whose `schema_migrations` holds version 99 opens and runs.
- **F03-1 (still present, reproduced).** `lock.ts:60` opens with `timeout: 0` and no retry. In a 6-way race, 5 of 20 rounds had no process get the lock, and no round ever had two holders. The refusal message at `lock.ts:21-25` names the PID from `studio.lock.pid` as if it were current. A launchd KeepAlive start racing a manual start would get a spurious refusal.
- **F03-3 (partially present).** No test covers the non-BUSY rethrow (`lock.ts:76`) or the did-not-enter-WAL throw (`store.ts:66-68`). A truly missing PID file while the holder is alive is untested; the EISDIR and garbage cases are covered at `store.test.ts:528-551`. No test calls `close()`/`release()` twice explicitly.
- **F03-5 (still present).** `kernel/test/store.test.ts:415-442` (`CHILD_SCRIPT`) copies the lock steps by hand instead of importing `lock.ts`.

## Acceptance criteria

1. **Given** a database whose `events` table, or any of its three append-only triggers, is missing or altered, **when** the store opens, **then** it refuses with a typed error naming what's missing and writes nothing. A test drops each trigger in turn, and the table, and asserts the refusal.
2. **Given** `Store.exec`, **when** someone reads its doc, **then** the doc says that the triggers block DML, not DDL, and that `exec` can defeat them. Alternatively `exec` is removed from the public surface; the implementer decides after a grep of callers and records the choice.
3. **Given** any sequence of inserts into `events`, including an attempted insert with an explicit id up to max-int, **when** the rows are read `ORDER BY id`, **then** the order equals append order. The fix is either a migration that rebuilds `events` with AUTOINCREMENT, keeping every row, id and trigger, or a guard that refuses an explicit id. A test covers the max-int case and the migration keeps existing rows byte-for-byte.
4. **Given** a database whose `schema_migrations` holds a version newer than this kernel knows, **when** the store opens, **then** it refuses with a typed error and doesn't migrate or write.
5. **Given** two starters racing for the store lock, **when** they start, **then** one acquires it. The loser retries 3–5 times with 10–100 ms of jittered backoff, using the same acquisition sequence, before refusing. There are still never two holders. The refusal message says the recorded PID may be stale. Tests are deterministic: they inject a BUSY result followed by success, and a BUSY result on every attempt.
6. **Given** the store tests, **when** they run, **then** they cover four paths: the non-BUSY rethrow, the did-not-enter-WAL throw, a missing PID file while the holder is alive, and an explicit double `close()`/`release()`.
7. **Given** the test child that holds the competing lock, **when** it takes the lock, **then** it imports the real `lock.ts` (or the built output), so it can't drift from the kernel's steps.

## Out of scope

Encrypting the database. Moving the kill switch's state out of `events`.

## Dependencies

Phase 1 items 01–09 (merged). Independent of H01 and H02.

## Risks

- AC 3's table rebuild is a migration on the audit table. It has to recreate the triggers in the same transaction and must never drop a row. The plan review should look at it closely. The migration takes the next free number when it's implemented (008 at the time of writing). H05 also adds a migration, so whichever lands second renumbers.
- AC 1 must not refuse a database that is merely older and still mid-migration. The check runs after migrations are applied.

## Source

Dismissed review findings from run `automate-2026-09-30-211858`, re-verified 2026-10-03: `proposed/…--03-sqlite-store-7d6c23--dismissed-a18c2c77.md`, `…-dismissed-af74603c.md`, and `…-dismissed-summary.md` entries 1–4.
