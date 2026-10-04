# Dismissed findings below the tracking threshold: 02-credential-env-and-auth-health (2)

## Status: proposed

- **Run:** automate-2026-10-03-180512
- **Item:** .supervisor/requirements/phase-1-hardening/02-credential-env-and-auth-health.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/25
- **Decision:** follow-up

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 0
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** c12dd14a

```
> OPEN_QUESTIONS.md:58 — cites sdk.mjs as the bundled CLI that reads the ten names; the reader is the native binary, sdk.mjs holds a settings-env deny-list
```

### Entry 2

- **Round:** 0
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 90d91f6a

```
> notify.ts:27 — totality stops at the type boundary; checkAuthHealth's own now() throwing propagates while the provider maps a throwing deps.now to clock_unreadable
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
