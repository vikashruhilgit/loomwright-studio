# 22g — The kernel launches the triage fix and the merge

## Status: done
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/286

**Ready (2026-11-16):** every line cited below was read on `main` `1a4a77b1`. Approval 43 was read read-only from the live store (`sqlite3 -readonly "file:~/.loomwright-studio/studio.db?mode=ro"`). The owner chose the kernel launch on 2026-11-16 and answered both open questions the same day (see Owner decisions).

**As** the owner of Loomwright Studio,
**I want** the kernel to start `/loomwright:review-pr <pr url>` (a triage fix) and `/loomwright:automate --merge-parked <run_id>` (a merge when ready) as its own sessions, the same way it starts the ticket run (D44),
**so that** the exit walk's triage fix and both merges (exit runbook, walk steps 2, 4 and 5) can run without any crew charter holding `Skill` or a Loomwright shell prefix.

## Why

**Observed (approval 43, 2026-11-16, setup step 6).** The owner asked Wright in Chat for "Sandbox Dev" with the walk's four jobs. Wright's held `kernel_agent_create` (approval 43, session 180, denied by the owner at 2026-11-16T03:07:00Z) carries `tool_policy.allowedTools` with `Skill` among `Read, Glob, Grep, Edit, Write` and twelve `mcp__kernel__` tools, and Bash prefixes `git status`, `git diff`, `git log`. Its readiness card flagged, as "no charter should grant it": "permission to run shell commands and start helper agents for Triage PR comments", "permission to commit with git, push with git and work with pull requests on GitHub for Triage PR comments", "permission to run shell commands for Ask for a merge" and "permission to work with pull requests on GitHub for Ask for a merge". Wright then told the owner "Triaging comments and asking for merges won't run yet" (session 180 output, seq 14).

**Where `Skill` came from.** In session 180 Wright first called `kernel_agent_list` (seq 2 to 4). Its answer included the turned-off member `studio-sandbox-dev`, whose settings `allowedTools` hold `Skill`. Approval 43's tool list, Bash prefixes and never list are identical, entry for entry and in the same order, to `~/.loomwright-studio/config/agents/studio-sandbox-dev.json`, and Wright named that member as "almost the same charter" (seq 14). That member got `Skill` from approval 32 (`kernel_agent_update` by Wright, 2026-11-12T16:33Z, before D44 was recorded); its creation charter (approval 29) had no `Skill`. Two other pre-D44 members (`ticket-runner-20c`, `wright-walk-22a-two`) carry it too. So the direct source is copying from an older member. Nothing in the kernel stops the copy:
- The readiness check counts a held `Skill` as covering a crew-launched command's need, not as a grant no charter should hold: `jobNeedsGaps` skips any need whose name the charter holds (`kernel/src/features/job-needs.ts:366-367`), and `permissionFindings` passes the charter's own `allowedTools` as `held` (`kernel/src/agents/charter-readiness.ts:437-440`). So approval 43's card did not list "run skills" at all.
- The pinned command table still marks both routes `launch: "crew"` with `Skill` among their needs (`job-needs.ts:158-175`), and the catalogue's `reaches` line tells Wright the crew session "runs it itself and it needs ... run skills ..." (`kernel/src/features/catalogue.ts:408-410`).
- The shipped role template tells the triage and merge sessions to run the Loomwright command themselves (`kernel/src/brain/templates.ts:126-129` and `:154-157`). Unverified as this session's source: the live data dir's `memory/wright/role.md` is an older copy (written once) that does not contain those lines.

**Is `Skill` still needed by anything?** Only by the kernel's own run policy: `AUTOMATE_RUN_POLICY` allows `Skill` (`kernel/src/automate/launch.ts:94`), and it is never in a charter (`launch.ts:26-28`). No crew job needs it once both routes are kernel-launched.

**Why the walk cannot complete today.** D44 left both routes open: "two crew paths still answer a Loomwright command for the crew session to run itself, and under this rule a crew session cannot run it (no `Skill`, no Loomwright shell prefix)" (`docs/DECISIONS.md:49`; `docs/architecture/automate.md:65-69`, and §"Known limits", `:131`). In code, `kernel_pr_route` answers `command: /loomwright:review-pr <url>` for `automate_fix` and `review_pr` (`kernel/src/automate/routing.ts:197`, `:215`, `:226-227`), and `kernel_automate_merge_check`'s `go` answers `invocation: /loomwright:automate --merge-parked <run_id>` (`kernel/src/automate/merge-check.ts:165-166`), whose description says "the exact invocation to run yourself" (`kernel/src/automate/runner.ts:217`). Neither queues anything. A crew policy without `Skill` refuses the call `tool_not_allowed` (`kernel/src/sessions/policy.ts:88-90`).

