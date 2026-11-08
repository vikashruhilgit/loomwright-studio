# Dismissed findings below the tracking threshold: 2026-11-02-160012-integrations-jira-clickup-connect-app-upgrade-and-repo-policy-card (6)

## Status: proposed

- **Run:** automate-2026-11-02-150636-L11
- **Item:** .supervisor/requirements/phase-8/2026-11-02-160012-integrations-jira-clickup-connect-app-upgrade-and-repo-policy-card.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/234
- **Decision:** follow-up

## Depends on
none

## Touches
docs/evidence/phase-8-polish/approvals/README.md

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 0180b34a

```
> repoSettingsUrl's OWNER_PATTERN omits the main process's (?!.*--) and the reserved owner 'settings'; such a repo gets a link main then refuses (fails safe)
```

### Entry 2

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 7b5ad585

```
> A single granted tool literally named 'none' is sent as '<kind>:none', which the kernel reads as the clear value
```

### Entry 3

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** c3ffea9e

```
> docs/evidence/phase-8-polish/approvals/README.md:45 still says open-external.ts 'allows exactly three addresses'
```

### Entry 4

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** fb9b28b5

```
> useEscape is a generic hook defined in McpConnect.tsx and imported by RepoPolicyCard.tsx
```

### Entry 5

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Evidence:** none recorded
- **Key:** 4d820f2f

```
> team/model.ts mcpToolsHeld doc comment says the kernel backs the null reading; the kernel refuses connectors: null
```

### Entry 6

- **Round:** 2
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Evidence:** severity LOW is below the fix floor MEDIUM
- **Key:** d1bbb323

```
> repoSettingsUrl OWNER_PATTERN omits the double-hyphen exclusion and reserved 'settings' owner that open-external.ts OWNER gate has, despite a comment claiming the same shape; untested in phase-8.test.tsx
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
