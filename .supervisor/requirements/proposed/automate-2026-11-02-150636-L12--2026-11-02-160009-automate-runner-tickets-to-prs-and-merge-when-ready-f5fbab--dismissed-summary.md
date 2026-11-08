# Dismissed findings below the tracking threshold: 2026-11-02-160009-automate-runner-tickets-to-prs-and-merge-when-ready (5)

## Status: proposed

- **Run:** automate-2026-11-02-150636-L12
- **Item:** .supervisor/requirements/phase-8/2026-11-02-160009-automate-runner-tickets-to-prs-and-merge-when-ready.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/237
- **Decision:** follow-up

## Depends on
none

## Touches
app/src/screens/approvals/subject.ts
docs/architecture/repo-policy.md

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 9362de90

```
> run-state.ts statusOf maps an unrecognised ## Status word to unknown, treated as neither live nor parked
```

### Entry 2

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 66cafa7b

```
> runner.ts remoteRepos reads [submodule] url lines in .git/config as remotes
```

### Entry 3

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 6f1d33a7

```
> text-rules.ts bidi set omits U+061C (ARABIC LETTER MARK)
```

### Entry 4

- **Round:** 1
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Evidence:** severity LOW is below the fix floor MEDIUM
- **Key:** 6cbf7f9b

```
> Doc/comment drift: app/src/screens/approvals/subject.ts kernelFields comment and docs/architecture/repo-policy.md:64 still describe the old top-level repo/pr/head_sha merge-approval payload shape; hasMergeApproval now reads $.tool and $.input.*
```

### Entry 5

- **Round:** 1
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Evidence:** severity LOW is below the fix floor MEDIUM
- **Key:** f6abb144

```
> Stale cross-reference: docs/architecture/repo-policy.md:64 says studio_approval matches a payload whose top-level repo, pr, head_sha match, but hasMergeApproval reads $.input.repo/pr/head_sha plus $.tool (and subject.ts:102-108 comment says top level wins)
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
