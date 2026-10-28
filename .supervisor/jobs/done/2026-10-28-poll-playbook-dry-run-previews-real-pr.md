# Supervisor Job: A poll playbook's dry run polls once without recording, shows would-run / would-skip per PR, then reviews one real PR forced into draft mode

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-28-121118/L1
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-6/2026-10-24-095109-a-poll-playbooks-dry-run-previews-one-real-pr.md
- **Base commit:** 165cdb6b254f79ab47fb868d27f2a9471d28a576

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel + vitest; every touched file is in `kernel/src`, `kernel/test` or `docs/`. |
| 2 | Dependency Availability | GO | All five dependencies are merged on `main`: item 01 schema (`draft_outputs`, `connectors`, migration 17), item 04 poll trigger (`kernel/src/triggers/poll.ts`), item 05 per-item dedupe (`evaluateDedupeKey` in `kernel/src/playbooks/runs.ts`, `kernel/src/playbooks/items.ts`), item 06 GitHub read tools (`kernel/src/integrations/github/tools.ts`), item 07 draft mode (`kernel/src/sessions/draft-mode.ts`, `kernel/src/integrations/drafts.ts`). No new package. |
| 3 | Architecture Fit | CAUTION | The contributed-tool context (`ContributedToolContext`) carries no `GitHubClient` today; the poll's client reaches only the loop's due work (`DueWorkContext.github`, from `KernelDeps.githubClient`). The dry run must get the same client through the tool context (plumbing in `features/contribution.ts`, `tools/server.ts`, `kernel.ts`). The daemon passes no `githubClient` yet, so in the shipped daemon a poll dry run reports `connector_missing` exactly as a due poll does. |
| 4 | Scope vs Supervisor Capability | CAUTION | 14 files (11 modify, 3 create) > 12: `context-bound`. Split into 2 sequential subtasks (session layer, then playbook layer). |
| 5 | Hard Blockers | GO | None. The MCP tool-call timeout for a long dry-run session stays NEEDS VERIFICATION (`docs/OPEN_QUESTIONS.md`), recorded by the live exit, not here. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Make `kernel_playbook_dry_run` on a playbook whose linked trigger is a `poll` poll the source once without recording anything, list each open PR as `would run` or `would skip (key …)` under the owner's dedupe key with the key's real field values, then run exactly one review session over the first `would run` PR (or the first PR if all would skip) with the four read-only kernel GitHub tools and forced into draft mode, so any would-be post comes back as a `dry_run` draft output in the result.

**Problem Statement:**
The owner needs to see exactly what a PR-review duty will do before enabling it, because a dry run today cannot read GitHub.
Currently, a dry-run session allows only `Read`, `Glob`, `Grep`, the kernel list/get tools and eight read-only Bash programs (`kernel/src/sessions/dry-run.ts`), `gh`/`git`/`curl`/WebFetch are out, and the dedupe preview shows `item.id` / `item.revision` as `<per item>` (`previewDedupeKey`, `kernel/src/playbooks/dry-run.ts`). This causes a poll playbook's dry run to show nothing about which PRs it would touch or what it would post.
Success looks like a dry-run result that names each polled PR with its would-run / would-skip verdict and real key values, plus the actual draft review body of one real PR, with no queue row, no `poll_item_*` event and no trigger bookkeeping written.

