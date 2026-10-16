# Supervisor Job: A redelivered ask never drops the reply of a session that is still running

## Environment
- **Project:** loomwright-studio (lane clone L2 of wave automate-2026-10-15-153327)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (sibling lanes L1 = item 09 kernel tool loading, L3 = item 11 notifications, L4 = item 12 version notes run in parallel; their `## Touches` lists do not include `kernel/src/brain/`, `kernel/src/kernel.ts`, `kernel/test/brain.test.ts` or `docs/architecture/brain.md`)
- **Source requirement:** .supervisor/requirements/phase-2/2026-10-15-084411-a-redelivered-ask-never-drops-a-live-reply.md
- **Base commit:** 95d31567140e3101e029cd985b7895a5b7fee8a1

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel, vitest; same module as item 06 (PR #54) |
| 2 | Dependency Availability | GO | No new dependency. Liveness comes from the existing `EventSessions.getSession(id): SessionRow \| undefined` the handler already receives as `ctx.sessions` |
| 3 | Architecture Fit | GO | Mechanism only; invariant 2 kept (the handler still never awaits or stops a session; liveness is read from the session manager, never inferred from the `brain_messages` row) |
| 4 | Scope vs Supervisor Capability | GO | 6 files, one module plus one comment and one doc: one worker |
| 5 | Hard Blockers | GO | None |

**Overall Verdict:** GO

## Task
**Goal:** On a redelivered `message` event whose `brain_messages` row is already `running` and whose session the session manager still reports live, a fault in a step before the session step (memory files, settings, context) never moves the row to `failed`; the fault is still rethrown. Plus four small same-file fixes from the item 06 review (model trim, honest `--json` wording, a stale `kernel.ts` comment, one duplicated test factory).

**Problem Statement:**
`kernel/src/brain/handler.ts`'s `fail()` moves the row to `failed` from `queued`, `parked` **or `running`**. A redelivered event finds its row again (idempotent on `queue_id`); when that row is `running` (its session is live), a transient throw from `ensureMemoryFiles` or `readWrightSettings` marks it `failed`. When the live session later ends, `attachReply` can only write from `running`, so the reply is lost although the session succeeded.
Success looks like: the row stays `running`, the handler still throws (the event loop fails/retries the event as today), and the session's result turns the row `replied`.

## Design decisions (binding for the worker)

1. **The guard lives in `fail()` only.** `fail(detail)` first checks whether this delivery found the row `running` (`row.status === "running"`, the row read by `ensureBrainMessage` at step a) AND the session is still live; if so it writes nothing and returns. Every other case writes exactly as today (`["queued", "parked", "running"]` → `failed`). Every caller keeps its control flow unchanged: the `memory_unwritable` / `settings_unwritable` paths still `throw err` after `fail(...)`, so the event is still failed by the loop exactly as today; the `model_unset` / `settings_invalid` / `no_session_manager` paths still `return`.
2. **Liveness is the session manager's report, never the row's.** Add one small helper in `handler.ts` (name it `sessionStillLive`): `(sessions: EventSessions | undefined, sessionId: number | null) => boolean` — `true` only when `sessionId !== null`, `sessions !== undefined`, and `sessions.getSession(sessionId)?.status` is `"starting"` or `"running"`. Compare the two literals inline: no runtime import from `../sessions/` (the module header rule: imports only types from the loop and the session manager). An absent row, `interrupted`, `orphaned`, or any terminal status ⇒ not live ⇒ the row ends `failed` with the detail, as today (never left `running`).
3. **Settings trim.** `readWrightSettings` returns `model: s.model.trim()`; the existing `s.model.trim() === ""` check keeps an all-whitespace model `model_unset`.
4. **Honest `--json` wording.** `--json` prints `JSON.stringify(res.body, null, 2)`: it escapes only what JSON requires (U+0000–U+001F, `"` and `\`), so a raw U+202E or U+009B in a reply passes through. Make the module comment in `kernel/src/brain/cli.ts` and the sentence in `docs/architecture/brain.md` (the paragraph after the outcome table) say that the escaping (`terminalText`) applies to the plain output, and that `--json` is standard `JSON.stringify` output (the house convention) which leaves such characters raw. Behaviour is unchanged; `ASK_HELP` is unchanged.
5. **`kernel.ts` comment.** The `KernelOptions.contributions` doc comment's "(every one empty: nothing is preinstalled)" is corrected: each shipped contribution ships only what its item has built (the brain's `message` handler, `POST /ask`, `GET /messages/:id`, `studio ask`; others likewise); still no playbook is preinstalled (invariant 1).
6. **One test factory.** `kernel/test/brain.test.ts` defines the same inline `EventContext` factory twice (both `const ctx = (): EventContext => ({`). Replace both with ONE module-level helper (e.g. `eventCtx(store, id, sessions)`) used by both existing tests and by the new tests.
7. **Docs.** `docs/architecture/brain.md`: in the routing section (after the step list / refusal paragraph) state the redelivery rule — a redelivered message whose row is `running` and whose session the session manager reports live keeps its row `running` on a fault before the session step (the fault is still raised); a row whose session is gone ends `failed` with the detail.

## Acceptance Criteria
- [ ] AC1: Given a message whose row is `running` with a live session (the session manager's `getSession(session_id)` reports `running`), when its event is redelivered and `ensureMemoryFiles` throws, then the row stays `running`, the handler throws, and when the session's result arrives the row becomes `replied` with the reply text.
- [ ] AC2: Given the same, when `readWrightSettings` throws instead, then the same holds.
- [ ] AC3: Given a message whose row is `queued` or `parked`, when the same fault happens, then the row ends `failed` with the fault in its detail (`memory_unwritable: …` / `settings_unwritable: …`), as today.
- [ ] AC4: Given a message whose row is `running` but whose session is no longer live (`getSession` answers `interrupted`, a terminal status, or no row), when its event is redelivered and the same fault happens, then the row ends `failed` with the fault in its detail, never left `running`.
- [ ] AC5: Given `"model": "  claude-x  "` in `wright.json`, then the session is started with `claude-x`; given `"model": "   "`, then the message fails `model_unset`.
- [ ] AC6: Given `kernel/src/brain/cli.ts`'s module comment and `docs/architecture/brain.md`, then neither claims `--json` escapes control or bidi characters; the plain-output escaping is still documented. `kernel/src/kernel.ts` no longer says every shipped contribution is empty. `kernel/test/brain.test.ts` has one `EventContext` factory.
- [ ] AC7: `cd kernel && npm ci && npm run typecheck && npm test` passes and `bash scripts/check-docs.sh` passes.

## Touched-file invariants

> Grounded at base `95d31567140e3101e029cd985b7895a5b7fee8a1`. The worker re-checks every entry before hand-back.

- **`kernel/src/brain/handler.ts`** — keep: type-only imports from the loop and sessions (`// Imports only types from the loop and the session manager (never the`); the handler never awaits the session (`if (handle !== undefined) attachReply(store, row.id, handle, now);`); the reply listener writes only from `running` (`updateBrainMessage(store, rowId, ["running"], { ...endingOf(status, reply), sessionId: handle.id }, now());`); the faults are still rethrown (`fail(\`memory_unwritable: ${messageOf(err)}\`);` then `throw err;`, and the same for `settings_unwritable`); final rows are never re-run (`if (FINAL_MESSAGE_STATUSES.includes(row.status)) return;`). Change only `fail`'s body (`updateBrainMessage(store, row.id, ["queued", "parked", "running"], { status: "failed", detail }, now());`) plus the new helper; update the module comment's step a/b description if it states the failure rule.
- **`kernel/src/brain/messages.ts`** — read-only for this item: `updateBrainMessage` moves a row only while it is in `from` (`WHERE id = ? AND status IN (${placeholders})`); no status or schema change (non-goal).
- **`kernel/src/brain/settings.ts`** — keep: the unset rule (`if (typeof s.model !== "string" || s.model.trim() === "") {`) and its message; never overwrite the file. Change only `model: s.model,`.
- **`kernel/src/brain/cli.ts`** — keep: `ASK_HELP` byte-identical (pinned: `expect(ASK_HELP).toBe('studio ask "<text>" [--json] [--timeout <s>]');` in `kernel/test/feature-seams.test.ts`, and the usage line in `kernel/test/triggers.test.ts`); the JSON output line (`const json = (): void => void out.stdout.write(\`${JSON.stringify(res.body, null, 2)}\n\`);`) and `terminalText` unchanged. Comment-only edit.
- **`kernel/src/kernel.ts`** — comment-only edit of `(every one empty: nothing is preinstalled). A collision between two of`; no code change.
- **`kernel/test/brain.test.ts`** — keep: the stub's default `getSession: () => undefined,` (existing tests rely on it); the new tests override `getSession` locally to read the `sessions` row the stub inserted (`INSERT INTO sessions (agent, task_id, status, model) VALUES (?, ?, 'running', ?)`). The AC9 doc pins (`"## Honest limits"`, `ASK_HELP`, the role-template block) must stay green.
- **`docs/architecture/brain.md`** — keep relative links valid (check-docs) and every needle the AC9 test reads; keep the honest-limit bullet starting `**A reply can be lost.**` accurate.

## Pin mutations

| Pin (new or changed test) | Mutation that must turn it red |
|---|---|
| `brain.test.ts` — running row + live session, memory fault: row stays `running`, handler throws, then `replied` | delete the live-session early return in `fail()` in `kernel/src/brain/handler.ts` |
| `brain.test.ts` — running row + live session, settings fault: same | same mutation |
| `brain.test.ts` — same, the handler still throws | replace `throw err;` after `fail(\`memory_unwritable: …\`)` with `return;` |
| `brain.test.ts` — parked row + fault ends `failed` with the detail | remove `"parked"` from `fail()`'s `from` list |
| `brain.test.ts` — running row + dead session (`interrupted`) + fault ends `failed` | make `sessionStillLive` return `true` whenever `sessionId !== null` (skip `getSession`) |
| `brain.test.ts` — `"  claude-x  "` starts the session with `claude-x` | revert to `model: s.model,` in `kernel/src/brain/settings.ts` |
| `brain.test.ts` — `"   "` fails `model_unset` | change the unset check to `s.model === ""` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Keep a live session's row on a redelivered fault; trim the model; honest `--json` wording; kernel comment; one test factory | AC1–AC7 | 6 modify, 0 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### Subtask contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/brain/handler.ts"}
  - {kind: "symbol", path: "kernel/src/brain/handler.ts", name: "sessionStillLive"}
  - {kind: "file", path: "kernel/src/brain/settings.ts"}
  - {kind: "file", path: "kernel/test/brain.test.ts"}
  - {kind: "file", path: "docs/architecture/brain.md"}
requires: []
lanes:
  - "kernel/src/brain/handler.ts"
  - "kernel/src/brain/settings.ts"
  - "kernel/src/brain/cli.ts"
  - "kernel/src/kernel.ts"
  - "kernel/test/brain.test.ts"
  - "docs/architecture/brain.md"
external_requires: []
```

## Parallelism Analysis

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
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| A dead session's row stays `running` forever if liveness is inferred from the row — Requirement risk | MEDIUM | Liveness only from `ctx.sessions.getSession(session_id)` status `starting`/`running`; AC4 pins the dead-session case |
| The sessions table can read `running` for a session the kernel lost (crash before the startup reap) | LOW | The startup reap marks such rows `interrupted`/`orphaned` before the loop runs; the "A reply can be lost" honest limit already covers a kernel death; note it in brain.md if the worker finds the window real |
| `kernel/src/kernel.ts` is shared with sibling lanes in other waves (twin graph: `DEPENDED_ON_BY: kernel/test/fixtures/crash-harness.mjs`; last change: self-heal fixed 2 issues, 2026-10-03) | LOW | Comment-only edit; no sibling lane in this wave lists it in `## Touches` |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-15-redelivered-ask-keeps-live-reply.md
```

## Plan Review: PASS (attempt 1/3; owner chose "Save and exit")

| # | Severity | Section | Description | Resolution |
|---|----------|---------|-------------|------------|
| 1 | LOW | Configuration | Single-subtask brief says `Mode: sequential`; the reduced form expects `Mode: single-agent` and `single-agent (no fan-out)` | deferred |
| 2 | LOW | Touched-file invariants | cli.ts entry cites the triggers.test.ts usage pin without quoting its anchor (`${DENY_HELP} \| ${ASK_HELP}\n`); the byte pin is feature-seams.test.ts:518 | deferred |
| 3 | LOW | Acceptance Criteria | AC6/AC7 not Given/When/Then; AC1/AC2 test technique (deferred `done`/`result`, break memory/ or config/ between deliveries) not spelled out — both techniques exist in brain.test.ts | deferred |

## Outcome
- **Status:** completed
- **Completed:** 2026-10-15T12:01:08Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/58
- **Branch:** feature/10-redelivered-ask-keeps-live-reply
- **Files changed:** 6
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** fail() in brain/handler.ts keeps a running row when getSession reports its session starting/running (sessionStillLive); the fault is still rethrown and the live session's listener writes replied; dead/absent sessions still fail. Model trimmed; honest --json wording in cli.ts + brain.md; kernel.ts comment corrected; one eventCtx test factory. Heal iteration 1 covered every sessionStillLive branch (MEDIUM test gap); iteration 2 PASS with 1 LOW dismissed (honest-limit doc note on the microtask gap). 1121 tests pass, check-docs OK. risk_classification high_risk=true (advisory: *auth*/*token* content match).

## Not verified
- **Redelivery against the real SessionManager in a running kernel** — handler-level tests only (stub getSession reads the same sessions table) (subtask 1)
