# 12 — Loomwright version notes flag only what changed, and the docs match the code

## Status: ready

**Priority:** Phase 2 polish · items 02 and 07 · from run `automate-2026-10-14-212726`'s kept review summaries (lanes L1 and L6)

**As** the owner,
**I want** a Loomwright version note to flag a breaking change only when it is new, and the Loomwright docs to describe what the code really does,
**so that** a repeated warning does not train me to ignore the real ones, and I can trust the docs when something goes wrong.

## Problem

From the reviews of items 02 and 07 (`kernel/src/loomwright/`, `docs/architecture/loomwright.md`):

- `schema_above_known` is flagged as breaking on every note while the new contract's schema stays above `KNOWN_CONTRACT_SCHEMA_VERSION`, not only on the change that crossed it.
- `firstLineOf` allocates a buffer the full marker size for every note file it probes; `Math.min(markerBytes + 1, <file size>)` is enough.
- The docs say the version watcher reads `capabilities.json` once; it reads it twice (the stored bytes are still the validated bytes).
- The docs say the no-contract notification is sent once per install path; its dedupe key also includes the adapter's message.
- The docs say every Loomwright refusal happens before admission, auth or any spawn; the host-switch collision refusal runs after admission and `buildEnv`.

## Scope

1. Flag `schema_above_known` only when the previous contract's schema was at or below the known version and the new one is above it. Keep reporting the schema version in the note either way.
2. Size `firstLineOf`'s buffer to `min(markerBytes + 1, file size)`.
3. Correct the three doc statements in `docs/architecture/loomwright.md` to match the code (or change the code where the doc states the intended behaviour, and say which in the PR).

## Non-goals

- Changing the session manager's Loomwright state directory or its host-switch checks (`kernel/src/sessions/manager.ts`); see the plan doc's "Considered and not queued".
- Reading anything beyond `capabilities.json` (D32).

## Acceptance criteria

- [ ] Given a change from schema 1 to schema 2 with the known version 1, then the note flags `schema_above_known`; and given a later change from 2 (still above known) to another version at schema 2, then that note does not flag it, and still states the schema version.
- [ ] Given a note file larger than the marker, when `firstLineOf` probes it, then the buffer it allocates is no larger than the marker plus one byte.
- [ ] Given `docs/architecture/loomwright.md`, then its statements about how often the contract is read, the no-contract notification's dedupe, and when the host-switch refusal happens match the code.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Depends on
none

## Touches
kernel/src/loomwright/
kernel/test/loomwright-version-note.test.ts
docs/architecture/loomwright.md