**Design (binding for the workers; mechanism only, invariant 1):**
- **Poll once, record nothing.** For a playbook whose linked trigger (`linkedTriggerOf`) has `kind = 'poll'`, the dry run parses the trigger's stored spec (`parsePollSpec`), reads the connector state and lists every repo through the SAME fetch item 04's fire uses (`fetchItems` in `kernel/src/triggers/poll.ts`, exported as `fetchPollItems` with its behaviour unchanged). It never calls `enqueueEvent`, never appends `poll_item_queued` / `poll_item_skipped` / `trigger_*` events, never writes `triggers` (`next_fire_at`, `last_result`, `last_fired_at` unchanged) and never opens a work step keyed `trigger:<id>:<instant>`.
- **Per-item verdict (read only).** For each item: `evaluateDedupeKey(dedupe_key_spec, {playbook, version, triggerId, scheduledAt, item}, timeZone)` (item 05's evaluator; `scheduledAt` = the trigger's `next_fire_at` when set, else the dry run's `now`; `timeZone` = the kernel's local zone, `Intl.DateTimeFormat().resolvedOptions().timeZone`, as `kernel/src/playbooks/drafts.ts` reads it), then the read-only `doneWithKey` check (exported from `kernel/src/playbooks/runs.ts`, unchanged: only `fire`/`run_now` rows that ended `done` count). A key found ⇒ `would skip (key <key>)`; otherwise `would run`. No dedupe spec ⇒ every item `would run`, key `null`. An invalid spec ⇒ the run's dedupe error (`dedupe_spec_invalid` / `dedupe_zone_invalid`) is reported for every item, and no session starts. Each entry shows the key's fields with their real values (the evaluated key JSON, e.g. `{"item.id":"github:o/r#7","item.revision":"abc123"}`), never `<per item>`.
- **One review, forced draft.** The session reviews the first `would run` item, or the first item when every item would skip; zero items ⇒ no session (`would_do` empty, a summary saying the poll found no open PRs). The prompt is the playbook's intent followed by `itemPromptBlock(item)` (`kernel/src/playbooks/items.ts`: the item wrapped `<untrusted-data source="github:<owner>/<repo>#<n>">`, invariant 3). It starts with `dryRun: true` and a new `forceDraft: true` session param: the manager sets the session policy's `mode` to `draft` whatever `playbooks.mode` says (a `live` playbook included), and in this dry run an outward call goes through item 07's draft path (one `draft_outputs` row, one `draft_output_recorded` event, the call denied `draft_mode` with `draftDenyReason`) instead of becoming a `dry_run` would-do entry. A non-outward, non-read-only call is still a `dry_run` would-do entry. The never boundary still wins first; a rail deny still wins.
- **The read tools.** (`mcp__kernel__kernel_github_pr_get` already matches `KERNEL_READ_TOOL`'s `_get` suffix today; only `_diff`, `_files`, `_comments` actually need the new list, but list all four for clarity.) The four tools `mcp__kernel__kernel_github_pr_get`, `_diff`, `_files`, `_comments` are read-only in a dry run (a new frozen `DRY_RUN_GITHUB_READ_TOOLS` list consulted by `isDryRunReadOnly`; `DRY_RUN_READ_ONLY_TOOLS` itself is unchanged). The session lists them only when the agent holds the `github` grant (existing `toolsForConnectors`); the agent's own policy must still allow them (as in a real run). `gh` stays out: in a dry run a `gh pr review|comment` is outward ⇒ drafted, any other `gh` call is a would-do entry, never run; `git`, `curl` and WebFetch stay out (`DRY_RUN_READ_ONLY_BASH` is unchanged).
- **The `dry_run` tag.** A draft recorded by a dry-run session is tagged in the result: `drafts: [{id, tool, target, body, event?, tag: "dry_run"}]`, read from `draft_outputs WHERE session = <the dry-run session>` after the session ends. Its row's `playbook_run` is the dry run's `playbook_runs` row (`kind = 'dry_run'`); a row recorded before that run row existed (`#draftContext` found none) is backfilled to it in `finishRun`'s transaction. The `dry_run` `playbook_runs` row never gets an `item_ref` (the previewed item lives in `result_json`), so `notifyNeedsGithub`'s outage query (`session_id IS NOT NULL AND item_ref IS NOT NULL`) never counts a dry run.
- **No GitHub, no grant: an incomplete preview, still enable-able.** Checked before any fetch, in order: no usable `github` connector or no client wired ⇒ `preview_incomplete: {reason: "connector_missing", fix: "Connect GitHub in Integrations (the github connector is <status or absent>)."}`; the owning agent lacks the grant (`needsGithub` from `kernel/src/playbooks/items.ts`, `missing: "grant"`) ⇒ `{reason: "needs_github", fix: "Add \"github\" to \"connectors\" in <settings path>."}`. A fetch that fails ⇒ `{reason: "rate_limited" | "source_error", …}`. In each of these no session starts, the parsed spec (`source`, `repos`, `filters`, `interval_seconds`) is still returned, and the `playbook_runs` row is written `kind = 'dry_run'`, `status = 'done'`, `session_id` NULL, `tokens` 0, so `latestDryRun` finds it and the enable stays possible (it parks at run time, item 05). The summary says the preview is incomplete and why.
- **Result shape (additive).** `DryRunToolResult` and `result_json` gain an optional `poll` object only for a poll playbook: `{spec, items: [{ref, revision, title, would: "run" | "skip", dedupe_key}], reviewed: <ref or null>, drafts, preview_incomplete?}`. Every phase 3 field keeps its meaning; a non-poll dry run's result, `result_json`, summary and mirror line are byte-identical to today.

## Acceptance Criteria
- [ ] Given a draft playbook with a poll trigger over one repo whose fake `GitHubClient` (passed as `KernelDeps.githubClient`) lists three open PRs, and a dedupe key `["item.id","item.revision"]`, where one PR has a `done` `fire` run whose `dedupe_key` is that PR's ref and unchanged head SHA, when it is dry-run, then the result's `poll.items` lists two `would: "run"` and one `would: "skip"` with its `dedupe_key` showing the real `item.id` and `item.revision` values, and a store snapshot taken before and after shows no new `queue` row, no new `poll_item_queued` / `poll_item_skipped` / `trigger_fired` / `trigger_missed` event, and the `triggers` row's `next_fire_at`, `last_result` and `last_fired_at` unchanged (the dry run's own `playbook_runs` row, `playbook_dry_run` event, session events and draft rows are the only writes).
- [ ] Given that dry run, then exactly one review session starts (`sessions` rows for the playbook grow by one), its prompt carries the first `would run` PR wrapped as `<untrusted-data source="github:<owner>/<repo>#<n>">`, its kernel MCP tool list includes the four `kernel_github_pr_*` tools, its `gh pr view` call is not run (a `dry_run` would-do entry), and its `gh pr review <n> --comment --body <text>` is denied with reason `draft_mode`; that body appears in the dry-run result's `poll.drafts` with `tag: "dry_run"`, and the `draft_outputs` row's `playbook_run` is the dry run's `kind = 'dry_run'` row.
- [ ] Given a poll playbook whose `playbooks.mode` is forced to `live` in the test (impossible in phase 6), when it is dry-run, then its `gh pr review` is still denied `draft_mode` and recorded as a draft output, never held for approval and never a would-do entry.
- [ ] Given no connected GitHub connector (or no client wired), when a poll playbook is dry-run, then the result carries the parsed spec and `poll.preview_incomplete` `{reason: "connector_missing", fix: …}` naming how to connect, no session starts, the `dry_run` row is `done` with `session_id` NULL, and `kernel_playbook_enable` is still held for approval (not refused for want of a dry run).
- [ ] Given a usable connector but an owning agent without the `github` grant, when a poll playbook is dry-run, then the result carries `poll.preview_incomplete` `{reason: "needs_github", fix: …}` naming the settings file, and no session starts and nothing is fetched (the fake client records no call).
- [ ] Given a poll that lists zero open PRs, when it is dry-run, then no session starts and the summary says the poll found no open pull requests.
- [ ] Given a forced-draft dry-run session (manager level), then the four `kernel_github_pr_*` tools are allowed (read-only), `DRY_RUN_READ_ONLY_TOOLS` still equals exactly `Read`, `Glob`, `Grep`, `kernel_loomwright_capabilities`, a dry run started without `forceDraft` still records an outward `gh pr review` as a `dry_run` would-do entry (`held`) with no draft row, and `forceDraft: true` without `dryRun: true` is refused `invalid_params`.
- [ ] Given a forced-draft dry-run session that is resumed (manager level), then the resumed session is still forced-draft: its outward `gh pr review` is denied `draft_mode` and recorded as a draft, never a `held` would-do entry (the flag rides on the `session_dry_run` event payload).
- [ ] Phase 3's dry-run tests (`kernel/test/playbooks-dry-run.test.ts`, `kernel/test/sessions-dry-run.test.ts`) and item 07's `kernel/test/draft-mode.test.ts` pass unchanged.
- [ ] `docs/architecture/dry-run.md` has a "Poll playbooks" section covering the no-record poll, the per-item verdict and key, the forced draft and the `dry_run` tag, and the incomplete-preview case (`connector_missing` / `needs_github` / fetch failure) that still allows the enable.
- [ ] `cd kernel && npm ci && npm run typecheck && npm test` and `bash scripts/check-docs.sh` pass.

