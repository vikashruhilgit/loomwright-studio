# Supervisor Job: Wright knows the old version was withdrawn (phase 8 item 19b)

## Environment
- **Project:** loomwright-studio (lane checkout `automate-2026-11-12-020724/L2`)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (the source requirement lives under the gitignored `.supervisor/`, so its provenance is the lane's copy, not a commit)
- **Source requirement:** .supervisor/requirements/phase-8-19/2026-11-12-020250-wright-knows-the-old-version-was-withdrawn.md
- **Base commit:** 5ff0d675c4196bda90d7d80f74f27ffc7c50f722

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel with vitest; no new dependency |
| 2 | Dependency Availability | GO | 18d's withdraw on replace (`withdrawReplaced` in `kernel/src/approvals/replace.ts`, called from `requestApproval`) is merged on `main` and already returns the withdrawn ids, oldest first |
| 3 | Architecture Fit | GO | The kernel states a fact it already recorded (invariant 2: the kernel owns the transition, the agent is told). No new approval, decision, event or message (invariant 3); the withdraw rule is unchanged |
| 4 | Scope vs Supervisor Capability | GO | 5 files modified and 1 created, about 150 changed lines: single-agent |
| 5 | Hard Blockers | CAUTION | AC2 and Validation 2 need the owner's live walk in the packaged app; a worker cannot produce that evidence. The evidence file `docs/evidence/` is outside the requirement's Touches (see `## Scope widening`) |

**Overall Verdict:** CAUTION

## Task
**Goal:** When a held call withdraws older pending approvals, the hold reason the agent receives names each withdrawn approval and says the kernel withdrew it, so Wright never tells the owner to decide an approval that no longer needs them.

**Problem Statement:**
The owner needs Wright's redraft message to point only at the approval that still needs a decision, because a withdrawn approval cannot be decided.
Currently, since 18d, holding v2 of a charter withdraws v1 in the same transaction (`withdrawReplaced`, `decided_by: "kernel"`, `replaced_by`), but `requestApproval` drops the withdrawn ids and the gate's hold reason says only "held as approval <id>; it did not run…". In 18d's Validation 2 walk (2026-11-11) Wright wrote "Approval 21 is still there with the old 2,000,000 limit, so reject 21 and approve 22". The owner is sent to an approval that is gone.
Success looks like: the hold reason for v2 names v1 as withdrawn by the kernel, and Wright's reply in the live walk names only v2 as the one to decide.

## Acceptance Criteria
- [ ] **AC1.** Given a pending charter approval A for member M, when Wright's next charter call for M is held as B, then the `permissionDecisionReason` Wright receives starts `approval_required: held as approval B;`, and contains the sentence ` The kernel withdrew approval A (the older pending version of this call); it needs no decision, so do not ask the owner to approve or reject it.`, placed after the "if it is approved, …" clause and before any readiness `agentNote` (so the note stays last). Shown by a kernel vitest through the session gate in `kernel/test/approvals-replace.test.ts` that asserts the whole reason string.
- [ ] **AC2.** Given that answer, when Wright writes to the owner in the live walk (requirement Validation 2: packaged app, the kernel running as the installed service, the owner asks Wright for a crew member, then uses the card's Ask or change for a small change such as a lower daily token limit), then Wright's reply names the new approval to decide and says the old one was withdrawn, with no "reject <old id>". Then a committed evidence file `docs/evidence/phase-8-19b-wright-knows-old-version-withdrawn.md` records the owner's report of Wright's message and the line `Verdict: PASS for Validation 2` at column 0 (outside any fence), and the PR body links to it. The worker creates the file with the walk's steps and Validation 1's output; the owner's report and the Verdict line are added at the owner's walk, as items 18b, 18c and 18d did.
- [ ] **AC3.** Given a held call that withdraws nothing (a first version, a call for a different member, or a hold with no `subject`), when it is held, then the reason is byte-identical to today's: `approval_required: held as approval <id>; it did not run. The owner decides in Studio's Approvals (approval <id>) and the decision arrives as a new message. End your turn now; if it is approved, <ifApproved><note>`. Shown by a kernel vitest asserting the whole string with `toBe` for a first charter hold, for a hold for another member while one is pending, and for a second hold with no subject (`boot(() => ({ display: "d" }))`).
- [ ] **AC4.** Given two older pending approvals 1 and 2 with the same subject (seeded in the store, see Implementation notes "AC4's setup"), when a third version for that subject is held through the gate, then both withdrawn ids are named oldest first: ` The kernel withdrew approvals 1 and 2 (the older pending versions of this call); they need no decision, so do not ask the owner to approve or reject them.` Shown by a kernel vitest asserting the whole sentence.
- [ ] **AC5.** Given a call that an existing one-shot grant lets through instead of holding it, then the reason is exactly `approval_granted` and nothing about withdrawals is added; no approval is withdrawn. Shown by a kernel vitest: hold a charter call, the owner approves it `once` with no applier (the grant is left for the retry), then a second, different charter call for the same member is held as approval 2 (approval 1 is approved, so nothing is withdrawn), then the call identical to approval 1 is repeated and gets `approval_granted`, and approval 2 is still `pending` afterwards.
- [ ] **AC6.** Given the hold's transaction throws after the withdraw (a test trigger `BEFORE INSERT ON events WHEN NEW.kind = 'tool_decision'` that raises), when the gate falls back to its fail-closed deny, then the reason is exactly `kernel_gate_error`, contains no withdrawal sentence, and approval A is still `pending` (the withdraw rolled back with the hold). Shown by a kernel vitest.
- [ ] **AC7 (supporting).** `docs/architecture/approvals.md` §"Withdraw on replace" and the pre-hold-check table row say that the held reason names each withdrawn approval (oldest first) and tells the agent not to ask the owner to decide it, that the reason is unchanged when nothing is withdrawn, and that nothing is stored or queued for it. `cd kernel && npm ci && npm run typecheck && npm test` and `bash scripts/check-docs.sh` pass (requirement Validation 1).

**Evidence rule:** AC1 and AC3 to AC6 are shown by committed kernel tests. AC2 (requirement Validation 2, the owner's walk) is recorded in the committed `docs/evidence/phase-8-19b-wright-knows-old-version-withdrawn.md` with `Verdict: PASS for Validation 2` at column 0 when the owner walks it; the PR body links to it.

## Scope widening
- docs/evidence/phase-8-19b-wright-knows-old-version-withdrawn.md
- accepted: LP-SCOPE 2026-11-12

## Implementation notes (binding where they say "must")

- **The sentence lives in `replace.ts`.** Add `export function withdrawnNote(ids: readonly number[]): string` to `kernel/src/approvals/replace.ts`. It must start with `if (ids.length === 0) return "";` (AC3). One id: `` ` The kernel withdrew approval ${id} (the older pending version of this call); it needs no decision, so do not ask the owner to approve or reject it.` ``. Two or more: the ids in the order given, joined `1 and 2` / `1, 2 and 3` (built as `` `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}` ``, so the literal `join(", ")` appears once in the file), with `approvals`, `versions`, `they need`, `them`. The ids are numbers from the store, never untrusted text.
- **Plumbing in `store.ts`, no new store read.** `RailOutcome`'s held variant gains `readonly withdrawn: readonly number[]` (`{ kind: "held"; id; withdrawn }`); the granted variant is unchanged. `requestApproval` keeps its signature and return type (`kernel/src/approvals/tool.ts` calls it); move its body into a non-exported `insertApproval(store, request, now): { row: ApprovalRow; withdrawn: number[] }` that keeps `withdrawReplaced`'s return value (`[]` when there is no subject), and make `requestApproval` return `insertApproval(...).row`. `holdOrUseGrant` calls `insertApproval` and returns `{ kind: "held", id: row.id, withdrawn }`. Update both functions' doc comments.
- **The reason in `manager.ts`.** In the `rail.kind === "outward"` hold branch, compute `const withdrawn = outcome.kind === "held" ? withdrawnNote(outcome.withdrawn) : "";` after the transaction committed, and build the held reason as `` `...End your turn now; if it is approved, ${ifApproved}${withdrawn}${note}` ``. Import `withdrawnNote` from `../approvals/replace.js`. The `tool_decision` event payload is unchanged (the withdraw is already recorded on each withdrawn approval's `approval_decided` event with `replaced_by`). A throw anywhere in the transaction still reaches the existing `catch` → `kernel_gate_error`, and `withdrawn` is computed only from a committed outcome (AC6).
- **AC4's setup.** Two pending approvals with the same subject cannot arise through the gate (each hold withdraws the one before it). Seed them in the store: call `requestApproval` for 1 and 2 with `subject: "agent:x"`, then set approval 1 back to `pending` (`UPDATE approvals SET status='pending', decision=NULL, decided_by=NULL, decided_at=NULL WHERE id = 1`), so both are pending with the same subject. Never delete an event: `events` is append-only (the `events_no_delete` trigger raises). Approval 1 keeps its earlier `approval_decided` event, which the withdraw query (`SAME_SUBJECT`, on `approvals.status` and the `approval_requested` subject only) does not read; the test comment says so; then hold v3 through the gate with a scripted check answering `{ display: "d", subject: "agent:x" }`, and assert the sentence names `1 and 2`. Also assert `withdrawnNote([1, 2, 3])` ends `approvals 1, 2 and 3 (...)` in a unit case.
- **Tests go in `kernel/test/approvals-replace.test.ts`**, in a new `describe("19b: the held reason names what the hold withdrew", …)` after the existing gate block, reusing `boot()`, `crew()`, `HELD`, `getApproval`, `count`, `events`. `kernel/test/sessions.test.ts` needs no change (none of its holds withdraws anything).
- **Not in scope:** the withdraw rule, the card's "Replaced by" collapse, the Approvals screen, any owner notification, Wright's prompt (requirement non-goals).

## Touched-file invariants

> Grounded at base `5ff0d675c4196bda90d7d80f74f27ffc7c50f722`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/approvals/replace.ts`** — keep: imports only the loop's audit helper and types (`This module imports only the loop's audit helper and types, so \`store.ts\``) so the `studio` CLI loads it without the Agent SDK; keep the withdraw a deny only, with no queued message (`queues no decision message`); keep `withdrawReplaced`'s order and return (`Returns the withdrawn ids, oldest first.`, `WHERE subject = ? ORDER BY id`). `withdrawnNote` must add no import. Pinned by: `kernel/test/approvals-replace.test.ts` (`withdrawReplaced alone: matches the subject exactly, skips the new id and returns what it withdrew`).
- **`kernel/src/approvals/store.ts`** — keep: `requestApproval`'s exported signature and `ApprovalRow` return (caller `kernel/src/approvals/tool.ts`: `const row = requestApproval(ctx.store,`); the withdraw stays inside the same transaction (`if (subject !== undefined) withdrawReplaced(store, subject, id, at);`) before `recordNotification`; the granted paths return before any hold (`return { kind: "granted", id: grant };`) and withdraw nothing (`a grant used here withdraws nothing`). Mirror: `RailOutcome` is re-exported by `kernel/src/approvals/index.ts` (`  RailOutcome,`) and consumed only by `kernel/src/sessions/manager.ts` (`const o = holdOrUseGrant(this.#store, call, this.#now());`). Pinned by: `kernel/test/approvals-replace.test.ts` (`runs in the caller's transaction: a rollback after the hold undoes the new row and the withdraw together`).
- **`kernel/src/sessions/manager.ts`** — keep: one transaction for the hold and its decision event (`// One transaction: the grant's use (or the new approval) and this call's one decision event.`), the fail-closed fallback (`reason = "kernel_gate_error";`), the granted reason (`? "approval_granted"`), the note last and only on a hold (`The check's note for the session (a charter's open readiness findings): only on a hold, after the reason, never stored.`). Reuse: the existing `ifApproved` / `note` composition. Pinned by: `kernel/test/sessions.test.ts` (`/the kernel applies it itself and that message says what it did; do not repeat the call\.$/`), `kernel/test/automate-merge-check.test.ts` (`run exactly the same call again, once\.$/`), `kernel/test/phase-4-exit.test.ts` (`.*the kernel applies it itself .*do not repeat the call\.$/`), and every `held as approval` prefix pin (about 20 test files) — all are no-withdraw holds, so AC3 keeps them green unchanged.
- **`kernel/test/approvals-replace.test.ts`** — keep: the store and gate harness (`function boot(check?: HeldToolCheck)`, `const HELD = (n: number) =>`) and every existing case unchanged; never the real SDK, a model, git or the network (`Never the real SDK, a model,`).
- **`docs/architecture/approvals.md`** — keep: its links resolve (`bash scripts/check-docs.sh` check 1); the section anchor `#withdraw-on-replace` stays (linked from the table row: `[withdraws an older pending approval with the same subject](#withdraw-on-replace)`).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/approvals-replace.test.ts` — AC1: v2's reason contains `The kernel withdrew approval 1 (the older pending version of this call)` | flip `withdrawnNote(outcome.withdrawn)` → `withdrawnNote([])` in `kernel/src/sessions/manager.ts` |
| `kernel/test/approvals-replace.test.ts` — AC3: a first hold's reason `toBe` today's exact string | delete `if (ids.length === 0) return "";` in `kernel/src/approvals/replace.ts` |
| `kernel/test/approvals-replace.test.ts` — AC4: `approvals 1 and 2 (the older pending versions of this call)` | flip `WHERE subject = ? ORDER BY id` → `WHERE subject = ? ORDER BY id DESC` in `kernel/src/approvals/replace.ts` |
| `kernel/test/approvals-replace.test.ts` — AC4 (unit): `withdrawnNote([1, 2, 3])` names `approvals 1, 2 and 3 (the older pending versions of this call)` | flip `join(", ")` → `join(" and ")` in `kernel/src/approvals/replace.ts` |
| `kernel/test/approvals-replace.test.ts` — AC5: the repeated call's reason `toBe("approval_granted")` | delete `return { kind: "granted", id: grant };` in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals-replace.test.ts` — AC6: reason `toBe("kernel_gate_error")` and approval 1 still `pending` | delete `this.#appendEvent("tool_decision", live.id, payload, this.#nowIso());` in `kernel/src/sessions/manager.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | The held reason names the approvals its hold withdrew | all | 5 modify, 1 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel | `kernel/src/approvals/replace.ts` (72 — new home of `withdrawnNote`, the withdraw module), `kernel/src/approvals/store.ts` (827 — about 15 lines; the single authority of `requestApproval` / `holdOrUseGrant`, a return-shape change in place, no new responsibility), `kernel/src/sessions/manager.ts` (3255 — about 3 lines; the one place the hold reason is built) | — | HIGH |
| tests | `kernel/test/approvals-replace.test.ts` (434 — about 120 lines appended; the single home of withdraw-on-replace gate tests, reusing its `boot()` / `crew()` / `HELD` harness rather than a second copy) | — | HIGH |
| docs | `docs/architecture/approvals.md` (289) | `docs/evidence/phase-8-19b-wright-knows-old-version-withdrawn.md` | HIGH |

Requirement Touches `kernel/test/sessions.test.ts` needs no change (no hold there withdraws anything).

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/approvals/replace.ts", name: "withdrawnNote"}
  - {kind: "type", path: "kernel/src/approvals/store.ts", name: "RailOutcome"}
  - {kind: "symbol", path: "kernel/src/approvals/store.ts", name: "insertApproval"}
  - {kind: "symbol", path: "kernel/src/sessions/manager.ts", name: "withdrawnNote"}
  - {kind: "symbol", path: "kernel/test/approvals-replace.test.ts", name: "19b: the held reason names what the hold withdrew"}
  - {kind: "symbol", path: "docs/architecture/approvals.md", name: "Withdraw on replace"}
  - {kind: "file", path: "docs/evidence/phase-8-19b-wright-knows-old-version-withdrawn.md"}
requires: []
lanes:
  - "kernel/src/approvals/replace.ts"
  - "kernel/src/approvals/store.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/test/approvals-replace.test.ts"
  - "docs/architecture/approvals.md"
  - "docs/evidence/phase-8-19b-wright-knows-old-version-withdrawn.md"
external_requires:
  - "The owner's live walk in the packaged app with the kernel as the installed service (AC2, requirement Validation 2)"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The hold reason is pinned by about 20 kernel test files (`held as approval` prefix, and several `$`-anchored suffixes) | MEDIUM | The sentence is empty when nothing is withdrawn (AC3, a `toBe` pin), and it sits before the `agentNote` so suffix pins of the note stay true; none of the existing pins withdraws anything |
| AC2 depends on Wright's model following the reason text; a unit test cannot show it | MEDIUM — Feasibility (Phase 2.5) | The kernel states the fact plainly and says what not to do; AC2 is checked in the owner's live walk and recorded in the evidence file. If Wright still tells the owner to reject the old one, that is a new finding for a follow-up, not a reason to change Wright's prompt here (requirement non-goal) |
| Evidence file `docs/evidence/phase-8-19b-wright-knows-old-version-withdrawn.md` is outside the requirement's Touches | LOW — Feasibility (Phase 2.5) | Recorded in `## Scope widening` as `pending-coordinator` for the coordinator's scope re-gate |
| `kernel/src/sessions/manager.ts` had self-heal fixes before (System Twin incident 2026-10-04) | LOW | The change is three lines in one branch; the five pin mutations above cover it |
| AC4 needs two pending approvals with the same subject, which the gate can never produce | LOW | The test seeds them in the store (Implementation notes) and says why in a comment |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-12-wright-knows-old-version-was-withdrawn.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-12T02:57:30Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/264
- **Branch:** feature/wright-knows-old-version-was-withdrawn
- **Files changed:** 7
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** The held reason now names each approval its hold withdrew (oldest first, before any readiness note; byte-identical when nothing was withdrawn). 9 new kernel vitests cover AC1 and AC3 to AC6; typecheck, 4451 tests and check-docs pass; all 6 pin mutations, applied by hand because the runner is unsupported, fail their tests. Self-heal fixed one MEDIUM doc drift (agents.md:340) in 1 iteration; one LOW nit was dismissed. AC2 (Validation 2) awaits the owner's live walk; the evidence file has no Verdict line yet.

## Not verified
- **Wright's reply in the packaged app after a redraft (AC2, requirement Validation 2)** — needs the owner's live walk with the kernel running as the installed service (subtask 1)
