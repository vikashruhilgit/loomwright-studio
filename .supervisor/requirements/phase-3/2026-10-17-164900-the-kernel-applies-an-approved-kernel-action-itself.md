# 10 — The kernel applies an approved kernel action itself, and tells the agent what it did

## Status: ready

**Priority:** MVP · blocks the phase 3 exit (live run 2026-10-17, step 4 failed) · invariants 2, 3 · D3

**As** the owner,
**I want** my approval of a held kernel action (enabling a playbook) to take effect without depending on the model repeating a call it cannot see,
**so that** approving does what I approved, every time, and the agent can't tell me something happened when it didn't.

## Problem

Live run 2026-10-17 (`docs/evidence/phase-3-exit-live-2026-10-17.json`, step 4): the owner approved `kernel_playbook_enable` once. The kernel queued one message to Wright, `approved approval 1: kernel_playbook_enable`, which names only the approval and the action. Wright's new session (no memory of the request) made **no tool call** and replied "Playbook 1 is now enabled … the kernel confirmed it", which was false: no `playbook_enabled` event, the playbook stayed `draft`, and the one-shot grant was never used. Completing an approved state change depends on a model repeating a held call exactly (`docs/OPEN_QUESTIONS.md`, Wright's retry), which is the LLM owning a transition the kernel should own (invariant 2).

## Owner decisions (2026-10-16, binding)

- **Dry run = a read-only agent run.** The owning agent runs the playbook once in a dry-run session: read-only tools work, and every outward or persistent tool call is denied by the kernel and recorded as "would do". The result (what it would do, what the dedupe key would skip, next fire times, tokens used) is stored and shown. Tokens count against limits.
- **Storage = SQLite + a markdown mirror.** The kernel's `playbooks` table is the source of truth. A read-only markdown copy under the data dir (`memory/playbooks/<slug>.md`) is rewritten on every change so the owner can read it (invariant 8).
- **Enabling = Wright requests, the owner approves once.** Wright drafts and dry-runs, then calls `kernel_playbook_enable`, which the approval gate always holds; the owner approves or denies it in `studio approvals`, which shows the dry run. Enable is refused unless the playbook's current version has a dry run. Any edit makes a new version and returns the playbook to draft (a new dry run and a new approval). This keeps D3 and invariant 3 as they are.
- **What starts a playbook:** the existing `once` / `cron` triggers, linked to the playbook, plus a manual "run now" by the owner. Event triggers (a new PR, a ticket) wait for connectors (phase 6).
- **What a fire does:** it wakes the owning agent (Wright in phase 3; crew is phase 4) with the playbook's intent as its instruction, under the playbook's model, priority, approvals and limits.
- **Priority = `low` / `normal` / `high`.** Pending events run high first, then normal, then low; oldest first within a level.
- **In phase 3:** priority ordering, "always allow" per playbook, per-playbook token limits, and the per-playbook API-key fallback (D28).
- **Policy is the user's (invariant 1, D4).** Every policy field (dedupe key, priority, model, token limit, fallback) records who set it: `wright` (shown as "proposed") or `owner`. No playbook ships preinstalled.

## Owner decisions (2026-10-17, from this finding)

- **Confirmed by the owner on 2026-10-17:** for a held action that is a kernel tool with a kernel-side effect (in phase 3: `kernel_playbook_enable` only; a closed set in code), the owner's `once` approval makes the kernel apply the held call itself, in the decision's transaction. The owner's approval stays required (D3, invariant 3 unchanged). Held actions that are not kernel tools (`gh pr comment` and the rest of the outward set) still run only through the agent's retry.

## Scope

**Part A — the kernel applies an approved kernel action.**
1. A closed set in code, `KERNEL_APPLIED_ACTIONS`, holds `kernel_playbook_enable`. When the owner decides `once` on an approval whose action is in the set, the kernel re-validates and applies the held input in the same transaction as the decision: the playbook still exists, is still at the version in the held input, still has a completed dry run of that version, and was not turned off by the owner. Then it enables the playbook and appends `playbook_enabled` naming the approval. The grant is recorded as used by the kernel. If any check fails, the approval is still recorded as decided, nothing is enabled, and the reason is stored on the approval (`apply_refused: <reason>`).
2. A `deny` changes nothing, as today. `always` never applies to `kernel_playbook_enable` (item 05).
3. The enable logic lives in one function (`kernel/src/playbooks/enable.ts`) used by both the tool path and the approval path; there is no second implementation.

**Part B — what the agent is told.**
4. The message the kernel queues after a decision states what the kernel did, from the store: for a kernel-applied action, "the kernel enabled playbook <slug> (#<id>) at version <n> on approval <id>" or "the kernel did not enable … : <reason>"; for any other approved action, the held tool, its exact input and an instruction to repeat that call once, unchanged; for a deny, that it was denied. The agent never has to infer whether something happened.
5. `studio approve` prints what the kernel applied (or why not) for a kernel-applied action.

**Part C — the exit checks follow the new path.**
6. `kernel/test/phase-3-exit.test.ts`: the enable takes effect on approval with no retry from the stand-in Wright. `kernel/test/phase-3-exit-live.test.ts` and `docs/evidence/phase-3-exit-runbook.md` step 4: pass when the playbook is enabled by the approval itself (`playbook_enabled` names the approval) before the first minute. Wright's reply is recorded, not required.
7. Docs: `docs/architecture/approvals.md` (kernel-applied actions, the message text), `docs/architecture/dry-run.md` (enabling), and the `docs/OPEN_QUESTIONS.md` retry entry answered.

## Non-goals

- Applying non-kernel outward actions (shell, `gh`) from the kernel: their retry stays with the agent, now with the exact call in the message.

## Acceptance criteria

- [ ] Given a held `kernel_playbook_enable` for v4 with a dry run of v4, when the owner approves `once`, then the playbook is `enabled` at v4 in the same transaction, `playbook_enabled` names the approval, and no agent call is needed.
- [ ] Given the playbook was edited to v5 after the request, when the owner approves, then nothing is enabled, the approval records `apply_refused: version_changed`, and the agent's message says so.
- [ ] Given the owner turned the playbook off after the request, when they approve, then nothing is enabled (`apply_refused: turned_off_by_owner`).
- [ ] Given an approved held `gh pr comment`, when the message is queued, then it names the tool and its exact input and asks for one unchanged retry; the one-shot grant behaves as today.
- [ ] Given a deny, when it is decided, then nothing is applied and the message says it was denied.
- [ ] The deterministic phase 3 exit test passes with a stand-in Wright that makes no retry; the live harness and runbook step 4 expect the kernel-applied enable.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- A tool is in `KERNEL_APPLIED_ACTIONS` only if the kernel already implements its effect. Adding a tool to the set is a code change with its own review.

## Risks

- The decision path (approvals) now calls into playbooks. Keep the dependency one-way: approvals calls a registered applier by action name, so the approvals module does not import playbooks internals.

## Depends on
none

## Touches
kernel/src/approvals/
kernel/src/playbooks/enable.ts
kernel/test/approvals.test.ts
kernel/test/playbooks-dry-run.test.ts
kernel/test/phase-3-exit.test.ts
kernel/test/phase-3-exit-live.test.ts
docs/architecture/approvals.md
docs/architecture/dry-run.md
docs/evidence/phase-3-exit-runbook.md
docs/OPEN_QUESTIONS.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-17T14:57:27Z
- **Brief:** .supervisor/jobs/done/2026-10-17-kernel-applies-approved-enable.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/79
