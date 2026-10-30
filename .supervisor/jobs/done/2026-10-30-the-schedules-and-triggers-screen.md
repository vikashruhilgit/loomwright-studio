# Supervisor Job: The Schedules & triggers screen (phase 7, item 05)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-30-192357/L3
- **CLAUDE.md:** ✓ Found (fresh — every path in its "Where things are" table exists; `bash scripts/check-docs.sh` enforces it)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (sibling phase 7 screen items 03, 04, 06, 07 and 08 run in parallel lanes and edit the same shared pin file, `kernel/test/gui-foundation.test.ts`; see Risk Assessment)
- **Source requirement:** .supervisor/requirements/phase-7/2026-10-30-140005-the-schedules-and-triggers-screen.md
- **Base commit:** f2fdc984476c914dfa2971eb9f014258e99ac846

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Kernel: strict TypeScript, vitest, better-sqlite3 (`json_extract` is built in). App: React + Electron, vitest/jsdom, Playwright e2e through `app/e2e/electron-harness.ts`. Both dependencies (item 01 contract, item 02 mockup) are merged at the base commit (`83c08ec`, `7302d43`). |
| 2 | Dependency Availability | GO | The contract already declares both routes and their shapes: `app/src/api/contract.ts` `ScheduleEntry`, `ScheduleResponse`, `TriggerFire`, `TriggerFiresResponse` (`next_before` cursor), keyed `"GET /schedule"` and `"GET /triggers/:id/fires"`. The e2e fixture kernel already answers both with empty defaults. The kernel part file `kernel/src/gui/schedules.ts` exists, empty. The owner on/off routes `POST /triggers/:id/on|off` exist (`kernel/src/triggers/routes.ts`). |
| 3 | Architecture Fit | CAUTION | The mockup's history badges name `triggers.last_result` codes (`missed_paused`, `missed_kill_switch`), but the `trigger_missed` events the route reads record `reason: "paused"` / `"kill_switch"` (`kernel/src/triggers/store.ts`, `kernel/src/triggers/poll.ts`). The AC says "its recorded reason", so the screen shows the event's `reason` verbatim and maps known values to a label. The mockup draws wake-up rows in the firing history, but no route serves wake-up history (DESIGN.md open point 10), so history is per trigger only. |
| 4 | Scope vs Supervisor Capability | CAUTION | About 2,500 changed lines across about 14 files (kernel routes and tests about 600; screen, unit tests, e2e, fixture and evidence README about 1,900) plus PNGs. Past `context-bound`. The kernel half and the app half share no file and meet only through the contract that is already merged, so they run as two independent subtasks. |
| 5 | Hard Blockers | GO | No migration is needed (see Risk Assessment for why none is added). No credential or service is needed: every e2e run uses the fixture kernel. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Serve `GET /schedule` and `GET /triggers/:id/fires` from the `gui` feature's `schedules` part, and replace the Schedules placeholder with the real screen built to the GUI v2 mockup (`docs/design/mockups/gui-v2.html`, views `schedules-empty`, `-loading`, `-populated`, `-error`, `-unreachable`): an upcoming timeline, the trigger list with on/off through the existing routes, and each trigger's paged firing history with every missed fire's recorded reason. Commit polish-gate screenshots in light and dark.

**Problem Statement:**
The owner needs to see when the kernel will act next and why something did not run (D4, D9, invariant 2).
Currently `GET /triggers` and `POST /triggers/:id/on|off` exist, but pending wake-ups have no route, and firing history lives only in `events` (`trigger_fired`, `trigger_missed`), which `GET /events` returns unfiltered. The Schedules screen is a "coming in this phase" placeholder.
Success looks like a merged PR whose screen orders upcoming fires by `next_fire_at` / `due_at`, shows each missed fire's reason, keeps working through a kernel outage, updates live, and matches the mockup in both themes.

### Owner decisions (2026-10-30, binding, from the requirement)
- **Hooks is deferred to phase 9.** No Hooks work here.
- **Each screen's kernel routes ride with that screen's item,** in its own feature part, against the contract item 01 declares. This item serves only `GET /schedule` and `GET /triggers/:id/fires`, in `kernel/src/gui/schedules.ts`, with the shapes `app/src/api/contract.ts` already declares. It does not change the contract.
- **One GUI v2 mockup first (D9):** the screen and its polish gate match `gui-v2.html`'s Schedules & triggers views.
- Non-goal: creating or editing a trigger's spec here (Wright drafts it; the playbook screen edits the playbook).
- Assumption: `triggers.next_fire_at` is authoritative for the next fire; the screen computes none.

### Design (binding unless a subtask records why it departs, in the evidence README)

