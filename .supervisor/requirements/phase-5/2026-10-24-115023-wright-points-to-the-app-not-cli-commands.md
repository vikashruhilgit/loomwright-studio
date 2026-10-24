# 23 — Wright points the owner to the app's controls, not to `studio` commands

## Status: ready

**Priority:** MVP, blocking the phase 5 rerun · ROADMAP phase 5 ("nothing typed in a terminal")

**As** the owner,
**I want** Wright to tell me where to act in the app (Approvals, a card's Set or Run now, Team),
**so that** its replies don't send me to a terminal for things the app already does.

## Problem

In the live run, Wright replied "set one with `studio playbooks set 3 model <id>`" (the card can set the model) and "Approve it with `studio approve 6`, or deny it with `studio deny 6`" (Approvals can). Wright repeats what the kernel told it: a held call's tool result says "The owner decides (studio approve <id> once, or studio deny <id>)" (`kernel/src/sessions/manager.ts:2501-2502`). Wright's guidance (`kernel/src/brain/templates.ts`) doesn't say the owner works in the app.

## Owner decisions (2026-10-24, binding)

Recorded 2026-10-24, after the phase 5 live exit run (harness `phase-5-exit-live`: all six flows passed its store checks). The owner asked for the run's findings to be written up as phase-5 items, and for a recommendation on when to test them. The recommendation (pending the owner's OK on the plan doc):

- **Fix before phase 6, then a short rerun.** These items (22–30) and the gap items (19–21) land before phase 6's foundation, then a short phase 5 live rerun checks them. Phase 6 builds on the same notifier, threads and cards (connector notifications, draft cards), and its foundation edits `kernel/src/console/threads.ts`. Testing everything after phase 6 would mix two phases' failures, against ROADMAP's rule that every phase ends with a check in the running system.
- **Blocking for the rerun:** 22 (the notification click opens the app), 23 (Wright points to the app, not the CLI), 24 (Stop/Kill on a starting session) and 25 (the playbook card). 26–30 are polish, and run in the same waves because they're small.
- **Phase 5's own decisions stand.** In particular: "the kernel posts [notifications], and the app opens their links" (phase 5 item 01), and the exit criterion "everything in phases 2–4 can be done from the app, with nothing typed in a terminal".

## Scope

1. **The held-call text** (`manager.ts:2501`) names where the owner decides, without a CLI command: "The owner decides in Studio's Approvals (approval <id>)". Keep "End your turn now" and the kernel-applied wording. Update the tests that pin the text.
2. **Wright's guidance** (`templates.ts`): when telling the owner how to change a value or decide an approval, name the app's control (Approvals; the playbook card's Set, Run now and Turn off; Team's inspector). Mention a `studio` command only when the owner asks for the CLI. Update `brain.md` and `brain.test.ts` (the companions rule).
3. **Other model-read texts that tell the owner to run a command:** grep `kernel/src` for `studio ` inside text a model reads, and list each one in the PR. Change only those inside this item's Touches, and list the rest for a follow-up.

## Non-goals

- Removing any CLI command. The CLI stays for the owner's own use.

## Acceptance criteria

- [ ] Given a held call, then the tool result names Approvals and approval <id>, and contains no `studio approve`. Pinned.
- [ ] Given `templates.ts`, then `brain.test.ts` pins that the guidance names the app's controls and gives a `studio` command only on the owner's request.
- [ ] Given the live rerun, then Wright's replies in flows 2–3 contain no `studio` command (the owner's observation).

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- A real Wright follows the guidance. Only the rerun shows it.

## Risks

- `manager.ts` is a kernel hotspot. This item changes one message string and its tests.

## Depends on
none

## Touches
kernel/src/sessions/manager.ts
kernel/test/sessions.test.ts
kernel/test/approvals.test.ts
kernel/src/brain/templates.ts
kernel/test/brain.test.ts
docs/architecture/brain.md
