# Supervisor Job: Playbooks detail polish: short model name, Schedules & triggers link, right-aligned provenance chips, button icons, the shared crumb

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-01-171537/L7
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-7/2026-11-01-090024-playbooks-detail-short-model-schedules-link-chips-and-icons.md
- **Base commit:** 42c403c8f9fdd2bfe3d14baabcba47366388b4c0

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React 19 + TypeScript renderer in `app/`, vitest unit tests, Playwright e2e through `app/e2e/electron-harness.ts`; all changes stay in that stack. |
| 2 | Dependency Availability | GO | Item 21 (dependency) is merged at base (`0bcf594`, PR #205): `app/src/shell/Crumb.tsx` exports `Crumb`, `app/src/components/icons/index.tsx` exports `Icon` with `chat`, `pencil`, `history`, `clock`, `back`. `shortModel` already exists in `app/src/screens/playbooks/model.ts`. |
| 3 | Architecture Fit | GO | Screen-local presentation change only; no kernel route, no stored value changes (the non-goal: the full id stays stored). Navigation to Schedules uses the shell's existing `#/<id>` hash routing (`screenForHash` in `app/src/App.tsx`; screen id `"schedules"`). |
| 4 | Scope vs Supervisor Capability | GO | ~11 hand-edited files (+ regenerated PNGs), well under the context-bound threshold; one coherent group → single subtask. |
| 5 | Hard Blockers | CAUTION | Two specs OUTSIDE the item's Touches (`app/e2e/keyboard.spec.ts`, `app/e2e/phase-7-exit.spec.ts`) locate the back control by `[data-pb-back]`, and the shared `Crumb` has no pass-through for data attributes (only `testId` and `ref`). The owner's binding rule forbids patching outside Touches, so the plan keeps `data-pb-back` on the shared crumb's button through its `ref` (see Risk Assessment). Also the committed evidence (`docs/evidence/phase-7-polish/playbooks/`) is outside the literal Touches list but required by Scope item 6 and pinned by `app/e2e/playbooks.spec.ts`. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Make the Playbooks detail (and list toolbar) match the approved GUI v2 mockup's `playbooks-populated` and `playbooks-detail` views: short model name in the Policy table, a "Schedules & triggers" link in the Trigger section, right-aligned provenance chips, icons on the four buttons, and the shell's shared "‹ Playbooks / <name>" crumb — with light/dark polish-gate screenshots committed.

**Problem Statement:**
The owner needs the Playbooks screen to pass its phase 7 polish gate (D9).
Currently (live re-run 2026-11-01), the detail's Model row shows `claude-sonnet-5-5` while the table and mockup show `sonnet`; the Trigger section has no link to Schedules & triggers; "set by you" / "proposed by Wright" chips trail each value inline instead of sitting at the row's right; "Ask Wright for a playbook", "Edit in English", "Edit fields" and "Version history" draw no icon; and the detail's crumb is a plain "Playbooks" button + "/ <name>", not the shell's shared "‹ Playbooks / <name>" (item 21). This fails the polish gate.
Success looks like the running app (fixture kernel) matching those mockup views in light and dark, with screenshots committed and named against the mockup views.

## Acceptance Criteria
- [ ] AC1 — Given a playbook whose model is `claude-sonnet-5-5`, when its detail is open, then the Policy table's Model row reads `sonnet` (through the existing `shortModel` in `app/src/screens/playbooks/model.ts`, the same function the table uses) with the full id in the value's `title`, matching `playbooks-detail`; given a model id with no known family (e.g. `sonnet` or `gpt-x`), then the row shows the id as stored (never blank), and given no model, then it reads "not set" with no provenance chip. The stored value and `/playbooks/:id/set` writes are unchanged.
- [ ] AC2 — Given the detail, when the owner looks at the Trigger section, then its header row carries a ghost "Schedules & triggers" button with the `clock` icon at the section's right (same row as the "Trigger" heading, pushed right by a spacer, as the mockup's `.sech` row), and when it is clicked, then the shell shows the Schedules & triggers screen (`window.location.hash` becomes `#/schedules` via a `SCHEDULES_HASH` constant in `model.ts`, alongside `APPROVALS_HASH`). The button carries a new test id `PLAYBOOKS_TEST_IDS.schedulesLink` = `"playbook-schedules-link"`.
- [ ] AC3 — Given the Policy table, when it renders (light and dark), then every provenance chip ("set by you" / "proposed by Wright") is right-aligned in its row: an e2e check measures, for every `[data-testid="playbook-field"]` row that has a `.pb-setby` chip, that the chip's right edge equals the row's content-box right edge (row `getBoundingClientRect().right` minus its computed `padding-right`, within 1px), in both themes. Captions ("recorded only", "tokens", "outward calls are recorded, never sent") stay beside the value, not in the chip column. Rows whose value is "not set" still show no chip.
- [ ] AC4 — Given Playbooks with playbooks listed, then the toolbar's "Ask Wright for a playbook" button shows the `chat` icon; and given the detail, then "Edit in English" shows `chat`, "Edit fields" shows `pencil` and "Version history" shows `history` — each passed through `Button`'s `icon` prop as `<Icon name=… className="pb-glyph" />` from `app/src/components/icons/index.tsx` (one `svg` inside the button's `.btn-icon` span), matching `playbooks-populated` and `playbooks-detail`.
- [ ] AC5 — Given the detail, then its crumb is the shell's shared `Crumb` (`app/src/shell/Crumb.tsx`) reading "‹ Playbooks / <name>" (button accessible name "Back to Playbooks"); when the owner opens a playbook, then focus lands on that back button; and when it is activated, then the view returns to the table with focus on that playbook's row (`[data-pb-open="<id>"]`). The local `Crumb` in `PlaybookDetail.tsx` is removed: the edit and history views and the "not in the kernel's list" fallback use the same shared crumb (edit/history read "‹ Playbook / <name>" as the mockup's `crumb('cancel-edit','Playbook')` / `crumb('back-pb','Playbook')` draw it; the fallback reads "‹ Playbooks / playbook #<id>", the id the owner opened, so no separator dangles), so the screen has one back control. The back button still carries the `data-pb-back` attribute (consumed by `app/e2e/keyboard.spec.ts` and `app/e2e/phase-7-exit.spec.ts`, which this item may not edit), and both of those specs pass unchanged.
- [ ] AC6 — Given the change, when `cd app && npm run build && PLAYBOOKS_EVIDENCE=1 npx playwright test e2e/playbooks.spec.ts --workers=1 -g "every designed state|the evidence README lists every screenshot"` is run (the build first, so the shots are of the new UI, never `app/dist` from before the change) (fixture kernel, through `app/e2e/electron-harness.ts`), then the committed evidence file `docs/evidence/phase-7-polish/playbooks/README.md` lists the regenerated light and dark PNGs of every mockup state this item changes — at least `playbooks-populated`, `playbooks-detail`, `playbooks-edit`, `playbooks-history` (each named against its `gui-v2.html` view) — its `playbooks-detail` row says the Model row shows the short name with the full id in its title (replacing "the Model row shows the full id"), and it names item 24; and the PR body links to that README.
- [ ] AC7 — Validation passes: `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`, and `bash scripts/check-docs.sh` from the repo root.

## House Rules
> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it). (id: `testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it`, advisory, no check)

## File Impact Map

Line counts at base `42c403c`. Module-layout threshold: 500 lines (`skills/supervisor-readiness/SKILL.md` §"Module layout").

| Path | Action | Confidence | What / home reason |
|---|---|---|---|
| `app/src/screens/playbooks/PlaybookDetail.tsx` (250) | MODIFY | HIGH | Remove local `Crumb`; use the shared crumb; Model row via `shortModel` with `title`; provenance chip moved to the row's right column; Trigger section header row with the Schedules & triggers button; icons on Edit in English / Edit fields / Version history. |
| `app/src/screens/playbooks/parts.tsx` (146) | MODIFY | HIGH | Home of the one new helper `PlaybookCrumb` ({parent, current, onBack}) that renders the shell `Crumb` with `className="pb-crumb"`, `glyphClassName="pb-glyph"` and a ref callback marking the button `data-pb-back` — used by detail, edit, history and the screen's fallback (one home, not three copies). |
| `app/src/screens/playbooks/PlaybookEdit.tsx` (211) | MODIFY | HIGH | Import `PlaybookCrumb` from `./parts` instead of `Crumb` from `./PlaybookDetail`. |
| `app/src/screens/playbooks/PlaybookHistory.tsx` (143) | MODIFY | HIGH | Same import swap. |
| `app/src/screens/playbooks/PlaybooksScreen.tsx` (496) | MODIFY | HIGH | `chat` icon on "Ask Wright for a playbook"; fallback crumb via `PlaybookCrumb` with `` current={`playbook #${view.id}`} ``. No new responsibility (adds ~5 lines; stays under 500 — if it would cross 500, move the fallback body into `parts.tsx` instead). |
| `app/src/screens/playbooks/model.ts` (425) | MODIFY | HIGH | Add `SCHEDULES_HASH = "#/schedules"` beside `APPROVALS_HASH`; add `schedulesLink: "playbook-schedules-link"` to `PLAYBOOKS_TEST_IDS`. |
| `app/src/screens/playbooks/playbooks.css` (658) | MODIFY | HIGH | (658 — the screen's single stylesheet; every `pb-*` rule lives here) add `.pb-glyph` (14×14, `flex: none`, as `.budget-glyph`), a `.pb-sech` header row + spacer for the Trigger section, a detail-only modifier `.pb-rows-policy .pb-row` (class on the detail's Policy `dl` only) with a three-column grid (label · value · chip, as the mockup's `.pf`: `150px minmax(0,1fr) auto`, `align-items: center`), crumb button offset like the mockup's `.crumb .btn`. The base `.pb-row` rule (`grid-template-columns: 160px minmax(0, 1fr)`, `align-items: start`) stays unchanged: `PlaybookEdit.tsx` uses `.pb-row` for its read-only and editable rows, whose layout must not move. |
| `app/src/screens/playbooks/PlaybookDetailPolish.test.tsx` | CREATE | HIGH | New unit tests for AC1–AC5 (short model + title + unknown-id + not-set; schedules button navigates to `#/schedules`; chip is the last element of its row / in the chip cell; icons present in the four buttons; crumb accessible name and focus round-trip; `data-pb-back` present). New file because `PlaybooksScreen.test.tsx` (881) is past the threshold. |
| `app/src/screens/playbooks/PlaybooksTokensOwner.test.tsx` (471) | MODIFY | HIGH | Flip the existing pin at "the detail shows the id in full" (`expect(modelRow.textContent).toContain("claude-sonnet-5-5")`) to the short name; update `getByRole("button", { name: "Playbook" / "Playbooks" })` to the shared crumb's names ("Back to Playbook" / "Back to Playbooks"). |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` (881) | MODIFY | HIGH | (881 — existing assertions only; no new tests appended here) update the crumb button names to "Back to Playbooks" / "Back to Playbook". |
| `app/e2e/playbooks.spec.ts` (877) | MODIFY | HIGH | (877 — the item's Touches names this spec, and it owns the screenshot capture) flip line ~589's `toContainText(REVIEW_MODEL)` to the short name; add e2e checks for AC2 (click → Schedules & triggers screen), AC3 (chip right-edge measurement, light and dark), AC4 (icons), AC5 (crumb text "Playbooks", "/", name; Back returns to the row with focus). |
| `docs/evidence/phase-7-polish/playbooks/README.md` | MODIFY | HIGH | AC6 evidence file: regenerated-shot notes, item 24, Model row now short. |
| `docs/evidence/phase-7-polish/playbooks/*.png` (20 files) | MODIFY | HIGH | Regenerated by the spec with `PLAYBOOKS_EVIDENCE=1` (the spec deletes and rewrites all twenty). |

Not modified (read-only consumers to keep green): `app/src/shell/Crumb.tsx`, `app/src/components/icons/index.tsx`, `app/e2e/keyboard.spec.ts`, `app/e2e/phase-7-exit.spec.ts`.

## Touched-file invariants

> Grounded at base `42c403c`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/screens/playbooks/PlaybookDetail.tsx`** — keep: each policy row keeps `data-testid={IDS.field} data-field={label}` (e2e `fieldOf` and unit tests find rows by it); keep the not-set rule `setBy={value === NOT_SET ? null : setBy}` (no chip on an unset value — compare against the displayed text, which is still `NOT_SET` for a null model since `shortModel(null)` returns `NOT_SET`); keep the section ids `aria-labelledby="pb-h-trigger"` / `"pb-h-policy"`; keep `disabled={actions.offline}` on Edit in English. reuse: `shortModel` and `safe` from `./model` (no second short-name mapping); `Icon` from `../../components/icons`.
- **`app/src/screens/playbooks/PlaybooksScreen.tsx`** — keep: the back focus target `show({ kind: "list" }, \`[data-pb-open="${view.id}"]\`)` and the open/edit/history focus target `"[data-pb-back]"` (both rely on the back button carrying `data-pb-back`); keep Ask Wright's `disabled={offline}` and `data-testid={IDS.askWright}`.
- **`app/src/screens/playbooks/PlaybookEdit.tsx`, `app/src/screens/playbooks/PlaybookHistory.tsx`** — keep: the Escape handlers `event.key === "Escape"` that call `onBack()`; only the crumb import/element changes.
- **`app/src/screens/playbooks/parts.tsx`** — keep: `SetBy` returns null when `setByWord` is empty (`if (word === "") return null;`) and keeps `data-by={setBy === "owner" ? "owner" : "wright"}` and the `pb-setby` class (the AC3 measurement and existing tests select `.pb-setby`).
- **`app/src/screens/playbooks/model.ts`** — keep: `shortModel`'s honest fallback `return valueOrNotSet(model);` (unknown id shown as stored, never blank — requirement Risk) unchanged; mirror the existing constant idiom `export const APPROVALS_HASH = "#/approvals";` for `SCHEDULES_HASH`; mirror the shell route shape: `screenForHash` in `app/src/App.tsx` reads `/^#\/([a-z][a-z0-9-]*)/` and the Schedules screen's `id: "schedules"` (`app/src/screens/schedules/index.tsx`).
- **`app/src/shell/Crumb.tsx` (not modified — mirrored)** — the shared crumb's settled props are `parent`, `current`, `onBack`, `className`, `glyphClassName`, optional `testId`, `ref`; its accessible name is `` aria-label={`Back to ${parent}`} `` — tests must use that name; do not edit the file (outside Touches).
- **`app/e2e/playbooks.spec.ts`** — keep: `backButton` = `screenOf(page).locator("[data-pb-back]")`; the evidence flow `if (EVIDENCE) for (const file of readdirSync(dir))` and the README pin test "the evidence README lists every screenshot, and nothing else" (`the README names the ${state} state`); launch only through `electron-harness.ts` (house rule; `app/scripts/hidden-windows.test.ts`).
- **Out-of-Touches consumers (must stay green, not edited)** — `app/e2e/keyboard.spec.ts` and `app/e2e/phase-7-exit.spec.ts` both use `byId(page, "screen-playbooks").locator("[data-pb-back]")` and assert it `toBeFocused()` after Enter opens a playbook, then Enter returns focus to the row.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/screens/playbooks/PlaybookDetailPolish.test.tsx` — Model row reads `sonnet` with title `claude-sonnet-5-5` | replace the Model row's `shortModel(playbook.model)` with `valueOrNotSet(playbook.model)` in `app/src/screens/playbooks/PlaybookDetail.tsx` |
| `app/src/screens/playbooks/PlaybookDetailPolish.test.tsx` — Schedules & triggers button sets `#/schedules` | flip `"#/schedules"` → `"#/playbooks"` in `app/src/screens/playbooks/model.ts` |
| `app/src/screens/playbooks/PlaybookDetailPolish.test.tsx` — the four buttons each contain one icon svg | delete the `icon={<Icon name="pencil" …` prop on Edit fields in `app/src/screens/playbooks/PlaybookDetail.tsx` |
| `app/src/screens/playbooks/PlaybookDetailPolish.test.tsx` — back button carries `data-pb-back` | delete the ref callback's `setAttribute("data-pb-back", "")` line in `app/src/screens/playbooks/parts.tsx` |
| `app/e2e/playbooks.spec.ts` — AC3 chip right edge equals the row's content-box right edge | flip the `.pb-rows-policy .pb-row` rule's `150px minmax(0,1fr) auto` → `160px minmax(0, 1fr)` in `app/src/screens/playbooks/playbooks.css` (chip falls back inline) |
| `app/src/screens/playbooks/PlaybooksTokensOwner.test.tsx` — flipped pin: the detail's Model row reads `sonnet`, not `claude-sonnet-5-5` | replace the Model row's `shortModel(playbook.model)` with `valueOrNotSet(playbook.model)` in `app/src/screens/playbooks/PlaybookDetail.tsx` |
| `app/e2e/playbooks.spec.ts` — flipped pin (was `toContainText(REVIEW_MODEL)`): the detail's Model row reads `sonnet` | replace the Model row's `shortModel(playbook.model)` with `valueOrNotSet(playbook.model)` in `app/src/screens/playbooks/PlaybookDetail.tsx` |
| `app/src/screens/playbooks/PlaybookDetailPolish.test.tsx` — AC1 an unknown id (`gpt-x`) shows as stored, never blank | flip `return valueOrNotSet(model);` → `return "";` in `app/src/screens/playbooks/model.ts` |
| `app/src/screens/playbooks/PlaybookDetailPolish.test.tsx` — AC1 a null model reads "not set" with no chip | flip `setBy={value === NOT_SET ? null : setBy}` → `setBy={setBy}` in `app/src/screens/playbooks/PlaybookDetail.tsx` |
| `app/src/screens/playbooks/PlaybookDetailPolish.test.tsx` — AC5 the crumb button's accessible name is "Back to Playbooks" | flip `parent="Playbooks"` → `parent="Playbook"` on the detail's crumb in `app/src/screens/playbooks/PlaybookDetail.tsx` |
| `app/src/screens/playbooks/PlaybookDetailPolish.test.tsx` — AC5 opening a playbook focuses the back button | flip `"[data-pb-back]"` → `"[data-pb-none]"` in `open` in `app/src/screens/playbooks/PlaybooksScreen.tsx` |
| `app/src/screens/playbooks/PlaybookDetailPolish.test.tsx` and `app/e2e/playbooks.spec.ts` — AC5 Back returns focus to that playbook's row | flip `` `[data-pb-open="${view.id}"]` `` → `` `[data-pb-none="${view.id}"]` `` in `app/src/screens/playbooks/PlaybooksScreen.tsx` |
| `app/e2e/playbooks.spec.ts` — AC2 clicking Schedules & triggers shows the Schedules & triggers screen | flip `"#/schedules"` → `"#/approvals"` in `app/src/screens/playbooks/model.ts` |
| `app/e2e/playbooks.spec.ts` — AC4 Ask Wright for a playbook shows its icon | delete the `icon={<Icon name="chat"` prop on the Ask Wright button in `app/src/screens/playbooks/PlaybooksScreen.tsx` |
| `app/e2e/playbooks.spec.ts` — AC5 crumb reads "Playbooks", "/", the name | flip `parent="Playbooks"` → `parent="Playbook"` on the detail's crumb in `app/src/screens/playbooks/PlaybookDetail.tsx` |
| `app/src/screens/playbooks/PlaybookDetailPolish.test.tsx` — the fallback crumb reads "playbook #<id>" | flip `` current={`playbook #${view.id}`} `` → `current=""` in `app/src/screens/playbooks/PlaybooksScreen.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Playbooks detail polish + regenerated evidence | all | 11 modify (+20 regenerated PNGs), 1 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 — Playbooks detail polish (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "app/src/screens/playbooks/parts.tsx", name: "PlaybookCrumb"}
  - {kind: "symbol", path: "app/src/screens/playbooks/model.ts", name: "SCHEDULES_HASH"}
  - {kind: "symbol", path: "app/src/screens/playbooks/model.ts", name: "schedulesLink"}
  - {kind: "symbol", path: "app/src/screens/playbooks/playbooks.css", name: ".pb-glyph"}
  - {kind: "file", path: "app/src/screens/playbooks/PlaybookDetailPolish.test.tsx"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/playbooks/README.md"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/playbooks/playbooks-detail-light.png"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/playbooks/playbooks-detail-dark.png"}
requires: []
lanes:
  - "app/src/screens/playbooks/**"
  - "app/e2e/playbooks.spec.ts"
  - "docs/evidence/phase-7-polish/playbooks/**"
external_requires:
  - "Electron + Playwright runnable locally for `npm run e2e` and the PLAYBOOKS_EVIDENCE=1 screenshot run"
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
| Feasibility (Phase 2.5): `app/e2e/keyboard.spec.ts` and `app/e2e/phase-7-exit.spec.ts` (outside Touches) locate the back control by `[data-pb-back]`; the shared `Crumb` forwards no data attributes. | MEDIUM | `PlaybookCrumb` passes a ref callback to `Crumb` that sets `data-pb-back=""` on the button (pinned by a unit test). Run both specs before hand-back. The cleaner fix (a pass-through prop on `app/src/shell/Crumb.tsx`, or switching those specs to a test id) is outside Touches — per the owner's rule, note it in the PR body as a follow-up; do not patch those files. |
| Feasibility (Phase 2.5): the evidence README and PNGs under `docs/evidence/phase-7-polish/playbooks/` are outside the literal Touches list. | LOW | Scope item 6 requires committed screenshots and the spec pins the README; item 21 updated its own evidence folder the same way. Touch nothing else under `docs/`. |
| A model id with no known short name renders blank. | MEDIUM | `shortModel` falls back to the stored id via `valueOrNotSet`; AC1 tests an unknown id and null. |
| Moving the chip to a third grid column wraps or clips long values (dedupe key, mode caption) at the window's minimum width. | MEDIUM | Value column is `minmax(0,1fr)` with `overflow-wrap: anywhere` (kept); check the detail screenshot at 1180 px and the existing min-width test still passes. |
| Shared crumb's accessible name ("Back to Playbooks") breaks existing `getByRole("button", { name: "Playbooks" })` unit tests and can collide with the sidebar's "Playbooks" entry. | LOW | Update those queries to the new name; the "Back to …" name no longer collides with the sidebar. |
| `PlaybooksScreen.tsx` is at 496 lines; edits could cross the 500-line threshold. | LOW | Keep the change to the icon prop and the fallback crumb; if it would cross, move the fallback body to `parts.tsx`. |
| The Policy rows' three-column grid leaks into the edit view, which reuses `.pb-row` for its read-only and editable rows. | MEDIUM | Scope the grid to the detail's Policy `dl` (`.pb-rows-policy .pb-row`) and leave the base `.pb-row` unchanged. Check the regenerated `playbooks-edit` / `playbooks-edit-refused` shots: only their crumb changes. |
| Edit/history crumbs change visually ("‹ Playbook / <name>"), so their screenshots change too. | LOW | The spec regenerates all twenty PNGs; the README notes the edit and history rows changed for the crumb. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-02-playbooks-detail-short-model-schedules-link-chips-and-icons.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-02T08:07:55Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/211
- **Branch:** feature/playbooks-detail-short-model-schedules-link-chips-and-icons
- **Files changed:** 27
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Playbooks detail polished to the GUI v2 mockup: short model name with full id in title, Schedules & triggers link, right-aligned provenance chips, icons on the four buttons, shared PlaybookCrumb (keeps data-pb-back); light/dark evidence regenerated (item 24). Phase 4.5 review PASS on first pass; 2 LOW findings dismissed below the MEDIUM fix floor. Preflight sync unverified (github.com unreachable at the time). Review drain not dispatched (.auto_review false in config). One e2e failure (chat.spec.ts:184 AC9) reported by the worker as pre-existing on base, not reproduced by Supervisor.

## Not verified
- **The waiting, error, empty, unreachable, edit-refused and history shots** — regenerated and the spec's state checks passed, but not every PNG was opened (subtask 1)
- **A real Wright kernel** — everything ran against the fixture kernel (subtask 1)
- **The claude-review PR check** — could not run before the PR existed (subtask 1)
