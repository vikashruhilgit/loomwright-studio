# Supervisor Job: Stop and Kill work on a starting session, or say why not

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-24-064605/L6
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-24-115024-stop-and-kill-work-on-a-starting-session.md
- **Base commit:** 86265042f043827edf99daa14e0342a6816e2abe

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Kernel is strict TS + vitest; app is React/Electron + vitest + Playwright, both already in place. |
| 2 | Dependency Availability | GO | No new dependency. Test seams exist: `SpawnFn` / `QueryFn` fakes in `kernel/test/sessions.test.ts` and `kernel/test/console-control.test.ts`; `sessionsKernel` fixture in `app/e2e/fixtures/sessions.ts`. |
| 3 | Architecture Fit | GO | Mechanism-only change inside `SessionManager.stopSession` / `#stop` and the console control route (invariants 1, 2). |
| 4 | Scope vs Supervisor Capability | GO | 8 certain files plus 5 conditional ones (only if AC1 or AC7 lands there). That is about the context-bound limit, and the work is one tightly coupled change, so it stays single-agent. |
| 5 | Hard Blockers | CAUTION | The requirement's premise is contradicted by the code and the live store (see Task § "What is verified"). The worker must reproduce the lost press and name the mechanism before fixing anything. |

**Overall Verdict:** CAUTION

## Task
**Goal:** A Stop or Kill pressed on a `starting` session always takes effect (recorded `session_stop_requested`, ends `stopped`/`owner_stop`|`owner_kill`, no orphaned CLI), or the app shows the kernel's refusal as text, never nothing.

**Problem Statement:**
The owner needs Stop and Kill to work on a session that is still `starting`, because Wright sessions spend 20–40 s in `starting`.
Currently, in the phase 5 live run, Stop then Kill on `starting` Wright sessions 36 and 37 did nothing: no event, no error, no change in the app. This leaves the owner unable to end a session that a live run just started.
Success looks like: every press either records `session_stop_requested` and ends the session, or shows a refusal line in the session's header.

### What is verified at base 8626504 (read the running code and the live store, read-only)
- **The kernel accepts a stop on a `starting` session today, in the in-process path.** `startSession` inserts the `starting` row and calls `#newLive(id, …, "starting", …)` (which does `this.#live.set(id, live)`) synchronously, with no `await` between them. `#stopLive` refuses `not_live` only when `this.#live.get(id)` is `undefined`, so a session started by this kernel is never `not_live` while `starting`. The requirement's citation of `control.ts:67/119/123` as the cause for a `starting` session does not hold for a kernel-started session. Those lines are the 409 for an ended row and for a `not_live` row (a row a previous kernel left).
- **The live store (`~/.loomwright-studio/studio.db`, opened `mode=ro`) has no `session_stop_requested` and no `route_failed` for sessions 36 or 37.** Their events are `starting` (05:58:35 / 05:58:40), `running` (05:59:01 / 05:59:18), then `completed`/`result_success`. Stops on 41 and 44 are recorded. So the press either never reached the route or was refused before `onAccepted`, and a 409 is never recorded by design. The app's `SessionsScreen.tsx` already renders `refusalText` for a 409 or any failure (`data-testid="session-notice"`), and `runsNow` treats `starting` as live, so "nothing shown" also contradicts the code as read. **The mechanism is therefore unknown.** Finding it is step 1 of the work (AC1).
- **A real pre-spawn window exists only if the SDK's `query()` spawns asynchronously.** `#launch` says "call `query()` (which spawns synchronously)", but this is not proven against the real SDK in `docs/`. If `#stop` runs while `attempt.pgid === undefined`, `#killAttemptGroup` returns at once (`if (pgid === undefined || …) return Promise.resolve();`). The session then ends `stopped` while a CLI can still spawn afterwards and run unowned: the orphan race named in the requirement's Risks.

