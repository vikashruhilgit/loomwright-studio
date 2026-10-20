# 12 — No test run posts a real macOS notification

## Status: ready

**Priority:** Phase 4 follow-up (test hygiene, the owner's attention; does not block anything) · invariant 3 (the owner trusts what a notification says) · D5

**As** the owner,
**I want** `npm test` never to post a notification on my Mac,
**so that** every notification I see is from my real kernel, and a test can't make me think an approval is waiting.

## Problem

On 2026-10-20 at 08:12 IST (02:42 UTC) the owner saw a real macOS notification, "Approval 1: kernel_agent_create — wright (session 1) asks to: kernel_agent_create … studio approve 1 once, or studio deny 1". It wasn't from the installed service: the service's store has no such approval, since its approvals #1 and #2 are phase 3's playbook enables. It came from `npm test`, which a review subagent of item 10's `/automate` run had started in this checkout at 02:40:16 UTC.

Reproduced the same day: running `kernel/test/agents-charter-tools.test.ts` alone spawned `terminal-notifier` (pid 24926, seen with `log stream`), while the service delivered nothing in that window.

**The mechanism.** That test boots a full kernel with `startKernel({dataDir, env: {PATH: "/usr/bin"}, sessions: …}, deps)` and no `contributions` option, so it gets `SHIPPED_CONTRIBUTIONS`. That includes the notifications feature's shipped due work, `deliveryDueWork = createDeliveryDueWork()` (`kernel/src/notifications/deliver.ts:89`), which uses the real notifier (`kernel/src/notifications/notifier.ts`: `terminal-notifier` at a fixed path, else `/usr/bin/osascript`). The test's AC1 case holds a `kernel_agent_create`, the approval writes its notification row, and the loop's due work delivers it for real. The exit tests don't do this, because they compose their own contributions with a stub notifier.

**Every test that boots with the default contributions is exposed** (checked on `main` at `ff8b9f9`): `agents-charter-tools`, `api`, `brain`, `brain-crew-routing`, `loomwright-adapter`, `loomwright-version-note` and `playbooks-dry-run`. Only `agents-charter-tools` has been seen posting; the others post whenever a notification row is pending at a loop tick. `phase-2-exit-live` is a live harness (`STUDIO_LIVE=1`), where a real notification is intended.

**Nothing stops it.** No vitest config or setup file exists (`package.json` runs `vitest run`), and nothing in a test run refuses the real notifier. So the leak returns with any new test that boots a kernel the obvious way.

## Owner decisions (2026-10-20)

- The owner asked for this as a phase 4 item after the leak was found during the live rerun.
- Real notifications stay in live harnesses (`STUDIO_LIVE=1`), which are meant to show the owner real notifications. Production behaviour is unchanged.

## Scope

1. **A run-wide guard.** Add a vitest setup (a `kernel/vitest.config.ts` with `setupFiles`, plus `kernel/test/setup-no-real-notifier.ts`). In every test run without `STUDIO_LIVE=1`, it makes a real notifier spawn impossible, and it fails the test that tried, naming the binary. Spawning `terminal-notifier` or `osascript` is refused, whether through the default `NotifierExec` or a direct `child_process` call to those binaries. Two requirements on the mechanism:
   - It lives in test code, not in the kernel's runtime path. If it can only work by changing `kernel/src/notifications/notifier.ts`, the change must be a test-only seam that leaves production behaviour byte-identical; stop and say so if that is not possible.
   - With `STUDIO_LIVE=1` the guard is off, so live harnesses still post real notifications.
2. **Fix the exposed tests.** Each test above that boots a kernel injects a stub notifier, or a notifications contribution built with `createDeliveryDueWork(stub)`, the way the exit tests do. A test that asserts on delivery reads the stub's calls. None is weakened: the same assertions pass.
3. **Pin it.**
   - A test proves the guard fires: a kernel booted with the shipped contributions that delivers one notification fails with the guard's error, not a real spawn.
   - A second case shows the guard is off under `STUDIO_LIVE=1`, without spawning anything: it asserts that the guard reports itself disabled.
4. **Docs.** `docs/architecture/notifications.md` gets a short "Testing" note: a test run can't reach the real notifier, how to inject a stub, and the `STUDIO_LIVE=1` exception.

## Non-goals

- Changing what or when the kernel notifies, or the notifier choice.
- The live harnesses' real notifications.

## Acceptance criteria

- [ ] Given `npm test` with `STUDIO_LIVE` unset, when the whole suite runs, then no `terminal-notifier` or `osascript` process is spawned. A test proves this with the guard; a manual check with `log stream --predicate 'process == "terminal-notifier" OR process == "osascript"'` during a run shows none, recorded in the PR.
- [ ] Given a test that boots a kernel with `SHIPPED_CONTRIBUTIONS` and lets a notification deliver, when it runs without a stub, then it fails with the guard's error naming the notifier, and nothing is posted.
- [ ] Given `STUDIO_LIVE=1`, then the guard is disabled, and a live harness's notifications post as before.
- [ ] Given the seven exposed test files, then each passes with a stub notifier and the same assertions.
- [ ] `cd kernel && npm ci && npm run typecheck && npm test` passes, and so does `bash scripts/check-docs.sh`.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- Vitest's `setupFiles` run in every test worker before any test module, so a guard installed there covers every file.

## Risks

- A guard that patches `child_process` globally could break tests that legitimately spawn other programs (`git`, `ps`, the fake CLI). It must refuse only the two notifier binaries, matched by basename and by the notifier's fixed paths.

## Depends on
none

## Touches
kernel/vitest.config.ts
kernel/test/setup-no-real-notifier.ts
kernel/test/notifications-test-guard.test.ts
kernel/test/agents-charter-tools.test.ts
kernel/test/api.test.ts
kernel/test/brain.test.ts
kernel/test/brain-crew-routing.test.ts
kernel/test/loomwright-adapter.test.ts
kernel/test/loomwright-version-note.test.ts
kernel/test/playbooks-dry-run.test.ts
kernel/src/notifications/notifier.ts
docs/architecture/notifications.md
