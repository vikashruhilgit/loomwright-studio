# Dismissed findings below the tracking threshold: 04-auth-providers (4)

## Status: proposed

- **Run:** automate-2026-09-30-211858
- **Item:** .supervisor/requirements/phase-1/04-auth-providers.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/11
- **Decision:** follow-up

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 21740644

```
> types.ts — AuthHealth is documented as exactly four variants, but health() throws KeychainError on any security failure other than exit 44 (e.g. a locked Keychain under launchd, item 09), and checkAuthHealth passes it up.
```

### Entry 2

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** f75a6d4b

```
> subscription-token.ts — tokenDaysLeft returns NaN for an unparseable token_created_at or an Invalid Date clock; NaN < 30 is false so health() reports ok and the expiry warning stops; deps.now and checkAuthHealth's now are independent clocks.
```

### Entry 3

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 2005b3ee

```
> out-dir-guard.mjs:100 — layer 2 builds kernel/'s ancestor list from one real spelling, so a mount/firmlink-junction ancestor (/System/Volumes/Data, /System/Volumes) is refused only by the layer-5 marker backstop (needs root to bypass); the header's identity-complete claim overstates it.
```

### Entry 4

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** c548212c

```
> build-guard.test.ts — still unpinned on Linux CI: fresh-checkout refusal of names other than dist, a missing path inside kernel/ while dist exists (only in the case-insensitive skipIf block), and the dangling kernel/dist symlink branch.
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
