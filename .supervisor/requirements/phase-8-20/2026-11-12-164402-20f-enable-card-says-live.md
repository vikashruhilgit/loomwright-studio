# 20f — An enable approval says when the playbook is live

**As** the owner, **I want** an enable card to say the playbook will run live, **so that** I never approve a write-capable run without seeing it.

## Why

the phase 8 exit live run of 2026-11-12 (commit `cfb3d428`, service pid 51124, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live): approval 31 enabled playbook 7 at version 3 in `live` mode. Its display listed model, priority, dedupe key, token limit and merge requirement, and never the mode; Wright had to warn "approval 31 should show whether it would actually run live". `kernel/src/playbooks/enable.ts` builds the lines (`valueLine(...)`, around line 281) without one for `mode`.

## Acceptance Criteria
- [ ] AC1: The enable display has a `mode:` line (`draft` or `live`, with who set it), placed first among the values.
- [ ] AC2: A live enable's first line says it plainly, for example "Enable playbook … at version 3, LIVE: its runs push and comment through the gate".
- [ ] AC3: Tests pin both lines for a draft and a live playbook.

## Validation (must pass before merge)
1. **Static:** `cd kernel && npm test`.

## Depends on
none

## Touches
kernel/src/playbooks/enable.ts
kernel/test/playbooks-foundation.test.ts
