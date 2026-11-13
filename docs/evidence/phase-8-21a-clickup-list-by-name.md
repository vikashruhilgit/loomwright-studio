# Phase 8 item 21a: a ClickUp poll names its list the way ClickUp reads it

Playbook 9 (`filters.list: "Loomwright Studio"`) failed every dry run (`mcp_tool_error`, runs 184 and 186) while the same list by ID read fine (run 183). This item reads ClickUp's server with a read-only probe to confirm why, finds out what the server offers to turn a name into an ID, and moves the kernel to IDs: the parser refuses a `list` or `space` that is not an ID, the kernel turns a list name Wright is given into the ID before it stores the poll, and a tool error on a dry run names the poll's filters first. The probe's result is also recorded in [`docs/OPEN_QUESTIONS.md`](../OPEN_QUESTIONS.md), and the design is in [MCP connectors: a list or space name at draft time](../architecture/mcp-connectors.md#a-list-or-space-name-at-draft-time).

## What the probe did, and did not do

- **Read only.** It called three tools the server marks `readOnlyHint: true` (`clickup_filter_tasks`, `clickup_get_list`, `clickup_get_workspace_hierarchy`) and listed the server's tools. It wrote nothing to ClickUp, to the Studio store or to the Keychain; the store was read with `sqlite3 -readonly`.
- **The owner's personal ClickUp only.** The connection is the one the owner made in Studio (`mcp_connections` row `clickup`). No work (Tray or vendsy) account was connected, read or called, and Jira was not touched.
- **No secret printed or kept.** The access token was read from the Keychain by the kernel's own `readMcpCredential` inside a scratch script outside the repository, passed to the kernel's own `callMcpTool`, and never printed. The scripts printed only `is_error`, text lengths and field names and types (a shape function prints names and types, never values). Raw answers went to files outside the repository; nothing from them is committed except the placeholder fixtures named below.
- **No task text.** The one call that returns tasks (`clickup_filter_tasks` by ID) printed only its shape. List, space and task names, ids and links are redacted here and in the fixtures.

## Step 1: build the kernel to a scratch directory, check the sign-in is readable

The kernel's own build, to a directory outside the repository (the 20g method), then a scratch script that only says whether a sign-in is present:

```bash
cd kernel && npm ci
node scripts/build.mjs --out-dir <scratch>/kdist
ln -s <repo>/kernel/node_modules <scratch>/node_modules     # so the built files resolve their packages
```

```js
import { securityCliKeychain } from "./kdist/auth/keychain.js";
import { readMcpCredential } from "./kdist/integrations/mcp/credential.js";
const cred = readMcpCredential(securityCliKeychain(), "clickup");
console.log("credential present:", cred !== undefined, "expires_at:", cred?.expires_at);   // the token is never printed
```

```text
credential present: true expires_at: 2036-11-06T13:08:39.453Z
```

## Step 2: the server's tool list

```js
import { writeFileSync } from "node:fs";
import { listMcpTools } from "./kdist/integrations/mcp/client.js";
const tools = await listMcpTools("https://mcp.clickup.com/mcp", cred.access_token);
console.log("tools/list ok:", tools.length);
writeFileSync(`${process.argv[2]}/tools-list.json`, JSON.stringify(tools, null, 2));   // outside the repository
for (const t of tools) console.log(t.name, "readOnlyHint=", t.annotations?.readOnlyHint);
```

```text
tools/list ok: 67
```

The tools that could turn a name into an ID, all `readOnlyHint: true`:

| Tool | Takes | Answers | Fit |
|---|---|---|---|
| `clickup_get_list` | `list_id` or `list_name` (the description: "Matching ignores case and surrounding whitespace, preferring an exact match. If several lists share the name, the first match is returned — verify the space in the result. If not found, confirm the name with the user rather than retrying variants.") | `{id, name, content?, space: {id, name}, url, statuses}` | the list lookup |
| `clickup_get_folder` | `folder_id` or `folder_name` with `space_id` or `space_name` | `{id, name, space: {id, name}}` | resolves a folder, not a space; a space name is only context |
| `clickup_get_workspace_hierarchy` | `max_depth` (`"0"` spaces, `"1"` folders, `"2"` lists), `limit` (at most 50), `cursor`, `space_ids`, `workspace_id` | `{hierarchy: {root: {id, name, children}}, next_cursor, has_more, total_spaces}` | the only tool that lists every space and list (so it could count same-named ones) |
| `clickup_get_list_location` | `list_id` | `{crumbs}` | an ID to names, the wrong way round |
| `clickup_search` | `keywords`, `filters` | content search over tasks, docs, chats | not a list or space lookup |

