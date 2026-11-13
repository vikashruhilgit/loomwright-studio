# Supervisor Job: The kernel launches a crew member's /automate run (D44), and the phase 8 exit checks walk the drafted-policy path

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-12-180247/L4
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-20/2026-11-12-170445-b-a-ticket-run-reaches-a-pr-with-the-charter-wright-drafted.md
- **Base commit:** cfb3d428d99db7dcd83ab2c77c5d972738ab7500

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest) and the app's Playwright e2e. No new dependency |
| 2 | Dependency Availability | GO | The session manager (`startSession`), the event queue (`enqueueEvent`) and the approval gate (`ALWAYS_HELD_TOOLS`) already exist |
| 3 | Architecture Fit | CAUTION | This reverses D43 (merged 2026-11-09: "no kernel tool or approval starts a session"). The owner chose a new D44 that supersedes it (LP-CLARIFY, 2026-11-13). The run starts from a kernel event through the session manager, the same path a playbook run takes, so invariant 2 holds |
| 4 | Scope vs Supervisor Capability | CAUTION | 21 modify + 3 create across kernel, app e2e and docs: split, `context-bound` |
| 5 | Hard Blockers | CAUTION | The kernel's Bash rail denies shell metacharacters (`bash_shell_metacharacter`, `kernel/src/sessions/policy.ts` `decideToolUse`), and real `/automate` runs many piped commands (probe p15: 125 Bash calls, none gated). The live run (Part A on the sandbox) may be denied mid-run. This item doesn't block on it: CI uses stand-ins. The owner decided to file live-run findings instead of widening a policy by hand |

**Overall Verdict:** CAUTION

## Task
**Goal:** Make the kernel itself start Loomwright's `/automate` run for a live ticket playbook's crew member, as a kernel-owned SDK session with a fixed run policy (D44, superseding D43). Both CI exit walks then build the crew member's policy from the jobs catalogue, and the live harness reports while it runs.

**Problem Statement:**
The owner needs a Wright-drafted crew member's live ticket playbook to reach a PR with nothing granted by hand, because the phase 8 exit walk cannot pass without it.
At present, the drafted "Hand tickets to /automate" job grants only kernel tools. The crew session is told to run `/automate` itself but has no `Skill` and no shell grant, so no ticket reached `/automate` in the 2026-11-12 exit live run. The CI walks hid this with a hand-written policy (`Read`, `Bash`, `Skill`, `gh pr` prefixes), and the live harness printed nothing for about 75 minutes because vitest buffers `console.log`.
Success: the crew session prepares the backlog, the kernel starts the `/automate` run session (attributed to the crew member and playbook, under the rail, the approval gate, Stop/Kill and the budget), and the CI walks fail when a catalogue grant is removed. The harness prints its summary path and each check change as they happen.

**Owner decisions taken in this Launch Pad (2026-11-13, LP-CLARIFY):**
- The decision is recorded as a **new D44 that supersedes D43's "the playbook's own run session runs `/automate`; no kernel tool or approval starts a session" clause**. D43's text stays unedited (the DECISIONS.md rule), and D42 stays reserved for the auth switch. The requirement's "D43" criterion is read as this D44 entry.
- The kernel starts the run as a **kernel-owned SDK session through the session manager**: a kernel event that `kernel_automate_prepare` enqueues, with a fixed run policy the kernel owns. It is **not** a spawned `claude -p` process.

## Acceptance Criteria

**Part 0: the decision on record**
- [ ] AC1. Given this PR, when the owner reads `docs/DECISIONS.md`, then a new row **D44** records the kernel-owned launch of `/automate` as the owner's choice (2026-11-12, confirmed 2026-11-13). It gives the reasoning (invariant 2: the kernel owns the run's start, stop, budget and attribution, and no crew charter carries `Skill` or Loomwright shell prefixes, invariant 3), names the rejected option (a): a scoped grant of `Skill` limited to named Loomwright skills plus exact helper and git/gh prefixes, and has a **Supersedes:** clause naming D43's "playbook's own run session runs `/automate`" and "no kernel tool or approval starts a session" clauses. D44 also names, as open and not yet built, the two crew paths that still answer a Loomwright command for the session to run itself: triage's `automate_fix` route (`/loomwright:review-pr <url>`) and `kernel_automate_merge_check`'s `go` (`/loomwright:automate --merge-parked <run_id>`). Under D44's rule a crew session cannot run them; they are follow-ups (20c or a later kernel launch). D43's row is unchanged, and `bash scripts/check-docs.sh` passes (no duplicated decision number).
- [ ] AC2. Given this PR, when the owner reads `docs/architecture/automate.md`, then a section describes the path end to end: who starts the run (the kernel, from the event `kernel_automate_prepare` enqueues), which permission policy applies (the kernel-fixed run policy plus the crew member's `never` list and GitHub write grant; the rail and the approval gate apply to every write), where its tokens and budget count (the crew member and the playbook), how Stop and Kill reach it (it is an ordinary kernel session of that playbook), and how a gate question reaches the owner (held in Approvals). Its "What exists today" bullets and the runner-tool text no longer say that no tool starts a session or that the session runs `/automate` itself. The section also lists the two open paths AC1 names (`automate_fix`'s `/loomwright:review-pr` and `--merge-parked`). `docs/architecture/brain.md`'s mirror of Wright's guidance (the "Tickets to pull requests" bullet and "they start no session") matches the new `templates.ts` text, and `docs/ARCHITECTURE.md`'s phase 8 automate summary links D44.

