# Supervisor Job: The kernel records each session's working directory (sessions.cwd, migration 015)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-20-112616/L1
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-4/2026-10-20-011500-the-kernel-records-each-sessions-working-directory.md
- **Base commit:** 44151bcc5f3246b1d8d5cbc34d3600cde291a468

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel, better-sqlite3 store, vitest — all in place. |
| 2 | Dependency Availability | GO | No new dependency; `realpathSync.native` and the firmlink helper already live in `kernel/src/protected-paths.ts`. |
| 3 | Architecture Fit | GO | Append-only migration list (`kernel/src/store/migrations/index.ts`), mechanism-only record (invariant 1), same-insert durability (invariant 2). |
| 4 | Scope vs Supervisor Capability | GO | 15 files (13 modify, 2 create), est. ~450 changed lines, one coherent change; single subtask. |
| 5 | Hard Blockers | GO | None. CI runs on `ubuntu-latest`, so tests must be portable (see Risk Assessment). |

**Overall Verdict:** GO

## Task
**Goal:** Record the realpath of each session's working directory in a new nullable `sessions.cwd` column (migration 015), written in the start's own insert, returned by `getSession` and `GET /status` / `studio status`, and refuse a resume whose resolved cwd differs from the recorded one with `SessionError("cwd_changed")`.

**Problem Statement:**
The owner (and anyone auditing the store) needs the store to say where every session actually ran because a crew member's workspace is today only inferable from `brain_messages.workspace`, the message that started it.
Currently, the session manager validates `cwd` against D31 and hands it to the SDK, but its `INSERT INTO sessions` has no cwd column, no event records it, and `resumeSession` can take a different cwd. This causes the phase 4 live harness to check the session's directory only indirectly, and the runbook to say "the kernel records no cwd on the session row".
Success looks like every session row started after migration 015 carrying its resolved cwd from the moment it exists, a resume in a different directory refused before anything spawns, and the live harness asserting the recorded cwd.

**Owner decisions (binding, from the requirement, 2026-10-20):** mechanism only, never a change to which cwd a session gets or to the D31 refusal; a nullable `sessions.cwd` column via migration 015 (append-only, contiguous, `store.test.ts` pins updated); resume with a different resolved cwd is refused `cwd_changed` naming both paths, one `session_refused` event `{reason: "cwd_changed", cwd, recorded_cwd}`, row status unchanged; a pre-015 row (null cwd) resumes as today; the stored form is the realpath resolved the way the D31 check resolves it (symlinks as far as the path exists, `/System/Volumes/Data` prefix removed). The SDK still receives `params.cwd` exactly as given today. The lane records what it observes about the CLI's per-project transcripts, if anything, without probing a live session.

**Non-goals:** changing any session's cwd or the D31 check; per-tool-call cwd (`tool_decision` events stay as they are); backfilling pre-015 rows.

