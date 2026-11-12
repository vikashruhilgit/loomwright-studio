# Phase 8 item 19b evidence: Wright knows the old version was withdrawn

**What shipped:** when a held call withdraws older pending approvals (18d's withdraw on replace), the reason the agent receives names each withdrawn approval, oldest first, says the kernel withdrew it, and tells the agent not to ask the owner to approve or reject it. The sentence (`withdrawnNote`, `kernel/src/approvals/replace.ts`) sits after the "if it is approved, …" clause and before any readiness `agentNote`, so the note stays last. When nothing is withdrawn, the reason is byte-identical to before. The ids travel from `withdrawReplaced` through `insertApproval` and the `held` `RailOutcome` to the session gate in the same transaction, with no new store read. Nothing is stored or queued for the sentence, and the withdraw rule is unchanged. Design: [approvals.md, Withdraw on replace](../architecture/approvals.md#withdraw-on-replace).

This file holds the committed tests behind each criterion and the owner's running-system check (Validation 2). The worker that wrote it does not write the Validation 2 verdict. Only the owner's report does.

## Validation 1 (static suites)

Run on macOS (Darwin 25.6.0, Node v24.11.1) on 2026-11-12, from the working tree of branch `feature/wright-knows-old-version-was-withdrawn` over base `5ff0d675` with the change applied. Each command was run as written, and the counts are copied from its output.

| Command | Result |
|---|---|
| `cd kernel && npm ci` | exit 0 |
| `cd kernel && npm run typecheck` | exit 0, `tsc -p tsconfig.json` clean (covers `src` and `test`) |
| `cd kernel && npm test` | exit 0. 131 test files passed, 2 skipped (133); **4451 passed**, 16 skipped (4467) |
| `cd kernel && npx vitest run test/approvals-replace.test.ts` | exit 0, **26 passed** (the 18d file's 17 cases plus 9 new ones for 19b) |
| `bash scripts/check-docs.sh` | exit 0, `check-docs: OK` |

## Each criterion and the committed test that shows it

All in `kernel/test/approvals-replace.test.ts`, `describe("19b: the held reason names what the hold withdrew")`.

| AC | Shown by |
|---|---|
| AC1 v2's reason names v1 as withdrawn, before the note | "AC1: v2 of a member's charter is told, before any note, that the kernel withdrew v1" (the shipped pre-hold check, whose readiness note is asserted present and last; the whole reason with `toBe`) and "AC1: the withdrawal sentence sits after the if-approved clause and before the check's agentNote, which stays last" (a scripted check with a note) |
| AC2 Wright's live reply | Validation 2 below (the owner's walk) |
| AC3 no withdraw, byte-identical reason | "AC3: a first charter hold and a hold for another member while one is pending read exactly as before" (shipped check), "AC3: with a scripted check (no note), …" and "AC3: a second hold with no subject reads exactly as before" (`boot(() => ({ display: "d" }))`), each with `toBe` |
| AC4 two withdrawn ids, oldest first | "AC4: two older pending versions of one subject are both named, oldest first" (two pending approvals seeded in the store, then v3 held through the gate) and "AC4 (unit): withdrawnNote names one, two or three ids …" (`approvals 1, 2 and 3`) |
| AC5 a grant adds nothing and withdraws nothing | "AC5: a call an existing one-shot grant lets through is approval_granted, …" (approval 2 still `pending` afterwards) |
| AC6 a rolled-back hold names nothing | "AC6: a hold whose transaction throws after the withdraw is kernel_gate_error, …" (a test trigger on `tool_decision` raises; approval 1 still `pending`, no `approval_decided` event) |
| AC7 docs | [approvals.md](../architecture/approvals.md): the pre-hold check table row and §"Withdraw on replace"; `check-docs: OK` above |

**Mutation checks (from the brief's pin table):** each mutation was applied alone to the working tree, the named tests run with `npx vitest run test/approvals-replace.test.ts -t <filter>`, and the file restored from a copy.

- `withdrawnNote(outcome.withdrawn)` → `withdrawnNote([])` in `manager.ts`: both AC1 tests failed (2 failed).
- `if (ids.length === 0) return "";` deleted in `replace.ts`: the three AC3 tests failed (3 failed).
- `WHERE subject = ? ORDER BY id` → `… ORDER BY id DESC` in `replace.ts`: the AC4 gate test failed (1 failed).
- `join(", ")` → `join(" and ")` in `replace.ts`: the AC4 unit test failed (1 failed).
- `return { kind: "granted", id: grant };` deleted in `store.ts`: the AC5 test failed (1 failed).
- `this.#appendEvent("tool_decision", live.id, payload, this.#nowIso());` deleted in `manager.ts`: the AC6 test failed (1 failed).

### What the static suites do not show

- **Wright's own reply.** That Wright follows the reason and tells the owner only the new approval needs a decision needs a live model turn (AC2). The tests show the exact text Wright receives.

## Validation 2 (owner)

In the packaged app (`cd app && npm run package`, then open the built app), with the kernel running as the installed service:

1. In Wright's thread, ask Wright to draft a crew member. Check that Wright holds a charter approval (v1) and the card shows it.
   - What it showed:
2. On v1's card, use Ask or change for a small change, for example "lower the daily token limit to 1,500,000; keep everything else the same", and Send. Check that Wright holds a v2 and that v1's card collapses to "Replaced by v2".
   - What it showed:
3. Read Wright's reply in the thread after the v2 is held. Check that it names v2 as the approval to decide, says the old one was withdrawn, and does not tell the owner to "reject <v1's id>" or to approve v1.
   - What it showed (Wright's message, as the owner reports it):

Owner's result (filled in from the owner's report):
