# Supervisor Job: The kernel keeps a bounded output log for every session (phase 5 item 03)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-21-052020/L2
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (rebase conflict expected with this wave's lanes for items 02 and 04 on `kernel/test/console-foundation.test.ts`; see Risk Assessment)
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140003-the-kernel-keeps-a-bounded-output-log-per-session.md
- **Base commit:** 77be86d5d57f029e6622126d92164c7205b92a96

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript and vitest in `kernel/`, with better-sqlite3 behind `Store` (synchronous, so one small transaction per write needs no await). |
| 2 | Dependency Availability | GO | No new npm dependency. The `session_output` table (migration 16), the `onOutput` observer (`kernel.ts`: `onOutput: (sessionId, message) => recordSessionOutput(store, sessionId, message)`), the route seam (`ContributedRoute`), the subcommand seam (`ContributedSubcommand`) and the escaper (`shown` in `kernel/src/approvals/cli.ts`) all exist. |
| 3 | Architecture Fit | CAUTION | Item 01's console seam has no way to contribute CLI verbs: `ConsolePart` has no `subcommands`, `consoleContributionOf` says "Never `subcommands`: the console has no CLI verbs", and `console-foundation.test.ts` pins that ("it never gets a subcommands key"). On 2026-10-21 the **owner chose to add the seam in this item**: an optional `subcommands` on `ConsolePart`, merged in part order. This grows Touches by `kernel/src/console/types.ts`, `kernel/src/console/index.ts`, `kernel/test/console-foundation.test.ts` and one sentence of `docs/ARCHITECTURE.md`. |
| 4 | Scope vs Supervisor Capability | GO | 6 modified and 1 created file, an estimated 600 to 800 changed lines. Single agent. |
| 5 | Hard Blockers | GO | None. `GET /sessions/:id/output` does not overlap phase 1's `POST /sessions/:id/abandon` (`routePathsOverlap`: the third literal segment differs), and `sessions` is not a reserved word (`PHASE1_SUBCOMMANDS` = `["status", "stop", "resume", "session", "service"]`). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Fill in the console's `output.ts` part. It records every session's SDK messages into the bounded `session_output` log, serves `GET /sessions` and `GET /sessions/:id/output`, announces new rows on the feed as throttled `session_output_appended` events, and contributes `studio sessions [--json]` and `studio sessions output <id> [--follow]` through a new, optional `subcommands` field on `ConsolePart`.

**Problem Statement:**
The owner needs every session's output kept by the kernel, bounded and readable after the session ends, so that the Sessions screen can stream and replay what an agent did without the app reading the CLI's own files (D10).
Today the SDK's messages pass through the session manager to `onOutput`, and `recordSessionOutput` drops them (a no-op from item 01). Nothing can review an ended session.
Success looks like this: a stand-in session's text, tool call, the kernel's own deny decision and its result come back in order from `GET /sessions/:id/output`; the log stops at 2,000 rows or 2 MiB with one cut note; a failing store never fails a session; and the CLI prints stored text escaped.

**Owner decisions (binding, copied from the requirement):** live feed = one WebSocket event feed of the append-only `events` (item 02 owns the socket); session output = a bounded log the kernel keeps, every string marked as untrusted data; the app never reads CLI files (D10). Mechanism only (invariant 1). There is no retention policy beyond the per-session caps.

**Design (grounded at base 77be86d):**
1. **Recorder** (`kernel/src/console/output.ts`). Export `createSessionOutputRecorder(deps?: { now?: () => Date; setTimer?: (fn: () => void, ms: number) => { cancel(): void }; warn?: (line: string) => void })`. It returns `record(store, sessionId, message)` and keeps per-session state in a `Map` keyed by session id: next `seq`, row count, byte total (the sum of `payload_json` lengths, in UTF-8 bytes), whether the log was cut, whether a warning was given, the `tool_decision` event cursor, and the feed throttle. On a session's first message, this state is loaded from `session_output`: `MAX(seq)+1`, `count(*)`, `sum(length(CAST(payload_json AS BLOB)))`, and whether a cut row already exists. That keeps it correct after a daemon restart resumes a session. `recordSessionOutput` stays the exported function `kernel.ts` already calls, now backed by a default recorder; the `warn` default is the `launchd.ts` idiom `(line) => void process.stderr.write(`${line}\n`)`. Each message maps to zero or more rows, written in one `store.transaction`:
   - `system` (`subtype: "init"`): `{subtype: "init", model, tool_count}` only.
   - `assistant`: one `assistant_text` row `{text, cut?}` per text block, with `text` cut to `ASSISTANT_TEXT_CUT = 8_000` characters and `cut: {original_chars}` when it was cut. One `tool_call` row `{tool_use_id, name, input_json, cut?}` per `tool_use` block, with `input_json` = `JSON.stringify(input)` cut to `TOOL_JSON_CUT = 4_000`.
   - `user` messages carrying `tool_result` blocks: `tool_result` `{tool_use_id, is_error, content, cut?}`, with the content as text cut to `TOOL_JSON_CUT`.
   - `result`: `{subtype, counted_tokens}`, where counted tokens are input + output + cache-write from the result's usage (the budget meter's `counted_tokens` definition, migration 1). Thinking and cache reads are excluded.
   - **`tool_decision` rows are copied from the kernel's own `tool_decision` events, never re-derived.** The recorder drains `SELECT id, payload_json FROM events WHERE kind = 'tool_decision' AND session_id = ? AND id > ? ORDER BY id` (cursor = the last event id drained) into a per-session pending FIFO, both **before and after** mapping each message. Each row's payload is the event payload copied **whole** (`tool`, `decision`, `reason`, plus `approval_id`, `command` and `category` when present). **The order of the hook relative to message delivery is not guaranteed and is unverified:** `#gate` writes the event synchronously from the SDK's hook callback, while `#observe` sees the assistant message only when the `for await` loop takes it, so either can come first. So the recorder writes decisions by **matching, not by arrival**: a pending decision is written only once a `tool_call` row for the same `tool` name exists without a decision yet (FIFO per tool name), and it is written directly after that call's rows in the same transaction. A decision whose call has not been recorded yet stays pending. If a matching `tool_call` is mapped later, the decision is written right after it. Pending decisions with no call are written before a `result` row (so none is lost). Either arrival order yields `tool_call` then its `tool_decision` (AC1). The worker records in `session-output.md` that the real SDK's interleaving is unverified and that matching makes the order independent of it. Any other message type (stream events, status) writes nothing.
   - **Caps:** `MAX_SESSION_OUTPUT_ROWS = 2_000` and `MAX_SESSION_OUTPUT_BYTES = 2 * 1024 * 1024` per session, counting content rows only. When the next row would pass either cap, one `system` row `{subtype: "output_cut", reason: "rows"|"bytes"}` is written beyond the caps (so 2,000 content rows, then the note as row 2,001), and the session's state is marked cut. Nothing more is kept, and later messages return before touching the store. `session-output.md` states this.
   - **Never fails the session:** the whole `record` body is wrapped in try/catch. On the first failure for a session it calls `warn` once with `studio: session <id> output log write failed: <error>` (the error escaped with `shown`), and later failures for that session are silent. It never rethrows, so the manager writes no `observer_error` per message.
   - **Feed event:** after a transaction that appended rows, if at least `OUTPUT_FEED_INTERVAL_MS = 250` ms (by `now`) have passed since this session's last `session_output_appended`, it inserts one event: `INSERT INTO events (at, kind, actor, session_id, payload_json) VALUES (?, 'session_output_appended', 'kernel', ?, ?)` with payload `{from_seq, to_seq}` covering every row since the last announcement. Otherwise it arms one trailing timer (`setTimer`, unref'd by default) for the remainder of the interval, which announces the pending range. A `result` message flushes at once only if the interval has passed; otherwise the trailing timer does it. There is never more than one event per session per 250 ms. The event insert sits in the same transaction as the rows it announces, or in the timer's own one-statement write.
