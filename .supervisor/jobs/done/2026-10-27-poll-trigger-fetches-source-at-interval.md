# Supervisor Job: A poll trigger fetches GitHub open PRs at the user-set interval and queues one fire per item

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-27-114124/L2
- **CLAUDE.md:** ✓ Found (fresh: kernel layout, invariants and the triggers/integrations paths it names match the code)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-6/2026-10-24-095104-a-poll-trigger-fetches-a-source-at-a-user-set-interval.md
- **Base commit:** 7f0949d6cf3c603b4217638a011f2073c9c25eb3

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest kernel; no new dependency (zod, node built-ins and the store already present). |
| 2 | Dependency Availability | CAUTION | The real `GitHubClient` (`kernel/src/integrations/github/client.ts`) is item 03, running in the parallel lane L1 and not on `main`. Item 04 codes against item 01's `GitHubClient` interface and tests with `FakeGitHubClient`; it adds an injection seam for the client, which item 03 (or whichever lands second) fills with the real one. |
| 3 | Architecture Fit | GO | A poll is one more trigger kind fired from the triggers contribution's due work, keyed `trigger:<id>:<instant>` like every fire; the loop already awaits async due work (`kernel/src/loop/loop.ts` `#runDueWork`). |
| 4 | Scope vs Supervisor Capability | GO | One worker: 3 creates + 12 modifies, seven of them one-to-few-line edits; both halves (validation, firing) share `poll.ts` and `store.ts`, so a split would only serialize. |
| 5 | Hard Blockers | GO | Item 01 (dependency) is merged: `PollSpec`, `SourceItem`, `GitHubClient`, migration 17 `connectors` table, `poll` in `TRIGGER_KINDS`, `poll_item_queued` in `THREAD_EVENT_KINDS`. Phase 5's live exit has passed (`docs/evidence/phase-5-exit-live-2026-10-25.json`), so the sequencing precondition holds. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Replace item 01's `poll_not_implemented` refusal with a real `poll` trigger: validated at creation (floor, reachable repos, connector, filters), fired by the deterministic kernel at the user's interval, queuing one playbook `message` per open PR, backing off on rate limits and parking when the connector is gone.

**Problem Statement:**
The owner needs a trigger that polls their chosen repos' open PRs at the interval they set, run by the kernel, because a review duty must see each PR without a model deciding when to look, and a quiet poll must cost no tokens.
Currently, triggers are time-based only (`once`, `cron`); `kind: poll` is in `TRIGGER_KINDS` but every write is refused `poll_not_implemented` (`kernel/src/triggers/store.ts`), and nothing fetches an external source. This blocks phase 6's review duty (items 05, 09, 10, 13).
Success looks like: a playbook-linked poll trigger with a `PollSpec` is accepted or refused with a named code; each due instant lists open PRs once through `GitHubClient`, queues exactly one `message` per item with a per-item `source_ref`, survives a crash without double-queuing, starts nothing when it finds nothing, backs off to `resets_at` on `rate_limited`, records `connector_missing` and notifies once per outage, and never fires under pause or the kill switch.

### Design decisions pinned for the worker (mechanism only, D4 / invariant 1)

