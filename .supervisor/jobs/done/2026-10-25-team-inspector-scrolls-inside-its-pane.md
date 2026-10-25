# Supervisor Job: The Team inspector scrolls inside its own pane, and the window never scrolls

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-24-064605/L10
- **CLAUDE.md:** ✓ Found (fresh; its `kernel/` + `docs/` description predates `app/`, nothing it states is contradicted)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-24-115028-the-team-inspector-scrolls-inside-its-pane.md
- **Base commit:** 9137fb39a4fe7028af13e1504e622bf139b09f5c
- **Depends on:** 2026-10-24-115026-crew-members-are-told-apart-on-screen.md — merged (PR #132, in base)

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | App-only CSS + e2e change: React 19, strict TypeScript, Playwright Electron e2e through `app/e2e/electron-harness.ts`. |
| 2 | Dependency Availability | GO | No new dependency, no kernel or contract change. The layout tokens exist: `--titlebar-height: 52px`, `--sidebar-width: 240px`, `--inspector-width: 320px` (`app/src/styles/tokens.css:105-107`). |
| 3 | Architecture Fit | GO | The shell layout lives in `app/src/App.tsx` (`.window` > `aside.sidebar` + `main.main` > `header.titlebar` + `div.content`) and `app/src/styles/app.css`. The requirement's Touches names `app/src/shell/`, but that directory holds only `KernelStates.tsx` (the bands); the fix belongs in `app.css`. `App.tsx` needs no change. Chat's and Sessions' stylesheets carry screen-local workarounds for the same gap, and those are retired here (step 2b). |
| 4 | Scope vs Supervisor Capability | GO | One concern (the window's scroll containment), ~8 small files (mostly CSS and evidence docs), one subtask. No split reason fires. |
| 5 | Hard Blockers | CAUTION | The e2e windows are hidden (`launchApp` sets `HIDDEN_WINDOW_ENV`). There's prior art for a wheel in a hidden window. `app/e2e/components.conversation.spec.ts:267-269` hovers a log, calls `page.mouse.wheel(0, -600)` and sees the pill change in a `launchGallery` window. That run used the gallery window, not the app window, so AC1 keeps a fallback. See Risk Assessment. |

**Overall Verdict:** CAUTION (check 5; carried into Risk Assessment)

## Task

**Goal:** Scrolling a long Team inspector scrolls only the inspector. The sidebar, the title bar and the cards stay where they are. On every screen the document's scroll position stays 0, and the document cannot scroll at all.

**Problem Statement:**
In the phase 5 live exit run, the owner scrolled a crew member's Team inspector to reach Turn off, and the whole window scrolled. The sidebar and the Team header scrolled out of view, content slid under the traffic lights, and the page stayed shifted after the inspector was back at its top. The approved layout (`docs/design/brand-book.md` §Layout) has a fixed 240px sidebar, a 52px title bar and a 320px inspector.

**Root cause (HIGH confidence; two earlier lanes already found it, and the worker still confirms it in the running app before fixing):** the inspector already has `overflow: auto; min-height: 0` (`.team-insp`, `app/src/screens/team/team.css:126-136`), and so does `.content` (`app.css`). The shell grid above them doesn't clamp, though. `.window` (`display: grid; grid-template-columns: var(--sidebar-width) 1fr; height: 100%`) has one implicit `auto` row. Its grid item `.main` (`display: grid; grid-template-rows: var(--titlebar-height) 1fr; min-width: 0`) keeps `min-height: auto`. So `.main`, and with it the `.window` row, grows to the screen's full content height, the document becomes taller than the viewport, and `<html>` is the thing that scrolls. Wheel input chains from the inspector to the document, and focusing Turn off scrolls the document to reveal it. Prior evidence:
- `app/src/screens/chat/chat.css:3-17` and `app/src/screens/sessions/sessions.css:2-17` both open with "The shell's `.window` row is `auto`, so `.main` grows with its content and `.content` never scrolls (app.css, outside this screen …)". Each holds its own screen to the window with `.main:has(.chat|.sessions) { min-height: 0; overflow: hidden; }` plus a `.content:has(> .chat|.sessions)` flex column.
- `docs/evidence/phase-5-polish/chat/README.md:44` names the proper fix: "`min-height: 0` (or `grid-template-rows: 100%`) in `app/src/styles/app.css`, which this item may not edit."
- `docs/evidence/phase-5-polish/sessions/README.md:61` says the same: "The real fix is a bounded row in `app.css` (item 01's file); once it lands, both screens' `:has()` rules can go."

Team never had such a workaround. That's why its inspector is where the owner hit the problem. On base, AC2 is expected to pass on Chat and Sessions (their `:has()` rules) and fail on Team.

Do this:

1. **Confirm the cause first (red before green).** Write the AC1 and AC2 e2e tests below. Build the app and run them on the unmodified base. Record which assertions fail and the measured `document.scrollingElement.scrollHeight` / `clientHeight` and `.main` height against the 760px window. The worker records these in the evidence README (AC3). If the base passes AC1 and AC2, the hypothesis is wrong. In that case, find the actual mechanism in the running app, for example a programmatic scroll of an `overflow: hidden` ancestor by `scrollIntoView` or focus. Record it in the README and fix that instead. Never weaken the tests to pass.
2. **Fix it at the shell (Scope 1).** In `app/src/styles/app.css`, give the shell's grid tracks a zero minimum, so the window and its columns can't grow past the viewport. The candidates are `.window` with `grid-template-rows: minmax(0, 1fr);` and `.main` with `grid-template-rows: var(--titlebar-height) minmax(0, 1fr);` / `min-height: 0;`. By the grid sizing rules, either set probably bounds the shell on its own, so find the **minimal** fix on the built app. Apply the candidates, then remove each one in turn and rebuild. A declaration whose removal keeps AC1/AC2 (and the step 2b pins) green is redundant and gets dropped. Prefer keeping `.window`'s `grid-template-rows: minmax(0, 1fr);`, which bounds the row every screen sits in, and add `.main`'s declarations only if removing them turns a test red. Record the ablation (what was removed, green/red) in the team README's root-cause note. Each kept declaration goes on its own line. Add no new class selector to `app.css`; `Toast.test.tsx` pins that no component stylesheet shares a class with it. Don't put `overflow: hidden` on `html` / `body` / `#root` / `.window` as the fix. It hides the symptom, and the document can still be scrolled programmatically. The root cause is the track sizing. Every width and height stays a token, and no raw values are added. Don't add `overscroll-behavior` either: once the document can't scroll there is nothing to chain to, so no test could pin it.
2b. **Remove the screen-local workarounds now that the shell owns containment.** Delete `.main:has(.chat) { min-height: 0; overflow: hidden; }` from `chat.css` and `.main:has(.sessions) { … }` from `sessions.css`. Keep `.content:has(> .chat)` / `.content:has(> .sessions)`: their flex column is what lets `.chat` / `.sessions` (`flex: 1`) fill the pane under a kernel band, and that's layout, not a workaround. Rewrite the two header comments to say the shell now bounds `.main` (`app.css`) and that this rule only lays out the band and the screen column. Add one line to each finding (`chat/README.md:44` and `sessions/README.md:61`) saying the shell gap is closed by this item and the `.main:has()` rules are gone. The existing pins then cover the shell fix: `app/e2e/sessions.spec.ts:270` ("the log does not scroll: it is not bounded by the pane") and the Chat e2e's composer-in-view checks. AC4's `npm run e2e` runs them.
3. **Keep the actions reachable (Scope 2).** Keep Open thread and Turn off in the inspector's scrolled content. Don't pin them to a footer, because pinning changes what covers the content, and the item's non-goal is changing the inspector's content. They must stay reachable by keyboard. Tab reaches Turn off, and reaching it scrolls the inspector, not the document (AC1). `.team-insp-actions { margin-top: auto }` stays as it is.
4. **Smoke-test every screen (Risk: a shell fix affects all screens).** AC2 visits each screen, and the worker looks at the existing evidence screenshots' states again (Chat, Sessions, Approvals, Team, the menu-bar panel) after the fix. A screen whose content now clips where it used to grow (as opposed to scrolling inside its own pane) is a finding to fix in that screen's own scroll container, or to list under "Not verified" if it's out of scope.

Non-goals: changing the inspector's content or order; pinning the actions to a footer; any kernel, `app/src/api/contract.ts` or `app/src/components/**` change; the existing `.content` scroll when a kernel band sits above a `height: 100%` screen (that scroll is inside `.content` and never moves the sidebar or title bar).

## Acceptance Criteria

- [ ] **AC1 — a long inspector scrolls alone.** In `app/e2e/team.spec.ts`, a new test opens Team on `teamFixture()`, clicks Mason's card and waits for the inspector heading. Precondition (so the test isn't vacuous): the inspector's `scrollHeight` exceeds its `clientHeight` by at least 100px. Judge this precondition, and whether a long variant is needed, **on the fixed build**. On base the shell grows to fit the inspector, so the precondition itself may be what fails there; step 1 records that together with the measured document `scrollHeight`. If on the fixed build the default fixture's Mason is not that long at the 760px window, add an opt-in `teamFixture({ longInspector: true })` variant that lengthens only Mason's charter duties, and leave the default roster and every existing test unchanged. Before scrolling, the test records the bounding boxes of `getByTestId("sidebar")`, the `header.titlebar` (`page.locator(".titlebar")`) and Wright's Team card. Then it (a) moves the mouse over the inspector and scrolls the wheel down well past the inspector's end (`page.mouse.wheel(0, 4000)` in steps, then `settle`). Then the inspector's `scrollTop` is > 0, `document.scrollingElement.scrollTop` is 0, and all three boxes are equal to the recorded ones (x, y, width, height). (b) It scrolls the wheel back up past the top. Then the inspector's `scrollTop` is 0, the document's is 0, and the three boxes are still equal (the live run's "stayed shifted" case). (c) It resets the inspector to the top, focuses the inspector heading, and calls `tabTo(page, inspector.getByRole("button", { name: "Turn off" }), "Turn off")`. Turn off is focused and inside the inspector's visible rect, the document's `scrollTop` is 0, and the three boxes are unchanged. Then `screenshots(page, "inspector-scrolled", testInfo)`. If a wheel doesn't scroll the hidden window (the inspector's `scrollTop` stays 0 after (a) on the fixed build), the worker replaces only step (a)'s input with `inspector.evaluate((el) => el.scrollBy(0, el.scrollHeight))`, keeps (b) and (c), and records the substitution in the README.
- [ ] **AC2 — the document never scrolls, on any screen.** In `app/e2e/team.spec.ts`, a new test launches on `teamFixture()` and, for every screen id in the shell (`chat`, `team`, `approvals`, `sessions`, `menubar`, each through `window.location.hash = "#/<id>"`), and again on Team with Mason's inspector open, waits for the screen to render and then asserts four things. `document.scrollingElement.scrollTop === 0` and `window.scrollY === 0`. `document.scrollingElement.scrollHeight <= document.scrollingElement.clientHeight`, so the document has nothing to scroll. That pins the root cause, not just today's position. And after `window.scrollTo(0, 500)`, `window.scrollY` is still 0. It also asserts that `#root` and `.window` each have `scrollTop === 0` and `scrollHeight <= clientHeight`. Each case's assertions use `expect.soft` with a message naming the screen, so one run records every case, then a hard `expect` at the end fails if any soft one did. On the unmodified base, the Team-with-inspector case must fail (step 1's red run). Chat and Sessions are expected to pass on base because of their `:has()` rules.
- [ ] **AC3 — polish-gate screenshots in a committed evidence file.** With `TEAM_EVIDENCE=1` the worker commits `docs/evidence/phase-5-polish/team/team-inspector-scrolled-light.png` and `team-inspector-scrolled-dark.png` (Mason's inspector scrolled to Turn off, with the sidebar, title bar and cards in place). The worker updates `docs/evidence/phase-5-polish/team/README.md` in four places. A row in the Screenshots table for the new pair. Rows in "What the spec proves" for AC1 and AC2. The measured root cause from step 1: which assertions failed on base, with the measured heights, and the declaration that fixed it. A row in the mutation table recording the pin mutation below and its failure message. The PR body links that README.
- [ ] **AC4 — validation.** `cd app && npm ci && npm run typecheck && npm test && npm run build` passes. After the build, `cd app && npx playwright test e2e/team.spec.ts --workers=1` passes, and so does `cd app && npm run e2e` (every spec, as the smoke-test of the shell fix across screens).

## File Impact Map

| File | Action | Confidence | Why |
|------|--------|------------|-----|
| `app/src/styles/app.css` | modify | HIGH | The shell's `.window` / `.main` track minimums (Scope 1). The step 1 red run confirms the exact declarations. |
| `app/src/screens/chat/chat.css` | modify | HIGH | Step 2b: drop `.main:has(.chat)`, rewrite the header comment. |
| `app/src/screens/sessions/sessions.css` | modify | HIGH | Step 2b: drop `.main:has(.sessions)`, rewrite the header comment. |
| `app/e2e/team.spec.ts` | modify | HIGH | AC1 and AC2 tests; the `inspector-scrolled` screenshots. |
| `docs/evidence/phase-5-polish/chat/README.md` | modify | HIGH | Step 2b: the line-44 finding gets "closed by this item". |
| `docs/evidence/phase-5-polish/sessions/README.md` | modify | HIGH | Step 2b: the line-61 finding gets "closed by this item". |
| `app/e2e/fixtures/team.ts` | modify | LOW | Only if Mason's inspector doesn't overflow at 760px: the opt-in `longInspector` variant. |
| `docs/evidence/phase-5-polish/team/README.md` | modify | HIGH | AC3 rows, root cause, mutation row. |
| `docs/evidence/phase-5-polish/team/team-inspector-scrolled-light.png` | create | HIGH | AC3 screenshot (light). |
| `docs/evidence/phase-5-polish/team/team-inspector-scrolled-dark.png` | create | HIGH | AC3 screenshot (dark). |

Verified unaffected: `app/src/screens/team/team.css` (`.team-insp` already scrolls: `overflow: auto; min-height: 0`; it only needs a bounded parent); `app/src/screens/team/Inspector.tsx` (the actions stay in the scrolled content, and its markup is unchanged); `app/src/App.tsx` (the class structure the CSS targets is unchanged); `app/src/shell/KernelStates.tsx` (the bands only).

### File Overlap Detection
Single subtask; no overlap.

## Touched-file invariants

> Grounded at base `9137fb3`. The worker re-checks these before hand-back.

- **`app/src/styles/app.css`** — keep: "Every width is a token" (line 1 comment), so new rules use `var(--titlebar-height)` / `var(--sidebar-width)` and no raw pixel sizes; `html, body, #root { height: 100%; margin: 0; }`; the `:focus-visible` ring (`outline: 2px solid var(--focus)`). Never add `outline: none`. Keep `.sidebar-titlebar` and `.titlebar` `-webkit-app-region: drag`, and `.content { min-height: 0; overflow: auto; }`. pinned by: `app/src/components/Toast/Toast.test.tsx:542-557` (`%s.css shares no class with app.css`, which reads `../../styles/app.css`), so add no new class selector. The component galleries also load `app.css` (`app/e2e/components.primitives.spec.ts:89`, `components.conversation.spec.ts:68`, `app/src/components/CommandPalette/gallery.tsx:10`) and run under AC4's `npm run e2e`.
- **`app/src/screens/chat/chat.css`, `app/src/screens/sessions/sessions.css`** — keep: `.content:has(> .chat)` / `.content:has(> .sessions)` (`display: flex; flex-direction: column; overflow: hidden;`) and `.chat` / `.sessions` (`flex: 1; min-height: 0`), so the band sits above a filling column; "Tokens only" / "Colour … come only from tokens.css". pinned by: `app/e2e/sessions.spec.ts:270` (the log is bounded by the pane) and the Chat e2e (`app/e2e/chat.spec.ts`, the composer `Message Wright` stays usable).
- **`app/e2e/team.spec.ts`, `app/e2e/fixtures/team.ts`** — keep: every launch through `launchApp` / `launchGallery`, never `electron.launch` or `new BrowserWindow` (the house rule; `app/scripts/hidden-windows.test.ts`). Screenshots go only through `screenshots()`, and only to the evidence dir with `TEAM_EVIDENCE=1`. The spec asserts behaviour, never pixels. Fixture data stays under `/srv/studio-fixture`. The default roster and existing tests stay unchanged, and any long variant is opt-in. `afterEach`'s "no uncaught page errors" stays.

## Pin mutations

| Pin | Mutation (applied to the code the pin protects) |
|-----|-------------------------------------------------|
| `app/e2e/team.spec.ts` — AC1 (boxes unchanged, document `scrollTop` 0) and AC2 (Team with inspector: document `scrollHeight <= clientHeight`) | revert `app/src/styles/app.css` to base (`git checkout 9137fb3 -- app/src/styles/app.css`), rebuild, run the spec. AC1 and AC2 must fail. This is the same run as step 1's red-first check, so it's recorded once. |
| `app/e2e/team.spec.ts` — AC1/AC2, the kept declaration(s) | delete exactly the declaration(s) step 2's ablation kept (expected: `grid-template-rows: minmax(0, 1fr);` in `.window` in `app/src/styles/app.css`). Because the ablation dropped every redundant declaration, deleting the kept one(s) must turn AC1/AC2 red. The ablation's own red runs are this mutation, so the worker records them once in the README mutation table and doesn't run them separately. |
| `app/e2e/sessions.spec.ts:270` — the log is bounded by the pane (now that `.main:has(.sessions)` is gone) | the same `app.css` revert as row 1, with step 2b applied. `sessions.spec.ts` AC2 must fail with "the log does not scroll: it is not bounded by the pane". The worker records it in the same README row. |

The e2e is the pin. jsdom does no layout, so no unit test can pin track sizing.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Shell scroll containment, inspector scrolls alone, document never scrolls; screenshots | AC1, AC2, AC3, AC4 | 7–8 modify, 2 create | `skills/frontend-ui/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "docs/evidence/phase-5-polish/team/team-inspector-scrolled-light.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/team/team-inspector-scrolled-dark.png"}
requires: []
lanes:
  - "app/src/styles/app.css"
  - "app/src/screens/chat/chat.css"
  - "app/src/screens/sessions/sessions.css"
  - "app/e2e/team.spec.ts"
  - "app/e2e/fixtures/team.ts"
  - "docs/evidence/phase-5-polish/team/README.md"
  - "docs/evidence/phase-5-polish/chat/README.md"
  - "docs/evidence/phase-5-polish/sessions/README.md"
  - "docs/evidence/phase-5-polish/team/team-inspector-scrolled-light.png"
  - "docs/evidence/phase-5-polish/team/team-inspector-scrolled-dark.png"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
1 (no dependencies)

### File Overlap Matrix
Single subtask; none.

### Batch Plan
- single-agent (no fan-out): Batch 1 = subtask 1
- **Recommended workers:** 1

## Skill References
- `skills/frontend-ui/SKILL.md` — layout tokens only, focus ring kept, keyboard reachability
- `skills/playwright-e2e/SKILL.md` — the fixture-kernel spec, wheel input, screenshots

## House Rules
- (advisory) E2E specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts` enforces it). AC1/AC2 comply.

## Risk Assessment

| Risk | Severity | Source | Mitigation |
|------|----------|--------|------------|
| `page.mouse.wheel` may not scroll the hidden app window (it does scroll a hidden gallery window: `components.conversation.spec.ts:267-269`). | LOW | Feasibility (Phase 2.5) | AC1 names the fallback (programmatic `scrollBy` for step (a) only) and requires the substitution to be recorded. Step (c)'s keyboard path tests the focus-scroll escape either way. |
| The cause may not be (only) the track sizing (the requirement's own assumption: "a missing scroll container, not Electron. Verify in the running app."). | LOW | Requirement Assumptions | Chat's and Sessions' evidence already measured this gap (`sessions/README.md:61`: `scrollHeight === clientHeight === 1260`). Step 1's red-first run on base still decides it, and if base passes, the worker finds and records the real mechanism before fixing. |
| Removing `.main:has(.chat|.sessions)` regresses Chat or Sessions if the shell fix doesn't fully replace it. | MEDIUM | Plan Review | The `.content:has()` flex columns stay. `sessions.spec.ts:270` and the Chat e2e run under AC4. If either goes red only because of the removal, the worker diagnoses it in `app.css` and doesn't restore the workaround silently. |
| A shell-level fix affects every screen. A screen that relied on the window growing may now clip. | MEDIUM | Requirement Risks | AC2 visits every screen. AC4 runs the whole e2e suite. Step 4 has the worker review each screen's states and fix clipping in that screen's own scroll container or list it under "Not verified". |
| The existing Team screenshots were captured before this fix. Their window may have been taller than its viewport. | LOW | Analysis (Phase 3) | The full-window screenshots are the window's viewport, so they're unaffected. The new pair is the evidence for this item. |

## Plan Review
- **Status:** PASS (attempt 3/3; attempts 1 and 2 also PASS, and their MEDIUM/LOW issues were refined)
- **Open note (LOW, below the fix floor, not applied):** step 2's ablation doesn't fix the order of removal. Suggested: remove `.main`'s candidates first, then remove `.window`'s `grid-template-rows: minmax(0, 1fr);` alone and confirm red. That red run is pin row 2. Row 2 holds whichever declaration is kept.

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-25-team-inspector-scrolls-inside-its-pane.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-25T04:51:19Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/137
- **Branch:** feature/team-inspector-scrolls-inside-its-pane
- **Files changed:** 9
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Root cause confirmed red on base: `.window`'s implicit `auto` row let `.main` grow to 1368px in the 760px window, so the document scrolled. Fixed with `.window { grid-template-rows: minmax(0, 1fr); }`, chosen by ablation. Removed Chat's and Sessions' `.main:has()` workarounds. Added AC1 (the inspector scrolls alone) and AC2 (the document never scrolls on any screen) e2e tests, the inspector-scrolled screenshots and the README evidence. Phase 4.5: iteration 1 found 1 MEDIUM (AC1 (a) didn't wait for the inspector bottom); fix-1 is 31a5850; iteration 2 PASS clean. 1 LOW dismissed (no long-thread Chat pin).

## Not verified
- **Chat with a thread longer than the window**: chat.spec.ts stays green with the shell fix reverted (short fixtures); a pin needs chat.spec.ts, which is outside this lane (subtask 1)
- **Kernel band above a full-height screen in the live app**: only covered by the Team error e2e; not observed on every screen (subtask 1)
