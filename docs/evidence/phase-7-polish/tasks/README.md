# Evidence: the Tasks screen (phase 7, item 03)

This is the polish-gate evidence for the Tasks screen: today's work as four columns ("Waiting on you", "Working", "Parked", "Done today"), each card opening to its history and its session's log. Every screenshot comes from the built app running against the fixture kernel, in light and dark mode. They are evidence for the owner's review, not visual-regression baselines: the spec never compares pixels.

- Screen: [`TasksScreen.tsx`](../../../../app/src/screens/tasks/TasksScreen.tsx) (discovered through [`index.tsx`](../../../../app/src/screens/tasks/index.tsx)), its views [`TasksViews.tsx`](../../../../app/src/screens/tasks/TasksViews.tsx), the open card [`TaskDetail.tsx`](../../../../app/src/screens/tasks/TaskDetail.tsx) and [`useOpenCard.ts`](../../../../app/src/screens/tasks/useOpenCard.ts), [`tasks.css`](../../../../app/src/screens/tasks/tasks.css), and the one home of the state-to-column table [`model.ts`](../../../../app/src/screens/tasks/model.ts)
- Unit tests: [`TasksScreen.test.tsx`](../../../../app/src/screens/tasks/TasksScreen.test.tsx), [`model.test.ts`](../../../../app/src/screens/tasks/model.test.ts)
- e2e: [`tasks.spec.ts`](../../../../app/e2e/tasks.spec.ts) over the fixture [`fixtures/tasks.ts`](../../../../app/e2e/fixtures/tasks.ts), which answers `GET /tasks` and `GET /tasks/:kind/:id` in the form the kernel's `tasks` part sends
- Mockup: [`docs/design/mockups/gui-v2.html`](../../../design/mockups/gui-v2.html), the views `tasks-empty` to `tasks-history`

## How they were produced

```sh
cd app
npm run build
TASKS_EVIDENCE=1 npx playwright test e2e/tasks.spec.ts --workers=1 -g AC11
```

The spec writes screenshots here only when **`TASKS_EVIDENCE=1`** is set. Before writing, it deletes every `*.png` in this folder, so the folder always matches the current states. Without the flag, the screenshots go to Playwright's per-test output directory, so a plain `npm run e2e` (locally or in CI) never changes the tree. Each one is a full-window screenshot (1180×760 at 2x, macOS, Electron 44) taken with `data-theme="light"` and then `data-theme="dark"` set on `<html>`. Before taking either, the spec checks that `color-scheme` reads that theme and that the ground colour differs between the two. The last test checks that this README lists exactly the fourteen files below and that the folder holds nothing else.

Times on the cards are real (the fixture's cards were stamped a few minutes before the run, never before today's midnight), so they differ from run to run.

## Screenshots

| Light | Dark | Mockup view id | State and how it was produced |
|---|---|---|---|
| [light](empty-light.png) | [dark](empty-dark.png) | `tasks-empty` | **Empty.** The fixture kernel answers `GET /tasks` with no group. The screen shows "No tasks yet." with the mockup's note and the "Ask Wright" button, never an empty board. |
| [light](loading-light.png) | [dark](loading-dark.png) | `tasks-loading` | **Loading.** The fixture holds `GET /tasks` open, so the first read stays in flight: four skeleton columns (never a spinner) and a "Loading tasks" status line. |
| [light](populated-light.png) | [dark](populated-dark.png) | `tasks-populated` | **Populated.** Eight cards: three working (a task, a playbook run, an ad hoc session), a parked task and an interrupted session, and three done today (a done task, a failed run, a stopped session). Nothing waits on the owner, so there is no attention band. |
| [light](waiting-light.png) | [dark](waiting-dark.png) | `tasks-waiting` | **Waiting on you.** The populated board plus a task in state `waiting` and a session in `failed:auth` (paused on the token). The column takes the attention style and the attention band counts "2 things wait on you." |
| [light](error-light.png) | [dark](error-dark.png) | `tasks-error` | **Error.** The kernel answers, but `GET /tasks` returns 500 `store_unreadable`. The failure card sits inside the screen with the route, status and code, and a "Try again" button. The shell's band does not show, as in the mockup. |
| [light](unreachable-light.png) | [dark](unreachable-dark.png) | `tasks-unreachable` | **Kernel unreachable.** The fixture's `GET /status` answers 503 from the start, so the shell's `kernel-unreachable-band` shows while `GET /tasks` still answers. The board keeps its cards, the subtitle reads "last known", and every card is disabled. |
| [light](history-light.png) | [dark](history-dark.png) | `tasks-history` | **History.** The working task is opened: crumb with Back, its facts, its four history events oldest first, and its session's live log in `StreamingLog` (Read latest, Stop, Kill, the caret and the "Following" pill). |

