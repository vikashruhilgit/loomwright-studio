# 15 — The live harness scores a playbook's latest dry run, not its first

## Status: ready

**Priority:** MVP · ROADMAP phase 6 (blocks a passing live exit run) · D33

**As** the owner,
**I want** the phase 6 live harness's stage 3 to judge the dry run that let the playbook be enabled,
**so that** a dry run that failed for a fixable reason, and was then rerun successfully, doesn't fail the whole live run.

## Problem

Found in the first live run (2026-10-29, run start 12:23:09 UTC, summary `studio-phase-6-exit-live-summary-1793276588794.json`). Playbook 5 had two dry runs since the run start:

- **Run 9 (version 1):** `done`, with no session, and `poll.preview_incomplete: needs_github`, because Wright's settings granted no `github` connector at the time.
- **Run 10 (version 3):** `done`, session 61 (16.2 s). It listed both planted PRs (`github:vikashruhilgit/studio-sandbox#1` and `#2`), reviewed #1 and recorded no item, key or poll event. The owner then approved the enable, and the kernel enabled version 3.

Stage 3 reported `fail` against run 9 for the rest of the run. The cause is `checkDryRunStage` in `kernel/test/phase-6-exit-live.test.ts`: `const done = runs.find((r) => r.status === "done")` picks the **earliest** done dry run. The kernel itself already does this right: the enable is held only when the **current version** has a `done` dry run (`docs/architecture/dry-run.md`).

## Scope

1. In `checkDryRunStage`, judge the latest `done` dry run of the version the kernel enabled (or, before any enable, the playbook's current version), not the first one. Keep listing every dry run since the run start in `harness.dry_runs`.
2. A canned-store test in the same file: two dry runs, the first `needs_github` and the second complete, passes stage 3; the reverse order (a complete one, then a failed rerun of the current version) still fails.
3. Record run 10's session duration (16.2 s, CLI-observed) against the open MCP tool-call timeout question in `docs/OPEN_QUESTIONS.md`, as one live observation.

## Non-goals

- No change to the kernel's dry-run or enable rules.
- No other stage's checker changes.

## Acceptance criteria

- [ ] Stage 3 passes on a store whose first dry run is `needs_github` and whose later dry run, of the enabled version, lists both PRs and reviewed one.
- [ ] Stage 3 still fails when the enabled version's latest dry run is incomplete.
- [ ] `cd kernel && npm test` passes.
