# Supervisor Job: 27b — A handover never queues a ticket that is gone

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-27/2026-11-24-140100-27b-a-handover-never-queues-a-ticket-that-is-gone.md
- **Base commit:** 98db9d8d77f107e2a03e19e314114df7c7b71ac1

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest) and the React app (vitest); no new stack |
| 2 | Dependency Availability | GO | No new dependency. The poll fetch (`fetchPollItems`, `kernel/src/triggers/poll.ts`), the GitHub client (`createRepoPolicyClient`, `kernel/src/integrations/github/repo-policy.ts`) and the append-only `events` table already exist |
| 3 | Architecture Fit | GO | Mechanism only: the kernel re-reads each playbook's OWN poll filter; it sets no filter. The kernel records "retired" in its own store and never edits or moves Loomwright's run file (invariant 4) |
| 4 | Scope vs Supervisor Capability | CAUTION | 15 files (11 modify, 4 create) is over the 12-file bound: split `context-bound` into 2 sequential subtasks |
| 5 | Hard Blockers | CAUTION | Retire needs files outside the requirement's Touches (owner chose "Retire on the Parked run card", LP-CLARIFY 2026-11-25); asked once at Phase 6 (`LP-SCOPE`) |

**Overall Verdict:** CAUTION

## Task
**Goal:** At each handover, carry an earlier backlog line only while its ticket is still open and still listed by its playbook's poll filter, say what was dropped and why, and give the owner a Retire action on the Parked run card so an old run's unfinished items stop being carried without anyone moving a file.

**Problem Statement:**
The owner needs a new `/automate` run to build the tickets just handed over, not a closed issue or an untagged task from an old run.
Currently the 23i carry rule (`kernel/src/automate/tickets-to-items.ts` header, "The backlog keeps what earlier handovers listed (phase 8 item 23i)") keeps an earlier line when the kernel wrote it, its item file exists, Loomwright has not stamped it finished, and no run file names it. Nothing asks whether the ticket is still open or still matches the playbook's filter. On the 2026-11-24 walk (run `20261124-133823`) the backlog carried issue #21 (closed `not planned`) and ClickUp 86bd5gdbq (its `studio-sandbox` tag removed), and the run picked #21 first. The owner had moved the 11-20 run file into an archive folder by hand, because there is no supported way to retire a run.
Success looks like: the handover drops a closed or off-filter ticket and names it with a reason, keeps a ticket whose source can't be read as `unverified`, and the owner retires a run from the Tasks screen. No file is moved by hand.

