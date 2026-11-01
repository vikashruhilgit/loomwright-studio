# 18 — Settings and Memory: home paths as ~, the account name, and Settings polish

## Status: ready

**Priority:** MVP · ROADMAP phase 7 · D9, invariant 6

**As** the owner,
**I want** paths under my home folder shown as `~/…` and Settings to show my account rather than the provider's id,
**so that** screenshots of the app don't publish my user name, and Settings reads like the mockup.

## Problem

Live run 2026-11-01, `memory-populated`, `memory-file`, `settings-populated`, light and dark. Memory's list and file view otherwise match; Settings mostly matches. Mismatches:

- **Home paths.** Memory's root (`/Users/<name>/.loomwright-studio/memory/`) and a file's Path, and Settings' Data location and Loomwright path, are absolute; the mockup shows `~/.loomwright-studio/…`. The repo is public, so live screenshots carry the user name (the owner's 2026-10-31 screenshot decision).
- **Account** reads `subscription-token` (the provider id); the mockup reads "personal subscription". Settings stays read-only for auth (invariant 6).
- **Command blocks** wrap (`security add-generic-password … -w` breaks over two lines); the mockup's fit on one line.
- **Theme help text** reads "System follows your Mac." even when Dark or Light is selected.
- The login-item note is out of scope (owner decision 2026-11-01).

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

1. **`~` for home paths** in Memory (root, file Path) and Settings (Data location, Loomwright), from one formatter; Reveal in Finder still opens the real path.
2. **Account** shows the provider's account display name; when the provider has none, the mockup's wording.
3. **Command blocks** fit one line at the window's default width, scrolling horizontally beyond it.
4. **Theme help text** matches the selected theme.
5. **Polish gate.** The PR commits screenshots from the running app (fixture kernel, through `app/e2e/electron-harness.ts`), light and dark, of every mockup state the item changes, each named against its `gui-v2.html` view. The owner's approval of the PR is the gate (D9).

## Non-goals

- The login-item note (owner decision 2026-11-01).
- Any auth write from Settings (invariant 6).

## Acceptance criteria

- [ ] Given a data directory under the home folder, then Memory and Settings show it as `~/…`, matching `memory-populated`, `memory-file` and `settings-populated`, and Reveal in Finder opens the real folder.
- [ ] Given a data directory outside the home folder, then it shows in full.
- [ ] Given the subscription provider, then Account shows its account name, not `subscription-token`.
- [ ] Given the default window width, then each command block is one line.
- [ ] Given Light, Dark or System selected, then the theme row's help text describes that choice.
- [ ] The polish-gate screenshots are in the PR body, each named against its mockup view.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`

## Assumptions

- The home folder is known to the app (Electron's `app.getPath('home')`) without a new kernel route.

## Risks

- A formatter applied in two screens; one unit test covers home, outside-home and a path that only starts with the home name.

## Depends on
2026-11-01-090012-shell-polish-sidebar-titlebar-subtitle-and-crew-rows.md

## Touches
app/src/screens/settings
app/src/screens/memory
app/src/shell/home-path.ts
app/e2e/settings.spec.ts
app/e2e/memory.spec.ts
