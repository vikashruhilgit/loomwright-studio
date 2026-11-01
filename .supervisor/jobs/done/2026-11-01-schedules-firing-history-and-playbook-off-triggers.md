# Supervisor Job: Schedules & triggers — firing history for all triggers, "Upcoming · Today", playbook-off triggers, and the shared shell (item 16)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-01-042119/L6
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-7/2026-11-01-090016-schedules-firing-history-and-playbook-off-triggers.md
- **Base commit:** daed1eab9fafe3f5429ca2d3f6efd13609bc7ada

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React + TypeScript renderer, vitest (jsdom) and Playwright/Electron e2e, all already in `app/`. No new dependency. |
| 2 | Dependency Availability | GO | Every read the screen needs exists: `GET /schedule`, `GET /triggers/:id/fires`, the live store's `triggers` and `playbooks` resources (`app/src/store/resources.ts`: `playbooks: { method: "GET", path: "/playbooks", query: { all: "1" } }`, so playbooks that are off are included). The shell parts from item 11 are merged (#192): `Titlebar` renders `ScreenDefinition.Subtitle`, `useKernelReach`, `withLastKnown`, `KernelBand`, and the fixture kernel's `stop()`/`restart()`. |
| 3 | Architecture Fit | CAUTION | No kernel route returns fires for all triggers, and the requirement's Touches doesn't include `app/src/api/contract.ts`. The owner settled this in `LP-CLARIFY` on 2026-11-01: the app fans out over the existing per-trigger route (see "Owner decisions (Launch Pad)" below). The fixture data and the evidence directory are also outside Touches. The owner extended Touches to cover both (`LP-TOUCHES`). |
| 4 | Scope vs Supervisor Capability | GO | One screen folder plus its e2e, fixture and evidence: 13 files modified and 7 created, all of it one coherent change to one screen. That stays single-agent: it doesn't meet `context-bound` by a wide margin, and the groups share `SchedulesScreen.tsx`. |
| 5 | Hard Blockers | GO | None. Kernel and contract are unchanged. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Make Schedules & triggers match the approved `gui-v2.html` `schedules-populated` and `schedules-unreachable` views. That means one firing history for all triggers with an All / Not fired filter, an "Upcoming · Today" list whose titles are never silently cut, a visible "playbook off: fires are skipped" note on every trigger whose playbook is off, the count line in the title bar, and the last data kept under the shared band when the kernel stops.

**Problem Statement:**
The owner needs to see what fired, what didn't and why, across every trigger, without opening each trigger. The 2026-11-01 live run (`schedules-populated`, light and dark) found these problems:
- The right pane shows only the selected trigger's detail and history.
- The Upcoming list has no "· Today" label, and its titles are cut ("Review open PRs on studio-sand…").
- Playbooks says "6 playbooks · 0 on" while Schedules says "3 triggers on", and the audit log shows those triggers' fires skipped (`trigger_missed` · `playbook_not_enabled`). Neither screen says why.
- With the kernel stopped, the screen replaced everything with "Status unknown".
- Its count line sits under the title instead of beside it.

Success means the populated and unreachable screenshots match their mockup views, and the playbook-off state is visible on the row, in the upcoming entry and in the history.

**Owner decisions carried from the requirement (binding):** These come from 2026-10-30 and 2026-11-01. Each screen adopts item 11's shell in its own folder. "On" vs "on" is explained in Schedules: a trigger whose playbook is off says so on its row and in the upcoming list (its fires are skipped, `playbook_not_enabled`). Nothing is patched outside an item's Touches as extended below; a worker that needs another file stops and says so. Invariants 1–9 are unchanged. Screenshots come from the fixture kernel only; none of the owner's live-run screenshots are committed. Non-goal: turning triggers or playbooks on or off from this screen beyond the existing trigger switch.

