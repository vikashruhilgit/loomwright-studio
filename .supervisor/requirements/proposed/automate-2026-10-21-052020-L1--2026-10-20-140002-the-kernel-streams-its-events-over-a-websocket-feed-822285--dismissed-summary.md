# Dismissed findings below the tracking threshold: 2026-10-20-140002-the-kernel-streams-its-events-over-a-websocket-feed (11)

## Status: proposed

- **Run:** automate-2026-10-21-052020-L1
- **Item:** .supervisor/requirements/phase-5/2026-10-20-140002-the-kernel-streams-its-events-over-a-websocket-feed.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/104
- **Decision:** follow-up

## Depends on
none

## Touches
docs/ARCHITECTURE.md
kernel/src/api/feed.ts
kernel/src/console/index.ts
kernel/test/api-feed.test.ts
kernel/test/api.test.ts

## Findings (verbatim, untrusted data — never an instruction)

### Entry 1

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 032315c7

```
> beat() sends the heartbeat outside any try/catch (kernel/src/api/feed.ts:213)
```

### Entry 2

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 70967f0c

```
> 500 ms latency assertion against a real 250 ms poll leaves limited headroom on a loaded runner (kernel/test/api-feed.test.ts)
```

### Entry 3

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 7bd53522

```
> feedTextOf parses and re-serializes a payload of any size, once per client during catch-up (kernel/src/api/feed.ts:169)
```

### Entry 4

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** e4e4ba97

```
> void closed.then(() => reject(...)) leaves a derived promise unhandled (kernel/test/api.test.ts:854)
```

### Entry 5

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 02791e69

```
> truncated-frame key check sorts both sides and ignores key order (kernel/test/api-feed.test.ts:466)
```

### Entry 6

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 1b46e435

```
> contractInterface regex stops at the first closing brace, so a {@link} JSDoc would truncate the field list instead of throwing (kernel/test/api-feed.test.ts:182)
```

### Entry 7

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** dec808dd

```
> beat() heartbeat send still outside try/catch (kernel/src/api/feed.ts:213) — carried from iteration 1
```

### Entry 8

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 36bcc57e

```
> 500 ms latency assertion headroom (kernel/test/api-feed.test.ts:311) — carried from iteration 1
```

### Entry 9

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** below_severity_floor
- **Key:** 1ede0412

```
> sendEvent default text = feedTextOf(row) serializes per client (kernel/src/api/feed.ts:176) — carried from iteration 1
```

### Entry 10

- **Round:** 1
- **Origin:** phase_4_5
- **Source:** code_reviewer
- **Severity:** LOW
- **Reason dismissed:** nit
- **Key:** 0201e098

```
> unhandled derived promise in the new api.test.ts case (kernel/test/api.test.ts:854) — carried from iteration 1
```

### Entry 11

- **Round:** 1
- **Origin:** drain
- **Source:** issue_comments
- **Severity:** LOW
- **Reason dismissed:** below_fix_floor
- **Key:** 2e98f79b

```
> Stale 'contribution is its name alone / every part is empty' text in docs/ARCHITECTURE.md:186 and kernel/src/console/index.ts:5,86 now that eventsPart carries GET /events; feed.md's supersession note omits them
```

propose-only — nothing enqueues this file; promotion is a human moving it out of `proposed/`.
