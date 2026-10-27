# Dismissed findings below the tracking threshold: 2026-10-24-095103-the-github-connector-token-validation-and-reachable-repos (7)

## Status: proposed

- **Run:** automate-2026-10-27-114124-L1
- **Item:** .supervisor/requirements/phase-6/2026-10-24-095103-the-github-connector-token-validation-and-reachable-repos.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/147
- **Decision:** follow-up

## Depends on
none

## Touches
unknown

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 71e07f7a

```
> getPullDiff cuts at a byte bound and decodes as UTF-8, so a multi-byte character at the cut becomes U+FFFD (client.ts:423)
```

### Entry 2

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** d15a47cf

```
> console-contract.test.ts:159 title 'not yet served' is stale for the four p6-item-03 routes
```

### Entry 3

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 623ab2e4

```
> integrations.md: '(one event)' is wrong when the row was already disconnected; '(connected)' can also be expiring
```

### Entry 4

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** a550e899

```
> integrations-cli-stdin.test.ts:75 over.destroyed cannot detect removal of the redundant stdin.destroy() at cli.ts:55
```

### Entry 5

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 7356e922

```
> MAX_GITHUB_TOKEN_LENGTH = 255 in connector.ts:83 restates client.ts:66 MAX_TOKEN_LENGTH
```

### Entry 6

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 40a9544f

```
> default request timeout wiring (client.ts:276) is untested; only an injected timeout is
```

### Entry 7

- **Round:** 1
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Key:** a693d34a

```
> stale test title in console-contract.test.ts says item 03 routes not yet served (pre-existing, file untouched by PR)
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
