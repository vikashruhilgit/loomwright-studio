# Supervisor Job: The PR tracker and owner-aware comment routing (phase 8 item 10)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-02-150636/L13
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (source requirement is gitignored under `.supervisor/*`, so its provenance is not in git; it is the `/automate` lane's queue item)
- **Source requirement:** .supervisor/requirements/phase-8/2026-11-02-160010-pr-tracker-and-owner-aware-comment-routing.md
- **Base commit:** 2b77e4c86f413b4a6e2aa0dc9344da476856bd4a

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest + zod in `kernel/`, React/TS contract in `app/`. Tools use `defineTool`; the tracker is a `DueWorkFn` on the automate feature's empty `trackerPart` (`kernel/src/automate/index.ts`). No new dependency. |
| 2 | Dependency Availability | GO | Both dependencies are merged on `main`: item 05 (GitHub write tools and poll sources) and item 09 (runner, `run-state.ts`, `merge-check.ts`, PR #237). Migration 20 already creates `pr_tracks`; item 08's `repo_policies` + `policyMet` exist. |
| 3 | Architecture Fit | GO | `trackerPart` and `routingPart` are the seams this item fills; `run-state.ts` (`readRunState`, `summarizeRuns`, `parsePullUrl`) already reads Loomwright run files by their `# Automate Run:` title; `githubConnectorRow` gives the owner login and App slug; `GET /tasks` lives in `kernel/src/gui/tasks.ts`. |
| 4 | Scope vs Supervisor Capability | CAUTION | ~28 files changed across the GitHub client, the automate feature, the tasks route and the app contract/fixtures: over the 12-file context bound, so three sequential subtasks (`context-bound`). |
| 5 | Hard Blockers | CAUTION | (a) Paths outside the requirement's Touches are needed (see `## Scope widening`): `GitHubPull` carries no `merged` flag, so "merged vs closed" needs `kernel/src/integrations/types.ts` + `client.ts` (+ its test); the workspace lookup the routing tool needs lives privately in `kernel/src/automate/runner.ts`; `createRepoPolicyClient` is typed without `getPull`; `ROLE_TEMPLATE` is pinned verbatim to `docs/architecture/brain.md`; a new required `TaskBoardItem` field breaks three app builders outside Touches; `pr_state_changed` must be named in `app/src/screens/budget/audit-sentences.ts` (its test scans `kernel/src` for every written kind); `docs/ARCHITECTURE.md` says `pr_tracks` is empty. (b) Loomwright's fix-now is an in-run owner decision at the park, not a standalone command, so `automate_fix` names `/loomwright:review-pr <pr url>` (the requirement's "its fix-now or `/review-pr <pr>`"). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Fill the automate feature's `tracker` part (a due-work tracker that keeps `pr_tracks` and the linked `tasks` row current, with one `pr_state_changed` event per change) and its `routing` part (the read-only `kernel_pr_route(repo, pr)` tool), and serve the PR fields on `GET /tasks` per the app contract.

**Problem Statement:**
The owner needs Tasks to show each ticket's PR truthfully (state, approvals against the repo's policy, CI, who owns it) and a triage playbook to know where a "fix" comment may go, because today nothing fills `pr_tracks` or `tasks.links_json`, nothing reads approvals or CI for a tracked PR, and nothing tells a playbook whether a PR belongs to a live `/automate` run, a parked item, the owner/App, or someone else.
Success looks like: a fake PR walked open → ready → parked → merged produces exactly four state records and four `pr_state_changed` events; approvals read `1/2` or `solo`; `kernel_pr_route` answers the four routes from fresh run state; `GET /tasks` carries ticket, PR, approvals, CI and owner kind.

### Design (binding for the worker; every choice is mechanism, invariant 1)

- **Closed sets in code (`kernel/src/automate/tracker.ts`):** `PR_TRACK_STATES = ["open", "draft", "ready", "parked", "merged", "closed"]`; CI reuses `GitHubCiState` (`green` / `pending` / `failing` / `none`); `PR_OWNER_KINDS = ["automate_live", "automate_parked", "owner", "other"]` mirroring the contract's `PrOwnerKind`. `PR_ROUTES = ["automate_drain", "automate_fix", "review_pr", "reply_only"]` in `routing.ts`.
- **Owner classification has one home: `routing.ts`** (`ownerOf(runRead, repo, pr, author, identity)`), imported by the tracker. Order: a `running` run file whose `## Current` item's PR URL (`parsePullUrl`) names this repo+number ⇒ `automate_live`; else a parked item (`summarizeRuns(...).parked`) naming it ⇒ `automate_parked`; else the PR author equals the GitHub connector's `account_login` (case-insensitive) or `<app_slug>[bot]` (`githubConnectorRow(store)`) ⇒ `owner`; else `other`. Run state unreadable, no workspace, or a failed GitHub read never yields `owner`/`automate_parked` (fail closed).
- **`kernel_pr_route(repo, pr)`** (`requiresConnector: "github"`, read level; read-only; re-reads run state and the PR's author on every call, never from `pr_tracks`). Answers `{route, repo, pr, owner_kind, command?, item?, reason?, note}`: `automate_live` ⇒ `automate_drain` (record only, leave it to that run); `automate_parked` ⇒ `automate_fix` with `item` (`run_id`, `item`, `status`, `reason`, `pr`) and `command: "/loomwright:review-pr <pr url>"` (Loomwright's fix-now is offered only by `/automate` itself at the park; the note says so); `owner` ⇒ `review_pr` with `command: "/loomwright:review-pr <pr url>"` (heals, never merges); `other` ⇒ `reply_only` (reply or answer, never push; suggest the fix in the reply). No workspace for the repo, `run_state_unreadable`, or a GitHub read failure ⇒ `reply_only` with `reason` (`no_workspace` / `run_state_unreadable` / `unreadable`), never a route that pushes. The note names the exact command per route and says a run that went live since the last call answers `automate_drain`. The tool's own description names the four routes and the three triage outcomes (fix, reply, answer) and what the playbook's session does for each (requirement Scope 5). The tool starts no session (owner decision 2026-11-03) and pushes nothing; every push stays held by the rail.
- **Which PRs the tracker follows:** (a) every PR a Loomwright run file names in the workspaces of every agent in `listAgents(store)` whose settings list workspaces (current item's `pr:` URL, via `readRunState`/`summarizeRuns`), and (b) every `pr_tracks` row not yet `merged`/`closed` (re-read until terminal). The ticket ref comes from the run item's requirement file when it is a `kernel_automate_prepare` item (`- dedupe ref: \`<ref>\`` under `## Source ticket`, read only under `.supervisor/requirements/studio/`, size-capped, treated as untrusted text), else `null`.
- **State derivation (precedence):** GitHub `merged: true` ⇒ `merged`; GitHub `state: "closed"` ⇒ `closed`; owner kind `automate_parked` ⇒ `parked` (Loomwright's reason = the item's `pause_reason`, else its `status`, stored in the event payload and links); a run item naming the PR with a full `ready_sha` equal to the PR's head and not parked ⇒ `ready`; GitHub `draft` ⇒ `draft`; else `open`.
- **Approvals:** from `getRepoPolicy(store, repo)` + `getPullMergeState`: `reviews` ⇒ `approvals = n`, `required = N`, word `"n/N"`; `solo` ⇒ word `"solo"`; `studio_approval` ⇒ `"studio_approval"`; no policy ⇒ `"no_policy"`. One pure helper `approvalsWordOf(policyKind, approvals, required)` in `tracker.ts`, reused by `gui/tasks.ts`.
- **When it reads GitHub (cadence is the user's):** the due work runs a pass only when a `trigger_fired` event was appended since its last pass (the owner's own trigger cadence drives refresh; the kernel ships no polling interval). The high-water event id is kept in memory (a restart re-reads on the next fire; the pass is idempotent). A pass reads at most `MAX_TRACKED_PER_PASS` PRs (a rate guard, not a cadence), oldest `updated` first.
- **Writes (one transaction per PR):** upsert `pr_tracks` (UNIQUE `repo, number`); when any of `state`, `head_sha`, `approvals`, `required`, `ci_state`, `owner_kind` changed (or the row is new), append exactly one `pr_state_changed` event `{repo, pr, from, to, head_sha, approvals, ci, owner_kind, reason?}` with `task_id` set to the linked task. The linked task is the `tasks` row whose `dedupe_key` is `pr:<repo>#<n>`; when none exists and the PR has a ticket ref, create it (`kind: "ticket_pr"`, `title` = the item's `# ` heading clipped, `state` = the PR state, `assignee_agent` = the workspace's agent) with one `task_created` event; then set its `links_json` to `{ticket, pr: {repo, number, url}, state, approvals, ci, owner_kind}` and its `state` to the PR state. Unchanged reads write nothing. The upsert sets `run_file` (the run id of the run file that names the PR) and `item_id` (that run item's `item` path) when a run file names the PR, else leaves them as they were (NULL for a never-named PR). `merged_by_gate` = 1 only when GitHub reports the PR merged AND a run file's `## Current` item names this PR with `status: done` and a full `ready_sha` equal to the merged head (the fields `run-state.ts` already parses; nothing in the run file records `--merge-parked` itself, so a hand merge at the exact READY head after `/automate` closed the item would also read 1 — recorded in `automate.md` Known limits); else 0. Shown, never acted on.
- **The GitHub client:** `tracker.ts` takes `{client?: () => GitHubClient & GitHubRepoPolicyReads}`; production passes none and uses `createRepoPolicyClient()` (its return type widened to `GitHubClient & GitHubRepoPolicyReads`, which it already constructs). It never reads `DueWorkContext.github`. Tests always inject `FakeGitHubClient`. A failed read changes nothing for that PR and appends nothing.
- **`GET /tasks` / `GET /tasks/:kind/:id`:** each `TaskBoardItem` gains `ticket_pr: TaskTicketPr | null`, served for a `task` card whose `links_json.pr` names a `pr_tracks` row; every value comes from that kernel-written `pr_tracks` row (and the repo policy for the approvals word), never from the agent-writable `links_json` beyond locating the row. `TaskTicketPr = {ticket: string | null, repo: string, number: number, url: string, state: PrTrackState, head_sha: string | null, approvals: string, ci: PrCiState | null, owner_kind: PrOwnerKind | null, merged_by_gate: boolean, updated: IsoTime}`. The history route's events already include the task's `pr_state_changed` rows (they carry its `task_id`).

## Acceptance Criteria
- [ ] AC1 — Given a fake PR (FakeGitHubClient) and fixture run files walked open → ready → parked `awaiting_merge` → merged across four tracker passes (each after a `trigger_fired`), then `pr_tracks` holds the final state with each intermediate state recorded once, the linked task's `state`/`links_json` follow it, and exactly four `pr_state_changed` events exist (one per change, each with the task's `task_id`); a fifth pass with nothing changed appends none. The row's `run_file` and `item_id` name the fixture run and item; `merged_by_gate` reads 1 when the done item's `ready_sha` equals the merged head and 0 for a PR merged at another head. Pinned in `kernel/test/automate-tracker.test.ts`.
- [ ] AC2 — Given a `reviews: 2` repo with one approving review at the head, then `pr_tracks` reads `approvals 1, required 2` and the task's `links_json.approvals` reads `"1/2"`; given a Solo repo, then it reads `"solo"`; a Studio-approval repo `"studio_approval"`, no policy `"no_policy"`. Pinned in `kernel/test/automate-tracker.test.ts`.
- [ ] AC3 — Given a PR named by a `running` run file's current item, then `kernel_pr_route` answers `automate_drain`; given a PR named by a paused run's parked item, then `automate_fix` with that item (run id, item, status, reason) and `command` `/loomwright:review-pr <pr url>`; given an owner- or App-authored PR not from `/automate`, then `review_pr` with the same command shape; and the route is re-read each call (a fixture switched from parked to running answers `automate_drain` on the next call); the tool's description names `automate_drain`, `automate_fix`, `review_pr`, `reply_only` and fix / reply / answer. Pinned in `kernel/test/automate-routing.test.ts`.
- [ ] AC4 — Given a PR by another person, then the route is `reply_only` and the answer has no `command`; given no workspace, unreadable run state or a failed GitHub read, then `reply_only` with its `reason`; and no module in `kernel/src/automate/` pushes, runs `git`/`gh`, starts a process or starts a session (`kernel/test/automate-merge-check.test.ts`'s existing source scan, whose pinned file list grows by `checkout.ts`, `tracker.ts` and `routing.ts`, plus a `git`/session-start scan in `automate-routing.test.ts`). Pinned in `kernel/test/automate-routing.test.ts`.
- [ ] AC5 — Given `GET /tasks` after a tracker pass, then the ticket-to-PR task card carries `ticket_pr` with ticket, PR (repo, number, url), state, approvals, CI and owner kind exactly as `TaskTicketPr` in `app/src/api/contract.ts` declares; every other card carries `ticket_pr: null`; a task whose agent-written `links` name an untracked PR carries `null`; the card's key list is pinned. Pinned in `kernel/test/gui-tasks.test.ts`, and the contract text pinned in `kernel/test/console-contract.test.ts`.
- [ ] AC6 — Given a GitHub pull that GitHub reports merged, then `getPull` answers `merged: true` (and `false` for a closed unmerged pull). Pinned in `kernel/test/integrations-github-client.test.ts`.
- [ ] AC7 — Given the automate feature, then `trackerPart` has one due work and no tool, `routingPart` has `kernel_pr_route` (github, read level) and nothing else, `runnerPart` is unchanged, and `kernel_pr_route` has its `CLOSED_VALUE_SETS` entry. Pinned in `kernel/test/phase-8-foundation.test.ts` and `kernel/test/tools-sdk-list.test.ts`.
- [ ] AC8 — Given Wright's role template, then `ROLE_TEMPLATE` names `kernel_pr_route`, the four routes and the three triage outcomes (fix, reply, answer) so Wright can draft a triage playbook from a sentence, nothing is preinstalled, and `docs/architecture/brain.md`'s role-template block equals it verbatim. Pinned in `kernel/test/brain.test.ts`.
- [ ] AC9 — Given the docs, then `docs/architecture/automate.md` describes the tracker and routing as built (replacing the tracker/routing "will" bullets and the "Nothing writes to it yet" line), `docs/ARCHITECTURE.md`'s `pr_tracks` row no longer says it is empty, and `pr_state_changed` has an audit sentence in `app/src/screens/budget/audit-sentences.ts`; `bash scripts/check-docs.sh` passes.
- [ ] AC10 — Validation: `cd kernel && npm ci && npm run typecheck && npm test`, `cd app && npm ci && npm run typecheck && npm test`, and `bash scripts/check-docs.sh` pass.

## Scope widening
- kernel/src/automate/checkout.ts
- kernel/src/automate/runner.ts
- kernel/src/integrations/types.ts
- kernel/src/integrations/github/client.ts
- kernel/src/integrations/github/repo-policy.ts
- kernel/test/integrations-github-client.test.ts
- kernel/test/automate-merge-check.test.ts
- docs/architecture/brain.md
- docs/ARCHITECTURE.md
- app/e2e/fixture-kernel.ts
- app/src/screens/tasks/model.test.ts
- app/src/screens/tasks/TasksScreen.test.tsx
- app/src/screens/budget/audit-sentences.ts
- accepted: LP-SCOPE 2026-11-09

## Touched-file invariants

> Grounded at base `2b77e4c86f413b4a6e2aa0dc9344da476856bd4a`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/integrations/types.ts`, `kernel/src/integrations/github/client.ts`** — keep: `export interface GitHubPull extends GitHubPullSummary {` gains `readonly merged?: boolean` (optional, so the many test literals that build a `GitHubPull` keep compiling); `pullOf` always sets it (`merged: p["merged"] === true`) beside `state: str(p["state"]),`; every other reader unchanged. pinned by: `kernel/test/integrations-github-client.test.ts` (the existing `getPull` tests).
- **`kernel/src/integrations/github/repo-policy.ts`** — keep: `export function createRepoPolicyClient(): GitHubRepoPolicyReads {` body unchanged; only its return type widens to `GitHubClient & GitHubRepoPolicyReads` (it already returns `createGitHubClient(...)`, which implements both). `policyMet` "Never throws" untouched. pinned by: `kernel/test/integrations-github-repo-policy.test.ts`, `kernel/test/automate-merge-check.test.ts` (mock of `createRepoPolicyClient`).
- **`kernel/src/automate/runner.ts`** — keep: `function checkoutOf(ctx: ContributedToolContext, agent: string, repo: string): string {` behaviour and its `no_workspace` messages; move it with `repoOfRemote`, `gitConfigDir`, `remoteRepos` into `kernel/src/automate/checkout.ts` and import them back (no behaviour change; `AUTOMATE_RUNNER_TOOL_NAMES` and the four tools untouched). pinned by: `kernel/test/automate-runner.test.ts` (`no_workspace` cases).
- **`kernel/test/automate-merge-check.test.ts`** — keep: the forbidden-pattern scan unchanged (`["a /merge endpoint", /\/merge(?![\w-])/],`, `"PUT"`, `child_process`, `fetch\s*\(`); extend only the pinned list `expect(files.sort()).toEqual(["index.ts", "merge-check.ts", "run-state.ts", "runner.ts", "text-rules.ts", "tickets-to-items.ts"]);` — Subtask 1 adds `"checkout.ts"`, Subtask 2 adds `"routing.ts"` and `"tracker.ts"` (sorted). The `createRepoPolicyClient` mock stays.
- **New automate modules (`checkout.ts`, `tracker.ts`, `routing.ts`)** — keep: they pass that scan, comments and note strings included — no `gh … merge` phrase, no `/merge` path, no `"PUT"`, no `child_process`/`execFile`/`spawn`/`fork(`, no `fetch(` or `node:https`; say "the merge command stays blocked" rather than naming the CLI verb.
- **`kernel/src/automate/index.ts`** — keep: "never the Agent SDK, the session manager or `kernel.ts`" (pinned by `kernel/test/feature-seams.test.ts`'s module graph; `tracker.ts`/`routing.ts`/`checkout.ts` may import `../agents/settings.js`, `../agents/registry.js`, `../integrations/github/repo-policy.js`, `../integrations/github/connector.js`, `../loop/internal.js` and node `fs`/`path`); `AUTOMATE_PARTS` order `runner`, `tracker`, `routing`; replace `export const trackerPart: AutomatePart = emptyConsolePart("tracker");` and `export const routingPart: AutomatePart = emptyConsolePart("routing");` with re-exports from `./tracker.js` / `./routing.js`, and update the header comment's import list. pinned by (update on purpose): `kernel/test/phase-8-foundation.test.ts` (`expect(Object.keys(automateContribution).sort()).toEqual(["name", "tools"]);` becomes `["dueWork", "name", "tools"]`; the tracker/routing "empty" loop; the merged-contribution test's `dueWork` equality).
- **`kernel/src/gui/tasks.ts`** — keep: "the kernel never maps a state to a column (the app does)"; `const KINDS = ["playbook_run", "session", "task"] as const;`; the keyset cursor; `BoardRow`'s field order (append `ticket_pr` after `creator_session`, read once per page like `withCreators`); a stored string is returned as stored, never interpreted; imports only helpers that load no SDK. pinned by (update on purpose): `kernel/test/gui-tasks.test.ts` (the full key list and the two `Object.keys(...).slice(-2)` pins reading `["creator_agent", "creator_session"]`, which become `["creator_session", "ticket_pr"]`; `["kind", "id", "title", "state", "agent", "playbook", "item_ref", "session", "tokens", "started", "ended", "updated", "creator_agent", "creator_session"]`, and `expect(tasksPart.dueWork ?? []).toEqual([]);`).
- **`kernel/src/brain/templates.ts`** — keep: `ROLE_TEMPLATE` shown verbatim between `<!-- role-template:start -->` and `<!-- role-template:end -->` in `docs/architecture/brain.md` (`kernel/test/brain.test.ts`); the existing automate tool needles (`kernel_automate_merge_check`, …) and GitHub tool needles stay; no playbook preinstalled (D3).
- **`app/src/api/contract.ts`** — keep: `export type PrOwnerKind = "automate_live" | "automate_parked" | "owner" | "other";` verbatim (pinned by `kernel/test/phase-8-foundation.test.ts`); `PrTrack` keeps its fields, `state` narrowed to the new `PrTrackState` and `ci_state` to `PrCiState`, whose values mirror `PR_TRACK_STATES` / `GitHubCiState`; `export interface TaskBoardItem {` gains required `ticket_pr: TaskTicketPr | null`; `CONTRACT_ROUTES` unchanged (no new route). mirror: `kernel/src/gui/tasks.ts` serves exactly these keys.
- **`app/e2e/fixtures/tasks.ts`, `app/e2e/fixture-kernel.ts`, `app/src/screens/tasks/model.test.ts`, `app/src/screens/tasks/TasksScreen.test.tsx`** — keep: each builder sets every field (`creator_session: null,` precedent); add `ticket_pr: null` only; no behaviour change. `app/e2e/fixtures/phase-7-exit.ts` imports its items from `./tasks` (`import { populatedItems, reviewHistory, reviewLog, runningSessions, tasksKernel, tasksRoutes, waitingItems } from "./tasks";`), so it needs an edit only if typecheck says so.
- **`app/src/screens/budget/audit-sentences.ts`** — keep: one entry per kind the kernel writes, read defensively from an untrusted payload, never JSON (`audit-sentences.test.ts` scans `kernel/src` for `appendEvent(store, "kind"`); add `pr_state_changed` in alphabetical position.
- **`kernel/test/tools-sdk-list.test.ts`** — keep: `expect(Object.keys(CLOSED_VALUE_SETS).sort()).toEqual([...kernelToolNames(SHIPPED)].sort());` — add `kernel_pr_route: []`.

## Closed enumerations touched

> Sibling greps at base `2b77e4c`: `grep -rnF 'kernel_automate_merge_check' --exclude=CHANGELOG.md --exclude-dir=node_modules --exclude-dir=.supervisor .` (newest tool-name sibling) → hits in `kernel/src/automate/{runner,merge-check,index}.ts`, `kernel/src/brain/templates.ts`, `kernel/test/{brain,automate-merge-check,automate-runner,phase-8-foundation,tools-sdk-list}.test.ts`, `docs/architecture/{brain,automate,approvals}.md`; and `grep -rnF 'poll_item_queued' …` (newest event-kind sibling) → `kernel/src/triggers/poll.ts`, `kernel/src/console/threads.ts`, `app/src/screens/budget/audit-sentences.ts`, `app/src/screens/chat/*`, `docs/architecture/{triggers,threads,dry-run}.md`, `docs/ARCHITECTURE.md`.

- **`kernel_pr_route`** (sibling: `kernel_automate_merge_check`) — must be named in:
  - `kernel/test/tools-sdk-list.test.ts` — `CLOSED_VALUE_SETS` — extend.
  - `kernel/test/phase-8-foundation.test.ts` — the parts' tool lists and the merged tool list (`"kernel_merge_approval_request",` last today) — extend.
  - `kernel/test/brain.test.ts` — the automate needle loop — extend (or a sibling needle).
  - `kernel/src/brain/templates.ts`, `docs/architecture/brain.md` — the role template — extend.
  - `docs/architecture/automate.md` — the tools table — extend.
  - `kernel/src/automate/runner.ts` `AUTOMATE_RUNNER_TOOL_NAMES` — no change: it lists the runner part's tools only.
  - `docs/architecture/approvals.md` — no change: the route tool is read-only, never held.
- **`checkout.ts`, `tracker.ts`, `routing.ts`** (sibling: `tickets-to-items.ts`) — must be named in:
  - `kernel/test/automate-merge-check.test.ts` — the pinned `kernel/src/automate/` file list — extend (Subtask 1: `checkout.ts`; Subtask 2: `routing.ts`, `tracker.ts`).
- **`pr_state_changed`** (sibling: `poll_item_queued`) — must be named in:
  - `app/src/screens/budget/audit-sentences.ts` — the per-kind sentence table (`audit-sentences.test.ts` coverage scan) — extend.
  - `docs/architecture/automate.md` — the tracker's event — extend.
  - `kernel/src/console/threads.ts` `THREAD_EVENT_KINDS` — no change: the event ties to a task (Tasks history), not to an agent thread.
  - `app/src/screens/tasks/history.ts` — no change: an unlisted kind reads `<kind> recorded`; its sentence is item 11's card.
- **`PR_TRACK_STATES` / `PR_ROUTES` / `PrTrackState` / `PrCiState` / `TaskTicketPr`** — new closed sets; mirrored kernel ↔ contract (`tracker.ts` ↔ `app/src/api/contract.ts`), pinned by `kernel/test/console-contract.test.ts`. `PR_OWNER_KINDS` mirrors the existing `PrOwnerKind` (no new value).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/integrations-github-client.test.ts` — merged pull → `merged: true` | flip `p["merged"] === true` → `false` in `kernel/src/integrations/github/client.ts` |
| `kernel/test/automate-tracker.test.ts` — unchanged fifth pass appends no event | delete the changed-fields comparison line in `kernel/src/automate/tracker.ts` (so every pass appends) |
| `kernel/test/automate-tracker.test.ts` — merged precedes closed | flip the `merged` check after the `closed` check in `kernel/src/automate/tracker.ts`'s state derivation |
| `kernel/test/automate-tracker.test.ts` — reviews 2 with one approval → `"1/2"` | flip `` `${approvals}/${required}` `` → `` `${approvals}` `` in `approvalsWordOf` (`kernel/src/automate/tracker.ts`) |
| `kernel/test/automate-tracker.test.ts` — no `trigger_fired` since last pass → no GitHub read | delete the `trigger_fired` high-water check line in `kernel/src/automate/tracker.ts` |
| `kernel/test/automate-routing.test.ts` — running run names the PR → `automate_drain` | delete the live-run branch line in `ownerOf` (`kernel/src/automate/routing.ts`) |
| `kernel/test/automate-routing.test.ts` — parked → `automate_fix` with `/loomwright:review-pr <url>` | flip `"automate_fix"` → `"review_pr"` in `kernel/src/automate/routing.ts`'s route mapping |
| `kernel/test/automate-routing.test.ts` — another author → `reply_only` | flip the `owner` login comparison to always true in `ownerOf` (`kernel/src/automate/routing.ts`) |
| `kernel/test/automate-routing.test.ts` — unreadable run state → `reply_only` | delete the `run_state_unreadable` fallback line in `kernel/src/automate/routing.ts` |
| `kernel/test/gui-tasks.test.ts` — card key list ends `creator_session`, `ticket_pr` | delete the `ticket_pr` field in `kernel/src/gui/tasks.ts`'s served row |
| `kernel/test/gui-tasks.test.ts` — agent-written links naming an untracked PR → `ticket_pr: null` | delete the `pr_tracks` lookup guard in `kernel/src/gui/tasks.ts` (serve from `links_json` instead) |
| `kernel/test/console-contract.test.ts` — `PrTrackState` text equals `PR_TRACK_STATES` | delete `"ready"` from `PR_TRACK_STATES` in `kernel/src/automate/tracker.ts` |
| `kernel/test/phase-8-foundation.test.ts` — `routingPart.tools` is `["kernel_pr_route"]`, `trackerPart.dueWork` has one entry | delete the `dueWork` entry in `kernel/src/automate/tracker.ts`'s `trackerPart` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | GitHub `merged` read, `createRepoPolicyClient` type, workspace lookup extracted to `checkout.ts` | AC6, AC10 | 6 modify, 1 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Tracker due work + `kernel_pr_route`, Wright guidance, kernel docs | AC1, AC2, AC3, AC4, AC7, AC8, AC9 (automate.md, ARCHITECTURE.md, audit sentence), AC10 | 10 modify, 4 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | BLOCKED (by #1) |
| 3 | `GET /tasks` PR fields, app contract, fixtures | AC5, AC10 | 9 modify, 0 create | `skills/unit-testing/SKILL.md` | BLOCKED (by #2) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/automate/checkout.ts"}
  - {kind: "symbol", path: "kernel/src/automate/checkout.ts", name: "checkoutOf"}
  - {kind: "symbol", path: "kernel/src/integrations/types.ts", name: "merged"}
  - {kind: "symbol", path: "kernel/src/integrations/github/repo-policy.ts", name: "createRepoPolicyClient"}
requires: []
lanes:
  - "kernel/src/integrations/types.ts"
  - "kernel/src/integrations/github/client.ts"
  - "kernel/src/integrations/github/repo-policy.ts"
  - "kernel/test/integrations-github-client.test.ts"
  - "kernel/src/automate/runner.ts"
  - "kernel/src/automate/checkout.ts"
  - "kernel/test/automate-merge-check.test.ts"
external_requires: []

# Subtask 2
provides:
  - {kind: "file", path: "kernel/src/automate/tracker.ts"}
  - {kind: "file", path: "kernel/src/automate/routing.ts"}
  - {kind: "symbol", path: "kernel/src/automate/tracker.ts", name: "PR_TRACK_STATES"}
  - {kind: "symbol", path: "kernel/src/automate/tracker.ts", name: "approvalsWordOf"}
  - {kind: "symbol", path: "kernel/src/automate/tracker.ts", name: "trackerPart"}
  - {kind: "symbol", path: "kernel/src/automate/routing.ts", name: "routingPart"}
  - {kind: "symbol", path: "kernel/src/automate/routing.ts", name: "kernel_pr_route"}
  - {kind: "symbol", path: "kernel/src/brain/templates.ts", name: "kernel_pr_route"}
  - {kind: "file", path: "kernel/test/automate-tracker.test.ts"}
  - {kind: "file", path: "kernel/test/automate-routing.test.ts"}
  - {kind: "symbol", path: "app/src/screens/budget/audit-sentences.ts", name: "pr_state_changed"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/automate/checkout.ts", name: "checkoutOf"}
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/types.ts", name: "merged"}
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/github/repo-policy.ts", name: "createRepoPolicyClient"}
lanes:
  - "kernel/src/automate/index.ts"
  - "kernel/src/automate/tracker.ts"
  - "kernel/src/automate/routing.ts"
  - "kernel/src/brain/templates.ts"
  - "kernel/test/automate-tracker.test.ts"
  - "kernel/test/automate-routing.test.ts"
  - "kernel/test/phase-8-foundation.test.ts"
  - "kernel/test/tools-sdk-list.test.ts"
  - "kernel/test/brain.test.ts"
  - "docs/architecture/automate.md"
  - "docs/architecture/brain.md"
  - "docs/ARCHITECTURE.md"
  - "app/src/screens/budget/audit-sentences.ts"
  - "kernel/test/automate-merge-check.test.ts"
external_requires:
  - "Loomwright >= 17.34.2 run-file shape (`# Automate Run:` title, `## Current` item line), already pinned by kernel/test/fixtures/loomwright-run-files/ (read-only here)"

# Subtask 3
provides:
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "TaskTicketPr"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "PrTrackState"}
  - {kind: "symbol", path: "kernel/src/gui/tasks.ts", name: "ticket_pr"}
requires:
  - {from: "2", kind: "symbol", path: "kernel/src/automate/tracker.ts", name: "approvalsWordOf"}
  - {from: "2", kind: "symbol", path: "kernel/src/automate/tracker.ts", name: "PR_TRACK_STATES"}
lanes:
  - "kernel/src/gui/tasks.ts"
  - "app/src/api/contract.ts"
  - "app/e2e/fixtures/tasks.ts"
  - "app/e2e/fixtures/phase-7-exit.ts"
  - "app/e2e/fixture-kernel.ts"
  - "app/src/screens/tasks/model.test.ts"
  - "app/src/screens/tasks/TasksScreen.test.tsx"
  - "kernel/test/gui-tasks.test.ts"
  - "kernel/test/console-contract.test.ts"
external_requires: []
```

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| github-reads + checkout (1) | `kernel/src/integrations/types.ts` (494), `kernel/src/integrations/github/client.ts` (1164 — one field in `pullOf`, no new responsibility), `kernel/src/integrations/github/repo-policy.ts` (one return type), `kernel/test/integrations-github-client.test.ts` (1919 — beside the existing `getPull` tests, the single home for that reader's pins), `kernel/src/automate/runner.ts` (300), `kernel/test/automate-merge-check.test.ts` (593 — one name in the pinned file list) | `kernel/src/automate/checkout.ts` (extract `checkoutOf`, `remoteRepos`, `gitConfigDir`, `repoOfRemote` from `runner.ts`: tracker and routing both need them, never a copy) | HIGH |
| tracker + routing (2) | `kernel/src/automate/index.ts` (60), `kernel/src/brain/templates.ts` (157), `kernel/test/phase-8-foundation.test.ts` (698 — the foundation pin itself changes), `kernel/test/tools-sdk-list.test.ts` (382), `kernel/test/brain.test.ts` (1302 — one needle beside the automate needle, the single home for template pins), `docs/architecture/automate.md` (85), `docs/architecture/brain.md` (289), `docs/ARCHITECTURE.md` (323), `app/src/screens/budget/audit-sentences.ts` (395 — one entry in the single per-kind table; the subtask that first writes the kind adds its sentence), `kernel/test/automate-merge-check.test.ts` (593 — two names in the pinned file list) | `kernel/src/automate/tracker.ts` (closed sets, `approvalsWordOf`, the pass, `trackerPart`), `kernel/src/automate/routing.ts` (`ownerOf`, `PR_ROUTES`, `kernel_pr_route`, `routingPart`), `kernel/test/automate-tracker.test.ts`, `kernel/test/automate-routing.test.ts` (run files built in temp dirs or read from the existing fixtures; no new fixture files) | HIGH (src), MEDIUM (exact "ready" signal in run files) |
| tasks route + contract (3) | `kernel/src/gui/tasks.ts` (307), `app/src/api/contract.ts` (1637 — the single authority for the wire shapes), `app/e2e/fixtures/tasks.ts` (260), `app/e2e/fixtures/phase-7-exit.ts` (239 — likely unchanged), `app/e2e/fixture-kernel.ts` (374), `app/src/screens/tasks/model.test.ts` (393), `app/src/screens/tasks/TasksScreen.test.tsx` (1186 — one factory default), `kernel/test/gui-tasks.test.ts` (644), `kernel/test/console-contract.test.ts` (341) | — | HIGH |

Module layout: each new responsibility has its own CREATE module (`tracker.ts`, `routing.ts`, `checkout.ts`); the large files (`client.ts`, `contract.ts`, the big tests) take one field or one pin beside their existing siblings. Reuse, never copy: `readRunState` / `summarizeRuns` / `parsePullUrl` (`run-state.ts`), `getRepoPolicy` and `createRepoPolicyClient` (`repo-policy.ts`), `githubConnectorRow` (`connector.ts`), `listAgents` + `readAgentSettings`, `appendEvent` (`loop/internal.ts`), `isRepoName`.

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2 ──→ Subtask 3
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | `kernel/test/automate-merge-check.test.ts` (each adds its own module names to one pinned list) | YES (requires: `checkout.ts`, `merged`, the widened client type; strictly sequential, so the shared test is edited one subtask at a time) |
| Subtask 2 | Subtask 3 | none | YES (requires: `approvalsWordOf`, `PR_TRACK_STATES`) |

Each subtask's AC10 passes inside its own lanes: the audit sentence for `pr_state_changed` lands in Subtask 2, the subtask that first writes the kind.

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Batch 3:** Subtask 3 (after Subtask 2)
- **Recommended workers:** 1
- **Estimated batches:** 3

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 3 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): over the 12-file context bound | MEDIUM | Three sequential subtasks along the `requires` edges; subtask 1 is small and lands first. |
| Feasibility (Phase 2.5): thirteen paths outside the item's Touches | MEDIUM | Recorded in `## Scope widening` as `pending-coordinator` (parallel lane). Each is forced: `merged` is not read today; the workspace lookup is private to `runner.ts`; the policy client is typed narrow; `brain.md` is a verbatim pin; three app builders, the audit table and the pinned `kernel/src/automate/` file list are compile/coverage-enforced; `ARCHITECTURE.md` would go stale. Nothing else outside Touches is edited. |
| Feasibility (Phase 2.5): Loomwright's fix-now cannot be triggered outside `/automate` | MEDIUM | `automate_fix` names `/loomwright:review-pr <pr url>` (the requirement's alternative) and the note says fix-now is offered only by `/automate` at the park; documented in `automate.md`. |
| The "ready" signal: a live run's READY is read from the run file's `ready_sha` at the PR head; the exact Loomwright write order is not probed | MEDIUM | Derive only from fields `run-state.ts` already parses (`ready_sha`, `status`, `pause_reason`); pin with run files built in the test; record in `automate.md` Known limits that the tracker reads run files as 17.34.2 writes them. |
| Refresh cadence vs invariant 1 | MEDIUM | No kernel interval: a pass runs only after a `trigger_fired` (the owner's trigger cadence); `MAX_TRACKED_PER_PASS` is a rate guard only. A setup with no trigger never refreshes — stated in `automate.md`. |
| Agent-writable `tasks.links` could forge PR facts on the board | MEDIUM | `GET /tasks` serves PR fields only from the kernel-written `pr_tracks` row the links point at; an untracked PR serves `null` (AC5 pin). |
| `merged_by_gate` is inferred (done item at the merged head), since the run file does not record `--merge-parked` | MEDIUM | Pinned both ways in AC1; stated in `automate.md` Known limits; it is display only. |
| Owner identity: `account_login` / `<app_slug>[bot]` may be null or stale | MEDIUM | A null identity never classifies `owner` (fail closed to `other` → `reply_only`); a test pins it. |
| Untrusted input (titles, PR authors, run-file text, item files) | MEDIUM | Titles clipped one line; the item file is read size-capped under `.supervisor/requirements/studio/` only; values are data, never interpolated into a command (the command uses only the validated repo, number and GitHub's `html_url`). |
| Invariant 4: no second drain, no push to someone else's branch | HIGH | The route tool starts nothing and pushes nothing; every push stays held by the rail; a source scan pins no `git`/`gh`/process/session start in `kernel/src/automate/`. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 3
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-09-pr-tracker-and-owner-aware-routing.md
```

## Plan Review: PASS (attempt 2/3)
- Attempt 1 FAIL (2 HIGH, 3 MEDIUM, 2 LOW), all fixed. Attempt 2 PASS, requirement_fit: fulfils.
- LOW (deferred, below the MEDIUM fix floor): no acceptance criterion exercises `GET /tasks/:kind/:id` returning the `pr_state_changed` rows. The Subtask 3 worker may add one assertion to AC5 in `kernel/test/gui-tasks.test.ts`.
- LOW (deferred): `gui/tasks.ts` imports `approvalsWordOf` / `PR_TRACK_STATES` from `tracker.ts`, so it depends on `tracker.ts`'s imports staying SDK-free. The Subtask 3 worker may move them into a leaf module or confirm `feature-seams.test.ts` stays green.

## Outcome
- **Status:** completed
- **Completed:** 2026-11-09T04:39:44Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/241
- **Branch:** feature/pr-tracker-and-owner-aware-routing
- **Files changed:** 28
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Three sequential subtasks delivered the GitHub `merged` read plus `checkout.ts`, the tracker due work plus `kernel_pr_route`, and `GET /tasks` `ticket_pr` with its contract. Phase 4.5 took three review rounds. Round 1 raised 2 MEDIUM tracker findings (a closed row that a live run names was not re-read; failing reads could starve the per-pass cap), fixed in 8e21504. Round 2 raised 1 MEDIUM doc drift in `automate.md`, fixed in 7e6bc66. Round 3 passed clean. One LOW (repo casing in the task dedupe key) was dismissed below the MEDIUM floor. Kernel tests: 4086 passed. App tests: 2984 passed. check-docs passed. Required CI is green.

## Not verified
- **Tracker and kernel_pr_route against real GitHub and a real Loomwright /automate run** — the tests use FakeGitHubClient and fixture run files; the live check belongs to phase 8 item 14 (subtask 2)
- **pr_state_changed audit sentence as rendered in the audit view** — only the coverage scan, typecheck and app tests ran; no test pins the sentence text (subtask 2)
- **app/e2e Playwright specs** — the fixtures only gained ticket_pr: null; the specs were typechecked, not run (subtask 3)
- **App tests at the final head** — after the round-1 and round-2 fixes, which touched only kernel files, docs and a comment, the app was re-checked with typecheck only; the 2984-test app suite last ran before those fixes (Phase 4.5)