## Touched-file invariants

> Grounded at base `165cdb6b254f79ab47fb868d27f2a9471d28a576`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/sessions/dry-run.ts`** — keep: a pure leaf with no I/O (`Pure, no I/O, a`); the closed frozen lists stay as they are: `DRY_RUN_READ_ONLY_TOOLS` (pinned by `kernel/test/sessions-dry-run.test.ts` `is exactly Read, Glob, Grep and kernel_loomwright_capabilities, frozen`) and `DRY_RUN_READ_ONLY_BASH` (`["cat", "head", "tail", "ls", "wc", "grep", "pwd", "echo"]`); the GitHub read tools go in a NEW frozen list, never into either. `classifyDryRunCall` keeps its order (`if (decision.decision !== "allow" || rail.kind === "deny") return { kind: "as_real_run" };`): a dry run only narrows.
- **`kernel/src/sessions/manager.ts`** — keep the gate's order: `The never boundary is read first for an outward call`, then the dry-run branch, then draft mode, then the GitHub CLI deny (`githubCliDecision`), then the hold; the forced-draft change only lets an outward call in a forced-draft dry run take the existing draft branch (`One transaction: the draft row, its event and this call's one decision event.`), never the hold and never an approval. Reuse `#sessionPolicy` (`mode = (PLAYBOOK_MODES as readonly unknown[]).includes(stored)`) to force `mode: "draft"`; a caller's own `mode` still never reaches the policy. Keep the resume rule `A dry run only narrows: a session that started as one resumes as one` and extend it so a forced-draft dry run resumes forced-draft (carry the flag on the `session_dry_run` event payload, read by `#startedAsDryRun`'s sibling). Keep `#checkPlaybookParams`' style for the new param (`dryRun must be a boolean`). Pinned by `kernel/test/draft-mode.test.ts` and `kernel/test/sessions-dry-run.test.ts`.
- **`kernel/src/sessions/types.ts`** — keep `readonly dryRun?: boolean;` and its doc; the new `forceDraft?: boolean` is documented the same way (only with `dryRun: true`; it only narrows).
- **`kernel/src/playbooks/dry-run.ts`** — keep the refusal order before any session (`crew_cannot_draft`, `mayManage`, owner off, draft only, model, settings) and the step's no-effect rule (`noEffect: (err) => phase === "checks" || (phase === "starting" && isAdmissionRefusal(err))`); keep `latestDryRun`'s `status = 'done'` rule; keep `formatDryRunSummary`'s text byte-identical for a non-poll run (pinned by `kernel/test/playbooks-dry-run.test.ts`: `Dedupe key for the next fire (preview):`) and append the poll lines only when `poll` is present; keep `previewDedupeKey`'s `<per item>` for a non-poll call. The module-graph rule in its header holds for it and for the new `dry-run-poll.ts`: `triggers feature's public index, type-only session and budget modules` (never the Agent SDK, the session manager or `kernel.ts`). The `dry_run` run row never carries `item_ref` (mirror: `kernel/src/playbooks/items.ts` `session_id IS NOT NULL AND item_ref IS NOT NULL`).
- **`kernel/src/triggers/poll.ts`** — keep `Phase A writes nothing` and the fire's behaviour byte-for-byte: exporting the fetch (`async function fetchItems(github: GitHubClient, spec: PollSpec): Promise<Fetched>`) and the connector read (`function githubConnector(store: Store): ConnectorState`) adds no logic; keep the import rule `Imports: its own \`fire-shared.ts\``. Pinned by `kernel/test/triggers-poll.test.ts`.
- **`kernel/src/triggers/index.ts`** — the public index the playbooks feature imports from; only extend the existing re-export line `export { MAX_POLL_ITEMS, POLL_FILTER_KEYS, POLL_SOURCES, firePollTriggers } from "./poll.js";` (with `parsePollSpec`, `fetchPollItems`, `githubConnectorState`) and keep its module-graph rule (`kernel/test/feature-seams.test.ts`): nothing reachable may import the Agent SDK, the session manager or `kernel.ts`.
- **`kernel/src/playbooks/runs.ts`** — keep `doneWithKey`'s query unchanged (`kind IN ('fire', 'run_now') AND dedupe_key = ? AND status = 'done'`): a dry run never counts as done, and exporting it adds no logic. `evaluateDedupeKey` stays pure (`the event's values only, never the clock`).
- **`kernel/src/features/contribution.ts`** — keep its import rule (`never the Agent SDK, the session manager or \`kernel.ts\``): the new `github?` field is a type-only `GitHubClient` import beside `import type { ConnectorKind } from "../integrations/types.js";`, optional like `startSession?(params: StartSessionParams): Promise<SessionHandle>;`. Pinned by `kernel/test/feature-seams.test.ts`.
- **`kernel/src/tools/server.ts`** — `contributedToolContext` passes the new field through beside `stepKey: (key) => kernelStepKey(contributed.name, sessionId, key),`; `KernelToolContext` gains the same optional field.
- **`kernel/src/kernel.ts`** — pass `deps.githubClient` (the same client the loop's due work gets: `...(deps.githubClient === undefined ? {} : { github: deps.githubClient }),`) into both `createKernelMcpServer({ store, sessions: manager, sessionId, now }` and the `heldToolCheckOf` context; absent stays absent.

## Closed enumerations touched

> Sibling grep at base `165cdb6b254f79ab47fb868d27f2a9471d28a576`: `grep -rnF 'needs_github' --exclude=CHANGELOG.md --exclude-dir=node_modules --exclude-dir=.supervisor .` → 22 hits in 6 files (`docs/architecture/playbook-runs.md`, `docs/architecture/agents.md`, `kernel/test/playbooks-runs-items.test.ts`, `kernel/src/playbooks/items.ts`, `kernel/src/playbooks/runs.ts`, plus `docs/evidence`).

- **`poll.preview_incomplete.reason`** = `connector_missing` | `needs_github` | `rate_limited` | `source_error` (a NEW closed set on a new field, defined once in `kernel/src/playbooks/dry-run-poll.ts`) — must be named in:
  - `kernel/src/playbooks/dry-run-poll.ts` — the new frozen list — create.
  - `docs/architecture/dry-run.md` — the new "Poll playbooks" section — extend.
  - `kernel/src/playbooks/items.ts` / `kernel/src/playbooks/runs.ts` — `needs_github` is the park reason of a real run (`readonly reason: "needs_github";`) — no change: a dry run never parks and never writes a park row.
  - `kernel/src/triggers/store.ts` — `TRIGGER_RESULTS` (`"rate_limited", "connector_missing", "source_error"`) — no change: a dry run writes no `last_result`.
  - `kernel/src/integrations/github/tools.ts` — `GITHUB_TOOL_REFUSALS` — no change: tool refusals, not dry-run reasons.
- **`poll.items[].would`** = `run` | `skip` (new, on a new field) — named only in `kernel/src/playbooks/dry-run-poll.ts` and the doc section. `playbook_runs.status` gains NO value: a dry run still uses `running` / `done` / `failed` (`PLAYBOOK_RUN_STATUSES` in `kernel/src/playbooks/runs.ts` — no change).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/playbooks-dry-run-poll.test.ts` — two would run, one would skip | in `kernel/src/playbooks/dry-run-poll.ts`, make the per-item check ignore `doneWithKey` (always `would: "run"`) ⇒ three run, red |
| `kernel/test/playbooks-dry-run-poll.test.ts` — store snapshot unchanged | in `kernel/src/playbooks/dry-run-poll.ts`, call `enqueueEvent` (or append `poll_item_queued`) for one item ⇒ snapshot differs, red |
| `kernel/test/playbooks-dry-run-poll.test.ts` — `gh pr review` denied `draft_mode` (and the `live` case) | in `kernel/src/sessions/manager.ts`, drop the forced `mode: "draft"` for `forceDraft` sessions ⇒ the `live` case is held / would-do, red |
| `kernel/test/playbooks-dry-run-poll.test.ts` — draft tagged `dry_run` in the result | in `kernel/src/playbooks/dry-run.ts`, drop the `drafts` read from `finishRun` ⇒ `poll.drafts` empty, red |
| `kernel/test/playbooks-dry-run-poll.test.ts` — `connector_missing`, no session | in `kernel/src/playbooks/dry-run-poll.ts`, skip the connector check ⇒ a session starts / the fetch runs, red |
| `kernel/test/sessions-dry-run-draft.test.ts` — GitHub read tools allowed | in `kernel/src/sessions/dry-run.ts`, remove `DRY_RUN_GITHUB_READ_TOOLS` from `isDryRunReadOnly` ⇒ `kernel_github_pr_diff` becomes a would-do entry, red |
| `kernel/test/playbooks-dry-run-poll.test.ts` — `needs_github`, no fetch | in `kernel/src/playbooks/dry-run-poll.ts`, move the grant check after the fetch ⇒ the fake client records a call, red |
| `kernel/test/playbooks-dry-run-poll.test.ts` — zero open PRs, no session | in `kernel/src/playbooks/dry-run-poll.ts`, drop the zero-items early return ⇒ a session starts, red |
| `kernel/test/playbooks-dry-run-poll.test.ts` — enable still held after an incomplete preview | in `kernel/src/playbooks/dry-run.ts`, write the incomplete-preview row with `status = 'failed'` ⇒ the enable is refused for want of a dry run, red |
| `kernel/test/sessions-dry-run-draft.test.ts` — `forceDraft` without `dryRun` refused | in `kernel/src/sessions/manager.ts` `#checkPlaybookParams`, accept `forceDraft` without `dryRun` ⇒ no `invalid_params`, red |
| `kernel/test/sessions-dry-run-draft.test.ts` — resumed forced-draft dry run stays forced-draft | in `kernel/src/sessions/manager.ts`, ignore the `session_dry_run` payload's forced-draft flag on resume ⇒ the resumed `gh pr review` becomes a `held` would-do entry, red |
| `kernel/test/sessions-dry-run-draft.test.ts` — non-forced dry run unchanged | in `kernel/src/sessions/manager.ts`, take the draft branch for every dry run (ignore `forceDraft`) ⇒ a plain dry run records a draft row, red |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Session layer: `forceDraft` dry runs take the draft path; GitHub read tools are read-only in a dry run | AC 7, AC 8 (resume), AC 9 (sessions/draft-mode part) | 3 modify, 1 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Playbook layer: no-record poll preview, per-item verdict, one forced-draft review, incomplete preview, tool-context GitHub client, docs | AC 1-6, AC 9 (playbooks part), AC 10, AC 11 | 8 modify, 1 create (+ 1 test create) | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | BLOCKED (by #1) |

### Module layout (File Impact Map)

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| sessions (subtask 1) | `kernel/src/sessions/dry-run.ts` (193), `kernel/src/sessions/types.ts` (590 — one optional field + doc beside `dryRun`, the single authority for session params), `kernel/src/sessions/manager.ts` (2947 — the gate and `#sessionPolicy` are the single authority for the decision order; a few lines, no new responsibility) | `kernel/test/sessions-dry-run-draft.test.ts` | HIGH |
| playbooks (subtask 2) | `kernel/src/playbooks/dry-run.ts` (507 — only the branch that calls the new module and the `poll` field on the result; the poll logic lives in the CREATE), `kernel/src/playbooks/runs.ts` (919 — export `doneWithKey` only, the single authority for "already done"), `kernel/src/triggers/poll.ts` (585 — export `fetchItems` as `fetchPollItems` and `githubConnector` as `githubConnectorState` only, the single authority for the fetch), `kernel/src/triggers/index.ts` (83), `kernel/src/features/contribution.ts` (559 — one optional context field, the single authority for the tool context), `kernel/src/tools/server.ts` (630 — one line in `contributedToolContext` + the `KernelToolContext` field), `kernel/src/kernel.ts` (409), `docs/architecture/dry-run.md` (133) | `kernel/src/playbooks/dry-run-poll.ts` (the poll preview: spec, connector/grant checks, fetch, per-item verdict, item selection, `preview_incomplete`), `kernel/test/playbooks-dry-run-poll.test.ts` | HIGH |

No helper is copied by 2+ siblings: the connector read is reused from `poll.ts` (exported), the grant read from `items.ts` (`needsGithub`), the key from `runs.ts` (`evaluateDedupeKey`, `doneWithKey`), the prompt block from `items.ts` (`itemPromptBlock`).

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "forceDraft"}
  - {kind: "symbol", path: "kernel/src/sessions/dry-run.ts", name: "DRY_RUN_GITHUB_READ_TOOLS"}
  - {kind: "file", path: "kernel/test/sessions-dry-run-draft.test.ts"}
requires: []
lanes:
  - "kernel/src/sessions/dry-run.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/test/sessions-dry-run-draft.test.ts"
external_requires: []

# Subtask 2
provides:
  - {kind: "file", path: "kernel/src/playbooks/dry-run-poll.ts"}
  - {kind: "symbol", path: "kernel/src/triggers/poll.ts", name: "fetchPollItems"}
  - {kind: "symbol", path: "kernel/src/triggers/poll.ts", name: "githubConnectorState"}
  - {kind: "symbol", path: "kernel/src/playbooks/runs.ts", name: "doneWithKey"}
  - {kind: "symbol", path: "kernel/src/features/contribution.ts", name: "github"}
  - {kind: "type", path: "kernel/src/tools/server.ts", name: "KernelToolContext"}
  - {kind: "file", path: "kernel/test/playbooks-dry-run-poll.test.ts"}
  - {kind: "symbol", path: "docs/architecture/dry-run.md", name: "Poll playbooks"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/sessions/types.ts", name: "forceDraft"}
  - {from: "1", kind: "symbol", path: "kernel/src/sessions/dry-run.ts", name: "DRY_RUN_GITHUB_READ_TOOLS"}
lanes:
  - "kernel/src/playbooks/dry-run.ts"
  - "kernel/src/playbooks/dry-run-poll.ts"
  - "kernel/src/playbooks/runs.ts"
  - "kernel/src/triggers/poll.ts"
  - "kernel/src/triggers/index.ts"
  - "kernel/src/features/contribution.ts"
  - "kernel/src/tools/server.ts"
  - "kernel/src/kernel.ts"
  - "kernel/test/playbooks-dry-run-poll.test.ts"
  - "docs/architecture/dry-run.md"
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
| Subtask 1 | Subtask 2 | none | YES (Subtask 2 starts the session with `forceDraft` from Subtask 1) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/sessions/dry-run.ts:22` | yes | HOLDS | `export const DRY_RUN_READ_ONLY_TOOLS: readonly string[] = Object.freeze([` | tip 2 hours ago, fetched <1h |
| `kernel/src/sessions/dry-run.ts:61` | yes | HOLDS | `export const DRY_RUN_READ_ONLY_BASH: readonly string[] = Object.freeze(["cat", "head", "tail", "ls", "wc", "grep", "pwd", "echo"]);` | tip 2 hours ago, fetched <1h |
| `kernel/src/playbooks/dry-run.ts:199-212` | yes | HOLDS (moved to 205) | `export function previewDedupeKey(spec: string \| null, fire: DedupeFire \| null): string \| null {` (`"item.id": "<per item>"` at 220) | tip 2 hours ago, fetched <1h |
| `policy.ts:181-184` | yes (`kernel/src/sessions/policy.ts`) | HOLDS (moved to 195) | `"mcp__kernel__kernel_playbook_enable",` in `ALWAYS_HELD_TOOLS` | tip 2 hours ago, fetched <1h |
| `docs/OPEN_QUESTIONS.md:112` | yes | STALE | `- [x] **Phase 5 exit: live run (item 18, owner).** … **Passed 2026-10-25**` (the requirement said unticked) | tip 2 hours ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The no-record mode leaks a write (a queue row, a `poll_item_*` event, a trigger bookkeeping update). | HIGH | The preview never calls `fireOnePoll` / `recordInstant` / `runStep(trigger:…)`; it calls only the exported pure fetch and read-only queries. AC 1 asserts a full before/after snapshot of `queue`, the poll/trigger event kinds and the `triggers` row. |
| Forced draft widens or reorders the gate (an outward call held for approval or allowed in a dry run; a phase 3 dry run starts recording drafts). | HIGH | Only `forceDraft` sessions take the draft branch; the never boundary and rail deny still win; AC 7 pins that a plain dry run still makes a `held` would-do entry with no draft row, and AC 8 keeps phase 3 / item 07 tests unchanged. |
| A draft recorded before the dry run's `playbook_runs` row exists has `playbook_run` NULL (`#draftContext`: "a call can arrive before the run's `session_id` is written"). | MEDIUM | The result reads drafts by session id (always correct), and `finishRun` backfills `playbook_run` for that session's NULL rows in its transaction. |
| A `dry_run` row with `item_ref` would end a `needs_github` outage early (`notifyNeedsGithub` counts any row with `session_id` and `item_ref`). | MEDIUM | The dry-run row never carries `item_ref`; the previewed item is stored in `result_json` only (touched-file invariant). |
| The daemon wires no `githubClient` (`kernel/src/kernel.ts`: "Defaults to none"), so in the shipped daemon a poll dry run reports `connector_missing` even with GitHub connected. | MEDIUM | Same behaviour as a due poll (item 04) and out of this item's scope; the result's `fix` and the doc section say so honestly. Source: Feasibility (Phase 2.5). |
| The review session runs longer than phase 3's dry run while the tool call stays open (MCP tool-call timeout NEEDS VERIFICATION). | MEDIUM | Unchanged mechanism; the doc's existing "honest limit" paragraph covers it, and the live exit records the duration. Source: requirement Assumptions. |
| Scope: 14 files across sessions, triggers, playbooks and the tool context. | MEDIUM | Split `context-bound` into two sequential subtasks with disjoint lanes. Source: Feasibility (Phase 2.5). |
| Cited premise `docs/OPEN_QUESTIONS.md:112` is STALE: the phase 5 live exit is now ticked (passed 2026-10-25), so the requirement's "run phase 6 only after that live run passes" precondition is met. | MEDIUM | No action in this item; source: Cited-line premise (Phase 3). |
| A draft recorded by a dry-run session appears as an ordinary draft card in the agent's thread (`kernel/src/console/threads.ts` renders `draft_output_recorded`), next to real drafts, untagged on the row. | LOW | The row's `playbook_run` points at the `kind = 'dry_run'` run, so a reader can tell; Subtask 2's worker checks `threads.ts` and, if it does not distinguish, records it in the doc section as a known gap (no app change in this item). |
| A dedupe key naming `trigger.scheduled_at` or `date` depends on which instant the preview uses. | LOW | Use the trigger's `next_fire_at` (else `now`) and document it; the verdict is a preview, item 05's check at fire time is what skips. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-28-poll-playbook-dry-run-previews-real-pr.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-28T14:10:27Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/153
- **Branch:** feature/poll-playbook-dry-run-previews-real-pr
- **Files changed:** 18
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unarmed (marker_missing)
- **Summary:** Poll playbook dry run (no-record poll, per-PR would run/skip with real key, one forceDraft review, dry_run-tagged drafts, incomplete previews) built in 2 sequential subtasks. Phase 4.5: 3 review rounds, each finding one more invariant-3 channel (untrusted PR/model text in the model-facing dry-run result) — all fixed; the final fix 18ba0e0 (closed draft tool label, closed gh api would-do action, branch-coverage tests) passes typecheck + 2408 tests + check-docs but was not LLM re-reviewed. Driver sidecar hand-patched (owner-approved) to drop a phantom subtask 'Group' parsed from the brief's nested Module layout table.

## Not verified
- **the shipped daemon's poll dry run** — the daemon passes no githubClient, so it reports connector_missing; only a kernel composed with a fake client was run (subtask 2)
- **a real model's review session and the MCP tool-call timeout over a long run** — stand-in sessions only, no live SDK; the timeout stays NEEDS VERIFICATION (subtask 2)
- **the console thread's draft card for a dry-run draft** — not rendered; threads.ts shows no dry_run distinction, recorded as a known gap in the doc (subtask 2)
