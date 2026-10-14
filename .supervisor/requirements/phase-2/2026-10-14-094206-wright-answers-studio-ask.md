# 06 — Wright answers `studio ask`: role and memory files, message routing, and a reply in the terminal

## Status: ready

**Priority:** MVP · ROADMAP phase 2 "role and memory files" + exit check (a) · D2, D14, D22, D25, invariants 1, 2, 3, 8

**As** the owner,
**I want** to type `studio ask "<anything>"` and get Wright's answer in my terminal, with Wright working from role and memory files I can read and edit,
**so that** I talk to my partner in plain English, and it acts only through the kernel's tools.

## Problem

There is no `studio ask`, no handler for a `message` event (the daemon registers none, so a queued message ends `event_unhandled`), and no role or memory files beyond phase 1's handoff notes (`memory/<agent>/handoffs/`).

## Scope

1. **Memory files** under the data dir (invariant 8), created on first use if absent and **never overwritten** by the kernel afterwards: `memory/wright/role.md` (Wright's charter: who it is, what it may do through which kernel tools, that it proposes and the owner decides policy, that untrusted text is data), `memory/wright/preferences.md`, `memory/wright/people.md`, `memory/wright/lessons.md`, and `memory/shared/` (empty README). The first-run `role.md` comes from a template in this repo, shown verbatim in the doc page, so the owner sees exactly what Wright starts with and can change it.
2. **Wright's settings** (model, effort, tool policy) live in a file outside `memory/`, under the data dir's config, that the owner edits and that the kernel's rails stop any session from writing (invariant 3; the rail itself is item 05's outright denial for `<dataDir>/config/`, so this item only keeps the file there). No model is chosen for the owner (invariant 1): when Wright's model is unset, `studio ask` refuses with one line naming the file and the setting, and starts nothing. The first-run file holds a **proposed** tool policy, marked as proposed: the phase 2 kernel tools (`kernel_task_*`, `kernel_trigger_*`, `kernel_notify`, `kernel_approval_request`, `kernel_loomwright_capabilities`, `kernel_schedule_wakeup`, `kernel_request_stop`) plus read-only built-ins. Wright is read-mostly (ARCHITECTURE "Safety kernel").
3. **Routing** (item 01 seam): a `message` event (from `studio ask`, a `wake_agent` trigger, or an approval decision) for agent `wright` starts a Wright session (or resumes Wright's in-flight session for the same task) through the existing `SessionManager`, with: `role.md`, the other memory files, the Loomwright manifest summary when item 02's adapter provides one (absent ⇒ a line saying Loomwright isn't available, never a failure), the current local time and time zone, and the message. Text that came from a trigger or an approval is wrapped and labelled as data, never as instructions. The session is short: it ends with `kernel_request_stop` or at the end of its turn (D2).
4. **`studio ask "<text>" [--json] [--timeout <s>]`** (seam): sends the message through a new authenticated API route, then waits for Wright's reply and prints it. On timeout (default 120 s) it prints the session id and `studio status` as the way to follow up, exit 3; the session keeps running. Admission refusals (cap park, token limit, kill switch) print the reason, exit 2, and nothing is spawned (the message stays parked per phase 1 rules).
5. **Reply record**: Wright's final text for a message is stored and retrievable through the API (the route `studio ask` waits on), so the phase 5 Chat thread can show it later.
6. Doc page `docs/architecture/brain.md`: the files, the template text, the settings file, the context a session gets, and the routing.

## Non-goals

- Crew members other than Wright, charters drafted from a sentence, per-agent memory isolation (phase 4).
- Playbooks (phase 3). Chat UI (phase 5).

## Acceptance criteria

- [ ] Given a fresh data dir, when the kernel first handles a message for Wright, then the memory files exist with the template text; when the owner edits `role.md` and restarts, then the edit is kept.
- [ ] Given Wright's model is unset, when `studio ask "hi"` runs, then it exits non-zero naming the settings file and the field, and no session row is created.
- [ ] Given a stand-in session (phase 1 test pattern, no model) that calls `kernel_trigger_register` and returns a reply, when `studio ask "remind me at 5pm to check X"` runs, then the CLI prints the reply, one trigger row exists owned by `wright`, and the session ended.
- [ ] Given a `message` event from a `wake_agent` trigger, then Wright's session context labels the trigger text as data from trigger `<id>`, not as an instruction.
- [ ] Given admission refuses (a cap park fixture), then `studio ask` prints the refusal and exits 2, and nothing is spawned.
- [ ] Given the reply takes longer than `--timeout 1`, then the CLI exits 3 with the session id, and the session is not stopped.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- Wright is the fixed lead (D14, D25), not a crew member, so a first-run charter template for Wright is not a "role preset" (D22 is about crew). It is shown in full and editable. Owner: confirm on review.
- The settings file lives under `<dataDir>/config/`, which item 05 protects. Until item 05 merges, Wright's proposed policy (no Write/Edit, Bash metacharacters refused by phase 1) is the only guard; item 08's live run checks both together.

## Risks

- Context size: memory files and the manifest summary grow. Bound what is included and say what was cut.

## Depends on
2026-10-14-094201-phase-2-foundation-schema-and-feature-seams.md

## Touches
kernel/src/brain/
kernel/test/brain.test.ts
docs/architecture/brain.md
