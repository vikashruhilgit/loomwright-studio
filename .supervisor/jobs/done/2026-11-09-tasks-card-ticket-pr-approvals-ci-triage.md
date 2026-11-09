# Supervisor Job: Tasks card for a ticket's PR (approvals, CI, owner, waiting on you) and its history

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-02-150636/L14
- **CLAUDE.md:** ✓ Found (fresh — phase 8 under way, matches the code read)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8/2026-11-02-160011-tasks-card-ticket-pr-approvals-ci-and-triage.md
- **Base commit:** a29804848d31942a64d5c727cfb4eb4065c2208b

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React + TypeScript app (`app/`), vitest unit tests, Playwright-Electron e2e through `app/e2e/electron-harness.ts`; no new dependency |
| 2 | Dependency Availability | GO | Item 10 (merged in #241) serves `TaskBoardItem.ticket_pr` (`TaskTicketPr` in `app/src/api/contract.ts`) on `GET /tasks` and `GET /tasks/:kind/:id`, and appends `pr_state_changed` events; the store's shared `approvals` resource (`GET /approvals`) and `mergeApprovalOf` (`app/src/screens/approvals/subject.ts`) already exist; `approvalHash(id)` (`app/src/screens/menubar/links.ts`) builds `#/approvals/<id>`, which `ApprovalsScreen` selects on hashchange |
| 3 | Architecture Fit | GO | Card and history extend the phase 7 Tasks screen; no kernel change (non-goal "New kernel routes") |
| 4 | Scope vs Supervisor Capability | GO | 8 modify + 4 source/doc creates (12 files) plus generated PNGs; single worker |
| 5 | Hard Blockers | CAUTION | No kernel source for the comment triage tally: `TaskTicketPr` has no tally field and no kernel code writes a comment-route event (`grep -rn "comment_routed\|tally" kernel/src app/src` → no hit outside DiffView). A tally the kernel did not record cannot be shown honestly; see AC6 and Risk row 1 |

**Overall Verdict:** CAUTION

## Task
**Goal:** Render a ticket → PR task on the Tasks board and in its history as `docs/design/mockups/phase-8.html` draws it (ticket source and id, PR number and state, approvals `n/N` / Solo / Approve in Studio / No policy, CI state, owner kind, "waiting on you" with a link to the pending merge approval), with each `pr_state_changed` in the history, honest status, last-known data while the kernel is away, and the polish-gate screenshots.

**Problem Statement:**
The owner needs to see at a glance where each ticket's PR stands and why it waits, because phase 7's Tasks board shows only today's kernel rows. Currently `GET /tasks` already serves `ticket_pr` (item 10) but the app ignores it: a ticket task shows as a plain task, and its state words (`open`, `draft`, `ready`, `merged`, `closed`) fall into the Other group. Success looks like a card that reads "GitHub Issue #14 → PR #21 · parked · Approve in Studio · CI green · waiting on you · Open approval #7", green only for what the kernel recorded, and a history listing each PR state change once, in order.

## Acceptance Criteria

Carried from the source requirement (AC1–AC5), plus the scope lines it lists (AC6–AC9). Every string from the kernel (ticket ref, repo, title, event payload, approval payload) is untrusted: it passes through `printable` (`app/src/screens/approvals/printable.ts`) and renders as a text child only.

- [ ] **AC1** Given a fixture ticket → PR task on a `reviews: 2` repo with one approval and CI green (`ticket_pr.approvals: "1/2"`, `ci: "green"`), when the board renders, then the card reads its ticket (source icon + label + id, e.g. "Issue #14": the source is read only from the ref's prefix as the kernel's poll sources write it — `github:<repo>#<n>` → GitHub Issue `#<n>`, `clickup:<id>` → ClickUp `<id>`, `jira:<site>/<key>` → Jira `<key>`; any other ref shows the escaped raw ref with no source icon; `ticket: null` shows no ticket line; unit cases for each), "PR #<n>" with its state, "1/2 approvals" (neutral, since 1 < 2) and "CI green" (ok tone) as the mockup's `prCard` draws them; asserted by a unit test and by `app/e2e/tasks.spec.ts`.
- [ ] **AC2** Given a parked PR (`ticket_pr.state: "parked"`, `approvals: "studio_approval"`) and a pending merge approval in the store's `approvals` resource whose `mergeApprovalOf` repo (case-insensitive) and pr match the card's `ticket_pr`, when the board renders, then the card sits in the "Waiting on you" column, shows "Waiting on you" and an "Open approval #<id>" control that navigates to `approvalHash(<id>)` (`#/approvals/<id>`), and the open card's detail shows the same waiting band and link; with no matching pending approval the card shows no "waiting on you" (never inferred from the state word alone).
- [ ] **AC3** Given CI pending (`ci: "pending"`, approvals `0/2`, state `open`), when the card renders, then nothing on the card has the ok (green) tone — CI pending is neutral with an idle dot, `0/2 approvals` neutral, the state badge neutral; `ci: null` (an out-of-set state the kernel read as `null`) and `"none"` are never green either; `"failing"` reads "CI failing" in the danger tone (the mockup's `ciChip`).
- [ ] **AC4** Given the open card's history (`GET /tasks/task/:id`) with several `pr_state_changed` events, when it renders, then each state change appears once, in the events' order (oldest first), as a sentence built only from the payload's fields (`PR #<pr>: <from> → <to> · CI <ci> · approvals <word>`, `reason` appended when present; `from: null` reads as opened), never the raw JSON; every event with a `session_id` links that session (its log, as the phase 7 history does), and the history's sessions (the `/automate`, fix and merge-item runs) and approvals are listed with their links.
- [ ] **AC5** Given the kernel down after a remount (Tasks opened again with the fixture's listener stopped), when the board renders, then the last-known board shows its ticket → PR cards with their approvals, CI and owner words and the "last known" mark, every card disabled, and no request text (the phase 7 item 23 behaviour, `lastKnown.ts` + `withLastKnown`, extended to the new card).
- [ ] **AC6** Triage tally (requirement scope 1 and 2, "the triage tally" / "its comments' routes", as amended by the requirement's `## Owner decision (2026-11-09, Launch Pad LP-CLARIFY, binding)`: "Defer tally", delivered by a kernel follow-up item): the card and detail show a comment tally only from a kernel-served value. At base `TaskTicketPr` carries no tally and the kernel records no comment-route event, so the card draws no tally numbers (never a guessed "0 fix · 0 reply"), a comment-route event the kernel may append later renders through the history's generic `<kind> recorded` line, and the committed evidence file `docs/evidence/phase-8-polish/tasks/README.md` records under "Deviations from the mockup" that the tally is absent because the kernel serves none, naming the missing field as the follow-up.
- [ ] **AC7** Board placement and tones for a ticket task (a card whose `ticket_pr` is non-null): `ticket_pr.state` `open`/`draft`/`ready` → Working, `parked` → Parked (Waiting on you when AC2's approval matches), `merged`/`closed` → Done today; the state badge is ok only for `merged`; a plain task's mapping (`TASK_COLUMNS`, `OK_STATE`) is unchanged, so every existing card keeps its column and tone. The owner kind reads as the mockup's `OWN[*].short` words (`automate_live` → "live /automate run", `automate_parked` → "parked /automate item", `owner` → "you or the App", `other` → "someone else"; `null` → no owner word). The approvals word reads `solo` → "Solo" (neutral), `studio_approval` → "Approve in Studio" (attention only while AC2's approval waits, else neutral), `no_policy` → "No policy" (parked tone), `n/N` → "n/N approvals" (ok only when n ≥ N), any other word → the escaped word, neutral. A parked `no_policy` card shows "No policy" and the mockup's "Set this repo's merge policy" note (no write; a link to Integrations only). `merged_by_gate: true` shows "by Loomwright's gate" as text, never an action.
- [ ] **AC8** Accessibility and keys: every ticket card keeps the board's accessible-name form (`cardLabel`: `Task <id>: <title>, <state>`, so AC10's regex `/^(Task|Playbook run|Session) \d+: .+, .+$/` in `tasks.spec.ts` still matches) with the ticket, PR, approvals, CI and "Waiting on you." words appended; the "Open approval" control is a sibling of the card button (the mockup's `.tfoot`), never a button nested in a button; J / K / Enter / Esc work on ticket cards as on any card; text meets 4.5:1 in both themes. The README's Deviations names the label prefix choice (the mockup's `prCard` label starts with the source, `GitHub Issue #14, PR 21: …`; the app keeps the board's `Task <id>:` prefix that AC10 pins).
- [ ] **AC9** Polish gate: with the phase 8 polish lanes' shared switch `PHASE8_POLISH_EVIDENCE=1` (as `app/e2e/playbooks.spec.ts`, `approvals.spec.ts` and `integrations-phase-8.spec.ts` use it; the phase 7 `TASKS_EVIDENCE` switch is untouched), `app/e2e/tasks.spec.ts` writes screenshots from the running app (fixture kernel, launched only via `launchApp` from `app/e2e/electron-harness.ts`) of every new card and history state, light and dark — at least `tasks-ticket-populated`, `tasks-ticket-waiting`, `tasks-ticket-pending`, `tasks-ticket-history`, `tasks-ticket-unreachable` — to `docs/evidence/phase-8-polish/tasks/`, and a committed evidence file `docs/evidence/phase-8-polish/tasks/README.md` lists each PNG with the `phase-8.html` view it matches (`tasks-populated`, `tasks-waiting`, `tasks-history`, `tasks-unreachable`), how to regenerate them, and the deviations from the mockup; a spec test asserts the README lists exactly the PNGs on disk and names the regenerate command, and a guard test (as the other phase 8 specs pin it) asserts that without `PHASE8_POLISH_EVIDENCE` nothing under `docs/evidence/phase-8-polish/tasks/` changed during the run. The phase 7 evidence folder (`docs/evidence/phase-7-polish/tasks/`, pinned at 16 PNGs) is untouched.

**Validation (must pass before merge):**
- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh` (scans `docs/**/*.md` relative links, so the new README's links must resolve)
- House rule (advisory): e2e specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts`).

## Touched-file invariants

> Grounded at base `a29804848d31942a64d5c727cfb4eb4065c2208b`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/screens/tasks/model.ts`** — keep: the plain-task tables unchanged, `const TASK_COLUMNS = table<ColumnId>({ waiting: "wait", working: "work", parked: "park", done: "done" });` and `const OK_STATE: Readonly<Record<TaskBoardKind, string>> = { task: "done", playbook_run: "done", session: "completed" };` (the ticket mapping is a separate branch keyed on `ticket_pr !== null`, never new synonyms in `TASK_COLUMNS`); the prototype-free `table<V>(` helper for any new word table; `cardLabel`'s prefix `` `${KIND_LABEL[item.kind]} ${item.id}: ${cardTitle(item)}, ${stateText(item)}` `` (AC10's regex pins it) — ticket words are appended after it. pinned by: `app/src/screens/tasks/model.test.ts` and `app/e2e/tasks.spec.ts` (`/^(Task|Playbook run|Session) \d+: .+, .+$/`).
- **`app/src/screens/tasks/history.ts`** — keep: "its payload is NOT shown" — an unknown kind still reads `` `${kind} recorded` ``; every payload string through `printable`; `SENTENCE_LIMIT` cut. reuse: `textOf(payload, name)` / `fieldOf` for the new `pr_state_changed` sentence. mirror: the payload keys `kernel/src/automate/tracker.ts` writes for `"pr_state_changed"` (`repo`, `pr`, `from`, `to`, `head_sha`, `approvals`, `ci`, `owner_kind`, optional `reason`). pinned by: `app/src/screens/tasks/history.test.ts`.
- **`app/src/screens/tasks/history.test.ts`** — keep: the unknown-kind loop `for (const kind of ["task_created", "task_updated", "session_started", "anything_new"])` and every existing `task_created` / `task_updated` expectation unchanged; the `pr_state_changed` cases are appended, never edits to existing ones.
- **`app/src/screens/tasks/TasksScreen.tsx`** — keep: `readTasks` treating a throw or a body without `groups` as a failed read (`if (result.ok && !Array.isArray(`), the last-known path (`setLastBoard`, `withLastKnown`, `useKernelReach(api).shellBand`), `TASKS_LIMIT = "200"`. reuse: `useResource` from `../../store/react` for the shared `approvals` resource (as `ApprovalsScreen.tsx` does: `useResource("approvals", api)`), never a second `GET /approvals` fetcher.
- **`app/src/screens/tasks/TasksViews.tsx`** / **`TaskDetail.tsx`** — keep: `CardView`'s single card button (`type="button"`) with `data-card-key={key}`, `data-column={column}`, `aria-disabled={offline ? true : undefined}`, and the focus-loss `watch` ref; a plain task card renders exactly as today. The ticket card's footer link is a sibling inside the `<li>`, not inside the button. `TaskDetail` keeps its `ApprovalRow` and the "No session is attached" note.
- **`app/e2e/fixtures/tasks.ts`** — keep: `item(kind, id, state, overrides)` defaulting `ticket_pr: null,` and `populatedItems` / `waitingItems` unchanged (the phase 7 AC11 screenshots and their 16-PNG pin read them); ticket fixtures are new exports. mirror: the kernel `tasks` gui part's route rules in the file header (`GET /tasks/:kind/:id` events oldest first).
- **`app/e2e/tasks.spec.ts`** — keep: `const EVIDENCE = process.env.TASKS_EVIDENCE === "1";` and the phase 7 `EVIDENCE_DIR` / `STATES` / `expect(expected).toHaveLength(16);` untouched; launches only through `import { launchApp } from "./electron-harness";`. reuse: the phase 8 switch as `app/e2e/playbooks.spec.ts` reads it, `process.env.PHASE8_POLISH_EVIDENCE === "1"`, with its own directory constant for `docs/evidence/phase-8-polish/tasks/`.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/screens/tasks/TicketPrCard.test.tsx` — merged is the only ok ticket state | flip `"merged"` → `"open"` in the ticket OK-state entry in `app/src/screens/tasks/TicketPrCard.tsx` |
| `app/src/screens/tasks/TicketPrCard.test.tsx` — CI pending / null / none never ok | flip the CI table's `pending` tone `"neutral"` → `"ok"` in `app/src/screens/tasks/TicketPrCard.tsx` |
| `app/src/screens/tasks/TicketPrCard.test.tsx` — `n/N approvals` ok only when n ≥ N | flip `>=` → `<=` in the approvals-tone comparison in `app/src/screens/tasks/TicketPrCard.tsx` |
| `app/src/screens/tasks/TicketPrCard.test.tsx` — waiting on you only with a matching pending merge approval | delete the `status === "pending"` match condition in `app/src/screens/tasks/TicketPrCard.tsx` |
| `app/src/screens/tasks/TicketPrCard.test.tsx` — ticket source from the ref prefix; unknown prefix shows raw ref | delete the `clickup:` prefix entry in `app/src/screens/tasks/TicketPrCard.tsx` |
| `app/src/screens/tasks/history.test.ts` — the `pr_state_changed` sentence, never raw JSON | delete the `if (kind === "pr_state_changed")` branch in `app/src/screens/tasks/history.ts` |
| `app/e2e/tasks.spec.ts` — AC2 card in Waiting on you with "Open approval #<id>" linking `#/approvals/<id>` | delete the `approvalHash(` navigation call in `app/src/screens/tasks/TicketPrCard.tsx` |
| `app/e2e/tasks.spec.ts` — AC5 last-known ticket cards marked and disabled | delete the `setLastBoard(` call in `app/src/screens/tasks/TasksScreen.tsx` |
| `app/e2e/tasks.spec.ts` — README lists exactly the phase 8 PNGs on disk | delete one PNG row from `docs/evidence/phase-8-polish/tasks/README.md` |
| `app/e2e/tasks.spec.ts` — nothing under `docs/evidence/phase-8-polish/tasks/` changes without `PHASE8_POLISH_EVIDENCE` | flip the phase 8 screenshot directory choice so it always writes to the tracked `docs/evidence/phase-8-polish/tasks/` (drop the `PHASE8_EVIDENCE ?` branch) in `app/e2e/tasks.spec.ts`'s phase 8 `shoot` helper |
| `app/src/screens/tasks/TicketPrCard.test.tsx` — owner-kind words (`automate_live` → "live /automate run", `automate_parked` → "parked /automate item", `owner` → "you or the App", `other` → "someone else") | flip `"live /automate run"` → `"parked /automate item"` in the owner-word table in `app/src/screens/tasks/TicketPrCard.tsx` |
| `app/src/screens/tasks/TicketPrCard.test.tsx` — `no_policy` reads "No policy" in the parked tone | flip the `no_policy` tone `"parked"` → `"ok"` in `app/src/screens/tasks/TicketPrCard.tsx` |
| `app/e2e/tasks.spec.ts` — AC4 an event with a `session_id` links that session | delete the session-link render for an event's `session_id` in `app/src/screens/tasks/TaskDetail.tsx` |
| `app/src/screens/tasks/TicketPrCard.test.tsx` / `app/e2e/tasks.spec.ts` AC10 — ticket words appended after the `Task <id>:` prefix | move the ticket words before the `KIND_LABEL` prefix in the ticket card's accessible-name builder in `app/src/screens/tasks/TicketPrCard.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Ticket → PR card, waiting-on-you link, PR history sentences, last-known, polish screenshots | all | 8 modify, 4 create (+ generated PNGs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| card + board | `app/src/screens/tasks/model.ts` (388), `app/src/screens/tasks/TasksViews.tsx` (277), `app/src/screens/tasks/TasksScreen.tsx` (386) | `app/src/screens/tasks/TicketPrCard.tsx` (the ticket card's words, tones, column, owner words, approval match and view — the one home for the new responsibility), `app/src/screens/tasks/ticket-pr.css` (its styles: `tasks.css` is 503 lines, at the threshold) | HIGH |
| history + detail | `app/src/screens/tasks/history.ts` (94), `app/src/screens/tasks/TaskDetail.tsx` (229) | — | HIGH |
| unit tests | `app/src/screens/tasks/history.test.ts` (102) | `app/src/screens/tasks/TicketPrCard.test.tsx` (the new module's tests; `TasksScreen.test.tsx` is 1186 lines and is not appended to) | HIGH |
| e2e + evidence | `app/e2e/tasks.spec.ts` (921 — appended: it is the item's one named e2e home in Touches, and a new spec file would widen Touches), `app/e2e/fixtures/tasks.ts` (261) | `docs/evidence/phase-8-polish/tasks/README.md` (+ the generated `tasks-ticket-*-{light,dark}.png`) | HIGH |

> **Validator-owned surfaces:** `scripts/check-docs.sh` scans every `docs/**/*.md` relative link, so `docs/evidence/phase-8-polish/tasks/README.md` is in its scan set (listed above).

Read-only reuse (imported, not modified): `app/src/screens/approvals/subject.ts` (`mergeApprovalOf`), `app/src/screens/menubar/links.ts` (`approvalHash`), `app/src/screens/approvals/printable.ts`, `app/e2e/fixtures/approvals.ts` (`mergeApproval`), `app/src/api/contract.ts` (`TaskTicketPr`, `PrCiState`, `PrOwnerKind`, `PrTrackState`).

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "app/src/screens/tasks/TicketPrCard.tsx"}
  - {kind: "symbol", path: "app/src/screens/tasks/TicketPrCard.tsx", name: "TicketPrCard"}
  - {kind: "file", path: "app/src/screens/tasks/ticket-pr.css"}
  - {kind: "file", path: "app/src/screens/tasks/TicketPrCard.test.tsx"}
  - {kind: "symbol", path: "app/src/screens/tasks/history.ts", name: "historyLine"}
  - {kind: "file", path: "docs/evidence/phase-8-polish/tasks/README.md"}
requires: []
lanes:
  - "app/src/screens/tasks/**"
  - "app/e2e/tasks.spec.ts"
  - "app/e2e/fixtures/tasks.ts"
  - "docs/evidence/phase-8-polish/tasks/**"
external_requires:
  - "Electron binary for Playwright e2e (node node_modules/electron/install.js once if missing)"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `DESIGN.md:137` | yes (`docs/DESIGN.md`) | HOLDS (moved to 138) | "Linked PRs and tickets, approvals counts and CI state join in phase 8, so the mockup shows none of them." | tip 12 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): the requirement's triage tally and comment routes have no kernel source (`TaskTicketPr` has no tally; no comment-route event kind exists) and new kernel routes are a non-goal; the owner deferred both to a kernel follow-up item on 2026-11-09 (`LP-CLARIFY`, recorded in the requirement) | MEDIUM | AC6: show no tally numbers, keep the generic `<kind> recorded` history line for any later event, record the gap and the missing field in the evidence README's Deviations; never derive a tally from session tool output |
| Matching a pending merge approval to a card uses agent-adjacent payload data | MEDIUM | Read it only through `mergeApprovalOf` (kernel-authorised `payload.input` of the merge tool, validated repo / pr / head_sha); match on repo (case-insensitive) + pr, and only `status === "pending"` |
| Existing Tasks pins (`TasksScreen.test.tsx` 1186 lines, `model.test.ts`, `tasks.spec.ts` AC4/AC10/AC11 and the 16-PNG phase 7 README test) break if plain-task rendering or `populatedItems` change | MEDIUM | Ticket rendering only when `ticket_pr !== null`; every existing fixture has `ticket_pr: null`; new fixtures are new exports; phase 7 evidence switch and folder untouched |
| Approvals resource unreachable / not yet loaded makes a waiting card flicker or claim nothing | LOW | Absent data ⇒ no "waiting on you" (honest default); last-known keeps the resource's last data like the board |
| e2e screenshots need the built app and Electron binary | LOW | Follow `docs/evidence/phase-8-polish/playbooks/README.md`'s regenerate recipe (`npm run build`, env switch, `--workers=1`) |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-09-tasks-card-ticket-pr-approvals-ci-triage.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-09T08:08:25Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/244
- **Branch:** feature/tasks-card-ticket-pr-approvals-ci-triage
- **Files changed:** 23
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Ticket → PR card on the Tasks board and in its history (ticket source, PR state, approvals, CI, owner, waiting-on-you link to the pending merge approval), pr_state_changed sentences with session links, last-known ticket cards, no tally (kernel serves none), 10 phase 8 polish PNGs + README. Phase 4.5 review PASS first round; 2 LOW findings dismissed below the MEDIUM fix floor. risk_classification high_risk=true (size, token-word content); red-team lens not enabled.

## Not verified
- **tasks-ticket-pending and tasks-ticket-populated screenshots in dark theme** — written and asserted by the spec but not opened (subtask 1)
