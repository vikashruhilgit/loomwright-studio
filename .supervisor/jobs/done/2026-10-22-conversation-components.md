# Supervisor Job: Build the conversation components (ChatBubble, EventCard, Charter, DiffView, StreamingLog) exactly as the design system specifies

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-22-023903/L3
- **CLAUDE.md:** ✓ Found (fresh: names `kernel/`, `docs/`, invariants; `app/` exists since item 01 merged)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140010-conversation-components-chatbubble-eventcard-charter-diffview-streaminglog.md
- **Base commit:** 58c2e4cad24d521b0880f36b9d0f22690847a9b8

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | `app/` is Electron + React 19 + TS + Vite with vitest + RTL (jsdom via `// @vitest-environment jsdom`) and Playwright, all installed by item 01 (`app/package.json`). |
| 2 | Dependency Availability | CAUTION | No icon or markdown library is installed (`app/package.json` has no `lucide*`, no markdown parser), and new npm dependencies are forbidden by the requirement. EventCard's 14px Lucide icons are drawn as inline SVG copied from `docs/design/design-system/components/EventCard/preview.html`; ChatBubble renders text without a markdown library. |
| 3 | Architecture Fit | CAUTION | The primitives this design composes (Avatar, item 09; Badge, Button, StatusDot, Dialog, item 08) are built by sibling lanes in the same wave and do not exist at the base commit (`app/src/components/` is absent). Item 10 must not import or create them; it exposes slots and uses native elements (see Risk Assessment). |
| 4 | Scope vs Supervisor Capability | GO | 5 components × (component, CSS, test, gallery) + e2e spec + evidence ≈ 23 files and well over 800 lines, so a `context-bound` split into 4 subtasks with disjoint lanes. |
| 5 | Hard Blockers | CAUTION | No component-gallery entry exists and the app window only loads `dist/index.html` and blocks navigation (`app/electron/main.ts`: `event.preventDefault()` on `will-navigate`), so the e2e spec must bring its own harness inside its Touches. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Build ChatBubble, EventCard, Charter, DiffView and StreamingLog once, each in `app/src/components/<Name>/`, matching its design-system README and `preview.html` in light and dark mode, safe with untrusted kernel text, WCAG 2.1 AA, with a Playwright evidence page and committed screenshots.

**Problem Statement:**
The owner needs the approved conversation components built once, exactly as the design system specifies, because every phase 5 screen (items 13–16) composes them and must pass its polish gate.
Currently, none is built: `app/src/components/` does not exist, and the specs live only in `docs/design/design-system/components/<Name>/README.md` + `preview.html`, tokens in `app/src/styles/tokens.css` (generated), rules in `docs/design/brand-book.md`. This blocks the screen items.
Success looks like five importable components (by path, no barrel file) whose tests prove each README rule, an e2e page that renders every state, and light/dark screenshots committed under `docs/evidence/phase-5-polish/components/conversation/`.

