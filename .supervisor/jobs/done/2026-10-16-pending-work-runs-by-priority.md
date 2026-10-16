# Supervisor Job: Pending work runs by priority — high, then normal, then low, oldest first within a level

## Environment
- **Project:** loomwright-studio (lane clone L3 of wave automate-2026-10-16-150622)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (sibling lanes L1 = item 02 playbook drafts, L2 = item 03 dry-run session, L4 = item 05 always-allow, L5 = item 06 token limits run in parallel; none of their `## Touches` lists `kernel/src/loop/`, `kernel/test/loop-queue-priority.test.ts`, `docs/architecture/queue.md` or `docs/ARCHITECTURE.md`)
- **Source requirement:** .supervisor/requirements/phase-3/2026-10-16-092904-pending-work-runs-by-priority.md
- **Base commit:** a60340ca29d550cf1aa4e2ab127a19fdc4577d8b

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel, better-sqlite3, vitest; same module as item 07 (event loop) |
| 2 | Dependency Availability | GO | No new dependency. `event_queue.priority TEXT NOT NULL DEFAULT 'normal'` already exists (migration 13, `kernel/src/store/migrations/013_playbooks.ts`); the closed set `PLAYBOOK_PRIORITIES` already exists in `kernel/src/playbooks/types.ts` |
| 3 | Architecture Fit | GO | Mechanism only (invariant 1): the kernel orders by a value someone else sets; it sets no priority itself. Invariant 2 unchanged (selection query only; the handling path is reused) |
| 4 | Scope vs Supervisor Capability | GO | 2 source files, 1 new test, 2 docs: one worker |
| 5 | Hard Blockers | GO | None |

**Overall Verdict:** GO

## Task
**Goal:** `enqueueEvent` accepts an optional `priority` (`low` / `normal` / `high`, default `normal`) and the event loop's tick processes eligible pending rows high first, then normal, then low, and by id within a level. Document the rule and its starvation limit.

**Problem Statement:**
`EventLoop.#runTick` (`kernel/src/loop/loop.ts`) walks pending rows with a strictly increasing id cursor (`let lastId = 0;` … `nextPendingRow(this.#store, lastId, …)`), and `nextPendingRow` (`kernel/src/loop/queue.ts`) selects `ORDER BY id LIMIT 1`. Item 01 added `event_queue.priority` (default `normal`) but nothing writes or reads it, so urgent work waits behind routine work. Success: a caller can enqueue with a priority, a tick handles high before normal before low (oldest first within a level), a parked row still waits for its `not_before`, and every existing caller and test is unchanged.

## Design decisions (binding for the worker)

