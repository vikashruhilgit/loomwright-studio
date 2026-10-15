# 10 — A redelivered ask never drops the reply of a session that is still running

## Status: ready

**Priority:** MVP · correctness of `studio ask` (item 06) · from run `automate-2026-10-14-212726`'s kept review summary (lane L5)

**As** the owner,
**I want** a reply from a Wright session that is still running to always reach my message,
**so that** a passing disk or settings hiccup on a redelivered event never makes Studio lose Wright's answer.

## Problem

The brain's `message` handler (`kernel/src/brain/handler.ts`) is idempotent on the queue row: a redelivered event finds its `brain_messages` row again. Its `fail()` helper moves the row to `failed` from `queued`, `parked` **or `running`**. On a redelivery whose row is already `running` (its session is live), a transient fault in `ensureMemoryFiles` or `readWrightSettings` therefore marks the row `failed`. When the live session later finishes, its reply can no longer be written to a `failed` row, so the answer is lost while the session itself succeeded.

## Scope

1. A redelivery of a message whose row is `running` never moves it to `failed` because of a fault in a step that runs before the session step (memory files, settings, context). The fault is still raised so the event loop retries the event as it does today.
2. A row whose session is gone (not live, never resumed) still ends `failed` with a detail, as today.
3. Small fixes from the same review, in the same files:
   - `settings.ts` accepts a whitespace-padded `model` untrimmed; trim it (an all-whitespace model stays `model_unset`).
   - `cli.ts` and `docs/architecture/brain.md` overstate `studio ask --json` escaping (raw U+202E / U+009B pass through, the house `JSON.stringify` convention); make the wording match the behaviour.
   - The `KernelOptions.contributions` comment in `kernel/src/kernel.ts` still says every shipped contribution is empty.
   - `kernel/test/brain.test.ts` defines the same inline `EventContext` factory twice; use one.

## Non-goals

- Changing the brain's statuses or the `brain_messages` schema.
- Retrying a failed session or re-asking Wright.

## Acceptance criteria

- [ ] Given a message whose row is `running` with a live session, when its event is redelivered and `ensureMemoryFiles` throws, then the row stays `running`, the handler throws (the event is retried), and when the session's result arrives the row becomes `replied` with the reply text.
- [ ] Given the same, when `readWrightSettings` throws instead, then the same holds.
- [ ] Given a message whose row is `queued` or `parked`, when the same fault happens, then the row ends `failed` with the fault in its detail, as today.
- [ ] Given a message whose row is `running` but whose session is no longer live (the session manager does not report it running), when its event is redelivered and the same fault happens, then the row ends `failed` with the fault in its detail, never left `running`.
- [ ] Given `"model": "  claude-x  "` in `wright.json`, then the session is started with `claude-x`; and given `"model": "   "`, then the message fails `model_unset`.
- [ ] Given the docs and the `--json` help, then they no longer claim escaping the CLI does not do.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Risks

- "Session still live" must be read from the session manager, not inferred from the row, or a dead session's row would stay `running` forever. The dead-session criterion guards it.

## Depends on
none

## Touches
kernel/src/brain/
kernel/src/kernel.ts
kernel/test/brain.test.ts
docs/architecture/brain.md
