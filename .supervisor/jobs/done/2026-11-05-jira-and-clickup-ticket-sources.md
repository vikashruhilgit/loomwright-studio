# Supervisor Job: Jira and ClickUp connectors and their ticket poll sources (phase 8 item 07)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-02-150636/L8 (Loomwright Studio)
- **CLAUDE.md:** ✓ Found (fresh: phases and invariants match the code at base)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8/2026-11-02-160007-jira-and-clickup-connectors-and-ticket-sources.md
- **Base commit:** 1a1cc2785cf06d4f248116d439d581f9211283ce

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest). Item 06's MCP client (`callMcpTool`, `listMcpTools` in `kernel/src/integrations/mcp/client.ts`), the Keychain credential reader (`readMcpCredential`), `mcpConnectorGate` and the fake MCP server (`kernel/test/fixtures/mcp-fake.ts`) are merged. No new dependency. |
| 2 | Dependency Availability | GO | Both dependencies are merged on `main`: item 05 (PR #222: `github.issues`, `github.pr_comments`, `sources/` dispatch) and item 06 (PR #223: the MCP connector mechanism). `MCP_SERVERS` is empty on purpose, waiting for this item. |
| 3 | Architecture Fit | GO | Fits the poll source-adapter seam (`kernel/src/triggers/sources/<source>.ts`, one dispatch in `poll.ts`), the two-phase fire, the item-run wrapper (`wrapUntrusted`) and item 06's gate. The only Agent SDK rule (`SDK_IN_GRAPH`, `kernel/test/feature-seams.test.ts`) is untouched: the MCP SDK client may load in the triggers graph, the Agent SDK may not. |
| 4 | Scope vs Supervisor Capability | CAUTION | About 21 distinct files (15 modify + 6 create, the fixture folder counted as 2) once Touches is widened. That is over the `context-bound` bound (more than 12 files), so the work splits into 2 ordered subtasks. |
| 5 | Hard Blockers | NO-GO (owner override) | The requirement's rule "Nothing is patched outside an item's Touches" can't hold: building the two sources turns two pins outside Touches red and makes two docs false. The owner was asked (LP-NO-GO, 2026-11-05) and chose **Widen all**. The owner also chose **Poll spec names it** for the Jira site, replacing the requirement's "the row records the site". See `## Owner overrides`. |

**Overall Verdict:** NO-GO (user override). The findings are HIGH risks below.

## Owner overrides (Launch Pad, 2026-11-05)

Recorded from the owner's AskUserQuestion answers in this Launch Pad session. They widen the requirement's `## Touches` for this item only. Every file a subtask may edit is in its `lanes:`. A worker that needs any file beyond them stops and says so; the requirement's rule still holds for everything not listed here.

- **LP-NO-GO → "Widen all (Recommended)".** Touches widen by these files:
  - `kernel/test/triggers-poll-github-sources.test.ts`. It pins `jira.issues and clickup.tasks are still refused poll_source_not_built` and `expect([...POLL_FILTER_KEYS].sort()).toEqual(["assignee", "author", "draft", "labels", "state"]);`.
  - `kernel/test/integrations-mcp-connector.test.ts`. It pins `expect(MCP_SERVERS).toEqual({});`.
  - `docs/architecture/triggers.md`. Its lines 79 and 89 say `jira.issues` and `clickup.tasks` are refused `poll_source_not_built`. The requirement kept this file out only so items 05 and 07 shared no file, and item 05 has merged since.
  - `docs/ARCHITECTURE.md`. Its line 284 says a spec naming either source is refused at creation.
  - `kernel/src/playbooks/drafts.ts`. Wright's draft guidance (`repos: [owner/name, ...] … to watch GitHub`) would draft a ClickUp poll wrong.
- **"Where the Jira site lives" → "Poll spec names it (Recommended)".** This supersedes the requirement's Scope 1 clause "the row records the site" (and "the row records the workspace"). There is no migration: `mcp_connections` (migration 020) keeps its six columns.
  - A `jira.issues` poll names its `site` (for example `acme.atlassian.net`) in its filters. The source passes it as Atlassian's `cloudId`; Atlassian's supported-tools documentation says `cloudId` may be the site URL.
  - A `clickup.tasks` poll is scoped by its `list` or `space` filter, so it names no workspace.
  - Item refs stay `jira:<site>/<key>` and `clickup:<task id>`.
  - `docs/architecture/mcp-connectors.md` says plainly that the row does not record the site.
- **Kept out on purpose:** `kernel/src/agents/settings.ts` and `kernel/src/agents/charter-files.ts`. Item 06 already removed `connector_not_built` (no hit under `kernel/src`), so the requirement's conditional ("only if item 06 left `connector_not_built`") does not fire. Also kept out: `kernel/src/triggers/index.ts`, `kernel/src/loop/types.ts`, `kernel/src/kernel.ts` and `kernel/src/playbooks/dry-run.ts`. The MCP ticket reader reaches `firePollTriggers` and `previewPoll` as an optional last parameter with a real default, so no caller changes.

## Task
**Goal:** Fill item 06's empty `MCP_SERVERS` with the Jira (Atlassian Rovo) and ClickUp definitions, and build the `jira.issues` and `clickup.tasks` poll sources. Each turns a tracker's tickets into the same `SourceItem` a GitHub issue gives, fetched by the kernel through item 06's MCP client with the owner's Keychain sign-in, never inside a session. The dry run shows them, and a playbook's per-item run takes their refs.

**Problem Statement:**
The owner wants "work my ClickUp tasks tagged studio" to become PRs, with Jira ready for a personal account later.
Today `jira.issues` and `clickup.tasks` are listed in `POLL_SOURCES` but refused `poll_source_not_built`, `MCP_SERVERS` is `{}`, and a playbook item ref must be `github:`.
Success looks like this: against item 06's fake MCP server, a ClickUp poll filtered by tag fires each task once, and again when it is edited. An expired Jira connection skips the poll `connector_missing` with nothing fetched. A hostile task body reaches the playbook only inside the untrusted-data wrapper. With neither tracker connected, everything else is unchanged.

## Acceptance Criteria

AC1 to AC4 are carried forward from the requirement word for word. AC5 to AC12 make the requirement's scope and the owner's overrides testable.

- [ ] AC1. Given a connected fake `clickup` and a poll on `clickup.tasks` filtered by tag, then each matching task fires once, and an edited task fires again under a dedupe key on id and revision.
- [ ] AC2. Given a `jira` connection that is `expired`, then the poll is skipped `connector_missing` and nothing is fetched.
- [ ] AC3. Given a task body containing an instruction, then it reaches the playbook wrapped as untrusted data.
- [ ] AC4. Given neither tracker is connected, then every other feature works unchanged (invariant 5).
- [ ] AC5. Given a `jira.issues` spec, then it parses only with no `repos` field and a `filters.site` matching `^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$`. It optionally takes `project`, `status` and `assignee` (strings of 1-200 characters) and `labels` (a non-empty array of such strings). It is stored normalized as `{source, filters, interval_seconds}`. A `repos` field, a missing or malformed `site`, or a mistyped filter is `invalid_spec`. Any other filter key is `poll_filter_unknown` naming `jira.issues`'s keys. When it fires, the kernel calls the definition's search tool (`searchJiraIssuesUsingJql`) with `cloudId: <site>`. The JQL is built by the kernel from the filters only: each value double-quoted with `\` and `"` escaped, `ORDER BY updated ASC`, at most `MAX_POLL_ITEMS` results. The owner never writes raw JQL.
- [ ] AC6. Given a `clickup.tasks` spec, then it parses only with no `repos` field and exactly one of `filters.list` or `filters.space` (a string of 1-200 characters). It optionally takes `status` and `assignee` (strings) and `tags` (a non-empty array of strings). Both or neither of `list`/`space` is `invalid_spec`, and any other key is `poll_filter_unknown`. The tag filter is applied by the kernel again on the parsed tasks, whatever the server answered (as `github.pulls` re-applies its filters).
- [ ] AC7. Given either source, then `poll_source_not_built` is emitted nowhere. Every `POLL_SOURCES` entry is built, and `POLL_SOURCES` itself is unchanged. Registering a tracker poll whose kind's row is not usable (`mcpConnectorGate` answers `connector_missing`) is refused `poll_connector_missing`, naming the kind and its status; a tracker spec has no reachable-repo check. A due tracker poll whose gate is not `open` records `connector_missing` with one notification per outage. The title names the tracker (`Poll trigger <id>: Jira not connected`), and the existing GitHub texts are unchanged.
- [ ] AC8. Given a fetched ticket, then its item is `{ref, revision, title, url, updated_at, text, status}`:
  - `ref` is `jira:<site>/<KEY>` (for example `jira:acme.atlassian.net/PROJ-12`) or `clickup:<task id>`;
  - `revision` and `updated_at` are the ticket's updated time;
  - `title` is the summary or name, `text` the description, and `status` the status name;
  - `url` is `https://<site>/browse/<KEY>`, or the task's own `url`.
  An entry with no usable key, id or updated time is dropped, never guessed. `playbooks/items.ts` accepts exactly these two ref shapes beside `GITHUB_ITEM_REF`; `jira:ABC-1` (no site) and a ref carrying spaces or words stay refused. `status` reaches the prompt only inside the wrapper. A tracker item never parks `needs_github`, because `isGithubItem` is false for it.
- [ ] AC9. Given a playbook whose linked trigger polls a tracker, when it is dry-run, then the preview lists the items each would fire, with `would: run | skip` under the owner's dedupe key, from the same fetch a due poll uses. An unusable tracker row (`mcpConnectorGate` not `open`, checked before any fetch) is `preview_incomplete` `connector_missing` with a fix that names the tracker (`Connect Jira in Integrations (the jira connector is <status>).`), and nothing is fetched. A tracker source failure is `source_error`, and its fix names the tracker and shows the fixed code from `message` (for example `ClickUp could not be read for clickup:list/<id>: tool_unavailable. …`), never GitHub's sentence. The GitHub fix sentences stay byte-identical for GitHub sources. No GitHub grant is required for a tracker poll's preview. Nothing is written by the preview.
- [ ] AC10. Given a due tracker poll, then the kernel reads the row's server (`MCP_SERVERS[kind]`, else the row's `server_url`) and the Keychain sign-in, and calls the server through item 06's `callMcpTool`, never inside a session.
  - When the definition's tool is missing from the row's stored tool list (`storedToolsOf(row.granted_tools)`), the poll records `source_error` with `tool_unavailable` and makes no call.
  - When the sign-in is missing or past its expiry, it records `source_error` with `connector_expired` and makes no call.
  - When the server answers `isError` or something unparseable, it records `source_error`.
  - No token reaches a row, an event, a notification, an answer or a log (a test scans for the fake token).
  - The `source_error` message carries only a fixed code, never the server's text.
