# Phase 8 item 20g: ClickUp tickets are read with a tool ClickUp has

Playbook 8's dry runs 155 and 157 (the phase 8 exit live run, 2026-11-12) failed `tool_unavailable` with ClickUp connected, because `MCP_TRACKERS.clickup.tool` was `get_workspace_tasks`, a name the kernel authored and never checked ([MCP connectors: ticket sources](../architecture/mcp-connectors.md#ticket-sources)). This item reads the real tool from ClickUp's server with a read-only probe, moves the poll, its dry run, its fixtures and the phase 8 exit walks to it, and makes a missing tool's refusal name the tool and the connector. The probe's result is also recorded in [`docs/OPEN_QUESTIONS.md`](../OPEN_QUESTIONS.md).

## What the probe did, and did not do

- **Read only.** It opened the Studio store read-only, asked ClickUp's server for its tool list, and made one `tools/call` of a tool the server marks `readOnlyHint: true`. It wrote nothing to ClickUp, to the store or to the Keychain.
- **The owner's personal ClickUp only.** The connection is the one the owner made in Studio (`mcp_connections` row `clickup`, `https://mcp.clickup.com/mcp`). No work (Tray or vendsy) account was connected, read or called, and Jira was not touched.
- **No secret printed or kept.** The access token was read from the Keychain by the kernel's own `readMcpCredential` inside a scratch script outside the repository, passed to the kernel's own client, and never printed. The scratch script printed only whether a sign-in was present, its expiry time and whether it had a refresh token (it had none). Raw output went to files outside the repository; nothing from them is committed except the redacted shape and the placeholder fixtures named below.
- **Task text is redacted.** This file gives field names and types. The committed response fixture replaces the task's id, name, link, update time, list id and list name with neutral placeholders.

## Step 1: the stored tool list (the connected row)

```bash
sqlite3 -readonly ~/.loomwright-studio/studio.db "select kind, status, length(granted_tools) from mcp_connections"
```

```text
clickup|connected|72366
```

The row's `granted_tools` is a JSON array of 58 entries, each `{name, proxy, read_only, description, schema}`. The names that list tasks: `clickup_filter_tasks` (`read_only` true), `clickup_search` (true) and `clickup_get_task` (true). There is no `get_workspace_tasks`. The stored `description` and `schema` are cut by the kernel at connect (300 and 1500 characters, `MCP_SCHEMA_MAX`), so the stored `schema` of `clickup_filter_tasks` ends part-way through its properties. It does hold `tags`, `list_ids`, `space_ids`, `statuses` and `assignees`, each `{"type":"array","items":{"type":"string"}}`.

## Step 2: the full tool entry, from the server's own `tools/list`

Because the stored schema is cut, the full input schema came from one `tools/list` call, through the kernel's own client. The kernel was built to a directory outside the repository (`node scripts/build.mjs --out-dir <scratch>/kdist`), and this scratch script (outside the repository) ran against it:

```js
import { writeFileSync } from "node:fs";
import { securityCliKeychain } from "./kdist/auth/keychain.js";
import { readMcpCredential } from "./kdist/integrations/mcp/credential.js";
import { listMcpTools } from "./kdist/integrations/mcp/client.js";
const cred = readMcpCredential(securityCliKeychain(), "clickup");
const tools = await listMcpTools("https://mcp.clickup.com/mcp", cred.access_token);
console.log("tools/list ok:", tools.length);                 // the token is never printed
writeFileSync(`${process.argv[2]}/tools-list.json`, JSON.stringify(tools, null, 2));
```

```text
credential present; expires_at: 2036-11-06T13:08:39.453Z has_refresh: false
tools/list ok: 67
```

The server lists 67 tools now (the row recorded 58 when it connected). `clickup_filter_tasks` is among them and `get_workspace_tasks` is not.

**The tool: `clickup_filter_tasks`.** Fields: `name`, `description`, `annotations` (`title: "Filter Tasks"`, `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`), `_meta`, `inputSchema` and `outputSchema`. Its description says it retrieves tasks with combined filters, that values within one filter use OR and filters combine with AND, and that results are paginated at about 100 tasks per call with `has_more` and `next_page`.

**Input schema** (`type: object`, no `required` array). Properties and their types:

