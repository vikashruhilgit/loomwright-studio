# Supervisor Job: The Playbooks screen (phase 7, item 04): every playbook, its runs and versions, and field-level edits

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-30-192357/L2
- **CLAUDE.md:** ✓ Found (fresh: its invariants, `kernel/` layout and `cd kernel && npm ci && npm test` match the tree at base)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (disk: 28 GiB free, 94% used; enough for 2 worktrees, watch it)
- **Source requirement:** .supervisor/requirements/phase-7/2026-10-30-140004-the-playbooks-screen.md
- **Base commit:** f2fdc984476c914dfa2971eb9f014258e99ac846

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Kernel route in strict TS + vitest (`kernel/src/gui/` part seam); screen in React + Vite under `app/src/screens/playbooks/`; Playwright e2e through `app/e2e/electron-harness.ts`. All in place. |
| 2 | Dependency Availability | GO | No new dependency. The contract types (`PlaybookRun`, `PlaybookRunsResponse`, `PlaybookVersion`, `PlaybookVersionsResponse`), the two `CONTRACT_ROUTES` entries (`origin: "p7-item-04"`) and the fixture kernel's empty defaults for both routes already landed with item 01. `listPlaybookVersions` (kernel/src/playbooks/store.ts) is reusable. |
| 3 | Architecture Fit | CAUTION | The mockup's field-level edit shows eight fields and one batched "Save as vN+1"; the owner's only write, `POST /playbooks/:id/set`, takes one field per call (`dedupe_key`, `priority`, `model`, `token_limit`, `mode`; `live` refused) and writes one version per call. Name, intent and effort have no owner write route, and the requirement's non-goal forbids new kernel behaviour. DESIGN.md open points 6 and 8 leave this to item 04. Resolved in this brief: edits are per field, name/intent/effort are read-only in the edit view, and the decision is recorded in DESIGN.md. |
| 4 | Scope vs Supervisor Capability | CAUTION | About 20 files and well over 800 changed lines (kernel routes and test, shared editor extraction, screen, tests, e2e, 20 screenshots). That trips `context-bound`, so the work is split into 3 subtasks. |
| 5 | Hard Blockers | GO | None. No migration (`playbook_runs` and `playbook_versions` exist since migration 13; `item_ref`/`item_revision` since 17). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Build the Playbooks screen (list, detail, per-field edit through `POST /playbooks/:id/set`, run and version history, Turn on/off through the existing approval, Run now, Edit in English) and the two kernel read routes it needs (`GET /playbooks/:id/runs`, `GET /playbooks/:id/versions`), reusing Chat's playbook-card field editor.

**Problem Statement:**
The owner needs one screen where every playbook's policy is visible and settable, because today a playbook can only be seen and set through a Chat card or the `studio` CLI.
Currently nothing lists a playbook's runs or versions (`playbook_runs`, `playbook_versions` have no read route), and DESIGN.md deferred field-level playbook editing to GUI v2. This means the owner can't see what a playbook did, what it cost in tokens, or how it changed without reading the database.
Success looks like this: with the fixture kernel, the screen shows every field the GUI v2 mockup shows for Playbooks, each edit round-trips through the kernel, and the screenshots of all 10 mockup states in both themes are committed.

**Owner decisions carried from the requirement (binding, 2026-10-30):** each screen's kernel routes ride with that screen's item, in its own `gui` part, against item 01's contract. Hooks is deferred to phase 9. The GUI v2 mockup (`docs/design/mockups/gui-v2.html`) is the polish target. D3, D4, D9, D24, D26 and invariants 1–9 hold.

