# Supervisor Job: Crew members are told apart on screen, off members look off, and each Team card's task line is live

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-24-064605/L8
- **CLAUDE.md:** ✓ Found (fresh; its `kernel/` + `docs/` description predates `app/`, nothing it states is contradicted)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-24-115026-crew-members-are-told-apart-on-screen.md
- **Base commit:** 86265042f043827edf99daa14e0342a6816e2abe

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | App-only change: React 19 + strict TypeScript, vitest + Testing Library unit tests, Playwright e2e through `app/e2e/electron-harness.ts`. |
| 2 | Dependency Availability | GO | No new dependency and no kernel change. `GET /agents` gives each member's `status` (`RosterEntry.status` in `app/src/api/contract.ts`); `GET /sessions` gives each session's `agent` and `status` (`SessionSummary`), already a live-store resource (`sessions` in `app/src/store/resources.ts`, refetched on `session_` / `stop_` events); `isLive` / `LIVE_STATUSES` (`["starting", "running"]`) already exist in `app/src/screens/sessions/model.ts`. |
| 3 | Architecture Fit | GO | Invariant 3 holds: `display_name` and `id` stay untrusted text rendered as React text children. D34 holds: nothing deletes or hides an off member; its thread stays reachable. No kernel or contract file changes. |
| 4 | Scope vs Supervisor Capability | GO | Single subtask: one concern (who is on screen and what they are doing), ~12 app files, no file-conflict / context-bound / genuine-parallelism reason to split. |
| 5 | Hard Blockers | CAUTION | Root cause of the stale task line: `taskLineFor` (`app/src/screens/team/model.ts`) trusts a brain message's `status === "running"`, and the kernel leaves a row `running` whenever its session's end is never written back (`kernel/src/brain/handler.ts` `attachReply`: "the reply is then lost (the row stays `running`; documented as an honest limit)"). The fix here is the app reading the session, not the message status; the kernel row can still say `running`. See Risk Assessment. |

**Overall Verdict:** CAUTION (check 5; finding carried into Risk Assessment)

## Task

**Goal:** On Team, in the Crew sidebar and in a thread's header, two members with the same display name can be told apart by their id; off members look off in the Crew sidebar; and each Team card's task line comes from the agent's live session, so an idle agent never shows a killed request.

**Problem Statement:**
In the phase 5 live exit run, Team and the Crew sidebar showed two "Comment-only Reviewer" members (`phase4-exit-mvg8wle4cf8f26`, off, and `phase5-exit-1024`, active) with the same turtle and colour and nothing to tell them apart. The off one sat in the Crew sidebar unmarked. Wright's card showed "Write me a 5000-word short story…" after that session was killed and Wright was idle: `taskLineFor` picks the newest brain message with `status === "running"`, and that row was never moved off `running`.

Do three things (the requirement's Scope 1–3), plus the screenshots:

1. **The id when names collide** (Scope 1). Add to `app/src/screens/team/model.ts` an exported pure helper `sharedNames(agents: readonly { id: string; display_name: string }[]): ReadonlySet<string>` returning the ids of every roster entry (Wright included) whose name key equals another entry's. The key is one line, `const nameKey = (a: { readonly display_name: string }): string => a.display_name.trim().toLowerCase();`, and `.trim().toLowerCase()` appears nowhere else in `model.ts`. Where the id shows:
   - **Team card** (`TeamCard` in `app/src/screens/team/TeamView.tsx`): when the card's id is in the set, a line under `.card-name` — a **sibling** of `.card-name` inside `.card-heading`, never nested in it (the card's accessible name comes from `aria-labelledby={`${id}-name`}` and the unit `card()` helper matches `selector: ".card-name"` by exact text) — with class `card-id`, `data-testid="team-card-id"`, text exactly the agent id, styled muted mono (`font-family: var(--type-mono-family)`, the muted text token `team.css` already uses). Always (collision or not) the `.card-name` element carries `title={agent.id}`. The card's own `title` stays the role (the e2e AC2 pin "the full persona as the card's `title`" stays).
   - **Crew row** (`app/src/screens/chat/CrewSection.tsx`): same rule, a `<span className="chat-crew-id" data-testid="crew-id">` under the name in the row's text column; the row button always carries `title={agent.id}`. The row's `aria-label` becomes exactly `<display name>[ (<id>)][, unread][, off]`: ` (<id>)` only when the id is in the set (so the two buttons have distinct accessible names), `, unread` as today, `, off` for an off member (item 2). The `crew-id` span is a sibling of `.chat-crew-name`, never nested in it.
   - **Thread header** (`app/src/screens/chat/Thread.tsx`, the `chat-with` span "with {name}"): when the open agent's id is in the set, the span is followed by a muted mono `<span className="chat-with-id" data-testid="thread-id">` with the id; the `chat-with` span always carries `title={agent}`.
   Ids are untrusted text: rendered as React text children only.
