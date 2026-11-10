# 17c — Thread continuity in the app: Reply, Summarize & start fresh with ⓘ, Copy reference

## Status: done
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/253

**Priority:** MVP · ROADMAP phase 8 (blocks item 14's live run at setup step 6) · D9, D24, D25

**As** the owner,
**I want** to press Reply on an agent's message, summarize a long thread and start fresh, or attach a thread as a reference, from Chat and each Crew thread,
**so that** I control how much conversation each message carries without typing anything technical.

## Problem

Item 17b gives the kernel continuity (reply, summarize & start fresh, references). Item 17a's mockup is how the owner wants it to look. Without this item, none of it reaches the owner: the composer in `app/src/screens/chat/ChatComposer.tsx` only sends a plain message, which is how Wright forgot its proposal in the phase 8 live run on 2026-11-09.

## Scope

Build exactly what the approved `docs/design/mockups/chat-threads.html` shows, in Chat (Wright's thread) and every Crew thread (D25), over 17b's API:

1. **Reply** on each agent message, the "Replying to:" strip with × (Esc cancels), and sends carrying the "continues" id. Replies are drawn joined to their thread. A reply that took the replay path shows the mockup's note.
2. **Summarize & start fresh** with **ⓘ**. The ⓘ panel shows the thread route's per-thread figures in tokens (D24). The button asks the kernel for a summary and shows the preview (**Start fresh with this** / **Edit** / **Cancel**). Start sends the edited text. The old thread shows "Summarized: continued in …" and keeps Reply.
3. **The size hint:** highlights Summarize past the owner's setting when set. The setting lives where the mockup puts it.
4. **Copy reference** on each thread, pasting as a chip in any composer, with the full / summary toggle, the size in tokens and ×. A refusal for size shows the kernel's message.
5. **Session names.** Chat, Crew, Sessions and Tasks show each session's kernel `title` (17b Part 5) instead of "ad hoc session" or "playbook #<id>". A thread's name can be renamed in place, as the mockup shows.
6. ⌘K commands for Reply to the last message, Summarize & start fresh, and Copy reference, matching the existing chat commands (`app/src/screens/chat/commands.ts`).

## Acceptance criteria

- **AC1.** Given an agent message, when the owner presses Reply and sends, then `POST /ask` carries the "continues" id, and the sent message appears joined to that thread. A plain send carries none.
- **AC2.** Given the Reply strip, when the owner presses × or Esc, then the next send is a plain message.
- **AC3.** Given Summarize, then nothing starts until the owner presses Start fresh with this. Cancel leaves both threads unchanged, and Edit's text is what's sent.
- **AC4.** Given the ⓘ panel, then its figures come from the thread route and are in tokens. No dollar figure appears anywhere (a test searches the rendered panel for `$`).
- **AC5.** Given a pasted reference, then it renders as a chip, sends as a reference (not pasted text), and its toggle chooses full or summary.
- **AC6.** Given the kernel unreachable or a 17b refusal (`continues_invalid`, a size refusal), then the composer keeps the owner's text and shows the refusal in plain words.
- **AC8.** Given any session in Sessions, Tasks, Chat or Crew, then its card shows the kernel's title. No screen renders "ad hoc session" or "playbook #<id>" (a test searches the rendered screens). Renaming a thread updates its title everywhere.
- **AC7.** Given each new control, then it matches the approved mockup in light and dark, keyboard-reachable, WCAG AA (the polish gate, `docs/UI.md`).

## Non-goals

- Kernel behaviour (17b).
- Search across threads.

## Owner decisions

- 2026-11-09: every session shows a suitable name based on what it's doing, never "ad hoc session".
- 2026-11-09: Reply, Summarize & start fresh with ⓘ, return to the old thread, and Copy reference, as designed in the phase 8 live-run session.

## Assumptions

- 17b's contract types land in `app/src/api/contract.ts` before this item starts.

## Dependencies

- Depends on: 17a (the approved mockup, D9) and 17b (the API it consumes).
- Blocks: item 14's live run, together with item 16.

## Risks

- The mockup may change in review. This item builds only what the merged mockup shows.

## Touches

app/src/screens/chat/ChatComposer.tsx
app/src/screens/chat/Thread.tsx
app/src/screens/chat/CrewSection.tsx
app/src/screens/chat/cards.tsx
app/src/screens/chat/commands.ts
app/src/screens/chat/model.ts
app/src/screens/chat/chat.css
app/src/screens/chat/composer.test.tsx
app/src/screens/chat/thread.test.tsx
app/src/screens/sessions/model.ts
app/src/screens/sessions/SessionsScreen.tsx
app/src/screens/tasks/model.ts
app/src/screens/settings/SettingsScreen.tsx
app/src/screens/settings/model.ts
app/e2e/chat.spec.ts
app/e2e/fixture-kernel.ts

## Validation (must pass before merge)

1. **Static — app suite:** `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`.
2. **Running system — the owner's Reply in the packaged app:** in the packaged app opened from Finder, the owner asks Wright something, presses Reply on the answer and refers back to it, and Wright answers knowing the earlier exchange. The owner summarizes that thread, edits the summary, starts fresh, then replies once more in the old thread. The owner reports what each step showed.

## Depends on

2026-11-09-160017-the-thread-continuity-mockup.md
2026-11-09-160018-thread-continuity-in-the-kernel.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-10T16:58:40Z
- **Brief:** .supervisor/jobs/done/2026-11-10-thread-continuity-in-the-app.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/253