- [ ] AC11. Given the shipped definitions, then `MCP_SERVERS` is exactly `{jira: {url: "https://mcp.atlassian.com/v1/mcp"}, clickup: {url: "https://mcp.clickup.com/mcp"}}`, and each definition's tool names are listed in a pinned fixture of that server's tool list under `kernel/test/fixtures/mcp-trackers/`. No test reaches a vendor address; every call goes to the fake server through an injected server or reader. Jira is never called live (owner: work account).
- [ ] AC12. Given the docs, then `docs/architecture/mcp-connectors.md` describes the two definitions, the two sources, their filters, item shapes and failures, and the poll-spec site decision, with a NEEDS VERIFICATION note for ClickUp's real tool names and response shapes. `docs/architecture/triggers.md` (lines 79 and 89, plus the per-source filter table) and `docs/ARCHITECTURE.md` (line 284) no longer say the two sources are refused, and link to `mcp-connectors.md` for their details. `cd kernel && npm ci && npm run typecheck && npm test` and `bash scripts/check-docs.sh` pass.

## Phase 3: File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| sources-core (Subtask 1) | `kernel/src/integrations/mcp/connector.ts` (551 — one constant, `MCP_SERVERS`, is filled from `trackers.ts`; no new responsibility), `kernel/src/integrations/types.ts` (449 — the single authority for `PollSpec` / `SourceItem`), `kernel/src/triggers/poll.ts` (611 — the single authority for spec parse, gate and dispatch; tracker-specific parsing goes to the new source files), `kernel/test/phase-8-foundation.test.ts` (662 — two existing pins edited only), `kernel/test/triggers-poll-github-sources.test.ts` (681 — two existing pins edited only), `kernel/test/integrations-mcp-connector.test.ts` (1425 — one existing pin edited only), `kernel/test/triggers-poll.test.ts` (823 — verify-only; edited only if a pin genuinely moves) | `kernel/src/integrations/mcp/trackers.ts`, `kernel/src/triggers/sources/jira-issues.ts`, `kernel/src/triggers/sources/clickup-tasks.ts`, `kernel/test/integrations-mcp-trackers.test.ts`, `kernel/test/fixtures/mcp-trackers/jira-tools.json`, `kernel/test/fixtures/mcp-trackers/clickup-tools.json` | HIGH |
| playbooks-and-docs (Subtask 2) | `kernel/src/playbooks/items.ts` (293), `kernel/src/playbooks/dry-run-poll.ts` (366), `kernel/src/playbooks/drafts.ts` (778 — one guidance sentence; no new responsibility), `kernel/test/playbooks-runs-items.test.ts` (736 — new cases are appended to the existing `runItemOf` / prompt-block describes, the single authority for item-payload pins), `kernel/test/playbooks-dry-run-poll.test.ts` (753 — the tracker preview cases append to the poll-preview describes), `docs/architecture/mcp-connectors.md` (133), `docs/architecture/triggers.md` (191), `docs/ARCHITECTURE.md` (323), `kernel/test/integrations-mcp-trackers.test.ts` (created by Subtask 1; Subtask 2 adds the AC1 end-to-end run and the AC3 prompt case) | — | MEDIUM |

