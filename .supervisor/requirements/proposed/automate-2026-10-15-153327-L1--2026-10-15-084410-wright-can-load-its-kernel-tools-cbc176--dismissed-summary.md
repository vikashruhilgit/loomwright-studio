# Dismissed findings below the tracking threshold: 2026-10-15-084410-wright-can-load-its-kernel-tools (5)

## Status: proposed

- **Run:** automate-2026-10-15-153327-L1
- **Item:** .supervisor/requirements/phase-2/2026-10-15-084410-wright-can-load-its-kernel-tools.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/61
- **Decision:** follow-up

## Depends on
none

## Touches
docs/OPEN_QUESTIONS.md
docs/evidence/agent-sdk-tool-loading-probe.md
kernel/src/loomwright/index.ts
kernel/src/sessions/manager.ts
kernel/test/phase-2-exit-live.test.ts

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 74787e1a

```
> docs/evidence/agent-sdk-tool-loading-probe.md:28 section 2 heading says one session each though four are recorded
```

### Entry 2

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** ca19ed53

```
> kernel/src/sessions/manager.ts:589 startSession doc comment omits kernel-set session variables from the refused host-switch names
```

### Entry 3

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 943db8f2

```
> kernel/src/loomwright/index.ts:11 runtime-imports header omits ../sessions/kernel-env.js and ../auth/credential-env.js
```

### Entry 4

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 84f57314

```
> docs/OPEN_QUESTIONS.md:95 and evidence section 5 say the live test passed on the final code though it ran before the review fix
```

### Entry 5

- **Round:** 0
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Key:** 544afe51

```
> kernel/test/phase-2-exit-live.test.ts deep-link assertion compares against deepLinkFor() instead of the literal loomwright-studio://notifications/<id> contract string
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
