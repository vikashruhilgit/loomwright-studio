# Phase 8 item 18c evidence: saved workspaces

**What shipped:** the kernel keeps one list of the owner's saved repo folders (`saved_workspaces`, migration 24), served by three owner routes (`GET /workspaces[?repo=]`, `POST /workspaces`, `POST /workspaces/:id/remove`), with `lookupSavedWorkspaces` exported for 18d. Settings → Workspaces lists the folders, adds one through a folder picker (the new bridge member `chooseFolder()`, channel `studio:choose-folder`) and removes rows with Undo. Design: [agents.md, Saved workspaces](../architecture/agents.md#saved-workspaces) (kernel) and [app.md, Settings → Workspaces](../architecture/app.md#settings--workspaces-phase-8-item-18c) (app).

This file holds the static suites' results and the owner's running-system check (Validation 2). The worker that wrote it does not write the Validation 2 verdict. Only the owner's report does.

## Static suites

Run on macOS (Darwin 25.6.0, Node v24.11.1) on 2026-11-11, from the working tree of branch `feature/saved-workspaces` over base `0b9ef984` with both subtasks' changes applied. Each command was run as written, and the counts are copied from its output.

| Command | Result |
|---|---|
| `cd kernel && npm ci && npm run typecheck && npm test` | exit 0. `npm ci` added 148 packages. `tsc -p tsconfig.json` clean. vitest: 132 test files (130 passed, 2 skipped), 4441 tests (**4425 passed**, 16 skipped, 0 failed) |
| `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e` | exit 0. `npm ci` added 388 packages. `tsc -p tsconfig.json && tsc -p tsconfig.node.json` clean. vitest: 102 test files, **3197 passed** (0 failed). `vite build` and the Electron build succeeded. Playwright: **354 passed** (0 failed, 5.4 min, 1 worker) |
| `bash scripts/check-docs.sh` | exit 0, `check-docs: OK` |

An earlier run of the app chain had 2 e2e failures, both in `e2e/phase-7-exit.spec.ts` (AC1 and AC2 settings). That spec fails on any request outside its composed route table, and Settings now reads `GET /workspaces`. `e2e/fixtures/phase-7-exit.ts` now names `GET /workspaces` in `PHASE_7_EXIT_ROUTE_KEYS` and serves it from the settings fixture (an empty list), as item 17c did for `GET /agents/:id`. The counts above are from the full rerun after that fix.

The 16 skipped kernel tests are conditional (`skipIf`/`runIf`) tests, such as the live exit probes that run only with `STUDIO_LIVE=1`. This item's `kernel/test/console-workspaces.test.ts` ran all 28 of its tests (`npx vitest run test/console-workspaces.test.ts`: 28 passed). That includes the EACCES test, which is skipped only when the suite runs as root.

### What the app tests pin (item 18c)

- `app/src/screens/settings/WorkspacesSection.test.tsx` (34 tests): the table of repo, path from `~` and last used (AC1); "Missing" and "Can't be read" in words, never ready (AC4); remove showing the row in place with Undo focused, and Undo saving the same path again (AC3); the no-remote note (AC5); the protected-folder and not-a-checkout refusals in plain words with the list unchanged (AC6); a cancelled or failed picker; a double-click sending one request; the loading, empty, error and unknown states; offline; literal kernel text; no input.
- `app/src/screens/settings/SettingsScreen.test.tsx`: Workspaces renders as the last region, below Threads.
- `app/electron/main.test.ts` ("the choose-folder channel") and `app/electron/preload.test.ts`: the channel is handled, refuses a caller that is not the window, opens a sheet on the owner's window with the main process's own options (`properties: ["openDirectory"]`), ignores any renderer argument, answers `null` on a cancel and rejects when the dialog can't be shown.
- `app/e2e/settings-workspaces.spec.ts` (6 tests, built app against the fixture kernel): AC1, AC3, AC4, AC5 and AC6 end to end. The main process's `dialog.showOpenDialog` is replaced with a recorder, so the picker runs through the real preload and IPC handler, and no native dialog opens.

