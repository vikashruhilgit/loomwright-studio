# 21d — Wright drafts a playbook for a crew member that is off

## Status: ready

**As** the owner of Loomwright Studio,
**I want** Wright to draft a playbook for a crew member even while that member is off, and tell me in plain words to turn the member on before anything runs,
**so that** asking for a duty never fails just because the member is off, while an off member still runs nothing.

## Why

Found 2026-11-14 during phase 8 item 21a's Validation 2 walk (kernel at `140076a6`). The owner asked Wright for a ClickUp ticket playbook for Ticket Runner (`ticket-runner-20c`). Ticket Runner was off: the owner had turned it off after item 20c's walk (event 21192, `by: owner`). Wright's `kernel_playbook_create` was refused `agent_off` and nothing was drafted. The owner had to find the member in Team and turn it on before Wright could even write a draft.

The refusal is inconsistent with the rest of the drafting tools:
- `draftOwner` (`kernel/src/playbooks/drafts.ts:289-296`) refuses a create for an `off` member: `agent_off: <id> is off; turn it on before drafting its playbooks`. Phase 4 item 08 pinned this (`kernel/test/playbooks-crew.test.ts:306`, "AC1").
- `kernel_playbook_update` has no such check (`actingAgentFor`, `drafts.ts:276`). `docs/architecture/playbooks.md:37` says "an `off` member's playbook can still be listed, updated or disabled; its dry run and fires refuse `agent_off`". After the owner turned Ticket Runner on, Wright updated the existing playbook 9 rather than drafting a new one, which it could have done while the member was still off.
- D34 says `off` "stops new sessions". A draft starts no session. The dry run (`dry-run.ts:445`) and fires (`runs.ts:428`, `:633`) already refuse `agent_off`, and they are what start the member's sessions.

## Acceptance Criteria

**Happy path:**
- [ ] **AC1.** Given a crew member that is `off`, when Wright calls `kernel_playbook_create` with `agent: <that member>`, then the draft is created and owned by the member, exactly as for an `active` member: same row, version, trigger, mirror and `fit`.
- [ ] **AC2.** Given that create, then its result carries one plain-words line saying the member is off, and that the owner turns it on (Team → the member's inspector → Turn on) before the dry run or the enable. Wright's reply to the owner says the same. Neither names a raw tool name, an error token or a file path.
- [ ] **AC3.** Given the draft and the member still `off`, when Wright dry-runs it, then it is refused `agent_off` before any session starts, as today. Wright's reply names the same owner step in plain words.

**Edge cases:**
- [ ] **AC4.** Given an `off` member's new draft, when Wright asks for its enable, then it is refused `no_dry_run` as today (`enable.ts`: an enable needs a dry run of the current version, which an off member can't get), and Wright's reply names turning the member on as the first step. A fire of an enabled playbook whose member is off still fails `agent_off` with one notification (`runs.ts`), unchanged.
- [ ] **AC5.** Given a create for an `active` member, then behaviour and result are unchanged: no off line.
- [ ] **AC6.** Given a repeat of the same create under the same idempotency key after the member was turned off, then it returns the stored first result instead of `agent_off`. `docs/architecture/playbooks.md:27`'s "a repeat of a create for a crew member that has been turned off since is `agent_off`" is updated to match.

**Error scenarios:**
- [ ] **AC7.** Given `agent` names no registered crew member, or a crew session calls the create, then the refusals are unchanged: `agent: "<id>" is not an active registered crew member` (reworded to drop "active") and `crew_cannot_draft`.

## Non-goals
- Changing what `off` stops: sessions, dry runs, fires and messages stay refused for an off member.
- A Turn on control inside Wright's chat message. The owner's step stays in Team.
- Turning the member on as a side effect of drafting or of the enable approval.

## Owner decisions
- 2026-11-14 (`/product-owner` session, gate PO-ASSUME): "Proceed anyway". This replaces phase 4 item 08's criterion "Given … an `off` agent, then it is refused, and nothing is written" for the create only; its dry-run, enable and fire refusals stand.

## Priority: MVP
**Rationale:** The phase 8 exit re-run asks Wright for ticket playbooks for crew members the owner may have turned off between walks; today the first ask fails.

## Assumptions
- A draft for an off member is harmless: it starts no session and has no trigger effect while the playbook is a draft (`runs.ts` refuses `agent_off` at fire time anyway).
- `playbookFit` reads the member's settings file, not its status, so it works for an off member.

## Dependencies
- Depends on: none (21c also changes `drafts.ts`; the wave planner keeps them apart).
- Blocks: none.

## Risks
- `kernel/test/playbooks-crew.test.ts:306` pins the old refusal; it must change with this item, not be deleted.

## Success Metrics
- In the walk below, the first ask for a playbook for an off member produces a draft, not a refusal.

## Handoff
Ready for: `/launch-pad goal: ".supervisor/requirements/phase-8-21/2026-11-14-120200-d-wright-drafts-a-playbook-for-a-crew-member-that-is-off.md"`

## Validation (must pass before merge)
1. **Static — kernel suite and docs:** `cd kernel && npm ci && npm test`, with `kernel/test/playbooks-crew.test.ts` covering AC1 to AC7; `bash scripts/check-docs.sh`.
2. **Running system — a draft for an off member:** in the packaged app with the kernel installed from the PR head, turn a crew member off in Team, then ask Wright for a playbook for it. The draft appears (`studio playbooks show <id>` names the member), Wright's reply says to turn the member on before the dry run, and a dry run asked for before turning it on is refused in plain words with no session started. Record it in `docs/evidence/phase-8-21d-draft-for-an-off-member.md` with `Verdict: PASS for Validation 2`.

## Depends on
none

## Touches
kernel/src/playbooks/drafts.ts
kernel/test/playbooks-crew.test.ts
docs/architecture/playbooks.md
docs/evidence/phase-8-21d-draft-for-an-off-member.md
