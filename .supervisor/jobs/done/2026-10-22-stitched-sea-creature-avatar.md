# Supervisor Job: Build the stitched sea-creature Avatar component in app/src/components/Avatar/

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-22-023903/L2
- **CLAUDE.md:** ✓ Found (fresh — phase 5 in progress; `app/` scaffold from item 01 is on `main`)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140009-the-stitched-sea-creature-avatar.md
- **Base commit:** 58c2e4cad24d521b0880f36b9d0f22690847a9b8

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | `app/package.json` already has React 19, TypeScript, vitest 5, @testing-library/react, jsdom, @playwright/test and `@react-spring/web` (the one spring library item 01 installed). |
| 2 | Dependency Availability | GO | No new npm dependency needed; `app/package.json` is item 01's file and is not touched. |
| 3 | Architecture Fit | GO | `app/src/components/` does not exist yet (this item or a run-3 sibling creates it); `app/src/styles/tokens.css` defines `--accent`, `--crew-teal/sky/berry/olive/slate`, `--attention`, `--ground`, `--ink-tertiary` in light and both dark selectors. |
| 4 | Scope vs Supervisor Capability | GO | One component, 12 created files (4 code/test + 1 e2e spec + 6 screenshots + 1 evidence README); single worker. |
| 5 | Hard Blockers | CAUTION | Item 01 ships no component gallery route and `app/` has no `playwright.config.*`; the only Playwright target is Electron (`app/e2e/smoke.spec.ts` launches `dist-electron/main.cjs`). `app/src/App.tsx`, `app/electron/main.ts`, `app/vite.config.ts` and `app/package.json` are item 01's, so the component e2e page must be self-contained in `app/e2e/components.avatar.spec.ts`. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Port the approved stitched sea-creature avatar (`docs/design/avatar/avatar.css` + `avatar.js`, `docs/design/design-system/components/Avatar/README.md` + `preview.html`, D23) into one React component at `app/src/components/Avatar/`, with tests, a Playwright page rendering every state, and committed light/dark screenshots.

**Problem Statement:**
The owner needs the approved Avatar built once, exactly as the design system specifies, because every phase 5 screen (Team, Chat, Approvals, Crew rows) renders agents with it and each screen's polish gate (D9) depends on it matching the design.
Currently, `app/src/components/` does not exist; the avatar lives only as vanilla HTML-string code in `docs/design/avatar/avatar.js` and CSS in `avatar.css`. Screens 13–17 cannot render an agent until it exists.
Success looks like a typed `<Avatar>` that renders the 8 creatures (whale for Wright alone, crowned, in `accent`), each in its `crew-*` hue, carries each of the 6 kernel states in the loose thread's shape (legible with motion off), uses only `tokens.css` variables, and passes `cd app && npm run typecheck && npm test && npm run build`.

