# Supervisor Job: Shell — one Back crumb and the in-content icon set (phase 7 item 21)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-01-171537/L2
- **CLAUDE.md:** ✓ Found (fresh — `kernel/` and `app/` layout, `npm` scripts and the `docs/` table all match the tree)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-7/2026-11-01-090021-shell-one-back-crumb-and-the-in-content-icon-set.md
- **Base commit:** 59275c832a77f65975ebdf020e34a3dcc552519a

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React 19 + TypeScript + vitest (jsdom) + Playwright/Electron, all present in `app/package.json`. React 19 takes `ref` as a prop, as `Button` (`ComponentPropsWithRef<"button">`) already does. |
| 2 | Dependency Availability | GO | No new dependency: the icons are inline SVG paths copied from `docs/design/mockups/gui-v2.html`'s `const I={` map, rendered through the existing `app/src/components/Glyph.tsx`. |
| 3 | Architecture Fit | GO | Shared UI lives in `app/src/shell/` (shell parts) and `app/src/components/` (primitives). `Glyph` already sets the idiom this follows: "The component carries no CSS of its own; the caller passes the class its screen styles". |
| 4 | Scope vs Supervisor Capability | GO | One worker: 4 creates + 3 code modifies + 1 evidence README + 4 re-taken PNGs, well under the `context-bound` bound; no split reason fires. |
| 5 | Hard Blockers | CAUTION | The requirement's `## Touches` does not list `docs/evidence/phase-7-polish/budget/`, but its Scope 3 ("The PR commits screenshots from the running app … each named against its `gui-v2.html` view") requires re-taking `budget-audit-*.png` and `budget-audit-filtered-*.png` there and updating that README, which `app/e2e/budget.spec.ts`'s AC9 test reads. The brief includes exactly those files and nothing else outside Touches. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Build one shared Back crumb (`app/src/shell/Crumb.tsx`, drawn "‹ Parent / Current") and one shared set of the mockup's in-content icons (`app/src/components/icons/`, rendered through `Glyph`), and adopt the crumb in Budget's audit log only.

**Problem Statement:**
The owner needs one Back control and one set of the mockup's in-content icons, built once, because Tasks, Playbooks and Memory each adopt them in their own (parallel) items and every click-through view must read the same.
Currently each screen draws its own crumb (Budget's audit log reads "‹ Back · Budget & audit / Audit log", Tasks "Back / Tasks / Task #1", Playbooks "Playbooks / <name>"), and the in-content icons (`gui-v2.html`'s `I` map: chat, pen, hist, mem, team, list, term, book) exist only as per-screen copies (`app/src/shell/Sidebar.tsx` `NAV_GLYPHS`, `app/src/screens/budget/parts.tsx` `HistoryGlyph`/`BackGlyph`) or not at all. This failed the phase 7 polish gate (live re-run 2026-11-01).
Success looks like: Budget's audit log shows "‹ Budget & audit / Audit log" exactly as the mockup's `budget-audit` view does, one keyboard-reachable control named "Back to Budget & audit" returns to the overview, and a unit-tested icon set exists for the three screen items to import, with its props settled here so they don't each reshape it.

