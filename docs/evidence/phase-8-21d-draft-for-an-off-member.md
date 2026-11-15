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

Walked on 2026-11-15 in the packaged app (`Loomwright Studio.app`, pid 31912), driven from the coordinator session through the macOS accessibility API, against the kernel built from this PR's head `4e4ac62b` and installed as the service (`npm ci`, `npm run build`, `node dist/cli/index.js service install`: "installed and loaded: kernel 0.0.0 (pid 87931)"). `sw_vers -productVersion` `26.6.2`, Node `v24.11.1`. ClickUp connected. The crew member was the walk-only member Wright Walk 22a One (`wright-walk-22a-one`, model `claude-sonnet-4-5`), not a working member.

### Step 1: the member is off: PASS

Team, Wright Walk 22a One's inspector: subtitle "Crew member · off", and the inspector ends with "Open thread" and "Turn on". (It was already off from the 22a walk's clean-up, so the toggle was not pressed here; step 5 presses it.)

### Steps 2 and 3: Wright drafts for the off member and names the owner step: PASS

Asked in Wright's thread: "Please draft a playbook for Wright Walk 22a One: when I send it, it reads the open ClickUp tasks tagged studio-sandbox in the Loomwright Studio list (list id 901422761392) and leaves one short comment summarising each. Only draft it; don't dry-run it or turn it on yet."

```text
events 24094 playbook_created {"playbook_id":16,"slug":"summarise-studio-sandbox-clickup-tasks","owning_agent":"wright-walk-22a-one","version":1,"by":"wright","trigger_id":25}   2026-11-15T03:43:36.995Z
playbooks 16  owning_agent wright-walk-22a-one  status draft
session 177's kernel_playbook_create result:
  "member_off":"Wright Walk 22a One is off. Before its dry run or turning this playbook on, turn Wright Walk 22a One on: Team, then Wright Walk 22a One's inspector, then Turn on."
```

No `agent_off` refusal at create. Playbooks showed the draft in its "3 playbooks wait on you" banner ("Summarise studio-sandbox ClickUp tasks"). Wright's reply, under "Before a dry run or turning it on:": "**Turn the member on.** Wright Walk 22a One is currently off. Go to Team, open its inspector, and choose Turn on." No tool name, error code or path in that sentence.

### Step 4: a dry run while the member is off is refused, no session: PASS

Asked: "Please dry-run the Summarise studio-sandbox ClickUp tasks playbook now, as it is. Don't turn anything on." Session 178 (Wright):

```text
tool result: agent_off: wright-walk-22a-one is off; its playbooks do not run
playbook_runs: no row for playbook 16 (latest row still 195, playbook 14)
sessions: no new session for wright-walk-22a-one (its latest is 171, from the 22a walk)
```

Wright's reply: "The kernel refused the dry run, so nothing ran and nothing was spent. Why: ... belongs to the crew member wright-walk-22a-one, and that member is turned off. ... 1. Turn wright-walk-22a-one back on in Team's inspector, then tell me and I'll run the dry run ..." It names the same owner step. Nit, not a failure: this reply names the member by its id, where the create's `member_off` line uses the display name; the wording is Wright's, the kernel's refusal is unchanged by design.

### Step 5: turned on, the dry run runs as the member: PASS (with a limit)

Team inspector, "Turn on" pressed; the button then read "Turn off".

```text
events 24121 agent_status_changed {"id":"wright-walk-22a-one","old":"off","new":"active","by":"owner"}   03:45:53Z
       24133 playbook_dry_run {"playbook_id":16,"version":1,"run_id":196,"status":"done","tokens":0,"would_do":0}   03:46:37Z
playbook_runs 196: playbook 16 v1, dry_run, done; fit.agent wright-walk-22a-one, fit.status no_jobs
  poll.spec {"source":"clickup.tasks","filters":{"list":"901422761392","status":"open","tags":["studio-sandbox"]}}; poll.items []
```

The dry run was not refused and ran for the member. Limit: the poll found no task, because the draft filters on ClickUp status `"open"` and the list's studio-sandbox task does not carry that status name (Wright said so in its reply and offered a new version), so no review session started under the member and nothing was reviewed. The member's own session start on a dry run with items is covered by the unchanged dry-run path (run 193 in the 22a walk); this item does not touch it.

Clean-up: `studio agents off wright-walk-22a-one` (event 24139), `studio playbooks off 16` (event 24140, `disabled`).

Verdict: PASS for Validation 2
