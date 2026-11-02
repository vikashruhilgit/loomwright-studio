# Supervisor Job: Shell: Kernel log in the band (phase 7, item 20)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-01-171537/L1
- **CLAUDE.md:** ✓ Found (fresh: every path in its "Where things are" table exists; `bash scripts/check-docs.sh` enforces it)
- **Git:** clean (0 files), branch: main, at origin/main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (paths outside the requirement's `## Touches`, each allowed by the owner at Launch Pad (`LP-CLARIFY`, 2026-11-01, two rounds; listed under "Owner decisions (Launch Pad)" below): three one-line band-text pins, the shell evidence folder, the preload test's key list, and one row in `docs/architecture/app.md`.)
- **Source requirement:** .supervisor/requirements/phase-7/2026-11-01-090020-shell-kernel-log-in-the-band.md
- **Base commit:** 59275c832a77f65975ebdf020e34a3dcc552519a
- **Depends on:** none. The shared band (`KernelBand`, item 11, PR #192) and every screen's adoption of it are on main.

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React + Electron (main/preload/renderer), vitest/jsdom, Playwright e2e through `app/e2e/electron-harness.ts`. Nothing new. |
| 2 | Dependency Availability | GO | No new dependency. `shell.showItemInFolder` is Electron's own. The mockup's band is `BAND` in `docs/design/mockups/gui-v2.html:913` (`<button class="a" data-act="other" data-what="The kernel log">Kernel log</button>`, styled by `.band .a` at :291: `margin-left:auto`, strong weight, underline, `white-space:nowrap`). |
| 3 | Architecture Fit | CAUTION | The pattern is `studio:reveal-data-dir` (argument-free channel, owner-only handler, the main process resolves the path). Pins outside Touches go red: the band text pins `app/src/store/connection.test.tsx:144`, `app/e2e/store.spec.ts:219`, `app/e2e/playbooks.spec.ts:419`; the preload key list `app/electron/preload.test.ts:51`. All four are allowed by the owner (`LP-CLARIFY`). The requirement's assumption "stdout is not kept" is wrong: `kernel/src/service/launchd.ts:82` `STDOUT_LOG_FILENAME = "kernel.out.log"` is also written (plist :193-194). The owner's decision (reveal `kernel.err.log`) still holds; Finder opens the `logs` folder with the err log selected, so the out log is visible beside it. |
| 4 | Scope vs Supervisor Capability | GO | About 14 files modified, 0 source files created, plus regenerated PNGs. One worker. |
| 5 | Hard Blockers | GO | No migration, no credentials, no kernel change. Fixture kernel only. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Give the shared red "Couldn't reach the kernel" band the mockup's "Kernel log" action at its right, on every screen. Pressing it asks Finder, through a new argument-free main-process channel, to reveal `<dataDir>/logs/kernel.err.log`. When the file does not exist, the band says so in words and reveals nothing.

**Problem Statement:**
The 2026-11-01 live re-run (packaged app at `59275c8`, kernel booted out) showed every screen's band ending at its sentence. The mockup's `BAND` carries a "Kernel log" button. `KernelBand` (`app/src/shell/KernelStates.tsx:27-34`) renders only the glyph and `KERNEL_BAND_COPY`. The shell (`app/src/App.tsx:90`, `<KernelBand />`) and six screens (Tasks `TasksScreen.tsx:292`, Memory `MemoryViews.tsx:68`, Playbooks `PlaybooksScreen.tsx:484`, Schedules `SchedulesScreen.tsx:534`, Integrations `IntegrationsView.tsx:638`, Budget `BudgetScreen.tsx:350`) all render that one component, passing only `testId`. So putting the action inside `KernelBand` puts it on every screen with no screen file edited.
Success: with the kernel down, every screen's band reads the sentence, then a "Kernel log" action at its right, in light and dark, matching `<screen>-unreachable`. Pressing it reveals the service's err log in Finder, or says there is no log yet.

**Mockup (owner-approved):** `docs/design/mockups/gui-v2.html`, `BAND` (:913) used by every `<screen>-unreachable` view (:829-877). The mockup has no view for the "no log yet" note; its wording and place are a Launch Pad default (below).

**Owner decisions carried from the requirement (binding):** Kernel log reveals the kernel service's log file (`<dataDir>/logs/kernel.err.log`) in Finder, through a main-process channel that takes no path from the renderer, as Reveal data dir does. It works with the kernel down. No log viewer inside the app (non-goal). The screenshots from the owner's real store stay outside the repo; the committed ones are fixture screenshots. Nothing is patched outside the item's Touches, extended below; a worker that needs another file stops and says so. Invariants 1–9 are unchanged.

**Owner decisions (Launch Pad `LP-CLARIFY`, 2026-11-01, binding; they extend Touches):**
1. **The three band-text pins: allowed.** In each file change only the one assertion: `app/src/store/connection.test.tsx:144` (`expect(band.textContent).toBe(KERNEL_BAND_COPY);`), `app/e2e/store.spec.ts:219` and `app/e2e/playbooks.spec.ts:419` (`toHaveText("Couldn't reach the kernel. …")`). Each now expects the sentence followed by the action's label (for example `` `${KERNEL_BAND_COPY}${KERNEL_LOG_LABEL}` `` in the unit test, and the full sentence + "Kernel log" in the two specs, which cannot import a `.tsx`). No other line of these files changes.
2. **The shell evidence folder: allowed.** `docs/evidence/phase-7-polish/shell/README.md` and its PNGs are updated (the same convention sibling items use for their evidence folders).
3. **Screenshot scope:** regenerate `integrations-unreachable` (light and dark) with the action, and add one shot of the "no log yet" note, named against `integrations-unreachable` with a suffix (`integrations-unreachable-kernel-log-missing-{light,dark}.png`; the mockup has no view for it, and the README says so). `app/e2e/shell.spec.ts` asserts the action on all seven screens' bands, without screenshots. The README records that the other screens' committed `*-unreachable` PNGs (in their own evidence folders) predate the button.
4. **The preload test and the bridge doc: allowed, as a top-level member.** The new member is top-level `revealKernelLog()` (like `homeDir`; it is not a preference). `app/electron/preload.test.ts` changes only the key list at :51 (add `"revealKernelLog"`, kept sorted) and adds one entry to the forwarded-call test (:60-92) that calls it with an argument and expects `{ channel: "studio:reveal-kernel-log", args: [] }`. `docs/architecture/app.md` gains one row in the table at :147-152 and adds `revealKernelLog` to the key-list sentence at :154. The PR body names every extension (1–4).

**Design choices made here (Launch Pad defaults; the owner may change them on the PR):**
- **The answer:** `revealKernelLog(): Promise<KernelLogReveal>`, with `type KernelLogReveal = "revealed" | "missing" | "failed"`. `"missing"`: the file does not exist (or is not a regular file). `"failed"`: any other error. The renderer treats a missing member or a rejected call as `"failed"`.
- **The note:** after a press answering `"missing"`, the band shows a note after the action, `role="status"`, `data-testid="kernel-log-note"`, reading "There is no kernel log yet." After `"failed"`: "Couldn't open the kernel log." After `"revealed"`: no note (the previous note clears). The note lives in `KernelBand`'s own state and goes when the band unmounts. `KERNEL_BAND_COPY` itself never changes, and no kernel string is rendered.
- **The action's look:** a `<button type="button">` with class `toast-band-action` from `app/src/components/Toast/Toast.css:147` (`margin: 0 0 0 auto`, weight 600, underline, `color: inherit`, the focus ring at :104-108), which is the shared Band's action style and matches the mockup's `.band .a`. `KernelStates.tsx` imports `../components/Toast/Toast.css` explicitly so it does not rely on another screen's import. No CSS file is edited. Label: "Kernel log" (`export const KERNEL_LOG_LABEL`).

## Acceptance Criteria

Carried from the requirement (AC1–AC4), made concrete. AC4 is rewritten to the evidence-file form.

- [ ] **AC1** Given any screen with the kernel unreachable, then the band (`kernel-unreachable-band`, or the screen's own `testId` band) shows a "Kernel log" button after the sentence, at its right: the button's right edge is within the band's padding of the band's right edge, and its left edge is right of the sentence's right edge. This matches `<screen>-unreachable`, light and dark. Pinned in `app/e2e/shell.spec.ts`: with the fixture's listener stopped (`kernel.stop()`), visit `#/tasks`, `#/playbooks`, `#/schedules`, `#/memory`, `#/budget`, `#/settings` and `#/integrations`. On each, exactly one `.band-danger`, whose `getByRole("button", { name: "Kernel log" })` is visible, with the geometry above. `expectOneSharedBand` (:77-86) now expects `BAND_COPY + "Kernel log"`. Unit-pinned in `app/src/shell/KernelBand.test.tsx`: the band holds exactly one button named "Kernel log", the text is `COPY + "Kernel log"`, and `expectNoRequestText` still passes on it.
- [ ] **AC2** Given the band's Kernel log action, when it is pressed, then the main process calls `shell.showItemInFolder(join(<its resolved dataDir>, "logs", "kernel.err.log"))` exactly once. The renderer sends no path: the preload drops any argument, and the main handler ignores one. `app/electron/main.test.ts` pins this like `studio:reveal-data-dir` (:331-335): calling with no argument and with `"/Users/<name>/.ssh"` both reveal only the main process's own log path. A caller that is not the window is refused (`rejects.toThrow("refused")`) and nothing is revealed. The handler list at :180-190 includes `"studio:reveal-kernel-log"`. `app/electron/preload.test.ts` pins `args: []` (owner decision 4). In `KernelBand.test.tsx`, with a fake bridge on `window.api`, pressing the action calls `revealKernelLog` once with no argument.
- [ ] **AC3** Given no log file on disk, when Kernel log is pressed, then the main process answers `"missing"` without calling `shell.showItemInFolder` (pinned in `main.test.ts`), and the band shows `kernel-log-note` reading "There is no kernel log yet." (pinned in `KernelBand.test.tsx` through `fakeBridge`'s `kernelLogAnswer = "missing"`, and in `shell.spec.ts`: the fixture's data dir has no `logs/kernel.err.log` (assert `existsSync` is false first), press, and the note shows). Given `"failed"`, a rejected call, or a bridge without the member, the note reads "Couldn't open the kernel log." (unit). Given `"revealed"`, no note (unit).
- [ ] **AC4** Given the polish gate, then the committed evidence file `docs/evidence/phase-7-polish/shell/README.md` names each regenerated screenshot against its `gui-v2.html` view (`integrations-unreachable` light and dark with the action; `integrations-unreachable-kernel-log-missing` light and dark, recorded as having no mockup view), written by `app/e2e/shell.spec.ts` with `SHELL_EVIDENCE=1` through `app/e2e/electron-harness.ts` (the same run also recaptures `integrations-token` light and dark). The README's intro and counts are updated: "in the two views … (4 files)" (:3) and "All 4 files were captured" (:11) become three shot names / 6 files, one of them with no mockup counterpart. The "Known remaining differences" bullet "**"Kernel log" button.** … the band carries the copy only." is replaced by what the button does, the stdout note (Feasibility 3), and the note that other screens' committed `*-unreachable` PNGs predate the button. "What this PR changes" item 1's sentence "The band has no "Kernel log" button." is updated. The README must still contain "Kernel log" (shell.spec.ts:308). The PR body links to the README.

**Evidence rule:** AC4's evidence lives in the committed `docs/evidence/phase-7-polish/shell/README.md` (a File Impact Map modify), never only in the PR body.

**Validation (must pass before merge):** `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`; `bash scripts/check-docs.sh`.

## File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| Main process + bridge (Subtask 1) | `app/electron/channels.ts` (35), `app/electron/main.ts` (187), `app/electron/preload.ts` (48), `app/src/api/contract.ts` (1479; one optional member + one type, beside `homeDir?` at :1434-1439, the single authority for the bridge's shape), `app/src/store/fake-bridge.ts` (142) | — | HIGH |
| Band (Subtask 1) | `app/src/shell/KernelStates.tsx` (57) | — | HIGH |
| Tests (Subtask 1) | `app/electron/main.test.ts` (388), `app/src/shell/KernelBand.test.tsx` (167), `app/e2e/shell.spec.ts` (309) | — | HIGH |
| Owner-allowed extensions | `app/src/store/connection.test.tsx` (217; :144 only), `app/e2e/store.spec.ts` (225; :219 only), `app/e2e/playbooks.spec.ts` (877; :419 only; no new responsibility), `app/electron/preload.test.ts` (104; :51 + one forwarded-call entry), `docs/architecture/app.md` (184; one table row + the key-list sentence), `docs/evidence/phase-7-polish/shell/README.md` (40), `docs/evidence/phase-7-polish/shell/integrations-*-{light,dark}.png` (4 regenerated) | `docs/evidence/phase-7-polish/shell/integrations-unreachable-kernel-log-missing-{light,dark}.png` | HIGH |

**Module layout (one home per new responsibility):**
- **The channel name:** `CHANNELS.revealKernelLog = "studio:reveal-kernel-log"` in `channels.ts`, added to `INVOKE_CHANNELS`, with a doc comment ("Renderer -> main: reveal the kernel service's own log in Finder. Carries no argument.").
- **The log path and the reveal:** in `main.ts`, beside the `revealDataDir` handler (187 lines, under the threshold; it is the one place handlers live). `handleBridge` takes the data dir (`resolveDataDir(process.env)`, already computed in `main()`). A constant `KERNEL_LOG_FILE = join("logs", "kernel.err.log")` carries a comment naming its source (`STDERR_LOG_FILENAME` in `kernel/src/service/launchd.ts:83`, under `<dataDir>/logs/` at :81). The app does not import kernel sources (precedent: `kernel-connection.ts:33` mirrors `DATA_DIR_ENV` the same way). The handler checks `fromOwner`, `stat`s the path (`isFile()`), and answers `"missing"` on `ENOENT`/not-a-file or `"failed"` on any other error. Otherwise it calls `shell.showItemInFolder(path)` and answers `"revealed"`. Logs carry reasons only, never the path (as the other handlers do).
- **The bridge member:** `revealKernelLog?(): Promise<KernelLogReveal>` on `StudioBridge` in `contract.ts`, optional like `homeDir?` (a fake without it compiles; the caller treats it as `"failed"`), with `export type KernelLogReveal`. Preload: `revealKernelLog: () => ipcRenderer.invoke(CHANNELS.revealKernelLog) as Promise<KernelLogReveal>`, with the comment "No argument: the main process reveals its own log, never a path from here."
- **The fake:** `fakeBridge` gains `revealKernelLog` plus `kernelLogReveals: number` (calls) and `kernelLogAnswer: KernelLogReveal` (default `"revealed"`) on `FakeBridge`, mirroring `reveals`/`revealAnswer` (:42-45, :75-84).
- **The action and note:** inside `KernelBand` (`KernelStates.tsx`, 57 lines). It reads the bridge with `getBridge() as StudioBridge | undefined` at press time (the precedent is `app/src/screens/settings/SettingsSubtitle.tsx:23`), because `App.tsx` and the six screens render it without an `api` prop and are outside Touches. `KernelBand`'s props stay `{ testId? }` and still hold no text.
- **Tests:** new unit pins go in `KernelBand.test.tsx` (167). Main-process pins go in `main.test.ts` (388) in a new `describe("the kernel-log channel")` beside `describe("the home-dir channel")`. E2E pins go in `shell.spec.ts` (309).

**Validator-owned surfaces:** `scripts/check-docs.sh` checks every relative link under `docs/` (the README's PNG links must resolve). `app/e2e/shell.spec.ts` AC7 (:295-309) checks the README names every `VIEWS` entry's light and dark PNG, that the PNG count equals `VIEWS.length * THEMES.length`, that it contains `SHELL_EVIDENCE=1`, and that it contains "Kernel log". The new missing-note shot must therefore be added to `VIEWS` (or the count check adjusted to the new set) so that check stays exact. `app/scripts/hidden-windows.test.ts` enforces the e2e launch rule.

**Total estimated files:** 14 modify (+ 4 regenerated PNGs, 2 new PNGs).

### File Overlap Detection

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| Subtask 1 | — | single subtask | NO |

## Touched-file invariants

> Grounded at base `59275c832a77f65975ebdf020e34a3dcc552519a`. The worker re-checks each entry before handing back.

- **`app/src/shell/KernelStates.tsx`**
  - **keep:** "The band's one fixed copy: no request text, no connection state, no port (a kernel string is never rendered here)". `KernelBand` keeps `role="alert"`, `className="band band-danger"`, `data-testid={testId}` with default `"kernel-unreachable-band"`, and `WarnGlyph className="band-glyph"`. Its props stay "no prop that holds text" (only `testId`). `SETUP_STEPS` and `NotInstalledState` are unchanged (Settings reuses `SETUP_STEPS`).
  - **pinned by:** `KernelBand.test.tsx` ("is a red alert…", `expectNoRequestText`), `app/e2e/playbooks.spec.ts:407-409` (`.band-danger` locator), `store.spec.ts:218` (`role` `alert`).
- **`app/electron/main.ts`**
  - **keep:** every handler starts `if (!fromOwner(event)) throw new Error("refused");`. The Reveal rule (main.ts:106-107): `so a path from the renderer is never opened`. The three window security settings in `windowOptions` (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`). "Reasons only: never the address…" for logging.
  - **pinned by:** `main.test.ts` "handles exactly the bridge's channels, and refuses a caller that is not its window" (:180-200) and the reveal-data-dir case (:331-335).
- **`app/electron/preload.ts`**
  - **keep:** `exposes exactly one key, \`api\``; the rule at preload.ts:4-5, `here hands the renderer` no `ipcRenderer`, channel name or Node API. The new method takes no parameter.
  - **pinned by:** `preload.test.ts` :45-58 (keys; no key matches `/token|ipc|require|process/i`, and `revealKernelLog` matches none of them).
- **`app/electron/channels.ts`**
  - **keep:** `renderer never names a channel itself` (channels.ts:1-2). `INVOKE_CHANNELS` lists exactly the handled invoke channels.
- **`app/src/api/contract.ts`**
  - **keep:** optional bridge members are documented with `compiles; a caller treats a missing member as` (contract.ts:1437; the line before it starts "Optional so a bridge without it (a test fake)"). The new member follows that wording.
- **`app/src/shell/KernelBand.test.tsx`**
  - **keep:** `COPY` stays a local literal, never imported from the component (`/** The copy, pinned here on its own (not imported from the component). */` :15). `expectNoRequestText` still runs on every band text it ran on, now including the action's label. The `describe("the screen contract: useKernelReach and withLastKnown"` block is unchanged. Only the exact-text expectations at :77, :84, :94 and :105 change, to `COPY + "Kernel log"`. New cases are added for the action and the note; `window.api` is installed per test and deleted in `afterEach`.
- **`app/src/store/fake-bridge.ts`**
  - **keep:** existing fields and defaults (`reveals: 0`, `revealAnswer: true`) are unchanged.
- **`app/e2e/shell.spec.ts`**
  - **keep:** Electron is launched only through `launchApp` from `./electron-harness` (`.agent/rules/testing.json`). PNGs are written only under `SHELL_EVIDENCE=1`. AC7's "nothing under the tracked evidence dir changed during the run" holds. The spec never presses Kernel log while a log file exists (it would open the real Finder): it presses only with the fixture data dir lacking `logs/kernel.err.log`.
- **`app/electron/main.test.ts`**
  - **keep:** the existing reveal-data-dir expectation is unchanged in substance (it still opens only the main process's own resolved data dir). If the mocked `resolveDataDir` (:47, `() => "/the/data"`) must answer a real temp dir so the "exists" case can create `logs/kernel.err.log`, :334's expected path follows that same dir. The electron mock's `shell` (:133-141) gains `showItemInFolder`, recording into `electron.os`.
- **Owner-allowed extension files** (`connection.test.tsx`, `store.spec.ts`, `playbooks.spec.ts`, `preload.test.ts`, `docs/architecture/app.md`)
  - **keep:** only the lines named in owner decisions 1 and 4 change.

## Closed enumerations touched

> Grep at base: `grep -rn "studio:home-dir\|reveal-data-dir"` (excluding node_modules) → `app/electron/channels.ts:15,17`, `app/electron/main.test.ts:184,189,307,332,333,340`, `app/electron/preload.ts:38`, `app/electron/preload.test.ts:86,90`, `docs/architecture/app.md:151,152`, `docs/evidence/phase-7-polish/shell/README.md:29`. Band text: `grep -rn "KERNEL_BAND_COPY\|reconnects on its own" app/src app/e2e` → exact-match pins `connection.test.tsx:144`, `store.spec.ts:219`, `playbooks.spec.ts:419`, `shell.spec.ts:38/83`, `KernelBand.test.tsx:16/77/84/94/105`. Every other hit is `toContain`/`toContainText` and is unaffected.

- **`INVOKE_CHANNELS`** (`channels.ts:25-35`): add `CHANNELS.revealKernelLog`.
- **Handled channel list** (`main.test.ts:180-190`, sorted): add `"studio:reveal-kernel-log"`, last in sorted order (`…"studio:request", "studio:reveal-data-dir", "studio:reveal-kernel-log"`).
- **Preload top-level keys** (`preload.test.ts:51`): add `"revealKernelLog"`, sorted (after `"request"`).
- **Preload forwarded calls** (`preload.test.ts:79-91`): add the argument-dropped entry.
- **Bridge doc table and key list** (`docs/architecture/app.md:147-154`).
- **Exact band-text pins** (`connection.test.tsx:144`, `store.spec.ts:219`, `playbooks.spec.ts:419`, `shell.spec.ts:83` via `expectOneSharedBand`, `KernelBand.test.tsx:77/84/94/105`): each expects sentence + "Kernel log".
- **Shell evidence `VIEWS`** (`shell.spec.ts:30`): add the missing-note shot so the README/PNG count check (:306) stays exact.
- **No change** (sibling-grep hits that are not closed lists): `main.test.ts:307` (refusal loop over prefs channels; the new channel gets its own refusal case in the new describe), `main.test.ts:332-333` and `:340` (per-channel cases), `docs/evidence/phase-7-polish/shell/README.md:29` (homeDir history line).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `KernelBand.test.tsx`: the band holds one "Kernel log" button | delete the `<button …>{KERNEL_LOG_LABEL}</button>` line in `KernelBand` |
| `KernelBand.test.tsx`: a press calls `revealKernelLog` once with no argument | in the click handler, skip the call (`return;` first) (applied by the reviewer) |
| `KernelBand.test.tsx`: `"missing"` shows "There is no kernel log yet." | map `"missing"` to `null` in the note helper (applied by the reviewer) |
| `KernelBand.test.tsx`: `"failed"` / no member shows "Couldn't open the kernel log." | treat a missing member as `"revealed"` (applied by the reviewer) |
| `KernelBand.test.tsx`: `"revealed"` shows no note | map `"revealed"` to the missing text |
| `main.test.ts`: reveals `<dataDir>/logs/kernel.err.log`, ignoring a renderer argument | in the handler, reveal `typeof arg === "string" ? arg : path` (applied by the reviewer) |
| `main.test.ts`: a non-window caller is refused and nothing revealed | delete the `fromOwner` line in the new handler |
| `main.test.ts`: no file → `"missing"`, no `showItemInFolder` | drop the `stat` check (always reveal) (applied by the reviewer) |
| `main.test.ts`: handled channels include `studio:reveal-kernel-log` | delete the new `ipcMain.handle(CHANNELS.revealKernelLog, …)` registration |
| `preload.test.ts`: forwards with `args: []` | pass the argument through in preload (`(...a) => ipcRenderer.invoke(CHANNELS.revealKernelLog, ...a)`) (applied by the reviewer) |
| `preload.test.ts:51`: `revealKernelLog` is a key | delete the `revealKernelLog` line in preload |
| `shell.spec.ts`: each of the seven screens' bands has the action at its right | delete the `toast-band-action` class from the button (it then sits beside the sentence, not at the right) (applied by the reviewer) |
| `shell.spec.ts`: no log → the note shows | answer `"revealed"` for a missing file in `main.ts` (applied by the reviewer) |
| `connection.test.tsx:144` / `store.spec.ts:219` / `playbooks.spec.ts:419` | delete the button line in `KernelBand` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel log in the band: the channel, main handler, preload and contract member, fake, the band's action and note, unit/main/e2e pins, the owner-allowed pin lines, the doc row, regenerated shell evidence | AC1–AC4 | 14 modify, 0 source create (+4 regenerated, 2 new PNGs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "app/electron/channels.ts", name: "CHANNELS.revealKernelLog"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "KernelLogReveal"}
  - {kind: "symbol", path: "app/src/shell/KernelStates.tsx", name: "KERNEL_LOG_LABEL"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/shell/README.md"}
requires: []
lanes:
  - "app/electron/channels.ts"
  - "app/electron/main.ts"
  - "app/electron/main.test.ts"
  - "app/electron/preload.ts"
  - "app/electron/preload.test.ts"
  - "app/src/api/contract.ts"
  - "app/src/store/fake-bridge.ts"
  - "app/src/shell/KernelStates.tsx"
  - "app/src/shell/KernelBand.test.tsx"
  - "app/src/store/connection.test.tsx"
  - "app/e2e/shell.spec.ts"
  - "app/e2e/store.spec.ts"
  - "app/e2e/playbooks.spec.ts"
  - "docs/architecture/app.md"
  - "docs/evidence/phase-7-polish/shell/**"
external_requires:
  - "Playwright + the built Electron app (`npm run build`) on macOS for the e2e and the light/dark screenshots"
```

## Parallelism Analysis

single-agent (no fan-out)

### Dependency Graph
```
Subtask 1 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | — | — | NO |

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `app/src/shell/KernelStates.tsx:27` | yes | HOLDS | `export function KernelBand({ testId = "kernel-unreachable-band" }: { readonly testId?: string }) {` | base 59275c8 |
| `app/src/store/connection.test.tsx:144` | yes | HOLDS | `expect(band.textContent).toBe(KERNEL_BAND_COPY);` | base 59275c8 |
| `app/e2e/store.spec.ts:219` | yes | HOLDS | `await expect(band).toHaveText("Couldn't reach the kernel. It may be restarting; this window reconnects on its own.");` | base 59275c8 |
| `app/e2e/playbooks.spec.ts:419` | yes | HOLDS | `await expect(bands(page)).toHaveText("Couldn't reach the kernel. …");` | base 59275c8 |
| `app/electron/preload.test.ts:51` | yes | HOLDS | `expect(Object.keys(api).sort()).toEqual(["connection", "feed", "homeDir", "onNavigate", "openExternal", "prefs", "request"]);` | base 59275c8 |
| `app/electron/main.test.ts:331` | yes | HOLDS | `it("reveals the main process's own data dir and ignores any argument the renderer sends", …` | base 59275c8 |
| `kernel/src/service/launchd.ts:83` | yes | HOLDS | `export const STDERR_LOG_FILENAME = "kernel.err.log";` (and :82 `STDOUT_LOG_FILENAME = "kernel.out.log"`, contradicting the requirement's stdout assumption) | base 59275c8 |
| `app/src/components/Toast/Toast.css:147` | yes | HOLDS | `.toast-band-action {` (`margin: 0 0 0 auto;` …) | base 59275c8 |
| `docs/design/mockups/gui-v2.html:913` | yes | HOLDS | `const BAND=… <button class="a" data-act="other" data-what="The kernel log">Kernel log</button></div>`;` | base 59275c8 |
| `app/e2e/shell.spec.ts:308` | yes | HOLDS | `for (const departure of ["Kernel log", "Schedules & triggers"]) expect(readme, …).toContain(departure);` | base 59275c8 |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): pins and files outside Touches (`connection.test.tsx:144`, `store.spec.ts:219`, `playbooks.spec.ts:419`, `preload.test.ts:51` + one entry, `docs/architecture/app.md`, the shell evidence folder). | MEDIUM | Owner allowed each (`LP-CLARIFY`, 2026-11-01, decisions 1–4). Any other file: stop and say so (owner rule). |
| Feasibility (Phase 2.5): the requirement's assumption "stdout is not kept" is false (`launchd.ts:82`, plist :193-194 write `kernel.out.log`). | LOW | The owner's decision (reveal `kernel.err.log`) stands. `showItemInFolder` opens `logs/` with the err log selected, so the out log is beside it. Record it in the README and the PR body. Do not reveal the out log too. |
| A new IPC channel widens the preload bridge (requirement risk). | MEDIUM | The preload passes no argument, the main handler ignores any, and the path is resolved from the main process's own data dir. Pinned in `preload.test.ts` and `main.test.ts` (AC2). |
| An e2e press with a real log present would open the real Finder. | MEDIUM | `shell.spec.ts` asserts the fixture data dir lacks `logs/kernel.err.log` before pressing, and presses only then. The "exists" path is pinned only in `main.test.ts` (mocked `shell`). |
| `KernelBand` reads `getBridge()` at press time; unit tests that render screens without `window.api` see the action but get "Couldn't open the kernel log." if pressed. | LOW | No out-of-scope test presses it. `KernelBand.test.tsx` installs a fake on `window.api` and removes it in `afterEach` (precedent `TasksScreen.test.tsx:132-133`). |
| The other screens' committed `*-unreachable` PNGs (their own evidence folders) show no button after this lands. | LOW | Owner decision 3: recorded in the shell README's known differences. Not regenerated here. |
| Screenshot pixels differ between machines. | LOW | Assert behaviour and geometry, never pixels. PNGs only under `SHELL_EVIDENCE=1`. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-01-shell-kernel-log-in-the-band.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-02T01:52:00Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/206
- **Branch:** feature/shell-kernel-log-in-the-band
- **Files changed:** 22
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unknown (no_driver_handover)
- **Summary:** Kernel log action in the shared kernel band (34b383f) plus the owner-approved smoke.spec.ts:63 key-pin fix (0d4da23) after the --continue resume; Phase 4.5 reviewer PASS on the first pass, 1 LOW dismissed (stale schedules evidence note, outside Touches).

## Not verified
- **Finder reveal of an existing kernel.err.log** — main.test.ts mock only (subtask 1)
