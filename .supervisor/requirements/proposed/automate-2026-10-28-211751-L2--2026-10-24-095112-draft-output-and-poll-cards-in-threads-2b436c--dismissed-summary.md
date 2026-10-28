# Dismissed findings below the tracking threshold: 2026-10-24-095112-draft-output-and-poll-cards-in-threads (6)

## Status: proposed

- **Run:** automate-2026-10-28-211751-L2
- **Item:** .supervisor/requirements/phase-6/2026-10-24-095112-draft-output-and-poll-cards-in-threads.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/156
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
- **Key:** 85611d15

```
> Test source holds a literal U+202E on two lines of integrationCards.test.tsx instead of the \u202e escape
```

### Entry 2

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 7251e813

```
> Evidence README lacks a Known-limits section (skip-run grouping has no fire id; PR URL is text only)
```

### Entry 3

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 4ca7d515

```
> A failed GET /drafts/:id is not retried until the card remounts
```

### Entry 4

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 4e02140c

```
> DraftCard name also used by components/ChatBubble (different component)
```

### Entry 5

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 14f6bba9

```
> Batch payload block has no try/finally; a malformed GET /events body would leave in-flight entries unresolved
```

### Entry 6

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 96b468b9

```
> A batch reads the full id span (up to 500 rows), not only the wanted ids
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
