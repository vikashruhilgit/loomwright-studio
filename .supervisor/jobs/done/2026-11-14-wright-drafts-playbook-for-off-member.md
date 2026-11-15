# Supervisor Job: Wright drafts a playbook for a crew member that is off (phase 8 item 21d)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-14-233007/L1
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-22/2026-11-14-120200-d-wright-drafts-a-playbook-for-a-crew-member-that-is-off.md
- **Base commit:** 1949901eede7ba7e3d00c4be23f4b0c8e187b67b

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest in `kernel/`; no new dependency |
| 2 | Dependency Availability | GO | Uses `getAgent` from `kernel/src/agents/registry.ts`, already imported by `drafts.ts` |
| 3 | Architecture Fit | GO | Mechanism change inside the existing create handler; `off` still stops sessions (D34): dry run (`dry-run.ts` `crewDryRunAs`) and fires (`runs.ts`) keep refusing `agent_off` |
| 4 | Scope vs Supervisor Capability | GO | 3 modify + 1 create, one subtask |
| 5 | Hard Blockers | GO | None |

**Overall Verdict:** GO

## Task
**Goal:** `kernel_playbook_create` drafts a playbook for a registered crew member whether it is `active` or `off`; for an `off` member the result carries one plain-words line telling the owner to turn the member on (Team → the member's inspector → Turn on) before the dry run or the enable, and Wright relays it.

**Problem Statement:**
The owner needs Wright to draft a duty for a crew member even while that member is off, because asking for a playbook should never fail on the member's on/off state when the draft starts no session.
Currently, `draftOwner` (`kernel/src/playbooks/drafts.ts`) refuses a create for an `off` member with `agent_off: <id> is off; turn it on before drafting its playbooks`, while `kernel_playbook_update` already acts on an off member's playbook. This made the phase 8 item 21a walk fail on its first ask (Ticket Runner was off) and forced the owner into Team before Wright could even write a draft.
Success looks like: the first ask for a playbook for an off member produces a draft owned by the member, Wright tells the owner in plain words to turn it on before the dry run, and the dry run, enable and fires stay refused for the off member exactly as today.

**Implementation shape (the literals the Pin mutations below anchor on):**
- In `draftOwner`, delete the `agent_off` line and replace the `isRoutable` line with `if (getAgent(store, requested) === undefined) throw new PlaybookError("invalid_input", \`agent: ${JSON.stringify(requested)} is not a registered crew member\`);`. Drop `isRoutable` from the import if nothing else in the file uses it (`tsc` must stay clean).
- Add, beside `withFit`, a helper `withMemberOff(store, agent, result)` that returns `result` unchanged when `row === undefined || row.status !== "off"` (with `const row = getAgent(store, agent)`), else `{ ...result, member_off: <line> }`. The line is built from the member's `display_name` only, e.g. `Mason is off. Before its dry run or turning this playbook on, turn Mason on: Team, then Mason's inspector, then Turn on.` It contains no tool name, no error token (`agent_off`, `no_dry_run`), no path and no member id. It is read at call time after the step (like `fit`), never stored in the work step, so a repeat reflects the member's status now.
- The create handler returns `withMemberOff(ctx.store, agent, afterStep(ctx, first))`. Update, disable and list are unchanged.
- The create description: its `agent (optional)` sentence says "a registered crew member (active or off)" instead of "an active crew member", and a new string line (its own `"…" +` line, containing the literal `member_off (only when that crew member is off)`) tells Wright to tell the owner the same in its reply, in plain words with no tool name, error token or path, and, when a later dry run is refused because the member is off or an enable because there is no dry run, to name that same owner step (turning the member on in Team) first. The return shape sentence names `member_off`.
- The file header comment's "Wright drafts a playbook for an `active` crew member" and the `draftOwner` / `mayManage` doc comments are updated to match.

## Acceptance Criteria
- [ ] **AC1.** Given a registered crew member that is `off`, when Wright calls `kernel_playbook_create` with `agent: <that member>`, then the draft is created and owned by the member exactly as for an `active` member: same row (`owning_agent`, `status: draft`, `version: 1`), linked trigger owned by the member, `playbook_created` event, mirror with the `- Agent:` line, and `fit` in the result. Pinned in `kernel/test/playbooks-crew.test.ts`.
- [ ] **AC2.** Given that create, then its result carries `member_off`: one plain-words line naming the member's display name and the owner's step (Team → the member's inspector → Turn on) before the dry run or the enable; the test asserts the line contains none of `kernel_`, `mcp__`, `agent_off`, `no_dry_run`, `/`, `.json`, `.md`. The create's tool description contains the `member_off (only when that crew member is off)` sentence telling Wright to say the same to the owner in plain words; a test pins that sentence (as item 21f's description test does).
- [ ] **AC3.** Given the draft from AC1 and the member still `off`, when Wright calls `kernel_playbook_dry_run`, then it is refused `agent_off` (text unchanged: `agent_off: <id> is off; its playbooks do not run`) and no session starts (the `bootManager` harness's `started` list stays empty). The create description's sentence (AC2) names the same owner step for this refusal.
- [ ] **AC4.** Given the off member's new draft, when Wright's `kernel_playbook_enable` reaches the gate, then it is refused before hold with the existing no-dry-run text (`a dry run of version 1 is required`) and no approval is held (`approvals` count 0). The create description's sentence (AC2) tells Wright to name turning the member on as the first step. A fire of an enabled playbook whose member is off still fails `agent_off` with one notification: the existing AC5 fire test in `kernel/test/playbooks-crew.test.ts` stays green unchanged.
- [ ] **AC5.** Given a create for an `active` member, then the result has no `member_off` key and is otherwise unchanged (the existing AC1 active-member test gains a `not.toHaveProperty("member_off")` assertion).
- [ ] **AC6.** Given a create for an `active` member under idempotency key K, then the member is turned off, when the same create is repeated under K, then it returns the first result's `id`, `slug` and `version` (not `agent_off`, no second row), and carries `member_off`. `docs/architecture/playbooks.md`'s sentence "a repeat of a create for a crew member that has been turned off since is `agent_off`, not the stored success" is replaced to say such a repeat returns the stored result.
- [ ] **AC7.** Given `agent` names no registered crew member, then the create is refused `agent: "<id>" is not a registered crew member` (the word "active" dropped) before anything is written; given a crew member's own session calls the create, then it is refused `crew_cannot_draft` as today; given a non-Wright, unregistered session names `agent`, then `agent: only Wright drafts a playbook for another agent` as today. The existing test at `AC1: an unregistered agent (agent:) or an off member (agent_off:) is refused…` is changed (not deleted) to cover these refusals and AC1's off-member success.
- [ ] **AC8 (docs).** `docs/architecture/playbooks.md` describes the create's `agent` as any registered crew member (`active` or `off`), the `member_off` result line, the reworded unregistered refusal, the repeat behaviour (AC6), and drops "at create" from the list of places `agent_off` is refused; `bash scripts/check-docs.sh` passes.
- [ ] **AC9 (evidence).** A committed evidence file `docs/evidence/phase-8-21d-draft-for-an-off-member.md` records Validation 1 (`cd kernel && npm ci && npm test` counts, `npx tsc -p tsconfig.json` exit, `bash scripts/check-docs.sh` output) and the new pins by name, and holds a `## Validation 2` section for the owner's running-system walk (turn a member off in Team, ask Wright for a playbook, see the draft and the plain-words step, a dry run refused with no session) to be filled with `Verdict: PASS for Validation 2` after the walk; the PR body links to it.

## Touched-file invariants

> Grounded at base `1949901eede7ba7e3d00c4be23f4b0c8e187b67b`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/playbooks/drafts.ts`** — keep: crew checks run before the work step and write nothing on refusal: `` `refuseCrewDrafting`, `draftOwner` and `actingAgentFor` stay before the claim, in the handlers `` and `const agent = draftOwner(ctx.store, refuseCrewDrafting(ctx), a.agent);`; keep only-Wright-names-an-agent: `agent: only Wright drafts a playbook for another agent`; keep the crew-session refusal `crew_cannot_draft: ${CREW_CANNOT_DRAFT_DETAIL}`; keep the step result shape `function resultOf(change: PlaybookChange): ToolResult` (the stored result must not gain `member_off`; it is added after the step); reuse: the read-after-step idiom of `export function withFit<T extends object>(` (read now, never stored in the step) and `afterStep(ctx, first)`; keep the CLI-safe import boundary in the header (`the leaf `../agents/registry.js` (types and `Store` reads only)`), so no new import beyond `registry.js`; mirror: dry run still refuses an off owner in `kernel/src/playbooks/dry-run.ts` `if (status !== "active") throw new PlaybookError("agent_off"` and fires in `kernel/src/playbooks/runs.ts` `return row("failed", { error: "agent_off" });` — both untouched; pinned by: `kernel/test/playbooks-crew.test.ts` (`is not an active registered crew member`, `agent_off: mason is off`, item 21f's description sentence `Draft a crew member's playbook only when the owner asked for one`, which must stay in the description verbatim).
- **`kernel/test/playbooks-crew.test.ts`** — keep: helpers `function addMember(id = "mason")`, `async function setMember(id: string, to: "off" | "on")` (the roster's own route) and `async function bootManager()` with its `started` list; keep `footprint()` before/after for "nothing written" on refusals; keep the AC5 fire test `AC5: mason off at fire time` and AC3 dry-run test `AC3: an off owner is refused agent_off` unchanged; reuse `call(...)`, `value<Created>`, `errorText` as the existing AC1 tests do.
- **`docs/architecture/playbooks.md`** — keep: the off-member sentence `an `off` member's playbook can still be listed, updated or disabled; its dry run and fires refuse `agent_off`` (still true); mirror the code's exact refusal texts (`agent: only Wright drafts a playbook for another agent`, the reworded `is not a registered crew member`); `scripts/check-docs.sh` must stay `OK`.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/playbooks-crew.test.ts` — AC1 off-member create succeeds; AC6 repeat after off returns the stored result | flip `getAgent(store, requested) === undefined` → `getAgent(store, requested)?.status !== "active"` in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/playbooks-crew.test.ts` — AC2 `member_off` present for an off member | flip `row.status !== "off"` → `row.status !== "gone"` in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/playbooks-crew.test.ts` — AC5 no `member_off` for an active member | flip `row === undefined || row.status !== "off"` → `row === undefined` in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/playbooks-crew.test.ts` — AC7 reworded unregistered refusal | flip `is not a registered crew member` → `is not an active registered crew member` in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/playbooks-crew.test.ts` — AC2 description sentence | delete `member_off (only when that crew member is off)` in `kernel/src/playbooks/drafts.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Create drafts for an off member, with the plain-words off line; pins, docs, evidence | AC1–AC9 | 3 modify, 1 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel playbooks | `kernel/src/playbooks/drafts.ts` (885 — append: `draftOwner` and `withFit` live here and are the single authority for the create's crew checks and its read-after-step fields; the helper is ~10 lines) | — | HIGH |
| kernel tests | `kernel/test/playbooks-crew.test.ts` (787 — append: the requirement names this file as the pin home, and `addMember`/`setMember`/`bootManager` live only here; the old AC1 off-refusal test is changed in place) | — | HIGH |
| docs | `docs/architecture/playbooks.md` (152) | `docs/evidence/phase-8-21d-draft-for-an-off-member.md` | HIGH |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/playbooks/drafts.ts", name: "withMemberOff"}
  - {kind: "symbol", path: "kernel/src/playbooks/drafts.ts", name: "member_off"}
  - {kind: "symbol", path: "kernel/test/playbooks-crew.test.ts", name: "member_off"}
  - {kind: "symbol", path: "docs/architecture/playbooks.md", name: "member_off"}
  - {kind: "file", path: "docs/evidence/phase-8-21d-draft-for-an-off-member.md"}
requires: []
lanes:
  - "kernel/src/playbooks/drafts.ts"
  - "kernel/test/playbooks-crew.test.ts"
  - "docs/architecture/playbooks.md"
  - "docs/evidence/phase-8-21d-draft-for-an-off-member.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | — | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/playbooks/drafts.ts:289-296` | yes | HOLDS (moved to 342) | `if (getAgent(store, requested)?.status === "off") throw new PlaybookError("agent_off", …turn it on before drafting its playbooks` | tip 47 minutes ago, fetched <1h |
| `kernel/test/playbooks-crew.test.ts:306` | yes | HOLDS | `it("AC1: an unregistered agent (agent:) or an off member (agent_off:) is refused before anything is written; …` | tip 47 minutes ago, fetched <1h |
| `drafts.ts:276` | yes (unique suffix `kernel/src/playbooks/drafts.ts`) | HOLDS (moved to 325) | `export function actingAgentFor(ctx: ContributedToolContext, id: number): string {` | tip 47 minutes ago, fetched <1h |
| `docs/architecture/playbooks.md:37` | yes | HOLDS | `… (an `off` member's playbook can still be listed, updated or disabled; its dry run and fires refuse `agent_off`)` | tip 47 minutes ago, fetched <1h |
| `dry-run.ts:445` | yes (unique suffix `kernel/src/playbooks/dry-run.ts`) | HOLDS (moved to 453) | `if (status !== "active") throw new PlaybookError("agent_off", \`agent_off: ${owner} is off; its playbooks do not run\`);` | tip 47 minutes ago, fetched <1h |
| `runs.ts:428` | yes (unique suffix `kernel/src/playbooks/runs.ts`) | HOLDS (moved to 430) | `return row("failed", { error: "agent_off" });` | tip 47 minutes ago, fetched <1h |
| `docs/architecture/playbooks.md:27` | yes | HOLDS | `… a repeat of a create for a crew member that has been turned off since is `agent_off`, not the stored success.` | tip 47 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Prior churn (postmortem ledger): `docs/architecture/playbooks.md` (17 entries), `kernel/src/playbooks/drafts.ts` (15), `kernel/test/playbooks-crew.test.ts` (1); recurring classes `self_heal_churn` (21), `drain_churn` (10); no `self_heal_miss` | MEDIUM | Keep the doc text exactly in step with the code's refusal strings; run `bash scripts/check-docs.sh` and the full kernel suite before hand-back so self-heal rounds are not spent on doc drift |
| The old AC1 refusal pin (`kernel/test/playbooks-crew.test.ts`) is deleted instead of changed, losing the unregistered / non-Wright refusal coverage | MEDIUM | AC7: change that test in place so it keeps the `ghost` and `SCOUT_SESSION` refusals and the `footprint()` check |
| `member_off` stored in the work step makes a repeat show a stale line, or leaks into the stored result | LOW | Add it after the step like `withFit`; AC6 asserts the repeat's line reflects the status now |
| The line or description leaks a tool name, error token or path to the owner | LOW | AC2's test asserts the line contains none of `kernel_`, `mcp__`, `agent_off`, `no_dry_run`, `/`, `.json`, `.md` |
| Item 21c also edits `drafts.ts` | LOW | The wave planner keeps them apart (requirement Dependencies); rebase on `main` before PR |
| Validation 2 needs the owner's running-system walk in the packaged app | LOW | The evidence file ships Validation 1 and an open Validation 2 section; the owner walks it before merge |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-14-wright-drafts-playbook-for-off-member.md
```

## Plan Review: PASS (attempt 1/3)

| # | Severity | Section | Description | Resolution |
|---|----------|---------|-------------|------------|
| 1 | LOW | Acceptance Criteria | AC8 does not name `docs/architecture/playbooks.md`'s "Wright drafts, the member runs." sentence ("Wright drafts a playbook for an `active` crew member with create's `agent`"), which becomes inaccurate; the worker should reword it to "a registered crew member (`active` or `off`)" along with the other AC8 edits. | warning (below the MEDIUM fix floor) |

## Outcome
- **Status:** completed
- **Completed:** 2026-11-15T02:25:47Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/282
- **Branch:** feature/wright-drafts-playbook-for-off-member
- **Files changed:** 4
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** kernel_playbook_create drafts for a registered crew member whether active or off; an off member's result carries a plain-words member_off line read after the step; dry run, enable and fires still refuse an off member. Tests 4740 passed / 16 skipped, tsc 0, check-docs OK; 5/5 pin mutations held (verified by hand — run-pin-mutations.sh reports unsupported_pin_runner). Phase 4.5 review PASS round 1, 0 issues. Validation 2 (owner's running-app walk) is open in the evidence file.

## Not verified
- **the packaged app's Wright reply relaying member_off to the owner** — needs the owner's running-system walk (Validation 2); no local app runtime was used (subtask 1)
