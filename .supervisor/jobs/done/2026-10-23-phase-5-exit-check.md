# Supervisor Job: Phase 5 exit check: prove "everything in phases 2–4 can be done from the app, with nothing typed in a terminal" deterministically (CI), and ship the live harness and owner runbook

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ⚠ Found (stale in one line: "The next step is phase 1 (the kernel)" although phases 1–4 are done; the patterns and invariants it states are current)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 2 (the stale CLAUDE.md line; two leftover worktrees under `.claude/worktrees/` whose branches are already merged into `main`, unrelated)
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140018-phase-5-exit-check.md
- **Base commit:** f3c6184b860be1d3c55b34a97e87436f407d130e

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Same stack as items 01–17: `app/` (Electron 44, React, TypeScript, Vite, Playwright `_electron`) and `kernel/` (strict TypeScript, vitest, better-sqlite3) |
| 2 | Dependency Availability | GO | No new npm dependency. The spec imports the kernel's own source and test helpers (`kernel/src/kernel.ts`, `kernel/test/session-fakes.ts`, `kernel/test/notifier-stub.ts`, `kernel/test/notifier-guard.ts`), which resolve their packages from `kernel/node_modules` |
| 3 | Architecture Fit | CAUTION | Every mechanism the six flows walk is merged (items 01–17, all `Status: done`). But no app e2e has yet run against a real kernel: every existing spec uses the fixture kernel (`app/e2e/fixture-kernel.ts`), and the app code never imports kernel code (`app/e2e/fixtures/team.ts`: "the app never imports kernel code"). This spec is the first to import the kernel, and it does so only in test code in the Playwright worker. The renderer and the main process stay kernel-free |
| 4 | Scope vs Supervisor Capability | CAUTION | About 2,000 new lines in two independent groups: an e2e spec of about 900 lines plus a CI step, and a live harness of about 800 lines with a runbook and two doc edits. Context-bound split |
| 5 | Hard Blockers | CAUTION | The `app` CI job installs only `app/` today, so the spec's kernel imports cannot resolve there. The job needs a kernel `npm ci` step in `.github/workflows/ci.yml`, which is outside the requirement's Touches. No other item in run 5 owns it (item 18 runs alone), so the requirement's stop rule does not fire, but the change is recorded here. Playwright has to transpile the kernel's NodeNext `.js`-suffixed TypeScript imports, and no probe has checked that yet (Risk Assessment) |

**Overall Verdict:** CAUTION (proceed)

## Task
**Goal:** Add phase 5's deterministic exit e2e (the built app driven by Playwright Electron against a real in-process kernel), its opt-in live harness and owner runbook, and the doc edits that record what phase 5 shipped, without marking phase 5 done.

**Problem Statement:**
The owner needs phase 5's exit criterion ("Everything in phases 2–4 can be done from the app, with nothing typed in a terminal"; it starts after setup, per the owner's 2026-10-20 decision) proven in CI and runnable live on his Mac.
Items 01–17 built the parts, and each screen's e2e runs against canned fixture data. Nothing yet proves the whole: one real kernel with the app as its only client, and every owner verb from phases 2–4 done through the UI.
Success looks like: `app/e2e/phase-5-exit.spec.ts` drives every Scope 1 step green in the `app` CI job; the live harness is skipped without `STUDIO_LIVE=1`; the runbook lets the owner (or an agent while the owner watches, D33) run the live check in the packaged `Loomwright Studio.app`.

**Precedent:** phase 4's exit PR (`.supervisor/jobs/done/2026-10-19-phase-4-exit-check.md`, commit `4aee99d`). `docs/ROADMAP.md`'s ✓ and the live evidence file `docs/evidence/phase-5-exit-live-<date>.json` are NOT in this PR. They land together in the owner's live-run commit after a passing live run (requirement AC 4; D33), as phase 4's did (`5d6df30`).