**Module layout (one home per new responsibility):**
- **Definitions and the MCP ticket reader** go in `kernel/src/integrations/mcp/trackers.ts` (CREATE). It holds:
  - `MCP_TRACKERS`: per kind, the url and the tool names (jira: `searchJiraIssuesUsingJql`; clickup: its task-listing tool, named from the pinned fixture);
  - `McpTicketReader`, with one method, `call(store, kind, tool, args)`;
  - `createMcpTicketReader(deps)`. It reads the row, the stored tool list and the Keychain credential through `rows.ts` and `credential.ts`, and calls `client.ts`'s `callMcpTool`. It answers `{ok: true, text}` or `{ok: false, error}` with a fixed code (`connector_missing | connector_expired | tool_unavailable | keychain_failed | mcp_unauthorized | mcp_timeout | mcp_unreachable | mcp_protocol | mcp_tool_error`).
  It imports neither `connector.ts` nor `tools.ts`; `connector.ts` imports `MCP_TRACKERS` to fill `MCP_SERVERS`, so there is no cycle.
- **The Jira spec slice** (site and filter checks, the JQL builder, result parse and item mapping) goes in `kernel/src/triggers/sources/jira-issues.ts` (CREATE). `poll.ts` calls its exported `checkJiraFilters` and `fetchJiraIssues`.
- **The ClickUp spec slice** goes in `kernel/src/triggers/sources/clickup-tasks.ts` (CREATE), with `checkClickupFilters` and `fetchClickupTasks`.
- **`poll.ts`** (611) only gains the per-source branches: `BUILT_SOURCES` becomes all five, `SOURCE_FILTER_KEYS` and `POLL_FILTER_KEYS` grow, the tracker sources take no `repos`, `checkPollSpec` / `gateOf` call `mcpConnectorGate` for a tracker source, and `fetchSource` dispatches. Every tracker-specific line lives in the two source files, so `poll.ts` grows by dispatch only.
- **`PollSpec`** becomes a union in `kernel/src/integrations/types.ts` (449): `GithubPollSpec` (today's shape, its `source` the three GitHub names), `JiraPollSpec` and `ClickupPollSpec` (no `repos`, their own filters). `SourceItem` gains an optional `status`. The three GitHub source files type-narrow to `GithubPollSpec` (a type-only change, inside `sources/`, which is in Subtask 1's lanes).
- **Item refs:** `items.ts` adds `JIRA_ITEM_REF` and `CLICKUP_ITEM_REF` beside `GITHUB_ITEM_REF` (the one home for ref shapes) and the optional `status` field.
- **Tests:** `integrations-mcp-trackers.test.ts` is the CREATE home for every new behaviour (AC1, AC2, AC5–AC11). The four existing large test files only get the pins listed in `## Touched-file invariants` edited, and Subtask 2's two playbook test files append cases to their existing describes.
- **Extract row:** none. The GitHub sources' `SourceFetch` type (`sources/github-pulls.ts`) is reused by the tracker sources, never copied. Each failure's `repo` field carries the tracker scope (`jira:<site>`, `clickup:list/<id>` or `clickup:space/<id>`).

> **Validator-owned surfaces:** acceptance runs `bash scripts/check-docs.sh`. It scans every relative markdown link in `docs/`, `CLAUDE.md` and `README.md`, so any link added to `mcp-connectors.md`, `triggers.md` or `ARCHITECTURE.md` (for example `mcp-connectors.md#ticket-sources`) must resolve to a real heading.