## Acceptance Criteria
- [ ] **AC1 (mechanism first):** Given the phase 5 live run's lost presses on `starting` sessions 36/37, when the worker reproduces a Stop and a Kill on a `starting` session through the app against a real in-process kernel (the `app/e2e/phase-5-exit.spec.ts` style: stand-in sessions held before `system/init`), then a committed evidence file `docs/evidence/stop-kill-starting-session.md` records the installed `@anthropic-ai/claude-agent-sdk` version and the probe command and output showing whether `query()` calls `spawnClaudeCodeProcess` synchronously, and names the mechanism that lost the press, which may be in the app, the bridge, the POST queue or the kernel, with the file:anchor and the command or test that shows it. The fix targets that mechanism, not a symptom, and the PR body links to the file. If the press is not lost in the reproduction, the file says so, records what was tried, and the remaining criteria still hold. A committed reproduction spec lives in `app/e2e/stop-kill-starting.spec.ts` and launches Electron only via `launchApp` from `app/e2e/electron-harness.ts`.
- [ ] **AC2:** Given a session in `starting` (a test spawner/query held before it is live: no `system/init` yet), when the owner presses Stop (`POST /sessions/:id/stop`), then `session_stop_requested {by: "owner", mode: "stop"}` is recorded once and the session ends `stopped` with reason `owner_stop` without running a turn. The test's fake query emits `system/init` and one assistant message **after** the stop is accepted (during the grace), and the test asserts that no `running` `session_status` event and no assistant output are recorded, so the `!live.stopping` guard is actually exercised. Pinned in `kernel/test/console-control.test.ts`.
- [ ] **AC3:** Given the same with Kill (`POST /sessions/:id/kill`), then `session_stop_requested {mode: "kill"}` is recorded and it ends `stopped`/`owner_kill`, with the fake again emitting `system/init` and an assistant message after the kill is accepted and the same no-`running` / no-output assertions. Pinned in `kernel/test/console-control.test.ts`.
- [ ] **AC4 (both orders, no orphan):** Given a `starting` session whose spawn has not yet reported its pgid (a test `SpawnFn` whose `onSpawn` is held), when Stop or Kill is accepted before the spawn and the spawn then completes, then the newly spawned group is killed at its first live moment. **Design (fixed by this brief):** `#spawnFor`'s `onSpawn` checks `live.stopping` and starts the group kill there. That kill also runs, and is recorded, when the spawn arrives after the session has already ended. `#stop` with an undefined pgid waits for that kill only with a limit: it races the `onSpawn` kill against the attempt ending (`attempt.exited` or the stream ending) and `LEADER_EXIT_WAIT_MS`, and never waits without a limit, so the session always reaches a terminal status. A third pinned case: Stop is accepted, the held spawn never completes, and the session still ends `stopped`/`owner_stop` within the limit. No other design is in scope and the session ends `stopped`/`owner_stop`|`owner_kill`, with no group left alive. Given the reverse order (spawn reported, then stop), it ends the same way. Both orders are pinned in `kernel/test/sessions.test.ts`. (No stop can land between `#newLive` and `#launch` in `startSession`: the code between them is synchronous, so no check is added there.)
- [ ] **AC5:** Given a session the kernel cannot stop (an ended row, or a `not_live` row), when the owner presses Stop or Kill, then the route answers `409 {error: "not_running", status}` and the app shows that refusal as text in the session's header (`session-notice`), never nothing. A non-409 failure (a 500, or a bridge failure) also shows text. Pinned in `app/e2e/sessions.spec.ts` and/or `app/src/screens/sessions/SessionsScreen.test.tsx`.
- [ ] **AC6:** Given a session listed `starting`, then Stop, ⌘. and Kill are enabled in Sessions (not `aria-disabled`) and each sends exactly one request. Pinned in the app tests, with the e2e fixture's `starting` row.
- [ ] **AC7:** Given a brain (Wright) message whose session was stopped or killed before it ran a turn, then its queue event is settled, not retried. The handler's `start-session` work step already returned the session id, so the step is not re-run, and the message ends with the session's terminal status. Pinned by a test in `kernel/test/console-control.test.ts` or `kernel/test/brain.test.ts`. Out of scope: playbook-run sessions (`kernel/src/playbooks/runs.ts`). The live failure was in Wright sessions started from Chat.
- [ ] **AC8:** Given `docs/architecture/session-control.md`, then it has a "Starting sessions" section: a Stop or Kill on `starting` is accepted, the spawn-race handling, and what still answers 409. `bash scripts/check-docs.sh` passes.
- [ ] **AC9:** Phase 5's Sessions and control tests pass, along with every Validation command: `cd kernel && npm ci && npm run typecheck && npm test`; `cd app && npm ci && npm run typecheck && npm test && npm run build`; `bash scripts/check-docs.sh`.

