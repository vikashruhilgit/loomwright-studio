# Supervisor Job: The Budget & audit screen (phase 7, item 07)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-30-192357/L5
- **CLAUDE.md:** ✓ Found (fresh — every path in its "Where things are" table exists; `bash scripts/check-docs.sh` enforces it)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (sibling phase 7 items 06 Memory and 08 Settings run in parallel lanes L4 and L6 and may add their own query-parsing copy in `kernel/src/gui/`; see Risk Assessment)
- **Source requirement:** .supervisor/requirements/phase-7/2026-10-30-140007-the-budget-and-audit-screen.md
- **Base commit:** 78fb740251cbbba04ccf6b596b3484807faffe26

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Kernel: strict TypeScript, vitest, better-sqlite3 (`json_valid` / `json_extract` built in). App: React + Electron, vitest/jsdom, Playwright e2e through `app/e2e/electron-harness.ts`. Both dependencies (item 01 contract, item 02 mockup) are merged at the base commit. |
| 2 | Dependency Availability | GO | The contract already declares both routes and their shapes: `app/src/api/contract.ts` `BudgetUsageQuery`, `BudgetUsageRow`, `BudgetLimitUsage`, `BudgetCapState`, `BudgetUsageResponse`, `AuditQuery`, `AuditResponse` (lines 1185–1250), keyed `"GET /budget/usage"` and `"GET /audit"` (lines 1343–1344). The fixture kernel already answers both with empty defaults (`app/e2e/fixture-kernel.ts:158-159`). The part file `kernel/src/gui/budget-audit.ts` exists, empty. D26 counting already lives in the store: `budget.counted_tokens` is a generated column (`input + output + cache_write`, `kernel/src/store/migrations/001_initial.ts`). Agent limits and sessions running: `rosterOf` (`kernel/src/agents/roster.ts`, SDK-free, the CLI loads it). Playbook limits: `playbookTokenLimit` / `playbookKey` (`kernel/src/budget/internal.ts`). Event frames: `eventFrameOf` (`kernel/src/console/events.ts`). Instants: `normalizeInstant` (`kernel/src/loop/internal.ts`). |
| 3 | Architecture Fit | CAUTION | (a) `budget.playbook` stores the playbook's **id as text** (`playbookKey(id)`; `playbookTokensToday` joins `b.playbook = CAST(p.id AS TEXT)`), but the contract's `BudgetUsageRow.playbook` and `BudgetLimitUsage.id` are slugs, so the route joins `playbooks`. (b) `events` has no agent or playbook column (`actor` is `'kernel'` for kernel writers and `'api'` for the API's own, e.g. `kernel/src/api/kill-switch.ts` and `stop_all_completed` in `kernel/src/api/server.ts`; `EventFrame` carries no `actor`), so the audit's agent and playbook filters match through the event's session (`sessions.agent`, `sessions.playbook`) or the payload's own `agent` / `playbook` keys. (c) `GET /status` labels `cap_state.account` from the auth providers (`readStatus` in `kernel/src/api/server.ts`), which a contributed route request does not carry. (d) Cap `utilization`'s scale is unverified (`docs/OPEN_QUESTIONS.md` Q6 saw `unifiedWindows` as 0–1 fractions; the top-level field is stored "as sent"). (e) The mockup shows a total ("8 of 20 events", "page 1 of 3"); keyset paging has no total. Each is resolved in the Design section. |
| 4 | Scope vs Supervisor Capability | CAUTION | About 2,600 changed lines across about 20 files (kernel routes, shared query helper and tests about 750; screen, unit tests, e2e, fixture and evidence README about 1,850) plus PNGs. Past `context-bound`. The kernel half and the app half share no file and meet only through the contract, which is already merged, so they run as two independent subtasks, as items 03–05 did. |
| 5 | Hard Blockers | GO | No migration: the routes read existing tables. No credential or service: every e2e run uses the fixture kernel. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Serve `GET /budget/usage` and `GET /audit` from the `gui` feature's `budget-audit` part, and replace the Budget & audit placeholder with the real screen built to the GUI v2 mockup (`docs/design/mockups/gui-v2.html`, `budgetScreen` / `auditScreen`, views `budget-empty`, `-loading`, `-populated`, `-waiting`, `-error`, `-unreachable`, `budget-audit`, `budget-audit-filtered`): tokens per day, per agent and per playbook against each limit (in tokens and sessions at once), the subscription cap with its reset time, and the full event log with filters, paged. Commit polish-gate screenshots in light and dark.

**Problem Statement:**
The owner needs to see where tokens went and audit everything the kernel did (D24, D26, D28, invariant 2).
Currently the `budget` table records tokens per session, agent, playbook and model per day (and a `cost_usd` estimate), and `cap_state` holds the subscription windows, read by `GET /status`. No route aggregates usage, and `GET /events` takes only `after` and `limit`. The Budget & audit screen is a "coming in this phase" placeholder.
Success looks like a merged PR whose screen shows totals that match the `budget` rows under D26, an agent at its limit in tokens, the cap state with its reset, a filtered and paged audit log, keeps working through a kernel outage, updates live, and matches the mockup in both themes.

### Owner decisions (2026-10-30, binding, from the requirement)
- **Hooks is deferred to phase 9.** No Hooks work here.
- **Each screen's kernel routes ride with that screen's item,** in its own feature part, against the contract item 01 declares. This item serves only `GET /budget/usage` and `GET /audit`, in `kernel/src/gui/budget-audit.ts`, with the shapes `app/src/api/contract.ts` already declares. It does not change the contract.
- **One GUI v2 mockup first (D9):** the screen and its polish gate match `gui-v2.html`'s Budget & audit views.
- Non-goals: setting limits here (Team sets an agent's, the playbook screen a playbook's); exporting the log.
- Assumption: D26's counting is the meter's own; the route reuses it (`budget.counted_tokens`, the generated column) rather than re-deriving it.
- Risk (requirement): a chart that implies a dollar budget. Every chart and meter is in tokens.

### Design (binding unless a subtask records why it departs, in the evidence README or `docs/architecture/budget.md`)

**Kernel routes (subtask 1).** Mechanism only (invariant 1). Read-only: neither route writes. No route sets `unauthenticated`. The part imports only SDK-free modules: `../agents/roster.js`, `../budget/internal.js`, `../console/events.js`, `../loop/internal.js`, `../features/contribution.js` (types), `./query.js`, `./types.js` — never `../api/server.js`, the Agent SDK, the session manager or `kernel.ts`.

- **Shared query parsing (extract).** Three gui parts already copy the "positive whole number" check (`limitOf` in `kernel/src/gui/schedules.ts`, `positiveInteger` in `kernel/src/gui/tasks.ts`, `positiveInt(raw, pattern)` in `kernel/src/gui/playbook-history.ts`). Create `kernel/src/gui/query.ts` exporting `positiveIntegerOf(raw: string): number | undefined` (`/^[1-9]\d*$/` and `Number.isSafeInteger`, exactly tasks.ts's body) and `limitOf(raw: string | undefined, fallback: number, max: number): number | undefined` (absent ⇒ `fallback`; else `positiveIntegerOf(raw)` when `<= max`, else `undefined`; exactly schedules.ts's semantics with its constants passed in). `tasks.ts` and `schedules.ts` import them in place of their local copies, with no behaviour change (their existing tests stay green unedited). `playbook-history.ts` keeps its `positiveInt(raw, pattern)`: it takes caller-specific digit-count patterns, so it is not the same helper; this is recorded in `query.ts`'s header.
- **`GET /budget/usage?days=`** — `days` default 7, a whole number 1–90 (`limitOf(days, 7, 90)`); anything else answers `400 {"error":"invalid_days"}`. "Today" is `localDay(req.now())` (the host's local day, as `rosterOf` and the meter use); the window is today and the `days - 1` local days before it (computed in JS as `YYYY-MM-DD` strings, compared as text with `budget.day`).
  - `rows`: `SELECT b.day, b.agent, coalesce(p.slug, b.playbook) AS playbook, SUM(b.counted_tokens), SUM(b.cache_read_tokens), SUM(b.cost_usd) FROM budget b LEFT JOIN playbooks p ON b.playbook = CAST(p.id AS TEXT) WHERE b.day >= ? AND b.day <= ? GROUP BY b.day, b.agent, b.playbook ORDER BY b.day DESC, b.agent, playbook` (agent / playbook `NULL`s sort first). `cost_estimate_usd` is `SUM(cost_usd)`, which SQLite returns `NULL` when every row's `cost_usd` is `NULL`. A `budget.playbook` that names no existing playbook keeps its stored text (so the day totals still equal the `budget` rows; documented). Days with no usage have no row (the screen draws them as 0).
  - `limits`: one `scope: "agent"` entry per `rosterOf(req.store, req.now())` entry (Wright first, then members in id order) with `id`, `tokens_today`, `tokens_per_day`, `sessions_running`, `sessions_at_once` taken from the roster entry as is; then one `scope: "playbook"` entry per row of `playbooks` (id order) with `id` = slug, `tokens_today` = `playbookCountedTokens(req.store, id, localDay(req.now()))` (`kernel/src/budget/internal.ts`, the meter's own query), `tokens_per_day` = `playbookTokenLimit(token_limit_per_day) ?? null` (a damaged stored value reads `null`, never a throw), `sessions_running` = sessions with that `playbook` in `starting` / `running`, `sessions_at_once: null`.
  - `cap_state`: the same rows and grouping `readStatus` builds (`SELECT account, rate_limit_type, status, resets_at, utilization, reset_source FROM cap_state ORDER BY account, rate_limit_type`, grouped by `account`, which holds the provider id since migration 9), each entry `{ account: <provider id>, provider: <provider id>, limits }`. A contributed route has no auth-provider list, so `account` carries the provider id; the screen shows the label from the live store's `status` resource entry with the same `provider` when it has one (Design: screen). `server.ts` (914 lines) is not edited; the one SELECT is the only shared text, and it is recorded in `budget-audit.ts`'s header.
  - Documented in `docs/architecture/budget.md` under a new "## Reading usage" section (the routes, the slug join, the unknown-playbook rule, `account` = provider id).
- **`GET /audit?kind=&agent=&playbook=&since=&until=&before=&limit=`** — every filter optional and combined with AND. Newest first by event id. `limit` default 50, at most 200 (`limitOf(limit, 50, 200)`, else `400 invalid_limit`); `before` an event id (`positiveIntegerOf`, else `400 invalid_cursor`), only ids below it; `since` / `until` inclusive ISO-8601 instants through `normalizeInstant` (else `400 invalid_since` / `400 invalid_until`; `since` after `until` ⇒ `400 invalid_range`), compared as text with `events.at` (both `%Y-%m-%dT%H:%M:%fZ`).
  - `kind`: exact match on `events.kind` (any string; no closed list: `events.kind` is free text).
  - `agent`: matches when the event's session has that agent (`s.agent = ?` through `LEFT JOIN sessions s ON s.id = e.session_id`) **or** the payload's `agent` key equals it (`CASE WHEN json_valid(e.payload_json) THEN json_extract(e.payload_json, '$.agent') END = ?`).
  - `playbook` (a slug): resolved to its id through `playbooks`; an unknown slug answers `200 {"events": [], "next_before": null}`. Matches when `s.playbook = <id>` **or** the payload's `playbook` key is the id (number) or the slug (`CASE WHEN json_valid(...) THEN json_extract(..., '$.playbook') END IN (<id>, <slug>)`).
  - Payload JSON is untrusted: the `json_valid` guard keeps a malformed row from raising (it matches no payload condition but still matches `kind` / time filters), and each row becomes `eventFrameOf(row)`, which passes unparseable text through as a string. Never a throw.
  - `next_before` = the last returned id as a decimal string when the page is full, else `null`.
  - Documented in `docs/architecture/budget.md`'s "## Reading usage" (the filter semantics, the session-or-payload match).

**The screen (subtask 2)**, `app/src/screens/budget/`, built to the mockup's `budgetScreen` and `auditScreen` (gui-v2.html lines 1185–1238) and the field map `docs/evidence/gui-v2-mockup/README.md` §"Budget & audit":
- **Overview layout:** content plus an inspector. Content: "Tokens counted per day" table (Day · Counted tokens with a meter relative to the busiest day · Cache reads (not counted)), one row per day of the window, today first, days without rows shown as 0; "By agent · today" (Agent with its `Avatar` and display name from the `agents` resource · Tokens against its daily limit · Sessions at once); "By playbook · today" (name and owning agent from the `playbooks` resource, "· off" when not enabled · Tokens against its daily limit); "Latest in the audit log" (the three newest events from `GET /audit?limit=3`, as `EventCard`s or the mockup's `evc` cards) with "Open the full log". Inspector: "Subscription cap" (account label, each window's `rate_limit_type` in mono, a status Badge — `allowed` ok, `allowed_warning` attention "warning", `rejected` danger "rejected", anything else neutral verbatim — a meter of `utilization` and "N% used · resets <local time>"; `reset_source: "recheck"` reads "reset unknown · rechecked <time>"; `resets_at: null` reads "no reset time"; `utilization: null` draws no meter and reads "usage not reported") and "Today" (today's counted tokens, `formatEstimate(sum of today's cost_estimate_usd)` from `app/src/components/formatEstimate.ts`, which prints "≈$x at API rates", omitted when every row's estimate is `null`, and the note that cache reads are shown, never counted).
- **Limit cells:** `tokens_per_day: null` ⇒ the number and "no limit set"; else "N of L" with a meter (`role="img"`, `aria-label="P percent of the daily token limit"`), and at or past the limit an "at limit" Badge (attention) and a full meter. Sessions at once: "N live of L" or "N live · no limit set". Every figure is tokens or sessions; no dollar figure appears in a chart, meter or limit cell.
- **Utilization scale:** treated as a 0–1 fraction (as `unifiedWindows` was observed, Q6), shown as `round(u × 100)`%, clamped 0–100. The evidence README records this as unverified for the top-level field.
- **Audit log view** (a sub-view of the screen with the mockup's crumb "Budget & audit / Audit log" and a Back button; the shell's `h1` stays the screen title): filter bar (`role="group"`, `aria-label="Filter the audit log"`) with Kind (kinds seen in the loaded pages plus the one filtered on), Agent (from the `agents` resource), Playbook (from the `playbooks` resource, by slug), Time range (Last 7 days / Last 24 hours / Last hour, sent as `since` = now minus the range; no `until`), and "Clear filters" (disabled when no filter is on, the default range included as "off"). A table (Id · When · Kind · Actor · Detail) captioned "Audit log, newest first". Actor: the payload's `agent` string when present, else "—" (neutral: `EventFrame` carries no `actor`, and the stored actor may be `'kernel'` or `'api'`, so the screen never guesses; a recorded departure naming the `'api'` writers). Detail: a one-line summary of the payload (its `text` / `reason` / `message` string when present, else compact JSON, truncated) plus "task N · session N · playbook <slug>" refs (the playbook ref when the payload's `playbook` is a slug or an id the `playbooks` resource resolves to a slug). A "filtered" Badge while a filter is on. Paging: 8 rows a page as the mockup (`limit=8`), "Older" sends `before = next_before` and is disabled when `next_before` is `null`; "Newer" pops a local cursor stack and is disabled on the first page. The footer reads "Showing rows a–b · page N · newest first" (no total: keyset paging; a recorded departure from "8 of 20 events"). No match: "No events match." with Clear filters. The append-only note under the table. Every payload string is untrusted: rendered as React text, never HTML.
- **States:** empty (no `rows` and every limit's `tokens_today` 0: "No tokens used yet." with the mockup's copy naming limits in tokens and sessions at once, never dollars, and one action, Ask Wright), loading (four skeleton rows), populated, waiting on you (any agent `scope: "agent"` limit with `tokens_today >= tokens_per_day`: an attention band per the mockup — "N agent waits on you: <name> used X of its L tokens today, so its new sessions wait until midnight. Raise its limit in Team to continue." with an "Open Team" button to `#/team` — and that row marked), error (a route-failure card naming `usage request` and its status, distinct from the band; an audit failure names `audit request`), kernel unreachable (the shell's shared `Kernel unreachable` band; the screen keeps its last data, marks it "last known", and disables "Audit log", "Open the full log", the filters and paging).
- **Live:** the screen watches the live store's `eventLog` (`useLiveStore()`, `app/src/store/react.ts`) and on any new event refetches `GET /budget/usage` and, on the overview, the latest three audit events, or, in the audit view on its first page, that page; throttled to once per 2 s, keeping the current rows on screen until the answer arrives (no skeleton on refetch, rows keyed by `day` / `id` / event id, fixed row heights: no layout shift). An audit view on an older page does not move. It edits no shared store file (`app/src/store/resources.ts` stays as is).
- **Keyboard and palette:** every action is reachable by keyboard; `J`/`K` move between rows; `Esc` in the audit view returns to the overview and focus returns to the control that opened it. Commands registered under owner `budget` with ids `budget.*` while mounted, as `app/src/screens/schedules/commands.ts` does, the mockup's three: "Open the audit log", "Show refused starts in the audit log" (the audit view with `kind=admission_refused`) and "Clear audit filters" (enabled only while a filter is on); the first two disabled while the kernel is unreachable.
- **Accessibility:** every meter has a `role="img"` and an `aria-label`, every badge has text, each table a caption, every select a `<label>`; colours and spacing from the design tokens only, so both themes meet WCAG 2.1 AA (a `contrast.test.ts` over the screen's token pairs, as `app/src/screens/schedules/contrast.test.ts`).
- **Shell entry:** `id: "budget"`, `title: "Budget & audit"`, `nav: { label: "Budget & audit", order: 10 }` kept, no shortcut (the mockup: "Budget & audit by the palette only"; pinned by `app/src/App.test.tsx` `["screens.budget", "Screens", undefined]`). The screen renders no `h1` (the shell's titlebar is the one level-1 heading); section headings are `h2`/`h3`.

## Acceptance Criteria
- [ ] AC1 — Given a real store holding `budget` rows across three days, two agents (one Wright) and two playbooks plus rows outside any playbook, with input, output, cache-write and cache-read tokens, some `cost_usd` values and some `NULL`, and one row whose `playbook` names no playbook, when `GET /budget/usage?days=3` is called, then it answers 200 and, for each (day, agent, playbook), `counted_tokens` equals the sum of that group's `input + output + cache_write` tokens, `cache_read_tokens` the sum of its cache reads (never added to `counted_tokens`), `cost_estimate_usd` the sum of its `cost_usd` (`null` when all are `NULL`), `playbook` is the slug (the stored text for the unknown one), and a row older than the window is absent; `days=0`, `days=91` and `days=x` answer `400 invalid_days` (`kernel/test/gui-budget-audit.test.ts`).
- [ ] AC2 — Given an agent whose settings file sets `limits.tokens_per_day` and whose counted tokens today equal it, when `GET /budget/usage` is called, then its `limits` entry has `tokens_today === tokens_per_day` (kernel test); and on the screen (fixture kernel) its row shows "N of N" tokens with an "at limit" Badge and a full meter, the waiting-on-you band names it, and the only dollar figure on the screen is the "Today" estimate, which reads "≈$… at API rates" (`app/e2e/budget.spec.ts` and `BudgetScreen.test.tsx`: no text matching `/\$/` outside an element whose text contains "at API rates").
- [ ] AC3 — Given `cap_state` rows for one provider (`five_hour` `allowed` with `resets_at` and `utilization`, `seven_day` `allowed_warning`), when `GET /budget/usage` is called, then `cap_state` carries them grouped by provider with `status`, `resets_at`, `utilization` and `reset_source` as stored (kernel test); and on the screen each window shows its type, its status Badge and "N% used · resets <time>" as the mockup's `budget-populated` inspector shows; a `rejected` window shows the danger Badge, and `reset_source: "recheck"` shows "reset unknown".
- [ ] AC4 — Given events of several kinds across two agents, two playbooks and a week (written with `appendEvent` and raw SQL, some linked by `session_id` to sessions with an agent and a playbook, some naming `agent` / `playbook` only in the payload, one with a `payload_json` that is not valid JSON), when `GET /audit` is called with each filter alone and combined, then it answers only matching events, newest first; paging with `next_before` neither overlaps nor skips and the last page's `next_before` is `null`; the malformed row is returned when it matches by kind and the route still answers 200; an unknown playbook slug answers an empty page; bad `limit`, `before`, `since`, `until` and a reversed range answer their 400 codes (kernel test). And on the screen, choosing Agent and Playbook filters shows only the fixture's matching rows with the "filtered" Badge, and "Older" / "Newer" page through them (e2e and jsdom).
- [ ] AC5 — Given the kernel unreachable (the bridge fails while the screen holds data), then the shared band shows, the screen keeps its last data marked "last known" with "Audit log", "Open the full log", the filters and paging disabled, and nothing throws (a jsdom test in `BudgetScreen.test.tsx` and an e2e step that closes the fixture kernel).
- [ ] AC6 — Given the keyboard only, then every action on the screen (open the audit log, change each filter, clear filters, page Older and Newer, go back with Back or `Esc` with focus returned, Open Team from the band, move between rows with `J`/`K`) is reachable by Tab/Enter/Space/arrow keys/`J`/`K`/`Esc`, and the ⌘K palette lists the screen's commands (`budget.*`: "Open the audit log", "Show refused starts in the audit log", "Clear audit filters") while the screen is mounted and not after it unmounts.
- [ ] AC7 — Given a live event on the feed that changes what the screen shows (the fixture kernel's `appendEvent` of a `budget_limit_reached` with the fixture's `/budget/usage` and `/audit` then answering the new data), then the totals, the agent row and the latest events update without a reload, and the bounding boxes of the rows already shown do not move (the e2e compares them before and after).
- [ ] AC8 — Given VoiceOver, then every control and status has an accessible name (the e2e checks each select, button, meter and badge with `getByRole` / `getByLabel`), and both themes meet WCAG 2.1 AA contrast: only design tokens are used for colour, `app/src/screens/budget/contrast.test.ts` checks the screen's text/background token pairs in light and dark, and the evidence README records the result.
- [ ] AC9 — The polish gate: a committed evidence file `docs/evidence/phase-7-polish/budget/README.md` lists one light and one dark screenshot (PNG files in that folder, each a relative link that `bash scripts/check-docs.sh` resolves) of every state the mockup shows for this screen, each named against its mockup state (`budget-empty`, `budget-loading`, `budget-populated`, `budget-waiting`, `budget-error`, `budget-unreachable`, `budget-audit`, `budget-audit-filtered`); the exact command that regenerates them (`BUDGET_EVIDENCE=1`, as `SCHEDULES_EVIDENCE=1` in `app/e2e/schedules.spec.ts`); and every departure from the mockup and why (at least: no event total in the audit footer, the Actor column's source ("—" when the payload names no agent; `EventFrame` has no `actor`), `account` labelled from `GET /status`, the utilization scale assumption). The PR body links to it and may embed the screenshots.
- [ ] AC10 (owner gate, not worker-satisfiable) — The owner's approval of the PR is the polish gate (D9). Supervisor and `/review-pr` never merge it. The evidence is the owner's GitHub approval, not the PR body.
- [ ] AC11 — Validation passes: `cd app && npm ci && npm run typecheck && npm test && npm run build`; `cd app && npx playwright test e2e/budget.spec.ts`; `cd kernel && npm ci && npm run typecheck && npm test`; `bash scripts/check-docs.sh` prints `check-docs: OK`.

**Evidence rule:** AC8's contrast record and AC9 rest on the committed `docs/evidence/phase-7-polish/budget/README.md`. FINALIZE lists it in the PR body's `## Evidence` section and may embed screenshots, but the PR body is never their only home.

## File Impact Map

| Path | Action | Lines at base | Confidence | Home / note |
|------|--------|---------------|------------|-------------|
| `kernel/src/gui/budget-audit.ts` | MODIFY (17) | 17 | HIGH | The item's own part (ARCHITECTURE.md "The gui feature"): both route handlers and their read queries (estimated 220–300 lines, below the threshold). |
| `kernel/src/gui/query.ts` | CREATE | — | HIGH | extract `positiveIntegerOf` / `limitOf` into `kernel/src/gui/query.ts` (the copies in `tasks.ts` and `schedules.ts`; `budget-audit.ts` is the third user). |
| `kernel/src/gui/tasks.ts` | MODIFY (266) | 266 | HIGH | Replace the local `positiveInteger` with `positiveIntegerOf` from `./query.js`; no behaviour change. |
| `kernel/src/gui/schedules.ts` | MODIFY (165) | 165 | HIGH | Replace the local `limitOf` with `./query.js`'s (`limitOf(raw, DEFAULT_LIMIT, MAX_LIMIT)`) and the id check with `positiveIntegerOf`; no behaviour change. |
| `kernel/test/gui-query.test.ts` | CREATE | — | HIGH | Unit tests of the shared helpers (absent, `0`, leading zero, sign, decimal, over max, unsafe integer). |
| `kernel/test/gui-budget-audit.test.ts` | CREATE | — | HIGH | Route tests against a real store (AC1–AC4 kernel side). Separate file per the requirement's Touches. |
| `docs/architecture/budget.md` | MODIFY (95) | 95 | HIGH | A new "## Reading usage" section for both routes. |
| `app/src/screens/budget/index.tsx` | MODIFY (17) | 17 | HIGH | Swap the placeholder for the real Component; keep id, title, nav label and order (no shortcut). |
| `app/src/screens/budget/BudgetScreen.tsx` | CREATE | — | HIGH | The overview (tables, inspector, band, states) and the switch to the audit view. Estimated 350–450 lines. |
| `app/src/screens/budget/AuditLog.tsx` | CREATE | — | HIGH | The audit view (filters, table, paging). Separate concern from the overview. |
| `app/src/screens/budget/model.ts` | CREATE | — | HIGH | Pure logic, no React: the day series with zero days, limit-cell figures and "at limit", waiting-on-you detection, cap labels and tones, utilization percent, payload summary and Actor, filter → query mapping, cursor stack, test ids table. |
| `app/src/screens/budget/useUsage.ts` | CREATE | — | HIGH | Fetch, hold-last-data and throttled live refetch of `GET /budget/usage` (as `app/src/screens/schedules/useSchedule.ts`). |
| `app/src/screens/budget/useAudit.ts` | CREATE | — | HIGH | Fetch and paging of `GET /audit` (as `app/src/screens/schedules/useHistory.ts`). |
| `app/src/screens/budget/commands.ts` | CREATE | — | HIGH | Palette commands, modelled on `app/src/screens/schedules/commands.ts`. |
| `app/src/screens/budget/budget.css` | CREATE | — | HIGH | Screen styles from tokens only (the mockup's meter, `tbl`, `fbar` blocks as reference). |
| `app/src/screens/budget/BudgetScreen.test.tsx` | CREATE | — | HIGH | jsdom tests: states, waiting band, dollar label rule, unreachable keeps data, filters and paging, palette register/unregister, live refetch, literal untrusted text. |
| `app/src/screens/budget/model.test.ts` | CREATE | — | HIGH | Unit tests for the model functions. |
| `app/src/screens/budget/contrast.test.ts` | CREATE | — | HIGH | Token-pair contrast in light and dark (as `app/src/screens/schedules/contrast.test.ts`). |
| `app/e2e/budget.spec.ts` | CREATE | — | HIGH | Playwright e2e, launched only through `app/e2e/electron-harness.ts`; screenshots to the evidence dir only with `BUDGET_EVIDENCE=1`, and a last test that fails if a tracked evidence file is newer than the run (as `schedules.spec.ts`). |
| `app/e2e/fixtures/budget.ts` | CREATE | — | HIGH | The screen's fixture routes and events (`app/e2e/fixtures/README.md`: each screen adds its own `<screen>.ts`; `fixture-kernel.ts` is not edited). |
| `docs/evidence/phase-7-polish/budget/README.md` | CREATE | — | HIGH | Polish-gate evidence (AC8 contrast, AC9), in the form of `docs/evidence/phase-7-polish/schedules/README.md`. |
| `docs/evidence/phase-7-polish/budget/*.png` | CREATE (~16) | — | MEDIUM | `budget-<state>-<light\|dark>.png`. Binary outputs no worker reads. |

Reference only, not modified: `app/src/api/contract.ts` (lines 215–245 `StatusBody.cap_state`, 631–639 `EventFrame`, 1185–1250 the shapes, 1343–1344 the route keys), `kernel/src/api/server.ts` (`readStatus`, the cap grouping to mirror; 914 lines, not edited), `kernel/src/agents/roster.ts` (`rosterOf`, `RosterEntry`), `kernel/src/budget/internal.ts` (`localDay`, `playbookKey`, `playbookCountedTokens`, `playbookTokenLimit`, `agentCountedTokens`), `kernel/src/budget/playbook.ts` (`playbookTokensToday`'s join), `kernel/src/console/events.ts` (`eventFrameOf`, `EventRow`), `kernel/src/loop/internal.ts` (`normalizeInstant`, `appendEvent`), `kernel/src/store/migrations/001_initial.ts` (`events`, `budget`, `cap_state`), `kernel/src/store/migrations/006_budget_cap_details.ts`, `kernel/src/store/migrations/013_playbooks.ts` (`sessions.playbook`), `app/e2e/fixture-kernel.ts` (options, `appendEvent`), `app/e2e/schedules.spec.ts` (evidence capture pattern), `app/src/store/react.ts` (`useLiveStore`, `useResource`), `app/src/shell/KernelStates.tsx` (the band), `app/src/components/*` (Avatar, Badge, Button, Card, EventCard, List, StatusDot, `formatEstimate.ts`), `docs/design/mockups/gui-v2.html` (`budgetScreen`, `auditScreen`, lines 747–790 data, 1313 and 1436 palette entries), `docs/evidence/gui-v2-mockup/README.md` (field map rows for Budget & audit).

Not touched (shared with sibling screen items): `app/src/store/resources.ts`, `app/src/api/contract.ts`, `app/e2e/fixture-kernel.ts`, `app/src/App.tsx`, `app/src/App.test.tsx`, `kernel/test/gui-foundation.test.ts` (its pins are generic since items 03–05: any part's routes pass them unedited), `kernel/src/gui/playbook-history.ts`, `kernel/src/gui/index.ts`, `docs/ARCHITECTURE.md`, `docs/UI.md`, `docs/DESIGN.md`.

Validator-owned surfaces: `scripts/check-docs.sh` checks every relative link in `docs/**/*.md`, so the evidence README's PNG links and any link added to `budget.md` must resolve. Its avatar-hue rules read `app/src/components/Avatar` only; this screen draws avatars through the `Avatar` component.

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/store/migrations/001_initial.ts` (budget) | yes | HOLDS | `counted_tokens     INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens + cache_write_tokens) VIRTUAL,` | base 78fb740 |
| `kernel/src/budget/playbook.ts` (`playbookTokensToday`) | yes | HOLDS | `FROM budget b JOIN playbooks p ON b.playbook = CAST(p.id AS TEXT)` (budget stores the id as text) | base 78fb740 |
| `kernel/src/loop/internal.ts` (`appendEvent`) | yes | HOLDS | `"INSERT INTO events (at, kind, actor, task_id, session_id, payload_json) VALUES (?, ?, 'kernel', ?, ?, ?)"` (no agent/playbook column) | base 78fb740 |
| `app/e2e/fixture-kernel.ts:158` | yes | HOLDS | `"GET /budget/usage": () => ({ status: 200, body: { rows: [], limits: [], cap_state: [] } satisfies BudgetUsageResponse }),` | base 78fb740 |

## House Rules

> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

## Touched-file invariants

> Grounded at base `78fb740251cbbba04ccf6b596b3484807faffe26`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/gui/budget-audit.ts`** — keep: the exported names and the part shape, `export const budgetAuditRoutes: readonly ContributedRoute[] = Object.freeze([` and `export const budgetAuditPart: GuiPart = Object.freeze({` with `name: "budget-audit"`, `tools`, `subcommands`, `handlers`, `dueWork` frozen and empty (pinned by `kernel/test/gui-foundation.test.ts` `holds no tools, subcommands, handlers or due work in any part: gui parts serve routes only`); no route sets `unauthenticated` (`serves no gui route unauthenticated`). Keep the import rule (the part's header and `kernel/src/gui/tasks.ts`'s: "never the Agent SDK, the session manager or `kernel.ts`"; `kernel/test/feature-seams.test.ts` pins the registry's module graph). mirror: `app/src/api/contract.ts` `export interface BudgetUsageRow`, `export interface BudgetLimitUsage`, `export type BudgetCapState = StatusBody["cap_state"];`, `export interface AuditResponse` (field names, nullability, `next_before`); and `readStatus`'s cap grouping in `kernel/src/api/server.ts` (`"SELECT account, rate_limit_type, status, resets_at, utilization, reset_source FROM cap_state ORDER BY account, rate_limit_type"`). reuse: `rosterOf` (`kernel/src/agents/roster.ts`), `localDay`, `playbookKey`, `playbookCountedTokens`, `playbookTokenLimit` (`kernel/src/budget/internal.ts`), `eventFrameOf` (`kernel/src/console/events.ts`), `normalizeInstant` (`kernel/src/loop/internal.ts`). pinned by: `kernel/test/gui-foundation.test.ts` and the new `kernel/test/gui-budget-audit.test.ts`.
- **`kernel/src/gui/tasks.ts`** — keep: `invalidQuery`'s `{ status: 400, body: { error: "invalid_query", message } }` shape and every call site's message; only `function positiveInteger(text: string): number | undefined {` is replaced by the shared import, same semantics (`/^[1-9]\d*$/` and `Number.isSafeInteger`). pinned by: `kernel/test/gui-tasks.test.ts` (unchanged, must stay green).
- **`kernel/src/gui/schedules.ts`** — keep: `const DEFAULT_LIMIT = 50;`, `const MAX_LIMIT = 200;`, the `400 invalid_limit` / `invalid_id` / `invalid_cursor` refusal codes and `const ID = /^[1-9]\d*$/;`'s semantics for the id check; only the local `function limitOf(raw: string | undefined): number | undefined {` is replaced by the shared one. pinned by: `kernel/test/gui-schedules.test.ts` (unchanged, must stay green).
- **`app/src/screens/budget/index.tsx`** — keep: `id: "budget"`, `title: "Budget & audit"`, `nav: { label: "Budget & audit", order: 10 }` with no `shortcut`, and `export const screen: ScreenDefinition = {` (the shell discovers it through `import.meta.glob`; pinned by `app/src/App.test.tsx`'s screen-id loop and `["screens.budget", "Screens", undefined]`, and by its `screen-${id}` test-id check, so the screen's root keeps `data-testid="screen-budget"`). The screen renders no `h1` (the shell's `<h1 className="titlebar-title">` is the one level-1 heading `App.test.tsx` asserts). Leave `app/src/screens/placeholder.tsx` in place.
- **`docs/architecture/budget.md`** — keep: the existing sections (`## Per-agent limits` … `## Events`) and the `## Events` kind table unchanged; add the new section after `## Events`. Every relative link resolves (`scripts/check-docs.sh`).

## Closed enumerations touched

None. The new refusal codes (`invalid_days`, `invalid_since`, `invalid_until`, `invalid_range`) and the palette owner `budget` join no closed list: `grep -rln "invalid_cursor" app/src kernel/src` hits only `kernel/src/gui/schedules.ts` (a local literal), and the `schedules` palette owner is a local `export const SCHEDULES_OWNER = "schedules";` in `app/src/screens/schedules/commands.ts` with no registry list. `events.kind` is free text (`docs/architecture/budget.md` §"Events"); the screen adds no kind.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/gui-budget-audit.test.ts` — counted tokens exclude cache reads | sum `counted_tokens + cache_read_tokens` as `counted_tokens` in the usage query in `kernel/src/gui/budget-audit.ts` |
| `kernel/test/gui-budget-audit.test.ts` — playbook is the slug | select `b.playbook` instead of `coalesce(p.slug, b.playbook)` in `kernel/src/gui/budget-audit.ts` |
| `kernel/test/gui-budget-audit.test.ts` — a row outside the window is absent | drop the `b.day >= ?` bound from the usage query |
| `kernel/test/gui-budget-audit.test.ts` — `cost_estimate_usd` is `null` when every `cost_usd` is `NULL` | wrap the sum as `coalesce(SUM(b.cost_usd), 0)` |
| `kernel/test/gui-budget-audit.test.ts` — `days=0`/`91`/`x` answer `400 invalid_days` | pass `max` 1000 to `limitOf` for `days` |
| `kernel/test/gui-budget-audit.test.ts` — the agent at its limit has `tokens_today === tokens_per_day` | set every agent entry's `tokens_per_day` to `null` in the limits mapper |
| `kernel/test/gui-budget-audit.test.ts` — playbook limits read `token_limit_per_day` | set every playbook entry's `tokens_per_day` to `null` |
| `kernel/test/gui-budget-audit.test.ts` — cap state grouped with its fields | drop `reset_source` from the cap SELECT |
| `kernel/test/gui-budget-audit.test.ts` — audit agent filter matches by session or payload | drop the `s.agent = ?` branch of the agent condition |
| `kernel/test/gui-budget-audit.test.ts` — audit playbook filter matches payload id | drop the payload branch of the playbook condition |
| `kernel/test/gui-budget-audit.test.ts` — a malformed payload row answers 200 | remove the `json_valid` guard from the payload conditions |
| `kernel/test/gui-budget-audit.test.ts` — paging does not overlap or skip | change `e.id < ?` to `e.id <= ?` in the audit query |
| `kernel/test/gui-budget-audit.test.ts` — `next_before` is `null` on the last page | always return the last row's id as `next_before` |
| `kernel/test/gui-budget-audit.test.ts` — since/until inclusive | change `e.at >= ?` to `e.at > ?` |
| `kernel/test/gui-budget-audit.test.ts` — bad `before` answers `400 invalid_cursor` | treat an unparseable `before` as absent |
| `kernel/test/gui-budget-audit.test.ts` — bad `since` answers `400 invalid_since` | pass `since` to SQL without `normalizeInstant` |
| `kernel/test/gui-budget-audit.test.ts` — bad `until` answers `400 invalid_until` | pass `until` to SQL without `normalizeInstant` |
| `kernel/test/gui-budget-audit.test.ts` — `since` after `until` answers `400 invalid_range` | skip the `since > until` check |
| `kernel/test/gui-budget-audit.test.ts` — bad `limit` answers `400 invalid_limit` | pass `max` 1000 to `limitOf` for the audit `limit` |
| `kernel/test/gui-budget-audit.test.ts` — an unknown playbook slug answers an empty page | drop the unknown-slug early return (so the filter is ignored) |
| `kernel/test/gui-query.test.ts` — over max rejected | drop the `<= max` test in `limitOf` in `kernel/src/gui/query.ts` |
| `kernel/test/gui-query.test.ts` — leading zero / `0` rejected | replace `/^[1-9]\d*$/` with `/^\d+$/` in `positiveIntegerOf` |
| `kernel/test/gui-query.test.ts` — unsafe integer rejected | drop the `Number.isSafeInteger` test in `positiveIntegerOf` |
| `app/src/screens/budget/model.test.ts` — Actor is "—" without a payload `agent` | return "kernel" for a payload without `agent` in `model.ts` |
| `app/src/screens/budget/model.test.ts` — at limit at equality | change `>=` to `>` in the at-limit test in `model.ts` |
| `app/src/screens/budget/model.test.ts` — zero days filled | return only the days that have rows from the day-series function in `model.ts` |
| `app/src/screens/budget/model.test.ts` — utilization as percent | return `utilization` unscaled from the percent function in `model.ts` |
| `app/src/screens/budget/BudgetScreen.test.tsx` — no `$` outside "at API rates" | render today's estimate with a bare `$` amount, not `formatEstimate`, in `BudgetScreen.tsx` |
| `app/src/screens/budget/BudgetScreen.test.tsx` — waiting band names the agent at its limit | never show the band in `BudgetScreen.tsx` |
| `app/src/screens/budget/BudgetScreen.test.tsx` — unreachable keeps last data | clear the held data when the connection is not live in `useUsage.ts` |
| `app/src/screens/budget/BudgetScreen.test.tsx` — Older sends `before` | omit `before` from the next page's query in `useAudit.ts` |
| `app/src/screens/budget/BudgetScreen.test.tsx` — commands unregister on unmount | delete the unregister call in the commands effect's cleanup |
| `app/src/screens/budget/BudgetScreen.test.tsx` — a new event refetches usage | make the live effect ignore new events in `useUsage.ts` |
| `app/src/screens/budget/BudgetScreen.test.tsx` — untrusted payload text shown literally | render the payload summary with `dangerouslySetInnerHTML` in `AuditLog.tsx` |
| `app/src/screens/budget/BudgetScreen.test.tsx` — `Esc` returns to the overview with focus restored | drop the focus restore in the audit view's close handler |
| `app/e2e/budget.spec.ts` — rows already shown keep their bounding boxes on a live update (AC7) | show the loading skeleton on every refetch in `BudgetScreen.tsx` |
| `app/e2e/budget.spec.ts` — the tracked evidence dir is untouched without `BUDGET_EVIDENCE` | write screenshots to the evidence dir unconditionally |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: `GET /budget/usage` and `GET /audit` in the budget-audit part, shared query helpers | AC1, AC2, AC3, AC4 (kernel side), AC11 (kernel, check-docs) | 4 modify, 3 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | App: the Budget & audit screen, e2e and polish-gate evidence | AC2, AC3, AC4 (screen side), AC5, AC6, AC7, AC8, AC9, AC11 (app, e2e, check-docs) | 1 modify, 13 create (+PNG outputs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

Subtask 2 never calls the real kernel: the screen talks to the contract shapes, the jsdom tests use the fake bridge, and the e2e uses the fixture kernel with `app/e2e/fixtures/budget.ts`. So it does not wait for subtask 1. Both read the same contract (`app/src/api/contract.ts` at the base commit) and neither edits it. If either finds the contract shape cannot serve an AC, it stops and reports that rather than editing the contract (a shared file sibling items read).

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/gui/budget-audit.ts", name: "budgetAuditRoutes"}
  - {kind: "symbol", path: "kernel/src/gui/budget-audit.ts", name: "budgetAuditPart"}
  - {kind: "symbol", path: "kernel/src/gui/query.ts", name: "limitOf"}
  - {kind: "symbol", path: "kernel/src/gui/query.ts", name: "positiveIntegerOf"}
  - {kind: "file", path: "kernel/test/gui-budget-audit.test.ts"}
  - {kind: "file", path: "kernel/test/gui-query.test.ts"}
  - {kind: "symbol", path: "docs/architecture/budget.md", name: "Reading usage"}
requires: []
lanes:
  - "kernel/src/gui/budget-audit.ts"
  - "kernel/src/gui/query.ts"
  - "kernel/src/gui/tasks.ts"
  - "kernel/src/gui/schedules.ts"
  - "kernel/test/gui-budget-audit.test.ts"
  - "kernel/test/gui-query.test.ts"
  - "docs/architecture/budget.md"
external_requires:
  - "Node.js and npm (cd kernel && npm ci)"

# Subtask 2
provides:
  - {kind: "file", path: "app/src/screens/budget/BudgetScreen.tsx"}
  - {kind: "file", path: "app/src/screens/budget/AuditLog.tsx"}
  - {kind: "file", path: "app/src/screens/budget/model.ts"}
  - {kind: "file", path: "app/src/screens/budget/commands.ts"}
  - {kind: "file", path: "app/e2e/budget.spec.ts"}
  - {kind: "file", path: "app/e2e/fixtures/budget.ts"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/budget/README.md"}
requires: []
lanes:
  - "app/src/screens/budget/**"
  - "app/e2e/budget.spec.ts"
  - "app/e2e/fixtures/budget.ts"
  - "docs/evidence/phase-7-polish/budget/**"
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
| 1 | `skills/unit-testing/SKILL.md` (vitest against a real store), `skills/error-handling/SKILL.md` (400 refusals, untrusted payload JSON never throws) |
| 2 | `skills/frontend-ui/SKILL.md` (design-system reuse, WCAG 2.1 AA, keyboard reachability, focus return), `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Source | Mitigation |
|------|--------|--------|------------|
| Size: about 2,600 lines across about 20 files is past one worker's context | HIGH | Feasibility (Phase 2.5) | Two subtasks split at the contract boundary, which is already merged; neither edits the other's files. |
| `budget.playbook` holds the playbook id as text, the contract wants a slug | MEDIUM | Feasibility (Phase 2.5) | `LEFT JOIN playbooks ON b.playbook = CAST(p.id AS TEXT)` (the meter's own join); an unknown id keeps its stored text so totals still match (AC1 tests it). |
| `events` has no agent or playbook column | MEDIUM | Feasibility (Phase 2.5) | Match through the event's session or the payload's `agent` / `playbook` keys, `json_valid`-guarded; documented in `budget.md`; AC4 covers both paths and a malformed row. An event that names an agent nowhere is not matched by the agent filter (documented). |
| A gui route has no auth-provider list, so `cap_state.account` cannot be labelled as `GET /status` labels it | LOW | Feasibility (Phase 2.5) | `account` = provider id in the route; the screen shows the label from the live `status` resource for the same `provider`. `server.ts` stays unedited (914 lines). Recorded departure. |
| Cap `utilization` scale unverified (Q6 saw 0–1 in `unifiedWindows`) | MEDIUM | Feasibility (Phase 2.5) | Treat as a 0–1 fraction, clamp to 0–100%; recorded unverified in the evidence README; a later live reading settles it. |
| No total in keyset paging, the mockup shows "8 of 20 events" and "page 1 of 3" | LOW | Feasibility (Phase 2.5) | Footer shows the page's row range and page number only; recorded departure. |
| A chart or meter that implies a dollar budget (requirement Risk) | MEDIUM | Analysis | Every meter and limit is in tokens or sessions; the only dollar figure goes through `formatEstimate` ("≈$… at API rates"); a jsdom test asserts no `$` elsewhere (AC2). |
| Extracting the query helper edits two merged sibling parts | LOW | Analysis | Same semantics, their existing tests stay green unedited; `playbook-history.ts` is left alone. Lanes L4 (Memory) and L6 (Settings) may still add their own copy; a later consolidation picks them up. |
| Untrusted event payloads (PR bodies, comments) rendered as HTML | MEDIUM | Analysis | React text only; a jsdom test feeds markup and asserts it is shown literally. |
| An unindexed `json_extract` scan on a large `events` table for the agent/playbook filter | LOW | Analysis | Accepted for phase 7: newest-first by rowid, stops at `limit` matches. No migration (parallel lanes would collide on the next number). Recorded in `budget.md`. |
| Layout shift on a live update (AC7) | MEDIUM | Analysis | Keep rows on screen while refetching, key rows by stable ids, fixed row heights; the e2e compares bounding boxes. |
| Merging without the owner's approval (D9 polish gate) | HIGH | Analysis | AC10 is an owner gate. Never auto-merge; leave the PR for the owner. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 1
- **Base Branch:** main
- **Split reason:** context-bound
- **Threshold note:** about 2,600 changed lines across about 21 files (past both `context-bound` bounds). The split falls on the contract boundary, which also gives two groups with no file overlap (7 and 14 files), so they run in parallel.

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-30-the-budget-and-audit-screen.md
```

## Plan Review: PASS (attempt 2/3)

| # | Severity | Section | Description | Resolution |
|---|----------|---------|-------------|------------|
| 1 | MEDIUM | Design (Audit log view) | Actor column credited API writers (`'api'` actor: kill switch, stop-all) to "kernel" (attempt 1) | fixed: "—" when the payload names no agent; Feasibility (b) names the `'api'` writers |
| 2 | LOW | Subtask Structure | Subtask 2 create count off by one (attempt 1) | fixed: 13 create; threshold note 7/14 |
| 3 | LOW | Design (Kernel routes) | Reuse `playbookCountedTokens` instead of a new SUM (attempt 1) | fixed |
| 4 | LOW | Pin mutations | Combined rows covered one case each (attempt 1) | fixed: one row per case |
| 5 | LOW | Closed enumerations | Unverified closed lists for new codes / palette owner (attempt 1) | fixed: section added with grep evidence (none) |
| 6 | LOW | Design (Audit log view) | Mockup's playbook ref in Detail missing (attempt 1) | fixed |

Owner chose **Save and exit** (LP-SAVE, 2026-10-30).

## Outcome
- **Status:** completed
- **Completed:** 2026-10-30T18:03:27Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/184
- **Branch:** feature/the-budget-and-audit-screen
- **Files changed:** 42
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Kernel GET /budget/usage and GET /audit in the gui budget-audit part with shared query helpers (kernel/src/gui/query.ts); the Budget & audit screen with audit log, jsdom + Playwright coverage and 16 polish screenshots. Phase 4.5: iteration 1 fixed one MEDIUM (copied Glyph/WarnGlyph/Skeleton → shared app/src/components), iteration 2 PASS with no findings; 5 LOW/nit dismissed (marker comment posted). Review drain not dispatched: /automate's config .auto_review=false (it owns the drain).

## Not verified
- **⌘K palette in Electron** — the shell does not mount the palette; the three budget.* commands are pinned in jsdom only (subtask 2)
- **Cap utilization scale** — top-level field treated as a 0–1 fraction (reviewer found the recorded p6 event supports it), not checked against a live kernel (subtask 2)
- **Screen against the real kernel routes** — exercised against contract shapes and the fixture kernel only (subtask 2)
