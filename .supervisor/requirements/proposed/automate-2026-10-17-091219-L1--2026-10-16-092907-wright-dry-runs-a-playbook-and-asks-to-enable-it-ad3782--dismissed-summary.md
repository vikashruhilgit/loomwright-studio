# Dismissed findings below the tracking threshold: 2026-10-16-092907-wright-dry-runs-a-playbook-and-asks-to-enable-it (5)

## Status: proposed

- **Run:** automate-2026-10-17-091219-L1
- **Item:** .supervisor/requirements/phase-3/2026-10-16-092907-wright-dry-runs-a-playbook-and-asks-to-enable-it.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/74
- **Decision:** follow-up

## Depends on
none

## Touches
kernel/src/playbooks/dry-run.ts
kernel/src/playbooks/enable.ts
kernel/src/playbooks/index.ts

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** b8e07251

```
> kernel/src/playbooks/index.ts:4 module comment still says 'today drafts is filled'
```

### Entry 2

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** ab273e39

```
> kernel/src/playbooks/enable.ts:75 display-builder branches with no test (set by owner, once at, trigger: none)
```

### Entry 3

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 0f633d43

```
> enable.ts:262 / dry-run.ts:336 branches added in 126e363 with no test
```

### Entry 4

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** db3a9802

```
> kernel/src/playbooks/enable.ts:30 module header omits the stored-playbook check
```

### Entry 5

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 6edf2da4

```
> kernel/src/playbooks/dry-run.ts:406 tool description does not say a key used for another playbook is refused
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
