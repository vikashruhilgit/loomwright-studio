# GUI v2 mockup: screenshot, token and field-map evidence (phase 7 item 02)

These are screenshots of every designed view of `docs/design/mockups/gui-v2.html`, in light and dark (51 views, 102 images), plus the audit of its token block and of every value outside it, and the map from every field the mockup shows to a kernel column, a route or a shape phase 7 item 01 declares. The mockup is static: it runs no kernel and makes no GitHub call. Each view is forced by the URL hash (`#view=<view>&theme=<light|dark>`), so each screenshot comes from one headless-browser command. No script is committed. The owner approves the design by merging the PR that adds it (D9). What the mockup commits items 03–09 to, and the open points for the owner, are in `docs/DESIGN.md` §["Phase 7: GUI v2"](../../DESIGN.md#phase-7-gui-v2). The Integrations screen, its GitHub token views and its GitHub App views are approved in `integrations.html` (see [the phase 6 evidence](../phase-6-integrations-mockup/README.md) and [the GitHub App evidence](../github-app-mockup/README.md)) and are not redrawn here; the Integrations views below add only the proposed token-to-App path.

## Screenshots

Each image is the full page: the intro line, the 1180×760 window, and the review strip under it with the forced view highlighted in its screen's group. The viewport is 1280×1000 CSS px. Every view is also reachable from the review strip.

### Tasks

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `tasks-empty` | The designed empty state: "No tasks yet.", one body paragraph and one primary action, Ask Wright | [gui-v2-tasks-empty-light.png](gui-v2-tasks-empty-light.png) | [gui-v2-tasks-empty-dark.png](gui-v2-tasks-empty-dark.png) |
| `tasks-loading` | Four columns of skeleton cards under their column labels; `aria-busy` with a "Loading tasks" status | [gui-v2-tasks-loading-light.png](gui-v2-tasks-loading-light.png) | [gui-v2-tasks-loading-dark.png](gui-v2-tasks-loading-dark.png) |
| `tasks-populated` | The board: four columns (Waiting on you, Working, Parked, Done today) holding the three card kinds (task, playbook run, session). Waiting on you is empty, with its own line | [gui-v2-tasks-populated-light.png](gui-v2-tasks-populated-light.png) | [gui-v2-tasks-populated-dark.png](gui-v2-tasks-populated-dark.png) |
| `tasks-waiting` | The same board with the two cards that wait on you in the first column (an `attention` edge): a task from Wright and a session paused on a refused token. A band says so | [gui-v2-tasks-waiting-light.png](gui-v2-tasks-waiting-light.png) | [gui-v2-tasks-waiting-dark.png](gui-v2-tasks-waiting-dark.png) |
| `tasks-error` | A route failure inside the screen body (`tasks request` · 500), with Try again and Kernel log. The shared band does not appear with it | [gui-v2-tasks-error-light.png](gui-v2-tasks-error-light.png) | [gui-v2-tasks-error-dark.png](gui-v2-tasks-error-dark.png) |
| `tasks-unreachable` | The shared `Kernel unreachable` band over the last-known board; the cards are disabled; the subtitle says "last known" | [gui-v2-tasks-unreachable-light.png](gui-v2-tasks-unreachable-light.png) | [gui-v2-tasks-unreachable-dark.png](gui-v2-tasks-unreachable-dark.png) |
| `tasks-history` | The click-through for Task #9: its facts, its history as EventCards, and its session log (StreamingLog) with the `live` badge and the streaming caret | [gui-v2-tasks-history-light.png](gui-v2-tasks-history-light.png) | [gui-v2-tasks-history-dark.png](gui-v2-tasks-history-dark.png) |

### Playbooks

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `playbooks-empty` | The empty state: "No playbooks yet." and one action, Ask Wright for the first one | [gui-v2-playbooks-empty-light.png](gui-v2-playbooks-empty-light.png) | [gui-v2-playbooks-empty-dark.png](gui-v2-playbooks-empty-dark.png) |
| `playbooks-loading` | Three skeleton rows | [gui-v2-playbooks-loading-light.png](gui-v2-playbooks-loading-light.png) | [gui-v2-playbooks-loading-dark.png](gui-v2-playbooks-loading-dark.png) |
| `playbooks-populated` | The Table: intent, trigger, dedupe key, priority, model, mode, last run, tokens today against the limit with "≈ … at API rates", and the on/off switch, for three playbooks | [gui-v2-playbooks-populated-light.png](gui-v2-playbooks-populated-light.png) | [gui-v2-playbooks-populated-dark.png](gui-v2-playbooks-populated-dark.png) |
| `playbooks-waiting` | The same Table with a draft playbook (Weekly changelog draft) marked "draft · waiting on you" and a band that links to it | [gui-v2-playbooks-waiting-light.png](gui-v2-playbooks-waiting-light.png) | [gui-v2-playbooks-waiting-dark.png](gui-v2-playbooks-waiting-dark.png) |
| `playbooks-error` | A route failure card (`playbooks request` · 500) | [gui-v2-playbooks-error-light.png](gui-v2-playbooks-error-light.png) | [gui-v2-playbooks-error-dark.png](gui-v2-playbooks-error-dark.png) |
| `playbooks-unreachable` | The shared band over the last-known Table; switches and the Ask Wright button are disabled | [gui-v2-playbooks-unreachable-light.png](gui-v2-playbooks-unreachable-light.png) | [gui-v2-playbooks-unreachable-dark.png](gui-v2-playbooks-unreachable-dark.png) |
| `playbooks-detail` | One playbook: intent, the policy fields with who set each, the trigger with next fire and last result, the on/off switch, tokens today with a meter and "≈ at API rates", recent runs, Edit in English, Edit fields and Version history | [gui-v2-playbooks-detail-light.png](gui-v2-playbooks-detail-light.png) | [gui-v2-playbooks-detail-dark.png](gui-v2-playbooks-detail-dark.png) |
| `playbooks-edit` | Field-level edit: eight fields, each with who set it; two changed (priority, token limit) and shown in a DiffView; Save as v4. Saving an enabled playbook makes it a draft again, and the note says so | [gui-v2-playbooks-edit-light.png](gui-v2-playbooks-edit-light.png) | [gui-v2-playbooks-edit-dark.png](gui-v2-playbooks-edit-dark.png) |
| `playbooks-edit-refused` | Field-level edit with three fields the kernel would refuse: an empty name, an empty intent (spaces only) and a dedupe key `{repo}#{pr}`, which is outside the kernel's closed set of seven key fields. Each shows its reason in `danger` under the field (`aria-invalid`, `aria-describedby`) and Save as v4 is disabled | [gui-v2-playbooks-edit-refused-light.png](gui-v2-playbooks-edit-refused-light.png) | [gui-v2-playbooks-edit-refused-dark.png](gui-v2-playbooks-edit-refused-dark.png) |
| `playbooks-history` | Version history: the versions list (v3 current) and the changes in v3 as a DiffView, read-only | [gui-v2-playbooks-history-light.png](gui-v2-playbooks-history-light.png) | [gui-v2-playbooks-history-dark.png](gui-v2-playbooks-history-dark.png) |

### Schedules & triggers

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `schedules-empty` | The empty state: "Nothing is scheduled." and one action, Ask Wright to schedule something | [gui-v2-schedules-empty-light.png](gui-v2-schedules-empty-light.png) | [gui-v2-schedules-empty-dark.png](gui-v2-schedules-empty-dark.png) |
| `schedules-loading` | Four skeleton rows | [gui-v2-schedules-loading-light.png](gui-v2-schedules-loading-light.png) | [gui-v2-schedules-loading-dark.png](gui-v2-schedules-loading-dark.png) |
| `schedules-populated` | The timeline of upcoming wake-ups, polls and cron fires; the five triggers with their switches; and the firing history with each missed fire's reason (`missed_paused`, `missed_kill_switch`, `rate_limited`, `connector_missing`, `source_error`) | [gui-v2-schedules-populated-light.png](gui-v2-schedules-populated-light.png) | [gui-v2-schedules-populated-dark.png](gui-v2-schedules-populated-dark.png) |
| `schedules-error` | A route failure card (`schedule request` · 500) | [gui-v2-schedules-error-light.png](gui-v2-schedules-error-light.png) | [gui-v2-schedules-error-dark.png](gui-v2-schedules-error-dark.png) |
| `schedules-unreachable` | The shared band over the last-known schedule; the trigger switches are disabled | [gui-v2-schedules-unreachable-light.png](gui-v2-schedules-unreachable-light.png) | [gui-v2-schedules-unreachable-dark.png](gui-v2-schedules-unreachable-dark.png) |

### Memory

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `memory-empty` | The empty state: "Nothing remembered yet.", with the memory path and one action, Ask Wright | [gui-v2-memory-empty-light.png](gui-v2-memory-empty-light.png) | [gui-v2-memory-empty-dark.png](gui-v2-memory-empty-dark.png) |
| `memory-loading` | A skeleton file list and a skeleton pane | [gui-v2-memory-loading-light.png](gui-v2-memory-loading-light.png) | [gui-v2-memory-loading-dark.png](gui-v2-memory-loading-dark.png) |
| `memory-populated` | The tree (Wright, Mason, Ada, Shared) with each file's size, and the "Pick a file" overview | [gui-v2-memory-populated-light.png](gui-v2-memory-populated-light.png) | [gui-v2-memory-populated-dark.png](gui-v2-memory-populated-dark.png) |
| `memory-file` | One file, `mason/lessons.md`: path, size, modified time, its content hash, the contents as read-only markdown source, and Edit | [gui-v2-memory-file-light.png](gui-v2-memory-file-light.png) | [gui-v2-memory-file-dark.png](gui-v2-memory-file-dark.png) |
| `memory-edit` | The edit view: a monospace textarea with the version it was opened at, a live DiffView of the owner's change, and Save | [gui-v2-memory-edit-light.png](gui-v2-memory-edit-light.png) | [gui-v2-memory-edit-dark.png](gui-v2-memory-edit-dark.png) |
| `memory-conflict` | The save was refused because the file changed since it was opened: the band, "On disk now" (accent edge) beside "Your edit", the diff between them, and four ways out (see who wrote it in the audit log, Discard my edit, Copy my version, Edit on top of the current version) | [gui-v2-memory-conflict-light.png](gui-v2-memory-conflict-light.png) | [gui-v2-memory-conflict-dark.png](gui-v2-memory-conflict-dark.png) |
| `memory-error` | A route failure card (`memory request` · 500) | [gui-v2-memory-error-light.png](gui-v2-memory-error-light.png) | [gui-v2-memory-error-dark.png](gui-v2-memory-error-dark.png) |
| `memory-unreachable` | The shared band over the last-known tree; the file list is disabled | [gui-v2-memory-unreachable-light.png](gui-v2-memory-unreachable-light.png) | [gui-v2-memory-unreachable-dark.png](gui-v2-memory-unreachable-dark.png) |

### Budget & audit

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `budget-empty` | The empty state: "No tokens used yet." with limits named in tokens and sessions at once, never dollars | [gui-v2-budget-empty-light.png](gui-v2-budget-empty-light.png) | [gui-v2-budget-empty-dark.png](gui-v2-budget-empty-dark.png) |
| `budget-loading` | Four skeleton rows | [gui-v2-budget-loading-light.png](gui-v2-budget-loading-light.png) | [gui-v2-budget-loading-dark.png](gui-v2-budget-loading-dark.png) |
| `budget-populated` | Tokens counted per day (cache reads shown, not counted); by agent against its daily limit and sessions at once; by playbook against its daily limit; the latest three audit events; the two subscription cap windows with their reset times; and today's total with its dollar estimate labelled "≈ at API rates" | [gui-v2-budget-populated-light.png](gui-v2-budget-populated-light.png) | [gui-v2-budget-populated-dark.png](gui-v2-budget-populated-dark.png) |
| `budget-waiting` | Ada has used its whole daily limit: its meter is full (`attention`) with an "at limit" Badge, its row is marked, and a band says its new sessions wait and where to raise the limit | [gui-v2-budget-waiting-light.png](gui-v2-budget-waiting-light.png) | [gui-v2-budget-waiting-dark.png](gui-v2-budget-waiting-dark.png) |
| `budget-error` | A route failure card (`usage request` · 500) | [gui-v2-budget-error-light.png](gui-v2-budget-error-light.png) | [gui-v2-budget-error-dark.png](gui-v2-budget-error-dark.png) |
| `budget-unreachable` | The shared band over the last-known usage; "Audit log" and the audit links are disabled | [gui-v2-budget-unreachable-light.png](gui-v2-budget-unreachable-light.png) | [gui-v2-budget-unreachable-dark.png](gui-v2-budget-unreachable-dark.png) |
| `budget-audit` | The full event log, newest first: Kind, Agent, Playbook and Time range filters, 8 rows a page (page 1 of 3), Newer and Older, and the append-only note | [gui-v2-budget-audit-light.png](gui-v2-budget-audit-light.png) | [gui-v2-budget-audit-dark.png](gui-v2-budget-audit-dark.png) |
| `budget-audit-filtered` | The log filtered to Mason and Review PRs on studio-sandbox: "8 of 20 events", a `filtered` Badge, Clear filters enabled | [gui-v2-budget-audit-filtered-light.png](gui-v2-budget-audit-filtered-light.png) | [gui-v2-budget-audit-filtered-dark.png](gui-v2-budget-audit-filtered-dark.png) |

### Settings

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `settings-empty` | The auth provider with no token yet: health `missing` with a `danger` dot, a band, and the three terminal commands that set it up. Launch at login, notifications and theme still show | [gui-v2-settings-empty-light.png](gui-v2-settings-empty-light.png) | [gui-v2-settings-empty-dark.png](gui-v2-settings-empty-dark.png) |
| `settings-loading` | Skeleton rows for the auth provider and the kernel; the app's own settings are already there | [gui-v2-settings-loading-light.png](gui-v2-settings-loading-light.png) | [gui-v2-settings-loading-dark.png](gui-v2-settings-loading-dark.png) |
| `settings-populated` | The auth provider read-only (provider, account, health `ok`, token created, token life, the Keychain item, never the value), the three terminal commands with Copy, the kernel (data location, notifier, Loomwright), and the app's own settings (launch at login, notifications, theme, keyboard map) | [gui-v2-settings-populated-light.png](gui-v2-settings-populated-light.png) | [gui-v2-settings-populated-dark.png](gui-v2-settings-populated-dark.png) |
| `settings-waiting` | The token expires in 18 days: an `attention` dot, a "renew soon" Badge and a band that points to the commands below | [gui-v2-settings-waiting-light.png](gui-v2-settings-waiting-light.png) | [gui-v2-settings-waiting-dark.png](gui-v2-settings-waiting-dark.png) |
| `settings-error` | A route failure card inside the auth provider section; the commands and the kernel sections are left out | [gui-v2-settings-error-light.png](gui-v2-settings-error-light.png) | [gui-v2-settings-error-dark.png](gui-v2-settings-error-dark.png) |
| `settings-unreachable` | The shared band over the last-known settings | [gui-v2-settings-unreachable-light.png](gui-v2-settings-unreachable-light.png) | [gui-v2-settings-unreachable-dark.png](gui-v2-settings-unreachable-dark.png) |

### Integrations (the token-to-App path)

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `integrations-token` | The token-connected detail with the proposed control: "Switch to GitHub App" with a `Proposal` Badge beside Replace token and Disconnect, and a note saying the token stays in use until the App connects | [gui-v2-integrations-token-light.png](gui-v2-integrations-token-light.png) | [gui-v2-integrations-token-dark.png](gui-v2-integrations-token-dark.png) |
| `integrations-token-to-app` | The switch dialog, step 1 of 2 (Create on GitHub): "waiting for you"; the row behind it reads "connected · token · setting up the App"; GitHub stays connected through the token | [gui-v2-integrations-token-to-app-light.png](gui-v2-integrations-token-to-app-light.png) | [gui-v2-integrations-token-to-app-dark.png](gui-v2-integrations-token-to-app-dark.png) |
| `integrations-token-to-app-install` | Step 2 of 2 (Install): step 1 `ok` with "done", step 2 `working` | [gui-v2-integrations-token-to-app-install-light.png](gui-v2-integrations-token-to-app-install-light.png) | [gui-v2-integrations-token-to-app-install-dark.png](gui-v2-integrations-token-to-app-install-dark.png) |
| `integrations-token-to-app-failed` | Setup didn't finish: nothing changed, GitHub is still connected through the token; Close and Set up again | [gui-v2-integrations-token-to-app-failed-light.png](gui-v2-integrations-token-to-app-failed-light.png) | [gui-v2-integrations-token-to-app-failed-dark.png](gui-v2-integrations-token-to-app-failed-dark.png) |
| `integrations-app-connected` | After the switch: connected through the GitHub App; the token item is gone; the App, the installation, the key, the access token's expiry with "renews automatically", permissions "checked by GitHub", and the repos chosen at install | [gui-v2-integrations-app-connected-light.png](gui-v2-integrations-app-connected-light.png) | [gui-v2-integrations-app-connected-dark.png](gui-v2-integrations-app-connected-dark.png) |
| `integrations-unreachable` | The shared band over the last-known token detail; Replace token, Switch and Disconnect are disabled; the status reads "unknown" | [gui-v2-integrations-unreachable-light.png](gui-v2-integrations-unreachable-light.png) | [gui-v2-integrations-unreachable-dark.png](gui-v2-integrations-unreachable-dark.png) |

### Keyboard map

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `keymap` | Every shortcut: screen shortcuts (⌘ and the browser-tab ⌃ form), the keys that work anywhere, and every palette command by screen | [gui-v2-keymap-light.png](gui-v2-keymap-light.png) | [gui-v2-keymap-dark.png](gui-v2-keymap-dark.png) |

### Screens without a waiting-on-you view

AC1 asks for a waiting-on-you view where it applies. Three screens have none, and one has its views elsewhere:

- **Schedules & triggers.** Nothing on this screen waits on a decision of yours. It reports what is due and what was missed. A missed poll that needs you (no connector) links to Integrations, whose own screen holds the action.
- **Memory.** No memory file waits on a decision of yours. The one case that needs you, a save refused because the file changed under you, is its own view, `memory-conflict`.
- **Keyboard map.** It shows no state of the kernel's.
- **Integrations.** Its waiting-on-you views (a token expiring, a token expired, a GitHub App revoked) are approved in `integrations.html` and are unchanged. This mockup adds only the switch path.

Tasks, Playbooks, Budget & audit and Settings each have one (`tasks-waiting`, `playbooks-waiting`, `budget-waiting`, `settings-waiting`).

## What was driven by hand

The views above are static. The paths between them were driven once in headless Chromium (Playwright 1.64.1) with a scratch script outside the repo (2026-10-30), after the last edit to the mockup:

- an odd hash falls back to the default view, `tasks-populated`: empty, `#`, `#view=bogus`, `#view=__proto__`, `#view=constructor`, `#view=toString`, `#view=hasOwnProperty`; a repeated `view` takes the first; a bad `theme` (`#view=memory-file&theme=bad`) keeps the view and leaves `data-theme` unset; `#theme=dark` alone keeps the default view and sets the theme. A live `hashchange` to `#view=__proto__` also falls back and does not throw;
- `Esc` closes a dialog and focus returns to the control that opened it: Edit in English on a playbook's detail → `Esc` → focus on "Edit in English". Tab and Shift+Tab inside that dialog stay inside it;
- the palette: `⌃K` opens it with focus in its input (40 items on Tasks), typing `audit` keeps three commands, `Esc` closes it and focus returns to the card that had it, `/` opens it too, "Keyboard map" + Enter opens the keyboard map, and a query with no match says so. The footer reads "Wright, powered by Claude";
- Memory: `mason/lessons.md` → Edit → type a line (the diff shows one added line and Save enables) → Save lands on `memory-conflict` with focus on the column, and the band, "On disk now" and "Your edit" show. "Edit on top of the current version" carries both the on-disk line and the owner's added line into the editor, and Save then writes it (toast "Saved memory/mason/lessons.md", back on the file view). "Discard my edit" returns to the file with a toast and focus on the sidebar's Memory row (the forced view had no opener). "See who wrote it in the audit log" opens the audit log filtered to `memory_updated` (1 row), and Back returns to the conflict with focus on that button. A file nobody else wrote (`ada/lessons.md`) saves without a conflict;
- Budget & audit filters: unfiltered is 20 of 20 events, 8 a page, 3 pages; Agent = Mason → 10; + Playbook = Review PRs → 8; + Kind = `admission_refused` → 0 with "No events match." and Clear filters; kind alone → 1; kind + Last hour → 0; Clear filters lands on the Kind select with 20 of 20; Older moves to "Showing 9–16 of 20 · page 2 of 3"; `#view=budget-audit-filtered` shows 8 of 20;
- Integrations, Switch to GitHub App: the button opens the dialog with "Open GitHub again" focused and GitHub still connected through the token; Tab cycles inside it (Cancel ↔ Open GitHub again); `Esc` closes it, shows "Setup cancelled. GitHub is still connected through your token." and returns focus to Switch to GitHub App; left alone it moves to step 2 after 2.5 s and to `integrations-app-connected` after another 2.5 s, with the toast and focus on the GitHub row; a click on the backdrop and `Esc` both cancel, and the pending steps never fire after a cancel (checked 5.6 s later: still the token view); from the failed view, "Set up again" restarts it and `Esc` on the failed view returns to the token view with focus on the GitHub row; `⌃K` → "switch" → Enter opens it and `Esc` returns focus to the GitHub row; in `integrations-unreachable` the Switch button is disabled;
- shortcuts: `⌃6` Tasks, `⌃7` Playbooks, `⌃8` Schedules & triggers, `⌃9` Memory, `⌃,` Settings, `⌃5` Integrations, and the same with `⌘`; `⌃1` (GUI v1's Chat) says it is in `gui-v1.html` and stays; `?` opens the keyboard map; Budget & audit has no digit (the sidebar shows a shortcut on every other screen); `J`/`K` move between cards and Enter opens one, with focus on Back and then back on the card;
- the keyboard map view lists the three tables (screens, keys that work anywhere, palette commands by screen).

The run reported 0 console errors.

## How to regenerate

Setup, once: the Playwright CLI at the version `app/package-lock.json` pins (1.64.1), with its Chromium:

```sh
cd app && npm ci && npx playwright install chromium
```

(These shots were taken with the same version, already installed in another checkout's `app/`, so this folder's `app/` was untouched.) Then, from `app/`, each shot is one command. `<repo>` is the absolute path of your checkout, `<v>` is a value from the `View` column above, and `<t>` is `light` or `dark`:

```sh
npx playwright screenshot --color-scheme=<t> --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/gui-v2.html#view=<v>&theme=<t>' <repo>/docs/evidence/gui-v2-mockup/gui-v2-<v>-<t>.png
```

For example, `playbooks-edit` in dark:

```sh
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/gui-v2.html#view=playbooks-edit&theme=dark' <repo>/docs/evidence/gui-v2-mockup/gui-v2-playbooks-edit-dark.png
```

To regenerate all 102 (bash, from `app/`):

```sh
for v in tasks-empty tasks-loading tasks-populated tasks-waiting tasks-error tasks-unreachable tasks-history playbooks-empty playbooks-loading playbooks-populated playbooks-waiting playbooks-error playbooks-unreachable playbooks-detail playbooks-edit playbooks-edit-refused playbooks-history schedules-empty schedules-loading schedules-populated schedules-error schedules-unreachable memory-empty memory-loading memory-populated memory-file memory-edit memory-conflict memory-error memory-unreachable budget-empty budget-loading budget-populated budget-waiting budget-error budget-unreachable budget-audit budget-audit-filtered settings-empty settings-loading settings-populated settings-waiting settings-error settings-unreachable integrations-token integrations-token-to-app integrations-token-to-app-install integrations-token-to-app-failed integrations-app-connected integrations-unreachable keymap; do
  for t in light dark; do
    npx playwright screenshot --color-scheme=$t --viewport-size=1280,1000 --full-page --wait-for-timeout=600 "file://<repo>/docs/design/mockups/gui-v2.html#view=$v&theme=$t" "<repo>/docs/evidence/gui-v2-mockup/gui-v2-$v-$t.png"
  done
done
```

The hash's `theme` sets `data-theme` on the page, and `--color-scheme` matches it, so a shot never depends on the host's appearance setting. `--wait-for-timeout=600` lets the dialog's open animation (`duration-slow`, 240ms) finish; the switch dialog's two-step timer (2.5 s each) has not fired by then, and the forced `…-install` view does not start one. The `working` dots animate, so their frame can differ by a few pixels in a regenerated shot.

## Token audit

### The token block is the generator's output, verbatim

The mockup's `<style>` opens with the stdout of `node app/scripts/tokens.mjs`, pasted between the `/* tokens:begin */` and `/* tokens:end */` comment lines. Generator names are used throughout (`--radius-lg`, `--duration-base`, `--ease-standard`, `--space-4`, `--type-body-size`), never gui-v1's short forms (`--r-lg`, `--d-base`, `--ease`). To check, run this from the repo root (bash, for the process substitution):

```sh
diff <(node app/scripts/tokens.mjs) <(awk '/\/\* tokens:end \*\//{f=0} f; /\/\* tokens:begin \*\//{f=1}' docs/design/mockups/gui-v2.html); echo "exit $?"
```

Result, 2026-10-30: no diff output, then `exit 0`. The block is 195 lines, the same as the generator's stdout. `grep -n -E "var\(--(r-[a-z]+|d-[a-z]+|ease)\)" docs/design/mockups/gui-v2.html` prints nothing: no short-form name is used.

### Values outside the block

The rest of the `<style>` is in two parts. The **harness** block (`harness:begin` … `harness:end`) is the same as `integrations.html`'s. The **app UI** part uses `var(--…)` tokens, plus the literals below.

The table names every literal value outside the token block, found by listing each number and colour in the CSS outside the block (a script over every declaration, with `var(...)` removed), plus the values the script passes inline. Structural values are not listed: `0`, `100%`, `1fr`, `auto`, `max-content`, `minmax(0, 1fr)`, `flex: 1`, `grid-row: 2`, `repeat(4, …)` (the board's four columns), `repeat(2, …)` (the conflict's two) and `-webkit-line-clamp: 2` lay out the page and carry no design value. The colour keywords `transparent` and `currentColor` are structural too. Lucide icon geometry (the `d` paths) and the avatar shapes are drawing data, not styles; the GitHub mark is copied from `integrations.html`.

| Value | Where | Marking |
|---|---|---|
| `--desk` `#3a3d52` / `#101118`, `--desk-ink` `#eef0ff` / `#d9dbef` | The desk the window sits on, the intro line and the review strip (light / dark) | review-harness chrome (not app UI) |
| `--win-shadow` `0 24px 80px #00000059, 0 0 0 1px #00000026` / `0 24px 80px #000000b3, 0 0 0 1px #ffffff1f` | The window's drop shadow on the desk, applied to `.win` | review-harness chrome (not app UI) |
| `#ff5f57`, `#febc2e`, `#28c840`; 12px circles at `50%` radius, `8px` gap and padding | The macOS traffic lights (the real app gets them from the OS) | review-harness chrome (not app UI) |
| `#ffffff14`, `#ffffff33`, `#ffffff26`, `#ffffff1f` | Review strip fill, borders, the selected segment and the key chips | review-harness chrome (not app UI) |
| `1240px`, `26px`, `12px`, `15px`, `20px`, `16px`, `24px`, `-16px`, `10px`, `18px`, `6px`, `5px`, `4px`, `1px`, `2px`; opacity `.7`, `.75`, `.9`; weights `500`, `600`; `max-width: 1280px` media query | Page, intro and review-strip sizes, type, padding, gaps, radii and focus ring; the breakpoint under which the intro and the strip go full width | review-harness chrome (not app UI) |
| `1180px` × `760px` | The window | new — the default window size; gui-v1 and phase 5's polish evidence ("The default window is 1180×760") |
| `blur(24px) saturate(1.4)` | Sidebar vibrancy | new — specified in `brand-book.md` §Layout; tokens.json has no filter values |
| `1px` | Hairline and border widths; the timeline rail's width; the visually hidden live region's size | new — component READMEs specify "a `hairline` edge"; tokens.json has edge colours but no widths |
| `2px` | Focus ring width and offset; the `idle` ring's stroke; the switch knob's inset | new — `brand-book.md` §Colour: "2px solid with a 2px offset"; the StatusDot idle ring as in gui-v1; the knob sits 2px in from each edge of its track (see the switch row) |
| `8px` (and `calc((var(--type-body-line) - 8px) / 2)`) | StatusDot size; the list row's dot column; centring the dot on the subject line | new — StatusDot README: "An 8px dot" |
| `16px`, `14px`, `12px`; stroke widths `1.5`, `1.75`, `2` | Lucide icon sizes (rows, buttons and badges, checks) and the GitHub mark (16px) | new — `brand-book.md` §Iconography (16px at 1.5px stroke; 14px in badges); gui-v1's icon classes |
| `20px` | Badge height; the timeline's pip (a 20px disc) and its column; the DiffView's marker column; the small Avatar size (inline `--s`) | new — Badge README: "All 20px tall"; the pip, the gutter and the avatar reuse the Badge's size, and 20px is List README's small Avatar |
| `24px` | The numbered steps' number column; the Avatar size on memory files and the grant card (inline `--s`) | new — List README (24px Crew avatar); the steps column fits a Badge's number |
| `32px` | Avatar's default `--s` | new — `avatar.css` default |
| `32px` × `18px`, knob `14px`, `translateX(14px)`, opacity `.5` when disabled | The on/off switch (Table's On column, trigger rows, Settings) | new — differs from Table README's 26×16: this one is larger so the row's switch is easier to hit. The owner may revert to 26×16, a one-line change per value (open point 13 in DESIGN.md) |
| `44px` | Crew row height; the palette's search row; the StreamingLog's bar; the Playbooks table's On column | new — List README (44px Crew rows), CommandPalette README ("a 44px search row"), gui-v1's log bar; the On column is switch + padding |
| `10px` | A skeleton line's height | new — gui-v1's skeleton (`.skel i`, 10px) |
| `70%`, `40%` | A skeleton card's second and third line widths | new — gui-v1's skeleton rhythm (short last lines) |
| `4px` | The usage meter's height | new — differs from Card README's 3px meter: the usage tables show a meter per row at full width, and 4px stays visible beside 14px type. Open point 13 in DESIGN.md |
| `7px` × `14px`, `-2px` | The streaming caret (a block) and its baseline nudge | new — the caret reads in a mono line; gui-v1's is a 2px bar for Chat's text |
| `68px` | The StreamingLog's time column | new — a `HH:MM` in `mono` plus a gap |
| `52px` | The timeline's time column; the audit table's Id column | new — a `HH:MM` or an event id in tabular figures |
| `150px` | The field-level edit's label column; the Policy list's label column; the audit filters' minimum control width; the Schedules history's Result column, the Budget day table's first column and the keyboard map's second column | new — the longest label ("Token limit per day") plus a gap |
| `72px` | The textarea's minimum height (three lines) | new — three body lines of `--type-body-line` |
| `480px`, `560px`, `360px`, `20%` | Dialog width (and the route-failure card's maximum width), the wide Dialog and the palette width, the toast width and the palette list's maximum height, the palette's offset from the top | new — Dialog README ("360px (480px when it carries a diff)"); `560px` for the switch dialog with steps; CommandPalette README ("560px", "centred at 20% from the top"); Toast README ("360px") |
| `65ch`, `44ch` | Maximum width of the empty state's lines; of the "no session log" line | new — `brand-book.md` §Type: "Running text stays under 65 characters"; 44ch keeps a two-line note narrow |
| `500` | Font weight of buttons, the selected sidebar row, the neutral badge, form labels and the pressed chip | new — List README ("weight 500" when selected), gui-v1's buttons and neutral badge; tokens.json defines 500 only for `kbd` |
| `.55`, `.85`, `50%` | The `working` dot's breathing keyframe (opacity, scale, midpoint) | new — gui-v1's StatusDot `pulse`; the duration is `--duration-pulse` |
| `.98` | Dialog and palette open scale | new — Dialog and CommandPalette READMEs: "scaling from 0.98" |
| `50`, `60` | Overlay and toast `z-index` | new — gui-v1's overlay stacking, the toast above it |
| `inset(50%)` | `clip-path` of the visually hidden live region and labels | new — the standard visually-hidden pattern for the `aria-live` announcer |
| Opacity `.28`, `.45`, `.85`; stroke widths `1.6`, `1.2`, `1.9`, `.8`; dash arrays `2.6 1.5`, `1.8 1.4`, `2.4 2.6` | The Avatar's fill, stitches, lines, loose thread and crown (static idle pose) | new — copied unchanged from `docs/design/avatar/avatar.css`; no avatar value is a token there either |
| `92`, `112`, `72`, `60`, `54`, `72`, `108`, `44` px (columns 2–9) | The Playbooks table's columns: Trigger, Dedupe key, Priority, Model, Mode, Last run, Tokens today, On (Playbook takes the rest) | new — Table README sets no widths; these fit the longest cell at `caption` size in a 1180px window |
| `84px`, `150px` | The Schedules firing-history columns: When, Result (Trigger takes the rest) | new — as above |
| `150px`, `170px` / `120px` / `52px`, `92px`, `190px`, `72px` / `210px`, `150px` | The Budget tables' first and third columns (day table; by-agent table's Sessions at once; audit table's Id, When, Kind, Actor) and the keyboard map's first and second columns | new — as above |
| `2500` ms, `4000` ms (script) | The mock setup's two step timers; how long a toast stays | new — mock behaviour only, not design durations (Toast README says a toast stays 6s or until hovered; the mock's is shorter so a review strip click never stacks them) |
| inline `width:<n>%` on `.meter i` (script) | Each meter's fill, from the data (usage over limit, share of the busiest day, cap utilisation) | new — data, not a style: it is the number the meter shows |
| inline `--s:20px`, `--s:24px` (script) | Avatar sizes on a card, a row or a header | new — List and Card READMEs' avatar sizes (20px small, 24px Crew) |

### New components and variants

The mockup uses List, Card, Badge, StatusDot, Dialog, Input, Toast, DiffView, StreamingLog, EventCard and Avatar, plus Button, CommandPalette and Table, as the design system defines them. Each class below is new, and each names its reason.

| Class | What it is | Marking |
|---|---|---|
| `.board`, `.bcol`, `.tcard`, `.tcard.wait` | The Tasks board and its card: four columns of cards of three kinds, one `attention` edge for a card that waits on you | new — a Card variant: Card's agent card is Team's; the board needs a compact card with the kind, a state Badge, the title and who it is for |
| `.fail`, `.fail.inl` | The route-failure card, bordered in `danger`, with the request, status and a retry; `.inl` is the same inside a section | new — AC1 needs an error state distinct from the shared band; no design-system component draws a failed request |
| `.empty`, `.skel` | The empty state and the loading skeleton | new — `brand-book.md` §States specify both; gui-v1 carries `.empty` and `.skel` |
| `.sw` | The on/off switch | new — Table README names a switch (26×16); this one is drawn at 32×18 (see the values table) |
| `.chipb` | A pressable filter chip (the history's All / Not fired; Settings' theme) | new — gui-v1 carries a chip; this one has `aria-pressed` |
| `.tl` | The timeline of upcoming fires and wake-ups: a time, a rail with a pip, an item | new — Schedules is the only screen with time-ordered items; no component draws one |
| `.runs`, `.facts`, `.kv`, `.pf`, `.fe` | A recent-runs list, a row of labelled facts, a definition list, the Policy list and the field-level form's grid | new — layout over Badge, StatusDot and Input; no new colour or type |
| `.list .lh.ag` | A tree group heading with an Avatar, in Memory's file tree | new — the memory tree groups files by agent, and List's heading has no Avatar slot |
| `.src`, `.src.cur` | A read-only markdown source block; with `.cur` its edge is `accent`, marking the version that is on disk now | new — no component shows raw text; DiffView shows changes only. The `accent` edge reuses the Card's "suggested" edge convention from the App choice |
| `.field textarea.mono` | The monospace textarea for a memory file | new — Input is one line; this is Input's chrome around a `mono` textarea |
| `.cmp` | The two-column conflict grid (on disk now beside your edit) | new — the conflict state needs two whole versions side by side; DiffView shows the difference below it |
| `.meter`, `.meter.full i` | The usage meter; at the limit its fill is `attention` | new — Card README's 3px meter turns `attention` from 80%; here it turns only at the limit, because a day's usage under its limit is not a warning. The owner may choose 80% (open point 13 in DESIGN.md) |
| `.dlg.wide`, `.dlg .band`, `.dlg .sech h2` | The 560px Dialog with a header row, and a band inside a Dialog | new — the switch dialog carries steps, a Badge and a failure band, so it uses a wider Dialog than Dialog README's 480px |
| `svg.mark` | The GitHub mark, in `ink` | new — copied from `integrations.html`; only the connector's label, as in the approved views |
| `.steps`, `.cmdline` | Numbered terminal commands, each with Copy | new — Settings shows the three setup commands; a command with a Copy button is not in Button or Input |
| `.fbar`, `.fctl` | The audit log's filter bar and one labelled control in it | new — Table README lists filters nowhere; this is a row of Input selects with labels |
| `.day`, `.bud`, `.aud`, `.km` column widths; `.km td .kbd + .kbd` | Table column widths for the day table, the by-agent table, the audit log and the keyboard map; the gap between two key chips in a cell | new — see the values table |
| `.crumb`, `.dhead`, `.sech`, `.blk`, `.box`, `.pad`, `.content`, `.inspector`, `.split`, `.pane` | Page layout: breadcrumb, header row, section header, block, bordered list, padding, the list-and-detail and inspector splits | new — layout only, over the window widths from tokens (`--list-pane-width`, `--inspector-width`) |

## Checks

Run from the repo root. Results are from 2026-10-30.

```sh
grep -n "Claude C[o]de" docs/design/mockups/gui-v2.html
grep -n -i -E "sign in|sign-in|signin|claude\.ai|type=\"password\"" docs/design/mockups/gui-v2.html
grep -n '\$[0-9]' docs/design/mockups/gui-v2.html
grep -n -i -E "#(24292f|2da44e|1f883d|238636|2ea043|0969da|f6f8fa|57606a|d0d7de|161b22|0d1117|8b949e|30363d|58a6ff|1a7f37|6e7781|eaeef2)\b" docs/design/mockups/gui-v2.html
```

- The first prints nothing (invariant 7): nothing says or looks like the Claude command-line tool (the `[o]` keeps this line from matching its own pattern, so the same grep over this README is clean too). The only attribution is "Wright, powered by Claude", in the palette footer.
- The second prints one line, a code comment in the Settings data (`there is no secret field and no sign-in`). Settings has no sign-in control, no OAuth button, no secret field and no `<input>` of its own (invariant 6): the auth provider is read-only, with its health, its token's state and the three terminal commands.
- The third prints nothing: there is no literal dollar figure. Every dollar estimate (Playbooks' Tokens today and detail, Budget & audit's Today) is built by one function that writes "≈$N.NN at API rates", so each one is beside "≈ … at API rates" (D24). Every limit is in tokens, or in sessions at once.
- The fourth prints nothing: no GitHub Primer colour.

## Field map (AC7)

Every data field a screen shows, and its source. A source is a kernel column at the base commit (`<migration file>: <table>.<column>`, migrations in `kernel/src/store/migrations/`), a route that exists at the base commit, or a shape phase 7 item 01's requirement declares in its Scope §1 (the route that serves it is named: items 03–08 each add the routes they read). Words the screen writes itself (empty-state copy, band copy, button labels) are copy, not fields, and are not listed. Open points are numbered and carried into `docs/DESIGN.md` §"Phase 7: GUI v2".

Existing routes at the base commit used below: `GET /status`, `GET /agents`, `GET /playbooks`, `GET /playbooks/:ref`, `POST /playbooks/:id/set`, `POST /playbooks/:id/off`, `GET /triggers`, `POST /triggers/:id/on|off`, `GET /sessions`, `GET /sessions/:id/output`, `GET /connectors`, `GET /events`, `GET /threads/:agent`, `POST /ask`.

### Every screen (the shell)

| Field | Source |
|---|---|
| Crew rows: name, avatar shape and hue | `014_agents.ts: agents.display_name, avatar_shape, avatar_hue` via existing `GET /agents`. Wright has no row: its look (the crowned whale in `accent`) is fixed in the app |
| Crew rows: last line | existing `GET /threads/:agent` (the newest item) |
| Sidebar footer: idle / kernel unreachable | the app's connection state (existing; `app/src/shell/KernelStates.tsx`), not a kernel field |
| The `Kernel unreachable` band and "last known" | the app's connection state; the last-read data is the app's cache |

### Tasks

| Field | Source |
|---|---|
| Card kind (Task, Playbook run, Session) and id | `001_initial.ts: tasks.id`; `013_playbooks.ts: playbook_runs.id`; `001_initial.ts: sessions.id`. Item 01's tasks list (item 03's `GET /tasks`) merges the three kinds; a session or a run is its own card only when no task owns it |
| Column (Waiting on you, Working, Parked, Done today) | `001_initial.ts: tasks.state` (free text, open point 1); `sessions.status`; `013_playbooks.ts: playbook_runs.status`. The grouping is the screen's; "Done today" also reads `tasks.updated_at` |
| Task title, kind | `001_initial.ts: tasks.title, tasks.kind` |
| Assignee (avatar and name) | `001_initial.ts: tasks.assignee_agent`, `sessions.agent`; a run's agent is `013_playbooks.ts: playbooks.owning_agent` via `playbook_runs.playbook`; name and look from `014_agents.ts: agents.*` |
| Card meta line ("since 14:10", "checks again 15:30", "13:20", "dry run · 14:16") | `001_initial.ts: tasks.created_at, next_check_at, updated_at, sessions.started_at, ended_at`; `013_playbooks.ts: playbook_runs.kind, started_at` |
| Session card title ("Ada · Weekly changelog draft", "Wright · direct thread") | derived: the agent's name, then the session's playbook (`013_playbooks.ts: sessions.playbook`) or task (`001_initial.ts: sessions.task_id`), else "direct thread" |
| Run card title | `013_playbooks.ts: playbooks.name` via `playbook_runs.playbook` |
| "Why" line on a session or run card (paused on a refused token, interrupted, GitHub answered an error) | derived from `001_initial.ts: sessions.status` (`failed:auth`, `interrupted`) and `013_playbooks.ts: playbook_runs.status, result_json`; the sentence is the screen's copy |
| Count in each column, the waiting band | derived from the cards |
| Task facts: State, Assignee, Kind, Dedupe key, Next check, Created, Updated | `001_initial.ts: tasks.state, assignee_agent, kind, dedupe_key, next_check_at, created_at, updated_at` |
| Run facts: Playbook, Run kind, Status, Version, Tokens, Dedupe key, Started, Ended | `013_playbooks.ts: playbook_runs.playbook (name from playbooks.name), kind, status, version, tokens, dedupe_key, started_at, ended_at` |
| Session facts: Agent, Status, Model, Started, Ended | `001_initial.ts: sessions.agent, status, model, started_at, ended_at` |
| History cards: kind, actor, time, text | `001_initial.ts: events.kind, actor, at, payload_json` for the task's or session's events (item 03's `GET /tasks/:kind/:id`). The cards labelled `session` and `playbook_run` come from `sessions` and `playbook_runs` rows, not from `events.kind` (the kernel writes `session_status` and no `playbook_run` event) |
| Session log: lines, times, the live / kept Badge, "Session N" | existing `GET /sessions/:id/output` (`016_session_output.ts: session_output.seq, kind, payload_json, created_at`); the Badge from `sessions.status`; a task's session is `001_initial.ts: tasks.owner_session_id`, a run's is `013_playbooks.ts: playbook_runs.session_id` |

### Playbooks

| Field | Source |
|---|---|
| Name, intent, slug | `013_playbooks.ts: playbooks.name, intent, slug` |
| Status (on / off / draft), version | `013_playbooks.ts: playbooks.status, version` |
| Trigger ("poll · every 10 min"), next fire, last result, "Fires on" | `011_phase_2_tables.ts: triggers.kind, spec_json, next_fire_at, last_result`, linked by `triggers.playbook`; existing `GET /playbooks/:ref` (`trigger`) and `GET /triggers` |
| Dedupe key | `013_playbooks.ts: playbooks.dedupe_key_spec`, stored as a JSON list of key fields from a closed set (`playbook.id`, `playbook.version`, `trigger.id`, `trigger.scheduled_at`, `date`, `item.id`, `item.revision`); shown as that list (see "Defects") |
| Priority, model, effort | `013_playbooks.ts: playbooks.priority, model, effort` |
| Mode | `017_phase_6_foundation.ts: playbooks.mode` (`draft` or `live`) |
| Token limit per day | `013_playbooks.ts: playbooks.token_limit_per_day` |
| "Set by you" / "proposed by Wright" on each policy field | `013_playbooks.ts: playbooks.dedupe_key_set_by, priority_set_by, model_set_by, effort_set_by, token_limit_set_by`; `017_phase_6_foundation.ts: playbooks.mode_set_by`. Name and intent have no `*_set_by` column, so the mockup shows none for them |
| Owner (avatar and name) | `013_playbooks.ts: playbooks.owning_agent`; `014_agents.ts: agents.*` |
| Last run, its kind | `013_playbooks.ts: playbook_runs.started_at, kind, status` (item 04's `GET /playbooks/:id/runs`) |
| Tokens today against the limit, the meter | `001_initial.ts: budget.counted_tokens` for `budget.playbook` and the day; limit as above |
| "≈ … at API rates" | `001_initial.ts: budget.cost_usd`, summed |
| Recent runs: kind, status, time, tokens | `013_playbooks.ts: playbook_runs.kind, status, started_at, tokens` (item 04's `GET /playbooks/:id/runs`) |
| Versions: number, time, "N fields changed", "by Wright / you", the DiffView | `013_playbooks.ts: playbook_versions.version, snapshot_json, created_at` (item 04's `GET /playbooks/:id/versions`). A snapshot is the whole `playbooks` row, `*_set_by` columns included, so the changes and who made them come from comparing two snapshots |
| Edit form: the draft of each field, the changes DiffView, Save as vN | the app's form state; the write is existing `POST /playbooks/:id/set` (open points 6 and 7) |
| Edit in English | no data; opens Wright's thread with the playbook named (existing `POST /ask`) |
| On / off switch | `playbooks.status`; off is existing `POST /playbooks/:id/off` (turning on: open point 8) |

### Schedules & triggers

| Field | Source |
|---|---|
| Upcoming: a poll's or cron's time, name, spec, agent | `011_phase_2_tables.ts: triggers.next_fire_at, kind, spec_json, owning_agent, playbook` (item 05's `GET /schedule`) |
| Upcoming: a wake-up's time, id, reason, task | `001_initial.ts: wakeups.due_at, id, reason, task_id` where `status = 'pending'` (item 05's `GET /schedule`; existing `GET /status` carries a bounded list) |
| Triggers list: label, spec, switch | `011_phase_2_tables.ts: triggers.playbook` (the label is the playbook's name), `spec_json`, `enabled`; a trigger with no playbook shows its `action` and `action_payload` (open point 10); the switch is existing `POST /triggers/:id/on|off` |
| Firing history: when, trigger, result | `001_initial.ts: events.at, kind, payload_json` for `trigger_fired` and `trigger_missed` (item 05's `GET /triggers/:id/fires`); the result words are `011_phase_2_tables.ts: triggers.last_result`'s closed set (`fired`, `missed_kill_switch`, `missed_paused`, `rate_limited`, `connector_missing`, `source_error`), here per fire |
| Firing history: the note ("1 new PR (#3). Task #9 created.", "The kill switch was on at the due time.") | derived from the event's payload; the sentence is the screen's copy |
| Firing history: a wake-up row | `001_initial.ts: wakeups.fired_at, status`; item 05's `GET /triggers/:id/fires` covers triggers only (open point 10) |
| "All" / "Not fired" counts | derived |

### Memory

| Field | Source |
|---|---|
| Tree: agents, their files, the shared files, each file's size and modified time | item 01's memory tree (item 06's `GET /memory`): the layout is `memory/<agent>/role.md, preferences.md, people.md, lessons.md` and `memory/shared/` (`ARCHITECTURE.md`); `handoffs/` and the playbook mirrors are not shown (open point 2). Agent name and look from `014_agents.ts: agents.*` |
| Path (`~/.loomwright-studio/memory/…`) | the data directory (item 08's `GET /settings`) plus the file's path |
| File: contents, version (content hash) | item 01's memory file (item 06's `GET /memory/file?path=`): content and its content hash |
| Edit: the text, "opened at version …", the changes DiffView | the app's editor state against the hash it read |
| Save | item 01's memory write (item 06's `PUT /memory/file`: path, new content, base hash) |
| Conflict: "You opened it … version", "On disk now … modified … version", the on-disk text | the refusal `changed_since_read` and the current content and hash it returns (item 06); the modified time from the tree |
| "See who wrote it in the audit log" | `001_initial.ts: events.kind = 'memory_updated'`, which no kernel code writes today; item 06 plans one for the owner's own writes (open point 3) |

### Budget & audit

| Field | Source |
|---|---|
| Tokens counted per day; cache reads | `001_initial.ts: budget.day, counted_tokens, cache_read_tokens`, summed per day (item 07's `GET /budget/usage?days=`); cache reads are shown and never counted (D26) |
| By agent: tokens today | `001_initial.ts: budget.agent, counted_tokens`; existing `GET /status` (`tokens_today.agents`) and `GET /agents` (`tokens_today`) |
| By agent: daily limit, sessions at once, "N live of M" | existing `GET /agents` (`tokens_per_day`, `sessions_at_once`, `sessions_running`): the limits are the agent's settings file's (`config/agents/<id>.json`), not a table column; "no limit set" is `null`. Live is `001_initial.ts: sessions.status` in (`starting`, `running`) |
| By playbook: name, agent, on / off, tokens today, limit | `001_initial.ts: budget.playbook, counted_tokens`; `013_playbooks.ts: playbooks.name, owning_agent, status, token_limit_per_day` |
| Meters, percent, "at limit" | derived from the above |
| Subscription cap: window name, status, utilisation, reset time | `001_initial.ts: cap_state.rate_limit_type, status, resets_at`; `006_budget_cap_details.ts: cap_state.utilization`; existing `GET /status` (`cap_state`). The account label is `002_auth_providers.ts: auth_providers.account` |
| Today's total and "≈ … at API rates" | `001_initial.ts: budget.counted_tokens, cost_usd` |
| Audit: id, when, kind, actor, detail | `001_initial.ts: events.id, at, kind, actor, payload_json` (item 07's `GET /audit`). The existing `GET /events` does not return `actor` (open point 11) |
| Audit: the task / session / playbook references | `001_initial.ts: events.task_id, session_id`; the playbook from the payload |
| Audit filters: kind, time range | `001_initial.ts: events.kind, at` |
| Audit filters: agent, playbook | `events` has no agent or playbook column: derived through `session_id` to `sessions.agent` and `013_playbooks.ts: sessions.playbook`, or the payload (open point 11) |
| Audit: "N of M events", page, Newer / Older | item 07's `GET /audit` (filtered, paged, newest first) |
| The event kinds in the log | every kind is one the kernel writes today except `memory_updated` (open point 3): `admission_refused`, `cap_warning`, `draft_output_recorded`, `kill_switch_engaged`, `kill_switch_released`, `playbook_created`, `playbook_dry_run`, `playbook_updated`, `session_status`, `task_created`, `trigger_fired`, `trigger_missed`, `wakeup_scheduled` |

### Settings

| Field | Source |
|---|---|
| Provider, account | `002_auth_providers.ts: auth_providers.id, account` (existing `GET /status`, `auth`) |
| Health (`ok`, `missing`, `expiring`, days) | existing `GET /status` (`auth[].health`), item 08's `GET /settings` |
| Token created | `002_auth_providers.ts: auth_providers.token_created_at` |
| Token life ("365 days · 186 days left · ends 4 May 2027") | the 365-day lifetime is `TOKEN_LIFETIME_DAYS` (`kernel/src/auth/subscription-token.ts`); days left from the health's `days`; the end date is derived (created + 365 days) |
| Keychain item (`loomwright-studio-oauth`) | `kernel/src/auth/subscription-token.ts` and `app/src/shell/KernelStates.tsx`. The value is never shown |
| The three terminal commands | `SETUP_STEPS` in `app/src/shell/KernelStates.tsx` (`claude setup-token`, `security add-generic-password -a loomwright-studio -s loomwright-studio-oauth -w`, `studio service install`). `studio auth …` is not a command (open point 4) |
| Data location, notifier, Loomwright install | item 08's `GET /settings`; the Loomwright path is also in existing `GET /status` (`loomwright`) |
| Launch at login, notifications, theme | the app's own settings; no kernel field |
| Keyboard map link | none |

### Integrations (the proposed token-to-App path)

| Field | Source |
|---|---|
| Status, "verified today 14:02", account | `017_phase_6_foundation.ts: connectors.status, verified_at, account_login` (existing `GET /connectors`) |
| Method (token / GitHub App) | `019_connector_app.ts: connectors.method` |
| "Read-only · declared", "declared by you" and its time | `018_connector_permissions_source.ts: connectors.permissions_source, permissions_declared_at` |
| Token expiry and days left | `017_phase_6_foundation.ts: connectors.expires_at` |
| Keychain item (`loomwright-studio-github`) | the connector's constant (`kernel/src/integrations/github/connector.ts`); the value is never shown |
| Reachable repos | `017_phase_6_foundation.ts: connectors.reachable_repos_json` (existing `GET /connectors/github/repos`) |
| After the switch: App slug, installation | `019_connector_app.ts: connectors.app_slug, installation_id`. The App's display name is not a column (open point 12) |
| After the switch: the access token's expiry, "renews automatically" | `017_phase_6_foundation.ts: connectors.expires_at`; the badge is the screen's copy |
| Agents with the grant | existing `GET /agents` (`connectors`); the role line is the agent's charter, `014_agents.ts: agents.charter_json` |

**The switch's interim state (Plan Review finding 2).** While a switch runs, the row is still the token's: `019_connector_app.ts: connectors.method` stays `token`, and `connectors.status` and `expires_at` do not change. No `connectors` column says "setting up the App". The dialog's steps and its closing time come from the existing setup flow (`POST /connectors/github/app/setup` answers `{setup_url, expires_at}`, and the app watches `GET /connectors`), and "connected · token · setting up the App" in the list row is the app's own state. When the install succeeds the kernel switches the row to `method: app`, sets `app_slug` and `installation_id` and deletes the token's Keychain item (the `integrations-app-connected` view). A cancel or a failed setup leaves the row as it was, which is what `integrations-token-to-app-failed` shows. The kernel already behaves this way (phase 7 item 09's requirement); the proposal is the control that opens the setup over a token connection.

### Keyboard map

No data fields. The screen shortcuts come from the sidebar's own list (`⌘1`–`⌘9`, `⌘,`), the palette commands are the ones each screen contributes, and "Open <playbook>" and "Open memory/<path>" have one entry per playbook and per file.

### Open points the field map raised

The numbers match `docs/DESIGN.md` §"Phase 7: GUI v2" → "Open points for the owner".

1. `tasks.state` is free text: `kernel_task_create` says "state is free text you choose; the kernel defines no states". The four board columns are the screen's grouping, and the mockup shows no "other" column. The owner decides whether the kernel closes the set, or the screen maps the words it knows and shows the rest in a fifth place.
2. Memory shows four files per agent and `shared/`. `handoffs/` and the playbook mirrors are not shown.
3. `memory_updated` is not an event the kernel writes today ([OPEN_QUESTIONS](../../OPEN_QUESTIONS.md)); item 06 plans one for the owner's own writes. The audit log shows one for Mason's lesson, and the conflict's "See who wrote it in the audit log" needs it. Until an agent's write is recorded too, a write by an agent leaves nothing to find.
4. Settings shows the three setup commands the app already shows (`SETUP_STEPS`). `studio auth …` is not a command, so none is shown.
5. The keyboard map is a proposal: `⌘6` Tasks, `⌘7` Playbooks, `⌘8` Schedules & triggers, `⌘9` Memory, `⌘,` Settings, Budget & audit by the palette only.
6. Field-level edit shows eight fields. The owner's set route takes five policy fields only (`dedupe_key`, `priority`, `model`, `token_limit`, `mode`: `kernel/src/playbooks/store.ts`, `PLAYBOOK_POLICY_FIELDS`). Name, intent and effort have no owner write route, and `mode: live` is refused in phase 6. Item 04 adds a write for the three or shows them read-only.
7. Any change makes an enabled playbook a draft again (`writeVersion`), so a saved edit needs a dry run and approval before it is on. The mockup says so on the edit page and after Save.
8. The On switch: only off has an owner route (`POST /playbooks/:id/off`). Turning a draft or disabled playbook on is Wright's `kernel_playbook_enable` plus the owner's approval, not a switch. Item 04 decides what the switch does when it is off.
9. The token-to-App switch is a proposal that replaces DESIGN.md's old "disconnects first" open point (the interim state is mapped above).
10. A trigger has no name column: the label is its playbook's name, or the action's text for a trigger with none (Friday wrap-up, Rotate the sandbox token). A wake-up's firing history has no route in item 05's plan.
11. The existing `GET /events` omits `events.actor`, and `events` has no agent or playbook column, so item 07's `GET /audit` must return the actor and derive the two filters.
12. The App's display name is not a `connectors` column (only `app_slug`). The approved App views already show a name; this mockup copies them.
13. Where the mockup departs from a component README (the switch at 32×18 against 26×16, the meter at 4px against 3px and at `attention` only at the limit against 80%, table cells that wrap against Table README's "truncate", a 4s toast against 6s): each is named in the values table above, and the owner decides which side moves.

## Defects found and fixed in the mockup

Subtask 3 changes no HTML except to fix a defect it finds. Six were found while building this map and two in review; each is fixed in `gui-v2.html` (the token block is untouched):

1. **Audit kinds that do not exist.** The log showed `session` and `playbook_run` as event kinds. The kernel writes `session_status`, and no `playbook_run` event. The five rows are now `session_status`, with the run named in the text ("Session 37 ended completed · playbook run 17 · 31,870 tokens").
2. **Dedupe key shown as a template.** The mockup showed `{repo}#{pr}@{head_sha}`. The kernel stores a list of key fields from a closed set. The three playbooks now show lists (`item.id, item.revision`; `trigger.id, trigger.scheduled_at`; `playbook.id, date`), and the edit field says what it takes.
3. **"Proposed by Wright" on name and intent.** `playbooks` has no `name_set_by` or `intent_set_by`. The two Badges are removed (the detail's Intent header and the edit form's two rows).
4. **A saved edit left the playbook on.** The kernel makes an enabled playbook a draft again on any change. The edit page now says so, and Save turns the playbook into a draft with a toast.
5. **A "why" line with no source.** Task #12 carried a sentence no column holds. The line is removed; the task's title is the ask.
6. **Two session titles with no source** ("Ada · changelog draft", "Ada · refactor spike"). They are now "Ada · Weekly changelog draft" (the session's playbook) and "Ada · direct thread".
7. **A form field the mockup let you save with a value the kernel refuses.** Only the token limit had a refusal; an empty name, an empty intent and a dedupe key outside `DEDUPE_KEY_FIELDS` left Save on. Every text field of the field-level edit now validates (`formErrs`) against each rule of `checkPolicyValue` and `parseOwnerPolicyValue` (a key field listed once; a token limit of at most 16 digits that is a safe integer), shows its reason in `danger` and turns Save off, and `playbooks-edit-refused` draws the state. The other forms were swept: Memory's edit is free markdown (its one refusal, `changed_since_read`, is `memory-conflict`), and Settings, Integrations and the Playbooks switches are toggles and fixed choices with no free value.
8. **The same work shown as two cards.** Run 17 and task 5 shared session 37, agent, dedupe key and window, but a session or a run is its own card only when no task owns it. Run 17's card is removed from Done today; the other cards were checked and no other session id or dedupe key repeats (runs 16 and 18 and sessions 38, 39, 40 and 44 have no owning task).

## Found, not changed

- The review strip's intro and keys line name `⌘`/`⌃` shortcuts for Chat, Team, Approvals and Sessions (`⌘1`–`⌘4`); they live in `gui-v1.html`, so pressing one in this mockup says so and does nothing else.
- Rendering was spot-checked on three screenshots (`memory-conflict` dark, `integrations-token-to-app` light, `playbooks-edit` light), not all 100. Contrast was not measured on any. The mockup uses only token colours, so the approved palette's contrast applies, but a measured pass in both themes was not done.
