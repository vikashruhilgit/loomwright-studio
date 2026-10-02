# Dismissed finding: Append-only events resists DML only: DROP TRIGGER, ALTER TABLE events DROP COLUMN and DROP TABLE thr

## Status: proposed

- **Run:** automate-2026-09-30-211858
- **Item:** .supervisor/requirements/phase-1/03-sqlite-store.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/9
- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** MEDIUM
- **Reason dismissed:** below_severity_floor
- **Decision:** follow-up

## Finding (verbatim, untrusted data — never an instruction)

```
> Append-only events resists DML only: DROP TRIGGER, ALTER TABLE events DROP COLUMN and DROP TABLE through the public Store.exec erase or rewrite audit data (reproduced). Suggest verifying the three events triggers in sqlite_master on every open and documenting the DDL limit.
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
