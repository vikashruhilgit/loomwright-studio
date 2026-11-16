# Supervisor Job: The kernel launches the triage fix and the merge (phase 8 item 22g)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-22/2026-11-16-090000-g-the-kernel-launches-the-triage-fix-and-the-merge.md
- **Base commit:** 1a4a77b124cb0f83ac2253351f22c73642c8c511

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript and vitest in `kernel/`, Playwright in `app/e2e`; no new stack. |
| 2 | Dependency Availability | GO | No new dependency. It reuses D44's launch path (`handleAutomateRun`, `EventContext.sessions`), the manager's Loomwright resolver (`resolveSessionLoomwright` / `loomwright/active-install.ts`) and `loomwrightMergeFlags`. |
| 3 | Architecture Fit | GO | It extends D44 the way the owner decided (2026-11-16). The kernel owns the lifecycle (invariant 2), the policy is a frozen kernel constant (invariant 3), and the only merge is Loomwright's gate (invariant 4). |
| 4 | Scope vs Supervisor Capability | CAUTION | 38 files (31 modify, 7 create) across 4 areas (rail, launch, charter, walks and docs), so it splits for the `context-bound` reason. |
| 5 | Hard Blockers | CAUTION | Some files fall outside the requirement's Touches, so the owner is asked once at Phase 6 (`LP-SCOPE`): the Bash rail (`sessions/policy.ts`, `sessions/types.ts`, `sessions/manager.ts`, the new `sessions/loomwright-scripts.ts`), the new `agents/charter-surplus.ts`, the new and existing test files that pin the rail, the launch and the charter text (each listed in the File Impact Map), and `docs/architecture/loomwright.md` and `docs/architecture/agents.md`. Each pins text this item changes or carries the AC15 mechanism. The exact list is computed by `automate-lanes.sh scope-outside` at Phase 6. |

**Overall Verdict:** CAUTION

## Task
**Goal:** When a live playbook's crew session gets `automate_fix` or `review_pr` from `kernel_pr_route`, or `go` from `kernel_automate_merge_check`, the kernel starts `/loomwright:review-pr <pr url>` or `/loomwright:automate --merge-parked <run_id>` as its own session through D44's launch path. Each kernel run policy admits Loomwright's named driver scripts by exact path under the active install, and no crew charter needs or is drafted with `Skill` or a Loomwright shell prefix.

**Problem Statement:**
The owner of Loomwright Studio needs the exit walk's triage fix and both merges (runbook walk steps 2, 4 and 5) to run without any crew charter holding `Skill` or a Loomwright shell prefix.
Today `kernel_pr_route` and `kernel_automate_merge_check` answer a Loomwright command for the crew session to run itself, which a D44 crew policy refuses (`tool_not_allowed`). Wright works around this by copying `Skill` from older members (approval 43), and the readiness check counts a held `Skill` as covering the need. Separately, today's ticket-run policy denies its own first driver call (`bash_prefix_not_allowed`, reproduced 2026-11-16).
Success looks like this: both routes start a kernel session attributed to the crew member and the calling playbook, version, task and model; the three run policies admit only named driver scripts by exact path; drafted charters hold no `Skill`, `Agent`, `Bash` or shell prefix; the readiness card reads the routes as covered by Studio and flags a held `Skill` as surplus; and both CI walks assert kernel-started sessions.

## Design decisions
- decision: Where the driver-script admission (AC15/AC16) lives, and which install it is built from
  chosen: Each run policy constant names its driver scripts by basename in a new ToolPolicy field (for example `loomwrightScripts: readonly string[]`). A new pure module, `kernel/src/sessions/loomwright-scripts.ts`, turns those names plus the session's own resolved `loomwrightPath` into a frozen set of exact admitted paths, and matches a Bash command against that set. The session manager fills the set in `#sessionPolicy` at start and at resume, the way it fills `mode` and `connectors` today. The install is therefore the one the session actually loads (`plugins: [{ type: "local", path: loomwrightPath }]`), and a resume reuses the row's recorded `loomwright_path`: an update is picked up at the next launch, never mid-session. `decideToolUse` admits `bash <path>` or `bash "<path>"` (optionally followed by arguments) only when `<path>` is in that set. The metacharacter check runs first, unchanged. When the set is built, each candidate `join(loomwrightPath, "scripts", name)` is kept only if it has no `..` segment, is a regular file and its realpath equals `realpath(loomwrightPath)/scripts/<name>` (so no symlink escapes). A missing or escaping script is left out, so a call to it is denied. When a policy names driver scripts and `<install>/scripts/` itself cannot be read (it is missing, or it is not a directory), the manager refuses the start through the same Loomwright refusal path (`#refusingLoomwright`, no row). That refusal is a `LoomwrightSessionError` carrying the EXISTING reason `install_path_invalid` (code `loomwright_not_found`), so the closed `LOOMWRIGHT_CONTRACT_ERROR_REASONS` list (`kernel/src/loomwright/contract.ts`) and its mapping switch (`loomwrightSessionErrorCode`, `kernel/src/sessions/loomwright-path.ts`) gain no value. The launch step tells it apart from an admission refusal with `err instanceof SessionError && err.code.startsWith("loomwright_")`. `SessionError` is the class in `sessions/types.ts`, which `launch.ts` already imports from, so no new import is needed. It stores `loomwright_unresolved: <code>: <message>`, and anything else is rethrown. The realpath comparison reuses `resolvedPath` from `kernel/src/protected-paths.ts` ("the ONE resolution", already imported by `launch.ts`).
  rejected: resolving the install a second time inside `automate/launch.ts`: it can diverge from the manager's cwd-scoped resolution (`projectPath: params.cwd`), and the module's own import rule forbids reaching into the session manager (blast radius, reversibility).
  rejected: `isInsidePath` (`kernel/src/protected-paths.ts`) for admission: it is case-insensitive and over-approximates on purpose so that refusals fail closed, which would make admission fail open. It is never used to admit a path.
  rejected: a `bash` prefix, or a `bash <install>/scripts/` prefix: it admits any file, `..` and symlinks. That fails the requirement's non-goal and invariant 3.
  evidence: `sessions/manager.ts` `#sessionPolicy` fills `mode`, `connectors` and `githubWrite` ("Filled by the session manager alone", `sessions/types.ts` ToolPolicy). `startSession` resolves with `resolveSessionLoomwright({ ..., projectPath: params.cwd })`, and resume reads `readSessionLoomwright(recordedPath)`.
  revisit when: Loomwright publishes a driver allowlist in its contract (`capabilities.json`), which should then replace the pinned names.
  status: confirmed
