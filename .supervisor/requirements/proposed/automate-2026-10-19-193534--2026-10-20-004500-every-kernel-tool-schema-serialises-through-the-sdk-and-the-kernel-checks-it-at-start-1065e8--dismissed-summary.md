# Dismissed findings below the tracking threshold: 2026-10-20-004500-every-kernel-tool-schema-serialises-through-the-sdk-and-the-kernel-checks-it-at-start (5)

## Status: proposed

- **Run:** automate-2026-10-19-193534
- **Item:** .supervisor/requirements/phase-4/2026-10-20-004500-every-kernel-tool-schema-serialises-through-the-sdk-and-the-kernel-checks-it-at-start.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/95
- **Decision:** follow-up

## Depends on
none

## Touches
docs/OPEN_QUESTIONS.md
kernel/src/tools/server.ts
kernel/test/tools-sdk-list.test.ts

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 0e20ec63

```
> kernel/src/tools/server.ts:614 — the omitted-tool branch reused the 'does not serialise' detail
```

### Entry 2

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 305fedf1

```
> docs/OPEN_QUESTIONS.md:104 still says no test lists tools through the SDK and item 10 is pending
```

### Entry 3

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** e87af216

```
> docs/OPEN_QUESTIONS.md:104 is stale now that kernel/test/tools-sdk-list.test.ts exists
```

### Entry 4

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 917841aa

```
> kernel/src/tools/server.ts:610 — 'so sessions would not be offered them' is plural for a single omitted tool
```

### Entry 5

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 481e75aa

```
> kernel/src/tools/server.ts:600 — the unserialisable() reason says 'its input schema does not serialise' even when it names several tools
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
