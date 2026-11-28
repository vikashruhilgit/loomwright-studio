# Dismissed finding: The idempotency claim (docs/architecture/brain.md:405, kernel/src/brain/memory-propose.ts:18-20, doc

## Status: proposed

- **Run:** automate-2026-11-28-074140
- **Item:** .supervisor/requirements/wright-aware/2026-11-21-230500-wa-f-agents-propose-lessons-and-the-owner-approves-them.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/321
- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** MEDIUM
- **Reason dismissed:** escalated_unfixed
- **Evidence:** none recorded
- **Decision:** follow-up

## Depends on
none

## Touches
docs/architecture/brain.md
docs/evidence/wa-f-memory-proposals.md
kernel/src/brain/memory-propose.ts

## Finding (verbatim, untrusted data — never an instruction)

```
> The idempotency claim (docs/architecture/brain.md:405, kernel/src/brain/memory-propose.ts:18-20, docs/evidence/wa-f-memory-proposals.md:23) holds only within one session: the decision is delivered in a new session row and the key check is per requesting_session, so a repeat there is held again and a second Allow once appends the entry twice
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
