# Settings screen evidence (phase 7 item 08)

These are screenshots of the built app's Settings screen in every state the GUI v2 mockup shows for it (`settings-empty`, `settings-loading`, `settings-populated`, `settings-waiting`, `settings-error`, `settings-unreachable`), each in light and dark mode (12 files). Each one was taken by `app/e2e/settings.spec.ts` against the fixture kernel, with the canned data in `app/e2e/fixtures/settings.ts`, and with the main process's test seams on (`STUDIO_APP_PREFS_DIR` at a temp dir and `STUDIO_APP_FAKE_OS=1`), so no screenshot run touched a real login item, Finder or the owner's own `prefs.json`. Every account, path and token date in them is a fixture value (`personal subscription`, `/Users/owner/.loomwright-studio`); the token dates are relative to the moment of capture (a token made 100 days ago, or 347 days ago for the expiring state), so they differ from the mockup's fixed clock. The window is made taller for the shots (1100 px) so the whole screen, down to "This app", is in each one; the real window scrolls.

To regenerate the screenshots (macOS):

```sh
cd app && npm run build && SETTINGS_EVIDENCE=1 npx playwright test e2e/settings.spec.ts --workers=1
```

`SETTINGS_EVIDENCE=1 npm run e2e` writes the same files, and also rewrites other screens' tracked screenshots, whose pixels change a little on every run; use the command above to regenerate these alone.

Without `SETTINGS_EVIDENCE=1` the spec writes its screenshots to Playwright's per-test output directory, so CI never changes these files, and one of its tests fails if any file in this directory is newer than the run's start. Another test fails if this README stops naming a light and a dark file for a state, or if a file here is not named. The spec checks behaviour and never compares pixels, because fonts differ between macOS and the Ubuntu CI run. All 12 files were captured on macOS on 2026-10-30.

## Screenshots

The "Mockup view" column names the view of `docs/design/mockups/gui-v2.html` each screenshot matches (`#view=<name>`).

| Screenshot (light / dark) | Mockup view | What it shows |
|---|---|---|
| [light](settings-empty-light.png) / [dark](settings-empty-dark.png) | `settings-empty` | No token yet: health `missing` with a danger dot and "no token in the Keychain item", the danger band "There is no token in the Keychain. Without one the crew can't start sessions.", no Token created or Token life rows, the Token row reading "Expected in the Keychain as `loomwright-studio-oauth`", and the three terminal commands under "Set it up in your terminal". The app's own settings still show. |
| [light](settings-loading-light.png) / [dark](settings-loading-dark.png) | `settings-loading` | The settings route held open by the fixture: skeleton rows for the auth provider (two) and the kernel (one), `aria-busy`, and a status line "Loading the auth provider" for a screen reader. "This app" is already there and usable. |
| [light](settings-populated-light.png) / [dark](settings-populated-dark.png) | `settings-populated` | The auth provider read-only (provider, account, health `ok`, token created, "365 days · 265 days left · ends ...", the Keychain item and "The value is never shown, and this app has no field for it"), the three terminal commands each with Copy, the kernel read-only (data location with Reveal in Finder, notifier with its caption, the Loomwright install path), and "This app" (Launch at login, Notifications, Theme). |
| [light](settings-waiting-light.png) / [dark](settings-waiting-dark.png) | `settings-waiting` | The token expires in 18 days: an attention dot with "expiring 18 days left", a "renew soon" badge on Token life, and the attention band "The subscription token expires in 18 days, on ... Create a new one with the commands below ...". |
| [light](settings-error-light.png) / [dark](settings-error-dark.png) | `settings-error` | The route-failure card in the auth provider section: "Couldn't load the auth provider", "the settings request failed (500)", the detail `GET /settings · 500 · store_unreadable`, and Try again. The commands and kernel sections are left out and no kernel band shows: the kernel answered. "This app" still works. |
| [light](settings-unreachable-light.png) / [dark](settings-unreachable-dark.png) | `settings-unreachable` | The fixture kernel closed while the screen held data: the shell's "Couldn't reach the kernel" band, "last known" beside the Auth provider and Kernel headings, the rows kept as last read, and Reveal in Finder disabled. In this shot the owner had already turned Launch at login on and picked Dark, to show that "This app" keeps working. |

## Contrast check (AC10)