## Acceptance Criteria
- [ ] AC1 — Given each component's README states, when its test (`app/src/components/<Name>/<Name>.test.tsx`) renders them, then each state matches the README's rules: variants, sizes, disabled, focus, empty and error where specified. Per component at minimum:
  - ChatBubble: Wright/specialist left on `surface` with `hairline` edge vs user right on `accent-soft` with no edge (asserted by class/data attribute); 520px max width; speaker + time caption; the optional playbook-draft card shows name, runs-as agent, key/value block (trigger, action, dedupe key, model, approval level), the dry-run line in `mono` (never behind a disclosure), and Enable / Edit in English / Edit fields calling their handlers; with `streaming` the meta line reads "streaming" and a static caret marks the live end.
  - EventCard: event line with `role="status"`, one icon per kind (session started/stopped/killed, playbook created/changed, agent created/renamed, memory updated with its path in `mono`, approval decided, hook applied/verified), tabular timestamp, and the subject activating the link handler; inline approval with `attention` edge, summary, reason, Allow once (`A`), Always (`⇧A`), Deny (`D`) and Full payload calling their handlers.
  - Charter: sections Identity, Persona, Duties, Tools, Boundaries, Model, Limits and the first playbook's dry run; Create (`⏎`), Edit in English (`E`) and a "Shape" button (the shape picker's trigger) call `onCreate` / `onEditInEnglish` / `onPickShape`; the picker dialog itself, which shows Avatar silhouettes, is the Team screen's (item 14); boundaries always rendered.
  - DiffView: file header with path in `mono`, scope label, +/− counts; hunk headers; two line-number gutters with `user-select: none`; added/deleted/context lines; no hunk collapsed; horizontal scroll inside the diff only; an `onRendered` callback fires once the hunks are in the DOM (the approval's Allow gate).
  - StreamingLog: header with status slot, agent, task, running time, tokens (tabular), and an optional `cost` shown only as an estimate labelled "≈ at API rates" (the AC6 rule; never a limit), omitted when not passed; Stop and Kill buttons calling `onStop` / `onKillRequest`; line kinds tool (`▸` prefix in `accent`), output, prose, error, ok; static block caret; `role="log"` with `aria-live="off"`; "Read latest" announces the last line through a polite live region; status changes announced politely.
- [ ] AC2 — Given a ChatBubble whose text is `<img src=x onerror=alert(1)>` or a `javascript:alert(1)` link (raw or as markdown `[x](javascript:alert(1))`), when it renders, then the text appears literally and the container has no `img` element and no `a[href^="javascript:"]` (no element with an `href` built from message text at all); the same `<img …>` string passed to EventCard, Charter, DiffView and StreamingLog also renders as inert text.
- [ ] AC3 — Given each component's source (`<Name>.tsx` only; `*.test.tsx` and `*.gallery.tsx` are not scanned), when the test suite runs, then it contains neither `dangerouslySetInnerHTML` nor `innerHTML` (a test in that folder reads the file and asserts it; the test builds its needles by concatenation so it never matches itself).
- [ ] AC4 — Given StreamingLog with the reader scrolled up (scrollTop below max), when 50 lines arrive, then `scrollTop` is unchanged and the pill reads "Jump to latest"; given the reader at the bottom, when lines arrive, then the view stays pinned to the bottom and the pill reads "Following"; activating "Jump to latest" returns to the bottom and resumes following. Lines append with no CSS transition or animation.
- [ ] AC5 — Given a Charter (or a ChatBubble playbook draft) whose model was chosen by Wright, then the model shows a `proposed` tag in `ink-tertiary`; the same holds for each other value marked as Wright's choice (name, limits), and a value the user set shows no tag.
- [ ] AC6 — Given a Charter with a tool whose connector is not connected, then the tool is listed with "not connected" (never hidden); given Limits, then they show tokens per day and sessions at once, and any dollar figure the caller passes is labelled "≈ at API rates" and never as a budget or limit.
- [ ] AC7 — Given an EventCard inline approval whose requesting agent is not the thread's agent, then nothing is rendered for it.
- [ ] AC8 — Given dark mode, then every component uses the dark tokens, with no hard-coded colour: a test in each component folder reads exactly `<Name>.css` and `<Name>.tsx` (never `*.test.tsx` or `*.gallery.tsx`) and fails on any hex colour literal (`#rgb`, `#rrggbb`, `#rrggbbaa`) in a CSS declaration value or a `style` object, any `rgb(`/`rgba(`/`hsl(`/`hsla(` literal, or a named colour keyword in a CSS colour property value other than `transparent`/`currentColor`/`inherit`; JSX text is not scanned. Colours come only from `tokens.css` variables. The test also proves its matcher on an inline positive sample (`color: #ffffff`) and negative sample (`PR #401` text).
- [ ] AC9 — Given keyboard only, then every interactive control in each component is a native `button` (or link-role element) reachable by Tab in DOM order, operable by Enter/Space, has an accessible name (the icon-only ones via `aria-label`), and shows a visible `:focus-visible` ring using `var(--focus)`; under `prefers-reduced-motion` nothing in these components moves. Proven two ways, because jsdom applies no CSS: RTL tests assert Tab order, names and Enter/Space activation, and a CSS-file assertion in each folder checks `<Name>.css` has a `:focus-visible` rule using `var(--focus)` and no `transition`/`animation` outside `@media (prefers-reduced-motion: no-preference)`; AC10 tabs through each gallery in Electron and screenshots one focused control per component.
- [ ] AC10 — Given the Playwright page `app/e2e/components.conversation.spec.ts`, when it runs (`cd app && npx playwright test e2e/components.conversation.spec.ts`), then it renders every state from the five galleries in Electron, checks AC2's inert rendering and AC4's scroll behaviour in a real layout engine, and writes one screenshot per component state in light and dark mode (`data-theme="light"` / `"dark"`) under `docs/evidence/phase-5-polish/components/conversation/`.
- [ ] AC11 — Given the committed evidence, then a committed evidence file `docs/evidence/phase-5-polish/components/conversation/README.md` lists every screenshot with the `preview.html` it matches, the command that produced them, and every mismatch found between a README and its `preview.html` (a finding for the owner, not a redesign), and the PR body links to it.
- [ ] AC12 — `cd app && npm ci && npm run typecheck && npm test && npm run build` passes, and the screenshots are committed.

## File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| ChatBubble + Charter | — | `app/src/components/ChatBubble/{ChatBubble.tsx,ChatBubble.css,ChatBubble.test.tsx,ChatBubble.gallery.tsx}`, `app/src/components/Charter/{Charter.tsx,Charter.css,Charter.test.tsx,Charter.gallery.tsx}` | HIGH |
| EventCard + DiffView | — | `app/src/components/EventCard/{EventCard.tsx,EventCard.css,EventCard.test.tsx,EventCard.gallery.tsx}`, `app/src/components/DiffView/{DiffView.tsx,DiffView.css,DiffView.test.tsx,DiffView.gallery.tsx}` | HIGH |
| StreamingLog | — | `app/src/components/StreamingLog/{StreamingLog.tsx,StreamingLog.css,StreamingLog.test.tsx,StreamingLog.gallery.tsx}` | HIGH |
| Evidence | — | `app/e2e/components.conversation.spec.ts`, `docs/evidence/phase-5-polish/components/conversation/README.md`, `docs/evidence/phase-5-polish/components/conversation/*.png` | HIGH (spec, README) / MEDIUM (screenshot count) |

All paths are new: `app/src/components/` and `docs/evidence/phase-5-polish/` do not exist at the base commit; their parents `app/src/` and `docs/evidence/` do. No existing file is modified.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | ChatBubble + Charter (chat turn, playbook draft, charter form) | AC1 (ChatBubble, Charter), AC2, AC3, AC5, AC6, AC8, AC9, AC12 | 0 modify, 8 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | EventCard + DiffView (timeline events, inline approval, diff) | AC1 (EventCard, DiffView), AC2, AC3, AC7, AC8, AC9, AC12 | 0 modify, 8 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 3 | StreamingLog (live session output) | AC1 (StreamingLog), AC2, AC3, AC4, AC8, AC9, AC12 | 0 modify, 4 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 4 | Evidence page, screenshots and evidence README | AC10, AC11, AC12 | 0 modify, 2 create + screenshots | `skills/playwright-e2e/SKILL.md` | BLOCKED (by #1, #2, #3) |

**Per-component file shape (subtasks 1–3):** `app/src/components/<Name>/<Name>.tsx` (named export `<Name>` plus its props type `<Name>Props`), `<Name>.css` (imported by the component; only `var(--…)` from `tokens.css`), `<Name>.test.tsx` (`// @vitest-environment jsdom`, RTL), and `<Name>.gallery.tsx` exporting `galleryStates: readonly { id: string; title: string; element: ReactElement }[]` — every README/preview state with canned data, including the `<img src=x onerror=alert(1)>` string. Galleries are never imported by `App.tsx`, so they stay out of the app bundle. No barrel file. Source-reading tests (AC3, AC8, AC9) read files through Vite `?raw` imports (`import css from "./<Name>.css?raw"`, `import src from "./<Name>.tsx?raw"`, typed by `vite/client`), not `node:fs`, so `app/tsconfig.json` needs no Node types.

**Composition rule (sibling lanes):** Avatar (item 09), Badge, Button, StatusDot and Dialog (item 08) are built in parallel lanes and are absent at the base commit. Do not import them and do not create anything in their folders. ChatBubble and Charter take the avatar as a `ReactNode` slot (`avatar`), StreamingLog takes its status indicator as a `ReactNode` slot (`status`), DiffView renders the scope as its own token-styled label, and in-component actions are native `<button>` elements styled in the component's own CSS. Kill's confirmation dialog belongs to the Sessions screen (item 16): StreamingLog's Kill calls `onKillRequest` and never kills by itself. Swapping in the primitives later is a screen-item follow-up, noted in the AC11 evidence README.

**Data shapes:** the components are presentational. They may import types from `app/src/api/contract.ts` (read-only, item 01's) but take README-level props: StreamingLog's line `kind` is the README's `tool | output | prose | error | ok` (mapping `SessionOutputKind` rows onto it is item 16's job); EventCard's kind is the README's six kinds; its inline approval takes `{ id, requestingAgent, summary, reason }` plus `threadAgent` and the four handlers. Every string from the kernel is rendered as a React text child.

**ChatBubble body:** render the body as plain text with paragraph and line breaks (an optional safe subset of inline code and bold may be built as React elements); no element's `href` is ever built from message text, so a `javascript:` link stays text.

## Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "app/src/components/ChatBubble/ChatBubble.tsx"}
  - {kind: "symbol", path: "app/src/components/ChatBubble/ChatBubble.tsx", name: "ChatBubble"}
  - {kind: "type", path: "app/src/components/ChatBubble/ChatBubble.tsx", name: "ChatBubbleProps"}
  - {kind: "file", path: "app/src/components/ChatBubble/ChatBubble.css"}
  - {kind: "file", path: "app/src/components/ChatBubble/ChatBubble.test.tsx"}
  - {kind: "file", path: "app/src/components/ChatBubble/ChatBubble.gallery.tsx"}
  - {kind: "symbol", path: "app/src/components/ChatBubble/ChatBubble.gallery.tsx", name: "galleryStates"}
  - {kind: "file", path: "app/src/components/Charter/Charter.tsx"}
  - {kind: "symbol", path: "app/src/components/Charter/Charter.tsx", name: "Charter"}
  - {kind: "type", path: "app/src/components/Charter/Charter.tsx", name: "CharterProps"}
  - {kind: "file", path: "app/src/components/Charter/Charter.css"}
  - {kind: "file", path: "app/src/components/Charter/Charter.test.tsx"}
  - {kind: "file", path: "app/src/components/Charter/Charter.gallery.tsx"}
  - {kind: "symbol", path: "app/src/components/Charter/Charter.gallery.tsx", name: "galleryStates"}
requires: []
lanes:
  - "app/src/components/ChatBubble/**"
  - "app/src/components/Charter/**"
external_requires:
  - "item 01 scaffold at base: app/src/styles/tokens.css, vitest + @testing-library/react + jsdom (installed)"

# Subtask 2
provides:
  - {kind: "file", path: "app/src/components/EventCard/EventCard.tsx"}
  - {kind: "symbol", path: "app/src/components/EventCard/EventCard.tsx", name: "EventCard"}
  - {kind: "type", path: "app/src/components/EventCard/EventCard.tsx", name: "EventCardProps"}
  - {kind: "file", path: "app/src/components/EventCard/EventCard.css"}
  - {kind: "file", path: "app/src/components/EventCard/EventCard.test.tsx"}
  - {kind: "file", path: "app/src/components/EventCard/EventCard.gallery.tsx"}
  - {kind: "symbol", path: "app/src/components/EventCard/EventCard.gallery.tsx", name: "galleryStates"}
  - {kind: "file", path: "app/src/components/DiffView/DiffView.tsx"}
  - {kind: "symbol", path: "app/src/components/DiffView/DiffView.tsx", name: "DiffView"}
  - {kind: "type", path: "app/src/components/DiffView/DiffView.tsx", name: "DiffViewProps"}
  - {kind: "file", path: "app/src/components/DiffView/DiffView.css"}
  - {kind: "file", path: "app/src/components/DiffView/DiffView.test.tsx"}
  - {kind: "file", path: "app/src/components/DiffView/DiffView.gallery.tsx"}
  - {kind: "symbol", path: "app/src/components/DiffView/DiffView.gallery.tsx", name: "galleryStates"}
requires: []
lanes:
  - "app/src/components/EventCard/**"
  - "app/src/components/DiffView/**"
external_requires:
  - "item 01 scaffold at base: app/src/styles/tokens.css, vitest + @testing-library/react + jsdom (installed)"

# Subtask 3
provides:
  - {kind: "file", path: "app/src/components/StreamingLog/StreamingLog.tsx"}
  - {kind: "symbol", path: "app/src/components/StreamingLog/StreamingLog.tsx", name: "StreamingLog"}
  - {kind: "type", path: "app/src/components/StreamingLog/StreamingLog.tsx", name: "StreamingLogProps"}
  - {kind: "file", path: "app/src/components/StreamingLog/StreamingLog.css"}
  - {kind: "file", path: "app/src/components/StreamingLog/StreamingLog.test.tsx"}
  - {kind: "file", path: "app/src/components/StreamingLog/StreamingLog.gallery.tsx"}
  - {kind: "symbol", path: "app/src/components/StreamingLog/StreamingLog.gallery.tsx", name: "galleryStates"}
requires: []
lanes:
  - "app/src/components/StreamingLog/**"
external_requires:
  - "item 01 scaffold at base: app/src/styles/tokens.css, vitest + @testing-library/react + jsdom (installed)"

# Subtask 4
provides:
  - {kind: "file", path: "app/e2e/components.conversation.spec.ts"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/conversation/README.md"}
requires:
  - {from: "1", kind: "symbol", path: "app/src/components/ChatBubble/ChatBubble.gallery.tsx", name: "galleryStates"}
  - {from: "1", kind: "symbol", path: "app/src/components/Charter/Charter.gallery.tsx", name: "galleryStates"}
  - {from: "2", kind: "symbol", path: "app/src/components/EventCard/EventCard.gallery.tsx", name: "galleryStates"}
  - {from: "2", kind: "symbol", path: "app/src/components/DiffView/DiffView.gallery.tsx", name: "galleryStates"}
  - {from: "3", kind: "symbol", path: "app/src/components/StreamingLog/StreamingLog.gallery.tsx", name: "galleryStates"}
lanes:
  - "app/e2e/components.conversation.spec.ts"
  - "docs/evidence/phase-5-polish/components/conversation/**"
external_requires:
  - "Electron binary downloaded by npm ci (CI has its own Download Electron step); macOS display for local screenshots"
```

**Subtask 4 harness (all inside its own spec file):** start a Vite dev server programmatically from the spec (`createServer` from `vite`, root `app/`, with an inline plugin that serves a gallery HTML page whose module imports `src/styles/tokens.css`, `src/styles/app.css` and the five `*.gallery.tsx` files), write a throwaway Electron main script to `os.tmpdir()` that opens a `BrowserWindow` on that URL, and `electron.launch` it. Toggle themes by setting `document.documentElement.dataset.theme`. The spec never imports `*.gallery.tsx` or anything under `src/` (it is typechecked by `app/tsconfig.node.json`, which has no `jsx`): the served page renders each state in a wrapper carrying `data-state-id="<Component>/<id>"`, and the spec enumerates states and names screenshots from those DOM attributes. Close the server and the app in `afterAll`. If this cannot be made to work without editing a file outside the lanes (for example `app/electron/main.ts`, `app/package.json`, `app/vite.config.ts` or `.github/workflows/ci.yml`, all item 01's), stop and say so rather than editing it. The spec runs in CI under the existing `npm run e2e` step, so it must not depend on a built `dist/`.

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 4
Subtask 2 ──→ Subtask 4
Subtask 3 ──→ Subtask 4
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |
| Subtask 1 | Subtask 3 | none | NO |
| Subtask 2 | Subtask 3 | none | NO |
| Subtask 1–3 | Subtask 4 | none (4 only imports the galleries) | YES (requires) |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2, Subtask 3 (parallel — empty `requires`, disjoint lanes)
- **Batch 2:** Subtask 4 (after 1, 2 and 3)
- **Recommended workers:** 3
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` |
| 3 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` |
| 4 | `skills/playwright-e2e/SKILL.md` |

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/components/ChatBubble/ChatBubble.test.tsx` — `<img src=x onerror=alert(1)>` renders as text | render the body through `dangerouslySetInnerHTML={{ __html: body }}` in `ChatBubble.tsx` → the test finds an `img` and fails |
| `app/src/components/ChatBubble/ChatBubble.test.tsx` — `javascript:` link stays inert | wrap a link-looking token in `<a href={token}>` in `ChatBubble.tsx` → an `a[href^="javascript:"]` exists and the test fails |
| `app/src/components/StreamingLog/StreamingLog.test.tsx` — scrolled-up reader keeps `scrollTop` after 50 lines | drop the "is the reader at the bottom" check so every append sets `scrollTop = scrollHeight` → `scrollTop` changes and the test fails |
| `app/src/components/Charter/Charter.test.tsx` — Wright-chosen model shows `proposed` | delete the `proposed` tag render for the Model row in `Charter.tsx` → the test fails |
| `app/src/components/Charter/Charter.test.tsx` — not-connected tool is listed | filter tools to `connected === true` in `Charter.tsx` → the tool is missing and the test fails |
| `app/src/components/EventCard/EventCard.test.tsx` — another agent's approval renders nothing | delete the `requestingAgent !== threadAgent` early return in `EventCard.tsx` → the card renders and the test fails |
| `app/src/components/Charter/Charter.test.tsx` — a passed dollar figure carries "≈ at API rates" (D24) | render the cost without its "≈ at API rates" label in `Charter.tsx` → the test fails |
| `app/src/components/StreamingLog/StreamingLog.test.tsx` — a passed cost carries "≈ at API rates" | render the cost without its label in `StreamingLog.tsx` → the test fails |
| `app/src/components/DiffView/DiffView.test.tsx` — `onRendered` fires only once the hunks are in the DOM (the approval's Allow gate) | call `onRendered` before the hunk rows render (or delete the call) in `DiffView.tsx` → the test fails |
| `app/src/components/EventCard/EventCard.test.tsx` — `<img src=x onerror=alert(1)>` in event text is inert | render the event text through `dangerouslySetInnerHTML` in `EventCard.tsx` → an `img` exists and the test fails |
| `app/src/components/Charter/Charter.test.tsx` — `<img …>` in persona/duty text is inert | render persona text through `dangerouslySetInnerHTML` in `Charter.tsx` → the test fails |
| `app/src/components/DiffView/DiffView.test.tsx` — `<img …>` in a diff line is inert | render line text through `dangerouslySetInnerHTML` in `DiffView.tsx` → the test fails |
| `app/src/components/StreamingLog/StreamingLog.test.tsx` — `<img …>` in a log line is inert | render line text through `dangerouslySetInnerHTML` in `StreamingLog.tsx` → the test fails |
| `app/src/components/StreamingLog/StreamingLog.test.tsx` — "Jump to latest" returns to the bottom and resumes following | delete the scroll-to-bottom in the Jump-to-latest handler in `StreamingLog.tsx` → `scrollTop` stays and the test fails |
| `app/src/components/ChatBubble/ChatBubble.test.tsx` — the draft's Wright-chosen model shows `proposed`, a user-set value shows none | delete the `proposed` tag render for the draft's model in `ChatBubble.tsx` → the test fails |
| `app/src/components/StreamingLog/StreamingLog.test.tsx` — at the bottom, new lines keep the view pinned and the pill reads "Following" | skip the scroll-to-bottom when the reader is at the bottom in `StreamingLog.tsx` → `scrollTop` lags and the test fails |
| `app/src/components/StreamingLog/StreamingLog.test.tsx` — `role="log"` with `aria-live="off"` | flip `aria-live="off"` → `aria-live="polite"` in `StreamingLog.tsx` → the test fails |
| `app/src/components/StreamingLog/StreamingLog.test.tsx` — "Read latest" puts the last line in the polite live region | delete the write of the last line into the live region in `StreamingLog.tsx` → the test fails |
| each `<Name>.test.tsx` — AC9 CSS-file check: `:focus-visible` uses `var(--focus)` | delete the `:focus-visible` rule in that folder's `<Name>.css` → the test fails |
| each `<Name>.test.tsx` — AC9 CSS-file check: no motion outside `prefers-reduced-motion: no-preference` | add `transition: opacity 120ms;` to a top-level rule in that folder's `<Name>.css` → the test fails |
| each `<Name>.test.tsx` — no hex/rgb colour literal in `<Name>.css`/`<Name>.tsx` | add `color: #ffffff;` to that folder's `<Name>.css` → the test fails |
| each `<Name>.test.tsx` — no `dangerouslySetInnerHTML`/`innerHTML` | add an unused `dangerouslySetInnerHTML` prop to that folder's component → the test fails |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): sibling primitives (Avatar item 09; Badge, Button, StatusDot, Dialog item 08) are built in parallel lanes and are absent at the base commit | MEDIUM | Never import them or touch their folders; use `ReactNode` slots (avatar, status) and native token-styled `<button>`s; Kill calls `onKillRequest` and the screen confirms with Dialog. Note the later swap to primitives in the evidence README. |
| Feasibility (Phase 2.5): no icon or markdown library, and new npm dependencies are forbidden | MEDIUM | Inline SVG icons copied from `EventCard/preview.html` (stroke `currentColor`); ChatBubble renders text and an optional hand-built safe subset. If a dependency proves unavoidable, stop and say so. |
| Feasibility (Phase 2.5): no component-gallery entry; the app window blocks navigation and loads only `dist/index.html` | HIGH | Subtask 4 brings a spec-local Vite + temporary Electron main harness (see Subtask 4 harness). If it needs an item 01 file, stop and say so instead of editing it. |
| The hex-literal grep is a false positive on text like `PR #401` in fixtures, or misses colours in inline `style` objects | MEDIUM | Scope the grep to CSS property values and style objects, not JSX text; test the grep itself against one positive (`#ffffff`) and one negative (`PR #401`) sample. |
| `preview.html` or README carries values the D24 rule or the tokens forbid (e.g. `EventCard/preview.html` `.kbd` uses `#ffffff33`; `Charter/preview.html` dry run shows `≈$0.08/run` without "at API rates"; `StreamingLog/README.md` puts "cost" in the header unlabelled) | MEDIUM | Follow the README, tokens and D24: cost/dollars only as an optional estimate labelled "≈ at API rates". Record each mismatch in the AC11 evidence README as a finding for the owner, never as a redesign. |
| jsdom has no layout, so StreamingLog's scroll tests can pass while real scrolling fails | MEDIUM | Unit tests stub `scrollHeight`/`clientHeight`/`scrollTop`; AC10 re-checks the scrolled-up and pinned behaviour in Electron. |
| Global keyboard shortcuts (A, ⇧A, D, ⏎, E, ⌘.) collide with the ⌘K/keyboard-map lane (item 11) | MEDIUM | Components show the shortcut hints and handle keys only while focus is inside the component (keydown on the card/form); the global keymap stays item 11's. |
| A sibling lane (08/09) adds its own hex-grep or gallery convention that differs | LOW | Each lane's tests are folder-local; nothing shared is created, so the conventions can be reconciled later without conflicts. |
| Screenshots generated on macOS differ from CI fonts | LOW | Screenshots are evidence, not visual-regression baselines; the spec never compares pixels. |

## Configuration
- **Workers:** 3
- **Mode:** parallel
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-22-conversation-components.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-22T05:21:00Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/113
- **Branch:** feature/conversation-components
- **Files changed:** 105
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Five conversation components (ChatBubble, Charter, EventCard, DiffView, StreamingLog) plus galleries, RTL tests, an Electron Playwright evidence spec and 82 light/dark screenshots with an evidence README. Three heal rounds fixed: Node types leaking into the src typecheck, the DiffView onRendered gate not re-arming (now keyed on path+scope+hunks), and the D24 estimate format (shared formatEstimate.ts, negatives and non-finite values omitted). The last fix (ad55904, -0 test pins, test-only) was not re-reviewed. Supervisor re-ran AC12 (typecheck, 164 tests, build) and the e2e spec (7/7) on the merged tree before the PR; the fixers report 173 tests passing at the final head; CI was green at each read.

## Not verified
- **Electron light/dark render; native Enter/Space** — covered later by subtask 4's Electron spec, not in jsdom (subtask 1)
- **Electron light/dark render** — covered by subtask 4's spec (subtask 2)
- **real scroll pinning; native activation/focus ring; light/dark render** — covered by subtask 4's spec (subtask 3)
- **spec under Linux CI/xvfb** — at the reviewer's iteration-1 read the PR's `app` CI job showed SUCCESS; not run locally on Linux (subtask 4)
