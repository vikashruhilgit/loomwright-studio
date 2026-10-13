# Dismissed finding: kernel/src/budget/cap.ts:188 / admission.ts:63 — parks and admission key on the provider's live acco

## Status: proposed

- **Run:** automate-2026-09-30-211858
- **Item:** .supervisor/requirements/phase-1/06-budget-meter-and-cap.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/15
- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** MEDIUM
- **Reason dismissed:** below_severity_floor
- **Decision:** follow-up

## Finding (verbatim, untrusted data — never an instruction)

```
> kernel/src/budget/cap.ts:188 / admission.ts:63 — parks and admission key on the provider's live account label; relabelling the account while parked lifts an unexpired park (one re-probe launch on a capped account, then re-park + second notify)
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