**Part A: the run**
- [ ] AC3. Given a live ticket playbook's crew session whose policy is drafted from the catalogue, when it calls `kernel_automate_prepare(repo, tickets)`, then the tool writes the items and `_BACKLOG.md` as today and enqueues one kernel event. Its answer tells the session that the kernel starts the run and that it must not run `/automate` itself. When that event is handled, the kernel starts one `/automate` run session through the session manager with prompt `/loomwright:automate --backlog <path> --inline-phases` (safe mode, no `--auto-merge`, no `--parallel`), cwd the crew member's checkout, `agent` = the crew member, `playbook`/`playbookVersion` = the calling session's playbook, and `task` = the calling session's task when it has one, and `model` = the calling session's model (its `sessions` row `model`, the playbook version's model: invariant 1, as `startCrewSession` passes `model: c.model`), never the crew member's settings model. Wright's guidance text (`kernel/src/brain/templates.ts`) no longer says the kernel tools start no session or that the session runs the invocation itself; it says prepare hands the backlog over and the kernel starts the run. The handler is idempotent on redelivery (one run session per event, via the loop's step store), and when Loomwright's run state reads `live` or unreadable it starts nothing and records why (single drain, invariant 4).
- [ ] AC4. Given that run, then the crew session's policy holds no `Skill` and no Loomwright helper, git-write or `gh` prefix. The run session's policy is the kernel-fixed run policy, a frozen constant in `kernel/src/automate/launch.ts`, never read from or written into a charter. Its `never` list and GitHub write come from the crew member's settings, so the rail's `merge_blocked`, the owner's boundaries and the approval gate still apply. The run session's events, token usage and budget are attributed to the crew member and its playbook (its `sessions` row's `agent` and `playbook`).
- [ ] AC5. Given the "Hand tickets to /automate" and "Triage PR comments" jobs in `TOOL_JOB_DEFINITIONS`, then the catalogue grants them only `mcp__kernel__` tools: no `Skill` and no Loomwright shell prefix. A test pins this.

**Part B: the CI walks use a drafted policy**
- [ ] AC6. Given `kernel/src/features/catalogue.ts`, then a new exported `allowedToolsForJobs(catalogue, jobs)` returns, in catalogue order, every `mcp__kernel__<tool>` of each named job, plus the tools of "Read a PR" when "Triage PR comments" is named (the rule `catalogueText` states). It is the one deterministic form of the instruction a charter is drafted from, and `kernel/test/tool-catalogue.test.ts` pins it.
- [ ] AC7. Given the kernel exit walk (`kernel/test/phase-8-exit.test.ts`), when a live ticket playbook fires on an issue, then the crew member's `tool_policy` is built with `allowedToolsForJobs` over the shipped catalogue (no hand-written `Read`/`Bash`/`Skill`/`gh` entries). The session prepares the backlog, the kernel starts the `/automate` stand-in run session, and that run opens a PR on the fake GitHub. The walk tells the run session apart by its prompt (`/loomwright:automate --backlog`), the way it tells the intake session apart by its ticket, because the run session runs on the ticket playbook's model, the same as the intake session.
- [ ] AC8. Given the app exit walk (`app/e2e/phase-8-exit.spec.ts` with its fixture `app/e2e/fixtures/phase-8-exit.ts`), then the crew charter's `tool_policy` comes from the same jobs-to-tools rule over the catalogue (no hand-written `Read`/`Skill`/`gh pr merge`), and the walk still passes.
- [ ] AC9. Given the exit walks, when a job's grant is removed from the catalogue (for example `kernel_automate_prepare`'s `job` moved off `automate_tickets`), then the kernel walk fails: the drafted policy no longer lists the tool and the prepare call is denied `tool_not_allowed`. A test in `kernel/test/phase-8-exit.test.ts` drafts from a catalogue with that grant removed and asserts the walk does not reach the run.

**Part C: the live harness reports as it runs**
- [ ] AC10. Given the runbook's harness command as written (`docs/evidence/phase-8-exit-runbook.md` §"Starting the harness", updated if the command changes), when it starts, then the summary path prints within seconds and each check change prints as it happens. The harness writes through a stream vitest does not buffer to test end (not `console.log`), and the summary file is rewritten on every check change.
- [ ] AC11. Given the harness stopped early (Ctrl-C / SIGINT), then its summary file holds the checks seen so far, with `result` showing it was interrupted.

**Edge cases**
- [ ] AC12. Given a gate question (`AskUserQuestion`) raised inside the run session, then it reaches the owner in Approvals. The run policy allows `AskUserQuestion`, and `AskUserQuestion` is added to `ALWAYS_HELD_TOOLS` (`kernel/src/sessions/policy.ts`), so the gate holds it as a pending approval whose payload carries the question's header, text and option labels. A kernel test drives this through the gate. The SDK path that returns the owner's chosen answer to the session is **unverified** (probe p15 did not exercise it). `docs/architecture/automate.md` records it as an open point, and nothing claims it works.

**Error scenarios**
- [ ] AC13. Given an outward write in the run session (for example `git push`), then it still passes the rail and the approval gate (held as `approval_required`, or `agent_boundary` under the crew member's `never`), and a `gh pr merge` in it is denied `merge_blocked` (D40). Kernel tests cover both on the run session.
- [ ] AC14. Given Stop or Kill on the run session (a session of the playbook), then the run stops through the session manager's normal path, and its token usage counts against the crew member and the playbook. A kernel test covers this.

**Validation (the requirement's, kept)**
- [ ] AC15. Given the Running system check, then a committed evidence file `docs/evidence/phase-8-20b-harness-reports.md` holds the fenced terminal output of starting the runbook's harness command, showing the summary path and at least one check-change line printed while it runs, with the column-0 line `Verdict: PASS for Validation 4`. The PR body links to it.

## Scope widening
- app/e2e/fixtures/phase-8-exit.ts
- docs/OPEN_QUESTIONS.md
- docs/architecture/brain.md
- kernel/src/brain/handler.ts
- kernel/src/brain/templates.ts
- kernel/src/sessions/policy.ts
- kernel/test/automate-launch.test.ts
- kernel/test/brain.test.ts
- kernel/test/feature-seams.test.ts
- kernel/test/sessions-policy.test.ts
- kernel/test/tool-catalogue.test.ts
- accepted: AUT-OVERLAP 2026-11-13

## Validation (must pass before merge)
1. **Static, docs check:** `bash scripts/check-docs.sh` (D44 and `automate.md`).
2. **Static, kernel suite:** `cd kernel && npm ci && npm run typecheck && npm test`.
3. **Static, app suite and exit e2e:** `cd app && npm run typecheck && npm test`, and `app/e2e/phase-8-exit.spec.ts` passing with the drafted policy.
4. **Running system, the harness reports live:** start the runbook's harness command and see the summary path and a check-change line printed while it runs. Record the output in `docs/evidence/phase-8-20b-harness-reports.md` with `Verdict: PASS for Validation 4`.

## Phase 3: File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| launch (kernel) | `kernel/src/automate/runner.ts` (249), `kernel/src/automate/index.ts` (70), `kernel/src/brain/handler.ts` (461), `kernel/src/brain/templates.ts` (196), `kernel/test/brain.test.ts` (1322 — only if a template-guidance assertion pins the changed wording; it extends the existing pin, the single home of the template tests), `kernel/test/phase-8-exit.test.ts` (901 — Subtask 1's minimal adaptation only: the stand-in run session told apart by its prompt, so the suite stays green; Subtask 3 then swaps the policy), `kernel/src/sessions/policy.ts` (1188 — one entry appended to `ALWAYS_HELD_TOOLS`, the single authority for the held set), `kernel/test/automate-runner.test.ts` (441), `kernel/test/sessions-policy.test.ts` (571 — one entry in the pinned held list, the list's own pin), `kernel/test/feature-seams.test.ts` (1150 — only if the module graph pin must name `launch.ts`; the single authority for the registry graph) | `kernel/src/automate/launch.ts`, `kernel/test/automate-launch.test.ts` | HIGH (runner, launch, policy), MEDIUM (brain dispatch, feature-seams) |
| catalogue + CI walks | `kernel/src/features/catalogue.ts` (419), `kernel/test/tool-catalogue.test.ts` (297), `kernel/test/phase-8-exit.test.ts` (901 — the walk's own crew policy; the drafted-policy builder it calls lives in `catalogue.ts`), `app/e2e/fixtures/phase-8-exit.ts` (572 — `crewCharter` is the one place the e2e crew policy is written), `app/e2e/phase-8-exit.spec.ts` (830 — only the steps that observe the kernel-started run) | — | HIGH |
| live harness | `kernel/test/phase-8-exit-live.test.ts` (1114 — the live reporter is its own `report`/`save` lines next to `writeSummary`, the harness's single summary writer), `docs/evidence/phase-8-exit-runbook.md` (188) | `docs/evidence/phase-8-20b-harness-reports.md` | HIGH |
| docs | `docs/DECISIONS.md` (48), `docs/architecture/automate.md` (122), `docs/architecture/brain.md` (353), `docs/ARCHITECTURE.md` (328), `docs/OPEN_QUESTIONS.md` (p15's AskUserQuestion entry: a one-line pointer to D44's open answer path) | — | HIGH |

**Module layout:** New responsibilities and their homes: (1) the run policy constant, the event payload shape and the run-start handler go in a CREATE, `kernel/src/automate/launch.ts`, which imports only types, the feature seam and this feature's files (the `feature-seams` rule): it gets the session manager through `EventContext.sessions`, never by import. (2) jobs → allowed tools goes in the existing shared module `kernel/src/features/catalogue.ts`, which owns `catalogueText`'s rule. (3) The held gate question is appended to `ALWAYS_HELD_TOOLS` in `policy.ts` (1188), the single authority. (4) The brain dispatch is one line in `brain/handler.ts`, the way it already routes `payload.playbook`. (5) The live harness's unbuffered reporter: in `phase-8-exit-live.test.ts` (1114), beside `writeSummary`, its single summary writer. No helper is copied by two or more siblings, so there is no extract row.

> **Validator-owned surfaces:** `scripts/check-docs.sh` scans every relative link in `docs/`, duplicated decision numbers in `docs/DECISIONS.md`, and CLAUDE.md's table paths. D44's link to `architecture/automate.md#…` and any new anchor must resolve.

### File Overlap Detection

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| launch | catalogue + CI walks | `kernel/test/phase-8-exit.test.ts` (sequential: Subtask 3 requires Subtask 1, so the share is legal) | YES (requires) |
| launch | docs | none; the docs name `launch.ts` symbols | YES (requires) |
| live harness | any | none | NO |

**Total estimated files:** 21 modify + 3 create (`phase-8-exit.test.ts` counted once)

## Touched-file invariants

> Grounded at base `cfb3d428d99db7dcd83ab2c77c5d972738ab7500`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/automate/runner.ts`** — keep: every runner tool refuses a non-live session through `liveSession` (`throw refuse("playbook_not_live"`), and prepare's checkout and item writing (`const checkout = checkoutOf(ctx, session.agent, args.repo);`). Keep: the invocation is safe mode with no `--auto-merge`, and ticket text never enters it. Keep: the module imports never the Agent SDK, the session manager or `kernel.ts` (`never the Agent SDK,`). Change only prepare's `note` text (`Run the invocation yourself in this session.`) and its description. Pinned by: `kernel/test/automate-runner.test.ts`, `kernel/test/automate-merge-check.test.ts` (scans `kernel/src/automate/` for merge endpoints, `gh` and process starts: `launch.ts` must start no process itself and only call `ctx.sessions.startSession`).
- **`kernel/src/automate/index.ts`** — keep: the merge order and the frozen part list (`export const AUTOMATE_PARTS: readonly AutomatePart[] = Object.freeze([runnerPart, trackerPart, routingPart]);`), and the rule that no part claims a handler kind (the brain owns `message`), so `launch.ts` is exported for the brain's route and is not a new part with a `message` handler. Update only the module comment's "no tool starts a session" wording.
- **`kernel/src/brain/templates.ts`** — change: the guidance lines `The kernel tools only write, read and check: they start no session,` and `answers the exact invocation to run yourself` to the D44 path. Keep: the rest of the section (`and the kernel never merges.`), and every tool name `kernel/test/brain.test.ts` pins (`for (const tool of ["kernel_automate_prepare", "kernel_automate_state", "kernel_automate_merge_check", "kernel_merge_approval_request"])`). Mirror: `docs/architecture/brain.md` (Subtask 4) carries the same text.
- **`kernel/test/automate-runner.test.ts`** — keep: the prepare tests' item and backlog assertions (`describe("AC2: kernel_automate_prepare"`) and the hostile-body test. Change: the answer's note and the new `run` field, and assert one run event enqueued per call.
- **`kernel/test/sessions-policy.test.ts`** — keep: the pinned held list's order (`"mcp__kernel__kernel_merge_approval_request",`). Change: append `"AskUserQuestion"`.
- **`kernel/test/feature-seams.test.ts`** — keep: the contributor order (`expect(SHIPPED_CONTRIBUTIONS.map((c) => c.name)).toEqual(["loomwright", "notifications",`). Change only if the registry module-graph pin must name `automate/launch.ts`.
- **`kernel/test/tool-catalogue.test.ts`** — keep: `describe("the catalogue covers every registered tool (AC1, AC6)"`. Add: the `allowedToolsForJobs` and AC5 no-`Skill` pins.
- **`app/e2e/phase-8-exit.spec.ts`** — keep: the walk's steps and fakes (`/** A ticket's session: hand it to /automate, which (stand-in) opens the PR and parks it awaiting the merge. */`). Change only the steps that observe the kernel-started run session.
- **`kernel/src/brain/handler.ts`** — keep: the playbook route stays first and unchanged (`if (ctx.event.payload.playbook !== undefined) return handlePlaybookMessage(`). Add the automate-run route as one sibling line before the plain-message path, keyed on its own payload field, so a plain message never matches it.
- **`kernel/src/sessions/policy.ts`** — keep: `ALWAYS_HELD_TOOLS` frozen (`export const ALWAYS_HELD_TOOLS: readonly string[] = Object.freeze([`), `decideToolUse`'s Bash rule unchanged (`bash_shell_metacharacter`): the run policy never widens the rail (invariant 3), and `bypassPermissions` is never set (D5, `forbidden_permission_mode` in `manager.ts`). Mirror: `kernel/src/tools/server.ts` checks `KERNEL_APPLIED_ACTIONS` ⊆ held (`is in KERNEL_APPLIED_ACTIONS but not in ALWAYS_HELD_TOOLS`); a non-kernel name in the held list must not break that check. Also fired by: `kernel/src/sessions/manager.ts`'s pre-hold check (`this.#heldToolCheck !== undefined && ALWAYS_HELD_TOOLS.includes(tool)`), whose `heldToolCheckOf` (`kernel/src/tools/server.ts`) answers `undefined` for a held name with no contributed `beforeHold` (`if (t?.beforeHold === undefined) return undefined;`), so `AskUserQuestion` is held as before. AC12's kernel test covers that path. Also `kernel/src/approvals/store.ts`'s always-refusal (`const held = ALWAYS_HELD_TOOLS.find((t) => t === tool);`) and the standing-grant skip (`!ALWAYS_HELD_TOOLS.includes(call.tool)`): no `always` grant ever covers a gate question. Pinned by: `kernel/test/sessions-policy.test.ts` (`"mcp__kernel__kernel_merge_approval_request",`).
- **`kernel/src/features/catalogue.ts`** — keep: `TOOL_JOB_DEFINITIONS` is the one place a job is declared (`the ONE place a job is`), and `catalogueText`'s rule (`also needs ${TOOL_JOBS.read_pr}, to read the comments.`). Reuse: `KERNEL_TOOL_PREFIX` and `catalogue.jobs`. Pinned by: `kernel/test/tool-catalogue.test.ts`.
- **`kernel/test/phase-8-exit.test.ts`** — keep: stand-in sessions told apart by model (`/** Each playbook's model: its stand-in session is told apart by it. */`), the injected clock, and the fake GitHub. Replace: the hand-written crew policy (`tool_policy: { allowedTools: ["Read", "Bash", ...MASON_TOOLS], allowedBashPrefixes: ["gh pr"], never: [] },`).
- **`app/e2e/fixtures/phase-8-exit.ts`** — replace: `tool_policy: { allowedTools: ["Read", "Skill", ...CREW_TOOLS], allowedBashPrefixes: ["gh pr merge"], never: ["git_push"] },` with a policy derived by the jobs-to-tools rule (keep `never: ["git_push"]`, an owner boundary, not a grant). The stand-in `/automate` run files (`RUN_FILES`) stay.
- **`kernel/test/phase-8-exit-live.test.ts`** — keep: the harness only reads the store and redacts the summary (`writeFileSync(path, \`${redact(JSON.stringify(summary, null, 2), home)}\n\`, { mode: 0o600 });`), the summary's keys, and its `STUDIO_LIVE=1` gate. Replace: the `console.log(\`phase-8-exit-live summary: ${summaryPath}` reporting with unbuffered writes, plus a `save()` on each check change and on SIGINT. Pinned by: its own `describe("phase 8 live: the summary"` tests.
- **`docs/DECISIONS.md`** — keep: never edit a settled row (`add a new entry that supersedes the old one rather than editing it`). D44 is appended after D43.

## Closed enumerations touched

> Sibling grep at base `cfb3d428`: `grep -rnF '"mcp__kernel__kernel_merge_approval_request"' --exclude-dir=node_modules --exclude-dir=.supervisor .` → 18 hits in 8 files.

- **`AskUserQuestion`** in the held set (sibling: `mcp__kernel__kernel_merge_approval_request`) — must be named in:
  - `kernel/src/sessions/policy.ts` — `ALWAYS_HELD_TOOLS` (`export const ALWAYS_HELD_TOOLS: readonly string[] = Object.freeze([`) — extend.
  - `kernel/test/sessions-policy.test.ts` — the pinned held list — extend.
  - `kernel/test/automate-runner.test.ts`, `kernel/test/phase-8-exit-live.test.ts`, `app/e2e/fixtures/approvals.ts`, `app/src/screens/**` tests, `docs/evidence/phase-8-item-09-merge-approval-shape.md` — no change: they name the merge-approval tool as one value, not as the closed held set.
- No new refusal, event kind or status value: the run is a `message` event with its own payload field (`EVENT_KINDS` stays `["wakeup", "message"]`). A skipped start is recorded on the event's step result, not as a new `AUTOMATE_REFUSALS` code.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/phase-8-exit.test.ts` — the walk reaches a PR with the drafted policy, and fails when a grant is removed (AC7, AC9) | In `kernel/src/automate/runner.ts`, change prepare's `job: "automate_tickets",` (the line right after `name: "kernel_automate_prepare",`; the file has two such `job:` lines, so the reviewer applies this one by hand) to `job: "general",` |
| `kernel/test/tool-catalogue.test.ts` — `allowedToolsForJobs` and the two jobs grant only `mcp__kernel__` tools, no `Skill` (AC5, AC6) | flip `${KERNEL_TOOL_PREFIX}${` → `${` in `kernel/src/features/catalogue.ts` (the prefixing line inside `allowedToolsForJobs`) |
| `kernel/test/automate-launch.test.ts` — one run session per event on redelivery (AC3) | delete `ctx.runStepAsync("automate-run"` in `kernel/src/automate/launch.ts` |
| `kernel/test/automate-launch.test.ts` — no start while the run state is live or unreadable (AC3) | delete `readRunState(` in `kernel/src/automate/launch.ts` |
| `kernel/test/automate-launch.test.ts` — the run session runs on the calling session's model (AC3) | flip `model: caller.model` → `model: settings.model` in `kernel/src/automate/launch.ts` |
| `kernel/test/automate-launch.test.ts` — the crew member's `never` reaches the run policy, so `git push` is `agent_boundary` and `gh pr merge` is `merge_blocked` (AC13) | delete `never:` in `kernel/src/automate/launch.ts` |
| `kernel/test/automate-launch.test.ts` — Stop/Kill of the run session and its usage attributed to agent and playbook (AC14) | delete `agent: ` in `kernel/src/automate/launch.ts` (the run-session start's agent line) |
| `kernel/test/automate-launch.test.ts` — a gate question is held with its payload (AC12) | delete `"AskUserQuestion",` in `kernel/src/sessions/policy.ts` |
| `kernel/test/phase-8-exit-live.test.ts` — the summary is saved on SIGINT with the checks so far (AC11) | delete `process.once("SIGINT"` in `kernel/test/phase-8-exit-live.test.ts` (the harness's own handler, not the pin's assertion) |
| `kernel/test/automate-launch.test.ts` — prepare starts one run session attributed to the crew member and playbook (AC3, AC4) | delete `playbook: ` in `kernel/src/automate/launch.ts` (the run-session start's playbook attribution line) |
| `kernel/test/automate-launch.test.ts` — the run session's policy is the fixed run policy; the crew policy holds no `Skill` (AC4, AC5) | flip `"Skill"` → `"Read"` in `kernel/src/automate/launch.ts` |
| `kernel/test/sessions-policy.test.ts` — `AskUserQuestion` is held (AC12) | delete `"AskUserQuestion",` in `kernel/src/sessions/policy.ts` |
| `kernel/test/tool-catalogue.test.ts` — `allowedToolsForJobs` adds Read a PR for triage (AC6) | delete `read_pr` in `kernel/src/features/catalogue.ts` (the line inside `allowedToolsForJobs` that adds the read_pr job) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | The kernel launches the /automate run session | AC3, AC4, AC5, AC12, AC13, AC14 | 10 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | The live harness reports as it runs | AC10, AC11, AC15 | 2 modify, 1 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 3 | The exit walks use a drafted policy | AC6, AC7, AC8, AC9 | 5 modify, 0 create | `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | BLOCKED (by #1) |
| 4 | D44 and the end-to-end path on record | AC1, AC2 | 5 modify, 0 create | — | BLOCKED (by #1) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/automate/launch.ts"}
  - {kind: "symbol", path: "kernel/src/automate/launch.ts", name: "AUTOMATE_RUN_POLICY"}
  - {kind: "symbol", path: "kernel/src/automate/launch.ts", name: "handleAutomateRun"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "AskUserQuestion"}
  - {kind: "file", path: "kernel/test/automate-launch.test.ts"}
requires: []
lanes:
  - "kernel/src/automate/launch.ts"
  - "kernel/src/automate/runner.ts"
  - "kernel/src/automate/index.ts"
  - "kernel/src/brain/handler.ts"
  - "kernel/src/brain/templates.ts"
  - "kernel/test/brain.test.ts"
  - "kernel/test/phase-8-exit.test.ts"
  - "kernel/src/sessions/policy.ts"
  - "kernel/test/automate-launch.test.ts"
  - "kernel/test/automate-runner.test.ts"
  - "kernel/test/sessions-policy.test.ts"
  - "kernel/test/feature-seams.test.ts"
external_requires:
  - "Agent SDK AskUserQuestion answer return through the kernel gate: unverified (probe p15 did not exercise it)"

# Subtask 2
provides:
  - {kind: "file", path: "docs/evidence/phase-8-20b-harness-reports.md"}
  - {kind: "symbol", path: "docs/evidence/phase-8-20b-harness-reports.md", name: "Verdict: PASS for Validation 4"}
requires: []
lanes:
  - "kernel/test/phase-8-exit-live.test.ts"
  - "docs/evidence/phase-8-exit-runbook.md"
  - "docs/evidence/phase-8-20b-harness-reports.md"
external_requires: []

# Subtask 3
provides:
  - {kind: "symbol", path: "kernel/src/features/catalogue.ts", name: "allowedToolsForJobs"}
  - {kind: "symbol", path: "kernel/test/phase-8-exit.test.ts", name: "allowedToolsForJobs"}
  - {kind: "symbol", path: "app/e2e/fixtures/phase-8-exit.ts", name: "crewCharter"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/automate/launch.ts", name: "handleAutomateRun"}
lanes:
  - "kernel/src/features/catalogue.ts"
  - "kernel/test/tool-catalogue.test.ts"
  - "kernel/test/phase-8-exit.test.ts"
  - "app/e2e/fixtures/phase-8-exit.ts"
  - "app/e2e/phase-8-exit.spec.ts"
external_requires: []

# Subtask 4
provides:
  - {kind: "symbol", path: "docs/DECISIONS.md", name: "D44"}
  - {kind: "symbol", path: "docs/architecture/automate.md", name: "AUTOMATE_RUN_POLICY"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/automate/launch.ts", name: "AUTOMATE_RUN_POLICY"}
lanes:
  - "docs/DECISIONS.md"
  - "docs/architecture/automate.md"
  - "docs/architecture/brain.md"
  - "docs/ARCHITECTURE.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires: []
```

**Subtask 1 design (the worker follows it):**
- `kernel_automate_prepare` keeps its writes, then enqueues one `message` event through `enqueueEvent` (`kernel/src/loop/queue.ts`, over `ctx.store`) with payload `{agent: <crew member>, automate_run: {repo, backlog, checkout, playbook, playbook_version, task, source_session}}`. Its answer gains `run: "started_by_kernel"`, and its note says the kernel starts the run and the session must not run `/automate`.
- `kernel/src/brain/handler.ts` routes `payload.automate_run !== undefined` to `handleAutomateRun(ctx)` in `launch.ts`, beside the `payload.playbook` route.
- `handleAutomateRun` runs in one `ctx.runStepAsync("automate-run", …)`. It re-reads the playbook (still `live`) and the agent (still `active`), reads `readRunState(checkout)` (start nothing when it is `live` or unreadable, and store why), then calls `ctx.sessions.startSession({agent, prompt: "/loomwright:automate --backlog <abs path> --inline-phases", model: caller.model (the calling session's `sessions` row model, the playbook version's model; never the crew member's settings model), permissionMode: <the crew member's>, cwd: <checkout>, policy: {...AUTOMATE_RUN_POLICY, never: <the crew member's never>}, playbook, playbookVersion, task})`. When the calling session's row `model` is null (`readonly model: string | null;` in `SessionRow`), it starts nothing and stores `model_unset` on the step result, the way `handlePlaybookMessage` stores a settings failure; `automate-launch.test.ts` pins this. An admission refusal is rethrown, so the loop parks the event, as `handlePlaybookMessage` does. Loomwright loading and the D41 file-backed token come from the session manager as for any live, write-granted playbook session; the worker confirms this by reading `manager.ts`, without editing it.
- `AUTOMATE_RUN_POLICY` is a frozen kernel constant: `allowedTools` holds what `/automate --inline-phases` needs (`Skill`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `Agent`, `AskUserQuestion`), and `allowedBashPrefixes` holds the Loomwright helper, `git` and `gh` prefixes it runs. It is never written to a charter or settings file. The rail, the never boundary, draft mode and the approval gate apply unchanged.
- **Hand-back:** Subtask 1 adapts `kernel/test/phase-8-exit.test.ts` only as far as its suite needs to stay green under the new prepare behaviour (the stand-in run session told apart by its `/loomwright:automate --backlog` prompt; the hand-written policy stays). It hands back with the whole kernel suite green. The other tests that only name `kernel_automate_prepare` in a tool list (`agents-charter-*.test.ts`, `playbooks-fit.test.ts`, `phase-8-foundation.test.ts`, `tools-sdk-list.test.ts`, `automate-tracker.test.ts`) pin no note or description and need no change. If one turns red, it is in this subtask's scope.

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 3
Subtask 1 ──→ Subtask 4
Subtask 2 (independent)
```

### File Overlap Matrix
Subtasks 1 and 3 share `kernel/test/phase-8-exit.test.ts`, ordered (3 requires 1). No LAUNCHABLE pair shares a lane.

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel: both have empty `requires`)
- **Batch 2:** Subtask 3, Subtask 4 (after Subtask 1)
- **Recommended workers:** 2
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md` |
| 3 | `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |
| 4 | — |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): reverses D43, a settled decision | MEDIUM | The owner chose D44 superseding D43 (LP-CLARIFY 2026-11-13). D43's text is untouched; D44 names exactly the clauses it supersedes |
| Feasibility (Phase 2.5): the kernel's Bash rail denies shell metacharacters, and real `/automate` runs piped commands, so the live run may be denied mid-run | HIGH | Never widen the rail or set `bypassPermissions` (invariant 3, D5). CI uses stand-ins. `automate.md` names this as the live run's known open point, and a live denial becomes a filed finding, as the owner decided |
| Two crew paths still answer a Loomwright command for the session to run itself: triage's `automate_fix` (`/loomwright:review-pr <url>`, `kernel/src/automate/routing.ts`) and merge check's `go` (`/loomwright:automate --merge-parked`). Under D44 a crew session cannot run them | MEDIUM | Out of this item's scope (no AC asks for it). D44 and `automate.md` name both as open follow-ups (20c or a later kernel launch), so nothing claims they work. The CI walk's triage and merge steps keep their stand-ins |
| Feasibility (Phase 2.5): 21 modify + 3 create, split `context-bound` | MEDIUM | Four subtasks with disjoint lanes; the walks and docs wait on the launch subtask |
| A kernel-started run escapes the kernel (requirement risk) | HIGH | The run is an ordinary session-manager session with `agent` and `playbook` set. AC13/AC14 tests prove the rail, Stop/Kill and attribution on it |
| A gate question stalls the run (requirement risk) | HIGH | AC12 holds `AskUserQuestion` in Approvals with the question shown. The answer's return path is unverified, recorded as open, and never claimed |
| Adding `AskUserQuestion` to `ALWAYS_HELD_TOOLS` holds it in every session that is allowed it, not only the run | MEDIUM | No charter today grants `AskUserQuestion`. `automate.md` and the policy comment state the scope |
| `launch.ts` imported by `brain/handler.ts` trips the feature-seams module-graph pin | MEDIUM | `launch.ts` imports only types, the seam and automate files. Update `feature-seams.test.ts` only if its pinned graph must name the new file |
| vitest may still buffer `process.stdout.write` from a worker thread | MEDIUM | Validation 4 runs the real command. If buffered, change the runbook's command (for example `--disableConsoleIntercept` or a single-thread pool) and record what worked in the evidence file |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-13-kernel-launches-automate-run.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-13T03:04:57Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/270
- **Branch:** feature/kernel-launches-automate-run
- **Files changed:** 28
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** The kernel starts a crew member's /automate run itself (D44): prepare enqueues a run event, handleAutomateRun starts one session-manager session under the frozen AUTOMATE_RUN_POLICY (narrowed git/gh subcommand prefixes), attributed to crew member and playbook, refused while a run session or Loomwright run is live. Exit walks draft the crew policy via allowedToolsForJobs; the live harness reports unbuffered and saves on SIGINT. Heal: 2 fix rounds (bare git/gh prefixes, single-drain race incl. symlinked workspace, helper copies, CI harness output race); round 3 PASS; required ci green on 77c88776; 4 LOW findings dismissed.

## Not verified
- **AskUserQuestion answer return** — the SDK path returning the owner's answer to the run session is not exercised (subtask 1)
- **Live /automate run** — not observed under the Bash rail and AUTOMATE_RUN_POLICY; `git pull --ff-only` is not in the prefix list and may be denied (subtask 1)
- **Concurrent run events** — residual window before a run session row commits; Loomwright's own lock is the backstop (subtask 1)
- **Interactive terminal** — harness run through a pipe, not a TTY (subtask 2)
- **Packaged app** — e2e ran against npm run build output, not a packaged build (subtask 3)