## Design decisions
- decision: How the kernel learns, at handover, whether an earlier ticket is still open and still matches its playbook's filter (T2: creates `kernel/src/automate/carry-check.ts`)
  chosen: Re-run the playbooks' own `poll` triggers of the ticket's source through the existing `fetchPollItems` (the same fetch a due poll makes, so the filter is the owner's own policy). A ticket that every relevant listing reads completely, with none listing it, is dropped. For a GitHub issue, one closed-state probe over the same client's `listIssues(repo, {state: "closed"})` tells `ticket_closed` apart from `filter_no_longer_matches`. A new module, because `tickets-to-items.ts` stays free of store, trigger and client imports (its header: "never the Agent SDK, the session manager or `kernel.ts`"; it imports only `node:` builtins plus its siblings `./run-state.js` and `./text-rules.js`), while the check needs the store, the trigger specs and the clients. It reuses the connector gating of `previewPoll` (`kernel/src/playbooks/dry-run-poll.ts`): `mcpConnectorGate` for a ticket source and `githubConnectorState` for GitHub. A source whose connection is not open maps to `unverified` with no fetch
  rejected: The playbook session passes the still-open refs as a new tool argument. Blast radius `no`: the policy would move into model text the kernel can't check (invariant 3), and legacy backlog lines would have no answer.
  rejected: Add a single-issue `getIssue` read to the GitHub client. Blast radius `no`: it touches `client.ts` and `types.ts`, and `listIssues` already answers the closed-state question.
  evidence: `kernel/src/playbooks/dry-run-poll.ts` already runs one playbook poll read-only through the same fetch (`import { fetchPollItems, githubConnectorState, parsePollSpec } from "../triggers/index.js";`), but it answers "what would this poll queue", not "is ticket X still listed". `export async function fetchPollItems(github: GitHubClient | undefined, spec: PollSpec, tickets: McpTicketReader = createMcpTicketReader(), store?: Store): Promise<Fetched>` (`kernel/src/triggers/poll.ts`). `listIssues(repo: string, filters: GitHubIssueFilters)` (`kernel/src/integrations/types.ts`). `export function createRepoPolicyClient(): GitHubClient & GitHubRepoPolicyReads` (`kernel/src/integrations/github/repo-policy.ts`). The live sandbox items carry `- link: https://github.com/<owner>/<sandbox-repo>/issues/<n>` and `- link: https://app.clickup.com/t/<task-id>`, and their dedupe refs differ in form (`<owner>/<sandbox-repo>#<n>` vs `clickup:<task-id>`), so matching uses the link.
  revisit when: A ticket source gets a cheap per-ticket state read in the kernel, or a playbook's tickets come from something other than a poll trigger.
  status: confirmed
- decision: The supported way to retire an old run so its unfinished items are not carried (T2: creates `kernel/src/automate/retired-runs.ts`)
  chosen: A Retire action beside Resume and Reply on the Tasks screen's Parked run card (owner's choice, LP-CLARIFY 2026-11-25). `POST /automate/paused-runs/:run_id/retire` appends one `automate_run_retired` event to the kernel's own append-only `events` table, holding the checkout, the run id and the studio item names the run file names at that moment. The kernel never edits, moves or deletes Loomwright's run file. A retired run is no longer listed or resumable, and the carry rule never carries its items (reason `run_retired`), even after the file is later archived or removed.
  rejected: Document Loomwright's AUT-RESUME `Archive` and read archived run files one folder down. Lock-in `no`: Loomwright 18.1.2 defines no archive location (`automate-next-step.sh`: "Archive / Start new are reported back as a `done` choice and carried out by the model").
  rejected: The kernel moves the run file into an archive folder. Rejected on invariant 4: the run file is Loomwright's.
  evidence: The owner answered LP-CLARIFY "Retire on Parked card". `kernel/src/gui/paused-runs.ts` already serves the card's owner routes ("It lives here, not under `automate/`, which holds no write route"). The `events` table is append-only (`events_no_update` trigger, `kernel/src/store/integrity.ts`), so it needs no migration.
  revisit when: Loomwright ships a mechanical archive for run files, or the kernel needs to retire a run that is not paused or stranded.
  status: confirmed

## Acceptance Criteria
- [ ] AC1 — Given an earlier backlog line whose ticket is now closed (a GitHub issue that no relevant `github.issues` poll lists and the closed-state probe finds), or no longer matches its playbook's filter (a ClickUp task that no relevant `clickup.tasks` poll lists, for example after its polled tag was removed), when a handover (`kernel_automate_prepare`) rewrites the backlog, then that line is not carried, and the answer's `dropped` names each one as `{item, ref, reason}` with reason `ticket_closed` or `filter_no_longer_matches`.
- [ ] AC2 — Given the ticket source cannot be read at handover time (no relevant poll trigger, no usable GitHub client or tracker connection, a fetch failure, or a listing cut at `MAX_POLL_ITEMS` so absence is not proven), when a handover rewrites the backlog, then the line is kept in its place and the answer's `unverified` names it. The rule fails toward keeping work and never silently drops.
- [ ] AC3 — Given a paused or stranded run on the Tasks screen's Parked run card, when the owner presses **Retire**, then `POST /automate/paused-runs/:run_id/retire` (body exactly `{agent, checkout}`) records one `automate_run_retired` event, the run is no longer listed by `GET /automate/paused-runs` nor resumable (Resume answers 404), and its unfinished items are not carried by any later handover (`dropped` reason `run_retired`). This holds even after the run file is moved or removed. No file under `.supervisor/automate/` is written, moved or deleted by the kernel. A run that is live or has a resume or continuation queued is refused (409).
- [ ] AC4 — Given the kernel test suite, when `cd kernel && npm test` runs, then tests cover: a closed issue dropped (`ticket_closed`); an untagged ClickUp task dropped (`filter_no_longer_matches`); an unreadable source kept as `unverified`; an open matching ticket kept in place (order unchanged); a ticket handed over again in the same call never dropped; a retired run's items not carried (`run_retired`). The 23i tests in `kernel/test/automate-runner.test.ts` stay green unchanged.
- [ ] AC5 — Given the app suite, when `cd app && npm test` and `npm run typecheck` run, then the Parked run card shows a Retire button that posts the body exactly `{agent, checkout}`, is disabled while offline or while the run is `run_live`, `resume_queued` or `continuation_queued`, and shows a refusal in the card. The kernel's `console-contract` test lists the new route under origin `p8-item-27`.

