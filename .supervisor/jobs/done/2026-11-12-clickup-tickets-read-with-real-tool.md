# Supervisor Job: ClickUp tickets are read with a tool ClickUp actually has (phase 8 item 20g)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-12-180247/L3
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (the source requirement is gitignored under `.supervisor/*`, so its provenance is not committed)
- **Source requirement:** .supervisor/requirements/phase-8-20/2026-11-12-170445-g-clickup-tickets-are-read-with-a-tool-clickup-has.md
- **Base commit:** cfb3d428d99db7dcd83ab2c77c5d972738ab7500

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel with vitest; the change is data in `MCP_TRACKERS`, the ClickUp source's argument and parse functions, a dry-run message, fixtures and docs. |
| 2 | Dependency Availability | GO | No new dependency. The kernel's own `callMcpTool` (`kernel/src/integrations/mcp/client.ts`) and `readMcpCredential` already reach ClickUp's hosted server. |
| 3 | Architecture Fit | GO | The tool name is already data in one place (`MCP_TRACKERS`), checked against the connection's stored tool list before any call (invariant 3). |
| 4 | Scope vs Supervisor Capability | GO | One worker: 12 modify (1 conditional) + 2 create, not past the `context-bound` threshold. |
| 5 | Hard Blockers | CAUTION | The real tool's input and response shape are only known from a live read-only probe of the owner's personal ClickUp (Keychain sign-in, store row under `~/.loomwright-studio`). If the worker cannot run the probe, it must stop and report, never guess a shape. The plan also needs files outside the requirement's Touches (see `## Scope widening`). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Make the `clickup.tasks` poll and its dry run call the tool ClickUp's hosted MCP server really lists, mapped from a recorded live probe, and make a missing tool's refusal name the tool and the connector.

**Problem Statement:**
The owner needs a ClickUp ticket playbook to list the tasks on a list so that ClickUp tickets become PRs the way GitHub issues do.
Currently, `MCP_TRACKERS.clickup.tool` is the authored, unverified `get_workspace_tasks`, which ClickUp's server does not list. Playbook 8's dry runs 155 and 157 (phase 8 exit live run, 2026-11-12) failed `tool_unavailable` with ClickUp connected. The connected row's `mcp_connections.granted_tools` lists `clickup_filter_tasks`, `clickup_search` and `clickup_get_task`.
Success looks like a ClickUp ticket playbook's dry run listing "Add a README to studio-sandbox" (tag `studio-sandbox`).

## Acceptance Criteria
- [ ] **AC1 (probe recorded).** Given the owner's personal ClickUp connected in the running Studio, when a read-only probe runs, then the following hold. (a) The listing tool's real name (expected `clickup_filter_tasks`), its input schema for a list and tags, and one real response's shape are recorded in `docs/OPEN_QUESTIONS.md`. The input schema comes from the ClickUp row's stored `granted_tools` `schema`. The response is one live call with a list id and a tag. The response shape is recorded with task text redacted to field names and types. (b) The same commands, values and observed field names are in the committed evidence file `docs/evidence/phase-8-20g-clickup-reader.md`, and the PR body links to it. (c) The ClickUp NEEDS VERIFICATION notes are removed: the comments in `kernel/src/integrations/mcp/trackers.ts` and `kernel/src/triggers/sources/clickup-tasks.ts`, the fixture `_note` in `kernel/test/fixtures/mcp-trackers/clickup-tools.json`, and the ClickUp bullets in `docs/architecture/mcp-connectors.md` (the table cell, the "NEEDS VERIFICATION: ClickUp's tool name and response shape" paragraph, and the open-points bullet). The probe never writes to ClickUp and never touches the work (Tray) account.
- [ ] **AC2 (poll calls the real tool and maps tasks).** Given a `clickup.tasks` poll with `filters.list` and `filters.tags`, when it fires or its playbook is dry-run, then:
  - `MCP_TRACKERS.clickup.tool` is the probed tool name.
  - `argsOf` sends the list and tags under the argument names the probed `inputSchema` declares.
  - `itemOf` maps each task in the probed response shape to a `SourceItem`: `ref` `clickup:<id>`, `title`, `text` (body), `url` (link) and `revision`/`updated_at`.
  - An off-shape entry is still dropped, and the kernel's case-insensitive tag re-check still applies.
  - `kernel/test/fixtures/mcp-trackers/clickup-tools.json` is the recorded tool list entry for that tool, with no invented tools. A response fixture recorded from the probe (ids and text replaced with neutral placeholders) drives a test in `kernel/test/integrations-mcp-trackers.test.ts` that asserts the mapped items field by field.
