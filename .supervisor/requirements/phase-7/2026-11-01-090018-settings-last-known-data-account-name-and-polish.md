# 18 — Settings: last-known data when the kernel is unreachable, ~ paths, the account name and polish

## Status: ready

**Priority:** MVP (bug + polish) · ROADMAP phase 7 · D9, invariant 6

**As** the owner,
**I want** Settings to keep showing what it last read while the kernel restarts, show my account rather than the provider's id, and show home paths as `~/…`,
**so that** Settings reads like the mockup and its screenshots don't publish my user name.

## Problem

Live run 2026-11-01, `settings-populated` and `settings-unreachable`, light and dark. Settings mostly matches. Mismatches:

- **Unreachable:** the auth section is replaced by "Status unknown"; the mockup keeps the last values under the shared band.
- **Home paths:** Data location and the Loomwright path are absolute; the mockup shows `~/…` (the owner's 2026-10-31 screenshot decision).
- **Account** reads `subscription-token` (the provider id); the mockup reads "personal subscription". Settings stays read-only for auth (invariant 6).
- **Command blocks** wrap (`security add-generic-password … -w` breaks over two lines); the mockup's fit on one line.
- **Theme help text** reads "System follows your Mac." even when Dark or Light is selected.
- The login-item note is out of scope (owner decision 2026-11-01).

The shell parts (the shared band, the titlebar subtitle slot, the `~` formatter) are item 11's; each screen item adopts them in its own folder, so the screen items run in parallel.

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

1. **Adopt the shell (item 11).** Settings keeps its last data under the shared band when the kernel is unreachable, matching `settings-unreachable`, with no raw request text; and it hands its count line to the titlebar subtitle slot instead of drawing its own band.
2. **`~` paths** for Data location and Loomwright, through item 11's formatter; Reveal in Finder still opens the real path.
3. **Account** shows the provider's account display name; when the provider has none, the mockup's wording.
4. **Command blocks** fit one line at the window's default width, scrolling horizontally beyond it.
5. **Theme help text** matches the selected theme.
6. **Polish gate.** The PR commits screenshots from the running app (fixture kernel, through `app/e2e/electron-harness.ts`), light and dark, of every mockup state the item changes, each named against its `gui-v2.html` view. The owner's approval of the PR is the gate (D9).

## Non-goals

- The login-item note (owner decision 2026-11-01).
- Any auth write from Settings (invariant 6).

## Acceptance criteria

- [ ] Given Settings loaded, when the fixture kernel's listener stops, then it keeps its data under the shared band with write controls disabled, matching `settings-unreachable`, and refreshes when the listener restarts.
- [ ] Given Settings, then its count line sits beside the title in the title bar, matching `settings-populated`.
- [ ] Given a data directory under the home folder, then Data location and Loomwright read `~/…`, matching `settings-populated`, and Reveal in Finder opens the real folder; outside home, in full.
- [ ] Given the subscription provider, then Account shows its account name, not `subscription-token`.
- [ ] Given the default window width, then each command block is one line.
- [ ] Given Light, Dark or System selected, then the theme row's help text describes that choice.
- [ ] The polish-gate screenshots are in the PR body, each named against its mockup view.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`

## Assumptions

- Item 11's band contract and formatter are merged first.

## Risks

- None beyond adopting a shared contract.

## Depends on
2026-11-01-090011-shell-shared-unreachable-band-sidebar-titlebar-slot-and-home-paths.md

## Touches
app/src/screens/settings
app/e2e/settings.spec.ts

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-01T14:18:07Z
- **Brief:** .supervisor/jobs/done/2026-11-01-settings-last-known-data-account-name-and-polish.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/199
