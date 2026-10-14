# 03 — Notifications: native macOS notifications with a stable deep link, plus `studio notifications`

## Status: ready

**Priority:** MVP · ROADMAP phase 2 exit check (a) needs the reminder to reach the owner · D11, D17

**As** the owner,
**I want** a native macOS notification when Studio has something for me, which opens the details when I click it, and a CLI list of every notification,
**so that** I notice a 5pm reminder without watching a terminal, and can always find it again.

## Problem

Today a `notify` is only an audit row in `events`; nothing reaches the owner. Phase 2 has no GUI (Electron is phase 5).

## Owner decisions (2026-10-14, binding)

- Delivery is a native macOS notification **and** a CLI list.
- Every notification carries a stable deep link `loomwright-studio://notifications/<id>`, recorded and shown in the CLI. In phase 2 a click opens Terminal on `studio notifications show <id>`. The phase 5 app takes over the same scheme later.

## Scope

1. **Record**: a function other features call to create a notification row (item 01's `notifications` table): source, title, body, deep link (always `loomwright-studio://notifications/<id>`), status `pending`. Creating the row commits with an audit event; delivery happens after the commit.
2. **Deliver** (due-work contribution, item 01 seam): every `pending` row is posted once as a native macOS notification whose click runs `studio notifications show <id>` in Terminal. Plain `osascript display notification` can't carry a click action; finding a mechanism that works **from the launchd agent** (no terminal, the kernel's install copy, D31) is part of this item: probe the candidates, record what works, choose one. Delivery outcome is written to the row: `delivered`, `failed` (with the error, one audit event, no retry loop, D17), or `unsupported` (not macOS, or no click-capable notifier available: the notification is still posted without a click action when possible and the row says why).
3. **`kernel_notify(title, body, idempotency_key)`** tool for agents, through the seam; source `agent:<name>`. Text is stored as given and displayed as plain text (never interpreted).
4. **CLI** (seam): `studio notifications [--limit N] [--json]` lists newest first (id, time, source, title, delivery status, deep link); `studio notifications show <id>` prints the full record, and for a `trigger:<id>` source the trigger's id, action and next fire, and for a session source the session id and status. API routes back both (bearer token as always).
5. Doc page `docs/architecture/notifications.md`: the record, delivery, the deep-link scheme, the chosen notifier and its limits.

## Non-goals

- Registering the `loomwright-studio://` URL scheme with macOS (the phase 5 app does).
- Notification preferences, quiet hours, grouping (policy; later).
- Slack or other connectors (phase 9).

## Acceptance criteria

- [ ] Given a recorded notification, when the loop ticks, then exactly one native post is attempted and the row moves to `delivered` / `failed` / `unsupported` with detail; a crash between post and status write never posts it twice more than once (at-most-once per row after a restart; a duplicate after a crash in that window is acceptable and documented, a loop is not).
- [ ] Given delivery fails, then one audit event records it and the row stays `failed`; no retry on later ticks.
- [ ] Given `studio notifications show <id>`, then it prints the record including the deep link; for an unknown id it exits non-zero with "no such notification".
- [ ] Given `kernel_notify` is called twice with the same idempotency key in one session, then one notification exists.
- [ ] Given a body containing shell metacharacters, quotes and newlines, then the posted notification shows it literally and nothing is executed (test with a stub notifier asserting argv/stdin, never a shell string).
- [ ] `docs/evidence/phase-2-notifier-probe.md` records, from the owner's Mac **under the launchd agent**: which notifier was tried, whether the notification appeared, whether clicking opened Terminal on `studio notifications show <id>`, and any permission prompt macOS showed. The PR body links it.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`
- Owner, on the Mac with the kernel installed via `studio service install`: trigger one notification and click it; result in the evidence file.

## Assumptions

- macOS may ask once for notification permission for the notifier; the evidence records the prompt.

## Risks

- No click-capable notifier works from a launchd agent without a signed app bundle (the same class of limit as D31). Then the item ships `unsupported` click delivery with the link still recorded, and says so in the evidence and the doc. It does not grant anything system-wide to `node`.
- A third-party notifier binary is a supply-chain dependency; prefer a mechanism that ships with macOS. If a dependency is unavoidable, pin it exactly.

## Depends on
2026-10-14-094201-phase-2-foundation-schema-and-feature-seams.md

## Touches
kernel/src/notifications/
kernel/test/notifications.test.ts
kernel/package.json
kernel/package-lock.json
probes/p11-notifier-under-launchd.mjs
docs/architecture/notifications.md
docs/evidence/phase-2-notifier-probe.md