- [ ] **AC3 (missing tool is named).** Given a ClickUp connection whose stored tool list lacks the listing tool, when the poll's dry run runs, then the refusal is still `source_error` with code `tool_unavailable` (the existing prefix `ClickUp could not be read for clickup:list/901: tool_unavailable. ` is unchanged), no call is made, and the fix text also names the tool (`MCP_TRACKERS.clickup.tool`, kernel data, never server text) and the connector (`clickup`), telling the owner to reconnect ClickUp in Integrations. A test in `kernel/test/playbooks-dry-run-poll.test.ts` asserts the tool name and the connector appear.
- [ ] **AC4 (Jira checked the same way, or marked not exercised).** Given Jira (`searchJiraIssuesUsingJql`), when this item closes, then `docs/OPEN_QUESTIONS.md` records Jira's tool name check as `not_exercised` explicitly, because Jira is the owner's work account and is never connected or called live. The record also says the name comes from Atlassian's supported-tools page. `MCP_TRACKERS.jira` is unchanged.
- [ ] **AC5 (suite green, every consumer of the old name moved).** Given the change, when `cd kernel && npm test` runs, then it passes. That covers the trackers tests, the dry-run poll tests and `kernel/test/phase-8-exit.test.ts`, which loads `clickup-tools.json`, fakes the server's answer and asserts the listing tool's name. The phase 8 exit e2e (`app/e2e/fixtures/phase-8-exit.ts`, `app/e2e/phase-8-exit.spec.ts`) is updated to the probed tool name, argument names and response shape. `CLICKUP_LIST_TOOL` is read from the recorded fixture's listing tool instead of a second literal. After the change, `grep -rn get_workspace_tasks kernel app/e2e docs/architecture` finds nothing. `kernel/test/playbooks-fit.test.ts`'s `clickup: ["get_workspace_tasks"]` grant is the one allowed exception: it is an opaque grant string that `fit.ts` never compares to `MCP_TRACKERS`, so it may stay or be renamed to the probed name. `bash scripts/check-docs.sh` passes. A committed evidence file `docs/evidence/phase-8-20g-clickup-reader.md` has a `## Phase 8 exit e2e` section. It holds either the exact command run with its result, or `not run` with the reason (for example, no packaged app or Playwright in the worker's environment). The PR body links to that file.
- [ ] **AC6 (Validation 2, running system).** Given the PR head built and running (packaged app and kernel service, as in phase 8's walks), when a ClickUp ticket playbook (list `901422761392`, tag `studio-sandbox`) is dry-run, then it lists "Add a README to studio-sandbox". The run's fenced output is recorded in `docs/evidence/phase-8-20g-clickup-reader.md` under `## Validation 2` with the column-0 line `Verdict: PASS for Validation 2`. That line is written only from the observed run (by the owner, or by Claude driving the app at the owner's request), never pre-filled by the worker. **Owner-closed after the PR opens:** the worker's part of AC6 is only the evidence file's `## Validation 2` section listing the owner's steps. Phase 4.5's diff review does not count the missing verdict against the worker.

## Scope widening
- kernel/src/triggers/sources/clickup-tasks.ts
- kernel/test/fixtures/mcp-trackers/clickup-tools.json
- kernel/test/fixtures/mcp-trackers/clickup-filter-tasks-response.json
- kernel/src/playbooks/dry-run-poll.ts
- kernel/test/playbooks-dry-run-poll.test.ts
- kernel/src/triggers/sources/tracker-shared.ts
- kernel/test/phase-8-exit.test.ts
- app/e2e/fixtures/phase-8-exit.ts
- app/e2e/phase-8-exit.spec.ts
- accepted: AUT-OVERLAP 2026-11-13

## Touched-file invariants

> Grounded at base `cfb3d428d99db7dcd83ab2c77c5d972738ab7500`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/integrations/mcp/trackers.ts`** — keep: the stored-tool check before any call, `if (!storedToolsOf(row.granted_tools).some((t) => t.name === tool)) return { ok: false, error: "tool_unavailable" };`. Keep the closed failure set `MCP_TICKET_FAILURES` unchanged (no new code). Keep "Nothing here logs." and the import rule "never `connector.ts` (which imports this file)". Keep the Jira entry `tool: "searchJiraIssuesUsingJql"` and both `url` values unchanged. mirror: `kernel/src/integrations/mcp/connector.ts` fills `MCP_SERVERS` from it (`clickup: Object.freeze({ url: MCP_TRACKERS.clickup.url })`), and the URL does not change. pinned by: `kernel/test/integrations-mcp-trackers.test.ts` (`"tool_unavailable",` in the failure-set list, and `expect(MCP_SERVERS).toEqual(`).
- **`kernel/src/triggers/sources/clickup-tasks.ts`** — keep: `CLICKUP_TASK_ID` and its use `if (typeof id !== "string" || !CLICKUP_TASK_ID.test(id)) return undefined;`, the drop-not-guess rule for a task with no usable id or updated time, and the kernel's own tag re-check `filters.tags.every((tag) => carried.has(tag.toLowerCase()))`. reuse: `readTickets(tickets, store, "clickup", MCP_TRACKERS.clickup.tool` and the `tracker-shared.ts` helpers (`textOf`, `urlOf`, `updatedOf`, `statusOf`, `orderItems`). Never add a parallel parser. mirror: `checkClickupFilters` (the spec's `list`/`space`/`status`/`assignee`/`tags` keys and `poll.ts`'s `"clickup.tasks": ["list", "space", "status", "assignee", "tags"]`) stays the owner-facing filter set. Only the tool-side argument names in `argsOf` change. pinned by: `kernel/test/integrations-mcp-trackers.test.ts` (`import { CLICKUP_TASK_ID, fetchClickupTasks } from "../src/triggers/sources/clickup-tasks.js";`).
- **`kernel/src/triggers/sources/tracker-shared.ts`** (only if the probed response is not a bare array or `{<key>: [...]}` JSON) — keep: `readTickets` returns only fixed codes (`return failure(scope, "mcp_protocol");`), never the server's text. Keep it shared with `jira-issues.ts`: any change must leave Jira's `readTickets(..., "issues", ...)` behaviour byte-identical.
- **`kernel/src/playbooks/dry-run-poll.ts`** — keep: `// The message is the kernel's own fixed code, never the server's text; anything else is shown as the closed \`client_error\`.` and the existing fix prefix built by `` `${tracker.label} could not be read for ${fetched.repo}: ${code}. `` (the added tool/connector sentence comes after it and uses only kernel data: `MCP_TRACKERS[tracker.kind].tool`, `tracker.kind`, `tracker.label`). Keep the GitHub branch's text unchanged. Keep the header comment's import list true: it names what comes from trackers ("the ticket reader's failure codes and type (`../integrations/mcp/trackers.js`)"), so when `MCP_TRACKERS` is imported, the comment adds it. The phrase wraps across two lines; grep its second line, `type (\`../integrations/mcp/trackers.js\`)`. pinned by: `kernel/test/playbooks-dry-run-poll.test.ts` (`expect(fix.startsWith("ClickUp could not be read for clickup:list/901: tool_unavailable. ")).toBe(true);`).
- **`kernel/test/fixtures/mcp-trackers/clickup-tools.json`** — keep: the `"server": "https://mcp.clickup.com/mcp"` key and the `tools[]` entry shape (`name`, `description`, `inputSchema`, `annotations`) that `fixture("clickup")` in the trackers test reads. Replace `_note` with a "RECORDED from the live server on <date>" note naming the probe. mirror: two other readers load this file, and both move with it: `kernel/test/phase-8-exit.test.ts` (`./fixtures/mcp-trackers/clickup-tools.json`) and `app/e2e/fixtures/phase-8-exit.ts` (`../../../kernel/test/fixtures/mcp-trackers/clickup-tools.json`).
- **`kernel/test/integrations-mcp-trackers.test.ts`** — existing pins on the old name and arguments change to the probed facts: `expect(sent?.name).toBe("get_workspace_tasks");`, `expect(sent?.arguments).toEqual({ list_ids: ["901"], tags: ["studio"] });` and the `reader.calls` case with `statuses: ["open"], assignees: ["ann"]`. keep: the `tool_unavailable` case asserting no call and no Keychain read (`a tool missing from the row's stored list is source_error tool_unavailable, with no call and no Keychain read`), the Jira cases unchanged, and no test reaching a vendor address.
- **`kernel/test/playbooks-dry-run-poll.test.ts`** — existing pins change: the stored `listTool` row (`proxy: "kernel_mcp_r_clickup_get_workspace_tasks"`) and `expect(tickets.calls).toEqual([{ tool: "get_workspace_tasks", args: { list_ids: ["901"], tags: ["studio"] } }]);`. keep: the `tool_unavailable` case's prefix pin, and that no call is made when the tool is missing.
- **`kernel/test/phase-8-exit.test.ts`** — keep: the test's one-`tools/call`-per-fire assertion, with its name changed to the probed tool (`expect(mcp.mcpCalls.filter((m) => m.method === "tools/call").every((m) => m.name === "get_workspace_tasks")).toBe(true);`). The fake server's answer (`tasks: [{ id, name, description, status, url, date_updated }]`, or the probed equivalent) moves to the probed response shape, and the crew grant `clickup: ["get_workspace_tasks"]` moves to the probed name. The walk's other assertions stay unchanged.
- **`app/e2e/fixtures/phase-8-exit.ts` / `app/e2e/phase-8-exit.spec.ts`** — keep: the fake ClickUp server answers only the listing tool, and the spec asserts one listing call per fire with the poll's filters. Change: `const CLICKUP_LIST_TOOL = "get_workspace_tasks";` is derived from the fixture, and the fake answer `{ tasks: [CLICKUP_TASK_ROW] }` moves to the probed shape. The spec's grant `clickup:get_workspace_tasks` and its assertion `c.name === "get_workspace_tasks" && JSON.stringify(c.arguments) === JSON.stringify({ list_ids: ["901"] })` move to the probed name and argument names.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/integrations-mcp-trackers.test.ts` — `MCP_TRACKERS.clickup.tool` equals the probed name | flip the probed tool name in `MCP_TRACKERS.clickup` in `kernel/src/integrations/mcp/trackers.ts` back to `get_workspace_tasks` |
| `kernel/test/integrations-mcp-trackers.test.ts` — the recorded-response mapping test (ref, title, text, url, revision) | flip the task-name key read by `itemOf` (`task["name"]` or the probed equivalent) to another key in `kernel/src/triggers/sources/clickup-tasks.ts` |
| `kernel/test/integrations-mcp-trackers.test.ts` — the call's arguments carry the list id and tags under the probed names | flip the list argument name in `argsOf` in `kernel/src/triggers/sources/clickup-tasks.ts` (for example to `list_id_x`) |
| `kernel/test/phase-8-exit.test.ts` — the walk's `tools/call` name equals the probed tool | flip the probed tool name in `MCP_TRACKERS.clickup` in `kernel/src/integrations/mcp/trackers.ts` to `get_workspace_tasks` |
| `kernel/test/playbooks-dry-run-poll.test.ts` — the dry run's `tickets.calls` carry the probed tool and argument names | flip the list argument name in `argsOf` in `kernel/src/triggers/sources/clickup-tasks.ts` (for example to `list_id_x`) |
| `app/e2e/phase-8-exit.spec.ts` — every ClickUp call has the probed name and the poll's list argument | flip the probed tool name in `MCP_TRACKERS.clickup` in `kernel/src/integrations/mcp/trackers.ts` to `get_workspace_tasks` |
| `kernel/test/playbooks-dry-run-poll.test.ts` — the `tool_unavailable` fix names the tool and the `clickup` connector | delete the line in `kernel/src/playbooks/dry-run-poll.ts` that appends the tool/connector sentence for `tool_unavailable` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Probe ClickUp, switch the reader to the real tool, name the missing tool, record it | AC1–AC6 | 12 modify (1 conditional), 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

**Order inside the subtask (one worker):**
1. **Probe first, read-only.** Read the ClickUp row's `granted_tools` from the running Studio's store under `~/.loomwright-studio` (open the SQLite file read-only, never write it). Record the listing tool's `name`, `read_only` and `schema`. Then make one live call of that tool with list `901422761392` and tag `studio-sandbox`. Use a scratch script outside the repo that imports the built kernel's `readMcpCredential` and `callMcpTool`. Record the response's field names and types. Never print or commit the access token, and never write to ClickUp. If the store, Keychain or server cannot be reached, stop and report `blocked` with what was tried; never author a shape.
2. Update `MCP_TRACKERS.clickup.tool`, `argsOf` and `itemOf` (and `readTickets` only if the probed text is not JSON of the current forms) to the probed facts. Update the fixtures and every consumer of the old name and shape: the trackers and dry-run tests, `kernel/test/phase-8-exit.test.ts` and the phase 8 exit e2e fixture and spec.
3. Add the tool/connector sentence to the dry-run `tool_unavailable` fix and its test.
4. Update `docs/OPEN_QUESTIONS.md` (ClickUp resolved with the probe record; Jira `not_exercised`), `docs/architecture/mcp-connectors.md` (table, ticket-sources paragraph, the dry-run example sentence if its text changes, open points), and create `docs/evidence/phase-8-20g-clickup-reader.md` with the probe record and an empty `## Validation 2` section listing the owner's steps.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/integrations/mcp/trackers.ts", name: "MCP_TRACKERS"}
  - {kind: "symbol", path: "kernel/src/triggers/sources/clickup-tasks.ts", name: "fetchClickupTasks"}
  - {kind: "file", path: "kernel/test/fixtures/mcp-trackers/clickup-tools.json"}
  - {kind: "file", path: "kernel/test/fixtures/mcp-trackers/clickup-filter-tasks-response.json"}
  - {kind: "file", path: "docs/evidence/phase-8-20g-clickup-reader.md"}
  - {kind: "symbol", path: "docs/evidence/phase-8-20g-clickup-reader.md", name: "Validation 2"}
  - {kind: "symbol", path: "docs/evidence/phase-8-20g-clickup-reader.md", name: "Phase 8 exit e2e"}
requires: []
lanes:
  - "kernel/src/integrations/mcp/trackers.ts"
  - "kernel/src/triggers/sources/clickup-tasks.ts"
  - "kernel/src/triggers/sources/tracker-shared.ts"
  - "kernel/src/playbooks/dry-run-poll.ts"
  - "kernel/test/integrations-mcp-trackers.test.ts"
  - "kernel/test/playbooks-dry-run-poll.test.ts"
  - "kernel/test/fixtures/mcp-trackers/clickup-tools.json"
  - "kernel/test/fixtures/mcp-trackers/clickup-filter-tasks-response.json"
  - "kernel/test/phase-8-exit.test.ts"
  - "app/e2e/fixtures/phase-8-exit.ts"
  - "app/e2e/phase-8-exit.spec.ts"
  - "docs/OPEN_QUESTIONS.md"
  - "docs/architecture/mcp-connectors.md"
  - "docs/evidence/phase-8-20g-clickup-reader.md"
external_requires:
  - "ClickUp's hosted MCP server (https://mcp.clickup.com/mcp), reached read-only with the owner's personal ClickUp sign-in from the Keychain"
  - "The running Studio's store under ~/.loomwright-studio holding the connected ClickUp row's granted_tools"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | — | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel reader | `kernel/src/integrations/mcp/trackers.ts` (137), `kernel/src/triggers/sources/clickup-tasks.ts` (136), `kernel/src/triggers/sources/tracker-shared.ts` (161, only if the probed text is not JSON of the current forms) | — | HIGH / HIGH / LOW |
| dry-run refusal | `kernel/src/playbooks/dry-run-poll.ts` (405) | — | HIGH |
| tests and fixtures | `kernel/test/integrations-mcp-trackers.test.ts` (933 — appending to the one existing home for the ClickUp source's tests, beside its fixture loader), `kernel/test/playbooks-dry-run-poll.test.ts` (942 — appending one case beside the existing `tool_unavailable` dry-run case it extends), `kernel/test/fixtures/mcp-trackers/clickup-tools.json` (32), `kernel/test/phase-8-exit.test.ts` (901 — edits in place to the existing ClickUp fake and pin; no new responsibility) | `kernel/test/fixtures/mcp-trackers/clickup-filter-tasks-response.json` | HIGH |
| phase 8 exit e2e | `app/e2e/fixtures/phase-8-exit.ts` (572 — edits in place: the tool constant is derived from the fixture, and the fake answer's shape changes; no new responsibility), `app/e2e/phase-8-exit.spec.ts` (830 — edits in place to the grant and the call assertion) | — | HIGH |
| docs | `docs/OPEN_QUESTIONS.md` (264), `docs/architecture/mcp-connectors.md` (197) | `docs/evidence/phase-8-20g-clickup-reader.md` | HIGH |

**Module layout:** no new module. Each new responsibility extends its existing single home: the tool name stays in `MCP_TRACKERS`, argument building and task mapping stay in `clickup-tasks.ts`, and the refusal text stays in `dry-run-poll.ts`'s tracker branch. The two large test files get appended cases only, each beside the cases it extends (reasons in the map). No helper is copied: reuse `tracker-shared.ts`.

**Validator-owned surfaces:** `scripts/check-docs.sh` scans every relative markdown link in `docs/`, so links added to the evidence file and to `mcp-connectors.md` must resolve.

**Consumers checked:** `grep -rn "get_workspace_tasks\|clickup-tools\|list_ids" kernel/test app/e2e app/src` at base. The hits are trackers test 450/451/500, dry-run-poll test 766/807, phase-8-exit test 446/601/702, the fixture, e2e fixture 10/218/220 and e2e spec 450/550/553 (all in the map), plus `kernel/test/playbooks-fit.test.ts` 479. That last one is an opaque grant string `fit.ts` never compares to `MCP_TRACKERS`, so it needs no change.

**Total estimated files:** 12 modify (1 conditional) + 2 create.

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/integrations/mcp/trackers.ts:50` | yes | HOLDS | `clickup: Object.freeze({ url: "https://mcp.clickup.com/mcp", tool: "get_workspace_tasks", label: "ClickUp" }),` | tip 6 hours ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The live probe cannot run from the worker: the Keychain prompts, the store is locked, or the sign-in has lapsed (source: Feasibility (Phase 2.5)) | HIGH | Probe first, before any code edit. On failure, stop with `blocked` and name what was tried. Never author a tool name, argument name or response shape. |
| The work and the plan touch files outside the requirement's Touches: the ClickUp source, the fixtures, the dry-run refusal and its test (source: Feasibility (Phase 2.5)) | MEDIUM | Listed in `## Scope widening` with `decision: pending-coordinator` for the coordinator's re-gate. |
| `clickup_filter_tasks` answers in text that is not JSON, or nests tasks under an unexpected key, so `readTickets` returns `mcp_protocol` | MEDIUM | Record the raw shape in the probe. Adapt `readTickets` only if needed, and keep Jira's path byte-identical (its tests must stay green unchanged). |
| The phase 8 exit e2e cannot run in the worker's environment (packaged app / Playwright) | MEDIUM | Update it in step with the kernel test. Run it when possible. Either way, record the command and result, or `not run` and why, in the evidence file's `## Phase 8 exit e2e` section. The owner's Validation 2 walk covers the live path. |
| A secret or a task's private text leaks into a commit: the token, or the real task body in the response fixture or evidence | HIGH | Redact the response to field names and types. Use neutral placeholder ids and text in the fixture, and never echo the credential. `docs/evidence` holds only what the AC lists. |
| The dry run's tool name is model-visible text | LOW | It is the kernel's own constant (`MCP_TRACKERS`), never server text, so invariant 3 holds. |
| ClickUp renames tools again | LOW | The refusal now names the tool and the connector, so the owner sees which tool to reconnect for. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-12-clickup-tickets-read-with-real-tool.md
```

## Plan Review: PASS (attempt 3/3)
- Attempt 1 FAIL: the plan missed consumers of the old tool name (`kernel/test/phase-8-exit.test.ts`, the phase 8 exit e2e). Fixed.
- Attempt 2 FAIL: the e2e not-run result could be recorded only in the PR body (Criterion 20). Moved to the evidence file. Pin rows added.
- Attempt 3 PASS, `requirement_fit: fulfils`. Open LOW note: AC5's literal `grep -rn get_workspace_tasks kernel app/e2e docs/architecture` would still hit the allowed `kernel/test/playbooks-fit.test.ts` grant. Apply it as `... | grep -v kernel/test/playbooks-fit.test.ts`, or rename that grant to the probed name.
- Saved by the `auto` tier of the LP-SAVE-NOTE gate (max severity LOW). Scope widening is pending the coordinator's re-gate.

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-13T05:46:48Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/271
- **Branch:** feature/clickup-tickets-read-with-real-tool
- **Files changed:** 13
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 0
- **Heal reason:** needs_human
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** A read-only live probe found the real ClickUp listing tool, `clickup_filter_tasks`. The reader, the fixtures, the tests, the phase 8 exit e2e and the docs now use it, and the `tool_unavailable` fix names the tool and the `clickup` connector. In the Phase 4.5 review, AC1, AC3, AC4 and AC5 passed, all six pin mutations the reviewer applied were caught, and required CI is green. It escalated one owner decision: ClickUp items now carry no body `text`, because `clickup_filter_tasks` returns none, while AC2 lists `text (body)`.

## Not verified
- **Validation 2: a dry run in the packaged app lists "Add a README to studio-sandbox"**: owner-closed after the PR opens; it needs the built service and app (subtask 1).
- **A tool_unavailable refusal against a live ClickUp row that lacks the tool**: needs a connection without the tool; only tests on an empty stored tool list cover it (subtask 1).