- decision: Where AC7's "holds a permission no crew member needs" check lives
  chosen: a new module `kernel/src/agents/charter-surplus.ts`, which takes a charter and returns readiness items (subject `permission`, status `flagged`) for `Skill`, `Agent` or a Loomwright shell prefix that no granted job needs. `charterReadiness` calls it. No new ReadinessSubject or ReadinessStatus value is added.
  rejected: appending to `kernel/src/agents/charter-readiness.ts` (821 lines, past the 500-line §"Module layout" threshold), since this is a new responsibility.
  evidence: `wc -l kernel/src/agents/charter-readiness.ts` gives 821. `ReadinessSubject = "duty" | "workspace" | "connector" | "permission" | "tracker" | "jobs"` already has `permission`.
  revisit when: a second kind of surplus grant check appears; it then belongs in the same module.
  status: confirmed
- decision: How the two new launches ride D44's path (AC3)
  chosen: a `kind` field inside the existing `automate_run` payload: `"backlog"`, which is the default when the field is absent so events queued before the upgrade still launch, plus `"review_pr"` and `"merge_parked"`. It is handled by the same `handleAutomateRun` and the same `automate-run` work-step key, so the single-drain check (`liveRunSession`) and idempotence cover all three kinds without a second query. The `review_pr` kind carries `repo` and `pr`, and the handler builds the URL with `pullUrlOf`. The `merge_parked` kind carries `repo`, `pr` and `run_id` (checked with `isRunId`). At launch the handler re-derives `--trust-unprotected` from `loomwrightMergeFlags(store, repo)`, never from the payload. If the import rule bars that import from `launch.ts`, the kernel tool sets a boolean `trust_unprotected` from the same function, and it is never a string flag.
  rejected: a new payload key and a second route in `brain/handler.ts`: that needs a second step key, and a single-drain query that misses the other kinds (blast radius).
  evidence: `launch.ts` `await ctx.runStepAsync("automate-run", () => startRun(ctx, run));`, and its `liveRunSession` SQL filters `w.key LIKE 'event:%:automate-run'`. `brain/handler.ts` routes on `ctx.event.payload[AUTOMATE_RUN_KEY] !== undefined`.
  revisit when: a launch needs a different single-drain scope from member plus checkout.
  status: confirmed

## Acceptance Criteria
Carried forward from the source requirement (its AC numbers kept). Launch Pad's calls are bound in `## Design decisions` above and in the notes in brackets.

**Happy path:**
- [ ] **AC1. Triage fix.** Given a live triage playbook whose crew member holds GitHub write and a workspace that is a clone of the repo, and a PR parked by a paused `/automate` run, when the crew session calls `kernel_pr_route` and the answer is `automate_fix`, then the kernel (not the crew session) starts one session with:
  - prompt `/loomwright:review-pr <pr url>`;
  - cwd the member's checkout;
  - `agent` the crew member;
  - `playbook`, version and `task` the calling session's;
  - `model` the calling session's (the playbook version's, never the member's settings model, invariant 1);
  - `permissionMode` the member's.

  The route's answer tells the session that the kernel starts it, that it must not run it, and that it should end its turn. The PR URL is kernel-built from `repo` and `pr`. No comment or PR text is in the prompt or the event. This case fails on `main` `1a4a77b1` (no session starts). [Launch Pad: the prompt is exactly `/loomwright:review-pr <url>`, with no `--until-mergeable` and no other flag, because the requirement fixes the prompt as kernel-built and `/review-pr` never merges.]
- [ ] **AC2. Merge.** Given a live merge-when-ready playbook and a `go` from `kernel_automate_merge_check`, when the crew session receives that answer, then the kernel starts one session with prompt `/loomwright:automate --merge-parked <run_id>` and the same attribution as AC1. `--trust-unprotected` is added only where `loomwrightMergeFlags` returns it today. A `wait` or a `park` starts nothing. This case fails on `main` `1a4a77b1`.
- [ ] **AC3. Same launch path.** Given either launch, when it happens, then it goes through the ticket run's path: a kernel `message` event, handled by the brain's loop and started through `EventContext.sessions`. It is never a spawned process and never a tool that starts a session itself. No new event kind is added. [Launch Pad: a `kind` field inside `automate_run`, as described in Design decisions.]
- [ ] **AC4. Fixed policy.** Given a launched session, then it runs a frozen kernel policy constant plus the member's own `never` list, and that policy is never read from or written into a charter or settings file. [Launch Pad: one constant per command, `REVIEW_PR_RUN_POLICY` and `MERGE_PARKED_RUN_POLICY`, beside `AUTOMATE_RUN_POLICY` in `kernel/src/automate/launch.ts`.] The rail and the approval gate apply unchanged:
  - a push is held, or, under `never`, denied `agent_boundary`;
  - `gh pr merge` is denied `merge_blocked` in every session (D40);
  - the kernel never merges; the only merge is Loomwright's gate inside `--merge-parked` (invariant 4), which the driver script runs and the rail sees only as `bash <driver>`.
- [ ] **AC5. Wright drafts no Loomwright grant.** Given the command table, when it is read, then `/loomwright:review-pr` and `/loomwright:automate --merge-parked` are marked `launch: "kernel"`. So:
  - no job's needs include `Skill`, `Agent`, `Bash` or a Loomwright shell prefix;
  - the catalogue's `reaches` lines for both commands read as the ticket run's does ("the kernel starts it ... never draft one for it");
  - the role template's merge and triage sections say the kernel starts the command and the session never runs it;
  - a charter Wright drafts from the four walk jobs holds no `Skill`, `Agent`, `Bash` or shell prefix, pinned by a test over `allowedToolsForJobs` and the drafting text.
