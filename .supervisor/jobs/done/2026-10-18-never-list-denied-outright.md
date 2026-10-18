# Supervisor Job: A crew member's `never` list is denied outright, before any approval or grant

## Environment
- **Project:** loomwright-studio (lane clone L2 of run automate-2026-10-18-135554)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-4/2026-10-18-041103-a-crew-members-never-list-is-denied-outright.md
- **Base commit:** 0fbe903b7c64522529ae04eea81ac5d3af146729

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest in `kernel/`; pure function plus one gate branch. |
| 2 | Dependency Availability | GO | No new dependency. |
| 3 | Architecture Fit | GO | Item 01 (PR #83, merged) already added `ToolPolicy.never`, `NEVER_CATEGORIES`, the `boundaryDecision` stub and its call site in the gate. |
| 4 | Scope vs Supervisor Capability | GO | 6 files, one worker. |
| 5 | Hard Blockers | CAUTION | The requirement's `## Touches` omits `kernel/src/sessions/manager.ts` and `kernel/test/sessions.test.ts`, but scope 2–3 (the category on the event, the pinned reason text) can only land in the gate's deny branch. See Risk Assessment. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Make `boundaryDecision` decide: an outward call whose rail form falls in the session policy's `never` list is denied `agent_boundary` with its category, never held, never covered by a grant.

**Problem Statement:**
The owner needs a crew member's `never` list enforced by the kernel because "comment-only, can't push" must be a boundary that cannot be approved away.
Currently, `boundaryDecision` (`kernel/src/sessions/policy.ts`) answers `none` for every call, so a policy that allows the Bash prefix `git` (for `git diff`) still lets a push be held as an approval the owner could grant.
Success looks like: with `never: ["git_push"]` every push form the rail recognises is denied `agent_boundary` (category `git_push`) with one `tool_decision` event and no approval row, while `git diff`, `gh pr comment` holds and every existing rail test stay unchanged.

## Acceptance Criteria
- [ ] AC1: Given a policy allowing the Bash prefix `git` with `never: ["git_push"]`, when the session runs `git push origin main`, `git -c alias.p=push p`, `git subtree push` or `git pu*`, then each is denied `agent_boundary` (category `git_push`), with exactly one `tool_decision` event, no approval row and no `approval_used` or `approval_grant_used` event.
- [ ] AC2: Given the same policy, when the session runs `git diff` or `git log`, then each is allowed as before (`bash_prefix_allowed`, no approval row).
- [ ] AC3: Given `never: ["git_push"]` and a policy allowing `gh pr comment`, when the session runs `gh pr comment 3 -b x`, then it is held as an approval exactly as today (`approval_required`), so the boundary never widens or narrows anything outside its categories.
- [ ] AC4: Given a standing grant whose exact payload is a push, and a policy that now has `never: ["git_push"]`, when the identical call is made, then it is denied `agent_boundary` and the grant is not used (no `approval_grant_used` / `approval_used` event).
- [ ] AC5: Given a policy with no `never` (or `never: []`), when any outward call is made, then `boundaryDecision` answers `none` and every existing rail test passes unchanged.
- [ ] AC6: Given the merge block and a boundary both matching (`gh pr merge 3` with a `never` naming PR writes, e.g. all of `NEVER_CATEGORIES`), when the call is made, then it is denied `merge_blocked`, which comes first in the order.
- [ ] AC7: Given every label the rail can emit for an outward Bash/Write/Edit/NotebookEdit call (every `GIT_OUTWARD` label, `git p4 submit`, `git alias`, each `gh pr`/`gh issue`/`gh alias` label, `gh api <VERB>`, `gh api (flag unread)`, and each `<tool> ~/.claude/` / `a settings*.json file` / `a hooks file` label), when it is mapped, then it maps to at least one `NeverCategory`; and the `ALWAYS_HELD_TOOLS` actions (`kernel_playbook_enable`, `kernel_agent_create`, `kernel_agent_update`) map to none.
- [ ] AC8: Given a call the rail reads as several outward forms (e.g. a Write to `~/.claude/hooks/x.sh`, read as both `~/.claude/` and `a hooks file`), when `never` names any one of their categories (here `hooks_write`), then it is denied `agent_boundary` with that category.
- [ ] AC9: Given a boundary deny, then the hook's `permissionDecisionReason` starts with `agent_boundary` and names the category, and says the owner's settings forbid this for this agent and not to ask for an approval or retry — pinned exactly in a test; and its `tool_decision` payload carries `reason: "agent_boundary"` and `category: "<category>"`.
- [ ] AC10: Given this change, when `docs/architecture/approvals.md` "The rail" is read, then it documents the boundary step in the order (after the merge block, before the outward set's grants and hold), the category table (category → the rail forms it covers) and the honest limits (`env git push`, `sh -c`, `xargs`, a script or Makefile target, a pre-defined alias are not recognised, so not covered by `never`); `docs/ARCHITECTURE.md` no longer says `boundaryDecision` answers "no boundary" for every call; and when `bash scripts/check-docs.sh` runs, then it passes.
- [ ] AC11: Given the change, when `cd kernel && npm ci && npm run typecheck && npm test` runs, then it passes.

## Touched-file invariants

> Grounded at base `0fbe903b7c64522529ae04eea81ac5d3af146729`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/sessions/policy.ts`** — keep: `boundaryDecision` pure, no I/O (`Pure: no I/O.`), and its return shape `{ readonly kind: "none" } | { readonly kind: "boundary"; readonly category: NeverCategory }`; keep `NEVER_CATEGORIES` closed and frozen (`export const NEVER_CATEGORIES = Object.freeze([`) with the same 14 values in the same order; keep `classifyToolCall`'s order (`if (form === "merge") return { kind: "deny", reason: "merge_blocked" };` before any outward answer) and keep its `action` string for every existing call byte-identical (approvals store it, grants match on the payload, `approvals.test.ts` compares outward classes with `toEqual`, e.g. `action: "Write ~/.claude/"`). reuse: the rail's own label tables (`GIT_OUTWARD`, `GH_PR_OUTWARD`, `GH_ISSUE_OUTWARD`, `GH_ALIAS_OUTWARD`, the `railTargets` outward labels `"~/.claude/"`, `"a settings*.json file"`, `"a hooks file"`) — no new matcher. If the outward class gains a field listing extra forms read, it must be optional and present ONLY when the extra forms add a `NeverCategory` that the `action` label's own mapping does not already cover — so `kernel/test/approvals.test.ts`'s `expect(classify("Write", input)).toEqual({ kind: "outward", action: "Write ~/.claude/", payload: { tool: "Write", input, cwd: RAIL.cwd } });` (a `~/.claude/settings.json` path, read as both `~/.claude/` and `a settings*.json file`, both `settings_write`) stays byte-identical and green, while `~/.claude/hooks/x.sh` (`settings_write` + `hooks_write`) carries the field (AC8). mirror: `ToolDecisionReason` keeps `"agent_boundary"`; update its doc comment (`Unreachable until phase 4 item 03 fills`) and `boundaryDecision`'s (`Today it answers \`none\` for every call`) and the `NEVER_CATEGORIES` comment if `git alias` also maps to `git_push`. pinned by: `kernel/test/sessions-policy.test.ts` (`is the closed, frozen list of never categories`, `answers no boundary for every outward call today` — the latter is item 01's placeholder and is replaced by this item's tests).
- **`kernel/src/sessions/manager.ts`** — keep: the call site and its position (`const boundary = rail.kind === "outward" ? boundaryDecision(live.policy, rail) : undefined;`) before the dry-run branch and the hold; the boundary branch writes no approval and looks up no grant and records exactly one event through `record()` (`toolDecisionPayload(tool, decision, reason, command, undefined)`); fail closed (`reason = "kernel_gate_error"` in the `catch`). Change only the boundary branch: carry the category into that one `tool_decision` payload and return the pinned reason text in `permissionDecisionReason` (today the deny tail returns the bare `reason`). reuse: the existing `refusal`-style local for a custom deny text (`reason === "held_refused" ? (refusal ?? reason) : reason`). update: the `#gate` doc comment's stale sentences (`with the bare reason \`agent_boundary\`` and `Today it answers \`none\` for every call, which changes nothing.`). pinned by: `kernel/test/sessions.test.ts`'s item 01 placeholder describe `the never boundary (phase 4 foundation)`, whose tests run the REAL `boundaryDecision` with `never: ["git_push"]` and a `git push` and expect `none`, so they go red once it is filled: (1) `startSession and resumeSession accept never: [git_push]` (expects `approval_required: held as approval 1;`); (2) `the gate asks boundaryDecision for outward calls only; a boundary answer denies with the bare reason agent_boundary` (expects `approval_required`, then `permissionDecisionReason: "agent_boundary"` exactly, then `approval_granted`); (3) `in a dry run, a boundary answer denies agent_boundary before the dry-run branch` (expects `.toBe("agent_boundary")`, a would-do entry, reasons `["agent_boundary", "dry_run"]`). Update them: use a `never` that does not match the call (e.g. `["gh_pr_comment"]`) wherever they test the held / granted / would-do paths, and the pinned reason text wherever they assert the boundary deny.
- **`docs/ARCHITECTURE.md`** — keep: the paragraph on `never` (`A session policy may carry \`never\``); update its stale last sentence (`Today \`boundaryDecision\` answers "no boundary" for every call, so nothing changes until the item that fills it.`) to say a call in a `never` category is now denied `agent_boundary`, linking the approvals.md rail step; keep every relative link resolvable.
- **`docs/architecture/approvals.md`** — keep: the numbered rail list under `## The rail` (`5. **The outward set: held as a pending approval**`), renumbering so the boundary is its own step between the merge block and the outward set; keep every relative link resolvable (`scripts/check-docs.sh` check 1).

## Closed enumerations touched

> Sibling grep at base `0fbe903`: `grep -rnF 'held_refused' kernel/src docs` (a gate-local deny reason with custom text) and `grep -rnF 'approval_id' kernel/src/sessions/manager.ts` (the optional key on the `tool_decision` payload).

- **`category`** (new optional key on the `tool_decision` event payload; sibling: `approval_id`) — must be named in:
  - `kernel/src/sessions/manager.ts` — `toolDecisionPayload` (`...(approvalId === undefined ? {} : { approval_id: approvalId }),`) — extend (or add the key only in the boundary branch).
  - `docs/architecture/approvals.md` — `Every call still records exactly one \`tool_decision\` event (with \`approval_id\` when one was held or used).` — extend: `category` on an `agent_boundary` deny.
  - `docs/architecture/approvals.md` — the Audit events table row `| \`tool_decision\` | \`{tool, decision, reason, command?, approval_id?}\` |` — extend: add `category?` to the payload and `agent_boundary` to the reasons that row lists.
- **`agent_boundary`** is already in `ToolDecisionReason` (item 01); no new reason value.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/sessions-boundary.test.ts` — git push forms denied `agent_boundary` | delete `if (categories.some((c) => never.includes(c)))` style match in `kernel/src/sessions/policy.ts` (make `boundaryDecision` return `{ kind: "none" }` again) |
| `kernel/test/sessions-boundary.test.ts` — `git -c alias.p=push p` is category `git_push` | flip the `git alias` mapping to `alias_define` only in `kernel/src/sessions/policy.ts` |
| `kernel/test/sessions-boundary.test.ts` — merge before boundary (AC6, through the gate) | flip `if (form === "merge") return { kind: "deny", reason: "merge_blocked" };` to return `{ kind: "outward", action: "gh pr merge", payload }` in `kernel/src/sessions/policy.ts` |
| `kernel/test/sessions-boundary.test.ts` — a standing grant is not used under a boundary (AC4) | move the boundary branch in `#gate` (`kernel/src/sessions/manager.ts`) below the grant/hold path |
| `kernel/test/sessions-boundary.test.ts` — multi-form Write to `~/.claude/hooks/x.sh` denied `hooks_write` (AC8) | make `boundaryDecision` check only `rail.action` in `kernel/src/sessions/policy.ts` |
| `kernel/test/sessions-policy.test.ts` — `ALWAYS_HELD_TOOLS` actions map to no category (AC7) | map `kernel_agent_create` to `settings_write` in `kernel/src/sessions/policy.ts` |
| `kernel/test/sessions-policy.test.ts` — every rail label maps to a category | delete the `gh api` mapping in `kernel/src/sessions/policy.ts` |
| `kernel/test/sessions.test.ts` — pinned reason text and `category` on the event | delete the boundary branch's custom text in `kernel/src/sessions/manager.ts` (bare `agent_boundary` returned) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Fill `boundaryDecision`, wire its category and reason text through the gate, test and document it | all | 6 modify, 1 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "boundaryDecision"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "NEVER_CATEGORIES"}
  - {kind: "file", path: "kernel/test/sessions-boundary.test.ts"}
  - {kind: "symbol", path: "docs/architecture/approvals.md", name: "agent_boundary"}
requires: []
lanes:
  - "kernel/src/sessions/policy.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/test/sessions-policy.test.ts"
  - "kernel/test/sessions-boundary.test.ts"
  - "kernel/test/sessions.test.ts"
  - "docs/architecture/approvals.md"
  - "docs/ARCHITECTURE.md"
external_requires: []
```

### Design notes (for the worker)
- **Mapping.** An exported pure helper (e.g. `neverCategoriesOf(action: string): readonly NeverCategory[]`) maps a rail action label to its categories: every `GIT_OUTWARD` label and `git p4 submit` → `git_push`; `git alias` → `alias_define` AND `git_push` (the rail holds it because an inline alias or autocorrect runs a push: `git -c alias.p=push p`, AC1); `gh alias set|import` → `alias_define`; `gh pr create|comment|review|edit|close` → `gh_pr_*`; `gh issue create|comment|edit|close` → `gh_issue_*`; `gh api <VERB>` and `gh api (flag unread)` → `gh_api_write`; `Bash naming ~/.claude/`, `Bash naming a settings*.json file` and the Write/Edit/NotebookEdit forms of both → `settings_write`; `… a hooks file` → `hooks_write`; `ALWAYS_HELD_TOOLS` actions → none.
- **Several forms.** The rail answers one `action`. To deny when ANY form read is in `never` (AC8), `classifyToolCall` may record the extra outward forms it read (the command form plus every path label) in an optional field, present only when those extra forms add a category the `action`'s own mapping lacks (so `approvals.test.ts`'s `Write ~/.claude/` toEqual stays byte-identical); `boundaryDecision` checks the `action` and all of them. The call site `boundaryDecision(live.policy, rail)` is unchanged, so the rail object is the only carrier. The reported category is the first match in `NEVER_CATEGORIES` order.
- **Order.** The merge block and protected paths are `deny` classes, so they can never reach `boundaryDecision` (which takes only `outward`): the order policy → unreadable Bash → protected → merge → boundary → grants/hold holds by construction; AC6 tests it end to end through the gate.
- **Reason text.** One exported constant/function in `policy.ts` builds it, e.g. `agent_boundary: <category> is in this agent's never list. The owner's settings forbid it for this agent; it did not run. Do not ask for an approval and do not retry it.` — the test pins it exactly.

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
| Requirement's `## Touches` omits `kernel/src/sessions/manager.ts`, `kernel/test/sessions.test.ts` and `docs/ARCHITECTURE.md` (whose `never` paragraph goes stale), yet scope 2–3 (category on the event, pinned reason text) can only land in the gate. Its Assumption forbids editing `manager.ts` only if item 01's call site were missing; it is present (`manager.ts`, `const boundary = rail.kind === "outward" ? boundaryDecision(live.policy, rail) : undefined;`). | MEDIUM | Change only the boundary branch of `#gate`; the call site and its position stay. Wave 1's other lanes (items 02, 04, 06) touch neither file, so no lane conflict. The PR body names the deviation. (source: Feasibility (Phase 2.5)) |
| A mapping that misses one of the rail's labels lets that form through to a hold instead of a deny. | HIGH | AC7's test enumerates every label the rail can emit (from its own tables, or by driving one command per form through `classifyToolCall`) and asserts each maps to ≥1 category. |
| Adding a field to the outward class breaks existing `toEqual` assertions on `classifyToolCall` (`approvals.test.ts` — including the two-label `Write ~/.claude/settings.json` case — and `sessions-dry-run.test.ts`). | MEDIUM | Make the field optional and present only when the extra forms add a category the `action` does not already map to; keep every existing `action` and every existing `toEqual` byte-identical. |
| Prior churn on every touched path (`manager.ts` 17, `sessions.test.ts` 8, `approvals.md` 7, `policy.ts` 5, `sessions-policy.test.ts` 5); recurring classes `self_heal_churn` (18) and `drain_churn` (8), no `self_heal_miss`. | MEDIUM | Keep the change surgical and the docs exact (approvals.md wording reviews have churned before); run typecheck, the full vitest suite and check-docs before hand-back. (source: Prior churn (postmortem ledger)) |
| `git alias` also mapping to `git_push` denies an alias definition in a `git_push`-never session even when the alias is harmless. | LOW | Over-denying is the safe direction and matches why the rail holds aliases; documented in the category table. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-18-never-list-denied-outright.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-18T10:13:24Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/84
- **Branch:** feature/never-list-denied-outright
- **Files changed:** 7
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** boundaryDecision filled via neverCategoriesOf over the rail's own labels plus an optional alsoReads; the gate records category on the one tool_decision event and returns the pinned agent_boundary reason; approvals.md rail step 5 + category table + limits. Phase 4.5 code-reviewer PASS on the first review (1 LOW dismissed below the MEDIUM fix floor); rules none; required CI green; risk_classification high_risk (auth content match; 587 changed lines) — advisory.

## Not verified
- **live Claude session reading the agent_boundary hook reason** — verified only through the real gate over the fake SDK (subtask 1)