## Scope widening
- /automate/paused-runs/:run_id/reply
- app/src/api/contract.ts
- app/src/screens/tasks/ParkedRunCard.test.tsx
- app/src/screens/tasks/ParkedRunCard.tsx
- app/src/screens/tasks/TasksScreen.tsx
- app/src/screens/tasks/TasksViews.tsx
- kernel/src/automate/carry-check.ts
- kernel/src/automate/retired-runs.ts
- kernel/src/gui/paused-runs.ts
- kernel/test/automate-carry-check.test.ts
- kernel/test/automate-retire.test.ts
- kernel/test/console-contract.test.ts
- accepted: LP-SCOPE 2026-11-25

## Touched-file invariants

> Grounded at base `98db9d8d77f107e2a03e19e314114df7c7b71ac1`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/automate/tickets-to-items.ts`** — keep: no store, trigger or client import. The header line reads `only \`node:\` builtins: never the Agent SDK, the session manager or \`kernel.ts\`.`. The store, triggers and clients stay out of this file, and the verdicts arrive as plain data from the runner. `writeTicketItems` stays synchronous. Keep the 23i read-before-write order: `// 23i: what earlier handovers listed stays, ahead of this one; read before anything is written.`. Keep the run-file rule: `if (runs.some((text) => text.includes(\`${STUDIO_ITEMS_DIR}/${name}\`))) continue;`. Reuse: `KEPT_LINE`, `isFinished`, `earlierItems` (extend it, never a second backlog parser). Read an item's ref and link from the `renderItem` lines `- dedupe ref:` and `- link:` only. pinned by: `kernel/test/automate-runner.test.ts` — `23i: a ticket handed over again keeps its place and is listed once; it is not 'carried'`.
- **`kernel/src/automate/runner.ts`** — keep: every handler starts with `const session = liveSession(ctx);`. The answer keeps `run: "started_by_kernel",`, and no ticket text goes in the queued event. Keep the import rule "never the Agent SDK, the session manager or `kernel.ts`" (`features/index.js` must still load without the SDK: `kernel/test/feature-seams.test.ts` "the feature registry's module graph (AC9)"). Mirror: the answer's new `dropped` / `unverified` fields match `PreparedTickets`.
- **`kernel/src/gui/paused-runs.ts`** — keep: owner write routes live here ("which holds no write route" — `automate/` gets none). The new route joins `export const resumeRoutes: readonly ContributedRoute[]`. Mirror the Resume route's re-read-the-list-then-act shape and its 400/404/409 codes. pinned by: `kernel/test/automate-resume.test.ts` `describe("POST /automate/paused-runs/:run_id/resume (23j)"`.
- **`app/src/api/contract.ts`** and **`kernel/test/console-contract.test.ts`** — mirror: one `CONTRACT_ROUTES` entry per line, exactly the shape `{ method: "POST", path: "/automate/paused-runs/:run_id/reply", origin: "d42" },` (the test parses it with `ENTRY_LINE`). The test's served-routes pin `expect(servedBy("p8-item-23")).toEqual(["GET /automate/paused-runs", "POST /automate/paused-runs/:run_id/resume"]);` stays as it is, and a sibling pin for `p8-item-27` is added.
- **`app/src/screens/tasks/ParkedRunCard.tsx`**, **`TasksViews.tsx`**, **`TasksScreen.tsx`** — reuse: Retire mirrors `export async function resumePausedRun(` (body exactly `{agent, checkout}`). It is wired the way `readonly onResume?: (run: PausedRunView) => Promise<ApiResult<unknown>>;` and `const result = await resumePausedRun(api, run);` are.
- **`docs/evidence/phase-8-exit-runbook.md`** — keep: every walk-table row stays on its single `| N. ` line (the test parses rows with `/^\| (\d+)\. /`). Step 1's row keeps the words `PR A` and `single-open-PR` and never says "two PRs". Add the walk-step-1 backlog expectation inside that one row, or as prose outside the table. pinned by: `kernel/test/phase-8-walk-order-probe.test.ts` — `R1: step 1 opens PR A only, and step 5 resumes the run before PR B` (`expect(row(1)).toContain("single-open-PR");`, `expect(row(1)).not.toMatch(/two PRs/i);`); it reads the runbook through `const RUNBOOK = join(REPO_ROOT, "docs", "evidence", "phase-8-exit-runbook.md");`.
- **`kernel/src/triggers/poll.ts`** (read, not modified) — mirror: `return { ok: true, items: fetched.items.slice(0, MAX_POLL_ITEMS), found: fetched.items.length };`. When `found > items.length` the listing was cut, so a missing ticket there is `unverified`, never dropped.