**Design facts the worker must port (from the sources above — do not redesign):**
- Construction: `<span class="bot {state}" role="img" aria-label title>` → `.ring` (aria-hidden) + `<svg viewBox="-2 -2 36 36">` → `circle.stitch` (r 16.5) → `g.drift` → `g.rig` → creature body (`.fill` at opacity .28, `.st` running-stitch outline, `.ln` inner lines, `.knot` eye) + crown (Wright only) + `g.tail` holding the thread paths `t-idle`, `t-up`, `t-slack`, `t-cut`+`t-cut2`, `t-bow` built from the creature's `tail` anchor. SVG path data for all 8 creatures comes verbatim from `SHAPES` in `avatar.js`.
- States (README table; the `stateWord` map is defined in `docs/design/design-system/components/Avatar/preview.html` — `avatar.js` only references it; `docs/design/mockups/gui-v1.html` has a different map and is NOT the source): `idle`→"idle" (thread `t-idle`), `working`→"working" (`t-idle`, stitches run), `waiting`→"waiting on you" (`t-up`, `attention` ring), `parked`→"paused at cap" (`t-slack`, 72% opacity, sparse ring), `done`→"done" (`t-bow`, solid ring), `danger`→"killed" (`t-cut` + `t-cut2`, broken ring).
- Identity: Wright (`id === "wright"`) is always the `whale` with the crown, hue `accent`, whatever shape/hue is passed. A crew member's shape is one of `shark, seahorse, octopus, turtle, jellyfish, fish, crab` (unknown or `whale` falls back to `fish`, per README "Don't use the whale or the crown for anyone but Wright"); hue is one of `teal, berry, sky, olive, slate` mapped to `--crew-*` (unknown falls back to `slate`). `accent` and semantic tokens (`ok`, `attention`, `danger`, `parked`) are never a crew identity hue.
- Label: `"{name} · {stateWord}"` plus `" · {action}"` when the optional current action is given; the same text is the `aria-label` and the `title` tooltip.
- Size via `--s` (default 32); documented sizes 16/24/36/56; never below 16px (clamp to 16).
- Per-agent stagger: `--seed: -{seedOf(id)}s` with `seedOf` ported from `avatar.js`.
- Motion: port the keyframes from `avatar.css` (CSS keyframes are acceptable); any JS-driven gesture uses only `@react-spring/web` and honours reduced motion. Under `@media (prefers-reduced-motion: reduce)` every avatar animation stops (port the rule, also stop the `.st`/`.ln`/`.stitch` `run` animation, and stop the hover nod: the source's `.bot:hover .rig{…!important}` out-specifies the source's reduced-motion `.bot .rig{animation:none!important}`, so add `.bot:hover .rig{animation:none!important}` inside the media block and record that source-CSS gap as an owner finding in the evidence README) and the thread's shape alone carries the state.
- Evidence README also records: the gestures are the CSS keyframes ported from `avatar.css` and no animation library other than `@react-spring/web` is used; the avatar strokes/fills are non-text graphics whose `--accent`/`--crew-*` hues the token notes rate 3:1+ on `--ground` and `--surface` in both themes (`docs/design/tokens.json`), so contrast is inherited from the tokens; and the owner findings (hover-nod vs reduced-motion gap, `idle`/`working` sharing `t-idle`, and the unported `.wind`/`.frame`/`.thread`/`.stripe` selectors that `avatar.css` styles but `avatar.js` never renders).
- Do NOT port the showcase-only selectors (`.shapes`, `.states …`) — they carry hex literals (`#ffffff14`, `#ffffff33`) and belong to the mockup page, not the component.

