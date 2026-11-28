# Supervisor Job: wa-e — agents can look up sessions, events, approvals, budget and settings

## Environment
- **Project:** ~/orca/workspaces/loomwright-studio/starfish-clone
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/wright-aware/2026-11-21-230400-wa-e-agents-can-look-up-sessions-events-approvals-budget-and-settings.md
- **Base commit:** 39ce2279fac0d8f157bad54609e476da3dccfc8c

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + zod + vitest in `kernel/`; kernel tools are `defineTool` entries in a `FeatureContribution` (`kernel/src/features/contribution.ts`). No new dependency. |
| 2 | Dependency Availability | GO | Every reader exists: `GET /sessions` + `GET /sessions/:id/output` (`kernel/src/console/output.ts`, `sessionOutputRoutes`), `readEventsAfter`/`eventFrameOf` (`kernel/src/console/events.ts`), `listApprovals` (`kernel/src/approvals/store.ts`), `GET /budget/usage` (`kernel/src/gui/budget-audit.ts`, `budgetAuditRoutes`), `readWrightToolPolicy` (`kernel/src/agents/past-tool-lists.ts`), `GET /workspaces` (`kernel/src/console/workspaces.ts`), `GET /connectors` (`kernel/src/integrations/github/routes.ts`). wa-d's `studio-view.ts` already calls routes in-process. |
| 3 | Architecture Fit | GO | Read-only kernel tools are mechanism (invariant 1); crew scoping is the D8 boundary wa-d already applies; untrusted text is wrapped (invariant 3). |
| 4 | Scope vs Supervisor Capability | GO | 1 new module + 1 new test + 8 modified files + 1 evidence file; single worker. |
| 5 | Hard Blockers | CAUTION | Needs files outside the requirement's Touches: `kernel/src/features/catalogue.ts` (a new job), `docs/architecture/brain.md` (named by the carried wa-c follow-up, plus the new tools), `docs/evidence/wa-e-studio-lookup-tools.md` (Validation 2 evidence). Asked once at Phase 6 (`LP-SCOPE`). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Give Wright, and a crew member the owner grants them to through its charter, six read-only kernel tools that look up sessions, one session's ending and output, the event log, approvals, token use against limits, and the current settings.

**Problem Statement:**
The owner needs Wright to explain what the "Studio right now" summary (wa-d) only names, because "why did last night's run fail?" or "what's waiting for me?" is answered today by guessing or by sending the owner to a screen.
Currently, the details (a session's ending and output, the event log, an approval's payload, per-agent budget use, the settings) are reachable only through owner API routes; no kernel tool reads them (checked 2026-11-21, re-checked at base `39ce2279`: no `kernel_session_*`, `kernel_event_*`, `kernel_approval_list`, `kernel_budget_*` or `kernel_settings_*` tool exists in `kernel/src`).
Success looks like: Wright calls `kernel_session_get` on the last failed session and quotes how it ended.

**Tools (names fixed by this brief):** `kernel_session_list`, `kernel_session_get`, `kernel_event_list`, `kernel_approval_list`, `kernel_budget_usage`, `kernel_settings_get`. All six live in the new module `kernel/src/brain/studio-tools.ts` and ride on `brainContribution.tools` (`kernel/src/brain/index.ts`). All six take job `look_up_studio`, a new job in `TOOL_JOB_DEFINITIONS` labelled **"Look up Studio details"** with `needs()` (nothing beyond its tools). A charter duty naming this job grants exactly these six tools, not the phase 1 task tools that share `general`.

