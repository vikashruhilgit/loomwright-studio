# 03 — A dry-run session can read but never act, and reports what it would have done

## Status: ready

**Priority:** MVP · ROADMAP phase 3 exit ("dry-run output is shown before it's enabled") · invariants 2, 3 · D3, D5

**As** the owner,
**I want** the kernel to run an agent session in which every outward or persistent action is refused and written down instead,
**so that** a playbook's dry run shows me exactly what it would do, with no way for it to do any of it.

## Problem

Sessions today either run a tool, deny it, or hold it for approval (`kernel/src/sessions/policy.ts`). There is no mode in which a session may read but every action is recorded as "would do".

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

1. **The dry-run launch option** item 01 added to the session manager (`startSession({ …, dryRun: true })`) now takes effect: the kernel's PreToolUse gate allows only read-only tools (Read, Glob, Grep, `kernel_*_list` / `_get` tools, `kernel_loomwright_capabilities`, and Bash commands the policy allows whose first word is in a fixed read-only set the kernel defines), and denies everything else with a fixed reason (`dry_run`), recording each denied call as a "would do" entry (tool, input summary, the reason it would have been held or run). The session's own policy still applies on top: dry run only narrows.
2. A dry-run session never creates an approval, never consumes a grant, and never writes through any `kernel_*` tool that changes state. The fixed rail (protected paths, merge block) is unchanged.
3. **Result:** when the session ends, the manager returns the "would do" list, the session's final text, and its token usage (counted against limits like any session).
4. Doc page `docs/architecture/dry-run.md` (the mechanism half; item 07 adds the playbook half).

## Non-goals

- Running a playbook's dry run (item 07). Any change to non-dry-run sessions.

## Acceptance criteria

- [ ] Given a dry-run session that calls Read and then `gh pr comment`, when it ends, then Read ran, the comment did not, and the "would do" list holds exactly the comment call with reason `dry_run`.
- [ ] Given a dry-run session whose policy allows an outward tool, when it calls it, then no approval row is created and no grant is consumed.
- [ ] Given a dry-run session calling a state-changing `kernel_*` tool (e.g. `kernel_task_create`, `kernel_trigger_register`), when it calls it, then it is denied and recorded, and the store is unchanged.
- [ ] Given a non-dry-run session, when the suite runs, then every existing sessions/policy test passes unchanged.
- [ ] Given a dry-run session, when it ends, then its token usage is recorded by the budget meter as for any session.
- [ ] Tests in `kernel/test/sessions-dry-run.test.ts` (a stand-in session, no model); `docs/architecture/dry-run.md` describes the mechanism and the read-only set.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- A deny-and-record PreToolUse decision is visible to the model as a tool error, so the model can continue and describe the rest of its plan (the 2026-10-15 live run showed denied calls return `tool_not_allowed` errors to the model).

## Risks

- The read-only Bash set must be conservative: a command not in it is "would do", never run.

## Depends on
2026-10-16-092901-phase-3-foundation-schema-seams-and-per-feature-pins.md

## Touches
kernel/src/sessions/dry-run.ts
kernel/src/sessions/manager.ts
kernel/src/sessions/types.ts
kernel/test/sessions-dry-run.test.ts
docs/architecture/dry-run.md
