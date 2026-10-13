# Dismissed findings below the tracking threshold: 07-event-loop-and-kernel-tools (6)

## Status: proposed

- **Run:** automate-2026-09-30-211858
- **Item:** .supervisor/requirements/phase-1/07-event-loop-and-kernel-tools.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/17
- **Decision:** follow-up

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 0e776c6a

```
> kernel/src/loop/loop.ts:81 — stop() then start() while a tick is running leaves two live timer chains; the tick rate doubles and #cancel tracks only one chain (reproduced)
```

### Entry 2

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 2dca711e

```
> kernel/src/loop/loop.ts:165 — no floor on not_before: a retryAt at or before now redelivers the parked event every tick with one event_parked row each (reproduced; production admission only returns future retryAt)
```

### Entry 3

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** b7d95366

```
> kernel/src/loop/loop.ts:184 — a crash-interrupted, non-re-runnable step inside a handler emits two notifies: work_step_interrupted plus event_failed (reproduced)
```

### Entry 4

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 0acb0669

```
> kernel/src/loop/steps.ts:165 — work_steps.rerunnable is written but never read; claim() decides from the current caller's opts.rerunnable, contradicting the migration doc (reproduced)
```

### Entry 5

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 45b1728c

```
> kernel/src/loop/steps.ts:187 — runStep<T> returns the live T on the first call but a JSON round-trip on repeats (a Date becomes a string)
```

### Entry 6

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 97fb0623

```
> docs/ARCHITECTURE.md:65 — idempotency_key wording: kernel_task_update takes an optional key and kernel_request_stop (creates nothing) requires one
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