## Closed enumerations touched

> Sibling grep at base `98db9d8d`: `grep -rnF '"p8-item-23"' --exclude=CHANGELOG.md kernel app/src docs` → 8 hits in 2 files (`contract.ts` 56, 173, 174; `console-contract.test.ts` 179, 180, 263, 264, 280). `grep -rnF 'run_declared_checks' --exclude=CHANGELOG.md kernel/src app/src` → hits in `launch.ts`, `declared-checks.ts`, `audit-sentences.test.ts`.

- **`p8-item-27`** (sibling: `p8-item-23`) — must be named in:
  - `app/src/api/contract.ts` — the origin union (`| "p8-item-23"`) and `CONTRACT_ROUTES` — extend.
  - `kernel/test/console-contract.test.ts` — all three lists: the `CONTRACT_ROUTES` mirror (lines 179–181), the phase-8 origin/route pair list checked with `toEqual` (lines 263–264), and a new `servedBy("p8-item-27")` pin beside line 280. The served-routes test title ("… and item 23's two (the paused-runs Resume) …") names item 27's one route too — extend.
- **`automate_run_retired`** (sibling event kind: `run_declared_checks`) — must be named in:
  - `kernel/src/automate/retired-runs.ts` — its one writer and reader — create.
  - `app/src/screens/budget/audit-sentences.ts` — no change: an unknown kind renders the fixed fallback ("an unknown kind … reads "{kind} · {NO_DESCRIPTION}"").
  - `kernel/src/loop/types.ts` `EVENT_KINDS` — no change: it closes the QUEUE's kinds (`["wakeup", "message"]`), not the `events` log's.
