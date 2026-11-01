# Shell polish evidence: the frame (phase 7, item 11)

These are screenshots of the built app's frame (the sidebar, the title bar and the shared kernel-unreachable band) in the two views of the GUI v2 mockup (`docs/design/mockups/gui-v2.html`) that show it, each in light and dark mode (4 files). Each was taken by `app/e2e/shell.spec.ts` against the fixture kernel (`app/e2e/fixtures/integrations.ts`), so no real account, repo or token was involved. The window is Studio's default 1180 by 760 px (the PNGs are 2x). The fixture roster is Wright, Mason (one thread, so his row shows a last line) and Ada (off).

To regenerate the screenshots (macOS):

```sh
cd app && npm run build && SHELL_EVIDENCE=1 npx playwright test e2e/shell.spec.ts --workers=1
```

Without `SHELL_EVIDENCE=1` the spec writes its screenshots to Playwright's per-test output directory, so CI never changes these files, and one of its tests fails if any file in this directory is newer than the run's start. Another test fails if this README stops naming a light and a dark file for a view, or if a file here is not named. The spec checks behaviour and never compares pixels, because fonts differ between macOS and the Ubuntu CI run. All 4 files were captured on macOS on 2026-11-01. In the dark shots the sidebar reads grey: it is translucent over the window's vibrancy, which a headless capture does not have.

## Screenshots

| Screenshot (light / dark) | Mockup view | What it shows |
|---|---|---|
| [light](integrations-token-light.png) / [dark](integrations-token-dark.png) | `integrations-token` | The frame at rest: a glyph beside each of the eleven entries, the divider after Integrations, "Schedules & triggers", the Crew group (avatar, name, one last line; Ada dimmed and saying "off"), and the bottom row (`idle`, the idle ring, the `⌘K` hint). The title bar is the title alone. |
| [light](integrations-unreachable-light.png) / [dark](integrations-unreachable-dark.png) | `integrations-unreachable` | The fixture's listener stopped under the open window (`fixture.stop()`, not a faked read): the one red band over Integrations, the list row `status unknown · kernel unreachable`, the last data kept with Replace token, Switch to GitHub App, Disconnect and Refresh off, and the bottom row reading `kernel unreachable` with the danger dot. |

## What this PR changes in the frame

1. **One shared band.** The shell draws the red "Couldn't reach the kernel" band once, above the screen, while the store reads `reconnecting` or `unreachable` (`KernelBand`), and the small "Reconnecting… Last updated" line is gone. Integrations keeps its last data under it with writes off (`useKernelReach`). The fixture kernel can stop and restart its listener. The band has no "Kernel log" button.
2. **Sidebar glyphs** beside each entry (decorative, `aria-hidden`), from the mockup's set, mapped by screen id in `app/src/shell/Sidebar.tsx`. Every entry's accessible name is its label alone.
3. **The divider** after Integrations, as the mockup's `NAV_ORDER` has it.
4. **"Schedules & triggers"** is the sidebar label (it was "Schedules"), as the mockup says.
5. **The bottom status row**: a labelled `role="status"` ("Kernel: idle") with the state word (`idle`, `working`, `paused`, `connecting`, `kernel unreachable`), derived only from the connection and `GET /status`, with the danger dot when the kernel does not answer, and the `⌘K` hint labelled "Command palette".
6. **Crew rows** are the mockup's: avatar, name, one ellipsised last line. The time is gone. The unread dot, the dimmed "off" row, the shared-name id and each row's accessible name are unchanged.
7. **A title bar subtitle slot**: `ScreenDefinition.Subtitle` renders beside the title (`data-testid="titlebar-subtitle"`), and a screen without one gets the title alone.
8. **A read-only `homeDir` bridge member** (`studio:home-dir`) with `formatHomePath` and `useHomeDir`, so screens can show `~/…` paths.
9. **Contrast.** The frame's text pairs are pinned at 4.5:1 in both themes (`app/src/shell/frame.test.tsx`), with no new colour. Pinning them found the Crew row's last line, "off" word and shared-name id under 4.5:1 on the current thread's accent-soft row in one theme; they now use the secondary ink there, and the selected entry's shortcut takes the accent as the mockup has it.

## Known remaining differences

- **"Kernel log" button.** The mockup's band has one. The app has no kernel log view, so the band carries the copy only.
- **Count lines under the title.** No screen declares a `Subtitle` yet, so every screen still draws its own count line under the title bar (Integrations: "1 connector · all optional"). Each screen's item (12, 14 to 18) moves its own line into the slot.
- **Screens not yet moved onto the shared band** (Tasks, Memory, Playbooks, Schedules, Budget, Settings) may still draw their own "Couldn't load" or "Status unknown" under the shell's band until their items land.
- **The `⌘K` hint is a hint.** The shell does not mount the palette or bind `⌘K` yet (the keyboard map and palette are item 13), so the hint is not a button.
- **Not installed.** With no `api.json` the status row reads `kernel unreachable` with the danger dot (it is one of the five words), while the screen area shows the setup steps instead of the band.
- **A kernel restart shows the red band for the moment it is down**, with no grace period (the mockup has none).
- **Stale text elsewhere.** `docs/evidence/phase-7-polish/schedules/README.md` (line 72) says the sidebar reads "Schedules", not "Schedules & triggers". That is now stale; it is outside this item's files, so it is left for the Schedules lane or a follow-up.
