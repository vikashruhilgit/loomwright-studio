# 06 — Each playbook has its own daily token limit and its own API-key fallback setting

## Status: ready

**Priority:** MVP · D24 (limits are tokens), D26 (what counts), D28 (per-playbook opt-in fallback at the cap) · invariants 1, 3

**As** the owner,
**I want** to cap how many tokens a playbook may use per day, and to choose per playbook whether it may continue on my API key at the subscription cap,
**so that** one runaway playbook can't spend the day's tokens, and only the playbooks I choose ever cost money.

## Problem

The meter counts tokens per session, agent and day; `budget.playbook` exists but is never written. The D28 fallback reads a kernel-wide placeholder (`kernel/src/budget/admission.ts`: "once playbooks exist it is read from the playbook's own policy"). Item 01 added the playbook's token limit, fallback policy and `sessions.playbook`.

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

1. **Metering:** a session with a playbook adds its usage (D26: input + output + cache-write) to that playbook's daily total as well as the agent's and the day's.
2. **Admission:** before a playbook's session starts (fire, run now or dry run), if the playbook's token limit for today is reached, the work is parked until the next local day and the owner is notified once per playbook per day; never retried in a loop (D17). A playbook with no limit is bounded only by the agent and kernel limits, as today.
3. **Fallback:** at the subscription cap, a playbook session continues on the API key only when that playbook's fallback policy opts in and its dollar ceiling is not reached; otherwise it waits (D28). For a playbook session the kernel-wide placeholder is never consulted; for a session without a playbook, behaviour is unchanged.
4. `studio status` shows per-playbook tokens today against its limit. Doc page `docs/architecture/budget.md`.

## Non-goals

- Setting the limit or fallback (item 02's `set`). Dollar limits on the subscription build (D24).

## Acceptance criteria

- [ ] Given a playbook session that used 1,000 input + 200 output + 300 cache-write + 5,000 cache-read tokens, when it ends, then the playbook's total for today is 1,500.
- [ ] Given a playbook at its daily limit, when it fires, then no session starts, the work is parked until local midnight, and one notification is recorded (a second fire that day records none).
- [ ] Given the subscription cap and a playbook whose fallback opts in under its ceiling, when it fires, then its session uses the API-key provider; given one that does not opt in, then it waits for the reset.
- [ ] Given a session without a playbook at the cap, when it starts, then behaviour matches today's (the placeholder is read).
- [ ] Tests in `kernel/test/budget-playbook.test.ts` (stubbed providers, no real key); `docs/architecture/budget.md` describes metering, admission and fallback per playbook.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- Until item 08 sets `sessions.playbook`, tests set it directly on the session row.
- The API-key path stays stub-tested (D16).

## Risks

- Admission and metering must read the playbook from the session row (item 01) inside `kernel/src/budget/`. If wiring them in needs a change to `kernel/src/sessions/manager.ts`, that file is item 03's in the same wave: stop and say so, so the plan can order 06 after 03, rather than editing it.

- `studio status` output is phase 1 code: add the per-playbook lines through the budget module's status hook only; if no such hook exists, add the lines in `docs` and the API only and say so.

## Depends on
2026-10-16-092901-phase-3-foundation-schema-seams-and-per-feature-pins.md

## Touches
kernel/src/budget/
kernel/test/budget-playbook.test.ts
docs/architecture/budget.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-16T12:12:54Z
- **Brief:** .supervisor/jobs/done/2026-10-16-playbook-token-limits-api-key-fallback.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/68
