# Supervisor Job: The owner can see and set when a playbook is live (phase 8 item 20e)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-12-180247/L2
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-20/2026-11-12-170445-e-the-owner-can-see-and-set-when-a-playbook-is-live.md
- **Base commit:** cfb3d428d99db7dcd83ab2c77c5d972738ab7500

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React/TS app (`app/`, vitest + testing-library) and strict-TS kernel (`kernel/`, vitest); both already hold the code this changes. |
| 2 | Dependency Availability | GO | No new dependency. The owner route `POST /playbooks/:id/set` already takes `{field: "mode", value}` from the app (`PlaybooksScreen.tsx` `setField`, used by `PlaybookEdit.tsx`); the kernel refuses `live` on a non-enabled playbook with `live_needs_enable` (`kernel/src/playbooks/store.ts` `setPlaybookPolicy`). The requirement's assumption holds. |
| 3 | Architecture Fit | GO | Mechanism only: the card exposes an existing owner write and tells the truth about the stored mode; the kernel's enable display gains one value line. D39 (a live version needs its own dry run and enable) is unchanged (a non-goal). |
| 4 | Scope vs Supervisor Capability | GO | 8 files (7 modify app/kernel + 1 kernel), well under the context-bound split; single agent. |
| 5 | Hard Blockers | CAUTION | The card needs a Set handler and the ⌘K wiring, both owned by `app/src/screens/playbooks/PlaybooksScreen.tsx`, which is outside the requirement's Touches (see `## Scope widening`). |

**Overall Verdict:** CAUTION

## Task
**Goal:** On a playbook's card the owner can switch Mode between Draft and Live (Live only when the playbook is enabled), is told before it applies that Live writes a new draft version needing its own dry run and enable approval, is then offered to ask Wright for that dry run and enable; the card's Mode row tells the truth for draft and live; and the kernel's enable approval display carries a `mode:` line first among the values and says LIVE on its first line for a live enable.

**Problem Statement:**
The owner needs to set and see a playbook's live mode in the app because going live is the phase 8 walk's step 1.
Currently, the card (`PlaybookDetail.tsx`) shows Mode read-only with a caption "outward calls are recorded, never sent" even for a live playbook; live mode needed `studio playbooks set 7 mode live` on the CLI; nobody explained that live makes a new draft version needing its own dry run and enable (a third dry run, ~121k tokens, was spent finding out); and the enable approval's display (`kernel/src/playbooks/enable.ts` `enableDisplay`) never names the mode.
This causes the owner to approve or watch a write-capable playbook without knowing it.
Success looks like: the card's Mode control sets draft/live with the explanation and the Wright hand-off, the Mode row reads correctly for both modes, and an enable approval's display shows `mode: … (who set it)` and `LIVE` on a live enable.

## Acceptance Criteria

Part A — the card (app):
- [ ] AC1: Given an enabled playbook, when I open its card (`PlaybookDetail`), then a Mode control offers Draft and Live, the current mode marked as chosen, and Live is choosable only when the playbook is enabled (`isOn(playbook)`), mirroring the kernel's `live_needs_enable`; on a playbook already in live mode, Live is shown chosen and choosing it again does nothing (no confirm, no Set).
- [ ] AC2: Given an enabled draft-mode playbook, when I choose Live, then nothing is sent yet and the card shows (the shared `Dialog`, `kind="decision"`) what happens: a new version, back in draft, that needs its own dry run and an enable approval before it runs live; when I confirm, then exactly one `POST /playbooks/:id/set` `{field: "mode", value: "live"}` is sent; when I cancel, then nothing is sent. Given the Set answered ok, then the card says the version the kernel answered with and offers "Ask Wright for the dry run and enable", which puts a line naming the playbook (id, slug) and asking for its dry run then its enable into Wright's composer and opens Wright's thread, sending nothing (the same hand-off idiom as Edit in English). A refusal shows in the kernel's own words.
- [ ] AC3: Given a playbook whose `mode` is `live`, then the card's Mode row caption says its runs push and comment through the approval gate; given `draft`, then it says "outward calls are recorded, never sent" (unchanged wording).
- [ ] AC4: Given I choose Draft on a live-mode playbook, then one `POST /playbooks/:id/set` `{field: "mode", value: "draft"}` is sent at once (no confirm), as the Edit view does.
- [ ] AC5 (edge): Given a playbook that is not enabled (disabled, or a draft), then Live is not choosable and the Mode control explains that the playbook must be enabled (turned on) first; nothing is sent.

