# 01 — Phase 3 foundation: the playbook schema, one home per phase 3 feature, and tests that pin each feature where it lives

## Status: ready

**Priority:** MVP · ROADMAP phase 3 (prerequisite for every other item) · invariants 1, 3 · D3, D4, D5

**As** the owner,
**I want** phase 3's schema and extension points created in ONE small change first,
**so that** items 02–08 each edit only their own files and run in parallel waves without merge conflicts.

## Problem

Phase 3 needs a `playbooks` table and links from triggers, sessions, the event queue and approvals to it; none exist (`kernel/test/store.test.ts` pins that no `playbooks` table exists). Several files are shared by every feature: the migrations list, the features registry (`kernel/src/features/index.ts`), Wright's proposed tool list and role template (`kernel/src/brain/settings.ts`, `templates.ts`, pinned to `docs/architecture/brain.md` by `brain.test.ts`), the fixed outward set (`kernel/src/sessions/policy.ts`) and `docs/ARCHITECTURE.md`. Worst of all, `kernel/test/feature-seams.test.ts` pins EVERY feature's tools, routes and subcommands in one test: every phase 2 feature commit edited it while none declared it in `## Touches` (2 of 4 lanes of the 2026-10-15 wave also drifted outside their Touches). If phase 3 items each had to edit these, they could not share a wave.

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

