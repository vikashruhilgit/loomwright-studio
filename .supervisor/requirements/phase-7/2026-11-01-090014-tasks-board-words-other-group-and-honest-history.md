# 14 — Tasks: the board words, an honest Other group, and a readable history

## Status: ready

**Priority:** MVP (bug) · ROADMAP phase 7 · D3, D9, UI.md honest status

**As** the owner,
**I want** a task waiting on me to appear under "Waiting on you", and any task the board can't sort to show up visibly instead of hiding in Working,
**so that** the board never tells me nothing waits on me when something does.

## Problem

Live run 2026-11-01. The runbook's populate step asked Wright to create a task "waiting on my answer". Wright called `kernel_task_create` with state `waiting on owner`. The board sorts only the exact words `waiting`, `working`, `parked`, `done` (`app/src/screens/tasks/model.ts:49`, "Anything not listed goes to Working"), so the card sat in **Working** and "Waiting on you" said "Nothing waits on you." The tool's description says "state is free text you choose; the kernel defines no states" (`kernel/src/tools/server.ts:161`), so nothing told Wright which words the board reads.

Also seen on the same cards: both task cards read "unknown agent" (Wright created them in session 81); the task's history shows the raw event payload (`{ "title": "Pick the repos to review first", "state": "waiting on owner" }`) where the mockup's `tasks-history` view shows a sentence and its actor; and the session panel says "No session is attached to this task" although the audit log records `task_created` in session 81.

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

1. **Name the board words to Wright.** `kernel_task_create` (and `kernel_task_update`) descriptions list `waiting`, `working`, `parked`, `done` as the words the board sorts and say any other word shows under Other. The kernel still accepts any state (D3; owner decision 2026-11-01).
2. **Other group.** The board shows a task whose state is none of the four in a visible "Other" group with its raw state word, never in Working. `gui-v2.html` gains the `tasks-other` view first (D9), in this item.
3. **Who made it.** A task card names the agent of the session that created it when it has no assignee, instead of "unknown agent"; with neither, it says so in words the mockup uses.
4. **Readable history.** Each history entry is a sentence plus its actor, as `tasks-history` shows; the raw payload is never the entry's text. The creating session is linked from the task when the store records it.
5. **Polish gate.** The PR commits screenshots from the running app (fixture kernel, through `app/e2e/electron-harness.ts`), light and dark, of every mockup state the item changes, each named against its `gui-v2.html` view. The owner's approval of the PR is the gate (D9).

## Non-goals

- A closed list of task states in the kernel (owner decision 2026-11-01).
- Guessing synonyms such as "waiting on owner" → Waiting.

## Acceptance criteria

- [ ] Given a task with state `waiting`, then it shows under "Waiting on you" and the count says so.
- [ ] Given a task with state `waiting on owner` (any word outside the four), then it shows in the Other group with that word, not in Working, matching the new `tasks-other` view.
- [ ] Given `kernel_task_create`'s and `kernel_task_update`'s tool descriptions, then they name the four board words and still accept any state (a kernel test pins both).
- [ ] Given a task created by Wright's session with no assignee, then its card names Wright, not "unknown agent".
- [ ] Given a task's history, then each entry is a sentence and an actor, matching `tasks-history`; no JSON object is visible.
- [ ] Given a task whose creating session is recorded, then its detail links that session's log.
- [ ] The polish-gate screenshots are in the PR body, each named against its mockup view.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`
- `cd kernel && npm ci && npm run typecheck && npm test`

## Assumptions

- The store records the creating session for a task (`owner_session_id`, `kernel/src/store/migrations/001_initial.ts`); if it doesn't for older rows, those say so.

## Risks

- Changing a tool description changes what Wright writes from now on; rows created before it keep their words and land in Other, which is the honest outcome.

## Depends on
2026-11-01-090012-shell-polish-sidebar-titlebar-subtitle-and-crew-rows.md

## Touches
kernel/src/tools/server.ts
kernel/test/kernel-tools.test.ts
kernel/src/gui/tasks.ts
kernel/test/gui-tasks.test.ts
app/src/screens/tasks
app/e2e/tasks.spec.ts
docs/design/mockups/gui-v2.html
