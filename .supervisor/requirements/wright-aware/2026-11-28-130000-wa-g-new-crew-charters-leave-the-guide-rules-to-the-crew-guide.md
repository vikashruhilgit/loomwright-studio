# wa-g — New crew charters leave the guide's rules to the crew guide

## Status: ready

**As** the owner of Loomwright Studio,
**I want** a newly written crew charter's `role.md` to hold only who the crew member is, and to leave the rules the kernel-built crew guide already gives,
**so that** each crew session reads those rules once, from the guide the kernel keeps current, and not twice from two texts that can drift apart.

## Why

- wa-a (PR #316) made the kernel build each agent's Studio guide; a crew session gets `crewGuide`, which carries the untrusted-text and memory rules.
- A new crew charter's `role.md` is still written by `kernel/src/agents/charter-files.ts` (the template around lines 454 and 461 on `main` at `873fb241`) with its own `## Untrusted text` and `## Memory` sections, so every new crew session reads those rules twice.
- The wa-a review found this (dismissed as a known limit), wa-b (PR #318) declined it because it changes charter prose, and `docs/architecture/brain.md` § Honest limits records it ("A crew charter's `role.md` still repeats the guide's rules").
- Separately, `docs/OPEN_QUESTIONS.md` (the entry ending around line 138 on `main` at `873fb241`) still says "Still open: nothing tells the owner when a shipped template has changed since their copy was written". wa-b (PR #318) closed that gap for Wright's `role.md` (an exact past template is upgraded with a backup and an audit event; an edited copy is flagged `old_manual` in `GET /memory` and on the Memory screen).

## Owner decisions

- 2026-11-28: approved by Tony as a new requirement item, routed through the coordinator: new crew charters drop the two duplicate sections; existing charters, edited or not, are never rewritten; charters stay owner-visible (D22); fix the stale OPEN_QUESTIONS line.

## Acceptance Criteria

**Happy path:**
- [ ] AC1. Given a crew member created through the charter path (`kernel_agent_create` approved, or the CLI or app path that writes `memory/<id>/role.md` through `charter-files.ts`), then the written `role.md` has no `## Untrusted text` section and no `## Memory` section. Its other sections (identity, persona, duties, boundaries and anything else the charter carries today) are unchanged.
- [ ] AC2. Given that new crew member's session, then the rules those two sections held still reach it through `crewGuide` (a test pins that `crewGuide`'s text carries the untrusted-text rule and the memory rule that the removed sections carried).
- [ ] AC3. Given the charter's approval card and every place the owner sees the charter text before or after approval, then the text shown is the text written (D22: the charter is owner-visible), with no hidden part.

**Edge cases:**
- [ ] AC4. Given an existing crew member's `role.md` written before this change, edited by the owner or not, then the kernel never rewrites, moves, backs up or marks it (no file write, no new audit event; a test pins the bytes unchanged across a kernel start and a session).
- [ ] AC5. Given Wright's `role.md`, then nothing in this item changes it (wa-b owns Wright's file).

**Docs:**
- [ ] AC6. `docs/architecture/brain.md` § Honest limits no longer lists the crew-charter duplicate as open for new charters; it says that charters written before this change keep the two sections, and that the kernel never rewrites a crew charter.
- [ ] AC7. `docs/OPEN_QUESTIONS.md`: the "Still open: nothing tells the owner when a shipped template has changed…" sentence is updated to say what wa-b (PR #318) does for Wright's `role.md` and what stays open (crew charters are never upgraded or flagged).
- [ ] AC8. Any test or doc that pins the old charter text (for example `kernel/test/agents-roster.test.ts` line 287 on `main` at `873fb241`, which expects `## Untrusted text` in `role.md`) is updated to the new text.

**Always:**
- [ ] AC9. No role presets (D22), no preinstalled playbooks, and the kernel enforces only the charter's JSON and the agents table, never its prose (D34).

## Non-goals
- Rewriting, upgrading or flagging any existing crew charter.
- Changing `crewGuide`'s rules, Wright's `role.md`, or the charter JSON (`config/agents/<id>.json`).

## Priority: Medium
**Rationale:** duplicated rules can drift from the guide the kernel keeps current; the fix is small and touches only new charters.

## Validation (must pass before merge)
1. **Static:** `cd kernel && npm ci && npm test`, with tests for AC1, AC2, AC4 and AC8; `cd app && npm run typecheck && npm test` if an app view of the charter text changes; `bash scripts/check-docs.sh`.
2. **Running system (owed live check when the owner is away):** on the owner's install with the kernel from the PR head, approve a new crew member and read its `memory/<id>/role.md`: no `## Untrusted text` or `## Memory` section; an existing crew member's `role.md` is byte-identical before and after. Record it in `docs/evidence/wa-g-new-crew-charters.md` with `Verdict: PASS for Validation 2`.

## Depends on
none

## Touches
kernel/src/agents/charter-files.ts
kernel/test/agents-roster.test.ts
kernel/test/brain-guide.test.ts
docs/architecture/brain.md
docs/architecture/agents.md
docs/OPEN_QUESTIONS.md
docs/evidence/wa-g-new-crew-charters.md
