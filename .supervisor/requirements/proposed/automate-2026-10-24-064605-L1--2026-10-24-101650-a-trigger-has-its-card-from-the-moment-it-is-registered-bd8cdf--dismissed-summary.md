# Dismissed findings below the tracking threshold: 2026-10-24-101650-a-trigger-has-its-card-from-the-moment-it-is-registered (2)

## Status: proposed

- **Run:** automate-2026-10-24-064605-L1
- **Item:** .supervisor/requirements/phase-5/2026-10-24-101650-a-trigger-has-its-card-from-the-moment-it-is-registered.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/128
- **Decision:** follow-up

## Depends on
none

## Touches
app/src/screens/chat/model.ts
app/src/store/resources.ts

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 96e56709

```
> app/src/store/resources.ts:64: the ?all=1 triggers list has no size limit (listTriggers has no LIMIT; every trigger_* event re-fetches it; every spent reminder adds a palette command)
```

### Entry 2

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 0fd1694b

```
> app/src/screens/chat/model.ts:167: triggerState re-derives the kernel's spentOnce and can disagree with it (a once trigger turned on then missed; a fire at exactly the toggle instant)
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
