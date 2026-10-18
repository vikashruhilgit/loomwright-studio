# Dismissed findings below the tracking threshold: 2026-10-18-041102-the-owner-creates-lists-renames-sets-and-turns-off-crew-members (7)

## Status: proposed

- **Run:** automate-2026-10-18-135554-L1
- **Item:** .supervisor/requirements/phase-4/2026-10-18-041102-the-owner-creates-lists-renames-sets-and-turns-off-crew-members.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/87
- **Decision:** follow-up

## Depends on
none

## Touches
unknown

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 1df3fe84

```
> roster.ts exists() duplicates charter-files.ts isPresent with different semantics (dangling symlink / EACCES shown as missing)
```

### Entry 2

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** d2da2106

```
> set replaces a symlinked config/agents/<id>.json with a regular file; not in Honest limits
```

### Entry 3

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** cdac566e

```
> create's missing-file warning overstates self-heal (nothing calls ensureAgentFiles until item 05)
```

### Entry 4

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** c553318d

```
> PERMISSION_MODES and workspaceProblem duplicated from settings.ts in charter-files.ts
```

### Entry 5

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 14f64b0e

```
> over-MAX_SETTINGS_BYTES part of the set test does not pin roster.ts's own size check; race-only re-read refusals untested
```

### Entry 6

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** c9b1e256

```
> filesError test relies on chmod 0o500 EACCES, fails when run as root (no getuid skip guard)
```

### Entry 7

- **Round:** 0
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Key:** 8fbe61e9

```
> set: settings-file rename and its agent_settings_set event are not one atomic unit
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
