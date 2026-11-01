# 12 — Shell polish: sidebar icons and groups, titlebar subtitle, status row and crew rows

## Status: ready

**Priority:** MVP · ROADMAP phase 7 · D9

**As** the owner,
**I want** the window's frame (sidebar, title bar, crew list) to look like the approved mockup on every screen,
**so that** the phase 7 screens read as one app and pass their polish gate.

## Problem

Live run 2026-11-01, compared with every `gui-v2.html` view (light and dark). The frame differs on all seven screens:

- **Sidebar:** no icons beside the entries; no divider between the first group (Chat … Integrations) and the second (Tasks … Settings); the entry reads "Schedules" where the mockup reads "Schedules & triggers"; the bottom status row ("idle" dot and `⌘K`) is missing.
- **Crew rows:** the app shows the agent id, "off", a time and a truncated last line on up to three lines; the mockup shows avatar, name and one last line.
- **Title bar:** the mockup puts each screen's count line beside the title ("Tasks  8 cards · 3 working"); the app's title bar (`app/src/App.tsx:96-97`) renders the title only, and each screen draws its count line in a band under it.
- **Tasks:** "Showing the newest 200 cards; older ones are not shown." shows even with 4 cards; the mockup shows no such line until the cap is reached.

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

1. **Sidebar** in `app/src/App.tsx` and its styles: an icon per entry (the mockup's glyphs, from the existing `Glyph` component), the group divider, "Schedules & triggers", and the bottom status row (the kernel's state word and the `⌘K` hint; the palette itself is item 13).
2. **Crew rows** as the mockup draws them.
3. **Titlebar subtitle slot.** The title bar renders a screen's count line beside the title; each phase 7 screen hands its line to the slot instead of drawing its own band. Screens touched for this only.
4. **Tasks' cap line** shows only when the board actually hides cards.
5. **Polish gate.** The PR commits screenshots from the running app (fixture kernel, through `app/e2e/electron-harness.ts`), light and dark, of every mockup state the item changes, each named against its `gui-v2.html` view. The owner's approval of the PR is the gate (D9).

## Non-goals

- The ⌘ shortcuts and the palette (item 13).
- Any screen body change beyond moving its count line.

## Acceptance criteria

- [ ] Given any phase 7 screen, then the sidebar shows an icon per entry, the divider between the two groups, "Schedules & triggers", and the bottom status row, as the mockup shows, in light and dark.
- [ ] Given crew members, then each row shows avatar, name and one last line, as the mockup shows.
- [ ] Given each phase 7 screen, then its count line sits beside the title in the title bar, matching its `<screen>-populated` view.
- [ ] Given fewer cards than the board's cap, then Tasks shows no cap line; given more, it shows it.
- [ ] Given VoiceOver, then every sidebar entry and the status row have labels; both themes meet WCAG 2.1 AA contrast.
- [ ] The polish-gate screenshots are in the PR body, each named against its mockup view.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`

## Assumptions

- The mockup's sidebar glyphs exist in `app/src/components/Glyph.tsx` or are added there.

## Risks

- Every screen hands over its count line; a screen that forgets keeps its old band. The e2e asserts the title bar text per screen.

## Depends on
2026-11-01-090011-kernel-unreachable-band-over-last-known-data-on-every-screen.md

## Touches
app/src/App.tsx
app/src/styles/app.css
app/src/components/Glyph.tsx
app/src/screens/types.ts
app/src/screens/tasks/TasksScreen.tsx
app/src/screens/playbooks/PlaybooksScreen.tsx
app/src/screens/schedules/SchedulesScreen.tsx
app/src/screens/memory/MemoryScreen.tsx
app/src/screens/budget/BudgetScreen.tsx
app/src/screens/settings/SettingsScreen.tsx
app/src/screens/integrations/IntegrationsView.tsx
app/e2e/shell.spec.ts
