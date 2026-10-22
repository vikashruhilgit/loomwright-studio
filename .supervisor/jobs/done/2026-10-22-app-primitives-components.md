# Supervisor Job: Build the eight approved app primitives (Button, Badge, Input, StatusDot, Dialog, List, Card, Toast) exactly as the design system specifies

## Environment
- **Project:** loomwright-studio (lane checkout `loomwright-studio-lanes/automate-2026-10-22-023903/L1`)
- **CLAUDE.md:** ✓ Found (fresh — `kernel/`, `app/`, `docs/` layout and the invariants match the tree at base)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (disk 94% used, 28 GiB free — adequate for worktrees)
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140008-app-primitives-button-badge-input-statusdot-dialog-list-card-toast.md
- **Base commit:** 58c2e4cad24d521b0880f36b9d0f22690847a9b8

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | `app/` is React 19 + TypeScript 7 + Vite 8 + vitest 5 + RTL 16 (jsdom) + Playwright 1.64 Electron, exactly what the requirement names (`app/package.json`). |
| 2 | Dependency Availability | CAUTION | No icon library is installed (README asks for 14px/12px Lucide icons) and the requirement forbids a new npm dependency: every icon is an `icon?: ReactNode` slot, and the few built-in glyphs (spinner, select chevron, dismiss ×, search) are CSS or an inline `currentColor` SVG. The Avatar component (Card agent card 36px, List Crew row 24px, Badge agent chip 14px) is item 09, built in parallel in this same wave and not on `main`: these take an `avatar?: ReactNode` slot and must not import `app/src/components/Avatar/`. |
| 3 | Architecture Fit | GO | Item 01 left `app/src/components/` empty for items 08–11; styles use only `tokens.css` custom properties; dark mode is `:root[data-theme="dark"]` / `prefers-color-scheme` in `app/src/styles/tokens.css`, so components need no theme code of their own. |
| 4 | Scope vs Supervisor Capability | CAUTION | ~50 created files (8 × component + styles + test + states fixture = 32, the e2e spec, 16 screenshots, an evidence README) exceeds one worker's bound → split, reason `context-bound`. |
| 5 | Hard Blockers | CAUTION | No component-gallery seam exists: the e2e smoke launches the real app (`app/e2e/smoke.spec.ts`), whose main process blocks navigation (`app/electron/main.ts`: `window.webContents.on("will-navigate", (event) => event.preventDefault());`), and `App.tsx` / `vite.config.ts` / `src/screens/` are outside this item's Touches. The spec therefore builds its own gallery bundle at test time with Vite's JS API and launches a throwaway Electron main pointed at it (see Subtask 4). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Build Button, Badge, Input, StatusDot, Dialog, List, Card and Toast once under `app/src/components/<Name>/`, token-only and matching each design-system README and `preview.html` in light and dark mode, with unit tests, a Playwright Electron page rendering every state, and committed light/dark screenshots.

**Problem Statement:**
The owner needs the approved primitives built once because screens 13–17 must all use the same components and pass the D9 polish gate.
Currently, the design system (`docs/design/design-system/components/<Name>/README.md` + `preview.html`, `docs/design/tokens.json`, `docs/design/brand-book.md`) specifies them, and none is built; `app/src/components/` does not exist yet. This blocks every screen item.
Success looks like eight components whose tests prove each README rule (variants, sizes, disabled, focus, empty, error), the behaviours the screens rely on (focus trap, Escape, J/K, scroll anchoring, no-shift toasts, honest status), no hard-coded colour, keyboard-only operation, and screenshots of every state in both themes.

**Binding scope notes (from the requirement, carried verbatim in meaning):**
- Each component lives in `app/src/components/<Name>/` (component, styles using only `tokens.css` variables, a test). **No barrel file**: no `app/src/components/index.ts`; screens import each component by path.
- Item 01 owns every shared file. Do **not** edit `app/package.json`, `app/package-lock.json`, `app/vite.config.ts`, `app/tsconfig*.json`, `app/src/App.tsx`, `app/src/main.tsx`, `app/src/styles/*`, `app/src/screens/*`, `app/e2e/smoke.spec.ts`, `app/e2e/fixture-kernel.ts`, `.github/workflows/ci.yml`. Add **no** npm dependency. If one turns out to be required, stop and say so in the PR rather than editing it.
- Changing the design is a non-goal: a mismatch with a README or `preview.html` is recorded as a finding in `docs/evidence/phase-5-polish/components/primitives/README.md`, not redesigned.

