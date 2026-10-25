# Evidence: the Sessions screen (phase 5, item 16)

This is the polish-gate evidence for the Sessions screen: every session the kernel lists, its output streaming, and Stop (⌘.), Kill and Abandon, each showing the status the kernel answered. Every screenshot comes from the built app running against the fixture kernel, in light and dark mode. They are evidence for the owner's review, not visual-regression baselines: the spec never compares pixels.

- Screen: [`SessionsScreen.tsx`](../../../../app/src/screens/sessions/SessionsScreen.tsx) (discovered through [`index.tsx`](../../../../app/src/screens/sessions/index.tsx)), [`sessions.css`](../../../../app/src/screens/sessions/sessions.css), the model (order, status words, row → log line) [`model.ts`](../../../../app/src/screens/sessions/model.ts), the paged output reader [`output.ts`](../../../../app/src/screens/sessions/output.ts)
- Unit tests: [`SessionsScreen.test.tsx`](../../../../app/src/screens/sessions/SessionsScreen.test.tsx), [`model.test.ts`](../../../../app/src/screens/sessions/model.test.ts)
- e2e: [`sessions.spec.ts`](../../../../app/e2e/sessions.spec.ts) over the fixture [`fixtures/sessions.ts`](../../../../app/e2e/fixtures/sessions.ts)

## How they were produced

```sh
cd app
npm run build
SESSIONS_EVIDENCE=1 npx playwright test e2e/sessions.spec.ts --workers=1 -g AC8
```

The spec writes screenshots here only when **`SESSIONS_EVIDENCE=1`** is set. Before writing, it deletes every `*.png` in this folder, so the folder always matches the current states. Without the flag, the screenshots go to Playwright's per-test output directory, so a plain `npm run e2e` (locally or in CI) never changes the tree. Each one is a full-window screenshot (1180×760 at 2x, macOS, Electron 44) taken with `data-theme="light"` and then `data-theme="dark"` set on `<html>`. Before taking either, the spec checks that `color-scheme` reads that theme and that the ground colour differs between the two. The last test checks that this README and the folder list exactly the twelve files below.

Running times in the shots are real (the fixture's sessions started a few minutes before the run), so they differ from run to run.

## Screenshots

The screens they match are in [`docs/design/mockups/gui-v1.html`](../../../design/mockups/gui-v1.html): `renderSessions()`, `srow()` and `logHTML()` (styles under `/* Sessions */`), and the kernel band in `bands()`.

| Light | Dark | State | Matches in gui-v1.html |
|---|---|---|---|
| [empty-light.png](empty-light.png) | [empty-dark.png](empty-dark.png) | **Empty.** The kernel lists no session. | Sessions with the mockup's **Empty** toggle: "Nothing running.", the same sentence, and the "Ask Wright for something" button. |
| [loading-light.png](loading-light.png) | [loading-dark.png](loading-dark.png) | **Loading.** The first `GET /sessions` has not answered. | Sessions with the **Loading** toggle: skeleton rows in the 360px list pane (never a spinner) and an empty detail. The fixture holds the read open; nothing else in the app reads `GET /sessions`. |
| [error-light.png](error-light.png) | [error-dark.png](error-dark.png) | **Error.** `api.json` names a port nothing listens on. | The **Offline** toggle's band ("Couldn't reach the kernel…"), shown by the shell over the screen. Under it is the screen's own error, which names the kernel as the cause. |
| [waiting-light.png](waiting-light.png) | [waiting-dark.png](waiting-dark.png) | **Waiting on you.** Session #34 (ada, playbook #5) asked for approval #7; it is selected. | `renderSessions()`'s **Waiting on you** group and `logHTML()`'s waiting state ("Review approval ⌘3"). The row carries an `approval #7` badge; the log ends with the kernel's held decision inline (`Bash held · approval #7 · approval_required · …`). |
| [populated-light.png](populated-light.png) | [populated-dark.png](populated-dark.png) | **Populated (running, log streaming).** Session #31 (mason, playbook #4) is selected. | `srow()` rows under **Running · 2** and `logHTML()` for a running session (the mockup's `s1` review log): the header (status, agent, task, time, tokens, Read latest, Stop ⌘., Kill), tool calls in accent, results, prose, an allowed decision in green and the held and denied decisions in red, the live caret, and the "Following" pill. |
| [ended-light.png](ended-light.png) | [ended-dark.png](ended-dark.png) | **Ended (failed / stopped).** Kill was confirmed on #35 and the kernel answered `{status: "failed", reason: "kill_incomplete"}`; a `stopped` and a `completed` session sit below it. | `srow()` under **Finished** (here **Recent**) and the mockup's `killed` danger dot: the row says `failed` with `kill_incomplete` and `kill unconfirmed` danger badges, the log header says `failed · kill_incomplete` in a danger badge, Stop and Kill are disabled. It is never shown as `stopped`. |

Differences from the mockup, on purpose:

- Each row shows the agent's **avatar** (the requirement's Scope 1), not the mockup's status dot; the List primitive's rule is never a dot beside an avatar. The status word is the kernel's own, in the meta line.
- The third group is **Recent**, not "Finished today": an `orphaned` row is listed there, and the kernel says its process group may still be alive, so the group never claims it finished.
- There is no "≈$ at API rates" figure (D24: tokens are the primary figure, and the contract has no cost field), and no "Open handoff" / "Resume task" buttons (no route for either).
- The mockup's title-bar "Kill switch ⌘⇧K" button is the shell's, not this screen's.

## What the spec checks besides the screenshots