- **`ticket_closed` · `filter_no_longer_matches` · `run_retired`** (a new closed set, no sibling): defined once as an exported `CARRY_DROP_REASONS` in `kernel/src/automate/carry-check.ts` and named in `docs/architecture/automate.md`.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/automate-carry-check.test.ts` — closed issue dropped `ticket_closed` | flip `ticket_closed` → `filter_no_longer_matches` in `kernel/src/automate/carry-check.ts` |
| `kernel/test/automate-carry-check.test.ts` — listing cut at MAX_POLL_ITEMS is `unverified` | delete the `found` vs `items.length` comparison line in `kernel/src/automate/carry-check.ts` |
| `kernel/test/automate-retire.test.ts` — retired run not listed | delete the retired-run filter line in `listPausedRuns` in `kernel/src/gui/paused-runs.ts` |
| `kernel/test/automate-carry-check.test.ts` — untagged ClickUp task dropped `filter_no_longer_matches` | flip the ClickUp drop verdict `filter_no_longer_matches` → `keep` in `kernel/src/automate/carry-check.ts` |
| `kernel/test/automate-carry-check.test.ts` — unreadable source kept `unverified` | flip the failed-fetch verdict `unverified` → `filter_no_longer_matches` in `kernel/src/automate/carry-check.ts` |
| `kernel/test/automate-carry-check.test.ts` — open matching ticket kept in place | delete the `keep` return when a listing holds the ticket in `kernel/src/automate/carry-check.ts` |
| `kernel/test/automate-carry-check.test.ts` — ticket handed over again never dropped | delete the `handed` skip in the drop loop of `writeTicketItems` in `kernel/src/automate/tickets-to-items.ts` |
| `kernel/test/automate-carry-check.test.ts` — retired run's items dropped `run_retired` | delete the `retired` check in `writeTicketItems` in `kernel/src/automate/tickets-to-items.ts` |
| `kernel/test/automate-carry-check.test.ts` — handler answers `dropped` / `unverified` | delete the `dropped` field of the `kernel_automate_prepare` answer in `kernel/src/automate/runner.ts` |
| `kernel/test/automate-retire.test.ts` — Resume answers 404 after a retire | delete the retired-run filter line in `listPausedRuns` in `kernel/src/gui/paused-runs.ts` (the same line as the list pin) |
| `kernel/test/automate-retire.test.ts` — 409 on `run_live` / `resume_queued` / `continuation_queued` | delete the 409 branch of the retire route in `kernel/src/gui/paused-runs.ts` |
| `kernel/test/automate-retire.test.ts` — run file unchanged and not moved | (no code to mutate: the route never writes the file; the pin guards a future write, so a mutation adding `writeFileSync` to the run file there must turn it red) |
| `kernel/test/automate-retire.test.ts` — later prepare drops retired items after the run file is deleted | flip `retiredItemNames(store, checkout)` → `new Set()` in the `kernel_automate_prepare` handler in `kernel/src/automate/runner.ts` |
| `app/src/screens/tasks/ParkedRunCard.test.tsx` — Retire posts exactly `{agent, checkout}` | flip `checkout: run.checkout` → `checkout: ""` in `retirePausedRun` in `app/src/screens/tasks/ParkedRunCard.tsx` |
| `app/src/screens/tasks/ParkedRunCard.test.tsx` — Retire disabled while offline / live / queued | delete the `disabled` expression of the Retire button in `app/src/screens/tasks/ParkedRunCard.tsx` |
| `kernel/test/phase-8-walk-order-probe.test.ts` — R1 step 1 row (existing pin, must stay green) | (unchanged pin: the runbook edit must keep it green; no new mutation) |
| `kernel/test/console-contract.test.ts` — `servedBy("p8-item-27")` lists the retire route | delete the retire entry from `resumeRoutes` in `kernel/src/gui/paused-runs.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Verify carried tickets against their playbooks' polls; retired-run reader | AC1, AC2, AC4 (all but the route) | 2 modify, 3 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | Retire on the Parked run card (route, app, docs) | AC3, AC4 (retire route), AC5 | 9 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md` | BLOCKED (by #1) |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| carry (1) | `kernel/src/automate/tickets-to-items.ts` (340), `kernel/src/automate/runner.ts` (297) | `kernel/src/automate/carry-check.ts`, `kernel/src/automate/retired-runs.ts`, `kernel/test/automate-carry-check.test.ts` | HIGH |
| retire (2) | `kernel/src/gui/paused-runs.ts` (325), `app/src/api/contract.ts` (2140 — the single authority for the API contract; one route entry and its types), `kernel/test/console-contract.test.ts` (416), `app/src/screens/tasks/ParkedRunCard.tsx` (284), `app/src/screens/tasks/ParkedRunCard.test.tsx` (274), `app/src/screens/tasks/TasksViews.tsx` (355), `app/src/screens/tasks/TasksScreen.tsx` (471), `docs/architecture/automate.md` (271), `docs/evidence/phase-8-exit-runbook.md` (201) | `kernel/test/automate-retire.test.ts` | HIGH (app wiring MEDIUM) |

