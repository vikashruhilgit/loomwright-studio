# Dismissed findings below the tracking threshold: 05-session-manager (8)

## Status: proposed

- **Run:** automate-2026-09-30-211858
- **Item:** .supervisor/requirements/phase-1/05-session-manager.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/13
- **Decision:** follow-up

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 95a494af

```
> kernel/src/sessions/spawner.ts:110 abort listener never removed on child exit; late abort could signal a reused pgid
```

### Entry 2

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** d853b4bf

```
> kernel/src/sessions/policy.ts:16 prefixes for command-executing programs (find, xargs, env, git, sed, awk, npm) grant arbitrary execution; undocumented on ToolPolicy
```

### Entry 3

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 4af63600

```
> kernel/src/sessions/spawner.ts:121 SDK-abort listener still attached after child exit; late abort runs killGroupUntilGone on a possibly reused pgid
```

### Entry 4

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 4d517a27

```
> kernel/src/sessions/manager.ts:567 reaper's first SIGKILL reads EPERM as group_not_ours, contradicting the EPERM-is-not-gone-yet finding
```

### Entry 5

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** e17aea6b

```
> kernel/src/sessions/manager.ts:650 #leaderStartIso runs execFileSync /bin/ps synchronously in query(); a hung ps blocks the event loop up to 2 s per spawn
```

### Entry 6

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 480af5e9

```
> docs/ARCHITECTURE.md session-manager bullets: SDK-abort path does not record session_kill_incomplete; start time can be null; left-alive rows' resumability unstated
```

### Entry 7

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** ee158a28

```
> kernel/src/sessions/policy.ts:26 prefixes for command-executing programs (find, xargs, env, git, npx, sh, bash) permit arbitrary execution; undocumented
```

### Entry 8

- **Round:** 2
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** a32a77b0

```
> kernel/src/sessions/manager.ts:426 an orphaned row stuck on leader_unverified has no kernel-side exit (stopSession not_live, resume refused); needs an owner-confirmed abandon action
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