## Acceptance Criteria
- [ ] AC1: Given `app/e2e/phase-5-exit.spec.ts`, set up as follows:
  - a real kernel from `startKernel` (`kernel/src/kernel.ts`) started **in the Playwright worker process**, over `stubNotifierContributions()` (`kernel/test/notifier-stub.ts`), with `installNotifierGuard()` installed and `assertNoNotifierRefusals()` called after the test (`kernel/test/notifier-guard.ts`, vitest-free);
  - stand-in sessions from `fakeSessions` (`kernel/test/session-fakes.ts`), never the real SDK, a model or the network;
  - one mutable injected clock read by `KernelDeps.now`, `loopDeps.now` and the brain's message handler (phase 4's pattern);
  - an injected keychain reader and writer whose API token equals the token the app gets through `STUDIO_APP_FIXTURE_TOKEN`;
  - `STUDIO_DATA_DIR` set to the kernel's data dir (where the kernel writes `api.json`, port 0 = OS-assigned);
  - the built app launched only through `launchApp` (`app/e2e/electron-harness.ts`), with everything under one `mkdtempSync(join(tmpdir(), "studio-phase5-exit-"))`.

  When `cd app && npm run build && npm run e2e` runs, then ONE test drives these flows in order. Each step is done through the app's UI: clicks, typing, the ⌘K palette, and the tray seam `globalThis.__studioTray` with `dialog.showMessageBox` stood in for the native confirm, as `app/e2e/menubar.spec.ts` does. Each step's effect is asserted from the kernel's store (rows, events, decisions), never only from what the screen shows:
  1. **Phase 2:** in Chat the owner asks Wright for a reminder; the stand-in Wright registers a trigger; the trigger's card shows in Chat; after the clock moves past its instant it fires, and the store records that instant's result as `fired`, with a `trigger_fired` event. The notification row then appears in the app.
  2. **Phase 3:** a playbook draft card shows in Chat. Set its priority from the card (`POST /playbooks/:id/set`), and the store's playbook row carries the new priority. Its dry run is shown. Enable is held, and the owner approves it in Approvals; the kernel itself enables the playbook (row enabled, approval decided `once`). Then Run now (`POST /playbooks/:id/run`) starts its session.
  3. **Phase 4:** the stand-in Wright drafts a comment-only reviewer (`kernel_agent_create`, `never` covering `git_push`); the owner presses Create in its card, and the kernel creates it (the `agents` row is `active`). In the reviewer's own session, a `git push` is denied, and the Sessions screen's output shows the decision `agent_boundary` (one `tool_decision` event `{decision: "deny", reason: "agent_boundary", category: "git_push"}`, and no approval row for the push). Its `gh pr comment` is held, and the owner presses Deny in Approvals (the approval row is decided `deny`).
  4. **Sessions:** the owner Stops one running session from the Sessions screen, and its row ends `stopped` after the grace, with reason `owner_stop`. The owner Kills another after confirming, and its row ends `stopped` with reason `owner_kill` and no grace. Its `SESSION_STOP_REQUESTED` event payload is `{by: "owner", mode: "kill"}`, as `kernel/test/console-control.test.ts` asserts on the route.
  5. **Menu bar:** Pause all from the tray (a durable pause event). A trigger due while paused is recorded `missed_paused` (a `trigger_missed` event, reason `paused`) and never fires. Resume clears the pause. Then the kill switch from the tray, with its confirm, is recorded as engaged in the events log.
  6. **Team:** the owner sets Wright's model in Team's inspector (`POST /agents/wright/set`), and `wright.json` (`wrightSettingsPath`) carries the new model.

  It passes under `cd app && npm ci && npm run typecheck && npm test && npm run build` and `npm run e2e` on the PR's head, and it uses `test.setTimeout(...)` large enough for the whole walk.
- [ ] AC2: Given `app/e2e/phase-5-exit.spec.ts`, then no step uses the CLI: the file neither imports nor calls `runCli`, and spawns no `studio` process or `kernel/dist/cli` entry, so `grep -nE "runCli|dist/cli|\"studio\"" app/e2e/phase-5-exit.spec.ts` prints nothing. It launches Electron only through `launchApp`, so `app/scripts/hidden-windows.test.ts` still passes.
- [ ] AC3: Given `.github/workflows/ci.yml`, then the `app` job installs the kernel's dependencies before its typecheck and e2e steps (setup-node caching both `app/package-lock.json` and `kernel/package-lock.json`, and a new step named exactly `Install (kernel, for app e2e)` that runs `npm ci` with `working-directory: kernel`). The `ci` job keeps its name and its steps unchanged. The `app` job's header comment no longer says the e2e uses only the fixture kernel: it says one spec runs a real in-process kernel with stand-in sessions, and that there is still no token, no Keychain and no real SDK. The PR's `app` job runs `phase-5-exit.spec.ts` green under xvfb.
- [ ] AC4: Given `STUDIO_LIVE` unset, when `cd kernel && npm test` runs, then `kernel/test/phase-5-exit-live.test.ts`'s live `describe` is skipped (`describe.skipIf(!LIVE)` with `const LIVE = process.env.STUDIO_LIVE === "1"`, as in `kernel/test/phase-4-exit-live.test.ts`), while its deterministic `describe`s for the exported helpers still run and pass. At least: the per-flow checkers accept a canned store that has each flow's effects, and they reject one that is missing an effect.
- [ ] AC5: Given `kernel/test/phase-5-exit-live.test.ts` with `STUDIO_LIVE=1` against the installed service's data dir (`STUDIO_DATA_DIR`, else the default), the harness works as follows:
  - It only **reads** the store, through `Store` or SQLite read-only. It never calls the CLI, never posts to the API and never decides an approval.
  - It checks every effect of the six Scope 1 flows the owner performs in the packaged app: rows, events and decisions, from a run start recorded when the harness begins.
  - It records each flow as `pass`, `fail` or `not_exercised`. A flow the owner did not perform is `not_exercised` and fails the run, never passing silently.
  - It writes a `0600`, redacted summary JSON in `tmpdir()`, following phase 4's `writeSummary` pattern, with the shape of the evidence file and `owner` fields left for the owner's observations.