2. **Routes** (`outputPart.routes`, both `GET`):
   - `/sessions?status=<s>&limit=<n>` → `200 {sessions: SessionSummary[]}`, newest first. Each summary is `id, agent, status, model, started (started_at), ended (ended_at), tokens (SUM(budget.counted_tokens) for the session, null when none), cwd, playbook`. `limit` defaults to 50, at most 500; `400 invalid_query` for a non-integer or out-of-range limit.
   - `/sessions/:id/output?after=<seq>&limit=<n>` → `200 {rows: SessionOutputRow[]}` in `seq` order with `seq > after` (default 0). `limit` defaults to 500, at most 500 (as `GET /events`). `payload` is the parsed `payload_json`. `400 invalid_id` / `400 invalid_query`, and `404 not_found` for no such session.
   - Shapes match `app/src/api/contract.ts` (`SessionSummary`, `SessionOutputRow`) exactly. The contract is **not edited**: its `origin: "item-03"` entries stay as they are.
3. **CLI** (`outputPart.subcommands`, one `ContributedSubcommand` named `sessions`):
   - `studio sessions [--json]` lists one line per session. Every stored string (agent, model, cwd) goes through `shown`.
   - `studio sessions output <id> [--follow]` prints one line per row, and **every stored string goes through `shown` (or `payloadText`) before it reaches stdout**.
   - `--follow` polls `GET /sessions/:id/output?after=<last>` at a fixed interval. It stops when the id appears in neither `GET /sessions?status=starting` nor `GET /sessions?status=running` (the contract has no single-session read and is not edited) and a final output read returns no rows.
   - An unknown verb or bad id prints the usage on stderr and exits 2. An API refusal prints one escaped stderr line and exits 1.
   - The follow loop is an exported helper with an injectable interval and sleep, so tests never wait on wall-clock time.
