# Dismissed finding: Chat card Always for merge approvals; GitHub-specific live copy

## Status: proposed

- **Run:** automate-2026-11-02-150636-L9
- **Item:** .supervisor/requirements/phase-8/2026-11-02-160013-playbook-live-mode-and-the-merge-approval-card.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/228
- **Round:** 3
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** unspecified
- **Reason dismissed:** already-addressed in baf38d7
- **Evidence:** app/src/screens/chat/cards.tsx:91 offerAlways={!merge}; app/src/components/PlaybookPolicy/PlaybookPolicy.tsx:165 "live sends them through the approval gate"
- **Decision:** follow-up

## Depends on
none

## Touches
unknown

## Finding (verbatim, untrusted data — never an instruction)

```
> Chat card Always for merge approvals; GitHub-specific live copy
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
