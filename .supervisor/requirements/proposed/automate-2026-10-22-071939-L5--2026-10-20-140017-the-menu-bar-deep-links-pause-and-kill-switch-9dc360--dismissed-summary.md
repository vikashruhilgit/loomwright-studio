# Dismissed findings below the tracking threshold: 2026-10-20-140017-the-menu-bar-deep-links-pause-and-kill-switch (7)

## Status: proposed

- **Run:** automate-2026-10-22-071939-L5
- **Item:** .supervisor/requirements/phase-5/2026-10-20-140017-the-menu-bar-deep-links-pause-and-kill-switch.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/122
- **Decision:** follow-up

## Depends on
none

## Touches
unknown

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 040b9418

```
> Tray enables Pause all and Kill switch before any /status read while the panel disables every action until the kernel answers
```

### Entry 2

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** d29feb6b

```
> An invalid-link route does not bump linkSeq, so an older notification link answering late still navigates after a newer invalid link
```

### Entry 3

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** c087e041

```
> A held deep link waiting for did-finish-load is dropped with no log line when the page load fails
```

### Entry 4

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** fc087ab6

```
> An agent:unknown notification opens #/chat/unknown, a thread for an agent that does not exist
```

### Entry 5

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 175311b2

```
> The tray says kernel not reached when /status answered but /approvals failed or a body was malformed; dot and count carry no stale cue
```

### Entry 6

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** fce4c667

```
> A refused action's failure line can stay up after it no longer matters, since only its own success or goal-reached status clears it
```

### Entry 7

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 69c34844

```
> A replayed feed event (id <= cursor) still causes one throttled tray read, contrary to the header comment
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
