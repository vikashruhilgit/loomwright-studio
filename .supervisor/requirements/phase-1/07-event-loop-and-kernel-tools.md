# 07: Event loop, wake-ups, idempotent work steps, and kernel tools

## Status: ready

**Priority:** MVP

## Story

As the kernel, I want a durable event queue, scheduled wake-ups, and in-process kernel tools whose effects are keyed so they happen at most once, so that a session can create tasks and schedule its next wake-up, and nothing is done twice after a crash (invariant 2, phase 1 exit criterion).

## Acceptance criteria

1. **Given** an event (user message, wake-up due, or internal), **when** it's enqueued, **then** it's written to SQLite first. The loop processes events in order and marks each one `done` only after its effects are committed. After a restart, unfinished events are processed again.
2. **Given** a work step with key `k`, **when** `runStep(k, fn)` runs, **then**:
   - if `work_steps[k]` is `done`, it returns the stored result without calling `fn`;
   - if it's `started` (from a crash), `fn` runs again only if the step is declared **re-runnable**, and otherwise it's marked `failed:interrupted` and a notify event is emitted;
   - otherwise it records `started`, runs `fn`, and records `done` with the result, in one transaction with the step's own writes where they're local.
3. **Given** the in-process MCP server `kernel`, **when** a session starts, **then** it exposes these tools, all `kernel_`-prefixed:
   - `kernel_task_create`, `kernel_task_update`, `kernel_task_list`, `kernel_task_get`;
   - `kernel_schedule_wakeup(at, reason)`;
   - `kernel_request_stop(handoff)`.

   Each takes a caller-supplied `idempotency_key` where it creates something, and goes through `runStep`. Repeating a call with the same key returns the first result.
4. **Given** `kernel_request_stop`, **when** a session calls it, **then** the kernel writes the handoff text to `memory/<agent>/handoffs/<task>.md` (markdown, invariant 8), ends the session through the session manager, and records the event.
5. **Given** a wake-up whose time has passed, including one missed while the kernel was down, **when** the loop ticks, **then** it fires exactly once, deduplicated by wake-up id.
6. **Given** the loop, **when** it runs, **then** it only provides mechanisms. No playbook, trigger type, dedupe policy or priority rule is built in (invariant 1). Phase 1 has only the `wakeup` and `message` event kinds.
7. Unit tests cover:
   - a crash between `started` and `done` (simulated by throwing);
   - repeated tool calls with the same key;
   - a missed wake-up firing once after a restart.

## Out of scope

Triggers such as poll, cron, hook and webhook (phase 2+). Playbooks (phase 3). The approval-request tool (phase 2).

## Dependencies

03, 05, 06.

## Risks

"Exactly once" is only true for effects inside SQLite. External effects (a `gh` comment, say) are at most once only through the idempotency key plus the check. Document that limit in the code where `runStep` is defined.
