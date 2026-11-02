# Dismissed findings below the tracking threshold: 2026-11-01-090023-tasks-last-known-board-across-remounts-kind-icons-and-crumb (3)

## Status: proposed

- **Run:** automate-2026-11-01-171537-L6
- **Item:** .supervisor/requirements/phase-7/2026-11-01-090023-tasks-last-known-board-across-remounts-kind-icons-and-crumb.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/210
- **Decision:** follow-up

## Depends on
none

## Touches
unknown

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 0
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** f1823016

```
> lastKnown.ts keyOf(api) indirection loosens the map key to WeakMap<object, …> vs the sibling settings store's WeakMap<StudioBridge, …>
```

### Entry 2

- **Round:** 0
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 255912c4

```
> TaskDetail.tsx re-wrapped header comment has an over-long line; Crumb JSX usages sit on one long line
```

### Entry 3

- **Round:** 1
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** invalid — not a defect; Playwright name match is substring so "Back" matches "Back to Tasks"; below MEDIUM fix floor
- **Key:** a065323d

```
> e2e tasks.spec.ts:688 still asserts name "Back" after tabTo matched /^Back to Tasks$/ — reviewer self-labels not a bug (Playwright substring match)
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
