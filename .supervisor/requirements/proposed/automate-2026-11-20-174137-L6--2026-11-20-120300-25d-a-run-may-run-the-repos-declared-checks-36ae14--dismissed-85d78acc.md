# Dismissed finding: fix not re-reviewed (final heal iteration): a run session could forge refs/remotes/origin/main via `

## Status: proposed

- **Run:** automate-2026-11-20-174137-L6
- **Item:** .supervisor/requirements/phase-8-25/2026-11-20-120300-25d-a-run-may-run-the-repos-declared-checks.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/307
- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** HIGH
- **Reason dismissed:** escalated_unfixed
- **Evidence:** none recorded
- **Decision:** follow-up

## Depends on
none

## Touches
unknown

## Finding (verbatim, untrusted data — never an instruction)

```
> fix not re-reviewed (final heal iteration): a run session could forge refs/remotes/origin/main via `git branch -r -d origin/HEAD` + `git worktree add .git/refs/remotes/origin <branch>`, defeating AC5 across launches; fix 2643a3c4 refuses both, but the base ref still lives in a session-writable checkout (trust-root decision: pin base sha at first launch, or a kernel-only ref namespace)
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