**Mutation checks (app side, from the brief's pin table):** each of these made its pin fail, and each was reverted:

- `"Missing"` → `""` failed `WorkspacesSection.test.tsx` (2 tests).
- The rendered note → `""` failed 1 test.
- The rendered refusal → `""` failed 3 tests.
- Deleting the Undo button failed 1 test.
- Deleting the `<WorkspacesSection` mount failed `SettingsScreen.test.tsx`.
- Deleting `ipcMain.handle(CHANNELS.chooseFolder` failed `main.test.ts` (6 tests).
- Deleting the preload's `chooseFolder` member failed `preload.test.ts` (2 tests).
- Deleting the repo `<td>` failed the e2e AC1 test.
- Removing the double-submit guard failed the double-click test.

### What the static suites do not show

- The native macOS folder picker itself. In e2e, the dialog call is replaced, so the sheet's look and its behaviour on a real `~/Documents` pick are only seen in Validation 2.
- The app against the real kernel's routes. The e2e uses the fixture kernel. The real routes are covered by `kernel/test/console-workspaces.test.ts` (a real temp git checkout) and by `kernel/test/console-contract.test.ts`, which pins that they are served.

## Validation 2 (owner)

In the packaged app (`cd app && npm run package`, then open the built app), with the kernel running as the installed service:

1. Open Settings → Workspaces. Choose **Add folder…**, pick a checkout of `vikashruhilgit/studio-sandbox` outside `~/Documents`, `~/Desktop`, `~/Downloads` and iCloud Drive, and check that a row lists it with repo `vikashruhilgit/studio-sandbox`, its path from `~` and a last used of "Today, …".
   - What it showed: the row "vikashruhilgit/studio-sandbox · ~/studio-work/studio-sandbox · Today, 16:40", picked through the native macOS folder sheet (Go to Folder `~/studio-work/studio-sandbox`, Open). The list had read "No saved workspaces yet. Add folder... saves one." before.
2. Choose **Add folder…** again and pick a folder inside `~/Documents` (for example `~/Documents/work/studio-sandbox`). Check that the plain refusal appears ("… is inside a macOS-protected folder (~/Documents, ~/Desktop, ~/Downloads, ~/Library/Mobile Documents), so it can't be used: …; use a copy of the repo outside those folders.") and that no row is added.
   - What it showed: the plain refusal below the list, and the list still held only the step 1 row.
3. Optional: remove the row from step 1 with its remove icon, check that it shows as removed with **Undo**, then choose Undo and check that it is listed again.
   - What it showed: the row was replaced in place by "Removed ~/studio-work/studio-sandbox from your saved workspaces. The folder is still on disk, and no crew member's settings change. Undo saves it again, as used now. Undo"; choosing Undo listed the row again, unchanged.

Owner's result (filled in from the owner's report):

Verdict: PASS for Validation 2

Run on 2026-11-11 at 16:40 local time (macOS 26.6.2) by Claude, driving the app at the owner's direction (the owner asked for the check to be run rather than waived), against the packaged app (`npm run package`, `release/mac-arm64/Loomwright Studio.app`) and the kernel installed as the launchd service (`service install`), both built from PR head `bd5543d9`. Text copied from the app's screen:

```
Step 1 (Add folder... -> ~/studio-work/studio-sandbox):
  REPO                           PATH                           LAST USED
  vikashruhilgit/studio-sandbox  ~/studio-work/studio-sandbox   Today, 16:40

Step 2 (Add folder... -> ~/Documents/work/studio-sandbox):
  Not saved: ~/Documents/work/studio-sandbox. ~/Documents/work/studio-sandbox is inside a
  macOS-protected folder (~/Documents, ~/Desktop, ~/Downloads, ~/Library/Mobile Documents),
  so it can't be used: macOS blocks the kernel, which runs in the background, from reading
  anything there (D31); use a copy of the repo outside those folders.
  (rows listed: 1, the step 1 row)

Step 3 (remove, then Undo):
  Removed ~/studio-work/studio-sandbox from your saved workspaces. The folder is still on
  disk, and no crew member's settings change. Undo saves it again, as used now. Undo
  -> after Undo:
  vikashruhilgit/studio-sandbox  ~/studio-work/studio-sandbox   Today, 16:40
```
