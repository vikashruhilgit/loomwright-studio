# Supervisor Job: Phase 7 exit check: one e2e over every GUI v2 screen and state against the fixture kernel, and the owner's live polish-gate runbook

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ⚠ Found (stale in one line: "The next step is phase 1 (the kernel)" although phases 1–6 are done; the patterns and invariants it states are current)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 2 (the stale CLAUDE.md line; two leftover worktrees under `.claude/worktrees/`, unrelated to this item)
- **Source requirement:** .supervisor/requirements/phase-7/2026-10-30-140010-phase-7-exit-check.md
- **Base commit:** c45b09e6b66779190a949aabc4b711e152beed23
- **Outcomes Rubric:** the source requirement has no `## Outcomes Rubric` section, so none is copied
- **Owner clarification (LP-CLARIFY, 2026-10-31):** live screenshots of the owner's real store are **committed only after the owner reviews each one**. The runbook stages them outside the repo; any screenshot showing private content stays local, and the evidence JSON records its file name and sha256 with `withheld: private` instead. The repo is public (`gh repo view` → `PUBLIC`).

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | `app/` only: Electron, React, Vite, `@playwright/test` (`_electron`), the fixture kernel (`app/e2e/fixture-kernel.ts`) |
| 2 | Dependency Availability | GO | No new dependency. All nine phase 7 dependencies are merged on `main` (PRs #180–#189; `git log --oneline -40`): Tasks, Playbooks, Schedules, Memory, Budget & audit, Settings, Integrations switch, each with its own `app/e2e/<screen>.spec.ts` and `app/e2e/fixtures/<screen>.ts` |
| 3 | Architecture Fit | GO | Phases 5 and 6 closed this way: a deterministic exit spec (`app/e2e/phase-5-exit.spec.ts`, `app/e2e/phase-6-exit.spec.ts`), a runbook (`docs/evidence/phase-{5,6}-exit-runbook.md`), an open OPEN_QUESTIONS entry, and the ROADMAP ✓ plus the live evidence JSON landing later, in one commit, after a passing live run (D33) |
| 4 | Scope vs Supervisor Capability | GO | About 1,000 new lines: one spec (~500), one composed fixture (~200), one runbook (~200), one OPEN_QUESTIONS entry. One worker |
| 5 | Hard Blockers | CAUTION | Nothing blocks this PR. Two verified gaps mean the **live** polish gate cannot fully match the mockup yet (Risk Assessment; findings, not fixed here): (a) the shell mounts no global keyboard map and no command palette: `installKeyboardMap` and `CommandPaletteHost` are used only in `app/src/components/CommandPalette/CommandPalette.tsx` and its `gallery.tsx`, never in `app/src/App.tsx` or `app/src/main.tsx` (`app/e2e/tasks.spec.ts` header: "the shell mounts neither `CommandPaletteHost` nor the keyboard map (App.tsx), so a launched window has no ⌘ keys"), so the sidebar's `⌘5`–`⌘9` / `⌘,` labels (`app/src/screens/*/index.tsx` `nav.shortcut`) do nothing in the running app; (b) the mockup's `keymap` view ("Keyboard map", opened from Settings with `?`, `docs/design/mockups/gui-v2.html:813`) has no screen in `app/src` (no match for `Keyboard map` / `keymap` outside component comments) |

**Overall Verdict:** CAUTION (proceed)

## Task
**Goal:** Add `app/e2e/phase-7-exit.spec.ts` (one keyboard tour of all seven phase 7 screens in one launch, every designed state of every screen in both themes, and a coverage check that every `gui-v2.html` view is covered or named as a known gap), its composed fixture, the owner's live runbook `docs/evidence/phase-7-exit-runbook.md`, and an open OPEN_QUESTIONS entry, without marking phase 7 done.

**Problem Statement:**
ROADMAP phase 7's criterion is "Each screen passes its polish gate" (`docs/ROADMAP.md:14`). Items 01–09 each built one screen with its own spec and polish screenshots on fixture data (`docs/evidence/phase-7-polish/<screen>/`). Nothing walks them together in one running app, by keyboard, and nothing checks them against the owner's real store.
Success looks like this: the exit spec passes in the `app` CI job (`.github/workflows/ci.yml:159`, `xvfb-run --auto-servernum npm run e2e`); the runbook lets the owner (or an agent while the owner watches, D33/D35) build, install, package, open from Finder and compare each screen with `gui-v2.html`, recording match or mismatch with screenshots. Every mismatch becomes a new phase 7 item; nothing is patched here.

**Precedent:** phase 6's exit PR (`.supervisor/jobs/done/2026-10-29-phase-6-exit-check.md`, PR #160) and phase 5's (`app/e2e/phase-5-exit.spec.ts`). `docs/ROADMAP.md`'s ✓ and `docs/evidence/phase-7-exit-live-<date>.json` are NOT in this PR: they land with the OPEN_QUESTIONS update in one commit after a passing live run (requirement AC 3; D33). The phase has no live harness (`STUDIO_LIVE`): the requirement asks for a runbook only, and the polish gate is a visual comparison.

## Acceptance Criteria
- [ ] AC1 (requirement AC 1; the tour): Given `app/e2e/phase-7-exit.spec.ts` with ONE fixture kernel serving every phase 7 screen populated, composed in a new `app/e2e/fixtures/phase-7-exit.ts` from the screens' own fixtures (`tasksRoutes(tasksKernel(…))`, `playbooksFixture`, `schedulesFixture`, `memoryFixture`, `budgetFixture`, `settingsFixture`, `integrationsFixture`), launched only through `launchApp` (`app/e2e/electron-harness.ts`), when `cd app && npm run build && npm run e2e` runs, then ONE test:
  1. reaches each of the seven screens (Integrations, Tasks, Playbooks, Schedules & triggers, Memory, Budget & audit, Settings) **from the sidebar by keyboard only** — Tab/Shift+Tab to its `nav` button (`aria-label="Screens"`, `app/src/App.tsx`) and Enter — never by `click()` and never by setting `location.hash`; after each Enter the button has `aria-current="page"`, the title bar's `h1` is the screen's `title`, and the screen shows its populated state by the same designed marker its own spec asserts;
  2. on each screen runs the in-screen key path that screen's spec already pins (for example Tasks J/K/Enter/Esc from `tasks.spec.ts` AC8; Playbooks J/K/Enter from `playbooks.spec.ts` AC10; Schedules J/K from `schedules.spec.ts` AC6; Memory J/K/Enter/Esc from `memory.spec.ts` AC10; Budget's audit log keys from `budget.spec.ts` AC6; Tab through Settings' and Integrations' controls), asserting where focus lands;
  3. repeats step 1's populated check in `light` and `dark` (`document.documentElement.dataset.theme`, as `tasks.spec.ts`'s `setTheme`; the `.main` background differs between the two);
  4. asks the kernel for nothing the composed fixture does not serve. `app/e2e/fixtures/phase-7-exit.ts` exports its FULL route table as one object (`PHASE_7_EXIT_ROUTES` or similar), re-declaring every default it relies on rather than leaning on `fixture-kernel.ts`'s non-exported `DEFAULT_ROUTES` (`GET /status`, `/connectors`, `/connectors/github/repos`, `/drafts`, `/settings`, the phase 7 read routes) and including what the launch's first screen reads: the app opens on Chat (`DEFAULT_SCREEN = "chat"`, `app/src/App.tsx`), whose thread and crew section read `GET /threads/:agent`, `/agents`, `/approvals`, `/messages`, `/playbooks`, `/triggers` and `/notifications` (`app/src/screens/chat/Thread.tsx`, `CrewSection.tsx`). The spec passes exactly that table to `startFixtureKernel` and asserts every `fixture.requests` entry (`{method, path}`; the fixture records no status) matches one of the table's keys under `:param` matching, with `GET /events/stream` (the feed upgrade) the only exemption.

  Where two screen fixtures serve the same route key (`GET /status`, `/agents`, `/approvals`, `/messages`, `/notifications`, `/playbooks`, `/triggers` are each served by several of `app/e2e/fixtures/{tasks,playbooks,schedules,memory,budget,settings,integrations}.ts`; `tasksRoutes` spreads `sessionsRoutes(kernel.sessions)`, which serves `/status`, `/agents` and the session routes), `phase-7-exit.ts` picks ONE source per key explicitly, with a one-line comment per key naming which and why, and every body stays `satisfies` its contract type so `npm run typecheck` checks it.
