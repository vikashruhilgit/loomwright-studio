# Evidence: the Approvals screen (phase 5, item 15)

This is the polish-gate evidence for the Approvals screen: the inbox, the exact payload, Allow once, Always for this playbook, Deny, and the standing grants. Every screenshot comes from the built app running against the fixture kernel, in light and dark mode. They are evidence for the owner's review, not visual-regression baselines: the spec never compares pixels.

- Screen: [`ApprovalsScreen.tsx`](../../../../app/src/screens/approvals/ApprovalsScreen.tsx) (discovered through [`index.tsx`](../../../../app/src/screens/approvals/index.tsx)), [`approvals.css`](../../../../app/src/screens/approvals/approvals.css), escaping [`printable.ts`](../../../../app/src/screens/approvals/printable.ts), kernel mirror [`kernel-mirror.ts`](../../../../app/src/screens/approvals/kernel-mirror.ts)
- Unit tests: [`ApprovalsScreen.test.tsx`](../../../../app/src/screens/approvals/ApprovalsScreen.test.tsx), [`printable.test.ts`](../../../../app/src/screens/approvals/printable.test.ts), [`kernel-mirror.test.ts`](../../../../app/src/screens/approvals/kernel-mirror.test.ts)
- e2e: [`approvals.spec.ts`](../../../../app/e2e/approvals.spec.ts) over the fixture [`fixtures/approvals.ts`](../../../../app/e2e/fixtures/approvals.ts)

## How they were produced

```sh
cd app
npm run build
APPROVALS_EVIDENCE=1 npx playwright test e2e/approvals.spec.ts --workers=1
```

The spec writes screenshots here only when **`APPROVALS_EVIDENCE=1`** is set. Before writing, it deletes every `*.png` in this folder, so the folder always matches the current states. Without the flag, the screenshots go to Playwright's per-test output directory, so a plain `npm run e2e` (locally or in CI) never changes the tree. Each one is a full-window screenshot (1180×760 at 2x, macOS, Electron 44) taken with `data-theme="light"` and then `data-theme="dark"` set on `<html>`. Before taking either, the spec checks that `color-scheme` reads that theme and that the ground colour differs between the two. The last test checks that this README and the folder list exactly the twelve files below.

## Screenshots

The screens they match are in [`docs/design/mockups/gui-v1.html`](../../../design/mockups/gui-v1.html): `renderApprovals()` and `detailHTML()` (styles under `/* Approvals */`), and the kernel band in `bands()`.

| Light | Dark | State | Matches in gui-v1.html |
|---|---|---|---|
| [empty-light.png](empty-light.png) | [empty-dark.png](empty-dark.png) | **Empty.** Nothing pending and no grants. | Approvals with the mockup's **Empty** toggle: "Nothing waiting on you.", the same sentence, and the "See what's running" button. The empty grants section sits under it. |
| [loading-light.png](loading-light.png) | [loading-dark.png](loading-dark.png) | **Loading.** The first `GET /approvals` has not answered. | Approvals with the **Loading** toggle: skeleton rows in the 360px list pane (never a spinner) and an empty detail. To hold the read in flight, the spec replaces the main process's request handler with one that never settles. |
| [error-light.png](error-light.png) | [error-dark.png](error-dark.png) | **Error.** `api.json` names a port nothing listens on. | The **Offline** toggle's band ("Couldn't reach the kernel. It may be restarting; this window reconnects on its own."), shown by the shell over the screen. Under it is the screen's own error, which names the kernel as the cause. |
| [waiting-light.png](waiting-light.png) | [waiting-dark.png](waiting-dark.png) | **Waiting on you.** Three pending, oldest first; #1 (a charter create from playbook `crew-setup` v2) is selected. | `renderApprovals()` inbox plus `detailHTML()`: rows with the waiting dot, the action as the title, agent · session · playbook, the cwd, the kernel's line ("The kernel creates this crew member when you allow it."), the display and the exact payload in mono wells, and **Allow once A / Always for this playbook ⇧A / Deny D**. |
| [populated-light.png](populated-light.png) | [populated-dark.png](populated-dark.png) | **Populated (detail + grants).** #2 (a rail-held `Bash` call from `review-prs` v3) is selected, with two standing grants. | The `detailHTML()` "Outward action" payload well, with the payload's own cwd. Below it is the grants section: grant #17 carries the **not current** badge, grant #21 has none, and each has Revoke. The mockup has no grants section; its "Revoke it from the playbook" toast is the nearest. |
| [decided-light.png](decided-light.png) | [decided-dark.png](decided-dark.png) | **Decided.** A was pressed on #1, then **Show decided** was turned on. | `decide()`'s outcome, shown in place: "allowed once" by owner, the kernel's `applied` sentence, then the message the agent gets (the `approval:1` brain message). Decided rows sit under the pending ones, and the selection stays on #1. |

