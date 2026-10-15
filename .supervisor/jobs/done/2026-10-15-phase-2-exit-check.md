# Supervisor Job: Phase 2 exit check: `studio ask` creates a trigger that fires, and a Loomwright version change produces a note, proven deterministically and in the running system

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean, branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (the live run needs the owner at the Mac; see Risk Assessment)
- **Source requirement:** .supervisor/requirements/phase-2/2026-10-14-094208-phase-2-exit-check.md
- **Base commit:** 239a5a97b9e6fba83ce1737a92f6b65d973b7ed8

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest kernel; both new tests follow existing patterns (`kernel/test/brain.test.ts` stand-in session, `kernel/test/exit-live.test.ts` opt-in live test). |
| 2 | Dependency Availability | GO | No new dependency. Every phase 2 item this one depends on (01–07) is merged on `main` with a `## Status: done` close-out stamp. |
| 3 | Architecture Fit | GO | Clock injection exists at the kernel level (`KernelDeps.now`, `loopDeps.now`; triggers' due work fires with `now()` from the loop context, `kernel/src/triggers/index.ts`), the notifier is injectable through a notifications contribution built with `createDeliveryDueWork(deps)`, and `startKernel` takes `contributions` and `sessions.installedPluginsPath`. No production code change is needed. |
| 4 | Scope vs Supervisor Capability | GO | Two test files, one runbook, three doc edits: single subtask. |
| 5 | Hard Blockers | CAUTION | Requirement scope 2 (the live run: launchd install, a real Wright model, a notification click, the literal 17:00 reminder, `kill -9` under launchd) can only be completed by the owner on his Mac. A worker cannot observe a notification click or wait until 17:00. The PR therefore ships everything automatable and is held at the merge gate until the owner's live run commits its evidence (see Risk Assessment and "Owner's live run" below). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Prove phase 2's two exit conditions: (1) `studio ask "remind me at 17:00 to check X"` makes Wright register a trigger that fires a notification with a deep link at 17:00; (2) a Loomwright version change produces one note file and one notification. Once deterministically in CI, once live on the owner's Mac, then mark phase 2 done on that evidence.

**Problem Statement:**
Phase 2's features (items 01–07) are merged and unit-tested one by one, but nothing proves the two "Done when" sentences in `docs/ROADMAP.md` end to end through a real kernel composed with the shipped features.
The roadmap rule is that every phase ends with a check in the running system, not just a test pass (phase 1's live exit run is the precedent: `docs/evidence/phase-1-exit-live-2026-10-06.json`).
Success looks like: a deterministic CI test of both conditions, an opt-in live harness plus a runbook the owner follows, and, after the owner's live run passes, an evidence file and `docs/ROADMAP.md` marking phase 2 done.

## Acceptance Criteria
- [ ] AC1: Given a kernel started with `startKernel` over the shipped contributions (the notifications contribution swapped for one whose delivery due work uses a recording notifier stub, `createDeliveryDueWork`), fake sessions (`kernel/test/session-fakes.ts`), a Wright model set, and an injected clock (`KernelDeps.now` and `loopDeps.now` read the same mutable value) at 16:00 local on a fixed date, when a stand-in Wright session answers `studio ask "remind me at 17:00 to check X"` by calling `kernel_trigger_register` with `kind: "once"`, the spec being that day's 17:00 in the test's time zone, `action: "notify"`, `text: "check X"`, then the CLI prints the stand-in's reply and exits 0, exactly one `triggers` row exists (owning agent `wright`, enabled, `next_fire_at` = that 17:00 instant), and no notification exists yet.
- [ ] AC2: Given AC1's kernel, when the clock is advanced to 17:00:01 and the loop ticks, then exactly one `notifications` row for that trigger exists whose `deep_link` is `deepLinkFor(id)`, and the stub notifier (given `nodePath`/`cliPath` as `darwin()` in `kernel/test/notifications.test.ts` does) received exactly one post for it whose `-execute` argument contains `notifications show <id>` and the test's data dir; further ticks with the clock advanced again add no row and no post (a `once` trigger fires once).
- [ ] AC3: Given a kernel started with `sessions.installedPluginsPath` ONLY (no `sessions.loomwrightPath`: a configured path wins over `installed_plugins.json`, `kernel/src/loomwright/active-install.ts` `resolveLoomwrightInstallWithText`), two installs written with `writeLoomwrightInstall` under the test's temp dir (install A: the valid fixture contract; install B: the same contract with a different `plugin_version`, one added command and one removed skill — the watcher compares the contract's own `plugin_version`, not the `installed_plugins.json` entry's `version`), and a fixture `installed_plugins.json` (`writeInstalledPlugins` + `userEntry`) whose `installPath` is install A, after the first tick has recorded A silently, when `installed_plugins.json` is rewritten so `installPath` is install B and the loop ticks with the clock advanced at least 60 s, then exactly one note file exists under `<dataDir>/memory/shared/loomwright-updates/`, exactly one notification with source `kernel:loomwright_version` exists, and later ticks add neither.
- [ ] AC4: Given the existing suite, when `cd kernel && npm ci && npm run typecheck && npm test` runs on CI (Linux), then AC1–AC3's test (`kernel/test/phase-2-exit.test.ts`) passes with no model, no network and no macOS notifier, the opt-in live test (`kernel/test/phase-2-exit-live.test.ts`) is skipped unless `STUDIO_LIVE=1`, and every other test still passes.
- [ ] AC5: Given the live harness `kernel/test/phase-2-exit-live.test.ts` (opt-in `STUDIO_LIVE=1`, never run in CI or by default, header comment giving the exact command like `kernel/test/exit-live.test.ts`), when the owner runs it, then it drives the machine-observable parts of live steps 1, 3, 4 and 5, each against a named kernel: **steps 1, 3 and 5 run against the launchd service the owner installed with `studio service install`, on its own data dir** (the harness reads the data dir from `STUDIO_DATA_DIR` or the default, uses the built `studio` CLI, and never stops, uninstalls or reinstalls the service): `studio ask` with a time 3 minutes ahead and the trigger row it created; `studio triggers off <id>` on a third reminder and that it never fires; `kill -9` of the service's pid (read from `api.json` and checked against `launchctl print`) between registering a reminder and its time, launchd's restart (a new pid answering `studio status`), and that the reminder fires exactly once. **Step 4 runs against a kernel the harness starts itself under a temp data dir** with `installedPluginsPath` pointed at a temp `installed_plugins.json` it switches between two temp installs (AC3's shape, real contract copies), recording the note file and the notification. Cleanup in `afterEach`: every trigger the harness created on the service is turned off (`studio triggers off`), the kernel it started is stopped and its temp dir removed; nothing it did not start is stopped or removed. It writes a run summary JSON (timings, row counts, event kinds, the commit it ran against; never env or tokens, any `sk-ant-…` string redacted) to a path it prints. The owner-only observations (the notification popping up, the click opening Terminal on `studio notifications show <id>`, the literal `remind me at 5pm` reminder firing at 17:00) are listed in the runbook (AC6) as fields the owner fills in.
- [ ] AC6: Given this item's diff, when the owner reads `docs/evidence/phase-2-exit-runbook.md`, then it lists every live step 1–5 from the source requirement with the exact commands (build, `studio service install`, setting the Wright model, the harness command), what to record for each, and the evidence file's shape (`docs/evidence/phase-2-exit-live-<date>.json`, same style as phase 1's: each step's outcome, failed steps recorded as failed with findings, and the commit the run used).
- [ ] AC7: Given this item's diff, when `bash scripts/check-docs.sh` runs, then it passes; `docs/OPEN_QUESTIONS.md` closes or updates (with what was observed and when, citing `docs/evidence/phase-2-loomwright-host-mode.md` and `docs/evidence/phase-2-notifier-probe.md`) the items items 02 and 03 probed: the `installed_plugins.json` desktop-app case, host mode from Studio, the notifier under launchd; and `docs/ARCHITECTURE.md` "Kernel tools" says which tools phase 2 shipped (the trigger tools, `kernel_approval_request`, `kernel_notify`, `kernel_loomwright_capabilities`) next to its existing "Phase 1 ships the first six" sentence.
- [ ] AC8: Given the worker's commits (checked at worker hand-back, before the owner's live run), when their changed files are listed, then none touches `docs/ROADMAP.md` or any `docs/evidence/phase-2-exit-live-*` file: the done mark and the evidence file are the owner's live-run commit on the same PR branch, made only once all five steps pass (a failed step is recorded as failed with findings, its fix becomes a new item in `.supervisor/requirements/phase-2/`, and phase 2 stays not done until a rerun passes).
- [ ] AC9 (owner-gated, checked after the owner's live-run commit, before merge): `docs/evidence/phase-2-exit-live-<date>.json` records all five live steps with their outcomes and the commit the run used; any failed step is recorded as failed with findings.
- [ ] AC10 (owner-gated, same commit): `docs/ROADMAP.md`'s phase 2 row is marked **Done <date>** with a link to that evidence file and a ✓ on its "Done when" cell, in the phase 1 row's shape; `bash scripts/check-docs.sh` still passes.

## Owner's live run (before merge; not the worker's)

The source requirement's Validation section requires the owner's live run, with its evidence file committed and its path in the PR body, before merge. The worker does not run it and must not fabricate any part of it. After the PR is open the owner follows `docs/evidence/phase-2-exit-runbook.md`, then commits on the PR branch: `docs/evidence/phase-2-exit-live-<date>.json` and the `docs/ROADMAP.md` phase 2 row marked **Done <date>** with the evidence link (the phase 1 row's shape). The PR body gets a `## Not verified` heading listing "Owner's live run (AC9, AC10)" until then.

**What holds the merge.** This item runs under `/automate` in safe mode (no `--auto-merge`), so nothing in the pipeline merges it: the engine parks the PR `awaiting_merge` (or `escalated` by its validation gate) and only the owner merges. The owner merges only after AC9 and AC10 are committed and the evidence path is in the PR body. The worker states this in the PR body's first paragraph.

## Touched-file invariants

> Grounded at base `239a5a97b9e6fba83ce1737a92f6b65d973b7ed8`. The worker re-checks these before hand-back.

- **Kernel test fixtures convention** (`kernel/test/fixtures/loomwright/README.md`, `No test reads the real`) — keep: every `startKernel` call in the new deterministic test injects `sessions.loomwrightPath` or `sessions.installedPluginsPath` under the test's temp dir.
- **`kernel/test/crash-helpers.ts` / `kernel/test/fixtures/crash-harness.mjs`** — reuse, do not change behaviour: if the live harness needs the crash harness, it calls it as `kernel/test/exit-live.test.ts` does; any change to these files must keep `kernel/test/crash-resume.test.ts`, `kernel/test/triggers-crash.test.ts` and `kernel/test/exit-live.test.ts` unchanged and green.
- **`docs/ARCHITECTURE.md` "Kernel tools"** — keep: the "Phase 1 ships the first six" sentence and the tool list; add phase 2's shipped tools as a sentence after it, never by rewriting the list's planned tools as shipped.
- **`docs/ROADMAP.md`** — the worker does not edit it (AC8).

## Pin mutations

| Pin | Mutation (one line, applied to the production code the pin protects; must turn the pin red) |
|-----|-------------------------------------------------------------|
| `kernel/test/phase-2-exit.test.ts` — AC1 one trigger row owned by `wright` with `next_fire_at` = 17:00 | change the registered spec's `next_fire_at` computation in `kernel/src/triggers/store.ts` to store `now` instead of the spec instant |
| `kernel/test/phase-2-exit.test.ts` — AC2 a `once` trigger fires once (no second row, no second post) | two guards, so a two-edit mutation: in `planFire`'s once branch change `next: null` to `next: first` AND delete the fired-path `if (once) store.prepare("UPDATE triggers SET enabled = 0 WHERE id = ?").run(id);` after `last_result = 'fired'` (not the kill-switch one) in `kernel/src/triggers/store.ts` |
| `kernel/test/phase-2-exit.test.ts` — AC2 `deep_link` is `deepLinkFor(id)` | change `` `${NOTIFICATION_DEEP_LINK_PREFIX}${id}` `` to `` `${NOTIFICATION_DEEP_LINK_PREFIX}${id + 1}` `` in the triggers' own notification insert in `kernel/src/triggers/store.ts` (trigger notifications do not go through `notifications/record.ts`) |
| `kernel/test/phase-2-exit.test.ts` — AC3 later ticks add no note and no notification | replace `const sameVersion = latest.plugin_version === observed.plugin_version && latest.contract_schema_version === observed.contract_schema_version;` with `const sameVersion = false;` in `kernel/src/loomwright/version-note.ts` |
| `kernel/test/phase-2-exit.test.ts` — AC3 a version change produces a note | change `latest.plugin_version === observed.plugin_version` to `true` in that same `sameVersion` line of `kernel/src/loomwright/version-note.ts` (the change is then recorded silently, no note) |

(Literals are from base `239a5a9`; the worker applies each mutation once locally, confirms the pin goes red, reverts, and lists the result in the PR body. The first row's literal is the worker's to pick.)

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Phase 2 exit: deterministic test, live harness, runbook, docs | AC1–AC8 (AC9–AC10 are the owner's) | 2 modify (`docs/OPEN_QUESTIONS.md`, `docs/ARCHITECTURE.md`), 3 create (`kernel/test/phase-2-exit.test.ts`, `kernel/test/phase-2-exit-live.test.ts`, `docs/evidence/phase-2-exit-runbook.md`) | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Design notes (binding for the worker; deviations named in the PR body)

1. **Deterministic test** (`kernel/test/phase-2-exit.test.ts`): copy the composition pattern of `kernel/test/brain.test.ts` (`startBrainKernel`, `remindingSession`, `toolsOf`, `memoryKeychain`, `stubProvider`, the `studio` CLI helper) rather than importing from another test file. Contributions = `SHIPPED_CONTRIBUTIONS` with the notifications entry replaced by one whose `dueWork` is `createDeliveryDueWork(<macOS stub with terminal-notifier present>)` (the stub shape is in `kernel/test/notifications.test.ts`). Use a fixed time zone for the "today 17:00" computation (as `brain.test.ts` uses `Asia/Kolkata`/`UTC`) so the test is stable on CI's clock. Clock: one mutable value read by `KernelDeps.now` and `loopDeps.now`; advance it, then wait for the loop's tick (`loopDeps.tickMs` small).
2. **Live harness** (`kernel/test/phase-2-exit-live.test.ts`): `describe.skipIf(!LIVE)` with `LIVE = process.env.STUDIO_LIVE === "1"`; the header states the command and what the owner must have set up first (the runbook). It must never read or print a token, must clean up everything it started in `afterEach` (as `exit-live.test.ts` does), and writes its summary to a printed temp path; the owner copies the parts he needs into the evidence file.
3. **No production change.** If the worker finds a kernel behaviour the exit test cannot pass without changing production code, it stops and reports it (a finding, a new item), never folds a fix into this PR (requirement Risks).

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/test/phase-2-exit.test.ts"}
  - {kind: "file", path: "kernel/test/phase-2-exit-live.test.ts"}
  - {kind: "file", path: "docs/evidence/phase-2-exit-runbook.md"}
requires: []
lanes:
  - "kernel/test/phase-2-exit.test.ts"
  - "kernel/test/phase-2-exit-live.test.ts"
  - "docs/evidence/phase-2-exit-runbook.md"
  - "docs/OPEN_QUESTIONS.md"
  - "docs/ARCHITECTURE.md"
external_requires: []
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
| The live run needs the owner (launchd install, a real Wright model, a notification click, waiting until 17:00) and cannot be done by a worker (source: Feasibility (Phase 2.5)). | HIGH | Split: the worker ships the deterministic test, the live harness and the runbook; the owner's live run commits the evidence and the ROADMAP done mark on the same PR branch (AC8). The merge gate holds the PR until the evidence is in the PR body. |
| The live run finds a gap, as phase 1's first did. | MEDIUM | Findings become new items in `.supervisor/requirements/phase-2/`, not fixes folded into this PR; the failed step is recorded as failed in the evidence file and phase 2 stays not done until a rerun passes. |
| Time-of-day flakiness: "today 17:00 local" on a CI clock in another zone, or near midnight. | MEDIUM | The deterministic test injects the clock and fixes the time zone; it never reads the wall clock for the trigger spec. |
| A test reading the real `~/.claude/plugins/installed_plugins.json` (the version watcher runs in every composed kernel). | MEDIUM | Every `startKernel` call injects `installedPluginsPath`/`loomwrightPath` under the temp dir (fixture convention). |
| The live harness leaks a process or the launchd agent if a step fails. | MEDIUM | `afterEach` cleanup as in `exit-live.test.ts`; the runbook says how to check (`launchctl print`, `ps`). |
| Live steps 1, 3 and 5 write reminder triggers into the owner's real store and `kill -9` his running service (by the requirement's design: step 5 must prove launchd's restart). | MEDIUM | The harness only turns off the triggers it created and never stops, uninstalls or reinstalls the service; the runbook says so up front, and the owner starts it knowingly. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-15-phase-2-exit-check.md
```

## Plan Review: PASS (attempt 3/3)

| # | Severity | Section | Description | Resolution |
|---|----------|---------|-------------|------------|
| 1 | MEDIUM | Pin mutations (row 2) | The two-edit mutation still leaves the pin green: in the same tick `fireDueTriggers` sees `enabled === 1 && next_fire_at === scheduledAt` and `movePastDone` spends the `once` trigger, and the unchanged `fireStepKey(row.id, scheduledAt)` would replay anyway (three guards: `next: null`, `enabled = 0`, `movePastDone`/step-key replay). | deferred — worker uses edit 1 `next: null` → `next: new Date(now.getTime() + 1).toISOString()` in `planFire`'s once branch plus edit 2 (delete the fired-path `enabled = 0`), confirms red, and records the final row in the PR body |
| 2 | MEDIUM | Pin mutations (row 4) / AC3 | Row 4 turns red only if AC3's later ticks each advance the clock by at least `VERSION_CHECK_INTERVAL_MS` (60 s, `kernel/src/loomwright/version-note.ts`); otherwise the throttle skips the check. | deferred — worker advances the clock ≥ 60 s before every later AC3 tick |

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-15T07:02:11Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/56
- **Branch:** feature/08-phase-2-exit-check
- **Files changed:** 5
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** CI exit test (ask → 17:00 trigger → one notification with deep link, once; version switch → one note + one notification), opt-in STUDIO_LIVE harness, runbook, OPEN_QUESTIONS/ARCHITECTURE updates. Phase 4.5: it1 FAIL (HIGH cleanup touched other agents' triggers + 2 MEDIUM) fixed e1636a8; it2 PASS + 2 MEDIUM at floor fixed 9bf5cc9; it3 PASS + 1 MEDIUM at floor fixed dc4d11d (not re-reviewed — final iteration). FINALIZE children check skipped by owner (stale ids from session 2c027050 in state.md). No production code change.

## Not verified
- **kernel/test/phase-2-exit-live.test.ts, all four steps** — never run; STUDIO_LIVE=1 is the owner's live run and needs the launchd service and a real model (subtask 1)
- **owner live steps 1-5, AC9, AC10** — owner-only; the evidence file and the ROADMAP done mark are the owner's commit (subtask 1)
- **CI on Linux** — run locally on macOS only; the exit test uses an explicit darwin notifier stub (subtask 1)
