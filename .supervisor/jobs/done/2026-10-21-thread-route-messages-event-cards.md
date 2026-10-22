# Supervisor Job: GET /threads/:agent interleaves an agent's messages with one-line event cards

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-21-052020/L5
- **CLAUDE.md:** ✓ Found (fresh — console layout, route seam and invariants match `kernel/src/console/` at base)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (sibling lane L4 — item 05 pause — edits the same console seam pins in this wave; see Risk Assessment)
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140006-a-thread-route-interleaves-messages-and-event-cards.md
- **Base commit:** 2b31dd8218e2008e2ad7375d9ad7c16e06c35dd4

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest kernel; a contributed route on the existing `ConsolePart` seam (`kernel/src/console/types.ts`), same as `events.ts` / `output.ts`. |
| 2 | Dependency Availability | GO | No new npm dependency: SQLite via the kernel `Store`, existing helpers `approvalView` (`kernel/src/approvals/store.ts`), `getAgent` (`kernel/src/agents/registry.ts`), `shown` (`kernel/src/approvals/cli.ts`), `ASK_AGENT` (`kernel/src/brain/routes.ts`). |
| 3 | Architecture Fit | GO | Read-only, mechanism-only route (invariant 1); contract types `ThreadsQuery` / `ThreadItem` / `ThreadResponse` already exist in `app/src/api/contract.ts` (item 01), and `console-contract.test.ts` already lists `GET /threads/:agent` with origin `item-06`. |
| 4 | Scope vs Supervisor Capability | GO | ~6 files, well under the `context-bound` bound; one coherent group → single subtask. |
| 5 | Hard Blockers | CAUTION | None in code. The requirement's Touches (3 files) omit three seam files the change must also edit to stay green/accurate (`kernel/test/console-foundation.test.ts` pins `threadsPart` empty; `kernel/src/console/index.ts` and `docs/ARCHITECTURE.md` say threads is empty). Those files belong to item 01 (merged in an earlier wave), not to a same-wave item, and wave-1 items 02–04 edited them the same way (merge `c991632`), so editing them is allowed — but sibling lane L4 (item 05) edits the same lines in parallel. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Fill the console's `threads` part with `GET /threads/:agent?before=<cursor>&limit=<n>`, which returns one agent's brain messages interleaved with one-line kernel event cards in time order, paged backwards, plus the agent's pending approvals, and document it in `docs/architecture/threads.md`.

**Problem Statement:**
The owner needs one route that returns an agent's whole thread (what was said and what the kernel did about that agent) because Chat and each Crew thread render exactly that (DESIGN.md §5, D25).
Currently, `GET /messages` lists `brain_messages` rows and the append-only `events` table holds what the kernel did, but nothing joins them per agent, so the app would have to fetch and correlate everything itself. This causes the mockup's interleaved EventCards (session started, playbook created, approval decided) and the inline pending approval to be unbuildable from the API.
Success looks like a single paged read whose items interleave in a stable `(time, id)` order, with escaped one-line summaries, an opaque cursor, and `404` for an unknown agent.

