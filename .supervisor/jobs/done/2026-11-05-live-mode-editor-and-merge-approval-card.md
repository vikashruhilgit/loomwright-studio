# Supervisor Job: Playbook live mode in the policy editor, and the "Approve in Studio" merge approval card (phase 8 item 13)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-02-150636/L9
- **CLAUDE.md:** ✓ Found (fresh: phases and paths it names match the tree at the base commit)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8/2026-11-02-160013-playbook-live-mode-and-the-merge-approval-card.md
- **Base commit:** 1a1cc2785cf06d4f248116d439d581f9211283ce

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React + TypeScript renderer under `app/` (vitest, Playwright Electron e2e); kernel vitest for the contract pin. No new dependency. |
| 2 | Dependency Availability | GO | Items it depends on are on `main`: 02 (`docs/design/mockups/phase-8.html` has `merge-card` and `playbook-mode-confirm` views), 04 (live mode: the kernel takes the owner's `live` on an enabled playbook, else `live_needs_enable`), 08 (`merge_requirement` row; `MERGE_APPROVAL_ACTION` in `kernel/src/integrations/github/repo-policy.ts`). The shared `Dialog` component exists (`app/src/components/Dialog/Dialog.tsx`). |
| 3 | Architecture Fit | CAUTION | The merge approval is filed by item 09 (`kernel_merge_approval_request`), which is NOT on `main`. Only `repo`, `pr`, `head_sha` are fixed by code today (item 08's `hasMergeApproval` reads `$.repo`, `$.pr`, `$.head_sha`); the CI, READY-time and policy keys are not. The card must read the payload by type only and show a missing field as missing, never guess. |
| 4 | Scope vs Supervisor Capability | CAUTION | ~15 source/test files plus screenshots: past the one-worker bound, so it splits along the two independent screens (see Configuration). |
| 5 | Hard Blockers | GO | None. The Electron open-external allowlist (`app/electron/open-external.ts`, outside Touches) does not admit PR URLs, so the PR link is shown as text (the existing Chat convention), which needs no change there. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Make `mode` editable (draft / live, with a confirm) on the Playbooks screen's field editor while Chat's draft card keeps it read-only, and draw a pending `kernel_merge_approval_request` approval in Approvals as a merge card (repo, PR, short head SHA, CI, Loomwright's READY time, the repo's policy) offering only Allow once and Deny, with light and dark polish screenshots under `docs/evidence/phase-8-polish/`.

**Problem Statement:**
The owner needs going live and approving a merge to be deliberate, readable decisions.
Currently the shared policy editor offers `live` disabled ("live (not available yet)", phase 6's limit, `modePolicyRow` in `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx`), although item 04 made the kernel accept it; and Approvals draws every held action generically, with "Always for this playbook" offered beside Allow once, so a merge approval's head SHA and CI are buried in a raw payload. This causes a merge allow the owner cannot read before giving it, and an allow that is only valid for one head.
Success looks like: one `mode: live` set after an explicit confirm, and a merge card whose facts are legible and whose only choices are Allow once and Deny.

## Acceptance Criteria
- [ ] AC1. Given an enabled draft playbook on the Playbooks screen's Edit fields view, when the owner opens Edit mode, picks `live`, presses Set and confirms the dialog (which says live acts on GitHub through the approval gate), then exactly one `POST /playbooks/:id/set` with `{field: "mode", value: "live"}` is sent; Cancel in the dialog sends nothing; a kernel refusal (e.g. `live_needs_enable`) shows under the mode field in the kernel's words and code. Chat's draft card still shows `mode` read-only (no Edit button; `app/src/screens/chat/cards.test.tsx` stays green unchanged).
- [ ] AC2. Given a pending approval whose `action` is `kernel_merge_approval_request`, then Approvals draws it as a merge card showing the repo, the PR (number and its `https://github.com/<owner>/<repo>/pull/<n>` URL as text), the head SHA's short form (7 characters, full SHA available as its title/accessible text), the CI state, Loomwright's READY time and the repo's policy, each read from the payload by type only (a missing or wrongly typed field reads "not in the request"), and it offers Allow once and Deny only: no "Always for this playbook" button, the `⇧A` palette command is disabled for it, and the Approvals screen's `decide()` refuses `always` for a merge approval (nothing is sent, an attention notice says a merge is asked every time), so on the Approvals screen the Always button, the `⇧A` palette command and the Shift+A keydown all send no `{decision: "always"}` request. (Chat's inline approval card is outside Touches and out of this AC; see Risk Assessment.) A non-merge approval still renders and decides exactly as before.
- [ ] AC3. Given `PLAYBOOK_POLICY_FIELDS` (`kernel/src/playbooks/store.ts`), when `cd kernel && npm test -- console-contract` runs, then the pin of the shared editor's fields still passes with `mode` editable on the Playbooks screen (`POLICY_FIELDS` + `READ_ONLY_POLICY_FIELDS` equal the kernel's list, in order; `READ_ONLY_POLICY_FIELDS` now documented as Chat's read-only rows), and a new pin asserts the app's mirrored `MERGE_APPROVAL_ACTION` in `app/src/screens/approvals/subject.ts` equals the kernel's.
- [ ] AC4. Given the built app against the fixture kernel, when the e2e specs run with their evidence env var set, then committed screenshots exist in light and dark under `docs/evidence/phase-8-polish/playbooks/` (mode editor with live selectable, the live confirm dialog, the refused-live state) and `docs/evidence/phase-8-polish/approvals/` (merge card pending, after Allow once, after Deny), each folder's `README.md` names every file it holds, and without the env var no tracked file under `docs/evidence/phase-8-polish/` changes.

## Touched-file invariants

> Grounded at base `1a1cc2785cf06d4f248116d439d581f9211283ce`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/components/PlaybookPolicy/PlaybookPolicy.tsx`** — keep: the props-only, no-kernel contract (`the caller owns the write, and a pending write`) and text-child rendering (`string is a React text child only.`); keep `export const READ_ONLY_POLICY_FIELDS = ["mode", "merge_requirement"] as const;` and `export const POLICY_FIELDS = ["dedupe_key", "priority", "model", "token_limit"] as const;` byte-for-byte (read as text by the kernel pin's `constStringList`, which requires `export const NAME = [ … ] as const;` on one line) — only the doc comment above them changes, to say `READ_ONLY_POLICY_FIELDS` are the rows Chat's card shows but does not edit; keep `mergeRequirementPolicyRow` read-only (its editor is not this item's scope), and reword its two "comes with phase 8 item 13" comments (above `READ_ONLY_POLICY_FIELDS`: `editor for it comes with phase 8 item 13.`; above the row: `editor text row is the one phase 8 item 13 wires.`) to "a later item" (the rest of that doc comment, `Kernel policy fields the Chat card shows but does not edit`, already describes the new state); rewrite `modePolicyRow`'s doc comment (`kernel refuses \`live\`, so the owner sees it exists and is not available yet.`), which this change makes false; `modePolicyRow` stays the only home of the mode options. pinned by: `kernel/test/console-contract.test.ts` (`expect(shown).toEqual(["mode", "merge_requirement"]);`) and `PlaybookPolicy.test.tsx` (`expect(READ_ONLY_POLICY_FIELDS).toEqual(["mode", "merge_requirement"]);`, and the `live (not available yet)` test, which this item rewrites).
- **`app/src/screens/playbooks/PlaybookEdit.tsx`** — keep: no optimistic update (`Nothing shown changes until the kernel answers`); the double-submit guard (`if (sending.current) return;`) and exactly one `onSet` per confirmed Set (`outcome = await onSet(playbook, row.field, value);`); refusals in the kernel's words under the field (`setNote({ field: row.field, tone: "danger", text: outcome.text });`). The live confirm opens before `confirm` sends and only `live` (not `draft`) opens it; its Cancel returns focus to the mode editor and sends nothing. reuse: the shared `Dialog` (`app/src/components/Dialog/Dialog.tsx`, `kind`/`title`/`description`/`action`/`onCancel`), never a new modal.
- **`app/src/screens/approvals/subject.ts`** — keep: pure, no markup (`Pure: nothing here builds`) and `The payload is untrusted and read by type only`; mirror: `MERGE_APPROVAL_ACTION = "kernel_merge_approval_request"` in `kernel/src/integrations/github/repo-policy.ts` (`export const MERGE_APPROVAL_ACTION = "kernel_merge_approval_request";`) and its reader's keys `$.repo`, `$.pr`, `$.head_sha`. The parser reads fields from `payload.input` when the payload is the rail's `{tool, input, cwd}` shape (as `charterApproval` in `app/e2e/fixtures/approvals.ts` is), else from the payload itself, so either shape item 09 files is read. `repo` must match `^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$`, `pr` a positive safe integer, `head_sha` `^[0-9a-f]{7,40}$`; anything else is not a merge card's PR (no URL is built).
- **`app/src/screens/approvals/ApprovalsScreen.tsx`** (1019) — keep: `{printable(a.action)}`, the exact untrusted payload well (`payloadText(a.payload)`), the decision buttons' keys (`aria-keyshortcuts="A"`, `aria-keyshortcuts="D"`), the busy/disabled rule (`const off = (decision: Decision): boolean => disabled && !busyOn(decision);`) and the `⇧A` command's `enabled` gate (`return can && current !== undefined && alwaysRefusalFor(current) === undefined;`), which gains `&& mergeApprovalOf(current) === undefined`. The one send-side guard: `decide()` (the function the keydown handler's `key === "A" && event.shiftKey ? "always"` branch and the palette command both reach) refuses `decision === "always"` when `mergeApprovalOf(approval) !== undefined`, before any request, with an attention notice, the same way its existing `alwaysRefusalFor` branch refuses. Only that guard, a mount point for `MergeApprovalCard` and the Always-button suppression are added here; the card's markup lives in the new file.
- **`app/src/screens/approvals/MergeApprovalCard.tsx`** (create) — mirror: Chat's PR-link convention, `an \`href\` is never built from one (the PR URL is shown as text,` (`app/src/screens/chat/integrationCards.tsx`): `app/electron/open-external.ts` `answers yes to exactly three forms` and is outside Touches, so the PR URL is text, not a link. Every payload string goes through `printable`. Says approving does not merge (Loomwright's gate merges, invariant 4); no control's text says merge.
- **`kernel/test/console-contract.test.ts`** — keep: the app is read as TEXT, never imported (`is read as TEXT, never imported`) and the existing `constStringList` reader; the new pin reads `subject.ts` as text with a fixed regex and compares to the kernel's `MERGE_APPROVAL_ACTION` imported from `../src/integrations/github/repo-policy.js` (or `../src/integrations/index.js`, which re-exports it).
- **`app/src/screens/playbooks/PlaybooksScreen.test.tsx`** (881) — keep: every existing field test green; the mode-options assertion (`screen.getByRole("option", { name: "live (not available yet)" })`) is rewritten to the enabled `live` option, never deleted; the read-only rows check (`Change this with Edit in English`) is unchanged. The new confirm tests append to the existing edit-view `describe`.
- **`app/src/screens/approvals/ApprovalsScreen.test.tsx`** (971) — keep: the existing Always / `alwaysRefusalFor` tests green unchanged (`always-reason` test id), so a non-merge approval's Always path is proved intact; merge-card and `mergeApprovalOf` tests append in their own `describe`.
- **`app/e2e/approvals.spec.ts`, `app/e2e/playbooks.spec.ts`** — keep: launch only through the harness (`launchApp` from `./electron-harness`; `app/scripts/hidden-windows.test.ts` fails a spec that `calls \`electron.launch\``); the existing evidence switches (`process.env.APPROVALS_EVIDENCE === "1"`, `process.env.PLAYBOOKS_EVIDENCE === "1"`) and their phase 5 / phase 7 dirs stay as they are; the new phase 8 shots use their own switch and dir, and default to Playwright's per-test output dir. The playbooks spec's `live (not available yet)` assertion is rewritten (live is now selectable).
- **`app/e2e/fixtures/approvals.ts`** — keep: every body typed by the contract (`Every body is typed by the contract.`); the rail payload shape `{tool, input, cwd}` (`The payload is the rail's \`{tool, input, cwd}\``) for the new `mergeApproval(id)` builder's rail variant.
- **`app/e2e/fixtures/playbooks.ts`** — NOT edited (outside the requirement's Touches list). It already answers the owner's `live` (`live_needs_enable: mode live needs playbook`), and a spec wanting an enabled playbook sets `kernel.playbooks` itself; if a needed state is missing, the worker stops and reports it.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/console-contract.test.ts` — the new `MERGE_APPROVAL_ACTION` mirror pin | flip `"kernel_merge_approval_request"` → `"kernel_merge_approval"` in `app/src/screens/approvals/subject.ts` |
| `app/src/components/PlaybookPolicy/PlaybookPolicy.test.tsx` — the rewritten mode-options test (live selectable) | flip `{ value: "live", label: "live" }` → `{ value: "live", label: "live", disabled: true }` in `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx` |
| `app/src/screens/approvals/ApprovalsScreen.test.tsx` — merge card renders no "Always for this playbook" button | flip `!isMergeApproval(a) ? (` → `true ? (` in `app/src/screens/approvals/ApprovalsScreen.tsx` (the Always button's render guard) |
| `app/src/screens/approvals/ApprovalsScreen.test.tsx` — Shift+A on a pending merge approval sends no request | flip `decision === "always" && isMergeApproval(approval)` → `false` in `app/src/screens/approvals/ApprovalsScreen.tsx` (the `decide()` guard) |
| `app/src/screens/approvals/ApprovalsScreen.test.tsx` — `⇧A` command disabled for a merge approval | flip `&& !isMergeApproval(current)` → `&& true` in `app/src/screens/approvals/ApprovalsScreen.tsx` |
| `app/src/screens/approvals/ApprovalsScreen.test.tsx` — a missing or wrongly typed `ci` reads "not in the request" | flip `typeof ci === "string" ? ci : undefined` → `typeof ci === "string" ? ci : "green"` in `app/src/screens/approvals/subject.ts` |
| `app/src/screens/approvals/ApprovalsScreen.test.tsx` — head commit shows 7 characters | flip `headSha.slice(0, 7)` → `headSha` in `app/src/screens/approvals/MergeApprovalCard.tsx` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — the changed mode-options assertion (was `live (not available yet)` disabled; now `live` enabled) | flip `{ value: "live", label: "live" }` → `{ value: "live", label: "live", disabled: true }` in `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx` |
| `app/e2e/playbooks.spec.ts` — the changed mode-options assertion (was `toBeDisabled`; now enabled) | flip `{ value: "live", label: "live" }` → `{ value: "live", label: "live", disabled: true }` in `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` — Set live opens the confirm; confirm sends exactly one `mode: live`; Cancel sends nothing | flip `value === "live"` → `false` in `app/src/screens/playbooks/PlaybookEdit.tsx` (the condition that opens the confirm instead of sending) |

(The worker writes these exact literals, or updates the row to the literal it wrote. Each mutant type-checks and turns its listed pins red; rows 2, 8 and 9 share one mutant by design, because three pins guard the same option.)

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Playbook `mode` editable (draft/live) with the live confirm; contract pin kept | AC1, AC3 (fields pin), AC4 (playbooks shots) | 6 modify, 1 create (+ PNGs) | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |
| 2 | Merge approval card in Approvals (Allow once / Deny only); action mirror pin | AC2, AC3 (action pin), AC4 (approvals shots) | 7 modify, 2 create (+ PNGs) | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| 1 mode | `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx` (275), `app/src/components/PlaybookPolicy/PlaybookPolicy.test.tsx` (261), `app/src/components/PlaybookPolicy/PlaybookPolicy.css` (34, only if the confirm/hint needs a style), `app/src/screens/playbooks/PlaybookEdit.tsx` (210), `app/src/screens/playbooks/PlaybooksScreen.test.tsx` (881 — append: the Touches name this file as the screen's test home and no new test file is in Touches), `app/e2e/playbooks.spec.ts` (955 — append: same reason) | `docs/evidence/phase-8-polish/playbooks/README.md` + its PNGs | HIGH |
| 2 card | `app/src/screens/approvals/subject.ts` (81 — the existing home of "what an approval is about": `MERGE_APPROVAL_ACTION` + `mergeApprovalOf`), `app/src/screens/approvals/ApprovalsScreen.tsx` (1019 — append only a mount point and the Always suppression; the card is its own module), `app/src/screens/approvals/approvals.css` (324), `app/src/screens/approvals/ApprovalsScreen.test.tsx` (971 — append: the only test file in Touches for this screen, covering `mergeApprovalOf` too), `app/e2e/approvals.spec.ts` (528 — append: same reason), `app/e2e/fixtures/approvals.ts` (344 — a `mergeApproval(id)` builder) | `app/src/screens/approvals/MergeApprovalCard.tsx`, `docs/evidence/phase-8-polish/approvals/README.md` + its PNGs | HIGH |
| 2 pin | `kernel/test/console-contract.test.ts` (313) — header item 4 reworded (`READ_ONLY_POLICY_FIELDS` are Chat's read-only rows; the Playbooks screen edits `mode` through `modePolicyRow`), the fields pin's assertion values unchanged, and a new item 5 / `describe` block for the `MERGE_APPROVAL_ACTION` mirror | — | HIGH |

**One owner for the contract test:** `kernel/test/console-contract.test.ts` is in Subtask 2's lanes only. AC3's fields half needs no assertion change (the constants keep their values), so Subtask 1 verifies it by running `cd kernel && npm test -- console-contract` and does not edit the file.

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` fails a relative markdown link under `docs/` whose target is missing, so each `docs/evidence/phase-8-polish/*/README.md` may link only to PNGs committed in the same PR.

### Subtask Contracts

```yaml
# Subtask 1 — playbook mode editable with the live confirm (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "app/src/components/PlaybookPolicy/PlaybookPolicy.tsx", name: "modePolicyRow"}
  - {kind: "symbol", path: "app/src/screens/playbooks/PlaybookEdit.tsx", name: "PlaybookEdit"}
  - {kind: "file", path: "docs/evidence/phase-8-polish/playbooks/README.md"}
requires: []
lanes:
  - "app/src/components/PlaybookPolicy/PlaybookPolicy.tsx"
  - "app/src/components/PlaybookPolicy/PlaybookPolicy.test.tsx"
  - "app/src/components/PlaybookPolicy/PlaybookPolicy.css"
  - "app/src/screens/playbooks/PlaybookEdit.tsx"
  - "app/src/screens/playbooks/PlaybooksScreen.test.tsx"
  - "app/e2e/playbooks.spec.ts"
  - "docs/evidence/phase-8-polish/playbooks/**"
external_requires:
  - "phase 8 item 04 on main: the kernel stores the owner's live on an enabled playbook, else 409 live_needs_enable"

# Subtask 2 — the merge approval card and the action mirror pin (LAUNCHABLE)
provides:
  - {kind: "file", path: "app/src/screens/approvals/MergeApprovalCard.tsx"}
  - {kind: "symbol", path: "app/src/screens/approvals/MergeApprovalCard.tsx", name: "MergeApprovalCard"}
  - {kind: "symbol", path: "app/src/screens/approvals/subject.ts", name: "MERGE_APPROVAL_ACTION"}
  - {kind: "symbol", path: "app/src/screens/approvals/subject.ts", name: "mergeApprovalOf"}
  - {kind: "symbol", path: "app/e2e/fixtures/approvals.ts", name: "mergeApproval"}
  - {kind: "file", path: "docs/evidence/phase-8-polish/approvals/README.md"}
requires: []
lanes:
  - "app/src/screens/approvals/subject.ts"
  - "app/src/screens/approvals/ApprovalsScreen.tsx"
  - "app/src/screens/approvals/MergeApprovalCard.tsx"
  - "app/src/screens/approvals/approvals.css"
  - "app/src/screens/approvals/ApprovalsScreen.test.tsx"
  - "app/e2e/approvals.spec.ts"
  - "app/e2e/fixtures/approvals.ts"
  - "kernel/test/console-contract.test.ts"
  - "docs/evidence/phase-8-polish/approvals/**"
external_requires:
  - "kernel MERGE_APPROVAL_ACTION in kernel/src/integrations/github/repo-policy.ts (item 08, on main)"
  - "phase 8 item 09 (not on main) files the approval and owns its CI / READY / policy payload keys"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
Subtask 2 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (`kernel/test/console-contract.test.ts` is in Subtask 2's lanes only; each evidence subfolder has its own README) | NO |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel)
- **Recommended workers:** 2
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md`, `skills/playwright-e2e/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Design notes (for both workers)

- **Mode (Subtask 1).** `modePolicyRow` offers `draft` and `live` (both selectable; label `live`), with a hint taken from the mockup's mode copy (`docs/design/mockups/phase-8.html`, `modeHint`): live acts on GitHub through the approval gate, after a dry run and an approval of the enable. Chat's card (`app/src/screens/chat/cards.tsx`) keeps rendering only `modePolicyRow(playbook).shown` and is not edited. In `PlaybookEdit`, a Set of `live` from the mode row opens a `Dialog` titled like the mockup's `liveDialog` ("Turn on live mode for “<name>”?", description "Live acts on GitHub through the approval gate. …"); its primary action calls the existing `confirm(row, "live")` once; Cancel closes it and returns focus to the mode editor. Setting `draft` sends at once, as today. A refusal (`live_needs_enable`) is the kernel's text under the mode field, as for any field.
- **Merge card (Subtask 2).** `mergeApprovalOf(a)` returns `undefined` unless `a.action === MERGE_APPROVAL_ACTION` and `repo`/`pr`/`head_sha` validate; otherwise `{repo, pr, headSha, ci, readyAt, policy}` where `ci`, `readyAt` (`ready_at`) and `policy` are strings when present and the right type, else `undefined` ("not in the request"). The card (header "Allow PR #<n> to go to Loomwright's gate", rows Pull request / Repo / Head commit / CI / Loomwright READY / Repo policy, the line "Approving does not merge. Loomwright's gate merges the PR when its own checks pass.") is mounted by `ApprovalDetail` above the payload well for a merge approval; the generic header, payload well and Allow once / Deny stay; the Always button is not rendered and the `⇧A` command is disabled for it. Head commit shows `headSha.slice(0, 7)` with the full SHA as accessible text.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Item 09 (not on `main`) files the merge approval and owns its payload; only `repo`/`pr`/`head_sha` are fixed by code (item 08's `hasMergeApproval`). If 09 names CI/READY/policy differently (e.g. `ci_state`), the card shows "not in the request" for them. — source: Feasibility (Phase 2.5) | HIGH | Read by type only and fail visible, never guess; keep every key name in one place (`subject.ts`), list them in its doc comment and in the approvals evidence README so item 09's worker can match them; the `MERGE_APPROVAL_ACTION` mirror pin catches an action rename. Read fields from `payload.input` when the payload is the rail's `{tool, input}` shape, else top level, so either filing shape is read. |
| Item 08's `hasMergeApproval` reads `$.repo` at the payload top level, while a rail-held tool approval's payload is `{tool, input, cwd}`; if item 09 holds the tool through the rail, `policyMet` would never see the approval. Out of this item's scope (no kernel source in Touches). — source: Feasibility (Phase 2.5) | MEDIUM | Do not patch the kernel. Note it in the PR body's follow-ups and in the approvals evidence README for item 09. |
| Scope ~15 files: split into two parallel subtasks. — source: Feasibility (Phase 2.5) | MEDIUM | Zero lane overlap (console-contract owned by Subtask 2; separate evidence subfolders). |
| The PR URL cannot open in the browser: `app/electron/open-external.ts` allows exactly three addresses and is outside Touches. | LOW | Show the URL as text (Chat's existing convention); a clickable link is a follow-up that edits the allowlist and its test. |
| `PlaybookPolicy.tsx`'s two `merge_requirement` comments say its editor comes with item 13, but item 13's Scope does not include it; `modePolicyRow`'s comment and `app/src/screens/chat/cards.tsx`'s `only \`draft\` is accepted in phase 6` comment go stale with this change. | LOW | Leave `mergeRequirementPolicyRow` read-only (requirement fit); reword both merge_requirement comments to "a later item" and rewrite `modePolicyRow`'s comment (in Touches). `cards.tsx` is outside Touches: list its stale comment as a PR-body follow-up, never an edit. |
| A merge approval held through the rail from a playbook session would be eligible for the kernel's `always` grant (`kernel/src/approvals/store.ts` refuses `always` only for approvals the rail did not hold). | MEDIUM | The Approvals screen never sends `always` for one (`decide()` guard, AC2); a kernel-side refusal is item 09's (it owns `ALWAYS_HELD_TOOLS`, "never covered by an always grant"); note it in the approvals evidence README. |
| Chat's inline approval card (`app/src/screens/chat/cards.tsx`, `ApprovalCard`) has its own `decide` and offers Always for any approval with a playbook, bypassing the Approvals screen's guard; `cards.tsx` is outside Touches. | HIGH | Not patched here (binding Touches rule). Record it as a PR-body follow-up and in the approvals evidence README for item 09: the real close is item 09's kernel-side refusal of `always` for `kernel_merge_approval_request` (its scope already says "never covered by an 'always' grant"), or a later item adding `cards.tsx` to Touches. If the owner wants it closed in this item, the lane stops and asks for `cards.tsx` to be added. |
| Screenshots differ between macOS and CI (fonts). | LOW | Specs assert behaviour, never pixels; evidence is written only with the env var, otherwise to Playwright's output dir; a guard asserts no tracked evidence file changed. |
| Large files (`ApprovalsScreen.tsx` 1019, its test 971, `PlaybooksScreen.test.tsx` 881, `playbooks.spec.ts` 955). | LOW | The card's markup and its payload parser live in their own modules; only mount points and tests are appended (Touches allow no new test file). |

## House Rules
> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- (from the source requirement) e2e specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts`).

## Validation
- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `cd kernel && npm ci && npm test -- console-contract`
- `bash scripts/check-docs.sh`

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 1
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-05-live-mode-editor-and-merge-approval-card.md
```

## Plan Review: PASS (attempt 3/3, saved by the owner at LP-SAVE-NOTE)
- **Deferred (MEDIUM, pin_mutations):** add Pin mutations rows for the new pins: `mergeApprovalOf` rejects a bad `repo` / `pr` / `head_sha` (so no URL is built), fields are read from `payload.input` for the rail shape and from the top level otherwise, the PR URL is text and never an `href`, and the approvals.spec merge-card checks (pending, after Allow once, after Deny). The `decide()`-guard and `⇧A`-command tests must use a rail-held, playbook-session merge approval (like `charterApproval`), so that `alwaysRefusalFor` returns undefined and only the new guard stops the request.

## Outcome
- **Status:** completed
- **Completed:** 2026-11-05T04:33:10Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/228
- **Branch:** feature/live-mode-editor-and-merge-approval-card
- **Files changed:** 27
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unknown (no_driver_handover)
- **Summary:** Playbooks field editor makes mode editable (draft/live) with a live confirm Dialog; Approvals draws kernel_merge_approval_request as a merge card (Allow once / Deny only; Always button, ⇧A and decide() guarded on the action); MERGE_APPROVAL_ACTION mirror pin in console-contract; light/dark evidence under docs/evidence/phase-8-polish/. Phase 4.5 round 1 FAIL (2 HIGH: merge payload read precedence vs the kernel's top-level reader, Always gate keyed on parse instead of action; 1 MEDIUM: live dialog during an in-flight Set) fixed in d53076e; round 2 PASS. 1 LOW dismissed (already-live dialog). Execute phase resumed on the legacy path after the Execute Manager checkpointed while its background workers were still running.