Part B — the enable approval (kernel):
- [ ] AC6: Given an enable approval for a playbook (`enableDisplay`), then its display has a `mode:` line built with the existing `valueLine` (so `mode: draft (proposed)`, `mode: live (set by owner)`, …) placed first among the value lines, immediately before `model:`.
- [ ] AC7: Given an enable approval for a playbook whose `mode` is `live`, then the display's first line says LIVE plainly: `Enable playbook "<name>" (<slug>, #<id>) at version <N>, LIVE, agent <agent>`. Given a draft-mode playbook, then the first line is byte-identical to today's (`… at version <N>, agent <agent>`), so `kernel/test/playbooks-dry-run.test.ts`'s first-line pin stays green.

Always:
- [ ] AC8: Every app change has a ⌘K command under the `playbooks` owner, registered while a playbook's view (detail, edit or history) is open: `playbooks.mode-live` (shows that playbook's card, the detail view, then opens the same Live confirm there, and sends nothing itself; enabled only when online and `liveChoosable`), `playbooks.mode-draft` (sends `mode draft` at once from any of the three views; enabled only when online and the mode is `live`), and `playbooks.ask-dry-run-enable` (the AC2 Wright hand-off, from any of the three views; enabled when online). Run from the Edit or History view, `playbooks.mode-live` lands on the card with the confirm open (pinned by a test).
- [ ] AC9 (validation): `cd kernel && npm test` passes, including new tests for the enable display of a draft-mode and a live-mode playbook (AC6, AC7) in `kernel/test/playbooks-foundation.test.ts`; `cd app && npm run typecheck && npm test` passes, including new tests in `app/src/screens/playbooks/PlaybooksScreen.test.tsx` for the Mode control and row (AC1–AC5) and the three ⌘K commands (AC8). Existing pins that the wording change touches are updated in this story, never deleted.