4. **The subcommand seam** (owner-approved): `ConsolePart` gains `readonly subcommands?: readonly ContributedSubcommand[]`. `mergeConsoleParts` joins them in part order. `consoleContributionOf` adds `subcommands` only when non-empty, like the other keys. Name collisions are left to `mergeContributions`, as for tools and routes. The header comments that say the console has no CLI verbs are corrected.

## Acceptance Criteria
- [ ] AC1: Given a stand-in session (`kernel/test/session-fakes.ts` fakes) that emits init, a text block, a Bash call the gate denies, and a result, then ends, when `GET /sessions/:id/output` is read, then the rows are `system`, `assistant_text`, `tool_call`, `tool_decision` (`decision: "deny"` with its `reason`), `result`, in that order, with `seq` strictly increasing. `kernel/test/session-fakes.ts` never calls hooks, so the test calls the session's `options.hooks.PreToolUse` callback itself. It runs this **twice, with the same expected order**: once with the hook called *after* the assistant message carrying the `tool_use` is pushed, and once *before*.
- [ ] AC2: Given a session that emits 2,500 messages each producing one row, when the log is read, then 2,000 rows are kept plus exactly one `system` `output_cut` row, no more rows are written after it, and the session ends with its normal status and no `observer_error` event.
- [ ] AC3: Given a store that refuses the `session_output` write (an injected fault), when a session streams several messages, then the session still completes normally, the recorder's `warn` was called exactly once for that session, and no `observer_error` event was written.
- [ ] AC4: Given an `assistant_text` row whose text contains an escape sequence (`\u001b[31m`) and a bidi control, when `studio sessions output <id>` prints it, then stdout contains the escaped form (`\x1b[31m`) and no raw ESC or bidi character.
- [ ] AC5: Given a running session whose rows are appended across many messages within 1 s (injected clock and timer), when the feed's `events` are read, then `session_output_appended` events for that session are at least 250 ms apart, each payload's `{from_seq, to_seq}` covers rows not announced before, and together they cover every appended row (the trailing timer announces the last batch).
- [ ] AC6: Given a text block over 8,000 characters and a tool input or result over 4,000 characters of JSON, when recorded, then the stored strings are cut to those sizes with a `cut` note giving the original length, and a `tool_result` row keeps `is_error`.
- [ ] AC7: Given a `held` decision (approval required), when recorded, then its `tool_decision` row carries the `approval_id` from the kernel's event.
- [ ] AC8: Given sessions in several statuses, when `GET /sessions?status=running&limit=1` and `GET /sessions/:id/output?after=<seq>&limit=<n>` are read, then they answer the contract's `SessionsResponse` / `SessionOutputResponse` shapes. A bad id, limit or `after` answers `400`, and an unknown session `404 not_found`.
- [ ] AC9: Given the shipped contributions, when merged, then `console` carries `routes` (`GET /sessions`, `GET /sessions/:id/output`) and `subcommands` (`sessions`) from its output part, and `consoleContributionOf` adds `subcommands` only when a part has any. `console-foundation.test.ts` pins both, and its "every part is empty" and "recordSessionOutput is a no-op" pins are updated to the new truth, not deleted without a replacement.
- [ ] AC10: `docs/architecture/session-output.md` documents the row kinds and payloads, the caps and cut note, untrusted-data handling, the routes, the feed event and its throttle, the CLI, and the write-failure rule. The console paragraph in `docs/ARCHITECTURE.md` no longer says the console has no subcommands, and `bash scripts/check-docs.sh` passes.
- [ ] AC11 (validation): `cd kernel && npm ci && npm run typecheck && npm test` passes, with `feature-seams.test.ts`'s module-graph pin still green (`output.ts` imports the SDK and `Store` as types only).

