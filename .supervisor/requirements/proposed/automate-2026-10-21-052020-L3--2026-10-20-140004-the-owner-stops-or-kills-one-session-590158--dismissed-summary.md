# Dismissed findings below the tracking threshold: 2026-10-20-140004-the-owner-stops-or-kills-one-session (6)

## Status: proposed

- **Run:** automate-2026-10-21-052020-L3
- **Item:** .supervisor/requirements/phase-5/2026-10-20-140004-the-owner-stops-or-kills-one-session.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/103
- **Decision:** follow-up

## Depends on
none

## Touches
kernel/src/cli/index.ts
kernel/src/console/control.ts
kernel/src/features/contribution.ts

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 04a33623

```
> CLI exit-code doc says only failed exits 1; the code also exits 1 for failed:auth and a status that has not ended (kernel/src/cli/index.ts:613)
```

### Entry 2

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 71bfb3cb

```
> The 'kernel API sent an unreadable answer' CLI branch has no test (kernel/src/cli/index.ts:251)
```

### Entry 3

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 0f91d351

```
> Deviation 'CLI exits 1 for failed:auth as well as failed' contradicts the derived check 'exit 0 on any other terminal status that is not failed' (kernel/src/cli/index.ts:333)
```

### Entry 4

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 00fc101a

```
> serialized doc comment overstated what runs on the queue (kernel/src/features/contribution.ts:220)
```

### Entry 5

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 0b320157

```
> Unreachable not_found -> 404 mapping in the catch (kernel/src/console/control.ts:116)
```

### Entry 6

- **Round:** 2
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Key:** 204d2304

```
> cli session stop/kill exit-code docstring says only failed exits 1, but failed:auth also exits 1; no CLI test pins the failed:auth 200 outcome
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
