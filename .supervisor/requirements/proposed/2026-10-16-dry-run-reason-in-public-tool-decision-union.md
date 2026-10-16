# Add `dry_run` to the public ToolDecisionReason union

## Status: proposed

**Follow-up of:** phase 3 item 03 (a dry-run session can read but never act), job `2026-10-16-dry-run-session-read-never-act`.

## Problem

Item 03 added a new `tool_decision` reason, `dry_run`, that the PreToolUse gate records for every call a dry-run session would have made. `kernel/src/sessions/policy.ts` and `kernel/src/sessions/index.ts` were outside that wave's lanes, so `dry_run` is a gate-only reason like `kernel_gate_error`: the gate's reason type in `kernel/src/sessions/manager.ts` is `ToolDecisionReason | "kernel_gate_error" | "dry_run"`. `ToolDecisionReason` is the public list of `tool_decision` reasons (it already lists the gate- and rail-only `approval_required`, `approval_granted`, `protected_kernel_path`, `merge_blocked`), so a consumer that switches on it never sees `dry_run`.

## Scope

1. Add `dry_run` to `ToolDecisionReason` in `kernel/src/sessions/policy.ts`, with a doc line (a dry-run session's call the policy and the rail let through that is not read-only: denied and recorded as would-do, never an approval).
2. Drop the `| "dry_run"` from the gate's local reason type in `manager.ts`.
3. Update `docs/architecture/dry-run.md` (the sentence saying `dry_run` is not yet in the public union).

## Acceptance criteria

- [ ] `ToolDecisionReason` includes `dry_run`; the gate's reason type is `ToolDecisionReason | "kernel_gate_error"`.
- [ ] `cd kernel && npm run typecheck && npm test` and `bash scripts/check-docs.sh` pass.