## Touched-file invariants

> Grounded at base `77be86d`. The worker re-checks every entry before hand-back.

- **`kernel/src/console/output.ts`**:
  - Keep: type-only imports, `import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";` and `import type { Store } from "../store/store.js";`. The `studio` CLI loads this module through the feature registry, and `kernel/test/feature-seams.test.ts` pins the module graph, so never a value import of the SDK, the session manager or `kernel.ts`. Also keep `SESSION_OUTPUT_KINDS` exactly the six frozen values (`Object.freeze(["assistant_text", "tool_call", "tool_decision", "tool_result", "result", "system"] as const)`), and the exported `recordSessionOutput(store: Store, sessionId: number, message: SDKMessage): void` signature, because `kernel.ts` (outside Touches) calls it.
  - Reuse: `shown` / `payloadText` from `../approvals/cli.js` for CLI printing, which `kernel/src/cli/index.ts` already imports.
  - Mirror: `app/src/api/contract.ts` `SessionSummary` / `SessionOutputRow` field names, and the `toolDecisionPayload` keys in `kernel/src/sessions/manager.ts` (`tool`, `decision`, `reason`, `command`, `approval_id`, plus `category` on an `agent_boundary` deny), copied whole.
  - Pinned by: `kernel/test/console-contract.test.ts` ("are the same six values as SESSION_OUTPUT_KINDS, each once").
- **`kernel/src/console/types.ts`**:
  - Keep: type-only imports (header: "nothing here may pull in the Agent SDK, the session manager or `kernel.ts`"), and `emptyConsolePart` returning `{ name, tools, routes, handlers }` frozen, without a `subcommands` key, so the empty parts still `toEqual({ name, tools: [], routes: [], handlers: {} })`.
  - Mirror: `ContributedSubcommand` from `../features/contribution.js`.
