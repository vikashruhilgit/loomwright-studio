# Supervisor Job: Integrations polish: switch from a token to the GitHub App without Disconnect (phase 7, item 09)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-30-192357/L7
- **CLAUDE.md:** ✓ Found (fresh: every path in its "Where things are" table exists; `bash scripts/check-docs.sh` enforces it)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (sibling phase 7 lanes may be open in parallel. This item's lanes are the integrations screen, its e2e, the GitHub App port and two architecture docs. Before FINALIZE, check `git log origin/main` for overlap; see Risk Assessment.)
- **Source requirement:** .supervisor/requirements/phase-7/2026-10-30-140009-integrations-polish-and-the-token-to-app-switch.md
- **Base commit:** fcaa34473546a8bc8e8f1a0146ed49921796f334

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | The app is React + Electron with vitest/jsdom and a Playwright e2e launched through `app/e2e/electron-harness.ts`. The kernel is strict TypeScript with vitest. The work needs nothing new. |
| 2 | Dependency Availability | GO | No new dependency. The setup sheet (`AppSetupSheet.tsx`), the setup routes, the port and the e2e fixture all exist at the base commit. The GUI v2 mockup this item depends on (`docs/design/mockups/gui-v2.html`, item 02) is merged. |
| 3 | Architecture Fit | CAUTION | The requirement assumes the kernel needs no change. Launch Pad found that the real kernel never gives the setup dialog its step-2 signal over an existing row. `storeApp` emits its event only when it creates the row: `kernel/src/integrations/github/app-port.ts` has `if (existing === undefined) statusEvent(store, updated, at);`, pinned by `kernel/test/integrations-github-app-port.test.ts` "with a token connected, records the slug and leaves method, status, the PAT item and the permissions as they were" (`expect(statusEvents()).toEqual([]);`). The app re-reads `GET /connectors` only on a `connector_status` event, so with a token in use the dialog stays on "Step 1 · Create" until the install connects. **Owner decision (Launch Pad, 2026-10-31, `LP-CLARIFY`): make the small kernel fix.** `storeApp` appends one `connector_status` event (status and method unchanged, no `refused`) whenever it records the slug on an existing row, and that pin changes on purpose. The fix also covers the post-Disconnect path the owner used on 2026-10-30 (the row is kept `disconnected`, so no event fired there either). |
| 4 | Scope vs Supervisor Capability | CAUTION | About 15 files change: 12 modify and 3 create, plus 12 generated screenshots. That is over the 12-file `context-bound` bound. The work splits into two groups with zero file overlap: the kernel (3 files) and the app with its e2e and doc (12). |
| 5 | Hard Blockers | GO | No migration and no credentials are needed. The e2e runs against the fixture kernel and never against real GitHub or a real browser (`shell.openExternal` is stubbed by the spec's `open`). |

**Overall Verdict:** CAUTION

## Task
**Goal:** On the token-connected GitHub detail, add "Switch to GitHub App". It opens the existing App setup dialog over the token connection and keeps the token in use until the install succeeds. Add the one kernel event that lets that dialog reach step 2, the polish fixes this path needs, and the polish-gate screenshots.

**Problem Statement:**
The owner, connected to GitHub with a token, needs to move to the GitHub App without disconnecting first. That way a switch never leaves GitHub disconnected part-way through.
Currently `TokenDetail` (`app/src/screens/integrations/IntegrationsView.tsx`) offers only Replace token and Disconnect. On 2026-10-30 the owner had to press Disconnect (event 2811, `docs/evidence/github-app-connect-live-2026-10-30.json`) before setting up the App. Even after Disconnect, the real kernel gave the setup dialog no step-2 signal, because `storeApp` over an existing row appends no event.
Success looks like this: from a token connection, Switch opens the setup dialog, which follows the real kernel to step 2 and on to the connected App. The token item goes only through `recordInstallation`, and a cancel or a failure leaves the token connection exactly as it was.

**Kernel's existing behaviour (the port, `docs/architecture/integrations.md` "The port"):** `storeApp` records `app_slug` and leaves `method` and `status` unchanged ("a token in use stays in use"). `recordInstallation` deletes the token's Keychain item and writes the row `connected`, `method: app`. A refused install (`token_write_scoped`, `install_failed`) leaves a token in use unchanged. The kernel is not asked to change any of this; only the step-2 event is added.

**Mockup (owner-approved by merging item 02):** `docs/design/mockups/gui-v2.html`, views `integrations-token`, `integrations-token-to-app` (dialog `sw1`), `integrations-token-to-app-install` (`sw2`), `integrations-token-to-app-failed` (`swf`), `integrations-app-connected` and `integrations-unreachable`. Copy is lifted from `integrationsScreen()` and `switchDialog()` there. The mockup's "Proposal" badges and its "Proposal for review" box are review furniture: the owner approved the switch by merging the mockup, so the app shows neither. The palette entry is the mockup's keymap row "Switch GitHub to the GitHub App", "While GitHub is connected by token".

**Owner decisions carried from the requirement (binding):** Integrations is polish only, with no new connector (Slack, Calendar and Mail stay in phase 9). The App's name and the setup pages do not change. The token stays in use until the install succeeds. Untrusted strings (account, repo names, permission names, refusals) are React text children, never markup, and the kernel's refusal `message` is never shown. Invariants 1 to 9 are unchanged. Studio never runs a claude.ai sign-in, and Studio never removes the App on GitHub.

## Acceptance Criteria

Carried from the requirement (AC1 to AC8), plus AC9 and AC10 for the owner's 2026-10-31 kernel decision.

- [ ] **AC1** Given a token connection (connected, expiring or expired), when the owner presses "Switch to GitHub App" on the detail pane (or runs the palette command), then the App setup dialog opens with one `POST /connectors/github/app/setup` call and the returned `setup_url` opened through the open-external channel, the Studio window does not navigate, no `POST /connectors/github/disconnect` is sent, and while the dialog runs the list row reads `connected · <account> · token · setting up the App` and the detail pane keeps the token's data.
- [ ] **AC2** Given the switch dialog open over a token, when the setup is cancelled (Cancel, Escape or the backdrop: one cancel call each) or fails (a `refused` of `install_failed`, `token_write_scoped`, `setup_expired` or any other reason, as an event or as the setup route's refusal), then the token connection is unchanged: the row is still `method: token` with its status, account and repos, no disconnect call was made, and the dialog's words and the list row say GitHub is still connected through the token. The failed view is the mockup's `swf` ("Setup didn't finish", "GitHub is still connected through your token", Close and Set up again, with no "Paste a token instead"). The cancelled view says "Setup cancelled. GitHub is still connected through your token." and does not say "Nothing was connected". Over a token, every refusal (`token_write_scoped` and `setup_expired` included) shows the one `swf` view, as the approved mockup has a single failure dialog for the switch. For `token_write_scoped` the view also lists the write permissions the refusal names, as the existing write-scoped view does, because the owner needs them to fix the App. The no-token path's four outcome views are unchanged.
- [ ] **AC3** Given the install succeeds (the fixture's `change("app-connected")`, which mirrors `recordInstallation`), then the dialog closes, the detail pane is `AppDetail` (GitHub App badge, installation, "renews automatically", Token row "None" where the mockup shows it), and the token item is gone. The e2e pins this against the fixture.
- [ ] **AC4** Given the kernel unreachable (status 0) on the token detail, then the shared band shows, the screen keeps its last data without a throw, and "Switch to GitHub App" is disabled with the existing `title="Needs the kernel"`, like Replace and Disconnect.
- [ ] **AC5** Given the keyboard only, then "Switch to GitHub App" is reachable by Tab in the detail header between Replace token and Disconnect (the mockup's order). The dialog traps focus and returns it to the Switch button, or to the connector row when that button is gone. The palette lists "Switch GitHub to the GitHub App" (id `integrations.switch-to-app`, group `Integrations`), enabled only while a token is in use, the kernel is reachable and no App is connected.
- [ ] **AC6** Given a live `connector_status` event that changes what the screen shows (step 1 → step 2 during the switch, and token → App when the install lands), then the screen updates without a reload, without a loading flash and without layout shift, measured as the existing AC10 e2e measures it.
- [ ] **AC7** Given VoiceOver, then the Switch button, the dialog (`aria-labelledby` / `aria-describedby`), each step and each outcome have labels, the dialog's live region states each step, including "GitHub stays connected through the token", and both themes meet WCAG 2.1 AA contrast. Only existing tokens and classes are used, with no new colour.
- [ ] **AC8** Given the polish gate, then a committed evidence file `docs/evidence/phase-7-polish/integrations/README.md` names each screenshot against its mockup view (`integrations-token`, `integrations-token-to-app`, `integrations-token-to-app-install`, `integrations-token-to-app-failed`, `integrations-app-connected`, `integrations-unreachable`), each in light and dark (12 PNGs written by the e2e under `INTEGRATIONS_EVIDENCE=1`). It lists every polish fix this PR makes and links every screenshot, and the PR body links to it.
- [ ] **AC9** (kernel, owner decision 2026-10-31) Given an existing GitHub row (a token connected, or `disconnected` after a Disconnect), when `storeApp` records the App's slug, then exactly one `connector_status` event is appended with the row's unchanged `status`, no `refused` and no secret. `method`, `status`, the PAT item and the permissions stay as they were. A first-ever `storeApp` (no row) still appends exactly one event, not two. The pin in `kernel/test/integrations-github-app-port.test.ts` changes from `expect(statusEvents()).toEqual([]);` to one event, and every other event-count assertion in the kernel suite still holds or is updated with a stated reason.
- [ ] **AC10** (docs) `docs/architecture/integrations.md` "The port" (`storeApp` row) says it appends one `connector_status` event, the step-2 signal. `docs/architecture/app.md` "The step-2 signal" says the kernel now confirms the event bullet, and describes the switch from a token. `bash scripts/check-docs.sh` passes.

**Evidence rule:** AC8's evidence lives in the committed `docs/evidence/phase-7-polish/integrations/README.md` (Markdown, a File Impact Map create), never only in the PR body.

**Validation (must pass before merge):** `cd app && npm ci && npm run typecheck && npm test && npm run build`; the Playwright e2e for the screen (`npx playwright test e2e/integrations.spec.ts e2e/integrations-switch.spec.ts --workers=1` after `npm run build`, launched only through `app/e2e/electron-harness.ts`); `cd kernel && npm ci && npm run typecheck && npm test`; `bash scripts/check-docs.sh`.

## Feasibility findings carried forward
See `## Risk Assessment` (source "Feasibility (Phase 2.5)").

## File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel | `kernel/src/integrations/github/app-port.ts` (361), `kernel/test/integrations-github-app-port.test.ts` (1023; the existing pin is changed in place, its single authority, and the new case "over an existing row (disconnected), one connector_status event" joins the same `storeApp` describe block, where its siblings are), `docs/architecture/integrations.md` (220) | — | HIGH |
| kernel: conditional | `kernel/test/integrations-github-app-setup.test.ts` (981), `kernel/test/phase-6-exit.test.ts` (805): edited only if an event count that includes a successful `storeApp` changes, each with a one-line reason | — | LOW |
| app: screen | `app/src/screens/integrations/IntegrationsView.tsx` (695), `app/src/screens/integrations/AppSetupSheet.tsx` (425), `app/src/screens/integrations/app-setup.ts` (168), `app/src/screens/integrations/commands.ts` (88), `app/src/screens/integrations/model.ts` (363) | `app/src/screens/integrations/switch.test.tsx` | HIGH |
| app: existing unit tests | `app/src/screens/integrations/integrations.test.tsx` (756; only where an existing expectation changes: the `owned(kernel)` command list at its line 466 is extended, and header-button expectations are updated; new cases go to `switch.test.tsx`) | — | MEDIUM |
| app: conditional style | `app/src/screens/integrations/integrations.css` (548): only if the header's three buttons need a wrap rule at narrow widths. It reuses existing tokens, with no new colour | — | LOW |
| app: e2e | `app/e2e/fixtures/integrations.ts` (305), `app/e2e/integrations.spec.ts` (931; only the keyboard walk's Tab order and anything the new button shifts; new cases go to the new spec) | `app/e2e/integrations-switch.spec.ts` | MEDIUM |
| app: docs and evidence | `docs/architecture/app.md` (163) | `docs/evidence/phase-7-polish/integrations/README.md` (+ 12 PNGs the e2e writes) | HIGH |

**Module layout (one home per new responsibility):**
- The switch's unit tests go to a **CREATE** `switch.test.tsx`, never appended to `integrations.test.tsx` (756) or `app-setup.test.ts` (583).
- The switch e2e, with its evidence dir `docs/evidence/phase-7-polish/integrations/`, goes to a **CREATE** `app/e2e/integrations-switch.spec.ts`, never appended to `integrations.spec.ts` (931). It reuses `launchApp` from `./electron-harness`, `startFixtureKernel` and `integrationsFixture`. Its screenshot helper follows `app/e2e/settings.spec.ts`'s phase-7 pattern: `INTEGRATIONS_EVIDENCE=1` writes to the tracked dir, otherwise to Playwright's output dir, and a test asserts the tracked dir is untouched otherwise.
- The switch's state and handler stay in `IntegrationsView.tsx` (695). Reason: the setup's one owner is `startApp` / `closeApp` / `app` there. Switch is `startApp` called over a token plus one `switching` flag, and a second home would duplicate the opener, focus and overlay state. Keep the addition small: one button, one flag, the row meta.
- The dialog's switch copy goes in `AppSetupSheet.tsx` (425) through one new optional prop (`overToken` / `switching`), not a second dialog. Reason: one dialog owns the setup call, cancel and step logic, and a copy would fork it.
- The token-aware row words go in `app-setup.ts` (168, next to `appRowMeta`).
- The fixture gains one helper, `appStored()`: `storeApp` over the current row (`app_slug` set, `method` and `status` unchanged, one non-refusal `connector_status` event). It mirrors the fixed kernel. It is not a new `AppState` value, so the fixture's `AppState` union does not grow. The palette's command-id list does grow; see `## Closed enumerations touched`.
- The Switch button's test id is a new key in `INTEGRATIONS_TEST_IDS`, `switchToApp: "integrations-switch-to-app"`, used on exactly one line of `IntegrationsView.tsx` (`data-testid={IDS.switchToApp}`), and copied into the new spec's `IDS`.
- The kernel change is one line in `storeApp` plus its test. No new module.

**Validator-owned surfaces:** `scripts/check-docs.sh` checks every relative link in `docs/` (the new README's 12 image links must resolve) and CLAUDE.md's table. Nothing else it scans changes.

**Total estimated files:** 12 modify + 3 create (+ 12 generated PNGs), and up to 3 more conditional modifies (the two kernel tests and `integrations.css`)

### File Overlap Detection

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| kernel (Subtask 1) | app (Subtask 2) | none | NO |

## Touched-file invariants

> Grounded at base `fcaa34473546a8bc8e8f1a0146ed49921796f334`. Every worker re-checks the entries for the files in its lanes before handing back.

- **`kernel/src/integrations/github/app-port.ts`**
  - **keep:** `storeApp` never changes `method` or `status` (`// The row records the slug only: method and status stay as they are (a PAT may be in use).`). It runs serialised on the shared credential queue (`storeApp: (store, conversion, pem, now) => exclusive(() => storeApp(store, conversion, pem, now), fail("conversion_failed", MESSAGES.failed_store)),`). It never throws or rejects. The event is appended inside the same `store.transaction(() => {` as the slug write.
  - **reuse:** the existing `statusEvent(store, updated, at)` (payload `{ connector_id: row.id, kind: row.kind, status: row.status }`, from `connector.ts`). Replace the condition `if (existing === undefined) statusEvent(store, updated, at);` so that exactly one event fires in both cases, never two.
  - **mirror:** the app reads any non-refusal `connector_status` as progress (`app/src/screens/integrations/app-setup.ts`: `if (event.kind !== "connector_status") return undefined;`). The console summarises it as `Connector github: <status>` (`kernel/src/console/threads.ts`: `return card(isText(p.status) ? \`${name}: ${shown(p.status)}\``), so the new event reads "Connector github: connected" over a token; that is accepted, and the payload carries no secret.
  - **pinned by:** `kernel/test/integrations-github-app-port.test.ts` (`expect(statusEvents()).toEqual([]);` in "with a token connected, records the slug…", and the sequence `["disconnected", "connected", "disconnected"]`). Also check `kernel/test/integrations-github-app-setup.test.ts` (`connectorEvents`, `Array(6).fill("connector_status")`) and `kernel/test/phase-6-exit.test.ts` (`events(store, "connector_status")`).
- **`app/src/screens/integrations/IntegrationsView.tsx`**
  - **keep:** one overlay at a time (`if (disconnecting.current || app !== undefined) return;`). No App setup while a token check is out (`setNotice({ text: TOKEN_PENDING });`). Disconnect is refused while the dialog runs (`if (!tokenInUse || offline || app !== undefined) return;`). The dialog closes when the App connects (`const appConnected = appInUse && (view.state === "connected" || view.state === "expiring");`). Every kernel string is a text child ("Every string from the kernel or GitHub").
  - **reuse:** `startApp`, `closeApp`, `rememberOpener` and the existing `dis` (`title: "Needs the kernel"`). Do not write a second setup launcher.
- **`app/src/screens/integrations/AppSetupSheet.tsx`**
  - **keep:** one setup call per mount; "Open GitHub again" reopens the same URL ("with no second setup call"). Cancel, Escape and the backdrop each send one cancel call ("Cancel, Escape and the backdrop all cancel a running setup (one call to"). The kernel's `message` is never shown ("The kernel's own `message` is never shown"). `data-phase` keeps its values.
  - **reuse:** `useModalFocus`, `Step` and the existing outcome views. The switch changes only copy and which buttons show.
- **`app/src/screens/integrations/app-setup.ts`**
  - **keep:** `appRowMeta` for the no-token path (`return { dot: "idle", text: \`not connected · ${note[phase.outcome]}\` };`). Add the token-aware words beside it; do not change this path.
- **`app/src/screens/integrations/commands.ts`**
  - **keep:** commands are registered once and read through a ref (`useEffect(() => registry.register(INTEGRATIONS_OWNER, integrationsCommands(() => latest.current.flags, () => latest.current.handlers)), [registry]);`). Ids are prefixed `integrations.`, and each command calls the same handler as its button. Update the header comment's command list.
- **`app/src/screens/integrations/model.ts`**
  - **keep:** `export const INTEGRATIONS_TEST_IDS = {` is the only source of test ids. The e2e copies ids and checks them against it ("the test ids this spec targets are the ones INTEGRATIONS_TEST_IDS in model.ts defines"), and the new spec does the same.
- **`app/e2e/fixtures/integrations.ts`**
  - **keep:** fixture data only ("Every value here is fixture data: no real account, repo or token."). Every `change` appends one event (`if (next !== "none") kernel?.appendEvent(event("connector_status", { connector_id: 1, kind: "github", status: statusOf(next) }));`).
  - **mirror:** `appStored()` must match the fixed kernel's `storeApp` exactly: the token row keeps `method` (absent or `token`), `status`, account and repos, gains `app_slug`, and gets one event with no `refused`.
- **`app/e2e/integrations.spec.ts`**
  - **keep:** the app is launched only through `import { launchApp } from "./electron-harness";`, and the phase 6 evidence dir is unchanged (`const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-6-polish/integrations/", import.meta.url));`). Phase 6 screenshots are never regenerated by this item.
- **`app/src/screens/integrations/integrations.test.tsx`**
  - **keep:** the refetch pin ("refetches GET /connectors on a connector_status event, and on no other") and every existing case. Change an expectation only where the new button or command changes it, and say why in the commit.

## Closed enumerations touched

> Sibling grep at base `fcaa34473546a8bc8e8f1a0146ed49921796f334`: `grep -rnF 'integrations.disconnect-github' --exclude=CHANGELOG.md --exclude-dir=node_modules --exclude-dir=.supervisor .` → 8 hits in 3 files.

- **`integrations.switch-to-app`** (sibling: `integrations.disconnect-github`). These hits must name it, or need no change:
  - `app/src/screens/integrations/commands.ts` — the `integrationsCommands` array (`id: "integrations.disconnect-github",`) — extend: add the new command. Update the header comment's command list too.
  - `app/src/screens/integrations/integrations.test.tsx` — the owned-commands list (`expect(owned(kernel)).toEqual(["integrations.connect-github", "integrations.disconnect-github", "integrations.refresh-repos"]);`) — extend, in the order the array registers them.
  - `app/src/screens/integrations/integrations.test.tsx` — the command-title list (`expect(kernel.registry.list().map((c) => c.title)).toEqual(["Connect GitHub", "Disconnect GitHub", "Refresh reachable repos"]);`) and the test name above it, which names the three commands — extend with "Switch GitHub to the GitHub App" in registration order. Found by a second sibling grep, `grep -rnF '"Refresh reachable repos"' app/src` (hits: `commands.ts`, `integrations.test.tsx`).
  - `app/src/screens/integrations/commands.ts` — the `IntegrationsCommandHandlers` interface (`readonly refreshRepos: () => void | Promise<void>;`) and the header comment's command list ("the three commands are registered once") — extend: add a `switchToApp` handler and make the comment count four. Its one call site, `app/src/screens/integrations/IntegrationsView.tsx` (`{ connect: connectHandler, disconnect: requestDisconnect, refreshRepos },`), passes the same handler the Switch button calls. The `IntegrationsCommandFlags` interface needs no new field, because `offline`, `hasToken` and `appConnected` already decide `enabled`.
  - `app/src/screens/integrations/integrations.test.tsx` — `command(kernel, "integrations.disconnect-github")` lookups (5 hits) — no change: each looks up one command by id and is not a list of every id. The new command's enabled cases go in `switch.test.tsx`.
  - `app/src/screens/integrations/connect-sheet.test.tsx` — `kernel.registry.get("integrations.disconnect-github")?.run()` — no change: a single lookup, not a list.
  - The palette group name stays `Integrations` (`INTEGRATIONS_GROUP`). No other surface lists every command id. `docs/DESIGN.md` names only one older command, in a phase 6 note, and is not a list.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/integrations-github-app-port.test.ts` — "with a token connected, records the slug…" now expects one event | delete `statusEvent(store, updated, at)` in `kernel/src/integrations/github/app-port.ts` |
| `kernel/test/integrations-github-app-port.test.ts` — new "over an existing row (disconnected), one connector_status event" | delete `statusEvent(store, updated, at)` in `kernel/src/integrations/github/app-port.ts` |
| `switch.test.tsx` — the token detail shows the Switch button, and pressing it makes one setup call and no disconnect call | delete `data-testid={IDS.switchToApp}` in `app/src/screens/integrations/IntegrationsView.tsx` |
| `switch.test.tsx` — the palette lists `integrations.switch-to-app`, enabled only with a token in use, the kernel reachable and no App | delete `integrations.switch-to-app` in `app/src/screens/integrations/commands.ts` |
| `integrations.test.tsx` — the extended `owned(kernel)` list | delete `integrations.switch-to-app` in `app/src/screens/integrations/commands.ts` |
| `switch.test.tsx` — over a token, the list row reads `connected · <account> · token · setting up the App` while the dialog runs, and keeps the token's words after a cancel or failure | flip `token · setting up the App` → `setting up the GitHub App · waiting for you on GitHub` in `app/src/screens/integrations/app-setup.ts` |
| `switch.test.tsx` — AC4: the Switch button is disabled with `title="Needs the kernel"` when the kernel is unreachable | remove `{...dis}` from the Switch button's line in `IntegrationsView.tsx` (applied by the reviewer: `{...dis}` is on more than one line) |
| `switch.test.tsx` — AC2: the cancelled view over a token says the token is still connected and never "Nothing was connected" | in `AppSetupSheet.tsx`, make the cancelled view ignore the switch prop, so it renders the no-token copy (applied by the reviewer) |
| `switch.test.tsx` — AC2: the failed view over a token has no "Paste a token instead" | in `AppSetupSheet.tsx`, render `again` in place of the switch's actions on the failed view (applied by the reviewer) |
| `switch.test.tsx` and `integrations-switch.spec.ts` — AC2: after a cancel or a failure no `POST /connectors/github/disconnect` was sent and the row is still `method: token` | make the Switch handler call `requestDisconnect()` before `startApp()` (applied by the reviewer) |
| `integrations-switch.spec.ts` — AC6: `appStored()` moves the switch dialog to step 2 with no reload | delete the `appendEvent` line inside `appStored` in `app/e2e/fixtures/integrations.ts` (the fixture mirrors the kernel signal, so the e2e must stay on step 1 without it) |
| `integrations.test.tsx` — the extended command-title list | delete `Switch GitHub to the GitHub App` in `app/src/screens/integrations/commands.ts` |
| `switch.test.tsx` — over a token, a non-refusal `connector_status` after the setup call moves the dialog to step 2 (`data-phase="install"`) | in `app/src/screens/integrations/AppSetupSheet.tsx`, make the event handler skip `move({ kind: "install" })` when the switch prop is set (applied by the reviewer: `move({ kind: "install" })` is on more than one line) |
| `integrations.spec.ts` — AC11 keyboard walk, Tab order Replace → Switch → Disconnect | move the Switch button after Disconnect in `TokenDetail` (applied by the reviewer) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: `storeApp` over an existing row appends one `connector_status` event (the step-2 signal), plus test and port doc | AC9, AC10 (integrations.md half) | 3 modify (+2 conditional), 0 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | App: "Switch to GitHub App" on the token detail, switch copy in the setup dialog, token-aware row words, palette command, fixture `appStored()`, switch unit tests and e2e, polish-gate screenshots and evidence README, app.md | AC1–AC8, AC10 (app.md half) | 9 modify (+1 conditional), 3 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/integrations/github/app-port.ts"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-port.ts", name: "storeApp"}
  - {kind: "file", path: "kernel/test/integrations-github-app-port.test.ts"}
  - {kind: "symbol", path: "kernel/test/integrations-github-app-port.test.ts", name: "over an existing row (disconnected), one connector_status event"}
  - {kind: "symbol", path: "docs/architecture/integrations.md", name: "### The port"}
requires: []
lanes:
  - "kernel/src/integrations/github/app-port.ts"
  - "kernel/test/integrations-github-app-port.test.ts"
  - "kernel/test/integrations-github-app-setup.test.ts"
  - "kernel/test/phase-6-exit.test.ts"
  - "docs/architecture/integrations.md"
external_requires: []
```

```yaml
# Subtask 2
provides:
  - {kind: "file", path: "app/src/screens/integrations/switch.test.tsx"}
  - {kind: "symbol", path: "app/src/screens/integrations/commands.ts", name: "integrations.switch-to-app"}
  - {kind: "symbol", path: "app/src/screens/integrations/IntegrationsView.tsx", name: "IDS.switchToApp"}
  - {kind: "symbol", path: "app/src/screens/integrations/model.ts", name: "switchToApp"}
  - {kind: "file", path: "app/e2e/integrations-switch.spec.ts"}
  - {kind: "symbol", path: "app/e2e/fixtures/integrations.ts", name: "appStored"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/integrations/README.md"}
requires: []
lanes:
  - "app/src/screens/integrations/IntegrationsView.tsx"
  - "app/src/screens/integrations/AppSetupSheet.tsx"
  - "app/src/screens/integrations/app-setup.ts"
  - "app/src/screens/integrations/commands.ts"
  - "app/src/screens/integrations/model.ts"
  - "app/src/screens/integrations/integrations.css"
  - "app/src/screens/integrations/integrations.test.tsx"
  - "app/src/screens/integrations/switch.test.tsx"
  - "app/e2e/fixtures/integrations.ts"
  - "app/e2e/integrations.spec.ts"
  - "app/e2e/integrations-switch.spec.ts"
  - "docs/architecture/app.md"
  - "docs/evidence/phase-7-polish/integrations/**"
external_requires:
  - "Playwright + the built Electron app (`npm run build`) on macOS for the light/dark screenshots"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
Subtask 2 (independent)
```
Subtask 2 drives the switch against the fixture kernel, whose `appStored()` mirrors the fixed kernel. It needs no output of Subtask 1 at build or test time. Subtask 2's `app.md` text states the kernel's new event as the AC9 contract, and Subtask 1 makes it true. Phase 4.5 reviews the two together.

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel)
- **Recommended workers:** 2
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/store/migrations/001_initial.ts:9` | yes | HOLDS | ` * hooks_installed and connectors arrive with their phases, so columns that will` | tip 52 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): the requirement's "kernel needs no change" is contradicted. Without an event, the switch dialog never reaches step 2 against the real kernel, and the e2e fixture's `app-created` (an App row plus an event) hid it. | HIGH | Owner chose the kernel fix (AC9). Subtask 2's fixture `appStored()` mirrors the fixed port (token row kept, slug added, one event), never the old `app-created` shape, so the e2e no longer hides the gap. Do not fake the switch's step 2 with `app-created`. |
| Feasibility (Phase 2.5): about 15 files, over the 12-file single-worker bound. | MEDIUM | Split into kernel and app (zero overlap). Each worker stays in its lanes. |
| The new `storeApp` event changes event counts other kernel tests assert (`["disconnected", "connected", "disconnected"]`, the setup route's per-refusal counts). | MEDIUM | Subtask 1 runs the full kernel suite and updates only counts that include a successful `storeApp`, each with a one-line reason. Refusal paths append no extra event, because `storeApp` is not reached or fails before the transaction. |
| A token-path `connector_status` event that is unrelated to the setup (for example the expiry due work changing `connected` → `expiring`) arriving while the switch dialog is on step 1 would read as the step-2 signal. | LOW | Accepted: this is today's documented signal (`docs/architecture/app.md`, the event bullet), and the window is minutes long. Note it in app.md's switch paragraph. Do not add a new signal shape. |
| The console thread shows a "Connector github: connected" line for the `storeApp` event over a token. | LOW | Accepted as a status line (the status is true). The payload carries no secret (the AC9 test asserts `expectNoSecret`). |
| The cancelled and failed views and the list row say "Nothing was connected" / "not connected" over a token, contradicting AC2. | MEDIUM | `appRowMeta` gets a token-aware sibling, and `AppSetupSheet` gets the switch copy from `switchDialog()` (no "Paste a token instead" when a token is in use). Pinned in `switch.test.tsx`. |
| The new header button shifts the existing keyboard walk (AC11 in `integrations.spec.ts`) and any header-button jsdom expectation. | MEDIUM | Update those expectations in place (Tab order Replace → Switch → Disconnect, as the mockup has it). Never delete an assertion to make it pass. |
| The requirement's Risk: the kernel refuses a setup while a token is connected. | MEDIUM | None is expected (the port's table says a token stays in use). If an e2e or kernel test shows a refusal, stop, record it in the evidence README and the PR, and do not work around it (owner rule). |
| Sibling phase 7 lanes merging first could conflict with the shared shell or palette. | LOW | Lanes here touch only the integrations screen and kernel files named above. Rebase on `origin/main` before FINALIZE. |
| Screenshot pixels differ between machines. | LOW | Assert behaviour, never pixels (the existing spec's rule). Regenerate the PNGs with `INTEGRATIONS_EVIDENCE=1` only from the new spec. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 1
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-31-integrations-token-to-app-switch.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-31T05:58:16Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/188
- **Branch:** feature/integrations-token-to-app-switch
- **Files changed:** 28
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unknown (no_driver_handover)
- **Summary:** Resumed (--continue) after both workers had finished in session f8c7584a. Committed subtask 2's work, merged the kernel storeApp step-2 event (AC9) and the app "Switch to GitHub App" flow, evidence and docs (AC1–AC8, AC10). Validation green: kernel 3246, app 2401 unit + 29 e2e, build, check-docs. Phase 4.5 code-reviewer PASSed on the first review, with 2 LOW nits dismissed and 12 of 14 pin mutations held (2 Playwright-only rows unverified). Rules: none. CI: green.