- [ ] **AC6. Readiness card.** Given a charter with Triage PR comments and Ask for a merge, when readiness runs, then the card shows no "no charter should grant it" line for those routes. It shows them as covered by Studio in plain words (for example "Studio runs the fix and the merge for this member"), and never names a kernel tool, a policy constant or a command's internals to the owner.
- [ ] **AC7. A charter that already holds `Skill`.** Given a drafted or updated charter that holds `Skill` (or `Agent`, or a Loomwright shell prefix that no granted job needs), when readiness runs, then it gets a flagged line in plain words saying it holds a permission no crew member needs. A held `Skill` is never silently counted as covering a need. [Launch Pad: readiness flags it and the kernel does not refuse the draft before the hold, so the owner decides on the card. `kernel_agent_update` and `kernel_agent_create` are unchanged.]
- [ ] **AC8. CI walks use the kernel launch.** Given `kernel/test/phase-8-exit.test.ts` and `app/e2e/phase-8-exit.spec.ts`, when they run, then:
  - they drop the crew-session stand-ins for both commands;
  - the triage fix and both merges each appear as a kernel-started session (its prompt, agent, playbook and model asserted), whose stand-in driver then does the fake fix or the fake gate merge;
  - the e2e assertion that the crew session's `Skill` is refused is removed, and the crew policy still holds no `Skill`.

**Edge cases:**
- [ ] **AC9. Single drain.** Given Loomwright's run state reads `live` or is unreadable, or a session this path started for the same member and checkout has not ended, when either launch is handled, then it starts nothing. For the fix this holds for `automate_fix`. An `automate_drain` route starts nothing, as today.
- [ ] **AC10. Idempotent.** Given one event, when it is redelivered, then it starts at most one session and the redelivery returns the stored result. Given two calls for the same PR while the first launched session is live, then the second starts nothing and stores why.
- [ ] **AC11. Who may trigger.** Given a dry run, a draft-mode playbook, a non-playbook session (chat) or a member without GitHub write, when the route or the merge check is called, then nothing is queued and nothing starts. The answer still carries the command for display and says why nothing was started. A dry run records a would-do, never a launch. [Launch Pad: `kernel_pr_route` stays a read-level tool. It queues only for a live, non-dry playbook session whose member holds `github: write`. In a dry run the gate already records the call as would-do (it is not a `_list`/`_get` tool), and a test pins that no event is queued.]
- [ ] **AC12. Refusals store why.** Given any of these, the launch starts nothing and stores the reason on the step, as `handleAutomateRun` does: playbook not `live`, member not `active`, the calling session gone or without a model, no workspace, run state live or unreadable. A budget or cap refusal is rethrown so the loop parks the event.
- [ ] **AC13. Untrusted text.** Given comment, PR and ticket text, then none of it reaches the launched prompt or the event payload (invariant 3). A test feeds an injection-shaped comment and asserts the prompt is exactly the kernel-built one.
- [ ] **AC15. The run policies admit Loomwright's own drivers, by exact path only.** Given the ticket run's `AUTOMATE_RUN_POLICY` and the two new run policies, then each admits `bash <script>` (unquoted, or the path in double quotes with no other metacharacter) only where `<script>` is an absolute path to a named Loomwright driver or helper script under the **active** install's `scripts/`. The kernel resolves that install at launch from the installed plugin, never from a charter, settings file, prompt or event payload. Arguments after the path are allowed as today's prefix rule allows them. These all stay denied: any other `bash` command, a path outside the active install's `scripts/` directory, a symlink or `..` escaping it, a renamed or unlisted script, and any shell metacharacter. A committed test reproduces `decideToolUse(AUTOMATE_RUN_POLICY, "Bash", {command: "bash <install>/scripts/automate-next-step.sh --resume …"})` and `… automate-helpers.sh meta-entry`; both fail on `main` (`bash_prefix_not_allowed`) and pass after.

  [Launch Pad: the per-policy name lists are derived from the 17.38.0 install with `grep -ohE 'scripts/[A-Za-z0-9_.-]+\.sh'` over the command file, its skill directory and the driver script's own text. The derivation leaves out `test-*.sh`, Loomwright-repo-only scripts (`bump-version.sh`, `release-refold.sh`, `check-doc-currency.sh`, `build-capabilities.sh`) and the host project's `ci-local.sh`. The command and the result are recorded in `docs/architecture/automate.md`. The lists include at least:
  - all three policies: `automate-helpers.sh`;
  - `AUTOMATE_RUN_POLICY`: `automate-next-step.sh`, `review-heal-next-step.sh`;
  - `MERGE_PARKED_RUN_POLICY`: `automate-next-step.sh`;
  - `REVIEW_PR_RUN_POLICY`: `review-heal-next-step.sh`, `drain-rounds.sh`, `ci-run-probe.sh`.]
