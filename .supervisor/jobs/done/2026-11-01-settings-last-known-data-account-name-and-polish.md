# Supervisor Job: Settings: last-known data when the kernel is unreachable, ~ paths, the account name and polish (phase 7, item 18)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-01-042119/L8
- **CLAUDE.md:** ✓ Found (fresh: every path in its "Where things are" table exists; `bash scripts/check-docs.sh` enforces it)
- **Git:** clean (0 files), branch: main, at origin/main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 2 (three paths outside the requirement's `## Touches`: the polish-gate evidence folder `docs/evidence/phase-7-polish/settings/` (the spec's own output folder, the same convention items 11, 12, 14 and 15 use), and two one-line pins the owner allowed at Launch Pad (below). Sibling lanes 12 and 15 also edit `app/src/shell/frame.test.tsx:94`; see Risk Assessment.)
- **Source requirement:** .supervisor/requirements/phase-7/2026-11-01-090018-settings-last-known-data-account-name-and-polish.md
- **Base commit:** daed1eab9fafe3f5429ca2d3f6efd13609bc7ada
- **Depends on:** item 11 (shell contract), merged as PR #192 (`a5307b9`). `KernelBand`, `useKernelReach`/`withLastKnown`/`LAST_KNOWN` (`app/src/shell/last-known.ts`), `ScreenDefinition.Subtitle`, `formatHomePath` (`app/src/shell/home-path.ts`) and `useHomeDir` (`app/src/shell/useHomeDir.ts`) are all on main.

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React + Electron, vitest/jsdom, Playwright e2e through `app/e2e/electron-harness.ts`. Nothing new. |
| 2 | Dependency Availability | GO | No new dependency. The shell contract from item 11 is merged. The mockup `docs/design/mockups/gui-v2.html` holds `settingsScreen` (line 1243) and `SET` (line 786: `account:'personal subscription'`, `dir:'~/.loomwright-studio'`, `lw:'~/.claude/plugins/cache/…'`). |
| 3 | Architecture Fit | CAUTION | Two pins outside Touches go red when "last known" moves to the title bar: `app/src/shell/frame.test.tsx:94` ("no screen declares one yet", `toEqual([])`) and `app/e2e/phase-7-exit.spec.ts:821` (`SETTINGS.lastKnown` `toHaveCount(2)`). The owner allowed both one-line changes in `LP-CLARIFY` (2026-11-01). The account fix needs no kernel change: the kernel's providers answer `account` as the provider id when no label is recorded (`kernel/src/auth/subscription-token.ts:75`, `return (store && readProviderMetadata(store, id)?.account) \|\| id;`), and no kernel code records a label (`recordTokenCreated` has no caller in `kernel/src`), so the screen detects that fallback. |
| 4 | Scope vs Supervisor Capability | GO | About 12 modify, 3 create (+ regenerated PNGs), nearly all in one folder. One worker. |
| 5 | Hard Blockers | GO | No migration, no credentials, no kernel change. Fixture kernel only. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Bring Settings in line with the approved mockup's `settings-populated` and `settings-unreachable`: keep the last-read data across a remount while the kernel is down, put "last known" in the title bar's subtitle slot, show home paths as `~/…`, show the account's name (or the mockup's "personal subscription") instead of the provider id, keep each command block on one line, and make the theme help text describe the selected theme.

