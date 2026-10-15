# Supervisor Job: Triggers — agents create one-shot and cron triggers; the owner sees every one and turns it on or off

## Environment
- **Project:** loomwright-studio (lane clone L3 of wave automate-2026-10-14-212726)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean, branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-2/2026-10-14-094204-triggers-wright-creates-and-the-owner-controls.md
- **Base commit:** 41425e0778cf31a3912694f32bc0a742b6ebf41e

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (`kernel/`), vitest, better-sqlite3, zod; the feature seam (`FeatureContribution`) already exists for tools, routes, subcommands and due work. |
| 2 | Dependency Availability | CAUTION | Cron evaluation and IANA time-zone conversion must be built without a new dependency (the requirement forbids touching `kernel/package.json`, owned by item 03 in this wave). Node 22's `Intl.DateTimeFormat` with `timeZone` supplies zone offsets; a 5-field cron matcher is hand-written. |
| 3 | Architecture Fit | GO | Due work runs once per loop tick (`DueWorkFn`); `triggers`, `notifications` and `event_queue` tables already exist (migration 11); work steps (`runStep`) give at-most-once fires; the kill-switch state is derived from `events`. |
| 4 | Scope vs Supervisor Capability | GO | One feature module plus its tests and doc page; fits the single-agent default. |
| 5 | Hard Blockers | CAUTION | The route seam gives a contributed route handler no store (`ContributedRouteRequest` is `{ params, query, body }`; contributions are merged before the store opens), so the owner-control routes need an additive seam extension (`store`, `now` on the request) in `kernel/src/features/contribution.ts` and `kernel/src/api/server.ts`; sibling lanes (03, 05, 06) need the same and may make the same additive edit. Item 03 (notifications record function) runs in a parallel lane and is not on `main`; this item writes the `notifications` row itself with the column contract migration 11 documents. The shipped-contribution pins in `kernel/test/feature-seams.test.ts` assert every feature registers nothing, so they must be narrowed for `triggers` (a file outside the requirement's `## Touches`). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Build the `triggers` feature contribution: kernel tools for agents to register, remove and list `once` / `cron` triggers; a due-work function that fires them at most once per scheduled instant (coalescing missed cron instants, never firing instants missed under the kill switch); and owner control through `studio triggers [--all] [--json]` and `studio triggers on|off <id>` over contributed API routes, with every register, remove, fire, miss and toggle audited, and a doc page.

**Problem Statement:**
The owner needs Wright to create time-based triggers ("remind me at 5pm to check X") and needs one place to see every trigger and turn any of them off or on, because reminders and scheduled work must happen on time without a session staying alive and nothing may run that the owner can't see and stop.
Currently, phase 1 only has `kernel_schedule_wakeup`, which queues a `wakeup` event nothing handles; there is no trigger, no recurring schedule and no owner-facing list. This makes phase 2 exit check (a) — "Wright creates the trigger itself and it fires at 5pm" — impossible.
Success looks like: an agent registers a trigger through a kernel tool, the kernel fires it at its computed instant (writing a `notifications` row or queueing a `message` event), and the owner lists and toggles every trigger from the CLI, with each step in the audit log.

## Acceptance Criteria
- [ ] Given `kernel_trigger_register(once, "2026-10-14T17:00:00+05:30", notify, "check X")`, then a row exists with next fire 11:30Z, and at the first tick at or after it exactly one notification row with source `trigger:<id>` and body "check X" exists; the trigger is now disabled with result `fired`.
- [ ] Given a `cron` trigger `0 9 * * 1-5` in `Asia/Kolkata`, then next fire times are correct across a weekend and across a DST change in a zone that has one (tested with `America/New_York`).
- [ ] Given a `wake_agent` trigger, when it fires, then one `message` event for its agent with the text and trigger id is queued, and nothing else.
- [ ] Given the kernel is killed with `kill -9` after a fire committed and before the tick ended, when it restarts, then the instant is not fired again. Tested with the phase 1 crash harness pattern: a separate `node` child process (a test-only fixture under `kernel/test/fixtures/`, like `crash-harness.mjs`, running the BUILT kernel from `buildKernel()` in `kernel/test/crash-helpers.ts`) opens the data dir, runs the triggers due work until the fire has committed, signals readiness on stdout and stays blocked before the tick ends (a test-only pause the fixture injects, never a flag in `kernel/src/`); the test sends `SIGKILL`, then a fresh process runs the due work again on the same data dir, and exactly one effect row exists for that instant.
- [ ] Given a `cron` trigger that missed 5 instants while the kernel was down, when it restarts, then it fires once, and the audit event says 5 missed.
- [ ] Given the owner ran `studio triggers off 7`, when an agent calls `kernel_trigger_register` again or tries to re-enable 7, then 7 stays off and the agent gets an error result saying the owner turned it off.
- [ ] Given an invalid spec (past `once`, bad zone, bad cron), then an error result naming the problem, and no row.
- [ ] Given the kill switch engaged over a `once` trigger's time and then released, then it is recorded `missed_kill_switch` and does not fire.
- [ ] Given `studio triggers [--all] [--json]`, then it lists id, owning agent, kind and spec, action and its text, enabled, next fire (owner's local time), last fired and result, created by and when, and who last toggled it; `studio triggers on|off <id>` toggles with `by: owner` in the audit event; turning on a past-due `once` trigger asks for confirmation that it will fire now and refuses without a terminal unless `--yes` (like `session abandon`).
- [ ] Given any register, remove, fire, miss or toggle, then exactly one audit event of a distinct `trigger_*` kind is appended in the same transaction as the change.
- [ ] Given a contributed route handler, when the API calls it, then the request it receives carries the kernel's `store` and `now` (an additive seam extension: `ContributedRouteRequest` gains `readonly store: Store` and `readonly now: () => Date`), documented in `docs/ARCHITECTURE.md` §"Phase 2 features" Routes bullet, and the existing feature-seams route tests still pass.
- [ ] Given the change, then `docs/architecture/triggers.md` documents the tools, the fire and missed-fire rules, owner control and the audit events under a `## Audit events` heading (replacing the "Documented by the item that builds it." stub), and `docs/ARCHITECTURE.md` names the real tool signatures (its `kernel_trigger_register(type, spec) / kernel_trigger_remove` line) and states what the kill switch does to triggers (nothing fires while engaged; missed instants are recorded `missed_kill_switch` after release).

## File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| triggers feature | `kernel/src/triggers/index.ts` | `kernel/src/triggers/cron.ts`, `kernel/src/triggers/store.ts`, `kernel/src/triggers/cli.ts` | HIGH |
| route seam (additive) | `kernel/src/features/contribution.ts`, `kernel/src/api/server.ts` | — | HIGH |
| tests | `kernel/test/feature-seams.test.ts`, `kernel/test/cli.test.ts` | `kernel/test/triggers.test.ts`, `kernel/test/triggers-crash.test.ts`, `kernel/test/fixtures/triggers-crash.mjs` | HIGH |
| docs | `docs/architecture/triggers.md`, `docs/ARCHITECTURE.md` | — | HIGH |

**Total estimated files:** 7 modify + 6 create

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Touched-file invariants

> Grounded at base `41425e0778cf31a3912694f32bc0a742b6ebf41e`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/triggers/index.ts`** — keep: the export name `triggersContribution` with contribution `name: "triggers"`, which `kernel/src/features/index.ts` imports into `SHIPPED_CONTRIBUTIONS` in the fixed order `loomwrightContribution,` … `triggersContribution,`; keep the module-graph rule pinned in `kernel/test/feature-seams.test.ts` (AC9): nothing reachable from `features/index.js` may import the Agent SDK, the session manager or `kernel.ts` — runtime imports of `../loop/steps.js`, `../loop/queue.js`, `../loop/internal.js` and `../api/kill-switch.js` are allowed (they type-import `Store` only), and the header comment's `it imports only types and zod: never the Agent SDK` is rewritten to state that rule; reuse: `defineTool` and the `FeatureContribution` parts from `../features/contribution.js` (`tools`, `routes`, `subcommands`, `dueWork`); mirror: tool names match `/^kernel_[a-z0-9_]{1,64}$/` and avoid `PHASE1_TOOL_NAMES`; routes must not overlap `PHASE1_ROUTES`; the subcommand name avoids `PHASE1_SUBCOMMANDS` and its help is one line (`needs a one-line help (at most 200 characters)`).
- **`kernel/src/features/contribution.ts`** — keep: `export interface ContributedRouteRequest` with `readonly params`, `readonly query`, `readonly body` unchanged; the file's own rule that it imports only zod, `../loop/types.js` and type-level kernel modules, never the Agent SDK or the tool server (`import type { Store } from "../store/store.js";` is already a type import); change: add `readonly store: Store;` and `readonly now: () => Date;` only (additive); mirror: `kernel/src/api/server.ts` `match.route.handler({ params: match.params, query, body })` must pass exactly those two new fields.
- **`kernel/src/api/server.ts`** — keep: authentication before routing, phase 1 routes matched first, the `isContributedRouteStatus(answered)` check and the `route_failed` 500 path untouched; change only the one `match.route.handler({ params: match.params, query, body })` call to also pass `store` and `now` (both already in scope: `const { store, sessions, loop, authProviders } = options;`).
- **`kernel/test/feature-seams.test.ts`** — keep: every assertion about the other four shipped features (`loomwright`, `notifications`, `approvals`, `brain`) registering nothing, the contributor order `["loomwright", "notifications", "triggers", "approvals", "brain"]`, and the route tests that spread `req.params` / `req.query` (adding fields to the request must not change `toEqual({ params: { id: "a b" }, query: { x: "1", y: "two" }, body: null })`); narrow to name `triggers`' parts explicitly: in the shipped-contributions test `expect(merged.tools).toEqual([]);`, `expect(merged.routes).toEqual([]);`, `expect(merged.subcommands).toEqual([]);`, `expect(merged.dueWork).toEqual([]);` and `for (const c of SHIPPED_CONTRIBUTIONS) expect(Object.keys(c)).toEqual(["name"]);`; in the shipped-kernel test `expect(kernelToolNames(kernel.contributions.tools)).toEqual([...KERNEL_TOOL_NAMES]);`, the `launchedTools` line, `expect(kernel.contributions.routes).toEqual([]);`, `expect(kernel.contributions.subcommands).toEqual([]);`, `expect(kernel.contributions.dueWork).toEqual([]);` and `expect(stderr.text()).toBe(` (exact phase 1 usage) after `runCli(["probe"], …)` (now the usage plus the triggers help line); in the composed-kernel tests `expect(Object.keys(tools)).toEqual([...KERNEL_TOOL_NAMES, "kernel_probe_echo"]);` (the three `kernel_trigger_*` names sit between), `expect(usage.stderr.text()).toBe(` (usage plus `studio probe <id>`) and `expect(kernel.contributions.subcommands.map((s) => s.name)).toEqual(["probe"]);` (now `["triggers", "probe"]`); the shipped-kernel test title `registers no kernel tool, API route, CLI subcommand, event handler or due work beyond phase 1's` may be renamed to say the triggers parts are the only additions; reuse: the file's helpers (`thrown`, `conflict`, `start`, `options`, `deps`, `launchedTools`).
- **`kernel/test/cli.test.ts`** — keep: `studio service with no or another action prints usage and exits 2` and its `expect(c.stderr.text()).toBe(` (exact phase 1 usage); narrow by passing `contributions: []` through the `cli()` / `serviceCli()` helpers' deps (`CliDeps.contributions`, which defaults to `SHIPPED_CONTRIBUTIONS`) so phase 1 usage stays exact; every other assertion unchanged.
- **`docs/architecture/triggers.md`** and **`docs/ARCHITECTURE.md`** — keep the H1s; both are scanned by `scripts/check-docs.sh` (`links to '$target' which does not exist`), so every relative link added must resolve; in `docs/ARCHITECTURE.md` change only the `kernel_trigger_register(type, spec) / kernel_trigger_remove` tool line, the Kill switch bullet's trigger sentence (`disables every trigger` / `Triggers do not exist until phase 2.`), the Phase 2 features sentence `All five ship empty, so nothing is preinstalled (invariant 1).` (triggers now ships agent tools and owner controls — mechanism, never a preinstalled playbook; the other four still ship empty) and the Phase 2 features Routes bullet (`The handler gets the params, the query and the parsed JSON body`).

## Closed enumerations touched

> Sibling greps at base `41425e0778cf31a3912694f32bc0a742b6ebf41e`: `grep -rnF 'due_work_failed' kernel/src docs` → 6 hits in 4 files (audit event kinds are bare string literals, no closed list in code); `grep -rnF 'last_fired_at' kernel/src docs` → 1 hit (migration 11 column); `grep -rnF 'wake_agent' kernel/src docs` → migration 11 comment, `docs/ARCHITECTURE.md` triggers row.

- **`trigger_registered`, `trigger_removed`, `trigger_fired`, `trigger_missed`, `trigger_toggled`** (audit event kinds; sibling: `due_work_failed`) — must be named in:
  - `docs/architecture/triggers.md` — the new `## Audit events` list — extend (create).
  - `kernel/src/loop/loop.ts` / `kernel/src/loop/types.ts` / `kernel/src/api/server.ts` — mention `due_work_failed` in comments only — no change: not a closed list of kinds.
- **`last_result` values `fired`, `missed_kill_switch`** (and `enabled_changed_by` `owner` / `agent`, already documented) — must be named in:
  - `kernel/src/triggers/store.ts` — the closed code-level set (new) — extend (create).
  - `kernel/src/store/migrations/011_phase_2_tables.ts` — the table comment names columns, not `last_result` values — no change: migrations are immutable once shipped.
  - `docs/ARCHITECTURE.md` triggers row (`next fire, last fired, last result, created (migration 11)`) — no change: names the column, not its values; the values are documented on `docs/architecture/triggers.md`.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/triggers.test.ts` — once trigger fires exactly one notification and disables itself | delete the line that sets `enabled = 0` for a fired `once` trigger in `kernel/src/triggers/store.ts` |
| `kernel/test/triggers-crash.test.ts` — SIGKILL after a committed fire does not fire the instant again | remove the `runStep` work-step wrapper keyed on trigger id + scheduled instant around the fire in `kernel/src/triggers/store.ts` |
| `kernel/test/triggers.test.ts` — cron trigger that missed 5 instants fires once with `missed: 5` | make the coalescing loop in `kernel/src/triggers/store.ts` fire every missed instant instead of one |
| `kernel/test/triggers.test.ts` — owner `off` cannot be undone by an agent | delete the `enabled_changed_by` owner refusal in the agent re-enable / re-register path in `kernel/src/triggers/store.ts` |
| `kernel/test/triggers.test.ts` — kill-switch window instants are `missed_kill_switch`, not fired | delete the kill-switch-window check in `kernel/src/triggers/store.ts` |
| `kernel/test/triggers.test.ts` — DST: `America/New_York` cron next fire across the March and November changes | replace the per-instant zone-offset lookup with one offset computed at registration in `kernel/src/triggers/cron.ts` |
| `kernel/test/feature-seams.test.ts` — the other four shipped features still register nothing | add `dueWork: [() => {}]` to `notificationsContribution` in `kernel/src/notifications/index.ts` (must turn the narrowed pin red) |
| `kernel/test/feature-seams.test.ts` — a contributed route receives `store` and `now` | delete `store` from the `match.route.handler(…)` call in `kernel/src/api/server.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Triggers feature: tools, due-work firing, route seam, owner CLI/API, audit, tests, docs | all | 7 modify, 6 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/triggers/cli.ts", name: "triggersSubcommand"}
  - {kind: "file", path: "kernel/src/triggers/cron.ts"}
  - {kind: "symbol", path: "kernel/src/triggers/cron.ts", name: "nextCronFire"}
  - {kind: "file", path: "kernel/src/triggers/store.ts"}
  - {kind: "symbol", path: "kernel/src/triggers/store.ts", name: "fireDueTriggers"}
  - {kind: "file", path: "kernel/src/triggers/cli.ts"}
  - {kind: "file", path: "kernel/test/triggers.test.ts"}
  - {kind: "file", path: "kernel/test/triggers-crash.test.ts"}
  - {kind: "file", path: "kernel/test/fixtures/triggers-crash.mjs"}
  - {kind: "symbol", path: "docs/architecture/triggers.md", name: "## Audit events"}
requires: []
lanes:
  - "kernel/src/triggers/**"
  - "kernel/src/features/contribution.ts"
  - "kernel/src/api/server.ts"
  - "kernel/test/triggers.test.ts"
  - "kernel/test/triggers-crash.test.ts"
  - "kernel/test/fixtures/triggers-crash.mjs"
  - "kernel/test/feature-seams.test.ts"
  - "kernel/test/cli.test.ts"
  - "docs/architecture/triggers.md"
  - "docs/ARCHITECTURE.md"
external_requires:
  - "Node >= 22 Intl.DateTimeFormat with IANA timeZone support (ICU built in)"
```

### Implementation notes (for the worker)

- **Route seam (additive):** `ContributedRouteRequest` gains `readonly store: Store` and `readonly now: () => Date`; `kernel/src/api/server.ts` passes the `store` already in scope and its `now`. Document it in the `docs/ARCHITECTURE.md` Routes bullet. Nothing else in the seam changes. A feature-seams test asserts a contributed route receives them.
- **Tools** (`kernel_trigger_register`, `kernel_trigger_remove`, `kernel_trigger_list`): register/remove take an `idempotency_key` and run through `ctx.stepKey(idempotencyKey)` with the work-step helpers so a repeated call returns the stored result. Owning agent = the calling session's `sessions.agent` (`ctx.sessions.getSession(ctx.sessionId)`); no agent name ⇒ error result. Invalid input returns an error result value (never a throw): a `once` instant in the past or without a zone (`normalizeInstant` semantics from `kernel/src/loop/internal.ts`), an unknown IANA zone, an invalid cron field. Register returns `{ id, next_fire_at }` (UTC ISO). Remove refuses a trigger the agent does not own. Re-registering the same (owner, kind, spec, action, text) while the owner turned it off, or any agent attempt to re-enable it, returns an error result saying the owner turned it off.
- **Cron** (`kernel/src/triggers/cron.ts`): 5 fields (`*`, lists, ranges, steps; day-of-week 0-7, 0 and 7 Sunday; standard OR rule when both day fields are restricted) in an IANA zone, via `Intl.DateTimeFormat(…, { timeZone })` wall-clock parts. A wall-clock time skipped by a spring-forward gap does not fire that day; a repeated wall-clock time in a fall-back overlap fires once (the first instant). No new dependency.
- **Firing** (`fireDueTriggers`, the contribution's due work): for each enabled trigger with `next_fire_at <= now`, one `runStep(store, "trigger:<id>:<scheduled instant>", …)` transaction writes the effect and the bookkeeping together: `notify` ⇒ one `notifications` row (`source` `trigger:<id>`, a title, `body` = stored text, `deep_link` `loomwright-studio://notifications/<notification id>` — the row id is known only after the insert, so insert then update `deep_link` inside the same `runStep` transaction) through ONE small local function following migration 11's column comment (item 03's record function is not on `main`); `wake_agent` ⇒ `enqueueEvent(store, { kind: "message", payload: { text, agent, trigger_id }, sourceRef: "trigger:<id>:<instant>" })`. Then `last_fired_at`, `last_result`, next fire (`cron`) or `enabled = 0`, `last_result = 'fired'` (`once`), plus one `trigger_fired` audit event.
- **Missed fires:** a `once` due while the kernel was down fires once on the first tick after; a `cron` that missed N instants fires once and its `trigger_fired` payload carries `missed: N`, then schedules the next future instant. Instants inside a kill-switch engagement window (from `kill_switch_engaged` / `kill_switch_released` in `events`, see `kernel/src/api/kill-switch.ts`) are recorded `last_result = 'missed_kill_switch'` with a `trigger_missed` event and NOT fired (a `once` is then disabled).
- **Owner control:** routes `GET /triggers` (`?all=1`), `POST /triggers/:id/on`, `POST /triggers/:id/off` and the `studio triggers` subcommand (`[--all] [--json]`, `on <id> [--yes]`, `off <id>`) in `kernel/src/triggers/cli.ts`, local-time rendering in the CLI. `on` of a past-due `once` answers a needs-confirmation status unless the body confirms; the CLI asks on a TTY and refuses without one unless `--yes` (mirror `session abandon`'s behaviour in `kernel/src/cli/index.ts`, but do NOT import from `../cli/index.js` — that would create a features → cli → features cycle, and the subcommand seam is not changed). `kernel/src/triggers/cli.ts` exports a factory `triggersSubcommand(deps?: { isInteractive?: () => boolean; confirm?: (question: string) => Promise<boolean> })` whose defaults are `process.stdin.isTTY === true` and a local `node:readline` y/yes prompt (EOF or error is a no); the shipped contribution uses the defaults and the tests build the subcommand with fakes, so the ask-and-proceed, ask-and-decline, no-TTY refusal and `--yes` paths are all tested. Toggles set `enabled_changed_by = 'owner'`, `enabled_changed_at`, and append `trigger_toggled` with `by: "owner"`. Default list shows enabled triggers; `--all` includes disabled ones.
- **Audit:** `trigger_registered`, `trigger_removed`, `trigger_fired`, `trigger_missed`, `trigger_toggled`, inserted with the same `events` shape as `appendEvent` (`actor 'kernel'`), in the same transaction as the change.

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | — | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Time-zone and DST errors make reminders fire an hour off (source requirement). | HIGH | DST tests for `America/New_York` across both changes; compute every next fire from wall-clock parts in the trigger's zone, never a fixed offset. |
| Cron + IANA zone math without a dependency is easy to get subtly wrong (Feasibility (Phase 2.5)). | MEDIUM | Own module `kernel/src/triggers/cron.ts` with table-driven tests: weekend skip, step/range/list fields, DOM/DOW OR rule, spring-forward gap, fall-back overlap. |
| The route seam extension (`store`, `now` on `ContributedRouteRequest`) is needed by sibling lanes 03, 05 and 06 too; parallel edits to `kernel/src/features/contribution.ts` and `kernel/src/api/server.ts` may conflict at the wave merge (Feasibility (Phase 2.5)). | HIGH | Keep the change to exactly the two additive fields and the one call site, worded as above, so an identical sibling edit merges cleanly or is a marker-only conflict; call it out in the PR body for the owner's wave integration. |
| Item 03 (notifications record function) is built in a parallel lane; writing the row locally may diverge (Feasibility (Phase 2.5)). | MEDIUM | Insert exactly migration 11's documented columns through one small function so wave integration can switch it to item 03's. |
| `kernel/test/feature-seams.test.ts` and `kernel/test/cli.test.ts` pin phase 1-only composition; sibling lanes adding tools/routes/subcommands change the same lines, so the wave merge may conflict there (Feasibility (Phase 2.5)). | MEDIUM | Narrow only the assertions named in Touched-file invariants; pass `contributions: []` in `cli.test.ts` so phase 1 usage stays exact regardless of siblings. |
| Double fire after a crash between the effect and the bookkeeping. | HIGH | Effect and bookkeeping commit in one `runStep` transaction keyed on trigger id + scheduled instant; SIGKILL replay test. |
| An agent undoes an owner's off. | HIGH | Refuse any agent re-enable or re-register while `enabled_changed_by = 'owner'` and `enabled = 0`; pinned test. |

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-14-triggers-wright-creates-and-the-owner-controls.md
```

## Plan Review: PASS (attempt 3/3)

| # | Severity | Section | Description | Resolution |
|---|----------|---------|-------------|------------|
| 1 | MEDIUM | Pin mutations | Rows missing for wake_agent-only, invalid spec, CLI confirm paths, one-audit-event-per-change and the changed feature-seams usage pins | deferred (worker adds a pin-mutation per new pin) |
| 2 | LOW | Implementation notes | `notifications.deep_link` is NOT NULL: insert a placeholder (`''`) then UPDATE in the same transaction | deferred |

## Outcome
- **Status:** completed
- **Completed:** 2026-10-15T01:41:19Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/49
- **Branch:** feature/04-triggers-owner-controls
- **Files changed:** 15
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Triggers feature (tools, due-work firing, route seam store+now, studio triggers, audit, docs). Phase 4.5: iteration 1 FAIL (1 HIGH + 4 MEDIUM fixed in 3102f49), iteration 2 PASS with 1 LOW dismissed. risk_classification high_risk=true (size + keyword matches). Tests 869 passed / 2 skipped.

## Not verified
- **studio triggers against the real launchd daemon and Keychain** — stub Keychain only (subtask 1)
- **default node:readline confirm and isTTY check** — tests inject fakes (subtask 1)
- **item 03/06 consumers of the notification row and message event** — sibling lanes not on main (subtask 1)
- **Linux CI run** — macOS only locally (subtask 1)