- [ ] AC6: Given `docs/evidence/phase-5-exit-runbook.md`, when the owner reads it, then it lists:
  - setup, excluded from the criterion: the token in the owner's own terminal (D27), `studio service install`, and `npm run package` in `app/` and opening `Loomwright Studio.app` from Finder or the Dock;
  - each of the six flows, done in the app only;
  - what only the owner can see, recorded in the evidence's `owner` fields (D33): that nothing was typed in a terminal, the notification on screen, and the approve and deny decisions;
  - cleanup, touching only the run's own playbook, trigger and crew member;
  - that the evidence file `docs/evidence/phase-5-exit-live-<date>.json` (phase 4's shape, `run_by` included) and the ROADMAP ✓ land in one commit after a passing live run.

  It links no file that does not exist yet (the future evidence JSON is named in code font, not linked), and `bash scripts/check-docs.sh` passes.
- [ ] AC7: Given the PR, then:
  - `docs/ARCHITECTURE.md` §"Phase 5 features" states the built app as shipped: the six screens and flows the exit check walks, and the packaged ad-hoc-signed `Loomwright Studio.app`;
  - `docs/OPEN_QUESTIONS.md` gains an open `- [ ] **Phase 5 exit: live run (item 18, owner).**` entry, placed after the phase 4 entries, naming the deterministic e2e, the live harness and the runbook, and what stays unverified (the live run itself, a real model in each flow, a real notification click opening the app, the packaged app's Keychain read);
  - `docs/ROADMAP.md` is unchanged, and no `docs/evidence/phase-5-exit-live-*.json` is added (`git diff --name-only origin/main...HEAD` lists neither).

## Phase 3: ANALYZE (summary)

**Tech Stack:** TypeScript (strict) in both packages. Node ≥ 22. App: Electron 44, React 19, Vite 8, vitest, `@playwright/test` 1.64 (`_electron`). Kernel: vitest, better-sqlite3, `@anthropic-ai/claude-agent-sdk` 0.3.284.

### File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| deterministic exit e2e | `.github/workflows/ci.yml` (the `app` job: kernel install + cache path) | `app/e2e/phase-5-exit.spec.ts` | HIGH (create), MEDIUM (whether more CI wiring is needed) |
| live harness, runbook, docs | `docs/ARCHITECTURE.md`, `docs/OPEN_QUESTIONS.md` | `kernel/test/phase-5-exit-live.test.ts`, `docs/evidence/phase-5-exit-runbook.md` | HIGH |

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` scans every `*.md` under `docs/` plus `CLAUDE.md` and `README.md` for relative links that resolve. The runbook and the two doc edits are its only new surfaces. `app/scripts/hidden-windows.test.ts` scans every file under `app/e2e/`, which includes the new spec.

### Facts the workers rely on (verified at base commit `f3c6184`)
- `startKernel` binds its API on port 0 by default (`kernel/src/api/server.ts`: `server.listen(options.port ?? 0, API_HOST, ...)`), writes `<dataDir>/api.json` (pid and port, no token), and takes its API token from the injected `keychain` / `keychainWriter` (`ensureApiToken`).
- The app's main process reads `<STUDIO_DATA_DIR>/api.json`, checks the pid is alive (the Playwright worker's pid is), and, only in an unpackaged run, takes the token from `STUDIO_APP_FIXTURE_TOKEN` (`app/electron/kernel-connection.ts`). The fixture token's shape is 64 lowercase hex characters (`FIXTURE_TOKEN` in `app/e2e/fixture-kernel.ts`).
- `kernel/test/session-fakes.ts`, `notifier-stub.ts`, `notifier-guard.ts` and `loop-helpers.ts` import nothing from `vitest`. Only `setup-no-real-notifier.ts` does, and the spec must not import it.
- The tray is driven through the seam `globalThis.__studioTray` with `TRAY_SEAM_ENV`, and the kill confirm is stood in by replacing `dialog.showMessageBox` (`app/e2e/menubar.spec.ts` header).
- Pause: a due instant while paused is recorded `missed_paused` with a `trigger_missed` event (reason `paused`) and never fires (`kernel/src/triggers/store.ts` header; `TRIGGER_RESULTS = ["fired", "missed_kill_switch", "missed_paused"]`).
- The `app` CI job runs `npm ci`, typecheck, `npm test`, `npm run build`, the Electron download, then `xvfb-run --auto-servernum npm run e2e` (all specs, `--workers=1`). It never installs `kernel/`.
- `app/tsconfig.node.json` includes `e2e`, so `npm run typecheck` in `app/` type-checks the kernel files the spec imports under the app's options (`moduleResolution: "Bundler"`, which maps `.js` specifiers onto `.ts`).

### Blast-Radius / Impact Prediction
Omitted: no touched subsystem has a verified System Twin contract, and `twin-graph.sh` returns empty groups.

## House Rules

> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

## Touched-file invariants

> Grounded at base `f3c6184b860be1d3c55b34a97e87436f407d130e`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`.github/workflows/ci.yml`**:
  - keep: the required check's name and comment, `# The job is named \`ci\` on purpose`, and the `ci` job's steps unchanged (the kernel's typecheck, test, build and `--version` smoke); the `app` job as a sibling job (`A sibling of \`ci\`, not a step in it,`); every `app` step's guard `if: hashFiles('app/package.json') != ''`; the sandbox allowance `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` before `xvfb-run --auto-servernum npm run e2e`.
  - change: the `app` job's header comment sentence `Tests use the fixture kernel: no` (through "no real kernel."), which becomes false once this spec boots a real in-process kernel. It now says one spec runs a real kernel in-process with stand-in sessions, and still no token, no Keychain and no real SDK (AC3).
  - reuse: the kernel job's own install idiom (`working-directory: kernel` + `run: npm ci`, and `cache-dependency-path: kernel/package-lock.json`). setup-node's `cache-dependency-path` takes a multi-line list, so both lock files go there.
  - pinned by: no test greps this file (`grep -rlF "ci.yml"` under `kernel/test`, `app/` and `scripts/` finds nothing).
  - Editing this workflow (not `claude-code-review.yml`) does not make the review action skip itself.

## Pin mutations

Each mutation is applied to production code (never the test), must turn the named pin red, and is reverted after the check. There is one row per separately protected assertion. Flow 1's `trigger_fired` event and notification row follow the same fire path as its `fired` result, so that row covers them.

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/e2e/phase-5-exit.spec.ts`, flow 3: the reviewer's push is denied `agent_boundary` in Sessions output | flip `const category = NEVER_CATEGORIES.find((c) => read.has(c) && never.includes(c));` → `const category = undefined;` in `kernel/src/sessions/policy.ts` (the push then falls to the rail and is held, so the pin sees an approval row or a non-boundary reason) |
| `app/e2e/phase-5-exit.spec.ts`, flow 5: a trigger due while paused is `missed_paused` and never fires | flip `const result: TriggerResult = killSwitch ? "missed_kill_switch" : "missed_paused";` → `const result: TriggerResult = "missed_kill_switch";` in `kernel/src/triggers/store.ts` |
| `app/e2e/phase-5-exit.spec.ts`, flow 1: the reminder's instant is recorded `fired` | flip `return { trigger_id: id, scheduled_at: scheduledAt, result: "fired", ...effect };` → `return { trigger_id: id, scheduled_at: scheduledAt, result: "missed_paused", ...effect };` in `kernel/src/triggers/store.ts` |
| `app/e2e/phase-5-exit.spec.ts`, flow 4: Kill ends the session `owner_kill` with no grace | flip `const intent: StopIntent = mode === undefined ? "stop" : mode === "stop" ? "owner_stop" : "owner_kill";` → `const intent: StopIntent = mode === undefined ? "stop" : "owner_stop";` in `kernel/src/sessions/manager.ts` (Kill then takes the graceful path and ends `owner_stop`) |
| `app/e2e/phase-5-exit.spec.ts`, flow 6: Team sets Wright's model and `wright.json` carries it | flip `if (!(WRIGHT_SET_FIELDS as readonly string[]).includes(rawField)) return wrightFieldReserved(dataDir);` → `if (true) return wrightFieldReserved(dataDir);` in `kernel/src/agents/roster.ts` (every Wright set is refused `reserved`) |
| `app/e2e/phase-5-exit.spec.ts`, flow 4: Stop is graceful and ends `owner_stop` | flip `const intent: StopIntent = mode === undefined ? "stop" : mode === "stop" ? "owner_stop" : "owner_kill";` → `const intent: StopIntent = mode === undefined ? "stop" : "owner_kill";` in `kernel/src/sessions/manager.ts` (Stop then ends `owner_kill` with no grace) |
| `app/e2e/phase-5-exit.spec.ts`, flow 2: approving the held enable in Approvals makes the kernel enable the playbook | delete `enablePlaybook(store, { id: row.id, version: row.version, sessionId: p.sessionId, approvalId: approval.id }, p.now);` in `kernel/src/playbooks/enable.ts` (the row stays draft) |
| `app/e2e/phase-5-exit.spec.ts`, flow 3: Deny in Approvals leaves the held comment's approval `denied` | flip `const status: ApprovalStatus = decision === "deny" ? "denied" : "approved";` → `const status: ApprovalStatus = "approved";` in `kernel/src/approvals/store.ts` |
| `app/e2e/phase-5-exit.spec.ts`, flow 5: the tray kill switch, confirmed, is recorded as engaged | delete `append(store, KILL_SWITCH_ENGAGED, at, payload);` in `kernel/src/api/kill-switch.ts` (no `kill_switch_engaged` event is written) |
| `app/e2e/phase-5-exit.spec.ts`, flow 2: the priority set from the card reaches the playbook row | make the `POST /playbooks/:id/set` handler (`kernel/src/playbooks/`) answer its success body without writing the field. Not machine-applicable: the reviewer applies it (D1 fallback). The pin must read `priority` from the store, not from the response |
| `kernel/test/phase-5-exit-live.test.ts`, the deterministic checker tests: a canned store missing a flow's effect is rejected | make the per-flow checker the subtask adds return `pass` without reading the store. Not machine-applicable (the file is new): the reviewer applies it (D1 fallback), and the reject-case test must turn red |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Deterministic phase 5 exit e2e and its CI wiring | AC1, AC2, AC3 | 1 modify, 1 create | `skills/playwright-e2e/SKILL.md`, `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Live harness, owner runbook, architecture and open-questions docs | AC4, AC5, AC6, AC7 | 2 modify, 2 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1 — deterministic exit e2e + CI wiring (LAUNCHABLE)
provides:
  - {kind: "file", path: "app/e2e/phase-5-exit.spec.ts"}
  - {kind: "symbol", path: ".github/workflows/ci.yml", name: "Install (kernel, for app e2e)"}
requires: []
lanes:
  - "app/e2e/phase-5-exit.spec.ts"
  - ".github/workflows/ci.yml"
external_requires:
  - "Playwright 1.64 test runner transpiling the kernel's NodeNext TypeScript (.js-suffixed specifiers) imported from an app e2e spec"

# Subtask 2 — live harness + runbook + docs (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/test/phase-5-exit-live.test.ts"}
  - {kind: "file", path: "docs/evidence/phase-5-exit-runbook.md"}
  - {kind: "symbol", path: "docs/evidence/phase-5-exit-runbook.md", name: "## Setup"}
  - {kind: "symbol", path: "docs/OPEN_QUESTIONS.md", name: "Phase 5 exit: live run (item 18, owner)."}
requires: []
lanes:
  - "kernel/test/phase-5-exit-live.test.ts"
  - "docs/evidence/phase-5-exit-runbook.md"
  - "docs/ARCHITECTURE.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires:
  - "the owner's installed launchd service and the packaged Loomwright Studio.app with a real Wright model (live run only, STUDIO_LIVE=1; never in CI)"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
Subtask 2 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel)
- **Recommended workers:** 2
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/playwright-e2e/SKILL.md`, `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5) CAUTION: Playwright has not been probed transpiling the kernel's NodeNext TypeScript (`../src/kernel.js` specifiers, ESM, native better-sqlite3) when imported from an app spec | HIGH | Probe first: a minimal `startKernel` boot in the spec before writing the flows. If Playwright cannot load the kernel without a new dependency (for example `tsx`) or a kernel config change, stop and say so (requirement Scope's stop rule). Never add a dependency, and never move the kernel into the renderer or main process |
| Feasibility (Phase 2.5) CAUTION: the `app` CI job does not install `kernel/`, and `.github/workflows/ci.yml` is outside the requirement's Touches | MEDIUM | Add only the kernel install and cache path to the `app` job (Touched-file invariants). No other item in run 5 owns the file. The PR body names the edit |
| Feasibility (Phase 2.5) CAUTION: app typecheck now covers the kernel files the spec imports, under the app's compiler options (DOM lib, Bundler resolution) | MEDIUM | Run `cd kernel && npm ci` before `cd app && npm run typecheck`. If a kernel file fails only under the app's options, report it as a finding. Do not edit `kernel/src` or either tsconfig to make it pass |
| Feasibility (Phase 2.5) CAUTION: about 2,000 new lines (check 4) | MEDIUM | Context-bound split into 2 independent subtasks; each subtask's validation commands gate it |
| The first e2e against a real kernel may surface an app↔kernel wiring gap (a route shape, a feed frame, a card action) | HIGH | Requirement Non-goals: a gap is a finding (worker hand-back + `docs/OPEN_QUESTIONS.md` / a new item in this folder's plan doc), never fixed in `app/src`, `app/electron` or `kernel/src` in this PR. The worker stops and says so |
| The one walk runs past Playwright's default 30 s test timeout | MEDIUM | `test.setTimeout(...)` sized for the walk; drive the kernel clock (`loopDeps.tickMs` small) rather than real waits |
| No vitest setup in the Playwright worker, so the run-wide notifier guard is not installed | MEDIUM | Use `stubNotifierContributions()` and call `installNotifierGuard()` in the spec, then `assertNoNotifierRefusals()` after the test (`docs/evidence/phase-4-no-real-notifier-in-tests.md`) |
| Stop and Kill against stand-in sessions: the fakes have no real process groups | MEDIUM | Assert the kernel's recorded outcome (row status, control events), as `kernel/test/console-control.test.ts` does, never an OS signal |
| A real model may not perform a flow the way the stand-in does (live only) | MEDIUM | Each flow is checked from the store. A flow the owner did not perform is `not_exercised` and FAILS the run. The runbook allows retrying a flow in the app, never in a terminal |
| ROADMAP marked done before a live run | MEDIUM | This PR must not edit `docs/ROADMAP.md` or add an evidence JSON. They land together in the owner's live-run commit (requirement AC 4, D33) |
| Home paths in the runbook or harness output trip the trail scrub | LOW | Write home paths as `~/...` or `/Users/<name>/`; the summary redacts them (phase 4's pattern) |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 1
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-23-phase-5-exit-check.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-23T18:40:36Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/124
- **Branch:** feature/phase-5-exit-check
- **Files changed:** 6
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** 2/2 subtasks merged (deterministic real-kernel phase 5 exit e2e + app CI kernel install; read-only live harness, owner runbook, ARCHITECTURE/OPEN_QUESTIONS). Phase 4.5: iteration 1 FAIL (HIGH checkMenuBarFlow false pass; MEDIUM runbook/owner fields promised UI the app lacks), fixed in 2647ceb with a class sweep (checkReviewerFlow session tie); iteration 2 PASS. All 11 pin mutations held (reviewer D1 fallback). CI required checks green. Children check skipped by owner (a67ef574fbbb0bb73 = turn-limited first worker; retry completed). Three app↔kernel gaps recorded, not fixed: no TriggerCard for a fired once reminder, no in-app notification list, notifier-guard recursion under Playwright. ROADMAP ✓ and live evidence JSON await the owner's live run (D33).

## Not verified
- **app CI job on ubuntu under xvfb** — needs the PR's CI run (subtask 1) — since observed green on PR #124
- **packaged Loomwright Studio.app** — owner live run (subtask 1)
- **STUDIO_LIVE=1 live describe** — owner live run, D33 (subtask 2)
- **app/e2e/phase-5-exit.spec.ts references** — sibling subtask 1 file, not visible to subtask 2's worktree (subtask 2)
