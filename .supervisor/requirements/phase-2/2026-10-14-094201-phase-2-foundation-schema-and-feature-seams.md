# 01 — Phase 2 foundation: the new tables and one home per feature, so the other phase 2 items never touch a shared file

## Status: ready

**Priority:** MVP · **Blocks every other phase 2 item** · ROADMAP phase 2 · invariants 1, 2, 3, 8

**As** the owner running phase 2 through `/automate --parallel`,
**I want** the shared parts of the kernel (schema, tool server, API router, CLI dispatcher, event-loop wiring, architecture doc) to gain their phase 2 extension points in ONE small change first,
**so that** the five feature items after it (adapter, notifications, triggers, approvals, Wright) each change only their own directory, their own tests and their own doc page, and can be built side by side without merge conflicts.

## Problem

Phase 1 composes everything in a few central files: `kernel/src/store/migrations/index.ts`, `kernel/src/tools/server.ts` (403 lines, the six phase 1 tools), `kernel/src/api/server.ts`, `kernel/src/cli/index.ts`, `kernel/src/kernel.ts`, `kernel/src/daemon.ts`, `kernel/src/loop/loop.ts` and `docs/ARCHITECTURE.md`. Every phase 2 feature needs to add something to each of them. If each feature item edits them, `plan-waves` puts every item in its own wave (shared Touches), and phase 2 runs one PR at a time.

Phase 2 also needs tables that don't exist yet: `triggers`, `notifications`, `approvals`, and a record of the last Loomwright contract the kernel saw (`docs/ARCHITECTURE.md` "Data model" lists `triggers` and `approvals`; nothing in migrations 001–010 creates them).

## Owner decisions (2026-10-14, binding)

- Triggers get their own table now, with a nullable playbook (playbooks are phase 3). One-shot and cron triggers.
- A trigger fires one of two actions, chosen when it is created: `notify` (the kernel posts stored text, no Claude session) or `wake_agent` (queues a message to the owning agent).
- Every notification carries a stable deep link `loomwright-studio://notifications/<id>`.
- Creating a trigger needs no approval; the owner can list every trigger and turn each on or off. An owner's "off" can't be undone by an agent.
- The "new features" note on a Loomwright version change is built from a diff of the old and new `capabilities.json`.

## Scope

1. **Migration 11** creates, append-only (never editing 001–010):
   - `triggers`: id, owning agent, playbook (nullable), kind (`once` / `cron`), spec (instant with time zone, or cron expression plus IANA time zone), action (`notify` / `wake_agent`), action payload (the text), created by (agent or owner), enabled flag, who last changed `enabled` and when (`owner` / `agent`), next fire time, last fired time, last result, created time.
   - `notifications`: id, source (`trigger:<id>`, `agent:<name>`, `kernel:<reason>`), title, body, deep link, created time, delivery status (`pending` / `delivered` / `failed` / `unsupported`), delivery detail, delivered time.
   - `approvals`: id, requesting agent, requesting session, action, exact payload (JSON), requested time, status (`pending` / `approved` / `denied`), decision (`once` / `always` / `deny`), decided by, decided time.
   - `loomwright_contract_seen`: one row per observed (install path, plugin version, contract schema version), the contract JSON as read, first seen time.
   The store's integrity check (phase 1, `kernel/src/store/integrity.ts`) still passes on a fresh store and on a store migrated from version 10, and the `events` table and its triggers are untouched.
2. **One directory per phase 2 feature**, already wired into the composition and empty: `kernel/src/loomwright/`, `kernel/src/notifications/`, `kernel/src/triggers/`, `kernel/src/approvals/`, `kernel/src/brain/`. Each exports one contribution object the kernel already reads at start, with these optional parts: kernel tools (name, input shape, handler), API routes (method, path, handler), `studio` subcommands (name, help line, handler), event-queue handlers (by event kind), and a per-tick "due work" function the loop calls before it processes the queue. The foundation ships each contribution EMPTY, so the shipped daemon still preinstalls no behaviour (invariant 1) and every existing test still passes unchanged.
3. The central files learn to merge contributions: the tool server registers contributed tools with the same validation, `kernel_` prefix rule, per-launch construction and `idempotency_key` work-step rules as the phase 1 tools; the API router mounts contributed routes behind the same bearer-token check (authentication before routing, unchanged); the CLI dispatches contributed subcommands with the same `api.json` pid check before any token read; the loop runs contributed due-work functions each tick, after `fireDueWakeups` and before queue processing, each in its own try/catch so one failing contributor never stops a tick (it is audited as `due_work_failed` with the contributor's name).
4. A contributed name that collides with an existing tool, route, subcommand or handler kind makes the kernel refuse to start with a typed error naming both owners (never a silent override).
5. **Docs:** `docs/ARCHITECTURE.md` gets the four new tables in "Data model", a short "Phase 2 features" section that says each feature is documented on its own page, and links to new stub pages `docs/architecture/loomwright.md`, `docs/architecture/notifications.md`, `docs/architecture/triggers.md`, `docs/architecture/approvals.md`, `docs/architecture/brain.md` (each a heading plus "Documented by the item that builds it"). Later items edit only their own page. `bash scripts/check-docs.sh` passes.

## Non-goals

- Any feature behaviour (tools that do something, routes that answer, notifications that post). Those are items 02–07.
- An `agents` or `playbooks` table (phases 3 and 4).
- Any new third-party dependency.

## Acceptance criteria

- [ ] Given a fresh data dir, when the kernel starts, then `schema_migrations` reaches version 11 and the four tables exist with the columns above.
- [ ] Given a store at version 10 with phase 1 rows, when the kernel starts, then it migrates to 11 with every phase 1 row intact and the integrity check passes before and after.
- [ ] Given the shipped daemon, when it starts, then no kernel tool, API route, CLI subcommand, event handler or due-work function beyond phase 1's is registered (a test lists them).
- [ ] Given a test contribution with one tool, one route, one subcommand, one handler and one due-work function, when a kernel is composed with it, then each is reachable through the normal path (tool through the MCP server with prefix and validation; route only with the bearer token, 401 without; subcommand through `studio`; handler for its event kind; due work once per tick), with no edit to the central file needed (the test composes it from outside).
- [ ] Given two contributions registering the same tool name (or route, subcommand, handler kind), when the kernel starts, then it refuses to start with a typed error naming both contributors.
- [ ] Given a due-work function that throws, when the loop ticks, then the tick still processes the queue, and one `due_work_failed` event names the contributor.
- [ ] `docs/ARCHITECTURE.md` documents the four tables and links the five feature pages; `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- Each feature's contribution lives in its own directory's `index.ts`; the five directories are fixed here so the later items' Touches are disjoint.

## Risks

- A seam shaped wrong forces a later item back into a central file and serialises the waves. Mitigation: the contribution test above exercises every part a later item needs.

## Depends on
none

## Touches
kernel/src/store/migrations/index.ts
kernel/src/store/migrations/011_phase_2_tables.ts
kernel/src/store/integrity.ts
kernel/src/tools/server.ts
kernel/src/api/server.ts
kernel/src/cli/index.ts
kernel/src/kernel.ts
kernel/src/daemon.ts
kernel/src/loop/loop.ts
kernel/src/loop/types.ts
kernel/src/loomwright/
kernel/src/notifications/
kernel/src/triggers/
kernel/src/approvals/
kernel/src/brain/
kernel/test/store.test.ts
kernel/test/feature-seams.test.ts
docs/ARCHITECTURE.md
docs/architecture/

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-14T15:53:35Z
- **Brief:** .supervisor/jobs/done/2026-10-14-phase-2-foundation-schema-feature-seams.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/47
