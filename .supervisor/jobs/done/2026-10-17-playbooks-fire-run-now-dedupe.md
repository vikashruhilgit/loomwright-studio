# Supervisor Job: Enabled playbooks fire on schedule or on demand, run under their own policy, and skip work their dedupe key says is done

## Environment
- **Project:** loomwright-studio (lane clone L2 of wave automate-2026-10-17-091219)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (sibling lane L1 = item 07 dry run + enable runs in parallel; its `## Touches` is `kernel/src/playbooks/dry-run.ts`, `kernel/src/playbooks/enable.ts`, `kernel/test/playbooks-dry-run.test.ts`, `docs/architecture/dry-run.md` — no overlap with this brief's lanes, but both items must change the same pins in `kernel/test/playbooks-foundation.test.ts`; see Risk Assessment)
- **Source requirement:** .supervisor/requirements/phase-3/2026-10-16-092908-enabled-playbooks-fire-on-schedule-or-on-demand-once-per-dedupe-key.md
- **Base commit:** b30ae9407800a2882ecf84f660d0544ce484ad33

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel, better-sqlite3, vitest |
| 2 | Dependency Availability | GO | No new dependency. Migration 13 already has `playbook_runs`, `playbook_versions`, `sessions.playbook` / `playbook_version`, `event_queue.priority`; `enqueueEvent` already takes `priority` (item 04); `startSession` already takes `playbook` / `playbookVersion` (item 01), which items 05/06 read |
| 3 | Architecture Fit | GO | Mechanism only (invariant 1): the kernel fires what the owner enabled, under the playbook's own policy values; it picks no model and sets no priority. Invariant 2: the session's lifecycle stays the session manager's; the handler never awaits a session |
| 4 | Scope vs Supervisor Capability | CAUTION | 4 source files + 1 new test + 3 docs + 2 pin updates; one worker, but a wide one (borderline context) |
| 5 | Hard Blockers | CAUTION | The `studio playbooks` help line would be 207 characters with a `run` verb; `mergeContributions` refuses a subcommand help over 200 at module load (`kernel/src/features/contribution.ts`: `s.help.length > 200`). Resolved by design decision 7 |

**Overall Verdict:** CAUTION

### CAUTION Findings (carried to Risk Assessment)
- Help line over 200 characters breaks module load — Impact: HIGH, Mitigation: design decision 7 (compact the joined help line; drafts' verb help strings unchanged).
- Wide single worker — Impact: MEDIUM, Mitigation: binding design decisions below; one test file holds all new behaviour tests.

## Task
**Goal:** A trigger linked to an enabled playbook enqueues a playbook `message` event at the playbook's priority; the owner's `studio playbooks run <id>` enqueues the same event now; the brain's `message` handler hands a playbook event to `runs.ts`, which skips it when the playbook's dedupe key matches a run that ended `done`, and otherwise starts the owning agent's session with the version's intent as its instruction, the version's model, and `sessions.playbook` / `playbook_version` set, recording a `playbook_runs` row.

**Problem Statement:**
The owner needs an enabled playbook to wake Wright on its schedule or on demand, under the model, priority and limits they set, and never do the same work twice. Today `fireOne` (`kernel/src/triggers/store.ts`) fires a linked trigger of an enabled playbook exactly like an unlinked one (a plain `wake_agent` message with the text `Playbook <slug>`), `runsPart` is empty, no session carries a playbook's id or model, and no dedupe check exists.

## Design decisions (binding for the worker)

1. **Firing (`kernel/src/triggers/store.ts`, `fireOne`).** Replace `playbookStatus` with a raw-SQL read `SELECT id, status, version, priority, owning_agent FROM playbooks WHERE slug = ?` (still raw SQL: this module must not import the playbooks feature). The not-enabled branch is unchanged (same `trigger_missed`, reason `playbook_not_enabled`, `playbook_status` from the same read). For an enabled playbook, after the kill-switch branch (unchanged, so a kill-switch instant is still `missed_kill_switch`) and **whatever the trigger's `action`**, the effect is one `enqueueEvent(store, { kind: "message", payload: { agent: <playbooks.owning_agent>, playbook: <id>, version: <version>, trigger_id: <trigger id>, scheduled_at: <scheduledAt> }, priority: <playbooks.priority>, sourceRef: \`playbook:${id}:${scheduledAt}\` }, now)` — no notification, no plain wake text. A stored priority outside the closed set makes `enqueueEvent` throw, which fails this trigger's step (reported once by the loop) and never enqueues at a guessed priority. Bookkeeping and `trigger_fired` are as for any fire; `trigger_fired` also carries `playbook: <slug>` and `playbook_id: <id>` (the effect's `queue_id` as today). Unlinked triggers are byte-for-byte unchanged. Update the module header paragraph on linked triggers.
2. **Run now (`kernel/src/playbooks/runs.ts`).** Route `POST /playbooks/:id/run` (owner, body absent or `{}`): `400 invalid_id` / `400 invalid_body` like the drafts routes, `404 not_found`, `409 {error: "not_enabled", message}` for a `draft` or `disabled` playbook; else `enqueueEvent` the same event with no `trigger_id`, `scheduled_at` = `req.now().toISOString()`, the playbook's priority and `sourceRef` `playbook:<id>:<scheduled_at>`, answering `200 {queue_id, created, playbook: <id>, version, scheduled_at}`. Verb `run` (help `studio playbooks run <id>`) posts to it through the CLI client and prints one line `queued playbook #<id> version <v> (event <queue_id>)`, exit 0; a refusal prints the kernel's message as one safe line to stderr, exit 1; a bad id prints usage to stderr, exit 2 (the drafts verbs' conventions: reuse their quoting rules — copy the small helpers, do not import drafts' private ones).
3. **Routing (`kernel/src/brain/handler.ts`).** At the top of the returned handler, before `ensureBrainMessage`: when `event.payload.playbook !== undefined`, `return handlePlaybookMessage(ctx, { now, timeZone, loomwright })` (exported from `../playbooks/runs.js`). No `brain_messages` row is written for a playbook event (its record is the `playbook_runs` row). Every other message takes the existing path unchanged (requirement risk: `studio ask` behaviour identical). Import direction: brain → playbooks only; the playbooks feature never imports the brain's handler (it may import `buildContext`, `defuseWrapperTags`, `BRAIN_AGENTS`, `readWrightSettings`, `wrightMemoryDir`, `ensureMemoryFiles` from `../brain/*.js` files, never `../brain/index.js` or `handler.js`, so there is no runtime cycle). Neither module loads the Agent SDK or the session manager (`feature-seams.test.ts` module-graph pin).
4. **The playbook run (`handlePlaybookMessage` in `runs.ts`)**, in order, each refusal recording a run row where one is named. **Redelivery rule:** steps b–f are ONE `ctx.runStep("playbook-run", …)` keyed on the event id, which evaluates b–e, inserts exactly one `playbook_runs` row for this event (the refusal/skip row, or the `running` row) and returns `{run_id, outcome}` (`outcome` = `start` or the terminal status written). A redelivery replays that stored result and never re-evaluates b–e, so one event writes exactly one run row whatever happened between deliveries (the playbook disabled meanwhile, or the run already `done`); only `outcome: start` continues to g–j.
   - a. Payload check: `playbook` and `version` positive safe integers, `scheduled_at` a string that `Date.parse`s, `trigger_id` absent or a positive integer, `agent` a string. Anything else ⇒ throw a `TypeError` (the loop fails the event with one notify). `kind` = `fire` when `trigger_id` is present, else `run_now`.
   - b. Read the live row (`getPlaybook`) and the version's snapshot (`playbook_versions` at `(playbook, version)`, `snapshot_json` parsed). Missing row or snapshot ⇒ run row `failed`, `result_json` `{"error":"not_found"}`, return.
   - c. Live `status !== "enabled"` or live `version !== event.version` ⇒ run row `skipped_not_enabled` (result `{status, version}`), return (the owner turned it off or edited it after the event was queued).
   - d. `agent` not in `BRAIN_AGENTS` ⇒ run row `failed` `{"error":"agent_not_routed"}` (crew is phase 4), return. The snapshot's `model` null ⇒ run row `failed` `{"error":"model_unset"}` (the kernel never picks a model), return.
   - e. **Dedupe.** The snapshot's `dedupe_key_spec` null ⇒ key null, no check. Else `evaluateDedupeKey(spec, input, timeZone)` (exported, pure): for each field in spec order — `playbook.id` → id, `playbook.version` → version, `trigger.id` → trigger id or `null` (run now), `trigger.scheduled_at` → the event's `scheduled_at`, `date` → the `YYYY-MM-DD` calendar date of `scheduled_at` in `timeZone` (the host's zone by default, the `BrainHandlerDeps.timeZone` passed through; "the instant's local date", item 01) — and the key is `JSON.stringify` of that object (fields in spec order). An unparseable spec or a field outside `DEDUPE_KEY_FIELDS` ⇒ run row `failed` `{"error":"dedupe_spec_invalid"}`, return. When a `playbook_runs` row exists with this `playbook`, `kind IN ('fire','run_now')`, `dedupe_key` = key and `status = 'done'` ⇒ insert a run row `skipped_duplicate` with the key and `ended_at`, start nothing, return.
   - f. Run row: still inside the same `playbook-run` step, insert the `running` row (playbook, version, kind, dedupe_key) and return its id with `outcome: start`; a redelivery reuses it.
   - g. Settings: `ensureMemoryFiles`, then `readWrightSettings(dataDir)`; not ok ⇒ run row `failed` with the same detail text the brain writes (`model_unset: …` / `settings_invalid: …`), return. Only `permissionMode` and `policy` are used; the model is the snapshot's, never the settings'.
   - h. Prompt (`playbookPrompt`, exported): `## Playbook <slug> (#<id>, version <v>, enabled by the owner)\n\nRun this playbook. Its intent is your instruction for this session:\n\n<intent, passed through defuseWrapperTags>\n\n` followed by `buildContext({ dataDir, source: \`playbook:${id}\`, text: \`Playbook ${slug} ${kind === "fire" ? \`fired for ${scheduled_at}\` : "run now by the owner"}.\`, loomwright, now, timeZone })` (Wright's memory, Loomwright and time sections; the kernel-built line is the wrapped message). The owner approved this exact version when enabling it; any edit returns it to draft (item 02), so the intent is the owner-approved instruction. Do not edit `context.ts`.
   - i. `ctx.runStepAsync("start-session", …)`: `sessions.startSession({ agent, prompt, model: <snapshot model>, permissionMode, cwd: wrightMemoryDir(dataDir), policy, playbook: id, playbookVersion: version })` → `{session_id}`. No resume path. An admission refusal (code `admission_refused`) leaves the run row `running`, writes `result_json` `{"parked": <reason>, "retry_at": <iso|null>}`, and is rethrown (the loop parks the event); any other throw ⇒ run row `failed` `{"error": "session_refused: <first line>"}`, rethrown. `ctx.sessions` undefined ⇒ run row `failed` `{"error":"no_session_manager"}`, return.
   - j. Write `session_id` on the run row (`result_json` back to null). Attach a listener only when this delivery holds the handle (never awaited, never throws, like `attachReply`): on `handle.done` the row becomes `done` when the status is `completed`, or `stopped` with a `stop_requested` event for that session (`kernel_request_stop`); otherwise `failed` with `{"error": "session_<status>"}`. In both cases `tokens` = `SELECT COALESCE(SUM(counted_tokens), 0) FROM budget WHERE session_id = ?` and `ended_at` = now. Only a row still `running` is updated.
   - Closed set, exported from `runs.ts` (not `types.ts`, which no item in this wave edits): `PLAYBOOK_RUN_STATUSES = ["running", "done", "failed", "skipped_duplicate", "skipped_not_enabled"]`. Every write is checked against it.
5. **What a fire skips at the trigger** stays as built (item 02): a draft/disabled/missing playbook's due instant is a `trigger_missed` (`playbook_not_enabled`) and no event; that is the "recorded as skipped" of scope 1. No `playbook_runs` row is written for it.
6. **Crash safety.** The trigger's instant is one `runStep` keyed `trigger:<id>:<scheduled_at>` holding the enqueue (unchanged), and the enqueue itself dedupes on `sourceRef` `playbook:<id>:<scheduled_at>`; the handler's run row and session start are work steps keyed on the event id. So a crash after the event is queued and before the session starts delivers the event again, replays the `playbook-run` step (one run row per event, never a second skip row against its own run), and starts at most one session for that instant.
7. **Help line (`kernel/src/playbooks/index.ts`, `playbooksHelp`).** Join `studio playbooks <verb>` with each verb's help with a leading `studio playbooks ` removed: `studio playbooks <verb> | list [--all] [--json] | show <id|slug> [--json] | set <id> <field> <value> | off <id> | run <id>` (≤ 200). `PLAYBOOK_VERB_HELP` and every verb's own `help` are unchanged. Update the `PLAYBOOKS_HELP` comment. This is the only `index.ts` edit.
8. **Docs.** Replace the stub `docs/architecture/playbook-runs.md` with the page: what fires a playbook (linked trigger of an enabled playbook; `studio playbooks run`), the event (payload, priority, `sourceRef`), the handler steps a–j in prose, the dedupe key (fields, `date` in the host's zone, key format, only `done` fire/run-now runs count), `done` vs `failed`, the run statuses, crash safety, and `## Honest limits` (two events with the same key both start while the first is still running — only a run that ended `done` is a duplicate; a run whose kernel restarted mid-session stays `running`, as a brain message does; a playbook run needs Wright's settings file valid, model included, though it uses the playbook's model; `date` uses the host zone, not a cron trigger's zone; an admission-parked event keeps its run row `running`). In `docs/architecture/triggers.md`, add to the Firing section that a linked trigger of an enabled playbook enqueues the playbook's message (link [playbook runs](playbook-runs.md)) and add `playbook` / `playbook_id` to the `trigger_fired` audit line. In `docs/architecture/brain.md`, add to the Routing section (outside the pinned `role.md` template block) that a message carrying `playbook` goes to playbook runs and writes no `brain_messages` row. In `docs/architecture/playbooks.md` (line 5), replace the sentence saying a fire is item 08's and "Until then no playbook starts work" with one that links [playbook runs](playbook-runs.md) as built.

## Acceptance Criteria
- [ ] AC1: Given an enabled playbook (priority `high`, model set) with a cron trigger, when the instant comes and the loop ticks, then exactly one `message` event with payload `{agent, playbook, version, trigger_id, scheduled_at}`, priority `high` and `sourceRef` `playbook:<id>:<instant>` is queued, and the brain starts one session whose `startSession` params carry the playbook's model (not Wright's settings model), `playbook: <id>` and `playbookVersion: <version>`, and a `playbook_runs` row of kind `fire` reads `running` with that `session_id`.
- [ ] AC2: Given a draft or a disabled playbook, when its trigger comes due, then nothing is queued and one `trigger_missed` (`playbook_not_enabled`) is recorded.
- [ ] AC3: Given a dedupe spec `["date"]` and a `fire` run of that playbook that ended `done` today, when it fires again today, then a `skipped_duplicate` run with the same key is recorded and no session starts; when it fires tomorrow, then a session starts.
- [ ] AC4: Given `studio playbooks run <id>` on an enabled playbook, when run, then one event is queued with `scheduled_at` = now (no `trigger_id`), the run row's kind is `run_now`, and the CLI prints the queued line and exits 0; given a draft playbook, the route answers 409 `not_enabled`, nothing is queued, and the CLI exits 1.
- [ ] AC5: Given a crash after the event is queued and before the session starts (the handler's start-session step not done), when the kernel restarts and the event is redelivered, then at most one session starts for that instant and there is exactly one `fire` run row for it.
- [ ] AC5b: Given a playbook event whose run already ended `done` (or whose playbook was disabled after its run row was written), when the same event is redelivered (the loop crashed before marking it done), then no second run row is written (no `skipped_duplicate` / `skipped_not_enabled` row against its own run) and no session starts.
- [ ] AC6: Given an unlinked trigger (`notify` and `wake_agent`), when it fires, then behaviour is unchanged and every existing trigger and brain test passes (`studio ask` unchanged).
- [ ] AC7: Given a playbook session that ends `completed` (or `stopped` after `kernel_request_stop`), when it ends, then its run row is `done` with `tokens` = the session's counted budget tokens; given one that ends `failed`, then the run row is `failed`.
- [ ] AC8: Given an event queued while enabled and the playbook disabled (or edited to a new version) before the handler runs, when it is handled, then the run row is `skipped_not_enabled` and no session starts.
- [ ] AC9: Given the change, when the PR's files are read, then the new tests live in `kernel/test/playbooks-runs.test.ts` (stand-in session manager, injected clock), `docs/architecture/playbook-runs.md` is no longer a stub, and the `studio playbooks` help line is at most 200 characters.
- [ ] AC10: Given the change, when `cd kernel && npm ci && npm run typecheck && npm test` and `bash scripts/check-docs.sh` run, then both exit 0.

## Touched-file invariants

> Grounded at base `b30ae9407800a2882ecf84f660d0544ce484ad33`. The worker re-checks every entry before hand-back.

- **`kernel/src/triggers/store.ts`** — keep: raw SQL over `playbooks`, never an import of the playbooks feature (`// The status is read with raw SQL: this module never imports the playbooks`); the not-enabled branch's event shape (`{ trigger_id: id, reason: "playbook_not_enabled", playbook: row.playbook, playbook_status: status, scheduled_at: scheduledAt, enabled: !once, ...counts }`), pinned by `kernel/test/triggers.test.ts` (`a linked trigger of a playbook that is not enabled starts no work`) and `kernel/test/playbooks-drafts.test.ts` (`reason: "playbook_not_enabled", playbook: "daily-repo-summary"`); the not-enabled check before the kill-switch one; the unlinked `wake_agent` enqueue byte-unchanged (`payload: { text: row.action_payload, agent: row.owning_agent, trigger_id: id }, sourceRef: \`trigger:${id}:${scheduledAt}\``); everything inside `fireOne` stays inside `runStep`'s transaction (`runStep(store, fireStepKey(row.id, scheduledAt), () => fireOne(`). The test `a linked trigger of an enabled playbook fires as an unlinked trigger does (what a playbook fire does is item 08's)` asserts the old behaviour and must be rewritten to the new effect (a playbook message, no notification).
- **`kernel/src/brain/handler.ts`** — keep: the module imports only types from the loop and the session manager (`// Imports only types from the loop and the session manager`); the non-playbook path byte-unchanged (`const row = ensureBrainMessage(store, { queueId: event.id, agent, source: messageSourceOf(event.payload), text }, now());`); `admissionRefusal` tells the refusal by code (`(err as { code?: unknown }).code !== "admission_refused"`) — reuse the same rule in `runs.ts` (copy, do not import a private function). Pinned by `kernel/test/brain.test.ts` (`expect(Object.keys(brainContribution)).toEqual(["name", "routes", "subcommands", "handlers"]);` and the message-handler identity).
- **`kernel/src/playbooks/runs.ts`** — keep the part shape (`export const runsPart: PlaybookPart = Object.freeze({ name: "runs", …`), frozen; claim no `message` handler in the part (the brain owns `message`: a second owner is a `ContributionConflictError` at merge).
- **`kernel/src/playbooks/index.ts`** — keep: `PLAYBOOK_PARTS` order (`Object.freeze([draftsPart, dryRunPart, enablePart, runsPart])`); `playbooksSubcommand`'s run/help/unknown-verb behaviour; edit only `playbooksHelp`, its comment, the `PLAYBOOKS_HELP` comment and the module header sentence listing which parts are filled (`today \`drafts\` is filled`). `kernel/src/features/contribution.ts` refuses a subcommand help over 200 (`s.help.length > 200`) — read-only.
- **`kernel/src/playbooks/types.ts`** — read-only: `PLAYBOOK_RUN_KINDS` (`["dry_run", "fire", "run_now"]`), `DEDUPE_KEY_FIELDS` (`["playbook.id", "playbook.version", "trigger.id", "trigger.scheduled_at", "date"]`), `PLAYBOOK_PRIORITIES` are the closed sets; do not add a second list.
- **`kernel/test/playbooks-foundation.test.ts`** — pins that change: the merged routes list (add `POST /playbooks/:id/run`), the `PLAYBOOKS_HELP` literal and verbs list (add `run`), and the empty-part loop (`for (const part of [dryRunPart, enablePart, runsPart])` — drop `runsPart`, pin its route and verb instead). Keep every other assertion; `Object.keys(playbooksContribution)` stays `["name", "tools", "routes", "subcommands", "dueWork"]` (no handler is added).
- **`docs/architecture/brain.md`** — keep the pinned `role.md` template block (the fenced `# Wright` … block under `### The first-run \`role.md\``) byte-unchanged.

## Pin mutations

| Pin (new test) | Mutation that must turn it red |
|---|---|
| AC1 payload, priority and `sourceRef` | enqueue the old plain `wake_agent` payload for linked enabled triggers |
| AC1 session model is the playbook's | pass `settings.settings.model` instead of the snapshot's model |
| AC1 session carries playbook id/version | drop `playbook` / `playbookVersion` from `startSession` params |
| AC2 draft/disabled queues nothing | remove the `status !== "enabled"` check in `fireOne` |
| AC3 same-day duplicate skipped | drop the `status = 'done'` dedupe query |
| AC3 next day runs | compute `date` from `now` instead of the event's `scheduled_at` |
| AC4 draft refused 409 | remove the `not_enabled` check in the run route |
| AC5 at most one session after redelivery | start the session outside `ctx.runStepAsync` |
| AC5b one run row per event on redelivery | evaluate steps b–e outside the `playbook-run` step |
| AC7 `done` / `failed` by session end | mark every ended run `done` |
| AC8 disabled-after-queue skipped | drop the live status/version check in the handler |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Linked triggers fire the playbook; run now; dedupe skip; playbook sessions and run rows; docs | AC1–AC10 (incl. AC5b) | 10 modify, 1 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/playbooks/runs.ts"}
  - {kind: "symbol", path: "kernel/src/playbooks/runs.ts", name: "handlePlaybookMessage"}
  - {kind: "symbol", path: "kernel/src/playbooks/runs.ts", name: "evaluateDedupeKey"}
  - {kind: "symbol", path: "kernel/src/playbooks/runs.ts", name: "PLAYBOOK_RUN_STATUSES"}
  - {kind: "file", path: "kernel/test/playbooks-runs.test.ts"}
  - {kind: "file", path: "docs/architecture/playbook-runs.md"}
requires: []
lanes:
  - "kernel/src/playbooks/runs.ts"
  - "kernel/src/playbooks/index.ts"
  - "kernel/src/triggers/store.ts"
  - "kernel/src/brain/handler.ts"
  - "kernel/test/playbooks-runs.test.ts"
  - "kernel/test/playbooks-foundation.test.ts"
  - "kernel/test/triggers.test.ts"
  - "docs/architecture/playbook-runs.md"
  - "docs/architecture/triggers.md"
  - "docs/architecture/brain.md"
  - "docs/architecture/playbooks.md"
external_requires: []
```

## Parallelism Analysis
single-agent (no fan-out)

### Dependency Graph
```
Subtask 1 (single subtask)
```

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The `studio playbooks` help line exceeds 200 characters with a `run` verb and the contribution merge throws at module load — Feasibility (Phase 2.5) | HIGH | Design decision 7 compacts the joined line; AC9 pins ≤ 200 |
| Sibling lane L1 (item 07) also changes `kernel/test/playbooks-foundation.test.ts` (its tools list and the empty-part loop), so the wave merge may conflict there | MEDIUM | Change only the pins this item breaks (routes, help/verbs, `runsPart` out of the empty loop); a marker-only conflict is resolved in the wave merge commit per the wave conflict rules |
| Brain handler changes must keep `studio ask` behaviour identical — Requirement risk | MEDIUM | The playbook branch returns before `ensureBrainMessage`; the rest is byte-unchanged; existing brain tests stay green (AC6) |
| Item 07 (parallel) may write its own dedupe-key evaluator for the dry run's "would skip" line, and the two could disagree | MEDIUM | `evaluateDedupeKey` is exported, pure and documented in playbook-runs.md; a follow-up can make item 07 call it |
| Wide single worker (10 modified files + 1 new test + docs) — Feasibility (Phase 2.5) | MEDIUM | Binding design decisions; all new behaviour tests in one file |
| `date` uses the host's zone, not a cron trigger's `tz` | LOW | Documented as an honest limit; item 01 defines `date` as "the instant's local date" |
| `PLAYBOOK_RUN_STATUSES` lives in `runs.ts`, not `types.ts` | LOW | Keeps `types.ts` out of both lanes; can move later with no behaviour change |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-17-playbooks-fire-run-now-dedupe.md
```

## Plan Review: PASS (attempt 2/3; owner: "Save and exit")

| # | Severity | Section | Description | Resolution |
|---|----------|---------|-------------|------------|
| 1 | MEDIUM | Design decisions (4, 6) | (attempt 1) refusal/skip rows written outside a work step, so a redelivery could add a second row | fixed (one playbook-run step per event, AC5b) |
| 2 | LOW | Subtask Structure | (attempt 1) file count off by one | fixed |
| 3 | LOW | Design decisions (8) | (attempt 1) docs/architecture/playbooks.md line 5 goes stale | fixed |
| 4 | LOW | Touched-file invariants | (attempt 1) index.ts comments/header excluded | fixed |
| 5 | LOW | Design decisions (4) | PLAYBOOK_RUN_STATUSES not tied to item 07 dry-run statuses | deferred |
| 6 | LOW | Design decisions (4) | keep b–e refusals as returns that write a row, never throws (a throw rolls the step back) | deferred (worker note) |

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-17T05:20:20Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/73
- **Branch:** feature/08-playbooks-fire-run-now-dedupe
- **Files changed:** 11
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Linked triggers of enabled playbooks queue the playbook message at its priority; run now (route + verb, 409 under the kill switch); handlePlaybookMessage runs one playbook-run step per event (dedupe skip, live re-check inside start-session, one run row per event), playbook sessions with the version's model and ids; help line compacted; docs. Phase 4.5: iteration 1 FAIL (HIGH stale-replay + MEDIUM kill switch), iterations 2 and 3 reviewer PASS each with one MEDIUM at the floor (crash-window overwrite; coverage), all fixed; the final tests-only fix (3080d7c) is not re-reviewed. Local gates: typecheck, 1349 tests, check-docs green. risk_classification high_risk=true (size + token/migration content).

## Not verified
- **studio playbooks run against a running daemon (runCli over the loopback HTTP API)** — the verb was exercised with an in-process client calling the route handler (subtask 1)
- **a real SessionManager start with playbook/playbookVersion (its params check and admission)** — only a stand-in EventSessions was used; no SDK or model (subtask 1)