## Design decisions
- decision: where the six read tools live and how they read
  chosen: a new module `kernel/src/brain/studio-tools.ts`. Where an owner reader already takes the filters the tool needs, the tool calls it: `listApprovals` (`kernel/src/approvals/store.ts`), `GET /budget/usage` through `budgetAuditRoutes` called in-process with a read-only request (as `studio-view.ts` does), the workspaces and connectors routes, `readWrightToolPolicy`, `listAgents`, `readAuthChoice`. Where the owner reader cannot filter or tail (`GET /sessions` takes only `status`+`limit`; `readEventsAfter` only `after`+`limit`, oldest first; `GET /sessions/:id/output` reads oldest first), the tool runs its own read-only `SELECT`s, as `studio-view.ts`'s "Recent mistakes" queries already do, and returns exactly the route's projection: `SessionSummary` fields through `withSessionTitles` (`kernel/src/brain/titles.ts`), `EventRow`s mapped through `eventFrameOf` (`kernel/src/console/events.ts`), and session-output rows in `SessionOutputRow` shape with `payload_json` parsed as `sessionOutput` does. So the agent and the app agree on field shape, and `kernel/src/console/output.ts` and `kernel/src/console/events.ts` are not edited
  rejected: appending them to `kernel/src/brain/studio-view.ts` — blast radius partial (473 lines, a separate concern: a prompt section versus tools) and it would push that file past the module-layout threshold
  rejected: extending `listSessions` / `readEventsAfter` / `sessionOutput` with agent, time, tail and total — blast radius no (edits two route modules outside the File Impact Map and changes owner routes the app contract mirrors); reversibility partial
  evidence: `kernel/src/console/output.ts` `listSessions` reads only `req.query.status` and `req.query.limit`; `kernel/src/console/events.ts` `readEventsAfter(store, after, limit)`; `kernel/src/brain/studio-view.ts` header "Only the four "Recent mistakes" queries are this module's own SQL (no route serves them): read-only SELECTs"; `ContributedTool` and `defineTool` in `kernel/src/features/contribution.ts`
  revisit when: an owner route gains these filters, so the tool can call it instead of its own SELECT
  status: confirmed