- **`kernel/src/console/index.ts`**:
  - Keep: `CONSOLE_PARTS` order `[eventsPart, outputPart, controlPart, pausePart, threadsPart]`; `ContributionConflictError("handler", kind, [first, part.name])` for duplicate handler kinds; the frozen merged object; and the "only the non-empty keys" rule in `consoleContributionOf`.
  - Pinned by: `kernel/test/console-foundation.test.ts` (`expect(SHIPPED_CONTRIBUTIONS[7]).toBe(consoleContribution)`).
- **`kernel/test/console-foundation.test.ts`**:
  - Keep: the `vi.mock("../src/console/output.js", …)` call recorder, which wraps the real export, so `recordSessionOutput` must stay a named export of `output.js`. Also keep the kernel integration pin `expect(kernel.store.prepare("SELECT count(*) FROM events WHERE kind = 'observer_error'").pluck().get()).toBe(0);`.
  - Change only the pins this item makes false: "is its name alone", "every part is empty" (the output part now has routes and subcommands; events, control, pause and threads stay empty; the `mergeConsoleParts(CONSOLE_PARTS)` `toEqual` gains the output routes and `subcommands`), "it never gets a subcommands key", and "is a no-op for now".
  - Stale comments to correct in `kernel/src/console/index.ts`: the header ("recordSessionOutput … a no-op") and the `consoleContribution` doc ("every part is empty today, so it does not throw"). In `docs/ARCHITECTURE.md`, the later "a no-op until item 03" line may be reworded to the past tense in the same paragraph; nothing else changes.
- **`docs/ARCHITECTURE.md`**: keep every other sentence of the console paragraph. Change only "Today every part is empty, so the contribution is its name alone: no tools, routes, subcommands, handlers or due work." to name the output part's routes and `sessions` verb and the new `subcommands` field. Also keep the existing link to `architecture/session-output.md` resolving (`scripts/check-docs.sh` rule 1).
- **`docs/architecture/session-output.md`**: keep the `[Phase 5 features](../ARCHITECTURE.md#phase-5-features)` link.

## Closed enumerations touched

> Sibling grep at base `77be86d`: `grep -rnF 'observer_error' kernel docs app/src` → 11 matching lines in 8 files (manager.ts, sessions/types.ts, console/output.ts, ARCHITECTURE.md, and tests). None is a closed list of event kinds: `events.kind` is free text (no SQL CHECK), and the app's `EventFrame.kind` is `string`.

- **`session_output_appended`** (new event kind; sibling `observer_error`):
  - `app/src/api/contract.ts` `EventFrame.kind: string`: no change, it is not a closed union.
  - `kernel/src/loop/types.ts` `EVENT_KINDS` (`["wakeup", "message"]`): no change, this is the loop *queue's* kinds, not the `events` log's.
  - `docs/architecture/session-output.md`: document the kind (a create in this item).
- **`subcommands`** (new `ConsolePart` key; siblings `tools`/`routes`/`handlers`/`dueWork`):
  - `kernel/src/console/types.ts` `interface ConsolePart`: extend.
  - `kernel/src/console/index.ts` `MergedConsoleParts` and the `consoleContributionOf` key list: extend.
  - `kernel/test/console-foundation.test.ts` `expect(Object.keys(contribution)).toEqual(["name", "routes", "handlers", "dueWork"])`: extend with a subcommands case.

## Pin mutations

