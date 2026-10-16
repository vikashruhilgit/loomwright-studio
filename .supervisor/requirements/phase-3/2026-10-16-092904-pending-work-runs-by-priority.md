# 04 — Pending work runs by priority: high, then normal, then low, oldest first within a level

## Status: ready

**Priority:** MVP · ROADMAP phase 3 exit ("priority … comes from the user") · invariant 1 · D4

**As** the owner,
**I want** the priority I give a playbook to decide which of its pending work runs first,
**so that** urgent work isn't stuck behind routine work when several things are due at once.

## Problem

The event loop processes pending `event_queue` rows strictly by id ("no other ordering", ARCHITECTURE main loop). Item 01 added `event_queue.priority` (`normal` by default), but nothing sets or reads it.

## Owner decisions (2026-10-16, binding)

- **Dry run = a read-only agent run.** The owning agent runs the playbook once in a dry-run session: read-only tools work, and every outward or persistent tool call is denied by the kernel and recorded as "would do". The result (what it would do, what the dedupe key would skip, next fire times, tokens used) is stored and shown. Tokens count against limits.
- **Storage = SQLite + a markdown mirror.** The kernel's `playbooks` table is the source of truth. A read-only markdown copy under the data dir (`memory/playbooks/<slug>.md`) is rewritten on every change so the owner can read it (invariant 8).
- **Enabling = Wright requests, the owner approves once.** Wright drafts and dry-runs, then calls `kernel_playbook_enable`, which the approval gate always holds; the owner approves or denies it in `studio approvals`, which shows the dry run. Enable is refused unless the playbook's current version has a dry run. Any edit makes a new version and returns the playbook to draft (a new dry run and a new approval). This keeps D3 and invariant 3 as they are.
- **What starts a playbook:** the existing `once` / `cron` triggers, linked to the playbook, plus a manual "run now" by the owner. Event triggers (a new PR, a ticket) wait for connectors (phase 6).
- **What a fire does:** it wakes the owning agent (Wright in phase 3; crew is phase 4) with the playbook's intent as its instruction, under the playbook's model, priority, approvals and limits.
- **Priority = `low` / `normal` / `high`.** Pending events run high first, then normal, then low; oldest first within a level.
- **In phase 3:** priority ordering, "always allow" per playbook, per-playbook token limits, and the per-playbook API-key fallback (D28).
- **Policy is the user's (invariant 1, D4).** Every policy field (dedupe key, priority, model, token limit, fallback) records who set it: `wright` (shown as "proposed") or `owner`. No playbook ships preinstalled.

## Scope

1. `enqueueEvent` takes an optional priority (`low` / `normal` / `high`, the closed set in `kernel/src/playbooks/types.ts`); default `normal`, so every existing caller is unchanged. An unknown value throws before anything is written.
2. The tick processes pending rows high first, then normal, then low, and by id within a level. A row parked until a not-before time is not eligible until then, whatever its priority. A `sourceRef` duplicate still returns the first row (its priority is not changed by the duplicate).
3. Fairness: no starvation guard in phase 3 (documented as a limit): a steady stream of `high` rows can delay `low` rows.
4. Doc page `docs/architecture/queue.md`: the ordering rule, the default, and the honest limit.

## Non-goals

- Who sets priority (item 08 passes the playbook's priority). Priority at the subscription cap (parking stays as today).

## Acceptance criteria

- [ ] Given pending rows enqueued as low (id 1), normal (id 2), high (id 3), when one tick runs, then they are handled in the order 3, 2, 1.
- [ ] Given two high rows, when a tick runs, then the lower id is handled first.
- [ ] Given a high row parked until a later time and a pending low row, when a tick runs before that time, then the low row is handled and the high row waits.
- [ ] Given an existing caller that passes no priority, when it enqueues, then the row is `normal`; every existing loop test passes unchanged.
- [ ] Given priority `urgent`, when enqueued, then it throws and nothing is written.
- [ ] Tests in `kernel/test/loop-queue-priority.test.ts`; `docs/architecture/queue.md` states the rule and the starvation limit.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- Ordering within one tick is enough; there is no pre-emption of a running session.

## Risks

- A crash between handling and marking done must keep phase 1's at-most-once guarantee; reuse the existing handling path, change only the selection query.

## Depends on
2026-10-16-092901-phase-3-foundation-schema-seams-and-per-feature-pins.md

## Touches
kernel/src/loop/queue.ts
kernel/src/loop/loop.ts
kernel/test/loop-queue-priority.test.ts
docs/architecture/queue.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-16T12:12:17Z
- **Brief:** .supervisor/jobs/done/2026-10-16-pending-work-runs-by-priority.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/67
