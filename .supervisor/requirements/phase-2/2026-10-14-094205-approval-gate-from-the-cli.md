# 05 — Approval gate (CLI): outward or persistent actions wait for the owner's decision, without holding a session open

## Status: ready

**Priority:** MVP · ROADMAP phase 2 "approval gate (CLI)" · D5, D7 (allow once / always / deny), invariant 3

**As** the owner,
**I want** any outward or persistent action an agent attempts to wait for my decision, which I give from the terminal,
**so that** nothing leaves my machine or changes my setup without me seeing the exact action first.

## Problem

Phase 1 has no approval mechanism. `docs/ARCHITECTURE.md` lists `kernel_approval_request(action, payload)` and an approvals table; neither exists.

## Owner decisions (2026-10-14, binding)

- Creating triggers and tasks needs no approval (item 04). The gate covers outward or persistent actions and an agent's explicit `kernel_approval_request`.

## Scope

1. **`kernel_approval_request(action, payload, idempotency_key)`** (item 01 seam): records a `pending` approval (requesting agent and session, the exact payload as given), creates a notification (item 03's record function, source `kernel:approval`) and returns at once with the approval id and `pending`. The session is **not** kept running while it waits: the tool result tells the agent the decision will arrive as a new message, and the agent should end its turn.
2. **Fixed outward/persistent set** in the kernel's `PreToolUse` rail (`kernel/src/sessions/policy.ts`; not editable by agents, invariant 3): a tool call that the agent's policy allows AND falls in the set is not run; it becomes a `pending` approval with the exact command or tool input, and the hook denies the call with a message naming the approval id. Phase 2's set: `git push`; `gh` subcommands that write (`pr create|comment|review|merge|edit|close`, `issue create|comment|edit|close`, `api` with a non-GET method); writes to `~/.claude/` and to any `settings*.json` or hooks file. `gh pr merge` stays blocked outright outside Loomwright's sanctioned gate (invariant 4) and never becomes an approval.
   **Denied outright, whatever the policy, never an approval** (ARCHITECTURE "Safety kernel": protected kernel files; phase 1's rail checks no paths at all): a write through Write, Edit or NotebookEdit, or a Bash command naming the path, to the Studio data dir's `config/` (where item 06 keeps each agent's settings), the store files, `api.json`, or the kernel's install copy under `<dataDir>/app/`.
3. **Decisions** (CLI + API, seam): `studio approvals [--all] [--json]` lists pending first (id, agent, session, time, action, the exact payload, pretty-printed and shown as data); `studio approve <id> once` / `studio deny <id>`. `always` is refused in phase 2 with "always-allow is stored per playbook; playbooks arrive in phase 3" (ARCHITECTURE: never global). A decision on a non-pending id fails clearly. Each decision is an audit event with `by: owner`.
4. **Delivering the decision**: deciding queues one `message` event to the requesting agent (`{ text: "<decision> approval <id>: <action>", agent, approval_id }`), which item 06 delivers. An approved held tool call is re-attempted only by the agent, and the rail lets exactly that payload through once (matched exactly, consumed on use).
5. Doc page `docs/architecture/approvals.md`.

## Non-goals

- `always` decisions (phase 3, per playbook). Approvals from the GUI (phase 5) or a connector.
- Approval timeouts or expiry (policy; later).

## Acceptance criteria

- [ ] Given an agent allowed `Bash(git push:*)` runs `git push origin main`, then it does not run; one `pending` approval holds the exact command; the hook's deny message names the approval id.
- [ ] Given `studio approve 3 once`, then approval 3 is `approved` / `once`, one `message` event for the requesting agent is queued, and the next identical `git push origin main` from that agent runs once; a second identical push is held again.
- [ ] Given an approved payload, when the agent runs a *different* command (`git push --force origin main`), then it is held as a new approval (exact match only).
- [ ] Given `studio approve 3 always`, then it is refused with the phase 3 message and 3 stays `pending`.
- [ ] Given `studio deny 3`, then 3 is `denied`, the agent gets a `message` event saying so, and the command never runs.
- [ ] Given a session whose policy allows Write, when it writes `<dataDir>/config/agents/wright.json` (or Edit, or `Bash(cat …)` naming it with a write), then the call is denied with reason `protected_kernel_path` and no approval is created.
- [ ] Given `gh pr merge 12` from any agent, then it is blocked as in phase 1 and no approval is created.
- [ ] Given a payload containing terminal escape sequences, when `studio approvals` prints it, then the escapes are shown escaped, not interpreted.
- [ ] Given `kernel_approval_request` with the same idempotency key twice in one session, then one approval exists.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- Phase 2 has one agent (Wright), whose tool policy (item 06) allows few outward actions; the gate is built and tested here with stand-in policies.

## Risks

- A command reaching the outward set by a route the matcher misses (an alias, `env git push`, a script). Phase 1's allowlist already refuses shell control and substitution characters; the doc page lists which forms are recognised and states plainly that allowing a program which runs others (ARCHITECTURE, "Safety kernel") grants what it can run.

## Depends on
2026-10-14-094201-phase-2-foundation-schema-and-feature-seams.md

## Touches
kernel/src/approvals/
kernel/src/sessions/policy.ts
kernel/test/approvals.test.ts
kernel/test/sessions-policy.test.ts
docs/architecture/approvals.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-15T05:32:30Z
- **Brief:** .supervisor/jobs/done/2026-10-15-approval-gate-from-the-cli.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/52
