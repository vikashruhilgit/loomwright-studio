# Supervisor Job: A dry-run session can read but never act, and reports what it would have done

## Environment
- **Project:** loomwright-studio (lane clone L2 of run automate-2026-10-16-150622)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean, branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-3/2026-10-16-092903-a-dry-run-session-can-read-but-never-act.md
- **Base commit:** a60340ca29d550cf1aa4e2ab127a19fdc4577d8b

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel with vitest; the change lives in `kernel/src/sessions/`. |
| 2 | Dependency Availability | GO | No new dependency. The gate already gets every PreToolUse call (`#gate(live)` in `manager.ts`), and the budget meter already watches every session's messages (`onMessage: budget.observe` in `kernel.ts`). |
| 3 | Architecture Fit | GO | Dry run narrows the existing deny-by-default gate (invariant 3). Item 01 already added the `dryRun` launch option as a no-op (`types.ts`: "Accepted and ignored until item 03"). |
| 4 | Scope vs Supervisor Capability | GO | 5 files (3 modify, 2 create, counting the doc page placeholder as a modify). One subtask is enough. |
| 5 | Hard Blockers | GO | None. |

**Overall Verdict:** GO

## Task
**Goal:** Make `startSession({ …, dryRun: true })` (and a dry-run resume) run a session in which the kernel's PreToolUse gate allows only a fixed read-only set, denies every other call with reason `dry_run`, records each denied call as a "would do" entry, and returns the "would do" list, the final text and the token usage when the session ends.

**Problem Statement:**
The owner needs to see exactly what a playbook would do before enabling it (ROADMAP phase 3 exit, D3), with no way for the dry run to do any of it (invariants 2 and 3).
Today a session either runs a tool, denies it, or holds it for approval (`kernel/src/sessions/policy.ts`). No mode lets a session read while recording every action as "would do". The `dryRun` option item 01 added is accepted and ignored.
Success means a dry-run session can read the repo and the kernel's list/get tools, and every outward or persistent call is denied, recorded, and returned to the caller. No approval row, no grant consumed, no state-changing `kernel_*` write.

## Acceptance Criteria
- [ ] Given a dry-run session that calls Read and then `gh pr comment`, when it ends, then Read ran, the comment did not, and the "would do" list holds exactly the comment call with reason `dry_run`.
- [ ] Given a dry-run session whose policy allows an outward tool, when it calls it, then no approval row is created and no grant is consumed.
- [ ] Given a dry-run session calling a state-changing `kernel_*` tool (e.g. `kernel_task_create`, `kernel_trigger_register`), when it calls it, then it is denied and recorded, and the store is unchanged.
- [ ] Given a non-dry-run session, when the suite runs, then every existing sessions/policy test passes unchanged.
- [ ] Given a dry-run session, when it ends, then its token usage is recorded by the budget meter as for any session.
- [ ] Tests in `kernel/test/sessions-dry-run.test.ts` (a stand-in session, no model); `docs/architecture/dry-run.md` describes the mechanism and the read-only set.

### Design (binding for the worker; it fills in the requirement's Scope items 1–4)

1. **New module `kernel/src/sessions/dry-run.ts`** holds the dry-run mechanism. It is pure, with no I/O, and is a leaf like `policy.ts`:
   - `DRY_RUN_READ_ONLY_TOOLS`: exactly `Read`, `Glob`, `Grep`, `mcp__kernel__kernel_loomwright_capabilities`. Also exported: a predicate that accepts any tool name matching `mcp__kernel__kernel_<name>_list` or `mcp__kernel__kernel_<name>_get`, which is the requirement's "`kernel_*_list` / `_get` tools". Today that is `kernel_task_list`, `kernel_task_get`, `kernel_trigger_list`, and later item 02's `kernel_playbook_list`. Nothing else counts as read-only. In particular `kernel_notify`, `kernel_approval_request`, `kernel_schedule_wakeup`, `kernel_request_stop`, every `*_create` / `*_update` / `*_register` / `*_remove` / `*_disable` / `*_enable` / `*_dry_run`, `Write`, `Edit`, `NotebookEdit`, `WebFetch`, `WebSearch`, `Task` and any MCP tool from another server are all "would do".
   - `DRY_RUN_READ_ONLY_BASH`: a frozen, closed list of program names, matched against the FIRST shell word of the command exactly (case-sensitive, no path, so `/bin/cat` and `./ls` are not in the set). Keep it conservative. Start from `cat`, `head`, `tail`, `ls`, `wc`, `grep`, `pwd`, `echo`, and every entry must be a program that cannot write, send or run another program through its own arguments. Exclude `git`, `gh`, `find`, `xargs`, `env`, `sed`, `awk`, `sort` (`-o`), `uniq` (output file), `tee`, `rg` (`--pre`), `npm`, `npx`, `node`, `sh`, `bash`, `curl`, `date` and `touch`. The doc page names the set and why each excluded program is excluded.
   - A function that classifies one call for a dry-run session from the policy decision and the rail class, and returns either "allow" or a would-do entry: `{ tool, input_summary, would: "run" | "held", action? }`. `input_summary` is a bounded, secret-free summary of untrusted input: the Bash command truncated to the same 500-character bound the `tool_decision` event uses, or the tool input's JSON truncated to a fixed bound. It is data and is never interpolated or executed.
