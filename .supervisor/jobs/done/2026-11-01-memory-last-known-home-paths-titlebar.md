# Supervisor Job: Memory keeps last-known data under the shared band, shows `~` paths, and puts its count line in the title bar

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-01-042119/L2
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 2 (two paths outside the requirement's `## Touches` list: the polish-gate evidence folder `docs/evidence/phase-7-polish/memory/`, and `app/src/shell/frame.test.tsx`, which the owner allowed at Launch Pad on 2026-11-01; see Risk Assessment)
- **Owner sign-off (Launch Pad, 2026-11-01):** the owner chose "Allow frame.test.tsx". This item may make the one-line expected-list change in `app/src/shell/frame.test.tsx` (`no screen declares one yet` → `["memory"]`) and must call out this Touches extension in the PR body. No other file outside Touches is allowed beyond the evidence folder.
- **Source requirement:** .supervisor/requirements/phase-7/2026-11-01-090012-memory-last-known-data-home-paths-and-titlebar-line.md
- **Base commit:** daed1eab9fafe3f5429ca2d3f6efd13609bc7ada

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React + TypeScript screen in `app/src/screens/memory/`, vitest (jsdom) unit tests, Playwright Electron e2e through `app/e2e/electron-harness.ts`. No new dependency. |
| 2 | Dependency Availability | GO | Item 11 (PR #192, merged at `a5307b9`) shipped every contract this item adopts: `useKernelReach` / `withLastKnown` / `LAST_KNOWN` (`app/src/shell/last-known.ts`), `KernelBand` (`app/src/shell/KernelStates.tsx`), `formatHomePath` (`app/src/shell/home-path.ts`), `useHomeDir` (`app/src/shell/useHomeDir.ts`), the `ScreenDefinition.Subtitle` slot (`app/src/screens/types.ts`, drawn by `app/src/shell/Titlebar.tsx` as `data-testid="titlebar-subtitle"`), and the fixture kernel's `stop()` / `restart()` (`app/e2e/fixture-kernel.ts`). |
| 3 | Architecture Fit | GO | Screen-local change; the shell discovers the screen via `import.meta.glob`, so no shared list is edited. Memory stays inspectable files (invariant 8); no write path changes (non-goal). |
| 4 | Scope vs Supervisor Capability | CAUTION | 13 hand-edited files (11 MODIFY + 2 CREATE, excluding the regenerated PNGs). That is one past the `context-bound` file bound (>12 files), which permits a split but does not require one. Most edits are small (re-pointed pins, a one-line test change, a CSS rule removal, README prose), and changed lines are well under 800. Kept as a single subtask: every file serves one coherent change, and a split would put `MemoryScreen.tsx`'s holder wiring and its pins in different workers. |
| 5 | Hard Blockers | CAUTION | `ScreenDefinition.Subtitle` is a prop-less `ComponentType`, so the count line must reach the title bar through state outside `MemoryScreen` (a small module-level store). No production screen adopts `Subtitle` on `main`. The only `Subtitle:` in `app/src` is the test double `Subtitle: Count` in `app/src/shell/frame.test.tsx`, and that file pins `no screen declares one yet`, so Memory is the first adopter and must update that pin (owner-allowed). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Make the Memory screen adopt item 11's shell contract: keep its last-known data under the one shared kernel band (never a request-text error card), hand its count line to the title bar's subtitle slot, and show paths under the home folder as `~/…`.

**Problem Statement:**
The owner needs Memory to keep showing their files while the kernel restarts and to show home paths as `~/…`, because the repo is public and screenshots must not publish their user name.
Currently (phase 7 exit live run, 2026-11-01), with the kernel stopped Memory replaced its tree with an error card reading `GET /memory · no answer · not_installed`; the root and a file's Path render the absolute `/Users/<name>/.loomwright-studio/memory/…`; and the count line ("21 files") sits in Memory's own `memory-bar` band under the title instead of beside it.
Success looks like the `memory-populated`, `memory-file` and `memory-unreachable` views of `docs/design/mockups/gui-v2.html` matched in the running app, light and dark, with committed screenshots.

**Root-cause notes (grounded at base):**
- The error card comes from `MemoryFailure` (`app/src/screens/memory/MemoryViews.tsx`), drawn when `tree === undefined` and `treeError` is set; for a status-0 refusal it prints `refusalLine("GET /memory", error)` → `GET /memory · no answer · <code>`. An in-place outage already keeps the tree (`setTree((last) => (result.status === 0 ? last : …))`), so the live run's card is the case where the screen held **no tree in component state** when the kernel was unreachable — e.g. the screen was (re)mounted (navigating to Memory) after the kernel stopped. Component state dies on unmount, so last-known data must live in a module-level holder that survives remount, and a status-0 failure must never render request text.
- The count line is `MemoryFrame`'s `<div className="memory-bar"><span … data-testid="memory-subtitle">` — Memory draws its own band. The title bar already renders a screen's `Subtitle` beside the `h1`.
- The root and file Path come from `memoryRoot(dataDir)` / `fullPath(dataDir, path)` in `app/src/screens/memory/model.ts`, which never shorten home.

**Design direction (worker may refine, contracts below are binding):**
- CREATE `app/src/screens/memory/held.ts`: a module-level holder (subscribe + snapshot, read with `useSyncExternalStore`) of the last tree that answered, the last `data_dir`, and the current count-line text. `MemoryScreen` seeds its initial state from it (so a remount while unreachable draws the last-known tree, not loading/error) and writes to it on every answered read and every subtitle change. Exports `useMemorySubtitle()` (the text for the title bar) — the holder is the single home for this new responsibility, not `MemoryScreen.tsx`.
- Behaviour change, intended: once a tree has answered in this app session, a remount (connected or not) draws the held tree straight away and never the loading skeleton. While connected it carries no last-known mark and is replaced when the re-read answers; while offline it carries `· last known`. The skeleton shows only before the first answer of the session.
- `index.tsx` declares `Subtitle: MemorySubtitle` (a component in `index.tsx` rendering `useMemorySubtitle()` inside `<span data-testid={MEMORY_TEST_IDS.subtitle}>`, so the existing `memory-subtitle` test id moves into the title bar unchanged). That keeps `app/e2e/phase-7-exit.spec.ts` (outside Touches, **not edited**) passing: its `byId(page, MEMORY.subtitle)` checks still find `14 files` / `14 files · last known`, now in the title bar. `MemoryFrame` stops drawing `memory-bar`, and the `.memory-bar` / `.memory-subtitle` CSS rules go too. The subtitle strings stay what they are today (`"14 files"`, `"14 files · last known"`, `"Edit"`, `"Changed since you opened it"` …), built with `withLastKnown` from `app/src/shell/last-known.ts` instead of the local `" · last known"` literal.
- `MemoryScreen` derives `offline` from `useKernelReach(api)` (plus its own status-0 tree read), and draws `<KernelBand testId=… />` itself only when its own read got status 0 while `!reach.shellBand`, so exactly one band is ever on screen (the contract in `last-known.ts`'s header).
- `memoryRoot` / `fullPath` take the home folder (`useHomeDir(api)`) and pass the joined path through `formatHomePath`; with home unknown they show the path in full (today's behaviour). Memory has no Reveal in Finder control, so nothing there changes.

## Acceptance Criteria
- [ ] **AC1** Given Memory loaded on the fixture kernel (populated, 14 files) with `mason/lessons.md` open in the file view, when the fixture's listener stops (`fixture.stop()`), then exactly one shell band (`kernel-unreachable-band` or `kernel-reconnecting-band`) shows, the tree keeps the same file paths in the same order, the title-bar subtitle reads `14 files · last known`, every file button is `aria-disabled="true"` and Edit is disabled, and neither the empty state nor the error card (`memory-error`) is present; and when the listener restarts (`fixture.restart()`), the band goes, the subtitle reads `14 files`, and the tree is read again (the fixture's `treeReads()` count rises) — matching `memory-unreachable` (e2e in `app/e2e/memory.spec.ts`).
- [ ] **AC2** Given Memory showed data, when the screen unmounts and mounts again while the kernel does not answer (status-0 reads), then it draws the last-known tree with the `· last known` subtitle and writes off, never the loading state or the error card (unit test in `app/src/screens/memory/MemoryScreen.test.tsx`, or `held.test.ts`).
- [ ] **AC3** Given Memory in any state, then its count line is rendered in the title bar (`data-testid="titlebar-subtitle"`, beside the `h1`) and the screen draws no subtitle band of its own: no `.memory-bar` element inside `screen-memory`, and the `memory-subtitle` element is a descendant of `titlebar-subtitle`, not of `screen-memory`. The e2e asserts `titlebar-subtitle` reads `14 files` on `memory-populated` and `Edit` in the editor, and `app/e2e/phase-7-exit.spec.ts` passes unedited.
- [ ] **AC4** Given the kernel unreachable (shell band showing, or a status-0 tree read with no data held), then no request text is visible anywhere in the window: the page text contains none of `GET /memory`, `GET /memory/file`, `no answer`, `not_installed`, `daemon_not_running`, `connection_failed`. A route failure with a non-zero status (e.g. `500 store_unreadable`) still shows its existing error card naming the request and status (unchanged behaviour, existing pins keep passing).
- [ ] **AC5** Given a `data_dir` under the home folder (the e2e overrides `GET /settings` so `data_dir` is `<os.homedir()>/.loomwright-studio`; the app's `homeDir` answers the same home), then the memory root reads `~/.loomwright-studio/memory/` and a file's Path reads `~/.loomwright-studio/memory/mason/lessons.md`, matching `memory-populated` and `memory-file`; and given a `data_dir` outside home (`/fixture/studio-data`) or home unknown, the root and Path read in full (unit tests in `model.test.ts` for `memoryRoot`/`fullPath` with and without home, including a sibling-prefix home such as `/Users/o` vs `/Users/o2`).
- [ ] **AC6** Given a file open, when the owner clicks Edit and then Cancel without typing, then no `PUT /memory/file` reached the fixture (`fx.puts` is empty), and the file view returns with the same text, version and Path as before Edit, with focus on Edit (e2e).
- [ ] **AC7** Given the polish gate, then a committed evidence file `docs/evidence/phase-7-polish/memory/README.md` names each regenerated screenshot (`memory-populated`, `memory-file`, `memory-unreachable`, light and dark, taken from the running app via `app/e2e/electron-harness.ts` with `MEMORY_EVIDENCE=1`) against its `gui-v2.html` view, its prose updated to say the root and Path read `~/…` and the count sits in the title bar, and the PR body links to it. The folder still holds exactly the README and the 16 screenshots (the existing AC13 pins).
- [ ] **AC8** Validation passes: `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`, and `bash scripts/check-docs.sh`.

## House Rules
> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

## File Impact Map

| Path | Action | Lines at base | Confidence | Why |
|------|--------|---------------|------------|-----|
| `app/src/screens/memory/held.ts` | CREATE | — | HIGH | Home for the new responsibility: last-known tree/data_dir + subtitle text that survive remount and reach the title bar |
| `app/src/screens/memory/held.test.ts` | CREATE | — | HIGH | Unit pins for the holder |
| `app/src/screens/memory/index.tsx` | MODIFY | 26 | HIGH | Declare `Subtitle: MemorySubtitle` |
| `app/src/screens/memory/MemoryScreen.tsx` | MODIFY | 453 | HIGH | `useKernelReach`, `useHomeDir`, seed from/write to the holder, own `KernelBand` when `!shellBand`, `withLastKnown` |
| `app/src/screens/memory/MemoryViews.tsx` | MODIFY | 510 | HIGH | `MemoryFrame` drops `memory-bar`; status-0 failure/read lines without request text; paths take home |
| `app/src/screens/memory/model.ts` | MODIFY | 407 | HIGH | `memoryRoot` / `fullPath` take `home` and use `formatHomePath` |
| `app/src/screens/memory/memory.css` | MODIFY | 514 | HIGH | Remove `.memory-bar` / `.memory-subtitle` rules |
| `app/src/screens/memory/MemoryScreen.test.tsx` | MODIFY | 899 | HIGH | Re-point subtitle pins to the holder/title bar; status-0 pins assert no request text; remount pin (AC2) |
| `app/src/screens/memory/model.test.ts` | MODIFY | 378 | HIGH | `~` path pins (AC5) |
| `app/src/screens/memory/contrast.test.ts` | MODIFY | 130 | HIGH | Delete the `[".memory-subtitle", "ink-tertiary", "ground", "the count line in the bar"]` row, because its rule leaves memory.css |
| `app/src/shell/frame.test.tsx` | MODIFY (owner-allowed, outside Touches) | 315 | HIGH | One line: `no screen declares one yet` expected list `[]` → `["memory"]`. Retitling the `it(...)` to match is allowed; nothing else in the file changes |
| `app/e2e/memory.spec.ts` | MODIFY | 584 | HIGH | `stop()`/`restart()` AC1, title-bar subtitle AC3, no request text AC4, home `data_dir` via a `GET /settings` route override AC5, Edit→Cancel AC6, screenshots |
| `docs/evidence/phase-7-polish/memory/README.md` | MODIFY | 82 | MEDIUM | AC7 prose for the three changed views |
| `docs/evidence/phase-7-polish/memory/memory-{populated,file,unreachable}-{light,dark}.png` | MODIFY (regenerated) | binary | MEDIUM | AC7; regenerate only these six (the other ten views' look changes only by the band moving, so regenerating all 16 with `MEMORY_EVIDENCE=1` is acceptable and keeps the set coherent) |

**Not touched:** `app/e2e/phase-7-exit.spec.ts` (kept green by the unchanged `memory-subtitle` test id), `app/e2e/fixtures/memory.ts`, `app/e2e/fixture-kernel.ts`, every `app/src/shell/*` file except `frame.test.tsx`, `app/src/App.tsx` — the home `data_dir` comes from a `routes: { "GET /settings": … }` override passed in `memory.spec.ts` (the fixture merges `routes` over its defaults, `app/e2e/fixture-kernel.ts` `FixtureKernelOptions.routes`). If the worker finds it needs any of these, it stops and says so (owner decision "Nothing is patched outside an item's Touches").

**Module layout:** every new responsibility (last-known holder, title-bar subtitle source) gets its own CREATE module, `held.ts`; `MemoryScreen.tsx` (453) and `MemoryViews.tsx` (510) only rewire to it. Tests count like source: the holder's pins go in the new `held.test.ts`, not in the 899-line `MemoryScreen.test.tsx` (which only re-points existing pins and adds the AC2 remount case).

## Touched-file invariants

> Grounded at base `daed1eab9fafe3f5429ca2d3f6efd13609bc7ada`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/screens/memory/MemoryScreen.tsx`** — keep: a read nobody answered never replaces data on screen: `A read the kernel did not answer (or refused) never replaces what is on screen.`; keep the draft through any outage or refetch (`A draft is never replaced: while one exists the read is dropped.`); reuse: `useKernelReach` and `withLastKnown` from `app/src/shell/last-known.ts` (`export function withLastKnown(line: string, offline: boolean): string`) instead of the local `const lastKnown = offline ? " · last known" : "";`; mirror: one band on screen — draw `KernelBand` only under `!shellBand`, per `last-known.ts` (`draws \`<KernelBand testId=... />\` itself, but only when \`!shellBand\``); pinned by: `app/src/screens/memory/MemoryScreen.test.tsx` (`"6 files · last known"`).
- **`app/src/screens/memory/MemoryViews.tsx`** — keep: kernel strings are text, never markup (`Every string from the kernel (a path, a file name, a refusal's code, a file's text) is`); keep the non-zero-status failure card naming the request (`The kernel answered, but the memory request failed.`); reuse: `KernelBand` from `app/src/shell/KernelStates.tsx` (no prop that holds text) rather than any new band; pinned by: `MemoryScreen.test.tsx` (`"GET /memory · 500 · store_unreadable"`).
- **`app/src/screens/memory/model.ts`** — keep: `printable(...)` on every kernel-supplied path (`printable(dataDir)`); reuse: `formatHomePath` from `app/src/shell/home-path.ts` (`export function formatHomePath(path: string, home: string | undefined): string`) — no local `~` logic; keep `memoryRoot(undefined)` → `"memory/"`; pinned by: `app/src/screens/memory/model.test.ts`.
- **`app/src/screens/memory/memory.css`** — keep: every colour from design tokens (pinned by `app/src/screens/memory/contrast.test.ts`: `var(--${fg})`, and the e2e `AC12: the screen's stylesheet takes every colour from the design tokens`); removing `.memory-subtitle` requires deleting its row in the contrast test's `TEXT` list, because that test asserts each listed selector exists (`is a rule of memory.css`).
- **`app/src/screens/memory/MemoryScreen.test.tsx`** — keep: every non-subtitle pin, including the non-zero-status card (`"GET /memory · 500 · store_unreadable"`) and `"GET /memory · 200 · invalid_response"`; the status-0 pin that today expects `"GET /memory · no answer · daemon_not_running"` flips to assert that no request text is shown (AC4). Every test that mounts the screen calls `resetHeldMemory()` in `afterEach`, so the holder never leaks between tests; subtitle pins read the holder or title bar, not `memory-subtitle` inside `screen-memory`.
- **`app/src/screens/memory/model.test.ts`** — keep: `memoryRoot(undefined)` → `"memory/"` (`expect(text(IDS.root)).toBe("memory/")` in the screen test, and the model's own no-data-dir case), and the `refusalLine` pins unchanged, because `refusalLine` itself does not change; it is only no longer rendered for status 0. Add `~` cases with home set, home unset, and a sibling-prefix home.
- **`app/src/screens/memory/contrast.test.ts`** — keep: every other `TEXT` row and the token assertions (`is a rule of memory.css`); only the `".memory-subtitle"` row goes.
- **`app/src/shell/frame.test.tsx`** (owner-allowed, outside Touches) — keep: every other pin in the file, including the title-alone case (`expect(screen.queryByTestId("titlebar-subtitle")).toBeNull();` for a screen without one); change only `no screen declares one yet`'s expected list to `["memory"]`.
- **`app/e2e/phase-7-exit.spec.ts`** (not edited) — mirror: it reads `MEMORY.subtitle` (`await expect(byId(page, MEMORY.subtitle)).toHaveText("14 files");` and `"14 files · last known"`), so `MEMORY_TEST_IDS.subtitle` keeps the value `"memory-subtitle"` and the title-bar span carries it.
- **`app/src/screens/memory/index.tsx`** — keep: the shell discovers it (`import.meta.glob("./screens/*/index.tsx")`), its one export stays `export const screen: ScreenDefinition`; mirror: `Subtitle` is a prop-less `ComponentType` (`readonly Subtitle?: ComponentType;` in `app/src/screens/types.ts`), drawn by `app/src/shell/Titlebar.tsx` under `data-testid="titlebar-subtitle"`.
- **`app/e2e/memory.spec.ts`** — keep: launch only via the harness (`import { launchApp } from "./electron-harness";`, house rule above); keep the evidence guard (`process.env.MEMORY_EVIDENCE === "1"`) and the folder pin (`lists exactly the 16 screenshots`); the afterEach page-error drain (`the window logged no uncaught page errors`); assert behaviour, never pixels.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/e2e/memory.spec.ts` — AC3 `titlebar-subtitle` reads `14 files` | delete `Subtitle: MemorySubtitle,` in `app/src/screens/memory/index.tsx` |
| `app/src/screens/memory/model.test.ts` — root reads `~/.loomwright-studio/memory/` with home set | replace the `formatHomePath(` call in `memoryRoot` (`app/src/screens/memory/model.ts`) with its first argument (reviewer-applied) |
| `app/src/screens/memory/MemoryScreen.test.tsx` — status-0 tree failure shows no `no answer` / code text | render `refusalLine("GET /memory", error)` for a status-0 error again in `MemoryFailure` (`app/src/screens/memory/MemoryViews.tsx`) (reviewer-applied) |
| `app/src/screens/memory/MemoryScreen.test.tsx` (or `held.test.ts`) — AC2 remount while unreachable draws the last-known tree | drop the holder seed: initialise `tree` state to `undefined` instead of the held tree in `MemoryScreen.tsx` (reviewer-applied) |
| `app/e2e/memory.spec.ts` — AC1 band clears and subtitle returns to `14 files` after `fixture.restart()` | make `MemoryScreen` ignore `connection.state` in its refetch mark (`feedMark`) (reviewer-applied) |
| `app/src/screens/memory/model.test.ts` — `fullPath` reads `~/.loomwright-studio/memory/mason/lessons.md` with home set | make `fullPath` (`app/src/screens/memory/model.ts`) join onto the un-shortened root instead of the `formatHomePath` result (reviewer-applied) |
| `app/e2e/memory.spec.ts` — AC5 root and file Path read `~/.loomwright-studio/…` | pass `undefined` instead of `useHomeDir(api)`'s answer as the home in `MemoryScreen.tsx` (reviewer-applied) |
| `app/e2e/memory.spec.ts` — AC4 page text holds no `GET /memory` / `no answer` / connection code | same mutation as the `MemoryFailure` row above: render `refusalLine(...)` for a status-0 error (reviewer-applied) |
| `app/e2e/memory.spec.ts` — AC6 Edit→Cancel writes nothing and returns focus to Edit | in `leaveEditor` (`MemoryScreen.tsx`), flip the focus target `IDS.edit` → `IDS.textarea` (reviewer-applied) |
| `app/src/screens/memory/MemoryScreen.test.tsx` — re-pointed subtitle pins (`"6 files · last known"`, `"Edit · last known"`, `"Changed since you opened it · last known"` and their live forms) | pass `false` instead of `offline` to `withLastKnown` in `MemoryScreen.tsx` (reviewer-applied) |
| `app/src/screens/memory/MemoryScreen.test.tsx` / `app/e2e/memory.spec.ts` — AC3 no `.memory-bar` inside `screen-memory`, `memory-subtitle` not a descendant of `screen-memory` | restore `<div className="memory-bar">` with the subtitle span in `MemoryFrame` (`MemoryViews.tsx`) (reviewer-applied) |
| `app/src/screens/memory/MemoryScreen.test.tsx` — AC4 status-0 file read shows no `GET /memory/file` / `no answer` text | render `refusalLine("GET /memory/file", readError)` again for a status-0 `readError` in `FileView` (`MemoryViews.tsx`) (reviewer-applied) |
| `app/src/shell/frame.test.tsx` — `no screen declares one yet` now expects `["memory"]` | delete `Subtitle: MemorySubtitle,` in `app/src/screens/memory/index.tsx` |
| `app/e2e/phase-7-exit.spec.ts` (unedited) — `MEMORY.subtitle` reads `14 files` | drop `data-testid={MEMORY_TEST_IDS.subtitle}` from `MemorySubtitle`'s span in `app/src/screens/memory/index.tsx` (reviewer-applied) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Memory adopts the shell contract: last-known holder, title-bar subtitle, `~` paths, e2e + evidence | all | 11 modify (+ regenerated PNGs), 2 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 — Memory adopts the shell contract (LAUNCHABLE)
provides:
  - {kind: "file", path: "app/src/screens/memory/held.ts"}
  - {kind: "symbol", path: "app/src/screens/memory/held.ts", name: "useMemorySubtitle"}
  - {kind: "file", path: "app/src/screens/memory/held.test.ts"}
  - {kind: "symbol", path: "app/src/screens/memory/index.tsx", name: "MemorySubtitle"}
  - {kind: "symbol", path: "app/src/screens/memory/held.ts", name: "resetHeldMemory"}
  - {kind: "symbol", path: "app/src/screens/memory/model.ts", name: "memoryRoot"}
  - {kind: "symbol", path: "app/src/screens/memory/model.ts", name: "fullPath"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/memory/README.md"}
requires: []
lanes:
  - "app/src/screens/memory/**"
  - "app/e2e/memory.spec.ts"
  - "app/src/shell/frame.test.tsx"
  - "docs/evidence/phase-7-polish/memory/**"
external_requires:
  - "Item 11 shell contract merged on main (PR #192): app/src/shell/last-known.ts, home-path.ts, useHomeDir.ts, KernelStates.tsx, Titlebar.tsx, fixture-kernel stop()/restart()"
  - "Electron + Playwright e2e runnable locally (npm run build, then npm run e2e)"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): `Subtitle` is prop-less, so the count line must leave `MemoryScreen` through module state; a module-level holder leaks between unit tests | MEDIUM | `held.ts` exports `resetHeldMemory()` for tests (called in `afterEach`), and subscribers use `useSyncExternalStore` so the title bar re-renders on change |
| Feasibility (Phase 2.5): 13 hand-edited files, one past the `context-bound` file bound | MEDIUM | Most edits are mechanical (re-pointed pins, one test line, one CSS removal); the worker keeps the change inside the listed paths and stops if more are needed |
| `app/src/shell/frame.test.tsx` is outside Touches (owner-allowed 2026-11-01). Items 14–18 (Tasks, Playbooks, Schedules, Budget & audit, Settings) each adopt the subtitle slot in parallel lanes and will edit the same expected-list line | MEDIUM | Change only that one line. The PR body names the Touches extension and the owner's sign-off. A later lane resolves the trivial conflict by merging the id lists |
| `app/e2e/shell.spec.ts` (outside Touches) has the comment `no screen declares a count line yet`, which goes stale (its check runs on Integrations and stays green) | LOW | Do not edit it. Name it in the PR body as a stale comment for a later item |
| `app/e2e/phase-7-exit.spec.ts` (outside Touches) reads `MEMORY.subtitle` | MEDIUM | Keep `MEMORY_TEST_IDS.subtitle` = `"memory-subtitle"` on the title-bar span, so the spec passes unedited. If it does not, stop and report rather than editing it |
| Feasibility (Phase 2.5): first adopter of `ScreenDefinition.Subtitle`; a defect in `Titlebar` would surface here | LOW | `Titlebar` is pinned by `app/src/shell/frame.test.tsx`; if it misbehaves, stop and report (shell files are outside Touches) |
| Evidence folder `docs/evidence/phase-7-polish/memory/` is outside the requirement's `## Touches` list, but Scope 3 / AC7 requires committing screenshots there and the existing AC13 e2e pins that folder | MEDIUM | Treat it as part of the item's own evidence (item 11 did the same for `shell/`); touch only the README and the PNGs in that folder; say so in the PR body |
| Live-run root cause is inferred (no tree in component state when the kernel was unreachable, most likely a remount), not reproduced | MEDIUM | AC2 pins the remount path and AC4 pins "no request text" for the no-data status-0 path, so either cause is covered |
| Home path in the e2e depends on Electron's `app.getPath("home")` matching the test process's `os.homedir()` | LOW | Both read the same `HOME`; the e2e asserts the root text, so a mismatch fails loudly rather than silently showing the full path |
| Screenshots differ between macOS and CI fonts | LOW | The spec asserts behaviour, never pixels (existing convention); screenshots are evidence only |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-01-memory-last-known-home-paths-titlebar.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-01T09:48:34Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/196
- **Branch:** feature/memory-last-known-home-paths-titlebar
- **Files changed:** 29
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Memory keeps its last-known tree and data_dir in a module holder (held.ts) that survives remount, puts its count line in the title bar via ScreenDefinition.Subtitle, shows ~/… paths, and never shows request text on a status-0 read. Typecheck, 2479 unit, build, 243/243 e2e, check-docs green. Phase 4.5 code review PASS on the first pass (2 LOW + 1 nit dismissed below the MEDIUM floor). Preflight OVERLAP with open PR #194 on app/src/shell/frame.test.tsx, and the owner chose proceed-anyway.

## Not verified
- **Real kernel (not the fixture) stopping while Memory is open, and a remount in the packaged app** — only the fixture kernel's stop/restart in Electron e2e and jsdom were run; the live phase-7 failure was not reproduced (subtask 1)
- **CI Ubuntu rendering and the screenshots' fonts** — run on macOS only (subtask 1)
