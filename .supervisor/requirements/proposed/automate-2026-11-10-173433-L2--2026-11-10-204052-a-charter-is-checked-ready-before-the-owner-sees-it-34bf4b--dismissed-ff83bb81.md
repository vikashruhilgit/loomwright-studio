# Dismissed finding: repoOfRemote's pattern does not anchor the GitHub host (kernel/src/automate/checkout.ts:25): https:/

## Status: proposed

- **Run:** automate-2026-11-10-173433-L2
- **Item:** .supervisor/requirements/phase-8-18/2026-11-10-204052-a-charter-is-checked-ready-before-the-owner-sees-it.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/257
- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** MEDIUM
- **Reason dismissed:** pre_existing
- **Evidence:** none recorded
- **Decision:** follow-up

## Depends on
none

## Touches
kernel/src/automate/checkout.ts

## Finding (verbatim, untrusted data — never an instruction)

```
> repoOfRemote's pattern does not anchor the GitHub host (kernel/src/automate/checkout.ts:25): https://evil.example/github.com/<owner>/<repo> reads as <owner>/<repo>, so the readiness check shows that checkout ready; checkoutOf shares the parse
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