## Acceptance Criteria
- [ ] AC1. Given Wright's session, when it calls `kernel_session_list` with optional filters `agent`, `status`, `since`, `until` (ISO 8601 times) and `limit`/`after` paging, then it gets, read-only, the matching sessions newest first, each with every `SessionSummary` field (`id`, `agent`, `status`, `model`, `started`, `ended`, `tokens`, `cwd`, `playbook`, `title`), the `tokens` sum and the title computed as `listSessions` and `withSessionTitles` compute them.
- [ ] AC2. Given Wright's session, when it calls `kernel_session_get` with a `session_id`, then it gets that session's row, how it ended (status, ended time, and the last `result` output row's payload: the SDK result subtype and any error text) and its most recent output rows (up to a bounded number, newest last, each `kind`, `seq`, `created_at` and `payload`), read with the tool's own read-only tail `SELECT … FROM session_output WHERE session_id = ? ORDER BY seq DESC LIMIT ?` (re-sorted ascending) in `SessionOutputRow` shape, with a `before` seq cursor for older rows.
- [ ] AC3. Given Wright's session, when it calls `kernel_event_list` with optional filters `kind`, `agent` (matched through the event's `session_id` to `sessions.agent`), `since`, `until` and `limit`/`after` paging, then it gets, read-only, the matching events as `eventFrameOf` frames (id, at, kind, session_id, task_id, payload), read with the tool's own read-only `SELECT` of the `EventRow` columns (never `actor`) joined to `sessions` for the agent filter, newest first.
- [ ] AC4. Given Wright's session, when it calls `kernel_approval_list` with optional `status` (`pending` or `recent`) and `agent`, then it gets pending approvals and recently decided ones, each with its id, requesting agent, action, status, times and payload, read through `listApprovals`.
- [ ] AC5. Given Wright's session, when it calls `kernel_budget_usage`, then it gets each agent's token and session use against its limits (`tokens_per_day`, `sessions_at_once`), read through `GET /budget/usage`'s handler, the same numbers the owner's app shows.
- [ ] AC6. Given Wright's session, when it calls `kernel_settings_get`, then it gets the current settings: per agent its model and tool-policy status, read raw from `config/agents/<id>.json` inside `studio-tools.ts` (a bounded read that refuses a file over `MAX_SETTINGS_BYTES`, never creates a file, and reports an absent or unreadable file as `null`, as `readWrightToolPolicy` does; never through `readAgentSettings` or `rosterOf`, so the call creates and rewrites no file), the workspaces, the connectors that are on, and the auth provider chosen (`readAuthChoice`, `kernel/src/auth/choice.ts`). A secret (the API key, a connector or GitHub token, the API token) is never returned: only `set: true | false` for each, decided from the stored rows and metadata the owner routes already read (for example `auth_providers.token_created_at`, the connector row's state), never from a Keychain read.
- [ ] AC7. Given a crew member's session that the owner granted these tools through its charter, then every result covers only that member's own rows: its sessions, the events of its sessions, its approvals, its own budget line, its own settings. A filter or id naming another agent (`agent: "wright"`, another member's `session_id`) returns no rows and a plain line saying so (for example `only your own items are shown: mason's are not`), never the rows. Wright (agent `wright`) sees all. The caller is the agent of `ctx.sessions.getSession(ctx.sessionId)`, as `kernel/src/triggers/tools.ts` reads it.
- [ ] AC8. Given the tool catalogue (`buildToolCatalogue`), then each of the six tools is listed under job `look_up_studio` ("Look up Studio details") with a purpose line (`purposeOf` its description's first sentence), so `catalogueText` lets Wright propose them in a charter in plain words.
- [ ] AC9. Given the current proposed Wright tool list `PROPOSED_ALLOWED_TOOLS` (`kernel/src/brain/settings.ts`), then it includes all six `mcp__kernel__kernel_*` names, appended after `"Grep"` so the order pins in `kernel/test/brain.test.ts` hold. The 25-tool list wa-c recorded in `PAST_PROPOSED_TOOL_LISTS` (the list before this change) stays the last past list, so an existing Wright with an unedited proposed list gets the six through wa-c's upgrade; a test reads a 25-tool proposed `wright.json` under a registered audit sink and sees the six added.
- [ ] AC10. Given a large result, then every list tool is paged and bounded: a `limit` (default and maximum stated as exported constants), an `after` cursor, each text field cut to a fixed length with the cut stated, and a `remaining` count of the matching rows not returned.
- [ ] AC11. Given any stored text that came from outside the owner (approval payloads, session output, event payloads, failure details, session titles), then the tool result marks it as untrusted data: it sits inside one `<untrusted-data source="studio-tools">` wrapper built with `wrapUntrusted` (`kernel/src/brain/context.ts`), its wrapper tags defused, so a closing tag inside a payload cannot end the wrapper (pinned).
- [ ] AC12. Given a bad filter (an unknown `status`, a malformed time, a `limit` out of range, a `kind` or `agent` that is not a valid name) or an unknown `session_id`, then the tool returns a plain refusal naming the field (for example `{"error": "invalid_filter", "field": "since", "message": "…"}` or `{"error": "not_found", "field": "session_id"}`), never a stack trace and never a throw through the SDK.
- [ ] AC13. Given any call of the six tools, then nothing is written: a test compares the store's total changes, the `events` count and a listing of the data dir before and after, for Wright and for a crew member, with `wright.json` absent (the tool must not create it).
- [ ] AC14 (carried from wa-c, PR #317). Given `kernel/src/brain/settings.ts`'s header comment, then it no longer says `wright.json` is "never overwritten": it says the file is created once and the owner's edits win, and that the one kernel rewrite is wa-c's audited upgrade of an unedited proposed tool list (`kernel/src/agents/past-tool-lists.ts`, with a backup and an audit event). The "`kernel/src/brain/settings.ts`'s header comment is stale" line is removed from `docs/architecture/brain.md` "Known limits".
- [ ] AC15. Given `docs/architecture/brain.md`, then it gains a section on the six tools: names, job, filters, paging bounds, the crew boundary, the untrusted wrapper and secret handling.
- [ ] AC16 (Validation 2, static half). Given the merged change, then a committed evidence file `docs/evidence/wa-e-studio-lookup-tools.md` records the commands run and what `kernel_session_get` returns for the most recent failed session in a read-only copy of the owner's store (copied with `sqlite3 … ".backup"` into a temp dir; no kernel is started against the owner's data dir and nothing is written to it). Only the session id, status, the result subtype and counts are recorded, never output or payload text. It also holds the kernel suite's result line and the line `Verdict: PASS for Validation 2 (static half; the live ask to Wright is the owner's)` at column 0. The live ask ("what did the last failed session say before it ended?") on the owner's install is listed as the owner's step, never run by the worker. The PR body links to the file.
- [ ] AC17 (Validation 1). Given `cd kernel && npm test`, then it passes, with a case per tool, the crew scoping (AC7), paging (AC10), secret redaction (AC6), untrusted marking (AC11), the catalogue entries (AC8), the proposed list and its upgrade (AC9), the refusals (AC12) and the no-write check (AC13).

## Owner conditions (binding)

The owner's words at Launch Pad Phase 6 (`LP-SCOPE`, 2026-11-28), verbatim; the PR body must show each one:

> A dedicated look_up_studio job is the narrower grant, so it is the better choice over general. Conditions to show in the PR body: all six tools are read-only; the settings lookup never returns a credential (no API key, no token, not even a prefix) or the Keychain item's contents; the approvals lookup cannot decide an approval; and the job is granted only through a charter duty the owner sees, never by default.

## Scope widening
- kernel/src/features/catalogue.ts
- docs/evidence/wa-e-studio-lookup-tools.md
- accepted: LP-SCOPE 2026-11-28

## Touched-file invariants

> Grounded at base `39ce2279fac0d8f157bad54609e476da3dccfc8c`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/brain/index.ts`** — keep: the CLI-safe import rule in its header (`so it imports only types and zod: never the Agent SDK.`); the contribution shape `export const brainContribution: FeatureContribution = Object.freeze({` with `name: "brain"`; add `tools: Object.freeze([...])` from `./studio-tools.js`, and extend the header's list of runtime imports to name the new module's imports. pinned by: `kernel/test/feature-seams.test.ts` (`features/index.js loads in a fresh Node process without the Agent SDK`) and the contributor order `["loomwright", "notifications", "triggers", "approvals", "brain", …]`.
- **`kernel/src/brain/studio-tools.ts`** (create) — must import only modules the `studio` CLI already loads (the SDK guard `SDK_IN_GRAPH` in `kernel/test/feature-seams.test.ts` fails otherwise); type-only `import type { SDKMessage }` modules such as `../console/output.js` are safe, `../tools/server.js`, `../sessions/manager.js`, `../kernel.ts` and `../budget/cap.js` are not. reuse: `wrapUntrusted` and `defuseWrapperTags` from `./context.js` and `cutChars` from `./memory.js`, as `kernel/src/brain/studio-view.ts` does (`import { defuseWrapperTags, localTimeLine, wrapUntrusted } from "./context.js";`); the caller-agent read `ctx.sessions.getSession(ctx.sessionId)?.agent` from `kernel/src/triggers/tools.ts`; `defineTool` from `../features/contribution.js`. Tool names must match `TOOL_NAME = /^kernel_[a-z0-9_]{1,64}$/` and none may take a `PHASE1_TOOL_NAMES` name.
- **`kernel/src/brain/settings.ts`** — keep: `PROPOSED_ALLOWED_TOOLS` frozen (`export const PROPOSED_ALLOWED_TOOLS: readonly string[] = Object.freeze([`), its existing order, and `"Read",`, `"Glob",`, `"Grep",` as the only non-kernel entries; the six new names are appended after `"Grep"`. mirror: `kernel/src/agents/past-tool-lists.ts` `PAST_PROPOSED_TOOL_LISTS` (`// 25 tools: \`845564ce\` through \`b4450b80\``) must remain a subset of the new list, unchanged. pinned by: `kernel/test/brain.test.ts` (`PROPOSED_ALLOWED_TOOLS.slice(after, after + 5)` and `.toEqual(["Read", "Glob", "Grep"])`), `kernel/test/agents-settings-upgrade.test.ts` (`toEqual([15, 21, 25])`, `isPastProposedList(PROPOSED_ALLOWED_TOOLS)).toBe(false)`).
- **`kernel/src/features/catalogue.ts`** — keep: `TOOL_JOB_DEFINITIONS` the one place a job is declared (`the ONE place a job is`), each entry `Object.freeze({ label: …, needs: needs() })`, `general` last; `TOOL_JOBS`/`TOOL_JOB_IDS` derived, never edited by hand. pinned by: `kernel/test/tool-catalogue.test.ts` (`toEqual(TOOL_JOB_IDS.filter(`) and the refusal text `is not one of ${TOOL_JOB_IDS.join(", ")}`.
- **`kernel/src/brain/studio-view.ts`** — keep: its no-write rule (`Writes nothing of its own: no store write, no file.`) and its SDK-free import list. Modify only if a reader it owns is exported for reuse by `studio-tools.ts` (for example a shared caller-scope helper); no behaviour change. pinned by: `kernel/test/brain-studio-view.test.ts`.
- **`docs/architecture/brain.md`** — remove exactly the line starting `- **\`kernel/src/brain/settings.ts\`'s header comment is stale.**`; keep the `templates.ts` stale-comment line (`kernel/src/brain/templates.ts\`'s header comment is stale`), which is not this item's.

## Closed enumerations touched

> Sibling grep at base `39ce2279`: `git grep -n "notify_owner" -- . ':!CHANGELOG.md'` → 17 hits in 8 files.

- **`look_up_studio`** (sibling: `notify_owner`) — must be named in:
  - `kernel/src/features/catalogue.ts` — `TOOL_JOB_DEFINITIONS` (`notify_owner: Object.freeze({ label: "Notify the owner", needs: needs() }),`) — extend, before `general`.
  - `kernel/src/notifications/tool.ts` — a tool's `job: "notify_owner",` — no change: a tool picks one job, not a list.
  - `kernel/test/agents-charter-readiness*.test.ts`, `kernel/test/approvals-replace.test.ts` — duty fixtures naming jobs — no change: data, not a closed list.
  - `app/e2e/fixtures/team.ts`, `app/e2e/team.spec.ts`, `app/src/screens/team/team.test.tsx` — job groups as fixture data from `GET /agents/:id` — no change: the app renders whatever job/label the kernel sends.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/brain-studio-tools.test.ts` — crew member asking for `agent: "wright"` sees no row | delete `if (caller !== "wright" && agent !== caller) ` guard line in `kernel/src/brain/studio-tools.ts` (whatever line applies the crew filter) |
| `kernel/test/brain-studio-tools.test.ts` — settings result contains no secret value, only `set` | flip the redaction so the stored value is returned instead of `set: true` in `kernel/src/brain/studio-tools.ts` |
| `kernel/test/brain-studio-tools.test.ts` — payload with `</untrusted-data>` stays inside the wrapper | delete the `wrapUntrusted(` call wrapping the result text in `kernel/src/brain/studio-tools.ts` |
| `kernel/test/brain-studio-tools.test.ts` — `remaining` counts the rows not returned | flip `remaining: total - rows.length` → `remaining: 0` in `kernel/src/brain/studio-tools.ts` |
| `kernel/test/tool-catalogue.test.ts` — the six tools under `look_up_studio` | delete `look_up_studio: Object.freeze({ label: "Look up Studio details", needs: needs() }),` in `kernel/src/features/catalogue.ts` |
| `kernel/test/brain-studio-tools.test.ts` — the six names are in `PROPOSED_ALLOWED_TOOLS` | delete `"mcp__kernel__kernel_settings_get",` in `kernel/src/brain/settings.ts` |
| `kernel/test/brain-studio-tools.test.ts` — AC13 no-write check (store changes, `events` count, data-dir listing, `wright.json` absent) | add one store write (for example an `INSERT INTO events`) or a `readAgentSettings(dataDir, "wright")` call inside `kernel_settings_get`'s handler in `kernel/src/brain/studio-tools.ts` |
| `kernel/test/brain-studio-tools.test.ts` — AC9 a 25-tool proposed `wright.json` gains the six through wa-c's upgrade | delete the `// 25 tools: \`845564ce\` through \`b4450b80\`` list from `PAST_PROPOSED_TOOL_LISTS` in `kernel/src/agents/past-tool-lists.ts` (scratch copy only; that file is not edited by this item) |
| `kernel/test/brain-studio-tools.test.ts` — AC12 a bad `since` is `{error: "invalid_filter", field: "since"}` | replace the field-naming refusal for `since` with a `throw new Error(…)` in `kernel/src/brain/studio-tools.ts` |
| `kernel/test/tool-catalogue.test.ts` — AC8 each of the six has a non-empty purpose line naming what it reads | replace `kernel_session_get`'s description with one whose first sentence is another tool's in `kernel/src/brain/studio-tools.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Six read-only Studio lookup tools, catalogue job, proposed list, docs and evidence | all | 8 modify, 3 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| tools | `kernel/src/brain/index.ts` (88), `kernel/src/brain/settings.ts` (135), `kernel/src/brain/studio-view.ts` (473, only if a helper is exported for reuse) | `kernel/src/brain/studio-tools.ts` (new home for all six tools: a separate concern from the prompt section) | HIGH |
| catalogue | `kernel/src/features/catalogue.ts` (580 — the single authority for the job vocabulary; one line appended to `TOOL_JOB_DEFINITIONS`) | — | HIGH |
| tests | `kernel/test/tool-catalogue.test.ts` (460), `kernel/test/feature-seams.test.ts` (1154 — the single authority for the module-graph and contributor pins; only touched if a pin names brain's tools) | `kernel/test/brain-studio-tools.test.ts` (new home for every tool case) | HIGH |
| docs | `docs/architecture/brain.md` (459) | `docs/evidence/wa-e-studio-lookup-tools.md` | HIGH |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/brain/studio-tools.ts"}
  - {kind: "symbol", path: "kernel/src/brain/studio-tools.ts", name: "kernel_session_list"}
  - {kind: "symbol", path: "kernel/src/brain/studio-tools.ts", name: "kernel_session_get"}
  - {kind: "symbol", path: "kernel/src/brain/studio-tools.ts", name: "kernel_event_list"}
  - {kind: "symbol", path: "kernel/src/brain/studio-tools.ts", name: "kernel_approval_list"}
  - {kind: "symbol", path: "kernel/src/brain/studio-tools.ts", name: "kernel_budget_usage"}
  - {kind: "symbol", path: "kernel/src/brain/studio-tools.ts", name: "kernel_settings_get"}
  - {kind: "symbol", path: "kernel/src/features/catalogue.ts", name: "look_up_studio"}
  - {kind: "symbol", path: "kernel/src/brain/settings.ts", name: "mcp__kernel__kernel_settings_get"}
  - {kind: "file", path: "kernel/test/brain-studio-tools.test.ts"}
  - {kind: "file", path: "docs/evidence/wa-e-studio-lookup-tools.md"}
  - {kind: "symbol", path: "docs/evidence/wa-e-studio-lookup-tools.md", name: "Verdict: PASS for Validation 2"}
requires: []
lanes:
  - "kernel/src/brain/studio-tools.ts"
  - "kernel/src/brain/index.ts"
  - "kernel/src/brain/settings.ts"
  - "kernel/src/brain/studio-view.ts"
  - "kernel/src/features/catalogue.ts"
  - "kernel/test/brain-studio-tools.test.ts"
  - "kernel/test/tool-catalogue.test.ts"
  - "kernel/test/feature-seams.test.ts"
  - "docs/architecture/brain.md"
  - "docs/evidence/wa-e-studio-lookup-tools.md"
external_requires:
  - "sqlite3 CLI (for the read-only `.backup` copy of the owner's store in AC16)"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Needs files outside the requirement's Touches (`kernel/src/features/catalogue.ts`, `docs/architecture/brain.md`, `docs/evidence/wa-e-studio-lookup-tools.md`) — source: "Feasibility (Phase 2.5)" | MEDIUM | Asked once at Launch Pad Phase 6 (`LP-SCOPE`); recorded in `## Scope widening` when accepted. |
| A crew member scoped wrong reads another member's work (the requirement's own risk) | HIGH | One scoping helper used by all six tools; pinned per tool with a two-member fixture (AC7) and a pin mutation. |
| A tool leaks a secret through a generic row dump (connector row, provider metadata) | HIGH | Build settings results field by field, as `GET /settings` does ("The body is built field by field: never a token, a key"); a test plants a fake secret in every stored place and asserts it never appears in any tool's result. |
| Calling `readAgentSettings` for an agent's settings creates `wright.json` or runs wa-c's upgrade from inside a tool | MEDIUM | Read raw through `readWrightToolPolicy` and `listAgents`; AC13's no-write test with `wright.json` absent. `GET /budget/usage`'s `rosterOf` can still run wa-c's audited upgrade, the same known limit wa-d records; state it in `docs/architecture/brain.md`. |
| A new import pulls the Agent SDK into the CLI graph | MEDIUM | `feature-seams.test.ts` SDK guard; import only modules `studio-view.ts` already imports or their siblings. |
| `GET /events` reads all events with no agent column; filtering by agent through `sessions` on a large log is slow | LOW | Page with `after`/`limit` (max as `MAX_EVENTS_LIMIT` = 500) and filter in the SQL join; never load the whole table. |
| The live Validation 2 ask cannot be run by the worker | LOW | AC16 records the static half from a read-only store copy; the live ask is the owner's step, as in wa-d. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-28-wa-e-studio-lookup-tools.md
```

## Plan Review
- **Decision:** PASS (attempt 2/3); requirement_fit: fulfils. Attempt 1 FAIL (HIGH: owner routes cannot filter/tail sessions, events, output) fixed by the revised Design decision.
- **Deferred LOW notes (for the worker):** (1) AC1/AC3 are newest first: page with a `before` id cursor (older rows), as AC2 does, and say so in AC10's constants; (2) AC4: `listApprovals({all: true})` caps decided rows at `MAX_DECIDED_LIST` (500) across agents — for a crew caller use a read-only per-agent SELECT of decided rows (same projection) so `remaining` is exact; (3) AC13's no-write claim covers the tools' own reads; `kernel_budget_usage` via `rosterOf` keeps wa-d's recorded known limit (wa-c's audited upgrade can run), stated in `docs/architecture/brain.md`; (4) Validation 2's live ask is the owner's step — name it in the PR test plan.

## Outcome
- **Status:** completed
- **Completed:** 2026-11-28T15:18:01Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/320
- **Branch:** feature/wa-e-studio-lookup-tools
- **Files changed:** 12
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Six read-only lookup tools (kernel_session_list, kernel_session_get, kernel_event_list, kernel_approval_list, kernel_budget_usage, kernel_settings_get) under new job look_up_studio in kernel/src/brain/studio-tools.ts; crew-scoped, paged, untrusted-wrapped, secret-free, no writes. Phase 4.5 round 1 PASS with one MEDIUM (stale guide sizes in brain.md) fixed in d6f82343; round 1's red ci was runner load (4 timeouts, 276s vs 138s on main), green on the fix head. Round 2 PASS; 4 LOW/nit dismissed. Pin mutations: script could not machine-apply any row; all 10 applied by hand across worker and reviewers, each failed its pin.

## Not verified
- **live ask to Wright on the owner's install (AC16 live half)** — the owner's step; the owner's data dir is read-only for the worker (subtask 1)
- **the six tools offered in a real SDK session with a model** — covered only by the SDK listing test (subtask 1)
- **app Team/charter display of the look_up_studio job** — no app runtime run; the app renders kernel-sent job labels (subtask 1)
