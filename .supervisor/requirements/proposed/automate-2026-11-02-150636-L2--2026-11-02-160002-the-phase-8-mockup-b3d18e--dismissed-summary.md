# Dismissed findings below the tracking threshold: 2026-11-02-160002-the-phase-8-mockup (3)

## Status: proposed

- **Run:** automate-2026-11-02-150636-L2
- **Item:** .supervisor/requirements/phase-8/2026-11-02-160002-the-phase-8-mockup.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/217
- **Decision:** follow-up

## Depends on
none

## Touches
unknown

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 6d098ddf

```
> DESIGN.md:253 and README:406 called open points 1-7 fields with no declared source; 5-7 are rule/route differences (reworded in passing by fix iteration 1)
```

### Entry 2

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 586156ca

```
> setView not-keep reset did not clear S.back, so the Back label leaked across review-strip jumps (fixed in fix iteration 2 as a remaining instance of round 1's reset class)
```

### Entry 3

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 893bcaf5

```
> After Allow once on #7, Open the task shows PR #21 history still 'Waiting on you: approval #7' (in-app flow only; fresh hash loads and screenshots unaffected)
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