**Kernel routes (subtask 1).** Mechanism only (invariant 1). Owner routes: none sets `unauthenticated`.
- `GET /schedule?limit=` — `limit` default 50, at most 200; a value that is not a whole number from 1 to 200 answers `400 {"error":"invalid_limit"}`. Entries are every **enabled** trigger with a non-null `next_fire_at` (kind `trigger`, `at` = `next_fire_at`, `agent` = `owning_agent`, `playbook` = the playbook's slug or `null`, `action`, `text` = the trigger's `text`, `task_id` = `null`) and every wake-up with `status = 'pending'` (kind `wakeup`, `at` = `due_at`, `text` = `reason`, `task_id`, the rest `null`; `fired` and `superseded` rows never appear). Sorted by `at` ascending, ties by kind (`trigger` first) then id; cut to `limit`. A disabled trigger never appears. Read-only: nothing is written.
- `GET /triggers/:id/fires?before=&limit=` — `400 invalid_id` (same `/^[1-9]\d*$/` check as `kernel/src/triggers/routes.ts`), `404 not_found` when no trigger has that id, `400 invalid_cursor` / `400 invalid_limit` on a bad query. Returns the `trigger_fired` and `trigger_missed` events whose payload `trigger_id` equals `:id`, newest first by event id, only ids below `before` when given; `limit` default 50, at most 200. Each `TriggerFire`: `id` = event id, `kind`, `at` = event `at`, `scheduled_at` = payload `scheduled_at` when a string else `null`, `reason` = payload `reason` when a string on a `trigger_missed` else `null` (verbatim: `paused`, `kill_switch`, `playbook_not_enabled`, `already_done`, `rate_limited`, `connector_missing`, `source_error`, or any other string the kernel records), `session_id` = the event's `session_id` column. `next_before` = the last returned id as a decimal string when the page is full, else `null`. Payload JSON is untrusted: a row whose payload does not parse is skipped, never a throw. SQLite's `json_extract` raises on malformed JSON, so the SQL filter guards it (`CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.trigger_id') END = ?`), or the query filters on `kind` only and the handler parses each payload in a `try`.
- Documented under "Owner control" in `docs/architecture/triggers.md`.

