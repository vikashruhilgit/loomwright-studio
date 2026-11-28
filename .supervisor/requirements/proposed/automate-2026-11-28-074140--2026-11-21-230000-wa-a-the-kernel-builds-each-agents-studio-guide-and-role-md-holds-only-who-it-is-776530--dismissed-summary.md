# Dismissed findings below the tracking threshold: 2026-11-21-230000-wa-a-the-kernel-builds-each-agents-studio-guide-and-role-md-holds-only-who-it-is (6)

## Status: proposed

- **Run:** automate-2026-11-28-074140
- **Item:** .supervisor/requirements/wright-aware/2026-11-21-230000-wa-a-the-kernel-builds-each-agents-studio-guide-and-role-md-holds-only-who-it-is.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/316
- **Decision:** follow-up

## Depends on
none

## Touches
docs/OPEN_QUESTIONS.md
docs/architecture/brain.md
docs/evidence/wa-a-studio-guide.md
kernel/src/brain/guide.ts

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 9417eaf1

```
> docs/OPEN_QUESTIONS.md:138 — the 'Still open: existing install keeps old guidance silently' sentence and its templates.ts pointer are partly out of date now that the rules come from the Studio guide
```

### Entry 2

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 10b618d9

```
> kernel/src/brain/guide.ts:44 — GUIDE_TOOLS_UNAVAILABLE says the catalogue 'could not be built for this session', which is false on the playbookPrompt path (no catalogue is passed)
```

### Entry 3

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Evidence:** none recorded
- **Key:** 94e8e794

```
> docs/evidence/wa-a-studio-guide.md:3 — says the probe ran 'against the merged code's buildContext' but it ran against the branch's
```

### Entry 4

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** bb755f46

```
> kernel/src/brain/guide.ts:90/:291 — the crew guide says it is written 'for every new conversation', but crewPlaybookPrompt builds crew playbook sessions with no guide (a documented follow-up)
```

### Entry 5

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Evidence:** none recorded
- **Key:** 2c6fee9c

```
> docs/evidence/wa-a-studio-guide.md:24/:51 — the recorded context sizes were measured at 2450ccd5 and are 18 chars lower than at 79bd7c77
```

### Entry 6

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 74569f09

```
> docs/architecture/brain.md:410 — a thread started before this upgrade and resumed after it had no Studio guide, yet RESUMED_THREAD_LINE says the guide is in its first message
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
