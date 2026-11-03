# Dismissed findings below the tracking threshold: 2026-11-02-160006-mcp-connector-mechanism-with-oauth (2)

## Status: proposed

- **Run:** automate-2026-11-02-150636-L6
- **Item:** .supervisor/requirements/phase-8/2026-11-02-160006-mcp-connector-mechanism-with-oauth.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/223
- **Decision:** follow-up

## Depends on
none

## Touches
docs/DECISIONS.md

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 547475d7

```
> docs/DECISIONS.md D38 still says a jira or clickup grant is refused connector_not_built until the connector items land; that code is no longer emitted (AC8). The wording is conditional and historical, and it is the owner's decision record
```

### Entry 2

- **Round:** 1
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Key:** ede8d774

```
> LOW: mcp-connectors.md:130 NEEDS VERIFICATION 64-char tool-name claim untracked in OPEN_QUESTIONS.md; DEFINITIVE_CODES invalid_client/unauthorized_client untested (FakeMcp RefreshMode only invalid_grant); D38 connector_not_built clause stale (informational)
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