Constants named in the Design are prescribed so these rows apply by script.

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/console-output.test.ts`: AC2 cap (2,000 rows + one cut note) | flip `MAX_SESSION_OUTPUT_ROWS = 2_000` → `MAX_SESSION_OUTPUT_ROWS = 3_000` in `kernel/src/console/output.ts` |
| `kernel/test/console-output.test.ts`: AC5 throttle (≥ 250 ms apart) | flip `OUTPUT_FEED_INTERVAL_MS = 250` → `OUTPUT_FEED_INTERVAL_MS = 0` in `kernel/src/console/output.ts` |
| `kernel/test/console-output.test.ts`: AC6 text cut at 8,000 | flip `ASSISTANT_TEXT_CUT = 8_000` → `ASSISTANT_TEXT_CUT = 80_000` in `kernel/src/console/output.ts` |
| `kernel/test/console-output.test.ts`: AC6 JSON cut at 4,000 | flip `TOOL_JSON_CUT = 4_000` → `TOOL_JSON_CUT = 40_000` in `kernel/src/console/output.ts` |
| `kernel/test/console-output.test.ts`: AC2 byte cap (2 MiB) | flip `MAX_SESSION_OUTPUT_BYTES = 2 * 1024 * 1024` → `MAX_SESSION_OUTPUT_BYTES = 2 * 1024 * 1024 * 1024` in `kernel/src/console/output.ts` |
| `kernel/test/console-output.test.ts`: AC4 escaped print | in `kernel/src/console/output.ts`, replace the `shown(…)` call around a printed `assistant_text` with the raw text (reviewer-applied) |
| `kernel/test/console-output.test.ts`: AC3 warn once | in `kernel/src/console/output.ts`, remove the per-session "already warned" check so every failure warns (reviewer-applied) |
| `kernel/test/console-output.test.ts`: AC1 decision copied from events | in `kernel/src/console/output.ts`, delete the `events` read for `kind = 'tool_decision'` (reviewer-applied) |
| `kernel/test/console-output.test.ts`: AC1 "hook before message" variant | in `kernel/src/console/output.ts`, write each drained decision at once instead of holding it until its matching `tool_call` (reviewer-applied) |
| `kernel/test/console-output.test.ts`: AC7 held decision's `approval_id` | in `kernel/src/console/output.ts`, drop `approval_id` from the copied `tool_decision` payload (reviewer-applied) |
| `kernel/test/console-output.test.ts`: AC6 `tool_result` keeps `is_error` | in `kernel/src/console/output.ts`, hard-code `is_error: false` on the `tool_result` row (reviewer-applied) |
| `kernel/test/console-output.test.ts`: AC8 refusals (400 / 404) | in `kernel/src/console/output.ts`, remove the `limit` range check of `GET /sessions/:id/output` (reviewer-applied); separately, answer `200 {rows: []}` instead of `404 not_found` for an unknown session (reviewer-applied) |
| `kernel/test/console-foundation.test.ts`: subcommands reach the contribution | in `kernel/src/console/index.ts`, drop the `subcommands` spread from `consoleContributionOf` (reviewer-applied) |
| `kernel/test/console-foundation.test.ts`: `subcommands` only when non-empty | in `kernel/src/console/index.ts`, make the `subcommands` spread unconditional (reviewer-applied) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Session output recorder, routes, `studio sessions` verbs and the console subcommand seam | all | 6 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### File Impact Map

| File | Action | Confidence |
|------|--------|------------|
| `kernel/src/console/output.ts` | modify (recorder, routes, subcommand) | HIGH |
| `kernel/src/console/types.ts` | modify (optional `subcommands`) | HIGH |
| `kernel/src/console/index.ts` | modify (merge `subcommands`, comments) | HIGH |
| `kernel/test/console-foundation.test.ts` | modify (pins made false by this item) | HIGH |
| `kernel/test/console-output.test.ts` | create (AC1 to AC8) | HIGH |
| `docs/architecture/session-output.md` | modify (fill item 01's stub) | HIGH |
| `docs/ARCHITECTURE.md` | modify (one sentence of the console paragraph) | MEDIUM |

```yaml
# Subtask 1 — session output log (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/test/console-output.test.ts"}
  - {kind: "symbol", path: "kernel/src/console/output.ts", name: "createSessionOutputRecorder"}
  - {kind: "symbol", path: "kernel/src/console/output.ts", name: "recordSessionOutput"}
  - {kind: "symbol", path: "kernel/src/console/output.ts", name: "MAX_SESSION_OUTPUT_ROWS"}
  - {kind: "symbol", path: "kernel/src/console/output.ts", name: "OUTPUT_FEED_INTERVAL_MS"}
  - {kind: "symbol", path: "kernel/src/console/output.ts", name: "outputPart"}
  - {kind: "symbol", path: "kernel/src/console/types.ts", name: "ConsolePart"}
  - {kind: "file", path: "docs/architecture/session-output.md"}