**Non-goal (from the requirement):** why sessions take 20–40 s to start. Record the observation in the evidence file only.

**Evidence rule:** AC1's evidence lives in `docs/evidence/stop-kill-starting-session.md` (a File Impact Map create), never only in the PR body.

## House Rules
> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing

## File Impact Map

| File | Action | Confidence | Why |
|------|--------|------------|-----|
| `kernel/src/sessions/manager.ts` | modify | HIGH | `#spawnFor` `onSpawn` kills at once when `live.stopping` (the one design for AC4); `#stop` awaits that kill, with a limit, when the pgid was undefined. |
| `kernel/src/console/control.ts` | modify | MEDIUM | Only if AC1 finds the refusal here; otherwise doc-comment only (the starting-session answers). |
| `kernel/test/sessions.test.ts` | modify | HIGH | AC4, both orders. |
| `kernel/test/console-control.test.ts` | modify | HIGH | AC2, AC3, AC7. |
| `app/src/screens/sessions/SessionsScreen.tsx` | modify | MEDIUM | Only if AC1 finds the press lost in the app; AC5/AC6 behaviour. |
| `app/src/screens/sessions/SessionsScreen.test.tsx` | modify | MEDIUM | AC5, AC6 unit pins. |
| `app/e2e/sessions.spec.ts` | modify | HIGH | AC5, AC6 e2e: a `starting` row's Stop/Kill, and a 409 showing text. |
| `app/e2e/fixtures/sessions.ts` | modify | MEDIUM | A `starting` session in the canned kernel, if one is not already there. |
| `docs/architecture/session-control.md` | modify | HIGH | AC8. |
| `docs/evidence/stop-kill-starting-session.md` | create | HIGH | AC1. |
| `app/e2e/stop-kill-starting.spec.ts` | create | LOW | AC1 reproduction, only if it is committed. |
| `kernel/src/brain/handler.ts` | modify | LOW | Only if AC7 finds a retry there. |
| `kernel/test/brain.test.ts` | modify | LOW | AC7 pin, if it is placed there. |

## Touched-file invariants