**There is no space lookup by name** other than the hierarchy tool.

### The hierarchy tool cannot be called by the kernel

`clickup_get_workspace_hierarchy` is not in the connected row's stored tool list. The reason is not that the server added it later. The kernel names a proxy tool `mcp__kernel__kernel_mcp_r_clickup_<mapped>` and keeps at most 64 characters, which leaves 30 for `<mapped>` ([the proxy tools](../architecture/mcp-connectors.md#the-proxy-tools); `mappedBudget("clickup")`). `clickup_get_workspace_hierarchy` is 31, so a connect drops it as `too_long`. Nine of the server's 67 tools are over 30 (`clickup_request_attachment_upload`, `clickup_download_task_attachment`, `clickup_get_chat_channel_messages`, `clickup_get_chat_message_replies`, `clickup_list_document_page_attachments`, `clickup_download_document_page_attachment`, `clickup_get_task_time_in_status`, `clickup_get_bulk_tasks_time_in_status`, `clickup_get_workspace_hierarchy`), and none of the nine is in the row; 67 - 9 = 58, the row's tool count. (The [20g evidence](phase-8-20g-clickup-reader.md) reads the 58 against 67 as a list that grew after the connect; it is the drop.)

```bash
sqlite3 -readonly ~/.loomwright-studio/studio.db "select kind, status, json_array_length(granted_tools) from mcp_connections"
```

```text
clickup|connected|58
```

The kernel only calls a tool that is in the stored list (`tool_unavailable` and no call otherwise), so the hierarchy tool is out of reach without changing that rule or the proxy-name rule, and neither is this item's to change. It was still probed, so the evidence says what it would give (below).

## Step 3: the calls

One scratch script made each call through the kernel's own `callMcpTool`, with the 20g shape printer. The tag is the Validation 2 walk's tag. The list is the owner's "Loomwright Studio" list (its ID is the one the 20g evidence already records).

```js
import { writeFileSync } from "node:fs";
import { callMcpTool } from "./kdist/integrations/mcp/client.js";
const URL = "https://mcp.clickup.com/mcp";
const READ_ONLY = new Set(["clickup_filter_tasks", "clickup_get_list", "clickup_get_workspace_hierarchy"]);
function shape(v, depth = 0) {              // names and types, never values
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length === 0 ? "[]" : `[${v.length} x ${shape(v[0], depth + 1)}]`;
  if (typeof v === "object") return depth > 4 ? "{...}" : "{" + Object.entries(v).map(([k, x]) => `${k}: ${shape(x, depth + 1)}`).join(", ") + "}";
  if (typeof v === "string") return /^[0-9]+$/.test(v) ? `digits(${v.length})` : `string(${v.length})`;
  return typeof v;
}
async function call(label, tool, args) {
  if (!READ_ONLY.has(tool)) throw new Error("not a read-only tool");
  const a = await callMcpTool(URL, cred.access_token, tool, args);
  writeFileSync(`${out}/raw-${label}.txt`, a.text);            // outside the repository
  const parsed = JSON.parse(a.text);
  console.log(`${label}: tool=${tool} is_error=${a.is_error} truncated=${a.truncated} text_length=${a.text.length}`);
  console.log(`   shape: ${shape(parsed)}`);
}
await call("filter-by-name", "clickup_filter_tasks", { list_ids: ["Loomwright Studio"], tags: ["studio-sandbox"] });
await call("filter-by-id", "clickup_filter_tasks", { list_ids: ["<the list's ID>"], tags: ["studio-sandbox"] });
await call("get-list-one", "clickup_get_list", { list_name: "Loomwright Studio" });
await call("get-list-none", "clickup_get_list", { list_name: "no such list zzq-probe-21a" });
await call("hierarchy-spaces", "clickup_get_workspace_hierarchy", { max_depth: "0", limit: 50 });
await call("hierarchy-full", "clickup_get_workspace_hierarchy", { max_depth: "2", limit: 50 });
await call("hierarchy-depth1", "clickup_get_workspace_hierarchy", { max_depth: "1", limit: 50 });
```