**The path to reuse.** `kernel_automate_prepare` enqueues one `message` event `{agent, automate_run: {...}}` (`runner.ts:184`). The brain's handler routes it to `handleAutomateRun`, which in one `automate-run` work step (`launch.ts:244-247`) checks playbook `live`, member `active`, the calling session and its model, the checkout and the run state, then calls `startSession` with `AUTOMATE_RUN_POLICY` plus the member's `never`, the calling session's model, playbook, version and task (`launch.ts:179-237`).

**The CI walks paper over it.** In `kernel/test/phase-8-exit.test.ts` the triage stand-in records the routed command as run "in THIS session" (`:825-826`), and the merge stand-in records the merge and writes the merged run file itself inside the crew session (`:885-888`). In `app/e2e/phase-8-exit.spec.ts` the triage session's `Skill` call is refused `tool_not_allowed` and the test asserts that refusal (`:658-661`, `:686`), while a stand-in "Loomwright's gate" merges on the `--merge-parked` invocation (`:748`, `:776`). Neither walk starts a kernel session for either command.

## Acceptance Criteria

**Happy path:**
- [ ] **AC1. Triage fix.** Given a live triage playbook whose crew member holds GitHub write and a workspace that is a clone of the repo, and a PR parked by a paused `/automate` run, when the crew session calls `kernel_pr_route` and the answer is `automate_fix`, then the kernel (not the crew session) starts one session with prompt `/loomwright:review-pr <pr url>`, cwd the member's checkout, `agent` the crew member, `playbook`, version and `task` the calling session's, `model` the calling session's (the playbook version's, never the member's settings model, invariant 1), and `permissionMode` the member's. The route's answer tells the session the kernel starts it, not to run it, and to end its turn. The PR URL is kernel-built from `repo` and `pr`; no comment or PR text is in the prompt or the event. This case fails on `main` `1a4a77b1` (no session starts).
- [ ] **AC2. Merge.** Given a live merge-when-ready playbook and a `go` from `kernel_automate_merge_check`, the kernel starts one session with prompt `/loomwright:automate --merge-parked <run_id>` (plus `--trust-unprotected` only where `loomwrightMergeFlags` returns it today), with the same attribution as AC1. A `wait` or `park` starts nothing. This case fails on `main` `1a4a77b1`.
- [ ] **AC3. Same launch path.** Both launches go through the ticket run's path (a kernel `message` event handled by the brain's loop and started through `EventContext.sessions`), never a spawned process and never a tool that starts a session itself. No new event kind. Whether it is a new payload key or a `kind` field inside `automate_run` is Launch Pad's call.
- [ ] **AC4. Fixed policy.** Each launched session runs a frozen kernel policy constant (one per command, or a shared one; Launch Pad's call) plus the member's own `never` list. It is never read from or written into a charter or settings file. The rail and the approval gate apply unchanged: a push is held or, under `never`, denied `agent_boundary`; `gh pr merge` is denied `merge_blocked` in every session (D40). The kernel never merges; the only merge is Loomwright's gate inside `--merge-parked` (invariant 4).
- [ ] **AC5. Wright drafts no Loomwright grant.** The command table marks `/loomwright:review-pr` and `/loomwright:automate --merge-parked` as kernel-launched, so no job's needs include `Skill`, `Agent`, `Bash` or a Loomwright shell prefix. The catalogue's `reaches` lines for them read as the ticket run's does ("the kernel starts it ... never draft one for it"). The role template's merge and triage sections say the kernel starts the command and the session never runs it. A charter Wright drafts from the four walk jobs holds no `Skill`, `Agent`, `Bash` or shell prefix (pinned by a test over `allowedToolsForJobs` and the drafting text).
- [ ] **AC6. Readiness card.** For a charter with Triage PR comments and Ask for a merge, the card shows no "no charter should grant it" line for those routes. It shows them as covered by Studio in plain words (for example "Studio runs the fix and the merge for this member"), never naming a kernel tool, a policy constant or a command's internals to the owner.
- [ ] **AC7. A charter that already holds `Skill`.** A drafted or updated charter that holds `Skill` (or a Loomwright shell prefix) gets a readiness line saying it holds a permission no crew member needs, in plain words. Whether the kernel also refuses such a draft before the hold is Launch Pad's call; it must never silently count `Skill` as covering a need.
- [ ] **AC8. CI walks use the kernel launch.** `kernel/test/phase-8-exit.test.ts` and `app/e2e/phase-8-exit.spec.ts` drop the crew-session stand-ins for both commands: the triage fix and both merges each appear as a kernel-started session (its prompt, agent, playbook and model asserted), whose stand-in driver then does the fake fix or the fake gate merge. The e2e assertion that the crew session's `Skill` is refused goes, and the crew policy still holds no `Skill`.

**Edge cases:**
- [ ] **AC9. Single drain.** Neither launch starts anything while Loomwright's run state reads `live` or is unreadable, or while a session this path started for the same member and checkout has not ended. For the fix this holds for `automate_fix`; an `automate_drain` route starts nothing (as today).
- [ ] **AC10. Idempotent.** One event starts at most one session; a redelivery returns the stored result. Two calls for the same PR while the first launched session is live start nothing the second time and store why.
- [ ] **AC11. Who may trigger.** A dry run, a draft-mode playbook, a non-playbook session (chat) and a member without GitHub write queue nothing and start nothing; the answer still carries the command for display, and says why nothing was started. A dry run records a would-do, never a launch.
- [ ] **AC12. Refusals store why.** Playbook not `live`, member not `active`, the calling session gone or without a model, no workspace, run state live or unreadable each start nothing and store the reason on the step, as `handleAutomateRun` does. Budget or cap refusal is rethrown so the loop parks the event.
- [ ] **AC13. Untrusted text.** Comment, PR and ticket text never reach the launched prompt or the event payload (invariant 3). A test feeds an injection-shaped comment and asserts the prompt is exactly the kernel-built one.
- [ ] **AC15. The run policies admit Loomwright's own drivers, by exact path only.** The ticket run's `AUTOMATE_RUN_POLICY` and the two new run policies each admit `bash <script>` (unquoted, or the path in double quotes with no other metacharacter) where `<script>` is an absolute path to a named Loomwright driver or helper script (at least `automate-next-step.sh`, `automate-helpers.sh`, `review-heal-next-step.sh`, and every script those drivers tell the session to run; Launch Pad lists them from the active install) under the **active** Loomwright install, resolved by the kernel at launch from the installed plugin, never from a charter, settings file, prompt or event payload. Arguments after the path are allowed as today's prefix rule allows them. Any other `bash` command, a path outside the active install's `scripts/` directory, a symlink or `..` escaping it, a renamed or unlisted script, and any shell metacharacter stay denied. Reproduced on `main` `1a4a77b1` (throwaway test, 2026-11-16, not committed): `decideToolUse(AUTOMATE_RUN_POLICY, "Bash", {command: "bash <install>/scripts/automate-next-step.sh --resume …"})` and `… automate-helpers.sh meta-entry` both answer `bash_prefix_not_allowed`, so today's ticket run stops at its first driver call. A committed version of that case must fail on `main` and pass after.
- [ ] **AC16. No install, no launch.** When the active Loomwright install cannot be resolved (not installed, unreadable, more than one candidate with no active marker), the kernel starts no run session and stores why on the step (fail closed); it never falls back to a broader prefix. Which install counts as active, and how a Loomwright update is picked up (at the next launch, never mid-session), is Launch Pad's call, documented in `docs/architecture/automate.md`.
- [ ] **AC14. D45 recorded.** `docs/DECISIONS.md` gains D45, worded as a proposal for the owner's approval (see Owner decisions), and `docs/architecture/automate.md` (§"The runner tools", §"The kernel-launched run (D44)", §"The merge check", §"Owner-aware routing", §"Known limits") and the exit runbook's walk steps 2, 4 and 5 describe the kernel launch. The "open, not built" notes for these two routes are removed. `bash scripts/check-docs.sh` passes.

## Non-goals

- Widening the Bash rail beyond AC15's exact driver paths, adding `bypassPermissions`, or admitting `bash` in general (D5, invariant 3). The metacharacter rule is unchanged.
- Any merge by the kernel, `--auto-merge` in any kernel-built prompt, or `--parallel`.
- Editing existing members' settings files (`studio-sandbox-dev`, `ticket-runner-20c`, `wright-walk-22a-two`); the owner removes `Skill` from them, or not.
- Rewriting the live data dir's `memory/wright/role.md` (the owner's file after first write).
- The `AskUserQuestion` answer path (p15, still unverified).
- Jira.