2. **Decision order in `#gate` for a dry-run session.** This is a narrowing. It never widens the policy and never skips the rail:
   1. `decideToolUse` (policy) denies → deny with the policy's reason, exactly as today. That is not a would-do entry, because the real run would not do it either.
   2. `classifyToolCall` (rail) answers `deny` (protected path, merge block, unreadable or too-large Bash) → deny with the rail's reason, exactly as today. Not a would-do entry. The fixed rail is unchanged (Scope 2).
   3. The rail answers `outward` → deny with reason `dry_run` and record a would-do entry `would: "held"` with the rail's `action`. **`holdOrUseGrant` is never called**, so no approval row is written and no grant is consumed (AC2). This also covers a read-only program the rail calls outward, for example `cat ~/.claude/settings.json`.
   4. The rail answers `ordinary`: a read-only tool or read-only Bash command → allow as today; anything else → deny `dry_run` and record a would-do entry `would: "run"`.
   - Every call still records exactly one `tool_decision` event. A dry-run deny records `reason: "dry_run"`. The fail-closed behaviour is unchanged: any throw, including a failure to record the would-do entry, denies with `kernel_gate_error`. The would-do entry is recorded only when the deny was recorded.
   - The model sees `permissionDecision: "deny"` with a fixed reason string that starts with `dry_run` and tells it the call was recorded and not run, so it can describe the rest of its plan (Assumption in the requirement).
3. **The result.** Add a `dryRun` field to `SessionHandle` in `types.ts`: a `Promise<DryRunReport | null>` that settles when `done` settles and never rejects, and is `null` for a session that is not a dry run. `DryRunReport` is `{ wouldDo: readonly WouldDoEntry[]; finalText: string | null; usage: … }`. `finalText` is the same text `result` resolves to, and `usage` is the **last** `result` message's `modelUsage`, normalised per model. It is a cumulative total for the SDK session (`budget/meter.ts` treats successive results as running totals and records deltas), so results are never added together. Use the `UsageTotals` type from `kernel/src/budget/types.ts`. `readTotals` is private to `budget/meter.ts` (outside the lanes), so the worker copies its normalisation into `dry-run.ts` with a comment naming `meter.ts` `readTotals` as the source. The report is held in memory only. Persisting it is item 07's job (`playbook_runs.result`). Token accounting itself is unchanged: the budget meter observes a dry-run session's messages through `onMessage` exactly as for any session (AC5). The dry run never bypasses it.
4. **Resume.** `resumeSession(id, { …, dryRun: true })` resumes as a dry run. Dry run only narrows, so a session that **started** as a dry run stays a dry run on every resume, whatever the resume's `dryRun` says. The manager writes one `session_dry_run` event at a dry-run start (no migration, no schema change) and reads it back on resume. The worker checks that this event kind does not collide with an existing kind (`grep -rn '"session_' kernel/src`).
5. **Non-dry-run sessions are byte-for-byte unchanged**: the same decisions, the same events and the same reasons (AC4). The `dryRun: false` and absent paths take today's code.
6. **Doc page** `docs/architecture/dry-run.md` replaces its one-line placeholder with the mechanism half: what a dry-run session may run (the read-only tool set and the Bash set, with the exclusion reasons), the decision order above, the `dry_run` reason, the would-do entry shape, the report on the handle, the resume rule, and that token usage counts against limits. It ends with a line saying item 07 adds the playbook half. Every relative link resolves (`bash scripts/check-docs.sh`).

## Touched-file invariants

