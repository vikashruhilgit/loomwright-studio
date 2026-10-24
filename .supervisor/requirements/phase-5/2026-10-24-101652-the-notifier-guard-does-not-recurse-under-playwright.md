# 21 — The notifier guard doesn't recurse under Playwright

## Status: ready

**Priority:** MVP (phase 5 follow-up, found by the exit e2e) · test infrastructure (#99)

**As** the owner,
**I want** `kernel/test/notifier-guard.ts` to install cleanly in a Playwright worker,
**so that** every spec that boots a real kernel is guarded against posting a real notification without carrying its own workaround.

## Problem

In a Playwright worker, `execFile`'s `util.promisify.custom` already points at itself, because Playwright's runner promisifies `execFile` before any spec loads. The guard then wraps that custom function (`kernel/test/notifier-guard.ts:117-118`), and its wrapper recurses without end (`RangeError`). `app/e2e/phase-5-exit.spec.ts:421-428` deletes the self-reference before installing the guard. The fix belongs in the guard (`docs/OPEN_QUESTIONS.md`, "Known gaps the e2e found" (3)).

## Owner decisions (2026-10-24, binding)

Recorded 2026-10-24 in the phase 6 requirements session, when the owner asked for the gaps the phase 5 exit e2e found (`docs/OPEN_QUESTIONS.md`, "Known gaps the e2e found") to be written up as items. The owner chose the proposed option each time. Each item carries this copy. Phase 5's 2026-10-20 decisions (item 01) still hold.

- **Gap 1, the trigger card = a card at creation.** A trigger gets its full card (schedule, next fire, On/Off) in its agent's thread as soon as it's registered, from its `trigger_registered` event. The app reads `GET /triggers?all=1`, so a spent or off trigger still shows its state. The one-line "fired" card stays as it is.
- **Gap 2, the notification list = the menu-bar panel.** The menu-bar panel shows the most recent notifications (e.g. the last 20), each with its delivery status. Each row opens what it links to, through the same `loomwright-studio://` link the notification's click would.
- **Gap 3, the notifier guards Playwright recursion = fixed in the guard.** This one needs no owner decision: the fix belongs in `kernel/test/notifier-guard.ts`, and the spec's workaround goes.
- **These land before phase 6.** Phase 6's foundation also edits `kernel/src/console/threads.ts`. These items run first, as phase-5 items.

## Scope

1. **Fix the guard:** when `original[promisify.custom]` is the function itself, or already a guarded wrapper, don't wrap it again. Give the wrapper a `promisify.custom` that guards the original's promisified form without referring back to the wrapper. The guard stays idempotent: installing it twice is a no-op.
2. **Remove the workaround** from `app/e2e/phase-5-exit.spec.ts` (the self-reference delete and its comment).
3. **A test** in `kernel/test/notifications-test-guard.test.ts`: an `execFile` stand-in whose `promisify.custom` points at itself gets guarded without `RangeError`. Both `execFile` and `promisify(execFile)` of a notifier binary are still refused. Installing twice is safe.

**Not here:** the gap's `docs/OPEN_QUESTIONS.md` entry is updated in the phase 5 close-out commit (with the live run's evidence), so items 19–21 don't conflict on it. Say what's fixed in the PR body.

## Non-goals

- Any change to the shipped notifier.

## Acceptance criteria

- [ ] Given an `execFile` whose `promisify.custom` is itself, when the guard installs, then no `RangeError` is thrown, and a call to `terminal-notifier` through either form is refused.
- [ ] Given the guard installed twice, then calls are guarded once, and nothing recurses.
- [ ] Given `phase-5-exit.spec.ts` without its workaround, then it passes in CI.
- [ ] `notifications-test-guard.test.ts` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `cd app && npm ci && npm run typecheck && npm test && npm run build`, plus the Playwright e2e

## Assumptions

- The self-reference is Playwright's own doing, not the guard's. The test reproduces it with a stand-in.

## Risks

- A guard that silently stops guarding. The test asserts that both call forms are refused.

## Depends on
none

## Touches
kernel/test/notifier-guard.ts
kernel/test/notifications-test-guard.test.ts
app/e2e/phase-5-exit.spec.ts
