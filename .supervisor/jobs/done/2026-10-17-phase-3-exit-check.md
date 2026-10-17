# Supervisor Job: Phase 3 exit check — wire the per-playbook token limit into session admission, then prove phase 3 deterministically (CI) and ship the live harness and runbook

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (one app-made worktree under `.claude/worktrees/`, unrelated)
- **Source requirement:** .supervisor/requirements/phase-3/2026-10-16-092909-phase-3-exit-check.md
- **Base commit:** 4734fb93832e614b98f33647a941765b975eb8d5

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel, vitest; same stack as phase 2's exit test |
| 2 | Dependency Availability | GO | No new dependency |
| 3 | Architecture Fit | GO | Playbook admission gate (`kernel/src/budget/playbook.ts` `PlaybookAdmission`) already exists; only the session manager's call to it is missing |
| 4 | Scope vs Supervisor Capability | CAUTION | ~1,500 changed lines across 3 groups (context-bound split) |
| 5 | Hard Blockers | NO-GO (owner override) | Scope step 8 ("the playbook's token limit parks the next fire") cannot pass today: `Budget.checkPlaybook` is never called (`kernel/src/budget/index.ts`: "`checkPlaybook` (bound too) is the playbook gate; nothing calls it yet"), `startKernel` wires only `admission: budget.check`, and `AdmissionRefusalReason` has no playbook reason. Item 06's AC ("no session starts, the work is parked until local midnight") is unmet although PR #68 merged. The owner chose (2026-10-17, Launch Pad Phase 2.5) to wire it in THIS PR |

**Overall Verdict:** NO-GO (user override — "Wire it in this PR")

## Task
**Goal:** Wire the per-playbook daily token limit into session admission, then add phase 3's deterministic exit test, its opt-in live harness and owner runbook, and the docs that record what phase 3 shipped — without marking phase 3 done.

