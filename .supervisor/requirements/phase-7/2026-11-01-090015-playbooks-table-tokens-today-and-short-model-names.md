# 15 — Playbooks: tokens today against the limit, short model names, owner by name

## Status: ready

**Priority:** MVP · ROADMAP phase 7 · D9, D24

**As** the owner,
**I want** the Playbooks table to show each playbook's tokens today against its daily limit, with short model names, as the mockup does,
**so that** I can see at a glance which playbook is spending what, without a cramped table.

## Problem

Live run 2026-11-01, `playbooks-populated` and `playbooks-detail`, light and dark:

- The last column reads "TOKENS" with "86,160 tokens · last run"; the mockup's reads "TOKENS TODAY" with "38.2k of 200k" (or "0 of 50k"), against the playbook's daily limit (D24: limits in tokens).
- The Model column shows the full id `claude-sonnet-5-5`, which wraps over three lines and pushes every row taller; the mockup shows `sonnet`.
- Detail: Owner shows the id `wright` where the mockup shows the agent's avatar and name; the title bar carries no slug (the subtitle slot is item 12's, this item fills it).
- The rest of the detail view matches.

**Kernel unreachable and the title bar (2026-11-01).** With the kernel stopped, Playbooks kept its rows but turned Last run and Tokens to "unknown · could not be read", with no band; its count line sits under the title instead of beside it. The shell parts (the shared band, the titlebar subtitle slot, the `~` formatter) are item 11's; each screen item adopts them in its own folder, so the screen items run in parallel.

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

1. **Adopt the shell (item 11).** Playbooks keeps its last data under the shared band when the kernel is unreachable, matching `playbooks-unreachable`, with no raw request text; and it hands its count line to the titlebar subtitle slot instead of drawing its own band. Last run and Tokens keep their last values marked last known, not "unknown · could not be read".
2. **Tokens today** per playbook against its daily limit ("no limit set" when unset), as the mockup shows; last-run tokens stay in the detail's Recent runs.
3. **Short model names** in the table (`sonnet`, `opus`, `haiku`), the full id in the detail and a tooltip.
4. **Owner by name and avatar** in the detail; the detail's slug in the title bar subtitle.
5. **Polish gate.** The PR commits screenshots from the running app (fixture kernel, through `app/e2e/electron-harness.ts`), light and dark, of every mockup state the item changes, each named against its `gui-v2.html` view. The owner's approval of the PR is the gate (D9).

## Non-goals

- Changing how tokens are counted.

## Acceptance criteria

- [ ] Given Playbooks loaded, when the fixture kernel's listener stops, then it keeps its data under the shared band with write controls disabled, matching `playbooks-unreachable`, and refreshes when the listener restarts.
- [ ] Given Playbooks, then its count line sits beside the title in the title bar, matching `playbooks-populated`.
- [ ] Given playbooks with and without a daily limit, then the table's last column reads "Tokens today" with "N of limit" or "no limit set", matching `playbooks-populated`.
- [ ] Given a playbook on `claude-sonnet-5-5`, then the table shows `sonnet` on one line and the detail shows the full id.
- [ ] Given a playbook's detail, then Owner shows the agent's avatar and name, matching `playbooks-detail`.
- [ ] The polish-gate screenshots are in the PR body, each named against its mockup view.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`
- `cd kernel && npm ci && npm run typecheck && npm test`

## Assumptions

- Tokens today per playbook can be read from the store (the Budget screen already shows per-playbook tokens today).

## Risks

- None beyond the table layout at narrow widths; the e2e checks one-line rows at the window's minimum width.

## Depends on
2026-11-01-090011-shell-shared-unreachable-band-sidebar-titlebar-slot-and-home-paths.md

## Touches
app/src/screens/playbooks
kernel/src/gui/playbook-history.ts
kernel/test/gui-playbook-history.test.ts
app/e2e/playbooks.spec.ts