A second script called `clickup_get_list` for a partial name, a padded name and the exact name, and compared the answer's `name` and `id` (printing booleans only):

```js
for (const [label, name] of [["prefix", "Loomwright"], ["suffix", "Studio"], ["lower-padded", "  loomwright STUDIO "], ["exact", "Loomwright Studio"]]) {
  const a = await callMcpTool(URL, cred.access_token, "clickup_get_list", { list_name: name });
  const j = JSON.parse(a.text);
  console.log(`${label}: is_error=${a.is_error} text_length=${a.text.length} keys=${Object.keys(j).join(",")} id_digits=${/^[0-9]+$/.test(j.id ?? "")} returned_name_equals_asked=${j.name?.trim().toLowerCase() === name.trim().toLowerCase()}`);
}
```

### The outcome of each call

```text
filter-by-name: tool=clickup_filter_tasks is_error=true truncated=false text_length=82 json=true
   shape: {error: string(70)}
filter-by-id: tool=clickup_filter_tasks is_error=false truncated=false text_length=389 json=true
   shape: {tasks: [1 x {id: string(9), custom_id: null, name: string(30), status: string(5), url: string(35), priority: null, assignees: [], tags: [1 x {name: string(14)}], due_date: null, date_updated: digits(13), date_closed: null, list: {id: digits(12), name: string(17)}}], count: number, page: number, has_more: boolean, next_page: null}
get-list-one: tool=clickup_get_list is_error=false truncated=false text_length=574 json=true
   shape: {id: digits(12), name: string(17), space: {id: digits(11), name: string(10)}, url: string(55), statuses: [3 x {id: string(21), status: string(5), color: string(7), orderindex: number, type: string(4), status_group: string(16)}]}
get-list-none: tool=clickup_get_list is_error=true truncated=false text_length=57 json=true
   shape: {error: string(43)}
hierarchy-spaces: tool=clickup_get_workspace_hierarchy is_error=false truncated=false text_length=263 json=true
   shape: {hierarchy: {root: {id: digits(11), name: string(9), children: [2 x {id: digits(11), name: string(5), type: string(5), children: []}]}}, next_cursor: null, has_more: boolean, total_spaces: number}
hierarchy-full: tool=clickup_get_workspace_hierarchy is_error=false truncated=false text_length=643 json=true
   shape: {hierarchy: {root: {id: digits(11), name: string(9), children: [2 x {id: digits(11), name: string(5), type: string(5), children: [1 x {...}]}]}}, next_cursor: null, has_more: boolean, total_spaces: number}
hierarchy-depth1: tool=clickup_get_workspace_hierarchy is_error=false truncated=false text_length=263 json=true
   shape: {hierarchy: {root: {id: digits(11), name: string(9), children: [2 x {id: digits(11), name: string(5), type: string(5), children: []}]}}, next_cursor: null, has_more: boolean, total_spaces: number}

prefix: is_error=false text_length=580 keys=id,name,content,space,url,statuses id_digits=true returned_name_equals_asked=true
suffix: is_error=true text_length=37 keys=error id_digits=- returned_name_equals_asked=-
lower-padded: is_error=false text_length=574 keys=id,name,space,url,statuses id_digits=true returned_name_equals_asked=true
exact: is_error=false text_length=574 keys=id,name,space,url,statuses id_digits=true returned_name_equals_asked=true
```

What each says:

- **The cause is confirmed.** `clickup_filter_tasks` with `list_ids` set to the list's **name** is `is_error: true`, and its error text is `Failed to filter tasks: list_ids must be an array of isNumericOrNumber`; with the list's **ID** and the same tag it is `is_error: false` and answers the one task (`count` 1, `has_more` false, `list.id` equal to the requested ID). The requirement's cause holds: `list_ids` takes numeric IDs only, and the kernel sent `filters.list` unchecked. The kernel's reader drops the error text, so what a dry run saw was only `mcp_tool_error` and a fix line that led with the connection.
- **Every ID is digits only**: the list's `id`, its `space.id`, the hierarchy's workspace, space and list ids, and the task list's `list.id`. The ID rule is `^[0-9]{1,30}$` (`CLICKUP_SCOPE_ID`).
- **One match** (`clickup_get_list` with `list_name`): one list, `{id, name, space: {id, name}, url, statuses}`; a list with a description also carries `content` (a string). The padded, upper-and-lower-case spelling answered the same list as the exact one (`id` equal), and the answer's `name` equals the asked name ignoring case and padding.
- **A partial name.** `Loomwright` (a prefix of the list's name) answered a different list, whose own name is `Loomwright` exactly; `Studio` (a suffix) is `is_error: true`. So the tool matched by whole name in this workspace; it is not a substring search. The kernel still compares the answer's `name` with the asked name, so a looser match could never be taken for the list asked for.
- **No match** (`clickup_get_list`): `is_error: true`, `{"error": "List \"<name>\" not found"}`. The kernel's reader keeps no server text, so it sees only `mcp_tool_error`: a name no list has and any other refusal look the same to the kernel.
- **Several matches: not reachable.** The owner's workspace has 2 spaces and 5 lists and no two lists share a name (the hierarchy answer, compared case-insensitively). A second list of the same name would need a write to ClickUp, which a read-only probe must not do. What is known is `clickup_get_list`'s own description: the first match is returned. Its answer carries no count or flag, so the kernel cannot see "several" through it. This is recorded as a limit, not as a verified refusal.
- **Spaces.** `clickup_get_workspace_hierarchy` answers a space's name and ID (`max_depth: "0"`), and the lists under each space (`"2"`; a list sits in `children` with `type: "list"`; the workspace has no folders, so a list in a folder was not observed). `has_more` was false and `next_cursor` null (2 spaces, under the limit of 50). It would have been the lookup for both a space name and the count of same-named lists, but the kernel cannot call it (above).

## What the change does, and what it leaves open

The design the probe left standing, against the one the plan drafted:

- **A list name is looked up with `clickup_get_list`** (`MCP_TRACKERS.clickup.lookup.list`), at `kernel_playbook_create` and `_update`, by the kernel with the owner's sign-in (the path a due poll uses; not inside a session, not under the per-agent grant). The answer is taken only when its `id` is digits and its `name` equals the asked name. The ID replaces the name in the spec before anything is stored.
- **A name no list has** is refused naming `filters.list`, the name and `mcp_tool_error` (the kernel's message says this is how ClickUp answers a name that no list has), and tells Wright to ask the owner which list they mean. Nothing is stored.
- **A space name** is refused `tool_unavailable` with no call (no tool the kernel can call looks a space up by name). The plan said to refuse it this way if the stored list lacked a lookup; the probe shows it always will.
- **"Several" is not refused**, because the server never says so (above). The plan's AC4 wanted a refusal for several matches; through the tools the kernel can call, that is not possible. This is a documented limit and the owner's call ([open questions](../OPEN_QUESTIONS.md)).
- **A value that is already an ID makes no call.** `checkClickupFilters` refuses a `list` or `space` that is not digits, naming the filter and the value, so a stored spec, a dry run and a due fire name the filter instead of reporting a broken connection.
- **A dry run's `mcp_tool_error`** now names the poll's filters first (`ClickUp could not be read for clickup:list/901: mcp_tool_error. The server ran the read and refused it, so check the poll's filters first: clickup:list/901 is read from filters.list, … Then check the clickup connection in Integrations, then dry-run again.`) and the connection after. Every other code's fix line and GitHub's are unchanged.
- **Playbook 9** (a draft whose stored spec holds a name) is now unreadable: its dry run reports the filter, and a due fire would park it (`parkPoll`, "parked: no next fire"). It never read anything. The owner has Wright re-draft it (`kernel_playbook_update` with the list's name, which the kernel resolves).

## Committed fixtures

- `kernel/test/fixtures/mcp-trackers/clickup-lookup-tools.json`: the recorded `clickup_get_list` and `clickup_get_workspace_hierarchy` entries (`name`, `description`, `inputSchema`, `annotations`, `outputSchema`, verbatim; `_meta` left out). The second is recorded to pin why a space name has no lookup. `clickup-tools.json` and its pins are unchanged.
- `kernel/test/fixtures/mcp-trackers/clickup-lookup-responses.json`: `get_list_one` (the answer above with every id, name and link replaced by a placeholder; the id stays digits-only; the statuses are placeholders of the observed shape), `get_list_not_found` and `filter_tasks_by_name` (the two error answers, which hold no list name or ID).

## Validation 1

Static, from this branch, in the worktree (macOS 26.6.2, Node v24.11.1):

```bash
cd kernel && npm ci && npm test
cd .. && bash scripts/check-docs.sh
```

```text
 Test Files  137 passed | 2 skipped (139)
      Tests  4606 passed | 16 skipped (4622)
   Start at  23:43:33
   Duration  24.56s (tests 72%, import 15%, transform 11%, setup 1%)
```

```text
check-docs: OK
```

(`bash scripts/check-docs.sh`, exit 0: every relative link in `docs/`, `CLAUDE.md` and `README.md` resolves, including the ones this file and the edited architecture docs add.)

The tests this item adds: `kernel/test/clickup-scope.test.ts` (the resolver over the recorded answers and over the real reader and the fake MCP server), the non-ID refusal pins in `kernel/test/integrations-mcp-trackers.test.ts`, and the `mcp_tool_error` fix line, stored-name refusal, create-description and create/update tool-path pins in `kernel/test/playbooks-dry-run-poll.test.ts`. Each pin was checked by applying its one-line mutation and seeing the file fail: the ID rule (`/^[0-9]{1,30}$/` → `/^.{1,200}$/`), the `mcp_tool_error` branch, the create description's "are ClickUp IDs", the awaited resolution in each of the create and update handlers, the ID short-circuit, the returned-spec replacement and the answer-name check.

Verdict: PASS for Validation 1

## Validation 2

**Owner-closed after the PR opens.** The worker's part is this list of steps. The owner (or Claude, driving the app at the owner's request) runs them against the PR head built and running, and records the observed output and the verdict below. Nothing here is a result.

1. Build the PR head and run it as in [phase 8's setup step 8](phase-8-exit-runbook.md#setup): the kernel installed as the launchd service and the packaged app opened from Finder. Record `git rev-parse HEAD`, the service's pid and `sw_vers -productVersion`.
2. In Integrations, check ClickUp is connected and its tool list names `clickup_get_list` (it is in the row's 58; a connection recorded before ClickUp had it needs Reconnect ClickUp).
3. In Wright's thread, ask Wright for a ClickUp ticket playbook for a developer crew member that polls "the Loomwright Studio list" **by that name**, tagged `studio-sandbox`, with an interval the owner chooses. Give no ID. Wright only proposes; the owner sets the interval and the dedupe key.
4. Read the stored poll (`studio playbooks show <id>`, or the playbook's mirror): `filters.list` must be the list's numeric ID, not the name.
5. Run the playbook's dry run (Wright's `kernel_playbook_dry_run`, or the playbook's Dry run in the app). Check the poll preview lists the open task tagged `studio-sandbox`, and says whether it would run or skip under the owner's key.
6. Paste the dry run's output in the fenced block below. It must show the task's title and `clickup:<id>` ref and no `mcp_tool_error`.
7. Negative checks, optional: ask Wright for a poll on a list name that does not exist and see the refusal name `filters.list` and the name, and Wright ask which list you mean; ask for a poll on a space by name and see `filters.space` refused `tool_unavailable`.

The run's output (fenced), recorded by whoever ran it:

```text
(not run yet)
```

Owner's result (filled in from the owner's report, only from the observed run):

Verdict: (not run yet)