**Module layout (homes):** the ticket check is its own module, `carry-check.ts`, because `tickets-to-items.ts` must stay node-only. The retire record (write and read of `automate_run_retired`) is `retired-runs.ts`, one home for both the route and the carry rule. The new tests go in new files: `kernel/test/automate-runner.test.ts` is 564 lines, at the 500 threshold, so it gets no new tests. `contract.ts` (2140) gets only its one route entry and types (one-line reason above).

### What each subtask does

**Subtask 1.**
- `retired-runs.ts` exports `RUN_RETIRED_EVENT = "automate_run_retired"`, `recordRunRetired(store, {checkout, run_id, items}, at)` (via `appendEvent` from `../loop/internal.js`; `items` bounded by `MAX_BACKLOG_ITEMS`), `retiredRunIds(store, checkout)` and `retiredItemNames(store, checkout)`. The reads parse `payload_json` defensively: a malformed row is ignored, never thrown.
- `tickets-to-items.ts` exports `earlierCandidates(checkout)`, the names `earlierItems` keeps, each with the `ref` and `link` its item file's `- dedupe ref:` / `- link:` lines hold (`null` when absent).
- `writeTicketItems(checkout, repo, tickets, carry?)` takes `carry = {verdicts: ReadonlyMap<name, "keep" | "unverified" | CarryDropReason>, retired: ReadonlySet<name>}`:
  - a name in `retired` → dropped `run_retired`;
  - a drop verdict → dropped with that reason;
  - `unverified`, or a name with no verdict (it appeared after the check) → kept and listed in `unverified`;
  - a name this call hands over again → never dropped.
- `PreparedTickets` gains `dropped: readonly {item, ref, reason}[]` and `unverified: readonly string[]` (repo-root-relative item paths, like `carried`). With no `carry` argument, the behaviour is byte-identical to today.
- `carry-check.ts` exports `CARRY_DROP_REASONS` and `async verifyCarried(store, candidates, deps?)`:
  - It finds the ticket's source from its link (`https://github.com/<o>/<r>/issues/<n>` → `github.issues` polls whose `repos` include `<o>/<r>` case-insensitively; `https://app.clickup.com/t/<id>` → `clickup.tasks` polls). The relevant triggers are `triggers` rows of kind `poll` linked to a playbook; their spec is parsed with `parsePollSpec`.
  - It fetches each relevant trigger once per call with `fetchPollItems`.
  - A ticket counts as listed when an item's `url` equals the link, or its `ref` equals `github:<o>/<r>#<n>` / `clickup:<id>`.
  - A ticket that any listing has → `keep`.
  - No relevant trigger, an unknown link form, any failed fetch, or a cut listing (`found > items.length`) without a match → `unverified`.
  - Otherwise GitHub → `ticket_closed` when `listIssues(repo, {state: "closed"})` holds the number, else `filter_no_longer_matches` (a failed probe → `filter_no_longer_matches`); ClickUp → `filter_no_longer_matches`.
  - `deps = {github?: () => GitHubClient | undefined, tickets?: McpTicketReader}`. The default GitHub client is `createRepoPolicyClient()` only when `githubConnectorState(store).usable`.
  - It reads only: no write, no event.
- `AutomateRunnerDeps` (`runner.ts`) gains an optional `carry?: {github?: () => GitHubClient | undefined, tickets?: McpTicketReader}`. `createAutomateRunnerTools(deps)` passes it to `verifyCarried`, so handler-level tests (Subtask 1's, and Subtask 2's "later prepare drops retired items") inject a fake GitHub client and ticket reader. The shipped `runnerPart` keeps `createAutomateRunnerTools()` with defaults.
- `runner.ts`'s `kernel_automate_prepare` handler becomes `async`. After `liveSession` and `checkoutOf` it computes `earlierCandidates`, `verifyCarried` and `retiredItemNames`, passes them to `writeTicketItems`, and answers `dropped` and `unverified` beside `carried`. The tool description says the answer names dropped and unverified earlier items.

