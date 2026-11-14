# 22a — Wave 1 of phase 8 item 21 walked live on the merged main

## Status: ready

**As** the owner of Loomwright Studio,
**I want** the crew tracker grant (21b) and the dry-run owner step (21e) walked once more in the packaged app on the merged `main`, including the cases no walk has covered,
**so that** what shipped in wave PR #279 is shown working on the code that actually merged, not on an earlier head.

## Why

Found 2026-11-14 while closing the phase-8-21 wave (wave PR #279, merged at `94785599`; `main` now at `1949901e`). Every wave-1 item passed its own validation gate, but not all of it on the code that merged:

- **21b:** Validation 2 failed steps 2 and 5 at `503d915b`; steps 2 and 5 were re-walked and passed at `3e4181a5` ([evidence](../../../docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md)). Two later commits changed how a new member's grant is saved: `507b75e6`, then `6d855422` (the settings file is no longer written before the commit; `ensureAgentFiles` rebuilds it after the commit from the recorded `agent_settings_set` grant, `recordedConnectors` in `kernel/src/agents/charter-files.ts`). Step 3 (create with Read tickets and Comment on tickets ticked; the member holds exactly those tools) runs exactly that path and was last walked live on the old code. Steps 1, 4 and 6 were not re-walked at the final code, and optional step 7 never ran.
- **21e:** Validation 2 passed at `516a90a2` ([evidence](../../../docs/evidence/phase-8-21e-dry-run-owner-step.md)). Its step 6 (grant the member GitHub write, dry-run again with a new key, and the review session runs; AC5) was never walked live, and the later summary-wording fix (`fa3abd3a`) is covered by tests only.
- **An untested interaction between them.** 21e skips the dry-run review session only when `fit.owner_steps` is non-empty (`ownerStepsOf`, `kernel/src/playbooks/dry-run.ts`), and owner steps come from the tools of the jobs a playbook names (`kernel/src/playbooks/fit.ts`). A playbook that names no jobs reads `fit.status: "no_jobs"`, which has no owner steps. 21b made a ClickUp duty with no kernel job valid (`source: "clickup"`, `jobs: []`), and Wright drafted playbooks 11 and 12 for such members naming no jobs. A ClickUp poll's preview checks the ClickUp connection (`mcpConnectorGate`) but not the member's own ClickUp grant. So a member with no ClickUp access, dry-running a ClickUp poll playbook that names no jobs, may list the tickets and then start a review session that cannot read them: the ~100k-token waste 21e removed for job-based playbooks. This is read from the code, not observed.

## Acceptance Criteria

**Happy path:**
- [ ] **AC1.** Given the kernel installed as the launchd service and the packaged app, both built from `main` at a recorded commit, when 21b's Validation 2 steps 1, 3, 4 and 6 are walked, then each passes as written in the 21b evidence file. In particular, a member created with Read tickets and Comment on tickets ticked holds exactly those capabilities' usable tools in its settings file (`studio agents show <id>`), and the `agent_settings_set` event records the same grant.
- [ ] **AC2.** Given that member, when its settings file is removed and the next crew message (or `ensureAgentFiles`) runs, then the file comes back holding the same grant, and the inspector shows the same capabilities granted.
- [ ] **AC3.** Given a crew member with a ClickUp poll playbook and an open owner step (21e's setup), when the owner grants the missing GitHub write in Team and dry-runs again with a new key, then the review session runs as before (21e AC5), its tokens are recorded, and the summary makes one claim about the enable.

**Edge cases:**
- [ ] **AC4.** Given a crew member whose only duty is `source: "clickup"`, `jobs: []`, with no ClickUp grant, and a ClickUp poll playbook for it that names no jobs, when it is dry-run, then the result is stated as observed: whether a review session started, its tokens, and the summary. If a session starts that cannot read the tickets, the dry run instead starts no session and names the missing ClickUp access as the owner's step, in plain words, with 0 tokens, and stores the run `done` (the same shape as 21e's `owner_step_open`).
- [ ] **AC5.** Given AC4's member after the owner grants it Read tickets, when it is dry-run again with a new key, then the review runs as for any member with access.

**Error scenarios:**
- [ ] **AC6.** Given any step of the walk that fails at `main`, then the failure is recorded in the evidence file with its observed output before anything is fixed, and a fix lands only for what the walk proved broken.

## Non-goals

- Re-walking steps that passed live at the final code (21b steps 2 and 5).
- 21c: it needed only static validation, which passed.
- Wright drafting playbooks nobody asked for: item 21f, PR #280, merged.
- New tracker capabilities, or changing what Validation 2 of 21b or 21e asks.

## Owner decisions

- 2026-11-14: Studio has no delete for crew members or playbooks; the three test members of 21b's walk and playbooks 10 to 12 were turned off, not deleted. The walk creates fresh members and turns them off afterwards.
- 2026-11-14: these follow-ups run in one new run with 21d (option A), not injected into the old run.

## Priority: MVP

**Rationale:** the code that merged in #279 has paths no live walk covered, one of them the grant-saving fix, and phase 8's exit depends on this behaviour.

## Assumptions

- The ClickUp connection stays connected and the `studio-sandbox` tagged task in the Loomwright Studio list still exists.
- AC4's outcome is read from the code; the walk decides it.

## Dependencies

- Depends on: none (wave PR #279 is merged).
- Blocks: the phase 8 exit re-run (`docs/evidence/phase-8-exit-runbook.md`).

## Risks

- AC3 and AC5 run real review sessions (about 100k tokens each in earlier runs). The walk records tokens per run.
- The walk changes the owner's store (crew members, a GitHub grant, playbooks): each change is the owner's at the walk, and the walk turns its test members and playbooks off when done.

## Success Metrics

- Every AC recorded with observed output and a verdict line in one evidence file.

## Handoff

- `/automate --folder .supervisor/requirements/phase-8-22` with the rest of this folder.

## Validation (must pass before merge)
1. **Static — kernel suite and docs:** `cd kernel && npm ci && npm test` and `bash scripts/check-docs.sh`, including a test for AC4's no-session outcome if a fix lands.
2. **Running system — the walk on the merged main:** in the packaged app with the kernel installed from `main`, walk AC1 to AC5 and record each with its observed output, the commit, the service pid and `sw_vers -productVersion` in `docs/evidence/phase-8-22a-wave-1-walk-on-main.md`, ending with `Verdict: PASS for Validation 2`.

## Depends on
none

## Touches
docs/evidence/phase-8-22a-wave-1-walk-on-main.md
kernel/src/playbooks/dry-run.ts
kernel/src/playbooks/dry-run-poll.ts
kernel/src/playbooks/fit.ts
kernel/test/playbooks-dry-run-poll.test.ts
docs/architecture/dry-run.md
