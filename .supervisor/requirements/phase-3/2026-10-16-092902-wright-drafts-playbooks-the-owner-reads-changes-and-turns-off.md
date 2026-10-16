# 02 — Wright turns a plain-English request into a stored draft playbook; the owner reads it, changes any policy value, and turns it off

## Status: ready

**Priority:** MVP · ROADMAP phase 3 exit ("a plain-English request becomes a stored playbook … dedupe key, priority and model come from the user, with Wright only proposing defaults") · invariants 1, 8 · D3, D4

**As** the owner,
**I want** Wright to save what I ask for ("every weekday at 9, summarise what changed in repo X") as a draft playbook I can read, whose every policy value I can change, and which I can turn off at any time,
**so that** recurring work is written down where I can see it, and nothing about how it runs is decided for me.

## Problem

Item 01 created the `playbooks` tables and an empty `kernel/src/playbooks/drafts.ts`. Nothing creates, versions, lists or edits a playbook, and there is no file the owner can read.

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

1. **Wright's tools** (in `drafts.ts`, via item 01's seam): `kernel_playbook_create(name, intent, trigger, dedupe_key, priority, model, token_limit, idempotency_key)`, `kernel_playbook_update(id, changes, idempotency_key)`, `kernel_playbook_list()`, `kernel_playbook_disable(id, idempotency_key)`. The trigger is a `once` or `cron` spec in the triggers feature's own format (validated with the triggers feature's exported validators, never re-implemented). Every policy value Wright supplies is stored with `set_by: wright`. Invalid input is an error result (never a throw), naming the field: an unknown dedupe-key field (the closed list in `types.ts`), a priority outside `low|normal|high`, an invalid trigger spec, an empty intent. A new playbook is `draft`, version 1. Creating it also registers its trigger linked to the playbook (`triggers.playbook` set; this item adds a playbook argument to the triggers module's register function), and a trigger-spec change updates that linked trigger. A linked trigger of a playbook that is not `enabled` never starts work (item 08 decides what a fire does).
2. **Versions.** Any change (by Wright or the owner) writes a new `playbook_versions` snapshot, increments `version`, and sets status back to `draft` if it was `enabled` (it must be dry-run and approved again, item 07). Disabling does not create a version.
3. **The markdown mirror.** After every create, change or disable, `<dataDir>/memory/playbooks/<slug>.md` is rewritten from the row (atomic write): name, status, version, intent, trigger in the owner's local time, every policy value with "(proposed)" when `set_by` is `wright`, and the last dry run's summary when there is one (item 07 fills it; a placeholder line until then). The file states it is generated and that edits there are not read. The contract's text is data: render it inert (as the version note does).
4. **The owner's verbs** (`studio playbooks …`, via item 01's seam; matching API routes): `list [--all] [--json]`, `show <id|slug>`, `set <id> <field> <value>` (dedupe_key / priority / model / token_limit; records `set_by: owner`, new version), `off <id>` (disable, by owner, audit event; Wright cannot turn back on a playbook the owner turned off, mirroring triggers).
5. Every create, update, set, disable is an audit event. Doc page `docs/architecture/playbooks.md`.

## Non-goals

- Dry run, enabling and firing (items 07, 08). Owner-side create (Wright creates; the owner edits).

## Acceptance criteria

- [ ] Given Wright calls `kernel_playbook_create` with a valid cron trigger and all policy values, when it returns, then the playbook is `draft` v1, every policy value is marked `set_by: wright`, and `memory/playbooks/<slug>.md` shows each as "(proposed)".
- [ ] Given Wright creates a playbook, when it returns, then exactly one trigger linked to it exists, listed by `studio triggers` with the playbook named.
- [ ] Given a draft, when the owner runs `studio playbooks set <id> priority high`, then the priority is `high` with `set_by: owner`, the version increments, a snapshot exists for both versions, and the mirror no longer marks priority as proposed.
- [ ] Given an enabled playbook, when Wright or the owner changes any value, then it returns to `draft` at the new version.
- [ ] Given a dedupe key naming an unknown field, an invalid cron, or a priority `urgent`, when Wright creates it, then the result is an error naming the field and nothing is stored.
- [ ] Given the owner turned a playbook off, when Wright updates or re-enables it, then the result is an error saying the owner turned it off.
- [ ] Given a crash between the row write and the mirror write, when the kernel restarts, then the mirror is rewritten from the row (the row is the truth).
- [ ] Tests in `kernel/test/playbooks-drafts.test.ts`; `docs/architecture/playbooks.md` describes the tools, verbs, versions and mirror.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- The owner edits policy values through `studio playbooks set` (no GUI until phase 7); intent and trigger changes go through Wright.

## Risks

- Reusing the triggers validators across features: import from the triggers module's public index only.

## Depends on
2026-10-16-092901-phase-3-foundation-schema-seams-and-per-feature-pins.md

## Touches
kernel/src/playbooks/drafts.ts
kernel/src/playbooks/store.ts
kernel/src/playbooks/mirror.ts
kernel/src/triggers/store.ts
kernel/test/triggers.test.ts
kernel/test/playbooks-drafts.test.ts
docs/architecture/playbooks.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-16T12:11:37Z
- **Brief:** .supervisor/jobs/done/2026-10-16-playbook-drafts-owner-edits-and-off.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/71
