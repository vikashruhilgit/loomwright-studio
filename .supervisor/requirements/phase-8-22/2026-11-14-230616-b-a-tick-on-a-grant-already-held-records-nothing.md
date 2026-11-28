# 22b — A tick on a grant already held records nothing

## Status: parked

**Not a bug (2026-11-15).** Launch Pad returned LP-NO-GO for this item and the owner aborted it. Verified on `main` at `1949901e`: a tick that adds no tool already records nothing and names no grant, also on a hand-edited file. `mergeUpdate` builds `merged.text` as a fresh rendering (`JSON.stringify(next, null, 2)`, `kernel/src/agents/charter-tools.ts`), `withConnectors` re-renders the same parsed file, and `mergeConnectorsGrant` returns the stored grant unchanged when nothing is added (`kernel/src/agents/settings.ts:233`), so `text !== merged.text` is false. The premise came from a static CI-review finding on PR #278 and was persisted without a reproduction; the process gap is filed as vikashruhilgit/loomwright#919. Kept parked so no folder run queues it again.

**As** the owner of Loomwright Studio,
**I want** an approval that ticks a tracker capability my crew member already holds to change nothing and say nothing was granted,
**so that** the audit trail and Wright's message never claim a grant that added no tool.

## Why

Raised by the CI review of PR #278 (phase 8 item 21b, 2026-11-14) and left open at merge. In `updateOnApproval` (`kernel/src/agents/charter-tools.ts`), the owner's tick is laid over the member's grant with `withConnectors`, which re-serializes the whole settings file (`JSON.stringify(file, null, 2)`), and `grantChanged` is `text !== merged.text`: a byte comparison of two renderings, not a comparison of the grant. When the settings file's bytes differ from that canonical rendering (an owner's hand edit with other spacing or key order), a tick on capabilities the member already fully holds counts as a change. The file is rewritten, an `agent_settings_set` event is recorded `by: "owner"`, and the applied sentence says "The owner granted <tracker> access with this approval" although nothing was added. Not observed live; read from the code and pinned by the reviewer.

## Acceptance Criteria

**Happy path:**
- [ ] **AC1.** Given a crew member whose settings file holds every tool of the capabilities the owner ticks, when the owner approves an update with those ticks, then no `agent_settings_set` event is recorded for `connectors`, the applied sentence does not say the owner granted access, and `connectors` is not in the update's changed fields.
- [ ] **AC2.** Given the same member and settings file hand-edited to other spacing and key order (same values), when the owner approves the same ticks, then the outcome is the same as AC1, and the file's bytes are unchanged unless another field of the update changed them.
- [ ] **AC3.** Given a tick that adds at least one tool the member lacks, when the owner approves, then the grant is written, recorded and named as today.

**Edge cases:**
- [ ] **AC4.** Given an update that changes another settings field together with a tick that adds nothing, then only that other field is written and recorded, and no grant is named.

## Non-goals

- Changing how a create records its grant (fixed in `6d855422`).
- Reformatting an owner's settings file when nothing changed.

## Owner decisions

none recorded

## Priority: Phase 2

**Rationale:** it misreports an approval on a hand-edited file only; no tool is granted or removed wrongly.

## Assumptions

- The grant comparison can use the parsed grant the merge already produces (`planOwnerGrant`'s old and next values).

## Dependencies

- Depends on: none.

## Risks

- An update test pins byte-identical output today; the fix keeps it for every case that changes the grant.

## Success Metrics

- AC1 to AC4 pinned by tests that fail on the byte comparison.

## Handoff

- `/automate --folder .supervisor/requirements/phase-8-22` with the rest of this folder.

## Validation (must pass before merge)
1. **Static — kernel suite and docs:** `cd kernel && npm ci && npm test`, with new cases in `kernel/test/agents-charter-tools.test.ts` for AC1 to AC4, at least one failing on the old `text !== merged.text` comparison; `bash scripts/check-docs.sh`.

## Depends on
none

## Touches
kernel/src/agents/charter-tools.ts
kernel/test/agents-charter-tools.test.ts
docs/architecture/approvals.md

## Status: done_with_escalation — ABANDONED (not a bug, verified on main 1949901e, LP-NO-GO 2026-11-15)
