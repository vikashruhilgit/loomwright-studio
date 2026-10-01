# Supervisor Job: Bring ARCHITECTURE.md in line with the SDK probe findings (D26–D29)

## Environment
- **Project:** /Users/vikashruhil/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-1/01-architecture-sync.md
- **Base commit:** a128872757a24b290c6984fc399fe22806b2fb5a

## Feasibility
- **Verdict:** GO — docs-only edit to one file; every fact to write is already recorded in `docs/DECISIONS.md` (D26–D30) and `docs/OPEN_QUESTIONS.md` (Q1–Q6 probe findings).

## Task
**Goal:** Update `docs/ARCHITECTURE.md` so its Auth, Kernel tools, Main loop, Session manager, Data model and Safety kernel sections match the probe-proven decisions D26–D29, citing D#/Q# for every changed statement.

**Problem Statement:**
The owner and every later phase-1 item need a correct architecture spec because items 02–09 build from it.
Currently, `ARCHITECTURE.md` predates the SDK probes: it says the subscription provider "uses the Claude Code login already on the machine", lists unprefixed kernel tools, and omits cap detection, process-group reaping, D26 budget rules and the `AGENTS.md` risk. This causes later items to build from a stale spec.
Success looks like every statement in the six named sections agreeing with DECISIONS.md/OPEN_QUESTIONS.md, with a D#/Q# citation on each changed line, and no decision altered.

## Acceptance Criteria
- [ ] Given the Auth section, when it's read, then it describes the `subscription` provider per D27: a `claude setup-token` token read from the Keychain item `loomwright-studio-oauth`, passed as `CLAUDE_CODE_OAUTH_TOKEN`, with `settingSources: []`, Loomwright loaded by path, and `ANTHROPIC_API_KEY` stripped from the child environment; it says the provider is personal-build only and compiled out of any distributed build (D29); the phrase "uses the Claude Code login already on the machine" is gone.
- [ ] Given the Kernel tools list, when it's read, then every tool name carries the `kernel_` prefix (`kernel_task_create`, …), with one line explaining why: Q5 showed an unprefixed `task_create` loses to the built-in `TaskCreate`.
- [ ] Given Main loop step 2, when it's read, then it cites D28: the kernel detects the cap from `rate_limit_event` `status: 'rejected'`, parks until `resetsAt` and notifies, and a playbook can opt in to the API-key fallback.
- [ ] Given the Session manager, when it's described anywhere in the doc, then it states the Q5 requirements: the kernel spawns the CLI itself (`spawnClaudeCodeProcess`) in its own process group, recorded in SQLite before start, with a boot-time reaper; every session sets `model` and `permissionMode` explicitly; every tool call passes a kernel `PreToolUse` hook callback; kernel tools need streaming input.
- [ ] Given the Data model, when it's read, then `sessions` includes the process group id and the auth account, `budget` follows D26 (input + output + cache writes count; cache reads recorded, not counted), and a `work_steps` table (idempotency keys, see item 07) is listed.
- [ ] Given the Safety kernel section, when it's read, then it notes that the CLI's builtin `agents-md` plugin loads a worked-on repo's `AGENTS.md` into the model, so that file is untrusted input (invariant 3).
- [ ] Given `docs/DECISIONS.md`, when the PR diff is inspected, then it is unchanged, and every changed statement in `ARCHITECTURE.md` cites its D# or Q#.

## Outcomes Rubric
- `docs/ARCHITECTURE.md` no longer contains the phrase "uses the Claude Code login already on the machine" and its Auth section names `loomwright-studio-oauth`, `CLAUDE_CODE_OAUTH_TOKEN`, `settingSources: []` and cites D27 and D29.
- Every bullet in the Kernel tools section starts with a `kernel_`-prefixed tool name, and the section cites Q5 for the prefix.
- Main loop step 2 mentions `rate_limit_event`, `rejected`, `resetsAt` and cites D28.
- The doc contains a session-manager passage naming `spawnClaudeCodeProcess`, process group, boot-time reaper, explicit `model`/`permissionMode`, `PreToolUse` and streaming input.
- The Data model table lists a `work_steps` row, and the `sessions` and `budget` rows reflect process group id, auth account and D26.
- The PR diff touches no file other than `docs/ARCHITECTURE.md`.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Sync ARCHITECTURE.md with D26–D29 and Q1–Q6 findings | AC 1–7 | 1 modify, 0 create | — | LAUNCHABLE |

## Subtask Contracts

```yaml
# Subtask 1 — Sync ARCHITECTURE.md (LAUNCHABLE)
provides:
  - {kind: "file", path: "docs/ARCHITECTURE.md"}
  - {kind: "symbol", path: "docs/ARCHITECTURE.md", name: "## Auth (D15, D16, D27, D29)"}
  - {kind: "symbol", path: "docs/ARCHITECTURE.md", name: "## Session manager (Q5)"}
requires: []
lanes:
  - "docs/ARCHITECTURE.md"
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
| 1 | none (docs edit; read `CLAUDE.md` invariants, `docs/DECISIONS.md` D26–D30, `docs/OPEN_QUESTIONS.md` technical section) |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Paraphrasing a decision wrongly | MEDIUM | Quote D#/Q# wording where it matters; cite on every changed line |
| Accidentally editing DECISIONS.md or reopening a decision | MEDIUM | Lane is `docs/ARCHITECTURE.md` only; DECISIONS.md is read-only for this job |
| Stating a Q-finding as verified when OPEN_QUESTIONS marks it "not verified" (e.g. the real `rejected` event, launchd login reachability) | LOW | Keep "not verified" qualifiers where the source has them |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-09-30-01-architecture-sync.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-09-30T16:00:20Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/5
- **Branch:** feature/phase1-01-architecture-sync
- **Files changed:** 1
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** docs/ARCHITECTURE.md synced with D26–D29 and Q1–Q6; review PASS (1 MEDIUM, 6 LOW advisory), rubric 6/6.