These close points the requirement leaves open so the worker does not re-decide them; none is a policy default (the interval, repos and filters stay the user's, stored as given):

1. **A poll belongs to a playbook.** `registerTrigger` / `updateTriggerSpec` with `kind: "poll"` and no `playbook` link is refused `invalid_input` ("a poll trigger must belong to a playbook"), because its fire's `source_ref` is `playbook:<id>:<instant>:<item.ref>`. So `kernel_trigger_register` (which takes no playbook) cannot create one; its description says polls are created through a playbook. The playbook path (`registerLinked` / `updateTriggerSpec` in `kernel/src/playbooks/store.ts`) is unchanged and reaches the new validation as is.
2. **Spec input.** For `kind: "poll"`, the `spec` string is the `PollSpec` as JSON text, and `tz` must be absent. Stored as normalized JSON (`{source, repos, filters, interval_seconds}`, repos and filter values exactly as given), so `updateTriggerSpec`'s existing `row.spec_json === specJson` check makes an unchanged re-save a no-op. Shape errors (not JSON, `source` other than `github.pulls`, `repos` empty / not `owner/name` strings / duplicates, a filter value of the wrong type, `interval_seconds` not an integer) are `invalid_spec`. The named refusals are their own codes: `poll_interval_below_floor` (< 60), `poll_repo_not_reachable` (naming every such repo), `poll_connector_missing`, `poll_filter_unknown` (naming the key; known keys `state` string, `draft` boolean, `author` string).
3. **Connector state** is read with raw SQL over `connectors` (migration 17), never by importing the integrations feature's values: usable means a `kind = 'github'` row with status `connected` or `expiring`; anything else (no row, `disconnected`, `expired`, `rejected`) is missing. The reachable set is `reachable_repos_json` parsed as a JSON array of `owner/name` strings (the shape `GET /connectors/github/repos` answers), compared case-insensitively; unparseable ⇒ treated as an empty set.
4. **Schedule.** Registration (and turning a poll on) sets `next_fire_at = now + interval_seconds`. After every processed instant the next fire is `now + interval_seconds` (never `scheduled + interval`, so downtime coalesces into one poll, no catch-up burst); after `rate_limited` it is `max(now + interval_seconds, resets_at)`.
5. **The fire is two-phase because `GitHubClient` is async and `runStep` is a synchronous transaction.** Phase A (no writes): pre-checks, then fetch every repo in spec order, sequentially, outside any transaction. Phase B: one `runStep(store, "trigger:<id>:<instant>", …)` that re-reads the row (still enabled and due at the instant, else `skipped`), re-checks the kill switch and pause, then writes the effect, the bookkeeping and the events. A `kill -9` during Phase A leaves nothing on disk (the next tick refetches the same instant); during Phase B it commits all or nothing; after it, the done step replays and `enqueueEvent`'s per-`source_ref` idempotency makes a re-queue impossible.
6. **No fetch at all when**, recorded inside the instant's step exactly like the cron path: the linked playbook is not `enabled` (`trigger_missed`, reason `playbook_not_enabled`); the instant falls in a kill-switch window (`last_result = missed_kill_switch`) or the kernel is paused / the instant falls in a pause window (`last_result = missed_paused`); the connector is missing or no client is wired (`last_result = connector_missing`, `trigger_missed` reason `connector_missing`). While the kill switch is engaged nothing runs at all (as `fireDueTriggers`).
7. **All-or-nothing per instant.** The first repo answering a failure stops the fetch and nothing is queued for that instant: `rate_limited` ⇒ `last_result = rate_limited`, `trigger_missed` reason `rate_limited` with `resets_at` and the repo; `http_error` / `unreachable` ⇒ `last_result = source_error`, `trigger_missed` reason `source_error` with the error, status (when any) and repo, schedule kept (`now + interval`), no retry within the tick.
8. **Items.** Each listed PR passes the spec's filters again in the kernel (the client's filtering is not trusted to be the only one): `draft` and `author` exact match; `state` compared to `"open"` (the listing returns open PRs only, so `state` other than `open` matches nothing). Item = `SourceItem` `{ref: "github:<owner>/<repo>#<n>", revision: head_sha, title, url, updated_at}`, repos in spec order, PRs by ascending number. At most `MAX_POLL_ITEMS = 100` items per instant (a kernel safety bound, like `MAX_COUNTED_INSTANTS`); beyond it the rest are dropped and `trigger_fired` carries `items_capped: true` and `items_found`.
9. **Effect per item** (Phase B, only when the linked playbook is `enabled`): `enqueueEvent` `{kind: "message", payload: {agent, playbook, version, trigger_id, scheduled_at, item}, priority: <playbook priority>, sourceRef: "playbook:<playbook id>:<instant>:<item.ref>"}` (the same payload as today's playbook fire plus `item`, so item 05 reads one shape), then one `poll_item_queued` event `{trigger_id, playbook_id, item_ref, revision, queue_id}` (the `{playbook_id, item_ref}` tie `kernel/src/console/threads.ts` already reads). Then `last_fired_at`, `last_result = fired`, next fire, and one `trigger_fired` with `items` (count queued), plus `items_capped` / `items_found` when capped. Zero items ⇒ the same `trigger_fired` with `items: 0`, no `message`, no session.
10. **Notify once per outage.** A `connector_missing` instant records one notification through `recordNotification` (source `trigger:<id>`, joining the step's transaction) only when the trigger's previous `last_result` was not already `connector_missing`; consecutive missing instants add none, and the first non-missing result ends the outage.
11. **The client seam.** `DueWorkContext` gains `readonly github?: GitHubClient` (type-only import from `../integrations/types.js`), `EventLoopOptions` gains the same field passed through by `#runDueWork` like `loomwright`, and `startKernel` passes `deps.githubClient` (a new optional `KernelDeps.githubClient`). With no client, a due poll records `connector_missing` (rule 6) — it never throws or retry-loops. Wiring item 03's real client into `KernelDeps.githubClient`'s default is item 03's (or the later-landing lane's) one-line change, recorded in the docs and the Risk Assessment.
12. **The cron path never sees a poll row**: `fireDueTriggers`'s due query and `planFire` exclude `kind = 'poll'`; the triggers contribution's due work becomes `async`, running `fireDueTriggers` then `await firePollTriggers(store, github, now)`. The entry calls both even when the first throws: it catches the error from each, and after both finish it rethrows the first, so the loop records one `due_work_failed` and a failing cron trigger never skips a due poll in the same tick (and vice versa). Inside each, one trigger's failure never stops the others, as today.

## Acceptance Criteria
- [ ] AC1 — Given a playbook-linked poll with `interval_seconds: 30`, when it is registered (or re-scheduled with `updateTriggerSpec`), then it is refused `TriggerError` `poll_interval_below_floor` and nothing is written; given 60 (connector connected, repo reachable), then it is accepted with `next_fire_at = now + 60s` and its spec stored as given.
- [ ] AC2 — Given a repo outside the connector's `reachable_repos_json`, when the poll is registered, then it is refused `poll_repo_not_reachable` and the message names that repo.
- [ ] AC3 — Given no `github` connector row, or one whose status is `disconnected` / `expired`, when a poll is registered, then it is refused `poll_connector_missing`; given a filter key other than `state` / `draft` / `author`, then it is refused `poll_filter_unknown` naming the key; given a poll with no playbook link, then it is refused `invalid_input`; nothing is written in any case.
- [ ] AC4 — Given a `FakeGitHubClient` with two open PRs on one repo and an enabled linked playbook, when the poll fires, then exactly two `message` rows are queued with `source_ref`s `playbook:<pid>:<instant>:github:<owner>/<repo>#<n>` and payload `item` `{ref, revision}` matching each PR (`revision` = head SHA), plus exactly two `poll_item_queued` events carrying `playbook_id` and `item_ref`, and one `trigger_fired` with `items: 2`.
- [ ] AC5 — Given the same instant replayed after a crash mid-fire (a throw inside the step after the first enqueue, rolled back; and, separately, a re-run of the instant after its step committed), then no message is queued twice: the rolled-back run leaves nothing and the retry queues each item once; the replayed run queues nothing new.
- [ ] AC6 — Given a fake client with no PRs, when the poll fires, then nothing is queued, `trigger_fired` has `items: 0`, and no session starts.
- [ ] AC7 — Given a `rate_limited` response with `resets_at` later than `now + interval`, when the poll fires, then nothing is queued, `last_result = rate_limited`, `next_fire_at` is no earlier than `resets_at`, and a `trigger_missed` event names reason `rate_limited` with `resets_at`; given an `http_error`, then `last_result = source_error`, the schedule is `now + interval`, and the client is called once per repo at most for that instant (no retry loop).
- [ ] AC8 — Given a disconnected connector, when the poll comes due twice in a row, then `listOpenPulls` is never called, `last_result = connector_missing`, and exactly one notification (source `trigger:<id>`) is recorded across both instants (notifier stub, never a real notifier).
- [ ] AC9 — Given the owner's pause, or the kill switch engaged and then released over the instant, when the poll is due, then `listOpenPulls` is never called and nothing is queued (`missed_paused` / `missed_kill_switch` recorded).
- [ ] AC10 — Given more than `MAX_POLL_ITEMS` open PRs, when the poll fires, then exactly `MAX_POLL_ITEMS` messages are queued and `trigger_fired` carries `items_capped: true` and `items_found`.
- [ ] AC10b — Given a cron trigger whose fire fails and a due poll in the same tick, when the triggers due work runs, then the poll still fires (its messages are queued) and the due work throws once (one `due_work_failed`).
- [ ] AC11 — Given `docs/architecture/triggers.md`, then it has a "Poll triggers" section covering the spec, the 60 s floor, the per-item fire key and `source_ref`, the item cap, backoff, parking and notify-once, and its `kind` / `last_result` / `trigger_missed` reason lists name the new values; no doc still says `poll` is refused `poll_not_implemented`.
- [ ] AC12 — Given the finished change, when `cd kernel && npm ci && npm run typecheck && npm test` and `bash scripts/check-docs.sh` run, then both pass.

## Phase 3: File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| poll mechanism | `kernel/src/triggers/store.ts` (1100 — edits limited to the closed sets, removing the refusal, delegating `kind: poll` to `poll.ts`, the poll branch of `nextFireOnEnable`, and excluding poll rows from the cron due query; every new responsibility lives in `poll.ts` / `fire-shared.ts`) | `kernel/src/triggers/poll.ts` (spec validation + the two-phase fire, `MAX_POLL_ITEMS`, `firePollTriggers`) | HIGH |
| shared fire helpers | — | `kernel/src/triggers/fire-shared.ts` (extract `killSwitchWindows`, `pauseWindows`, `inKillSwitchWindow`, `inPauseWindow`, `linkedPlaybook`, `fireStepKey` out of `store.ts` so `store.ts` and `poll.ts` both import them and `store.ts` ↔ `poll.ts` never form an import cycle) | HIGH |
| triggers wiring | `kernel/src/triggers/index.ts` (57), `kernel/src/triggers/tools.ts` (98), `kernel/src/triggers/cli.ts` (215) | — | HIGH |
| client seam | `kernel/src/loop/types.ts` (225), `kernel/src/loop/loop.ts` (349), `kernel/src/kernel.ts` (401) | — | MEDIUM |
| tests | `kernel/test/integrations-foundation.test.ts` (798 — only its `poll triggers are refused poll_not_implemented (AC3)` describe block is rewritten; no new responsibility), `kernel/test/console-pause.test.ts` (674 — only the `TRIGGER_RESULTS` equality pin is extended) | `kernel/test/triggers-poll.test.ts` (every new AC test) | HIGH |
| docs | `docs/architecture/triggers.md` (103), `docs/ARCHITECTURE.md` (278 — the two `poll_not_implemented` mentions in the `triggers` data-model row and the Phase 6 "closed sets grow" bullet), `docs/architecture/playbooks.md` (127 — only line 16's `poll` … `until item 04` sentence, which becomes a pointer to triggers.md's Poll triggers section) | — | HIGH |

Not touched, by design: `kernel/src/triggers/routes.ts` (53) — it maps every `TriggerError` code generically (`return { status: 409, body: { error: err.code, message: err.message } }`), so the new codes need no change; `kernel/src/playbooks/store.ts` — its `sameTrigger` false-negative for a poll falls through to `updateTriggerSpec`, whose `row.spec_json === specJson` check returns `changed: false`; `kernel/src/playbooks/drafts.ts` (its 200-char spec bound is item 10's, Wright drafting polls).

**Total estimated files:** 12 modify + 3 create (~900 changed lines, most in `poll.ts` and `triggers-poll.test.ts`).

### File Overlap Detection

Single subtask: no overlap between subtasks. Cross-lane overlap (outside this brief): see Risk Assessment (`kernel/src/kernel.ts` with lane L1 / item 03; `docs/ARCHITECTURE.md` Phase 6 bullet with lane L3 / item 05).

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `docs/architecture/triggers.md:1-3` | yes | HOLDS | `Time-based triggers: an agent creates a one-shot (`once`) or recurring (`cron`) trigger with a kernel tool` | tip 51 minutes ago, fetched <1h |
| `kernel/src/triggers/store.ts:72` | yes | HOLDS (moved to 77) | `export const TRIGGER_KINDS = ["once", "cron", "poll"] as const;` | tip 51 minutes ago, fetched <1h |
| `docs/OPEN_QUESTIONS.md:112` | yes | STALE | `- [x] **Phase 5 exit: live run (item 18, owner).**` — now ticked, and `docs/evidence/phase-5-exit-live-2026-10-25.json` exists | tip 51 minutes ago, fetched <1h |

## Touched-file invariants

> Grounded at base `7f0949d6cf3c603b4217638a011f2073c9c25eb3`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/triggers/store.ts`** — keep: one audit event per change in the same transaction (`appends exactly one audit event of its own`); the per-instant step key (`return `trigger:${id}:${iso}`;`); the kill-switch early return (`if (isKillSwitchEngaged(store)) return [];`); the playbook read stays raw SQL (`this module never imports the playbooks`); failure isolation (`if (failures.length > 0) throw new Error(clip(failures.join("; ")));`); every refusal before any write. reuse: `instantTaken`, `movePastDone`-style already-done handling, `appendEvent`, `enqueueEvent`, `recordNotification`. mirror: the playbook fire payload `payload: { agent: playbook.owning_agent, playbook: playbook.id, version: playbook.version, trigger_id: id, scheduled_at: scheduledAt }` (the poll payload is this plus `item`). pinned by: `kernel/test/console-pause.test.ts` `expect(TRIGGER_RESULTS).toEqual(["fired", "missed_kill_switch", "missed_paused"]);` (extend, do not delete), `kernel/test/triggers-crash.test.ts` (`kill -9 around a trigger's fire, then a fresh process (AC4)`) and `kernel/test/integrations-foundation.test.ts` `expect(TRIGGER_KINDS).toEqual(["once", "cron", "poll"]);` (keep).
- **`kernel/src/triggers/index.ts`** — keep: the CLI-loadable module graph (`nothing reachable from here may import the`): `poll.ts` and `fire-shared.ts` import only their own files, `../loop/*`, `../api/kill-switch.js`, `../console/pause.js`, `../notifications/record.js` (already imported by `store.ts`) and `../integrations/types.js` **type-only**; update the header's runtime-import list if it changes. reuse: the `dueWork: Object.freeze<DueWorkFn[]>([` array (the entry becomes `async`). pinned by: `kernel/test/feature-seams.test.ts` (the registry's module graph and contributor order `["loomwright", "notifications", "triggers", …]`).
- **`kernel/src/triggers/tools.ts`** — keep: refusals are error results, never throws (`throw new Error(`${name}: ${errorMessage(err)}`);` inside `named`), and the repeat contract (`ctx.stepKey(a.idempotency_key)`); the `kind: z.enum(TRIGGER_KINDS),` enum stays the store's own list. pinned by: `kernel/test/tools-sdk-list.test.ts` `{ path: "kind", enum: TRIGGER_KINDS }`.
- **`kernel/src/triggers/cli.ts`** — keep: stored text is data (`quoted(`/`bare(` escaping in `specText`); add a `poll` branch beside `if (t.kind === "cron") return `cron ${quoted(spec.cron)} in ${bare(spec.tz)}`;` that prints repos and interval through `quoted`/`bare`, never raw.
- **`kernel/src/loop/types.ts`** — mirror the existing optional context field `readonly loomwright?: LoomwrightInstallSettings;` for `github?: GitHubClient` on both `DueWorkContext` and `EventLoopOptions`, type-only import. pinned by: the 13 tests importing `../src/loop/types.js` (e.g. `kernel/test/console-pause.test.ts` `import type { DueWorkContext } from "../src/loop/types.js";`) — the field is optional, so none changes.
- **`kernel/src/loop/loop.ts`** — keep: one try/catch per due-work fn (`this.#recordSafely("due_work_failed", NO_REF, { contributor: work.owner, error: clip(errorMessage(err)) });`); mirror the conditional spread `...(this.#loomwright === undefined ? {} : { loomwright: this.#loomwright })` for `github`.
- **`kernel/src/kernel.ts`** — keep: `KernelDeps` fields are optional with documented defaults (`readonly loopDeps?: EventLoopDeps;`); pass the client the way the loop already gets `loomwright: { configured: options.sessions?.loomwrightPath, installedPluginsPath: options.sessions?.installedPluginsPath },`. The triggers feature must never import `kernel.ts` (feature-seams pin).
- **`kernel/test/integrations-foundation.test.ts`** — keep every block except `describe("poll triggers are refused poll_not_implemented (AC3)", () => {`, which is rewritten in place (renamed for the new behaviour) to assert the new refusals, never removed: its `expect(TRIGGER_KINDS).toEqual(["once", "cron", "poll"]);` assertion (inside that block) stays unchanged; keep the `FakeGitHubClient` block too.

## Closed enumerations touched

> Sibling grep at base `7f0949d6cf3c603b4217638a011f2073c9c25eb3`: `grep -rnF 'missed_paused' --exclude-dir=node_modules --exclude=CHANGELOG.md .` → 43 hits in 9 files (outside `.supervisor/`); `grep -rnF 'owner_off' kernel/src app/src docs` → 19 hits in 7 files; `grep -rnF 'poll_not_implemented' --exclude-dir=node_modules .` → 21 hits in 5 files (outside `.supervisor/`).

- **`rate_limited`, `connector_missing`, `source_error`** (sibling: `missed_paused`) — `last_result` values; also new `trigger_missed` reasons — must be named in:
  - `kernel/src/triggers/store.ts` — `export const TRIGGER_RESULTS = ["fired", "missed_kill_switch", "missed_paused"] as const;` — extend.
  - `kernel/test/console-pause.test.ts` — `expect(TRIGGER_RESULTS).toEqual(["fired", "missed_kill_switch", "missed_paused"]);` — extend.
  - `docs/architecture/triggers.md` — `- `last_result`: `fired`, `missed_kill_switch`, `missed_paused`` and the `trigger_missed` reason list — extend.
  - `docs/architecture/pause.md`, `app/e2e/phase-5-exit.spec.ts`, `kernel/test/phase-5-exit-live.test.ts`, `docs/evidence/*` — no change: they assert or describe `missed_paused` itself, not the full set.
- **`poll_interval_below_floor`, `poll_repo_not_reachable`, `poll_connector_missing`, `poll_filter_unknown`** (sibling: `owner_off`; replaces `poll_not_implemented`) — must be named in:
  - `kernel/src/triggers/store.ts` — `export type TriggerErrorCode = "invalid_spec" | "invalid_input" | "not_found" | "not_owner" | "owner_off" | "needs_confirmation" | "poll_not_implemented";` — extend with the four, remove `poll_not_implemented`.
  - `kernel/src/triggers/routes.ts` — `return { status: 409, body: { error: err.code, message: err.message } };` — no change: generic over every code.
  - `kernel/src/triggers/tools.ts` (1 hit, a comment), `kernel/src/playbooks/enable.ts` (2), `kernel/src/playbooks/store.ts` (5), `docs/architecture/dry-run.md` (1), `docs/architecture/playbooks.md` (2), `docs/architecture/triggers.md` (1) — `owner_off` as prose or as the playbooks feature's own `PlaybookError` code, not a `TriggerErrorCode` list — no change.
  - `kernel/src/triggers/store.ts` (7 hits), `docs/ARCHITECTURE.md` (2), `docs/architecture/triggers.md` (2), `kernel/test/integrations-foundation.test.ts` (9) — the `poll_not_implemented` mentions — rewrite (in the File Impact Map). `docs/architecture/playbooks.md` (1, line 16: `is refused `trigger: poll_not_implemented: …` until item 04`) — rewrite (in the File Impact Map).
- **`poll_item_queued`** (event kind) — already in `THREAD_EVENT_KINDS` and tied in `kernel/src/console/threads.ts` (`poll_item_queued: "playbook",`) by item 01 — no change; the payload must carry `playbook_id` and `item_ref` (what `threads.ts` reads: `isText(p.item_ref)`).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/triggers-poll.test.ts` — AC1 floor | flip `< 60` → `< 30` in `kernel/src/triggers/poll.ts` |
| `kernel/test/triggers-poll.test.ts` — AC2 reachable | delete the `poll_repo_not_reachable` throw line in `kernel/src/triggers/poll.ts` |
| `kernel/test/triggers-poll.test.ts` — AC4 per-item source_ref | flip `:${item.ref}` → `` in the `sourceRef` template in `kernel/src/triggers/poll.ts` (all items then share one `source_ref` and only one is queued) |
| `kernel/test/triggers-poll.test.ts` — AC5 replay | delete the `row.next_fire_at !== scheduledAt` re-check line in the poll step in `kernel/src/triggers/poll.ts` |
| `kernel/test/triggers-poll.test.ts` — AC7 backoff | flip `max(` → `min(` in the rate-limited next-fire computation in `kernel/src/triggers/poll.ts` |
| `kernel/test/triggers-poll.test.ts` — AC8 notify once | delete the previous-`last_result` `connector_missing` guard line in `kernel/src/triggers/poll.ts` |
| `kernel/test/triggers-poll.test.ts` — AC9 pause | delete the pause-window check line before the fetch in `kernel/src/triggers/poll.ts` |
| `kernel/test/triggers-poll.test.ts` — AC10 cap | flip `MAX_POLL_ITEMS = 100` → `MAX_POLL_ITEMS = 1_000_000` in `kernel/src/triggers/poll.ts` |
| `kernel/test/console-pause.test.ts` — `TRIGGER_RESULTS` equality | delete `"source_error"` from `TRIGGER_RESULTS` in `kernel/src/triggers/store.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Poll trigger: validation, client seam, two-phase per-item fire, backoff, parking, docs | all | 12 modify, 3 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/triggers/poll.ts"}
  - {kind: "symbol", path: "kernel/src/triggers/poll.ts", name: "firePollTriggers"}
  - {kind: "symbol", path: "kernel/src/triggers/poll.ts", name: "MAX_POLL_ITEMS"}
  - {kind: "file", path: "kernel/src/triggers/fire-shared.ts"}
  - {kind: "symbol", path: "kernel/src/triggers/store.ts", name: "TRIGGER_RESULTS"}
  - {kind: "type", path: "kernel/src/loop/types.ts", name: "DueWorkContext"}
  - {kind: "symbol", path: "kernel/src/kernel.ts", name: "githubClient"}
  - {kind: "file", path: "kernel/test/triggers-poll.test.ts"}
  - {kind: "symbol", path: "docs/architecture/triggers.md", name: "Poll triggers"}
requires: []
lanes:
  - "kernel/src/triggers/poll.ts"
  - "kernel/src/triggers/fire-shared.ts"
  - "kernel/src/triggers/store.ts"
  - "kernel/src/triggers/index.ts"
  - "kernel/src/triggers/tools.ts"
  - "kernel/src/triggers/cli.ts"
  - "kernel/src/loop/types.ts"
  - "kernel/src/loop/loop.ts"
  - "kernel/src/kernel.ts"
  - "kernel/test/triggers-poll.test.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/test/console-pause.test.ts"
  - "docs/architecture/triggers.md"
  - "docs/ARCHITECTURE.md"
  - "docs/architecture/playbooks.md"
external_requires:
  - "Item 01 (phase 6 foundation, merged): PollSpec, SourceItem, GitHubClient, FakeGitHubClient, migration 17 connectors table"
  - "Item 03 (lane L1, in flight): the real GitHubClient, later wired into KernelDeps.githubClient's default"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): the real `GitHubClient` is item 03's (lane L1), not on `main`; until it is wired, a production poll records `connector_missing` every interval. | HIGH | Seam `KernelDeps.githubClient` → `EventLoopOptions.github` → `DueWorkContext.github` (rule 11); triggers.md states the wiring is owed and by whom; the PR body names the follow-up so item 03's lane (or this one, if it lands second) wires the default. Never construct a client here. |
| Cross-lane contract with item 03: `reachable_repos_json` format is not fixed by item 01. | HIGH | Pin the reading (rule 3: JSON array of `owner/name` strings, case-insensitive, unparseable ⇒ empty) and document it in triggers.md; if item 03 lands a different shape first, adapt the one parser in `poll.ts`. |
| Cross-lane contract with item 05 (lane L3): the queued message's payload shape (`item` field) and `source_ref`. | HIGH | Payload = today's playbook payload plus `item: SourceItem` (rule 9), documented in triggers.md; item 05 reads `item.ref` / `item.revision`. |
| Cross-lane merge conflict: `kernel/src/kernel.ts` (item 03 may wire its client there) and `docs/ARCHITECTURE.md`'s Phase 6 "closed sets grow" bullet (item 05 edits the `item.id` clause on the same line). | MEDIUM | Keep both edits minimal and local (one `KernelDeps` field + one pass-through; replace only the `poll` clause of the bullet). |
| `runStep` is synchronous while `GitHubClient` is async: a fetch inside the step would hold the transaction or break atomicity. | HIGH | Two-phase fire (rule 5); the step re-reads the row and re-checks kill switch / pause before writing. |
| A poll row reaching the cron path would be parked as an unknown kind (`planFire` throws). | MEDIUM | Exclude `kind = 'poll'` from `fireDueTriggers`'s due query (rule 12) and test that a due poll never appears in `fireDueTriggers`' outcomes. |
| Burst of queued items for a busy repo. | MEDIUM | `MAX_POLL_ITEMS` cap recorded when hit (rule 8); item 05's dedupe and the playbook's token limit bound the cost. |
| Module layout: `store.ts` is 1100 lines. | MEDIUM | New responsibilities go to `poll.ts` / `fire-shared.ts`; `store.ts` edits stay to the closed sets, the refusal swap, delegation and the due-query exclusion. |
| Cited-line premise (Phase 3): `docs/OPEN_QUESTIONS.md:112` no longer holds "phase 5 live exit unticked" — it is ticked and its evidence exists. | MEDIUM | Favourable staleness: the requirement's sequencing precondition (phase 5 live exit first) is met; no action. |
| Crash AC tested in-process (a throw inside the step, and a replay of a done step) rather than a separate `kill -9`'d process. | LOW | Same atomicity as the cron path, which `kernel/test/triggers-crash.test.ts` already proves across processes; Phase A writes nothing, so only Phase B's transaction matters. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-27-poll-trigger-fetches-source-at-interval.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-27T14:24:28Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/146
- **Branch:** feature/poll-trigger-fetches-source-at-interval
- **Files changed:** 15
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Poll trigger replaces poll_not_implemented: validated at creation (60 s floor, github connector, reachable repos, known filters, playbook link); two-phase per-item fire (fetch outside any transaction, one runStep per instant) queues one message + one poll_item_queued per open PR keyed playbook:<id>:<instant>:<item.ref>; rate-limit backoff to resets_at, source_error keeps schedule, connector_missing notifies once per outage, pause/kill switch skip the fetch, MAX_POLL_ITEMS=100. Client seam KernelDeps.githubClient -> EventLoopOptions.github -> DueWorkContext.github (real client is item 03's follow-up). Self-heal: 3b1ca20 moves a poll off a failed instant (no per-tick GitHub refetch); 977ee06 pins every failure-move branch. 2091 tests pass, check-docs OK. 6 LOW findings dismissed below the MEDIUM floor (see PR marker comment).

## Not verified
- **real GitHubClient via KernelDeps.githubClient default** — item 03 has not landed; only FakeGitHubClient exercised, so production polls record connector_missing until it is wired (subtask 1)
- **playbook dry-run / markdown mirror / Wright drafting for a poll playbook** — outside this lane; dry-run shows no next fires for a poll, drafts' 200-char spec bound is item 10's (subtask 1)
- **message handler consuming payload.item of a poll's queued message** — item 05's consumer, not run here (subtask 1)
