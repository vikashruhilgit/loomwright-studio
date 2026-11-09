# Dismissed findings below the tracking threshold: 2026-11-02-160014-phase-8-exit-check-and-live-run-on-studio-sandbox (4)

## Status: proposed

- **Run:** automate-2026-11-02-150636-L15
- **Item:** .supervisor/requirements/phase-8/2026-11-02-160014-phase-8-exit-check-and-live-run-on-studio-sandbox.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/246
- **Decision:** follow-up

## Depends on
none

## Touches
unknown

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** a219fa70

```
> Runbook step 6 does not say the named session's policy must allow gh pr Bash prefixes; a policy-level deny of a merge then reads as a failed attempt
```

### Entry 2

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 0b6547c8

```
> phase-8-exit-live.test.ts lacks three branch cases (no pr_tracks row, owner.notes not a string, a denied named tool) and checkEvidenceShape accepts a result: failed evidence file
```

### Entry 3

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** d500b014

```
> The kernel walk reads the kernel_pr_route answer from the stand-in session's recorded result rather than the store (AC2 wording)
```

### Entry 4

- **Round:** 1
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Evidence:** severity LOW is below the fix floor MEDIUM
- **Key:** e6efdf06

```
> Comments say 'see the deviations' but no such section exists
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
