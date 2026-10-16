# 05 — "Always allow" is scoped to one playbook and one action, and the owner can revoke it

## Status: ready

**Priority:** MVP · ARCHITECTURE main loop step 6 ("'Always allow' is stored per playbook, never globally"), VISION ("until the user loosens them, per playbook, never globally") · invariant 3 · D5

**As** the owner,
**I want** to answer a held action from a playbook with "always for this playbook",
**so that** a routine playbook stops asking me about the same action, while every other playbook and every chat session still asks.

## Problem

`studio approve <id> always` is refused with `409 always_not_supported` (`kernel/src/approvals/store.ts`, `docs/architecture/approvals.md`: "always-allow is stored per playbook; playbooks arrive in phase 3"). Grants are one-shot today. Item 01 added `approvals.playbook` and `sessions.playbook` / `playbook_version`.

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

1. When a held approval's requesting session has a playbook, the approval row records it (`approvals.playbook`), and `studio approvals` shows "from playbook <slug> v<n>".
2. `studio approve <id> always` (and its API route) is accepted ONLY for an approval that has a playbook; it approves this call and stores a standing grant scoped to (playbook, action, the approval's normalised payload match as for one-shot grants). An approval without a playbook still returns `409 always_not_supported`, with a message saying "always" needs a playbook.
3. A later held call from a session of the same playbook that matches a standing grant runs without a new approval, and is recorded as an audit event naming the grant. It never matches across playbooks, from a chat session, or from a dry-run session (item 03).
4. A standing grant never covers `kernel_playbook_enable` (item 01 keeps it always held), protected kernel paths or the merge block: the fixed rail runs first.
5. **Lifetime:** a grant belongs to the playbook version it was given on; a new version (any edit, item 02) asks again. The owner revokes a grant with `studio approvals revoke <grant id>` and lists them with `studio approvals grants`.
6. Doc: `docs/architecture/approvals.md` (replace the phase 2 "always" refusal text).

## Non-goals

- Approval levels beyond hold / always (e.g. "ask only when blocking", the mockup's narrowing checkbox): later.

## Acceptance criteria

- [ ] Given a held `gh pr comment` from a playbook session, when the owner approves it `always`, then it runs, a standing grant is stored for that playbook version, and a second matching call from the same playbook runs without a new approval.
- [ ] Given that grant, when a chat session or another playbook makes the same call, then it is held as before.
- [ ] Given an approval with no playbook, when the owner answers `always`, then it returns 409 `always_not_supported` and nothing changes.
- [ ] Given a grant on v2, when the playbook is edited to v3, then the next matching call is held again.
- [ ] Given a grant, when the owner revokes it, then the next matching call is held.
- [ ] Given a playbook session calling `kernel_playbook_enable`, when a standing grant exists for anything, then the call is still held.
- [ ] Tests in `kernel/test/approvals.test.ts`; `docs/architecture/approvals.md` updated.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- Grants tied to a version is the safe default (an edit may change what the playbook does). The owner can change this at review.
- Until item 08 sets `sessions.playbook`, tests set it directly on the session row.

## Risks

- Matching must reuse the one-shot payload normalisation, never a looser match.

## Depends on
2026-10-16-092901-phase-3-foundation-schema-seams-and-per-feature-pins.md

## Touches
kernel/src/approvals/
kernel/test/approvals.test.ts
docs/architecture/approvals.md
