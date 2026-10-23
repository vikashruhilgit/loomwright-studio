# Evidence: the menu bar, deep links, Pause all and the kill switch (phase 5, item 17)

This is the polish-gate evidence for the menu bar. The native menu-bar icon and its menu are `app/electron/tray.ts`. The `loomwright-studio://` link handler is `app/electron/deeplink.ts`. The window side is the status panel at `#/menubar` plus an always-mounted host that takes links and registers the Kernel ⌘K commands. Every screenshot comes from the built app running against the fixture kernel, in light and dark mode. They are evidence for the owner's review, not visual-regression baselines: the spec never compares pixels.

- Shared model: [`state.ts`](../../../../app/src/screens/menubar/state.ts) (the state precedence, the link grammar, the tray seam)
- Main process: [`tray.ts`](../../../../app/electron/tray.ts), [`deeplink.ts`](../../../../app/electron/deeplink.ts)
- Window: [`index.tsx`](../../../../app/src/screens/menubar/index.tsx), [`MenubarPanel.tsx`](../../../../app/src/screens/menubar/MenubarPanel.tsx), [`MenubarHost.tsx`](../../../../app/src/screens/menubar/MenubarHost.tsx), [`links.ts`](../../../../app/src/screens/menubar/links.ts), [`menubar.css`](../../../../app/src/screens/menubar/menubar.css), and the `#/approvals/<id>` selection in [`ApprovalsScreen.tsx`](../../../../app/src/screens/approvals/ApprovalsScreen.tsx)
- Unit tests: [`state.test.ts`](../../../../app/src/screens/menubar/state.test.ts), [`menubar.test.tsx`](../../../../app/src/screens/menubar/menubar.test.tsx), [`kernel-mirror.test.ts`](../../../../app/src/screens/menubar/kernel-mirror.test.ts), [`tray.test.ts`](../../../../app/electron/tray.test.ts), [`deeplink.test.ts`](../../../../app/electron/deeplink.test.ts), [`ApprovalsScreen.test.tsx`](../../../../app/src/screens/approvals/ApprovalsScreen.test.tsx)
- e2e: [`menubar.spec.ts`](../../../../app/e2e/menubar.spec.ts) over the fixture [`fixtures/menubar.ts`](../../../../app/e2e/fixtures/menubar.ts)

## How they were produced

```sh
cd app
npm run build
MENUBAR_EVIDENCE=1 npx playwright test e2e/menubar.spec.ts --workers=1
```

The spec writes screenshots here only when **`MENUBAR_EVIDENCE=1`** is set. Before writing, it deletes every `*.png` in this folder, so the folder always matches the current states. Without the flag, the screenshots go to Playwright's per-test output directory, so a plain `npm run e2e` (locally or in CI) never changes the tree. Each one is a full-window screenshot (1180×760 at 2x, macOS, Electron 44) taken with `data-theme="light"` and then `data-theme="dark"` set on `<html>`. Before taking either, the spec checks that `color-scheme` reads that theme and that the ground colour differs between the two. The last test checks that this README and the folder list exactly the eighteen files below.

## Screenshots

Every view matches the menu-bar dropdown in [`docs/design/mockups/gui-v1.html`](../../../design/mockups/gui-v1.html): `toggleMenu()` under `/* ---------- Menu-bar dropdown ---------- */`, styled by `.mbmenu`. Its status row is `.st` (the dot, the state word, and the meta line). Its rows are `.it`, with `.it.dng` for the kill switch, separated by `hr`. The panel renders it in the window as a card. It shows only what the contract carries: "N running · N waiting on you". It leaves out the mockup's tokens and cost line, because limits are tokens and never dollars (invariant 9). It also leaves out Ask Wright… and Settings…, which are not part of this item.