1. **Migration 013** (append-only, contiguous, no SQL CHECK; value sets closed in code, as migration 011 did):
   - `playbooks`: id, slug (unique), name, owning agent, intent (natural-language text), status (`draft` / `enabled` / `disabled`), version (integer, starts at 1), dedupe key spec (nullable), priority (`low` / `normal` / `high`), model, effort (recorded only, as in brain.md), token limit per day (nullable), API-key fallback policy JSON (nullable, the `ApiKeyFallbackPolicy` shape in `kernel/src/budget/types.ts`), and for each policy field who set it (`wright` / `owner`); created/updated timestamps.
   - `playbook_versions`: one row per version, a full snapshot of the playbook at that version (so a dry run, an approval and a fire can name the exact version they used).
   - `playbook_runs`: id, playbook, version, kind (`dry_run` / `fire` / `run_now`), status, session id (nullable), dedupe key (nullable), result JSON (the dry run's "would do" list), tokens, started/ended.
   - `sessions.playbook` and `sessions.playbook_version` (nullable), `event_queue.priority` (`normal` default, every existing row `normal`), and `approvals.playbook` (nullable). `triggers.playbook` already exists (migration 011).
   - Update `kernel/test/store.test.ts` pins (the "no playbooks table" assertion becomes the new tables' columns).
2. **One home per phase 3 feature, empty and wired in now.** `kernel/src/playbooks/` with `index.ts` merging four EMPTY sub-contributions from `drafts.ts` (item 02), `dry-run.ts` and `enable.ts` (item 07), `runs.ts` (item 08), each exporting empty `tools`, `routes`, `subcommand verbs` and `handlers` lists; `types.ts` with the closed value sets (statuses, priorities, run kinds, the closed list of dedupe-key fields: `playbook.id`, `playbook.version`, `trigger.id`, `trigger.scheduled_at`, `date` (the instant's local date), and the `set_by` values). Register the `playbooks` contribution in `SHIPPED_CONTRIBUTIONS`. The owner's `studio playbooks <verb>` subcommand is ONE contributed subcommand whose verbs come from the sub-files, so items 02 and 08 add verbs without touching a shared file.
3. **Per-feature pins.** Move each feature's pinned lists (tools, routes, subcommands, handlers, due work, contribution keys) out of `kernel/test/feature-seams.test.ts` into that feature's own test file (`loomwright-adapter`, `notifications`, `triggers`, `approvals`, `brain`, and a new `kernel/test/playbooks-foundation.test.ts` for the playbooks shell). `feature-seams.test.ts` keeps only the contributor order, the collision and naming rules, and the merge mechanics. Nothing about the shipped behaviour changes; the same values are pinned, in the feature's own file.
4. **Wright's tool names, reserved now.** Add `mcp__kernel__kernel_playbook_create`, `_update`, `_list`, `_disable`, `_dry_run`, `_enable` to `PROPOSED_ALLOWED_TOOLS` and the role template's tool list (and the matching `docs/architecture/brain.md` block). Note: `wright.json` is create-if-absent, so an existing data dir keeps its old policy; the owner adds the names (the exit runbook says how).
5. **Sessions carry their playbook.** `startSession` / `resumeSession` accept optional `playbook` and `playbookVersion` (and `dryRun`, ignored until item 03) and write them to the session row; `getSession` returns them. Nothing sets them yet (items 07 and 08 do), so every existing caller is unchanged.
6. **`kernel_playbook_enable` is always held.** Add it to the fixed outward set in `kernel/src/sessions/policy.ts`, so every call is held for the owner's approval, and an "always" grant can never cover it (item 05 must not widen this).
7. **Docs.** `docs/ARCHITECTURE.md`: the `playbooks` data-model row and the new columns, the phase 3 tools (`kernel_playbook_create / update / list / disable / dry_run / enable`), and a "Phase 3 features" section linking one stub page per item: `docs/architecture/playbooks.md` (02), `dry-run.md` (03 and 07), `queue.md` (04), `budget.md` (06), `playbook-runs.md` (08). Approvals keep `approvals.md` (05). Later items edit only their own page.

## Non-goals

- Any playbook behaviour (items 02–08). The empty contribution registers nothing.
- Changing a phase 2 feature's behaviour: item 3 only moves pins.

## Acceptance criteria

- [ ] Given a fresh store, when migrations run, then migration 013 creates `playbooks`, `playbook_versions`, `playbook_runs` and the new nullable columns, and `event_queue.priority` defaults to `normal`; given a store at migration 012 with queued rows, when it upgrades, then every existing row reads `normal` and nothing else changes.
- [ ] Given the shipped contributions, when they merge, then `playbooks` is registered with no tools, routes, verbs or handlers, and `studio playbooks` prints its help without error.
- [ ] Given the moved pins, when the suite runs, then each phase 2 feature's tools, routes and subcommands are pinned in that feature's own test file with the same values as before, and `feature-seams.test.ts` pins no feature's list.
- [ ] Given a fresh data dir, when `wright.json` is created, then its proposed tool policy includes the six `mcp__kernel__kernel_playbook_*` names, and the role template and `brain.md` match (the existing pin passes).
- [ ] Given `startSession` with `playbook` 3 and `playbookVersion` 2, when the session row is read, then it carries both; given no playbook, then both are null.
- [ ] Given a session whose policy allows `mcp__kernel__kernel_playbook_enable`, when it calls it, then the call is held as a pending approval (not run), as any outward-set tool is.
- [ ] `docs/ARCHITECTURE.md` lists the phase 3 tables, columns and tools, and links the five stub pages; `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- The dedupe-key field list is closed in code and small in phase 3 (only schedule fields exist until connectors arrive in phase 6); adding a field later is a code change, never a user-supplied expression.

## Risks

- Moving the pins is a large but mechanical diff; review that no assertion was dropped (count assertions before and after).

## Depends on
none

## Touches
kernel/src/store/migrations/
kernel/test/store.test.ts
kernel/src/playbooks/
kernel/test/playbooks-foundation.test.ts
kernel/src/features/index.ts
kernel/test/feature-seams.test.ts
kernel/test/loomwright-adapter.test.ts
kernel/test/notifications.test.ts
kernel/test/triggers.test.ts
kernel/test/approvals.test.ts
kernel/test/brain.test.ts
kernel/src/brain/settings.ts
kernel/src/brain/templates.ts
docs/architecture/brain.md
kernel/src/sessions/policy.ts
kernel/src/sessions/manager.ts
kernel/src/sessions/types.ts
kernel/test/sessions.test.ts
kernel/test/sessions-policy.test.ts
docs/ARCHITECTURE.md
docs/architecture/playbooks.md
docs/architecture/dry-run.md
docs/architecture/queue.md
docs/architecture/budget.md
docs/architecture/playbook-runs.md
