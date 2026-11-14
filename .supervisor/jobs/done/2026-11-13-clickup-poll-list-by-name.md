# Supervisor Job: A ClickUp poll names its list the way ClickUp reads it (phase 8 item 21a)

## Environment
- **Project:** loomwright-studio (lane checkout `automate-2026-11-13-223926/L1`)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-21/2026-11-13-221500-a-a-clickup-poll-names-its-list-the-way-clickup-reads-it.md
- **Base commit:** c240581d96706aec8b04496fa3040ede24c680cc

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel + vitest; no new dependency. |
| 2 | Dependency Availability | GO | ClickUp's connected server already lists a read-only name lookup (`clickup_get_list`, stored `read_only: true`, description "Use to resolve list names to IDs"), read from the connected row's stored tool list at plan time. The kernel's own ticket reader (`createMcpTicketReader`) already calls any listed tool. |
| 3 | Architecture Fit | GO | The kernel already reads ClickUp as its own due work with the owner's Keychain sign-in (D38, `trackers.ts`); a name lookup at draft time is one more call of the same reader. Tool names stay data in `MCP_TRACKERS`, checked against the stored tool list. |
| 4 | Scope vs Supervisor Capability | GO | ~13 files, mostly small edits plus tests and docs; single worker. |
| 5 | Hard Blockers | CAUTION | AC1's live probe reads the owner's Keychain sign-in from a scratch script (the 20g precedent). If the worker's environment cannot read the Keychain, the probe and the recorded lookup fixture cannot be made by the worker. Also: the plan needs files outside the requirement's Touches (a new test file and two recorded fixtures); see `## Scope widening` if present. |

**Overall Verdict:** CAUTION

## Task
**Goal:** A `clickup.tasks` poll that Wright drafts from the owner's words ("the Loomwright Studio list") stores that list's ClickUp ID and reads it; a filter that is not an ID is refused or reported as the filter, never as a broken connection.

**Problem Statement:**
The owner needs Wright to turn "the Loomwright Studio list" into a working ClickUp ticket poll, because the owner never handles kernel internals such as list IDs.
Currently `argsOf` in `kernel/src/triggers/sources/clickup-tasks.ts` sends `filters.list` to `clickup_filter_tasks` as `list_ids: [<value>]` unchecked, Wright's drafting text (`kernel_playbook_create`'s description in `kernel/src/playbooks/drafts.ts`) never says the filter must be an ID, and the dry run's fix line (`kernel/src/playbooks/dry-run-poll.ts`) leads with "Check the clickup connection in Integrations". Playbook 9 (`filters.list: "Loomwright Studio"`) failed every dry run (`mcp_tool_error`, runs 184 and 186) while the same list by ID read fine (run 183).
Success looks like: Wright drafts the poll from the list's name, the stored filter is the numeric ID, the dry run lists the open task tagged `studio-sandbox`, and a bad filter is named as the filter.

**Approach (kernel resolves, Wright never guesses):** the kernel, not Wright, turns a name into an ID, at `kernel_playbook_create` / `kernel_playbook_update` time, with its own ticket reader and the owner's sign-in (the same path a due poll uses; never inside a session, never under the per-agent grant, which Wright may not hold for ClickUp). The lookup tool's name is data in `MCP_TRACKERS`, checked against the connection's stored tool list like the listing tool. Exactly one match stores the ID; none or several refuse with a message that names the filter, the name and the count, so Wright asks the owner which. The parser (`checkClickupFilters`) refuses any `list`/`space` that is not an ID, so every other path (a stored spec, a dry run, a due fire) reports the filter by name. Rejected: telling Wright to look the ID up itself (needs an owner-only `connectors.clickup` grant on Wright and still trusts the model to copy the right ID); sending the name and guessing from the server's error (its text is untrusted and dropped by design).

