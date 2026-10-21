# Dismissed finding: loadState count-based OFFSET cursor can duplicate a tool_decision row after restart

## Status: proposed

- **Run:** automate-2026-10-21-052020-L2
- **Item:** .supervisor/requirements/phase-5/2026-10-20-140003-the-kernel-keeps-a-bounded-output-log-per-session.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/102
- **Round:** 2
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** unspecified
- **Reason dismissed:** already-addressed: loadState (kernel/src/console/output.ts:257-321) now rebuilds pending by subtracting copied rows by exact payload_json and sets cursor past the last decision event; the OFFSET query no longer exists
- **Decision:** follow-up

## Depends on
none

## Touches
unknown

## Finding (verbatim, untrusted data — never an instruction)

```
> loadState count-based OFFSET cursor can duplicate a tool_decision row after restart
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