## Owner decisions

- 2026-11-16: fix it before the walk. The kernel launches `/loomwright:review-pr <pr url>` (the triage fix route) and `/loomwright:automate --merge-parked <run_id>` (the merge when ready) the way D44 launches the ticket run: a kernel-owned SDK session with a fixed run policy constant never read from or written into a charter, plus the member's own `never` list, attributed to the crew member and the calling playbook, version and task, idempotent, and starting nothing while Loomwright's run state reads live or unreadable. The merge stays Loomwright's `--auto-merge` / `--merge-parked` gate only; the kernel never merges and `gh pr merge` stays `merge_blocked`.
- 2026-11-16: Wright no longer drafts `Skill` or Loomwright shell prefixes into a crew charter, and the readiness card stops flagging a route the kernel launches, reading as covered in plain words.
- **Proposed D45, for the owner's approval (AC14):** "**The kernel also starts the triage fix and the merge when ready, as kernel-owned SDK sessions with a fixed run policy; this extends D44 to two more commands.** When a live playbook's crew session gets `automate_fix` from `kernel_pr_route`, or `go` from `kernel_automate_merge_check`, the kernel enqueues one kernel `message` event and, when the loop handles it, starts one session through the session manager, as D44's ticket run does: prompt `/loomwright:review-pr <pr url>` or `/loomwright:automate --merge-parked <run_id>` (plus `--trust-unprotected` only where the owner recorded it), cwd the crew member's checkout, attributed to the crew member and the calling playbook, version, task and model. Its policy is a frozen kernel constant, never read from or written into a charter, plus the crew member's own `never` list; the rail, the approval gate, Stop and Kill, the budget and the cap apply. Start-up is idempotent and starts nothing while Loomwright's run state reads live or unreadable (single drain, invariant 4). No crew charter carries `Skill` or a Loomwright shell prefix, and Wright drafts none. Each kernel run policy (the ticket run's included) admits `bash` only for named Loomwright driver and helper scripts by exact path under the active install, which the kernel resolves at launch and never reads from a charter; with no resolvable install it starts nothing. The merge is unchanged: the only merge is Loomwright's gate inside `--merge-parked`, the kernel never merges, and `gh pr merge` stays `merge_blocked` (D40). **Supersedes:** D43's 'Fixes and `/review-pr` run the same way, in the triage playbook's own session'; D44's 'for the ticket run only' limit on its two superseded D43 clauses ('the live playbook's own run session runs `/automate`' and 'no kernel tool or approval starts a session'), now also for these two commands; and D44's 'Open, not built' paragraph. **Does not supersede:** the rest of D44, D43 and D40, including `kernel_merge_approval_request` as a record only, safe mode's `awaiting_merge` park, Loomwright's gate as the only merge, and no `--parallel`." The worker adds it only as the owner approves it; if the owner changes the wording, the owner's wording wins.
- 2026-11-16 (answers open question 1): allow exact driver paths. Each kernel run policy, the ticket run's `AUTOMATE_RUN_POLICY` included, admits only `bash <active Loomwright install>/scripts/<named driver>.sh`, resolved at launch from the installed plugin and never from a charter; recorded in D45 and built here (AC15, AC16). The denial was reproduced first (AC15). This replaces D44's "file it rather than widen" rule for these named scripts only.
- 2026-11-16 (answers open question 2): keep both routes. `review_pr` launches the same way as `automate_fix`.
- **Open question 1, as first written (answered above):** both commands are driven almost entirely by Loomwright's driver scripts: `/automate --merge-parked` "calls `automate-next-step.sh --merge-parked ...`" (Loomwright 17.38.0 `skills/automate-loop/SKILL.md:40`), and `/review-pr --until-mergeable` calls `bash "${CLAUDE_PLUGIN_ROOT}/scripts/review-heal-next-step.sh"` (`commands/review-pr.md:48`). `AUTOMATE_RUN_POLICY` lists no helper script (`launch.ts:86-92`), and the rail denies an unlisted prefix `bash_prefix_not_allowed` and any `$` as `bash_shell_metacharacter` (`policy.ts:79-85`, `:55`). So a launched merge session is expected (read from code, **not reproduced**; no kernel-launched run has run live, the store holds no `automate-run` step) to be denied at its first driver call, and the walk's merges would then fail. D44's rule is to file that denial as a finding, not widen a policy (`automate.md:60-61`). Owner: keep that rule and treat the walk as the probe, or decide separately (a later D-entry) whether a kernel run policy may name the active install's driver scripts by exact path.
- **Open question 2, as first written (answered above):** the `review_pr` route (owner- or App-authored PR, no run holds it) answers the same command (`routing.ts:226-227`). This item launches it too, the same way, since it is the same command and the same gap (`automate.md:69`). The owner may narrow it to `automate_fix` only.

