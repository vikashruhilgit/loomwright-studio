# 13 — Keyboard: mount the screen shortcuts, the ⌘K palette and the Keyboard map view

## Status: ready

**Priority:** MVP · ROADMAP phase 7 · D9 · item 10's two known gaps

**As** the owner,
**I want** ⌘1–⌘9, ⌘, and ⌘K to work in the app as the sidebar labels and the mockup promise, and a Keyboard map I can open with `?`,
**so that** the app is keyboard-first, as UI.md says, and the two known phase 7 gaps close.

## Problem

Item 10 recorded two known mismatches before the live run (`KNOWN_GAPS = ["keymap"]` in `app/e2e/phase-7-exit.spec.ts:943`; the OPEN_QUESTIONS entry "Phase 7 exit: live run (item 10, owner)"), and the 2026-11-01 run confirmed both:

1. **The ⌘ shortcuts and ⌘K do nothing.** The sidebar labels Chat `⌘1` … Memory `⌘9` and Settings `⌘,`; the mockup has a ⌘K palette. `app/src/App.tsx` builds palette commands (line 43, "Each screen's sidebar entry is also a palette command") and `app/src/components/CommandPalette/` exists, but the shell mounts no global key map and no palette.
2. **There is no Keyboard map view.** The mockup's `keymap` view (opened with `?`) has no screen.

Also: J / K did not visibly move between Playbooks rows in the live run, but the keys were delivered to a background window, which is not reliable. It is unverified, and this item's e2e settles it in the foreground.

## Owner decisions (2026-10-30, binding)

Recorded 2026-10-30 in the phase 7 product-owner session, over two rounds of AskUserQuestion. The owner chose the proposed option every time. Each item carries this copy. D3, D4, D9, D12, D22, D24, D26, D27, D28, D29, D34, D36 and invariants 1–9 stay as they are. Phase 5 and phase 6 decisions (in their items) still hold.

- **Hooks is deferred to phase 9.** The Hooks screen is built with the hook-management mechanism it shows (propose, apply with backup, verified to fire, rollback; ROADMAP phase 9). `hooks_installed` does not exist yet (`kernel/src/store/migrations/001_initial.ts:9`), so phase 7 builds no Hooks screen. UI.md and DESIGN.md get a note recording this, as phase 6 did for Integrations.
- **Tasks shows today's kernel data.** The board groups tasks, playbook runs and sessions by state and clicks through to their history and session logs. Linked PRs and tickets, approvals counts and CI state join in phase 8 (acceptance test 2), which the UI.md card example describes.
- **Integrations is polish only.** No new connector: Slack, Calendar and Mail stay in phase 9. Known gap from the 2026-10-30 live run: a token connection has no path to the GitHub App without Disconnect (`TokenDetail` offers only Replace and Disconnect).
- **One GUI v2 mockup first (D9).** One clickable file, `docs/design/mockups/gui-v2.html`, holds every phase 7 screen and every state (empty, loading, error, waiting on you, kernel unreachable), light and dark, with its token block the verbatim output of `node app/scripts/tokens.mjs`. The owner approves it by merging its PR. Every screen item depends on it, and its polish gate matches it. This mirrors phase 0.
- **Each screen's kernel routes ride with that screen's item.** Tasks, Memory, Budget & audit, playbook run history and trigger firing history have no read route today (the API serves `/playbooks`, `/triggers`, `/events`, `/status` and the phase 5–6 routes). Each screen item adds the routes it reads, in its own feature part, against the contract item 01 declares. Memory's write route is guarded (below).
- **Settings shows the auth provider read-only.** Settings shows the active provider, its health and its token's state, plus the terminal commands that change it (`claude setup-token`, `studio auth …`), as phase 5 does. No secret entry in Settings, and never a claude.ai sign-in (invariant 6).

## Owner decisions (2026-11-01, binding)

Recorded 2026-11-01 in the phase 7 findings product-owner session (AskUserQuestion, one round). The owner chose the proposed option every time. Each finding item carries this copy.

- **Source.** These items come from the phase 7 exit live run on 2026-11-01 (item 10's runbook, packaged app opened from Finder at `d754f83`, the owner's real store, light and dark, the kernel stopped for the unreachable state, run by the agent with the owner's word per D33/D35). It failed the polish gate. The screenshots stay outside the repo (the owner's 2026-10-31 screenshot decision); none is committed by these items.
- **Task states stay free text (D3).** `kernel_task_create`'s description names the four words the board sorts (`waiting`, `working`, `parked`, `done`) for Wright to use. The board shows any other state in its own visible "Other" group with the raw word, never silently in Working. No closed list in the kernel, no guessed synonyms.
- **"On" vs "on" is explained in Schedules.** A trigger whose playbook is off says so on its row and in the upcoming list (its fires are skipped, `playbook_not_enabled`). No separate item.
- **The login-item note is out of scope.** "macOS can't find this app's login item" is the designed honest note for a build run from `app/release/`; the re-run checks Settings from an installed copy.
- **Nothing is patched outside an item's Touches.** A lane that needs another file stops and says so.

## Scope

1. **Global key map** in the shell: ⌘1–⌘9 and ⌘, open their screens; ⌘K (and `/` where the mockup says so) opens the palette; Esc closes it. Keys pressed in a text field type, never navigate.
2. **Mount the existing `CommandPalette`** with the shell's screen commands and each screen's own commands.
3. **Keyboard map view** (`app/src/screens/keymap/`), built to the mockup's `keymap` view, opened with `?` and from the palette.
4. **Close the gap in item 10's spec:** `KNOWN_GAPS` becomes empty; the OPEN_QUESTIONS entry records both as fixed by this item.
5. **J / K check:** the e2e presses J / K / Enter / Esc on Tasks, Playbooks and Memory with the window focused and asserts the selection moves.
6. **Polish gate.** The PR commits screenshots from the running app (fixture kernel, through `app/e2e/electron-harness.ts`), light and dark, of every mockup state the item changes, each named against its `gui-v2.html` view. The owner's approval of the PR is the gate (D9).

## Non-goals

- New commands beyond those screens already declare.
- Rebinding keys.

## Acceptance criteria

- [ ] Given any screen, when I press ⌘1–⌘9 or ⌘,, then the labelled screen opens.
- [ ] Given any screen, when I press ⌘K, then the palette opens, lists the screens and the current screen's commands, filters as I type, runs one on Enter and closes on Esc.
- [ ] Given focus in a text field (Chat, Memory edit), when I press J, K or `?`, then the character is typed and nothing navigates.
- [ ] Given `?` outside a text field, then the Keyboard map opens and matches the `keymap` view in light and dark.
- [ ] Given Tasks, Playbooks and Memory with the window focused, when I press J / K, then the selection moves; Enter opens; Esc returns with focus on the item.
- [ ] Given `app/e2e/phase-7-exit.spec.ts`, then `KNOWN_GAPS` is empty and the mockup coverage check passes.
- [ ] The polish-gate screenshots are in the PR body, each named against its mockup view.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`

## Assumptions

- The palette component and its fuzzy filter are complete (it has its own gallery and spec, `app/e2e/components.palette.spec.ts`).

## Risks

- Electron's menu accelerators and the page's key handler can both fire on ⌘ keys; one owner of each key, pinned by a test.

## Depends on
2026-11-01-090012-shell-polish-sidebar-titlebar-subtitle-and-crew-rows.md

## Touches
app/src/App.tsx
app/src/shell
app/src/screens/keymap
app/e2e/keyboard.spec.ts
app/e2e/phase-7-exit.spec.ts
docs/OPEN_QUESTIONS.md