## What the spec checks besides the screenshots

| AC | What it asserts in the running app |
|---|---|
| AC1 | With two pending, #1 (oldest) comes first and is selected. When a third arrives through the feed, the order and the selection are unchanged. After J selects #2, `GET /approvals` stops returning #1 and an `approval_decided` event is pushed: #2 is still selected and still shown. |
| AC1b, AC2 | The detail shows `kernel_agent_create`, `wright`, `session #12`, `from playbook crew-setup v2`, the session's cwd (the payload has none) and the kernel's line. A sends exactly one `POST /approvals/1/approve` with body `{"decision":"once"}`. The `applied` sentence then shows, followed by the agent's message. A second A sends nothing. |
| AC3 | With `playbook: null`, the Always button is disabled, its explanation is `always needs an approval the rail held from a playbook session; approve it once`, and ⇧A sends nothing. On a playbook approval the kernel refuses, ⇧A sends `{"decision":"always"}`, the 409's `message` shows, and the approval stays pending. |
| AC4 | A payload and a display holding `\u001b[31m` and U+202E render as the literal text `\x1b[31m` and `\u202e`, in a `<pre>` with a monospace font. No raw C0/C1 control, bidi control or separator appears anywhere in `document.body.textContent`. |
| AC5 | The `current: false` grant shows "not current"; the current one does not. Revoke opens the confirm. Cancel sends nothing, and Confirm sends exactly one `POST /approvals/grants/17/revoke`. |
| AC7 | Keyboard only: J/K select, ⇧A, D and A each decide (one request each), "Show grants" moves focus to the grants heading, Revoke opens the confirm with focus on Cancel (Enter cancels; Tab then Enter revokes once), and "Show decided" adds the kernel's decided list. |

In the unit tests, A, ⇧A, D, "show grants" and "show decided" are registered commands with ids `approvals.*` in the palette's "Approvals" group, and they are unregistered on unmount. With the global keyboard map installed over the same registry, A still sends exactly one request.

## Findings for the owner

These are gaps in the contract (item 01) or the shell. None was worked around by changing the kernel, the contract or a shared file.

1. **No `always`-eligibility field on `Approval`.** The kernel decides whether it accepts `always` only on `POST /approvals/:id/approve` (`alwaysRefusal` in `kernel/src/approvals/store.ts`, which answers `409 always_not_supported` with a `message`). The screen can tell only one case in advance, `playbook === null`. There it disables ⇧A and shows the kernel's `ALWAYS_REFUSED` sentence plus "; approve it once". For every other case it sends the request and shows the kernel's 409 `message`, escaped, beside the buttons. Those cases are a stale playbook version, an unnamed or mismatched agent, and an always-held tool, which includes every kernel-applied tool such as a charter create. If `GET /approvals` carried `always_refusal: string | null`, the button could explain itself before you press it.
2. **No `source` (rail / agent request) field on `Approval`.** For a no-playbook approval the kernel has two different refusals: "asked for by its agent", which it checks first, and "no playbook". The app cannot tell them apart, so it shows `ALWAYS_REFUSED`, which is true for both.
3. **No `cwd` on `Approval`.** The detail shows the payload's own string `cwd` when there is one (a rail-held Bash payload is `{tool, command, cwd}`). Otherwise it shows the requesting session's `SessionSummary.cwd` from `GET /sessions`, and otherwise "cwd unknown". A session the `GET /sessions` page does not include falls through to "cwd unknown".
4. **The shell mounts no `CommandPaletteHost`.** `App.tsx` never mounts it, so the running app has no ⌘K palette and no global keyboard map yet. The screen registers its commands, so the palette lists them once it is mounted. Until then it handles A, ⇧A, D and J/K itself through a window listener in the bubble phase. That listener ignores any key the keyboard map has already handled (the map prevents the default in the capture phase), so no key ever runs twice; a unit test pins this. Mounting the host is item 01's (or 17's) call.
5. **The shell passes screens no bridge.** The screen reads `window.api` itself and renders a plain no-bridge state when it is missing, which is what `App.test.tsx` mounts.
