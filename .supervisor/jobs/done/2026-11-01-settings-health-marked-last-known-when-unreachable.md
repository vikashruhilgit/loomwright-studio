# Supervisor Job: Settings: Health marked last known while the kernel is unreachable (phase 7, item 27)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-01-171537/L5
- **CLAUDE.md:** ✓ Found (fresh: every path in its "Where things are" table exists; `bash scripts/check-docs.sh` enforces it)
- **Git:** clean (0 files), branch: main, at origin/main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (two evidence folders outside the requirement's `## Touches`: `docs/evidence/phase-7-polish/settings/` (the settings spec's own output folder, the same convention item 18 used) and the two `settings-unreachable` PNGs plus one README row in `docs/evidence/gui-v2-mockup/` (the mockup's committed screenshots of the very view this item changes; the owner allowed exactly these three paths in `LP-CLARIFY`, 2026-11-01, below). No other file outside Touches. See Risk Assessment.)
- **Source requirement:** .supervisor/requirements/phase-7/2026-11-01-090027-settings-health-marked-last-known-when-unreachable.md
- **Base commit:** 59275c832a77f65975ebdf020e34a3dcc552519a
- **Depends on:** none. Item 18 (PR #199) is merged: `lastKnown.ts`, `SettingsSubtitle.tsx`, the `offline` flag in `SettingsScreen.tsx` and the remount cache are on main.

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React + Electron, vitest/jsdom, Playwright e2e through `app/e2e/electron-harness.ts`; the mockup is a static HTML file. Nothing new. |
| 2 | Dependency Availability | GO | No new dependency. `LAST_KNOWN` (`app/src/shell/last-known.ts:19`, `export const LAST_KNOWN = "last known";`) is reused. The mockup already has the neutral dot class (`gui-v2.html:270`, `.dot.idle{border:2px solid var(--idle)}`). |
| 3 | Architecture Fit | GO | `SettingsScreen.tsx:69` already computes `offline` (`connectionDown \|\| latest?.kind === "unreachable"`) and passes it to `KernelSection`; `AuthSection` gets the same prop. The assumption holds: the held view (`read.lastOk`, seeded from `lastKnown.ts` across remounts) already carries `provider.health`. |
| 4 | Scope vs Supervisor Capability | GO | About 8 modify (+4 regenerated PNGs, 2 mockup PNGs), one folder plus the mockup. One worker. |
| 5 | Hard Blockers | GO | No kernel change, no migration, no credentials. Fixture kernel only. `phase-7-exit.spec.ts`'s Settings `unreachable` case (`init: { unreachable: true }`) fails only `GET /status` (503, `app/e2e/fixtures/phase-7-exit.ts:177`); `GET /settings` still answers, so the case holds a view and Health will show the new mark, but the case asserts nothing about Health (only the band, the subtitle and a disabled Reveal, spec:820-822) and writes no screenshots, so it stays green. Its `populated` case asserts `toHaveText("ok")` while live: unchanged. |

**Overall Verdict:** GO

## Task
**Goal:** While the kernel is unreachable and Settings holds a last view, the Auth provider's Health row shows its last value with a neutral dot (the mockup's `.dot.idle` ring, never green) and a "last known" caption; when the kernel answers again it shows the live value and colour. The mockup's `settings-unreachable` view changes first (D9).

**Problem Statement:**
The 2026-11-01 live re-run (kernel booted out) showed Settings' last-known page with "last known" in the title bar, but the Health row still had a green dot and "ok". Root cause: `AuthSection` (`app/src/screens/settings/AuthSection.tsx:58-76`) draws `healthView(provider.health)` with no notion of reach; it never receives `offline` (`SettingsScreen.tsx:168`, `<AuthSection view={view} placeholder={placeholder} now={now} />`). The mockup does the same: `settingsScreen` (`gui-v2.html:1255`) draws `<span class="dot ok">` for `settings-unreachable`, because its `v` is `'ok'` whatever `off` is. So the design changes first, then the app.
Success: `gui-v2.html#view=settings-unreachable` and the running app (fixture kernel stopped) both show Health as a neutral ring, the word "ok" in the body ink colour and a "last known" caption, light and dark; restarting the kernel brings back the green dot and no caption.

**Owner decisions carried from the requirement (binding):** While the kernel is unreachable, Settings shows Health's last value with a "last known" mark and no green dot; `gui-v2.html`'s `settings-unreachable` view changes first (D9). Other Settings rows are a non-goal (the title line's "last known" covers them). Settings stays read-only for auth: no secret entry, never a claude.ai sign-in (invariant 6). Screenshots from the owner's real store stay outside the repo; committed ones are fixture screenshots. Nothing is patched outside the item's Touches; the two evidence folders below are the only extension, and a worker that needs any other file stops and says so. Invariants 1–9 unchanged.

**Owner decision (Launch Pad `LP-CLARIFY`, 2026-11-01, binding; it extends Touches):**
1. **`docs/evidence/gui-v2-mockup/`: allowed for exactly three paths.** Regenerate only `gui-v2-settings-unreachable-light.png` and `gui-v2-settings-unreachable-dark.png` with that README's own pinned command (§"How to regenerate", Playwright 1.64.1), and change only the description cell of the `settings-unreachable` row (README line 81). Nothing else in that folder. The PR body names this extension.
The polish folder `docs/evidence/phase-7-polish/settings/` is the settings spec's own output folder (written under `SETTINGS_EVIDENCE=1` and checked by its AC11), extended the same way items 11, 12, 14, 15 and 18 did. Any other file outside Touches: stop and say so.

**Design choices made here (Launch Pad defaults; the owner may change them on the PR):**
- **Which "unreachable":** the screen's own `offline` (`SettingsScreen.tsx:69`), the same flag that disables Reveal in Finder, so the mark and the disabled Reveal always agree. (The title-bar subtitle follows the shell's `KernelReach`; the brief moment where they differ is item 18's documented, expected gap.)
- **What the row shows while offline with a view:** the dot's tone is `neutral` and the word's tone is `neutral` (body ink, not green/amber/red), for every health value, not only `ok` (a stale "expiring" or "missing" is just as unknown). The word and its existing caption (`18 days left`, `no token in the Keychain item`, an error reason) stay. A caption "last known" (`LAST_KNOWN`, reused) follows them, as `<span className="settings-cap" data-testid={IDS.healthLastKnown}>`. Live: unchanged (tone from `healthView`, no caption).
- **The neutral dot:** `.settings-dot[data-tone="neutral"]` is drawn as the mockup's `.dot.idle`: `background: transparent; border: 2px solid var(--idle); box-sizing: border-box;` (8×8 total). `Dot` is used only for Health (`AuthSection.tsx:70`), so the only other neutral dot (a health word this build does not know, `healthView` default) becomes the same ring, which matches the mockup's meaning of `idle`.
- **The mockup:** in `settingsScreen`, when `off`, the `ok` health reads `<span class="dot idle" aria-hidden="true"></span>ok<span class="cap">last known</span>`; every other view is byte-identical. No view is added or removed.

## Acceptance Criteria

Carried from the requirement (AC1–AC4), made concrete. AC4 is rewritten to the evidence-file form.

- [ ] **AC1** Given `docs/design/mockups/gui-v2.html#view=settings-unreachable` (light and dark), then the Health row reads `ok` beside a `dot idle` ring (not `dot ok`) with a `cap` "last known" after it; `settings-populated` still draws `dot ok` and no caption. The two committed mockup screenshots `docs/evidence/gui-v2-mockup/gui-v2-settings-unreachable-{light,dark}.png` are regenerated with that README's own command (§"How to regenerate", Playwright 1.64.1, `--viewport-size=1280,1000 --full-page --wait-for-timeout=600`), and its `settings-unreachable` row (README line 81) says "Health marked last known with a neutral dot". Pinned in `app/e2e/settings.spec.ts` by a file-level test (no Electron, like AC11's README test) that reads `gui-v2.html`, slices `function settingsScreen` up to the next top-level `function `, and asserts it contains the literal off-branch Health markup `<span class="dot idle" aria-hidden="true"></span>ok<span class="cap">last known</span>` (absent at base: the slice's existing `last known` texts at lines 1252 and 1268 do not match it) and still contains `<span class="dot ok" aria-hidden="true"></span>ok`. `phase-7-exit.spec.ts` AC3 (51 views in `docs/evidence/gui-v2-mockup/README.md`) stays green: no view is added or removed.
- [ ] **AC2** Given Settings loaded against the fixture kernel, when the fixture's listener stops (`fixture.stop()`), then the Health row (`IDS.health`) shows the last word (`ok`) with its dot's `data-tone="neutral"` (computed `background-color` transparent, never the `--ok` colour), the word's `data-tone="neutral"`, and `IDS.healthLastKnown` reading "last known", matching the updated `settings-unreachable`; after leaving Settings and coming back while still stopped (item 18's remount), the same. Pinned in `app/e2e/settings.spec.ts` AC7 and in a unit test in `polish.test.tsx` (offline with a held `ok` view, and a held `expiring` view: dot and word neutral, the "18 days left" caption kept, the mark present).
- [ ] **AC3** Given that state, when the listener restarts (`fixture.restart()`), then Health shows `ok` with `data-tone="ok"` on the dot and the word and no `IDS.healthLastKnown`. Pinned in `app/e2e/settings.spec.ts` AC7 (after `restart()`) and the unit test (an answer lands again: tone back, mark gone). While live and never offline, `IDS.healthLastKnown` is absent (populated pin).
- [ ] **AC4** Given the polish gate, then the committed evidence file `docs/evidence/phase-7-polish/settings/README.md` names each screenshot this item changes against its `gui-v2.html` view, light and dark: `settings-unreachable-{light,dark}.png` (regenerated by `app/e2e/settings.spec.ts` with `SETTINGS_EVIDENCE=1` through `app/e2e/electron-harness.ts`) against `settings-unreachable`, and the two regenerated mockup PNGs. Its `settings-unreachable` row (line 26) and its Unreachable test row (line 73) say Health is marked "last known" with a neutral dot, the "Every status carries text as well as colour" paragraph (line 62) mentions the caption, and the folder still holds exactly 12 PNGs (AC11's count). The PR body links to it.

**Evidence rule:** AC4's evidence lives in the committed `docs/evidence/phase-7-polish/settings/README.md` (a File Impact Map modify), never only in the PR body.

**Validation (must pass before merge):** `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`; `bash scripts/check-docs.sh`.

## File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| Mockup (Subtask 1, first) | `docs/design/mockups/gui-v2.html` (1580; one expression in `settingsScreen`, line 1255), `docs/evidence/gui-v2-mockup/gui-v2-settings-unreachable-{light,dark}.png` (2, regenerated), `docs/evidence/gui-v2-mockup/README.md` (row at line 81 only) | — | HIGH |
| Settings screen | `app/src/screens/settings/AuthSection.tsx` (239), `app/src/screens/settings/SettingsScreen.tsx` (253; line 168 passes `offline`), `app/src/screens/settings/model.ts` (332; `healthLastKnown` id, `healthView` offline variant), `app/src/screens/settings/settings.css` (411; the neutral ring), `app/src/screens/settings/polish.test.tsx` (319), `app/src/screens/settings/SettingsScreen.test.tsx` (716; only the expectation at :512), `app/src/screens/settings/model.test.ts` (286) | — | HIGH |
| e2e + evidence | `app/e2e/settings.spec.ts` (747), `docs/evidence/phase-7-polish/settings/README.md` (109), `docs/evidence/phase-7-polish/settings/settings-unreachable-{light,dark}.png` (2, regenerated) | — | HIGH |

**Module layout (one home per new responsibility):**
- **The offline health view:** a pure helper in `model.ts` (332, under the threshold) beside `healthView`: `healthViewOf(health, offline)` (or an `offline` parameter on `healthView` defaulting to `false`) returns `{ ...healthView(health), tone: "neutral" }` when offline. `model.ts` keeps no `.tsx` import. `SETTINGS_TEST_IDS` gains `healthLastKnown: "settings-health-last-known"`.
- **The row:** `AuthSection` (239) takes `readonly offline: boolean` in `AuthSectionProps` and renders the caption; `SettingsScreen.tsx:168` passes the existing `offline`. No new component.
- **The ring:** CSS only, `.settings-dot[data-tone="neutral"]` in `settings.css`; colours from tokens (`var(--idle)`).
- **Tests:** new unit pins in `polish.test.tsx` (319, the item-18 polish file; under the threshold) and `model.test.ts` (286) for the helper; `SettingsScreen.test.tsx` (716, past the threshold) changes only its `:512` expectation (the reason: the row now carries the mark). `app/e2e/settings.spec.ts` (747) is past the threshold but is appended: Touches names this spec only, the owner's rule forbids a new spec file outside Touches, and its `screenshots()` / evidence README checks live there.

**Validator-owned surfaces:** `scripts/check-docs.sh` checks every relative link under `docs/` (both READMEs' image links must still resolve; no file is renamed). `app/e2e/settings.spec.ts` AC11 checks the polish README names every state's light and dark PNG, that exactly `STATES.length * THEMES.length` PNGs exist, and `SETTINGS_EVIDENCE=1`. `app/e2e/phase-7-exit.spec.ts` AC3 reads `docs/evidence/gui-v2-mockup/README.md`'s view tables (51 views): only the description cell of the `settings-unreachable` row changes, never its first column.

**Total estimated files:** 10 modify (+4 regenerated PNGs).

### File Overlap Detection

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| Subtask 1 | — | single subtask | NO |
| this item | sibling lanes of this run (items 20–26, 28) | none: their Touches are `app/src/shell/*`, `app/electron/*`, `app/src/components/*`, `app/src/screens/{budget,keymap,tasks,playbooks,schedules,memory}`, their own specs, and docs outside these folders; none names `gui-v2.html` or `screens/settings` | NO |

## Touched-file invariants

> Grounded at base `59275c832a77f65975ebdf020e34a3dcc552519a`. The worker re-checks each entry before handing back.

- **`app/src/screens/settings/AuthSection.tsx`**
  - **keep:** "There is no input, no sign-in and no way to enter a credential anywhere in this file (invariants 6 and 7)". Every value renders as a React text child. "Colour is never the only signal: the word is always there" (`model.ts`, `healthView`'s doc): the word stays in every state. `copySelection` and `SETUP_STEPS` untouched.
  - **pinned by:** `settings.spec.ts` AC10 (no input / sign-in, every status has text), AC2 (`IDS.health` "ok" while live).
- **`app/src/screens/settings/SettingsScreen.tsx`**
  - **keep:** the status-0-means-unreachable rule (`useSettings.ts:6-7`, "A status 0 answer is 'kernel unreachable', never 'nothing to show'"); `const offline = connectionDown || latest?.kind === "unreachable";` (line 69) unchanged; the refetch on return (`if (live && unanswered) refetch();`); Reveal sends no path.
  - **pinned by:** `SettingsScreen.test.tsx` "the kernel unreachable" block, `settings.spec.ts` AC6, AC7.
- **`app/src/screens/settings/model.ts`**
  - **keep:** `healthView`'s live mapping (`case "ok": return { label: "ok", tone: "ok", note: undefined };` and the four others) unchanged; `parseSettings` field by field; no import that reaches a `.tsx` file ("so the e2e project (`tsconfig.node.json`, no `jsx`) can import `SETTINGS_TEST_IDS`"). `IDS.lastKnown` stays.
  - **pinned by:** `model.test.ts` healthView cases; `SettingsScreen.test.tsx:110,130,141,157` (live words and notes, `text(IDS.health)` exact strings) stay green unchanged.
- **`app/src/screens/settings/settings.css`**
  - **keep:** every colour from the design tokens.
  - **pinned by:** `contrast.test.ts`, `settings.spec.ts` AC10 "the screen's stylesheet takes every colour from the design tokens".
- **`app/src/screens/settings/SettingsScreen.test.tsx`**
  - **keep:** every case unchanged except `expect(text(IDS.health)).toBe("ok");` at :512 (inside "keeps the last data marked last known…"), which becomes the offline form (`"oklast known"`, or the word element's text plus `IDS.healthLastKnown`), with a one-line reason. `expect(screen.queryAllByTestId(IDS.lastKnown)).toHaveLength(0);` (:510, "the section heads carry no mark") stays: the new caption uses `IDS.healthLastKnown`, not `IDS.lastKnown`.
- **`app/src/screens/settings/polish.test.tsx`**
  - **keep:** `expect(text(IDS.health)).toBe("ok");` at :71 (the remount case, offline) moves to the offline form in the same way; every other case unchanged.
- **`app/e2e/settings.spec.ts`**
  - **keep:** Electron launched only through `launchApp` from `./electron-harness` (`.agent/rules/testing.json`; `app/scripts/hidden-windows.test.ts`). PNGs written only under `SETTINGS_EVIDENCE=1`. `app/e2e/fixtures/settings.ts` not edited. AC7's `rows()` (line 439) compares `health` to the live `before`: after `stop()` the health part is asserted separately (the word element "ok" plus the mark), the other four rows still `toEqual` the last read; after `restart()` `rows()` equals `before` again. The post-stop and post-restart Health checks use retrying Playwright assertions (`toHaveAttribute("data-tone", …)`, `toHaveText`, `toHaveCount`), placed after the `reveal` disabled / enabled assertion (Reveal follows the same `offline`), never a one-shot read right after the subtitle check (the subtitle follows the shell's reach and can lead the screen's `offline`). `await expect(byId(page, IDS.lastKnown), "the section heads carry no mark").toHaveCount(0);` stays.
- **`docs/design/mockups/gui-v2.html`**
  - **keep:** the token block between `/* tokens:begin */` and `/* tokens:end */` byte-identical (`diff <(node app/scripts/tokens.mjs) <(awk …)` from the mockup README, exit 0); the `VIEWS` table (line 870 `'settings-unreachable':{scr:'settings',st:'unreachable',…}`) unchanged; `R.sub=last?'last known':''` unchanged.
  - **pinned by:** `phase-7-exit.spec.ts` AC3 (README coverage, 51 views), the new AC1 file test.
- **`docs/evidence/gui-v2-mockup/README.md` / `docs/evidence/phase-7-polish/settings/README.md`**
  - **keep:** every image link resolves (`check-docs.sh`); the mockup README's first column and view count unchanged; the polish README still contains `SETTINGS_EVIDENCE=1` and names all 12 PNGs.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `polish.test.tsx`: offline with a held `ok` view, the dot's `data-tone` is `neutral` | in `AuthSection.tsx`, pass `healthView(provider.health)` (ignoring `offline`) to `Dot` (applied by the reviewer) |
| `polish.test.tsx`: offline, `IDS.healthLastKnown` reads "last known" | delete the caption's JSX in `AuthSection.tsx` |
| `polish.test.tsx`: live, no `IDS.healthLastKnown` and the dot is `ok` | render the caption unconditionally in `AuthSection.tsx` (applied by the reviewer) |
| `polish.test.tsx`: offline `expiring` keeps "18 days left" and is neutral | in the offline helper, return `note: undefined` (applied by the reviewer) |
| `polish.test.tsx`: an answer landing again brings back `ok` and removes the mark | in `SettingsScreen.tsx:168`, pass `offline={view !== undefined}` instead of `offline` (applied by the reviewer) |
| `model.test.ts`: the offline helper makes the tone `neutral` for all five states and keeps label and note | return `healthView(health)` unchanged when offline |
| `settings.spec.ts` AC7: after `stop()`, the Health dot's computed background is not the `--ok` colour and the mark shows | in `SettingsScreen.tsx:168`, drop the `offline` prop (default `false`) (applied by the reviewer) |
| `settings.spec.ts` AC7: after `restart()`, Health is `data-tone="ok"` with no mark | make `AuthSection`'s offline condition `true` once set (latch it in a `useRef`) |
| `settings.spec.ts` AC1 file test: `settingsScreen` draws `dot idle` and `last known` for Health | revert `gui-v2.html:1255`'s `off` branch to `dot ok` with no caption (applied by the reviewer) |
| `settings.spec.ts` AC1 file test: the off-branch literal includes the caption | delete `<span class="cap">last known</span>` from `gui-v2.html:1255`'s off branch, keeping `dot idle` (applied by the reviewer) |
| `settings.spec.ts` AC1 file test: `settingsScreen` still draws `dot ok` | draw `dot idle` for every view in `gui-v2.html:1255` |
| `SettingsScreen.test.tsx:512` (moved): offline row reads the word plus the mark | delete the caption's JSX in `AuthSection.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Health marked last known: the mockup's `settings-unreachable` first (and its two PNGs), then the app's offline Health row (neutral ring, neutral word, "last known" caption), unit and e2e pins, regenerated polish evidence | AC1–AC4 | 10 modify (+4 PNGs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "app/src/screens/settings/model.ts", name: "SETTINGS_TEST_IDS"}
  - {kind: "file", path: "docs/design/mockups/gui-v2.html"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/settings/README.md"}
  - {kind: "file", path: "docs/evidence/gui-v2-mockup/gui-v2-settings-unreachable-light.png"}
  - {kind: "file", path: "docs/evidence/gui-v2-mockup/gui-v2-settings-unreachable-dark.png"}
requires: []
lanes:
  - "docs/design/mockups/gui-v2.html"
  - "app/src/screens/settings/**"
  - "app/e2e/settings.spec.ts"
  - "docs/evidence/phase-7-polish/settings/**"
  - "docs/evidence/gui-v2-mockup/gui-v2-settings-unreachable-*.png"
  - "docs/evidence/gui-v2-mockup/README.md"
external_requires:
  - "Playwright 1.64.1 + Chromium (`npx playwright install chromium`) for the two mockup screenshots"
  - "Playwright + the built Electron app (`npm run build`) on macOS for the e2e and the light/dark app screenshots"
```

## Parallelism Analysis

single-agent (no fan-out)

### Dependency Graph
```
Subtask 1 (independent; item 18 already on main)
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
| `docs/design/mockups/gui-v2.html:1255` | yes | HOLDS | `` const health=v==='missing'?…:`<span class="dot ok" aria-hidden="true"></span>ok`; `` (`v` is `'ok'` for `unreachable`, line 1253) | base 59275c8 |
| `docs/design/mockups/gui-v2.html:270` | yes | HOLDS | `.dot.idle{border:2px solid var(--idle)}` | base 59275c8 |
| `app/src/screens/settings/SettingsScreen.tsx:69` | yes | HOLDS | `const offline = connectionDown \|\| latest?.kind === "unreachable";` | base 59275c8 |
| `app/src/screens/settings/SettingsScreen.tsx:168` | yes | HOLDS | `<AuthSection view={view} placeholder={placeholder} now={now} />` | base 59275c8 |
| `app/src/screens/settings/AuthSection.tsx:70` | yes | HOLDS | `<Dot tone={health.tone} />` | base 59275c8 |
| `app/src/screens/settings/settings.css:172` | yes | HOLDS | `.settings-dot {` … `background: var(--idle);` (no `neutral` rule) | base 59275c8 |
| `app/src/screens/settings/SettingsScreen.test.tsx:512` | yes | HOLDS | `expect(text(IDS.health)).toBe("ok");` (offline case) | base 59275c8 |
| `app/src/screens/settings/polish.test.tsx:71` | yes | HOLDS | `expect(text(IDS.health)).toBe("ok");` (offline remount case) | base 59275c8 |
| `app/e2e/settings.spec.ts:439` | yes | HOLDS | `const rows = async () => ({ … health: await textOf(page, IDS.health), … });` | base 59275c8 |
| `app/e2e/phase-7-exit.spec.ts:818` | yes | HOLDS | `init: { unreachable: true },` (Settings unreachable case: no view, no Health row) | base 59275c8 |
| `docs/evidence/gui-v2-mockup/README.md:81` | yes | HOLDS | `` | `settings-unreachable` | The shared band over the last-known settings | … `` | base 59275c8 |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Two evidence folders outside Touches (`docs/evidence/phase-7-polish/settings/`, and two PNGs + one README row in `docs/evidence/gui-v2-mockup/`). | LOW | The owner allowed the three mockup-evidence paths (`LP-CLARIFY`, 2026-11-01); the polish folder is the spec's own output folder (item 18 precedent). The PR body names both. Any other file: stop and say so (owner rule). |
| Offline pins that assert the live health text (`SettingsScreen.test.tsx:512`, `polish.test.tsx:71`, `settings.spec.ts:439` `rows()`) go red. | MEDIUM | Each is in Touches and changes to the offline form with a reason; no other expectation in those files moves. |
| The neutral ring also changes the unknown-health-word case. | LOW | Intended (one meaning of neutral, as the mockup's `idle`); the word is always beside it. Noted in the polish README. |
| The mark and the title-bar subtitle use different reach signals for a moment. | LOW | Item 18's documented gap; the mark follows the same `offline` as Reveal. |
| Regenerating mockup PNGs on another Playwright version shifts pixels in unrelated areas. | LOW | Use the README's pinned command (1.64.1); regenerate only the two `settings-unreachable` files. |
| Screenshot pixels differ between machines. | LOW | Assert behaviour (tones, text, computed background), never pixels; app PNGs only under `SETTINGS_EVIDENCE=1`. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-01-settings-health-marked-last-known-when-unreachable.md
```

## Plan Review
- **Decision:** PASS on attempt 2/3 (attempt 1 PASS with 2 MEDIUM, both fixed; the owner chose Save and exit at `LP-SAVE-NOTE`).
- **Deferred (LOW, for the worker):**
  1. The `SettingsScreen.tsx` invariant's status-0 "quote" paraphrases `useSettings.ts:5-7`; ground on the real lines.
  2. The cited-line row `phase-7-exit.spec.ts:818` note "no view, no Health row" is stale: only `GET /status` fails, a view is held, the case asserts nothing about Health (Feasibility row 5 is correct).
  3. The modify count is 11 (the map's rows), not 10 / "about 8".

## Outcome
- **Status:** completed
- **Completed:** 2026-11-01T18:31:00Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/203
- **Branch:** feature/settings-health-marked-last-known-when-unreachable
- **Files changed:** 15
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Offline Settings Health row shows a neutral ring, neutral word and a "last known" caption; live restores the ok tone. Mockup settings-unreachable changed first (D9) with its two PNGs regenerated; unit + e2e pins; polish evidence updated. Phase 4.5 code-reviewer PASS with 0 issues (pin mutations 10/12 red, rows 7–8 judged by reading); required CI green. Drain not dispatched (.auto_review false — the /automate lane owns it).

## Not verified
- **Contrast of the neutral ring (--idle on ground) in light and dark** — not in contrast.test.ts's pair table; not measured, stated in the polish README Limits (subtask 1)
- **Real app against a real kernel booted out** — only the fixture kernel was used, per the brief (subtask 1)