| Light | Dark | State | Matches in gui-v1.html |
|---|---|---|---|
| [loading-light.png](loading-light.png) | [loading-dark.png](loading-dark.png) | **Loading.** The first `GET /status` has not answered (the fixture holds it). | The `.mbmenu` card with static skeleton bars in place of `.st` and the rows. It shows no spinner and no guessed state. |
| [error-light.png](error-light.png) | [error-dark.png](error-dark.png) | **Error.** `api.json` names a port nothing listens on. | The **Offline** toggle's band ("Couldn't reach the kernel. It may be restarting; this window reconnects on its own."), shown by the shell's `UnreachableBand` above the panel. Under it the card says it couldn't read the kernel's state, and why. No action row is offered. |
| [idle-light.png](idle-light.png) | [idle-dark.png](idle-dark.png) | **Idle (empty).** Nothing running, nothing pending. | `.st` with the idle ring and "idle", then "0 running · 0 waiting on you". Approvals shows no pill, Pause all and Kill switch… are enabled, and Resume is disabled. |
| [working-light.png](working-light.png) | [working-dark.png](working-dark.png) | **Working.** Two sessions running. | `.st` with the working dot and "2 running · 0 waiting on you". |
| [waiting-light.png](waiting-light.png) | [waiting-dark.png](waiting-dark.png) | **Waiting on you.** Two pending approvals. | `.st` "waiting on you". The Approvals `.it` row carries the count pill (2), as the mockup's `menu-approvals` row does. |
| [paused-light.png](paused-light.png) | [paused-dark.png](paused-dark.png) | **Paused.** `GET /status` says `paused: true`. | The mockup's `pause` / `resume` row swap: the first action row reads **Unpause**, and Resume is enabled. |
| [cap-light.png](cap-light.png) | [cap-dark.png](cap-dark.png) | **Paused at cap.** A limit in `cap_state` is `rejected`. | `.st` with the parked dot, "paused at cap", and the reset time in the meta line ("· resets HH:MM"). |
| [killed-light.png](killed-light.png) | [killed-dark.png](killed-dark.png) | **Killed.** `kill_switch.engaged`. | `.st` with the failed (stop) dot and "killed". Kill switch… is disabled and Resume is enabled. |
| [kill-confirm-light.png](kill-confirm-light.png) | [kill-confirm-dark.png](kill-confirm-dark.png) | **The kill confirm**, over the working state. | The mockup's `killSwitch()` overlay, drawn with the design system's destructive `Dialog`: "Engage the kill switch?", the consequence with the number running, then Cancel and **Engage kill switch**. |

## The native menu, and what is verified instead

Playwright cannot screenshot or click the native macOS menu-bar icon or its menu, because they are drawn by the OS outside any web page. The spec therefore checks the tray through its e2e seam instead. That seam is `globalThis.__studioTray`. It is set only when the app is unpackaged and `STUDIO_APP_TRAY_SEAM=1`, and `tray.test.ts` pins that a packaged app never sets it. Through it the spec reads the model the icon and menu are built from (the state, the count, the title beside the icon, and every item's label and enabled flag) and presses items exactly as the menu does. The native kill confirm (`dialog.showMessageBox`) is replaced with a stub that answers Cancel or Engage and counts how many times it was asked.

On macOS, every local e2e run briefly puts a real menu-bar icon in the menu bar while the app is up. The harness hides windows only.

## What the spec checks besides the screenshots

| AC | What it asserts in the running app |
|---|---|
| AC1 | With two pending approvals and a status at rest, the tray model reads `count` 2, title `"2"`, state `waiting`, and items status / open / pause-all / kill-switch / resume / quit. The panel agrees ("0 running · 2 waiting on you"). |
| AC2 | The tray's Pause all sends exactly one `POST /pause`. The state becomes `paused` only once a later `GET /status` (seen in the fixture's log after the POST) says so. The item then reads Unpause and sends `POST /unpause`. The case where the kernel still says `paused: false` is unit-pinned in `tray.test.ts` and `menubar.test.tsx`. |
| AC3 | Tray: Kill switch… asks once. On Cancel nothing is sent and the state is unchanged. On Engage, exactly one `POST /stop-all` is sent, the state is `killed`, and the item is disabled. Resume sends `POST /resume`. Window: the panel's Kill switch… opens the `Dialog`. Cancel sends nothing, Engage sends exactly one `POST /stop-all`, and Resume sends `POST /resume`. |
| AC4 | `loomwright-studio://notifications/7` (a `kernel:approval` titled `Approval 7: Bash`) lands on `#/approvals/7` with #7 selected, not the older #4. It causes one `GET /notifications/7`, no `POST /approvals/*`, and no toast. `loomwright-studio://notifications/3` (`agent:pim`) lands on `#/chat/pim`. Each of `loomwright-studio://approve/7`, `…/notifications/abc`, `…/notifications/7?x=1` and `https://example.com/notifications/7` shows exactly one toast ("That notification link points to nothing Studio can open") and changes no route. After each, no `GET /notifications/*` and no POST reach the fixture. |
| AC4b, AC5 (macOS) | After the window is closed, the app process is still running and the tray model is still readable (count 2). `…/notifications/7` then creates one window that lands on `#/approvals/7`. Exactly one `GET /notifications/7` is sent and no toast shows, even though the main process may deliver the route twice. |
| AC5 | Pressing Quit in the tray exits the app process. Afterwards the fixture kernel still answers `GET /status` (200, kill switch off), and its log holds no `POST /stop-all`, `POST /pause` or `POST /sessions/*` from the quit. |
| AC7 | Keyboard only, on the panel: Space on Pause all pauses, and the same button keeps focus reading Unpause. Enter on Resume resumes. Enter on Kill switch… opens the confirm with focus on Cancel. Escape cancels and sends nothing, as does Enter on Cancel. Tab then Enter engages, sending exactly one `POST /stop-all`. Focus then moves to Resume, never to `<body>`, and Enter on Resume resumes. Enter on Approvals opens `#/approvals`. |