> Grounded at base `8626504`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/sessions/manager.ts`**. Keep: acceptance stays synchronous (`Never put an` `await` before `live.stopPromise` is set, nor in `#stop` before `live.cutGrace` is set), because the console route relies on `onAccepted` having run before `stopSession` returns. Keep: one stop and one terminal transition per session (a second stop joins `live.stopPromise`). Keep: the pgid is persisted in `onSpawn` before any message is awaited (`Synchronous, inside query(): on disk before any message is awaited`). Keep: the `starting → running` guard `if (live.status === "starting" && !live.stopping && !live.authFailed)`. Keep: `kill_incomplete` handling, so a group that can't be confirmed gone ends `failed`, never `stopped`. Mirror: `STOPPED_REASON` keys `owner_stop` / `owner_kill`. Pinned by: `kernel/test/sessions.test.ts` `describe("stopSession (AC4, fakes)"`.
- **`kernel/src/console/control.ts`**. Keep: its only value imports are `./types.js` and `../loop/internal.js` (`value imports are \`./types.js\``), pinned by `kernel/test/feature-seams.test.ts`. Keep: the event is written only from `onAccepted`, so a 400/404/409/503 records nothing. Keep: only acceptance runs on `serialized`, never the grace. Mirror: the contract `SessionControlResponse` in `app/src/api/contract.ts`.
- **`app/src/screens/sessions/SessionsScreen.tsx`**. Keep: one request per session in flight (`inFlight.current`); `runsNow` gates Stop/Kill by `isLive`; refusal text is escaped through `printable`. Mirror: `LIVE_STATUSES` (`export const LIVE_STATUSES: readonly SessionStatus[] = ["starting", "running"];` in `model.ts`) and the fixture's `const LIVE = new Set(["starting", "running"]);`.
- **`app/e2e/sessions.spec.ts`** and **`app/e2e/fixtures/sessions.ts`**. Keep: Electron is launched only through `app/e2e/electron-harness.ts` (house rule). Keep: the fixture answers as the kernel does (header comment: `a running session ends \`stopped\``). Update that comment if a `starting` answer is added. Pinned by: `a 409 shows the answered status` (AC4 test title).
- **`kernel/src/brain/handler.ts`**. Keep: the `start-session` work step stays idempotent on replay (`runStepAsync("start-session"`): a stored `session_id` is never started again. Keep: an admission refusal parks the message (`status: "parked"`) rather than failing it. Fired by: the brain's event-queue handler. Pinned by: `kernel/test/brain.test.ts`.
- **`kernel/test/sessions.test.ts`**, **`kernel/test/console-control.test.ts`**, **`kernel/test/brain.test.ts`**, **`app/src/screens/sessions/SessionsScreen.test.tsx`**. Keep: temp stores and the `SpawnFn` / `QueryFn` fakes (`const spawn: SpawnFn = (_o, hooks) => {`), never `~/.loomwright-studio`. Keep every existing queue, grace and brain-queue test green (`describe("the routes run on the API server's POST queue"`).
- **`docs/architecture/session-control.md`**. Keep: relative links resolve (`scripts/check-docs.sh` check 1).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/sessions.test.ts`: AC4 stop-before-spawn order (no group left alive) | delete the new `live.stopping` group-kill line in `#spawnFor`'s `onSpawn` in `kernel/src/sessions/manager.ts` (the line lands with the change; the reviewer completes the literal). The spawned group survives, so the pin turns red. |
| `kernel/test/sessions.test.ts`: AC4 reverse order (spawn reported, then stop) | flip `if (pgid === undefined || (attempt.groupGone && attempt.toolGroupsDone)) return Promise.resolve();` → `return Promise.resolve();` in `kernel/src/sessions/manager.ts`. Nothing is killed, so the pin turns red. |
| `kernel/test/sessions.test.ts`: AC4 held spawn that never completes still ends `stopped` within the limit | delete the new bounded-wait race for the `onSpawn` kill in `#stop` in `kernel/src/sessions/manager.ts`, replacing it with an unbounded await (the reviewer completes the literal). The test times out, so the pin turns red. |
| `kernel/test/console-control.test.ts`: AC2 starting Stop ends `owner_stop` with no `running` | flip `live.status === "starting" && !live.stopping` → `live.status === "starting"` in `kernel/src/sessions/manager.ts`. Init after the stop records `running`, so the pin turns red. |
| `kernel/test/console-control.test.ts`: AC3 starting Kill ends `owner_kill` | flip `owner_kill: "owner_kill"` → `owner_kill: "owner_stop"` in `kernel/src/sessions/manager.ts`. The reason is wrong, so the pin turns red. |
| `app/e2e/sessions.spec.ts` / `SessionsScreen.test.tsx`: AC5 a 409 shows text | flip `reason: null, notice: refusalText(result, verb)` → `reason: null, notice: undefined` in `app/src/screens/sessions/SessionsScreen.tsx`. No `session-notice`, so the pin turns red. |
| `app/e2e/sessions.spec.ts` / `SessionsScreen.test.tsx`: AC6 Stop enabled on `starting` | flip `export const LIVE_STATUSES: readonly SessionStatus[] = ["starting", "running"];` → `export const LIVE_STATUSES: readonly SessionStatus[] = ["running"];` in `app/src/screens/sessions/model.ts`. Stop becomes disabled, so the pin turns red. |
| `kernel/test/console-control.test.ts` or `kernel/test/brain.test.ts`: AC7 a stopped-before-turn message is not retried | delete the line that settles that message's queue event or step (named by the worker once found; the reviewer completes the literal). The event is retried, so the pin turns red. |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Reproduce the lost press, then make Stop/Kill on `starting` take effect or show a reason | all | 11 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 — Stop/Kill on a starting session (LAUNCHABLE)
provides:
  - {kind: "file", path: "docs/evidence/stop-kill-starting-session.md"}
  - {kind: "symbol", path: "docs/architecture/session-control.md", name: "Starting sessions"}
