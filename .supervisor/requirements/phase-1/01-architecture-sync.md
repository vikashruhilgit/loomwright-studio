# 01: Bring ARCHITECTURE.md in line with the probe findings

## Status: ready

**Priority:** MVP · **Type:** docs only (no code)

## Story

As the owner, I want `docs/ARCHITECTURE.md` to match what the SDK probes proved (D26–D29), so that every later phase 1 item builds from a correct spec, not a stale one.

## Context

`ARCHITECTURE.md` was written before the probes (`docs/OPEN_QUESTIONS.md`, all six technical items now answered). Three parts are now wrong.

## Acceptance criteria

1. **Given** the Auth section, **when** it's read, **then** it describes the `subscription` provider as D27 does: a `claude setup-token` token read from the Keychain item `loomwright-studio-oauth` and passed as `CLAUDE_CODE_OAUTH_TOKEN`, with `settingSources: []`, Loomwright loaded by path, and `ANTHROPIC_API_KEY` stripped from the child environment. It must also say the provider is **personal-build only** and compiled out of any distributed build (D29). The phrase "uses the Claude Code login already on the machine" is gone.
2. **Given** the Kernel tools list, **when** it's read, **then** every tool name carries the `kernel_` prefix (`kernel_task_create`, …), with one line explaining why: Q5 showed an unprefixed `task_create` loses to the built-in `TaskCreate`.
3. **Given** Main loop step 2, **when** it's read, **then** it cites D28: the kernel detects the cap from `rate_limit_event` `status: 'rejected'`, parks until `resetsAt` and notifies, and a playbook can opt in to the API-key fallback.
4. **Given** the Session manager, **when** it's described anywhere in the doc, **then** it states the Q5 requirements:
   - the kernel spawns the CLI itself (`spawnClaudeCodeProcess`) in its own process group, recorded in SQLite before start, with a boot-time reaper;
   - every session sets `model` and `permissionMode` explicitly;
   - every tool call passes a kernel `PreToolUse` hook callback;
   - kernel tools need streaming input.
5. **Given** the Data model, **when** it's read, **then** `sessions` includes the process group id and the auth account, `budget` follows D26 (input + output + cache writes count; cache reads recorded, not counted), and a `work_steps` table (idempotency keys, see item 07) is listed.
6. **Given** the Safety kernel section, **when** it's read, **then** it notes that the CLI's builtin `agents-md` plugin loads a worked-on repo's `AGENTS.md` into the model, so that file is untrusted input (invariant 3).
7. No decision in `DECISIONS.md` is changed, and every changed statement cites its D# or Q#.

## Out of scope

Any code. Any new decision.

## Dependencies

PR #3 merged.

## Risks

Low. The main risk is paraphrasing a decision wrongly, so quote D# wording where it matters.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-01T00:03:28Z
- **Brief:** .supervisor/jobs/done/2026-09-30-01-architecture-sync.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/5