> Grounded at base `a60340ca29d550cf1aa4e2ab127a19fdc4577d8b`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/sessions/manager.ts`**. Keep: the gate fails closed on any throw (`reason = "kernel_gate_error";`), and no tool runs without a recorded kernel decision (`// No tool runs without a recorded kernel decision.`). Keep: the rail applies only after the policy allowed (`// The rail applies only after the policy allowed: it never widens a policy.`). Keep: an outward call's grant use or new approval and its decision event share one transaction (`const outcome = this.#store.transaction(() => {`), and in dry run this path is not entered at all. Reuse: `toolDecisionPayload(` for the event payload (its `MAX_EVENT_COMMAND_CHARS` truncation) and `this.#appendEvent(` for the new `session_dry_run` event. Keep `#checkPlaybookParams`' refusal before any row or spawn, and update its doc comment line `` `dryRun` is accepted and ignored until item 03. `` to describe the new meaning. Fired by: the gate is registered with no matcher (`hooks: { PreToolUse: [{ hooks: [this.#gate(live)] }] }`), so it sees every tool call, and the launch-options builder makes it for the start and for every resume attempt. The dry-run flag therefore travels on `LiveSession` (`interface LiveSession {`), which is built for both a start and a resume, never as a launch-local value. Pinned by: `kernel/test/sessions.test.ts` (`denies a non-PreToolUse hook input with kernel_gate_error`), `kernel/test/approvals.test.ts` (`a failing approval write denies with kernel_gate_error and leaves nothing behind`), and `kernel/test/sessions.test.ts` (`dryRun is accepted and ignored`, an existing test that must stay green unchanged: a dry run with no tool calls still completes).
- **`kernel/src/sessions/types.ts`**. Keep: `ToolPolicy` doc text and shape (`readonly allowedBashPrefixes: readonly string[];`), and the `SessionHandle.result` contract (`readonly result: Promise<string | null>;`, which never rejects). The new `dryRun` handle field follows the same never-rejects contract. Replace the two `/** A dry run. Accepted and ignored until item 03 (phase 3 dry runs) gives it a meaning. */` comments with the real meaning. Mirror: every new exported type is also re-exported from `kernel/src/sessions/index.ts`, and only if that is needed for the test. `index.ts` is not in this brief's lanes, so prefer importing from `../src/sessions/dry-run.js` / `../src/sessions/types.js` directly in the test and leave `index.ts` untouched.
- **`docs/architecture/dry-run.md`**. Keep: it stays linked from `docs/ARCHITECTURE.md` (`[dry runs](architecture/dry-run.md)`). Pinned by: `scripts/check-docs.sh` (relative links resolve).

## Closed enumerations touched

> Sibling grep at base `a60340c`: `grep -rnF 'kernel_gate_error' --exclude=CHANGELOG.md .` → 11 hits in 4 files (docs/architecture/approvals.md, kernel/test/sessions.test.ts, kernel/test/approvals.test.ts, kernel/src/sessions/manager.ts).

