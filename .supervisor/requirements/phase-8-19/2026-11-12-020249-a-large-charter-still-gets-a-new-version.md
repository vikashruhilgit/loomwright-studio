# 19a — A large charter still gets a new version when the owner asks for a change

## Status: done
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/266

**Priority:** MVP (blocks the phase 8 live run, step 6) · D24, invariants 1, 3 · follows 18b, 18d

**As** the owner,
**I want** Ask or change and Choose workspace to produce a new charter version even when the charter has many duties,
**so that** I can shape a real crew member, such as a developer that turns tickets into PRs in a saved workspace, in one approval instead of reading an explanation of why Wright couldn't.

## Problem

A new member's create approval must fit its "head" in the 4,000 characters `studio approvals` lists before its cut (`MAX_APPROVAL_DISPLAY`; `kernel/src/agents/charter-tools.ts`, `createHead` / `displayFitRefusal`). That rule exists so the enforced, limits and workspaces lines are never hidden by the cut.

In 18d's Validation 2 walk (2026-11-11, `docs/evidence/phase-8-18d-charter-card-in-chat.md`), Wright drafted a 10-duty developer charter (approval 21; head 3,994 characters). Two of the owner's changes were then refused (`tool_decision deny held_refused`), so no v2 was held and the owner got an explanation instead:

- Ask or change "add comment replies": 615 characters over.
- Choose workspace → the saved `~/studio-work/studio-sandbox`: 60 characters over.

Measured on approval 21: the readiness lines (`kernel/src/agents/charter-readiness.ts`, item 18b) took **3,211** of the 3,994 head characters, because each `covered:` / `flagged:` duty line quotes the duty's full text. The enforced, limits and workspaces lines took 585. The duty count, not the grants, fills the head. Update displays carry the same readiness lines in every form (`updateDisplay`), so Wright's create-then-update workaround can hit the same wall.

## Scope

1. **Shorten each readiness line's duty quote in the approval display** (the owner's decision, 2026-11-12): a duty is named by its number, how it is covered or why it is flagged, and a short excerpt of its text. The full duty text stays in the charter's `role.md` (in the display's full details) and in the parsed charter. Applies to create and update displays alike.
2. The must-fit head still holds the who line, every readiness line, the job lines, and the enforced, limits and workspaces lines. The safety rule (the enforced lines are never cut) is unchanged.
3. The fit refusal stays, for charters that still don't fit, and its text names what to ask for less of.

## Acceptance criteria

**Happy path**

- **AC1.** Given a create charter with 10 duties whose texts average about 200 characters (approval 21's shape), when Wright holds it, then the display's head fits `MAX_APPROVAL_DISPLAY` with at least 1,200 characters to spare, and each readiness line names its duty number and starts with the same `covered:` / `flagged:` prefix as today.
- **AC2.** Given that held charter, when the owner's Ask or change adds a job with 5 more kernel tools (approval 21's "add comment replies" case), then Wright's redraft is held as v2 rather than refused for size.
- **AC3.** Given that held charter, when the owner picks a saved workspace with Choose workspace, then Wright's redraft with the workspace path is held as v2 rather than refused for size.
- **AC4.** Given a held update for a member with 10 duties, when `updateDisplay` builds it, then its readiness lines use the same short form, and the update fits under the same conditions as the create.

**Edge cases**

- **AC5.** Given a duty text shorter than the excerpt length, when its readiness line is built, then the line carries the whole text with no cut mark. Given a longer one, the excerpt ends with one visible cut mark, and the line never ends mid-word.
- **AC6.** Given the shortened display, when the owner opens the card's full details, then `role.md` still carries every duty's full text, and the "<n> characters, nothing cut" count matches the stored display.
- **AC7.** Given the chat charter card and the Approvals screen (18d, item 16), when they render a shortened readiness block, then every readiness line still shows with its Covered / Flagged badge and its duty number, and the workspace line still offers Choose workspace.

**Error scenarios**

- **AC8.** Given a charter that still doesn't fit after shortening (for example many very long enforced lists), when Wright calls the create, then it is refused as today, and the refusal names how many characters over it is and what to ask for less of. Nothing is held.

## Non-goals

- Raising `MAX_APPROVAL_DISPLAY`, or no longer counting any line in the must-fit head (option not chosen, 2026-11-12).
- Moving the readiness lines below the enforced lines (option not chosen, 2026-11-12).
- Wright splitting a charter into a create plus an automatic update (option not chosen, 2026-11-12).
- Changing what the readiness check covers or flags (18b's logic). Only how its lines are quoted in the display changes.
- The clone action ("Clone it for me"), which is its own follow-up (18d decision 2).

## Owner decisions

- 2026-11-12, at this requirement's gate: shorten each readiness line's duty quote in the head (with the number and a short excerpt). The full duty text stays in `role.md` and the full details.

## Assumptions

- The app's readiness parsing (`app/src/screens/approvals/charterBlocks.ts`) keys on the line prefixes and the duty number, not on the duty text being whole. The Launch Pad confirms this against `charterBlocks.test.ts` / `CharterCard.test.tsx`.
- An excerpt of about 80 characters is enough for the owner to recognise a duty. The exact length is the builder's choice, within AC1's budget.
- No saved approval is rewritten: displays are built at hold time, so already-held approvals keep their old form.

## Dependencies

- Depends on: 18b (readiness lines) and 18d (card, withdraw on replace), both merged.
- Blocks: the phase 8 live run's step 6 (`docs/evidence/phase-8-exit-runbook.md`).

## Risks

- A test that pins a readiness line's full text (`kernel/test/agents-charter-readiness.test.ts`, `agents-charter-tools.test.ts`, app card tests) must change with intent, not just be loosened.
- An excerpt that cuts a duty's distinguishing words could make two duties look alike. The number keeps them distinct.

## Touches
kernel/src/agents/charter-readiness.ts
kernel/src/agents/charter-tools.ts
kernel/test/agents-charter-readiness.test.ts
kernel/test/agents-charter-tools.test.ts
kernel/test/agents-charter-connectors.test.ts
kernel/test/phase-4-exit.test.ts
app/src/screens/approvals/charterBlocks.ts
app/src/screens/approvals/charterBlocks.test.ts
app/src/screens/chat/CharterCard.test.tsx
docs/architecture/agents.md

## Validation (must pass before merge)

1. **Static — kernel and app suites:** `cd kernel && npm ci && npm run typecheck && npm test` (AC1, AC4, AC5, AC8), `cd app && npm ci && npm run typecheck && npm test` (AC6, AC7), and `bash scripts/check-docs.sh`.
2. **Running system — the owner reshapes a large charter:** in the packaged app with the kernel running as the installed service, the owner asks Wright for a 10-duty developer for `<owner>/<repo>`. In Ask or change they type "add comment replies", and then choose the saved workspace. Each produces a held v2 (then v3) that the card shows, with the older version "Replaced by". `studio approvals` lists each version's enforced line before its cut. The owner reports what each step showed.

## Depends on
none

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-12T11:52:39Z
- **Brief:** .supervisor/jobs/done/2026-11-12-a-large-charter-still-gets-a-new-version.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/266