## Priority: MVP (phase 8 exit)

**Rationale:** walk steps 2, 4 and 5 need the triage fix and both merges, and today no crew session can run either command. Approval 43 shows Wright works around the gap by copying `Skill` from an older member, against D44 and invariant 3.

## Assumptions

- The triage fix runs only for a live playbook whose member holds GitHub write: the launched session pushes, and the down-scoped token is minted only for a live, write-granted session (D41). `kernel_pr_route` itself stays read-level.
- `/loomwright:review-pr` never merges (Loomwright 17.38.0 `agents/review-pr.md:122`), so the fix session needs no merge path.
- Which `review-pr` flags the kernel passes (for example `--until-mergeable`) is Launch Pad's call; the prompt is kernel-built and fixed.

## Dependencies

- Depends on: none. It consumes 20b's launch path, already on `main`.
- 22f (merged) is unaffected: the launched sessions get the member's tracker proxies the same way any session does.

## Risks

- AC15 fixes the denial reproduced at the first driver call, but a launched run may still be denied later (a driver asking for a command outside the run policy, or a metacharacter). The live walk is the first real run of any kernel-launched session; this item does not claim it works live.
- AC15 trusts the active install's scripts: a listed script can run whatever it runs. That is the trust the owner already gives Loomwright in a terminal; the bound is the exact path under the install and the list of names.
- `kernel_pr_route` and `kernel_automate_merge_check` stop being read-only in effect (they queue a launch). Their descriptions, the docs and the tests that call them read-only change on purpose and should say so.
- Existing members holding `Skill` keep it until the owner edits them; AC7 makes the card say so.
- `--merge-parked` inside a kernel SDK session in host mode is still untested (`automate.md:132`).

