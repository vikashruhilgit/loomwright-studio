# Dismissed findings below the tracking threshold: 2026-10-24-095111-the-integrations-screen (4)

## Status: proposed

- **Run:** automate-2026-10-28-211751-L1
- **Item:** .supervisor/requirements/phase-6/2026-10-24-095111-the-integrations-screen.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/157
- **Decision:** follow-up

## Depends on
none

## Touches
docs/ARCHITECTURE.md

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** fd655b31

```
> IntegrationsView.tsx:268 expiring band prints raw days (can read 'in 0 days' / 'in -1 days'); rowMeta already clamps
```

### Entry 2

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** cc310eb1

```
> Evidence README calls the evidence-gating test 'its last test' but it is second to last
```

### Entry 3

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 19658873

```
> IntegrationsView.tsx:441 settleFrom stays set after a same-state Replace; a later connector_status flip can pull focus to the row
```

### Entry 4

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 30fa7e34

```
> docs/ARCHITECTURE.md:244 'read once, sent, and cleared' lists steps opposite to the code (cleared before sent)
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
