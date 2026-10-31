# Budget & audit screen evidence (phase 7 item 07)

These are screenshots of the built app's Budget & audit screen in every state the GUI v2 mockup shows for it (`budget-empty`, `budget-loading`, `budget-populated`, `budget-waiting`, `budget-error`, `budget-unreachable`, `budget-audit`, `budget-audit-filtered`), each in light and dark mode (16 files). Each one was taken by `app/e2e/budget.spec.ts` against the fixture kernel, with the canned data in `app/e2e/fixtures/budget.ts`. Every name, repo and task in them is a fixture value (`studio-sandbox`, a session "37 ended completed"), so none of it is real data. Days and times are relative to the moment of capture (today's row is always the first, the five-hour window resets at 17:00 today), so they differ from the mockup's fixed clock and the audit log's times differ on every run.

To regenerate the screenshots (macOS):

```sh
cd app && npm run build && BUDGET_EVIDENCE=1 npx playwright test e2e/budget.spec.ts --workers=1
```

`BUDGET_EVIDENCE=1 npm run e2e` writes the same files, and also rewrites other screens' tracked screenshots, whose pixels change a little on every run; use the command above to regenerate these alone.

Without `BUDGET_EVIDENCE=1` the spec writes its screenshots to Playwright's per-test output directory, so CI never changes these files, and one of its tests fails if any file in this directory is newer than the run's start. Another test fails if this README stops naming a light and a dark file for a state, or if a file here is not named. The spec checks behaviour and never compares pixels, because fonts differ between macOS and the Ubuntu CI run. All 16 files were captured on macOS on 2026-10-30.

## Screenshots

The "Mockup view" column names the view of `docs/design/mockups/gui-v2.html` each screenshot matches (`#view=<name>`).

| Screenshot (light / dark) | Mockup view | What it shows |
|---|---|---|
| [light](budget-empty-light.png) / [dark](budget-empty-dark.png) | `budget-empty` | "No tokens used yet." with the copy that limits are in tokens and sessions at once, never dollars, and the one action, Ask Wright. No Audit log button, as in the mockup. |
| [light](budget-loading-light.png) / [dark](budget-loading-dark.png) | `budget-loading` | The usage route held open by the fixture: four skeleton rows, `aria-busy`, and a status line "Loading usage" for a screen reader. |
| [light](budget-populated-light.png) / [dark](budget-populated-dark.png) | `budget-populated` | Tokens counted per day for seven days (today first, a day with no rows as 0, cache reads beside the count and "not counted"); by agent (Wright with no limit set, Mason 47,844 of 150,000, Ada 61,900 of 100,000, each with its sessions at once); by playbook (one with a limit, one off); the three latest audit events; the inspector with the two cap windows (`five_hour` allowed 41%, `seven_day` warning 83%, each with its reset) and today's total with its one "≈$… at API rates" estimate. |
| [light](budget-waiting-light.png) / [dark](budget-waiting-dark.png) | `budget-waiting` | Ada has used her whole limit: "100,000 of 100,000", an "at limit" badge, a full meter, the row marked, and the band "1 agent waits on you: Ada used 100,000 of its 100,000 tokens today, so its new sessions wait until midnight. Raise its limit in Team to continue." with an Open Team button. |
| [light](budget-error-light.png) / [dark](budget-error-dark.png) | `budget-error` | The route-failure card: "Couldn't load usage", "the usage request failed (500)", the detail `GET /budget/usage · 500 · store_unreadable`, and Try again. No kernel band above it: the kernel answered. |
| [light](budget-unreachable-light.png) / [dark](budget-unreachable-dark.png) | `budget-unreachable` | The fixture kernel closed while the screen held data: the shell's "Couldn't reach the kernel" band, "… tokens today · last known", the cap account marked "last known", the tables as last read, and Audit log and Open the full log disabled. |
| [light](budget-audit-light.png) / [dark](budget-audit-dark.png) | `budget-audit` | The full log, newest first: crumb with Back, the Kind, Agent, Playbook and Time range filters, Clear filters disabled, the Id · When · Kind · Actor · Detail table (8 rows), "Showing rows 1–8 · page 1 · newest first", Newer disabled, Older, and the append-only note. |
| [light](budget-audit-filtered-light.png) / [dark](budget-audit-filtered-dark.png) | `budget-audit-filtered` | The log filtered to Mason and Review PRs on studio-sandbox: the "filtered" badge, Clear filters enabled, and only Mason's review events, each with its session, task and playbook refs. |

## Contrast check (AC8)

