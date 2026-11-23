# Dismissed finding: Notes disclosed limits: declared npm test runs working-tree files; run_declared_checks sentence lack

## Status: proposed

- **Run:** automate-2026-11-20-174137-L6
- **Item:** .supervisor/requirements/phase-8-25/2026-11-20-120300-25d-a-run-may-run-the-repos-declared-checks.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/307
- **Round:** 2
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** unspecified
- **Reason dismissed:** already-addressed: the working-tree limit is documented in the PR and the sentence has a dedicated test
- **Evidence:** app/src/screens/budget/audit-sentences.test.ts:144 tests run_declared_checks; docs/architecture/automate.md:145 "A declared check runs the working tree's files, not the base commit's"
- **Decision:** follow-up

## Depends on
none

## Touches
unknown

## Finding (verbatim, untrusted data — never an instruction)

```
> Notes disclosed limits: declared npm test runs working-tree files; run_declared_checks sentence lacks a unit test
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
