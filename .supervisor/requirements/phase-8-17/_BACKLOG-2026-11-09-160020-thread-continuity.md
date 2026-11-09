# Thread continuity in Chat and Crew — plan doc (index document, not an implementable item)

## Status: done (index document — nothing to implement)

## Why now
Phase 8's live run (2026-11-09, setup step 6) stalled twice. Item 16 (`.supervisor/requirements/phase-8-16/`): Wright drafted a charter missing the tools the playbooks call. This set: Wright forgot its own crew proposal between two Chat messages: every message starts a fresh session with only that message as context (`docs/architecture/brain.md:230-258`, `:314`; store rows 65/66/67 ran as sessions 82/83/84). The live run resumes at step 6 only after every item here lands; item 16 is on this checklist so one run covers both.

## Owner decisions
none recorded

## Order
| Item | Outcome | Depends on | Runs beside |
|---|---|---|---|
| 17a | The owner approves the mockup for Reply, Summarize & start fresh with ⓘ, and Copy reference (D9) | none | 17b |
| 17b | The kernel continues a replied-to session (or replays it), summarizes on request, attaches references, Wright drafts proposals straight into Approvals, and every session gets a title for what it is doing | none | 17a |
| 16 | Wright drafts charters from the kernel's tool catalogue, the charter card reads in plain language (as 17a shows), and a fit check catches a playbook's missing tools before enable | 17a | 17b, 17c |
| 17c | The app's Chat and Crew threads offer all three controls, and every screen shows session titles, as the merged mockup shows | 17a, 17b | none |

## Run
/automate --backlog .supervisor/requirements/phase-8-17/_BACKLOG-2026-11-09-160020-thread-continuity.md --parallel 2
Safe mode, no --auto-merge. N = 2 because wave 1 has two independent items.
wave 1: 17a, 17b
wave 2: 17c, 16
16 waits on 17a: its charter card is designed in 17a's mockup (D9).
17c waits on 17a: D9, nothing coded before the mockup is merged.
17c waits on 17b: it consumes 17b's contract types in app/src/api/contract.ts.
Hotspot: app/src/api/contract.ts belongs to 17b; 17c reads it and leaves it alone.
17a is small on purpose: it is the D9 approval gate and must merge on its own.
No companions rule proposed.

## Considered and not queued
- A rolling window of the last N turns in every prompt: replaced by owner-chosen Reply; it would guess at continuity and spend tokens on unrelated history.
- Resuming every Chat message's previous session by default: makes every message pay for history and moves state into the SDK's transcript, against invariant 2's short sessions.
- Wright writing its own handoff notes into memory: relies on the model's discipline, nothing enforces it.

## Revisit when
Part 0's probe shows the SDK can't resume completed sessions (17b then runs on the replay path only), or threads routinely pass the owner's size hint.

## Checklist
- [ ] .supervisor/requirements/phase-8-17/2026-11-09-160017-the-thread-continuity-mockup.md
- [ ] .supervisor/requirements/phase-8-17/2026-11-09-160018-thread-continuity-in-the-kernel.md
- [ ] .supervisor/requirements/phase-8-17/2026-11-09-160019-thread-continuity-in-the-app.md
- [ ] .supervisor/requirements/phase-8-16/2026-11-09-160016-wright-drafts-charters-that-cover-the-work.md