**Design (from the requirement's Scope; binding unless a fact below contradicts it):**
- **Route:** `GET /threads/:agent` in `kernel/src/console/threads.ts`, exported as `threadsPart` (route list non-empty, no tools/handlers/subcommands/dueWork). Response `{items, next_before, pending_approvals}` exactly as `ThreadResponse` in `app/src/api/contract.ts`. **Do not change the contract.**
- **Valid agents:** `wright` (`ASK_AGENT`) and every agent `getAgent(store, id)` returns (any status). Anything else → `404 {error: "no_such_agent"}` (the name `brain/routes.ts` already uses).
- **Message items:** `{type: "message", …row}` for every `brain_messages` row with `agent = :agent OR from_agent = :agent` (a delegation `wright → mason` is the row `agent: "mason", from_agent: "wright"`, so it appears in both threads, its `from_agent` field marking it as quoted data from its source). `threads.ts` restates the 15-column list locally (the same columns as the module-private `COLUMNS` in `kernel/src/brain/messages.ts`, typed as the exported `BrainMessageRow`); it neither imports nor exports `COLUMNS`, since `brain/messages.ts` is outside the lanes. Order key: `created_at`.
- **Event items:** `{type: "event", id, at, kind, summary, ref}` from `events`, restricted to a closed list exported from `threads.ts` (e.g. `THREAD_EVENT_KINDS`) of **existing** kinds only, each tied to the agent as follows:
  - `session_status` whose payload `to` is `running` (session started) or a terminal status per `isTerminalStatus` in `kernel/src/sessions/types.ts` (session ended), for a session whose `sessions.agent = :agent`;
  - `playbook_created`, `playbook_updated`, `playbook_enabled`, `playbook_disabled` for a playbook (`payload.playbook_id`) whose `playbooks.owning_agent = :agent`;
  - `approval_requested`, `approval_decided` for an approval (`payload.id`) whose `approvals.requesting_agent = :agent`;
  - `agent_created`, `agent_renamed`, `agent_settings_set`, `agent_status_changed` whose `payload.id = :agent`;
  - `trigger_fired` for a trigger (`payload.trigger_id`) whose `triggers.owning_agent = :agent`;
  - `memory_updated` is **not** listed: no writer exists at base (`grep -rn memory_updated kernel/src` → 0 hits). Non-goal: no new event kinds.
  - `summary` is one kernel-written line (no `\n`), built from the kind and stored fields; every stored name/slug/display string inside it passes through `shown` (`kernel/src/approvals/cli.ts`) so control and bidi characters are escaped. `ref` is a small object naming the referenced row (e.g. `{session_id}`, `{playbook_id}`, `{approval_id}`, `{trigger_id}`), never the raw payload.
- **Pending approvals:** `pending_approvals` = the agent's `status = 'pending'` approvals (`requesting_agent = :agent`), oldest first, each mapped through `approvalView`.
- **Ordering and paging:** one merged order over both sources by `(at, type, id)` (message `created_at` / event `at` are both ISO-8601 UTC ms text, so string compare is time order; `type` breaks a tie between a message and an event with the same id). A page is the newest `limit` items strictly before the cursor, returned oldest → newest. `next_before` is an opaque string (e.g. base64url of the oldest item's key) when older items remain, else `null`. `limit`: default 50, 1–200, else `400 {error: "invalid_limit"}`; an undecodable `before` → `400 {error: "invalid_before"}`. Read-only: no writes, no new migration or index (Touches forbid it).
- **Docs:** `docs/architecture/threads.md` replaces its item-01 stub (keeping `# Threads`, adding a `## Paging` section among others) with the item shapes, the event-kind list (and which agent each is tied by), the summary escaping, and the paging/cursor rules.

## Acceptance Criteria
- [ ] 1. Given Wright's three messages and, between them, a `session_status` (to `running`) event for a Wright session, a `playbook_created` event for a Wright-owned playbook and an `approval_requested` event for a pending Wright approval, when `GET /threads/wright`, then the six items come back interleaved in time order, each event with a one-line `summary`, and `pending_approvals` lists exactly that pending approval.
- [ ] 2. Given 120 thread items for one agent, when paging with `limit=50` from no cursor and then following `next_before`, then exactly three pages (50, 50, 20) cover all 120 items with no duplicates and no gaps, and the third page's `next_before` is `null`.
- [ ] 3. Given a delegation from Wright to `mason` (a `brain_messages` row `agent: "mason", from_agent: "wright"`), when `GET /threads/wright` and `GET /threads/mason`, then the row appears in both, with `from_agent: "wright"`.
- [ ] 4. Given an agent that is neither `wright` nor registered, when `GET /threads/<it>`, then `404`; and given a playbook whose slug contains a control character (e.g. `\u001b`), when its `playbook_created` event appears in the thread, then that item's `summary` contains the escaped form and no raw control character.
- [ ] 5. Given an event of a kind outside the closed list (e.g. `session_output_appended`) or an event about another agent, when `GET /threads/:agent`, then it is not in the items; given `limit=0`, `limit=201` or an undecodable `before`, then `400`.
- [ ] 6. `docs/architecture/threads.md` documents the item shapes, the event-kind list and the paging, `kernel/src/console/index.ts` and `docs/ARCHITECTURE.md` no longer say the threads part is empty, and `bash scripts/check-docs.sh` passes.
- [ ] 7. `cd kernel && npm ci && npm run typecheck && npm test` passes, including `console-foundation.test.ts` (updated to pin the threads route) and `feature-seams.test.ts`'s module-graph pin (no Agent SDK, session manager or `kernel.ts` value import reachable from `threads.ts`).

## Touched-file invariants

> Grounded at base `2b31dd8218e2008e2ad7375d9ad7c16e06c35dd4`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/console/threads.ts`** — keep: the export name and shape consumed by `index.ts` (`export const threadsPart: ConsolePart`) and `name: "threads"` (pinned by `console-foundation.test.ts`: `["events", "output", "control", "pause", "threads"]`); reuse: the `events.ts` route idiom — `Object.freeze({ ...emptyConsolePart("events"), routes: Object.freeze([eventsRoute]) })` and its query regexes `const POSITIVE_INT = /^[1-9][0-9]{0,15}$/;` returning `{ status: 400, body: { error: "invalid_limit" } }`; reuse `approvalView` and `shown` rather than new serializers/escapers; mirror: `ThreadItem` / `ThreadResponse` in `app/src/api/contract.ts` (`readonly next_before: string | null;`, `readonly pending_approvals: readonly Approval[];`) exactly — the contract is item 01's and must not change; keep: only type imports from the SDK/session manager — `types.ts`: `nothing here may pull in the Agent SDK, the session manager or \`kernel.ts\`` (enforced by `feature-seams.test.ts`: `SDK_IN_GRAPH`).
- **`kernel/test/console-foundation.test.ts`** — keep: every other part's pins unchanged (`expect(CONSOLE_PARTS).toEqual([eventsPart, outputPart, controlPart, pausePart, threadsPart]);`); change only the threads tokens, in every place the file pins the console's routes or calls threads empty:
  - the contribution test: `expect(consoleContribution.routes).toEqual([...eventsPart.routes, ...outputPart.routes, ...controlPart.routes]);` gains `...threadsPart.routes`, and the merged owner list ending `"POST /sessions/:id/kill",` gains `"GET /threads/:agent"`;
  - the parts test: remove `threadsPart` from `for (const part of [pausePart, threadsPart]) {` (leave `pausePart`), add a threads route pin written as a literal (`expect(threadsPart.routes.map((r) => ({ method: r.method, path: r.path }))).toEqual([{ method: "GET", path: "/threads/:agent" }])`, no tools/handlers, the same literal style as the control pin), and add `...threadsPart.routes` to the `mergeConsoleParts(CONSOLE_PARTS)` expectation's `routes: [...eventsPart.routes, ...outputPart.routes, ...controlPart.routes],`;
  - the wording: the header comment `` `events`, `output` and `control`, the others are still empty `` and the two test titles (`it("is its name, the events, output and control parts' routes` and `control has stop and kill, the rest are empty`) name the threads route.
  Same-wave lane L4 (item 05) edits these same lines for `pausePart` — keep each edit to the threads tokens.
- **`kernel/src/console/index.ts`** — keep: `CONSOLE_PARTS` order and `mergeConsoleParts` / `consoleContributionOf` untouched; change only the header comment (`Today three parts are filled: events (the`) to name the threads part's `GET /threads/:agent` route. Add re-exports of new public `threads.ts` names next to `export { threadsPart } from "./threads.js";` only if the test imports them from the index.
- **`docs/ARCHITECTURE.md`** — keep: the console paragraph's structure; change only `Today three parts are filled` (to four, adding the threads part's route), the claim `` `pause.ts` and `threads.ts` are empty `` and the route count in `so the contribution is its name, those five routes and that subcommand` to include the threads route with a link to [threads](architecture/threads.md) (the doc table row `| [threads](architecture/threads.md) | 06 |` already exists). Links must resolve (`scripts/check-docs.sh` check 1).
- **`docs/architecture/threads.md`** — keep: the first line's parent link `[Phase 5 features](../ARCHITECTURE.md#phase-5-features)` and the `**Routes:** \`GET /threads/:agent\`.` line; replace `Today (item 01) the part is empty.` with the real content.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/console-threads.test.ts` — interleaving test (AC 1) | in `kernel/src/console/threads.ts`, reverse the merged sort (newest → oldest within a page): the order assertion must turn red |
| `kernel/test/console-threads.test.ts` — paging test (AC 2) | in `kernel/src/console/threads.ts`, make the cursor comparison inclusive (`<=` instead of `<`): the no-duplicates assertion must turn red |
| `kernel/test/console-threads.test.ts` — delegation test (AC 3) | in `kernel/src/console/threads.ts`, drop the `OR from_agent = ?` clause: the sender's-thread assertion must turn red |
| `kernel/test/console-threads.test.ts` — escaping test (AC 4) | in `kernel/src/console/threads.ts`, interpolate the playbook slug without `shown(...)`: the no-raw-control-character assertion must turn red |
| `kernel/test/console-threads.test.ts` — unknown agent (AC 4) | in `kernel/src/console/threads.ts`, skip the `getAgent` / `ASK_AGENT` check: the `404` assertion must turn red |
| `kernel/test/console-threads.test.ts` — closed-list filter (AC 5) | in `kernel/src/console/threads.ts`, drop the `THREAD_EVENT_KINDS` restriction from the events query: the `session_output_appended` exclusion assertion must turn red |
| `kernel/test/console-threads.test.ts` — other agents' events (AC 5) | in `kernel/src/console/threads.ts`, drop the per-agent join condition for one kind (e.g. the `owning_agent = ?` playbook test): the other-agent exclusion assertion must turn red |
| `kernel/test/console-threads.test.ts` — limit bounds (AC 5) | in `kernel/src/console/threads.ts`, raise the largest limit from 200 to 201: the `limit=201` → `400` assertion must turn red |
| `kernel/test/console-threads.test.ts` — undecodable cursor (AC 5) | in `kernel/src/console/threads.ts`, fall back to "no cursor" when `before` fails to decode: the `invalid_before` → `400` assertion must turn red |
| `kernel/test/console-foundation.test.ts` — the literal pins (merged owner list's `"GET /threads/:agent"`, the new threads part route pin) | flip `"/threads/:agent"` → `"/thread/:agent"` in `kernel/src/console/threads.ts`; separately, empty `threadsPart.routes` in `kernel/src/console/threads.ts` (both literal pins turn red) |
| `kernel/test/console-foundation.test.ts` — the copying pins (`expect(consoleContribution.routes)…` and the `mergeConsoleParts(CONSOLE_PARTS)` routes, both built from `...threadsPart.routes`) | mutation probe only (never an edit the worker makes): delete `threadsPart` from `CONSOLE_PARTS` in `kernel/src/console/index.ts`; both copying pins (and `expect(CONSOLE_PARTS).toEqual(…)`) turn red. The path flip cannot reach them by construction; the literal pins above cover the path |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Thread route, tests, seam pins and docs | all | 5 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/console/threads.ts"}
  - {kind: "symbol", path: "kernel/src/console/threads.ts", name: "threadsPart"}
  - {kind: "symbol", path: "kernel/src/console/threads.ts", name: "THREAD_EVENT_KINDS"}
  - {kind: "file", path: "kernel/test/console-threads.test.ts"}
  - {kind: "symbol", path: "docs/architecture/threads.md", name: "Paging"}
requires: []
lanes:
  - "kernel/src/console/threads.ts"
  - "kernel/test/console-threads.test.ts"
  - "docs/architecture/threads.md"
  - "kernel/test/console-foundation.test.ts"
  - "kernel/src/console/index.ts"
  - "docs/ARCHITECTURE.md"
external_requires: []
```

## Parallelism Analysis

single-agent (no fan-out)

### File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| route | `kernel/src/console/threads.ts` (stub today) | — | HIGH |
| tests | `kernel/test/console-foundation.test.ts` | `kernel/test/console-threads.test.ts` | HIGH |
| seam text | `kernel/src/console/index.ts` (comment), `docs/ARCHITECTURE.md` (one paragraph) | — | HIGH |
| docs | `docs/architecture/threads.md` (stub today) | — | HIGH |

Validator-owned surfaces: `scripts/check-docs.sh` scans every `docs/**/*.md` link plus `CLAUDE.md` / `README.md`; only the two docs above change, and both must keep their links resolvable.

### Batch Plan
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

Test pattern to follow: `kernel/test/console-control.test.ts` / `console-output.test.ts` (temp data dir via `mkdtempSync`, a real `Store`, the route reached through `compileRoutePath` / `matchRoutePath` or the part's handler with a `ContributedRouteRequest` literal). Seed rows with the real writers where they are cheap (`ensureBrainMessage`, `requestApproval`, `appendEvent`) and direct `INSERT`s for `sessions` / `playbooks` / `triggers` rows.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): sibling lane L4 (item 05, pause) edits the same lines of `kernel/test/console-foundation.test.ts`, the `kernel/src/console/index.ts` header and the `docs/ARCHITECTURE.md` console paragraph in this wave, so whichever merges second conflicts. | MEDIUM | Edit only the threads-specific tokens (see Touched-file invariants) and never edit `pause.ts` or its pins. If the second-merged lane conflicts, escalate per the merge-conflict rule (never force-resolve); wave 1's merge `c991632` shows the conflict is small and local, but resolving it is not this worker's call. |
| Feasibility (Phase 2.5): the requirement's Touches list 3 files but the suite and docs need 3 more (foundation test, index comment, ARCHITECTURE). | MEDIUM | They are item 01's seam files from an earlier wave, not a same-wave item's, so the requirement's stop rule does not fire; the PR body names the three extra files and why. If a reviewer reads the Touches rule more strictly, stop and say so rather than widening further. |
| Merge-paging across two tables can duplicate or skip items at equal timestamps. | MEDIUM | Single total order `(at, type, id)`, strict `<` against the decoded cursor in both source queries, fetch `limit + 1` per source then merge and cut; AC 2 seeds equal timestamps across both sources. |
| `events` has no index on `kind`/`session_id`, so per-agent filtering scans the table. | LOW | Read-only and bounded by `limit`; filter with `kind IN (…)` and `id`/`at` ordering; adding an index needs a migration outside the Touches — out of scope, note it in `threads.md`. |
| Event payloads are untrusted data (invariant 3); a stored name could carry control/bidi characters or be missing. | MEDIUM | Summaries only read typed fields, fall back to a generic sentence when a field is absent or not a string, and pass every stored string through `shown`; AC 4 pins the escaping. |
| The contract (item 01) may not fit (e.g. a need for an extra field to mark quoted data). | LOW | Requirement risk: stop and say so; do not change `app/src/api/contract.ts`. `from_agent` on the row already marks a delegation as quoted data. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-21-thread-route-messages-event-cards.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-21T16:31:21Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/108
- **Branch:** feature/thread-route-messages-event-cards
- **Files changed:** 6
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** GET /threads/:agent built (messages + closed-list escaped event cards, (at,type,id) merge, base64url cursor, pending approvals, 400/404); seam pins and docs updated. Holistic review PASS first pass with adversarial repros and all 11 pin mutations confirmed red; 3 LOW findings dismissed below the MEDIUM fix floor (PR comment). CI required checks green.

## Not verified
- **app Chat/Crew screens (app/src/screens/chat)** — item 13 placeholder; nothing renders the route yet (subtask 1)
- **GET /threads/:agent over the live API socket** — tested through matchRoutePath and the handler, like the other console tests (subtask 1)
