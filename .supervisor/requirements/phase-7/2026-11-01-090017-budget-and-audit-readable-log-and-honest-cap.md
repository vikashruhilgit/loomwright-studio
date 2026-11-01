# 17 — Budget & audit: a readable audit log and an honest subscription cap

## Status: ready

**Priority:** MVP · ROADMAP phase 7 · D9, D24, UI.md honest status

**As** the owner,
**I want** the audit log to read as sentences with who did each thing, and the cap card to say when its numbers are stale,
**so that** I can read my own audit trail and trust the cap state.

## Problem

Live run 2026-11-01, `budget-populated` and `budget-audit`, light and dark. The per-day and per-agent tables match. Mismatches:

- **Audit log Detail** shows raw payloads and codes (`{"from_seq":9,"to_seq":9}`, `{"title":"Pick the repos to review first","state":"waiting on owner"}`, `result_success`, `group_gone`); the mockup shows a sentence ("Draft review recorded for studio-sandbox #3. Recorded, not sent.").
- **Actor** reads "—" on every row; the mockup names the actor (mason, ada, kernel, wright).
- No "N of N events" count beside the title, and no Newer / Older paging visible.
- **Cap card:** "five_hour · usage not reported · resets Fri 30 Oct 00:30" on Sun 1 Nov, a reset time in the past shown as current; the label reads `subscription-token` (the provider id) where the mockup reads "personal subscription". `studio status` reported `seven_day allowed_warning until 2026-10-26`, an expired window, and the card shows "allowed"; whether that is right is to be checked against the cap rules, not assumed.

**Kernel unreachable and the title bar (2026-11-01).** With the kernel stopped, Budget & audit replaced everything with "Status unknown"; its count line sits under the title instead of beside it. The shell parts (the shared band, the titlebar subtitle slot, the `~` formatter) are item 11's; each screen item adopts them in its own folder, so the screen items run in parallel.

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

1. **Adopt the shell (item 11).** Budget & audit keeps its last data under the shared band when the kernel is unreachable, matching `budget-unreachable`, with no raw request text; and it hands its count line to the titlebar subtitle slot instead of drawing its own band.
2. **Audit Detail as sentences.** Each audit kind the store writes has a sentence; an unknown kind shows its kind name and "no description yet", never a JSON object.
3. **Actor** from the event's agent or session ("kernel" for kernel events).
4. **Count and paging** as the mockup shows.
5. **Honest cap.** A window whose reset time has passed is marked stale with when it was last read; the card's label is the provider's display name. Check how an expired `allowed_warning` should read against the cap rules (`kernel/src/` cap detection) and pin it in a test.
6. **Polish gate.** The PR commits screenshots from the running app (fixture kernel, through `app/e2e/electron-harness.ts`), light and dark, of every mockup state the item changes, each named against its `gui-v2.html` view. The owner's approval of the PR is the gate (D9).

## Non-goals

- New audit kinds.
- Dollar figures beyond the existing "≈ at API rates" estimate (D24).

## Acceptance criteria

- [ ] Given Budget & audit loaded, when the fixture kernel's listener stops, then it keeps its data under the shared band with write controls disabled, matching `budget-unreachable`, and refreshes when the listener restarts.
- [ ] Given Budget & audit, then its count line sits beside the title in the title bar, matching `budget-populated`.
- [ ] Given the audit log, then every row's Detail is a sentence, no JSON object is visible, and Actor names who did it, matching `budget-audit`.
- [ ] Given more events than a page, then the count and Newer / Older paging show and work.
- [ ] Given a cap window whose reset time has passed, then the card marks it stale with its last-read time instead of showing the past reset as current.
- [ ] Given the subscription provider, then the cap card's label is its display name, not its id.
- [ ] Given an expired `allowed_warning` window, then the card reads what the cap rules say (pinned in a kernel test).
- [ ] The polish-gate screenshots are in the PR body, each named against its mockup view.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`
- `cd kernel && npm ci && npm run typecheck && npm test`

## Assumptions

- Each audit row carries the agent or session that caused it, or the kernel; rows without one say "kernel".

## Risks

- Many audit kinds; the sentence table lives in one place with a test that every kind the store writes has an entry.

## Depends on
2026-11-01-090011-shell-shared-unreachable-band-sidebar-titlebar-slot-and-home-paths.md

## Touches
app/src/screens/budget
kernel/src/gui/budget-audit.ts
kernel/test/gui-budget-audit.test.ts
app/e2e/budget.spec.ts

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-01T13:54:25Z
- **Brief:** .supervisor/jobs/done/2026-11-01-budget-and-audit-readable-log-and-honest-cap.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/197