The screen takes every colour from the design tokens: `app/e2e/budget.spec.ts` fails on a hex colour, a colour function or a named colour in `budget.css`, and `app/src/screens/budget/contrast.test.ts` fails if the stylesheet names a token that does not exist. That test also computes the WCAG 2.1 contrast ratio of each text and background token pair the screen uses, from `app/src/styles/tokens.css`, in both themes (text needs 4.5:1, non-text parts 3:1). All pairs pass in both themes. The ratios on 2026-10-30:

| Pair (text on background) | Used for | Light | Dark |
|---|---|---|---|
| `ink` on `surface` | table text, the inspector's figures, the event cards | 17.29 | 14.08 |
| `ink` on `ground` | the screen's titles and the figures on the page ground | 15.89 | 15.31 |
| `ink-secondary` on `surface` | the event kind, the cache-read note, the empty-state copy | 6.43 | 6.68 |
| `ink-secondary` on `ground` | the crumb and the empty-state copy on the page ground | 5.91 | 7.26 |
| `ink-tertiary` on `surface` | captions, section labels, table headers, "no limit set" | 5.59 | 4.97 |
| `ink-tertiary` on `ground` | the summary line, captions on the page ground, "last known" | 5.14 | 5.40 |
| `ink-secondary` on `attention-soft` | the waiting row's captions | 5.75 | 5.34 |
| `ink` on `attention-soft` | the waiting row's figures | 15.44 | 11.27 |
| `attention` on `attention-soft` | the waiting-on-you band, the "at limit" and "warning" badges | 5.04 | 7.11 |
| `ok` on `ok-soft` | the "allowed" badge | 4.63 | 5.84 |
| `danger` on `danger-soft` | the "rejected" badge, a refresh notice | 5.09 | 6.04 |
| `danger` on `surface` | the route-failure card's heading | 5.95 | 6.52 |
| `ink-secondary` on `surface-sunken` | a cap status the screen has no label for (neutral badge) | 5.56 | 7.59 |
| `accent` on `accent-soft` | the "filtered" badge | 5.43 | 5.22 |
| `ink` on `surface-sunken` | the route-failure detail and the select fields | 14.95 | 16.00 |
| `on-accent` on `accent` | the primary button's label (Ask Wright) | 6.48 | 7.02 |
| `accent` on `surface` | ghost buttons' hover text | 6.48 | 6.34 |
| `accent` on `surface-sunken` (non-text, 3:1) | a meter's bar against its track | 5.60 | 7.21 |
| `attention` on `surface-sunken` (non-text, 3:1) | a full meter (at limit) against its track | 4.88 | 10.10 |
| `focus` on `surface` (non-text, 3:1) | the focus ring | 6.48 | 6.34 |

Every status carries text as well as colour: a badge has its word ("at limit", "allowed", "warning", "rejected", "filtered"), a row at its limit also reads "N of N", and the band has its sentence. Every meter is a `role="img"` with an `aria-label` that says what it measures ("62 percent of the daily token limit", "45 percent of the busiest day", "41 percent of the five_hour window used"). Each table has a caption, each select a `<label>`, and the filters are a group named "Filter the audit log"; the e2e checks each of these with `getByRole`.

## What the spec checks

| Area | Check |
|---|---|
| Overview (AC2, AC3) | Seven day rows, today first, a day with no rows as 0; the shell's one `h1` reads "Budget & audit"; the agents and playbooks with their limit cells and sessions; the two cap windows with their badges and "N% used · resets <time>". |
| At limit (AC2) | Ada's row reads "100,000 of 100,000" with an "at limit" badge and a full meter, the band names her, Open Team goes to `#/team` by keyboard, and exactly one text node on the screen holds a dollar sign: the "≈$… at API rates" estimate. |
| Log and paging (AC4) | Unfiltered, the 20 events page 8 + 8 + 4 with `before` cursors `393` and `385`, no overlap, Older disabled on the last page, focus moved to Newer; Newer re-reads the cursors it came by. Agent = Mason and Playbook = Review PRs shows exactly the eight matching rows with the "filtered" badge; the full page's Older shows "No older events."; Kind = `admission_refused` shows "No events match." and Clear filters restores the log. |
| Unreachable (AC5) | The fixture kernel is closed: the shell's band shows, the rows and limits are the last read, "last known" appears, Audit log and Open the full log are disabled, and the window logs no page error. |
| Keyboard (AC6) | J and K move between table rows; Enter on Audit log opens the log with focus on Back; Tab reaches the four filters, a row and Older in order; typing "Mason" on the Agent select filters; Enter on Clear filters leaves focus on Kind; Enter and Space page; Escape returns to the overview with focus on the button that opened it; Back after Open the full log returns focus to that button. |
| Live (AC7) | From the waiting state, `liveUpdate` ends a session of Mason's and records Ada's `budget_limit_reached`: the total, Mason's row (52,300 of 150,000) and the latest events update with no reload and no skeleton; the boxes of the day, agent and playbook rows, the latest-event cards, the cap windows and the band are identical before and after. |
| Names (AC8) | Every button, select, badge, table, meter and group has an accessible name; every `<time>` carries its instant; the stylesheet has no literal colour. |