2. **Off members look off** (Scope 2). In the Crew sidebar, members with `status === "off"` sort after every other member (stable: the kernel's order is kept inside each group), done by an exported comparator in `CrewSection.tsx` written on one line as `const offLast = (a: RosterEntry, b: RosterEntry): number => Number(a.status === "off") - Number(b.status === "off");` and applied as `[...crew].sort(offLast)` on its own line, the row gets the class `off` (dimmed in `chat.css` with the existing muted/disabled opacity convention, never `display: none` and never `disabled`), and the row shows the word `off` (`<span className="chat-crew-off" data-testid="crew-off">off</span>` in the top line). Clicking an off row still opens its thread (D34: threads stay readable).
3. **The current task is live** (Scope 3). Change `taskLineFor` to take the sessions list: `taskLineFor(agentId, approvals, messages, sessions, unread?)` where `sessions: readonly SessionSummary[] | undefined`. Order stays: a pending approval → `waiting` (needs approvals only); otherwise all three lists must be read or the line is `unknown`; then the agent's live sessions are, on one line, `const live = sessions.filter((s) => s.agent === agentId && isLive(s.status));` (`isLive` imported from `../sessions/model`). No live session → `{ state: "idle", text: "idle" }`, whatever the messages say. A live session → `working`, with text = the newest `running` message of the agent whose `session_id` is one of those live sessions' ids, else the fallback, on its own line, `` return { state: "working", text: `Session ${newestLive.id} running` }; `` (newest live = highest id). `TeamView` reads `useResource("sessions", api)` and folds a sessions refusal into `taskUnread` and the `team-tasks-error` alert the way approvals and messages already are (`sessions: <error>`).
4. **Wright proposing a distinct name** (Scope 4) is a kernel template change and is NOT done here. The PR body notes it as a follow-up (a note, not acceptance evidence).

Non-goals: renaming (exists) and deleting members (D34 keeps them); any kernel or `app/src/api/contract.ts` change; the Team cards' order (Wright first, then the kernel's order) stays unchanged — only the Crew sidebar sorts off members last.

## Acceptance Criteria

