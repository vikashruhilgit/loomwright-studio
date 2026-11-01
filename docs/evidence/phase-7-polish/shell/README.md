# Shell polish evidence: the frame (phase 7, item 11)

These are screenshots of the built app's frame (the sidebar, the title bar and the shared kernel-unreachable band) in the two views of the GUI v2 mockup (`docs/design/mockups/gui-v2.html`) that show it, and in one state the mockup has no view for (the band's note when there is no kernel log yet). That is three shots, each in light and dark mode (6 files). Each was taken by `app/e2e/shell.spec.ts` against the fixture kernel (`app/e2e/fixtures/integrations.ts`), so no real account, repo or token was involved. The window is Studio's default 1180 by 760 px (the PNGs are 2x). The fixture roster is Wright, Mason (one thread, so his row shows a last line) and Ada (off).

To regenerate the screenshots (macOS):

```sh
cd app && npm run build && SHELL_EVIDENCE=1 npx playwright test e2e/shell.spec.ts --workers=1
```

Without `SHELL_EVIDENCE=1` the spec writes its screenshots to Playwright's per-test output directory, so CI never changes these files, and one of its tests fails if any file in this directory is newer than the run's start. Another test fails if this README stops naming a light and a dark file for a view, or if a file here is not named. The spec checks behaviour and never compares pixels, because fonts differ between macOS and the Ubuntu CI run. All 6 files were captured on macOS on 2026-11-01 (the `integrations-token` pair is recaptured by every evidence run; the `integrations-unreachable` pair was regenerated with the "Kernel log" button, and the third shot is new). In the dark shots the sidebar reads grey: it is translucent over the window's vibrancy, which a headless capture does not have.

## Screenshots

| Screenshot (light / dark) | Mockup view | What it shows |
|---|---|---|
| [light](integrations-token-light.png) / [dark](integrations-token-dark.png) | `integrations-token` | The frame at rest: a glyph beside each of the eleven entries, the divider after Integrations, "Schedules & triggers", the Crew group (avatar, name, one last line; Ada dimmed and saying "off"), and the bottom row (`idle`, the idle ring, the `⌘K` hint). The title bar is the title alone. |
| [light](integrations-unreachable-light.png) / [dark](integrations-unreachable-dark.png) | `integrations-unreachable` | The fixture's listener stopped under the open window (`fixture.stop()`, not a faked read): the one red band over Integrations, the list row `status unknown · kernel unreachable`, the last data kept with Replace token, Switch to GitHub App, Disconnect and Refresh off, and the bottom row reading `kernel unreachable` with the danger dot. The band now ends with the "Kernel log" button at its right, as the mockup's `BAND` does. |
| [light](integrations-unreachable-kernel-log-missing-light.png) / [dark](integrations-unreachable-kernel-log-missing-dark.png) | none (`integrations-unreachable`, with the button pressed) | **The mockup has no view for this.** The same stopped-listener state after pressing "Kernel log" when the fixture's data dir holds no `logs/kernel.err.log`: nothing is revealed, and the band reads "There is no kernel log yet." after the button (`role="status"`). The wording and the place are a Launch Pad default the owner can change on the PR. |

## What this PR changes in the frame

1. **One shared band.** The shell draws the red "Couldn't reach the kernel" band once, above the screen, while the store reads `reconnecting` or `unreachable` (`KernelBand`), and the small "Reconnecting… Last updated" line is gone. Integrations keeps its last data under it with writes off (`useKernelReach`). The fixture kernel can stop and restart its listener. The band ends with the mockup's "Kernel log" button at its right (`toast-band-action`, the shared Band's action style), on every screen, because every screen renders this one component. Pressing it asks the main process (`studio:reveal-kernel-log`, no argument) to reveal `<dataDir>/logs/kernel.err.log` in Finder; with no such file it reveals nothing and the band says "There is no kernel log yet.", and on any other error "Couldn't open the kernel log.".
2. **Sidebar glyphs** beside each entry (decorative, `aria-hidden`), from the mockup's set, mapped by screen id in `app/src/shell/Sidebar.tsx`. Every entry's accessible name is its label alone.
3. **The divider** after Integrations, as the mockup's `NAV_ORDER` has it.
4. **"Schedules & triggers"** is the sidebar label (it was "Schedules"), as the mockup says.
5. **The bottom status row**: a labelled `role="status"` ("Kernel: idle") with the state word (`idle`, `working`, `paused`, `connecting`, `kernel unreachable`), derived only from the connection and `GET /status`, with the danger dot when the kernel does not answer, and the `⌘K` hint labelled "Command palette".
6. **Crew rows** are the mockup's: avatar, name, one ellipsised last line. The time is gone. The unread dot, the dimmed "off" row, the shared-name id and each row's accessible name are unchanged.
7. **A title bar subtitle slot**: `ScreenDefinition.Subtitle` renders beside the title (`data-testid="titlebar-subtitle"`), and a screen without one gets the title alone.
8. **A read-only `homeDir` bridge member** (`studio:home-dir`) with `formatHomePath` and `useHomeDir`, so screens can show `~/…` paths.
9. **Contrast.** The frame's text pairs are pinned at 4.5:1 in both themes (`app/src/shell/frame.test.tsx`), with no new colour. Pinning them found the Crew row's last line, "off" word and shared-name id under 4.5:1 on the current thread's accent-soft row in one theme; they now use the secondary ink there, and the selected entry's shortcut takes the accent as the mockup has it.

## Known remaining differences

- **"Kernel log" reveals a file; it is not a log view.** The button shows the service's `kernel.err.log` in Finder (the app has no log viewer, by decision). The service also writes `kernel.out.log` (`STDOUT_LOG_FILENAME` in `kernel/src/service/launchd.ts`), so stdout is kept too: Finder opens the `logs` folder with the err log selected, so the out log is visible beside it, and only the err log is revealed. The mockup has no view for the "no log yet" note (see above).
- **Other screens' committed unreachable screenshots predate the button.** The unreachable PNGs (`*unreachable-light.png` and `*unreachable-dark.png`) in the other screens' evidence folders (`docs/evidence/phase-7-polish/<screen>/`) were taken before the band had the "Kernel log" button and are not regenerated here. Their bands read the sentence alone. `app/e2e/shell.spec.ts` asserts the button, without screenshots, on the bands of Tasks, Playbooks, Schedules, Memory, Budget, Settings and Integrations.
- **Count lines under the title.** No screen declares a `Subtitle` yet, so every screen still draws its own count line under the title bar (Integrations: "1 connector · all optional"). Each screen's item (12, 14 to 18) moves its own line into the slot.
- **Screens not yet moved onto the shared band** (Tasks, Memory, Playbooks, Schedules, Budget, Settings) may still draw their own "Couldn't load" or "Status unknown" under the shell's band until their items land.
- **The `⌘K` hint is a hint.** The shell does not mount the palette or bind `⌘K` yet (the keyboard map and palette are item 13), so the hint is not a button.
- **Not installed.** With no `api.json` the status row reads `kernel unreachable` with the danger dot (it is one of the five words), while the screen area shows the setup steps instead of the band.
- **A kernel restart shows the red band for the moment it is down**, with no grace period (the mockup has none).
- **Stale text elsewhere.** `docs/evidence/phase-7-polish/schedules/README.md` (line 72) says the sidebar reads "Schedules", not "Schedules & triggers". That is now stale; it is outside this item's files, so it is left for the Schedules lane or a follow-up.