## Acceptance Criteria
- [ ] AC1: Given a crew member asked with `--workspace /repos/demo`, when its session starts, then the store records `/repos/demo` (its realpath) in `sessions.cwd` for that session, and `getSession` returns it.
- [ ] AC2: Given a message naming no workspace, when the session starts, then `sessions.cwd` holds the agent's memory folder (resolved).
- [ ] AC3: Given an interrupted session started in `/repos/demo`, when it is resumed with cwd `/repos/other`, then the resume is refused `SessionError("cwd_changed")` whose message names both paths, with exactly one `session_refused` event `{reason: "cwd_changed", cwd, recorded_cwd}` carrying the session's id, nothing spawned, admission and auth not called, and the row unchanged. Resumed with `/repos/demo`, or through a symlink that resolves to it, then it resumes as today.
- [ ] AC4: Given a session row from before migration 015 (cwd null), when it is resumed, then it resumes as today (no comparison, no refusal).
- [ ] AC5: Given a cwd reached through a symlink, or written with the `/System/Volumes/Data` prefix, when the session starts, then `sessions.cwd` holds the resolved path (the SDK still gets `params.cwd` as given).
- [ ] AC6: Given a `protected_cwd` refusal (or `invalid_params`, or an admission refusal), then no session cwd is recorded beyond the existing `session_refused` event for `protected_cwd`.
- [ ] AC7: Given the kernel killed between the row's insert and the session's first message, then the recorded cwd is already in the store: `sessions.cwd` is written by the same `INSERT` that creates the row (the `failed:auth` row's insert included), never by a later `UPDATE`.
- [ ] AC8: Given `GET /status`, then each `starting`/`running` session object carries `cwd` (string or null), and `studio status` prints it escaped with `shown()` from `kernel/src/approvals/cli.ts` (or `-` when null).
- [ ] AC9: Given every existing sessions, brain, playbook, store, api, cli and phase 4 exit test, then each passes unchanged apart from the new field (pins that list `sessions` columns, migration versions or `/status` session objects gain `cwd` / 15 and nothing else).
- [ ] AC10: Given the live harness `kernel/test/phase-4-exit-live.test.ts`, then steps 4 and 5 (`expectCrewSession`) assert the reviewer's session `cwd` equals step 1's repo from the recorded column, and keep the `brain_messages.workspace` check as a second check; `docs/evidence/phase-4-exit-runbook.md` replaces "the kernel records no cwd on the session row" with what is recorded.
- [ ] AC11: Given `docs/ARCHITECTURE.md`, then the `sessions` data-model row names the cwd (realpath, null before migration 015) and the session-manager section has a bullet on recording the cwd and the `cwd_changed` resume refusal; `bash scripts/check-docs.sh` passes.
- [ ] AC12: `cd kernel && npm ci && npm run typecheck && npm test` passes.

## Touched-file invariants

> Grounded at base `44151bcc5f3246b1d8d5cbc34d3600cde291a468`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/sessions/manager.ts`** — keep: the D31 check stays first and unchanged, `this.#refuseProtectedCwd(params.cwd, null);` in `startSession` and the resume's `// Before admission and the group check: the row is not touched, only the refusal is logged.`; keep the SDK receiving the cwd as given (`projectPath: params.cwd,` in the start path's Loomwright lookup, and `cwd: params.cwd,` in the start launch and the resume ctx) — only the stored value is resolved; keep the one row-creating insert, `INSERT INTO sessions (agent, task_id, sdk_session_id, status, model, auth_account, loomwright_path, playbook, playbook_version, started_at, ended_at, updated_at)` gains `cwd` in the same statement (both `#insertRow` callers: `"failed:auth"` and `"starting"`); reuse: the refusal shape of `this.#recordSafely("session_refused", sessionId, { reason: "protected_cwd", cwd });` for `cwd_changed` (a sibling private helper next to `#refuseProtectedCwd`, after the row is read and the not_found/not_resumable checks, before `#refusingLoomwright`/`#admit`, so the row is untouched); mirror: `getSession`'s column list `leader_started_at, kill_incomplete_at, playbook, playbook_version, started_at, ended_at, updated_at` must match `SessionRow` in `kernel/src/sessions/types.ts`; pinned by: `kernel/test/sessions.test.ts` (`describe("a cwd in a macOS-protected folder (D31, protected_cwd)"`).
- **`kernel/src/sessions/types.ts`** — keep: `SessionErrorCode` is a closed union ending `| "protected_cwd";` — add `"cwd_changed"` with a doc comment like its siblings; `SessionRow` fields are `readonly` with doc comments (`readonly playbook_version: number | null;`) — add `readonly cwd: string | null;` documented (realpath, null before migration 015).
- **`kernel/src/protected-paths.ts`** — keep: it stays a leaf (`// A leaf module: it imports nothing from \`service/\` or \`sessions/\`.`); reuse: the ONE resolution, `function resolveExisting(path: string): string {` composed with `export function withoutFirmlink(path: string): string {` — export one new function named `resolvedPath` built from these two so the stored value and the resume comparison share the D31 check's resolution; never re-implement realpath elsewhere; pinned by: `kernel/test/protected-paths.test.ts`.
- **`kernel/src/store/migrations/index.ts`** — keep: `/** Every migration, in ascending version order. Append only; never edit a shipped one. */` — append `015` after `agentRegistry,`; never edit 001–014.
- **`kernel/src/store/migrations/015_session_cwd.ts`** (create) — reuse migration 14's re-run-safe idiom: `if (existing.all(table).includes(column)) continue;` over `pragma_table_info` (the store's integrity check re-runs top migrations whose records were deleted); nullable `TEXT`, no default, no SQL trigger (`kernel/src/store/migrations/014_agents.ts`: "Creates no SQL trigger").
- **`kernel/test/store.test.ts`** — pinned lists to extend by exactly one entry: `[14, "agents"],` → add `[15, "session_cwd"]` (or the chosen name); every `toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])` → `…, 14, 15]`; `expect(columns(store, "sessions").slice(-5)).toEqual([` gains `cwd`; the re-run test title "a re-run of migrations 11 to 14" and `.at(-1)).toEqual([14, "agents"])` move to 15; add a `describe("migration 15: …")` upgrade test in the shape of the migration 13/14 describes (open at `migrations.slice(0, 14)`, insert a session row, reopen, row kept with `cwd` null).
- **`kernel/src/api/server.ts`** — keep: `"SELECT id, agent, model, pgid, started_at, status FROM sessions WHERE status IN ('starting', 'running') ORDER BY id",` stays the source of `/status`'s running sessions — add `cwd` to it and to `StatusBody["sessions"]` (`readonly started_at: string | null;` sibling); additive field only; pinned by: `kernel/test/api.test.ts` (`{ id: 1, agent: "wright", model: "claude-haiku-4-5", pgid: 2000000001, started_at: "2026-10-02T09:00:00.000Z", status: "running" }`).
- **`kernel/src/cli/index.ts`** — keep: the status line `` lines.push(`  #${s.id} ${s.agent ?? "-"} ${s.model ?? "-"} ${s.status}, pgid ${s.pgid ?? "-"}, started ${s.started_at ?? "-"}`); `` keeps its existing prefix (pinned by `kernel/test/cli.test.ts`: `"#1 wright claude-haiku-4-5 running, pgid 77"`) — append the cwd after it; tolerate an older daemon that sends no `cwd` (the file's `// \`?? []\`: a daemon older than this CLI does not send the field.` convention); reuse: `export function shown(text: string): string {` from `kernel/src/approvals/cli.ts` for the escape.
- **`kernel/test/api.test.ts`, `kernel/test/cli.test.ts`, `kernel/test/protected-paths.test.ts`** (shared invariant: existing pins gain only the new field, nothing else changes) — keep: in `kernel/test/api.test.ts` the `/status` session objects such as `{ id: 1, agent: "wright", model: "claude-haiku-4-5", pgid: 2000000001, started_at: "2026-10-02T09:00:00.000Z", status: "running" }` gain only an additive `cwd` key (null for the raw-INSERT seeds); in `kernel/test/cli.test.ts` the assertion `expect(text).toContain("#1 wright claude-haiku-4-5 running, pgid 77");` stays unchanged (the cwd is appended after the existing prefix) and a new case pins the escaped cwd; in `kernel/test/protected-paths.test.ts` every existing D31 case stays unchanged and new cases pin only the new exported resolver (symlink resolved, `/System/Volumes/Data` prefix stripped, a not-yet-existing tail kept lexically), portable to `ubuntu-latest` (build the firmlink form by prefixing `realpathSync(tmp)`).
- **`kernel/test/phase-4-exit-live.test.ts`** — keep: the existing check `expect(m.message.workspace, "the message's workspace (the session's cwd) is not the throwaway repo").toBe(throwaway?.repo);` stays as the second check; the session SELECTs `"SELECT id, agent, status, model, started_at, ended_at FROM sessions WHERE id = ?"` gain `cwd` and its `SessionRow` interface gains `cwd`; replace the comment `// The kernel records no session cwd:` with the recorded-cwd assertion. The workspace is already `realpathSync(mkdtempSync(...))`, so the stored realpath compares equal. It runs only live (skipped in `npm test`), so it must still typecheck.
- **`docs/evidence/phase-4-exit-runbook.md`** — replace the parenthetical `(the kernel records no cwd on the session row)` with what is recorded; keep the rest of the step text and the summary JSON shape unless the harness adds a field.
- **`docs/ARCHITECTURE.md`** — extend the `| \`sessions\` |` data-model row (it ends `… (null for a session that is not a playbook's; a resume writes them only when given; migration 13) |`) and add the session-manager bullet beside `- **A session never runs in a macOS-protected folder (D31).**`; relative links must resolve for `scripts/check-docs.sh`.

## Closed enumerations touched

> Sibling grep at base `44151bcc5f3246b1d8d5cbc34d3600cde291a468`: `grep -rnF 'protected_cwd' --exclude-dir=node_modules --exclude-dir=.supervisor --exclude=CHANGELOG.md .` → 18 hits in 7 files.

- **`cwd_changed`** (sibling: `protected_cwd`) — must be named in:
  - `kernel/src/sessions/types.ts` — the `SessionErrorCode` union (`| "protected_cwd";`) — extend.
  - `docs/ARCHITECTURE.md` — the D31 session-manager bullet (prose, not a closed list) — extend with the new sibling bullet on cwd recording and `cwd_changed` (AC11).
  - `kernel/src/sessions/manager.ts` — `#refuseProtectedCwd` and doc comments — extend: the new refusal sits beside it, and the `resumeSession` doc comment names `cwd_changed`.
  - `kernel/test/sessions.test.ts` — protected_cwd tests — no change: they pin D31, which is unchanged.
  - `kernel/src/protected-paths.ts` — header comment — no change: it describes D31 only.
  - `docs/architecture/loomwright.md`, `README.md` — prose comparisons to D31 — no change: not a list of refusal codes.
  - `kernel/src/brain/handler.ts` (`fail(\`session_refused: ${messageOf(err)}\`)`) and `kernel/src/playbooks/runs.ts` (`session_refused: ${messageOf(err)}`) — catch-all on any start/resume throw — no change: they forward every code, so `cwd_changed` fails the message/run with its text.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/sessions-cwd.test.ts` — start records the resolved cwd (symlink / firmlink, AC1, AC5) | in `kernel/src/sessions/manager.ts` `#insertRow`, bind `params.cwd` instead of the resolved value |
| `kernel/test/sessions-cwd.test.ts` — memory-folder cwd recorded (AC2) via a start with no workspace | in `kernel/src/sessions/manager.ts` `#insertRow`, bind `null` for `cwd` |
| `kernel/test/sessions-cwd.test.ts` — resume in another folder refused `cwd_changed` (AC3) | delete the `cwd_changed` comparison call in `resumeSession` in `kernel/src/sessions/manager.ts` |
| `kernel/test/sessions-cwd.test.ts` — resume through a symlink to the recorded cwd resumes (AC3) | in the `cwd_changed` comparison, compare `params.cwd` as given instead of its resolved form |
| `kernel/test/sessions-cwd.test.ts` — pre-015 null cwd resumes (AC4) | in the `cwd_changed` comparison, drop the `recorded cwd === null` early return |
| `kernel/test/sessions-cwd.test.ts` — `getSession` returns `cwd` (AC1) | delete `cwd` from the `getSession` SELECT column list in `kernel/src/sessions/manager.ts` |
| `kernel/test/protected-paths.test.ts` — the new resolver strips the `/System/Volumes/Data` prefix | in `kernel/src/protected-paths.ts`, the new resolver returns `resolveExisting(path)` without `withoutFirmlink` |
| `kernel/test/protected-paths.test.ts` — the new resolver follows a symlink | in `kernel/src/protected-paths.ts`, the new resolver returns `withoutFirmlink(resolve(path))` instead of `withoutFirmlink(resolveExisting(path))` |
| `kernel/test/store.test.ts` — migration list ends at 15 | delete `sessionCwd,` in `kernel/src/store/migrations/index.ts` (or the chosen export name) |
| `kernel/test/api.test.ts` — `/status` session objects carry `cwd` (AC8) | delete `cwd` from the running-sessions SELECT in `kernel/src/api/server.ts` |
| `kernel/test/cli.test.ts` — `studio status` prints the escaped cwd (AC8) | in `formatStatus` in `kernel/src/cli/index.ts`, print `s.cwd` without `shown()` (a stored `\u001b` reaches the output raw) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Record, show and use the session cwd (migration 015, manager, status, harness, docs) | all | 13 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/store/migrations/015_session_cwd.ts"}
  - {kind: "file", path: "kernel/test/sessions-cwd.test.ts"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "cwd_changed"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "readonly cwd: string | null"}
  - {kind: "symbol", path: "kernel/src/protected-paths.ts", name: "resolvedPath"}
  - {kind: "symbol", path: "kernel/src/api/server.ts", name: "cwd"}
requires: []
lanes:
  - "kernel/src/store/migrations/015_session_cwd.ts"
  - "kernel/src/store/migrations/index.ts"
  - "kernel/test/store.test.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/protected-paths.ts"
  - "kernel/test/protected-paths.test.ts"
  - "kernel/src/api/server.ts"
  - "kernel/test/api.test.ts"
  - "kernel/src/cli/index.ts"
  - "kernel/test/cli.test.ts"
  - "kernel/test/sessions-cwd.test.ts"
  - "kernel/test/phase-4-exit-live.test.ts"
  - "docs/evidence/phase-4-exit-runbook.md"
  - "docs/ARCHITECTURE.md"
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

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/brain/handler.ts:359-387` | yes | HOLDS | `let cwd = session.memoryCwd;` … `cwd = listed;` … `sessions.resumeSession(resumeId, { prompt, permissionMode, cwd, policy })` | tip 59 minutes ago, fetched <1h |
| `kernel/src/sessions/manager.ts:2144` | yes | HOLDS | `#refuseProtectedCwd(cwd: string, sessionId: number \| null): void {` | tip 59 minutes ago, fetched <1h |
| `kernel/src/sessions/manager.ts:2499` | yes | HOLDS | `` `INSERT INTO sessions (agent, task_id, sdk_session_id, status, model, auth_account, loomwright_path, playbook, playbook_version, started_at, ended_at, updated_at)`` | tip 59 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Resume comparison resolves differently from the stored value, so a symlinked workspace refuses its own resume | HIGH | One exported resolver in `kernel/src/protected-paths.ts` used for both the insert and the comparison; AC3's symlink case pins it. |
| CI runs on `ubuntu-latest`: `/System/Volumes/Data` does not exist and `/tmp` is not a symlink there, while macOS `/tmp` → `/private/tmp` | MEDIUM | Tests compute expectations from `realpathSync(tmp)` and build the firmlink form by prefixing the realpath (as `kernel/test/sessions.test.ts`'s existing `firmlinked` case does), never hard-code `/private/tmp`. |
| Brain handler resumes an agent's interrupted session (`interruptedAgentSession`) with the new message's workspace; if it differs, the resume is now refused and the message fails `session_refused: …cwd_changed…` instead of running in the other folder | MEDIUM | This is the owner's chosen behavior (requirement "Resume: refuse a different cwd"); add a sessions-cwd test, and note it in the ARCHITECTURE bullet. Do not change the handler's routing (non-goal). |
| ~60 test `INSERT INTO sessions` seeds and fixture rows omit `cwd` | LOW | Column is nullable without default; such rows read null and resume as today (AC4). |
| Store integrity re-runs top migrations whose records were deleted; a bare `ALTER TABLE … ADD COLUMN` would fail with "duplicate column name" | MEDIUM | Reuse migration 14's `pragma_table_info` guard; extend the re-run test to 15. |
| Plan touches 15 files (13 modify, 2 create) (context-bound's file bound is > 12) but est. ~450 changed lines, mostly small pin updates; kept single-agent | LOW | One coherent change with heavy cross-file coupling (types ↔ manager ↔ status ↔ tests); a split would serialize anyway. |
| Live harness (`phase-4-exit-live.test.ts`) is skipped in `npm test`, so a wrong assertion is not caught by CI | LOW | Typecheck covers it; keep the assertion symmetric with the existing `brain_messages.workspace` check (both against `throwaway?.repo`, already a realpath). |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-20-kernel-records-session-cwd.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-20T08:22:40Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/97
- **Branch:** feature/kernel-records-session-cwd
- **Files changed:** 17
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Migration 015 adds nullable sessions.cwd, written as the realpath (protected-paths resolvedPath, the D31 resolution) by the row-creating INSERT; getSession, GET /status and studio status (shown()-escaped) show it; a resume whose resolved cwd differs is refused cwd_changed (one session_refused event, nothing spawned, row unchanged); pre-015 null rows resume as before. Live harness asserts the recorded cwd; ARCHITECTURE, runbook and OPEN_QUESTIONS updated. 1696 tests pass; all 11 pin mutations killed by hand. Phase 4.5: 1 fix iteration (stale OPEN_QUESTIONS line), then PASS with no issues; LOW brain.md note dismissed below floor. Drain not dispatched (.auto_review false — the /automate lane owns it). risk_classification high_risk=true (migrations, auth/token content, size).

## Not verified
- **kernel/test/phase-4-exit-live.test.ts recorded-cwd assertion (steps 4 and 5)** — live harness runs only with STUDIO_LIVE=1 and a real model; typechecked, not run (subtask 1)
- **Claude CLI resume transcript lookup when resumed from another cwd** — brief forbids probing a live session; recorded from Agent SDK 0.3.284 type docs only (subtask 1)