**Subtask 2.**
- `paused-runs.ts` adds `POST /automate/paused-runs/:run_id/retire`:
  - body exactly `{agent, checkout}` (else 400);
  - it re-reads `listPausedRuns`; a run not listed for that agent and checkout → 404;
  - `blocked` of `run_live`, `resume_queued` or `continuation_queued` → 409;
  - otherwise it reads the run file's text, collects the `.supervisor/requirements/studio/ticket-*.md` names it holds, calls `recordRunRetired`, and answers 200 `{run_id, items}`.
- `listPausedRuns` leaves out runs whose id `retiredRunIds` holds for that checkout. The part's comment block and the `pausedRunsPart` doc line name the fourth route.
- App: the contract adds the route under `p8-item-27` (and the origin to the union) with a `PausedRunRetireResponse` type. `ParkedRunCard` gets `retirePausedRun(api, run)` and a Retire button with the same disabled and refusal handling as Resume. `TasksViews`/`TasksScreen` pass `onRetire` and read the board again after a success.
- Tests: `kernel/test/automate-retire.test.ts` covers the route's 200/400/404/409, the list exclusion, Resume answering 404 after a retire, the run file unchanged byte for byte and not moved, and a later `kernel_automate_prepare` dropping the retired items `run_retired` even after the run file is deleted. `ParkedRunCard.test.tsx` covers the button's body and disabled states.
- Docs: `docs/architecture/automate.md` adds to the `kernel_automate_prepare` paragraph the verification rule, the `dropped` / `unverified` fields and the three reasons, and to "The owner's Resume" paragraph Retire and its honest limit (below). `docs/evidence/phase-8-exit-runbook.md` "Known preconditions" says a checkout that ran before has its old paused run retired from the Parked run card, never moved by hand. Its walk step 1 expectation says the handover's backlog lists only the walk's two tickets, and that `dropped` names any earlier closed or off-filter ticket.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/automate/carry-check.ts"}
  - {kind: "symbol", path: "kernel/src/automate/carry-check.ts", name: "verifyCarried"}
  - {kind: "symbol", path: "kernel/src/automate/carry-check.ts", name: "CARRY_DROP_REASONS"}
  - {kind: "file", path: "kernel/src/automate/retired-runs.ts"}
  - {kind: "symbol", path: "kernel/src/automate/retired-runs.ts", name: "recordRunRetired"}
  - {kind: "symbol", path: "kernel/src/automate/retired-runs.ts", name: "retiredRunIds"}
  - {kind: "symbol", path: "kernel/src/automate/retired-runs.ts", name: "retiredItemNames"}
  - {kind: "symbol", path: "kernel/src/automate/tickets-to-items.ts", name: "earlierCandidates"}
  - {kind: "file", path: "kernel/test/automate-carry-check.test.ts"}
requires: []
lanes:
  - "kernel/src/automate/tickets-to-items.ts"
  - "kernel/src/automate/runner.ts"
  - "kernel/src/automate/carry-check.ts"
  - "kernel/src/automate/retired-runs.ts"
  - "kernel/test/automate-carry-check.test.ts"
external_requires: []