requires: []
lanes:
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/console/control.ts"
  - "kernel/test/sessions.test.ts"
  - "kernel/test/console-control.test.ts"
  - "kernel/src/brain/**"
  - "kernel/test/brain.test.ts"
  - "app/src/screens/sessions/**"
  - "app/e2e/sessions.spec.ts"
  - "app/e2e/fixtures/sessions.ts"
  - "app/e2e/stop-kill-starting.spec.ts"
  - "docs/architecture/session-control.md"
  - "docs/evidence/stop-kill-starting-session.md"
external_requires:
  - "@anthropic-ai/claude-agent-sdk query() spawn timing (sync vs async spawnClaudeCodeProcess call); probe, do not assume"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md`, `skills/error-handling/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/console/control.ts:67` | yes | STALE (for a `starting` session) | doc comment: `409 {error: "not_running", status}`: the session has ended, or … `not_live` | base 8626504 |
| `kernel/src/console/control.ts:119` | yes | STALE (for a `starting` session) | `return { answer: { status: 409, body: { error: "not_running", status } } };` only after a non-accepted (terminal) stop | base 8626504 |
| `kernel/src/console/control.ts:123` | yes | STALE (for a `starting` session) | `if (code === "not_live") …`, reached only when `#live.get(id)` is undefined, never for a kernel-started `starting` session | base 8626504 |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The requirement's premise (a 409 for `starting`) is contradicted by the code and the live store. A fix aimed at the 409 path would not fix the live failure. (Feasibility (Phase 2.5), Cited-line premise (Phase 3)) | HIGH | AC1: reproduce first against a real in-process kernel through the app, name the mechanism in the evidence file, and fix that. If it is not reproducible, record what was tried and still land AC2–AC8. |
| A race between stop and spawn leaves an orphan CLI: `#killAttemptGroup` returns at once when `pgid === undefined`, so a stop before `onSpawn` ends `stopped` while the CLI spawns later. | HIGH | AC4: kill in `onSpawn` when `live.stopping`; test both orders with a held `SpawnFn`; probe whether the real SDK's `query()` calls `spawnClaudeCodeProcess` synchronously and record the result in the evidence file. |
| Breaking synchronous acceptance (an `await` before `live.stopPromise`) breaks the queue seam and the Kill-cuts-grace behaviour. | MEDIUM | Touched-file invariant. The existing `console-control.test.ts` queue tests must stay green. |
| The brain retries a message whose session was stopped before its turn, which re-starts Wright. | MEDIUM | AC7 pin. The `start-session` step already returned an id, so confirm it is not re-run. |
| The production store was read for diagnosis. | LOW | Read-only (`sqlite3 -readonly`, `mode=ro`). The worker must not write to `~/.loomwright-studio`; all tests use temp stores. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-24-stop-and-kill-work-on-a-starting-session.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-24T16:17:00Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/133
- **Branch:** feature/stop-and-kill-work-on-a-starting-session
- **Files changed:** 11
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Stop/Kill on a starting session now takes effect in the kernel or shows a refusal in the app. The lost press from the live run was NOT reproduced (SDK 0.3.284 spawns synchronously; the in-process repro recorded both presses), so its mechanism is unidentified and the evidence file says so. AC2–AC8 landed: onSpawn kills a late spawn when stopping, the no-pgid wait is bounded, output is suppressed during a stop on starting, plus pins and docs. Self-heal: iteration 1 added the missing late-spawn kill-failure and streamEnded tests (57596a9); iteration 2 fixed a reproduced race where a late spawn during the final leader-exit wait ended the session failed instead of stopped (b4c5152); iteration 3 PASS. Dismissed: 1 LOW below floor and 2 doc nits.

## Not verified
- **packaged app + launchd kernel with a real Wright session (owner live rerun)** — there was no live owner run in this job; this is covered only by fakes and the in-process e2e against startKernel (subtask 1)
