# wa-d: every prompt says what is in Studio right now (evidence)

**What this is.** The static half of Validation 2 of the wa-d brief (AC10): `studioView` (`kernel/src/brain/studio-view.ts`) run over a read-only copy of the owner's store, with the section's line groups, counts and kinds it produced. Only group names, counts and kinds are recorded here, never a payload, a playbook name or slug, a crew member's id or any failure text. The live half (asking Wright "what's going on in Studio?" on the owner's install) is the owner's step, listed at the end. It was not run by the worker.

## The read-only copy

Run on 2026-11-28 at the branch's working tree (base `873fb241`).

**Finding the data dir.** The kernel resolves it with `resolveDataDir` (`kernel/src/store/store.ts`): `STUDIO_DATA_DIR`, else `~/.loomwright-studio`. The owner's install is at `~/.loomwright-studio`, and its kernel was running (a `studio.lock.pid` and a live `studio.db-wal`). It runs from `~/.loomwright-studio/app/0.0.0/dist/daemon.js`, not from this checkout.

**Commands run** (`<tmp>` is a fresh directory under the session's scratch dir, outside the repository and the data dir):

```sh
mkdir -p <tmp>/data
sqlite3 -readonly ~/.loomwright-studio/studio.db ".backup '<tmp>/data/studio.db'"
cp -R ~/.loomwright-studio/config <tmp>/data/config     # read-only copy: roster limits and Wright's tool policy
cd kernel
AC10_DIR=<tmp>/data AC10_OUT=<tmp>/result.json npx vitest run test/zz-ac10-probe.test.ts
rm test/zz-ac10-probe.test.ts                           # the probe was a temporary file, never committed
```

The probe opened a `Store` on the copy only (no kernel was started and no audit sink was registered, so no settings upgrade could run). It called `studioView(store, "wright", …)` with `wrightSelf(<tmp>/data, …)`, then `studioView(store, <id>, …)` for every registered crew member. For each section it recorded the length, whether it held the heading, whether the whole-section fallback appeared, the count of each group (shown plus `… and <n> more not shown`, or `unavailable`) and the kinds of the recent mistakes. Nothing was written to `~/.loomwright-studio`: `sqlite3 -readonly` opens the source read-only, and `cp` only reads.

## What `studioView` produced

**Wright** (3 203 characters, under `MAX_STUDIO_VIEW_CHARS` 6 000; heading present; no fallback; read in 18 ms):

| Group | Count |
|---|---|
| Crew | 15 |
| Playbooks | 20 |
| Triggers | 29 |
| Scheduled wakeups | 0 (`none`) |
| Running sessions | 0 (`none`) |
| Approvals waiting | 0 (`none`) |
| Limits (today) | 36 |
| Cap windows not allowed | 1 |
| Your settings | 1 |
| Taken at | present |
| Recent mistakes (last 24 hours, newest first) | 0 (`none in the last 24 hours`) |

No group read as `unavailable`.

**Crew members** (15 views: 1 on, 14 off). Each was between 807 and 1 598 characters, held the heading, had no fallback and was read in 6 to 8 ms. None had a Crew or Scheduled wakeups group. Each had its own Playbooks (0 to 2), Triggers (0 to 2), Running sessions 0, Approvals waiting 0, Limits (today) 1 to 3 (its own line and its playbooks'), Cap windows not allowed 1 (the account's), Your settings 1, Taken at, and Recent mistakes 0. No group read as `unavailable`.

**The mistakes queries meet real rows.** The copy's latest failures are older than a day (its latest tool deny is from 2026-11-24, its latest failed message from 2026-11-19), so `0` is the expected count above. As a counter-check, the same view was built over the copy once more with `now` set to 2026-11-24T12:00:00Z (a second temporary probe, deleted after the run). Its Recent mistakes listed 2 lines, both of kind `tool denied`, with the left-out reasons (`approval_required`, `dry_run`, `draft_mode`) filtered out. Counts per source in the copy were read with `sqlite3` (counts only, no text).

## The kernel suite

`cd kernel && npm test` at the branch's working tree, after the change:

```text
 Test Files  161 passed | 1 skipped (162)
      Tests  5551 passed | 23 skipped (5574)
```

`npx tsc -p tsconfig.json --noEmit` was clean, and `kernel/test/feature-seams.test.ts` (the `SDK_IN_GRAPH` module-graph guard) passed alone: 37 passed.

Verdict: PASS for Validation 2 (static half; the live "what's going on in Studio?" ask is the owner's)

## The owner's step (not run by the worker)

On the owner's install, with one approval waiting and one failed message in the last day, ask Wright "what's going on in Studio?" and check that its answer names both. This needs a real Wright session on the owner's install: production, and real spend on the API key (D42). So it is the owner's step and was not run here.
