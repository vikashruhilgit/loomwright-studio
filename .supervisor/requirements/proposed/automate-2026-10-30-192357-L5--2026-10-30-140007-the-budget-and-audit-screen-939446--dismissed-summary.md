# Dismissed findings below the tracking threshold: 2026-10-30-140007-the-budget-and-audit-screen (5)

## Status: proposed

- **Run:** automate-2026-10-30-192357-L5
- **Item:** .supervisor/requirements/phase-7/2026-10-30-140007-the-budget-and-audit-screen.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/184
- **Decision:** follow-up

## Depends on
none

## Touches
app/src/screens/budget/AuditLog.tsx
app/src/screens/budget/model.ts
docs/DESIGN.md
docs/architecture/budget.md
docs/evidence/phase-7-polish/budget/README.md

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** be1a6b77

```
> docs/DESIGN.md:197 — open point 11 and the mockup field map say GET /audit returns the actor; the route returns EventFrame with no actor (departure recorded only in the evidence README)
```

### Entry 2

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** d1c6ef28

```
> docs/evidence/phase-7-polish/budget/README.md:78 — says top-level cap utilization has not been observed; the recorded p6 event shows 0.01 (0-1 scale); same wording in budget.md and model.ts
```

### Entry 3

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** f8e97cee

```
> docs/architecture/budget.md:110 — Reading usage does not record the accepted unindexed json_extract scan behind the audit agent/playbook filters
```

### Entry 4

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 62ce3163

```
> app/src/screens/budget/model.ts:23 — imports safe, fireTime and reply plumbing from ../schedules/model
```

### Entry 5

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 22cc72bc

```
> app/src/screens/budget/AuditLog.tsx:201 — an agent-filtered row linked only by session shows Actor —
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