## Differences from the mockup, on purpose

- **Stop and Kill appear on an open card with a live session.** The mockup's history view shows none and says "Tasks has no command of its own". The requirement says Stop and Kill reuse phase 5's session routes, so they sit in the log bar (`StreamingLog`'s own buttons) and `tasks.stop` / `tasks.kill` are in the palette, registered only while such a card is open. Kill asks first. This is for the owner's approval of the PR (D9).
- **A session card has no title in the kernel**, so it is named by its agent and what it ran from ("ada · ad hoc session", "mason · playbook #4"). The mockup's invented titles ("Ada · Weekly changelog draft") and its `why` lines are not in the contract. The app adds one line only: `failed:auth` says "Paused: the subscription token was refused.", as the brief's mapping states.
- **The "Done today" dot is neutral, not green.** That column holds failed and stopped cards too, and green means only what the kernel recorded as done. The badges follow the mockup's tones.
- **The empty state's subtitle is "0 tasks"** whenever the board is empty, including while the kernel is away, because the empty state takes no props. The shell's band still says so.
- **Cards are real buttons with `aria-disabled`** (not the native `disabled`) while the kernel is away, so focus is never lost to the page.

## What the spec checks besides the screenshots

| AC | What it asserts in the running app |
|---|---|
| AC4 | The four columns in the mockup's order, each a labelled region. Cards land where the state table puts them. Each card is named "Kind id: title, state". Green (`ok`) is on exactly task `done`, run `done` and session `completed`; `failed` and `failed:auth` are danger; `stopped` is neutral. An unknown task state ("Waiting On Review") is in Working, neutral, in the kernel's own words. A session or task that ended yesterday is not on the board. |
| AC5 | With no rows: "No tasks yet.", the note and the button, and no board. |
| AC6 | Enter on a card opens it: facts, four history events oldest first, and the session's log read after seq 0 and then after the last seq when the feed announces `session_output_appended` for it. Stop sends one `POST /sessions/41/stop` and the log header shows the kernel's answer (`stopped · owner_stop`). Kill asks first: Esc leaves the confirm open, Cancel sends nothing, confirming sends one POST. A card with no session shows the "no log yet" note. Back and Esc return with focus on the card. |
| AC7 | The fixture closes under the open window: the reconnecting band shows, the subtitle reads "last known", the cards are disabled and a click does not open one, and the empty state never shows. With `GET /status` failing from the start, the shell's `kernel-unreachable-band` shows over the populated, disabled board. With no kernel at all, the screen says the kernel isn't answering instead of "No tasks yet.". |
| AC8 | J, K and the arrows move focus card by card across the column boundaries. Enter opens, Tab reaches Back, Stop and Kill, and Esc returns. ⌘6 and ⌘K are not in a launched window (the shell mounts neither the palette nor the keyboard map), so `TasksScreen.test.tsx` pins ⌘6 through `installKeyboardMap` and the two palette commands against the registry. |
| AC9 | A `task_updated` event refetches `GET /tasks` exactly once and the card moves from Working to Done today without a reload. The parked card is the same element with the same bounding box, and the four column headers keep theirs. `session_output_appended` refetches nothing; `session_status` does. |
| AC10 | Every card has an accessible name; the four columns are labelled regions; every badge has text; the log is `role="log"` with a label. Title, kind line, meta line and badge text are at least 4.5:1 in light and dark. `tasks.css` holds no hex, `rgb(` or `hsl(` (a unit test reads the file). |
| AC11 | This README lists exactly the fourteen files above, one pair per mockup view id, and the folder holds nothing else. |

## Findings for the owner

1. **The kernel closes no set of task states** (the mockup's open point). The board maps `waiting`, `working`, `parked` and `done`, and puts every other word in Working, neutral, verbatim. If the kernel closes the set, `model.ts` is the one place to change.
2. **An unknown run or session status also goes to Working**, neutral. The brief fixes this only for a task's free text; the same rule keeps a status a newer kernel adds visible rather than hidden.
3. **The shell mounts no palette and no ⌘ keys**, so a launched window cannot be driven by ⌘6 or ⌘K; that is covered in unit tests only.
4. **`GET /tasks` is read once, at its largest page (200).** If the kernel has more, the screen says "Showing the newest 200 cards; older ones are not shown." and does not page.
