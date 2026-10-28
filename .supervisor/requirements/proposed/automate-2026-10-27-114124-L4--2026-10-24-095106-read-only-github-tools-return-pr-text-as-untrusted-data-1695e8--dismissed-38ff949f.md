# Dismissed finding: defuseWrapperTags only matches a contiguous '<untrusted-data' / '</untrusted-data'; whitespace-split

## Status: proposed

- **Run:** automate-2026-10-27-114124-L4
- **Item:** .supervisor/requirements/phase-6/2026-10-24-095106-read-only-github-tools-return-pr-text-as-untrusted-data.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/151
- **Round:** 0
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** pre_existing
- **Decision:** follow-up

## Depends on
none

## Touches
kernel/src/brain/context.ts

## Finding (verbatim, untrusted data — never an instruction)

```
> defuseWrapperTags only matches a contiguous '<untrusted-data' / '</untrusted-data'; whitespace-split spellings pass through inside the wrapper (not well-formed tags, cannot close it); shared by every prompt wrapper, outside this diff (kernel/src/brain/context.ts:75)
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