| Argument | Type | Used by the poll |
|---|---|---|
| `list_ids` | array of string | yes, from `filters.list` |
| `space_ids` | array of string | yes, from `filters.space` |
| `statuses` | array of string | yes, from `filters.status` |
| `assignees` | array of string | yes, from `filters.assignee` |
| `tags` | array of string | yes, from `filters.tags` |
| `folder_ids` | array of string | no |
| `view_id` | string | no |
| `fields` | array of string, an enum of `custom_id`, `status`, `priority`, `assignees`, `tags`, `due_date`, `date_updated`, `date_closed`, `list` | no (omitted, the server returns all fields) |
| `include_closed` | boolean | no |
| `subtasks` | boolean, default true | no |
| `page` | number, 0-indexed | no |
| `order_by` | string, an enum of `id`, `created`, `updated`, `due_date` | no |
| `reverse` | boolean | no |
| `due_date_from`, `due_date_to`, `date_closed_from`, `date_closed_to` | string, a date pattern | no |
| `custom_fields` | array of `{field_id, operator, value}` | no |
| `workspace_id` | string, digits only | no |

The five argument names the poll sends are the ones the authored fixture already used, so `argsOf` is unchanged. Only the tool name was wrong.

**Output schema** (`additionalProperties: false`, as the server declares it): `tasks` (array), `count` (number), `page` (number), `has_more` (boolean), `next_page` (number or null) are required; `message` (string) and `warnings` (array of string) are optional. Each task requires `id`, `name` and `url`, and may carry `custom_id`, `status`, `priority`, `assignees`, `tags`, `due_date`, `date_updated`, `date_closed` and `list`. **A task has no body or description field.**

## Step 3: one live call

One call of the read-only tool, with the list and the tag the Validation 2 walk uses, through the kernel's own `callMcpTool`:

```js
import { writeFileSync } from "node:fs";
import { securityCliKeychain } from "./kdist/auth/keychain.js";
import { readMcpCredential } from "./kdist/integrations/mcp/credential.js";
import { callMcpTool } from "./kdist/integrations/mcp/client.js";
const cred = readMcpCredential(securityCliKeychain(), "clickup");
const args = { list_ids: ["901422761392"], tags: ["studio-sandbox"] };
const answer = await callMcpTool("https://mcp.clickup.com/mcp", cred.access_token, "clickup_filter_tasks", args);
console.log("is_error:", answer.is_error, "truncated:", answer.truncated, "text_length:", answer.text.length);
writeFileSync(`${process.argv[2]}/raw-response.txt`, answer.text);   // raw text stays outside the repository
```

```text
is_error: false truncated: false text_length: 389
```

The answer's text is JSON. Its shape, names and types only (the task's text redacted):

```text
{
  tasks: [
    {
      id: string                      // 9 characters
      custom_id: null
      name: string
      status: string                  // a status name, e.g. a "to do" style name; not an object
      url: string                     // https://app.clickup.com/t/<id>
      priority: null
      assignees: []                   // array; the schema says items are {id: number, username: string | null}
      tags: [ { name: string } ]      // objects, not strings
      due_date: null
      date_updated: string            // epoch milliseconds, 13 digits
      date_closed: null
      list: { id: string, name: string }
    }
  ],
  count: number                       // 1
  page: number                        // 0
  has_more: boolean                   // false
  next_page: null
}
```

One task matched: the list's task carrying the tag `studio-sandbox`. Its `list.id` equals the requested list id. Its `name` is the title the Validation 2 walk expects; it is not repeated here.

What the mapping needs from this:

- `ref` is `clickup:<id>`, from `id` (a string that matches `CLICKUP_TASK_ID`).
- `title` is `name`; `url` is `url`; `status` is `status` (a plain string; `statusOf` accepts it).
- `revision` and `updated_at` are `date_updated`, an epoch-millisecond string that `updatedOf` already turns into an ISO time.
- `text` has no source: **the listing carries no body.** A ClickUp item therefore has no `text`. The kernel does not call `clickup_get_task` to fetch one.
- The kernel's case-insensitive tag re-check reads `tags[].name`, which is the shape here.

## Committed fixtures

