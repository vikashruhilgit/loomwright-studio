# 24 — Stop and Kill work on a starting session, or say why not

## Status: ready

**Priority:** MVP, blocking the phase 5 rerun · ROADMAP phase 5 (Sessions: stop/kill) · D2

**As** the owner,
**I want** Stop and Kill on a session that is still `starting` to take effect, or to show me a clear reason,
**so that** a press is never silently ignored.

## Problem

In the live run, Stop and then Kill pressed on two `starting` Wright sessions (36 and 37) did nothing: no `session_stop_requested` event, no error, and no change in the app. Sessions took 20–40 s to go from `starting` to `running`. The kernel answers `409 {error: "not_running"}` for a session that has not started yet (`kernel/src/console/control.ts:67`, :119, :123), and Sessions shows nothing for that 409. Stop on a `running` session worked (41 ended `owner_stop`), and so did Kill (44 ended `owner_kill`, after its confirmation).

## Owner decisions (2026-10-24, binding)

Recorded 2026-10-24, after the phase 5 live exit run (harness `phase-5-exit-live`: all six flows passed its store checks). The owner asked for the run's findings to be written up as phase-5 items, and for a recommendation on when to test them. The recommendation (pending the owner's OK on the plan doc):

- **Fix before phase 6, then a short rerun.** These items (22–30) and the gap items (19–21) land before phase 6's foundation, then a short phase 5 live rerun checks them. Phase 6 builds on the same notifier, threads and cards (connector notifications, draft cards), and its foundation edits `kernel/src/console/threads.ts`. Testing everything after phase 6 would mix two phases' failures, against ROADMAP's rule that every phase ends with a check in the running system.
- **Blocking for the rerun:** 22 (the notification click opens the app), 23 (Wright points to the app, not the CLI), 24 (Stop/Kill on a starting session) and 25 (the playbook card). 26–30 are polish, and run in the same waves because they're small.
- **Phase 5's own decisions stand.** In particular: "the kernel posts [notifications], and the app opens their links" (phase 5 item 01), and the exit criterion "everything in phases 2–4 can be done from the app, with nothing typed in a terminal".

## Scope

1. **Kernel:** a Stop or Kill on a `starting` session is accepted and recorded (`session_stop_requested`). The session ends as soon as it can: before spawn it never spawns (ending `stopped`, `owner_stop` / `owner_kill`), and during spawn the stop applies at the first moment the session is live. A route that truly can't act answers 409 with a reason the app shows. The queue event of a never-spawned session is settled, not retried.
2. **App (Sessions):** a 409 or any error from Stop or Kill shows inline in the session's header (the refusal text), never nothing. Stop and Kill stay enabled for `starting` sessions.
3. **Docs:** starting sessions in `docs/architecture/session-control.md`.

## Non-goals

- Why sessions take 20–40 s to start (record the observation; split it out if it matters).

## Acceptance criteria

- [ ] Given a session in `starting` (a test spawner held before it is live), when the owner presses Stop, then `session_stop_requested {by: owner, mode: stop}` is recorded and it ends `stopped`/`owner_stop` without running a turn.
- [ ] Given the same with Kill, then it ends `stopped`/`owner_kill`.
- [ ] Given a stop on an ended session, then the 409 `not_running` shows in the app as text.
- [ ] Phase 5's Sessions and control tests pass.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- `bash scripts/check-docs.sh`
- House rule (advisory): e2e specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts`).

## Assumptions

- The manager can cancel a session between admission and spawn with a check, not a restructure. If it can't, stop and say so.

## Risks

- A race between stop and spawn that leaves an orphan process. Test both orders.

## Depends on
2026-10-24-115023-wright-points-to-the-app-not-cli-commands.md

## Touches
kernel/src/console/control.ts
kernel/test/console-control.test.ts
kernel/src/sessions/manager.ts
kernel/test/sessions.test.ts
app/src/screens/sessions/
app/e2e/sessions.spec.ts
app/e2e/fixtures/sessions.ts
docs/architecture/session-control.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-24T20:21:54Z
- **Brief:** .supervisor/jobs/done/2026-10-24-stop-and-kill-work-on-a-starting-session.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/133