## Acceptance Criteria
- [ ] **AC1 — Budget's audit log adopts the crumb.** Given Budget's audit log is open (from the toolbar's Audit log button), when it renders, then its crumb reads "‹ Budget & audit / Audit log" as `gui-v2.html`'s `budget-audit` view draws it: the back chevron icon and "Budget & audit" are one button, a `/` separator is `aria-hidden`, "Audit log" is plain text, and the word "Back" and the "·" separator are no longer drawn; and when that button is activated (click, Enter) the view returns to Budget & audit with focus on the control that opened the log (the Audit log button when opened from the toolbar, "Open the full log" when opened from there). `app/e2e/budget.spec.ts` asserts the crumb's visible text, the absence of "Back" in it, and the focus return to the Audit log button after activating the crumb; its accessible-names loop (`for (const name of ["Back", "Clear filters", "Newer", "Older"])`) names the control exactly as "Back to Budget & audit".
- [ ] **AC2 — the shared crumb is one control with a parent-naming name.** Given the shared crumb `app/src/shell/Crumb.tsx` rendered with `parent="Budget & audit"` and `current="Audit log"`, when a user tabs to it, then exactly one focusable element (a `<button>`) is reached, its accessible name is "Back to Budget & audit" (the visible label "Budget & audit" is inside that name), activating it calls `onBack` once, the chevron is drawn by the shared icon set's `back` icon (decorative, `aria-hidden`), and the current name is not focusable. `app/src/shell/Crumb.test.tsx` asserts each of these.
- [ ] **AC3 — the shared icon set.** Given the shared icon set in `app/src/components/icons/`, then it exports the names `back`, `chat`, `pencil`, `history`, `file`, `shared`, `task`, `session`, `run`, `clock`, each with the path data of its `gui-v2.html` `I` map entry verbatim (`back`=`I.back`, `chat`=`I.chat`, `pencil`=`I.pen`, `history`=`I.hist`, `file`=`I.mem`, `shared`=`I.team`, `task`=`I.list`, `session`=`I.term`, `run`=`I.book`, `clock`=`I.clock`), and each renders through `Glyph` (one `svg` with `viewBox="0 0 24 24"`, `aria-hidden="true"` and the caller's class). `app/src/components/icons/icons.test.tsx` lists the ten names exactly, renders each one, and compares each rendered icon's shape markup (`d`, `cx`/`cy`/`r`, `x`/`y`/`width`/`height`/`rx`) against the `I` map's string for it (for example `back` draws `<path d="m15 18-6-6 6-6">`).
- [ ] **AC4 — polish gate evidence (committed).** Given the running app against the fixture kernel (`app/e2e/electron-harness.ts`), when `cd app && npm run build && BUDGET_EVIDENCE=1 npx playwright test e2e/budget.spec.ts --workers=1` runs on macOS, then the re-taken `budget-audit-light.png`, `budget-audit-dark.png`, `budget-audit-filtered-light.png` and `budget-audit-filtered-dark.png` are committed in `docs/evidence/phase-7-polish/budget/`, and a committed evidence file `docs/evidence/phase-7-polish/budget/README.md` names each against its `gui-v2.html` view (`budget-audit`, `budget-audit-filtered`), says item 21 re-took them, and describes the crumb as "‹ Budget & audit / Audit log" (no "crumb with Back"); its line-3 intro sentence (which says item 17 re-took the audit shots) also names item 21; its Keyboard row says Enter on Audit log opens the log with focus on the crumb (not "on Back") and "the crumb after Open the full log returns focus to that button" (not "Back after …"); and its departure bullet "**\"Back\" is a labelled button before the crumb.**" is removed, because the crumb now matches `budget-audit` (its accessible name "Back to Budget & audit" contains the visible label). Only the four `budget-audit*` PNGs and the README change in that directory: after the evidence run, `git checkout -- ` every other PNG there and confirm with `git status`. The PR body links to that README.
- [ ] **AC5 — validation.** Given the change, then `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e` and `bash scripts/check-docs.sh` pass.

**Non-goals (from the requirement):** adopting the crumb or the icons in Tasks, Playbooks, Memory or Schedules (their own items); moving `Sidebar.tsx`'s `NAV_GLYPHS` or any screen's `parts.tsx` glyph onto the set (outside Touches).

## Implementation notes (settled props — the contract the screen items adopt)

- **`Crumb` (`app/src/shell/Crumb.tsx`)** — `export interface CrumbProps { readonly parent: string; readonly current: string; readonly onBack: () => void; readonly className: string; readonly glyphClassName: string; readonly testId?: string; readonly ref?: Ref<HTMLButtonElement> }` and `export function Crumb(...)`. Renders `<div className={className}>` holding a `Button` (`size="row" variant="ghost"`, `icon={<Icon name="back" className={glyphClassName} />}`, `aria-label` built from the literal `Back to` + parent, `data-testid={testId}`, `ref`, `onClick={onBack}`) whose child is `parent`, then `<span aria-hidden="true">/</span>`, then `<span>{current}</span>`. Like `Glyph`, it carries no CSS of its own: the caller passes its screen's classes (Budget passes `budget-crumb` and `budget-glyph`, whose rules in `budget.css` already match the mockup's `.crumb` / `.crumb .btn`). The literal `Back to` appears exactly once in `Crumb.tsx`. Header comment states the contract and that Tasks, Playbooks and Memory adopt it in their own items.
- **Icon set (`app/src/components/icons/index.tsx`)** — `export const ICON_NAMES` (readonly tuple of the ten names, in AC3 order), `export type IconName = (typeof ICON_NAMES)[number]`, the tuple written one quoted name per line (the literal `"history",` appears exactly once in the file, in `ICON_NAMES`), a module-private `PATHS: Readonly<Record<IconName, ReactNode>>` with bare keys, one per line, and `export function Icon({ name, className }: { readonly name: IconName; readonly className: string })` returning `<Glyph className={className}>{PATHS[name]}</Glyph>`. Paths copied verbatim from the `I` map (`ico('…')` inner markup; `back`'s single `<path d="m15 18-6-6 6-6"/>`).
- **`Glyph.tsx`** — API unchanged (`className` stays required, `aria-hidden="true"` and `viewBox="0 0 24 24"` stay); only its header comment gains one line pointing at `components/icons/` as the shared set.
- **`AuditLog.tsx`** — replace the `budget-crumb` block (the `Button … Back`, `·`, "Budget & audit", `/`, "Audit log" spans) with `<Crumb ref={backRef} className="budget-crumb" glyphClassName="budget-glyph" parent="Budget & audit" current="Audit log" onBack={onBack} testId={IDS.back} />`; drop `BackGlyph` from its `./parts` import (the export in `parts.tsx` stays — that file is outside Touches).

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| shell crumb | — | `app/src/shell/Crumb.tsx`, `app/src/shell/Crumb.test.tsx` | HIGH |
| icon set | `app/src/components/Glyph.tsx` (26 — comment line only) | `app/src/components/icons/index.tsx`, `app/src/components/icons/icons.test.tsx` | HIGH |
| budget adoption | `app/src/screens/budget/AuditLog.tsx` (319), `app/e2e/budget.spec.ts` (742 — appended to the existing audit-log keyboard test, the spec that is the single e2e and evidence authority for this screen) | — | HIGH |
| polish evidence | `docs/evidence/phase-7-polish/budget/README.md` (101), `docs/evidence/phase-7-polish/budget/budget-audit-light.png`, `budget-audit-dark.png`, `budget-audit-filtered-light.png`, `budget-audit-filtered-dark.png` (re-taken binaries) | — | HIGH |

**Module layout (`skills/supervisor-readiness/SKILL.md` §"Module layout"):** each new responsibility has one CREATE home — the crumb in `app/src/shell/Crumb.tsx`, the icon set in `app/src/components/icons/index.tsx`, each with its own test file. `app/e2e/budget.spec.ts` (742) is past the threshold; the crumb assertions append to it because it is the one spec that drives this screen in the running app and owns its evidence (`EVIDENCE_DIR`, AC9). **Extract row:** `extract the mockup's in-content icon paths into app/src/components/icons/index.tsx` — the set is the CREATE that becomes the shared module; the existing copies (`app/src/shell/Sidebar.tsx` `NAV_GLYPHS`, `app/src/screens/budget/parts.tsx` `HistoryGlyph`/`BackGlyph`, `app/src/screens/schedules/parts.tsx` `BackGlyph`) are **not** migrated here, because the owner's binding rule is "Nothing is patched outside an item's Touches" and those files are outside this item's; AuditLog stops being a consumer of the budget copy. No third copy is written.

> **Validator-owned surfaces:** `app/e2e/budget.spec.ts`'s AC9 test reads `docs/evidence/phase-7-polish/budget/README.md` (every state names a light and a dark file; every file is named) and its freshness test fails CI if a file there is newer than the run's start — so the README and PNGs are regenerated only with `BUDGET_EVIDENCE=1` on macOS and committed; `bash scripts/check-docs.sh` checks the README's relative links resolve.

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/store/migrations/001_initial.ts:9` | yes | HOLDS | ` * hooks_installed and connectors arrive with their phases, so columns that will` | tip 4 hours ago, fetched <1h |

## Touched-file invariants

> Grounded at base `59275c832a77f65975ebdf020e34a3dcc552519a`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/screens/budget/AuditLog.tsx`** — keep: focus lands on the crumb's control when the log opens: `backRef.current?.focus({ preventScroll: true });` (the ref now goes to `Crumb`'s `ref`); keep the prop `readonly onBack: () => void;` and the test id `data-testid={IDS.back}` (passed as `testId`, value `back: "budget-back"` in `model.ts`); keep the heading `<h2 className="budget-title">Audit log</h2>` and the header comment's untrusted-data rule (`untrusted data: a React text child`). Mirror: Escape is handled by `BudgetScreen.tsx` (`if (event.key === "Escape" && view === "audit") {`), which the crumb must not intercept. Pinned by: `app/src/screens/budget/BudgetScreen.test.tsx` `expect(document.activeElement).toBe(screen.getByTestId(IDS.back));` and `expect(screen.getByTestId(IDS.audit).textContent).toContain("Budget & audit");`; `app/src/screens/budget/shell.test.tsx` `fireEvent.click(screen.getByTestId(IDS.back));`.
- **`app/src/components/Glyph.tsx`** — keep: `aria-hidden="true"`, `viewBox="0 0 24 24"`, the required `readonly className: string;` and the comment's `carries no CSS of its own`; `WarnGlyph` unchanged. Pinned by: `app/src/components/Shared.test.tsx` `it("is decorative and carries the caller's class"`.
- **`app/e2e/budget.spec.ts`** — keep: evidence goes to the repo only under `const evidence = process.env.BUDGET_EVIDENCE === "1";`, otherwise to `testInfo.outputPath(file)`; keep `await screenshots(page, "audit", testInfo);` and the AC9 test `test("AC9: the evidence README names a light and a dark screenshot of every state, and every one exists"`; keep the existing focus checks `await expect(byId(page, IDS.back)).toBeFocused();` and `await expect(byId(page, IDS.openLog)).toBeFocused();`. Reuse its `byId` helper; assert behaviour, never pixels.
- **`docs/evidence/phase-7-polish/budget/README.md`** — keep: every state row names a light and a dark file in the `| [light](budget-<state>-light.png) / [dark](budget-<state>-dark.png) | \`<view>\` |` form AC9 parses (e.g. `| [light](budget-audit-light.png) / [dark](budget-audit-dark.png) | \`budget-audit\` |`), the 18-file count and the regenerate command `BUDGET_EVIDENCE=1 npx playwright test e2e/budget.spec.ts --workers=1`.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/shell/Crumb.test.tsx` — accessible name "Back to Budget & audit" | flip `Back to` → `Go to` in `app/src/shell/Crumb.tsx` |
| `app/src/shell/Crumb.test.tsx` — the chevron is the set's `back` icon | delete `<Icon name="back"` in `app/src/shell/Crumb.tsx` |
| `app/src/components/icons/icons.test.tsx` — the exact list of ten names | flip `"history",` → `"hist",` in `app/src/components/icons/index.tsx` |
| `app/src/components/icons/icons.test.tsx` — each icon's shape markup matches the `I` map | flip `m15 18-6-6 6-6` → `m15 18-6-6 6-5` in `app/src/components/icons/index.tsx` |
| `app/src/components/icons/icons.test.tsx` — each renders through `Glyph` | flip `<Glyph className={className}>` → `<svg className={className}>` in `app/src/components/icons/index.tsx` |
| `app/src/shell/Crumb.test.tsx` — the current name is not focusable (one focusable element) | flip `<span>{current}</span>` → `<button>{current}</button>` in `app/src/shell/Crumb.tsx` |
| `app/src/shell/Crumb.test.tsx` — activating it calls `onBack` once | delete `onClick={onBack}` in `app/src/shell/Crumb.tsx` |
| `app/src/shell/Crumb.test.tsx` — the `/` separator is `aria-hidden` | flip `<span aria-hidden="true">/</span>` → `<span>/</span>` in `app/src/shell/Crumb.tsx` |
| `app/e2e/budget.spec.ts` — activating the crumb returns focus to the Audit log button | flip `[data-opener="${opener}"]` → `[data-opener="none"]` in `app/src/screens/budget/BudgetScreen.tsx` (scratch copy only; the file is outside lanes) |
| `app/e2e/budget.spec.ts` — crumb reads "Budget & audit" with no "Back" | flip `parent="Budget & audit"` → `parent="Back"` in `app/src/screens/budget/AuditLog.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Shared crumb + icon set, adopted in Budget's audit log, with polish evidence | all | 3 modify + 1 README + 4 PNG re-takes, 4 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1 — shared crumb, icon set, Budget audit-log adoption, evidence (LAUNCHABLE)
provides:
  - {kind: "file", path: "app/src/shell/Crumb.tsx"}
  - {kind: "symbol", path: "app/src/shell/Crumb.tsx", name: "Crumb"}
  - {kind: "type", path: "app/src/shell/Crumb.tsx", name: "CrumbProps"}
  - {kind: "file", path: "app/src/shell/Crumb.test.tsx"}
  - {kind: "file", path: "app/src/components/icons/index.tsx"}
  - {kind: "symbol", path: "app/src/components/icons/index.tsx", name: "Icon"}
  - {kind: "symbol", path: "app/src/components/icons/index.tsx", name: "ICON_NAMES"}
  - {kind: "type", path: "app/src/components/icons/index.tsx", name: "IconName"}
  - {kind: "file", path: "app/src/components/icons/icons.test.tsx"}
  - {kind: "symbol", path: "app/src/screens/budget/AuditLog.tsx", name: "Crumb"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/budget/README.md"}
requires: []
lanes:
  - "app/src/shell/Crumb.tsx"
  - "app/src/shell/Crumb.test.tsx"
  - "app/src/components/Glyph.tsx"
  - "app/src/components/icons/**"
  - "app/src/screens/budget/AuditLog.tsx"
  - "app/e2e/budget.spec.ts"
  - "docs/evidence/phase-7-polish/budget/README.md"
  - "docs/evidence/phase-7-polish/budget/budget-audit-*.png"
external_requires:
  - "macOS host for the BUDGET_EVIDENCE=1 screenshot run (fonts differ on the Ubuntu CI run)"
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
| Feasibility (Phase 2.5): the evidence README and four PNGs in `docs/evidence/phase-7-polish/budget/` are outside the requirement's `## Touches`, while its Scope 3 requires committed screenshots | MEDIUM | Touch only `README.md` and the four `budget-audit*` PNGs there; no other file outside Touches. Name this in the PR body so the owner sees it at approval. |
| Three parallel items (Tasks, Playbooks, Memory) adopt the crumb; a prop change after this merges forces each to reshape it (requirement risk) | HIGH | Props are fixed in "Implementation notes" above and stated in `Crumb.tsx`'s header; do not add, rename or make optional any prop beyond that list. |
| Re-taking evidence rewrites tracked screenshots: `BUDGET_EVIDENCE=1 npm run e2e` rewrites other screens', and even the spec-scoped command rewrites all 18 budget PNGs (every state test calls `screenshots()`) | MEDIUM | Use the spec-scoped command in AC4, then `git checkout -- ` every PNG in `docs/evidence/phase-7-polish/budget/` except the four `budget-audit*` files; `git status` must show no other PNG. |
| The crumb's `aria-label` replaces the visible label as the accessible name | LOW | Keep the visible text ("Budget & audit") inside the name ("Back to Budget & audit"), per WCAG 2.5.3 label-in-name. |
| Icon paths drift from the mockup if hand-typed | LOW | Copy each `d`/shape verbatim from `gui-v2.html`'s `const I={` block; `icons.test.tsx` compares each icon's shape markup with the `I` map string (AC3). |
| `parts.tsx`' `BackGlyph` becomes unused by AuditLog | LOW | Leave it (outside Touches; no unused-export check runs); a later item migrates the copies onto the set. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-01-shell-one-back-crumb-and-icon-set.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-01T18:31:43Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/205
- **Branch:** feature/shell-one-back-crumb-and-icon-set
- **Files changed:** 13
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Shared Crumb (app/src/shell/Crumb.tsx) and 10-icon set (app/src/components/icons/) added; Budget's audit log adopts the crumb ("‹ Budget & audit / Audit log", name "Back to Budget & audit"); budget-audit evidence re-taken. Phase 4.5 review PASS first round (2 LOW dismissed). Supervisor verified: typecheck, 2729/2729 unit, budget.spec 21/21, check-docs OK, all 10 pin mutations held by hand (run-pin-mutations.sh: unsupported_pin_runner). Drain suppressed by config .auto_review=false (owned by /automate). CI required checks pending at completion.

## Not verified
- **dark-theme budget-audit and budget-audit-filtered crumb rendering** — only the light budget-audit shot was opened by the worker; supervisor opened budget-audit-filtered-dark.png and it reads correctly (subtask 1)
- **e2e/schedules.spec.ts AC1 and e2e/chat.spec.ts AC9 passing** — both failed in the worker's full npm run e2e; worker reports both fail at base; files untouched (subtask 1)
