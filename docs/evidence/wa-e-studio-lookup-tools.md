# wa-e evidence: Studio lookup tools (Validation 2, static half)

Date: 2026-11-28. Branch `feature/wa-e-studio-lookup-tools`, base `39ce2279`.

What this checks: `kernel_session_get` (`kernel/src/brain/studio-tools.ts`) run against a read-only copy of the owner's real store answers how the most recent failed session ended. Only the session id, status, result subtype and counts are recorded here. No output or payload text is recorded.

## Read-only copy of the owner's store

The owner's kernel was running during the check. Nothing was started against the owner's data dir and nothing was written to it. The one command that touched it is a read-only SQLite backup into a temp dir:

```sh
mkdir -p "$TMP/ac16/data"
sqlite3 -readonly ~/.loomwright-studio/studio.db ".backup '$TMP/ac16/data/studio.db'"   # rc=0
sqlite3 "$TMP/ac16/data/studio.db" "PRAGMA integrity_check;"                            # ok
sqlite3 "$TMP/ac16/data/studio.db" "SELECT COUNT(*) FROM sessions;"                     # 266
sqlite3 "$TMP/ac16/data/studio.db" "SELECT COUNT(*) FROM sessions WHERE status IN ('failed','failed:auth');"  # 2
```

## `kernel_session_get` on the most recent failed session

A one-off vitest probe, kept outside the repo, opened a `Store` on the copy's temp data dir. It called the tool's handler as Wright with `session_id` set to the newest session whose status is `failed` or `failed:auth`, and recorded only these fields:

| Field | Value |
|---|---|
| session id | 245 |
| status (`ending.status`) | `failed:auth` |
| result subtype (`ending.result.payload.subtype`) | none: the session recorded no `result` output row (it failed at auth, before a result) |
| last status change present (`ending.last_status_change`) | yes |
| output rows in the store for the session | 1 |
| `shown` / `remaining` / `limit` | 1 / 0 / 20 |
| `next_before` | null |
| text fields cut (`text_cut.fields`) | 0 |
| one `<untrusted-data source="studio-tools">` wrapper | yes |
| `scope` | `you are Wright: all of Studio is shown` |

## Kernel suite

`cd kernel && npx tsc -p tsconfig.json` (rc 0) and `cd kernel && npm test`:

```text
 Test Files  162 passed | 1 skipped (163)
      Tests  5581 passed | 23 skipped (5604)
```

An earlier full run had one failure in `test/run-confinement.test.ts` (a git worktree listing under load; it imports nothing this change touches), which passed in three runs on its own and in the run above.

The ten pin mutations in the brief were each applied to a scratch state of the source and run against their pinning test, then restored. Every one made its pin fail.

## The owner's step (not run by the worker)

The live ask on the owner's install: ask Wright "what did the last failed session say before it ended?" and check that it calls `kernel_session_get` on that session and quotes how it ended. Wright gets the tools through its proposed tool list: an unedited 25-tool proposed `wright.json` is upgraded by wa-c's audited upgrade, and an edited one needs the six `mcp__kernel__kernel_*` names added by the owner.

Verdict: PASS for Validation 2 (static half; the live ask to Wright is the owner's)
