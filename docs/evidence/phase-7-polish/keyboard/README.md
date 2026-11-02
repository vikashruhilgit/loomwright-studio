# Keyboard polish evidence: the Keyboard map and the palette (phase 7, item 13)

These are screenshots of the built app's Keyboard map, of the `⌘K` palette open over Tasks, and of Memory opened by that palette, in the three views of the GUI v2 mockup (`docs/design/mockups/gui-v2.html`) they match, each in light and dark mode (6 files). Each was taken by `app/e2e/keyboard.spec.ts` through `app/e2e/electron-harness.ts` against the fixture kernel (`app/e2e/fixtures/phase-7-exit.ts`), so no real account, repo, token or store was involved. The Tasks and Memory shots use the window's default 1180 by 760 px; the Keyboard map shot is taken after `?` from a Settings scrolled down at the default size, and then uses a window 1500 px tall so more of its tables are in view (the PNGs are 2x).

To regenerate the screenshots (macOS):

```sh
cd app && npm run build && KEYBOARD_EVIDENCE=1 npx playwright test e2e/keyboard.spec.ts --workers=1
```

Without `KEYBOARD_EVIDENCE=1` the spec writes its screenshots to Playwright's per-test output directory, so CI never changes these files, and one of its tests fails if any file in this directory is newer than the run's start. Another test fails if this README stops naming a light and a dark file for a view, or if a file here is not named. The spec checks behaviour and never compares pixels, because fonts differ between macOS and the Ubuntu CI run. All 6 files were captured on macOS on 2026-11-01. Phase 7 item 29 (the shared Back crumb) changed `keymap`, so `keymap-light.png` and `keymap-dark.png` were taken again for it on macOS on 2026-11-02; the other four are unchanged. In the dark shots the sidebar reads grey: it is translucent over the window's vibrancy, which a headless capture does not have.

## Screenshots

| Screenshot (light / dark) | Mockup view | What it shows |
|---|---|---|
| [light](keymap-light.png) / [dark](keymap-dark.png) | `keymap` | Opened with `?` from a Settings scrolled down, and shown at its top (`.content` `scrollTop` 0): the title bar with its count line, Settings marked in the sidebar (the screen it was opened from), the shared crumb "‹ Settings / Keyboard map" focused (it returns to Settings; item 29), "Go to a screen" (each sidebar screen with its shortcut, Budget & audit with `none` / `palette only`), "Anywhere" and the start of "Palette commands by screen". |
| [light](tasks-populated-palette-light.png) / [dark](tasks-populated-palette-dark.png) | `tasks-populated`, palette open | `⌘K` pressed on Tasks (8 cards, 3 working): the focused search input, the Screens group (the first eight rows and "Show all 11"), the Agents group, and the footer "Wright, powered by Claude". The sidebar shows Tasks as current and every `⌘` label. |
| [light](memory-populated-light.png) / [dark](memory-populated-dark.png) | `memory-populated` | Memory opened by the palette (`⌘K`, "Memory", Enter) from Tasks: focus is on the first control inside Memory (the first file, with its focus ring) and no sidebar entry holds the focus ring; Memory is the one marked entry. |

## What this PR changes

1. **One keyboard host.** `app/src/shell/KeyboardHost.tsx` mounts one `installKeyboardMap` and the `⌘K` palette. `⌘1` to `⌘9` and `⌘,` open the screen the sidebar labels, `⌘K` or `/` opens the palette, and `?` opens the Keyboard map. A text field keeps its keys.
2. **The Keyboard map** is `#/keymap` (`app/src/screens/keymap/`), a screen with no sidebar entry, reached by `?` or the palette's "Keyboard map" command.
3. **One owner for each chord.** The application menu holds no accelerator for `⌘1` to `⌘9`, `⌘,` or `⌘K`; a test reads the launched app's menu.
4. **The kill confirm holds every key behind it**, however it was opened.
5. **Focus after a palette run.** When the palette runs a command that changes the hash (a screen), `KeyboardHost` moves focus into the opened screen once it has rendered: the first control inside its `screen-<id>` root, or the root itself. It skips the move when focus is already inside `.content` or in a text field. `⌘1` to `⌘9`, a sidebar click or Enter, Esc, and a command that changes no hash leave focus where it was.
6. **The Keyboard map opens at its top** (`.content` is one scrolling element shared by every screen, so the map resets it), and **the sidebar marks the screen the map was opened from** (Settings for a deep link onto the map).
7. **`KNOWN_GAPS` is empty** in `app/e2e/phase-7-exit.spec.ts`: `keymap` is a click-through mapped to `keyboard.spec.ts`.

## Known remaining differences from the mockup

- **"Browser tab" column.** The mockup's first table has a `⌃` browser-tab column and a "Where" column ("in this mockup"). The app is not a browser tab, so the table has "Shortcut" and "By keyboard" (`shortcut, or the palette`, or `palette only` for Budget & audit) instead, and the intro line drops the browser-tab sentence.
- **"Anywhere" has a seventh row**, `⌘⇧K`, the kill switch's chord (it asks to confirm first). The mockup's palette hint "(⌃K in a browser tab)" is dropped for the same reason.
- **"Palette commands by screen" lists what the registry holds now**, with the group, the title and the key. A screen's own commands (Memory's "Open memory/…", Budget & audit's "Open the audit log") appear while that screen is open, and the mockup lists every one at all times. A fixed list would drift from the keys, so it is read from the registry. The mockup's "Shown" column has no data behind it in the registry and is not drawn.
- **The Keyboard map shot is cut at the window's height.** A 1500 px window shows the three tables down to the palette-commands rows; the rest of that table scrolls.
- **Tasks has a command of its own** in the app (Stop and Kill on the open card), so the mockup's caption "Tasks has no command of its own" is not drawn.
- **The sidebar mark follows the opener, not a fixed parent.** The mockup's `navHTML` marks the map's static parent (`parent:'settings'`, always Settings). The app marks the screen the map was actually opened from (Tasks when opened from Tasks), and Settings only for a deep link onto the map.
- **These are fixture-kernel captures.** They are taken through `app/e2e/electron-harness.ts` against the fixture kernel, so the owner's decision that screenshots stay outside the repo (about live-run captures of the real store) does not cover them.
- **Focus.** Opening the map puts focus on Back, as the mockup does. Back goes to the screen the map was opened from, and to Settings when the window opened on the map itself.
- **Playbooks detail has no Esc** to return to the list (Tasks and Memory do); it is outside this item and recorded in `docs/OPEN_QUESTIONS.md`.
