# Dismissed findings below the tracking threshold: 04-session-manager-hardening (3)

## Status: proposed

- **Run:** automate-2026-10-03-180512
- **Item:** .supervisor/requirements/phase-1-hardening/04-session-manager-hardening.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/29
- **Decision:** follow-up

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 31421d82

```
> manager.ts #recordLeaderStart — the async leader probe can run after Node reaped a short-lived leader, so a reused pid's start time could in theory be recorded (negligible on macOS's sequential pids)
```

### Entry 2

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 3c513c11

```
> cli/index.ts:55 — CLIENT_HEADER duplicates the constant exported by api/server.ts
```

### Entry 3

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** f86505e4

```
> cli/index.ts:120 readlineConfirm — an input destroyed without an error never settles and keeps its listeners, contradicting the 'Always settles' comment (not reachable via normal stdin EOF/error)
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