A pin mutation of the AC7 check: the usage read was made to clear the held data at the start of every refetch (the screen flashes its loading state). The check failed with "the screen never flashed a loading state" and the change was reverted.

## Departures from the mockup

- **No event total in the audit footer.** The mockup reads "Showing 9–16 of 20 · page 2 of 3" and a badge "20 of 20 events". `GET /audit` pages by keyset cursor (`next_before`), which has no total, so the footer reads "Showing rows 9–16 · page 2 · newest first" and there is no count badge. A full last page has a cursor and the page after it is empty; that page says "No older events." instead of "No events match."
- **The Actor column is the payload's `agent`, or "—".** `EventFrame` carries no `actor`; the stored actor is `'kernel'` for the kernel's own writers and `'api'` for the API's own (the kill switch, stop-all), and the route does not send it. The screen never guesses, so an event that names no agent in its payload reads "—" where the mockup reads "kernel" or "you".
- **The cap account is labelled from `GET /status`.** A contributed route has no auth-provider list, so `GET /budget/usage` puts the provider id in `account`. The screen shows the label from the live store's `status` entry for the same provider ("personal subscription") and falls back to the provider id.
- **The utilization scale is an assumption.** `docs/OPEN_QUESTIONS.md` Q6 saw `unifiedWindows` utilization as 0 to 1 fractions; the top-level field is stored "as sent" and has not been observed. The screen treats it as a fraction (0.41 reads 41%, clamped to 0 to 100). **Unverified** for the top-level field: a later live reading settles it.
- **The band names every agent at its limit.** The mockup's band is written for one agent; with several it reads "N agents wait on you: A used …; B used …, so their new sessions wait until midnight. Raise their limits in Team to continue."
- **Open Team goes to `#/team`.** The mockup says "Team is in gui-v1.html"; the app has the Team screen.
- **"Back" is a labelled button before the crumb.** The mockup's button carries the crumb's first segment; here it reads "Back" so the visible label is the accessible name, followed by "Budget & audit / Audit log".
- **The latest events are `evc` cards, not `EventCard`s.** The mockup's cards (kind, actor, time, one line) are drawn as they are; the design system's `EventCard` has six fixed kinds and a link subject that does not fit free-text kernel kinds.
- **Row text clips.** Table rows and cards have fixed heights so a refetch moves nothing; a long detail ends in an ellipsis.
- **The first row of each table is a tab stop.** J and K move between rows, so each table's first row takes `tabindex="0"` and the rest `-1`, as the Schedules history does.

## Limits

- **A band that appears pushes the content down by its height.** The AC7 check starts in the waiting state, where the band is already up, so it measures the rows and not the band's own arrival. When an agent reaches its limit while the screen is on the populated view, the band appears above the tables like every band in the app and the content below it moves once.
- **The ⌘K palette is not reachable in the built app.** The shell does not mount the command palette (probed on 2026-10-30, as in phases 6 and 7). The screen registers "Open the audit log", "Show refused starts in the audit log" and "Clear audit filters" under owner `budget` while it is mounted and unregisters them on unmount; that, their enabled flags and what each does are pinned in `app/src/screens/budget/BudgetScreen.test.tsx` (jsdom), not driven in Electron. Budget & audit has no digit shortcut, as in the mockup.
- **Arrow keys on a `<select>` open the list on macOS.** The e2e changes a filter by typing the option's name on the focused select; the jsdom tests drive `change` directly.
- **The fixture's routes are the shared interface, not the kernel's.** The real routes (`kernel/src/gui/budget-audit.ts`) are covered by `kernel/test/gui-budget-audit.test.ts`. The fixture's 20 events and the page size of 8 are chosen so three pages show, and so the Mason and Review PRs filter lands on exactly one full page.
- All screenshots come from one machine (macOS). The Ubuntu CI run executes the same assertions but does not write these files.