requires: []
lanes:
  - "kernel/src/console/output.ts"
  - "kernel/src/console/types.ts"
  - "kernel/src/console/index.ts"
  - "kernel/test/console-foundation.test.ts"
  - "kernel/test/console-output.test.ts"
  - "docs/architecture/session-output.md"
  - "docs/ARCHITECTURE.md"
external_requires:
  - "@anthropic-ai/claude-agent-sdk SDKMessage shapes (assistant content blocks text/tool_use, user tool_result, system init, result usage) as already used by the budget meter"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): item 01's console seam forbade CLI verbs. The owner approved adding an optional `subcommands` on `ConsolePart` in this item (2026-10-21), which changes item 01's contract. | MEDIUM | Additive and optional only: empty parts keep their exact shape (`emptyConsolePart` unchanged), and the contract file `app/src/api/contract.ts` is not edited. Item 05 (`studio pause`) can reuse the seam. |
| Same-wave rebase conflict: lanes for items 02 (`events.ts`) and 04 (`control.ts`) must also flip `console-foundation.test.ts`'s "every part is empty" and "name alone" pins, and may edit the same `docs/ARCHITECTURE.md` sentence. | MEDIUM | Keep each pin edit per part (assert the output part's own routes and subcommands; leave the other parts' empty assertions as one loop over the remaining parts) so a rebase is a small, mechanical merge. Change only the one ARCHITECTURE sentence. |
| The real SDK's order of the PreToolUse hook versus delivery of the assistant message is unverified: the decision event may arrive before or after its `tool_use` message. | MEDIUM | Decisions are matched to their `tool_call` (FIFO per tool name), not written on arrival. AC1 runs both orders by calling the hook itself, and the "hook before message" pin mutation guards the matching. `session-output.md` records the interleaving as unverified. |
| A store fault inside `record` floods `observer_error` events (one per message) or breaks the session. | HIGH | The whole body is in try/catch and never rethrows; warns once per session (AC3). Pinned by the warn-once mutation. |
| Stored model or tool text reaches the terminal raw (escape-sequence injection, invariant 3). | HIGH | Every printed stored string goes through `shown`/`payloadText` (AC4); rows are never interpreted. |
| The trailing timer keeps the daemon or a test process alive. | LOW | Unref'd by default; tests inject `setTimer`. |
| Unbounded per-session state in the recorder `Map` across a long-lived daemon. | LOW | Drop a session's entry after its `result` row has been announced (and after a cut); reload from the DB lazily if a later message arrives. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-21-session-output-log.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-21T11:23:04Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/102
- **Branch:** feature/session-output-log
- **Files changed:** 7
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Session output recorder, GET /sessions and /sessions/:id/output, throttled session_output_appended feed, `studio sessions` verbs and the optional ConsolePart.subcommands seam. Three heal rounds: each reviewer passed the correctness gate (14/14 pins held, AC1–AC11 addressed), but each found new fix-floor MEDIUMs; fixes landed in 01f3e79, 9c76810 and 2c7ccf6. The round-3 fix (warn-set add order, bounded trailing-announce retry) was not LLM re-reviewed. The supervisor verified typecheck and 1788 passing tests. Open owner decision: an events (session_id, kind, id) index (out of lane). Follow-up: stale comment at kernel/src/kernel.ts:298.

## Not verified
- **real Agent SDK interleaving of the PreToolUse hook versus the assistant tool_use message** — no live SDK run; matching makes the order independent, and both orders are tested with fakes (subtask 1)
- **`studio sessions` through runCli against a running daemon** — the subcommand is tested directly against the real route handlers, not via a launched daemon and keychain (subtask 1)
