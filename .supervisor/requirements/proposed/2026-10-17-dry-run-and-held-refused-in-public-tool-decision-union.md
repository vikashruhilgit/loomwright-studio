# Add `dry_run` and `held_refused` to the public ToolDecisionReason union

## Status: proposed

**Follow-up of:** phase 3 item 07 (Wright dry-runs a playbook and asks to enable it), job `2026-10-17-playbook-dry-run-and-enable`. It covers, and so replaces, the earlier draft `2026-10-16-dry-run-reason-in-public-tool-decision-union.md` (item 03's, `dry_run` only); a human decides which one to promote and drops the other.

## Problem

The PreToolUse gate records two `tool_decision` reasons that the public `ToolDecisionReason` union in `kernel/src/sessions/policy.ts` does not list:

- `dry_run` (item 03): a dry-run session's call that the policy and the rail let through and that is not read-only, denied and recorded as would-do.
- `held_refused` (item 07): a call to a tool in `ALWAYS_HELD_TOOLS` that the tool's pre-hold check (`beforeHold`) refused before the hold: no approval written, no grant used.

Both are gate-local today: the gate's reason type in `kernel/src/sessions/manager.ts` is `GateReason = ToolDecisionReason | "kernel_gate_error" | "dry_run" | "held_refused"`. `ToolDecisionReason` already lists other gate- and rail-only reasons (`approval_required`, `approval_granted`, `protected_kernel_path`, `merge_blocked`), so a consumer that switches on it never sees these two.

## Scope

1. Add `dry_run` and `held_refused` to `ToolDecisionReason` in `kernel/src/sessions/policy.ts`, each with a doc line.
2. Reduce `GateReason` in `manager.ts` to `ToolDecisionReason | "kernel_gate_error"`.
3. Update the sentences in `docs/architecture/dry-run.md` and `docs/architecture/approvals.md` that say these reasons are not yet in the public union.

## Acceptance criteria

- [ ] `ToolDecisionReason` includes `dry_run` and `held_refused`; the gate's reason type is `ToolDecisionReason | "kernel_gate_error"`.
- [ ] No `tool_decision` event payload changes (the same reason strings are recorded).
- [ ] `cd kernel && npm run typecheck && npm test` and `bash scripts/check-docs.sh` pass.
