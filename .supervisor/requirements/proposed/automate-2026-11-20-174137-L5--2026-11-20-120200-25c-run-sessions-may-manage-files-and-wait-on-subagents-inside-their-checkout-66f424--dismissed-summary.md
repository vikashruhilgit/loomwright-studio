# Dismissed findings below the tracking threshold: 2026-11-20-120200-25c-run-sessions-may-manage-files-and-wait-on-subagents-inside-their-checkout (4)

## Status: proposed

- **Run:** automate-2026-11-20-174137-L5
- **Item:** .supervisor/requirements/phase-8-25/2026-11-20-120200-25c-run-sessions-may-manage-files-and-wait-on-subagents-inside-their-checkout.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/304
- **Decision:** follow-up

## Depends on
none

## Touches
docs/OPEN_QUESTIONS.md
docs/architecture/automate.md

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 2e3eff7e

```
> isInsideResolved (an admission check) compares case-insensitively; on a case-sensitive APFS volume or Linux, a sibling directory differing only in case would read as inside the checkout
```

### Entry 2

- **Round:** 3
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Evidence:** none recorded
- **Key:** ae38faf3

```
> chmod -x file is read as an option and refused (fail closed), although -x is a valid symbolic mode
```

### Entry 3

- **Round:** 1
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Evidence:** severity LOW is below the fix floor MEDIUM
- **Key:** 00b58099

```
> three owner re-decide items from 25c are recorded only in docs/architecture/automate.md, not in docs/OPEN_QUESTIONS.md
```

### Entry 4

- **Round:** 1
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Evidence:** severity LOW is below the fix floor MEDIUM
- **Key:** a9be3425

```
> splitGitC does not consume the value word of a two-word -c/--git-dir/--work-tree before -C, so it returns none instead of refuse global_option (fails closed via bash_prefix_not_allowed)
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