# Subtask 2
provides:
  - {kind: "symbol", path: "kernel/src/gui/paused-runs.ts", name: "/automate/paused-runs/:run_id/retire"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "p8-item-27"}
  - {kind: "symbol", path: "app/src/screens/tasks/ParkedRunCard.tsx", name: "retirePausedRun"}
  - {kind: "file", path: "kernel/test/automate-retire.test.ts"}
  - {kind: "symbol", path: "docs/architecture/automate.md", name: "run_retired"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/automate/retired-runs.ts", name: "recordRunRetired"}
  - {from: "1", kind: "symbol", path: "kernel/src/automate/retired-runs.ts", name: "retiredRunIds"}
  - {from: "1", kind: "symbol", path: "kernel/src/automate/carry-check.ts", name: "CARRY_DROP_REASONS"}
lanes:
  - "kernel/src/gui/paused-runs.ts"
  - "kernel/test/automate-retire.test.ts"
  - "kernel/test/console-contract.test.ts"
  - "app/src/api/contract.ts"
  - "app/src/screens/tasks/ParkedRunCard.tsx"
  - "app/src/screens/tasks/ParkedRunCard.test.tsx"
  - "app/src/screens/tasks/TasksViews.tsx"
  - "app/src/screens/tasks/TasksScreen.tsx"
  - "docs/architecture/automate.md"
  - "docs/evidence/phase-8-exit-runbook.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (2 imports 1's modules) | YES (requires) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): 15 files exceeds one worker's bound | MEDIUM | Split `context-bound` into 2 sequential subtasks with typed `requires` |
| Feasibility (Phase 2.5): retire needs paths outside the requirement's Touches | MEDIUM | The owner chose the mechanism (LP-CLARIFY); the widening is recorded at Phase 6 `LP-SCOPE` |
| A ticket handed over by a playbook whose poll lists more than `MAX_POLL_ITEMS` (100) is never proven absent | LOW | A cut listing yields `unverified` (kept), never a drop: the fail-toward-keeping rule |
| Union of every playbook's polls: a ticket still listed by ANY playbook's poll of that source is kept | LOW | The intended rule (the kernel sets no policy); documented in `automate.md` |
| The handover now makes network reads (one listing per relevant poll trigger, plus one closed probe per GitHub repo with a dropped candidate) | MEDIUM | Only when earlier candidates exist; each trigger is fetched once per call; every failure maps to `unverified` and never throws out of the handler |
| A retired run file still reads as incomplete to Loomwright, whose next start asks AUT-RESUME (held in Approvals); `kernel_automate_state` still reads it `parked` | MEDIUM | Honest limit, written in `automate.md` and the runbook: Retire stops the card and the carry. The owner answers Loomwright's own AUT-RESUME (`Archive` / `Start new`) in Approvals. The kernel never edits Loomwright's file (invariant 4) |
| The closed-state probe `listIssues(repo, {state: "closed"})` walks every page (`getPages`, capped at `GITHUB_DEFAULT_MAX_PAGES` = 10). On a repo with many closed issues it costs up to 10 requests per handover with a dropped GitHub candidate, and an issue past the cap reads `filter_no_longer_matches` instead of `ticket_closed` | LOW | Run the probe only for repos with a drop candidate, once per call. A probe that is incomplete or fails still drops the line, with `filter_no_longer_matches`: the ticket is proven off the filter, and only the reason label is weaker. Documented in `automate.md` |
| Requirement Validation 2 (running system: the next walk's backlog lists only the walk's two tickets) can't be run by a worker | MEDIUM | It is the merge gate for the owner. Subtask 2 writes the expectation into the runbook's walk step 1, and the owner records the result in that walk's evidence file before merging |
| `kernel_automate_prepare` handler goes sync → async | LOW | `merge_check` is already an async handler; tests await the handler |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-25-27b-handover-never-queues-gone-ticket.md
```


## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-25T17:40:00Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/313
- **Branch:** feature/27b-handover-never-queues-gone-ticket
- **Files changed:** 18
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 1
- **Heal reason:** needs_human
- **Heal remaining issues:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Handover now drops closed or off-filter earlier tickets (`dropped` with ticket_closed / filter_no_longer_matches / run_retired), keeps unreadable ones as `unverified`, and the Parked run card has Retire (POST /automate/paused-runs/:run_id/retire, automate_run_retired event, run file never touched). Heal round 1 fixed 4 findings (time-bound retire, Retire focus, 409 approval_pending, one item-source parser). Escalated: the owner must decide which poll triggers count as relevant (carry-check.ts:178), and one reproduced HIGH is unfixed: a ClickUp page with has_more and fewer than 100 usable items reads as complete (carry-check.ts:191).

## Not verified
- **kernel_automate_prepare against live GitHub and ClickUp** — fake client and ticket reader only (subtask 1)
- **docs/architecture/automate.md answer-shape sentence** — Subtask 2's lane; it was updated there (subtask 1)
- **Retire on the Parked run card in the running Electron app** — jsdom component tests only (subtask 2)
- **Runbook walk step 1 backlog expectation (Validation 2)** — needs the owner's live walk against the sandbox repo (subtask 2)
