# 25d — A kernel-run session may run the repo's declared checks

**As the** owner,
**I want** a ticket run's worker (and a `review_pr` fix worker) to run exactly the checks the repository itself declares,
**so that** Loomwright can verify its change and the Supervisor publishes a PR, without letting the run execute arbitrary code it wrote.

## Why
Item 24a, observed 2026-11-20 (session 249, issue studio-sandbox#21): the worker was denied `chmod +x drum.sh`, `bash drum.sh` and `bash -n drum.sh` (events 38063 → 38078), the Supervisor checkpointed with no PR, and the run stopped before its second item. The same pattern ran through sessions 217, 224, 226, 231 and 236. Loomwright's worker, fix worker and code-reviewer are all told to run the project's tests (`agents/worker.md:79`, `skills/review-heal/SKILL.md:168,446`, `agents/code-reviewer.md:267-268`); denied, the reviewer must mark behaviour `unverified`, which forces `NEEDS_HUMAN`.

## Acceptance criteria
- [ ] Given a run launch, when the kernel builds the session's policy, then it reads the repo's declared checks from the base branch's committed files, never the working tree: each `run:` line of every job in `.github/workflows/*.yml`, and `npm test` / `npm run <script>` for each script in `package.json` (`scripts`), recorded on the session row with the base sha they came from.
- [ ] Given a declared check, when a run session issues exactly that command line (after 25b's parse; an extra argument, a different script or a prefix of it is not a match), then it is admitted with reason `declared_check`; any other execution (`bash <file>`, `./<file>`, `node <file>`, `npx …`) stays refused.
- [ ] Given a declared `run:` line that contains a construct the rail refuses (a pipe, `&&`, a redirect, a multi-line script), when the kernel reads it, then that line is not admitted and the launch records it as `declared_check_skipped` with the reason; the rest are admitted.
- [ ] Given a repo with no workflow and no `package.json`, when the run launches, then it has no declared checks and the run's prompt says so (the worker can't run code; the Supervisor's checkpoint names that).
- [ ] Given the run edits `package.json` or a workflow on its branch, when it then issues the new command, then it is refused: only the base sha's declarations count.
- [ ] Given the studio-sandbox repo (its `ci` workflow runs `npm test`, which is `node ping.js`), when a ticket asks for a script, then the worker can run `npm test` (the runbook's ticket wording that makes `npm test` exercise the new script is 25f's).
- [ ] Given 25a's exclusions table, when this story lands, then every `filed: 25b|25c|25d` row the rail now admits is removed, and the conformance test gains a stale-exclusion check: an excluded command the rail admits fails the test.
- [ ] The kernel records each declared-check admission in the session's `tool_decision` events (reason `declared_check`), so the walk's evidence shows which checks ran.

## Non-goals
- Per-playbook extra commands (not chosen; revisit if a project needs more than its declared checks).
- Running a file the run itself created directly.

## Owner decisions
- 2026-11-20: "Repo's declared checks" chosen for 24a (owner, /product-owner session).

## Priority: MVP
Blocks walk step 1 (and step 2's fix).

### Assumptions
- Defect evidence: observed — studio.db events 38063-38078 and the run file line `no PR: supervisor_checkpoint (Worker Bash blocked by kernel tool policy …)`.
- `npm test` runs `node ping.js` under the rail's process: it executes repo code, but only code the base branch declared as its test.

### Risks
- A ticket whose change is a new script is only exercised if the repo's tests call it; the Supervisor may still checkpoint. The runbook's tickets are written to fit.

## Validation (must pass before merge)
1. **Static — kernel suite:** `cd kernel && npm test`, with tests for reading declarations from a base sha, exact-match admission, the skipped constructs and the branch-edit refusal.
2. **Static — conformance:** 25a's test passes with every closed `filed:` row removed and the stale-exclusion check on; re-adding one closed row makes it fail.
3. **Running system — next live walk:** session events show `npm test` admitted `declared_check`, and the ticket run opens its PR.

## Depends on
2026-11-20-120000-25a-a-conformance-test-catches-every-loomwright-command-the-rail-denies.md
2026-11-20-120200-25c-run-sessions-may-manage-files-and-wait-on-subagents-inside-their-checkout.md

## Touches
kernel/src/automate/declared-checks.ts
kernel/src/automate/launch.ts
kernel/src/sessions/policy.ts
kernel/test/automate-declared-checks.test.ts
kernel/src/automate/run-exclusions.ts
docs/architecture/automate.md

## Status: brief-shipped

Job `.supervisor/jobs/done/2026-11-23-25d-run-may-run-repos-declared-checks.md` completed (reconciled from the job lifecycle, not self-reported).
Acceptance criteria are NOT machine-verified here — review them before promoting this to `## Status: done`.
