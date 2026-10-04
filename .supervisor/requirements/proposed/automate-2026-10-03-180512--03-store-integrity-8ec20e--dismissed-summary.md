# Dismissed findings below the tracking threshold: 03-store-integrity (4)

## Status: proposed

- **Run:** automate-2026-10-03-180512
- **Item:** .supervisor/requirements/phase-1-hardening/03-store-integrity.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/27
- **Decision:** follow-up

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 0
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 92e1ec72

```
> store.ts:83 — journal_mode=WAL runs before checkBeforeMigrating; a DELETE-mode v99/foreign DB is refused but its header is rewritten to WAL (reproduced)
```

### Entry 2

- **Round:** 0
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** ce3217fc

```
> integrity.ts:140 — undocumented honest limit: DROP TABLE events then recreating it and all four triggers with identical text passes the schema check and wipes audit history
```

### Entry 3

- **Round:** 0
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** a3e003c7

```
> daemon-exit.ts:57 — StoreIntegrityError/StoreSchemaTooNewError fall through to transient, so under launchd a tampered or too-new DB restarts every 60 s indefinitely (acknowledged follow-up)
```

### Entry 4

- **Round:** 0
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** c323ab69

```
> integrity.ts:160 — unknownVersions read as a JS number, so a max-int version reports 9223372036854776000
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
