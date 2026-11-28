# Dismissed finding: Settings copy tells owner to hand-edit wright.json while kernel will upgrade it

## Status: proposed

- **Run:** automate-2026-11-28-074140
- **Item:** .supervisor/requirements/wright-aware/2026-11-21-230200-wa-c-an-unedited-proposed-tool-list-gets-the-current-proposed-tools.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/317
- **Round:** 2
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** unspecified
- **Reason dismissed:** already-addressed
- **Evidence:** 5fc0389e: app/src/screens/settings/SettingsScreen.tsx:314 hides the file note when upgradePending
- **Decision:** follow-up

## Depends on
none

## Touches
unknown

## Finding (verbatim, untrusted data — never an instruction)

```
> Settings copy tells owner to hand-edit wright.json while kernel will upgrade it
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