**Decisions this brief makes (DESIGN.md "Open points" 6 and 8 assign them to item 04; no kernel behaviour is added):**
- **Per-field edits.** The edit view shows all eight mockup fields. The five `POST /playbooks/:id/set` accepts (`dedupe_key`, `priority`, `model`, `token_limit`, `mode`) are editable one at a time, each with its own Set, which sends one `/set` and writes at most one kernel version (none when the value is unchanged: the kernel answers `changed: false`). The view always names the version the kernel answered with, never a predicted "vN+1". On an enabled playbook the edit view says, before any Set, that a change makes the playbook a draft again (the kernel's rule, as the mockup says). Whether that rule is right for an owner's one-field edit (DESIGN.md open point 7) stays the owner's open decision and is not changed here. Name, intent and effort are shown read-only with "Change this with Edit in English" because there is no owner write route. `mode` offers `draft` only and shows `live` disabled ("not available yet"), as the mockup does.
- **The On switch.** On → off sends `POST /playbooks/:id/off`, the existing owner route, which needs no approval. Off → on has no owner route. If a pending `kernel_playbook_enable` approval names this playbook (the `approvals` resource, `approval.playbook`), the switch reveals that held approval and links to it in Approvals (`#/approvals`). Otherwise it says the playbook turns on when Wright asks and the owner approves, and offers Edit in English. It never calls an enable path itself.

## Acceptance Criteria

Kernel (the `playbook-history` part):
- [ ] AC1. Given a playbook with recorded runs, when the owner calls `GET /playbooks/:id/runs` with the API token, then the kernel answers 200 `{runs, next_before}`. `runs` is newest first (by `playbook_runs.id`), and each run is exactly the contract's `PlaybookRun` (`id, playbook, version, kind, status, item_ref, item_revision, tokens, session, started, ended`, mapped from `session_id`, `started_at` and `ended_at`). `tokens` is the stored count, `null` while the run has none. `limit` defaults to 50 and is capped at 200. `before` is the opaque cursor from the previous page's `next_before`, which is `null` on the last page. A non-numeric id answers 400 `invalid_id`, an unknown playbook 404 `not_found`, and a malformed `limit` or `before` 400 `invalid_query`.
- [ ] AC2. Given a playbook with versions, when the owner calls `GET /playbooks/:id/versions`, then the kernel answers 200 `{versions}`, newest first. Each entry is `{playbook, version, snapshot, created_at}`, built with `listPlaybookVersions` (not a second SQL read), and an unreadable `snapshot_json`, or one that parses to anything but a plain object (null, an array, a string, a number), reads as `{}`, never a guessed row. A non-numeric id answers 400 `invalid_id` and an unknown playbook 404 `not_found`.
- [ ] AC3. Given the shipped `gui` contribution, then the `playbook-history` part declares exactly these two `GET` routes, neither `unauthenticated`, and the other five parts are still empty. `kernel/test/gui-foundation.test.ts` pins both facts, and `cd kernel && npm ci && npm run typecheck && npm test` passes.

App (carried from the requirement, plus the decisions above):
- [ ] AC4. Given the fixture kernel, then the list and detail show every field the mockup shows: name and intent, trigger, dedupe key, priority, model, effort, mode, last run, tokens and on/off. The poll spec, mode and dedupe key are shown in full, never truncated (phase 6's "Revisit when"). Each policy value shows who set it ("set by you" / "proposed by Wright"), and an unset value reads "not set", never a filled-in default (invariant 1, D4). Tokens are the counted figures (D26), and a dollar figure appears only through `formatEstimate` ("≈ … at API rates", D24).
- [ ] AC5. Given a field edit, then it is sent as one `POST /playbooks/:id/set` `{field, value}`. A refusal is shown under that field with the kernel's own message and code (`refusalOf`), and nothing shown changes locally until the kernel answers: no optimistic update, and the editor keeps its text while held. Name, intent and effort are read-only in the edit view, with the Edit in English hint.
- [ ] AC6. Given Turn on for a playbook that is off, then a pending `kernel_playbook_enable` approval for it is shown and linked (`#/approvals`), or, with none pending, the screen says Wright asks and the owner approves. No request turns the playbook on. Turn off sends `POST /playbooks/:id/off`.
- [ ] AC7. Given "Edit in English", then Wright's thread (`#/chat`) opens with the composer holding a line that names the playbook (its id and slug), focused, and no `POST /ask` is sent until the owner sends it.
- [ ] AC8. Given Run now on an enabled playbook, then `POST /playbooks/:id/run` is sent once (an in-flight guard drops repeats) and its refusal (`not_enabled`, `kill_switch_engaged`) is shown in the kernel's words.
- [ ] AC9. Given the kernel unreachable, then the shell's shared band shows and the screen keeps its last data, marked last known, without a throw. Given the first load failing, then the mockup's error state shows with a retry.
- [ ] AC10. Given the keyboard only, then every action on the screen is reachable (list rows, detail actions, each field's Edit/Set/Cancel with Escape, version list, switch, Run now). J/K move between rows as in the mockup, and the ⌘K palette lists the screen's commands (owner `playbooks`, ids `playbooks.*`), registered on mount and unregistered on unmount.
- [ ] AC11. Given a live feed event that changes what the screen shows (`playbook_*` via the `playbooks` resource; a run's `session_*`/`event_*` for the open playbook's runs), then the list, detail, runs and versions update without a reload and without layout shift: the rows keep their size, and no spinner replaces loaded content.
- [ ] AC12. Given VoiceOver, then every control and status has an accessible name (switches `"<name> is on|off"`, Set/Cancel per field, run status text beside each dot), and both themes meet WCAG 2.1 AA contrast using only the design tokens.
- [ ] AC13. Given Chat's playbook card, then it still renders and sets fields exactly as before. Its editor is the same shared component the screen uses, not a copy, and `app/src/screens/chat/cards.test.tsx` passes unchanged.
- [ ] AC14. Given the polish gate, then a committed evidence file `docs/evidence/phase-7-polish/playbooks/README.md` lists one screenshot per mockup state in light and dark: `playbooks-empty`, `-loading`, `-populated`, `-waiting`, `-error`, `-unreachable`, `-detail`, `-edit`, `-edit-refused` and `-history`, 20 PNGs captured from the running app by `app/e2e/playbooks.spec.ts` into that directory. Each is named against its mockup state, any deviation from the mockup is stated with its reason (per-field Set; read-only name/intent/effort), and the PR body links to the README.
- [ ] AC15. Given DESIGN.md "Open points" 6 and 8, then both record item 04's decision (per-field edit with read-only name/intent/effort; the off-state switch shows the held approval), and `bash scripts/check-docs.sh` passes.
- [ ] AC16. Validation: `cd app && npm ci && npm run typecheck && npm test && npm run build` passes, and `cd app && npx playwright test e2e/playbooks.spec.ts` passes, launched only through `app/e2e/electron-harness.ts`.

**Evidence rule:** AC14's evidence is the committed README and PNGs, not the PR body.

## File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel routes (#1) | `kernel/src/gui/playbook-history.ts`, `kernel/test/gui-foundation.test.ts` | `kernel/test/gui-playbook-history.test.ts` | HIGH |
| shared policy editor + chat handoff (#2) | `app/src/screens/chat/cards.tsx`, `app/src/screens/chat/chat.css`, `app/src/screens/chat/Thread.tsx`, `kernel/test/console-contract.test.ts` | `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx`, `app/src/components/PlaybookPolicy/PlaybookPolicy.css`, `app/src/components/PlaybookPolicy/PlaybookPolicy.test.tsx`, `app/src/screens/chat/handoff.ts`, `app/src/screens/chat/handoff.test.ts` | HIGH |
| screen + e2e + evidence (#3) | `app/src/screens/playbooks/index.tsx`, `docs/DESIGN.md` | `app/src/screens/playbooks/PlaybooksScreen.tsx`, `app/src/screens/playbooks/PlaybookDetail.tsx`, `app/src/screens/playbooks/model.ts`, `app/src/screens/playbooks/model.test.ts`, `app/src/screens/playbooks/commands.ts`, `app/src/screens/playbooks/PlaybooksScreen.test.tsx`, `app/src/screens/playbooks/playbooks.css`, `app/e2e/playbooks.spec.ts`, `app/e2e/fixtures/playbooks.ts`, `docs/evidence/phase-7-polish/playbooks/README.md` (+ 20 PNGs) | MEDIUM (screen file split is the worker's call within the directory) |

Reused, not modified: `kernel/src/playbooks/store.ts` (`listPlaybookVersions`, `getPlaybook`), `app/src/api/contract.ts` (types and routes already declared by item 01), `app/src/screens/chat/model.ts` (`write`, `refusalOf`), `app/src/components/formatEstimate.ts`, `app/e2e/fixture-kernel.ts` (defaults merged over by the new fixture), `app/src/store/*` (no new resource: see Risk Assessment).

**Total estimated files:** 8 modify + 16 create (plus 20 PNGs).

### Module layout

| Path | Lines at base | Home for the new responsibility |
|------|---------------|--------------------------------|
| `kernel/src/gui/playbook-history.ts` | 17 | The two routes and their row mappers live here: this part file is the home item 01 made for them. |
| `kernel/test/gui-foundation.test.ts` | 54 | Edit the empty-part pin only. Route behaviour tests go in the new `kernel/test/gui-playbook-history.test.ts`. |
| `kernel/test/console-contract.test.ts` | 279 | Repoint one URL constant (and its describe text) to the shared component. No new test here. |
| `app/src/screens/chat/cards.tsx` | 643 | Shrinks: `PolicyEditor`, `policyRows`, `PolicyRow`, `dedupeDraft`, `provenance`, `MODEL_NOT_SET`, `POLICY_FIELDS` and `READ_ONLY_POLICY_FIELDS` move to the new `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx`. Two homes (Chat card, Playbooks screen) need them, so the editor is extracted, not appended. |
| `app/src/screens/chat/chat.css` | 505 | Shrinks: the five `.chat-edit*` rules move to `PlaybookPolicy.css`. |
| `app/src/screens/chat/Thread.tsx` | 645 | Gains only a call that takes a pending composer text on mount. The handoff store is the new `app/src/screens/chat/handoff.ts`, not appended here. |
| `app/src/screens/playbooks/index.tsx` | 17 | Swaps `Component` to the real screen. Screen code goes in new files in the same directory. |
| `docs/DESIGN.md` | 203 | Appends the decision to open points 6 and 8 in place. |

## House Rules

> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

## Touched-file invariants

> Grounded at base `f2fdc984476c914dfa2971eb9f014258e99ac846`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/gui/playbook-history.ts`**: keep the part's name and exported route array (`name: "playbook-history",`, `export const playbookHistoryRoutes`), every array and the part `Object.freeze`d, and no route setting `unauthenticated` (the file's header: `none sets`; the full sentence "Every gui route is an owner route that needs the API token" is on one line in `kernel/src/gui/index.ts`). Imports stay type-level or store-level: never the Agent SDK, the session manager or `kernel.ts` (`kernel/src/gui/index.ts`: "imports only types, the feature seam"; pinned by `kernel/test/feature-seams.test.ts`). Reuse `listPlaybookVersions` and `getPlaybook` from `../playbooks/store.js`, and mirror the existing route idiom in `kernel/src/playbooks/drafts.ts` (`if (id === undefined) return { status: 400, body: { error: "invalid_id" } };`, `return { status: 404, body: { error: "not_found" } };`). The response shapes mirror `app/src/api/contract.ts` `export interface PlaybookRunsResponse` and `export interface PlaybookVersionsResponse` exactly.
- **`kernel/test/gui-foundation.test.ts`**: keep the part order pin `const PART_NAMES = ["tasks", "playbook-history", "schedules", "memory", "budget-audit", "settings"];`, the registry-position test, and "serves no gui route unauthenticated". Narrow only the empty-part pin, so it excludes `playbook-history` (which now pins its two `GET` paths). The merged-keys line `expect(Object.keys(guiContribution)).toEqual(["name"]);` becomes `["name", "routes"]`. Sibling lanes (items 03, 05–08) edit the same pin, so keep the change to the `playbook-history` row and the merged-keys line to make rebases trivial.
- **`kernel/test/console-contract.test.ts`**: keep the policy-field pin's logic (`constStringList(cards, "POLICY_FIELDS")`, `constStringList(cards, "READ_ONLY_POLICY_FIELDS")`, `PLAYBOOK_POLICY_FIELDS`) and leave the phase 7 route list untouched (`["p7-item-04", "GET /playbooks/:id/runs"],`, since the origin stays `p7-item-04`). Only `const PLAYBOOK_CARDS = new URL("../../app/src/screens/chat/cards.tsx", import.meta.url);` is repointed to `../../app/src/components/PlaybookPolicy/PlaybookPolicy.tsx`, and the moved constants keep the exact literal form `export const POLICY_FIELDS = ["dedupe_key", "priority", "model", "token_limit"] as const;` that its regex reads.
- **`app/src/screens/chat/cards.tsx`**: keep `export const TURN_ON_GAP`, `export const LAST_DRY_RUN_GAP` (imported by `app/src/screens/chat/cards.test.tsx`), `ALWAYS_INELIGIBLE` (imported by `app/src/screens/chat/thread.test.tsx`), `PlaybookCard`'s write path (`write(api, "/playbooks/:id/set", params, { field, value }, changes)`) and its in-flight guard. The card imports the moved editor and constants from the shared component and re-exports nothing with `export const POLICY_FIELDS`, so the pinned literal has exactly one home. Pinned by `app/src/screens/chat/cards.test.tsx`, which must pass unchanged.
- **`app/src/screens/chat/chat.css`**: remove only the moved `.chat-edit {`, `.chat-edit-controls`, `.chat-edit-controls .field-group`, `.chat-edit .field-label` and `.chat-edit-hint` rules. Their class names may change in the shared component (to `policy-edit*`) as long as `cards.tsx` and the CSS move together.
- **`app/src/screens/chat/Thread.tsx`**: keep the CharterCard prefill path (`onEditInEnglish={(prefill) => {`) and the composer contract (sends nothing on its own; `ChatComposer` owns `POST /ask`). The only change is the composer's initial text (`const [text, setText] = useState("");`) taking a pending handoff for this agent once on mount, and focusing the composer when one was taken.
- **`app/src/screens/playbooks/index.tsx`**: keep `id: "playbooks"` and `nav: { label: "Playbooks", order: 7, shortcut: "⌘7" },` (the mockup's ⌘7). Replace only `Component`, and drop the `ScreenPlaceholder` import (leave `app/src/screens/placeholder.tsx` in place: the other screens still use it).
- **`docs/DESIGN.md`**: edit only open points 6 (`**Field-level edit shows eight fields; the owner's write route takes five.**`) and 8 (`**The On switch.**`), adding the decision under each. No new relative link unless its target exists (`scripts/check-docs.sh` check 1).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/gui-playbook-history.test.ts` (route served, runs newest first, paging, 400/404) | delete `path: "/playbooks/:id/runs",` in `kernel/src/gui/playbook-history.ts` |
| `kernel/test/gui-playbook-history.test.ts` (versions route) | delete `path: "/playbooks/:id/versions",` in `kernel/src/gui/playbook-history.ts` |
| `kernel/test/gui-foundation.test.ts` (playbook-history part holds two GET routes; merged keys `["name", "routes"]`) | delete `routes: playbookHistoryRoutes,` in `kernel/src/gui/playbook-history.ts` |
| `kernel/test/console-contract.test.ts` (POLICY_FIELDS + READ_ONLY_POLICY_FIELDS = kernel PLAYBOOK_POLICY_FIELDS, now read from the shared component) | flip `"model", "token_limit"] as const;` → `"model"] as const;` in `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx` |
| `app/src/screens/chat/handoff.test.ts` (a taken handoff is cleared: taken once) | the reviewer removes the line in `app/src/screens/chat/handoff.ts` that deletes the entry on take, so a second take returns the text again |
| `app/src/screens/chat/handoff.test.ts` (a handoff fills Wright's composer on mount and focuses it, and nothing is sent) | delete `takeComposerHandoff(` in `app/src/screens/chat/Thread.tsx` (the composer mounts empty) |
| `app/src/components/PlaybookPolicy/PlaybookPolicy.test.tsx` (the editor holds its text while held; Escape cancels only when not held) | the reviewer drops the `held` check in `PolicyEditor`'s `onChange` in `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx`, so typing while held changes the text |
| `app/src/components/PlaybookPolicy/PlaybookPolicy.test.tsx` (the mode row offers `draft` only, `live` disabled) | the reviewer removes `disabled` from the `live` option `modePolicyRow`'s editor renders in `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx` |
| `app/src/screens/chat/cards.test.tsx` (the card sets fields through the shared editor, unchanged) | the reviewer makes `PlaybookCard` in `app/src/screens/chat/cards.tsx` skip `write(` for the Set path, so the card's set test goes red |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` (AC5: nothing changes locally until the kernel answers; a refusal shows the kernel's text) | the reviewer makes the screen's Set handler render the new value before `write` resolves (an optimistic update) in `app/src/screens/playbooks/PlaybookDetail.tsx` |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` (AC6: no request turns a playbook on; Turn off sends `/playbooks/:id/off`) | the reviewer makes the off-state switch send `POST /playbooks/:id/run` (any write) in the screen's switch handler |
| `app/src/screens/playbooks/PlaybooksScreen.test.tsx` (AC8: Run now's in-flight guard drops repeats) | the reviewer removes the in-flight guard check in the screen's Run now handler |
| `app/src/screens/playbooks/model.test.ts` (an unset policy value reads "not set"; a missing snapshot field reads unknown, never a default) | the reviewer makes the model's value formatter return the field's kernel default (`normal` / `draft`) for `null` in `app/src/screens/playbooks/model.ts` |
| `app/e2e/playbooks.spec.ts` (AC7: Edit in English opens `#/chat` with the playbook named and no `POST /ask` in the fixture's `requests`) | the reviewer makes the Edit in English handler call `api.request` for `/ask` after the handoff |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: `GET /playbooks/:id/runs` and `GET /playbooks/:id/versions` in the `playbook-history` gui part | AC1, AC2, AC3 | 2 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | App: extract the shared playbook policy editor from Chat's card; add Chat's composer handoff | AC13 (+ the AC5/AC7 building blocks) | 4 modify, 5 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 3 | App: the Playbooks screen, its palette commands, e2e, polish-gate evidence and the DESIGN.md decisions | AC4–AC12, AC14, AC15, AC16 | 2 modify, 10 create (+20 PNGs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | BLOCKED (by #2) |

### Subtask Contracts

```yaml
# Subtask 1 — kernel read routes (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/src/gui/playbook-history.ts"}
  - {kind: "symbol", path: "kernel/src/gui/playbook-history.ts", name: "playbookHistoryRoutes"}
  - {kind: "symbol", path: "kernel/src/gui/playbook-history.ts", name: "/playbooks/:id/runs"}
  - {kind: "symbol", path: "kernel/src/gui/playbook-history.ts", name: "/playbooks/:id/versions"}
  - {kind: "file", path: "kernel/test/gui-playbook-history.test.ts"}
requires: []
lanes:
  - "kernel/src/gui/playbook-history.ts"
  - "kernel/test/gui-foundation.test.ts"
  - "kernel/test/gui-playbook-history.test.ts"
external_requires: []

# Subtask 2 — shared policy editor + chat composer handoff (LAUNCHABLE)
provides:
  - {kind: "file", path: "app/src/components/PlaybookPolicy/PlaybookPolicy.tsx"}
  - {kind: "symbol", path: "app/src/components/PlaybookPolicy/PlaybookPolicy.tsx", name: "PolicyEditor"}
  - {kind: "symbol", path: "app/src/components/PlaybookPolicy/PlaybookPolicy.tsx", name: "policyRows"}
  - {kind: "symbol", path: "app/src/components/PlaybookPolicy/PlaybookPolicy.tsx", name: "provenance"}
  - {kind: "symbol", path: "app/src/components/PlaybookPolicy/PlaybookPolicy.tsx", name: "POLICY_FIELDS"}
  - {kind: "symbol", path: "app/src/components/PlaybookPolicy/PlaybookPolicy.tsx", name: "READ_ONLY_POLICY_FIELDS"}
  - {kind: "symbol", path: "app/src/components/PlaybookPolicy/PlaybookPolicy.tsx", name: "modePolicyRow"}
  - {kind: "file", path: "app/src/components/PlaybookPolicy/PlaybookPolicy.css"}
  - {kind: "file", path: "app/src/components/PlaybookPolicy/PlaybookPolicy.test.tsx"}
  - {kind: "file", path: "app/src/screens/chat/handoff.ts"}
  - {kind: "symbol", path: "app/src/screens/chat/handoff.ts", name: "handOffComposerText"}
  - {kind: "symbol", path: "app/src/screens/chat/handoff.ts", name: "takeComposerHandoff"}
  - {kind: "file", path: "app/src/screens/chat/handoff.test.ts"}
requires: []
lanes:
  - "app/src/components/PlaybookPolicy/*"
  - "app/src/screens/chat/cards.tsx"
  - "app/src/screens/chat/chat.css"
  - "app/src/screens/chat/Thread.tsx"
  - "app/src/screens/chat/handoff.ts"
  - "app/src/screens/chat/handoff.test.ts"
  - "kernel/test/console-contract.test.ts"
external_requires: []

# Subtask 3 — the Playbooks screen, e2e and evidence (BLOCKED by #2)
provides:
  - {kind: "file", path: "app/src/screens/playbooks/PlaybooksScreen.tsx"}
  - {kind: "symbol", path: "app/src/screens/playbooks/PlaybooksScreen.tsx", name: "PlaybooksScreen"}
  - {kind: "file", path: "app/src/screens/playbooks/model.ts"}
  - {kind: "file", path: "app/src/screens/playbooks/commands.ts"}
  - {kind: "symbol", path: "app/src/screens/playbooks/commands.ts", name: "PLAYBOOKS_OWNER"}
  - {kind: "file", path: "app/src/screens/playbooks/PlaybooksScreen.test.tsx"}
  - {kind: "file", path: "app/src/screens/playbooks/model.test.ts"}
  - {kind: "file", path: "app/e2e/playbooks.spec.ts"}
  - {kind: "file", path: "app/e2e/fixtures/playbooks.ts"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/playbooks/README.md"}
requires:
  - {from: "2", kind: "symbol", path: "app/src/components/PlaybookPolicy/PlaybookPolicy.tsx", name: "PolicyEditor"}
  - {from: "2", kind: "symbol", path: "app/src/components/PlaybookPolicy/PlaybookPolicy.tsx", name: "policyRows"}
  - {from: "2", kind: "symbol", path: "app/src/components/PlaybookPolicy/PlaybookPolicy.tsx", name: "modePolicyRow"}
  - {from: "2", kind: "symbol", path: "app/src/screens/chat/handoff.ts", name: "handOffComposerText"}
lanes:
  - "app/src/screens/playbooks/*"
  - "app/e2e/playbooks.spec.ts"
  - "app/e2e/fixtures/playbooks.ts"
  - "docs/evidence/phase-7-polish/playbooks/*"
  - "docs/DESIGN.md"
external_requires:
  - "Electron + Playwright via app/e2e/electron-harness.ts (launchApp) for the e2e and screenshots"
```

**Subtask 1 notes.** The runs route reads `playbook_runs` for one playbook, ordered by `id DESC`, with `id < before` when a cursor is given. The cursor is the last row's id as a decimal string (opaque to the app), and `next_before` is set only when one more row exists past the page (fetch `limit + 1`). Validate `limit` as `^[1-9]\d{0,2}$`, clamped to 200, and `before` as a positive integer. Map `session_id` → `session`, `started_at` → `started` and `ended_at` → `ended`. Do not expose `result_json` or `dedupe_key` (the contract does not carry them). The versions route reverses `listPlaybookVersions` (oldest-first) to newest-first and maps any snapshot that is not a plain object to `{}` (a test covers null, an array and a string). Tests seed rows in a temp store, as the existing `playbooks-*.test.ts` files do, and call handlers directly and through the merged API (token required, 401 without it).

**Subtask 2 notes.** `PlaybookPolicy.tsx` takes everything the editor needs as props: `onConfirm(value)`, `busy`, `held` and the row. It never reaches into Chat's state. **`mode` ownership:** #2 owns it. `PolicyEditor`'s row type accepts every kernel policy field, and `modePolicyRow(playbook)` builds the `mode` row, which renders a select offering `draft` with `live` present but `disabled` ("not available yet"). Only the Playbooks screen uses `modePolicyRow`. The Chat card keeps showing `mode` read-only, and `POLICY_FIELDS` and `READ_ONLY_POLICY_FIELDS` keep their exact values, so the console-contract pin holds. Constants the chat tests import from `./cards` (`TURN_ON_GAP`, `LAST_DRY_RUN_GAP`, `ALWAYS_INELIGIBLE`) stay in `cards.tsx`. `handoff.ts` is a plain per-agent map (no React, no storage, nothing persisted). `handOffComposerText(agent, text)` stores, `takeComposerHandoff(agent)` returns it and clears it, and the Playbooks screen calls the first, then sets `window.location.hash = "#/chat"`. The thread takes the text on mount and focuses the composer, and never sends. Add a `thread.test.tsx`-style test in `handoff.test.ts` that renders Wright's thread after a handoff and checks that the composer holds the text, has focus, and that no `/ask` is sent. Do not edit `thread.test.tsx`. The Thread call reads `takeComposerHandoff(` literally (the pin mutation deletes that line).

**Subtask 3 notes.** Data comes from the live store's `playbooks`, `triggers` and `approvals` resources (`useResource`) plus screen-local `GET /playbooks/:id/runs` (the newest page for the detail; `limit=1` per row for the list's "Last run") and `GET /playbooks/:id/versions`. These are refetched when the live snapshot's newest event id moves past an event the screen cares about. Do not add a resource to `app/src/store/resources.ts`. "Tokens" in the list is the last run's counted tokens, and the detail's tokens figure comes from the loaded runs' `tokens`. Neither is invented when absent ("not counted yet"). The e2e uses `app/e2e/fixtures/playbooks.ts` merged over `fixture-kernel.ts`'s defaults and drives every mockup state: empty, a held `GET /playbooks` for loading, a 500 for error, a closed fixture for unreachable, a pending enable approval for waiting, a `/set` answering 400 for edit-refused, and a feed `appendEvent` for AC11. It writes the 20 PNGs to `docs/evidence/phase-7-polish/playbooks/`, following `app/e2e/chat-integrations.spec.ts`'s `EVIDENCE_DIR` pattern, and the README maps each to its state.

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
Subtask 2 ──→ Subtask 3
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (`kernel/test/console-contract.test.ts` is #2's only; `gui-foundation.test.ts` is #1's only) | NO |
| Subtask 1 | Subtask 3 | none | NO |
| Subtask 2 | Subtask 3 | none (#3 imports #2's modules, edits none of them) | NO, but BLOCKED by `requires` |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel)
- **Batch 2:** Subtask 3 (after Subtask 2)
- **Recommended workers:** 2
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` |
| 3 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): the mockup's batched 8-field "Save as vN+1" doesn't match the kernel's one-field `/set` with no owner write for name/intent/effort | MEDIUM | Per-field Set; read-only name/intent/effort with Edit in English. Each deviation is named in the evidence README, and DESIGN.md open points 6/8 record it (AC14, AC15). No kernel write is added (requirement non-goal). |
| Feasibility (Phase 2.5): the work is large (`context-bound`) | MEDIUM | Split into 3 subtasks along kernel / shared component / screen lines with zero file overlap. |
| Prior churn (postmortem ledger): `Thread.tsx` (6), `chat.css` (6), `cards.tsx` (5) and `console-contract.test.ts` (5) were touched by PRs that needed extra rounds; recurring classes `self_heal_churn` (12) and `drain_churn` (3), no `self_heal_miss` | MEDIUM | Keep Subtask 2's chat edits mechanical: move code without behaviour change, keep `cards.test.tsx` unchanged and green, and limit the Thread edit to the initial text plus focus. Run the full `npm test` before hand-back. |
| Sibling phase 7 lanes (items 03, 05–08) edit the same empty-part pin in `kernel/test/gui-foundation.test.ts` | MEDIUM | Touch only the `playbook-history` row and the merged-keys line, and expect a trivial rebase conflict at drain time. |
| Overlap with Chat's playbook card (requirement risk): the two could disagree | MEDIUM | One shared `PlaybookPolicy` component (AC13). The policy-field pin moves with it (`console-contract.test.ts`). |
| Turn on could be built as a bypass | HIGH | No owner enable route exists. AC6 forbids any request that turns a playbook on, and the switch only surfaces the held `kernel_playbook_enable` approval (invariant 3). |
| Untrusted text (`name`, `intent`, `item_ref`, snapshot fields) rendered in the screen | MEDIUM | Render as React text only, never `dangerouslySetInnerHTML`. Snapshot fields are read by type, and a missing field reads "unknown", never a default (contract note on `PlaybookVersion.snapshot`). |
| Live refetch storms from screen-local reads on every feed event | LOW | Refetch only for the open playbook and only on `playbook_*`/`session_*`/`event_*` kinds, throttled like the store (`REFETCH_THROTTLE_MS`). |
| Disk at 94% (28 GiB free) | LOW | 2 workers max. 20 PNGs are small. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-30-the-playbooks-screen.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-30T15:14:32Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/182
- **Branch:** feature/the-playbooks-screen
- **Files changed:** 49
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unknown (no_driver_handover)
- **Summary:** 3/3 subtasks merged. Phase 3 checkpointed once because the execute manager has no TaskOutput tool here. It was resumed in-session with a fresh execute manager that ran its workers in the foreground. Phase 4 ran per finalize.md because the driver had parked. Phase 4.5: iteration 1 FAILed (BLOCKING hollow Run now guard pin, MEDIUM unset priority shown as default), fix cf95961 fixed both. Iteration 2 PASSed with 4 LOW findings dismissed below the MEDIUM floor (PR comment). risk_classification high_risk=true (size/token content); red team disabled. Until-mergeable drain not dispatched (.auto_review false; /automate owns the drain).

## Not verified
- **PNG contents (all 20) not visually opened by the retry worker; supervisor spot-checked populated-light and edit-refused-dark** (subtask 3)
- **full-pool ci-local.sh and other screens' e2e specs not run** (subtask 3)
- **Chat playbook card and Chat composer in the running Electron app (jsdom unit tests only)** (subtask 2)
