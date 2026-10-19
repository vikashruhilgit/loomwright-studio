# Supervisor Job: Phase 4 exit check — prove "a comment-only reviewer created from chat can't push" deterministically (CI), and ship the live harness and owner runbook

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (one app-made worktree under `.claude/worktrees/`, unrelated)
- **Source requirement:** .supervisor/requirements/phase-4/2026-10-18-041109-phase-4-exit-check.md
- **Base commit:** 2c0dfff3631c6a8963eb44e8853236e3bf26c20b

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel, vitest; same stack and shape as the phase 2 and phase 3 exit tests |
| 2 | Dependency Availability | GO | No new dependency; the test shells out to `git` (present on `ubuntu-latest` CI and the owner's Mac) through `node:child_process` |
| 3 | Architecture Fit | GO | Every mechanism the 10 scope steps walk is already merged (items 01–08, PRs #83–#91): `kernel_agent_create` held and kernel-applied, `agent_boundary`, `kernel_agent_message` + `delegation_depth`, `agent_sessions_at_once`, `agent_daily_limit`, crew playbooks, `studio agents off`, `studio ask --agent --workspace` |
| 4 | Scope vs Supervisor Capability | CAUTION | ~1,800 new lines across two independent groups (a ~700-line deterministic test, a ~900-line live harness + runbook + two doc edits) — context-bound split |
| 5 | Hard Blockers | GO | None. CAUTION: no kernel-level test yet runs `studio ask --agent mason --workspace <repo>` end to end (only handler-level and scripted-client tests do), and no kernel test uses a real git repo with a bare remote — this test is the first; a gap it finds is a finding, not a fix folded in (requirement Non-goals) |

**Overall Verdict:** CAUTION (proceed)

## Task
**Goal:** Add phase 4's deterministic exit test, its opt-in live harness and owner runbook, and the doc edits that record what phase 4 shipped — without marking phase 4 done.

**Problem Statement:**
The owner needs phase 4's exit criterion ("a specialist created from chat can do only what its policy allows. Tested: a comment-only reviewer can't push") proven in CI and runnable live on his Mac.
Items 01–08 build the parts, but nothing proves the whole: a sentence → a charter → the owner's approval → a registered reviewer → the reviewer's own session → a denied push (bare remote unchanged) and an allowed-but-held comment.
Success looks like: `kernel/test/phase-4-exit.test.ts` drives every Scope 1 step green in CI; the live harness is skipped without `STUDIO_LIVE=1`; the runbook lets the owner (or an agent under D33) run the live check.

**Precedent:** phase 3's exit PR #76 (`.supervisor/jobs/done/2026-10-17-phase-3-exit-check.md`). `docs/ROADMAP.md`'s ✓ and the live evidence file `docs/evidence/phase-4-exit-live-<date>.json` are NOT in this PR — they land together in the owner's live-run commit after a passing live run (requirement AC 4; D33).

## Acceptance Criteria
- [ ] AC1 — Given `kernel/test/phase-4-exit.test.ts` (a real kernel from `startKernel` with `SHIPPED_CONTRIBUTIONS`, stand-in sessions via `fakeSessions`, one injected clock, a stub notifier, no model, and a temporary git repo with one unpushed commit and a local bare remote, all under one `mkdtempSync(join(tmpdir(), "studio-phase4-exit-"))`), when the suite runs, then ONE test drives in order, each step asserted from the store, the files or the repo (never only from reply text):
  1. `studio ask "<plain-English request for a comment-only reviewer of <repo> that never pushes>"` reaches Wright, and the stand-in Wright calls `mcp__kernel__kernel_agent_create` with a charter for id `mason`: `never` covering `git_push` and every PR/issue write category except `gh_pr_comment` (take the names from `NEVER_CATEGORIES`, `kernel/src/sessions/policy.ts`), Bash prefixes `git`, `gh pr view`, `gh pr diff`, `gh pr comment`, the repo as its one workspace, `limits.sessions_at_once: 1` and a small `limits.tokens_per_day`;
  2. the call is held (`approval_required: held as approval <id>; … the kernel applies it itself … do not repeat the call.`), and `studio approvals`' display shows the charter header line (`Create crew member mason (…), proposed by Wright`) and, as the display's second line, a line starting `enforced: never: ` that lists `git_push` and every PR/issue write category except `gh_pr_comment` (`kernel/src/agents/charter-tools.ts`);
  3. `studio approve <id> once` makes the kernel create `mason` (`getAgent` row `status: "active"`, `created_by: "wright"`, `approval_id: <id>`; `role.md`, the settings file and the four memory files exist per `agentFilePaths`), and the decision message Wright receives contains `Nothing to repeat.`;
  4. `studio ask --agent mason --workspace <repo> "push your commit"` starts a session with `agent: "mason"` and `cwd` = the repo; in it the gate denies `Bash {command: "git push origin main"}` with a reason starting `agent_boundary: git_push`, one `tool_decision` event `{decision: "deny", reason: "agent_boundary", category: "git_push"}` is recorded, no approval row exists for it, and `git --git-dir <remote> rev-parse refs/heads/main` is identical before and after;
  5. in the same session the gate holds `Bash {command: "gh pr comment 1 -b \"LGTM\""}` as an approval (`approval_required: held as approval …`), and `studio deny <that id>` records the deny and queues `denied approval <id>: … Nothing was done; do not repeat the call.` for mason;
  6. the stand-in Wright calls `mcp__kernel__kernel_agent_message` to mason (not held); mason's reply returns to Wright as a message with `from_agent: "mason"` at the same depth as the delegation; with `wright.json` `limits.delegation_depth: 1`, a further delegation from that depth is refused `delegation_depth` (nothing queued, one `agent_message_refused` event);
  7. while one mason session is still running, a second `studio ask --agent mason …` is parked with reason `agent_sessions_at_once` (no second session starts) and runs once the first session ends;
  8. after mason's sessions report usage past its `tokens_per_day` for the budget day, the next mason start is refused `agent_daily_limit` (no session starts);
  9. (after the injected clock moves past the next budget day) a playbook the stand-in Wright drafts with `kernel_playbook_create` for agent `mason` dry-runs in a session with `agent: "mason"` (cwd `agentMemoryDir(dataDir, "mason")`, `dryRun: true`) and, once enabled (held enable approved `once`, kernel-applied), fires at its trigger instant in a session with `agent: "mason"`;
  10. `studio agents off mason` prints `studio: agent mason turned off`, and the next `studio ask --agent mason …` exits 2 with `studio: mason is off: it takes no messages; nothing was queued`;
  and it passes under `cd kernel && npm run typecheck && npm test` on the PR's head.
- [ ] AC2 — Given `STUDIO_LIVE` unset, when `cd kernel && npm test` runs, then `kernel/test/phase-4-exit-live.test.ts`'s live `describe` is skipped (`describe.skipIf(!LIVE)`), while its deterministic `describe`s for exported helpers still run and pass (at least: the throwaway-repo helper creates a repo with one unpushed commit and a bare remote outside the protected folders, and the run-tag provenance query selects only the harness's own agents).
- [ ] AC3 — Given `kernel/test/phase-4-exit-live.test.ts` with `STUDIO_LIVE=1` on the installed service, its live `describe` walks Scope 2's steps in order: a run-tagged throwaway repo + bare remote created outside the protected folders (D31, never under `~/Documents`); a plain-English ask to Wright for a comment-only reviewer (run-tagged id) of that repo that never pushes; a wait for the owner's decision on the held `kernel_agent_create` (the harness checks the `agents` row and files, not the reply); `studio ask --agent <id> --workspace <repo> "push the commit to origin"` asserting the session's `agent` and cwd, a `tool_decision` deny for a push (`agent_boundary`, or the policy's own deny when the charter lists no push-capable prefix — recorded which), no approval row for a push, and the bare remote's ref unchanged; a push the model never attempts (after the one re-ask the runbook allows) is recorded `not_exercised` and FAILS the run, never passes silently; `studio ask --agent <id> --workspace <repo> "leave a review comment on PR 1"` asserting a held `gh pr comment` approval that the owner denies (no `gh` on the machine ⇒ recorded `not_exercised` for that step only, per the requirement's Assumptions); cleanup that turns off only the harness's own run-tagged agents (re-read first, only those still `active`) and removes the throwaway repo, touching no other agent or data; and a `0600`, redacted summary JSON in `tmpdir()` (phase 3's `writeSummary` pattern).
- [ ] AC4 — Given `docs/evidence/phase-4-exit-runbook.md`, when the owner reads it, then it lists setup (build, `service install`, adding the four `mcp__kernel__kernel_agent_*` names to an existing `wright.json` tool policy because the file is create-if-absent, the reviewer's model that Wright proposes and the owner may change before approving), each live step, what only the owner can see (the approval display read on screen, the approve/deny decisions), the one allowed re-ask, cleanup, and the evidence file's shape (phase 3's shape, `run_by` included, D33); it links no file that does not exist yet (the future evidence JSON is named in code font, not linked); and `bash scripts/check-docs.sh` passes.
- [ ] AC5 — Given the PR, then `docs/ARCHITECTURE.md` still states the four `kernel_agent_*` tools as shipped (lines 63 and 77 — adjust only if inaccurate), its safety-kernel bullet's "Reviewers comment only." points to the `never` list (link `architecture/approvals.md#the-never-boundary`), `docs/OPEN_QUESTIONS.md` gains an open `- [ ] **Phase 4 exit: live run (item 09, owner).**` entry (deterministic test, harness, runbook, and what stays unverified live: a real model attempting the push, a real model's handling of a crew reply, a long delegation chain, `kernel_agent_update` live, the agent limits live), placed after the phase 3 entries; `docs/ROADMAP.md` is unchanged and no `docs/evidence/phase-4-exit-live-*.json` is added.

## Phase 3: ANALYZE (summary)

**Tech Stack:** TypeScript (strict), Node ≥ 22, vitest, better-sqlite3, `@anthropic-ai/claude-agent-sdk`.

### File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| deterministic exit test | — | `kernel/test/phase-4-exit.test.ts` | HIGH |
| live harness + runbook + docs | `docs/ARCHITECTURE.md`, `docs/OPEN_QUESTIONS.md` | `kernel/test/phase-4-exit-live.test.ts`, `docs/evidence/phase-4-exit-runbook.md` | HIGH |

### Facts the workers rely on (verified at base commit `2c0dfff`)
- **Skeleton to copy:** `kernel/test/phase-3-exit.test.ts` — one `describe`, one long `it` with `// ---- N. ----` step comments and a 60_000 ms timeout; `beforeEach` `mkdtempSync`, `afterEach` stops `kernels[]`, `vi.restoreAllMocks()`, `rmSync`. Its helpers are file-local (`mutableClock`, `memoryKeychain`, `writeSettings`, `testContributions`, `twoMoreTicks`, `success`, `toolsOf`/`tool`, `gateOf`, `value`, `standIns`, `reply`, the store readers `runRows`/`sessionRow`/`decisionText`/`approvalRows`) — copy them into the new file; do NOT add a shared helper module. Shared imports: `fakeSessions`, `fakeMsg`, `makePluginDir`, `stubProvider`, `flush` (`kernel/test/session-fakes.ts`), `events`, `count` (`kernel/test/loop-helpers.ts`).
- **Kernel set-up:** `startKernel({dataDir, env: {PATH: "/usr/bin"}, sessions: {loomwrightPath: makePluginDir(tmp), stopGraceMs: 10}, contributions}, deps)` with `deps = {keychain, keychainWriter, sessionDeps: {...fakes.deps, homeDir: <tmp home>}, selectAuthProvider: async () => stubProvider(), availableProviderIds: async () => ["api-key"], now: clock.now, loopDeps: {tickMs: 10, now: clock.now}}`. Pass an explicit `homeDir` under `tmp` for the session manager's cwd check (`#refuseProtectedCwd`, `kernel/src/sessions/manager.ts`). The workspace D31 check does NOT see it: `readAgentSettings(dataDir, agent)` is called with no options by the brain handler (`kernel/src/brain/handler.ts`) and the ask route (`kernel/src/brain/routes.ts`), so it falls back to the real `os.homedir()` (`kernel/src/agents/settings.ts`). A repo under `tmpdir()` passes it on macOS (`/var/folders/…`) and on ubuntu CI (`/tmp`), because neither is under `<home>/Documents|Desktop|Downloads|Library/Mobile Documents` (`isProtectedPath`, `kernel/src/protected-paths.ts`). `studio(argv)` → `runCli(argv, {dataDir, keychain: keychain.reader, stdout, stderr})`.
- **Determinism:** swap the brain's message handler for `brainMessageHandler({now: clock.now, timeZone: () => ZONE})` in the contributions (phase 3's `testContributions`). The budget day is the host's local day (`localDay`; see the comment at the top of `phase-3-exit.test.ts`), so advance the clock past the next local midnight when step 9 needs mason admitted again after step 8.
- **Wright's settings:** phase 3's `writeSettings` writes `wright.json` with `tool_policy {status: "owner", allowedTools: [...PROPOSED_ALLOWED_TOOLS], allowedBashPrefixes: [...]}`; `PROPOSED_ALLOWED_TOOLS` (`kernel/src/brain/settings.ts`) already includes the four `mcp__kernel__kernel_agent_*` names. Add `limits: {delegation_depth: 1}` for step 6 — `readWrightSettings` accepts `limits` but REFUSES `never` / `workspaces` on Wright (`settings_invalid`, `kernel/src/agents/settings.ts`), so put neither in `wright.json`.
- **Stand-ins:** `standIns()` routes each fake session to a driver queue by `call.options.model`; give mason a model distinct from Wright's (and from the playbook's if one is set) so drivers are routed unambiguously. Tools: `call.options.mcpServers.kernel.instance._registeredTools[name].handler(args, {})`; the rail gate: `options.hooks.PreToolUse[0].hooks[0]` with `cwd: call.options.cwd`. A session with no queued driver lands in `failures` — assert `failures` empty at the end.
- **Step 1–3 (create):** see `kernel/test/agents-charter-tools.test.ts` (charter fixture ~l.87–101, held create ~l.320–369 — that test starts the session directly; here it goes through `studio ask`). Display is read from `studio approvals` stdout between `"  display:\n"` and `"  payload:\n"` (header line built in `kernel/src/agents/charter-tools.ts`). `studio approve <id> once` stdout carries `the kernel applied it: The kernel created crew member mason (…) on approval <id>.` (`kernel/src/approvals/cli.ts`); decision message `approved approval <id>: kernel_agent_create. <applied> Nothing to repeat.` (`kernel/src/approvals/store.ts`). Charter validation: `validateCharter`; workspace rule `workspaceProblem` (absolute, not protected, not inside the data dir and not containing it) in `kernel/src/agents/charter-files.ts` and `kernel/src/agents/settings.ts` — put the repo at `join(tmp, "repo")` and the data dir at a sibling `join(tmp, "data")`.
- **Step 4–5 (crew session):** `studio ask --agent mason --workspace <repo>` → `POST` route in `kernel/src/brain/routes.ts` (409 `agent_off`, `workspace_not_listed`) → the brain handler (`kernel/src/brain/handler.ts`) reads `readAgentSettings` and starts the session with `policy: {...s.policy, never}`, cwd = `listedWorkspace(...)` else `agentMemoryDir`. Policy is not on `FakeCall.options` — prove it by the gate's behaviour. Boundary deny reason `boundaryDenyReason` (`kernel/src/sessions/policy.ts`); the `tool_decision` event is written in `kernel/src/sessions/manager.ts`. A deny of the held comment queues a message to the requesting agent (mason, `messageAgent` in `kernel/src/approvals/store.ts`) — that starts a mason session, which needs a queued driver and respects `sessions_at_once: 1` (end the step-4 session first).
- **Git fixture (new; no helper exists in `kernel/test`):** `execFileSync("git", [...])` with `-c user.name=… -c user.email=… -c init.defaultBranch=main` (CI has no git identity): `git init --bare <tmp>/remote.git`; `git init <tmp>/repo`, commit, `git remote add origin <remote>`, `git push origin main` (the fixture's own setup push), then one more commit left unpushed. Read the ref with `git --git-dir <remote> rev-parse refs/heads/main`. The denied push never runs (the gate denies before any spawn), so the "unchanged ref" assertion holds by construction — keep it anyway, it is the exit criterion's evidence.
- **Step 6 (delegation):** `kernel/test/agents-delegation.test.ts`; refusal built in `kernel/src/agents/delegate.ts` (`if (limit !== undefined && depth > limit)`, reason `delegation_depth`, `agent_message_refused` event, one `kernel:delegation_depth` notification); the reply carries `depth: row.depth, reply_to: row.id` (`kernel/src/brain/handler.ts`), asserted shape in `kernel/test/brain-crew-routing.test.ts` (`{agent: "wright", from_agent: "mason", depth: 1, reply_to}`).
- **Steps 7–8 (limits):** `kernel/test/budget-agent-limits.test.ts`; reasons `agent_sessions_at_once` and `agent_daily_limit` (`kernel/src/budget/internal.ts`); the loop records `event_parked` (`kernel/src/loop/loop.ts`); a parked brain message row's detail is `admission_refused: <reason>; retry at <iso>` and `studio ask` then exits 2 with `studio: message <id> is parked: …` (`kernel/src/brain/cli.ts`). Usage is reported through the fake session's `result` message (`success(text, modelUsage)`).
- **Step 9 (crew playbook):** `kernel/test/playbooks-crew.test.ts` (create with `agent: "mason"`, dry run ~l.328–369, fire ~l.600–637). Enable is always held and kernel-applied on `once` (phase 3 item 10). A playbook trigger due while still a draft is `trigger_missed` — schedule it after the enable on the injected clock.
- **Step 10 (off):** `kernel/src/agents/roster.ts` (`studio: agent mason turned off`); the ask refusal in `kernel/src/brain/cli.ts`.
- **Live harness:** mirror `kernel/test/phase-3-exit-live.test.ts`: `const LIVE = process.env.STUDIO_LIVE === "1"`, `describe.skipIf(!LIVE)`, deterministic `describe`s for exported helpers that run in CI, run tag `phase4-exit-${Date.now().toString(36)}${randomBytes(3).toString("hex")}` (lowercase — fit for an agent id), `writeSummary()` with `redact()` and mode `0o600` in `tmpdir()`, `step(name, body)` outcome recording, built-CLI `studio()` via `execFile(process.execPath, [CLI_PATH, …])` with `STUDIO_DATA_DIR`, `beforeAll` service checks (darwin, built CLI, launchd pid = api.json pid = status pid, wright.json model and tools), `withDb`/`tryDb`/`waitFor` from `kernel/test/crash-helpers.ts`, cleanup in `afterAll` that re-reads and only turns off rows still on. Evidence shape: `docs/evidence/phase-3-exit-live-2026-10-18.json` top-level keys (`test, date, result, run_by, commit, dirty_worktree, machine, wright_model, wright_settings, service, harness_summary, steps, run_tag, cleanup`), each step `{outcome, harness, owner, findings}`.
- **Runbook:** mirror `docs/evidence/phase-3-exit-runbook.md`'s headings (What this run does, Setup, Running it, Step 1–N, If a step fails, The evidence file, Marking phase 4 done). `scripts/check-docs.sh` resolves every relative markdown link in `docs/` — never link the not-yet-written evidence JSON.
- **CI** (`.github/workflows/ci.yml`, job `ci`, ubuntu-latest): `bash scripts/check-docs.sh`, then in `kernel/`: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, a `node dist/daemon.js --version` smoke.

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/agents/settings.ts` (Wright never/workspaces refused) | yes | HOLDS | `if (s[field] !== undefined) return invalid(field, \`${field}: not supported for Wright yet` | tip 2c0dfff, read <1h |
| `kernel/src/agents/delegate.ts` (depth refusal) | yes | HOLDS | `if (limit !== undefined && depth > limit) {` | tip 2c0dfff, read <1h |
| `kernel/src/brain/handler.ts` (crew policy carries never) | yes | HOLDS | `policy: { ...s.policy, ...(s.never ? { never: s.never } : {}) },` | tip 2c0dfff, read <1h |

## Pin mutations

Each mutation is applied to production code (never the test), must turn the named pin red, and is reverted after the check.

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/phase-4-exit.test.ts` step 4 — mason's push is denied `agent_boundary` with no approval row | flip `const category = NEVER_CATEGORIES.find((c) => read.has(c) && never.includes(c));` → `const category = undefined;` in `kernel/src/sessions/policy.ts` (the push then falls to the rail and is held — the pin must see an approval row / a non-boundary reason) |
| `kernel/test/phase-4-exit.test.ts` step 4 — the crew session runs under mason's `never` list | flip `policy: { ...s.policy, ...(s.never ? { never: s.never } : {}) },` → `policy: { ...s.policy },` in `kernel/src/brain/handler.ts` |
| `kernel/test/phase-4-exit.test.ts` step 6 — a delegation past `delegation_depth` is refused | flip `if (limit !== undefined && depth > limit) {` → `if (limit !== undefined && depth > limit + 1) {` in `kernel/src/agents/delegate.ts` |
| `kernel/test/phase-4-exit.test.ts` step 5 — the held comment's deny queues "Nothing was done; do not repeat the call." for mason | flip `` if (decision === "deny") return `${head}. Nothing was done; do not repeat the call.`; `` → `` if (decision === "deny") return `${head}.`; `` in `kernel/src/approvals/store.ts` |
| `kernel/test/phase-4-exit.test.ts` step 7 — a second mason start is parked `agent_sessions_at_once` | flip `return { reason: "agent_sessions_at_once", retryAt, details };` → `return null;` in `kernel/src/budget/internal.ts` (`sessionsAtOnceRefusal` returns `AgentRefusalOf<"agent_sessions_at_once"> \| null`; the tsconfig has no `noUnusedLocals`, so the now-unused locals compile) |
| `kernel/test/phase-4-exit.test.ts` step 8 — mason past `tokens_per_day` is refused `agent_daily_limit` | delete the line `if (tokens !== null) return { reason: "agent_daily_limit", retryAt: tokens.retryAt, details: tokens.details };` in `kernel/src/budget/internal.ts` (`agentRefusal`; `tokens` becomes an unused local, which compiles without `noUnusedLocals`) |
| `kernel/test/phase-4-exit.test.ts` step 10 — an off agent takes no message | flip `if (member.status !== "active") return { status: 409, body: { error: "agent_off" } };` → `if (member.status === "never") return { status: 409, body: { error: "agent_off" } };` in `kernel/src/brain/routes.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Deterministic phase 4 exit test | AC1 | 0 modify, 1 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Live harness, owner runbook, architecture and open-questions docs | AC2, AC3, AC4, AC5 | 2 modify, 2 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1 — deterministic exit test (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/test/phase-4-exit.test.ts"}
requires: []
lanes:
  - "kernel/test/phase-4-exit.test.ts"
external_requires: []

# Subtask 2 — live harness + runbook + docs (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/test/phase-4-exit-live.test.ts"}
  - {kind: "file", path: "docs/evidence/phase-4-exit-runbook.md"}
  - {kind: "symbol", path: "docs/evidence/phase-4-exit-runbook.md", name: "## Setup"}
requires: []
lanes:
  - "kernel/test/phase-4-exit-live.test.ts"
  - "docs/evidence/phase-4-exit-runbook.md"
  - "docs/ARCHITECTURE.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires:
  - "the owner's installed launchd service and a real Wright model (live run only, STUDIO_LIVE=1; never in CI)"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
Subtask 2 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel)
- **Recommended workers:** 2
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5) CAUTION: no kernel-level test yet runs `studio ask --agent mason --workspace <repo>` end to end; the exit test may surface a wiring gap | HIGH | Requirement Non-goals: a gap found is reported as a finding (worker hand-back + `docs/OPEN_QUESTIONS.md`), never fixed in this PR's production code; the worker stops and says so rather than editing `kernel/src/` |
| Feasibility (Phase 2.5) CAUTION: ~1,800 new lines (check 4) | MEDIUM | Context-bound split into 2 independent subtasks; `npm run typecheck && npm test` and `bash scripts/check-docs.sh` gate both |
| First kernel test using a real git repo and bare remote; CI has no git identity and may default to `master` | MEDIUM | Pass `-c user.name -c user.email -c init.defaultBranch=main` on every fixture `git` call; never depend on global git config |
| Step 8 parks mason until the next local budget day, which would also refuse step 9's crew playbook | MEDIUM | Advance the injected clock past the next local midnight before step 9 (`localDay`, host zone — phase 3's note) |
| `sessions_at_once: 1` means any queued message to mason (the deny message in step 5, the delegation in step 6) waits while a mason session is open | MEDIUM | End each mason session (fake `result` + end) before the next mason message; queue a driver for every mason session, including the one the step-5 deny message starts; assert `failures` empty |
| `readWrightSettings` refuses `never`/`workspaces` in `wright.json` | MEDIUM | Wright's settings in the test carry only `limits.delegation_depth`; mason's settings come from the charter |
| A real model may refuse to try a push it was told is forbidden (live only) | MEDIUM | Harness prompt names the push as the owner's explicit request; one re-ask; still no attempt ⇒ step `not_exercised` ⇒ run FAILS |
| ROADMAP marked done before a live run | MEDIUM | This PR must not edit `docs/ROADMAP.md` nor add an evidence JSON; they land together in the owner's live-run commit (requirement AC 4, D33) |
| Prior churn: `docs/ARCHITECTURE.md` and `docs/OPEN_QUESTIONS.md` drew many review rounds in earlier phases | MEDIUM | Keep doc edits minimal and factual; state limits explicitly; match the docs' existing voice (CLAUDE.md conventions) |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 1
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-19-phase-4-exit-check.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-19T12:52:07Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/93
- **Branch:** feature/phase-4-exit-check
- **Files changed:** 5
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Added the phase 4 deterministic exit test (10 steps, real kernel + real git repo with a bare remote; 7/7 pin mutations held, applied by hand by the Phase 4.5 reviewer because run-pin-mutations.sh runs only *.sh pins), the STUDIO_LIVE-only live harness, the owner runbook, and the ARCHITECTURE/OPEN_QUESTIONS edits. Phase 4.5: iteration 1 FAIL (HIGH live step 4 accepted any policy deny; MEDIUM runbook re-ask wording) → fix 7382a75; iteration 2 FAIL (HIGH pushCapablePrefixes single probe) → fix a67e557 (git command-line model pushWitnessOf); iteration 3 PASS (1 LOW dismissed). 3 LOW dismissed in total. Execute Manager #1 checkpointed with both workers still running (handed back at 7/60 calls); a fresh Execute Manager gated them. kernel/src unchanged; ROADMAP unchanged; live run pending (owner, D33). Finding (not fixed, Non-goals): the kernel records no session cwd.

## Not verified
- **kernel/test/phase-4-exit-live.test.ts live describe** — never run (needs STUDIO_LIVE=1, the owner's service and a real model) (subtask 2)
- **docs/OPEN_QUESTIONS.md phase 4 entry's description of kernel/test/phase-4-exit.test.ts** — written in a worktree without that file; the Phase 4.5 reviewers later judged AC5 addressed on the merged tree (subtask 2)