- [ ] **AC1 — ids when names collide.** Given a roster with two crew members of the same display name (`sharedNames` treats `"Comment-only Reviewer"` and `" comment-only reviewer "` as the same), then in `team.test.tsx` both Team cards render a `team-card-id` with their own id, a third member with a unique name renders none, and every `.card-name` has `title` = its id; and in `crew.test.tsx` both Crew rows render a `crew-id` with their own id, their accessible names differ (`<name> (<id>)`), and every row button has `title` = its id. In `thread.test.tsx`, the thread header of one of the two shows `thread-id` with its id, and a thread with a unique name shows none. A `sharedNames` unit test pins: no collisions → empty set; Wright counted; case and surrounding whitespace ignored.
- [ ] **AC2 — off members look off.** Given a roster `[wright, offA (off), b (active), offC (off), d (active)]`, then in `crew.test.tsx` the Crew rows are in the order `b, d, offA, offC`, each off row has the class `off` and a `crew-off` element reading `off`, its accessible name ends with `, off`, no active row has either, and clicking an off row navigates to its thread hash. (g) The existing test `avatar states: off reads killed, a pending approval reads waiting` (`crew.test.tsx:80-86`) finds the off Pim with `{ name: "Pim, off" }` instead of `{ name: "Pim" }` (line 83). Its "killed" and "waiting on you" assertions stay unchanged.
- [ ] **AC3 — the task line is live.** In `team.test.tsx`: (a) given Wright with a `running` brain message whose `session_id` names a session that `GET /sessions` reports `stopped` (killed), and no live session, then Wright's card task line is `idle` (`data-idle="true"`, text `idle`) and does not contain the message text; (b) given the same message with its session `running`, the line is `working` with the message text; (c) given a live session and no matching running message, the line is `working` with `Session <id> running`; (d) given `GET /sessions` refused, every card without a pending approval is `unknown` (`status unavailable`, never `idle`) and the tasks alert names `sessions:`; (e) the existing `taskLineFor` pins (lines ~379-386) are updated to the new signature and keep their meaning (waiting needs approvals only; unread lists never read as idle; add `taskLineFor("mason", [], running, undefined)` → `unknown`); (f) the existing tests that rely on a `running` message reading as `working` keep their assertions unchanged. Each test's running message is given a `session_id` (the `message()` helper defaults to `session_id: null`, `team.test.tsx:161`; e.g. `message({ …, session_id: 7 })`), and its `GET /sessions` answer includes `{ id: 7, agent: <the same agent>, status: "running" }`. The tests are: the working-dot test (~line 315) and the invariant-3 guard `renders kernel strings as text, never markup` (lines ~333-346, whose line ~342 asserts Mason's task line equals the hostile message text — never weaken or delete that assertion).
- [ ] **AC4 — e2e and polish-gate screenshots in a committed evidence file.** `app/e2e/fixtures/team.ts` serves `GET /sessions` (Wright's session 12 `running`, so the populated state stays `working`) and gains a collision roster variant (two crew members sharing a display name, plus the off Ada). A new `app/e2e/team.spec.ts` test launches the app through `launchApp` (never `electron.launch` / `new BrowserWindow`), asserts both colliding cards and both Crew rows show their ids and Ada's Crew row is last, dimmed (`off` class) and says off, then calls `screenshots(page, "told-apart", testInfo)`. With `TEAM_EVIDENCE=1` the worker commits `docs/evidence/phase-5-polish/team/team-told-apart-light.png` and `team-told-apart-dark.png`, and adds a row for them (plus the AC3 note: a killed session reads idle) to the screenshots table in `docs/evidence/phase-5-polish/team/README.md`. The PR body links that README.
- [ ] **AC5 — validation.** `cd app && npm ci && npm run typecheck && npm test && npm run build` passes, and `cd app && npx playwright test e2e/team.spec.ts --workers=1` passes after the build.

## File Impact Map

| File | Action | Confidence | Why |
|------|--------|------------|-----|
| `app/src/screens/team/model.ts` | modify | HIGH | `sharedNames`; `taskLineFor` gains the sessions list (imports `isLive` from `../sessions/model`, `SessionSummary` from the contract). |
| `app/src/screens/team/TeamView.tsx` | modify | HIGH | `useResource("sessions", api)`; sessions into `taskOf` / `taskUnread` / `tasksFailed`; `TeamCard` gets an `idShown` prop for the `card-id` line and the `.card-name` `title`. |
| `app/src/screens/team/team.css` | modify | HIGH | `.card-id` muted mono style. |
| `app/src/screens/team/team.test.tsx` | modify | HIGH | The fake (`GET /sessions` route beside `GET /messages`, line ~215); AC1 card and `sharedNames` tests; AC3 tests; the existing `taskLineFor` pins (lines ~379-386), the working-dot test (line ~315) and `renders kernel strings as text, never markup` (lines ~333-346) updated for sessions (AC3(e)/(f)). |
| `app/src/screens/chat/CrewSection.tsx` | modify | HIGH | Off-last sort, `off` class and word, `crew-id`, row `title`, aria-label. |
| `app/src/screens/chat/chat.css` | modify | HIGH | `.chat-crew-row.off` dimming, `.chat-crew-off`, `.chat-crew-id`, `.chat-with-id`. |
| `app/src/screens/chat/crew.test.tsx` | modify | HIGH | AC1 Crew-row and AC2 tests; the existing `avatar states: off reads killed, a pending approval reads waiting` (lines 80-86) queries `{ name: "Pim, off" }` (AC2(g)). |
| `app/src/screens/chat/Thread.tsx` | modify | MEDIUM | Thread header id (Scope 1 names the thread header; not in the requirement's Touches). |
| `app/src/screens/chat/thread.test.tsx` | modify | MEDIUM | AC1 thread-header test. |
| `app/e2e/fixtures/team.ts` | modify | HIGH | `GET /sessions` route; collision roster variant. |
| `app/e2e/team.spec.ts` | modify | HIGH | AC4 test and the `told-apart` screenshots. |
| `docs/evidence/phase-5-polish/team/README.md` | modify | HIGH | AC4 row for the new screenshots. |
| `docs/evidence/phase-5-polish/team/team-told-apart-light.png` | create | HIGH | AC4 screenshot (light). |
| `docs/evidence/phase-5-polish/team/team-told-apart-dark.png` | create | HIGH | AC4 screenshot (dark). |

Verified unaffected: `app/src/screens/chat/testkit.tsx` (Crew rows read no sessions; no route needed); `app/src/screens/chat/model.ts` `agentAvatarState` (already reads `status === "off"` as `danger`, unchanged); `app/src/api/contract.ts` and `app/src/store/resources.ts` (the `sessions` resource exists); `taskLineFor`'s only callers are `TeamView.tsx` and `team.test.tsx`.

### File Overlap Detection
Single subtask; no overlap.

## Touched-file invariants

> Grounded at base `8626504`. The worker re-checks these before hand-back.

- **`app/src/screens/team/model.ts`** — keep: `TASK_LOADING = "checking status…"` and `TASK_UNAVAILABLE = "status unavailable"`; the rule in `taskLineFor`'s doc ("A state is shown only when the lists it depends on were read … never "idle"") now covers sessions too; the waiting branch (`Waiting on you · ${what}`, newest pending approval by id, `display` else `action`) unchanged; "Nothing in this file builds markup" (no JSX). pinned by: `team.test.tsx` (`taskLineFor claims a state only from the lists it was read from`).
- **`app/src/screens/team/TeamView.tsx`** — keep: card `title={role}` and `aria-labelledby={`${id}-name`}`; `data-testid="team-card"`, `team-card-task`, `data-idle` / `data-unknown`; the `team-tasks-error` alert text prefix `Couldn't read what the agents are doing (`. pinned by: `app/e2e/team.spec.ts` AC1/AC2 (full persona as the card's `title`), `team.test.tsx` (`a refused GET /messages still shows a pending approval as waiting; every other card is unavailable, never idle`).
- **`app/src/screens/team/team.css`** (and **`app/src/screens/chat/chat.css`**) — keep: no `outline: none` / `outline: 0` anywhere; new rules use tokens only (`var(--type-mono-family)`, the muted text token the file already uses), no raw colours. pinned by: `team.test.tsx` (`team.css never removes the focus ring`, which reads the file via `read("team.css")`).
- **`app/src/screens/chat/CrewSection.tsx`** — keep: Wright never under Crew (`specialists`); the name stays `<display name>[, unread]` at the start of the accessible name ("it must never start with a screen's name"); `aria-describedby` time + last line; `data-agent={agent.id}`; the ⌘K `registry.register("chat", commands)` effect. pinned by: `crew.test.tsx` (`Wright is never under Crew`, `a row's name is its agent, and its time and last line are its description`).
- **`app/src/screens/chat/Thread.tsx`** — keep: `with {name}` text and the `StatusDot` chip in `.chat-titlerow`; `nameOf` unchanged. pinned by: `thread.test.tsx`.
- **`app/e2e/team.spec.ts`, `app/e2e/fixtures/team.ts`** — keep: every launch through `launchApp` / `launchGallery` (house rule; `app/scripts/hidden-windows.test.ts`); screenshots only via `screenshots()` (evidence dir only with `TEAM_EVIDENCE=1`); fixture data stays under `/srv/studio-fixture`, no real path; the default roster (Wright, Mason, Ada) and existing tests unchanged — the collision roster is an opt-in variant.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `team.test.tsx` — AC3(a): killed session reads idle | flip `&& isLive(s.status)` → `` in `app/src/screens/team/model.ts` |
| `team.test.tsx` — AC3(c): live session, no matching message → `Session <id> running` | flip `` `Session ${newestLive.id} running` `` → `"working"` in `app/src/screens/team/model.ts` |
| `team.test.tsx` — AC3(b)/(f): running message on a live session reads `working` with its text | flip `return { state: "working", text: message.text }` → `return { state: "working", text: "working" }` in `app/src/screens/team/model.ts` |
| `team.test.tsx` — AC3(d) + AC3(e) unread sessions → `unknown` | flip `sessions === undefined` → `false` in `app/src/screens/team/model.ts` |
| `team.test.tsx` — AC3(d): the tasks alert names `sessions:` | flip `` `sessions: ${errorText(sessionsError)}` `` → `` `messages: ${errorText(sessionsError)}` `` in `app/src/screens/team/TeamView.tsx` |
| `team.test.tsx` — AC1: colliding cards show `team-card-id`; `sharedNames` unit pins | flip `a.display_name.trim().toLowerCase();` → `a.display_name.trim().toLowerCase() + Math.random();` in `app/src/screens/team/model.ts` (`nameKey`) |
| `team.test.tsx` — AC1 `sharedNames`: case and whitespace ignored | flip `a.display_name.trim().toLowerCase();` → `a.display_name;` in `app/src/screens/team/model.ts` (`nameKey`) |
| `team.test.tsx` — AC1: `.card-name` carries `title` = id | flip `title={agent.id}` → `title={agent.display_name}` in `app/src/screens/team/TeamView.tsx` |
| `crew.test.tsx` — AC1: Crew rows show `crew-id` | delete `data-testid="crew-id"` in `app/src/screens/chat/CrewSection.tsx` (the span is written on one line) |
| `crew.test.tsx` — AC1: distinct accessible names `<name> (<id>)` | flip `` ` (${agent.id})` `` → `""` in `app/src/screens/chat/CrewSection.tsx` |
| `crew.test.tsx` — AC1: row button `title` = id | flip `title={agent.id}` → `title={agent.display_name}` in `app/src/screens/chat/CrewSection.tsx` |
| `thread.test.tsx` — AC1: thread header shows `thread-id` | delete `data-testid="thread-id"` in `app/src/screens/chat/Thread.tsx` (the span is written on one line) |
| `crew.test.tsx` — AC2: off rows sort last | flip `[...crew].sort(offLast)` → `[...crew]` in `app/src/screens/chat/CrewSection.tsx` |
| `crew.test.tsx` — AC2: off row has the `off` class | flip `" off"` → `""` in `app/src/screens/chat/CrewSection.tsx` (the class suffix literal) |
| `crew.test.tsx` — AC2: off row says off | delete `<span className="chat-crew-off" data-testid="crew-off">off</span>` in `app/src/screens/chat/CrewSection.tsx` |
| `crew.test.tsx` — AC2: accessible name ends `, off` | flip `", off"` → `""` in `app/src/screens/chat/CrewSection.tsx` |
| `app/e2e/team.spec.ts` — AC4 told-apart test | the same mutations as the `crew-id`, `team-card-id` and sort rows above (e2e runs against the build; the worker runs it once by hand with the `[...crew].sort(offLast)` flip and records the result) |

Each mutation literal must stay on one source line so `scripts/run-pin-mutations.sh` can apply it: write `" off"` (class suffix), `", off"` (aria suffix), `` ` (${agent.id})` `` (aria id suffix), `title={agent.id}` (`.card-name`), the `crew-id` / `thread-id` spans, the `live` filter, the `Session ${newestLive.id} running` fallback, `return { state: "working", text: message.text }`, the `sessions === undefined` check in `taskLineFor`'s unread guard, and `` `sessions: ${errorText(sessionsError)}` `` each as one literal on one line.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Ids on name collisions, off members look off, live task line; screenshots | AC1, AC2, AC3, AC4, AC5 | 12 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "app/src/screens/team/model.ts", name: "sharedNames"}
  - {kind: "symbol", path: "app/src/screens/team/model.ts", name: "taskLineFor"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/team/team-told-apart-light.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/team/team-told-apart-dark.png"}
requires: []
lanes:
  - "app/src/screens/team/model.ts"
  - "app/src/screens/team/TeamView.tsx"
  - "app/src/screens/team/team.css"
  - "app/src/screens/team/team.test.tsx"
  - "app/src/screens/chat/CrewSection.tsx"
  - "app/src/screens/chat/chat.css"
  - "app/src/screens/chat/crew.test.tsx"
  - "app/src/screens/chat/Thread.tsx"
  - "app/src/screens/chat/thread.test.tsx"
  - "app/e2e/fixtures/team.ts"
  - "app/e2e/team.spec.ts"
  - "docs/evidence/phase-5-polish/team/README.md"
  - "docs/evidence/phase-5-polish/team/team-told-apart-light.png"
  - "docs/evidence/phase-5-polish/team/team-told-apart-dark.png"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
1 (no dependencies)

### File Overlap Matrix
Single subtask; none.

### Batch Plan
- single-agent (no fan-out): Batch 1 = subtask 1
- **Recommended workers:** 1

## Skill References
- `skills/unit-testing/SKILL.md` — vitest + Testing Library pins
- `skills/frontend-ui/SKILL.md` — design tokens only (muted, mono), accessible names, no colour-only state (the `off` word, not just dimming)
- `skills/playwright-e2e/SKILL.md` — the fixture-kernel spec and screenshots

## House Rules
- (advisory) E2E specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts` enforces it). AC4 complies.

## Risk Assessment

| Risk | Severity | Source | Mitigation |
|------|----------|--------|------------|
| The kernel can leave a brain message `running` after its session ended (`attachReply` lost write; the live run's killed request). The app fix reads the session, so the card is honest; the message row itself still says `running` (the thread may still show "is working on it"). | MEDIUM | Feasibility (Phase 2.5) | The task line no longer trusts message status alone (AC3). The kernel-side row repair is out of this item's Touches; the PR body names it as a follow-up beside Scope 4. |
| `GET /sessions` returns the newest 50 sessions by default; a live session older than 50 newer ones would be missed. | LOW | Analysis (Phase 3) | Live sessions are the newest rows in practice (`ORDER BY s.id DESC`); documented in `taskLineFor`'s doc comment. |
| Screenshots differ between macOS and CI fonts. | LOW | Analysis (Phase 3) | The spec asserts behaviour, never pixels (existing convention); committed PNGs come from `TEAM_EVIDENCE=1` on macOS. |
| `Thread.tsx` is outside the requirement's Touches. | LOW | Requirement Scope 1 | Scope 1 names the thread header; the change is one span and a `title`. |
| Showing ids adds an untrusted string to the UI. | LOW | Invariant 3 | React text children only; no `dangerouslySetInnerHTML`, no markup built from ids. |

## Plan Review
- **Status:** PASS (attempt 3/3; attempts 1 and 2 also PASS, and their MEDIUM/LOW issues were refined)
- **Deferred (MEDIUM, at the fix floor, attempts exhausted):** AC3(f)'s list also needs the test `the inspector header avatar` > `carries the card's state: waiting on you for a pending approval, working for a running message` (`team.test.tsx` ~707-721). Give its Wright message `session_id: 7` and add `{ id: 7, agent: "wright", status: "running" }` to its `GET /sessions` answer. Keep the `"Wright · working"` assertion (line ~720) unchanged.

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-24-crew-members-are-told-apart-on-screen.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-24T16:08:17Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/132
- **Branch:** feature/crew-members-are-told-apart-on-screen
- **Files changed:** 14
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** sharedNames ids on colliding Team cards / Crew rows / thread header; off crew sorted last, avatar dimmed, labelled off; taskLineFor reads live sessions so a killed request reads idle. Every review PASSed (no HIGH/BLOCKING); 5 MEDIUM findings fixed across 3 iterations (aria-describedby id, AA contrast on off rows, newest-50 limit documented and its follow-up named as status.sessions). The final iteration's doc-only fix (b1a185d) was not re-reviewed. Drain not dispatched (.supervisor/config.json auto_review: false). guard: armed.

## Not verified
- **Chat thread header thread-id in the built Electron app** — covered by thread.test.tsx (jsdom) only; no e2e opens #/chat/<colliding id> (subtask 1)