- `kernel/test/fixtures/mcp-trackers/clickup-tools.json`: the recorded `clickup_filter_tasks` entry (`name`, `description`, `inputSchema`, `annotations`, `outputSchema`, verbatim; `_meta`, a UI resource hint, left out). It lists no other tool.
- `kernel/test/fixtures/mcp-trackers/clickup-filter-tasks-response.json`: the answer above with the task's id, name, link, update time, list id and list name replaced by neutral placeholders. Field names, nesting and value types are as observed.

## What the change does, and what it leaves open

- `MCP_TRACKERS.clickup.tool` is `clickup_filter_tasks`. `argsOf` is unchanged. `itemOf` reads the probed fields only (`date_updated`, `name`, `url`, `status`, `tags[].name`) and no longer reads a `description`, `text_content` or `updated_at` key, which the listing does not carry.
- A `tool_unavailable` dry run now says which tool is missing and which connector to reconnect: `ClickUp could not be read for clickup:list/901: tool_unavailable. The clickup connector's tool list lacks clickup_filter_tasks; reconnect ClickUp in Integrations so the list is read again. Check the clickup connection …`. Both names are the kernel's own data.
- **Jira is `not_exercised`.** `searchJiraIssuesUsingJql` comes from Atlassian's supported-tools page; Jira is the owner's work account and was not connected or called. `MCP_TRACKERS.jira` is unchanged.
- **Left open for the owner:** the poll reads the first page only (about 100 tasks) and does not follow `next_page`; `include_closed` is not sent; an item has no body. They are recorded in [`docs/OPEN_QUESTIONS.md`](../OPEN_QUESTIONS.md).

## Phase 8 exit e2e

The deterministic walk in the built app, against the real in-process kernel and the fake ClickUp server (which now lists `clickup_filter_tasks` and answers in the recorded shape). Run from this branch's worktree, with Electron's binary fetched and the app built first:

```bash
cd app
npm ci --ignore-scripts
node node_modules/electron/install.js
npm run build
npx playwright test e2e/phase-8-exit.spec.ts --workers=1
```

```text
Running 1 test using 1 worker

  ✓  1 e2e/phase-8-exit.spec.ts:418:1 › phase 8 exit: tickets become PRs, comments are triaged, the owner is re-requested and each merge goes through Loomwright's gate, in the app against a real kernel (9.0s)

  1 passed (10.8s)
```

The spec launches the app through the hidden-window harness (`launchApp`), so no window took focus. `cd app && npx tsc -p tsconfig.node.json` (which covers `e2e/`) is clean. The kernel suite (`cd kernel && npm test`) passed 4499 tests (16 skipped, as before) across 132 files.

## Validation 2

**Owner-closed after the PR opens.** The worker's part is this list of steps. The owner (or Claude, driving the app at the owner's request) runs them against the PR head built and running, and records the observed output and the verdict below. Nothing here is a result.

1. Build the PR head and run it as in [phase 8's setup step 8](phase-8-exit-runbook.md#setup): the kernel installed as the launchd service and the packaged app opened from Finder. Record `git rev-parse HEAD`, the service's pid and `sw_vers -productVersion`.
2. In Integrations, check ClickUp is connected and its tool list names `clickup_filter_tasks` (a connection recorded before ClickUp added tools may list fewer tools; Reconnect ClickUp refreshes the list).
3. In Wright's thread, ask Wright to draft a playbook for a developer crew member whose trigger is a `clickup.tasks` poll with `filters: {list: "901422761392", tags: ["studio-sandbox"]}` and an interval the owner chooses. Wright only proposes; the owner sets the interval and the dedupe key.
4. Run the playbook's dry run (Wright's `kernel_playbook_dry_run`, or the playbook's Dry run in the app). Check the poll preview lists the task "Add a README to studio-sandbox" and says whether it would run or skip under the owner's key.
5. Paste the dry run's output in the fenced block below. It must show the task's title and `clickup:<id>` ref, and must not show `tool_unavailable`.
6. Optional: if the dry run does say `tool_unavailable`, check its fix names `clickup_filter_tasks` and the `clickup` connector and tells you to reconnect ClickUp in Integrations. Reconnect and run the dry run again.

The run's output (fenced), recorded by whoever ran it:

```text
(not run yet)
```

Owner's result (filled in from the owner's report, only from the observed run):