**Problem Statement:**
The owner needs phase 3's exit criterion ("a plain-English request becomes a stored playbook whose dry-run output is shown before it's enabled; dedupe key, priority and model come from the user, with Wright only proposing defaults") proven in CI and runnable live on his Mac, because "done" must mean it works in the running system.
Currently items 02–08 build the parts but nothing proves the whole, and one part (item 06's per-playbook token-limit park) was never wired: a playbook at its daily limit still starts a session.
Success looks like: a playbook at its limit is refused `playbook_daily_limit` at session start and its fire is parked; `kernel/test/phase-3-exit.test.ts` drives every scope step green in CI; the live harness is skipped without `STUDIO_LIVE=1`; the runbook lets the owner (or an agent under D33) run the live check.

**Precedent:** phase 2's exit commit `7cc343b` ("test: phase 2 exit check (deterministic test, live harness, runbook, docs)"). `docs/ROADMAP.md`'s ✓ and the live evidence file `docs/evidence/phase-3-exit-live-<date>.json` are NOT in this PR — they land together in the owner's live-run commit after a passing live run (requirement AC 4; D33).

## Acceptance Criteria
- [ ] AC1 — Given a playbook whose counted tokens today are at its `token_limit_per_day`, when its session start is requested (fire, run now or dry run), then the session manager refuses it with `AdmissionRefusedError` reason `playbook_daily_limit` and `retryAt` = the next budget day, no session row or spawn is created, one `playbook_limit_reached` event and one `notify` are recorded for that playbook-day (a second refused start the same day records neither again), and a session that is not a playbook's is admitted exactly as before (same `Budget.check` verdicts and events).
- [ ] AC2 — Given the kernel started by `startKernel`, when a playbook fire hits that refusal, then the fire's `playbook_runs` row keeps `result_json` `{parked, retry_at}` and the loop parks the event until `retry_at` (`event_parked`), with no second notify (D17).
- [ ] AC3 — Given `kernel/test/phase-3-exit.test.ts` (a real kernel from `startKernel` with `SHIPPED_CONTRIBUTIONS`, a stand-in Wright via `fakeSessions`, one injected clock, a stub notifier, no model), when the suite runs, then one test drives in order: `studio ask` → stand-in Wright calls `kernel_playbook_create` with proposed values (`*_set_by = 'wright'`, mirror file under `memory/playbooks/<slug>.md`) → the owner runs `studio playbooks set <id> priority …` and `… model …` (`*_set_by = 'owner'`) → `kernel_playbook_dry_run` stores a `dry_run` run and it is shown (mirror "Last dry run" line and the `studio approvals` display) → `kernel_playbook_enable` is held → `studio approve <id> once` → the retried enable enables it (`playbook_enabled`) → the linked trigger fires at its instant, the session starts with the playbook's model and the queue row carries its priority → a second fire with the same dedupe key records `skipped_duplicate` and starts no session → an outward call held in a fire session and approved `always` passes on the next fire without a new approval, and after a new version (set + dry run + approve) the same call is held again → with the playbook's token limit reached, the next fire is parked (`playbook_daily_limit`) and starts no session; and it passes in CI.
- [ ] AC4 — Given `STUDIO_LIVE` unset, when `cd kernel && npm test` runs, then `kernel/test/phase-3-exit-live.test.ts`'s live `describe` is skipped (its deterministic helper `describe`s still run).
- [ ] AC5 — Given `docs/evidence/phase-3-exit-runbook.md`, when the owner reads it, then it lists setup (build, `service install`, Wright's model, adding the six `mcp__kernel__kernel_playbook_*` names to an existing `wright.json` tool policy because the file is create-if-absent), each live step (plain-English request for a cron playbook a few minutes ahead with a run tag → draft, mirror file, dry run → enable request in `studio approvals` with the dry run shown → owner approves → it fires at its minute → a second instant with the same dedupe key is skipped), what only the owner can see, cleanup that turns off only the harness's own playbooks, and the evidence file's shape (phase 2's shape plus `run_by`, D33); and `bash scripts/check-docs.sh` passes.
- [ ] AC6 — Given the PR, then `docs/ARCHITECTURE.md` "Kernel tools" states the six phase 3 playbook tools as shipped, `docs/architecture/budget.md` "Not wired yet" no longer says the manager does not call the playbook gate (it states what is now wired; every other "Not wired yet" bullet that is still true — including the API-key provider switch, the running-session ceiling and `studio status`'s missing per-playbook line — stays), budget.md's sentence "The kernel's own wiring (`onMessage: budget.observe`, `admission: budget.check`) is unchanged." is rewritten to the new wiring, the JSDoc comments in `kernel/src/budget/index.ts` ("`checkPlaybook` (bound too) is the playbook gate; nothing calls it yet") and `kernel/src/budget/playbook.ts` (the class comment's sentence that the session manager "does not call it yet and launches every session on its one provider", which wraps across two lines) state the new wiring, `docs/OPEN_QUESTIONS.md` records what this work leaves unverified, and `docs/ROADMAP.md` is unchanged.

## Phase 3: ANALYZE (summary)

**Tech Stack:** TypeScript (strict), Node ≥ 22, vitest, better-sqlite3, `@anthropic-ai/claude-agent-sdk` 0.3.284.

### File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| admission wiring | `kernel/src/sessions/types.ts`, `kernel/src/sessions/manager.ts`, `kernel/src/kernel.ts`, `kernel/src/budget/index.ts` (comment only), `kernel/src/budget/playbook.ts` (comment only), `docs/architecture/budget.md` | `kernel/test/sessions-playbook-admission.test.ts` | HIGH |
| deterministic exit test | — | `kernel/test/phase-3-exit.test.ts` | HIGH |
| live harness + docs | `docs/ARCHITECTURE.md`, `docs/OPEN_QUESTIONS.md` | `kernel/test/phase-3-exit-live.test.ts`, `docs/evidence/phase-3-exit-runbook.md` | HIGH |

### Facts the workers rely on (verified at base commit)
- Stand-in Wright: `fakeSessions({script})` (`kernel/test/session-fakes.ts`); tools called through `call.options.mcpServers.kernel.instance._registeredTools[name].handler(args, {})` (`toolsOf` in `kernel/test/phase-2-exit.test.ts`); the rail gate through `options.hooks.PreToolUse[0].hooks[0]` (`gateOf` in `kernel/test/playbooks-dry-run.test.ts`). `mutableClock`, `studio()`/`runCli`, `success`, `toolsOf`, `gateOf` are inline per file — copy them, do not add a shared helper module.
- `kernel_playbook_create` (`kernel/src/playbooks/drafts.ts`) args `{name, intent, trigger:{kind,spec,tz?}, dedupe_key?, priority?, model?, token_limit?, idempotency_key}`; the linked trigger is a `wake_agent` trigger. A playbook trigger that comes due while still a draft is recorded `trigger_missed` (`playbook_not_enabled`) and a `once` trigger is spent — enable before the instant.
- `studio playbooks set <id> <field> <value>` (fields `dedupe_key`, `priority`, `model`, `token_limit`) writes a NEW version and returns an enabled playbook to `draft` — do the owner sets before the dry run.
- `kernel_playbook_dry_run` refuses a non-draft or a model-less playbook; the nested dry-run session is driven by the same fake script (tell it apart by `options.model` or the session row's `playbook`).
- `kernel_playbook_enable` is in `ALWAYS_HELD_TOOLS` (`kernel/src/sessions/policy.ts`); `beforeHold` (`kernel/src/playbooks/enable.ts`) refuses with no dry run for the current version; the retry must run in the session that used the approval (`ownApproval`).
- Fire path: `fireOne` (`kernel/src/triggers/store.ts`) enqueues a `message` with the playbook's priority; `handlePlaybookMessage` (`kernel/src/playbooks/runs.ts`) starts the session with the snapshot's model; an `admission_refused` error keeps the run row parked (`runs.ts` `admissionRefusal`) and the loop parks the event.
- Dedupe: only a prior run with the same key that ended `done` counts (`doneWithKey`, `runs.ts`), so the first fake fire session must push a `result` and end. Never put `trigger.scheduled_at` in the key.
- Always grants: `holdOrUseGrant` / `decideApproval` (`kernel/src/approvals/store.ts`); a fire session's outward call reaches the rail only when `wright.json`'s `tool_policy` allows it (e.g. an allowed Bash prefix) while keeping the six playbook tools in `allowedTools`. Do NOT copy `playbooks-dry-run.test.ts`'s `writeSettings`, which narrows `allowedTools` to `["Read"]` and would deny enable.
- Determinism: the shipped brain handler uses the wall clock and host zone (`brainMessageHandler`, `kernel/src/brain/handler.ts`, `BrainHandlerDeps`). In the deterministic test replace `brainContribution` in the contributions with `{...brainContribution, handlers: {message: brainMessageHandler({now: clock.now, timeZone: () => ZONE})}}`, as phase 2 swaps the notifier; avoid `date` in the dedupe key unless the zone is pinned this way.
- Live harness: mirror `kernel/test/phase-2-exit-live.test.ts` (built CLI via `execFile`, launchctl/api.json/status pid checks, run tag, session provenance, cleanup that re-reads and only turns off rows still on, `0600` redacted summary in `tmpdir()`). Phase 3's provenance analogue: `playbook_created` events carry the creating session's id; cleanup `studio playbooks off <id>`.
- Wright's tool policy: `PROPOSED_ALLOWED_TOOLS` (`kernel/src/brain/settings.ts`); `readWrightSettings` creates `wright.json` only when absent (`flag: "wx"`), so an existing file keeps its old policy.

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/budget/index.ts:54` (agent research) | yes | HOLDS | `` `checkPlaybook` (bound too) is the playbook gate; nothing calls it yet. `` | tip 4734fb9, fetched <1h |

## Touched-file invariants

> Grounded at base `4734fb93832e614b98f33647a941765b975eb8d5`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/sessions/types.ts`** — keep: `AdmissionRequest`'s existing five fields and their meaning (`readonly provider: string;` — "the key admission checks parks on"); keep `AdmissionRefusedError` a `SessionError` with code `"admission_refused"` (`super("admission_refused", message);`), which `kernel/src/playbooks/runs.ts` `admissionRefusal` and the brain handler detect by code, never by import. Add the playbook field as OPTIONAL (`playbook?: number`) so every existing request literal in tests (`kind: "start", agent: "wright", account:` in `kernel/test/budget-cap.test.ts`, `kernel/test/store.test.ts`) still type-checks. pinned by: `kernel/test/brain.test.ts` (`new AdmissionRefusedError("agent_daily_limit"`).
- **`kernel/src/sessions/manager.ts`** — keep: admission runs before any row, status change or spawn on start (`this.#admit({ kind: "start", agent: params.agent`), after `#checkPlaybookParams(params)` and Loomwright resolution; a refused resume leaves the row untouched (`// Before the group check: a refused resume leaves the row and its events untouched.`); `#parkIfRefused` never throws for a refusal and fails closed on a throwing check (`payload = { reason: "admission_error"`). reuse: the existing `#admit` / `#parkIfRefused` paths — pass the session's playbook id instead of adding a second admission call: on start from `params.playbook`, on resume and on every resume retry from the row's `playbook` (`#parkIfRefused` builds its own request, so thread it there too). **Request shape: include the `playbook` key ONLY when the session has a playbook** (a positive id); a non-playbook request keeps exactly its five fields `kind, agent, account, provider, task` — never `playbook: null` or `playbook: undefined` — because `kernel/test/budget-admission.test.ts` asserts the exact five-field request with `toEqual` (the `[{ kind`… request lists around its `managerHarness` tests, two `start` and two `resume` requests) and that file is outside every lane. pinned by: `kernel/test/sessions.test.ts` (`expect(h.admission).not.toHaveBeenCalled();`), `kernel/test/budget-admission.test.ts` (the exact five-field request assertions).
- **`kernel/src/kernel.ts`** — keep: `new Budget({ store, authProvider }, { now })` (no API-key provider is given, so the playbook gate never admits on another provider) and `onMessage: budget.observe,`; replace the `admission: budget.check,` line with `admission: admissionFor(budget, authProvider.id),`, where `admissionFor` is a new function EXPORTED from `kernel/src/kernel.ts` that calls `budget.checkPlaybook({ ...request, playbook: request.playbook ?? null })` (an absent playbook ⇒ `null` ⇒ exactly `check`'s verdict and events) and maps the verdict onto `AdmissionDecision`. Fail closed: an admit naming a provider other than `authProvider.id` must not launch (refuse or throw) — the manager launches every session on its one provider. mirror: `PlaybookAdmissionDecision` (`kernel/src/budget/playbook.ts`, `{ readonly admitted: true; readonly provider: string }`) mapped onto `AdmissionDecision` (`kernel/src/sessions/types.ts`).
- **`kernel/src/budget/index.ts`, `kernel/src/budget/playbook.ts`** — comment-only edits; keep: every exported name and the `Budget` / `PlaybookAdmission` behaviour unchanged (`readonly checkPlaybook = (request: PlaybookAdmissionRequest): PlaybookAdmissionDecision =>`, `if (playbook === null) {`); change only the JSDoc sentences that say nothing calls the playbook gate. pinned by: `kernel/test/budget-playbook.test.ts` (`b.checkPlaybook(request({ playbook: pb }))`).

## Closed enumerations touched

> Sibling grep at base `4734fb9`: `grep -rnF 'agent_daily_limit' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.supervisor .` → 19 hits in 9 files (excluding the app-made `.claude/worktrees/` checkout).

- **`playbook_daily_limit`** (sibling: `agent_daily_limit`) — must be named in:
  - `kernel/src/sessions/types.ts` — `export type AdmissionRefusalReason = "cap_parked" | "agent_daily_limit";` — extend.
  - `kernel/src/budget/playbook.ts` — `PlaybookRefusalReason` already names it — no change.
  - `kernel/src/budget/admission.ts` — `reason: "cap_parked" | "agent_daily_limit",` is `BudgetAdmission`'s own refusal (it never refuses for a playbook) — no change.
  - `kernel/src/budget/internal.ts` — the agent-limit notify payload — no change: the playbook notify is `notePlaybookLimitReached`'s.
  - `docs/architecture/budget.md` — prose naming the gate's reasons — extend the wiring paragraph (AC6).
  - `kernel/test/budget-admission.test.ts`, `kernel/test/budget-playbook.test.ts`, `kernel/test/budget-meter.test.ts`, `kernel/test/brain.test.ts` — test values, not closed lists — no change.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/sessions-playbook-admission.test.ts` — a playbook at its limit is refused `playbook_daily_limit` at start (the test drives admission through `startKernel` with fake sessions, so the kernel's real wiring is under test) | flip `admission: admissionFor(budget, authProvider.id),` → `admission: budget.check,` in `kernel/src/kernel.ts` |
| `kernel/test/sessions-playbook-admission.test.ts` — a non-playbook start is admitted with exactly `Budget.check`'s verdict and events | flip `if (playbook === null) {` → `if (playbook === -1) {` in `kernel/src/budget/playbook.ts` |
| `kernel/test/sessions-playbook-admission.test.ts` — one `playbook_limit_reached` and one `notify` per playbook-day (a second refused start records neither) | flip `WHERE kind = 'playbook_limit_reached'` → `WHERE kind = 'playbook_limit_never'` in `kernel/src/budget/internal.ts` (the dedupe read inside `notePlaybookLimitReached`) |
| `kernel/test/phase-3-exit.test.ts` — the next fire at the limit is parked (`event_parked`) and starts no session | flip `admission: admissionFor(budget, authProvider.id),` → `admission: budget.check,` in `kernel/src/kernel.ts` |
| `kernel/test/phase-3-exit.test.ts` — a second fire with the same dedupe key is skipped | flip `AND dedupe_key = ? AND status = 'done'` → `AND dedupe_key = ? AND status = 'never'` in `kernel/src/playbooks/runs.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Wire the per-playbook token limit into session admission | AC1, AC2, AC6 (budget.md and budget JSDoc part) | 6 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | Deterministic phase 3 exit test | AC3 | 0 modify, 1 create | `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |
| 3 | Live harness, owner runbook, architecture and open-questions docs | AC4, AC5, AC6 (ARCHITECTURE, OPEN_QUESTIONS, ROADMAP unchanged) | 2 modify, 2 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1 — admission wiring (LAUNCHABLE)
provides:
  - {kind: "type", path: "kernel/src/sessions/types.ts", name: "AdmissionRefusalReason"}
  - {kind: "type", path: "kernel/src/sessions/types.ts", name: "AdmissionRequest"}
  - {kind: "file", path: "kernel/test/sessions-playbook-admission.test.ts"}
  - {kind: "symbol", path: "kernel/src/kernel.ts", name: "admissionFor"}
requires: []
lanes:
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/kernel.ts"
  - "kernel/src/budget/index.ts"
  - "kernel/src/budget/playbook.ts"
  - "kernel/test/sessions-playbook-admission.test.ts"
  - "docs/architecture/budget.md"
external_requires: []

# Subtask 2 — deterministic exit test (BLOCKED by #1)
provides:
  - {kind: "file", path: "kernel/test/phase-3-exit.test.ts"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/kernel.ts", name: "admissionFor"}
  - {from: "1", kind: "type", path: "kernel/src/sessions/types.ts", name: "AdmissionRefusalReason"}
lanes:
  - "kernel/test/phase-3-exit.test.ts"
external_requires: []

# Subtask 3 — live harness + runbook + docs (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/test/phase-3-exit-live.test.ts"}
  - {kind: "file", path: "docs/evidence/phase-3-exit-runbook.md"}
  - {kind: "symbol", path: "docs/evidence/phase-3-exit-runbook.md", name: "## Setup"}
requires: []
lanes:
  - "kernel/test/phase-3-exit-live.test.ts"
  - "docs/evidence/phase-3-exit-runbook.md"
  - "docs/ARCHITECTURE.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires:
  - "the owner's installed launchd service and a real Wright model (live run only, STUDIO_LIVE=1; never in CI)"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
Subtask 3 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (2 consumes 1's behaviour) | YES (requires) |
| Subtask 1 | Subtask 3 | none | NO |
| Subtask 2 | Subtask 3 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 3 (parallel)
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 2
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md` |
| 3 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5), owner-overridden NO-GO: item 06's parking was never wired, so this PR carries production code, unlike phase 2's test-only exit PR | HIGH | Keep the change to the admission call path only (types, manager, kernel wiring); no API-key provider switch and no running-session ceiling enforcement — those stay in budget.md "Not wired yet" |
| Routing every session through `checkPlaybook` changes admission for non-playbook sessions | HIGH | `playbook: null` must yield exactly `Budget.check`'s verdict and events; Subtask 1 adds a test that a non-playbook start records the same events as before, and the full suite must stay green |
| The shipped brain handler uses the wall clock and host zone, so run timestamps and a `date` dedupe key are nondeterministic in the exit test | MEDIUM | Swap `brainContribution`'s message handler for `brainMessageHandler({now: clock.now, timeZone: () => ZONE})` in the test only |
| A playbook trigger coming due while still a draft is recorded `trigger_missed` and a `once` trigger is spent | MEDIUM | Schedule the trigger after the enable step on the injected clock (or use cron) |
| `studio playbooks set` creates a new version and drops an enabled playbook to draft | MEDIUM | Do the owner sets before the dry run; the "new version asks again" step deliberately uses this |
| Prior churn (postmortem ledger): `docs/ARCHITECTURE.md` (26) and `docs/OPEN_QUESTIONS.md` (13) prior rounds, classes self_heal_churn / drain_churn | MEDIUM | Keep doc edits minimal and factual; state limits explicitly; match the docs' existing voice |
| Scope ~1,500 changed lines (Feasibility CAUTION, check 4) | MEDIUM | Context-bound split into 3 subtasks; Subtask 1 limited to the admission call path and comment edits; `npm run typecheck && npm test` and `bash scripts/check-docs.sh` gate every subtask |
| A real model may phrase or schedule the playbook differently from the request | LOW | The live harness checks stored rows (`playbooks`, `playbook_runs`, events), never the reply text |
| ROADMAP marked done before a live run | MEDIUM | This PR must not edit `docs/ROADMAP.md`; the ✓ and the evidence JSON land together in the owner's live-run commit (AC 4 of the requirement, D33) |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-17-phase-3-exit-check.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-17T07:39:01Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/76
- **Branch:** feature/phase-3-exit-check
- **Files changed:** 12
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Wired per-playbook token-limit admission (admissionFor → Budget.checkPlaybook; playbook_daily_limit refusal) and added the phase 3 deterministic exit test, opt-in live harness, owner runbook and docs. Phase 4.5 review PASS on first pass (5/5 pin mutations held, 6/6 ACs addressed); 1 pre-existing finding dismissed (docs/architecture/dry-run.md:13). risk_classification high_risk=true (content+size heuristic). ROADMAP unchanged; live run pending.

## Not verified
- **Live daemon (launchd) with a real model hitting the limit** — deterministic fakes only (subtask 1)
- **kernel_playbook_dry_run tool and POST /playbooks/:id/run route at the limit** — not tested end to end at these entry points (subtask 1)
- **Live describe of phase-3-exit-live.test.ts (STUDIO_LIVE=1)** — needs the owner's service and a real Wright model (subtask 3)
- **Whether a real Wright repeats the held kernel_playbook_enable call exactly after approval** — recorded in OPEN_QUESTIONS and runbook step 4 (subtask 3)
- **phase-3-exit.test.ts in GitHub Actions CI** — run locally only before the PR (subtask 2)
