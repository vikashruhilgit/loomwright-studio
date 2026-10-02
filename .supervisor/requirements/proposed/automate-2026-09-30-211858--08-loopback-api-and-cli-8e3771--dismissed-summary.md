# Dismissed findings below the tracking threshold: 08-loopback-api-and-cli (2)

## Status: proposed

- **Run:** automate-2026-09-30-211858
- **Item:** .supervisor/requirements/phase-1/08-loopback-api-and-cli.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/19
- **Decision:** follow-up

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 61f115ba

```
> A session whose stream had already ended failed on its own is reported 'not confirmed stopped' like a kill_incomplete group (errs safe; wording only). kernel/src/cli/index.ts:140
```

### Entry 2

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 3f3234b5

```
> The stopAll comment (kernel/src/sessions/manager.ts:516) says the failed:auth auth timer would die with a stopping kernel; in stop mode it stays armed and retries the kill (harmless; comment incomplete).
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
