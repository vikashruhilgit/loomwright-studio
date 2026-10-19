# 11 — The kernel records each session's working directory

## Status: ready

**Priority:** Phase 4 follow-up (audit; does not block the live exit rerun) · invariants 2, 3, 8 · D31, D5

**As** the owner,
**I want** the store to say where every session actually ran,
**so that** I, or anyone auditing the store, can see that a crew member's session ran in the workspace I named, without inferring it from the message that started it.

## Problem

The kernel decides a session's working directory and never records it.

- **The caller chooses it.** The brain handler picks the cwd (`kernel/src/brain/handler.ts:359-387`: the agent's memory folder, or the listed workspace a message names), and dry runs and playbook runs pick their own (`kernel/src/playbooks/dry-run.ts`, `runs.ts`). The session manager receives it as `StartSessionParams.cwd` or `ResumeSessionParams.cwd` (`kernel/src/sessions/types.ts`).
- **The manager uses it but stores nothing.** It checks it against D31's protected folders (`#refuseProtectedCwd`, `kernel/src/sessions/manager.ts:2144`) and hands it to the SDK (`cwd`, `projectPath`). But its `INSERT INTO sessions` (`manager.ts:2499`) has no cwd column, and no migration through 014 adds one.
- **No event records it either.** The only event carrying a cwd is `session_refused`, for a protected one. The live store holds no event whose payload has `cwd`.
- **A resume is a separate decision.** `resumeSession` takes its own `cwd`, so a resumed session can run in a different directory from its start.

The phase 4 live harness (`kernel/test/phase-4-exit-live.test.ts`, item 09) can therefore show only indirectly that a crew member ran in the owner's workspace: it reads `brain_messages.workspace`, the folder the handler starts the session in. The runbook says so ("the kernel records no cwd on the session row"). Anyone auditing the store sees what was asked for, not where the session ran.

Found during item 09's exit-check work (PR #93), and confirmed against `main` at `9f69a0f` and the live store on 2026-10-20.

## Owner decisions

- The phase 4 owner decisions in [the plan doc](_BACKLOG-2026-10-18-041110-phase-4-agent-roster.md) are unchanged. This item adds a record only: mechanism, no policy (invariant 1). It never changes which cwd a session gets, or the D31 refusal.

## Open questions (the owner's; answer here before this item is queued)

The lane must not choose these. If any is still open when the lane starts, it stops and says so, and it implements nothing.

1. **A column or an event?**
   - (a) A nullable `sessions.cwd` column (a migration, plus the `store.test.ts` pins), written in the same insert as the row and returned by `getSession` and `/status`.
   - (b) A `cwd` field on the session's first `session_status` event (`to: "starting"`), or on a new `session_cwd` event. That needs no migration, but a reader has to join events.
   - (c) Both.
2. **What a resume records.** A resume may pass another cwd.
   - (a) Each launch attempt, start and every resume, records its own cwd, and a column, if chosen, holds the latest.
   - (b) Only the start is recorded, and a resume with a different cwd is refused.
   - (c) Only the start is recorded, and a resume's differing cwd is recorded as an event.
3. **Which form of the path.**
   - (a) The path as the caller gave it.
   - (b) Its realpath, resolved the way the D31 check resolves it (through symlinks, with the `/System/Volumes/Data` firmlink removed).
   - (c) Both.

## Scope

Once the questions are answered:

1. **Record it.** The session manager records the cwd of every launch, start and resume as the owner chose, in the same transaction as the row or event it belongs to, so a `kill -9` can never leave a session row without its cwd (invariant 2). A refused launch (`protected_cwd`, `invalid_params`, an admission refusal) records nothing new; `protected_cwd` keeps its existing `session_refused` event. The value is read from the params the manager already validated, never from the model or from the hook input.
2. **Show it.** `getSession` (and `/status`'s running sessions, if a column is chosen) returns it. Stored paths are owner-visible text: printed escaped, as every stored text is.
3. **Use it in the live harness.** `kernel/test/phase-4-exit-live.test.ts` steps 4 and 5 assert the reviewer's session ran in step 1's repo from the recorded cwd, and keep `brain_messages.workspace` as a second check. `docs/evidence/phase-4-exit-runbook.md` replaces "the kernel records no cwd on the session row" with what is recorded.
4. **Docs.** `docs/ARCHITECTURE.md` gets the `sessions` data-model row (or the event) and the session-manager bullet on cwd.

## Non-goals

- Changing which cwd any session gets, or the D31 check.
- The per-tool-call cwd: the rail reads the hook input's `cwd`, which can drift after a `cd` (OPEN_QUESTIONS, "PreToolUse hook input `cwd`"). `tool_decision` events don't carry it, and that stays a separate question.
- Backfilling sessions recorded before the change. They read null, or have no event.

## Acceptance criteria

- [ ] Given a crew member asked with `--workspace /repos/demo`, when its session starts, then the store records `/repos/demo` (in the form chosen in question 3) for that session, and `getSession` returns it.
- [ ] Given a message naming no workspace, when the session starts, then the store records the agent's memory folder.
- [ ] Given a resume, then the store reflects the answer to question 2: a second cwd recorded, a refusal, or an event.
- [ ] Given a `protected_cwd` refusal, then no session cwd is recorded beyond the existing `session_refused` event.
- [ ] Given the kernel killed between the row's insert and the session's first message, then the recorded cwd is already in the store (one transaction).
- [ ] Given every existing sessions, brain, playbook and phase 4 exit test, then each passes unchanged apart from the new field.
- [ ] The live harness's steps 4 and 5 check the recorded cwd, and `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- The cwd is not secret (a repo path or a memory folder under the data dir), so recording it in the store, and in evidence files, is acceptable.

## Risks

- A migration (question 1a) is the next one after 014: append-only and contiguous, with the store's integrity checks unchanged.
- Recording on every resume attempt, including the retries of a failed resume, must not double-write: key it on the launch attempt.

## Depends on
none

## Touches
kernel/src/store/migrations/
kernel/test/store.test.ts
kernel/src/sessions/manager.ts
kernel/src/sessions/types.ts
kernel/src/api/server.ts
kernel/test/sessions-cwd.test.ts
kernel/test/phase-4-exit-live.test.ts
docs/evidence/phase-4-exit-runbook.md
docs/ARCHITECTURE.md
