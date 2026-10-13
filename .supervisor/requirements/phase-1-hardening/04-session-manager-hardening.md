# H04: session manager — no stray kill, no stuck row, no blocking probe, honest stop-all output

## Status: ready

**Priority:** MVP · **Safety kernel (invariant 3): kill path and permission policy**

## Story

As the owner, I want the session manager to:

- never signal a process group after its session is gone;
- give me a way out of a session row it can't verify;
- never freeze the kernel on a slow `ps`;
- say clearly when a Bash allowlist entry hands a session arbitrary execution;

so that the kill path and the permission policy do what they claim.

## Evidence (verified against `main` at 4429d4b on 2026-10-03)

Already fixed and excluded here:

- F05-4: the reaper now reads EPERM as "not gone yet" (`manager.ts:812-817`, `spawner.ts:185-205`).
- F05-6: the ARCHITECTURE session-manager bullets were corrected (`ARCHITECTURE.md:85-87,96`).

Still present:

- **F05-1/F05-3 (still present, reproduced).** `kernel/src/sessions/spawner.ts:117-123` adds `options.signal.addEventListener("abort", killGroup, { once: true })` and never removes it when the child exits. The SDK aborts that signal from its transport `close()`, after `#authFail` (`manager.ts:1179`), so a late abort can SIGKILL a process group whose number has since been reused. The window is narrow (≤ ~2 s, auth-fail path only).
- **F05-2/F05-7 (partially present).** No Bash prefixes ship by default; the only non-test use of `allowedBashPrefixes` is validation at `manager.ts:305`. But neither `ToolPolicy` (`types.ts:40-58`, `policy.ts:16-37`) nor `docs/` warns about command-running programs. An allowed `find`, `xargs`, `env`, `git`, `npx`, `sed`, `awk`, `npm`, `sh` or `bash` gives arbitrary execution, because a command like `find . -exec rm {} +` contains no blocked shell character.
- **F05-5 (still present, bounded).** `manager.ts:953` → `#leaderStartIso` (`:1379-1386`) → `readGroupLeader` runs `execFileSync("/bin/ps", …, { timeout: 2000 })` (`spawner.ts:221,256-262`) inside the synchronous `onSpawn`. A hung `ps` freezes the kernel for up to 2 s per spawn or resume.
- **F05-8 (still present).** A row that is `orphaned` with `leader_unverified` is stuck: `stopSession` returns `not_live` (`manager.ts:559-562`) and resume is refused (`:637-642`). The CLI (`cli/index.ts:83-87`) and the API (`api/server.ts:282-288`) offer no way out. The row clears only at the next reap, which runs only at daemon start (`kernel.ts:187`).
- **F08-1 (still present).** `cli/index.ts:155` treats only `completed`, `interrupted` and `failed:auth` as already ended (`ALREADY_ENDED`). A session that failed by itself (`failed`, e.g. `result_error`, with `stop_requested_after_end`, `manager.ts:1288`) is printed "not confirmed stopped" and makes `stop --all` exit non-zero. It errs safe but is wrong.
- **F08-2 (still present, comment only).** The `stopAll` comment at `manager.ts:518` says the failed:auth timer "would die with a stopping kernel". In kill-switch mode the kernel keeps running, and `#stopForAll` (`:537-548`) never cancels `attempt.authTimer`. This is harmless, because `#killAttemptGroup` returns early on `groupGone` (`:1313`).

## Acceptance criteria

1. **Given** a session child that has exited, **when** the SDK later aborts the forwarded signal, **then** no signal is sent: the abort listener is removed on exit. A test spawns a short child, aborts after exit and asserts no kill.
2. **Given** `ToolPolicy`'s doc comment and `docs/ARCHITECTURE.md`'s permission-policy section, **when** someone reads them, **then** they say that a prefix allowlist matches at word boundaries and blocks shell characters, but that allowing a program which runs other programs grants arbitrary execution. The docs list examples (`find`, `xargs`, `env`, `git`, `npx`, `npm`, `sed`, `awk`, `sh`, `bash`). The kernel doesn't add a blocklist, because policy is the user's (invariant 1).
3. **Given** a spawn or resume, **when** the leader's start time is read, **then** the event loop isn't blocked by a synchronous child process. Either the probe is async or it is otherwise off the synchronous `onSpawn` path. A `null` start time stays handled as it is today, and a test proves a slow `ps` doesn't block other work.
4. **Given** a session row that is `orphaned` with `leader_unverified`, **when** the owner runs an explicit abandon action, **then** the row moves to a terminal state and an event records who abandoned it and when. The kernel never signals the group, because it can't verify the group is its own. The action is a CLI command that asks for confirmation (with a `--yes` flag for scripts) plus an API route. It refuses any row that is live or not `leader_unverified`. Tests cover the refusal and success paths.
5. **Given** `studio stop --all` with a session that had already failed by itself, **when** the output prints, **then** that session is reported as already ended, not as "not confirmed stopped", and the exit code reflects only sessions that are really unconfirmed. The difference is carried in the stop-all outcome, not guessed in the CLI.
6. **Given** a kill-switch stop of a failed:auth attempt whose group is confirmed gone, **when** stop-all settles it, **then** the auth timer is cancelled, and the comment at `manager.ts:518` describes what actually happens.

## Out of scope

Wright warning when it drafts a playbook with a risky prefix (a later playbook-drafting item can use AC 2's list). A periodic reaper.

## Dependencies

Phase 1 items 01–09 (merged). Independent of H01–H03.

## Risks

- AC 4 adds a terminal session state. Check every consumer of session status (the API `/status`, the CLI status output, crash-resume) so the new state is never read as resumable.
- AC 1 must not remove the abort listener before the child has really exited, or a legitimate abort would go unhandled.

## Source

Dismissed review findings from run `automate-2026-09-30-211858`, re-verified 2026-10-03: `proposed/…--05-session-manager-5d41c0--dismissed-summary.md` entries 1, 2, 3, 5, 7, 8 and `proposed/…--08-loopback-api-and-cli-8e3771--dismissed-summary.md` entries 1–2.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-04T17:13:27Z
- **Brief:** .supervisor/jobs/done/2026-10-04-h04-session-manager-hardening.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/29
