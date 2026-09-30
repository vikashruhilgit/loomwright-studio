# 03: SQLite store, migrations, and the audit log

## Status: ready

**Priority:** MVP

## Story

As the kernel, I want one durable SQLite database that I alone write to, with an append-only audit log, so that all state survives a `kill -9` and every action I take can be inspected afterwards (invariants 2 and 8, D2).

## Acceptance criteria

1. **Given** a first start, **when** the store opens `~/.loomwright-studio/studio.db` (overridable by `STUDIO_DATA_DIR` for tests), **then** it creates the directory with mode 0700 and the database with WAL mode and `foreign_keys=ON`.
2. **Given** numbered migrations in `kernel/src/store/migrations/`, **when** the store opens, **then** it applies pending ones in order inside transactions, records them in `schema_migrations`, and reopening is a no-op. A failed migration leaves the database unchanged.
3. **Given** migration 1, **when** it's applied, **then** it creates the phase 1 tables from `ARCHITECTURE.md` (as updated by item 01):
   - `tasks`;
   - `sessions`, including `pgid`, `auth_account`, `sdk_session_id`, `status` and `model`;
   - `events`, the audit log;
   - `budget`;
   - `work_steps`, with columns `key` (unique), `status` (`started`/`done`/`failed`), `result_json` and timestamps;
   - `wakeups`;
   - `cap_state`, with `account`, `rate_limit_type`, `status`, `resets_at` and `updated_at`.

   Tables for later phases (agents, playbooks, triggers, approvals, …) are **not** created yet.
4. **Given** the `events` table, **when** any code tries to UPDATE or DELETE a row, **then** a trigger rejects it. Appending is the only write.
5. **Given** the store API, **when** it's used, **then** every write goes through one `Store` class. A second process opening the database for writing is refused (a lock file under the data dir, holding a live PID check), so the "one writer: the kernel" rule is enforced, not just documented.
6. **Given** a unit test that writes, kills nothing, and reopens, **when** it runs, **then** the data persists. A second test simulates a crash mid-transaction (throw inside the transaction) and asserts nothing partial was committed.

## Out of scope

Tables for phases 2+. Any encryption at rest.

## Dependencies

02.

## Risks

A single-writer lock that goes stale after `kill -9` must not block restart: the lock is taken over when its PID is dead. Test that case.
