# 17a — The thread continuity mockup: Reply, Summarize & start fresh, Copy reference

## Status: done
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/249

**Priority:** MVP (D9 gate) · ROADMAP phase 8 (blocks item 14's live run at setup step 6) · D9, D24, D25

**As** the owner,
**I want** one clickable mockup of the new Chat and Crew thread controls, light and dark, every state,
**so that** I approve how continuing, summarizing and referencing a conversation looks and reads before any code is written.

## Problem

Found in the phase 8 live run, 2026-11-09, setup step 6. Wright lost its own crew proposal between two Chat messages and asked the owner to restate it. Every message starts a fresh session (the store: `brain_messages` rows 65, 66 and 67 ran as sessions 82, 83 and 84, each with a new SDK session id). The context is one message only (`docs/architecture/brain.md:230-258`), and "nothing summarises the earlier conversation" (`brain.md:314`). The thread on screen shows a conversation the model never sees.

The owner designed the fix in that session. It adds controls no mockup shows, and D9 says nothing is coded until the owner approves the mockup (`docs/UI.md:3`).

## Scope

One HTML file, `docs/design/mockups/chat-threads.html`, built like `docs/design/mockups/phase-8.html`: no build, its token block the verbatim output of `node app/scripts/tokens.mjs`, light and dark, clickable. It shows, in Chat (Wright's thread) and in one Crew thread (D25):

1. **Plain message vs reply.** The composer as today (a plain message is a new topic). Each agent message has **Reply**. Pressing it puts a strip above the composer, "Replying to: <first line of that message>", with **×** to cancel. A sent reply is drawn joined to the message it answers, and a chain of replies reads as one thread.
2. **Summarize & start fresh**, beside Reply, with an **ⓘ**. The ⓘ panel shows this thread's real numbers in tokens, never dollars (D24): messages so far, tokens read per reply now, and the estimate with a summary. It also says what a summary keeps (exact values word for word) and drops (the back-and-forth).
3. **The summary preview.** After the button: the summary Wright wrote, with **Start fresh with this**, **Edit** and **Cancel**. The new thread then starts with the summary at its top. The old thread stays readable, marked "Summarized: continued in <new thread>", and still offers Reply.
4. **The size hint.** Past a size the owner sets, the button is highlighted. The mockup shows the setting where the owner sets it, with Wright's proposed default shown as a proposal, never as fixed.
5. **Copy reference.** Each thread offers **Copy reference**. Pasted into any composer, Chat or Crew, it shows as a chip: "📎 Thread: <title> (<n> messages)". The chip has a toggle (full thread / its summary, when one exists), its size in tokens, and **×** to remove it.
6. **Session names.** Every thread, and its session card in Sessions and Tasks, shows a name for what it's doing (the owner's first line, a playbook's name, "From Wright: …"), never "ad hoc session". Rename in place for a thread.
7. **The charter approval card in plain language (item 16, AC3).** A held crew charter, create and update, lists its kernel tools grouped by job ("Hand tickets to /automate", "Triage PR comments", "Ask for a merge", "Read a PR"), each with its one-line purpose, ahead of the raw `mcp__kernel__…` names, which sit beneath behind a disclosure. It also shows item 16's fit-check gap: "This playbook needs *Ask for a merge*; Sandbox Developer doesn't have it", with the held charter change beside it.
8. **States.** Empty thread, a long thread past the hint, a reply whose earlier session can't be continued ("Continuing from the saved conversation" note, the fallback), a referenced thread too large for the limit, and the kernel unreachable.

Its evidence (screenshots of every state, the token audit, the field map to the kernel fields item 17b adds) goes in `docs/design/evidence/chat-threads-mockup/README.md`. `docs/DESIGN.md` gets a row in its mockup table.

## Acceptance criteria

- **AC1.** Given the mockup, when opened from the file, then every view in Scope 1-8 is reachable by clicking, in light and dark.
- **AC2.** Given the token block, when compared with `node app/scripts/tokens.mjs` output, then it is identical (the token audit in the evidence).
- **AC3.** Given any number on screen about size or cost, then it is in tokens and never in dollars (D24).
- **AC4.** Given the Reply strip, the summary preview and the reference chip, when navigated by keyboard only, then each is reachable and dismissable (Esc on the strip, Tab order on the preview), WCAG AA contrast in both themes.
- **AC5.** Given the field map, then every number and label shown maps to a field item 17b names, or is marked "computed in the app".

## Non-goals

- Code in `app/` or `kernel/` (items 17b and 17c).
- Changes to any other screen, beyond the session name on the Sessions and Tasks cards and item 16's charter card.
- Search across threads.

## Owner decisions

- 2026-11-09: a plain message stays a new topic and a fresh session. Continuity happens only when the owner presses Reply.
- 2026-11-09: Summarize & start fresh sits beside Reply with an ⓘ that explains the token saving with details.
- 2026-11-09: after a summary, the owner can still go back and continue the old thread.
- 2026-11-09: a thread can be copied as a reference and attached to any message instead of summarizing.
- 2026-11-09: every session gets a suitable name based on the task it's performing, not "ad hoc session".
- 2026-11-09: item 16's plain-language charter card is designed in this mockup.
- 2026-11-09: the owner approves the mockup by merging the PR that adds it (D9, as for phases 6, 7 and 8).

## Assumptions

- One mockup file covers Chat and Crew, because both use the same thread component (`app/src/screens/chat/Thread.tsx`).

## Dependencies

- Depends on: none.
- Blocks: 17c (the app work) and item 16's card (`.supervisor/requirements/phase-8-16/`).

## Risks

- The size hint and the reference limit need numbers the owner hasn't set. The mockup shows them as settings with a proposed default, never fixed.

## Touches

docs/design/mockups/chat-threads.html
docs/design/evidence/chat-threads-mockup/README.md
docs/DESIGN.md

## Validation (must pass before merge)

1. **Static — docs check:** `bash scripts/check-docs.sh` passes, and the token audit in the evidence shows the token block matches `node app/scripts/tokens.mjs`.
2. **Running system — the owner clicks through it:** the owner opens `docs/design/mockups/chat-threads.html` in a browser, walks every state in light and dark, and approves by merging the PR (D9).

## Depends on

none

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-10T06:08:40Z
- **Brief:** .supervisor/jobs/done/2026-11-09-the-thread-continuity-mockup.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/249
