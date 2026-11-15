# Phase 8 item 21d: Wright drafts a playbook for a crew member that is off

The phase 8 item 21a walk failed on its first ask: Ticket Runner was off, so `kernel_playbook_create` refused `agent_off: <id> is off; turn it on before drafting its playbooks`, and the owner had to go to Team before Wright could write a draft. A draft starts no session, so the member's on/off state does not need to gate it. This item lets the create draft for any registered crew member, `active` or `off`, and has the result tell the owner, in plain words, to turn an off member on before the dry run or the enable.

## What changed

- `kernel_playbook_create` (`kernel/src/playbooks/drafts.ts`, `draftOwner`) no longer refuses an `off` member. An `agent` that names no registered crew member is refused `agent: "<id>" is not a registered crew member` (the word "active" is gone), before anything is written. A crew member's own session is still refused `crew_cannot_draft`, and a non-Wright caller naming `agent` is still refused `agent: only Wright drafts a playbook for another agent`.
- A new helper `withMemberOff(store, agent, result)` sits beside `withFit`. For a member that is `off` now it adds `member_off`: one line built from the member's display name only, for example `Mason is off. Before its dry run or turning this playbook on, turn Mason on: Team, then Mason's inspector, then Turn on.` It has no tool name, error token, path or member id. It is read after the step and never stored in it, so a repeat under the same idempotency key shows the member's status now (and the stored first result stays free of it).
- The create description says `agent` is a registered crew member (active or off), and holds the sentence `member_off (only when that crew member is off)` telling Wright to say the same to the owner in plain words, and to name that owner step first when a later dry run is refused because the member is off or an enable because there is no dry run.
- Unchanged, by design: an `off` member's dry run is still refused `agent_off: <id> is off; its playbooks do not run` with no session started, an enable of its draft is refused before the hold for want of a dry run (nothing held), and a fire of an enabled playbook whose member is off still fails `agent_off` with one notification. `off` still stops sessions (D34).
- `docs/architecture/playbooks.md` describes all of it: `agent` as any registered crew member, `member_off`, the reworded refusal, the repeat behaviour (a repeat of a create for a member turned off since returns the stored result, now carrying `member_off`, instead of `agent_off`), and `agent_off` no longer listed as a refusal "at create".

## The new pins

All in `kernel/test/playbooks-crew.test.ts` (20 tests in the file):

- `AC1: Wright drafts for an active crew member: ...` gained `expect(created).not.toHaveProperty("member_off")` (an active member's result is unchanged).
- `AC1/AC7: an unregistered agent (agent:), a crew member's own session and a non-Wright caller are refused before anything is written; an off member is no longer refused` is the old `AC1: an unregistered agent (agent:) or an off member (agent_off:) ...` test changed in place: it keeps the `ghost` and `SCOUT_SESSION` refusals and the `footprint()` check, adds the `crew_cannot_draft` refusal from mason's own session and the reworded unregistered text, and ends with the off member drafted.
- `AC1/AC2: the draft is created and owned by the off member exactly as for an active one, and the result carries one plain-words member_off line`: the row, the linked trigger, the `playbook_created` event, the mirror's `- Agent:` line, `fit`, and a `member_off` line that names `Mason`, `Team`, `inspector` and `Turn on` and contains none of `kernel_`, `mcp__`, `agent_off`, `no_dry_run`, `/`, `.json`, `.md`, the member id.
- `AC5/AC6: the line is not stored in the step: a repeat under the same key after the member went off returns the first id, slug and version with member_off, and no second row`: the first result (active) has no `member_off`; the repeat after the member went off returns the same `id`, `slug` and `version`, carries `member_off`, and leaves one row; after turning the member on again a further repeat has none.
- `AC3/AC4: the off member's draft has its dry run refused agent_off with no session, and an enable is refused before hold for want of a dry run; no approval`: through the `bootManager` harness, the `started` list stays empty, the enable gate answers `a dry run of version 1 is required`, and `approvals` stays 0.
- `AC2: the create description carries the member_off sentence ...`: pins `member_off (only when that crew member is off)` and its neighbouring wording.

The existing `AC5: mason off at fire time` fire test and `AC3: an off owner is refused agent_off` dry-run test are unchanged and green.

## Pin mutations

Each applied alone to `kernel/src/playbooks/drafts.ts`, the crew test file run, then reverted (the file was byte-identical to the good copy afterwards).

| # | Mutation | Result |
|---|----------|--------|
| 1 | `getAgent(store, requested) === undefined` to `getAgent(store, requested)?.status !== "active"` | 4 tests fail (AC1/AC7, AC1/AC2, AC5/AC6, AC3/AC4) |
| 2 | `row.status !== "off"` to `row.status !== "gone"` | 3 tests fail (AC1/AC2, AC5/AC6, AC3/AC4) |
| 3 | `row === undefined \|\| row.status !== "off"` to `row === undefined` | 2 tests fail (the active-member AC1 test, AC5/AC6) |
| 4 | `is not a registered crew member` to `is not an active registered crew member` | 1 test fails (AC1/AC7) |
| 5 | delete `member_off (only when that crew member is off)` | 1 test fails (the AC2 description pin) |

## Validation 1

Run in the worktree at the end of the change, on 2026-11-15.

```bash
cd kernel && npm ci && npm test
```

```text
 Test Files  137 passed | 2 skipped (139)
      Tests  4740 passed | 16 skipped (4756)
```

```bash
cd kernel && npx tsc -p tsconfig.json
```

```text
exit 0, no output
```

```bash
bash scripts/check-docs.sh
```

```text
check-docs: OK
```

## Validation 2

Not walked yet. The owner walks this in the running app, then the verdict line below is filled in.

1. In Team, turn a crew member off (for example Ticket Runner).
2. In Wright's thread, ask Wright for a playbook for that member.
3. Check: a draft is created and owned by the member (Playbooks shows it, agent set to the member), and Wright tells you in plain words to turn the member on (Team, the member's inspector, Turn on) before its dry run, with no tool name, error code or path in the sentence.
4. Ask Wright to dry-run it while the member is still off. Check: the dry run is refused because the member is off, no session starts, and Wright names the same step (turn the member on in Team).
5. Turn the member on, ask for the dry run again, and check it starts as the member.

Verdict: PENDING for Validation 2
