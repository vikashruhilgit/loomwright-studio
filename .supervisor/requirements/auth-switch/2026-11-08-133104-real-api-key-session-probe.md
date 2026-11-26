# Auth 1 — One real API-key session succeeds, and the result is recorded

## Status: done
2026-11-08: owner ran `probes/p16-api-key-real-session.mjs`; all four models answered on the key (`docs/evidence/p16-api-key-real-session.json`). Error scenario left open, see below.

**As** the owner of Loomwright Studio,
**I want** one agent session to run end to end on a real `ANTHROPIC_API_KEY` through the `api-key` provider,
**so that** the in-app provider switch (Auth 3, Auth 4) is built on a proven path rather than a stub-tested one.

## Why

The `api-key` provider (`kernel/src/auth/api-key.ts`, Keychain item `loomwright-studio-api-key`) is stub-tested only (D16, `docs/ARCHITECTURE.md` §Auth). The only live evidence is negative: an invalid key reached the API and got `401` after 10 retries (>60 s) (`docs/OPEN_QUESTIONS.md`, Q4). A success with a real key has never been run.

## Acceptance Criteria

**Happy path:**
- [x] Given a real API key in the Keychain item `loomwright-studio-api-key` and `settingSources: []`, when the probe runs a one-turn query per model the owner chooses, then each answers, the init message reports `apiKeySource: "ANTHROPIC_API_KEY"`, and nothing of the user's setup loads except Loomwright and the CLI builtins.
- [x] Given the probe ran, then `docs/OPEN_QUESTIONS.md` records the date, SDK/CLI version, models answered, `apiKeySource`, loaded plugins, and whether a `rate_limit_event` appears on the key (cap detection on the API path).

**Edge cases:**
- [x] Given `CLAUDE_CODE_OAUTH_TOKEN` is also set in the probe's parent environment, when the probe builds the child env through `credential-env.ts`, then only the key reaches the session (the strip list holds for the API path too).

**Error scenarios:**
- [ ] *(not observable without revoking a key or draining credit; recorded as open in `docs/OPEN_QUESTIONS.md`. An invalid key now fails with an `assistant` `authentication_failed` error ~0.3 s after init, not an `api_retry`.)* Given a revoked or out-of-credit key, when the probe runs, then the failure is visible as an `api_retry` with its status within ~2 s and the probe aborts it (records the status a credit-exhausted key returns, which the kernel's park-and-notify needs).

## Non-goals
- Switching the owner's running kernel to the key (that is Auth 3/Auth 4).
- Any app UI.
- Workload Identity Federation.

## Owner decisions
- 2026-11-08: the real-key probe is a prerequisite story, recorded before the UI switch ships (/product-owner session).

## Priority: MVP
**Rationale:** The switch is worthless if the target path doesn't authenticate; one run removes the biggest unknown.

## Assumptions
- The owner runs the probe; the key is a real credential and never enters a prompt, file or log (pattern of `probes/p4d-token-isolated-auth.mjs`).
- A small API spend for the probe is acceptable to the owner.

## Dependencies
- Depends on: none
- Blocks: Auth 3 (its merge needs this evidence); runs alongside Auth 2

## Risks
- Credit-exhausted status may differ from invalid-key `401`; if not observable without draining credit, record it as still open.

## Validation (must pass before merge)
1. **Running system — the owner's probe output:** the probe's JSON evidence (committed under `docs/evidence/`) shows each requested model answered on the key with `apiKeySource: "ANTHROPIC_API_KEY"`.
2. **Static — docs:** `docs/OPEN_QUESTIONS.md` entry updated from NEEDS VERIFICATION to the recorded result.

## Depends on
none

## Touches
probes/p16-api-key-real-session.mjs
docs/OPEN_QUESTIONS.md
docs/evidence/p16-api-key-real-session.json