## Success Metrics

- AC1 to AC14 are pinned by tests and docs. At least one AC1 and one AC2 case fail on `main` `1a4a77b1`.
- In the exit walk, the triage fix and both merges appear as kernel-started sessions of the crew member, and the crew charter holds no `Skill`.

## Handoff

- `/automate --folder .supervisor/requirements/phase-8-22` (this item is `ready`; both open questions are answered and D45's wording includes the driver-path rule).

## Validation (must pass before merge)
1. **Static (kernel suite and docs):** `cd kernel && npm ci && npm test`, with new cases for AC1 to AC13. At least one AC1 case and one AC2 case must fail on `main` `1a4a77b1` before the change. `kernel/test/phase-8-exit.test.ts` and `app/e2e/phase-8-exit.spec.ts` assert the kernel-started sessions (AC8). Then `bash scripts/check-docs.sh`.
2. **Running system — the exit walk:** the live check is the exit walk itself (runbook walk steps 2, 4 and 5 on studio-sandbox). This item does not run it.

## Depends on
none

## Touches
kernel/src/automate/launch.ts
kernel/src/automate/routing.ts
kernel/src/automate/merge-check.ts
kernel/src/automate/runner.ts
kernel/src/brain/handler.ts
kernel/src/brain/templates.ts
kernel/src/features/job-needs.ts
kernel/src/features/catalogue.ts
kernel/src/agents/charter-readiness.ts
kernel/src/playbooks/fit.ts
kernel/test/phase-8-exit.test.ts
kernel/test/automate-launch.test.ts
kernel/test/automate-routing.test.ts
kernel/test/automate-merge-check.test.ts
kernel/test/brain.test.ts
app/e2e/phase-8-exit.spec.ts
docs/DECISIONS.md
docs/architecture/automate.md
docs/architecture/brain.md
docs/evidence/phase-8-exit-runbook.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-16T13:04:51Z
- **Brief:** .supervisor/jobs/done/2026-11-16-kernel-launches-triage-fix-and-merge.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/286
