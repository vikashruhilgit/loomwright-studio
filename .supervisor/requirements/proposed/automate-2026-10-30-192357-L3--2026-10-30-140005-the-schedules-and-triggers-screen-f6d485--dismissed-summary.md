# Dismissed findings below the tracking threshold: 2026-10-30-140005-the-schedules-and-triggers-screen (3)

## Status: proposed

- **Run:** automate-2026-10-30-192357-L3
- **Item:** .supervisor/requirements/phase-7/2026-10-30-140005-the-schedules-and-triggers-screen.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/181
- **Decision:** follow-up

## Depends on
none

## Touches
kernel/src/triggers/routes.ts

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 49754ae0

```
> SchedulesScreen.test.tsx: no jsdom test drives connectionDown (live store reconnecting) while data is held
```

### Entry 2

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 3060792d

```
> kernel/src/triggers/routes.ts header still says the Schedules screen 'will reuse' the routes
```

### Entry 3

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 686a8ce7

```
> History.tsx: resume ref armed on every Load older click even when loadOlder() starts no read
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
