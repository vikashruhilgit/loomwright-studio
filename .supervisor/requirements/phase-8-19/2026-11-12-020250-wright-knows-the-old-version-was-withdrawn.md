# 19b — Wright knows the old version was withdrawn

## Status: done
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/264

**Priority:** MVP (small, but it misleads the owner at every redraft) · invariants 2, 3 · follows 18d

**As** the owner,
**I want** Wright's message after a redraft to say that the older version was already withdrawn,
**so that** I am never told to reject an approval that no longer needs me, or to go looking for one that is gone.

## Problem

Since 18d, when Wright holds a new version of a charter, the kernel withdraws the older pending one in the same transaction (`withdrawReplaced`, `kernel/src/approvals/replace.ts`; `decided_by: "kernel"`, `replaced_by`). The card shows "Replaced by v2". But Wright is never told: the held call's answer to Wright is only "held as approval <id>; it did not run…" (`kernel/src/sessions/manager.ts`, the `holdOrUseGrant` branch). `requestApproval` (`kernel/src/approvals/store.ts`) drops the ids `withdrawReplaced` returns.

Seen in 18d's Validation 2 walk (2026-11-11): after approval 22 withdrew 21, Wright wrote "Approval 21 is still there with the old 2,000,000 limit, so reject 21 and approve 22". It said the same again after the workspace reply.

## Scope

1. When a held call withdraws older approvals, the held call's answer to the agent names each withdrawn approval's id and says the kernel withdrew it, so the owner need not decide it.
2. Only the agent's answer changes. Nothing new is queued, nothing is approved, and the withdraw itself is unchanged (invariant 3, 18d's "no decision message").

## Acceptance criteria

**Happy path**

- **AC1.** Given a pending charter approval A for member M, when Wright's next charter call for M is held as B, then the reason Wright receives names B as held and A as withdrawn by the kernel, and tells Wright not to ask the owner to decide A.
- **AC2.** Given that answer, when Wright writes to the owner in the live walk, then its message names B as the one to decide and does not tell the owner to reject or approve A.

**Edge cases**

- **AC3.** Given a held call that withdraws nothing (a first version, or a different member), when it is held, then the reason Wright receives is byte-identical to today's.
- **AC4.** Given two older pending versions of the same member, when a third is held, then both withdrawn ids are named, oldest first.
- **AC5.** Given a call that is granted by an existing grant instead of held, then nothing about withdrawals is added.

**Error scenarios**

- **AC6.** Given the withdraw or the hold fails and rolls back (the transaction throws), when the gate falls back to its fail-closed deny, then Wright is not told of any withdrawal.

## Non-goals

- Changing the withdraw rule, the card's "Replaced by" collapse, or the Approvals screen.
- Notifying the owner of the withdrawal separately (the card already shows it).
- Rewording Wright's prompt to infer withdrawals. The kernel states the fact; Wright doesn't guess.

## Owner decisions

none recorded

## Assumptions

- The withdrawn ids can travel from `requestApproval` / `holdOrUseGrant` to the hook reason without a new store read. `withdrawReplaced` already returns them in the same transaction.
- Wright's replies follow the reason text it receives. AC2 is checked live, not by a unit test.

## Dependencies

- Depends on: 18d (withdraw on replace), merged.
- Blocks: none. It is independent of 19a, and the two share no file.

## Risks

- The hook reason is pinned by many kernel tests (`held as approval` appears in about 10 test files). AC3 keeps the no-withdraw case byte-identical so those don't churn.

## Touches
kernel/src/approvals/store.ts
kernel/src/approvals/replace.ts
kernel/src/sessions/manager.ts
kernel/test/approvals-replace.test.ts
kernel/test/sessions.test.ts
docs/architecture/approvals.md

## Validation (must pass before merge)

1. **Static — kernel suite:** `cd kernel && npm ci && npm run typecheck && npm test` (AC1, AC3–AC6), and `bash scripts/check-docs.sh`.
2. **Running system — Wright's redraft message:** in the packaged app with the kernel running as the installed service, the owner asks Wright for a crew member, then uses the card's Ask or change for a small change (for example a lower daily token limit). Wright's reply names the new approval to decide and says the old one was withdrawn, with no "reject <old id>". The owner reports Wright's message.

## Depends on
none

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-12T11:34:05Z
- **Brief:** .supervisor/jobs/done/2026-11-12-wright-knows-old-version-was-withdrawn.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/264
