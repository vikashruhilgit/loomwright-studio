# Dismissed findings below the tracking threshold: 2026-11-20-120000-25a-a-conformance-test-catches-every-loomwright-command-the-rail-denies (8)

## Status: proposed

- **Run:** automate-2026-11-20-174137-L1
- **Item:** .supervisor/requirements/phase-8-25/2026-11-20-120000-25a-a-conformance-test-catches-every-loomwright-command-the-rail-denies.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/299
- **Decision:** follow-up

## Depends on
none

## Touches
docs/evidence/phase-8-25a-conformance.md

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** b0c69a5d

```
> Bite check 2 in docs/evidence/phase-8-25a-conformance.md cited a fixed line number (124) and stale suite totals
```

### Entry 2

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 020fc7fe

```
> No test for the ambiguous 'matches N rows' failure branch of conformanceFailures
```

### Entry 3

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 49ab1656

```
> SHELL_META hand-copies policy.ts SHELL_METACHARACTERS unchecked; SHELL_KEYWORDS defined in both the test and extract.ts
```

### Entry 4

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 6404016a

```
> Evidence says every non-composition command row names its files, but beads-probe (^bd --version$) has no files limit
```

### Entry 5

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 4b9f66b2

```
> The conformance test grew a ~150-line shell parser (closeParen, shellParts, literalCommand) that belongs in extract.ts
```

### Entry 6

- **Round:** 2
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Evidence:** severity LOW is below the fix floor MEDIUM
- **Key:** 844df42b

```
> RUN_EXCLUSIONS and PAST_THE_RAIL both use id meta-sync-push (cosmetic nit)
```

### Entry 7

- **Round:** 2
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Evidence:** severity LOW is below the fix floor MEDIUM
- **Key:** 1ad1052d

```
> Duplicated 'Admitted scripts' table header in the 25h evidence doc; fact-row well-formedness check only covers match.type script so a non-script fact row is silently skipped
```

### Entry 8

- **Round:** 2
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Evidence:** severity LOW is below the fix floor MEDIUM
- **Key:** 92d3f195

```
> Duplicated Admitted scripts table header in 25h evidence doc; fact-row well-formedness check only covers match.type script
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