**Total estimated files:** 15 modify + 6 create = 21 distinct paths. Subtask 1 has 7 modify (one verify-only) + 6 create, plus the three GitHub source files' type narrowing. Subtask 2 has 8 modify, plus the one file shared after Subtask 1 (`integrations-mcp-trackers.test.ts`).

### File Overlap Detection

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| Subtask 1 | Subtask 2 | `kernel/test/integrations-mcp-trackers.test.ts` | YES (Subtask 2 requires Subtask 1) |

## Design notes (binding for both subtasks)

- **The site is the owner's, per poll (owner override).** Jira's site is `filters.site`, sent as `cloudId`. The ref is `jira:<site>/<KEY>` with the site lower-cased as stored. There is no `getAccessibleAtlassianResources` round trip, so a poll is one tool call.
- **The kernel builds the query.** Jira's JQL comes from the closed filter set only: `project = "<p>"`, `status = "<s>"`, one `labels = "<l>"` per label, `assignee = "<a>"`, joined with `AND`, then `ORDER BY updated ASC`. Each value has `\` → `\\` and `"` → `\"`. With no optional filter it is `ORDER BY updated ASC` alone, which is valid JQL scoped by the site. ClickUp's arguments are the list or space id plus the given status, tags and assignee, sent as the fixture's tool takes them.
- **Tool names are data, checked against the real connection.** `MCP_TRACKERS` names each tool. Before any call the reader checks that the row's stored tool list (the one item 06 recorded from the server's own `tools/list` at connect) has that name, and refuses `tool_unavailable` otherwise. A wrong guess is a named failure, never a call to an unknown tool. The fixture under `kernel/test/fixtures/mcp-trackers/` pins each definition's names. A test asserts that every name in `MCP_TRACKERS` appears in its kind's fixture, and the fake server serves the fixture.
- **No session, no grant.** The poll's call is the kernel's own due work, with the owner's connection; the owner's per-agent tool grant (item 06) governs sessions only, not polls. The Keychain is read only when a tracker poll actually fetches, through an injectable reader. The three entry points gain the reader as an optional last parameter, defaulting to `createMcpTicketReader()` (the real reader, which builds its Keychain reader lazily):
  - `fetchPollItems(github: GitHubClient | undefined, spec: PollSpec, tickets: McpTicketReader = createMcpTicketReader()): Promise<Fetched>`. A GitHub source still needs `github` (its callers gate on it first, as today); a tracker source uses only `tickets`.
  - `firePollTriggers(store, github, now = new Date(), tickets = createMcpTicketReader())`.
  - `previewPoll({store, github, now, agent, tickets?}, row, trigger)`.
  So `triggers/index.ts` and `playbooks/dry-run.ts` are unchanged, and existing two-argument calls to `fetchPollItems` still typecheck.
- **Failure codes stay inside the existing closed unions.** A tracker failure is `{ok: false, error: "client_error", repo: <tracker scope>, message: <fixed code>}`. The fixed code is one of `connector_expired`, `tool_unavailable`, `keychain_failed`, `mcp_unauthorized`, `mcp_timeout`, `mcp_unreachable`, `mcp_protocol` or `mcp_tool_error`, or `connector_missing` should the reader find the row gone between the gate and the call. `SourceFetch.error` (`sources/github-pulls.ts`) and `Fetched.error` (`poll.ts`) are unchanged, so a due poll records `source_error` with `error: "client_error"` and that `message`, and `dry-run-poll.ts`'s existing switch on `fetched.error` needs no new case. The message is only the code, never server text.
- **Result parsing is loose and bounded.** The tool's text is parsed as JSON. An unparseable answer, an `isError` answer, or a top-level shape with no issue or task array is `source_error` (`mcp_protocol` / `mcp_tool_error`). An entry without a usable key or id or an updated time is dropped. Text fields that are not strings, such as Atlassian's ADF description object, become their JSON text, clipped by the prompt's existing `MAX_ITEM_TEXT_PROMPT_CHARS`. Items are sorted by updated time and then by ref, de-duplicated by ref, and capped by `MAX_POLL_ITEMS` in `poll.ts` as today.
- **Untrusted data.** Title, text, status and URL are server text. They reach a model only through `items.ts`'s one `wrapUntrusted(ref, …)` block (AC3) and the dry run's existing wrapping. The ref must match its strict pattern because the frame prints it raw outside the wrapper. The `url` is the server's, held to the existing `MAX_ITEM_URL_CHARS` / no-control-character rule; the Jira url is built by the kernel from the site and key.
- **Mechanism only (invariant 1).** There is no default filter, interval or dedupe key. Wright's draft may propose them (dedupe on `item.id` + `item.revision`, 5 minutes), but nothing is built in.

## Touched-file invariants

> Grounded at base `1a1cc2785cf06d4f248116d439d581f9211283ce`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/triggers/poll.ts`**
  - Keep the two-phase fire (`Phase A writes nothing`), `const key = fireStepKey(row.id, scheduledAt);`, the per-item `sourceRef: \`playbook:${playbook.id}:${scheduledAt}:${item.ref}\``, `export const MAX_POLL_ITEMS = 100;`, the 60 s floor (`poll_interval_below_floor`) and "notify once per outage" (`if (row.last_result !== "connector_missing")`).
  - Keep `POLL_SOURCES` byte-identical (`export const POLL_SOURCES = ["github.pulls", "github.issues", "github.pr_comments", "jira.issues", "clickup.tasks"] as const;`).
  - Every GitHub refusal text stays as is (`poll_connector_missing: no connected GitHub connector`).
  - The import rule widens only by `../integrations/mcp/connector.js` (`mcpConnectorGate`), `../integrations/mcp/trackers.js` (the default reader) and the two new source files; never the Agent SDK.
  - Rewrite the header comment and the `POLL_SOURCES` doc comment, which name `poll_source_not_built`.
  - Pinned by: `kernel/test/triggers-poll.test.ts`, `kernel/test/triggers-poll-github-sources.test.ts`, `kernel/test/phase-8-foundation.test.ts`.
