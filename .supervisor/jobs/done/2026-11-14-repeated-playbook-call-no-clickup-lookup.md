# Supervisor Job: A repeated playbook call never repeats the ClickUp name lookup (phase 8 item 21c)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-14-103216/L2
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-21/2026-11-14-120100-c-a-repeated-playbook-call-never-repeats-the-clickup-lookup.md
- **Base commit:** 02244df1bc2943059840a681ab57b4a0571f7e21

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel, vitest; no new dependency |
| 2 | Dependency Availability | GO | `runStepAsync` (`kernel/src/loop/steps.ts`) and its `noEffect` option already exist |
| 3 | Architecture Fit | GO | Same claim-before-async pattern the dry run uses (`kernel/src/playbooks/dry-run.ts`); keeps invariant 2 (state in the kernel's work steps) |
| 4 | Scope vs Supervisor Capability | GO | 1 source file + 1–2 test files; single worker |
| 5 | Hard Blockers | GO | None; tests need no network (the reader is mocked) |

**Overall Verdict:** GO

## Task
**Goal:** Make `kernel_playbook_create` and `kernel_playbook_update` claim their idempotency key before the ClickUp list-name lookup, so a repeat under the same key returns the stored first outcome without calling ClickUp again.

**Problem Statement:**
The owner (through Wright) needs a retried playbook call to return what the first call did, because today a repeat looks the list up again before the step claims its key.
Currently, `resolvedTrigger` (a live `clickup_get_list` read via `resolveClickupNames`) runs in both handlers before `runStep(ctx.store, ctx.stepKey(a.idempotency_key), …)`. If that second lookup fails (sign-in expired, timeout, list renamed), the repeat reports a failure for a playbook that was already saved, and Wright may retry under a fresh key and make a duplicate. This breaks the tools' own `REPEAT` promise.
Success looks like: no repeated create or update makes a second ClickUp call (counted by a test reader).

**Design (prescribed, so the pins below are machine-applicable):**
- Add ONE private helper in `kernel/src/playbooks/drafts.ts`, used by both handlers (one home; never two copies), named `draftStep`. It calls `runStepAsync(ctx.store, ctx.stepKey(idempotencyKey), fn, { now: ctx.now, noEffect: … })`. Inside `fn`, in this order: build the stored trigger (`storeTrigger`) and resolve the ClickUp name (`resolveClickupNames(createMcpTicketReader(), …)`, as `resolvedTrigger` does today) — the *lookup phase*; then set `phase = "write";` and run the synchronous `createPlaybook` / `updatePlaybook` and `resultOf` — the *write phase*. Declare the phase as `let phase: "lookup" | "write" = "lookup";` (the dry run's `phase` idiom) and a flag `let lookedUp = false;`, set right after the lookup as `lookedUp = resolved.spec !== stored.spec;` (true only when a lookup call was made: `resolveClickupNames` returns the text unchanged whenever it makes no call). The step options are exactly `{ now: ctx.now, noEffect: () => phase === "lookup" || (phase === "write" && !lookedUp) }`.
- `noEffect` releases the claim (`releaseClaim`) only when nothing could have happened: every error of the lookup phase (shape refusal, not found, space name, failed lookup — the lookup only reads); and a write-phase refusal **only when no lookup call was made** (the resolved spec text equals the stored spec text — a non-poll trigger, a poll that is not `clickup.tasks`, or a list/space already given as an ID, or no trigger change on an update). `createPlaybook`/`updatePlaybook` each run in one store transaction, so their refusal writes nothing; releasing in the no-lookup case keeps today's `runStep` semantics (rollback, a later same-key call runs again) byte for byte (AC3). After a successful lookup a write refusal is NOT released: `runStepAsync` records `failed:error`, and a same-key repeat rejects with `WorkStepFailedError` ("already failed (failed:error); use a new key to try again") without a lookup (AC6).
- `refuseCrewDrafting(ctx)`, `draftOwner(…)` (create) and `actingAgentFor(ctx, a.id)` (update) stay synchronous and before the claim, as in the dry run. `afterStep(ctx, first)` runs after the step on the first call and on every replay, unchanged. The `kernel_playbook_disable` tool and every other tool keep `runStep` (non-goal).
- `resolvedTrigger`'s doc comment ("a repeat that still carries the name looks it up again") is rewritten to the new truth; remove `resolvedTrigger` if `draftStep` absorbs it. No tool description text changes (`REPEAT` now holds as written).

## Acceptance Criteria
- [ ] **AC1.** Given a `kernel_playbook_create` with a `clickup.tasks` poll whose `filters.list` is a list name, and a test reader (via `vi.mock` of `../src/integrations/mcp/trackers.js`' `createMcpTicketReader`) that answers the first `clickup_get_list` call and fails every later call, when the call succeeds and is repeated with the same idempotency key, then the repeat returns a result equal to the first, the reader saw exactly one call, and one playbook row exists.
- [ ] **AC2.** Given a `kernel_playbook_update` that changes the trigger to a `clickup.tasks` poll with a list name and succeeds, when it is repeated with the same key, then the repeat returns the first result, the reader saw exactly one `clickup_get_list` call, and the playbook's version is unchanged by the repeat.
- [ ] **AC3.** Given a create or update whose list or space is already an ID (digits only), when it runs and is repeated with the same key, then the reader is never called and the repeat returns the first result; and given such a call whose write is refused, then nothing is written and a later same-key call runs again (today's `runStep` behaviour).
- [ ] **AC4.** Given a successful create (and update) with a list name, when the same key is repeated with different arguments (another list name, another `name`), then the first result is returned, no lookup is made for the new arguments, and nothing new is written.
- [ ] **AC5.** Given a first create (and update) whose name lookup fails — not found (`mcp_tool_error`), a space name, and the reader unreachable (e.g. `mcp_timeout`) — then the same refusal text as today is returned, no playbook row, no version and no `work_steps` row for the key exist (update: the playbook is unchanged), and a later call with the same key calls the reader again (and succeeds when the reader now answers). The requirement's "more than one match" case is not testable: `clickup_get_list` answers one list, so the kernel cannot see same-named lists (`kernel/src/triggers/sources/clickup-tasks.ts` comment; `docs/evidence/phase-8-21a-clickup-list-by-name.md`); "an answer whose name is another list's" (21a's refusal) stands in for it.
- [ ] **AC6.** Given a first call whose lookup succeeds but whose write is refused (e.g. `mode: live` → `live_mode_owner_only`, or an owner-set value on an update), then the refusal is returned, the key's `work_steps` row is `failed` with reason `error`, nothing is written, and a same-key repeat rejects with the `WorkStepFailedError` text (`already failed (failed:error); use a new key to try again`) without calling the reader.
- [ ] **AC7 (requirement Risks).** Given a `work_steps` row for the call's key left `started` by a crash (inserted by the test), when a create with a list name runs under that key, then it rejects with the `WorkStepInterruptedError` text (`was interrupted by a crash and is not re-runnable`), the reader is not called, and no playbook is written.
- [ ] **AC8.** `cd kernel && npm ci && npm test` is green (the existing `playbooks-drafts*.test.ts` and `clickup-scope.test.ts` suites unchanged in behaviour), `cd kernel && npm run typecheck` passes, and `bash scripts/check-docs.sh` passes.

## Touched-file invariants

> Grounded at base `02244df1bc2943059840a681ab57b4a0571f7e21`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/playbooks/drafts.ts`** — keep: the refusals before the step stay synchronous and first — `const agent = draftOwner(ctx.store, refuseCrewDrafting(ctx), a.agent);` (create) and `refuseCrewDrafting(ctx);` + `const agent = actingAgentFor(ctx, a.id);` (update); keep the post-step `return afterStep(ctx, first);` on both handlers (it refuses a repeat the owner's off overtook and rewrites the mirror); keep the `namedAsync("kernel_playbook_create", async () => {` / `namedAsync("kernel_playbook_update", async () => {` wrappers (error-text prefix) and `{ now: ctx.now }` passed to the step; keep the `REPEAT` constant text `Repeating a call with the same idempotency_key in this session returns the first result, even if other arguments differ.` unchanged; keep the `ctx.stepKey(a.idempotency_key)` key shape. reuse: `runStepAsync` and its `noEffect` option (imported from the loop feature as `runStep` is today) with the dry run's phase idiom (`let phase: Phase = "checks";` … `noEffect: (err) => phase === "checks"` in `kernel/src/playbooks/dry-run.ts`) — never a hand-rolled claim or a second lookup cache; `storeTrigger(` and `resolveClickupNames(createMcpTicketReader(), store, stored.spec)` as the lookup itself (21a's resolver unchanged — non-goal). mirror: `runStepAsync`'s contract in `kernel/src/loop/steps.ts` — `fn` rejects with an error `opts.noEffect` accepts … the claim is released; `already failed`; `was interrupted by a crash and is not re-runnable (failed:interrupted)`. Leave `kernel_playbook_disable`'s `runStep(` untouched. pinned by: `kernel/test/playbooks-drafts.test.ts` (`a repeat with the same key returns the first result and stores one playbook`), `kernel/test/playbooks-drafts-poll.test.ts` (`nothingWritten()`, `the same refusals come back from an update, which leaves the playbook as it was`), `kernel/test/clickup-scope.test.ts` (resolver behaviour, must stay green unchanged).
- **`kernel/test/playbooks-drafts-poll.test.ts`, `kernel/test/playbooks-drafts.test.ts`** — keep: every existing case unchanged in behaviour, including `function nothingWritten(): void {` and the GitHub-poll cases (they make no lookup, so the reader mock never answers them); keep `playbooks-drafts.test.ts`'s `SELECT count(*) FROM work_steps` check expecting 0 after refused writes with no lookup (it now pins AC3's release branch); keep `call(name, args)` going through `contributedToolHandler(` (the tool server's own handler, no SDK launch). reuse: the repo's `vi.mock(…, async (importActual) => ({ ...(await importActual<…>()), … }))` form (as in `kernel/test/playbooks-dry-run-poll-unit.test.ts`), replacing only `createMcpTicketReader` and leaving the rest of `trackers.js` real; the recorded `get_list_one` answer from `kernel/test/fixtures/mcp-trackers/clickup-lookup-responses.json` rather than a hand-written answer shape. New cases go in one new `describe` block in `playbooks-drafts-poll.test.ts` whose title contains `phase 8 item 21c`; `playbooks-drafts.test.ts` changes only if an existing case breaks under AC3/AC6.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/playbooks-drafts-poll.test.ts` — AC1/AC2/AC4 repeat makes no second lookup | Move the `resolveClickupNames(…)` call out of `draftStep`'s `fn` to before `runStepAsync(` (the pre-fix order): the repeat calls the reader a second time and fails |
| `kernel/test/playbooks-drafts-poll.test.ts` — AC5 failed lookup releases the key | flip `phase === "lookup"` → `phase === "never"` in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/playbooks-drafts-poll.test.ts` — AC6 write refusal after a lookup is recorded, repeat makes no lookup | delete `phase = "write";` in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/playbooks-drafts-poll.test.ts` — AC3 a refused write with no lookup releases the key | flip `&& !lookedUp` → `&& false` in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/playbooks-drafts-poll.test.ts` — AC7 crash leftover is interrupted, no lookup | Move the `resolveClickupNames(…)` call out of `draftStep`'s `fn` to before `runStepAsync(` (the pre-fix order): the reader is called before the claim sees the `started` row, so "the reader is not called" fails |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Claim the key before the ClickUp lookup in create and update; pin AC1–AC7 | all | 2–3 modify, 0 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel playbooks | `kernel/src/playbooks/drafts.ts` (859 — the create/update handlers live here; `draftStep` is a small private helper beside them, replacing `resolvedTrigger`, not a new concern) | — | HIGH |
| kernel tests | `kernel/test/playbooks-drafts-poll.test.ts` (261 — new `describe` block for AC1–AC7; stays under 500) | — | HIGH |
| kernel tests | `kernel/test/playbooks-drafts.test.ts` (966 — only if an existing case reuses a key after a refused write and must follow AC3/AC6; no new cases here) | — | LOW |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/playbooks/drafts.ts", name: "draftStep"}
  - {kind: "symbol", path: "kernel/src/playbooks/drafts.ts", name: "lookedUp"}
  - {kind: "symbol", path: "kernel/test/playbooks-drafts-poll.test.ts", name: "phase 8 item 21c"}
requires: []
lanes:
  - "kernel/src/playbooks/drafts.ts"
  - "kernel/test/playbooks-drafts-poll.test.ts"
  - "kernel/test/playbooks-drafts.test.ts"
external_requires: []
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

**Test notes for the worker:** mock the reader with `vi.mock("../src/integrations/mcp/trackers.js", async (importActual) => ({ ...(await importActual<…>()), createMcpTicketReader: () => mocks.reader }))` (the repo's existing pattern, e.g. `kernel/test/playbooks-dry-run-poll-unit.test.ts`), with a `vi.hoisted` counting reader whose answers each test sets; the existing GitHub-poll cases in the file make no lookup, so the mock does not change them. The answer shape is `clickup-lookup-responses.json`'s `get_list_one` (`kernel/test/fixtures/mcp-trackers/`). If the store refuses a `clickup.tasks` poll without a ClickUp connection, seed `mcp_connections` as `kernel/test/clickup-scope.test.ts` does (`INSERT INTO mcp_connections (kind, server_url, status, granted_tools) VALUES ('clickup', …)`).

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/playbooks/drafts.ts:207` | yes | HOLDS | `async function resolvedTrigger(store: Store, t: z.infer<typeof triggerShape>): Promise<PlaybookTriggerInput> {` | tip 20 minutes ago, fetched <1h |
| `kernel/src/playbooks/drafts.ts:424` | yes | HOLDS | `const trigger = await resolvedTrigger(ctx.store, a.trigger);` | tip 20 minutes ago, fetched <1h |
| `kernel/src/playbooks/drafts.ts:425` | yes | HOLDS | `const first = runStep(` | tip 20 minutes ago, fetched <1h |
| `kernel/src/playbooks/drafts.ts:474` | yes | HOLDS | `const changes = trigger === undefined ? rest : { ...rest, trigger: await resolvedTrigger(ctx.store, trigger) };` | tip 20 minutes ago, fetched <1h |
| `kernel/src/playbooks/drafts.ts:475` | yes | HOLDS | `const first = runStep(` | tip 20 minutes ago, fetched <1h |
| `kernel/src/playbooks/drafts.ts:234` | yes | HOLDS | `const REPEAT = "Repeating a call with the same idempotency_key in this session returns the first result, …` | tip 20 minutes ago, fetched <1h |
| `kernel/src/loop/steps.ts:346` | yes | HOLDS | `export function runStepAsync<T>(store: Store, key: string, fn: () => Promise<T>, opts: StepOptions = {}): Promise<T> {` | tip 20 minutes ago, fetched <1h |
| `kernel/src/playbooks/dry-run.ts:570` | yes | HOLDS | `const result = await runStepAsync(` | tip 20 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| AC6's wording ("recorded as today") vs today's code: today a refused write inside `runStep` rolls back and records nothing, so a same-key repeat re-runs; AC6 also asks that the repeat makes no lookup, which needs a recorded outcome. Resolved by the Design: record `failed:error` only when a lookup was made; release (today's semantics) when none was | MEDIUM | Pinned by AC3 (no-lookup refusal still re-runs) and AC6 (post-lookup refusal is terminal, no second call); the reviewer checks both branches of `noEffect` |
| Moving the write inside an async step: a crash between `started` and `done` leaves the row `started`, and the next same-key call marks it `failed:interrupted` with one `notify` instead of re-running | MEDIUM | Not re-runnable on purpose (a re-run would repeat a lookup and maybe a write); pinned by AC7 |
| A concurrent same-key call while the lookup is in flight now joins the same promise (`runStepAsync`'s in-flight map) instead of racing two lookups | LOW | Desired; no extra code |
| `vi.mock` of `trackers.js` is file-wide in `playbooks-drafts-poll.test.ts` | LOW | Spread `importActual` and only replace `createMcpTicketReader`; existing GitHub-poll cases never call it |
| A `noEffect` that inspects error types instead of the phase could release after a write | MEDIUM | Use the phase variable and the "lookup made" flag only (dry-run idiom); AC6 pin mutation `delete phase = "write";` must turn red |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-14-repeated-playbook-call-no-clickup-lookup.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-14T05:31:25Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/276
- **Branch:** feature/repeated-playbook-call-no-clickup-lookup
- **Files changed:** 2
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** kernel_playbook_create and kernel_playbook_update claim their idempotency key via the private draftStep helper (runStepAsync + phase/lookedUp noEffect) before the ClickUp list-name lookup; a same-key repeat returns the first result with no second ClickUp call. 16 new tests (AC1-AC7) in playbooks-drafts-poll.test.ts; full kernel suite 4622 passed, typecheck and check-docs green. Phase 4.5 review PASS first round; one LOW latent-coupling note dismissed below the MEDIUM floor.

## Not verified
- **Real ClickUp MCP lookup through the live reader** — the tests use a mocked reader and the recorded get_list_one answer; no network or sign-in in this run (subtask 1)
- **A real-process crash between claim and done** — AC7 simulates it by inserting a started work_steps row (subtask 1)