- [ ] AC2 (requirement AC 1; every state): Given the same spec, then ONE table-driven test (or one `test` per screen) shows each screen's designed shared states, each reached with that screen's own fixture and the mechanism its own spec uses (a never-settling route for loading, a 500 route for error, `GET /status` → 503 for unreachable, the fixture's `empty` / `waiting` state), in both themes, asserting the same designed marker that screen's spec asserts for that state:

  | Screen | States |
  |---|---|
  | Tasks | empty, loading, populated, waiting, error, unreachable |
  | Playbooks | empty, loading, populated, waiting, error, unreachable |
  | Schedules & triggers | empty, loading, populated, error, unreachable |
  | Memory | empty, loading, populated, error, unreachable |
  | Budget & audit | empty, loading, populated, waiting, error, unreachable |
  | Settings | empty, loading, populated, waiting, error, unreachable |
  | Integrations | token, token-to-app, token-to-app-install, token-to-app-failed, app-connected, unreachable |

  Screenshots, if taken, go only to `testInfo.outputPath(…)`: the spec writes nothing under `docs/evidence/` (no `*_EVIDENCE` switch). It asserts behaviour, never pixels.
- [ ] AC3 (requirement AC 1; nothing in the mockup is uncovered): Given the same spec, then a static test reads the view ids from `docs/evidence/gui-v2-mockup/README.md`'s view tables only (the `## Screenshots` section, before the token tables, whose first columns also hold backticked values such as `1px`), asserting it read exactly 51 ids (`tasks-empty` … `keymap`), and asserts each is exactly one of: a state AC2 walks; a click-through view mapped to the test in its screen's own spec that covers it, by a title prefix that spec file contains (checked by reading the file and finding `test("<prefix>`):

  | View | Spec | Test title prefix |
  |---|---|---|
  | `tasks-history` | `app/e2e/tasks.spec.ts` | `AC6: a card opens with its facts, its history` |
  | `playbooks-detail` | `app/e2e/playbooks.spec.ts` | `AC4/AC12: the detail shows the policy` |
  | `playbooks-edit` | `app/e2e/playbooks.spec.ts` | `AC5: a field edit is one /set` |
  | `playbooks-edit-refused` | `app/e2e/playbooks.spec.ts` | `AC5: a refusal shows under its field` |
  | `playbooks-history` | `app/e2e/playbooks.spec.ts` | `AC5: a field edit is one /set` (it opens `playbook-history`) |
  | `memory-file` | `app/e2e/memory.spec.ts` | `AC6: opening a file shows its full path` |
  | `memory-edit` | `app/e2e/memory.spec.ts` | `AC7: Edit shows a textarea` |
  | `memory-conflict` | `app/e2e/memory.spec.ts` | `AC8: an agent's write after the file was opened makes a save a conflict` |
  | `budget-audit` | `app/e2e/budget.spec.ts` | `AC4: the audit log pages Older and Newer` |
  | `budget-audit-filtered` | `app/e2e/budget.spec.ts` | `AC4: choosing Agent and Playbook` |

  or a `KNOWN_GAPS` entry. `KNOWN_GAPS` equals exactly `["keymap"]`, with a comment naming the finding (no Keyboard map screen and no global keyboard map in the shell; the OPEN_QUESTIONS entry of AC5), and the test also asserts every `KNOWN_GAPS` id (and every mapped view) is a view id in the README, so a stale gap or mapping goes red. A new mockup view with no mapping turns this test red.
- [ ] AC4 (requirement AC 2; the runbook): Given `docs/evidence/phase-7-exit-runbook.md`, when the owner reads it, it lists:
  - **what the run does to the machine**: it reads the owner's real store through the packaged app; whether it writes anything (only what a step names, for example Tasks data the owner creates), and that the screenshots show the owner's real data;
  - **setup**, typed in a terminal: build the kernel and reinstall the service (`cd kernel && npm ci && npm run build`, `node kernel/dist/cli/index.js service install`, as `docs/evidence/phase-5-exit-runbook.md` setup step 2), package the app (`cd app && npm ci && npm run package`), and open `app/release/mac-arm64/Loomwright Studio.app` **from Finder**; record the commit;
  - **populating thin screens** (requirement Assumption): where the real store has no rows for a screen (Tasks today), how to create them from the app or `studio` on the owner's own data, never against `vendsy/*` or any employer repo;
  - **the walk**: for each of the seven screens and each state reachable on the real store (populated, plus empty / waiting where the store shows them, and unreachable by stopping the service with `launchctl` and restarting it), compare with the matching `gui-v2.html` view (`#view=<view>&theme=<light|dark>`) in light and dark, by keyboard where the mockup shows a key, and record `match` or `mismatch` with a one-line reason and a screenshot;
  - **the known mismatches to expect** (AC3's `KNOWN_GAPS` and the Feasibility CAUTION): the sidebar's ⌘ shortcuts and ⌘K do nothing, and there is no Keyboard map view;
  - **who clicks** per D33/D35: the owner, or an agent while the owner watches, clicking only what the owner named in chat before the run; `run_by` and each such click recorded as "the agent, on the owner's word";
  - **screenshots (the owner's 2026-10-31 decision)**: taken to a folder outside the repo (for example `${TMPDIR}/studio-phase7-exit-<date>/`); the owner reviews each before the evidence commit; those approved are committed under `docs/evidence/phase-7-exit-live-<date>/`; one showing private content stays local and the evidence JSON records its file name and sha256 with `withheld: private`;
  - **the evidence file's shape**: `docs/evidence/phase-7-exit-live-<date>.json` with, per screen and state, the mockup view id, `match` / `mismatch`, the reason, the screenshot (path, or name + sha256 + `withheld`), `run_by`, the commit, and empty `owner` fields for what only the owner reports;
  - **findings**: every mismatch becomes a new phase 7 requirement item under `.supervisor/requirements/phase-7/`; nothing is patched during the run;
  - **close**: only after a run with no open mismatch, the evidence JSON, the approved screenshots, the ROADMAP phase 7 row marked done with the evidence path, and the OPEN_QUESTIONS entry ticked, in ONE commit; never before.

  It links no file that does not exist yet (the future evidence JSON and folder are named in code font, not linked), and `bash scripts/check-docs.sh` passes.
- [ ] AC5 (requirement AC 3, the PR half): Given the PR, then:
  - `docs/OPEN_QUESTIONS.md` gains an open `- [ ] **Phase 7 exit: live run (item 10, owner).**` entry placed after the existing phase 7 entries (after line 136's notifications entry, before `## Deferred decisions`). It names the exit spec and the runbook; what stays unverified (the live run itself on the owner's real store and packaged app; each screen against its mockup outside fixture data); and the two findings for new items, recorded and not fixed: the shell mounts no global keyboard map or command palette (⌘ shortcuts and ⌘K dead in the running app), and the mockup's Keyboard map view is not built;
  - `docs/ROADMAP.md` is unchanged and no `docs/evidence/phase-7-exit-live-*` path is added (`git diff --name-only origin/main...HEAD` lists neither);
  - no file under `app/src/`, `app/electron/` or `kernel/` changes. A gap the spec finds is a finding (worker hand-back and the OPEN_QUESTIONS entry), never a production fix in this PR. If a screen lacks a stable marker for a state, the spec uses what that screen's own spec asserts (a heading, a test id, a band) rather than adding one.
- [ ] AC6: `bash scripts/check-docs.sh` passes, and `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e` passes (`app/scripts/hidden-windows.test.ts`, which scans every file under `app/e2e/`, included).

## Phase 3: ANALYZE (summary)

**Tech Stack:** TypeScript (strict), Node ≥ 22. App: Electron 44, React 19, Vite, vitest, `@playwright/test` 1.64 (`_electron`), `ws` for the fixture kernel's feed.

### File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| exit spec | (none) | `app/e2e/phase-7-exit.spec.ts`, `app/e2e/fixtures/phase-7-exit.ts` | HIGH (the spec), MEDIUM (how cleanly the seven fixtures compose: shared route keys need one chosen source each) |
| runbook and docs | `docs/OPEN_QUESTIONS.md` | `docs/evidence/phase-7-exit-runbook.md` | HIGH |

### Module layout
- `docs/OPEN_QUESTIONS.md`: 144 lines at base, below the threshold. The entry is appended there because every phase's live-run entry lives in that list.
- The spec and its fixture are new modules. Per-screen data is imported from the existing `app/e2e/fixtures/{tasks,playbooks,schedules,memory,budget,settings,integrations}.ts` (258, 422, 295, 242, 297, 137, 334 lines), never copied. The composition (one route table from seven) is its own new `app/e2e/fixtures/phase-7-exit.ts`, matching `app/e2e/fixtures/phase-6-exit.ts`. `setTheme` / `ground` are each copied in `tasks.spec.ts` and `settings.spec.ts`; the spec may copy them a third time (each spec keeps its own helpers today) or the worker may note an extract as a follow-up; no shared helper module is created in this PR.

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` checks every relative link in `docs/**/*.md`; the runbook and the OPEN_QUESTIONS entry are its new surfaces. `app/scripts/hidden-windows.test.ts` scans every file under `app/e2e/`, which includes the new spec and fixture.

### Facts the worker relies on (verified at base `c45b09e`)
- Screens are discovered from `app/src/screens/<id>/index.tsx`; the sidebar renders one `nav-item` button per screen with a `nav`, in `nav.order` (`app/src/App.tsx`), with `aria-current="page"` on the current one and the title in `header h1.titlebar-title`. Nav orders: integrations 5 (`⌘5`), tasks 6 (`⌘6`), playbooks 7 (`⌘7`), schedules 8 (`⌘8`), memory 9 (`⌘9`), budget 10 (no shortcut), settings 11 (`⌘,`).
- `installKeyboardMap` / `CommandPaletteHost` are mounted only by `app/src/components/CommandPalette/CommandPalette.tsx` and its gallery, not by the shell: ⌘ keys do nothing in a launched window.
- The fixture kernel (`app/e2e/fixture-kernel.ts`) merges `options.routes` over `DEFAULT_ROUTES` (status, phase 6's empty connectors/repos/drafts, phase 7's eleven read routes); a route function may return a never-settling promise (loading); unmatched routes answer 404 `not_found`; `requests` records every authenticated request.
- Unreachable is forced in the screen specs by `"GET /status": () => ({ status: 503, … })` (`tasks.spec.ts` AC11) or `unreachableDataDir()`.
- Themes are forced by `document.documentElement.dataset.theme` (`tasks.spec.ts` `setTheme`); `settings.spec.ts` also uses `page.emulateMedia`.
- The `app` CI job runs every spec with `--workers=1` under xvfb (`.github/workflows/ci.yml:159`, `app/package.json` `"e2e": "playwright test e2e --workers=1"`).
- `docs/evidence/gui-v2-mockup/README.md` lists 51 view ids, the last being `keymap` ("Every shortcut … every palette command by screen"); `docs/DESIGN.md:191` records the keymap as a proposal.

### Blast-Radius / Impact Prediction
Omitted: no touched subsystem has a verified System Twin contract. This PR adds one e2e spec, one fixture and docs only.

## House Rules

> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

## Pin mutations

Each mutation is applied to production code (never the test), must turn the named pin red, and is reverted after the check.

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| AC1 step 1: Enter on a sidebar button opens that screen with `aria-current="page"` | in `app/src/App.tsx`, change `aria-current={s.id === current.id ? "page" : undefined}` → `aria-current={undefined}` |
| AC1 step 1: the sidebar is reached and walked by keyboard | in `app/src/App.tsx`, add `tabIndex={-1}` to the `nav-item` `<button>` (the buttons leave the Tab order, so the tour can no longer reach a screen without a click) |
| AC1 step 1: each screen is listed in the sidebar | in `app/src/screens/budget/index.tsx`, delete the `nav: { label: "Budget & audit", order: 10 },` line (Budget leaves the sidebar) |
| AC1 step 3: the populated check runs in both themes (the `.main` background differs) | in `app/src/styles/app.css`, change `.main`'s `background: var(--ground);` → `background: #808080;` (one colour in both themes; the step 3 "backgrounds differ" assertion must go red) |
| AC1 step 4: every request the app makes is one the composed table serves | not machine-applicable as a one-line production change: the app's paths are pinned by the contract allow-list (`app/src/api/contract.ts`), so a renamed path never reaches the fixture. The reviewer applies it (D1 fallback) by deleting `GET /threads/:agent` from the exported table and confirming the check fails naming `/threads/wright` (or the agent the launch reads), then restoring it |
| AC2: the unreachable band shows over a screen | in `app/src/App.tsx`, change `{connection.state === "unreachable" ? <UnreachableBand /> : null}` → `{null}` |
| AC3: an uncovered mockup view turns the coverage test red | add a row `` | `tasks-new-view` | x | x | x | `` to `docs/evidence/gui-v2-mockup/README.md`'s Tasks table (a docs mutation; the test must fail naming `tasks-new-view`) |
| AC3: every `KNOWN_GAPS` id is a real mockup view (a stale gap goes red) | delete the `` | `keymap` | … `` row from `docs/evidence/gui-v2-mockup/README.md` (a docs mutation; the coverage test must fail naming the stale gap `keymap`) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Phase 7 exit: e2e over every screen and state, runbook, open-questions entry | AC1, AC2, AC3, AC4, AC5, AC6 | 1 modify, 3 create | `skills/playwright-e2e/SKILL.md`, `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1 — exit spec + composed fixture + runbook + OPEN_QUESTIONS (LAUNCHABLE)
provides:
  - {kind: "file", path: "app/e2e/phase-7-exit.spec.ts"}
  - {kind: "file", path: "app/e2e/fixtures/phase-7-exit.ts"}
  - {kind: "file", path: "docs/evidence/phase-7-exit-runbook.md"}
  - {kind: "symbol", path: "docs/OPEN_QUESTIONS.md", name: "Phase 7 exit: live run (item 10, owner)."}
requires: []
lanes:
  - "app/e2e/phase-7-exit.spec.ts"
  - "app/e2e/fixtures/phase-7-exit.ts"
  - "docs/evidence/phase-7-exit-runbook.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires:
  - "the owner's installed launchd service, the packaged app opened from Finder, and the owner's real store (live run only; never in CI)"
```

## Parallelism Analysis

### Dependency Graph
```
single-agent (no fan-out)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | (none) | n/a | NO |

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/playwright-e2e/SKILL.md`, `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5) CAUTION: the shell mounts no global keyboard map or palette, so the sidebar's ⌘ labels and ⌘K do nothing in the running app | HIGH (for the live polish gate) | Not fixed here (`app/src` is out of scope, AC5). The tour uses Tab/Enter on the sidebar and in-screen keys only (AC1); the runbook lists it as an expected mismatch (AC4); the OPEN_QUESTIONS entry records it as a finding for a new item (AC5). Phase 7 cannot be marked done until that item lands |
| Feasibility (Phase 2.5) CAUTION: the mockup's Keyboard map view (`keymap`) is not built | HIGH (for the live polish gate) | `KNOWN_GAPS = ["keymap"]` in AC3, the runbook and the OPEN_QUESTIONS entry; a finding for a new item |
| Live screenshots expose the owner's real data in a public repo | HIGH | The owner's 2026-10-31 decision: stage outside the repo, owner reviews each before commit, private ones withheld with name + sha256 (AC4) |
| The seven fixtures disagree on a shared route (`GET /playbooks`, `/triggers`, `/status`, `/agents`…), so the composed kernel shows a screen differently from its own spec | MEDIUM | One explicit source per shared key in `phase-7-exit.ts` with its reason (AC1); the tour asserts each screen's populated marker, so a wrong choice turns it red rather than passing silently |
| A screen passes on fixture data only (requirement Risk) | MEDIUM | The live half exists for this (AC4); the spec claims fixture coverage only |
| The exit spec adds many Electron launches to an already long serial `app` job | MEDIUM | AC1 is one launch; AC2 reuses one launch per screen per state where the state needs its own fixture, and takes no tracked screenshots; set `test.setTimeout` per test as `tasks.spec.ts` AC11 does |
| The spec duplicates each screen's state assertions and drifts from them | LOW | AC2 asserts the same marker each screen's spec uses; AC3 checks the click-through mappings by reading those specs' test titles |
| ROADMAP marked done before a passing live run | MEDIUM | This PR must not edit `docs/ROADMAP.md` or add `docs/evidence/phase-7-exit-live-*` (AC5) |
| An employer repo is used to populate Tasks | HIGH | The runbook forbids `vendsy/*` and any employer repo by name (AC4) |
| Home paths in the runbook trip the trail scrub | LOW | Write home paths as `~/…` |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-31-phase-7-exit-check.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-31T19:30:07Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/190
- **Branch:** feature/phase-7-exit-check
- **Files changed:** 4
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Added app/e2e/phase-7-exit.spec.ts (keyboard tour of the 7 phase 7 screens, every designed state in both themes, 51-view mockup coverage with KNOWN_GAPS=["keymap"]) and its composed fixture app/e2e/fixtures/phase-7-exit.ts, the owner's live runbook docs/evidence/phase-7-exit-runbook.md, and the open OPEN_QUESTIONS live-run entry with two findings (no global keyboard map/palette in the shell; Keyboard map view not built). Phase 4.5 review PASS first iteration; all 8 pin mutations held under the reviewer's D1 fallback; CI ci/app/claude-review green. ROADMAP unchanged.

## Not verified
- **Each screen against its mockup on the owner's real store and packaged app** — needs the owner's launchd service, Finder and real data; this is the runbook's live run (subtask 1)
- **Loading and error views on a real store** — a real store cannot show them on demand; only the fixture spec covers them (subtask 1)
