# 05: Session manager (spawn, gate, stop, reap, resume)

## Status: ready

**Priority:** MVP

## Story

As the kernel, I want to start, gate, stop and reap Claude sessions myself, so that no session outlives the kernel's knowledge of it, every tool call passes a gate the brain can't edit, and a `kill -9` of the kernel never leaves orphaned agents running (invariants 2 and 3; Q5).

## Acceptance criteria

1. **Given** `startSession({agent, task, prompt, model, permissionMode, cwd})`, **when** it runs, **then** it calls SDK `query()` with:
   - `settingSources: []`;
   - `plugins: [{type: 'local', path: <Loomwright path>}]`;
   - `env` from the auth provider (item 04);
   - an explicit `model` and `permissionMode` (both required; there are no defaults, because the CLI default model is Opus, per Q1);
   - `includeHookEvents: true`;
   - a **streaming** async-iterable prompt, so in-process kernel tools work (Q5).
2. **Given** the spawn, **when** the CLI child starts, **then** the kernel launches it through `spawnClaudeCodeProcess` as the leader of a **new process group**. The group id is written to `sessions.pgid` **before** the first message is awaited.
3. **Given** a session, **when** any tool is called, **then** a kernel `PreToolUse` hook callback decides allow or deny from a per-session policy object (phase 1: an allowlist of tool names and Bash command prefixes, deny by default). Every decision is appended to `events`. `bypassPermissions` can't be set. This must hold even for read-only commands such as `echo`, which Q5 showed skip `canUseTool`.
4. **Given** a running session, **when** `stopSession(id)` runs, **then** the kernel closes the input, waits up to 2 s, then kills the whole process group. The session ends `stopped`, and no process from the group remains (a test checks with `kill -0`).
5. **Given** kernel start-up, **when** `sessions` has rows in `starting`/`running` whose process group is still alive, **then** the reaper kills each group, marks the session `interrupted`, and appends an event. Groups that are gone are just marked `interrupted`.
6. **Given** an `interrupted` session with an `sdk_session_id`, **when** it's resumed, **then** the kernel calls `query({resume})` with the same isolation options. Resume is **retryable**, up to 3 attempts with backoff, and the full error text of each failure is recorded (Q5's lost error).
7. **Given** an auth failure (a 401 or `authentication_failed`), **when** it occurs, **then** the kernel's own timeout (default 30 s) aborts the session instead of waiting on the CLI's retries (>60 s seen in Q4), marks it `failed:auth`, and emits a notify event. It never retries in a loop.
8. **Given** the Loomwright path, **when** it's resolved, **then** it comes from config, with a fallback to the newest `~/.claude/plugins/cache/atelier/loomwright/<version>/`, and is recorded on the session row.
9. Unit tests inject a fake `query` and a fake spawner. One opt-in live test (`STUDIO_LIVE=1`, Haiku) runs a real session that tries `touch gated.txt` under a policy that denies it, and asserts the file doesn't exist.

## Out of scope

Approval UI (phase 2; phase 1 denies anything not allowlisted). Agent roster and charters (phase 4).

## Dependencies

03, 04.

## Risks

- This is the largest item. If it grows past one reviewable PR, split AC 5–6 (reaper and resume) into a follow-up and say so in the PR.
- Process-group handling differs on Linux; target macOS and note the gap.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-02T06:08:32Z
- **Brief:** .supervisor/jobs/done/2026-10-02-05-session-manager.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/13