## Acceptance Criteria
- [ ] Given each component's README states, when its test renders them, then each state matches the README's rules: variants, sizes, disabled, focus, empty and error where specified. (For Avatar: `Avatar.test.tsx` renders all 6 states × Wright and a crew member, all 7 crew creatures, and sizes 16/24/36/56, asserting `role="img"`, the exact `aria-label`/`title` text per state including the optional action, the state class on the root, and that a size below 16 renders at 16.)
- [ ] Given each kernel state, when motion is reduced, then the thread's static shape still shows the state. (Test: for each of the 6 states the visible thread path set differs from every other state's — `idle`/`working` share `t-idle` and are told apart by the running stitches only when motion is on, so the test asserts the 5 distinct thread shapes for idle, waiting, parked, done, danger and that `working` keeps `t-idle`; and `Avatar.css` contains a `prefers-reduced-motion: reduce` block that sets `animation: none` on drift, rig, tail, ring and the stitch layers (`.wind` is not ported: `avatar.js` renders no `.wind` group), includes a `.bot:hover .rig` override with `animation: none !important` so a hover nod cannot play under reduced motion, and never changes a `.t-*` `display`.)
- [ ] Given `wright`, then only the whale with its crown, in `accent`. (Test: `id="wright"` renders the whale path data and one crown path with `--bot: var(--accent)` even when another shape/hue is passed; any other id never renders the crown or the whale, and never resolves `--bot` to `--accent` or a semantic token.)
- [ ] Given dark mode, then every component uses the dark tokens, with no hard-coded colour (a test greps for hex literals outside `tokens.css`). (Test reads the non-test source files `Avatar.tsx`, `Avatar.css` and `creatures.ts` — never the scanning test itself, whose fixtures such as the README's example action "Post review on #412" would self-match; needles are built so they cannot match themselves — and fails on any `#[0-9a-fA-F]{3,8}` colour literal, any `rgb(`/`hsl(` literal, and any identity part (`.fill`, `.st`, `.ln`, `.knot`, `.stitch`, `.t`, `.crown`) painted with `var(--ok|--attention|--danger|--parked)`.)
- [ ] Given keyboard only, then every interactive component is reachable and operable, with visible focus. (Avatar is non-interactive, `role="img"`: the test asserts it has no `tabindex` and is not a focus stop, so it never adds an unlabeled tab stop; its label is reachable to assistive tech via `aria-label`.)
- [ ] Given `app/e2e/components.avatar.spec.ts`, when `npm run e2e` runs, then it renders every state, creature and size with the real `tokens.css` + `Avatar.css` and writes `states-light.png`, `states-dark.png`, `creatures-light.png`, `creatures-dark.png`, `sizes-light.png`, `sizes-dark.png` (reduced motion emulated so captures are stable) under `docs/evidence/phase-5-polish/components/avatar/`, and those six PNGs plus a `README.md` naming each screenshot and the `preview.html` row it matches are committed.
- [ ] `cd app && npm run typecheck && npm test && npm run build` passes, and the screenshots are committed.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/components/Avatar/Avatar.test.tsx` — crown only for Wright | remove the `id === "wright"` guard on the crown in `app/src/components/Avatar/Avatar.tsx` (render the crown for every agent) |
| `app/src/components/Avatar/Avatar.test.tsx` — whale only for Wright | let a crew member's `whale` shape through instead of falling back to `fish` in `app/src/components/Avatar/Avatar.tsx` |
| `app/src/components/Avatar/Avatar.test.tsx` — crew `--bot` never `--accent` / semantic | map an unknown crew hue to `--accent` instead of `--crew-slate` in `app/src/components/Avatar/Avatar.tsx` |
| `app/src/components/Avatar/Avatar.test.tsx` — size clamps to 16 | delete the 16px clamp in `app/src/components/Avatar/Avatar.tsx` |
| `app/src/components/Avatar/Avatar.test.tsx` — thread shape per state | flip the `done` state's thread from `t-bow` to `t-idle` in `app/src/components/Avatar/Avatar.tsx` |
| `app/src/components/Avatar/Avatar.test.tsx` — aria-label/title text | flip `"waiting on you"` → `"waiting"` in the state-word map in `app/src/components/Avatar/Avatar.tsx` |
| `app/src/components/Avatar/Avatar.test.tsx` — state class on the root | render the root `className` without the state (`bot` only) in `app/src/components/Avatar/Avatar.tsx` |
| `app/src/components/Avatar/Avatar.test.tsx` — optional action suffix in label | drop the `" · {action}"` suffix from the label in `app/src/components/Avatar/Avatar.tsx` |
| `app/src/components/Avatar/Avatar.test.tsx` — no hex / rgb / semantic identity paint | add `.bot .knot{fill:#4650c8}` (or `fill:var(--danger)`) to `app/src/components/Avatar/Avatar.css` |
| `app/src/components/Avatar/Avatar.test.tsx` — reduced-motion block (incl. hover) | delete the `.bot:hover .rig{animation:none!important}` line from the reduced-motion block in `app/src/components/Avatar/Avatar.css` |
| `app/src/components/Avatar/Avatar.test.tsx` — not a focus stop | add `tabIndex={0}` to the root span in `app/src/components/Avatar/Avatar.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Avatar component, tests, e2e page and screenshots | all | 0 modify, 12 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| component | — | `app/src/components/Avatar/Avatar.tsx`, `app/src/components/Avatar/Avatar.css`, `app/src/components/Avatar/creatures.ts` (SHAPES path data + seedOf) | HIGH |
| tests | — | `app/src/components/Avatar/Avatar.test.tsx` | HIGH |
| e2e + evidence | — | `app/e2e/components.avatar.spec.ts`, `docs/evidence/phase-5-polish/components/avatar/{states,creatures,sizes}-{light,dark}.png`, `docs/evidence/phase-5-polish/components/avatar/README.md` | MEDIUM (harness shape — see Risk 1) |

No file overlap with any other item in run 3 (items 08, 10, 11, 12 own their own `app/src/components/<Name>/` dirs and `app/e2e/components.<group>.spec.ts`).

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "app/src/components/Avatar/Avatar.tsx"}
  - {kind: "symbol", path: "app/src/components/Avatar/Avatar.tsx", name: "Avatar"}
  - {kind: "type", path: "app/src/components/Avatar/Avatar.tsx", name: "AvatarState"}
  - {kind: "file", path: "app/src/components/Avatar/Avatar.css"}
  - {kind: "file", path: "app/src/components/Avatar/creatures.ts"}
  - {kind: "file", path: "app/src/components/Avatar/Avatar.test.tsx"}
  - {kind: "file", path: "app/e2e/components.avatar.spec.ts"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/avatar/README.md"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/avatar/states-light.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/avatar/states-dark.png"}
requires: []
lanes:
  - "app/src/components/Avatar/**"
  - "app/e2e/components.avatar.spec.ts"
  - "docs/evidence/phase-5-polish/components/avatar/**"
external_requires:
  - "@react-spring/web ^10.1.2 (already in app/package.json devDependencies, installed by item 01) — only if a gesture is JS-driven"
  - "Electron binary for Playwright (`node node_modules/electron/install.js`, as CI does) to run the e2e page locally"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md` (WCAG 2.1 AA, design-system tokens), `skills/unit-testing/SKILL.md` (vitest + RTL, `// @vitest-environment jsdom` pragma as in `app/src/App.test.tsx`), `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): no component gallery route and no `playwright.config.*` exist; the component isn't mounted in the app, and `App.tsx`, `electron/main.ts`, `vite.config.ts`, `package.json` belong to item 01. | MEDIUM | Keep the harness inside `app/e2e/components.avatar.spec.ts`: e.g. build a temp entry that imports `../src/styles/tokens.css` and `../src/components/Avatar/Avatar` with vite's programmatic `build()` using `configFile: false` (react plugin passed inline) and `root` + `outDir` both inside a temp dir — never loading `app/vite.config.ts`, whose `emptyOutDir: true` would wipe the `app/dist` that `smoke.spec.ts` needs — launch Electron with a temp `main.cjs` that loads that `index.html`, toggle theme via `data-theme="light"`/`"dark"` on `<html>` (tokens.css honours both), emulate `reducedMotion: "reduce"`, and screenshot. Don't import `.css` straight into the Playwright test process. If no self-contained harness works, stop and report rather than editing an item-01 file. |
| The new e2e spec also runs in CI (`xvfb-run npm run e2e` in `.github/workflows/ci.yml`) on ubuntu. | MEDIUM | It must not depend on the fixture kernel or the built app, must clean up its temp dir and Electron process, and must not compare against the committed PNGs (font rendering differs across OSes); it only captures. |
| `avatar.js` lets any agent pick `whale` (`a.shape in SHAPES`), and `avatar.css` has showcase selectors with hex literals. | LOW | The README is authoritative: whale + crown for Wright only; don't port `.shapes`/`.states`. Record any other README-vs-`preview.html` mismatch as a finding for the owner in the evidence README, not a redesign. |
| Design gap: in the approved design `idle` and `working` both use the `t-idle` thread, so with motion off the thread shape alone can't tell them apart (working differs only by running stitches). | MEDIUM | Do not invent a new thread shape (non-goal: changing the design). Implement as designed, test the 5 distinct shapes plus `working` keeping `t-idle` (AC 2), and record the gap as an owner finding in the evidence README and the PR. |
| `scripts/check-docs.sh` rule 4 (semantic token as identity hue) scans only `docs/design/**`, not `app/`. | LOW | `Avatar.test.tsx` enforces the same rule for the app code (AC 4); `check-docs.sh` is out of this item's Touches and is not edited. |
| jsdom applies no CSS, so motion/visibility can't be asserted from computed style. | LOW | Assert structure in jsdom (which thread path(s) render per state, classes, attributes) and assert the reduced-motion rule textually on `Avatar.css`; the e2e screenshots cover the visual. Rendering only the active state's thread path(s) in markup (rather than all six with `display` toggles) makes the state legible without CSS and is acceptable. |
| Disk on this Mac is 94% used (28 GiB free). | LOW | Enough for one worktree + Electron; clean the e2e temp dir. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-22-stitched-sea-creature-avatar.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-22T05:15:13Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/110
- **Branch:** feature/stitched-sea-creature-avatar
- **Files changed:** 12
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Avatar component ported. Each of the 3 Phase 4.5 reviews was PASS (11/11 pins held, 7/7 ACs addressed, CI green) but raised MEDIUM test-strength/evidence findings. They were fixed in 34fcf5f, 0898678 and 7e3a0ad; the last fix was not re-reviewed. Resumed via --continue after the SUP-CHILDREN park, which was a false positive: the Worker Results heading recorded the label worker-1 instead of agent_id a51e6ba603c69c23f.

## Not verified
- **e2e under xvfb on ubuntu CI** — run on macOS only (subtask 1)
- **hover nod under reduced motion with a live pointer** — pinned textually only (subtask 1)