**The screen (subtask 2)**, `app/src/screens/schedules/`, built to the mockup's `schedulesScreen` (gui-v2.html):
- **Layout:** a split. Left: "Upcoming" timeline (entries in the order `GET /schedule` returns them; the screen sorts nothing) with each entry's time, kind icon (once / cron / poll / wake-up), name and spec (a trigger entry's type and spec come from the `triggers` resource row with the same `id`, since `ScheduleEntry` carries only `trigger` / `wakeup`; until that row is loaded, a generic trigger icon and no spec); then "Triggers · N" from `GET /triggers?all=1` (the live store's existing `triggers` resource, `useResource("triggers")`) with a `role="switch"` on/off per trigger. Right: the selected trigger's detail and "Firing history" table (When · Trigger · Result) with "All · N" / "Not fired · N" filter chips and a "Load older" control driven by `next_before`.
- **A trigger's name:** its playbook's name when it has one, else its action's `text` (DESIGN.md open point 10). `text` is untrusted: rendered as text, never HTML.
- **Missed fires:** each `trigger_missed` row shows a label and, beneath it in mono, the recorded `reason` verbatim. Known reasons get a label and badge tone; an unknown reason shows verbatim with a neutral badge. A missed poll whose reason is `connector_missing` links to Integrations (`#/integrations`); the screen holds no action of its own.
- **Repeats (requirement risk):** consecutive rows with the same kind and reason are grouped into one row showing the count and the first and last time; paging continues the group across a "Load older" page.
- **On/off:** `POST /triggers/:id/on` / `off`. A `409 needs_confirmation` (a `once` whose time has passed) opens a Dialog that says it would fire at once; confirming resends with `{"confirm": true}`. Refusals show the kernel's `error` code in the row, never a throw.
- **States:** empty ("Nothing is scheduled." and one action, Ask Wright to schedule something), loading (four skeleton rows), populated, error (a route-failure card naming `schedule request` and its status, distinct from the band), kernel unreachable (the shell's shared `Kernel unreachable` band; the screen keeps its last data, marks it "last known", and disables every control that needs the kernel). No waiting-on-you view (the mockup's comment: nothing here waits on the owner).
- **Live:** the screen watches the live store's `eventLog` (`useLiveStore()`, `app/src/store/react.ts`) and, on a new event whose kind starts `trigger_`, `wakeup_` or `playbook_`, refetches `GET /schedule` and the open trigger's first history page, throttled, keeping the current rows on screen until the answer arrives (no skeleton on refetch, rows keyed by id, fixed row heights: no layout shift). It edits no shared store file (`app/src/store/resources.ts` stays as is).
- **Keyboard and palette:** every action is reachable by keyboard; `J`/`K` move between rows; `Esc` closes the dialog and focus returns to the control that opened it (or a stable row when it is gone). Commands registered under owner `schedules` with ids `schedules.*` while mounted, as `app/src/screens/integrations/commands.ts` does: at least "Show missed fires" (the mockup's palette entry: opens the screen with the "Not fired" filter) and "Refresh schedule"; each disabled while the kernel is unreachable where it needs the kernel.
- **Accessibility:** every switch has `aria-label="<name> trigger is on|off"`, every badge has text, the timeline is a labelled list, the history a captioned table; colours and spacing from the design tokens only, so both themes meet WCAG 2.1 AA.
- **Shell entry:** `id: "schedules"`, `nav: { label: "Schedules", order: 8, shortcut: "⌘8" }` kept (pinned by `app/src/App.test.tsx`); `title` becomes "Schedules & triggers" (the mockup's title; `App.test.tsx` reads `entry.title`). The sidebar label "Schedules" is a recorded departure from the mockup's "Schedules & triggers".

## Acceptance Criteria
- [ ] AC1 — Given a real store holding a `once`, a `cron` and a `poll` trigger (enabled, with `next_fire_at`), a disabled trigger, and wake-ups that are `pending`, `fired` and `superseded`, when `GET /schedule` is called, then it answers 200 with the enabled triggers and the pending wake-ups only, sorted by `at` ascending (ties: trigger before wake-up, then id), each field as the Design section maps it, cut to `limit`; `limit=0`, `limit=201` and `limit=x` answer `400 invalid_limit` (`kernel/test/gui-schedules.test.ts`). And given the e2e fixture kernel answering `GET /schedule` with once, cron and poll trigger entries and pending wake-ups, when the screen opens, then the timeline shows them in that order as the mockup's `schedules-populated` view shows (`app/e2e/schedules.spec.ts`).
- [ ] AC2 — Given a trigger with `trigger_missed` events recorded with reasons `playbook_not_enabled`, `paused`, `kill_switch`, `connector_missing`, `rate_limited` and `source_error` (written through the kernel's own fire paths or `appendEvent`), when `GET /triggers/:id/fires` is called, then each missed fire carries its recorded `reason` verbatim and `scheduled_at`, newest first, and a fired one carries `reason: null`; and on the screen each missed row shows its recorded reason (for example `playbook_not_enabled`) and a `connector_missing` row links to Integrations.
- [ ] AC3 — Given more fires than one page (for example 120 `trigger_missed` events for one poll trigger every two minutes, as the owner's machine logs for a disabled playbook), when the history is paged with `next_before`, then pages do not overlap or skip, the last page's `next_before` is `null`, another trigger's events never appear, a `trigger_missed` row whose `payload_json` is not valid JSON (inserted with raw SQL) is skipped while the route still answers 200, an unknown trigger answers `404 not_found`, and a bad id or cursor answers 400; and on the screen consecutive repeats are grouped into one row with a count, and "Load older" fetches the next page.
- [ ] AC4 — Given a disabled trigger, then the trigger list shows its switch off (`aria-checked="false"`) and it is absent from the upcoming timeline (the kernel test asserts its absence from `GET /schedule`; the screen test asserts the switch). Turning a trigger on or off calls `POST /triggers/:id/on|off`; a `409 needs_confirmation` opens a confirm dialog, and confirming resends `{"confirm": true}`.
- [ ] AC5 — Given the kernel unreachable (the bridge fails while the screen holds data), then the shared band shows, the screen keeps its last data marked "last known" with every kernel-bound control disabled, and nothing throws (a jsdom test in `SchedulesScreen.test.tsx` and an e2e step that closes the fixture kernel).
- [ ] AC6 — Given the keyboard only, then every action on the screen (select a trigger, toggle it, filter the history, load older, open the confirm dialog and leave it with `Esc`, follow the Integrations link) is reachable by Tab/Enter/Space/`J`/`K`/`Esc`, and the ⌘K palette lists the screen's commands (`schedules.*`, at least "Show missed fires") while the screen is mounted and not after it unmounts.
- [ ] AC7 — Given a live event on the feed that changes what the screen shows (the fixture kernel's `appendEvent` of a `trigger_fired`, `trigger_toggled` or `wakeup_scheduled`, with the fixture's routes then answering the new data), then the timeline and the open history update without a reload, and the screen's bounding boxes of the rows already shown do not move (the e2e compares them before and after).
- [ ] AC8 — Given VoiceOver, then every control and status has an accessible name (the e2e checks each switch, chip, button and badge for one with `getByRole`), and both themes meet WCAG 2.1 AA contrast: only design tokens are used for colour, and the evidence README records a contrast check of the screen's text/background token pairs in light and dark.
- [ ] AC9 — The polish gate: a committed evidence file `docs/evidence/phase-7-polish/schedules/README.md` lists one light and one dark screenshot (PNG files in that folder, each a relative link that `bash scripts/check-docs.sh` resolves) of every state the mockup shows for this screen (empty, loading, populated, error, kernel unreachable) plus the history's "Not fired" filter and the confirm dialog, each named against its mockup state (`schedules-empty`, `schedules-loading`, `schedules-populated`, `schedules-error`, `schedules-unreachable`); the exact command that regenerates them (`SCHEDULES_EVIDENCE=1`, as `INTEGRATIONS_EVIDENCE=1` in `app/e2e/integrations.spec.ts`); every departure from the mockup and why (at least: the sidebar label, the reason codes shown verbatim, and no wake-up history). The PR body links to it and may embed the screenshots.
- [ ] AC10 (owner gate, not worker-satisfiable) — The owner's approval of the PR is the polish gate (D9). Supervisor and `/review-pr` never merge it. The evidence is the owner's GitHub approval, not the PR body.
- [ ] AC11 — Validation passes: `cd app && npm ci && npm run typecheck && npm test && npm run build`; `cd app && npx playwright test e2e/schedules.spec.ts`; `cd kernel && npm ci && npm run typecheck && npm test`; `bash scripts/check-docs.sh` prints `check-docs: OK`.

**Evidence rule:** AC8's contrast record and AC9 rest on the committed `docs/evidence/phase-7-polish/schedules/README.md`. FINALIZE lists it in the PR body's `## Evidence` section and may embed screenshots, but the PR body is never their only home.

## File Impact Map

| Path | Action | Lines at base | Confidence | Home / note |
|------|--------|---------------|------------|-------------|
| `kernel/src/gui/schedules.ts` | MODIFY (17) | 17 | HIGH | The item's own part (ARCHITECTURE.md "The gui feature"): both route handlers and their read queries live here (estimated 180–250 lines, below the threshold). Imports `getTrigger` from `../triggers/store.js` for the 404 check; nothing that loads the Agent SDK, the session manager or `kernel.ts`. |
| `kernel/test/gui-schedules.test.ts` | CREATE | — | HIGH | Route tests against a real store (AC1–AC4 kernel side). Separate file per the requirement's Touches. |
| `kernel/test/gui-foundation.test.ts` | MODIFY (51) | 51 | HIGH | The empty-part pin exempts `schedules` and the merged-contribution key check allows `routes` (the file's header says each screen item edits this pin). |
| `docs/architecture/triggers.md` | MODIFY (164) | 164 | HIGH | Document the two routes under "Owner control", beside `GET /triggers`. |
| `app/src/screens/schedules/index.tsx` | MODIFY (17) | 17 | HIGH | Swap the placeholder for the real Component; keep id, nav label, order and shortcut; title "Schedules & triggers". |
| `app/src/screens/schedules/SchedulesScreen.tsx` | CREATE | — | HIGH | The screen component (timeline, trigger list, history, dialog, states). Estimated 450–600 lines; if it passes 500, split the history pane into `History.tsx` in the same directory. |
| `app/src/screens/schedules/model.ts` | CREATE | — | HIGH | Pure logic, no React: reason labels and tones, repeat grouping across pages, trigger display name, the refetch-kind test, test ids table (as `INTEGRATIONS_TEST_IDS`). |
| `app/src/screens/schedules/commands.ts` | CREATE | — | HIGH | Palette commands, modelled on `app/src/screens/integrations/commands.ts`. |
| `app/src/screens/schedules/schedules.css` | CREATE | — | HIGH | Screen styles from tokens only (mockup's `/* Timeline (Schedules) */` block as reference). |
| `app/src/screens/schedules/SchedulesScreen.test.tsx` | CREATE | — | HIGH | jsdom tests: states, unreachable keeps data, toggle and confirm, palette register/unregister, live refetch. |
| `app/src/screens/schedules/model.test.ts` | CREATE | — | HIGH | Unit tests for grouping, labels, names. |
| `app/e2e/schedules.spec.ts` | CREATE | — | HIGH | Playwright e2e, launched only through `app/e2e/electron-harness.ts`; screenshots to the evidence dir only with `SCHEDULES_EVIDENCE=1`, and a last test that fails if a tracked evidence file is newer than the run (as `integrations.spec.ts`). |
| `app/e2e/fixtures/schedules.ts` | CREATE | — | HIGH | The screen's fixture routes and events (the fixture-kernel convention: each screen adds its own `app/e2e/fixtures/<screen>.ts`; `fixture-kernel.ts` is not edited). |
| `docs/evidence/phase-7-polish/schedules/README.md` | CREATE | — | HIGH | Polish-gate evidence (AC8 contrast, AC9), in the form of `docs/evidence/phase-6-polish/integrations/README.md`. |
| `docs/evidence/phase-7-polish/schedules/*.png` | CREATE (~14) | — | MEDIUM | `schedules-<state>-<light\|dark>.png`. Binary outputs no worker reads. |

Reference only, not modified: `app/src/api/contract.ts` (lines 1049–1110, the shapes; 1338–1339, the route keys), `kernel/src/triggers/routes.ts` (the `ID` check and the on/off routes), `kernel/src/triggers/store.ts` (`getTrigger`, `listTriggers`, `TriggerView`, the `trigger_missed` payloads), `kernel/src/triggers/poll.ts` (poll miss payloads), `kernel/src/store/migrations/001_initial.ts` (`events`, `wakeups`), `kernel/src/store/migrations/011_phase_2_tables.ts` (`triggers`), `app/e2e/fixture-kernel.ts` (options, `appendEvent`), `app/e2e/integrations.spec.ts` (evidence capture pattern), `app/src/store/react.ts` (`useLiveStore`, `useResource`), `app/src/screens/sessions/SessionsScreen.tsx` (`api.request` and error copy pattern), `app/src/shell/KernelStates.tsx` (the band), `app/src/components/*` (Badge, Button, Card, Dialog, List, StatusDot, EventCard), `docs/design/mockups/gui-v2.html` (`schedulesScreen`, the `schedules-*` views, line 1452's "Show missed fires"), `docs/evidence/gui-v2-mockup/README.md` (field map rows for Schedules).

Not touched (shared with sibling screen items): `app/src/store/resources.ts`, `app/src/api/contract.ts`, `app/e2e/fixture-kernel.ts`, `app/src/App.tsx`, `app/src/App.test.tsx`, `kernel/test/console-contract.test.ts` (its phase 7 pin checks origins, which this item does not change, so it stays green), `docs/ARCHITECTURE.md`, `docs/UI.md`, `docs/DESIGN.md`.

Validator-owned surfaces: `scripts/check-docs.sh` checks every relative link in `docs/**/*.md`, so the evidence README's PNG links and any link added to `triggers.md` must resolve. Its avatar-hue rules read `app/src/components/Avatar` only; this screen draws no avatar of its own (if it shows one, it uses the `Avatar` component).

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/store/migrations/001_initial.ts:9` | yes | HOLDS | ` * hooks_installed and connectors arrive with their phases, so columns that will` (no `hooks_installed` table exists) | tip 33 minutes ago, fetched <1h |

## Touched-file invariants

> Grounded at base `f2fdc984476c914dfa2971eb9f014258e99ac846`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/gui/schedules.ts`** — keep: the exported names and the part shape, `export const schedulesRoutes: readonly ContributedRoute[] = Object.freeze([` and `export const schedulesPart: GuiPart = Object.freeze({` with `name: "schedules"` (re-exported by `kernel/src/gui/index.ts` as `export { schedulesPart, schedulesRoutes } from "./schedules.js";`); no route sets `unauthenticated` (pinned by `kernel/test/gui-foundation.test.ts` `serves no gui route unauthenticated`); frozen arrays and objects. Keep the import rule in `kernel/src/gui/types.ts`: "nothing here may pull in the Agent SDK, the session manager or `kernel.ts`" (`kernel/test/feature-seams.test.ts` throws `SDK_IN_GRAPH` on any path to `@anthropic-ai/claude-agent-sdk`). reuse: the id check `const ID = /^[1-9]\d*$/;` and the `{ status, body: { error } }` refusal shape of `kernel/src/triggers/routes.ts`; `getTrigger` from `kernel/src/triggers/store.ts`. mirror: `app/src/api/contract.ts` `export interface ScheduleEntry`, `export interface TriggerFire` and `export interface TriggerFiresResponse` (field names, nullability, `next_before`), and the payload keys the kernel writes in `kernel/src/triggers/store.ts` (`trigger_id: id, reason: "playbook_not_enabled"`, `reason: killSwitch ? "kill_switch" : "paused"`) and `kernel/src/triggers/poll.ts` (`return missed("connector_missing", { reason: "connector_missing"`). pinned by: `kernel/test/gui-foundation.test.ts` and the new `kernel/test/gui-schedules.test.ts`.
- **`kernel/test/gui-foundation.test.ts`** — keep: every other part stays pinned empty (`it("holds every part empty: no tools, routes, subcommands, handlers or due work (until each screen item fills its part)"` keeps its assertions for the five other parts), `const PART_NAMES = ["tasks", "playbook-history", "schedules", "memory", "budget-audit", "settings"];` and the tenth-and-last registry pin unchanged. Change only what `schedules` now fills: a `FILLED` set naming `schedules` that the empty loop skips, and replace `expect(Object.keys(guiContribution)).toEqual(["name"]);` with a key check computed from the filled parts (`name` plus `routes` while any filled part has routes; `expect(guiContribution.routes ?? []).toEqual(routes);` already pins the merge), so sibling items extend the set rather than rewrite the line.
- **`app/src/screens/schedules/index.tsx`** — keep: `id: "schedules"`, `nav: { label: "Schedules", order: 8, shortcut: "⌘8" }` and `export const screen: ScreenDefinition = {` (the shell discovers it through `import.meta.glob`; pinned by `app/src/App.test.tsx` `"Schedules⌘8"` and `["screens.schedules", "Screens", "⌘8"]`, and by its `screen-${id}` test-id check, so the screen's root keeps `data-testid="screen-schedules"`). `title` may change: `App.test.tsx` reads `entry?.title` and asserts it on the one level-1 heading (`getByRole("heading", { level: 1 })`), which the shell renders (`<h1 className="titlebar-title">{current.title}</h1>` in `app/src/App.tsx`), so the screen renders no `h1` of its own (its section headings are `h2` or lower). Leave `app/src/screens/placeholder.tsx` in place (its header: "A screen item replaces its `index.tsx` Component and leaves this file").

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/gui-schedules.test.ts` — schedule sorted by `at` | remove the `ORDER BY` / sort step from the `GET /schedule` handler in `kernel/src/gui/schedules.ts` |
| `kernel/test/gui-schedules.test.ts` — a disabled trigger is absent | drop the `enabled = 1` condition from the schedule's trigger query in `kernel/src/gui/schedules.ts` |
| `kernel/test/gui-schedules.test.ts` — only pending wake-ups | drop the `status = 'pending'` condition from the wake-up query in `kernel/src/gui/schedules.ts` |
| `kernel/test/gui-schedules.test.ts` — missed reason verbatim | return `null` for `reason` on every row in the fires mapper in `kernel/src/gui/schedules.ts` |
| `kernel/test/gui-schedules.test.ts` — paging does not overlap or skip | change `id < ?` to `id <= ?` in the fires query in `kernel/src/gui/schedules.ts` |
| `kernel/test/gui-schedules.test.ts` — a malformed payload row is skipped, the route answers 200 | remove the `json_valid` guard (or the `try` around the payload parse) in the fires query in `kernel/src/gui/schedules.ts` |
| `kernel/test/gui-schedules.test.ts` — another trigger's events never appear | drop the `trigger_id` filter from the fires query in `kernel/src/gui/schedules.ts` |
| `kernel/test/gui-schedules.test.ts` — `limit=0`, `limit=201`, `limit=x` answer `400 invalid_limit` | accept any number in the limit check (drop the 1–200 range test) in `kernel/src/gui/schedules.ts` |
| `kernel/test/gui-schedules.test.ts` — a bad id answers `400 invalid_id` | skip the `ID` regex check in the fires handler in `kernel/src/gui/schedules.ts` |
| `kernel/test/gui-schedules.test.ts` — a bad cursor answers `400 invalid_cursor` | treat an unparseable `before` as absent in the fires handler in `kernel/src/gui/schedules.ts` |
| `kernel/test/gui-schedules.test.ts` — an unknown trigger answers `404 not_found` | delete the `getTrigger` existence check in the fires handler in `kernel/src/gui/schedules.ts` |
| `kernel/test/gui-schedules.test.ts` — `next_before` is `null` on the last page | always return the last row's id as `next_before` in `kernel/src/gui/schedules.ts` |
| `app/src/screens/schedules/SchedulesScreen.test.tsx` — `409 needs_confirmation` opens the dialog, confirming resends `{"confirm": true}` | resend the toggle without `confirm: true` after the dialog's confirm in `SchedulesScreen.tsx` |
| `app/src/screens/schedules/SchedulesScreen.test.tsx` — a `trigger_`/`wakeup_`/`playbook_` event refetches the schedule | make the refetch-kind test in `app/src/screens/schedules/model.ts` return `false` |
| `app/e2e/schedules.spec.ts` — rows already shown keep their bounding boxes on a live update (AC7) | show the loading skeleton on every refetch instead of keeping the current rows in `SchedulesScreen.tsx` |
| `app/src/screens/schedules/SchedulesScreen.test.tsx` — untrusted text is shown literally | render a trigger's `text` with `dangerouslySetInnerHTML` in `SchedulesScreen.tsx` |
| `kernel/test/gui-foundation.test.ts` — the other five parts stay empty | add a stub route to `kernel/src/gui/memory.ts`'s `memoryRoutes` (must turn the empty pin red) |
| `app/src/screens/schedules/model.test.ts` — repeats grouped | make the grouping function return its input rows unchanged in `app/src/screens/schedules/model.ts` |
| `app/src/screens/schedules/SchedulesScreen.test.tsx` — unreachable keeps last data | clear the held data when the connection is not live in `SchedulesScreen.tsx` |
| `app/src/screens/schedules/SchedulesScreen.test.tsx` — commands unregister on unmount | delete the unregister call in the commands effect's cleanup in `SchedulesScreen.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: `GET /schedule` and `GET /triggers/:id/fires` in the schedules part | AC1, AC2, AC3, AC4 (kernel side), AC11 (kernel, check-docs) | 3 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | App: the Schedules & triggers screen, e2e and polish-gate evidence | AC1, AC2, AC3, AC4 (screen side), AC5, AC6, AC7, AC8, AC9, AC11 (app, e2e, check-docs) | 1 modify, 10 create (+PNG outputs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

Subtask 2 never calls the real kernel: the screen talks to the contract shapes, the jsdom tests use the fake bridge, and the e2e uses the fixture kernel with `app/e2e/fixtures/schedules.ts`. So it does not wait for subtask 1. Both read the same contract (`app/src/api/contract.ts` at the base commit) and neither edits it. If either finds the contract shape cannot serve an AC, it stops and reports that rather than editing the contract (a shared file sibling items read).

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/gui/schedules.ts", name: "schedulesRoutes"}
  - {kind: "symbol", path: "kernel/src/gui/schedules.ts", name: "schedulesPart"}
  - {kind: "file", path: "kernel/test/gui-schedules.test.ts"}
  - {kind: "symbol", path: "docs/architecture/triggers.md", name: "GET /schedule"}
requires: []
lanes:
  - "kernel/src/gui/schedules.ts"
  - "kernel/test/gui-schedules.test.ts"
  - "kernel/test/gui-foundation.test.ts"
  - "docs/architecture/triggers.md"
external_requires:
  - "Node.js and npm (cd kernel && npm ci)"

# Subtask 2
provides:
  - {kind: "file", path: "app/src/screens/schedules/SchedulesScreen.tsx"}
  - {kind: "file", path: "app/src/screens/schedules/model.ts"}
  - {kind: "file", path: "app/src/screens/schedules/commands.ts"}
  - {kind: "file", path: "app/e2e/schedules.spec.ts"}
  - {kind: "file", path: "app/e2e/fixtures/schedules.ts"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/schedules/README.md"}
  - {kind: "symbol", path: "app/src/screens/schedules/index.tsx", name: "Schedules & triggers"}
requires: []
lanes:
  - "app/src/screens/schedules/**"
  - "app/e2e/schedules.spec.ts"
  - "app/e2e/fixtures/schedules.ts"
  - "docs/evidence/phase-7-polish/schedules/**"
external_requires:
  - "Node.js and npm (cd app && npm ci); Electron and Playwright as app devDependencies; `npm run build` before the e2e"
  - "macOS for the committed screenshots (fonts differ on Linux CI; the spec checks behaviour, never pixels)"
```

## Parallelism Analysis

Two independent subtasks, no file overlap, no `requires` edge: both LAUNCHABLE.

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| 1 (kernel) | 2 (app) | none | NO |

### Batch Plan
- **Batch 1:** subtasks 1 and 2
- **Recommended workers:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` (vitest against a real store), `skills/error-handling/SKILL.md` (400/404 refusals, untrusted payload JSON never throws) |
| 2 | `skills/frontend-ui/SKILL.md` (design-system reuse, WCAG 2.1 AA, keyboard reachability, focus return), `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Source | Mitigation |
|------|--------|--------|------------|
| Size: about 2,500 lines across about 14 files is past one worker's context | HIGH | Feasibility (Phase 2.5) | Two subtasks split at the contract boundary, which is already merged; neither edits the other's files. |
| Reason vocabulary: the mockup and DESIGN.md name `missed_paused` / `missed_kill_switch` (the `triggers.last_result` codes), but `trigger_missed` events record `paused` / `kill_switch` | MEDIUM | Feasibility (Phase 2.5) | The route passes the event's `reason` verbatim; the screen labels known values and shows the code beneath. The evidence README records the departure. No kernel write path changes. |
| The mockup draws wake-up rows in the firing history, but no route serves wake-up history (DESIGN.md open point 10) | MEDIUM | Feasibility (Phase 2.5) | History is per trigger. Wake-ups appear only in the upcoming timeline. Recorded as a departure in the evidence README. |
| A busy poll trigger floods history (a `trigger_missed` every two minutes for a disabled playbook) (requirement Risk) | MEDIUM | Analysis | Keyset paging on event id (`id < before`, newest first, bounded `limit`) and grouping of consecutive repeats on the screen; AC3 tests 120 events. |
| `GET /triggers/:id/fires` filters `events` by `kind` and `json_extract(payload_json, '$.trigger_id')` with no index, so a rare trigger's page scans the whole table | LOW | Analysis | Accepted for phase 7: the scan walks the rowid index newest first and stops at `limit` matches. No migration is added, because sibling items in parallel lanes would collide on the next migration number; an expression index is a later item if the owner's store shows it slow. Recorded in `docs/architecture/triggers.md`. |
| Parallel sibling lanes (items 03, 04, 06, 07, 08) each edit `kernel/test/gui-foundation.test.ts`'s empty-part pin | MEDIUM | Analysis | Write the exemption so siblings extend it on their own lines: a `const FILLED: ReadonlySet<string> = new Set(["schedules"]);` the empty loop skips, and a merged-key check computed from the filled parts rather than a literal list. A textual conflict with a sibling is still possible and is resolved at merge (each side adds its part name). |
| Sibling items add their own shared files (store resources, contract) and this item's screen relies on them unchanged | LOW | Analysis | This item edits no shared app file: it reads the live store's existing `triggers` resource and `eventLog`, and calls its two routes with `api.request`. |
| Layout shift on a live update (AC7) | MEDIUM | Analysis | Keep rows on screen while refetching, key rows by id, fixed row heights; the e2e compares bounding boxes before and after. |
| Turning a past `once` trigger on fires it at once (`409 needs_confirmation`) | MEDIUM | Analysis | The screen asks first and resends `{"confirm": true}` only after the owner confirms (AC4). |
| Untrusted text (trigger `text`, wake-up `reason`, playbook names) rendered as HTML | MEDIUM | Analysis | Render as React text only; a jsdom test feeds markup and asserts it is shown literally. |
| Merging without the owner's approval (D9 polish gate) | HIGH | Analysis | AC10 is an owner gate. Never auto-merge; leave the PR for the owner. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 1
- **Base Branch:** main
- **Split reason:** context-bound
- **Threshold note:** about 2,500 changed lines across about 14 files (past both `context-bound` bounds). The split falls on the contract boundary, which also gives two groups with no file overlap (4 and 10 files), so they run in parallel.

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-30-the-schedules-and-triggers-screen.md
```

## Plan Review: PASS (attempt 3/3)

| # | Severity | Section | Description | Resolution |
|---|----------|---------|-------------|------------|
| 1 | MEDIUM | Task / Design + AC3 | `json_extract` on untrusted `payload_json` raises on malformed JSON, contradicting "never a throw" (attempt 1) | fixed: `json_valid` guard or try-parse, AC3 raw-SQL malformed row, pin row |
| 2 | LOW | Touched-file invariants | Screen must render no `h1` (App.test.tsx single-h1 pin) (attempt 1) | fixed |
| 3 | LOW | Design (Layout) | Timeline icon/spec come from the `triggers` resource, not `ScheduleEntry` (attempt 1) | fixed |
| 4 | LOW | Risk Assessment | gui-foundation sibling edits conflict on the same lines (attempt 1) | fixed: `FILLED` set, computed key check |
| 5 | MEDIUM | Pin mutations | Rows missing for the 400/404 refusals, `next_before` null, confirm resend, live refetch, layout shift, literal text (attempt 2) | fixed: rows added |
| 6 | MEDIUM | Pin mutations | Rows still missing for the rewritten gui-foundation merged-key check, the `connector_missing` → Integrations link, `Esc` focus return on the confirm dialog, and the e2e evidence-staleness test (attempt 3) | deferred (no review attempt left): workers add a mutation row's equivalent check for each when they write the pin |
| 7 | LOW | File Impact Map | `kernel/test/gui-foundation.test.ts` line count recorded as 51; the reviewer read 54 | deferred (cosmetic, far below the threshold) |

## Outcome
- **Status:** completed
- **Completed:** 2026-10-30T15:13:24Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/181
- **Branch:** feature/the-schedules-and-triggers-screen
- **Files changed:** 34
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unknown (no_driver_handover)
- **Summary:** Kernel GET /schedule and GET /triggers/:id/fires in the gui schedules part, plus the Schedules & triggers screen with e2e and 14 light/dark polish-gate screenshots. Integrated validation is green: kernel 3014 tests, app 1627 tests, build, 14 e2e, check-docs. Phase 4.5 ran 3 reviews and 2 fix rounds: Load older / Try again focus handoff, a shared Skeleton, and negative-branch focus tests. Risk is classified high (size, auth/token content matches) and is advisory only. FINALIZE ran on the legacy --continue path because the driver parked at execute-stop after the Execute Manager checkpointed while its workers were still running. The until-mergeable drain was not dispatched: .supervisor/config.json has auto_review:false and no dispatch marker exists. AC10 (owner approval) is pending.
