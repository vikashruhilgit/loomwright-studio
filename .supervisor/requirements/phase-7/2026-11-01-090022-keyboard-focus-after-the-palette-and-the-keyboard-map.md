# 22 — Keyboard: focus after the palette, and the Keyboard map's scroll and sidebar mark

## Status: ready

**Priority:** MVP (polish) · ROADMAP phase 7 · D9

**As** the owner,
**I want** focus to land where I went after the palette, and the Keyboard map to open at its top with its opener marked in the sidebar,
**so that** keyboard use matches the mockup's focus rules.

## Problem

Live re-run 2026-11-01, global keys pressed in the foreground (item 13's ⌘K palette, ⌘, and `?` all work):

- **Focus after the palette.** After ⌘K runs a screen command (Memory), the focus ring stays on the previous screen's sidebar item (Tasks) while Memory is active.
- **The Keyboard map opens mid-page.** Opened with `?` from a scrolled Settings, it opened at Settings' scroll offset instead of its top.
- **No sidebar mark while the map is open.** The mockup (`keymap`) keeps the screen the map was opened from highlighted in the sidebar; live highlights nothing. Back does return to the opener.

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

## Owner decisions (2026-11-01 re-run, binding)

Recorded 2026-11-01 in the phase 7 re-run findings product-owner session (AskUserQuestion, one round). The owner chose the proposed option every time. Each item from this round carries this copy.

- **Source.** These items come from the phase 7 exit live re-run on 2026-11-01 (item 19's runbook, packaged app opened from Finder at `59275c8`, the owner's real store, light and dark, the kernel booted out for the unreachable state, the global keys checked in the foreground, run by the agent with the owner's word and the owner watching per D33/D35). It failed the polish gate. The screenshots stay outside the repo (the owner's 2026-10-31 screenshot decision); none is committed by these items.
- **Tasks history keeps the session viewer.** The session log in a task's history keeps the phase 6 viewer's header (Read latest, Stop, Kill); it is accepted as built, not a mismatch, and no item changes it.
- **Settings Health is marked last known.** While the kernel is unreachable, Settings shows Health's last value with a "last known" mark and no green dot. `gui-v2.html`'s `settings-unreachable` view changes first (D9).
- **Kernel log reveals the service's own log.** The band's "Kernel log" action reveals the kernel service's log file (`<dataDir>/logs/kernel.err.log`, where `studio service install` points launchd's stderr) in Finder, through a main-process channel that takes no path from the renderer, as Reveal data dir does. It works with the kernel down, which is when the band shows.
- **One Back control.** Every click-through view uses one shared crumb from the shell, drawn as the mockup draws it: "‹ Parent / Current" (for example "‹ Tasks / Task #9"), without the word "Back". Each screen adopts it in its own item.
- **Nothing is patched outside an item's Touches.** A lane that needs another file stops and says so.

## Scope

1. **Focus after the palette.** After the palette runs a command that opens a screen, focus lands in the opened screen (its first focusable control or its main region), and no sidebar item keeps a stale focus ring.
2. **The Keyboard map's scroll.** It opens scrolled to its top whatever the opener's scroll.
3. **Sidebar mark.** While the Keyboard map is open, the sidebar marks the screen it was opened from, as `keymap` draws it; Back still returns there.
4. **Polish gate.** The PR commits screenshots from the running app (fixture kernel, through `app/e2e/electron-harness.ts`), light and dark, of every mockup state the item changes, each named against its `gui-v2.html` view. The owner's approval of the PR is the gate (D9).

## Non-goals

- New shortcuts or palette commands.

## Acceptance criteria

- [ ] Given the palette runs a screen command, then focus is inside the opened screen and no sidebar item shows a focus ring (`app/e2e/keyboard.spec.ts`).
- [ ] Given a scrolled Settings, when `?` opens the Keyboard map, then the map is at its top.
- [ ] Given the Keyboard map opened from Settings, then the sidebar marks Settings, matching `keymap`, light and dark; Back returns to Settings.
- [ ] The polish-gate screenshots are in the PR body, each named against its mockup view.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`

## Assumptions

- The palette's "focus returns to the control that opened it" rule (Keyboard map text) covers Esc only; a command that opens a screen moves focus into it.

## Risks

- Moving focus on a screen change must not steal focus from a text field the owner is typing in.

## Depends on
none

## Touches
app/src/shell/KeyboardHost.tsx
app/src/shell/KeyboardHost.test.tsx
app/src/shell/Sidebar.tsx
app/src/components/CommandPalette
app/src/screens/keymap
app/e2e/keyboard.spec.ts
