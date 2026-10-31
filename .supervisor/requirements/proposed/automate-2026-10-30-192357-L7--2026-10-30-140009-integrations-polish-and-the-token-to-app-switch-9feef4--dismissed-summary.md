# Dismissed findings below the tracking threshold: 2026-10-30-140009-integrations-polish-and-the-token-to-app-switch (3)

## Status: proposed

- **Run:** automate-2026-10-30-192357-L7
- **Item:** .supervisor/requirements/phase-7/2026-10-30-140009-integrations-polish-and-the-token-to-app-switch.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/188
- **Decision:** follow-up

## Depends on
none

## Touches
app/e2e/integrations-switch.spec.ts
app/e2e/integrations.spec.ts
docs/DESIGN.md
docs/architecture/app.md

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 0
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 058bda19

```
> app/e2e/integrations-switch.spec.ts copies helpers verbatim from app/e2e/integrations.spec.ts (launchWith, openedUrls, countPointer, byId, tabTo, settle); a shared non-spec helper module could hold them
```

### Entry 2

- **Round:** 0
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 89cc60d5

```
> docs/DESIGN.md Integrations section still says the palette offers three commands; the screen now has four and a Switch button (DESIGN.md is the approved phase-6 record; docs/architecture/app.md is updated)
```

### Entry 3

- **Round:** 2
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Key:** aa1167f0

```
> docs/DESIGN.md open-point 9 and the 'The token-to-App switch (a proposal)' heading are not annotated as built by item 09 / D37, unlike sibling bullets 6 and 8
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