1. **Enqueue.** `EnqueueParams` gains `readonly priority?: PlaybookPriority;` (type imported with `import type` from `../playbooks/types.js`; the runtime list `PLAYBOOK_PRIORITIES` imported as a value — that module is "Types only, plus the lists" and has only type imports from the loop, so no runtime cycle). `enqueueEvent` resolves `params.priority ?? "normal"` and, like the existing kind/payload/sourceRef checks, throws a `TypeError` naming the value **before** `store.transaction` when it is not one of `PLAYBOOK_PRIORITIES` (so `"urgent"`, `""` and `1` are refused and nothing is written; `undefined` and `null` mean the default, matching how `taskId`/`sessionId` treat `?? null`). The `INSERT` writes the `priority` column. The `sourceRef` duplicate path is unchanged: it returns the first row's id with `created: false` and never updates the first row's priority. `enqueueMessage` passes no priority (stays `normal`); its signature is unchanged.
2. **Row shape.** `QueueRow` gains `readonly priority: string;` and `ROW_COLUMNS` gains `priority`, so `getQueueRow` returns it. `toQueuedEvent` / `QueuedEvent` are unchanged (handlers do not need it in this item).
3. **Selection.** `nextPendingRow` becomes `nextPendingRow(store, nowIso, seen)` where `seen` is the ids already handled in this tick (`readonly number[]`). It selects the first `status = 'pending'` row with `(not_before IS NULL OR not_before <= ?)` and `id NOT IN (SELECT value FROM json_each(?))` (the seen ids as a JSON array), ordered by `CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 ELSE 1 END, id`, `LIMIT 1`. A stored value outside the closed set (only possible by hand-written SQL: there is no SQL CHECK) sorts as `normal`; say so in the function comment. No migration and no new index (the existing `event_queue_status_id` index still narrows to pending rows).
4. **The tick.** In `#runTick`, replace the `lastId` cursor with a `seen: number[]` list: each processed row's id is pushed before `#process`, and the next query excludes all of them. This keeps both guarantees the cursor gave — a row parked or left pending during this tick is not delivered twice in it, and a row a handler enqueues during the tick **is** processed in it (now at its priority: a `high` row enqueued by a handler runs before the remaining `normal`/`low` rows). Everything else in `#process`, `#finish`, `#park`, `#fail` is unchanged (requirement risk: at-most-once and the crash/redelivery path stay exactly as phase 1 built them).
5. **No starvation guard** (requirement scope 3): a steady stream of `high` rows can delay `low` rows indefinitely. No pre-emption of a running session: ordering applies to which pending row is handled next, within one tick.
6. **Comments.** Update the `EventLoop` class comment (`processes pending queue rows in id order` and `There is no ordering other than the row id`) and the `#runTick` cursor comment to the new rule; update `nextPendingRow`'s doc comment. Leave `kernel/src/store/migrations/007_event_loop.ts` untouched (an applied migration's comment describes what it built; queue.md is the current rule).
6a. **Mid-tick eligibility (a behaviour change to state, not avoid).** The old `id > lastId` cursor skipped a lower-id row whose `not_before` passed during a long tick; the `seen` list does not, so such a row is taken in that same tick at its priority. This is intended; queue.md says so in one sentence.
7. **Docs.** Replace the stub `docs/architecture/queue.md` ("Documented by the item that builds it.") with the page: what a queue row is (link to the [data model](../ARCHITECTURE.md#data-model)), `enqueueEvent`'s optional priority and its closed set and default, the ordering rule (high → normal → low, id within a level; a parked row is not eligible before `not_before` whatever its priority, and one whose `not_before` passes during a tick is taken in that tick (each row at most once per tick); a handler's enqueue in the same tick is taken at its priority; a `sourceRef` duplicate keeps the first row's priority), who sets it (not the kernel: item 08 passes the playbook's priority; invariant 1), and an `## Honest limits` section (no starvation guard; no pre-emption of a running session; an out-of-set stored value sorts as normal). In `docs/ARCHITECTURE.md` (main loop paragraph, line 89) change `processes \`pending\` rows in id order (no other ordering)` to say they are processed by priority (high, normal, low) and by id within a level, linking [the queue](architecture/queue.md). No other ARCHITECTURE.md edit.

## Acceptance Criteria
- [ ] AC1: Given pending rows enqueued as `low` (id 1), `normal` (id 2), `high` (id 3), when one tick runs, then they are handled in the order 3, 2, 1.
- [ ] AC2: Given two `high` rows, when a tick runs, then the lower id is handled first.
- [ ] AC3: Given a `high` row parked until a later time (`not_before` in the future) and a pending `low` row, when a tick runs before that time, then the `low` row is handled and the `high` row stays `pending`; when a tick runs after that time, then the `high` row is handled.
- [ ] AC4: Given an existing caller that passes no priority (`enqueueEvent` without `priority`, and `enqueueMessage`), when it enqueues, then the row's `priority` is `normal`; every existing kernel test passes unchanged.
- [ ] AC5: Given priority `urgent` (and given a non-string such as `1`), when `enqueueEvent` is called, then it throws a `TypeError` and neither an `event_queue` row nor an `event_enqueued` row is written.
- [ ] AC6: Given a row enqueued with `sourceRef` `x` at `low`, when the same `sourceRef` is enqueued again at `high`, then the first id is returned with `created: false` and the stored priority is still `low`.
- [ ] AC7: Given a pending `normal` row and a handler that, while handling it, enqueues a `high` row, when one tick runs over that `normal` row plus a pending `low` row, then the order is normal (already started), high, low — the handler's enqueue is processed in the same tick, at its priority.
- [ ] AC7b: Given a pending row whose handler throws `AdmissionRefusedError` with a `retryAt` that is strictly later than the clock when `#park` reads it (so `not_before` = that `retryAt`, not now + `DEFAULT_PARK_MS`) but not later than the clock when the tick's next `nextPendingRow` query reads it (e.g. an injected `now` that returns a scripted, increasing sequence of instants, with `retryAt` between the park's and the next query's), when one tick runs, then that row is delivered exactly once in the tick (it stays `pending` with `attempts: 1`) and is delivered again only on the next tick.
- [ ] AC8: Given the change, when the PR's files are read, then the tests live in `kernel/test/loop-queue-priority.test.ts`, `docs/architecture/queue.md` states the ordering rule, the default, the mid-tick eligibility rule and the starvation limit, and `docs/ARCHITECTURE.md` no longer says "id order (no other ordering)".
- [ ] AC9: Given the change, when `cd kernel && npm ci && npm run typecheck && npm test` and `bash scripts/check-docs.sh` run, then both exit 0.

## Touched-file invariants

> Grounded at base `a60340ca29d550cf1aa4e2ab127a19fdc4577d8b`. The worker re-checks every entry before hand-back.

- **`kernel/src/loop/queue.ts`** — keep: every refusal happens before any write (`if (!isEventKind(params.kind)) throw new TypeError(` … then `return store.transaction((): EnqueueResult => {`); the row and its audit row in one transaction (`appendEvent(store, "event_enqueued", { sessionId, taskId }, { queue_id: id, kind: params.kind, source_ref: sourceRef }, iso);`); the dedupe early return (`if (existing !== undefined) return { id: existing, created: false };`); `enqueueMessage`'s call shape (`return enqueueEvent(store, { kind: "message", payload: { text: params.text, agent }, taskId: params.taskId ?? null }, at);`). `getQueueRow` and `toQueuedEvent` callers in `kernel/test/brain.test.ts`, `kernel/test/feature-seams.test.ts`, `kernel/test/loop-queue.test.ts` read rows with `toMatchObject`, so an added `priority` field keeps them green.
- **`kernel/src/loop/loop.ts`** — keep: `#process` / `#finish` / `#park` / `#fail` byte-unchanged (the at-most-once and redelivery semantics: `UPDATE event_queue SET status = 'done', done_at = ?, attempts = attempts + ? WHERE id = ? AND status = 'pending'`); the stop check before each row (`if (this.#abortTick) break;`); `nextPendingRow` is the only selection (imported `import { nextPendingRow, toQueuedEvent } from "./queue.js";`). Pinned by `kernel/test/loop-queue.test.ts`: `it("processes pending rows in id order and marks each done only after its handler resolved"` (all-`normal` rows, so id order still holds) and `it("tick is single-flight and a handler's enqueue is processed in the same tick"` (the same-tick enqueue guarantee the `seen` list must keep).
- **`kernel/src/loop/index.ts`** — read-only: `nextPendingRow` is not exported (`export { enqueueEvent, enqueueMessage, getQueueRow } from "./queue.js";`), so its signature change has no outside caller; keep it unexported.
- **`kernel/src/playbooks/types.ts`** — read-only: `PLAYBOOK_PRIORITIES` (`export const PLAYBOOK_PRIORITIES = Object.freeze(["low", "normal", "high"] as const);`) is the closed set; do not add a second list in the loop.
- **`docs/ARCHITECTURE.md`** — edit only the main-loop sentence `processes \`pending\` rows in id order (no other ordering)`; keep every relative link valid (`bash scripts/check-docs.sh` check 1).

## Pin mutations

| Pin (new test) | Mutation that must turn it red |
|---|---|
| AC1 order 3, 2, 1 | change the `ORDER BY` in `nextPendingRow` back to `ORDER BY id` |
| AC2 two highs, lower id first | order the `CASE` key alone (drop `, id`) or order `id DESC` within a level |
| AC3 parked high waits, low runs | drop `(not_before IS NULL OR not_before <= ?)` from `nextPendingRow` |
| AC4 default `normal` | change the default in `enqueueEvent` from `"normal"` to `"low"` |
| AC5 `urgent` throws, nothing written | remove the `PLAYBOOK_PRIORITIES` check in `enqueueEvent` |
| AC6 duplicate keeps first priority | make the dedupe path `UPDATE event_queue SET priority = ?` before returning |
| AC7 handler's high enqueue runs before the pending low | revert `#runTick` to the `lastId` id cursor (`nextPendingRow(store, lastId, …)` with `id > ?`) |
| AC7b a row parked during the tick is not redelivered in it (moving clock) | drop the `seen` exclusion (`id NOT IN (SELECT value FROM json_each(?))`) from the query |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Priority on enqueue; tick selects high → normal → low, id within a level; queue doc | AC1–AC9 (incl. AC7b) | 4 modify, 1 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/loop/queue.ts"}
  - {kind: "symbol", path: "kernel/src/loop/queue.ts", name: "nextPendingRow"}
  - {kind: "file", path: "kernel/src/loop/loop.ts"}
  - {kind: "file", path: "kernel/test/loop-queue-priority.test.ts"}
  - {kind: "file", path: "docs/architecture/queue.md"}
requires: []
lanes:
  - "kernel/src/loop/queue.ts"
  - "kernel/src/loop/loop.ts"
  - "kernel/test/loop-queue-priority.test.ts"
  - "docs/architecture/queue.md"
  - "docs/ARCHITECTURE.md"
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
| A crash between handling and marking done must keep phase 1's at-most-once guarantee — Requirement risk | MEDIUM | Only the selection query and the tick's cursor change; `#process`/`#finish`/`#park`/`#fail` stay byte-unchanged (Touched-file invariants); the existing restart/redelivery tests in `loop-queue.test.ts` stay green |
| Replacing the id cursor could redeliver a row parked during the same tick (a `retryAt` only ms ahead) or drop the same-tick processing of a handler's enqueue | MEDIUM | The `seen` list excludes every row handled in this tick; AC7 pins both behaviours, and the existing same-tick test stays |
| `json_each` needs SQLite's JSON functions | LOW | better-sqlite3 bundles SQLite with JSON built in; the test suite runs the real query |
| No starvation guard: a stream of `high` rows delays `low` rows — Requirement scope 3 | LOW | Documented as an honest limit in `docs/architecture/queue.md` |
| `docs/ARCHITECTURE.md` is outside the requirement's `## Touches` (a later wave's item 09 edits it) | LOW | One-sentence edit only; no sibling lane in this wave touches it; leaving it would keep a false "no other ordering" claim |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-16-pending-work-runs-by-priority.md
```

## Plan Review: PASS (attempt 2/3; owner chose "Refine further" after attempt 1, then "Save and exit")

| # | Severity | Section | Description | Resolution |
|---|----------|---------|-------------|------------|
| 1 | LOW | Pin mutations | (attempt 1) AC7 parked-row pin passed with a fixed clock | fixed (AC7b, moving clock) |
| 2 | LOW | Acceptance Criteria | (attempt 1) AC8/AC9 not Given/When/Then | fixed |
| 3 | LOW | Design decisions | (attempt 1) migration 007 comment and mid-tick eligibility unmentioned | fixed (decisions 6, 6a) |
| 4 | LOW | Risk Assessment | Risk row 2 says "AC7 pins both behaviours"; AC7 pins same-tick enqueue, AC7b pins no redelivery | deferred |
| 5 | LOW | Touched-file invariants | `getQueueRow` caller list omits `kernel/test/loop-sessions.test.ts` and `kernel/test/kernel-daemon.test.ts` (both read only `?.status`) | deferred |
| 6 | LOW | File Impact Map | No separate File Impact Map table; the `lanes:` list and Subtask Structure count carry it | deferred |

## Outcome
- **Status:** completed
- **Completed:** 2026-10-16T10:10:09Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/67
- **Branch:** feature/04-pending-work-runs-by-priority
- **Files changed:** 5
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** enqueueEvent takes an optional closed-set priority (default normal, refused before any write); the tick picks pending rows high, normal, low (id within a level) with a per-tick seen list instead of the id cursor; queue.md documents the rule and limits. Phase 4.5 reviewer PASS on the first review (3 LOW items dismissed below the MEDIUM fix floor); CI required checks green.
