# Dismissed findings below the tracking threshold: 06-budget-meter-and-cap (2)

## Status: proposed

- **Run:** automate-2026-09-30-211858
- **Item:** .supervisor/requirements/phase-1/06-budget-meter-and-cap.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/15
- **Decision:** follow-up

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 9a09134a

```
> kernel/src/budget/cap.ts:229 — a rejected rate_limit_event arriving after a text_fallback park for the same hit records its own window and sends a second notify
```

### Entry 2

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** f51f08fd

```
> kernel/src/budget/cap.ts:316 — superseded cap_recheck/cap_reset wake-ups stay pending after a park extension; item-07 consumer must treat a cap_* wake-up as 're-ask admission', never 'park ended'
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
