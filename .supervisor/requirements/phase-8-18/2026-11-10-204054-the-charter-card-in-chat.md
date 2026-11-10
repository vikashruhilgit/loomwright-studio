# 18d — The charter card in Chat: plain and short, complete on request, copyable, and discussed in its thread

## Status: ready

**Priority:** Phase 2 (follow-up) · D9, D22, invariants 3, 7

**As** the owner,
**I want** the charter card in Chat to show me the plain summary first, the full details only when I ask, every word available and copyable, and a way to ask about or change it that continues the same thread,
**so that** I can judge and adjust a crew member from the card itself, without raw names in my way, without missing text, and without starting the conversation over.

## Problem

Found in the item 16 Validation 2 walk, 2026-11-10:

- Chat's charter card renders the kernel's display raw in a `<pre>` (`app/src/screens/chat/cards.tsx:146`); item 16's plain view is used on the Approvals screen only (`app/src/screens/approvals/CharterDisplay.tsx`).
- The display is stored cut at 4,000 characters (`kernel/src/approvals/store.ts:117,278`) and shown with no mark. The owner saw `role.md` end mid-sentence and could not tell what was missing.
- There is no copy control, and the card's details can't be collapsed.
- "Edit in English" puts text in the composer (`cards.tsx:125`), but nothing ties the change to the thread the charter was drafted in.

## Scope

**Part A — plain, short, complete.** Chat's charter card uses the same plain view as the Approvals screen, compact by default as 18a's mockup shows: who, Can do (jobs with "used for" lines), Never does, Limits, and 18b's readiness block. The raw details sit behind an expand control and, when shown, are complete and scroll inside the card. The kernel keeps a held approval's display whole (bounded by the existing `MAX_REQUEST_PAYLOAD_JSON`, 64,000 characters) so the app can show all of it; a surface that must stay short (the CLI's list, a notification) ends a cut text with a visible mark naming how many characters were left out and how to see them all.

**Part B — copy and icons.** Copy controls on the whole card and on each details block copy the full text, not the visible part. Copy, expand and more are icons with tooltips and accessible names. The same applies on the Approvals screen's charter card.

**Part C — workspace question.** When 18b flags a missing workspace, the card offers the saved workspaces whose remote matches the repo (18c), **Choose folder…**, and **Clone it for me**. Picking or choosing proposes the charter update (held, as today); cloning is held for the owner's approval before anything is written.

**Part D — Ask / Change continues the thread.** An Ask / Change box on the card posts the owner's words as a Reply in the thread where Wright drafted the charter (item 17c's threads). Wright's answer and any new charter version appear in that thread; the earlier card is marked "Replaced by v2" with what changed (jobs added or removed, workspace set, limits changed). From the Approvals screen the same box posts into that thread and links to it.

## Acceptance criteria

**Happy path**

- **AC1.** Given a held charter create, when its card is shown in Chat, then it shows the compact plain view first, with no `mcp__kernel__` name, JSON or file path until the details are expanded.
- **AC2.** Given a display longer than 4,000 characters, when the details are expanded in the app, then all of it is shown, scrolling inside the card, with nothing cut.
- **AC3.** Given the card's copy control, when it is used, then the clipboard holds the full display text exactly as the kernel stored it; a block's copy control copies that block in full.
- **AC4.** Given the owner types "add comment replies" in the card's Ask / Change box, when it is sent, then it appears as a Reply in the charter's drafting thread, Wright answers there, and a new card version appears there with the older one marked "Replaced by v2" and the change named.
- **AC5.** Given 18b flagged a missing workspace and 18c holds a matching saved workspace, when the owner picks it on the card, then a held charter update adding that workspace is proposed.

**Edge cases**

- **AC6.** Given a CLI list or notification showing a long display, when it is cut, then it ends with a visible mark naming the characters left out and how to see the full text; it never ends mid-sentence with no mark.
- **AC7.** Given the drafting thread was summarized and started fresh (17c), when the owner uses Ask / Change, then it posts into the thread that holds the charter's latest version, and says which thread.
- **AC8.** Given no saved workspace matches, when the workspace question shows, then it offers Choose folder… and Clone it for me only.

**Error scenarios**

- **AC9.** Given the clipboard write fails, when copy is used, then the owner is told it did not copy; never a silent success.
- **AC10.** Given a chosen folder inside a protected folder (D31), when it is chosen, then the card says why it can't be used and proposes nothing.
- **AC11.** Display text is untrusted: it is rendered as text, never markup, in every view (as `printable` does today).

## Non-goals

- The readiness checks themselves (18b) and the saved list itself (18c).
- Plain-language refusals with a Fix button elsewhere in the app (considered, not queued).
- Changing who approves: every charter change is still a held approval decided by the owner (D22).

## Owner decisions

- 2026-11-10: details hidden by default, shown on request; all text available by scroll or "more", never silently cut.
- 2026-11-10: copy and show-all are icons with tooltips; copy on the card so it is easy to paste elsewhere.
- 2026-11-10: the owner can ask or change from the card, and that conversation shows in the main Chat in the same thread (the thread, not one long session: sessions stay short, invariant 2).
- 2026-11-10: chosen workspaces are offered for selection next time.

## Assumptions

- Contract change (owner-stated form): the stored display is no longer cut at 4,000 characters; it is kept whole up to the existing 64,000-character payload bound, and short surfaces mark their cut. Tests that pin the 4,000 cut change with it.
- The clone is a held action, decided by the owner, and runs only after approval (invariant 3); where it clones to follows D31.

## Dependencies

- Depends on: 18a (mockup, D9), 18b (readiness block), 18c (saved workspaces), item 17c (`../phase-8-17/2026-11-09-160019-thread-continuity-in-the-app.md`, PR #253: threads and Reply).
- Blocks: none.

## Risks

- A 64,000-character display in Chat is heavy. Mitigation: compact by default; the details render only when expanded.
- Ask / Change could post into the wrong thread after a start fresh. Mitigation: AC7.

## Touches

kernel/src/approvals/store.ts
kernel/src/cli/index.ts
kernel/test/approvals.test.ts
app/src/screens/chat/cards.tsx
app/src/screens/chat/cards.test.tsx
app/src/screens/chat/chat.css
app/src/screens/chat/continuity.ts
app/src/screens/approvals/CharterDisplay.tsx
app/src/screens/approvals/CharterDisplay.test.tsx
app/src/screens/approvals/ApprovalsScreen.tsx
app/src/screens/approvals/approvals.css
docs/architecture/approvals.md

## Validation (must pass before merge)

1. **Static — kernel and app suites:** `cd kernel && npm ci && npm run typecheck && npm test` (AC2, AC6), `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e` (AC1 to AC11), and `bash scripts/check-docs.sh`.
2. **Running system — the owner judges and changes a charter from the card:** in the packaged app, the owner asks Wright for the walk's developer, sees the compact card, expands the details and finds `role.md` complete, copies the card and pastes it into a note, picks a saved workspace, and asks for a change in the Ask / Change box; the change appears in the drafting thread with a new card version marked against the old. The owner reports what each step showed.

## Depends on

2026-11-10-204051-the-charter-card-mockup.md
2026-11-10-204052-a-charter-is-checked-ready-before-the-owner-sees-it.md
2026-11-10-204053-saved-workspaces.md
../phase-8-17/2026-11-09-160019-thread-continuity-in-the-app.md
