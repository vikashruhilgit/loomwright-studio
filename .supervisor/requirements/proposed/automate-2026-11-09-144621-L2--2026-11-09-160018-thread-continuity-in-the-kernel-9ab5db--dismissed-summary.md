# Dismissed findings below the tracking threshold: 2026-11-09-160018-thread-continuity-in-the-kernel (3)

## Status: proposed

- **Run:** automate-2026-11-09-144621-L2
- **Item:** .supervisor/requirements/phase-8-17/2026-11-09-160018-thread-continuity-in-the-kernel.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/250
- **Decision:** follow-up

## Depends on
none

## Touches
docs/architecture/threads.md

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 7366b5ec

```
> start-fresh writes the owner's summary file before the transaction; a concurrent losing start-fresh has already overwritten it
```

### Entry 2

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Evidence:** none recorded
- **Key:** 5814d32a

```
> docs/architecture/threads.md refusal note listed only symlink_refused and hard_link_refused
```

### Entry 3

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 9a72b0d7

```
> FIFO test's detached sh watchdog can be orphaned if the test times out or is cancelled inside its try block
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
