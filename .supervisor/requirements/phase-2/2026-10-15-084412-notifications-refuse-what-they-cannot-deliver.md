# 11 — Notifications refuse what they cannot deliver, and print what they show safely

## Status: ready

**Priority:** Phase 2 hardening · item 03's notifications · from run `automate-2026-10-14-212726`'s kept review summary (lane L2)

**As** the owner,
**I want** a notification that can never be shown to be refused when it is recorded, and every notification printed without hidden control characters,
**so that** I never get a silently `failed` notification row, and nothing in a notification can disguise itself in my terminal.

## Problem

From the review of item 03 (`kernel/src/notifications/`):

- `recordNotification` and the `kernel_notify` tool accept a NUL character in the title; the notifier spawn then fails and the row ends `failed`.
- An empty body reaches `terminal-notifier` as zero bytes on stdin; whether it then prints its help and exits 1 (row `failed`) is unverified.
- `printable` does not escape bidi controls or U+2028/U+2029, and `--json` output leaves C1 characters raw.
- There are no branch tests for the interrupted-redelivery path in `deliver.ts`, or for `studio notifications show` with a null or missing session.
- The `spawnNotifier` bound comment leaves out `DRAIN_MS` (the worst case is `timeoutMs + KILL_GRACE_MS + DRAIN_MS`).
- `docs/evidence/phase-2-notifier-probe.md` section 1 shows output from before the probe's `--` end-of-options change.

## Scope

1. Refuse at record time (both `recordNotification` and `kernel_notify`) a title or body the notifier cannot carry: a NUL anywhere. The tool answers an error result; nothing is recorded.
2. Probe `terminal-notifier` with an empty body on this Mac, record the result in `docs/evidence/phase-2-notifier-probe.md`, and handle it: if it fails, deliver a body that is never empty (or refuse an empty body at record time); either way, a test pins the behaviour.
3. `printable` escapes bidi controls (U+202A–U+202E, U+2066–U+2069, U+061C, U+200E, U+200F) and U+2028/U+2029; the docs say what `--json` passes through raw (the house `JSON.stringify` convention) instead of claiming escaping it does not do.
4. Branch tests for the interrupted-redelivery path and for `show` with a null or missing session.
5. Fix the `spawnNotifier` bound comment, and re-run probe section 1 so its output matches the current probe.

## Non-goals

- Changing the `notifications` schema or deep-link format.
- Rowid reuse of the delivery step key (latent only if rows are ever deleted; nothing deletes them).

## Acceptance criteria

- [ ] Given a title containing NUL, when `kernel_notify` is called, then it answers an error result and no row is recorded; and the same through `recordNotification`.
- [ ] Given an empty body, then the evidence file records what `terminal-notifier` did, and the recorded notification is either delivered or refused at record time, never left `failed` by the spawn.
- [ ] Given a title with U+202E, U+2028 or U+061C, when `studio notifications show <id>` prints it, then those characters are escaped.
- [ ] Given an interrupted delivery that is redelivered, then a test pins its outcome; and given `show` for a notification whose session is null or no longer exists, then it prints the notification without error.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Depends on
none

## Touches
kernel/src/notifications/
kernel/test/notifications.test.ts
docs/architecture/notifications.md
docs/evidence/phase-2-notifier-probe.md