The screen takes every colour from the design tokens: `app/src/screens/settings/contrast.test.ts` fails on a hex colour, a colour function, a named colour or a colour property with a literal value in `settings.css`, and on a token the stylesheet names that does not exist (`app/e2e/settings.spec.ts` checks the same in the built app's run). That test also computes the WCAG 2.1 contrast ratio of each text and background token pair the screen uses, from `app/src/styles/tokens.css`, in both themes (text needs 4.5:1, non-text parts 3:1). The ratios on 2026-10-30:

| Pair (text on background) | Used for | Light | Dark |
|---|---|---|---|
| `ink` on `ground` | the values, the account, the Health word | 15.89 | 15.31 |
| `ink` on `surface` | the app preferences' titles | 17.29 | 14.08 |
| `ink-secondary` on `ground` | the commands' intro, the Reveal and Copy buttons' label, the 'status unknown' note | 5.91 | 7.26 |
| `ink-secondary` on `surface` | an unpressed theme button, the route-failure card's text | 6.43 | 6.68 |
| `ink-secondary` on `surface-sunken` | the neutral badges (read-only, the step numbers), the Copy button, a neutral notice | 5.56 | 7.59 |
| `ink-tertiary` on `ground` | the row labels, the section labels, captions, 'last known' | 5.14 | 5.40 |
| `ink-tertiary` on `surface` | the app preferences' captions | 5.59 | 4.97 |
| `ink` on `surface-sunken` | the commands, the route-failure detail | 14.95 | 16.00 |
| `accent` on `accent-soft` | the pressed theme button | 5.43 | 5.22 |
| `attention` on `attention-soft` | the expiring band, the renew soon badge | 5.04 | 7.11 |
| `attention` on `ground` | the 'expiring' Health word | 5.18 | 9.66 |
| `attention` on `surface` | the login item's 'needs your approval' note | 5.64 | 8.89 |
| `danger` on `danger-soft` | the missing and invalid band, a notice | 5.09 | 6.04 |
| `danger` on `ground` | the 'missing', 'error' and 'invalid_shape' Health words, a Loomwright error, 'Couldn't open the folder' | 5.47 | 7.09 |
| `danger` on `surface` | the route-failure card's heading | 5.95 | 6.52 |

Non-text parts (3:1):

| Pair | Used for | Light | Dark |
|---|---|---|---|
| `border` on `surface` | the switch's off track | 3.38 | 3.33 |
| `accent` on `surface` | the switch's on track | 6.48 | 6.34 |
| `focus` on `surface` | the focus ring on a switch or a theme button | 6.48 | 6.34 |
| `focus` on `ground` | the focus ring on a Copy or Reveal button | 5.95 | 6.90 |
| `ok` on `ground` | the 'ok' dot | 4.89 | 7.83 |
| `attention` on `ground` | the 'expiring' dot | 5.18 | 9.66 |
| `danger` on `ground` | the 'missing' and 'error' dot | 5.47 | 7.09 |

Every status carries text as well as colour: the Health dot has its word beside it (`ok`, `expiring` with its days, `missing`, `invalid_shape`, `error` with its reason), the dot is `aria-hidden`, and a band says in words what it means. Each switch is named "`<name>` is on|off" (for example "Launch at login is off"), the theme buttons are a group labelled "Theme" with `aria-pressed`, the four sections are labelled regions, each Copy button is named "Copy command: `<command>`", and the e2e checks each of these with `getByRole`.

## What the spec checks

| Area | Check |
|---|---|
| Facts (AC2) | Provider, account, health, token created, "365 days · 265 days left · ends ...", the Keychain row, the three commands with a named Copy each, the data location, notifier and Loomwright path. The fixture's body also carries a token-shaped field at the top and in `provider`: it is in neither the page's markup nor its text. Copy puts the command on the clipboard (read in the main process) and says "Copied". |
| States (AC11) | Missing (danger band as an alert, no token rows), expiring (attention band as a status, "renew soon", "18 days left"), loading (two and one skeleton rows, the app's own switch already enabled), a 500 (the failure card, no commands or kernel sections, Try again recovers). |
| Launch at login (AC4) | A click calls the fake OS with `openAtLogin: true` (one `setLoginItemSettings` call in `os-calls.json`), `prefs.json` never holds it, and after a relaunch the switch reads the OS's state; the OS's file is then edited to off while the app is closed (System Settings turning it off) and the next launch shows off. A seeded `requires-approval` item says "Needs your approval" and stays off when asked. |
| Theme (AC5) | After `emulateMedia({ colorScheme: null })` (Playwright pins light), Light then Dark then Light then Dark flip `matchMedia("(prefers-color-scheme: dark)")` with no reload (a window marker survives) and with no `data-theme` set, the tokens' `--ground` really changes, `prefs.json` holds the theme, and a relaunch reads dark on its first read, then light after the next change and relaunch. |
| Reveal, notifications (AC6) | Reveal records exactly one `reveal` call whose path is the fixture kernel's own data dir, not the one the screen displays (the kernel's account of its dir), so the renderer's value is never opened. Turning notifications off writes `prefs.json` and survives a relaunch, which reveals nothing. |
| Unreachable (AC7) | The fixture kernel is closed: the shell's band shows, "last known" marks both kernel sections, the rows are the last read, Reveal is disabled and records nothing, and the switches and theme buttons still work. The window logs no page error. |
| Keyboard (AC8) | From the first Copy, Tab reaches Copy, Copy, Reveal, both switches and System, Light, Dark in that order; Enter on Light, Space on both switches, Enter on Reveal and on Copy each do their action. |
| Live (AC9) | An `auth_token_expiring` event with a changed data location, notifier and Loomwright path updates those rows with no reload and no skeleton, and the nine rows already shown have identical bounding boxes before and after. A `notify` event with reason `auth_token_expiring` (what the kernel appends today) and the view moved to expiring brings the band and the badge; an `auth_health_changed` back to ok removes them; no skeleton on any of the three. |
| Names (AC10) | Two switches by name, the Theme group, the four labelled regions and their h2 headings, every button named, every dot hidden from assistive tech, no `input`, `textarea` or `select`, no control or link named sign in / log in / claude.ai (the "Launch at login" switch is the OS's login item, not a sign-in), no "Claude Code". The shell's one `h1` reads "Settings". |

## Departures from the mockup

- **No Keyboard map row.** The mockup's "This app" has a fourth row, "Keyboard map" with an Open button. No item builds the keyboard map yet (the shell does not mount the palette either), so the row is left out rather than shown as a dead control.
- **No `studio auth` command.** A `studio auth` command does not exist (`docs/DESIGN.md` open point 4), so none is shown. The screen shows the three commands of the first-run screen (`SETUP_STEPS` in `app/src/shell/KernelStates.tsx`, reused, not copied): `claude setup-token`, the Keychain `security` command and `studio service install`, which is what the mockup's own `SETUP_STEPS` also lists.
- **The Notifications copy.** The mockup says "Show a macOS notification when something waits on you. Off keeps it in the app." That promises a behaviour nothing has: the kernel posts its own macOS notifications through its notifier and does not read this preference, and the app posts none. The screen says only what the switch is: "Kept as this app's own preference. The kernel's macOS notifications don't follow it yet." Whether it should also gate the kernel's notifier is an open owner question in `docs/OPEN_QUESTIONS.md`.
- **The failure card's heading level.** The mockup draws it as an `h2` inside the section; the screen's section headings are `h2`, so the card's heading is an `h3` and the order stays correct.
- **No "Kernel log" button on the failure card.** The mockup's card has Try again and Kernel log; no screen builds a kernel log, so only Try again is shown. (The same departure as Schedules.)
- **The unreachable view shows the shell's band only.** The screen draws no band of its own; "last known" sits beside the two kernel-fed section headings (the mockup puts it in the title bar's subtitle).
- **Copy selects the command's text instead of using the async clipboard.** In the built app `navigator.clipboard.writeText` is rejected ("Write permission denied", probed 2026-10-30), because the shell's permission handler denies every request. The screen selects the command's own text and runs the browser's `copy` command, which needs no permission, then puts the owner's selection back, and falls back to the async clipboard only in a window with no copy command. It builds no input or textarea.
- **The login item can say more than the mockup.** Under "Launch at login" the description is replaced by the OS's own word when it matters ("Needs your approval ...", "macOS can't find this app's login item ...", or "macOS did not change it ..." when a requested change reads back unchanged). The mockup has no such state.
- **Dates read `4 May 2026` in the owner's local day**, and "Token life" for a token past its end reads "expired · ended `<date>`".

## Limits

- **The ⌘K palette and ⌘, are not reachable in the built app.** The shell does not mount the command palette or bind the screen shortcuts (as for phases 5 to 7). The screen registers "Theme: System", "Theme: Light", "Theme: Dark", "Reveal the data folder in Finder", "Turn launch at login on|off" and "Turn notifications on|off" under owner `settings` while it is mounted and unregisters them on unmount; that, each command's call and Reveal being disabled while the kernel is unreachable are pinned in `app/src/screens/settings/SettingsScreen.test.tsx` (jsdom), not driven in Electron.
- **The kernel appends no event whose kind starts `auth_` or `loomwright_`** (a grep of `kernel/src` on 2026-10-30). The live refetch follows those prefixes as the item asks, and also the `notify` events whose payload `reason` starts `auth_` (`auth_token_expiring`, `auth_failed`), which are what the kernel appends today. The fixture's e2e covers both shapes.
- **A change to `expiring` or `missing` adds the band above the sections**, so the rows move down by its height. That is a state change, not a refetch: a refetch that changes only text inside the rows moves nothing, which is what the live check measures.
- **The login item on the real ad-hoc-signed build is not exercised here.** Every e2e run uses the fake OS. The result of `app.setLoginItemSettings` on the real build is recorded in `docs/OPEN_QUESTIONS.md`.
- **The fixture's route is the shared interface, not the kernel's.** The real route (`kernel/src/gui/settings.ts`) is covered by `kernel/test/gui-settings.test.ts`.
- All screenshots come from one machine (macOS). The Ubuntu CI run executes the same assertions but does not write these files.