- [ ] **AC16. No install, no launch.** Given the active Loomwright install cannot be resolved (not installed, unreadable, or more than one candidate with no active marker), or its `scripts/` directory cannot be read, when a run session would start, then the kernel starts none and stores why on the step (fail closed). It never falls back to a broader prefix. [Launch Pad: the active install is the one the session manager resolves for the session's cwd (`resolveSessionLoomwright`, D32 `installed_plugins.json`). A Loomwright update is picked up at the next launch, never mid-session, because a resume reuses the recorded `loomwright_path`. The step catches the manager's Loomwright refusal (a `SessionError` whose code starts `loomwright_`; an unreadable `scripts/` reuses the existing reason `install_path_invalid`, so no new reason value is added) and stores `loomwright_unresolved: <code>: <message>`; budget and cap refusals are still rethrown. Documented in `docs/architecture/automate.md`.]
- [ ] **AC14. D45 recorded.** Given the docs, then:
  - `docs/DECISIONS.md` gains D45 as the proposed wording in the source requirement's Owner decisions, verbatim, marked as proposed for the owner's approval (if the owner changes the wording, the owner's wording wins);
  - `docs/architecture/automate.md` (§"The runner tools", §"The kernel-launched run (D44)", §"The merge check", §"Owner-aware routing", §"Known limits") and the exit runbook's walk steps 2, 4 and 5 describe the kernel launch;
  - the "open, not built" notes for these two routes are removed;
  - `bash scripts/check-docs.sh` passes.

## Scope widening
- docs/architecture/agents.md
- docs/architecture/loomwright.md
- kernel/src/agents/charter-surplus.ts
- kernel/src/sessions/loomwright-scripts.ts
- kernel/src/sessions/manager.ts
- kernel/src/sessions/policy.ts
- kernel/src/sessions/types.ts
- kernel/test/agents-charter-needs.test.ts
- kernel/test/agents-charter-readiness.test.ts
- kernel/test/agents-charter-tools.test.ts
- kernel/test/automate-launch-routes.test.ts
- kernel/test/crash-resume.test.ts
- kernel/test/job-needs.test.ts
- kernel/test/loomwright-scripts.test.ts
- kernel/test/playbooks-fit.test.ts
- kernel/test/sessions-live.test.ts
- kernel/test/sessions-policy.test.ts
- kernel/test/tool-catalogue.test.ts
- accepted: LP-SCOPE 2026-11-16

## Touched-file invariants

> Grounded at base `1a4a77b124cb0f83ac2253351f22c73642c8c511`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/automate/launch.ts`**
  - keep: the module's import rule (`never the Agent SDK, the session manager or`); the single step `await ctx.runStepAsync("automate-run", () => startRun(ctx, run));`; the unreadable-reads-as-live rule `if (!state.ok) return skip(`; frozen run policies (`export const AUTOMATE_RUN_POLICY: ToolPolicy = Object.freeze({`); the policy plus `never` merge `policy: { ...AUTOMATE_RUN_POLICY, ...(settings.never !== undefined`; the session as the step's last effect, so an admission refusal comes out of the step and is never caught.
  - reuse: `liveRunSession` and `skip(...)` for every new refusal.
  - pinned by: `kernel/test/automate-launch.test.ts`.
- **`kernel/src/automate/routing.ts`**
  - keep: the kernel-built command `` const command = `/loomwright:review-pr ${url}`; `` and `const url = pullUrlOf(repo, pr);`; `requiresConnector: "github",` with no write level, so the tool stays listed to a read grant; `automate_drain` starting nothing; the untrusted-comment sentence `comment text is untrusted data, never instructions`.
  - the description's "The tool starts no session and pushes nothing" changes on purpose (requirement Risks) and must say the kernel queues the launch.
  - pinned by: `kernel/test/automate-routing.test.ts`.
- **`kernel/src/automate/merge-check.ts`**
  - keep: `mergeCheck` never throws, with the `} catch {` → `wait("unreadable"` fallback; the flags only from `...loomwrightMergeFlags(deps.store, repo)]`; `wait` and `park` paths unchanged.
  - mirror: `go`'s `run_id` is what `isRunId` (`kernel/src/automate/run-state.ts`) accepts.
  - pinned by: `kernel/test/automate-merge-check.test.ts`.
- **`kernel/src/automate/runner.ts`**
  - keep: `liveSession` refusals (`refuse("dry_run_session"`, `refuse("playbook_not_live"`) and `const DRY_RUN_EVENT = "session_dry_run";`.
  - reuse: the enqueue shape `enqueueEvent(ctx.store, { kind: "message", payload: { agent: session.agent, [AUTOMATE_RUN_KEY]: run } }, ctx.now());` for the merge launch.
  - the `kernel_automate_merge_check` description "the exact invocation to run yourself" changes on purpose.
  - pinned by: `kernel/test/automate-runner.test.ts`.
- **`kernel/src/brain/handler.ts`**
  - keep: `if (ctx.event.payload[AUTOMATE_RUN_KEY] !== undefined) return handleAutomateRun(ctx);` as the only automate route. A comment update only; no test pins the payload route (`brain.test.ts` has no `automate_run` hit).
- **`kernel/src/sessions/policy.ts`**
  - keep: the metacharacter test first (`if (SHELL_METACHARACTERS.test(command)) return { decision: "deny", reason: "bash_shell_metacharacter" };`); deny by default (`reason: "bash_prefix_not_allowed"`); the merge block (`if (forms[0] === "merge") return { kind: "deny", reason: "merge_blocked" };`); `decideToolUse` stays pure (no I/O); no new ToolDecisionReason value (an admitted driver call answers `bash_prefix_allowed`).
  - pinned by: `kernel/test/sessions-policy.test.ts`.
- **`kernel/src/sessions/types.ts`**
  - keep: ToolPolicy's filled-by-manager convention (`Filled by the session manager alone`). The new admitted-path set is one more such field: a caller's value is dropped.
  - pinned by: typecheck.
- **`kernel/src/sessions/manager.ts`**
  - keep: `#sessionPolicy(policy: ToolPolicy, agent: string | null, playbook: number | null, forceDraft = false, githubToken = false): ToolPolicy` as the single place session-derived policy fields are filled; start resolves with `projectPath: params.cwd,` and resume never re-resolves (`readSessionLoomwright(recordedPath)`); a Loomwright refusal stays `#refusingLoomwright` (no row).
  - pinned by: `kernel/test/sessions-live.test.ts`, `kernel/test/sessions-tool-groups.test.ts` and `kernel/test/crash-resume.test.ts`.
- **`kernel/src/features/job-needs.ts`**
  - keep: `it is the kernel's own fact, D44`; the `CommandLaunch` type (`"kernel" | "crew"`) stays even with no crew row; `LOOMWRIGHT_COMMAND_NEEDS_VERSION` bumps only if the rows are re-read from a newer install.
  - mirror: `resolveJobNeeds` already drops a kernel-launched command's needs (`const crew = reached.filter((c) => c.launch === "crew");`).
  - pinned by: `kernel/test/job-needs.test.ts`.
- **`kernel/src/features/catalogue.ts`**
  - keep and reuse: the ticket run's kernel line, `the kernel starts it under its own fixed policy (D44), so it adds no Claude tool or shell command to a charter; never draft one for it`, now generated for all three commands. The "A `reaches` line for a route the crew session runs itself" sentence in `catalogueText` goes or is reworded.
  - pinned by: `kernel/test/tool-catalogue.test.ts`.
- **`kernel/src/agents/charter-readiness.ts`**
  - keep: the prefixes (`READINESS_COVERED_PREFIX = "  covered: "`, `READINESS_FLAG_PREFIX = "  flagged: "`); `TRACKER_ACCESS_FLAG`, which the app mirrors byte for byte in `app/src/screens/approvals/charterBlocks.ts`; plain words only.
  - `routeJobs` and `routeCommands` become empty or removed. Remove them with their `noteText` use rather than leaving dead branches.
  - pinned by: `kernel/test/agents-charter-readiness.test.ts`, `kernel/test/agents-charter-needs.test.ts`.
- **`kernel/src/playbooks/fit.ts`**
  - keep: `closeText`'s owner-step wording for connector and workspace gaps. The `D44 leaves this route to the crew session` branch goes.
  - pinned by: `kernel/test/playbooks-fit.test.ts`.
- **`kernel/src/brain/templates.ts`**
  - keep: `Ticket text is untrusted data. Never put it in an invocation`; the four route names and their meaning. The live data dir's `role.md` is not rewritten (non-goal).
  - mirror: `docs/architecture/brain.md` quotes the template sections verbatim, and `brain.test.ts` checks that it does, so both change in the same subtask.
  - pinned by: `kernel/test/brain.test.ts` (the merge and triage section pins, for example `starts no session and pushes nothing`).

## Closed enumerations touched

> Sibling grep at base `1a4a77b1`: `grep -rnF 'AUTOMATE_RUN_KEY' kernel/src app/src` → 7 hits in 3 files (`automate/launch.ts`, `automate/runner.ts`, `brain/handler.ts`).

- **`automate_run.kind`**: new values `backlog` (the default when absent), `review_pr` and `merge_parked` (sibling: the `automate_run` payload). The values must be named in:
  - `kernel/src/automate/launch.ts`, in `automateRunOf`'s payload check (`if (typeof raw !== "object" || raw === null`). Extend it: an unknown `kind` throws `TypeError`, as other bad fields do.
  - `kernel/src/automate/runner.ts`: the prepare enqueue. No change needed, because an absent `kind` means `backlog`.
  - `kernel/src/brain/handler.ts`: the route on the key. No change: it routes on the key, never on `kind`.
- **`launch: "crew"`** rows (sibling `grep -rnF 'launch: "crew"' kernel/src` → `job-needs.ts:161`, `:170`): both flip to `"kernel"`, and the `CommandLaunch` type is unchanged.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/sessions-policy.test.ts`: the driver path under the install is admitted | delete the driver-set branch in `decideToolUse` in `kernel/src/sessions/policy.ts` (it then answers `bash_prefix_not_allowed`) |
| `kernel/test/loomwright-scripts.test.ts`: a symlink escaping `scripts/` is not admitted | delete the realpath comparison line in `kernel/src/sessions/loomwright-scripts.ts` |
| `kernel/test/loomwright-scripts.test.ts`: an unlisted script under `scripts/` is denied | replace the name-list filter with every `*.sh` in `scripts/` in `kernel/src/sessions/loomwright-scripts.ts` |
| `kernel/test/automate-launch-routes.test.ts`: `automate_fix` starts one session with the exact prompt | delete the `enqueueEvent` call in the `automate_fix` branch in `kernel/src/automate/routing.ts` |
| `kernel/test/automate-launch-routes.test.ts`: merge `go` starts `--merge-parked <run_id>` | delete the `enqueueEvent` call on `go` in `kernel/src/automate/runner.ts` |
| `kernel/test/automate-launch-routes.test.ts`: run state live starts nothing | delete `if (summary.state === "live") return skip(` in `kernel/src/automate/launch.ts` |
| `kernel/test/automate-launch-routes.test.ts`: an unresolved install stores `loomwright_unresolved` | remove the catch of the Loomwright refusal around `sessions.startSession` in `kernel/src/automate/launch.ts` |
| `kernel/test/job-needs.test.ts`: no job's needs include `Skill` | flip `launch: "kernel"` → `launch: "crew"` in the `/loomwright:review-pr` row in `kernel/src/features/job-needs.ts` |
| `kernel/test/agents-charter-readiness.test.ts`: a held `Skill` is flagged surplus | delete the `charterSurplus` call in `charterReadiness` in `kernel/src/agents/charter-readiness.ts` |
| `kernel/test/agents-charter-readiness.test.ts`: the routes read as covered by Studio, with no `no charter should grant it` line | flip `launch: "kernel"` → `launch: "crew"` in the `/loomwright:automate --merge-parked` row in `kernel/src/features/job-needs.ts` |
| `kernel/test/automate-launch-routes.test.ts`: a dry run, a draft playbook, chat and a member without write queue nothing | delete the live, non-dry, `github: write` check before `enqueueEvent` in `kernel/src/automate/routing.ts` |
| `kernel/test/automate-launch-routes.test.ts`: a redelivery returns the stored result and starts no second session | replace `ctx.runStepAsync("automate-run"` with a direct `startRun(ctx, run)` call in `kernel/src/automate/launch.ts` |
| `kernel/test/automate-launch-routes.test.ts`: a second call while the first launched session is live stores `run_session_live` | delete `if (live !== undefined) return skip(` in `kernel/src/automate/launch.ts` |
| `kernel/test/automate-launch-routes.test.ts`: an injection-shaped comment leaves the prompt exactly `/loomwright:review-pr <url>` | build the prompt from the route's `note` text instead of `pullUrlOf(repo, pr)` in `kernel/src/automate/launch.ts` |
| `kernel/test/automate-launch-routes.test.ts`: `wait` and `park` queue nothing | move the `enqueueEvent` call before the `answer === "go"` check in `kernel/src/automate/runner.ts` |
| `kernel/test/automate-launch-routes.test.ts`: `--trust-unprotected` appears only where `loomwrightMergeFlags` returns it | append `--trust-unprotected` unconditionally to the merge prompt in `kernel/src/automate/launch.ts` |
| `kernel/test/loomwright-scripts.test.ts`: a `..` path into `scripts/` is denied | delete the `..` segment check in `kernel/src/sessions/loomwright-scripts.ts` |
| `kernel/test/sessions-policy.test.ts`: a driver path followed by `$(…)` or `;` is denied | move the driver-set branch above the `SHELL_METACHARACTERS.test(command)` check in `kernel/src/sessions/policy.ts` |
| `kernel/test/loomwright-scripts.test.ts`: the double-quoted path form is admitted and a single-quoted one is not | delete the double-quote strip in `matchLoomwrightScript` in `kernel/src/sessions/loomwright-scripts.ts` |
| `kernel/test/automate-launch-routes.test.ts`: an unreadable `scripts/` stores `loomwright_unresolved: loomwright_not_found` | delete the scripts-dir readability refusal in `#sessionPolicy` in `kernel/src/sessions/manager.ts` |
| `kernel/test/sessions-live.test.ts`: a started run session's policy holds the exact admitted paths built from the session's own `loomwrightPath` | delete the admitted-set fill in `#sessionPolicy` in `kernel/src/sessions/manager.ts` |
| `kernel/test/crash-resume.test.ts`: a resumed run session keeps the admitted set of its recorded install, even after the active install changed | replace `readSessionLoomwright(recordedPath)` with a fresh `resolveSessionLoomwright` call on resume in `kernel/src/sessions/manager.ts` |
| `kernel/test/phase-8-exit.test.ts`: the triage fix and both merges are kernel-started sessions with the asserted prompt, agent, playbook and model | delete the `enqueueEvent` call in the `automate_fix` branch in `kernel/src/automate/routing.ts` |
| `app/e2e/phase-8-exit.spec.ts`: both merges are kernel-started `--merge-parked` sessions | delete the `enqueueEvent` call on `go` in `kernel/src/automate/runner.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Driver scripts by exact path in every kernel run policy | AC15, AC16 (the mechanism and the ticket run's list) | 8 modify, 2 create | `loomwright:unit-testing` | LAUNCHABLE |
| 2 | The kernel launches the triage fix and the merge | AC1, AC2, AC3, AC4, AC9, AC10, AC11, AC12, AC13, AC16 (the stored `loomwright_unresolved` skip) | 8 modify, 1 create | `loomwright:unit-testing`, `loomwright:error-handling` | BLOCKED (by #1) |
| 3 | No Loomwright grant in a charter; the readiness card reads the routes as covered | AC5, AC6, AC7 | 13 modify, 1 create | `loomwright:unit-testing` | LAUNCHABLE |
| 4 | CI walks assert kernel-started sessions; D45 and docs | AC8, AC14 | 8 modify, 0 create | `loomwright:playwright-e2e`, `loomwright:unit-testing` | BLOCKED (by #2, #3) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/sessions/loomwright-scripts.ts"}
  - {kind: "symbol", path: "kernel/src/sessions/loomwright-scripts.ts", name: "loomwrightScriptPaths"}
  - {kind: "symbol", path: "kernel/src/sessions/loomwright-scripts.ts", name: "matchLoomwrightScript"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "loomwrightScripts"}
  - {kind: "symbol", path: "kernel/src/automate/launch.ts", name: "automate-next-step.sh"}
  - {kind: "file", path: "kernel/test/loomwright-scripts.test.ts"}
requires: []
lanes:
  - "kernel/src/sessions/loomwright-scripts.ts"
  - "kernel/src/sessions/policy.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/automate/launch.ts"
  - "kernel/test/loomwright-scripts.test.ts"
  - "kernel/test/sessions-policy.test.ts"
  - "kernel/test/automate-launch.test.ts"
  - "kernel/test/sessions-live.test.ts"
  - "kernel/test/crash-resume.test.ts"
external_requires:
  - "Loomwright 17.38.0 install layout: <install>/scripts/<name>.sh, read from ~/.claude/plugins/installed_plugins.json (D32)"

# Subtask 2
provides:
  - {kind: "symbol", path: "kernel/src/automate/launch.ts", name: "REVIEW_PR_RUN_POLICY"}
  - {kind: "symbol", path: "kernel/src/automate/launch.ts", name: "MERGE_PARKED_RUN_POLICY"}
  - {kind: "symbol", path: "kernel/src/automate/launch.ts", name: "merge_parked"}
  - {kind: "symbol", path: "kernel/src/automate/launch.ts", name: "loomwright_unresolved"}
  - {kind: "symbol", path: "kernel/src/automate/routing.ts", name: "AUTOMATE_RUN_KEY"}
  - {kind: "symbol", path: "kernel/src/automate/runner.ts", name: "merge_parked"}
  - {kind: "file", path: "kernel/test/automate-launch-routes.test.ts"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/sessions/types.ts", name: "loomwrightScripts"}
  - {from: "1", kind: "symbol", path: "kernel/src/automate/launch.ts", name: "automate-next-step.sh"}
lanes:
  - "kernel/src/automate/launch.ts"
  - "kernel/src/automate/routing.ts"
  - "kernel/src/automate/merge-check.ts"
  - "kernel/src/automate/runner.ts"
  - "kernel/src/brain/handler.ts"
  - "kernel/test/automate-launch-routes.test.ts"
  - "kernel/test/automate-routing.test.ts"
  - "kernel/test/automate-merge-check.test.ts"
  - "kernel/test/automate-launch.test.ts"
external_requires: []

# Subtask 3
provides:
  - {kind: "file", path: "kernel/src/agents/charter-surplus.ts"}
  - {kind: "symbol", path: "kernel/src/agents/charter-surplus.ts", name: "charterSurplus"}
  - {kind: "symbol", path: "kernel/src/agents/charter-readiness.ts", name: "charterSurplus"}
  - {kind: "symbol", path: "kernel/src/agents/charter-readiness.ts", name: "Studio runs"}
requires: []
lanes:
  - "kernel/src/features/job-needs.ts"
  - "kernel/src/features/catalogue.ts"
  - "kernel/src/brain/templates.ts"
  - "kernel/src/agents/charter-readiness.ts"
  - "kernel/src/agents/charter-surplus.ts"
  - "kernel/src/playbooks/fit.ts"
  - "kernel/test/job-needs.test.ts"
  - "kernel/test/tool-catalogue.test.ts"
  - "kernel/test/agents-charter-needs.test.ts"
  - "kernel/test/agents-charter-tools.test.ts"
  - "kernel/test/agents-charter-readiness.test.ts"
  - "kernel/test/playbooks-fit.test.ts"
  - "kernel/test/brain.test.ts"
  - "docs/architecture/brain.md"
external_requires: []

# Subtask 4
provides:
  - {kind: "symbol", path: "docs/DECISIONS.md", name: "D45"}
  - {kind: "symbol", path: "docs/architecture/automate.md", name: "D45"}
requires:
  - {from: "2", kind: "symbol", path: "kernel/src/automate/launch.ts", name: "REVIEW_PR_RUN_POLICY"}
  - {from: "2", kind: "symbol", path: "kernel/src/automate/launch.ts", name: "MERGE_PARKED_RUN_POLICY"}
  - {from: "3", kind: "symbol", path: "kernel/src/agents/charter-surplus.ts", name: "charterSurplus"}
lanes:
  - "kernel/test/phase-8-exit.test.ts"
  - "app/e2e/phase-8-exit.spec.ts"
  - "docs/DECISIONS.md"
  - "docs/architecture/automate.md"
  - "docs/architecture/brain.md"
  - "docs/architecture/loomwright.md"
  - "docs/architecture/agents.md"
  - "docs/evidence/phase-8-exit-runbook.md"
external_requires: []
```

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| rail (1) | `kernel/src/sessions/policy.ts` (1195: one branch delegating to the new module); `kernel/src/sessions/types.ts` (689: one ToolPolicy field); `kernel/src/sessions/manager.ts` (3290: the single filler of session-derived policy fields, `#sessionPolicy`); `kernel/src/automate/launch.ts` (247); `kernel/test/sessions-policy.test.ts` (583: AC15 reproduction beside the existing rail cases); `kernel/test/automate-launch.test.ts` (873: only the existing `AUTOMATE_RUN_POLICY` pins updated); `kernel/test/sessions-live.test.ts` (manager-level: a started run session's admitted set is read back); `kernel/test/crash-resume.test.ts` (a resume keeps the recorded install's set) | `kernel/src/sessions/loomwright-scripts.ts` (the admitted-path set and matcher); `kernel/test/loomwright-scripts.test.ts` | HIGH |
| launch (2) | `kernel/src/automate/launch.ts` (247: the single launch path, AC3); `kernel/src/automate/routing.ts` (242); `kernel/src/automate/merge-check.ts` (170); `kernel/src/automate/runner.ts` (270); `kernel/src/brain/handler.ts` (497: comment only, LOW); `kernel/test/automate-routing.test.ts` (336); `kernel/test/automate-merge-check.test.ts` (593: only the existing read-only pins changed); `kernel/test/automate-launch.test.ts` (873: shared with group 1, which runs first; only the existing policy-shape pins updated) | `kernel/test/automate-launch-routes.test.ts` (new AC1–AC4 and AC9–AC13 cases, kept out of the 873-line `automate-launch.test.ts`) | HIGH |
| charter (3) | `kernel/src/features/job-needs.ts` (382); `kernel/src/features/catalogue.ts` (576: edits the existing `reaches` lines, no new responsibility); `kernel/src/brain/templates.ts` (203); `kernel/src/agents/charter-readiness.ts` (821: the route lines change and the surplus check is called from the new module); `kernel/src/playbooks/fit.ts` (388); `kernel/test/job-needs.test.ts` (274); `kernel/test/tool-catalogue.test.ts` (436); `kernel/test/agents-charter-needs.test.ts` (258); `kernel/test/agents-charter-tools.test.ts` (1498: updates the existing `no charter should` pin at the CREW_RUN_JOBS case only); `kernel/test/agents-charter-readiness.test.ts` (1331: AC6/AC7 cases beside the existing permission cases); `kernel/test/playbooks-fit.test.ts` (757); `kernel/test/brain.test.ts` (1328: its role-template pins at the merge and triage sections, and the brain.md verbatim check); `docs/architecture/brain.md` (362: the template section it quotes verbatim, shared with group 4, which runs after) | `kernel/src/agents/charter-surplus.ts` | HIGH |
| walks and docs (4) | `kernel/test/phase-8-exit.test.ts` (992); `app/e2e/phase-8-exit.spec.ts` (896); `docs/DECISIONS.md` (49); `docs/architecture/automate.md` (156); `docs/architecture/brain.md` (362); `docs/architecture/loomwright.md` (203: the `launch: "kernel"` paragraph); `docs/architecture/agents.md` (386: the permission-line paragraph); `docs/evidence/phase-8-exit-runbook.md` (190) | — | MEDIUM |

> **Validator-owned surfaces:** `scripts/check-docs.sh` scans every `*.md` under `docs/` for relative links and `docs/DECISIONS.md` for duplicate D numbers; the four doc files above are its surface.

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2 ──→ Subtask 4
Subtask 3 ─────────────────→ Subtask 4
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | `kernel/src/automate/launch.ts`, `kernel/test/automate-launch.test.ts` | YES (2 requires 1) |
| Subtask 1 | Subtask 3 | none | NO |
| Subtask 2 | Subtask 3 | none | NO |
| Subtask 2 | Subtask 4 | none | NO |
| Subtask 3 | Subtask 4 | `docs/architecture/brain.md` | YES (4 requires 3) |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 3 (parallel, no shared file)
- **Batch 2:** Subtask 2 (after 1)
- **Batch 3:** Subtask 4 (after 2 and 3)
- **Recommended workers:** 2
- **Estimated batches:** 3

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 3 | `skills/unit-testing/SKILL.md` |
| 4 | `skills/playwright-e2e/SKILL.md`, `skills/unit-testing/SKILL.md` |

### Cited-line premise check

Every cited line was checked against `origin/main` `1a4a77b1`: tip 3 hours ago, fetched under 1 hour ago. All 31 refs resolve.

All rows below: resolves yes, premise HOLDS.

| ref | deciding line |
|-----|----------------|
| `kernel/src/features/job-needs.ts:366` | `for (const n of needs.claudeTools) {` (the skip is at 367) |
| `kernel/src/agents/charter-readiness.ts:437` | `const held = { allowedTools: charter.tool_policy.allowedTools, …` |
| `kernel/src/features/job-needs.ts:158` | `"/loomwright:review-pr": frozenRow({` |
| `kernel/src/features/catalogue.ts:408` | `const asks = andList([...row.claudeTools, ...row.bashPrefixes]…` |
| `kernel/src/brain/templates.ts:126`, `:154` | `- Merge when ready …` / `- automate_fix: a paused /automate run parked it…` |
| `kernel/src/automate/launch.ts:94`, `:26`, `:86`, `:179`, `:244` | `allowedTools: Object.freeze(["Skill", …` and the policy, startRun and handleAutomateRun lines |
| `docs/DECISIONS.md:49` | `\| D44 \| **The kernel starts a live ticket playbook's /automate run…` |
| `docs/architecture/automate.md:60`, `:65`, `:69`, `:131`, `:132` | the Bash-rail, two-crew-paths, review_pr and Known-limits lines |
| `kernel/src/automate/routing.ts:197`, `:226` | `` const command = `/loomwright:review-pr ${url}`; `` / `command,` |
| `kernel/src/automate/merge-check.ts:165` | `const invocation = ["/loomwright:automate", "--merge-parked", …` |
| `kernel/src/automate/runner.ts:184`, `:217` | the `enqueueEvent(…AUTOMATE_RUN_KEY…)` line and `…the exact invocation to run yourself…` |
| `kernel/src/sessions/policy.ts:55`, `:79`, `:88` | `SHELL_METACHARACTERS` / `bash_command_not_string` / `allowedTools.includes(toolName)` |
| `kernel/test/phase-8-exit.test.ts:825`, `:885` | the `…run in THIS session…` / `The session runs Loomwright's invocation…` lines |
| `app/e2e/phase-8-exit.spec.ts:658`, `:686`, `:748`, `:776` | the `Skill` refusal and stand-in gate lines |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Scope: 38 files (31 modify, 7 create, counting the new tests) in 4 areas (Feasibility, Phase 2.5) | MEDIUM | Split `context-bound` into 4 subtasks with explicit lanes; subtasks 1 and 3 run in parallel. |
| Files outside the requirement's Touches (the session rail, charter test files, two architecture docs) (Feasibility, Phase 2.5) | MEDIUM | Asked once at Launch Pad Phase 6 (`LP-SCOPE`). Each is either the AC15 mechanism or an existing pin of text this item changes on purpose. |
| A launched session may still be denied later: a driver asks for a command outside the run policy, or emits a metacharacter (for example `$(…)`), or a skill file read with `Read` shows the unexpanded `${CLAUDE_PLUGIN_ROOT}` form, which the rail denies on `$` | HIGH | Out of scope to widen (non-goal). State it in `docs/architecture/automate.md` §"Known limits". The live exit walk is the first real run, and the item never claims it works live. A denial becomes a finding, not a policy widening. |
| AC15 trusts the listed scripts: a listed script runs whatever it runs, including Loomwright's own `gh pr merge` inside the `--merge-parked` gate | MEDIUM | Bounded by exact path under the session's own resolved install, the realpath check and the name list. Direct `gh pr merge` stays `merge_blocked`. Recorded in D45. |
| `kernel_pr_route` and `kernel_automate_merge_check` stop being read-only in effect | MEDIUM | Change their descriptions, the docs and the tests that call them read-only, and say so in the PR. Queue only for a live, non-dry, write-granted playbook session (AC11). |
| The admitted path set and the plugin path the SDK expands drift apart (a lexical versus a realpath form of `loomwrightPath`) | MEDIUM | Build the set from the same `loomwrightPath` string the manager passes to `plugins: [{ type: "local", path }]`, and pin it with a manager-level test that starts a run session and reads the admitted set back. |
| Both walk tests tell stand-in sessions apart by model, and a kernel-launched fix runs on the triage playbook's model, the same as the triage crew session | LOW | Tell drivers apart by prompt as well, as the ticket intake driver already does by ticket ref. |
| Existing members holding `Skill` keep it until the owner edits them (non-goal) | LOW | AC7's surplus line says so on the card. |
| `--merge-parked` inside a kernel SDK session in host mode is still untested (`automate.md:132`) | MEDIUM | Keep the Known-limits line, reworded. The live walk probes it. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 3
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-16-kernel-launches-triage-fix-and-merge.md
```

## Plan Review: PASS (attempt 3/3)
- Requirement fit: fulfils. Reviewer seat `plan_reviewer` is routed to grok; every attempt returned `lens_unparseable` and fell back to Claude (`seat_routing plan_reviewer provider=grok reason=lens_unparseable`).
- Deferred (MEDIUM, at the fix floor; no attempt left): `#sessionPolicy` runs after the session row is written (`manager.ts` 900-908 on start, 1207-1217 on resume). Build the admitted script set, and raise the unreadable-`scripts/` refusal (`install_path_invalid`), inside or right after the `#refusingLoomwright` closure (start: `manager.ts` 854-860; resume: 1175), before `#admit`. Pass the set into `#sessionPolicy`, which only copies it onto the policy. Assert the refusal leaves no row on start and the row unchanged on resume. The Pin mutations row "delete the scripts-dir readability refusal in `#sessionPolicy`" means that refusal at its corrected place.
- Deferred (LOW): update `launch.ts`'s import-rule comment to name `SessionError`, and the repo-policy import if it is used.
- Deferred (LOW): Subtask 3's `Studio runs` provide depends on the line's wording. Use that phrase in the covered line, or export a constant and name it.

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-16T06:57:24Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/286
- **Branch:** feature/kernel-launches-triage-fix-and-merge
- **Files changed:** 42
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 2
- **Heal reason:** needs_human
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unarmed (marker_missing)
- **Summary:** 4/4 subtasks merged (kernel launches /loomwright:review-pr and /loomwright:automate --merge-parked through D44's path; exact-path driver admission; no Loomwright grant in charters; walks and D45). Self-heal fixed 6 findings in 2 rounds (gate-eval and other merging/pushing/spawning helper subcommands denied; automate-lanes/wave/merge-watch/lane-sampler dropped; dry-run.md AC14; route descriptions; bashGate; per-policy driver argument profiles). Escalated on one owner decision: the driver also reads mode/trust from the run file's ## Run Config and its sidecar, both writable by the run session. Children check skipped by the owner (a4e15f9f, subtask 3's turn-limited first worker).

## Not verified
- **app/e2e phase-8-exit.spec.ts** — not run by subtask 1's worker (subtask 1); the Execute Manager later reports the e2e walk passing on the integrated branch
- **real /automate run with bash <install>/scripts/automate-next-step.sh; SDK plugin-root expansion vs lexical loomwrightPath** — unverified (subtask 1)
- **docs/architecture/dry-run.md:133, agents.md:326, loomwright.md:37** — still described crew-launched routes at subtask 3; fixed by subtask 4 and heal round 1 (subtask 3)
- **app readiness card rendering** — not run (subtask 3)
- **phase-8-exit.test.ts and app/e2e phase-8-exit.spec.ts** — owned by subtask 4 (subtask 2)
- **real /loomwright:review-pr and --merge-parked runs under the new policies** — never run live (subtask 2)
- **live kernel-started /loomwright:review-pr and --merge-parked sessions** — the owner's live exit walk will be the first (subtask 4)