**Problem Statement:**
The 2026-11-01 live run (item 10's runbook: "Open all seven screens first, so each holds data, then stop the service and look at each again") showed Settings' auth section as "Status unknown". Root cause: the shell mounts only the current screen (`app/src/App.tsx`, `<Screen />`), so going back to Settings after the kernel stopped remounts it, and `useSettingsRead` (`app/src/screens/settings/useSettings.ts`) starts from `NOT_READ` with no last `ok` view. The first read answers status 0, so `SettingsScreen.tsx` takes the `latest?.kind === "unreachable"` branch and draws `IDS.unknown`. The in-mount case already keeps its data (e2e AC7 pins it), which is why the fixture tests passed. The other mismatches: Data location and Loomwright print absolute paths (`AuthSection.tsx`, `{view.dataDir}` / `{view.loomwright.installPath}`); Account prints `provider.account`, which the real kernel fills with the provider id; `.settings-mono` has `overflow-wrap: anywhere` (settings.css:38), so `security add-generic-password … -w` breaks; `THEME_DESCRIPTION = "System follows your Mac."` (model.ts:274) is shown whatever theme is pressed; and "last known" sits beside the two section headings instead of in the title bar.
Success: navigating to Settings while the kernel is down shows the last data under the shell band, "last known" in the title bar, `~/…` paths, "personal subscription", one-line commands and theme-matched help text, in light and dark, matching the mockup views.

**Mockup (owner-approved):** `docs/design/mockups/gui-v2.html`, views `settings-populated` and `settings-unreachable`. `settingsScreen` sets `R.sub=last?'last known':''`, so populated has no subtitle and unreachable's subtitle is "last known"; the section heads carry only the `read-only` badge. The mockup's theme caption is "System follows your Mac." for System; Light and Dark wording is set below.

**Owner decisions carried from the requirement (binding):** Settings stays read-only for auth: no secret entry, never a claude.ai sign-in (invariant 6). The login-item note is out of scope. Screenshots from the owner's real store stay outside the repo; the committed ones are fixture screenshots. Nothing is patched outside the item's Touches, extended below; a worker that needs another file stops and says so. Invariants 1–9 unchanged.

**Owner decisions (Launch Pad `LP-CLARIFY`, 2026-11-01, binding; they extend Touches):**
1. **`app/src/shell/frame.test.tsx`: allowed.** Change only the expected list at line 94 (`toEqual([])`) to include `"settings"` (kept sorted with whatever sibling ids are already there after rebase; the test title may say "only the screens whose items moved their line declare one"). No other line of the file.
2. **`app/e2e/phase-7-exit.spec.ts:821`: allowed.** Change only that assertion: the unreachable case expects the title bar's subtitle to read "last known" (`page.getByTestId("titlebar-subtitle")` has text "last known") instead of two `SETTINGS.lastKnown` marks. No other line of the file.
The PR body names both extensions.

**Design choices made here (Launch Pad defaults; the owner may change them on the PR):**
- **Account fallback:** the Account row shows `provider.account` when it is non-null and differs from `provider.id`. When it is `null` or equals the id (the kernel's "no label recorded" fallback), it shows "personal subscription" for the `subscription-token` provider (the mockup's wording) and keeps today's "none recorded" for any other provider.
- **Theme help text:** System → "System follows your Mac." (unchanged); Light → "Always light, whatever your Mac uses."; Dark → "Always dark, whatever your Mac uses." While the preferences have not answered, the System text.
- **Write controls while offline:** Reveal in Finder is disabled with `title="Needs the kernel"` (as today). The "This app" switches and theme buttons stay enabled: they are the main process's, not the kernel's, and the mockup does not disable them.

## Acceptance Criteria

Carried from the requirement (AC1–AC7), made concrete. AC7 is rewritten to the evidence-file form.

- [ ] **AC1** Given Settings loaded against the fixture kernel, when the fixture's listener stops (`fixture.stop()`), then the shell band (`kernel-unreachable-band`) shows over Settings' last data: the provider, account, health, data location and Loomwright rows read as before, `IDS.unknown`, `IDS.error`, `IDS.notice` and any `GET /settings` text are absent, and Reveal in Finder is disabled with `title="Needs the kernel"`. When the user goes to another screen and back to Settings while still stopped (a remount), the same last data shows (not "Status unknown"). When the listener restarts (`fixture.restart()`), the band goes, the subtitle clears and Reveal is enabled again, matching `settings-unreachable` and then `settings-populated`. With no data ever read (the app started with the kernel down), "Status unknown" stays (the existing SettingsScreen.test "with no data at all and the kernel unreachable" case is unchanged). Pinned in `app/e2e/settings.spec.ts` (AC7 there moves from `fixture.close()` to `stop()`/`restart()` and adds the remount) and in a new unit test for the cache.
- [ ] **AC2** Given Settings, then the title bar's subtitle slot (`titlebar-subtitle`, through `screen.Subtitle` in `app/src/screens/settings/index.tsx`) reads "last known" (`LAST_KNOWN` from `app/src/shell/last-known.ts`) while the kernel is unreachable and Settings holds a last view, and is empty otherwise (populated: title alone visually, matching `settings-populated`, whose `R.sub` is `''`). The two section headings no longer carry `settings-last-known` marks. Pinned in the unit test and the e2e (populated: subtitle text is empty; unreachable: "last known").
- [ ] **AC3** Given a data directory and Loomwright install under the home folder, then Data location and Loomwright read `~/…` (`formatHomePath(path, useHomeDir(api))`), matching `settings-populated`, and Reveal in Finder still records exactly one `reveal` call for the main process's own data dir (the existing AC6 e2e, unchanged in substance); given paths outside home, they read in full. The e2e reads the app's home with `app.evaluate(({ app }) => app.getPath("home"))` and serves paths under it through `fx.update({ data_dir, loomwright })` (spec-local; `app/e2e/fixtures/settings.ts` is not edited). Unit tests cover under-home, outside-home and no `homeDir` member (full path).
- [ ] **AC4** Given the subscription provider whose `account` equals its id (`subscription-token`) or is `null`, then Account reads "personal subscription", never `subscription-token`; given a recorded label (`"Vikash"`), that label; given another provider with no label, "none recorded". Pure helper in `model.ts`, unit-tested in `model.test.ts`; the e2e drives the id-equals-account case by wrapping `fx.options.routes["GET /settings"]` in the spec so the body's `provider.account` equals `provider.id`.
- [ ] **AC5** Given the default window size (1180×760, `app/electron/main.ts:25`), then each of the three command blocks (`IDS.command`) is one line: its `getBoundingClientRect().height` is at most one `--type-mono-line` plus padding (assert equal height across the three, and `scrollWidth > clientWidth` allowed only with `overflow-x: auto` on its block). Beyond the width it scrolls horizontally, never wraps (`white-space: pre; overflow-wrap: normal` on the command `code`, `overflow-x: auto` on it or `.settings-cmdline`). Copy still copies the whole command. Pinned in the e2e.
- [ ] **AC6** Given System, Light or Dark pressed, then the theme row's help text is the matching sentence from "Design choices" above, and it changes when another button is pressed. Pinned in a unit test (all three) and the e2e (one change).
- [ ] **AC7** Given the polish gate, then the committed evidence file `docs/evidence/phase-7-polish/settings/README.md` names each regenerated screenshot against its `gui-v2.html` view (`settings-populated`, `settings-unreachable`, and every other `settings-*` state whose pixels move: all six are rewritten by the spec), each in light and dark, written by `app/e2e/settings.spec.ts` with `SETTINGS_EVIDENCE=1` through `app/e2e/electron-harness.ts`. Its rows and "known differences" are updated: "last known" now in the title bar (README line 85's departure removed), `~/…` paths, the account wording, one-line commands, the theme text, and the two Touches extensions. The PR body links to it.

**Evidence rule:** AC7's evidence lives in the committed `docs/evidence/phase-7-polish/settings/README.md` (a File Impact Map modify), never only in the PR body.

**Validation (must pass before merge):** `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`; `bash scripts/check-docs.sh`.

## File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| Settings screen (Subtask 1) | `app/src/screens/settings/useSettings.ts` (121), `app/src/screens/settings/SettingsScreen.tsx` (249), `app/src/screens/settings/AuthSection.tsx` (239), `app/src/screens/settings/model.ts` (303), `app/src/screens/settings/index.tsx` (38), `app/src/screens/settings/settings.css` (395), `app/src/screens/settings/model.test.ts` (246), `app/src/screens/settings/SettingsScreen.test.tsx` (742; only the two `IDS.lastKnown` expectations at :547 and :574 move to the subtitle, each with a reason) | `app/src/screens/settings/lastKnown.ts`, `app/src/screens/settings/SettingsSubtitle.tsx`, `app/src/screens/settings/polish.test.tsx` | HIGH |
| e2e + evidence | `app/e2e/settings.spec.ts` (554), `docs/evidence/phase-7-polish/settings/README.md` (97), `docs/evidence/phase-7-polish/settings/settings-*-{light,dark}.png` (12, regenerated) | — | HIGH |
| owner-allowed pins | `app/src/shell/frame.test.tsx` (315; line 94 only, owner decision 1), `app/e2e/phase-7-exit.spec.ts` (1021; line 821 only, owner decision 2; no new responsibility) | — | HIGH |

**Module layout (one home per new responsibility):**
- **Last-known cache across remounts:** CREATE `app/src/screens/settings/lastKnown.ts`. A module-level store of the last `ok` `SettingsView` per bridge (`WeakMap<StudioBridge, SettingsView>`) with `subscribe`/`get`/`set` for `useSyncExternalStore`. `useSettingsRead` seeds its `Read` from it on mount (`lastOk` set, `latest` undefined) and writes every `ok` reply to it. No React in the store module itself (a hook may live beside it). Not in `useSettings.ts` because the subtitle also reads it.
- **Subtitle:** CREATE `app/src/screens/settings/SettingsSubtitle.tsx` with two exports: `SettingsSubtitleView({ api })` (the testable part, keyed by the prop bridge: `useKernelReach(api).offline && cached view exists` → `LAST_KNOWN`, else `null`) and a thin `SettingsSubtitle` that calls `getBridge()` and renders `null` with no bridge, else `<SettingsSubtitleView api={api} />`. Unit tests render `<SettingsSubtitleView api={fake.bridge} />` beside `<SettingsScreen api={fake.bridge} />` (same bridge, so the same cache key). "Offline" here is the shell's `KernelReach.offline` (the shared contract): in the moment a status-0 read lands before the feed notices, the sections are offline while the subtitle is still empty; that is expected, not a defect. `index.tsx` adds `Subtitle: SettingsSubtitle`. (An empty `titlebar-subtitle` span remains when it renders `null`; `Titlebar.tsx` is not edited. `.titlebar` is a flex row with `gap`, so an empty span adds no visible text.)
- **Account wording and theme text:** pure helpers in `model.ts` (303, under the threshold): `accountLabel(provider)` and `themeDescription(theme)`; `THEME_DESCRIPTION` stays exported (System text) or is replaced by the helper (grep: its only users are `model.ts:274` and `SettingsScreen.tsx:36,225`).
- **`~` paths:** reuse `formatHomePath` / `useHomeDir` from `app/src/shell/` (never a copy). `KernelSection` receives `home` as a prop from `SettingsScreen`.
- **Command blocks:** CSS only, in `settings.css` (`.settings-cmdline code`).
- **Tests:** new unit pins go in CREATE `polish.test.tsx`, not appended to `SettingsScreen.test.tsx` (742, past the threshold); `model.test.ts` (246) takes the helper tests. `app/e2e/settings.spec.ts` (554) is past the threshold but is appended: Touches names this spec only, the owner's rule forbids a new spec file outside Touches, and its `screenshots()` / evidence README checks live there.

**Validator-owned surfaces:** `scripts/check-docs.sh` checks every relative link under `docs/` (the README's 12 image links must still resolve). `app/e2e/settings.spec.ts` AC11 checks the README names every state's light and dark PNG and `SETTINGS_EVIDENCE=1`.

**Total estimated files:** 12 modify + 3 create (+ 12 regenerated PNGs).

### File Overlap Detection

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| Subtask 1 | — | single subtask | NO |
| this item | sibling lanes 12 (Memory), 15 (Playbooks) | `app/src/shell/frame.test.tsx:94` (each adds its id) | rebase before FINALIZE |

## Touched-file invariants

> Grounded at base `daed1eab9fafe3f5429ca2d3f6efd13609bc7ada`. The worker re-checks each entry before handing back.

- **`app/src/screens/settings/model.ts`**
  - **keep:** `parseSettings` builds the view field by field (model.ts:8-9, "token-shaped string, say) is never shown and never kept"); every kernel string passes through `safe` (`printable`). No import that reaches a `.tsx` file ("so the e2e project (`tsconfig.node.json`, no `jsx`) can import `SETTINGS_TEST_IDS`"). `IDS.lastKnown` stays in `SETTINGS_TEST_IDS` (unused ids are harmless; the e2e imports the object).
  - **pinned by:** `model.test.ts` (the secret-field and escaping cases), `SettingsScreen.test.tsx:399,407` (account rendered literally and escaped: `accountLabel` must return the `safe`d account unchanged when it is a real label).
- **`app/src/screens/settings/AuthSection.tsx`**
  - **keep:** "There is no input, no sign-in and no way to enter a credential anywhere in this file (invariants 6 and 7)". Every value renders as a React text child. `copySelection` reads the `code` node's text, so the `~` formatting never applies to command blocks; `SETUP_STEPS` stays reused, never copied.
  - **pinned by:** `settings.spec.ts` AC10 (no input / sign-in), AC2 (`IDS.command` texts equal `COMMANDS`).
- **`app/src/screens/settings/SettingsScreen.tsx`**
  - **keep:** "A status 0 answer is 'kernel unreachable', never 'nothing to show'"; the refetch on return (`if (live && unanswered) refetch();`); Reveal sends no path (`revealFolder()` → `bridge.revealDataDir()`); "The app's own preferences are the main process's ... they work while the kernel is down". `bandOf` (token health band, `IDS.band`) stays: it is the mockup's `R.band`, not the kernel band.
  - **pinned by:** `SettingsScreen.test.tsx` "the kernel unreachable" block (app controls enabled, `kernel.fake.reveals` 0), `settings.spec.ts` AC6 (one `reveal` of the main process's own dir), AC7.
- **`app/src/screens/settings/useSettings.ts`**
  - **keep:** "an answer older than the latest request is dropped" (`generation`); "The last `ok` view is kept until a newer one lands". The cache only seeds `lastOk`; it never invents a `latest`, so a remount still issues its read.
- **`app/src/screens/settings/index.tsx`**
  - **keep:** `id: "settings"`, `title: "Settings"`, `nav: { label: "Settings", order: 11, shortcut: "⌘," }` unchanged; "The shell draws the one `h1`, so neither branch renders one."
  - **pinned by:** `app/src/App.test.tsx` (entries), `settings.spec.ts` AC2 (`h1` reads "Settings").
- **`app/src/screens/settings/settings.css`**
  - **keep:** every colour from the design tokens (`contrast.test.ts`, `settings.spec.ts` AC10 "takes every colour from the design tokens").
- **`app/e2e/settings.spec.ts`**
  - **keep:** Electron launched only through `launchApp` from `./electron-harness` (`.agent/rules/testing.json`; `app/scripts/hidden-windows.test.ts`). PNGs written only under `SETTINGS_EVIDENCE=1` (AC11 "nothing under the tracked evidence dir changed during the run"). `app/e2e/fixtures/settings.ts` is not edited: overrides are spec-local.
- **`app/src/screens/settings/SettingsScreen.test.tsx`**
  - **keep:** every case unchanged except the two `IDS.lastKnown` expectations (`expect(screen.getAllByTestId(IDS.lastKnown)).toHaveLength(2)` at :547, `expect(screen.queryAllByTestId(IDS.lastKnown)).toHaveLength(0)` at :574), which move to the subtitle (rendered beside the screen with the same fake bridge). In particular "with no data at all and the kernel unreachable it says the status is unknown, never a health" (:241, AC1 relies on it) and the literal/escaped account cases (`expect(text(IDS.account)).toBe(markup);` :399, :407) stay as they are. New pins go in `polish.test.tsx`.
- **`app/src/screens/settings/model.test.ts`**
  - **keep:** the existing parse, secret-field and escaping cases (`expect(parsed?.provider.account).toBe("a\\u202eb\\x1b[31m");` :82) unchanged; the `accountLabel` and `themeDescription` tests are added beside them.
- **`app/src/shell/frame.test.tsx` / `app/e2e/phase-7-exit.spec.ts`**
  - **keep:** only line 94 / line 821 change (owner decisions 1 and 2). On rebase keep sibling ids already added at :94.

## Closed enumerations touched

> Grep at base: `grep -rn "Subtitle" app/src --include="*.ts*"` → `types.ts` (definition), `Titlebar.tsx` (render), `frame.test.tsx:94` (the closed list of declaring screens). `grep -rn "lastKnown" app/src app/e2e` → `AuthSection.tsx:40`, `SettingsScreen.test.tsx:547,574`, `settings.spec.ts:395`, `phase-7-exit.spec.ts:821`.

- **Screens declaring `Subtitle`:** `app/src/shell/frame.test.tsx:94` `toEqual([])` → add `"settings"` (owner decision 1).
- **`settings-last-known` marks:** `SettingsScreen.test.tsx:547` (`toHaveLength(2)`) and `:574` (`toHaveLength(0)`), `settings.spec.ts:395` (`toHaveCount(2)`), `phase-7-exit.spec.ts:821` (`toHaveCount(2)`, owner decision 2): each moves to the subtitle's "last known".

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `polish.test.tsx`: remount while unreachable shows the last data, not `IDS.unknown` | in `useSettings.ts`, start from `NOT_READ` without seeding from the cache (applied by the reviewer) |
| `polish.test.tsx` / e2e: subtitle reads "last known" while offline with a view | make `SettingsSubtitle` return `null` always |
| `polish.test.tsx`: subtitle empty while live | drop the `offline` condition in `SettingsSubtitle` (applied by the reviewer) |
| `polish.test.tsx`: no `settings-last-known` mark in the section heads | restore `lastKnown={offline}` on `KernelSection`'s `SectionHead` |
| `polish.test.tsx` / e2e AC3: paths under home read `~/…` | render `{view.dataDir}` without `formatHomePath` in `AuthSection.tsx` |
| `model.test.ts`: account equal to the id reads "personal subscription" | in `accountLabel`, return `provider.account ?? "none recorded"` (applied by the reviewer) |
| `model.test.ts`: a recorded label is shown | make `accountLabel` always return "personal subscription" for `subscription-token` (applied by the reviewer) |
| `polish.test.tsx` / e2e: Dark pressed reads "Always dark, whatever your Mac uses." | return the System text for every theme in `themeDescription` |
| e2e AC5: each command block is one line at 1180×760 | delete the `white-space: pre` declaration on `.settings-cmdline code` |
| `frame.test.tsx:94` includes `"settings"` | delete `Subtitle: SettingsSubtitle,` in `app/src/screens/settings/index.tsx` |
| `phase-7-exit.spec.ts:821`: unreachable case's `titlebar-subtitle` reads "last known" | delete `Subtitle: SettingsSubtitle,` in `app/src/screens/settings/index.tsx` |
| `SettingsScreen.test.tsx:547` (moved): the subtitle reads "last known" after the read answers unreachable with a held view | make `SettingsSubtitleView` return `null` always (applied by the reviewer) |
| `SettingsScreen.test.tsx:574` (moved): the subtitle is empty once an answer lands again | drop the `offline` condition in `SettingsSubtitleView` (applied by the reviewer) |
| `model.test.ts`: another provider with no label reads "none recorded" | in `accountLabel`, return "personal subscription" for every provider (applied by the reviewer) |
| `polish.test.tsx`: a path outside home reads in full | in `AuthSection.tsx`, pass `"/"` as the home to `formatHomePath` instead of the `home` prop (applied by the reviewer) |
| `polish.test.tsx`: a bridge with no `homeDir` member shows the path in full | in `SettingsScreen.tsx`, pass a constant `"/Users/owner"` as `home` instead of `useHomeDir(api)` (applied by the reviewer) |
| `polish.test.tsx`: Light pressed reads "Always light, whatever your Mac uses." | in `themeDescription`, return the Dark text for Light (applied by the reviewer) |
| `settings.spec.ts` AC7: after `fixture.stop()`, leaving Settings and coming back shows the last data, not `settings-unknown` | in `useSettings.ts`, start from `NOT_READ` without seeding from the cache (applied by the reviewer) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Settings polish: last-known cache across remounts, the title-bar "last known", `~` paths, the account wording, one-line commands, theme text, tests, the two allowed pins, regenerated evidence | AC1–AC7 | 12 modify, 3 create (+12 PNGs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "app/src/screens/settings/lastKnown.ts"}
  - {kind: "file", path: "app/src/screens/settings/SettingsSubtitle.tsx"}
  - {kind: "symbol", path: "app/src/screens/settings/SettingsSubtitle.tsx", name: "SettingsSubtitle"}
  - {kind: "symbol", path: "app/src/screens/settings/SettingsSubtitle.tsx", name: "SettingsSubtitleView"}
  - {kind: "symbol", path: "app/src/screens/settings/model.ts", name: "accountLabel"}
  - {kind: "symbol", path: "app/src/screens/settings/model.ts", name: "themeDescription"}
  - {kind: "file", path: "app/src/screens/settings/polish.test.tsx"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/settings/README.md"}
requires: []
lanes:
  - "app/src/screens/settings/**"
  - "app/e2e/settings.spec.ts"
  - "app/src/shell/frame.test.tsx"
  - "app/e2e/phase-7-exit.spec.ts"
  - "docs/evidence/phase-7-polish/settings/**"
external_requires:
  - "Playwright + the built Electron app (`npm run build`) on macOS for the e2e and the light/dark screenshots"
```

## Parallelism Analysis

single-agent (no fan-out)

### Dependency Graph
```
Subtask 1 (independent; item 11's contract already on main)
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
| `app/src/screens/settings/model.ts:274` | yes | HOLDS | `export const THEME_DESCRIPTION = "System follows your Mac.";` | base daed1ea |
| `app/src/screens/settings/settings.css:38` | yes | HOLDS | `overflow-wrap: anywhere;` (in `.settings-mono`) | base daed1ea |
| `kernel/src/auth/subscription-token.ts:75` | yes | HOLDS | `return (store && readProviderMetadata(store, id)?.account) \|\| id;` | base daed1ea |
| `app/src/shell/frame.test.tsx:94` | yes | HOLDS | `expect(SCREENS.filter((s) => s.Subtitle !== undefined).map((s) => s.id)).toEqual([]);` | base daed1ea |
| `app/e2e/phase-7-exit.spec.ts:821` | yes | HOLDS | `await expect(byId(page, SETTINGS.lastKnown)).toHaveCount(2);` | base daed1ea |
| `app/electron/main.ts:25` | yes | HOLDS | `width: 1180,` (height 760 at :26) | base daed1ea |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): two pins outside Touches (`frame.test.tsx:94`, `phase-7-exit.spec.ts:821`). | MEDIUM | Owner allowed both one-line changes (`LP-CLARIFY`, 2026-11-01). Any other file outside the lanes: stop and say so (owner rule). |
| Feasibility (Phase 2.5): the evidence folder `docs/evidence/phase-7-polish/settings/` is not in Touches. | LOW | It is the spec's own output folder and scope item 6 requires committed screenshots; items 11, 12, 14 and 15 commit theirs the same way. |
| Lanes 12 and 15 add their ids to `frame.test.tsx:94` too. | MEDIUM | Rebase on `origin/main` before FINALIZE and keep every sibling id, sorted; never revert a sibling's line. A conflict that is not a plain union of ids escalates; never force-resolve. |
| A module-level cache leaks a stale view into a later test in the same jsdom run. | MEDIUM | Key it by bridge (`WeakMap<StudioBridge, …>`): each test's fake bridge is new. Export a test-only reset if any test reuses a bridge. |
| A cached view shown after the kernel returns with a different data dir. | LOW | The cache seeds only `lastOk`; the mount still reads, and the answer replaces it. "last known" marks it until then. |
| An empty `titlebar-subtitle` span while live (Settings declares `Subtitle` but renders nothing). | LOW | `Titlebar.tsx` is outside Touches; the flex row shows nothing visible. The e2e asserts its text is empty, not its absence. Record in the README. |
| `app.getPath("home")` in the e2e is the real user's home, so the `~` screenshots would print it in full if the spec served `/Users/<owner>/...`. | MEDIUM | AC3's spec serves paths under the app's own home, so the screenshots show `~/…` and publish no user name (the requirement's point). Assert no screenshot text contains the home path (`document.body.innerText` excludes it). |
| `white-space: pre` on a long command at narrow widths hides its end. | LOW | `overflow-x: auto` on the code block keeps it scrollable; Copy reads the node's full text. |
| Screenshot pixels differ between machines. | LOW | Assert behaviour, never pixels; PNGs only under `SETTINGS_EVIDENCE=1`. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-01-settings-last-known-data-account-name-and-polish.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-01T10:43:49Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/199
- **Branch:** feature/settings-last-known-data-account-name-and-polish
- **Files changed:** 28
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Settings keeps the last ok view per bridge across remounts (lastKnown.ts), shows "last known" in the title-bar subtitle (SettingsSubtitle), prints ~ paths, labels the kernel's id-as-account fallback "personal subscription", keeps commands on one line with a token-coloured overflow shade, and describes the pressed theme; both owner-allowed pins, the unit/e2e pins, the evidence README and PNGs updated. Phase 4.5: iteration 1 fixed 2 MEDIUM (overflow cue; shared test-support.tsx fixtures), iteration 2 PASS with no findings; 1 LOW dismissed (stale-while-revalidate on live remount). Pre-flight OVERLAP (sibling PRs #194-196 on frame.test.tsx / phase-7-exit.spec.ts) — owner chose proceed-anyway; rebase may be needed when they merge.

## Not verified
- **Real kernel with the subscription-token provider answering account equal to id** — the e2e wraps the fixture route to emulate the kernel fallback; the real kernel route was not run (subtask 1)
- **Keyboard access to the clipped end of the longest command** — removed from the Tab order on purpose; no screen reader or keyboard scroll check was done (subtask 1)
- **Ubuntu CI e2e** — ran on macOS only; screenshots are macOS-only by design (subtask 1)
