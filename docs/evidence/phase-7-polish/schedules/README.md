# Schedules & triggers screen evidence (phase 7 item 05)

These are screenshots of the built app's Schedules & triggers screen in every state the GUI v2 mockup shows for it, plus the history's "Not fired" filter and the confirm dialog, each in light and dark mode (14 files). Each one was taken by `app/e2e/schedules.spec.ts` against the fixture kernel, with the canned data in `app/e2e/fixtures/schedules.ts`. Every name, repo and task in them is a fixture value (`studio-sandbox`, a wake-up "PR #3 review may be ready"), so none of it is real data. The times are relative to the moment of capture (the poll's next fire is four minutes ahead, the wake-up an hour), so they differ from the mockup's fixed clock.

To regenerate the screenshots (macOS):

```sh
cd app && npm run build && SCHEDULES_EVIDENCE=1 npx playwright test e2e/schedules.spec.ts --workers=1
```

`SCHEDULES_EVIDENCE=1 npm run e2e` writes the same files, and also rewrites other screens' tracked screenshots, whose pixels change a little on every run; use the command above to regenerate these alone.

Without `SCHEDULES_EVIDENCE=1` the spec writes its screenshots to Playwright's per-test output directory, so CI never changes these files, and one of its tests fails if any file in this directory is newer than the run's start. Another test fails if this README stops naming a light and a dark file for a state, or if a file here is not named. The spec checks behaviour and never compares pixels, because fonts differ between macOS and the Ubuntu CI run. All 14 files were captured on macOS on 2026-10-30.

## Screenshots

The "Mockup view" column names the view of `docs/design/mockups/gui-v2.html` each screenshot matches (`#view=<name>`).

| Screenshot (light / dark) | Mockup view | What it shows |
|---|---|---|
| [light](schedules-empty-light.png) / [dark](schedules-empty-dark.png) | `schedules-empty` | "Nothing is scheduled." with the note that Studio ships no triggers, and the one action, Ask Wright to schedule something. |
| [light](schedules-loading-light.png) / [dark](schedules-loading-dark.png) | `schedules-loading` | The schedule route held open by the fixture: four skeleton rows, `aria-busy`, and a status line "Loading the schedule" for a screen reader. |
| [light](schedules-populated-light.png) / [dark](schedules-populated-dark.png) | `schedules-populated` | The upcoming timeline in the order the route sends (a poll, a wake-up, a once, two crons), "Triggers · 6" with a switch each (the disabled ones off and not on the timeline), and the open trigger's detail and firing history: a repeat of fired rows as one row "×2", a rate limit, four polls missed while paused as one row "×4" with the reason `paused` beneath, a fire with its session, a kill switch, and a missing connector with its link to Integrations. |
| [light](schedules-not-fired-light.png) / [dark](schedules-not-fired-dark.png) | the history's "Not fired" filter in `schedules-populated` (`S.hf = 'missed'`, also the palette's "Show missed fires") | The same history with the "Not fired" chip pressed: only the missed groups. |
| [light](schedules-confirm-light.png) / [dark](schedules-confirm-dark.png) | no mockup view (the requirement's confirm for a past `once` trigger) | The dialog after the kernel answered `409 needs_confirmation` to turning on "Archive the old sandbox": it says turning it on would fire it at once, Cancel has focus and the `Esc` chip, and the primary reads "Turn on and fire now". |
| [light](schedules-error-light.png) / [dark](schedules-error-dark.png) | `schedules-error` | The route-failure card: "Couldn't load the schedule", "the schedule request failed (500)", the detail `GET /schedule · 500 · store_unreadable`, and Try again. No kernel band above it: the kernel answered. |
| [light](schedules-unreachable-light.png) / [dark](schedules-unreachable-dark.png) | `schedules-unreachable` | The fixture kernel closed while the screen held data: the shell's "Couldn't reach the kernel" band, the summary "5 upcoming · 4 triggers on · last known", every switch, Refresh and Load older disabled, and the rows kept as last read. |

## Contrast check (AC8)

The screen takes every colour from the design tokens: `app/e2e/schedules.spec.ts` fails on a hex colour, a colour function or a named colour in `schedules.css`, and `app/src/screens/schedules/contrast.test.ts` fails if the stylesheet names a token that does not exist. That test also computes the WCAG 2.1 contrast ratio of each text and background token pair the screen uses, from `app/src/styles/tokens.css`, in both themes (text needs 4.5:1, non-text parts 3:1). The ratios on 2026-10-30:

| Pair (text on background) | Used for | Light | Dark |
|---|---|---|---|
| `ink` on `surface` | names, table text, the open trigger's title | 17.29 | 14.08 |
| `ink` on `accent-soft` | the selected trigger row | 14.48 | 11.60 |
| `ink-secondary` on `surface` | reasons, counts, the detail's values | 6.43 | 6.68 |
| `ink-secondary` on `accent-soft` | the selected row's second line | 5.39 | 5.50 |
| `ink-secondary` on `ground` | the timeline's times | 5.91 | 7.26 |
| `ink-tertiary` on `surface` | captions, section labels, table headers | 5.59 | 4.97 |
| `ink-tertiary` on `ground` | the summary line | 5.14 | 5.40 |
| `ink-secondary` on `surface-sunken` | the neutral badges | 5.56 | 7.59 |
| `accent` on `accent-soft` | the pressed filter chip | 5.43 | 5.22 |
| `accent` on `surface` | the link to Integrations | 6.48 | 6.34 |
| `ok` on `ok-soft` | the "fired" and "on" badges | 4.63 | 5.84 |
| `attention` on `attention-soft` | the missed · paused, kill switch, rate limited and not enabled badges | 5.04 | 7.11 |
| `danger` on `danger-soft` | the no connector and source error badges, a notice | 5.09 | 6.04 |
| `danger` on `surface` | a row's refusal, the route-failure heading | 5.95 | 6.52 |
| `ink` on `surface-sunken` | the route-failure detail | 14.95 | 16.00 |
| `on-accent` on `accent` | the primary button's label | 6.48 | 7.02 |
| `border` on `surface` (non-text, 3:1) | the switch's off track | 3.38 | 3.33 |
| `focus` on `surface` (non-text, 3:1) | the focus ring | 6.48 | 6.34 |

Every status carries text as well as colour (each badge has a label, a repeat has "×N" and "N times", a missed fire has its reason in mono), so colour is never the only signal. Each switch is named "`<name>` trigger is on|off", the timeline is a labelled list ("Upcoming"), the history is a captioned table ("Firing history") and the filter chips are a labelled group; the e2e checks each of these with `getByRole`.

## What the spec checks

| Area | Check |
|---|---|
| Timeline (AC1) | Five entries (poll, wake-up, once, cron, cron) in the order the fixture route sends them; a disabled trigger is not on it; "Triggers · 6"; the shell's one `h1` reads "Schedules & triggers". |
| History (AC2, AC3) | Each missed row shows its recorded reason verbatim; a reason with no label (`queue_overflow`) is shown as is with a neutral "missed" badge; a repeat is one row with a count (the 28 fires of the fixture add up once each over three pages of 10, 10 and 8); "Load older" sends the `before` cursor each time, the connector repeat continues across pages one and two, the control goes away at the last page; only the missing-connector row links to `#/integrations`. |
| Switches (AC4) | A toggle posts `/triggers/:id/on` or `/off` with no body; a past `once` trigger gets `409 needs_confirmation` and a dialog; Escape sends nothing and returns focus to the switch; Enter on the primary resends with `{"confirm": true}`. |
| Unreachable (AC5) | The fixture kernel is closed: the shell's band shows, the rows stay, the summary says "last known", every switch, Refresh and Load older is disabled, the filter still works, and the window logs no page error. |
| Keyboard (AC6) | J and K move between the triggers and between the history's rows; Enter opens a trigger; the Integrations link is followed with Enter; the confirm is reached with Space and left with Escape. |
| Live (AC7) | A `trigger_fired` and a `wakeup_scheduled` event from the fixture update the timeline and the open history with no reload and no skeleton; the boxes of the timeline entries, the trigger rows, the history rows and the detail pane already shown are identical before and after. A `trigger_toggled` from elsewhere flips the switch and adds the trigger to the timeline. |
| Names (AC8) | Every switch, chip, button and badge has an accessible name or text; the lists, table and groups are labelled; every `<time>` carries its instant. |

Two things made the AC7 check fail and were fixed or reverted. On its first run the timeline and the trigger list shared one scrolling column, and a new timeline entry pushed the trigger rows down 58 px; that is why the left pane is now two regions of equal height that scroll on their own. Then, as a pin mutation, the schedule read was made to clear the held data at the start of every refetch (the screen flashes its loading state): the check failed with "the screen never flashed a loading state" and the change was reverted.

## Departures from the mockup

- **The sidebar says "Schedules", not "Schedules & triggers".** The shell's entry keeps `nav.label: "Schedules"` (pinned by `app/src/App.test.tsx`); the title bar, which is the screen's `title`, says "Schedules & triggers" as the mockup does.
- **The reason codes are the ones the kernel records, shown verbatim.** The mockup's history badges use `missed_paused` and `missed_kill_switch`, which are `triggers.last_result` codes. The `trigger_missed` events record `paused` and `kill_switch`, and the route passes them through, so the badge reads "missed · paused" and the mono line beneath shows `paused`. A reason the screen has no label for is shown as is, under a neutral "missed" badge.
- **No wake-up history.** The mockup draws wake-up rows in the firing history. No route serves wake-up history (`docs/DESIGN.md` open point 10), so history is per trigger and wake-ups appear only in the upcoming timeline.
- **Repeats are grouped.** A run of consecutive rows of one kind and reason is one row: the count ("×4", spoken as "4 times") and the first and last time in the Trigger column. The mockup lists every fire.
- **The left pane is two regions, not one column.** The mockup stacks "Upcoming" and "Triggers" in one scrolling column. A new timeline entry then pushes every trigger row down (the AC7 check showed it), so each region has half of the pane's height and scrolls on its own. With more than about four entries or six triggers a region scrolls.
- **"Upcoming", not "Upcoming · today".** The route returns the next fires whatever day they fall on, and the timeline's time column says "20:21" for today and "6 Nov" after.
- **A Refresh button, and "Not fired · 7+".** The toolbar has a Refresh button (the palette's "Refresh schedule", reachable without ⌘K); while older pages exist the chip counts say "10+" because the count is of the fires loaded.
- **The unreachable view shows the shell's band only.** The mockup's band has a "Kernel log" link; the shell's shared band has none. The screen draws no band of its own.
- **The confirm dialog is the design system's `decision` Dialog** (Cancel with the `Esc` chip, a primary "Turn on and fire now"), because the mockup has no view for it. It is not a destructive confirm, so Escape closes it.
- **Row text clips.** Timeline entries, trigger rows and history rows have fixed heights so a refetch moves nothing; a long name ends in an ellipsis.

## Limits

- **The ⌘K palette and ⌘8 are not reachable in the built app.** The shell does not mount the command palette or bind the screen shortcuts (probed on 2026-10-30, as in phase 6). The screen registers "Show missed fires" and "Refresh schedule" under owner `schedules` while it is mounted and unregisters them on unmount; that is pinned in `app/src/screens/schedules/SchedulesScreen.test.tsx` (jsdom), not driven in Electron. "Show missed fires" only sets the history's filter and focuses its chip: registered while the screen is mounted, it cannot open the screen from elsewhere.
- **The fixture's routes are the shared interface, not the kernel's.** The real routes (`kernel/src/gui/schedules.ts`) are covered by `kernel/test/gui-schedules.test.ts`; the fixture pages by 10, not the kernel's default 50, so three pages show "Load older".
- **The unreachable capture is of a kernel that was running and went away.** With no data ever read, the screen says "Status unknown" instead (pinned in jsdom).
- All screenshots come from one machine (macOS). The Ubuntu CI run executes the same assertions but does not write these files.