## Acceptance Criteria
- [ ] **AC1 (probe, evidence-file form).** Given the owner's personal ClickUp connection, when a read-only probe (the 20g method: the kernel's own `readMcpCredential` + `callMcpTool` from a scratch script outside the repository; read-only tools only; token never printed) calls `clickup_filter_tasks` with `list_ids` set to the list's **name** and then to its **ID**, and calls the name-lookup tool(s) for a list name (`clickup_get_list` with `list_name`) and for a space name (whichever read-only tool the server lists for it), then a committed evidence file `docs/evidence/phase-8-21a-clickup-list-by-name.md` contains the probe script, the commands, the outcome of each call (`is_error` and the redacted answer shape; no task text, no token), whether IDs are digit-only, and what the lookup answers for one match, no match and (if reachable) several matches; and `docs/OPEN_QUESTIONS.md` records both `clickup_filter_tasks` answers, confirming or correcting the cause stated in the requirement. The PR body links to the evidence file.
- [ ] **AC2 (name → ID at draft).** Given a connected ClickUp connector whose stored tool list has the lookup tool, when Wright calls `kernel_playbook_create` or `kernel_playbook_update` with a `clickup.tasks` poll whose `filters.list` (or `filters.space`) is a name that matches exactly one list (space), then the stored trigger's spec holds that list's (space's) ID, not the name, and a dry run of it calls `clickup_filter_tasks` with `list_ids: [<that ID>]` (`space_ids` for a space). A value that is already an ID makes no lookup call. The owner never types or looks up an ID.
- [ ] **AC3 (non-ID refused or reported as the filter).** Given a `clickup.tasks` poll spec whose `list` or `space` is not an ID (e.g. stored before this change, or reaching the parser any other way), when it is created, updated or dry-run, then it is refused (`invalid_spec` from `checkClickupFilters`, surfaced by create/update as an error result, and by the dry run as `PlaybookError` `invalid_input` "the poll trigger N's stored spec cannot be read: …") with a message naming the filter key (`filters.list` / `filters.space`) and the value it holds, and never a fix line naming the connection or Integrations.
- [ ] **AC4 (no match or several: ask, never guess).** Given a list (space) name that matches no list, or more than one, when Wright creates or updates the poll, then the call is refused with an error result naming the filter, the name and how many matched (and, for several, the matching IDs only after they pass the ID check — never the server's names or other text), nothing is stored, and `kernel_playbook_create`'s description tells Wright to tell the owner and ask which list or space they mean rather than pick one. A lookup that fails (any `MCP_TICKET_FAILURES` code, including `tool_unavailable` when the stored tool list lacks the lookup tool) refuses naming the filter and that fixed code, never the server's text.
- [ ] **AC5 (tool error names the filters first).** Given a `clickup.tasks` dry run whose read fails `mcp_tool_error` while the connector is usable, then the `source_error` fix line names the poll's filters first (the scope `clickup:list/<id>` or `clickup:space/<id>` and the filter key) and only then the connection; the server's text is still never quoted. Every other failure code's fix line, and every GitHub fix line, is unchanged.
- [ ] **AC6 (docs).** Given the change, then `docs/architecture/mcp-connectors.md` §"Ticket sources" (the filter table, the definitions table, the dry-run paragraph) and `docs/architecture/triggers.md`'s `clickup.tasks` filter row say that `list`/`space` hold IDs, that a name given at draft time is resolved by the kernel with the named lookup tool, and how none/several/failed lookups are refused.
- [ ] **AC7 (Validation 1, static).** Given the branch, when `cd kernel && npm test` and `bash scripts/check-docs.sh` run, then both pass, and their result lines are recorded in `docs/evidence/phase-8-21a-clickup-list-by-name.md` under a `## Validation 1` heading with the declared line `Verdict: PASS for Validation 1`.
- [ ] **AC8 (Validation 2, running system — the owner's walk).** Given the packaged app, when the owner asks Wright for a ClickUp ticket playbook naming "the Loomwright Studio list" by name, then its dry run lists the open task tagged `studio-sandbox`; the evidence file carries a `## Validation 2` section with the walk's steps, and the line `Verdict: PASS for Validation 2` is written only by whoever actually ran the walk (never pre-filled by the worker).

## Scope widening
- kernel/test/clickup-scope.test.ts
- kernel/test/fixtures/mcp-trackers/clickup-lookup-responses.json
- kernel/test/fixtures/mcp-trackers/clickup-lookup-tools.json
- accepted: LP-SCOPE 2026-11-13

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Probe, resolve ClickUp names to IDs at draft time, refuse non-IDs, name the filter on a tool error | all | 9 modify, 4 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| ClickUp source | `kernel/src/triggers/sources/clickup-tasks.ts` (138) — home of the ID check in `checkClickupFilters` and of the new name resolver `resolveClickupNames` (the ClickUp source's own module) | — | HIGH |
| Tracker data | `kernel/src/integrations/mcp/trackers.ts` (138) — the lookup tool name(s) as data on the ClickUp definition | — | HIGH |
| Playbook tools | `kernel/src/playbooks/drafts.ts` (838 — the single authority for the playbook tools; only the description text and an awaited `resolveClickupNames` call in the create and update handlers land here, no resolver logic) | — | HIGH |
| Dry run | `kernel/src/playbooks/dry-run-poll.ts` (409) — the `mcp_tool_error` fix line | — | HIGH |
| Tests | `kernel/test/integrations-mcp-trackers.test.ts` (971 — home of the existing `parsePollSpec(clickupSpec(` parse pins; only the non-ID refusal pins land here), `kernel/test/playbooks-dry-run-poll.test.ts` (973 — home of the tracker dry-run fix-line pins and the only `h.create` tool-path rig; only the AC3/AC5 fix-line pins and the create/update tool-path cases land here) | `kernel/test/clickup-scope.test.ts` (the resolver's unit tests over a fake `McpTicketReader` and the recorded lookup fixtures) | HIGH |
| Fixtures | — | `kernel/test/fixtures/mcp-trackers/clickup-lookup-tools.json` (the recorded `tools/list` entry of each lookup tool, verbatim like `clickup-tools.json`), `kernel/test/fixtures/mcp-trackers/clickup-lookup-responses.json` (the recorded lookup answers, ids and names replaced by placeholders) | MEDIUM (exact shape set by the probe) |
| Docs | `docs/OPEN_QUESTIONS.md` (270), `docs/architecture/mcp-connectors.md` (197), `docs/architecture/triggers.md` (193) | `docs/evidence/phase-8-21a-clickup-list-by-name.md` | HIGH |

> **Validator-owned surfaces:** `scripts/check-docs.sh` scans every `docs/**/*.md`, `CLAUDE.md` and `README.md` for relative links: every link the new evidence file and the edited docs add must resolve.

**Total estimated files:** 9 modify + 4 create. The existing `kernel/test/fixtures/mcp-trackers/clickup-tools.json` is NOT modified (its pin `toEqual(["clickup_filter_tasks"])` and its "no other tool is listed" note stay true); the lookup tools get their own fixture.

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/playbooks/drafts.ts:381` | yes | HOLDS | `"for clickup.tasks give no repos and exactly one of filters.list or filters.space, with status, assignee and tags optional; " +` | tip 51 minutes ago, fetched <1h |
| `kernel/src/integrations/mcp/trackers.ts:129` | yes | HOLDS | `if (answer.is_error) return { ok: false, error: "mcp_tool_error" };` | tip 51 minutes ago, fetched <1h |
| `kernel/src/playbooks/dry-run-poll.ts:224` | yes | HOLDS | `` return incomplete(spec, "source_error", `${tracker.label} could not be read for ${fetched.repo}: ${code}. ${missing}Check the ${tracker.kind} connection i… `` | tip 51 minutes ago, fetched <1h |

## Touched-file invariants

> Grounded at base `c240581d96706aec8b04496fa3040ede24c680cc`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/triggers/sources/clickup-tasks.ts`** — keep: the spec refusal code `invalid_spec` and the one-of rule `"a clickup.tasks poll takes exactly one of filters.list or filters.space"` (a non-ID value is a new `TriggerError("invalid_spec", …)` naming `filters.list`/`filters.space` and the value, never a new error class or code; quote the value with `JSON.stringify` cut to the filter's 200-character bound — `kernel/src/triggers/poll.ts`'s `shown` is a private function outside this lane, so do not import or copy it); keep the tool argument names `list_ids: [filters.list]` / `space_ids: [filters.space]` in `argsOf`; keep failures as fixed codes (`readTickets(tickets, store, "clickup", MCP_TRACKERS.clickup.tool, …)` returns `client_error` with the scope as `repo`). reuse: `readTickets`/`objectOf`/`textOf` from `./tracker-shared.js` for the lookup call and its parse — never a second JSON-parsing helper; the ID rule is one exported constant `CLICKUP_SCOPE_ID` beside `CLICKUP_TASK_ID`. mirror: the lookup tool's name comes from `MCP_TRACKERS.clickup` (`trackers.ts`), never a string literal here. pinned by: `kernel/test/integrations-mcp-trackers.test.ts` (`expect(sent?.arguments).toEqual({ list_ids: ["901"], tags: ["studio"] });`).
- **`kernel/src/integrations/mcp/trackers.ts`** — keep: the server's failure text is never kept (`What the server says about a failure is never kept`; `if (answer.is_error) return { ok: false, error: "mcp_tool_error" };` stays as is); `MCP_TICKET_FAILURES` stays the closed nine-code set (no new code); `MCP_TRACKERS` stays `Object.freeze`d and the Jira entry gains no lookup. reuse: the existing `McpTrackerDefinition` shape, extended by one optional readonly field for the lookup tool name(s). mirror: `kernel/src/integrations/mcp/connector.ts` reads only `MCP_TRACKERS.<kind>.url` (`clickup: Object.freeze({ url: MCP_TRACKERS.clickup.url })`) — unchanged. pinned by: `kernel/test/integrations-mcp-trackers.test.ts` (`expect(MCP_TRACKERS.clickup.tool).toBe("clickup_filter_tasks");`, `expect(Object.isFrozen(MCP_TRACKERS)).toBe(true);`, and the closed-set pin `"mcp_tool_error",`).
- **`kernel/src/playbooks/drafts.ts`** — keep: the module's CLI-safe import rule (`The \`studio\` CLI loads this module`; never the Agent SDK, the session manager or `kernel.ts`; the triggers feature's own CLI-safe rule is stated in `kernel/src/triggers/index.ts`, and `kernel/src/triggers/poll.ts` already imports `createMcpTicketReader` from `../integrations/mcp/trackers.js`, so this adds no new reachable module) and update the header's import list to name the one new import (`../triggers/sources/clickup-tasks.js`, as `dry-run-poll.ts` names `../triggers/poll.js`); the reader is the default `createMcpTicketReader()` (lazy, as the dry-run tool path's `previewPoll` gets it when `deps.tickets` is absent), and `resolveClickupNames` takes the reader as a parameter so tests inject a fake; keep the idempotent step: the resolution runs before `runStep(` (`ctx.stepKey(a.idempotency_key)`) and only reads; a value that is already an ID skips the lookup (no call), and a repeat call that still carries the name re-resolves — if that lookup fails, the repeat is refused naming the filter and the fixed code (acceptable: nothing is written, and Wright retries or asks the owner); keep refusals as error results naming the field (`refusals are error results naming the field`) via `named`/`namedAsync` (switch the two handlers to `namedAsync("kernel_playbook_create", …)` / `namedAsync("kernel_playbook_update", …)`); keep the description substring `clickup.tasks give no repos and exactly one of filters.list or filters.space` and add the sentence `filters.list and filters.space are ClickUp IDs` plus the name-resolution and ask-the-owner guidance. reuse: `storeTrigger` output (`{ kind, spec: text }`) as the resolver's input — resolve the JSON text, never re-parse the zod input twice. pinned by: `kernel/test/playbooks-dry-run-poll.test.ts` (`expect(description).toContain("clickup.tasks give no repos and exactly one of filters.list or filters.space");`).
- **`kernel/src/playbooks/dry-run-poll.ts`** — keep: the fix never quotes server text (`The message is the kernel's own fixed code, never the server's text`); the `tool_unavailable` sentence (`The ${tracker.kind} connector's tool list lacks`) and every other code's sentence (`Check the ${tracker.kind} connection in Integrations and the poll's filters, then dry-run again.`) unchanged; the new `mcp_tool_error` branch is selected by the literal `code === "mcp_tool_error"` and its sentence is built from kernel data only (`fetched.repo`, the spec's filter keys). pinned by: `kernel/test/playbooks-dry-run-poll.test.ts` (`expect(fix).toContain("ClickUp could not be read for clickup:list/901: mcp_timeout. Check the clickup connection");` and `expect(fix.startsWith("ClickUp could not be read for clickup:list/901: tool_unavailable. ")).toBe(true);`).
- **`kernel/test/integrations-mcp-trackers.test.ts`, `kernel/test/playbooks-dry-run-poll.test.ts`** — keep: no test reaches a vendor address or the Keychain (`A reader that records its calls and answers`; tracker reads go through a fake `McpTicketReader` or the fake MCP server); every existing clickup spec value stays digit-only (`{ list: "901" }`, `{ space: "55" }`). A tool-path create with a name runs against a connected row whose stored tool list lacks the lookup tool, so the reader refuses `tool_unavailable` before any Keychain read.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/integrations-mcp-trackers.test.ts` — `filters.list` holding a name is refused `invalid_spec` naming the filter and value | flip `/^[0-9]{1,30}$/` → `/^.{1,200}$/` in `kernel/src/triggers/sources/clickup-tasks.ts` |
| `kernel/test/clickup-scope.test.ts` — one match: the spec's `list` becomes the matched ID | make `resolveClickupNames` return the spec text unchanged after a single match (reviewer applies) |
| `kernel/test/clickup-scope.test.ts` — several matches refuse naming the count, never pick one | make `resolveClickupNames` take the first match when several match (reviewer applies) |
| `kernel/test/clickup-scope.test.ts` — an ID-valued spec makes no lookup call | remove the `CLICKUP_SCOPE_ID` short-circuit in `resolveClickupNames` so every value is looked up (reviewer applies) |
| `kernel/test/playbooks-dry-run-poll.test.ts` — `mcp_tool_error` fix line names the filters first | flip `code === "mcp_tool_error"` → `code === "mcp_tool_error_x"` in `kernel/src/playbooks/dry-run-poll.ts` |
| `kernel/test/playbooks-dry-run-poll.test.ts` — the create description says the filters are IDs | flip `filters.list and filters.space are ClickUp IDs` → `filters.list and filters.space are names` in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/playbooks-dry-run-poll.test.ts` — create with a name resolves before storing (tool path; refusal names `filters.list` and `tool_unavailable` when the lookup tool is missing) | delete the awaited `resolveClickupNames(` call in the create handler of `kernel/src/playbooks/drafts.ts` (reviewer applies) |
| `kernel/test/playbooks-dry-run-poll.test.ts` — update with a name resolves before storing (tool path; same refusal as create, nothing stored, version unchanged) | delete the awaited `resolveClickupNames(` call in the update handler of `kernel/src/playbooks/drafts.ts` (reviewer applies) |
| `kernel/test/clickup-scope.test.ts` — no match refuses naming the filter, the name and the count 0 | make `resolveClickupNames` return the spec text unchanged (name kept) when nothing matches (reviewer applies) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/triggers/sources/clickup-tasks.ts", name: "resolveClickupNames"}
  - {kind: "symbol", path: "kernel/src/triggers/sources/clickup-tasks.ts", name: "CLICKUP_SCOPE_ID"}
  - {kind: "file", path: "kernel/test/clickup-scope.test.ts"}
  - {kind: "file", path: "kernel/test/fixtures/mcp-trackers/clickup-lookup-tools.json"}
  - {kind: "file", path: "kernel/test/fixtures/mcp-trackers/clickup-lookup-responses.json"}
  - {kind: "file", path: "docs/evidence/phase-8-21a-clickup-list-by-name.md"}
  - {kind: "symbol", path: "docs/evidence/phase-8-21a-clickup-list-by-name.md", name: "Validation 1"}
requires: []
lanes:
  - "kernel/src/triggers/sources/clickup-tasks.ts"
  - "kernel/src/integrations/mcp/trackers.ts"
  - "kernel/src/playbooks/drafts.ts"
  - "kernel/src/playbooks/dry-run-poll.ts"
  - "kernel/test/integrations-mcp-trackers.test.ts"
  - "kernel/test/playbooks-dry-run-poll.test.ts"
  - "kernel/test/clickup-scope.test.ts"
  - "kernel/test/fixtures/mcp-trackers/clickup-lookup-tools.json"
  - "kernel/test/fixtures/mcp-trackers/clickup-lookup-responses.json"
  - "docs/OPEN_QUESTIONS.md"
  - "docs/architecture/mcp-connectors.md"
  - "docs/architecture/triggers.md"
  - "docs/evidence/phase-8-21a-clickup-list-by-name.md"
external_requires:
  - "The owner's personal ClickUp connection (mcp_connections row clickup, connected) and its Keychain sign-in, for the AC1 read-only probe only"
  - "ClickUp's hosted MCP server https://mcp.clickup.com/mcp: clickup_filter_tasks and a read-only name-lookup tool (clickup_get_list; a space lookup the probe names)"
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
| Feasibility (Phase 2.5): the AC1 probe needs the owner's Keychain sign-in; a worker environment that cannot read it cannot probe or record the lookup fixtures. | HIGH | Do the probe FIRST. If the Keychain read fails, stop and report BLOCKED with the probe script ready for the owner to run; never author a lookup response shape or fixture from documentation or guesswork (CLAUDE.md "Verify before asserting"). |
| The lookup tool's answer shape (one match, no match, several matches) and whether a space has a read-only name lookup are unknown until the probe; the connected row's stored list (58 tools) has `clickup_get_list` but no space lookup was seen in it. | MEDIUM | Build the resolver on the recorded answers only. If the stored tool list lacks a space lookup, a space name is refused naming `filters.space` and `tool_unavailable` (reconnecting ClickUp re-reads the list); record that in the evidence and `docs/OPEN_QUESTIONS.md`. |
| Tightening `checkClickupFilters` makes any stored spec holding a name unreadable: its dry run reports `invalid_input`, and a due fire parks the poll (`parkPoll`, "parked: no next fire"). | LOW | Intended (those polls never read anything). Playbook 9 is a draft; the owner re-drafts it through Wright. Note it in the evidence file. |
| Several matches: returning server names to Wright would put untrusted text in a tool result. | MEDIUM | The refusal names only the filter, the owner's name as given, the count and digit-checked IDs; never the server's names, paths or other text. |
| One extra ClickUp call per draft with a name; a list renamed after drafting keeps its ID. | LOW | The lookup runs only when the value is not already an ID, and only at create/update. |
| Files outside the requirement's Touches: `kernel/test/clickup-scope.test.ts` and the two lookup fixtures. | LOW | Keeps new tests out of the two 970-line test files (module layout) and keeps `clickup-tools.json` and its pins unchanged. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-13-clickup-poll-list-by-name.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-13T18:25:51Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/275
- **Branch:** feature/clickup-poll-list-by-name
- **Files changed:** 13
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 1
- **Heal reason:** needs_human
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Kernel refuses non-ID ClickUp list/space filters (invalid_spec naming the filter) and resolves a list name to its ID with clickup_get_list at kernel_playbook_create/update; space names refused tool_unavailable; mcp_tool_error dry-run fix line names the filters first; probe evidence + Validation 1 PASS recorded. Round 1 MEDIUM docs-heading fix (140076a6) held on re-review. Escalated: AC4's several-matches clause is not detectable with the callable ClickUp tools (clickup_get_list returns the first match; the hierarchy tool's 31-char proxy name is dropped at connect) — owner to amend AC4 or pick a follow-up. Validation 2 (owner walk) not run.

## Not verified
- **Several same-named ClickUp lists** — a read-only probe cannot create a duplicate; the server's own description says the first match is returned (subtask 1)
- **A list inside a folder, multiple ClickUp workspaces, a space the sign-in cannot read** — the probed workspace has none (subtask 1)
- **Validation 2 (the owner's walk in the packaged app)** — not run; the verdict line is left unfilled (subtask 1)