**Owner decisions (Launch Pad, 2026-11-01, binding):**
1. **History source: app fan-out (`LP-CLARIFY`).** The all-triggers history is built in the renderer from the existing `GET /triggers/:id/fires`. The screen reads one first page per trigger in the `triggers` resource and merges the pages newest first by event id. The kernel (`kernel/src/gui/schedules.ts`, `kernel/test/gui-schedules.test.ts`) and `app/src/api/contract.ts` are **not** changed. The cost is one request per trigger on each refresh. It is acceptable for a personal build with a handful of triggers, and the PR names this limit.
2. **Touches extended (`LP-TOUCHES`).** Add `app/e2e/fixtures/schedules.ts` (fires on several triggers, and a trigger that is on whose playbook is off) and `docs/evidence/phase-7-polish/schedules/**` (the README and the regenerated PNGs).
3. **Touches extended (`LP-TOUCHES`, round 2).** Add `app/src/shell/frame.test.tsx`, and change only the expected list in `it("no screen declares one yet …")` from `[]` to `["schedules"]`. Give the test a name that fits, such as "the screens that declare a count line". If another screen lane edits the same line first, the merge takes the union of the ids, and that conflict is escalated, never force-resolved. No other line of `app/src/shell/**` changes.

**`app/e2e/phase-7-exit.spec.ts` stays green without being edited (design constraints; it is outside Touches and reads this item's fixture through `app/e2e/fixtures/phase-7-exit.ts`'s `schedulesFixture(init.schedules)`):**
- The title-bar count line (`Subtitle.tsx`) carries `data-testid={IDS.summary}` with the same text as `summaryText`. The exit spec's page-wide `byId(page, SCHEDULES.summary)` checks for "5 upcoming · 4 triggers on" and "… · last known" then still pass.
- `IDS.timeline` stays on **exactly one** element, the region wrapping both the Today and the Later lists, because the exit spec's `byId` is a strict `getByTestId`. Every upcoming entry, Later ones included, keeps `data-testid={IDS.entry}`, so `byId(page, SCHEDULES.entry)).toHaveCount(5)` still holds.
- Whichever history table the pane shows (all triggers by default, or one trigger's own) carries `data-testid={IDS.table}`, so the exit check `byId(page, SCHEDULES.table)` on first load passes. Only one is mounted at a time.
- The fixture keeps the second trigger in list order (id 2, "Weekly changelog") with **no fires**, so the exit spec's "Nothing has fired or been missed yet." after opening it still holds. It also keeps the counts of 5 upcoming and 4 triggers on: no trigger is added and no enabled flag or `next_fire_at` changes.
- So the fixture's playbook-off case is trigger 2: its playbook `weekly-changelog` gets a non-`"enabled"` `status` (for example `"disabled"`) in `PLAYBOOKS`. The extra fires for the multi-trigger merge go on triggers 3 and 4 (no playbook), with ids interleaved with the poll's. The poll's existing `playbook_not_enabled` misses show the new history label in e2e. "Its own skipped fires" for a playbook-off trigger is pinned in `AllHistory.test.tsx` (jsdom), where the fake kernel can give that trigger misses.
- Run `npx playwright test e2e/phase-7-exit.spec.ts` as part of `npm run e2e`. If it can't stay green under these constraints, stop and say so (owner rule).

**Design decisions this brief makes (they follow conventional defaults; the PR names each for the owner):**
- **Default pane = all triggers.** With no trigger selected, which is the default as in the mockup, the right pane shows "Firing history" for all triggers. Choosing a trigger's name in the list opens that trigger's detail and its own history (the existing `Detail` and `History`, reused) with a "All triggers" button that goes back. That's how "a trigger's own detail stays reachable from its row".
- **Merged fire shape.** `TriggerFire` has no trigger id, so `all-fires.ts` wraps each fire as `{ trigger_id, fire }` before merging. Grouping compares `trigger_id`, `fire.kind` and `fire.reason`.
- **Merged paging horizon.** The merged list shows only fires newer than or equal to the *horizon*. The horizon is the oldest loaded fire id among triggers that still have older pages (`cursor !== null`); a trigger whose history is fully loaded doesn't limit it. So no trigger's older-but-unloaded fire can be missing from the list above it. "Load older" reads the next page of each trigger whose cursor is not null and whose oldest loaded fire is at the horizon, then recomputes.
- **"Upcoming · Today" and "Later".** The route returns next fires on any day. Entries due on the local day of `now` go under the heading "Upcoming · Today". Later entries go under a "Later" sub-label in the same region, so nothing is hidden. With nothing due today, the "Upcoming · Today" heading still shows, followed by a one-line "Nothing else is due today."
- **Playbook off = the kernel's own rule, mirrored.** A trigger is "playbook off" when `trigger.playbook !== null` and the playbooks resource has loaded, and the playbook with that slug is missing or has `status !== "enabled"`. That is exactly the kernel's gate (`kernel/src/triggers/fire-shared.ts` `linkedPlaybook` by `slug`, then `poll.ts`'s `linked === undefined || linked.status !== "enabled"`). While the playbooks resource hasn't loaded, the screen claims nothing. A trigger with no playbook is never "playbook off".

## Acceptance Criteria
- [ ] **AC1** Given Schedules & triggers has loaded with data, when the fixture kernel's listener stops (`fixture.stop()`), then:
  - the shared band (`kernel-unreachable-band` / `kernel-reconnecting-band`) shows;
  - the screen keeps its timeline, trigger list and firing history as last read;
  - the title bar's count line ends in "· last known" (`withLastKnown`);
  - every switch, Refresh and Load older is disabled with `title="Needs the kernel"`;
  - no raw request text (method, path or connection state) is drawn;
  - after `fixture.restart()` the screen reads again by itself and the "· last known" mark goes away.

  Leaving Schedules and coming back while the kernel is stopped still shows the last data, because the last answers are held per bridge beyond the screen's mount. "Status unknown" remains only for a window that never had an answer.
- [ ] **AC2** Given Schedules & triggers is populated, then its count line ("N upcoming · M triggers on") sits beside the title in the title bar (`data-testid="titlebar-subtitle"`, declared as `screen.Subtitle` in `index.tsx`), matching `schedules-populated`. The screen draws no count line of its own (no `IDS.summary` element inside the screen body).
- [ ] **AC3** Given fires from several triggers, then:
  - the right pane's "Firing history" table (When · Trigger · Result) lists them all, merged newest first by event id, each row naming its trigger;
  - "All · N" and "Not fired · N" filter it, and Not fired keeps only `trigger_missed` rows;
  - consecutive repeats of one trigger, kind and reason fold into one row with a count;
  - "Load older" extends the list without dropping or repeating a fire;
  - choosing a trigger in the list opens its detail and its own history, and "All triggers" returns;
  - all of this matches `schedules-populated`.
- [ ] **AC4** Given upcoming fires today, then the list is headed "Upcoming · Today" (later fires under "Later"), and every entry title and trigger-row title wraps to at most two lines. A title still too long for two lines is clamped with an ellipsis *and* carries its full text as a `title` tooltip, so no title is cut without one.
- [ ] **AC5** Given a trigger that is on whose playbook is off (fixture: trigger 2, whose playbook `weekly-changelog` has a `status` that is not `"enabled"`), then:
  - its row in the trigger list and its entry in the upcoming list each say "playbook off: fires are skipped";
  - the note has accessible text, not colour alone;
  - its `trigger_missed` fires with reason `playbook_not_enabled` read "playbook off: fires are skipped" in the firing history, with the code `playbook_not_enabled` verbatim beneath;
  - a trigger whose playbook is enabled, or that has no playbook, shows no such note.
- [ ] **AC6** Given the polish gate, then a committed evidence file `docs/evidence/phase-7-polish/schedules/README.md` names each regenerated screenshot against its `gui-v2.html` view, in light and dark. The screenshots are `schedules-populated` with the all-triggers history and the playbook-off trigger, `schedules-not-fired`, and `schedules-unreachable`, plus the unchanged states that were regenerated. The PNGs are written by `app/e2e/schedules.spec.ts` under `SCHEDULES_EVIDENCE=1`. The README replaces the departures this item resolves ("Upcoming, not Upcoming · today", "history is per trigger", "The sidebar says Schedules") with what holds now. It names the remaining differences: no wake-up rows in the history (no route), the "playbook off" row the mockup doesn't have, the "Later" sub-label, and the one-request-per-trigger fan-out. The PR body links to the README.

**Evidence rule:** AC6's evidence lives in the committed `docs/evidence/phase-7-polish/schedules/README.md` and its PNGs (File Impact Map), never only in the PR body.

**Validation (must pass before merge):**
- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`
- `cd kernel && npm ci && npm run typecheck && npm test` (unchanged kernel; run to prove it)

## Touched-file invariants

> Grounded at base `daed1eab9fafe3f5429ca2d3f6efd13609bc7ada`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/screens/schedules/SchedulesScreen.tsx`**
  - keep: a status 0 answer is "kernel unreachable", never "nothing scheduled". Today that is `const connectionDown = connection.state === "reconnecting"`; replace it with item 11's `useKernelReach(api)` (`app/src/shell/last-known.ts`: `const shellBand = state === "reconnecting" || state === "unreachable";`), and draw `<KernelBand testId=... />` yourself only when your own read answered status 0 and `!shellBand`, so exactly one band is on screen.
  - keep: every write turned off with `title={offline ? "Needs the kernel" : undefined}`.
  - keep: live refetch through `useFeedRefetch(newestScheduleEventId(eventLog), refetchAll);`, which now refetches every trigger's first page as well.
  - keep: the re-read when the feed is live again (`if (live && scheduleUnanswered) refetchSchedule();`), the J/K walk over `data-nav-group` / `data-nav-row` / `data-nav-focus`, the confirm-dialog focus return, and the `inFlight` double-click guard.
  - keep: kernel strings stay React text children (header: "a React text child, never markup").
  - mirror: the shell draws the one `h1` ("shell draws the one `h1`" in `index.tsx`).
- **`app/src/shell/frame.test.tsx`**
  - change only: the expected list in `expect(SCREENS.filter((s) => s.Subtitle !== undefined).map((s) => s.id)).toEqual([]);` becomes `["schedules"]` (owner decision 3).
  - keep: the two title-bar tests above it unchanged ("a screen that declares none shows the title alone, with no empty subtitle element").
- **`app/src/screens/schedules/SchedulesScreen.test.tsx`**
  - change only the tests whose premise this item changes, which are those expecting:
    - a trigger history open on load ("populated: the timeline, 'Triggers · N', the open trigger's detail and its firing history; no h1 of its own");
    - the summary inside the screen body;
    - "Status unknown" after a remount (it stays for a window that never had an answer: "with no data at all it says the status is unknown, never 'nothing is scheduled'").
  - keep: every switch, confirm, J/K, live-update, untrusted-text and route-failure test as it is. That includes the inert-markup check `expect(container.querySelector("b:not(.schedules-clip)")).toBeNull();`, so a clamped title keeps the `schedules-clip` class or the check is updated to the new title class in the same way.
- **`app/e2e/phase-7-exit.spec.ts` (read, not modified)**
  - consumer of this item's fixture and test ids. It must stay green under the design constraints in the Task section. Keep `byId(page, SCHEDULES.timeline)).toBeVisible()` true with one element carrying `IDS.timeline`, keep `byId(page, SCHEDULES.entry)).toHaveCount(5)` true, and keep `byId(page, SCHEDULES.summary)).toHaveText("5 upcoming · 4 triggers on")` and `byId(page, SCHEDULES.historyEmpty)).toHaveText("Nothing has fired or been missed yet.")` true.
- **`app/src/screens/schedules/History.tsx`**
  - keep: rows are a fixed height and keyed by their oldest fire's id (`key: \`fire-${g.oldest.id}\`` in `model.ts` `groupFires`), so a refetch moves nothing already shown.
  - keep: only a missed poll with no connector links to Integrations (`linksToIntegrations`).
  - keep: the reason code is shown verbatim beneath the label.
  - reuse: this component stays the selected trigger's own history. The all-triggers table is a new `AllHistory.tsx` that reuses `fireView`, `fireTime`, `filterGroups`-style filtering and the same row markup classes. Never a second copy of `KNOWN_REASONS`.
- **`app/src/screens/schedules/model.ts`**
  - keep: `KNOWN_REASONS` is the one label table (`playbook_not_enabled: { label: "playbook not enabled", tone: "attention" },`). Change that label to `"playbook off: fires are skipped"` (AC5) in place rather than adding a second table.
  - keep: `safe()` for kernel text.
  - keep: `groupFires`'s rule "A fired row and a missed one never merge". The all-triggers grouping also never merges across two triggers.
  - keep: `mergeFirstPage` / `appendOlderPage` semantics for the per-trigger history.
  - reuse: `sameDay` / `timelineTime` for the Today split, and `triggerName` for names.
  - pinned by: `app/src/screens/schedules/model.test.ts`.
- **`app/src/screens/schedules/index.tsx`**
  - keep: `title: "Schedules & triggers"`, `nav: { label: "Schedules & triggers", order: 8, shortcut: "⌘8" }` (pinned by `app/src/App.test.tsx` and `app/e2e/smoke.spec.ts`), and the no-bridge branch's "This window has no connection to the kernel.".
  - add: `Subtitle`. It renders nothing when there's no bridge or no answer yet, so the title bar shows the title alone (`Titlebar.tsx`: "A screen that declares none gets the title alone").
- **`app/src/screens/schedules/useSchedule.ts`, `useHistory.ts`**
  - keep: "an answer older than the latest request is dropped" (the `generation` guards), and "A failed read never drops what is held".
  - The last ok `/schedule` answer moves into the per-bridge holder `last-read.ts` so it outlives the mount. `useScheduleRead` keeps its signature.
- **`app/src/screens/schedules/schedules.css`**
  - keep: every colour from the design tokens. The pins are `app/src/screens/schedules/contrast.test.ts` (a named token must exist) and `app/e2e/schedules.spec.ts` "AC8: the screen's stylesheet takes every colour from the design tokens" (no hex or colour function, no named colour).
  - change: `.schedules-clip`'s `white-space: nowrap;` single-line cut for titles becomes a two-line clamp (`-webkit-line-clamp: 2`) on the title elements only. Spec lines may stay one line.
- **`app/e2e/schedules.spec.ts`**
  - keep: `const STATES = ["empty", "loading", "populated", "not-fired", "confirm", "error", "unreachable"] as const;`, so the playbook-off state is shown inside `populated`, not a new state.
  - keep: the guard "AC9: without SCHEDULES_EVIDENCE the screenshots went to the output dir and nothing under the tracked evidence dir changed during the run", and the README-names-every-file test (`STATES.length * THEMES.length`).
  - keep: the opening by hash (`window.location.hash = "#/schedules";`).
  - add: AC1 uses `fixture.stop()` then `fixture.restart()` (`app/e2e/fixture-kernel.ts`: `restart(): Promise<void>;`).
- **`app/e2e/fixtures/schedules.ts`**
  - keep: `POLL_ID = 1`, `PAST_ONCE_ID = 6` and `PAGE_SIZE = 10`, which the spec imports.
  - keep: the firesRoute's `next_before` cursor rule (`page.length === PAGE_SIZE && last !== undefined ? String(last.id) : null`), and the 404 for an unknown trigger.
  - add: fires on triggers 3 and 4, with ids interleaved with the poll's so the merge order is observable, and `weekly-changelog`'s `status` set to a value that is not `"enabled"` (trigger 2 becomes the playbook-off trigger).
  - keep: trigger 2 has no fires; 5 upcoming and 4 triggers on; no new trigger (consumer: `app/e2e/phase-7-exit.spec.ts`).
  - note: interleaving the new fires renumbers the poll's ids (today `1..28`, with `let nextFire = 29;` feeding the live fire). That moves what `app/e2e/schedules.spec.ts` AC2/AC3 pins: the `fireReads` cursors, the page-one row kinds and the "All · 10+ / 20+ / 28" counts. `nextFire` must stay above every fixture id. That test is rewritten for the all-triggers default plus one trigger's own paging, and the fan-out reads one first page per trigger.
  - mirror: every fire stays a valid `TriggerFire` (`satisfies TriggerFiresResponse`).
- **`docs/evidence/phase-7-polish/schedules/README.md`**
  - keep: its table names a light and a dark file per entry in `STATES`, and every PNG in the directory, because the spec's README test reads it.
  - keep: the regenerate command line (`SCHEDULES_EVIDENCE=1 npx playwright test e2e/schedules.spec.ts --workers=1`).

## Closed enumerations touched

> Sibling grep at base `daed1eab9fafe3f5429ca2d3f6efd13609bc7ada`: `grep -rln "SCHEDULES_TEST_IDS" app` → 8 files (`model.ts`, `model.test.ts`, `index.tsx`, `SchedulesScreen.tsx`, `SchedulesScreen.test.tsx`, `History.tsx`, `e2e/schedules.spec.ts`, `e2e/phase-7-exit.spec.ts`).

- **New test ids** (sibling: `loadOlder: "schedules-load-older"`): the all-triggers table's rows and trigger name, the playbook-off note, the "All triggers" button, and the Today/Later headings.
  - `app/src/screens/schedules/model.ts` — `export const SCHEDULES_TEST_IDS = {` (the one id map) — extend.
  - `app/src/screens/schedules/model.test.ts` — `const values = Object.values(SCHEDULES_TEST_IDS);` uniqueness check — no change: it iterates the map, so new ids are covered.
  - the screen, test and e2e files — readers — extend only where they use the new ids.
  - `app/e2e/phase-7-exit.spec.ts` — reader (`import { SCHEDULES_TEST_IDS as SCHEDULES }`) — no change: no existing id is renamed or removed, and `summary`/`table` keep their meaning (design constraints).

## Pin mutations

Each row is applied by the reviewer to a scratch copy. The literals marked † exist at base. The rest are written by this change, and the reviewer applies them in prose.

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/screens/schedules/all-fires.test.ts` — merged newest first across triggers | In `all-fires.ts`, reverse the merge sort comparator (ascending by id). The pin must turn red. |
| `app/src/screens/schedules/all-fires.test.ts` — horizon hides fires below an unfinished trigger's oldest loaded fire | In `all-fires.ts`, drop the horizon filter (show every loaded fire). The pin must turn red. |
| `app/src/screens/schedules/all-fires.test.ts` — a repeat never merges across two triggers | In `all-fires.ts`, remove the `trigger_id` equality from the grouping condition. The pin must turn red. |
| `app/src/screens/schedules/model.test.ts` — playbook off mirrors the kernel gate (missing slug or `status !== "enabled"`; null playbook never off; unloaded playbooks claim nothing) | In `model.ts`'s playbook-off helper, flip `!== "enabled"` → `=== "enabled"`. The pin must turn red. |
| `app/src/screens/schedules/model.test.ts` — Today split | In `model.ts`'s Today split, replace the `sameDay(...)` test with `true`. The "Later" assertion must turn red. |
| `app/src/screens/schedules/model.test.ts` — label for `playbook_not_enabled` | flip `playbook off: fires are skipped` → `playbook not enabled` in `app/src/screens/schedules/model.ts` |
| `app/src/screens/schedules/AllHistory.test.tsx` — the default pane is all triggers and "All triggers" returns from a trigger's detail | In `SchedulesScreen.tsx`, default the selection to `triggers?.[0]` again († `?? triggers?.[0]`). The pin must turn red. |
| `app/src/screens/schedules/AllHistory.test.tsx` — a remount while offline still shows the last data | In `last-read.ts`, make the holder per mount (state kept in the hook, not per bridge). The pin must turn red. |
| `app/src/screens/schedules/AllHistory.test.tsx` — AC4 a clamped title carries its full text as `title` | In `SchedulesScreen.tsx`, drop the `title` attribute from the clamped entry/trigger title. The pin must turn red. |
| `app/src/screens/schedules/AllHistory.test.tsx` — AC5 the note shows on a playbook-off trigger's row and upcoming entry, and not for an enabled or null playbook | In `SchedulesScreen.tsx`, render the note on the negation of the playbook-off helper. The pin must turn red. |
| `app/e2e/schedules.spec.ts` — AC3 every interleaved fixture fire appears exactly once after paging to the end | In `useAllFires.ts`, skip reading the next page of any trigger but the first with a cursor. The pin must turn red. |
| `app/src/screens/schedules/AllHistory.test.tsx` — AC1 "Status unknown" only for a window that never had an answer | In `SchedulesScreen.tsx`, ignore the `last-read.ts` holder when choosing the unknown state. The pin must turn red. |
| `app/src/shell/frame.test.tsx` — the screens that declare a count line are `["schedules"]` | delete the `Subtitle` line of `screen` in `app/src/screens/schedules/index.tsx`. The pin must turn red. |
| `app/e2e/schedules.spec.ts` — AC2 count line in the title bar | In `index.tsx`, delete the `Subtitle` line of `screen`. The pin must turn red. |
| `app/e2e/schedules.spec.ts` — AC1 refresh after restart | In `SchedulesScreen.tsx`, delete the re-read effect († `if (live && scheduleUnanswered) refetchSchedule();`). The pin must turn red. |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Schedules: all-triggers firing history, Upcoming · Today, playbook-off note, title-bar count line, last data under the shared band, e2e + evidence | all | 13 modify, 7 create (+ regenerated PNGs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| screen | `app/src/screens/schedules/SchedulesScreen.tsx` (475), `app/src/screens/schedules/History.tsx` (218), `app/src/screens/schedules/model.ts` (418 — appends the Today split and the playbook-off helper next to `sameDay`/`triggerName`, which they reuse; stays under 500), `app/src/screens/schedules/index.tsx` (38), `app/src/screens/schedules/useSchedule.ts` (58), `app/src/screens/schedules/useHistory.ts` (93), `app/src/screens/schedules/schedules.css` (536 — appended: the one stylesheet `contrast.test.ts` and the e2e AC8 colour check read, so a second file would escape both pins) | `app/src/screens/schedules/all-fires.ts` (the pure merge, horizon and cross-trigger grouping), `app/src/screens/schedules/useAllFires.ts` (the fan-out hook: one first page per trigger, Load older, stale-answer drop), `app/src/screens/schedules/AllHistory.tsx` (the all-triggers table), `app/src/screens/schedules/last-read.ts` (the per-bridge holder of the last ok schedule and merged history, read by the screen and the Subtitle), `app/src/screens/schedules/Subtitle.tsx` | HIGH |
| unit tests | `app/src/shell/frame.test.tsx` (one expected list, owner decision 3), `app/src/screens/schedules/SchedulesScreen.test.tsx` (938 — modify only the existing tests whose premise changes: the default open trigger, the summary in the toolbar, "Status unknown"; every new test goes to a new file), `app/src/screens/schedules/model.test.ts` (382) | `app/src/screens/schedules/all-fires.test.ts`, `app/src/screens/schedules/AllHistory.test.tsx` | HIGH |
| e2e + fixture | `app/e2e/schedules.spec.ts` (505 — the screen's single e2e file, where `STATES`, `screenshots()` and the evidence guards live; new tests appended there), `app/e2e/fixtures/schedules.ts` (295) | — | HIGH |
| evidence | `docs/evidence/phase-7-polish/schedules/README.md` (88), the 14 `schedules-*-{light,dark}.png` regenerated | — | HIGH |

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` scans the docs tree; this change edits only `docs/evidence/phase-7-polish/schedules/README.md`. The spec's own README test also reads that README.

**Not touched (owner rule):** `kernel/src/gui/schedules.ts`, `kernel/test/gui-schedules.test.ts` (listed in Touches, but no change is needed under decision 1), `app/src/api/contract.ts`, `app/e2e/fixture-kernel.ts`, `app/e2e/phase-7-exit.spec.ts`, `app/e2e/fixtures/phase-7-exit.ts`, and `app/src/shell/**` except `frame.test.tsx`'s one expected list.

**Where literals live (for the provides gate):** the timeline heading text "Upcoming · Today" is written in `SchedulesScreen.tsx`, where the "Upcoming" heading already is.

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/store/migrations/001_initial.ts:9` | yes | HOLDS | ` * hooks_installed and connectors arrive with their phases, so columns that will` | tip 2 hours ago, fetched >1h |

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "app/src/screens/schedules/all-fires.ts"}
  - {kind: "file", path: "app/src/screens/schedules/useAllFires.ts"}
  - {kind: "file", path: "app/src/screens/schedules/AllHistory.tsx"}
  - {kind: "file", path: "app/src/screens/schedules/last-read.ts"}
  - {kind: "file", path: "app/src/screens/schedules/Subtitle.tsx"}
  - {kind: "file", path: "app/src/screens/schedules/all-fires.test.ts"}
  - {kind: "file", path: "app/src/screens/schedules/AllHistory.test.tsx"}
  - {kind: "symbol", path: "app/src/screens/schedules/index.tsx", name: "Subtitle"}
  - {kind: "symbol", path: "app/src/screens/schedules/model.ts", name: "playbook off: fires are skipped"}
  - {kind: "symbol", path: "app/src/screens/schedules/SchedulesScreen.tsx", name: "Upcoming · Today"}
  - {kind: "symbol", path: "app/src/screens/schedules/AllHistory.tsx", name: "Firing history"}
  - {kind: "symbol", path: "docs/evidence/phase-7-polish/schedules/README.md", name: "schedules-populated"}
requires: []
lanes:
  - "app/src/screens/schedules/**"
  - "app/e2e/schedules.spec.ts"
  - "app/e2e/fixtures/schedules.ts"
  - "app/src/shell/frame.test.tsx"
  - "docs/evidence/phase-7-polish/schedules/**"
external_requires:
  - "Item 11's shell parts on main (PR #192): ScreenDefinition.Subtitle, useKernelReach, withLastKnown, KernelBand, fixture stop()/restart()"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): there's no all-triggers fires route, and the contract is outside Touches. | MEDIUM | Owner chose the app fan-out (`LP-CLARIFY`, 2026-11-01). The merge horizon keeps paging honest. The PR names the one-request-per-trigger cost. |
| The fan-out's merged paging can show a gap or a repeat if the horizon is wrong. | MEDIUM | Pure `all-fires.ts` with unit pins for the horizon, ordering and dedupe (Pin mutations). The e2e pages the fixture's interleaved fires to the end and asserts every fire appears exactly once. |
| Changing the default pane breaks existing unit tests ("populated: … the open trigger's detail", "opens the history of the trigger chosen in the list") and e2e tests that expect a trigger history open on load. | MEDIUM | Update those tests' premises in place, and keep the per-trigger history reachable from the row so their behaviour checks still apply after one click. |
| The mockup has no "playbook off" row or "Later" sub-label (requirement risk). | LOW | Show both inside the `schedules-populated` screenshots, and name the differences in the evidence README and the PR body for the owner (D9). |
| The playbook-off rule in the app could drift from the kernel's gate. | LOW | Mirror `fire-shared.ts` `linkedPlaybook` (by slug) and `status !== "enabled"`, cite them in a comment, and pin with `model.test.ts`. The history line still shows the kernel's own recorded reason code. |
| `SCHEDULES_EVIDENCE=1 npm run e2e` rewrites other screens' PNGs. | LOW | Regenerate with the README's single-spec command only, and commit only `docs/evidence/phase-7-polish/schedules/**`. |
| `app/src/shell/frame.test.tsx`'s expected list is also edited by other screen lanes moving their count lines (Memory, Settings). | MEDIUM | Owner decision 3: on a merge conflict the list becomes the union of the ids. Escalate the conflict and never force-resolve it. |
| `app/e2e/phase-7-exit.spec.ts` (outside Touches) reads this item's fixture and test ids. | MEDIUM | Design constraints in the Task section: `IDS.summary` on the title-bar line, `IDS.table` on the shown history table, trigger 2 without fires, and counts unchanged. Run it in `npm run e2e`, and stop if it can't stay green. In the exit tour, the playbooks fixture's slugs differ from the schedules fixture's, so triggers 1 and 2 show "playbook off". That is the kernel's own rule (a missing slug is not enabled), and the exit markers don't read it. |
| A worker needs a file outside the lanes (for example `app/src/shell/**` or the contract). | LOW | Stop and say so (owner rule). Don't patch it. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-01-schedules-firing-history-and-playbook-off-triggers.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-01T11:22:25Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/200
- **Branch:** feature/schedules-firing-history-and-playbook-off-triggers
- **Files changed:** 34
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unknown (no_driver_handover)
- **Summary:** All-triggers firing history (renderer fan-out over GET /triggers/:id/fires, merged under a paging horizon), Upcoming · Today / Later with two-line clamped titles carrying tooltips, the playbook-off note, the title-bar count line, and last data held per bridge under the shared band; e2e and evidence regenerated. Pre-flight OVERLAP on app/src/shell/frame.test.tsx with open PRs #194/#195/#196 (owner chose proceed-anyway; owner decision 3 governs the merge). Phase 4.5 fixed one MEDIUM (duplicated Row → shared FireRow/FireTable/FilterChips/useLoadOlderFocus) and dismissed four LOW findings. The driver parked at an Execute Manager checkpoint (it could not poll its worker); the run resumed on the legacy path once the worker finished.

## Not verified
- **title-bar Subtitle at narrow window widths** — screenshots only taken at the harness default size (subtask 1)
- **a title long enough to hit the two-line clamp, rendered** — fixture has no long titles; e2e checks computed line-clamp and title attribute, jsdom pins class and attribute (subtask 1)