- **`kernel/src/triggers/sources/github-pulls.ts`, `github-issues.ts`, `github-pr-comments.ts`** (type-only change)
  - Keep each export, `export async function fetchGithubPulls(github: GitHubClient, spec: PollSpec)` (and `fetchGithubIssues` / `fetchGithubPrComments`), byte-identical apart from the `spec` parameter type, which narrows to `GithubPollSpec`.
  - Keep `export type SourceFetch =` (exported name and shape, including the closed `error: "http_error" | "unreachable" | "client_error"`) byte-identical. The tracker sources import it and never copy it.
  - Keep the header rule `Imports: type-only from \`../../integrations/types.js\``.
  - Pinned by: `kernel/test/triggers-poll-github-sources.test.ts`, `kernel/test/triggers-poll.test.ts`.
- **`kernel/src/integrations/types.ts`**
  - Keep `SourceItem`'s existing fields and their doc, and the GitHub client types.
  - `PollSpec` stays the exported name, now the union. Its old `source` doc (`` `jira.issues` and `clickup.tasks` are not built (`poll_source_not_built`) ``) is rewritten.
  - Type-only module: no runtime value is added.
- **`kernel/src/integrations/mcp/connector.ts`**
  - Keep `export const MCP_SERVERS: Readonly<Partial<Record<McpKind, McpServerDefinition>>> = Object.freeze(` as the exported name and type. It is now filled from `trackers.ts` and remains frozen.
  - Keep `serverFor`'s order (`deps.serverFor`, then `MCP_SERVERS`, then the row's `server_url`) and `mcpConnectorGate` unchanged.
  - Rewrite the header line `` `MCP_SERVERS` is empty until a ticket source's item names `` and the `MCP_SERVERS` doc comment.
  - Pinned by: `kernel/test/integrations-mcp-connector.test.ts`.
