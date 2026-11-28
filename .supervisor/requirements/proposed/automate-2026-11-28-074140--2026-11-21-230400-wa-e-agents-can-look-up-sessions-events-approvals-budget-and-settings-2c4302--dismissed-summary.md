# Dismissed findings below the tracking threshold: 2026-11-21-230400-wa-e-agents-can-look-up-sessions-events-approvals-budget-and-settings (4)

## Status: proposed

- **Run:** automate-2026-11-28-074140
- **Item:** .supervisor/requirements/wright-aware/2026-11-21-230400-wa-e-agents-can-look-up-sessions-events-approvals-budget-and-settings.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/320
- **Decision:** follow-up

## Depends on
none

## Touches
docs/evidence/wa-e-studio-lookup-tools.md
kernel/src/brain/studio-tools.ts

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 6c3cb3af

```
> answer() checks MAX_LOOKUP_RESULT_CHARS before wrapUntrusted defuses wrapper tags, so the returned data can exceed the stated cap (kernel/src/brain/studio-tools.ts:322)
```

### Entry 2

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 72b76bfd

```
> kernel_event_list COUNT(*) for remaining and kernel_session_get's last session_status lookup read the whole events table (no index on kind/session_id/at) (kernel/src/brain/studio-tools.ts:546, :481)
```

### Entry 3

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 6a377440

```
> With after, a newest-first list returns the newest matching rows; the descriptions do not say to keep after and pass next_before to page newer rows (kernel/src/brain/studio-tools.ts:388, :509, :574)
```

### Entry 4

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Evidence:** none recorded
- **Key:** 4c933aa8

```
> The kernel_session_get probe command is not recorded in the evidence file (docs/evidence/wa-e-studio-lookup-tools.md:26)
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
