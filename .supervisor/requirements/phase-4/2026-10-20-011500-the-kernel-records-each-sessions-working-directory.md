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

## Owner decisions (2026-10-20, binding)

- The phase 4 owner decisions in [the plan doc](_BACKLOG-2026-10-18-041110-phase-4-agent-roster.md) are unchanged. This item adds a record only: mechanism, no policy (invariant 1). It never changes which cwd a session gets, or the D31 refusal.
- **Where: a `sessions.cwd` column.** It is nullable, written in the same insert as the row, and returned by `getSession` and by `studio status` / `GET /status` for running sessions. That needs migration 015, which is append-only and contiguous, with the `store.test.ts` pins updated.
- **Resume: refuse a different cwd.** Only the start's cwd is recorded, so the column never changes after the insert. A resume whose `cwd`, resolved the same way, is not the recorded one is refused before admission, auth or any spawn, with `SessionError("cwd_changed")` naming both paths. The refusal appends one `session_refused` event (`{reason: "cwd_changed", cwd, recorded_cwd}`), and the row's status is unchanged, so a resume with the right cwd still works. A row recorded before migration 015 has a null cwd and is resumed as today: there is nothing to compare against. Unverified, and the reason the owner chose this: the CLI keeps transcripts per project dir, so a resume in another folder probably could not find its transcript anyway. The lane records what it observes, if anything, without probing a live session.
- **Path form: the realpath.** The stored value is the cwd resolved the way the D31 check resolves it (`kernel/src/protected-paths.ts`: through symlinks as far as the path exists, with the `/System/Volumes/Data` firmlink prefix removed), so it shows where the session actually ran. The path as given is not stored.

## Scope

1. **Record it.** `startSession` writes the resolved cwd into `sessions.cwd` in the same insert as the row, so a `kill -9` can never leave a session row without its cwd (invariant 2). `resumeSession` compares its resolved cwd with the recorded one and refuses `cwd_changed` as the owner decided. A refused launch (`protected_cwd`, `invalid_params`, an admission refusal) records nothing new; `protected_cwd` keeps its existing `session_refused` event. The value is read from the params the manager already validated, never from the model or from the hook input.
2. **Show it.** `getSession` and `/status`'s running sessions return it. Stored paths are owner-visible text: printed escaped, as every stored text is.
3. **Use it in the live harness.** `kernel/test/phase-4-exit-live.test.ts` steps 4 and 5 assert the reviewer's session ran in step 1's repo from the recorded cwd, and keep `brain_messages.workspace` as a second check. `docs/evidence/phase-4-exit-runbook.md` replaces "the kernel records no cwd on the session row" with what is recorded.
4. **Docs.** `docs/ARCHITECTURE.md` gets the `sessions` data-model row (or the event) and the session-manager bullet on cwd.

## Non-goals

- Changing which cwd any session gets, or the D31 check.
- The per-tool-call cwd: the rail reads the hook input's `cwd`, which can drift after a `cd` (OPEN_QUESTIONS, "PreToolUse hook input `cwd`"). `tool_decision` events don't carry it, and that stays a separate question.
- Backfilling sessions recorded before the change. They read null, or have no event.

## Acceptance criteria

- [ ] Given a crew member asked with `--workspace /repos/demo`, when its session starts, then the store records `/repos/demo` (its realpath) for that session, and `getSession` returns it.
- [ ] Given a message naming no workspace, when the session starts, then `sessions.cwd` holds the agent's memory folder (resolved).
- [ ] Given an interrupted session started in `/repos/demo`, when it is resumed with cwd `/repos/other`, then the resume is refused `cwd_changed` naming both paths, with one `session_refused` event, nothing spawned, and the row unchanged. Resumed with `/repos/demo`, or through a symlink that resolves to it, then it resumes as today.
- [ ] Given a session row from before migration 015 (cwd null), when it is resumed, then it resumes as today.
- [ ] Given a cwd reached through a symlink, or written with the `/System/Volumes/Data` prefix, when the session starts, then `sessions.cwd` holds the resolved path.
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

- Migration 015 is the next after 014. The store's integrity checks (contiguous versions, no foreign triggers) are unchanged.
- The resume check must use the same resolution as the stored value, or a symlinked workspace would refuse its own resume. The AC covers it.

## Depends on
none

## Touches
kernel/src/store/migrations/
kernel/test/store.test.ts
kernel/src/sessions/manager.ts
kernel/src/sessions/types.ts
kernel/src/protected-paths.ts
kernel/src/api/server.ts
kernel/test/sessions-cwd.test.ts
kernel/test/phase-4-exit-live.test.ts
docs/evidence/phase-4-exit-runbook.md
docs/ARCHITECTURE.md