| AC | What it asserts in the running app |
|---|---|
| AC1 | With one running, two ended, one `kill_unconfirmed` and two orphaned sessions, the running one is first and selected. Each row shows its avatar (labelled with the agent), agent, task (`playbook #4`, `ad hoc session`), running time, tokens (`—` when `null`) and the kernel's status word. #28 shows `kill unconfirmed`; the orphans show `leader_unverified` and `reap_error`. |
| AC2 | After the fixture appends rows and pushes `session_output_appended` for #31, the new lines show and the fixture's record of output reads is exactly `after=0`, then `after=<last seq>` (each with `limit=500`), never `0` again. With the log scrolled up, more lines arrive: `scrollTop` is unchanged and the pill reads "Jump to latest". |
| AC3 | Every row kind shows inline: `init`, tool calls, results (an `is_error` one in the error style), prose, `Bash allowed · policy_allow`, `Bash held · approval #7 · approval_required`, `Bash denied · never_category · …`, a `success` and an `error_max_turns` result. A payload holding ESC and U+202E renders as the literal `\x1b[31m` and `\u202e`, as do the agent and the cwd; no raw C0/C1 control, bidi control or separator appears in `document.body.textContent`. A session with no cwd says `cwd unknown`. |
| AC4 | ⌘. sends exactly one `POST /sessions/31/stop`. While the fixture holds the answer the row says `stopping…` (a second ⌘. sends nothing); after it answers `{status: "stopped", reason: "owner_stop"}` the row says `stopped · owner_stop`. A `409 not_running` with `status: "completed"` shows `completed` and the refusal. |
| AC5 | Kill opens the confirm. Escape leaves it open and sends nothing; Cancel closes it and sends nothing; Confirm sends exactly one `POST /sessions/31/kill`. |
| AC6 | A kill answered `{status: "failed", reason: "kill_incomplete"}`: the row says `failed` with a danger `kill_incomplete` badge, the log header says `failed · kill_incomplete`, and after the list refetch the row still never says `stopped`. |
| AC7 | Abandon is absent for every row but the `leader_unverified` orphan (#26, `reap_error`, has none). Escape and Cancel send nothing; Confirm sends exactly one `POST /sessions/27/abandon`, and the row says `abandoned`. |
| AC9 | Keyboard only: J/K select, Read latest announces the last line, Home in the focused log pauses following and "Jump to latest" resumes it, ⌘. stops, Kill opens the confirm with focus on Cancel (Tab, Enter kills once), and Abandon does the same. |

In the unit tests, `sessions.stop` (⌘.), `sessions.kill` and `sessions.abandon` are registered commands in the palette's "Sessions" group, `enabled` following the selection (stop and kill only for a running session with no request in flight; abandon only for a `leader_unverified` orphan), none named `screens.sessions`, and all unregistered on unmount. With the global keyboard map installed over the same registry, ⌘. sends exactly one stop, from the body and from inside the log (where StreamingLog's own ⌘. handler hits the same in-flight guard).

## Findings for the owner

These are gaps in the contract (item 01) or the shell. None was worked around by changing the kernel, the contract or a shared file.

1. **No task field for a session.** `SessionSummary` is `{id, agent, status, model, started, ended, tokens, cwd, playbook}` (`app/src/api/contract.ts`, mirrored from `kernel/src/console/output.ts`), and `GET /status`'s `sessions` has no task either. The requirement asks each row to show the session's task; the screen shows `playbook #<n>` when `playbook` is set, else `ad hoc session`. A `task` (or the playbook's slug and the task's title) on `SessionSummary` would let the row say what the session is doing in words, as the mockup does ("review PR #412").
2. **The shell's layout gives screens no bounded height.** `.window`'s grid row is `auto` and `.main` keeps `min-height: auto` (`app/src/styles/app.css`), so `.content` grows with its content instead of scrolling. A log longer than the window grew to its full height and never scrolled, so "Jump to latest" never applied (the AC2 e2e caught it: `scrollHeight === clientHeight === 1260`). Chat records the same gap; like Chat, this screen holds its column to the window with `:has()`-scoped rules in its own stylesheet. The real fix is a bounded row in `app.css` (item 01's file); once it lands, both screens' `:has()` rules can go.
   **Closed (phase 5 polish, the Team inspector scrolls inside its pane, 2026-10-25):** `.window` now has `grid-template-rows: minmax(0, 1fr);` in `app.css`, so the shell bounds `.main`, and `.main:has(.sessions)` is gone from `sessions.css`. `.content:has(> .sessions)` stays: it only lays out the kernel band above the column Sessions fills. With the shell fix reverted and the `:has()` rule gone, this spec's AC2 fails with "the log does not scroll: it is not bounded by the pane" (recorded in `docs/evidence/phase-5-polish/team/README.md`).
3. **The shell mounts no `CommandPaletteHost`.** `App.tsx` never mounts it, so the running app has no ⌘K palette and no global keyboard map yet. The screen registers its commands, so the palette lists them once it is mounted; the e2e cannot open the palette, so the ⌘K listing is verified in unit tests only. Until then the screen handles J/K and ⌘. itself through a window listener in the bubble phase, which ignores any key already handled (the map's capture phase, or StreamingLog's own ⌘.), so no key runs twice.
4. **The shell passes screens no bridge.** The screen reads `window.api` itself and renders a plain no-bridge state when it is missing, which is what `App.test.tsx` mounts.
5. **`printable` is imported from the Approvals screen's directory** (`app/src/screens/approvals/printable.ts`, read-only), which couples the two screens. A shared module for the kernel's escaping would be item 01's file.
6. **`GET /sessions` answers the newest 50 by default.** A selected session that falls off that page shows "no longer in the kernel's list" and nothing acts until the owner picks another.
