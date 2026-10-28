# Dismissed findings below the tracking threshold: 2026-10-24-095107-draft-mode-records-outward-calls-instead-of-sending-them (5)

## Status: proposed

- **Run:** automate-2026-10-27-114124-L5
- **Item:** .supervisor/requirements/phase-6/2026-10-24-095107-draft-mode-records-outward-calls-instead-of-sending-them.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/150
- **Decision:** follow-up

## Depends on
none

## Touches
docs/architecture/approvals.md

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 15f3af70

```
> Deviation: integrations-github-connector.test.ts (outside lanes) route-count assertion changed, beyond AC5's permitted existing-assertion changes
```

### Entry 2

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 753d8005

```
> Deviation: integrations-foundation.test.ts 'four routes' assertion grew to six routes, beyond AC5's named empty-part filter change
```

### Entry 3

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 1d97269c

```
> GET /drafts/:id answers 400 invalid_query for integer ids '0' and '007' instead of 404 no_draft
```

### Entry 4

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 16bbbca5

```
> draftView's first two properties share a line (the brief's prescribed pin-mutation spelling)
```

### Entry 5

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** drift
- **Key:** 27e7986b

```
> docs/architecture/approvals.md item 7 omits the oversize-command clause added to draft-mode.md step 5
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