## Acceptance Criteria
- [ ] **AC1** — Given each component's README states, when its vitest + RTL test (`app/src/components/<Name>/<Name>.test.tsx`, `// @vitest-environment jsdom`) renders them, then each state matches the README's rules: Button's four variants (`primary`, `secondary`, `ghost`, `danger`), two sizes (32px `control-height`, 28px `row-height`), disabled (native `disabled`, label unchanged), loading (`aria-busy="true"`, spinner replaces the icon, label kept) and optional kbd chip; Badge's semantic tones (`ok`, `attention`, `danger`, `parked`, `accent`) and neutral, plus the count pill (requires `aria-label` with the unit), chip (avatar/PR slot), kbd and mono marks; Input's text, search (leading icon, trailing kbd hint), select (trailing chevron) and composer variants, with a visible `label` above every non-composer field, an optional hint, and an error state that sets `aria-invalid="true"` and `aria-describedby` pointing at the rendered message; StatusDot's six states; Dialog's `confirm` (`role="alertdialog"`) and `decision` (`role="dialog"`, mono well, optional checkbox) kinds with at most two action buttons; List's navigation, data and Crew rows, the skeleton loading rows and the empty Crew text "No specialists yet. Wright proposes one when a duty needs it."; Card's agent and task cards (focusable, open on `Enter`); Toast's toast (`role="status"`, at most one action, dismiss) and band (`danger` → `role="alert"`, `parked`, `attention`).
- [ ] **AC2** — Given a List with a selected row scrolled into the middle of its viewport, when three items are inserted above it, then the selected key is unchanged and the selected row's on-screen top offset is unchanged (asserted in the real Electron renderer by `app/e2e/components.primitives.spec.ts` via `boundingBox()`, and in `app/src/components/List/List.test.tsx` by checking that `scrollTop` grows by exactly the inserted rows' height using stubbed layout metrics).
- [ ] **AC3** — Given an open Dialog, when the user presses Tab / Shift+Tab repeatedly, then focus never leaves the dialog; on open focus lands on the first non-destructive control; when it closes (Cancel, a handler, or Escape), focus returns to the element that opened it. Given a `decision` dialog, when Escape is pressed, then it closes via its cancel handler. Given a destructive `confirm` dialog, when Escape is pressed, then it stays open (requirement Scope 2; see Risk Assessment for the README mismatch this records).
- [ ] **AC4** — Given the List, when focus is on it and the user presses `j`/`ArrowDown` or `k`/`ArrowUp`, then the selection moves one row with a visible focus/selection style; `Enter` calls the open handler; the selected navigation row carries `aria-current="page"`.
- [ ] **AC5** — Given StatusDot, then `ok` renders only when the caller passes the kernel-verified flag together with a verification time (shown in its meta); `ok` without that flag renders `ink-tertiary` text with no dot (the README's "a guess" rule); every state carries its state word visibly or as an `aria-label`; only `working` animates.
- [ ] **AC6** — Given a Toast stack, when a toast appears or leaves, then no element of the main content moves (asserted in the e2e spec by comparing a content element's `boundingBox()` before and after showing a toast); the stack shows at most three toasts, older ones collapsed; a toast auto-dismisses after 6 s unless hovered (unit test with fake timers).
- [ ] **AC7** — Given dark mode (`data-theme="dark"`), then every component uses the dark tokens with no hard-coded colour: each component's test reads its own `<Name>.css`, `<Name>.tsx` and `<Name>.states.tsx` source from disk with Node (`/// <reference types="node" />` at the top of the test file — `@types/node` is already a devDependency — then `readFileSync(fileURLToPath(new URL("./Button.css", import.meta.url)), "utf8")`; `node:fs` is allowed in `*.test.tsx` files only, never in component code). **Never `?raw` for CSS:** vitest 5's `vitest:css-disable` plugin turns `*.css?raw` into `export default ""` under the default `css.include: []`, which would make the check vacuous. Each test also asserts the CSS it read is non-empty, and asserts there is no hex colour literal (`/#[0-9a-fA-F]{3,8}\b/`) and no `rgb(`/`hsl(` colour function, so only `var(--…)` tokens from `tokens.css` colour anything.
- [ ] **AC8** — Given keyboard only, then every interactive component (Button, Input, Dialog controls, List rows, Card, Toast action and dismiss) is reachable with Tab, operable with Enter/Space (and Escape/J/K where specified), and shows the `focus` ring on `:focus-visible`; every control has an accessible name (RTL `getByRole(…, { name })` finds each).
- [ ] **AC9** — Given `prefers-reduced-motion: reduce`, then each component's CSS sets its animation/transition durations to 0 (opacity fades capped at `duration-instant`) and the `working` dot is static (each component's CSS carries a `@media (prefers-reduced-motion: reduce)` block; StatusDot's test reads `StatusDot.css` with `readFileSync` as in AC7 and asserts that block contains `animation: none` for the working dot; Subtask 4's e2e spec also asserts, under `page.emulateMedia({ reducedMotion: "reduce" })`, that the working dot's `getComputedStyle(...).animationName` is `none` in the real renderer).
- [ ] **AC10** — Given `app/e2e/components.primitives.spec.ts` run by `PRIMITIVES_EVIDENCE=1 npm run e2e` (without the flag the screenshots go to Playwright's output dir), then it renders every state of all eight components in the Electron renderer in light and dark mode and writes one screenshot per component per theme, which are committed under `docs/evidence/phase-5-polish/components/primitives/` as `<name>-light.png` / `<name>-dark.png`, and a committed evidence file `docs/evidence/phase-5-polish/components/primitives/README.md` lists every screenshot, names the `preview.html` each matches, and records each README/preview mismatch as a finding for the owner; the PR body links to it.
- [ ] **AC11** — `cd app && npm ci && npm run typecheck && npm test && npm run build` passes, `npm run e2e` passes (smoke + components spec), and `bash scripts/check-docs.sh` passes.

**Evidence rule:** AC10's evidence is committed files (`*.png` + the evidence `README.md`), never only the PR body.

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` |
| 3 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` |
| 4 | `skills/playwright-e2e/SKILL.md`, `skills/frontend-ui/SKILL.md` |

## File Impact Map

All paths are **create** (the item modifies no existing file). Parent dirs verified: `app/src/` exists (`app/src/components/` is a new dir), `app/e2e/` exists, `docs/evidence/` exists (`phase-5-polish/` is new).

| Path | Action | Subtask | Confidence |
|------|--------|---------|------------|
| `app/src/components/{Button,Badge,StatusDot,Input}/<Name>.tsx` | create | 1 | HIGH |
| `app/src/components/{Button,Badge,StatusDot,Input}/<Name>.css` | create | 1 | HIGH |
| `app/src/components/{Button,Badge,StatusDot,Input}/<Name>.test.tsx` | create | 1 | HIGH |
| `app/src/components/{Button,Badge,StatusDot,Input}/<Name>.states.tsx` | create | 1 | HIGH |
| `app/src/components/{Dialog,Toast}/<Name>.tsx`, `.css`, `.test.tsx`, `.states.tsx` | create | 2 | HIGH |
| `app/src/components/{List,Card}/<Name>.tsx`, `.css`, `.test.tsx`, `.states.tsx` | create | 3 | HIGH |
| `app/e2e/components.primitives.spec.ts` | create | 4 | HIGH |
| `docs/evidence/phase-5-polish/components/primitives/*.png` (16) | create | 4 | HIGH |
| `docs/evidence/phase-5-polish/components/primitives/README.md` | create | 4 | HIGH |

Reference (read, never edit): `docs/design/design-system/components/<Name>/{README.md,preview.html}`, `docs/design/tokens.json`, `docs/design/brand-book.md` §Motion, `app/src/styles/tokens.css`, `app/src/styles/app.css` (the shell's `:focus-visible` ring), `app/e2e/smoke.spec.ts` (Electron launch idiom), `app/src/App.test.tsx` (RTL + jsdom docblock idiom).

**`<Name>.states.tsx` convention (all subtasks):** each component dir exports `export const states: ReadonlyArray<{ readonly id: string; readonly title: string; readonly render: () => ReactElement }>` covering every state its README and `preview.html` show (Toast's states also include its bands). Unit tests may reuse it; Subtask 4's gallery renders it. It imports only its own component (and, for composites, sibling components by path).

**Containment rule (all `states` entries):** every state renders **contained and static** so the whole gallery can sit on one page: no portal, no overlay covering the page, no focus trap, no auto-dismiss timer, no `position: fixed` escaping its frame. Dialog exposes an `inline` prop (renders the panel in flow, no overlay, no trap, no initial-focus move) used only by its states; Toast's stack and Band states render inside a frame with `position: relative; transform: translateZ(0)` (which contains fixed children) and with auto-dismiss off (`duration={null}` or equivalent). The interactive behaviours (AC2, AC3, AC6) are set up by Subtask 4's gallery entry, not by `states`.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/components/Button/Button.test.tsx` — no hex literal, CSS read via `readFileSync` (AC7) | add `color: #4650c8;` to any rule in `app/src/components/Button/Button.css` → the test must fail (same pin per component dir) |
| `app/src/components/Dialog/Dialog.test.tsx` — destructive confirm ignores Escape (AC3) | make the Escape handler call `onCancel` regardless of `kind` in `app/src/components/Dialog/Dialog.tsx` → the test must fail |
| `app/src/components/Dialog/Dialog.test.tsx` — focus returns to opener (AC3) | delete the line that refocuses the stored opener on close in `app/src/components/Dialog/Dialog.tsx` → the test must fail |
| `app/src/components/List/List.test.tsx` — scroll anchoring on insert-above (AC2) | delete the `scrollTop` adjustment in List's layout effect in `app/src/components/List/List.tsx` → the test must fail |
| `app/src/components/StatusDot/StatusDot.test.tsx` — honest `ok` (AC5) | render the `ok` dot whenever `state === "ok"` ignoring the verified flag in `app/src/components/StatusDot/StatusDot.tsx` → the test must fail |
| `app/src/components/Toast/Toast.test.tsx` — max three toasts (AC6; the test asserts the literal 3 and advances timers by the literal 6000, never importing the constants) | flip `MAX_VISIBLE_TOASTS = 3` → `MAX_VISIBLE_TOASTS = 4` in `app/src/components/Toast/Toast.tsx` |
| `app/src/components/Toast/Toast.test.tsx` — 6 s auto-dismiss (AC6) | flip `TOAST_DURATION_MS = 6000` → `TOAST_DURATION_MS = 60000` in `app/src/components/Toast/Toast.tsx` |
| `app/src/components/Toast/Toast.test.tsx` — hover pauses auto-dismiss (AC6) | delete the `onMouseEnter` handler that pauses the timer in `app/src/components/Toast/Toast.tsx` → the test must fail |
| `app/src/components/List/List.test.tsx` — j/k and arrows move the selection (AC4) | delete the `case "j":` arm of the keydown switch in `app/src/components/List/List.tsx` → the test must fail |
| `app/src/components/List/List.test.tsx` — Enter opens (AC4) | delete the `onOpen` call in the `Enter` arm of the keydown switch in `app/src/components/List/List.tsx` → the test must fail |
| `app/src/components/Dialog/Dialog.test.tsx` — Tab / Shift+Tab focus trap (AC3) | delete the wrap-around `focus()` call in the Tab handler in `app/src/components/Dialog/Dialog.tsx` → the test must fail |
| `app/src/components/Input/Input.test.tsx` — error wiring (AC1) | delete `aria-describedby=` in `app/src/components/Input/Input.tsx` |
| `app/src/components/Button/Button.test.tsx` — loading sets `aria-busy` (AC1) | delete `aria-busy=` in `app/src/components/Button/Button.tsx` |
| `app/src/components/StatusDot/StatusDot.test.tsx` — reduced motion stops breathing, CSS read via `readFileSync` (AC9) | delete `animation: none` in `app/src/components/StatusDot/StatusDot.css` (the one occurrence, inside the `@media (prefers-reduced-motion: reduce)` block) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Leaf primitives: Button, Badge, StatusDot, Input | AC1 (these four), AC5, AC7, AC8, AC9, AC11 (typecheck + test) | 0 modify, 16 create | frontend-ui, unit-testing | LAUNCHABLE |
| 2 | Overlays: Dialog and Toast (built on Button, StatusDot) | AC1 (these two), AC3, AC6 (unit part), AC7, AC8, AC9, AC11 (typecheck + test) | 0 modify, 8 create | frontend-ui, unit-testing | BLOCKED (by #1) |
| 3 | Collections: List and Card (built on StatusDot, Badge) | AC1 (these two), AC2 (unit part), AC4, AC7, AC8, AC9, AC11 (typecheck + test) | 0 modify, 8 create | frontend-ui, unit-testing | BLOCKED (by #1) |
| 4 | Gallery e2e spec, screenshots and evidence README | AC2 (e2e part), AC6 (e2e part), AC10, AC11 (build + e2e + check-docs) | 0 modify, 18 create | playwright-e2e, frontend-ui | BLOCKED (by #1, #2, #3) |

### Subtask 1 notes — Button, Badge, StatusDot, Input
- **Button** (`Button.tsx`): `variant: "primary" | "secondary" | "ghost" | "danger"`, `size: "standalone" | "row"` (32 / 28 px via `--control-height` / `--row-height`), `icon?: ReactNode`, `kbd?: string`, `loading?: boolean` (`aria-busy`, 12px CSS spinner in the icon slot, width kept — never animate width), native `disabled`. Hover/pressed on `--duration-instant`; disabled = `--ink-disabled` on `--surface-sunken`. Sentence-case label as children.
- **Badge** (`Badge.tsx`): exports `Badge` (`tone: "ok" | "attention" | "danger" | "parked" | "accent" | "neutral"`, 20px, `--radius-xs`, caption size, weight 600, optional 12px icon slot), `CountPill` (`--attention` fill, `--radius-full`, tabular digits, **required** `aria-label`), `Chip` (`--surface` + `--hairline` edge, `avatar?: ReactNode` slot — do not import Avatar), `Kbd`, `Mono`.
- **StatusDot** (`StatusDot.tsx`): `state: "idle" | "working" | "waiting" | "paused" | "ok" | "failed"` (hollow ring / breathing on `--duration-pulse` / filled `--attention` / filled `--parked` with a pause bar / filled `--ok` / filled `--danger`), `label` (state word; `hideLabel` moves it to `aria-label`), `meta?: string` in caption. `ok` requires `verified: { at: string }`; without it render the README's guess form (no dot, `--ink-tertiary` text). Exported for reuse by Toast and List.
- **Input** (`Input.tsx`): exports `TextField` (variant `text | search`), `SelectField`, `Composer`. Rest = `--surface-sunken`, no border; focus = `--surface` with `--accent` edge. Label in the `label` type style, `--ink-tertiary`, wired with `htmlFor`/`id`; `hint`; `error` → `--danger` edge + message + `aria-invalid` + `aria-describedby`. Composer: `aria-label` required, chat type size, `Enter` sends, `Shift+Enter` inserts newline, grows to six lines then scrolls, `streaming` prop swaps Send for Stop (uses Button by path).

### Subtask 2 notes — Dialog, Toast
- **Dialog** (`Dialog.tsx`): `inline?: boolean` (states/gallery only — see Containment rule), `kind: "confirm" | "decision"`, `title`, `description`, `payload?: string` (mono well), `checkbox?`, `actions` (≤2), `wide?` (480px for a diff), 360px on `--surface-raised`, `--radius-lg`, `--shadow-3`, `--space-5`, over `--overlay`; open on `--duration-slow` `--ease-enter` from scale 0.98, close on `--duration-fast`. Focus trap (Tab/Shift+Tab cycle), initial focus on the first non-destructive control, restore focus to the opener on close, Escape → cancel except `kind="confirm"`. Never default-focus a `danger` primary. Buttons are `Button` imported by path. No stacking (one dialog at a time is the caller's contract; document it in the component's header comment).
- **Toast** (`Toast.tsx`): exports `Toast`, `ToastStack` (bottom-right of the main column, `position: fixed`/absolute so it never shifts layout, ≤3 visible via a named constant `MAX_VISIBLE_TOASTS = 3`, older collapse, auto-dismiss after `TOAST_DURATION_MS = 6000` paused on hover via `onMouseEnter`/`onMouseLeave`, enter `--duration-base` `--ease-enter`, leave `--duration-fast` `--ease-exit`, `role="status"`), and `Band` (`tone: "danger" | "parked" | "attention"`, full width at the top of the main column on the `*-soft` ground, `danger` → `role="alert"`, never auto-dismisses). Toast carries a StatusDot (by path), one bold + one plain clause, ≤1 `--accent` action, a dismiss with an accessible name. Do not migrate `app/src/shell/KernelStates.tsx`'s band (item 01 owns it).

### Subtask 3 notes — List, Card
- **List** (`List.tsx`): generic over items with a stable `key`; row kinds `nav` (28px, icon, label, kbd or CountPill, selected = `--accent-soft` + `--accent` + weight 500 + `aria-current="page"`), `data` (44px, StatusDot 8px, subject `body-strong`, caption meta `--ink-tertiary` tabular, right column), `crew` (44px, `avatar?: ReactNode` 24px slot, name weight 600 with an `--accent` unread dot, tabular time, caption second line; never a StatusDot beside an avatar). Keyboard (one `switch (event.key)` keydown handler with `case "j":`/`case "ArrowDown":`, `case "k":`/`case "ArrowUp":`, and `case "Enter":` calling `onOpen`): `ArrowUp/ArrowDown` and `j/k` move, `Enter` opens, focus ring on the row (roving tabindex or `aria-activedescendant` on a `listbox`). Scroll anchoring: in a layout effect, when items are inserted before the first visible / selected row, add the inserted height to `scrollTop` so nothing visible moves. `loading` renders skeleton rows on `--surface-sunken` at real row height; `emptyText` for the Crew group. Streaming meta updates change text only, never height. No zebra stripes.
- **Card** (`Card.tsx`): exports `AgentCard` (36px `avatar` slot, one-line `title-2` name with ellipsis, role clamped to a reserved two lines with full text as `title`, task line clamped at two lines with tooltip, budget block pinned to the bottom: 3px meter `--accent`, `--attention` from 80%, caption label "142k of 375k today" + model, tabular, meta row never wraps, no hairline above it), `TaskCard` (subject, chip slots, state line of Badges), and `CardGrid` (`auto-fill` 250px min, `grid-auto-rows: 1fr`). `--surface` on `--ground`, `--hairline` edge, `--radius-md`, `--space-4`, `--shadow-1` on hover only; card is a focusable element that opens on `Enter`/click; no buttons on the face; no dollar figure.

### Subtask 4 notes — gallery spec and evidence
- `app/e2e/components.primitives.spec.ts` must not depend on any file outside this item's Touches. In `test.beforeAll` (raise its timeout, e.g. 120 s) it:
  1. **Writes real gallery files** (not a virtual HTML entry) — `index.html` and `entry.tsx` — into a gitignored folder **inside the app**: `app/node_modules/.cache/components-gallery/` (root `.gitignore` ignores `node_modules/`), so bare imports (`react`, `react-dom/client`, the `react/jsx-runtime` that `@vitejs/plugin-react` injects) resolve by walking up to `app/node_modules`. `entry.tsx` imports `app/src/styles/tokens.css` and every `app/src/components/<Name>/<Name>.states.tsx` by relative path, renders one `<section data-testid="gallery-<name>">` per component listing each state with its title, and **also defines the interactive demos itself** by importing `List`, `ToastStack`/`Toast` and `Dialog` by path (decision (b): Subtask 4 owns them; Subtasks 2–3 export no demo states): `data-testid="demo-list"` with a scrolled List, a selected row and a `data-testid="demo-insert-above"` button that prepends three items; `data-testid="demo-content"` block beside a `data-testid="demo-show-toast"` button that pushes a toast into a live `ToastStack`; a `data-testid="demo-open-dialog"` opener that opens a non-inline `decision` Dialog.
  2. Calls `build({ root: thatDir, configFile: false, base: "./", plugins: [react()], logLevel: "warn", build: { outDir: <a temp dir under os.tmpdir()>, emptyOutDir: true } })` — `configFile: false` so `app/vite.config.ts` (with `outDir: "dist", emptyOutDir: true`) is never loaded and can't wipe the app's `dist/`.
  3. Writes a throwaway Electron main (`main.cjs`) into another temp dir that opens one `BrowserWindow` (`contextIsolation: true`, `nodeIntegration: false`, a fixed size such as 1200×900) and `loadFile`s the built gallery's `index.html`; then `_electron.launch({ args: [thatMainCjs] })` as `smoke.spec.ts` does.
- Themes: set `document.documentElement.dataset.theme = "light" | "dark"` (tokens.css honours `:root[data-theme]`), then screenshot each `gallery-<name>` section. **Output dir:** when `PRIMITIVES_EVIDENCE=1` is set, write to `docs/evidence/phase-5-polish/components/primitives/<name>-<theme>.png` (resolved from the spec's `import.meta.url`); otherwise write to `testInfo.outputPath(...)` so CI and later lanes' e2e runs never dirty the tracked evidence. Disable animations for stable screenshots (`animations: "disabled"` and `page.emulateMedia({ reducedMotion: "reduce" })`).
- Behaviour assertions in the real renderer, against the demos above: AC2 (click `demo-insert-above`; the selected row's `boundingBox().y` and the selected key are unchanged), AC6 (record `demo-content`'s `boundingBox()`, click `demo-show-toast`, assert the toast is visible and the box is unchanged), AC3 (focus `demo-open-dialog` by keyboard and press Enter, Tab/Shift+Tab stay inside the dialog, Escape closes it and `demo-open-dialog` is focused again).
- It runs in CI with the smoke under `xvfb-run npm run e2e` (`.github/workflows/ci.yml`); it must pass on ubuntu as well as macOS.
- **The worker produces the PNGs itself — no human step:** in its own worktree on this Mac it runs `cd app && npm ci && npm run build && PRIMITIVES_EVIDENCE=1 npm run e2e`, then commits the 16 PNGs that run wrote plus the evidence README (which states this exact command as how they were produced).
- `README.md` in the evidence dir: a table of the 16 screenshots (relative links, which `scripts/check-docs.sh` checks resolve), the `docs/design/design-system/components/<Name>/preview.html` each matches, the placeholder used for the Avatar slot (item 09 not merged), and every README/preview mismatch found (at least the destructive-Escape one below) as an owner finding.

### Subtask Contracts

```yaml
# Subtask 1 — Leaf primitives: Button, Badge, StatusDot, Input (LAUNCHABLE)
provides:
  - {kind: "file", path: "app/src/components/Button/Button.tsx"}
  - {kind: "symbol", path: "app/src/components/Button/Button.tsx", name: "Button"}
  - {kind: "file", path: "app/src/components/Button/Button.css"}
  - {kind: "file", path: "app/src/components/Button/Button.test.tsx"}
  - {kind: "symbol", path: "app/src/components/Button/Button.states.tsx", name: "states"}
  - {kind: "file", path: "app/src/components/Badge/Badge.tsx"}
  - {kind: "symbol", path: "app/src/components/Badge/Badge.tsx", name: "Badge"}
  - {kind: "symbol", path: "app/src/components/Badge/Badge.tsx", name: "CountPill"}
  - {kind: "file", path: "app/src/components/Badge/Badge.css"}
  - {kind: "file", path: "app/src/components/Badge/Badge.test.tsx"}
  - {kind: "symbol", path: "app/src/components/Badge/Badge.states.tsx", name: "states"}
  - {kind: "file", path: "app/src/components/StatusDot/StatusDot.tsx"}
  - {kind: "symbol", path: "app/src/components/StatusDot/StatusDot.tsx", name: "StatusDot"}
  - {kind: "file", path: "app/src/components/StatusDot/StatusDot.css"}
  - {kind: "file", path: "app/src/components/StatusDot/StatusDot.test.tsx"}
  - {kind: "symbol", path: "app/src/components/StatusDot/StatusDot.states.tsx", name: "states"}
  - {kind: "file", path: "app/src/components/Input/Input.tsx"}
  - {kind: "symbol", path: "app/src/components/Input/Input.tsx", name: "TextField"}
  - {kind: "symbol", path: "app/src/components/Input/Input.tsx", name: "Composer"}
  - {kind: "file", path: "app/src/components/Input/Input.css"}
  - {kind: "file", path: "app/src/components/Input/Input.test.tsx"}
  - {kind: "symbol", path: "app/src/components/Input/Input.states.tsx", name: "states"}
requires: []
lanes:
  - "app/src/components/Button/**"
  - "app/src/components/Badge/**"
  - "app/src/components/StatusDot/**"
  - "app/src/components/Input/**"
external_requires:
  - "react, react-dom, vitest, @testing-library/react, jsdom already in app/package.json (no new dependency)"

# Subtask 2 — Overlays: Dialog and Toast (BLOCKED by #1)
provides:
  - {kind: "file", path: "app/src/components/Dialog/Dialog.tsx"}
  - {kind: "symbol", path: "app/src/components/Dialog/Dialog.tsx", name: "Dialog"}
  - {kind: "file", path: "app/src/components/Dialog/Dialog.css"}
  - {kind: "file", path: "app/src/components/Dialog/Dialog.test.tsx"}
  - {kind: "symbol", path: "app/src/components/Dialog/Dialog.states.tsx", name: "states"}
  - {kind: "file", path: "app/src/components/Toast/Toast.tsx"}
  - {kind: "symbol", path: "app/src/components/Toast/Toast.tsx", name: "Toast"}
  - {kind: "symbol", path: "app/src/components/Toast/Toast.tsx", name: "ToastStack"}
  - {kind: "symbol", path: "app/src/components/Toast/Toast.tsx", name: "Band"}
  - {kind: "file", path: "app/src/components/Toast/Toast.css"}
  - {kind: "file", path: "app/src/components/Toast/Toast.test.tsx"}
  - {kind: "symbol", path: "app/src/components/Toast/Toast.states.tsx", name: "states"}
requires:
  - {from: "1", kind: "symbol", path: "app/src/components/Button/Button.tsx", name: "Button"}
  - {from: "1", kind: "symbol", path: "app/src/components/StatusDot/StatusDot.tsx", name: "StatusDot"}
lanes:
  - "app/src/components/Dialog/**"
  - "app/src/components/Toast/**"
external_requires: []

# Subtask 3 — Collections: List and Card (BLOCKED by #1)
provides:
  - {kind: "file", path: "app/src/components/List/List.tsx"}
  - {kind: "symbol", path: "app/src/components/List/List.tsx", name: "List"}
  - {kind: "file", path: "app/src/components/List/List.css"}
  - {kind: "file", path: "app/src/components/List/List.test.tsx"}
  - {kind: "symbol", path: "app/src/components/List/List.states.tsx", name: "states"}
  - {kind: "file", path: "app/src/components/Card/Card.tsx"}
  - {kind: "symbol", path: "app/src/components/Card/Card.tsx", name: "AgentCard"}
  - {kind: "symbol", path: "app/src/components/Card/Card.tsx", name: "TaskCard"}
  - {kind: "file", path: "app/src/components/Card/Card.css"}
  - {kind: "file", path: "app/src/components/Card/Card.test.tsx"}
  - {kind: "symbol", path: "app/src/components/Card/Card.states.tsx", name: "states"}
requires:
  - {from: "1", kind: "symbol", path: "app/src/components/StatusDot/StatusDot.tsx", name: "StatusDot"}
  - {from: "1", kind: "symbol", path: "app/src/components/Badge/Badge.tsx", name: "Badge"}
  - {from: "1", kind: "symbol", path: "app/src/components/Badge/Badge.tsx", name: "CountPill"}
lanes:
  - "app/src/components/List/**"
  - "app/src/components/Card/**"
external_requires: []

# Subtask 4 — Gallery e2e spec, screenshots and evidence README (BLOCKED by #1, #2, #3)
provides:
  - {kind: "file", path: "app/e2e/components.primitives.spec.ts"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/README.md"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/button-light.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/button-dark.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/badge-light.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/badge-dark.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/input-light.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/input-dark.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/statusdot-light.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/statusdot-dark.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/dialog-light.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/dialog-dark.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/list-light.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/list-dark.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/card-light.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/card-dark.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/toast-light.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/primitives/toast-dark.png"}
requires:
  - {from: "1", kind: "symbol", path: "app/src/components/Input/Input.states.tsx", name: "states"}
  - {from: "2", kind: "symbol", path: "app/src/components/Dialog/Dialog.states.tsx", name: "states"}
  - {from: "2", kind: "symbol", path: "app/src/components/Toast/Toast.states.tsx", name: "states"}
  - {from: "3", kind: "symbol", path: "app/src/components/List/List.states.tsx", name: "states"}
  - {from: "3", kind: "symbol", path: "app/src/components/Card/Card.states.tsx", name: "states"}
  - {from: "3", kind: "symbol", path: "app/src/components/List/List.tsx", name: "List"}
  - {from: "2", kind: "symbol", path: "app/src/components/Dialog/Dialog.tsx", name: "Dialog"}
  - {from: "2", kind: "symbol", path: "app/src/components/Toast/Toast.tsx", name: "ToastStack"}
lanes:
  - "app/e2e/components.primitives.spec.ts"
  - "docs/evidence/phase-5-polish/components/primitives/**"
external_requires:
  - "Electron + @playwright/test already in app/package.json; vite's build() JS API and @vitejs/plugin-react (already devDependencies)"
  - "macOS + Electron available to the worker in its worktree (it runs `PRIMITIVES_EVIDENCE=1 npm run e2e` itself; no human step)"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2 ──┐
Subtask 1 ──→ Subtask 3 ──┼──→ Subtask 4
Subtask 1 ────────────────┘
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (2 imports 1's files read-only) | YES (requires) |
| Subtask 1 | Subtask 3 | none (3 imports 1's files read-only) | YES (requires) |
| Subtask 2 | Subtask 3 | none | NO |
| Subtask 1/2/3 | Subtask 4 | none (4 imports their `*.states.tsx` read-only) | YES (requires) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2, Subtask 3 (parallel)
- **Batch 3:** Subtask 4
- **Recommended workers:** 2
- **Estimated batches:** 3

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| No gallery seam: the shell blocks navigation and `App.tsx`/`vite.config.ts`/`src/screens/` are item 01's (Feasibility (Phase 2.5)) | HIGH | Subtask 4 writes real gallery files under the gitignored `app/node_modules/.cache/components-gallery/` (so bare imports resolve), builds them with Vite's `build()` API and `configFile: false`, and launches a throwaway Electron main from a temp dir; nothing outside Touches changes. A module-resolution error is a setup bug to fix, not a reason to stop; only if the approach is impossible in CI does the worker stop and say so in the PR (never add a screen or edit vite.config). |
| ~50 created files exceed one worker's bound (Feasibility (Phase 2.5), check 4) | MEDIUM | Split into 4 subtasks by component group (`context-bound`); the shared `<Name>.states.tsx` + Containment contract is fixed in this brief so the lanes stay independent. |
| One-page gallery: open dialogs, overlays and fixed toasts would cover each other and trap the keyboard | MEDIUM | Containment rule on every `states` entry (Dialog `inline`, toast/band in a transform frame, no timers); live behaviour only in Subtask 4's demos. |
| vitest 5 empties `*.css?raw` imports (`vitest:css-disable` with default `css.include: []`), and `app/vite.config.ts` can't be edited | HIGH | CSS source checks (AC7, AC9) read files with `readFileSync` in test files only (`/// <reference types="node" />`), assert the text is non-empty, and AC9 is re-checked in the real renderer by Subtask 4. |
| Screenshot runs dirty tracked evidence in CI or later lanes | LOW | The spec writes to `docs/evidence/…` only under `PRIMITIVES_EVIDENCE=1`; otherwise to Playwright's output dir. |
| Destructive-Escape mismatch: requirement Scope 2 says Escape does not close a destructive confirm, while Dialog README says "`Esc` cancels" and `preview.html`'s "Kill everything?" shows `Cancel Esc` | MEDIUM | Follow the requirement (the later, binding owner scope). Do not show an `Esc` kbd chip on a destructive Cancel that Escape doesn't trigger, and record the mismatch as an owner finding in the evidence README. |
| Avatar (item 09) is built in parallel and not on `main` (Feasibility (Phase 2.5)) | MEDIUM | Card, List Crew rows and Badge chip take an `avatar?: ReactNode` slot; never import `app/src/components/Avatar/`. The gallery uses a token-coloured placeholder circle at the right size and the evidence README says so. |
| No icon library and no new dependency allowed (Feasibility (Phase 2.5)) | MEDIUM | Icon props are `ReactNode` slots; built-in glyphs are CSS or inline `currentColor` SVG (no hex). If a Lucide set turns out to be required, stop and say so. |
| jsdom has no layout, so scroll anchoring and no-shift toasts can't be proven in unit tests alone | MEDIUM | Unit tests stub `scrollHeight`/`offsetTop`/`getBoundingClientRect`; the real assertions (AC2, AC6) run in the Electron renderer in Subtask 4. |
| Screenshots differ between macOS and the ubuntu CI run (fonts) | LOW | The spec asserts behaviour, never pixel-diffs; committed PNGs are the Subtask 4 worker's macOS run, with the command named in the evidence README. |
| A lane finds item 01's contract (tokens, test rig, CI e2e step) doesn't fit | MEDIUM | Stop and say so in the PR rather than changing the contract (requirement Risks). |
| Parallel wave items 09–12 also create under `app/src/components/` and `docs/evidence/phase-5-polish/components/` | LOW | Disjoint subdirectories by Touches (`Avatar/`, `ChatBubble/`…, `conversation/`); this item creates no shared file (no barrel, no shared helper). |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 3
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-22-app-primitives-components.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-22T06:00:04Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/114
- **Branch:** feature/app-primitives-components
- **Files changed:** 50
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Eight primitives (Button, Badge, StatusDot, Input, Dialog, Toast, List, Card) built under app/src/components/ with unit tests, a Playwright Electron gallery spec, and 16 light/dark screenshots plus an evidence README. Resumed session: the prior run parked at the FINALIZE children check because the Worker Results headings carried labels instead of agent ids. The ids were corrected, all four workers were confirmed settled, and the run pushed and opened PR #114. Phase 4.5 took 3 review→fix rounds: 7 issues fixed in 41b3df7, then 3 in d7648d9, then 1 in 5cb6453. The 3rd review passed with one MEDIUM at the fix floor. Its fix (5cb6453) was not re-reviewed because it came on the final iteration, so the outcome is escalated. The until-mergeable drain was not dispatched: auto_review is false and the owning /automate run drives its own drain.

## Not verified
- **components.primitives.spec.ts on ubuntu CI under xvfb-run** — only run on macOS so far (subtask 4)
- **Composer six-line growth in a real renderer** — CSS only (subtask 1)
- **light/dark rendering of the four leaf components** — Subtask 4 covers (subtask 1)
- **Dialog/ToastStack in real Electron renderer** — Subtask 4 e2e (subtask 2)
- **List scroll anchoring in real Electron renderer** — Subtask 4 (subtask 3)
- **List/Card light/dark rendering and focus ring** — Subtask 4 (subtask 3)