- **`dry_run`** (sibling: `kernel_gate_error`), a new `tool_decision` reason. It must be named in:
  - `kernel/src/sessions/manager.ts`: the gate's reason type `let reason: ToolDecisionReason | "kernel_gate_error"`. Extend it to also allow `"dry_run"`.
  - `docs/architecture/dry-run.md`: the new page names the reason. Extend it (new content).
  - `kernel/src/sessions/policy.ts` `ToolDecisionReason`: **no change in this item, deliberately.** That union is the public list of `tool_decision` reasons (re-exported by `kernel/src/sessions/index.ts`, which also lists the gate- and rail-only reasons `approval_required`, `approval_granted`, `protected_kernel_path`, `merge_blocked`), so gate-only reasons usually belong there. `dry_run` joins `kernel_gate_error` as a gate-local reason only because `policy.ts` and `index.ts` are outside this wave's lanes (item 05 of the same wave edits the approval and policy surface). The worker files a follow-up draft under `.supervisor/requirements/proposed/` that adds `dry_run` to the public union.
  - `docs/architecture/approvals.md`, `kernel/test/sessions.test.ts`, `kernel/test/approvals.test.ts`: no change. They describe or pin `kernel_gate_error` behaviour, not a list of every reason.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/sessions-dry-run.test.ts`: the Read + `gh pr comment` would-do test (AC1; `gh pr comment` is rail-outward, so its entry is `would: "held"`, `action: "gh pr comment"`) | Delete the line in `kernel/src/sessions/manager.ts` that sends a dry-run session's `outward` call to the `dry_run` deny. The call then takes the approval path (denied `approval_required`), the would-do list is empty and the test turns red. |
| `kernel/test/sessions-dry-run.test.ts`: the no-approval/no-grant test (AC2) | Same branch: delete the line that sends a dry-run session's `outward` call to the `dry_run` deny before `holdOrUseGrant`. With a matching one-shot grant present, the grant is consumed and the call allowed, so the test turns red. |
| `kernel/test/sessions-dry-run.test.ts`: the ordinary non-read-only call test (Design 2.4, e.g. `Write` to a scratch path and Bash `wc` vs `touch x`) | Delete the line in `kernel/src/sessions/manager.ts` that routes a dry-run session's ordinary non-read-only call to the `dry_run` deny. `Write` then runs (allow) and the test turns red. |
| `kernel/test/sessions-dry-run.test.ts`: the state-changing `kernel_*` test (AC3) | Widen the read-only predicate in `kernel/src/sessions/dry-run.ts` to also accept a `_create` suffix. `mcp__kernel__kernel_task_create` is then allowed and the test turns red. |
| `kernel/test/sessions-dry-run.test.ts`: the budget meter test (AC5) | Skip the `#onMessage` call in `kernel/src/sessions/manager.ts` for a dry-run session. The observer sees no messages and the test turns red. |
| `kernel/test/sessions-dry-run.test.ts`: the report test (finalText, usage, `null` for a non-dry-run session) | Make the handle's `dryRun` resolve to `null` for a dry-run session as well. The test turns red. |
| `kernel/test/sessions-dry-run.test.ts`: the fail-closed test (a failed would-do record) | Wrap the would-do record in `kernel/src/sessions/manager.ts` in a try/catch that swallows the throw and allows. The test asserting a `kernel_gate_error` deny turns red. |
| `kernel/test/sessions-dry-run.test.ts`: the read-only Bash set test | Add `git` to `DRY_RUN_READ_ONLY_BASH` in `kernel/src/sessions/dry-run.ts`. `git status` would then run, and the test asserting it is "would do" turns red. |
| `kernel/test/sessions-dry-run.test.ts`: the resume-stays-dry test | Delete the line in `kernel/src/sessions/manager.ts` that reads the `session_dry_run` event on resume. A resume with `dryRun: false` then runs an outward tool and the test turns red. |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Dry-run gate, report and doc | all | 3 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 — Dry-run gate, report and doc (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/src/sessions/dry-run.ts"}
  - {kind: "symbol", path: "kernel/src/sessions/dry-run.ts", name: "DRY_RUN_READ_ONLY_BASH"}
  - {kind: "symbol", path: "kernel/src/sessions/dry-run.ts", name: "DRY_RUN_READ_ONLY_TOOLS"}
  - {kind: "type", path: "kernel/src/sessions/types.ts", name: "DryRunReport"}
  - {kind: "file", path: "kernel/test/sessions-dry-run.test.ts"}
  - {kind: "file", path: "docs/architecture/dry-run.md"}
requires: []
lanes:
  - "kernel/src/sessions/dry-run.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/test/sessions-dry-run.test.ts"
  - "docs/architecture/dry-run.md"
external_requires: []
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The read-only Bash set lets through a program that can write, send or run another program | HIGH | Closed list, first word exact, conservative, with every exclusion reason in the doc. The shell-metacharacter deny and the rail still apply on top. A test asserts that `git status`, `find . -exec`, `sed` and `sort -o` are all "would do". |
| A dry-run deny path still reaches `holdOrUseGrant` (an approval appears, or a grant is consumed) | HIGH | The outward branch for a dry-run session never enters the approval transaction. AC2's test asserts zero `approvals` rows and an unconsumed one-shot grant. |
| A dry run resumed without `dryRun` acts for real | HIGH | The `session_dry_run` start event makes every resume of that session dry, whatever the resume's `dryRun` says (Design 4). This is pinned by a test. |
| Other lanes in this wave (items 04/05/06) edit `manager.ts` or `types.ts` and conflict | MEDIUM | Keep the edits local to the gate, the handle and the launch option. Leave `index.ts` and `policy.ts` untouched. The wave integration (`wave-build`) resolves marker-only conflicts. |
| A non-dry-run behaviour change slips into the gate refactor | MEDIUM | AC4: the whole existing suite runs unchanged. The dry-run branch is only entered when the live session is a dry run. |
| Token usage on the report is read in a different shape than the meter records | LOW | Reuse the meter's normalisation shape (`readTotals` fields). The report is advisory data, and the meter stays the accounting source. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Validation (must pass before merge)
- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-16-dry-run-session-read-never-act.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-16T10:44:27Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/69
- **Branch:** feature/phase3-03-dry-run-session
- **Files changed:** 5
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Dry-run sessions: the PreToolUse gate narrows policy and rail. Read-only tools and a closed read-only Bash set run, and every other call that would run or be held is denied dry_run and recorded as would-do; holdOrUseGrant is never reached. SessionHandle.dryRun carries the report { wouldDo, finalText, usage }, and a session_dry_run event keeps resumes dry. 26 tests and docs/architecture/dry-run.md. Phase 4.5: iteration 1 PASS with one MEDIUM (report scope across a resume overstated in the docs), fixed in 6551af2; iteration 2 PASS with LOW nits only.

## Not verified
- **real SDK/CLI dry-run session (model-facing deny as tool error)** — fake harness only (subtask 1)
