# Dismissed findings below the tracking threshold: 2026-11-10-204054-the-charter-card-in-chat (4)

## Status: proposed

- **Run:** automate-2026-11-10-173433-L4
- **Item:** .supervisor/requirements/phase-8-18/2026-11-10-204054-the-charter-card-in-chat.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/262
- **Decision:** follow-up

## Depends on
none

## Touches
app/src/screens/approvals/charterBlocks.ts
docs/evidence/phase-8-18d-charter-card-in-chat.md
kernel/src/approvals/store.ts

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 9079837e

```
> CharterCard.test.tsx test gaps: copy('all', display.trim()) and dropping printable() from the older-version member name stay green
```

### Entry 2

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 11062a3d

```
> kernel/src/approvals/store.ts:360 cuts a display over 64,000 with no mark and may split a surrogate pair; the app would still say 'nothing cut'
```

### Entry 3

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** a243a4dc

```
> app/src/screens/approvals/charterBlocks.ts REPO_TOKEN also matches prose such as 'CI/CD' or 'and/or', so the workspace question can name a non-repo
```

### Entry 4

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 240a1ac1

```
> docs/evidence/phase-8-18d-charter-card-in-chat.md AC7 row and suite counts predate the heal-round tests
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