Design notes (names the pins below rely on):
- `model.ts` adds `export function liveChoosable(playbook: Pick<Playbook, "status" | "mode">): boolean` whose body is `return isOn(playbook) && playbook.mode !== "live";` — the one rule both the card's Live choice and the `playbooks.mode-live` command's `enabled` read (enabled, and not already live).
- `model.ts` adds `export function modeSavedText(answer: PlaybookChangeResponse): string` for the card's post-Set line, containing `saved as v${answer.playbook.version}` (the version the kernel answered with).
- The card's Live/Draft choices are a radio group whose Live option carries `aria-checked={playbook.mode === "live"}` (Draft the converse); the confirm's Cancel is `onCancel={onCancelLive}`; a refused Set shows `{ tone: "danger", text: outcome.text }` (role alert).
- `model.ts` adds the live caption constant containing `push and comment through the approval gate`, keeps the draft caption `outward calls are recorded, never sent`, and exports the Live explanation the card's confirm and `PlaybookEdit.tsx`'s confirm both show (it keeps the phrase `Live sends outward calls through the approval gate`).
- `PlaybookDetail` takes the Live-confirm state from the screen: props `liveAskOpen: boolean`, `onAskLive: (playbook) => void`, `onCancelLive: () => void`, plus `onSet` (the screen's `setField`) and `onAskDryRunEnable: (playbook) => void`; its Live choice calls `onAskLive(playbook)`; the confirm's primary action calls `onSet(playbook, "mode", "live")`; the Draft choice calls `onSet(playbook, "mode", "draft")` directly.
- `model.ts` adds `export function dryRunEnableLine(playbook)` (the composer line: names the playbook by id and `safe` slug and asks for its dry run, then its enable) and the not-enabled explainer text containing `must be enabled (turned on) first`.
- The screen's hand-off handler calls `handOffComposerText(WRIGHT, dryRunEnableLine(playbook))` then navigates to Wright's thread (sends nothing).
- `commands.ts` handlers gain `askLive`, `setModeDraft` and `askDryRunEnable`; the commands call `handlers().askLive(p)`, `handlers().setModeDraft(p)` and `handlers().askDryRunEnable(p)` through `ofCurrent(`; `playbooks.mode-draft`'s `enabled` reads the latest current playbook and tests `latest.mode === "live"`. The screen's `askLive` shows the detail view (`show({ kind: "detail", id }, …)`) and sets the Live-confirm state.
- The Mode control sits in its own element below the Policy `dl` (not inside the Mode `PolicyRow` and never inside `.pb-chipcell`), so the e2e chip-alignment loop and the caption-in-`.pb-value` pin are unaffected.

Non-goals (carried from the requirement): changing the D39 rule that a live version needs its own dry run and enable; cutting the dry run's token cost.

## Scope widening
- app/src/screens/playbooks/PlaybooksScreen.tsx
- accepted: AUT-OVERLAP 2026-11-13

## Touched-file invariants

> Grounded at base `cfb3d428d99db7dcd83ab2c77c5d972738ab7500`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/playbooks/enable.ts`** — keep: the draft-mode first line exactly as built today, `at version ${row.version}, agent ${row.owning_agent}` (insert `, LIVE` only when `row.mode === "live"`); every display line is stored text the CLI escapes ("Stored text throughout: the CLI escapes every line."). reuse: `function valueLine(` and its `setterText` for the `mode:` line (no new formatter). pinned by: `kernel/test/playbooks-dry-run.test.ts` (`at version 1, agent wright\n`, draft-mode first line), `kernel/test/playbooks-foundation.test.ts` (`merge_requirement: reviews:2 (proposed)`, matched with `toContain` on the split lines, so inserting a line keeps it green).
- **`app/src/screens/playbooks/PlaybookDetail.tsx`** — keep: kernel text only through `safe(`; writes disabled while `actions.offline`, and held while another write is pending (`actions.pending`); the draft caption `outward calls are recorded, never sent` (pinned by `app/e2e/playbooks.spec.ts` `toContainText("outward calls are recorded, never sent")` on a draft-mode fixture). reuse: `PolicyRow` for the Mode row, `isOn(playbook)` for "enabled", the shared `Dialog` with `kind="decision"` as `PlaybookEdit.tsx` uses it. keep (e2e, outside lanes and outside the vitest validation): every `playbook-field` row's chip stays right-aligned and no `.pb-cap` sits inside `.pb-chipcell` (`app/e2e/playbooks.spec.ts` `captionInChip`), so the Mode control lives outside the `PolicyRow`.
- **`kernel/test/playbooks-foundation.test.ts`** — keep: the `merge_requirement` describe's existing pins, e.g. `merge_requirement: reviews:2 (proposed)` matched with `toContain(shown)` on the split display lines. reuse: `function draft(` and `function preHold(` (read the display from `preHold(id).verdict?.display`); update pins, never delete them.
- **`app/src/screens/playbooks/PlaybookEdit.tsx`** — keep: the live confirm's title `Turn on live mode for` and its description containing `Live sends outward calls through the approval gate`, with no "GitHub" and no "merge" (pinned by `app/src/screens/playbooks/PlaybooksScreen.test.tsx` AC5b); the `sending.current` re-entry guard. reuse: take the description from the shared model.ts constant this story adds, so card and edit view say the same thing.
- **`app/src/screens/playbooks/model.ts`** — keep: `export const PLAYBOOKS_TEST_IDS = {` as the one home of test ids; `export function handoffLine(` unchanged (Edit in English's line). reuse: add the Mode texts and the dry-run-and-enable hand-off line here beside `handoffLine`, passing slug through `safe(`.
- **`app/src/screens/playbooks/commands.ts`** — keep: the header promise `No command turns a playbook on or sends a message` (the Live command opens the confirm; the hand-off sends nothing; Draft is a policy Set, not a turn-on, so reword the comment to name it precisely); `enabled: () => !sources().offline` style (flags read through `sources()` when asked, never captured); per-playbook commands acting only via `ofCurrent(`; `commandSignature` keyed on ids and names only (enabled-ness reads live state). reuse: `PLAYBOOKS_COMMANDS` gets the three new ids.
- **`app/src/screens/playbooks/PlaybooksScreen.tsx`** — keep: every write through `guarded(` and `write(`; reuse `setField` (`guarded(`set:${playbook.id}:${field}`` ) for the card's Set, and the `handOffComposerText(WRIGHT, handoffLine(playbook))` idiom for the new hand-off; the Live confirm's open state lives in the screen (as `turnOn` does) so the ⌘K command can open it.
- **`app/src/screens/playbooks/PlaybooksScreen.test.tsx`** — reuse: `async function mountLoaded(`, `function applySet`, `posts(` for the new tests; update, never delete, any pin whose wording changes.

## Closed enumerations touched

> Sibling grep at base `cfb3d428`: `grep -rnF 'playbooks.edit-fields' --exclude=CHANGELOG.md .` → 1 hit in 1 file (outside `.supervisor/`); `grep -rnF 'playbook-edit-fields' app docs kernel` → 9 hits in 2 files.

- **`playbooks.mode-live`, `playbooks.mode-draft`, `playbooks.ask-dry-run-enable`** (sibling: `playbooks.edit-fields`) — must be named in:
  - `app/src/screens/playbooks/commands.ts` — the closed id map `export const PLAYBOOKS_COMMANDS = {` — extend.
- **new test ids for the Mode control** (sibling: `playbook-edit-fields`) — must be named in:
  - `app/src/screens/playbooks/model.ts` — `export const PLAYBOOKS_TEST_IDS = {` — extend.
  - `app/e2e/playbooks.spec.ts` — uses ids, not a closed list — no change.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/playbooks-foundation.test.ts` — live enable first line contains `, LIVE` | flip `", LIVE"` → `""` in `kernel/src/playbooks/enable.ts` |
| `kernel/test/playbooks-foundation.test.ts` — `mode: draft` / `mode: live (set by owner)` line present, before `model:` | delete `valueLine("mode", row.mode, row.mode_set_by),` in `kernel/src/playbooks/enable.ts` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — live Mode row caption says push and comment through the approval gate | flip `push and comment through the approval gate` → `outward calls are recorded, never sent` in `app/src/screens/playbooks/model.ts` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — Live not choosable on a non-enabled playbook (card, AC5) and ⌘K `playbooks.mode-live` disabled there (AC8) | flip `isOn(playbook) && playbook.mode` → `true || playbook.mode` in `app/src/screens/playbooks/model.ts` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — choosing Live on an already-live playbook opens no confirm and sends nothing (AC1) | flip `&& playbook.mode !== "live"` → `&& true` in `app/src/screens/playbooks/model.ts` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — the current mode is marked chosen (AC1) | flip `aria-checked={playbook.mode === "live"}` → `aria-checked={false}` in `app/src/screens/playbooks/PlaybookDetail.tsx` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — Cancel in the card's Live confirm sends nothing (AC2) | flip `onCancel={onCancelLive}` → `onCancel={() => onSet(playbook, "mode", "live")}` in `app/src/screens/playbooks/PlaybookDetail.tsx` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — after an ok Set the card names the version the kernel answered with (AC2) | flip `saved as v${answer.playbook.version}` → `saved` in `app/src/screens/playbooks/model.ts` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — a refused Set shows the kernel's own words (AC2) | flip `text: outcome.text }` → `text: "refused" }` in `app/src/screens/playbooks/PlaybookDetail.tsx` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — ⌘K `playbooks.mode-draft` sends `{mode, draft}` at once (AC8) | delete `handlers().setModeDraft(p)` in `app/src/screens/playbooks/commands.ts` |
| `kernel/test/playbooks-foundation.test.ts` — the `mode:` line sits immediately before `model:` (AC6 ordering) | move `valueLine("mode", row.mode, row.mode_set_by),` to after `valueLine("model", row.model, row.model_set_by),` in `kernel/src/playbooks/enable.ts` (reviewer-applied; not a machine form) |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — choosing Live on the card opens the confirm (AC2) | delete `onAskLive(playbook)` in `app/src/screens/playbooks/PlaybookDetail.tsx` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — confirming the card's Live confirm sends exactly one `{mode, live}` (AC2) | delete `onSet(playbook, "mode", "live")` in `app/src/screens/playbooks/PlaybookDetail.tsx` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — Draft sends at once, no confirm (AC4) | flip `onSet(playbook, "mode", "draft")` → `onAskLive(playbook)` in `app/src/screens/playbooks/PlaybookDetail.tsx` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — "Ask Wright for the dry run and enable" puts the line in Wright's composer, sends nothing (AC2) | delete `handOffComposerText(WRIGHT, dryRunEnableLine(playbook))` in `app/src/screens/playbooks/PlaybooksScreen.tsx` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — not-enabled explainer shown (AC5) | flip `must be enabled (turned on) first` → `is not enabled` in `app/src/screens/playbooks/model.ts` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — ⌘K `playbooks.mode-draft` enabled only when the mode is live (AC8) | flip `latest.mode === "live"` → `true` in `app/src/screens/playbooks/commands.ts` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — ⌘K `playbooks.mode-live` sends no `/set`, lands on the card with the confirm open (AC8) | flip `handlers().askLive(p)` → `handlers().setModeDraft(p)` in `app/src/screens/playbooks/commands.ts` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — ⌘K `playbooks.ask-dry-run-enable` hands off to Wright (AC8) | delete `handlers().askDryRunEnable(p)` in `app/src/screens/playbooks/commands.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Mode control and truthful Mode row on the card; LIVE-aware enable display | all | 8 modify, 0 create | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Path | Action | Lines at base | Confidence | Home / note |
|------|--------|---------------|------------|-------------|
| `kernel/src/playbooks/enable.ts` | MODIFY | 565 | HIGH | `enableDisplay` gains the `mode:` line and the LIVE first-line word. Append reason: (565 — `enableDisplay` is the single builder of the enable display; two lines change). |
| `kernel/test/playbooks-foundation.test.ts` | MODIFY | 462 | HIGH | New `it` in the `merge_requirement` describe (it already has `draft()` and `preHold()`): one draft-mode and one live-mode enable display (set `mode='live', mode_set_by='owner'` on the row directly, version unchanged, so the done dry run still matches). |
| `app/src/screens/playbooks/PlaybookDetail.tsx` | MODIFY | 253 | HIGH | Home of the card's Mode control (its only user), the mode-aware row caption, the Live confirm and the post-Set Wright offer. |
| `app/src/screens/playbooks/model.ts` | MODIFY | 429 | HIGH | Shared home of the Mode texts (draft/live captions, the Live explanation, the not-enabled explainer), the dry-run-and-enable hand-off line, and new test ids. |
| `app/src/screens/playbooks/PlaybookEdit.tsx` | MODIFY | 240 | HIGH | Its live confirm's description reads the shared model.ts explanation (keeps the AC5b pinned phrase). |
| `app/src/screens/playbooks/commands.ts` | MODIFY | 124 | HIGH | Three new commands and handlers (AC8). |
| `app/src/screens/playbooks/PlaybooksScreen.tsx` | MODIFY | 493 | HIGH | Outside Touches (see `## Scope widening`): passes `setField` and the Live-confirm state to `PlaybookDetail`, adds the hand-off handler, wires the three ⌘K handlers. |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` | MODIFY | 1003 | HIGH | New describe blocks for AC1–AC5 and AC8. Append reason: (1003 — the playbook kernel harness `mountLoaded`/`applySet`/`posts` lives only in this file; a new file would copy it, and the requirement's Touches names this file). |

### Subtask Contracts

```yaml
# Subtask 1 — Mode control on the card + LIVE-aware enable display (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "kernel/src/playbooks/enable.ts", name: 'valueLine("mode", row.mode, row.mode_set_by)'}
  - {kind: "symbol", path: "app/src/screens/playbooks/commands.ts", name: "playbooks.mode-live"}
  - {kind: "symbol", path: "app/src/screens/playbooks/commands.ts", name: "playbooks.mode-draft"}
  - {kind: "symbol", path: "app/src/screens/playbooks/commands.ts", name: "playbooks.ask-dry-run-enable"}
  - {kind: "symbol", path: "app/src/screens/playbooks/model.ts", name: "liveChoosable"}
  - {kind: "symbol", path: "app/src/screens/playbooks/model.ts", name: "dryRunEnableLine"}
  - {kind: "symbol", path: "app/src/screens/playbooks/model.ts", name: "modeSavedText"}
  - {kind: "symbol", path: "app/src/screens/playbooks/PlaybookDetail.tsx", name: "onAskLive"}
requires: []
lanes:
  - "kernel/src/playbooks/enable.ts"
  - "kernel/test/playbooks-foundation.test.ts"
  - "app/src/screens/playbooks/PlaybookDetail.tsx"
  - "app/src/screens/playbooks/PlaybookEdit.tsx"
  - "app/src/screens/playbooks/model.ts"
  - "app/src/screens/playbooks/commands.ts"
  - "app/src/screens/playbooks/PlaybooksScreen.tsx"
  - "app/src/screens/playbooks/PlaybooksScreen.test.tsx"
external_requires: []
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| `PlaybooksScreen.tsx` is outside the requirement's Touches (Feasibility (Phase 2.5)) | MEDIUM | Recorded under `## Scope widening` as `pending-coordinator`; the change there is wiring only (props and three handlers), no new behaviour. |
| An approval or caption text change breaks tests that pin the display (requirement's own risk) | MEDIUM | Draft-mode first line kept byte-identical (`playbooks-dry-run.test.ts`); the mode line is inserted, and existing line pins use `toContain` on split lines; the draft caption is unchanged (e2e pin); the Edit confirm keeps its pinned phrase. Update, never delete, any pin that changes. |
| After Set live the playbook is a draft at a new version, so "Live only when enabled" would grey out the chosen Live | LOW | Live stays shown as chosen when `mode === "live"` (`aria-checked`); `liveChoosable` gates only a change to Live, so an already-live playbook never reopens the confirm. The explainer shows only when Live is not the current mode and the playbook is not enabled. |
| A ⌘K Live command that sent the Set directly would skip the confirm | MEDIUM | The command opens the card's confirm (state held in the screen) and sends nothing; a test asserts zero `/set` posts after running it. |
| Untrusted kernel text (name, slug) in the new hand-off line or dialog | LOW | Through `safe(` and rendered as text children, as `handoffLine` does. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-12-playbook-live-mode-on-card.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-13T02:12:06Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/268
- **Branch:** feature/playbook-live-mode-on-card
- **Files changed:** 8
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Card Draft/Live Mode control with the Live confirm and the Wright dry-run-and-enable hand-off, truthful Mode caption, three ⌘K commands, and a LIVE-aware enable display (mode: line before model:, ", LIVE" on a live first line). Heal round 1 fixed a HIGH (Mode note/hand-off leaked across playbooks; key={current.id} + regression test); 3 LOW dismissed below the MEDIUM floor. Kernel 4461 + app 3263 tests pass, typecheck clean.

## Not verified
- **Mode control layout on the card (spacing and radio styling)** — no browser or e2e run; only DOM and ARIA asserted in jsdom (subtask 1)
- **app/e2e/playbooks.spec.ts chip-alignment and caption-in-.pb-value pins** — e2e suite not run (subtask 1)