- **`kernel/test/integrations-mcp-connector.test.ts`**
  - Only the test `refuses to connect a kind with no server address (item 06 hard-codes none), and uses the row's address once there is one` changes.
  - `expect(MCP_SERVERS).toEqual({});` becomes the AC11 exact value.
  - The no-address refusal (`server_not_configured`) and the row-address cases are kept by injecting `serverFor` (e.g. `() => undefined`, then the row's url), so no case reaches a vendor address. Retitle it.
  - Every other case stays green, unedited. If one goes red because a connect now resolves a vendor URL, inject `serverFor` there too; never weaken `mcpUrlAllowed`.
- **`kernel/test/triggers-poll-github-sources.test.ts`**
  - `jira.issues and clickup.tasks are still refused poll_source_not_built (invalid_spec)` flips: both now parse with their required filters. Retitle it.
  - `POLL_FILTER_KEYS stays the union of every source's keys` keeps its name and its `.sort()` form, with the list now `["assignee", "author", "draft", "labels", "list", "project", "site", "space", "state", "status", "tags"]`.
  - The loop at `for (const key of POLL_FILTER_KEYS) {` stays (it checks each key is taken by some source).
- **`kernel/test/phase-8-foundation.test.ts`**
  - Keep `CONNECTOR_KINDS is github, jira, clickup, frozen` and the `POLL_SOURCES` `toEqual` list (its `it(...)` title is reworded: none is "not built yet").
  - The describe `a poll source not built is refused poll_source_not_built (invalid_spec)` flips: no source is refused that way, `poll_source_not_built` is never thrown, and both tracker specs with their required filters parse.
  - The three-GitHub-sources-parse case stays.
  - Every grant pin (lines 181–339) is untouched.
- **`kernel/test/triggers-poll.test.ts`** — verify-only: `[spec({ source: "jira.issues" }), undefined],` (a jira spec carrying GitHub `repos` and no `site`) must still be `invalid_spec`; under AC5 it is, because a tracker spec takes no `repos`. If it goes red, the change is wrong, not the test.
- **`kernel/src/playbooks/items.ts`**
  - Keep `export const GITHUB_ITEM_REF = /^github:` byte-identical, `MAX_ITEM_REF_CHARS = 512`, the CONTROL rule and `isGithubItem` (`item.ref.startsWith("github:")`).
  - Keep the rule that every author-controlled field is shown inside the one wrapper `and nowhere else`.
  - Add `status` to `RunItem`'s Pick and to `runItemOf` (absent or a string of at most 200 characters with no control character). The refusal message for `item.ref` names the three shapes.
  - Imports stay as the header lists them.
  - Pinned by: `kernel/test/playbooks-runs-items.test.ts` (`expect(GITHUB_ITEM_REF.test(ref)).toBe(true);`, and `["a ref of another source", { ref: "jira:ABC-1", revision: "aaa" }, /item\.ref/]`, which must stay refused, unedited).
- **`kernel/src/playbooks/dry-run-poll.ts`**
  - Keep "Read only … writes nothing", `export const PREVIEW_INCOMPLETE_REASONS = Object.freeze(["connector_missing", "needs_github", "rate_limited", "source_error"] as const);` unchanged (no new reason), and the GitHub fix sentences byte-identical for GitHub sources.
  - The seam for the tracker connection check is a value import of `mcpConnectorGate` from `../integrations/mcp/connector.js`, the same function `poll.ts` uses. That widens the header's `type-only integrations` import rule by exactly that one module; no test pins the rule (`feature-seams.test.ts` forbids only the Agent SDK). Rewrite the header's import paragraph to name it.
  - The gate is checked before any fetch. The GitHub connector check (`githubConnectorState`, the wired client) and the `needsGithub` grant check run only for a GitHub source; a tracker source runs only its own gate.
  - A tracker `source_error`'s fix names the tracker and the fixed code from `fetched.message` (written by the kernel, never the server). Add one branch beside the existing `"GitHub could not be read for"` sentence; never edit that sentence.
  - Rewrite the header's "Checked before any fetch, in order: a usable `github` connector and a wired client (`connector_missing`), then the owning agent's `github` grant" paragraph so it covers tracker sources too.
  - Pinned by: `kernel/test/playbooks-dry-run-poll.test.ts`, `kernel/test/playbooks-dry-run-poll-unit.test.ts` (must stay green, unedited).
- **`kernel/src/playbooks/drafts.ts`**
  - Only the guidance sentence `` `or {kind: poll, poll: {source, repos: [owner/name, ...], filters (optional: ${POLL_FILTER_KEYS.join(", ")}), interval_seconds}} (no tz) to watch GitHub; ` + `` changes. It names `repos` for the GitHub sources and the tracker sources' required `site` / `list | space`.
  - Keep the `POLL_FILTER_KEYS` interpolation. Nothing pins the sentence (grep at base: one hit, the source line).
- **`docs/architecture/mcp-connectors.md`**
  - Keep the `Part of [Phase 8 features](../ARCHITECTURE.md#phase-8-features).` link, the D38 link, and every built section of item 06.
  - Rewrite the `mcpConnectorGate` paragraph's `` `poll.ts` is not edited by this item `` sentence, and add a `## Ticket sources` section (the anchor `triggers.md` links to).
- **`docs/architecture/triggers.md`**
  - Keep the `[MCP connectors](mcp-connectors.md)` link and the GitHub rows of the filter table.
  - Rewrite only the line-79 sentence (`` `jira.issues` and `clickup.tasks` are refused `poll_source_not_built` until their items land ``) and the line-89 clause (`` or one not built (`jira.issues`, `clickup.tasks`: the message starts `poll_source_not_built:`) ``). Add the two tracker rows to the filter table, pointing to `mcp-connectors.md#ticket-sources` for the details.
- **`docs/ARCHITECTURE.md`**
  - Keep the line-284 bullet's other sentences (the `CONNECTOR_KINDS` grant text, the GitHub `write` level).
  - Rewrite only `` and a poll spec naming `jira.issues` or `clickup.tasks` is refused at creation (`invalid_spec`, the message starting `poll_source_not_built:`), so Wright's drafts and the dry run refuse it too ``.

## Closed enumerations touched

> Sibling grep at base `1a1cc27`: `grep -rnF 'POLL_FILTER_KEYS' kernel/src kernel/test` → 9 hits in 4 files (`triggers/poll.ts` ×2, `triggers/index.ts`, `playbooks/drafts.ts` ×2, `test/triggers-poll-github-sources.test.ts` ×4). `grep -rnF '"needs_github", "rate_limited"' kernel/src` → 1 hit. `grep -rnF 'poll_source_not_built' kernel docs` → `poll.ts` ×4, `types.ts`, `phase-8-foundation.test.ts` ×2, `triggers-poll-github-sources.test.ts` ×2, `docs/architecture/triggers.md` ×2, `docs/ARCHITECTURE.md`, `docs/architecture/mcp-connectors.md`.

- **New filter keys `site`, `project`, `status`, `list`, `space`, `tags`** (sibling: `assignee`). They must be named in:
  - `kernel/src/triggers/poll.ts`: `export const POLL_FILTER_KEYS = [` (extend) and `const SOURCE_FILTER_KEYS` (two new rows);
  - `kernel/test/triggers-poll-github-sources.test.ts`: the union pin (extend);
  - `docs/architecture/triggers.md`: the per-source filter table (two rows).
  - `kernel/src/playbooks/drafts.ts` needs no change for the keys, because it interpolates `POLL_FILTER_KEYS`.
- **`BUILT_SOURCES`** (`poll.ts`): extend to all five, so `isBuiltSource` is true for every `POLL_SOURCES` entry. Every closed list that named the refusal `poll_source_not_built` is rewritten (the grep above).
- **`PREVIEW_INCOMPLETE_REASONS`:** no change. A tracker preview uses `connector_missing` and `source_error`.
- **`SourceFetch.error` / `Fetched.error`** (`"http_error" | "unreachable" | "client_error"`, in `sources/github-pulls.ts` and `poll.ts`): no change. Every tracker failure is `client_error`, its fixed code in `message` (see Design notes). Consumers that switch on `error` (`poll.ts` `recordInstant`, `dry-run-poll.ts` `previewPoll`) need no new case.
- **`TriggerResult` / `trigger_missed` reasons:** no change. A tracker poll records `connector_missing` and `source_error`, as GitHub does.
- **`SourceItem` fields:** add the optional `status`. `RunItem` (`items.ts`) is the only Pick of it that must name it (`grep -rn "Pick<SourceItem" kernel/src` → 1 hit).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `integrations-mcp-trackers.test.ts` — AC1 each tagged task fires once; the edited one fires again | In `sources/clickup-tasks.ts`, set `revision` to the task id instead of its updated time |
| `integrations-mcp-trackers.test.ts` — AC1/AC6 the tag filter is re-applied in the kernel | In `sources/clickup-tasks.ts`, delete the kernel-side tag check |
| `integrations-mcp-trackers.test.ts` — AC2 expired jira skips `connector_missing`, fake server sees 0 calls | In `poll.ts` `gateOf`, return `open` for a tracker source without calling `mcpConnectorGate` |
| `integrations-mcp-trackers.test.ts` / `playbooks-runs-items.test.ts` — AC3 the hostile body is inside the wrapper | In `items.ts`, render `text` outside the `wrapUntrusted` block |
| `integrations-mcp-trackers.test.ts` — AC4 GitHub polls fire unchanged with no tracker row | In `poll.ts` `checkPollSpec`, call `mcpConnectorGate(store, "jira")` for every source |
| `integrations-mcp-trackers.test.ts` — AC5 the JQL quotes and escapes a value with `"` | In `sources/jira-issues.ts`, delete the `"` escape |
| `integrations-mcp-trackers.test.ts` — AC5 a jira spec with `repos` is `invalid_spec` | In `poll.ts`, accept `repos` on a tracker source |
| `integrations-mcp-trackers.test.ts` — AC6 both `list` and `space` is `invalid_spec` | In `sources/clickup-tasks.ts`, delete the exactly-one check |
| `integrations-mcp-trackers.test.ts` — AC7 registering with no usable row is `poll_connector_missing` | In `poll.ts` `checkPollSpec`, skip the connector check for tracker sources |
| `integrations-mcp-trackers.test.ts` — AC8 refs are `jira:<site>/<KEY>` / `clickup:<id>` | In `sources/jira-issues.ts`, drop `<site>/` from the ref |
| `playbooks-runs-items.test.ts` — AC8 a `jira:` and a `clickup:` ref are accepted; `status` is kept | In `items.ts`, delete the `JIRA_ITEM_REF` test from the ref check |
| `playbooks-dry-run-poll.test.ts` — AC9 a tracker preview lists would-run items without a GitHub grant | In `dry-run-poll.ts`, run `needsGithub` for every source |
| `playbooks-dry-run-poll.test.ts` — AC9 an expired tracker row is `connector_missing` naming the tracker, 0 server calls | In `dry-run-poll.ts`, delete the `mcpConnectorGate` check for a tracker source |
| `playbooks-dry-run-poll.test.ts` — AC9 a tracker `source_error` fix names the tracker and its code (`tool_unavailable`), never "GitHub" | In `dry-run-poll.ts`, route a tracker failure to the existing `"GitHub could not be read for"` sentence |
| `integrations-mcp-trackers.test.ts` — AC10 a tool missing from the row's list is `tool_unavailable`, 0 calls | In `mcp/trackers.ts`, delete the stored-tool-list check |
| `integrations-mcp-trackers.test.ts` — AC10 no token in any row, event, notification or log | In `mcp/trackers.ts`, append the access token to the `source_error` message |
| `integrations-mcp-trackers.test.ts` — AC11 every `MCP_TRACKERS` tool name is in its fixture | In `mcp/trackers.ts`, rename the jira search tool to `searchIssues` |
| `integrations-mcp-connector.test.ts` — AC11 `MCP_SERVERS` exact value | In `mcp/connector.ts`, set `MCP_SERVERS` back to `Object.freeze({})` |
| `triggers-poll-github-sources.test.ts` — the `POLL_FILTER_KEYS` union | In `poll.ts`, delete `"tags"` from `POLL_FILTER_KEYS` |
| `phase-8-foundation.test.ts` — no source is refused `poll_source_not_built` | In `poll.ts`, remove `"clickup.tasks"` from `BUILT_SOURCES` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Definitions, the MCP ticket reader, the `jira.issues` / `clickup.tasks` sources, spec parse, gate and dispatch in `poll.ts` | AC1 (the poll fires and re-fires; the dedupe-key run half is #2's), AC2, AC4, AC5, AC6, AC7, AC8 (item shape from the sources), AC10, AC11 | 7 modify, 6 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | Playbook item refs and status, the tracker dry run, Wright's draft guidance, docs | AC1 (dedupe on `item.id` + `item.revision` through a real per-item run), AC3, AC8 (`items.ts` accepts the refs; no `needs_github`), AC9, AC12 | 8 modify (+1 shared after #1), 0 create | `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/integrations/mcp/trackers.ts"}
  - {kind: "symbol", path: "kernel/src/integrations/mcp/trackers.ts", name: "MCP_TRACKERS"}
  - {kind: "symbol", path: "kernel/src/integrations/mcp/trackers.ts", name: "createMcpTicketReader"}
  - {kind: "type", path: "kernel/src/integrations/mcp/trackers.ts", name: "McpTicketReader"}
  - {kind: "file", path: "kernel/src/triggers/sources/jira-issues.ts"}
  - {kind: "symbol", path: "kernel/src/triggers/sources/jira-issues.ts", name: "fetchJiraIssues"}
  - {kind: "file", path: "kernel/src/triggers/sources/clickup-tasks.ts"}
  - {kind: "symbol", path: "kernel/src/triggers/sources/clickup-tasks.ts", name: "fetchClickupTasks"}
  - {kind: "symbol", path: "kernel/src/triggers/poll.ts", name: "fetchPollItems"}
  - {kind: "type", path: "kernel/src/integrations/types.ts", name: "JiraPollSpec"}
  - {kind: "type", path: "kernel/src/integrations/types.ts", name: "ClickupPollSpec"}
  - {kind: "file", path: "kernel/test/integrations-mcp-trackers.test.ts"}
  - {kind: "file", path: "kernel/test/fixtures/mcp-trackers/jira-tools.json"}
  - {kind: "file", path: "kernel/test/fixtures/mcp-trackers/clickup-tools.json"}
requires: []
lanes:
  - "kernel/src/integrations/mcp/trackers.ts"
  - "kernel/src/integrations/mcp/connector.ts"
  - "kernel/src/integrations/types.ts"
  - "kernel/src/triggers/poll.ts"
  - "kernel/src/triggers/sources/**"
  - "kernel/test/integrations-mcp-trackers.test.ts"
  - "kernel/test/fixtures/mcp-trackers/**"
  - "kernel/test/phase-8-foundation.test.ts"
  - "kernel/test/triggers-poll-github-sources.test.ts"
  - "kernel/test/integrations-mcp-connector.test.ts"
  - "kernel/test/triggers-poll.test.ts"
external_requires:
  - "Item 06's MCP client, credential and rows modules (kernel/src/integrations/mcp/client.ts, credential.ts, rows.ts) and its fake server (kernel/test/fixtures/mcp-fake.ts), used unedited"
  - "Atlassian Rovo MCP tool names (searchJiraIssuesUsingJql; cloudId may be the site URL) per Atlassian's supported-tools page; ClickUp's official tool names are NEEDS VERIFICATION"

# Subtask 2
provides:
  - {kind: "symbol", path: "kernel/src/playbooks/items.ts", name: "JIRA_ITEM_REF"}
  - {kind: "symbol", path: "kernel/src/playbooks/items.ts", name: "CLICKUP_ITEM_REF"}
  - {kind: "symbol", path: "docs/architecture/mcp-connectors.md", name: "## Ticket sources"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/triggers/poll.ts", name: "fetchPollItems"}
  - {from: "1", kind: "type", path: "kernel/src/integrations/mcp/trackers.ts", name: "McpTicketReader"}
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/mcp/trackers.ts", name: "createMcpTicketReader"}
  - {from: "1", kind: "file", path: "kernel/test/integrations-mcp-trackers.test.ts"}
lanes:
  - "kernel/src/playbooks/items.ts"
  - "kernel/src/playbooks/dry-run-poll.ts"
  - "kernel/src/playbooks/drafts.ts"
  - "kernel/test/playbooks-runs-items.test.ts"
  - "kernel/test/playbooks-dry-run-poll.test.ts"
  - "kernel/test/integrations-mcp-trackers.test.ts"
  - "docs/architecture/mcp-connectors.md"
  - "docs/architecture/triggers.md"
  - "docs/ARCHITECTURE.md"
external_requires: []
```

Note: `kernel/test/playbooks-dry-run-poll-unit.test.ts`, `kernel/test/feature-seams.test.ts` and `kernel/test/agents-connectors-grant.test.ts` are in no lane. Each must stay green unedited; a red one is a defect in the change.

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | `kernel/test/integrations-mcp-trackers.test.ts` | YES (ordered: 2 requires 1; Subtask 2 appends cases and re-runs Subtask 1's) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The requirement's Touches rule was overridden by the owner (source: Feasibility (Phase 2.5), NO-GO overridden) | HIGH | Every file is in a subtask's `lanes:` and named in `## Owner overrides`. A worker needing any other file stops and says so. Code review checks the diff stays inside the union of the two lanes. |
| Scope is over one worker's context: 21 distinct files (source: Feasibility (Phase 2.5)) | HIGH | Split `context-bound` into 2 ordered subtasks. Subtask 2 consumes only the sources, the reader type and the test file. |
| The requirement said "the row records the site"; the owner chose the poll spec instead (source: Feasibility (Phase 2.5), owner override) | MEDIUM | Recorded in `## Owner overrides`. `mcp-connectors.md` states it plainly, and no migration is added. |
| ClickUp's official MCP tool names and result shapes are unverified. A search found only third-party servers' names. | HIGH | Tool names are data in `MCP_TRACKERS`, checked against the row's real tool list before any call (`tool_unavailable`, never a blind call). Parsing is loose and drops off-shape entries. The fixture is marked "authored, not recorded from the live server" and the doc carries NEEDS VERIFICATION. The owner's live ClickUp run (item 13) confirms or corrects the name. |
| Atlassian documents a v2 endpoint (`https://mcp.atlassian.com/v2/mcp`), while the requirement names v1 | MEDIUM | Ship the requirement's v1 URL as data in one place (`MCP_TRACKERS`). The doc notes v2 as NEEDS VERIFICATION. Jira is never live here (owner's work account). |
| Server text (summary, description, status) carries instructions into a playbook (invariant 3) | HIGH | AC3 and AC8: every field is inside the one `wrapUntrusted` block, and the ref is strictly patterned. The `source_error` message is a fixed code, never server text. |
| JQL injection through an owner filter value | MEDIUM | The JQL is built only from the closed filter set, each value quoted with `\` and `"` escaped (AC5 pin). There is no raw-JQL field. |
| A tracker poll reads the real Keychain in a test | MEDIUM | The reader is an injected parameter, and every test passes a fake reader or the fake server plus a fake keychain. The real reader is built lazily, only when a tracker poll fetches. |
| A token leaks into a `source_error` event or `due_work_failed` | HIGH | The reader catches everything and answers fixed codes (item 06's pattern). AC10's scan covers rows, events, notifications and logs for the fake token. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-05-jira-and-clickup-ticket-sources.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-05T06:27:45Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/229
- **Branch:** feature/jira-and-clickup-ticket-sources
- **Files changed:** 27
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Built the Jira and ClickUp MCP definitions, the MCP ticket reader, the jira.issues and clickup.tasks poll sources, tracker item refs, the tracker dry run, draft guidance and docs. Review round 1 passed with 2 MEDIUM findings, which fix iteration 1 (5a4274f) resolved. Round 2 passed with no findings. 2 LOW findings were dismissed. The owner approved widening the lanes by kernel/test/integrations-foundation.test.ts, docs/architecture/playbook-runs.md and docs/architecture/dry-run.md.

## Not verified
- **jira.issues against the live Atlassian endpoint** — the owner's work account, so it is never called live by design (subtask 1)
- **clickup.tasks against the live ClickUp server** — the tool name and response shape are authored, not recorded (subtask 1)
- **The default real reader against the real macOS Keychain** — tests use only the fake Keychain (subtask 1)
- **A ticket read through the dry run with the real Keychain and a vendor server** — tests use fake readers and the fake MCP server (subtask 2)
- **ClickUp live tool name and response shape** — authored; the owner's live run (item 13) confirms it (subtask 2)