The unit tests (`menubar.test.tsx`) also pin the following. The four commands `menubar.pause-all`, `menubar.unpause`, `menubar.kill-switch` and `menubar.resume` are registered in group "Kernel" with no shortcut, are removed on unmount, and their `enabled` follows each `GET /status` answer. The host subscribes `onNavigate` when its module is evaluated. A route repeated within 2 s is handled once. `invalid-link` makes no request at all. An older link that answers late never overrides a newer one.

## The window-closed steps run on macOS only

On every platform but macOS, `app/electron/main.ts` quits on `window-all-closed` (`if (process.platform !== "darwin") app.quit();`). This item does not edit `main.ts`. So the two steps that close the window first (AC4b's closed-window link, and AC5's "still running with the window closed") are `test.skip`ped off macOS, and CI's e2e runs on ubuntu. The closed-window delivery path is unit-tested on every platform in `deeplink.test.ts` (AC4b (i) to (iii)). Keeping the app alive on Linux is a product decision outside this item.

**macOS run (2026-10-23, Electron 44, this branch):** `npx playwright test e2e/menubar.spec.ts --workers=1` passed every test, including the macOS-only "AC4b + AC5 (macOS)" test, which ran and was not skipped.

## Findings for the owner

These are gaps in the contract (item 01) or the shell. None was worked around by changing the kernel, the contract or a shared file.

1. **No approval reference on `GET /notifications/:id`.** `notificationDetail` in `kernel/src/notifications/routes.ts` adds a `trigger` (for `trigger:<id>`) or a `session` (for `agent:<name>`), never the approval a `kernel:approval` notification is about. The app therefore reads the id from the kernel-authored title `Approval ${id}: ${action}` (`kernel/src/approvals/store.ts`), anchored as `^Approval ([1-9][0-9]{0,15}): `, and only for the source `kernel:approval`. An agent can only post `agent:<name>` sources (`kernel/src/notifications/tool.ts`), so it cannot forge one. `kernel-mirror.test.ts` pins the source, the title template and the link prefix against the kernel's source. An `approval_id` field on the detail would remove the title parsing.
2. **No owning agent on a `trigger` detail.** The detail's `trigger` is `{ id, action, next_fire_at }`. It names no agent, so a `trigger:<id>` link opens Wright's thread (`#/chat`), where playbook cards appear, rather than the thread of the agent the playbook runs as.
3. **`App.tsx` mounts no ⌘K palette host and does not subscribe `onNavigate`.** The four Kernel commands are registered in the app's registry, so the palette lists them once a host is mounted. Until then they are reachable through the panel's buttons, which are keyboard-operable (AC7). Links reach the window because the menubar module's always-mounted `SidebarSection` subscribes `window.api.onNavigate` itself, at module evaluation. It needs no edit to `App.tsx`.
4. **The kill confirm closes on Escape.** The design system's destructive `Dialog` (`kind="confirm"`) ignores Escape by design. This item's AC7 requires the kill confirm to be dismissable by keyboard, so the host adds an Escape-to-cancel for that one dialog. Cancelling sends nothing. Every other confirm keeps the design system's rule.

## Scope: the owner's LP-SCOPE widening (2026-10-22)

Besides the requirement's own files, the owner approved ("Widen app Touches") edits to three files. `app/electron/main.test.ts` gains electron mock entries only (`Tray`, `Menu`, `nativeImage` and `dialog`; the `app` members the tray and deep-link handler call were already mocked), so `main()` still reaches `createWindow()` with every existing assertion unchanged. `app/src/screens/approvals/ApprovalsScreen.tsx` and its test gain the `#/approvals/<id>` selection only. On mount and on `hashchange`, that selection sets the selected id and nothing else: no decision is sent, an id not in the list takes the screen's existing "no longer waiting" path, and `#/approvals` with no id still opens on the oldest row. There is no kernel change and no new npm dependency.
