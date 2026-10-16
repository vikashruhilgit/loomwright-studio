# 07 — Wright dry-runs a playbook, shows the result, and asks the owner to enable it

## Status: ready

**Priority:** MVP · ROADMAP phase 3 exit ("whose dry-run output is shown before it's enabled") · invariant 3 · D3

**As** the owner,
**I want** every playbook dry-run before it can run, with the dry run in front of me when Wright asks to turn it on,
**so that** I approve what it will actually do, and nothing runs that I haven't seen.

## Problem

Item 02 stores drafts; item 03 can run a session that reads but never acts. Nothing dry-runs a playbook, and nothing enables one. Item 01 reserved `kernel_playbook_dry_run` and `kernel_playbook_enable` (always held by the gate).

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

1. `kernel_playbook_dry_run(id, idempotency_key)` (in `dry-run.ts`): starts a dry-run session (item 03) for the owning agent, with the playbook's current version's intent as the instruction, its model, and `sessions.playbook` / `playbook_version` set. It records a `playbook_runs` row of kind `dry_run` with the "would do" list, the next three fire times (from the trigger spec), what the dedupe key would evaluate to for the next fire, and the tokens used; it rewrites the playbook's mirror (item 02's mirror function) with the summary. The tool returns that summary to Wright. A playbook with no model set is refused (the kernel never picks a model, brain.md).
2. `kernel_playbook_enable(id, idempotency_key)` (in `enable.ts`): refused unless the current version has a completed dry run. The gate holds the call (item 01); the held approval's display text includes the playbook name, version, every policy value marked "(proposed)" where `set_by` is `wright`, and the dry run's summary, so `studio approvals` shows them. When the owner approves and Wright's retry consumes the grant, the playbook becomes `enabled` at that version. Its linked trigger already exists (item 02); item 08 makes it fire the playbook once enabled. If the version changed between the request and the retry, enabling is refused.
3. Every dry run and enable is an audit event. Doc: the playbook half of `docs/architecture/dry-run.md`.

## Non-goals

- What happens when an enabled playbook fires (item 08).

## Acceptance criteria

- [ ] Given a draft playbook, when Wright calls `kernel_playbook_dry_run` with a stand-in session that reads one file and attempts one `gh pr comment`, then a `dry_run` run is stored with that comment in its "would do" list, the next three fire times and tokens, and the mirror shows the summary.
- [ ] Given a draft with no dry run of its current version, when Wright calls `kernel_playbook_enable`, then the result is an error saying a dry run is required.
- [ ] Given a dry-run draft, when Wright calls `kernel_playbook_enable`, then the call is held, and `studio approvals` shows the playbook, its version, its values with "(proposed)" marks, and the dry-run summary.
- [ ] Given the owner approves and Wright retries, when the retry runs, then the playbook is `enabled` at the approved version.
- [ ] Given an edit after the request and before the retry, when the retry runs, then enabling is refused and the playbook stays `draft`.
- [ ] Given a playbook with no model, when dry-run is requested, then it is refused naming the model.
- [ ] Tests in `kernel/test/playbooks-dry-run.test.ts` (stand-in sessions, no model).

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- The linked trigger is created by item 02; this item never edits the triggers module.

## Risks

- Wright must retry the held call after approval (the existing phase 2 grant flow); the role template already says to retry a held action after approval.

## Depends on
2026-10-16-092902-wright-drafts-playbooks-the-owner-reads-changes-and-turns-off.md
2026-10-16-092903-a-dry-run-session-can-read-but-never-act.md

## Touches
kernel/src/playbooks/dry-run.ts
kernel/src/playbooks/enable.ts
kernel/test/playbooks-dry-run.test.ts
docs/architecture/dry-run.md
