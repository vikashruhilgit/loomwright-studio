# Phase 8 item 21b: a crew member's tracker grant in plain words

A crew member's ClickUp or Jira grant is today offered as one checkbox per raw tool name (58 for ClickUp). This item shows it as a short list of capabilities ("Read tickets", "Comment on tickets", ...). The kernel owns a fixed, exact-name list of those capabilities per tracker ([`MCP_TRACKER_CAPABILITIES`](../../kernel/src/integrations/mcp/trackers.ts)), and `GET /connectors` serves each connection's tools grouped by it. This file records the read-only probe that fixed ClickUp's list, the answer to whether ClickUp's server marks every tool with `readOnlyHint` and `destructiveHint`, and the **proposed** mapping of every ClickUp tool to a capability, for the owner to approve at merge. The hint answer is also in [`docs/OPEN_QUESTIONS.md`](../OPEN_QUESTIONS.md), and the design is in [MCP connectors: capabilities](../architecture/mcp-connectors.md#capabilities-a-trackers-tools-in-plain-words).

## What the probe did, and did not do

The method is [item 21a's](phase-8-21a-clickup-list-by-name.md#what-the-probe-did-and-did-not-do), on 2026-11-14.

- **Read only.** One call, the server's `tools/list`, through the kernel's own `listMcpTools`. No tool was called, so nothing was written to ClickUp, to the Studio store or to the Keychain. The store was read with `sqlite3 -readonly`.
- **The owner's personal ClickUp only.** The connection is the one the owner made in Studio (`mcp_connections` row `clickup`, `connected`, 58 tools stored). No work (Tray or vendsy) account was connected, read or called, and Jira was not touched.
- **No secret printed or kept.** The kernel's own `readMcpCredential` read the access token inside a scratch script outside the repository, and the script printed only the count and the tool names and hints. The raw `tools/list` answer went to a file outside the repository and nothing from it is committed (descriptions and schemas are not copied here).

```bash
cd kernel && npm ci
node scripts/build.mjs --out-dir <scratch>/kdist           # the kernel's own build, outside the repository
sqlite3 -readonly ~/.loomwright-studio/studio.db "select kind, status, json_array_length(granted_tools) from mcp_connections"
```

```text
clickup|connected|58
```

```js
import { securityCliKeychain } from "./kdist/auth/keychain.js";
import { readMcpCredential } from "./kdist/integrations/mcp/credential.js";
import { listMcpTools } from "./kdist/integrations/mcp/client.js";
const cred = readMcpCredential(securityCliKeychain(), "clickup");        // the token is never printed
const tools = await listMcpTools("https://mcp.clickup.com/mcp", cred.access_token);
console.log("tools/list ok:", tools.length);                             // then names and annotations only
```

```text
credential present: true
tools/list ok: 67
```

## The hint answer

**Every one of the server's 67 tools carries both `readOnlyHint` and `destructiveHint`, each a boolean.** 29 are `readOnlyHint: true` (all with `destructiveHint: false`), and 38 are `readOnlyHint: false`, of which 16 are `destructiveHint: true` and 22 are not.

This does not make the capability list derivable from the hints, so the kernel keeps its own exact-name list (the design decision this item recorded as confirmed):

- The hints only split read from write. `clickup_create_comment`, `clickup_create_task` and `clickup_update_task` are all `readOnlyHint: false`, and nothing in them says "comment" from "status change" or "create".
- `destructiveHint` is not "deletes": `clickup_update_task` and `clickup_move_task` are `true`, `clickup_create_task` is `false`, and `clickup_delete_task` and `clickup_delete_comment` are `true`. A grant by destructive flag would put an ordinary status change beside a delete.
- The kernel's stored tool list keeps only `read_only` (no destructive flag), so reading the destructive hint would also need a storage change.

The "revisit when" condition of that decision (the hints are set on every tool and the owner wants the list derived from them) is met on the first half only; it stays for the owner to call.

## The tools, and the mapping to capabilities

The mapping below is the worker's **proposal for the owner to approve at merge**. It is what `MCP_TRACKER_CAPABILITIES.clickup` holds. "In the stored list" says whether the connection's stored tool list has the tool: the kernel names a proxy tool `mcp__kernel__kernel_mcp_<r|w>_clickup_<mapped>` and keeps at most 64 characters, so a tool whose name is over 30 characters is dropped at connect ([item 21a](phase-8-21a-clickup-list-by-name.md#the-hierarchy-tool-cannot-be-called-by-the-kernel)); 9 of the 67 are, and the capability view only ever answers tools the connection lists. A tool no capability names is **other tools**: named in the Team screen, never granted by a capability tick.

| Tool | `readOnlyHint` | `destructiveHint` | In the stored list | Capability |
|---|---|---|---|---|
| `clickup_attach_task_file` | false | false | yes | other tools |
| `clickup_request_attachment_upload` | false | false | no (33 chars) | other tools |
| `clickup_download_task_attachment` | true | false | no (32 chars) | other tools |
| `clickup_get_chat_channels` | true | false | yes | chat |
| `clickup_send_chat_message` | false | false | yes | chat |
| `clickup_get_chat_channel_messages` | true | false | no (33 chars) | chat |
| `clickup_get_chat_message_replies` | true | false | no (32 chars) | chat |
| `clickup_react_to_chat_message` | false | false | yes | chat |
| `clickup_delete_chat_message` | false | true | yes | chat |
| `clickup_update_chat_message` | false | true | yes | chat |
| `clickup_get_task_comments` | true | false | yes | comment |
| `clickup_create_comment` | false | false | yes | comment |
| `clickup_create_task_comment` | false | false | yes | comment |
| `clickup_update_comment` | false | true | yes | comment |
| `clickup_delete_comment` | false | true | yes | delete |
| `clickup_get_threaded_comments` | true | false | yes | comment |
| `clickup_get_custom_fields` | true | false | yes | read |
| `clickup_create_document` | false | false | yes | other tools |
| `clickup_list_document_pages` | true | false | yes | other tools |
| `clickup_get_document_pages` | true | false | yes | other tools |
| `clickup_create_document_page` | false | false | yes | other tools |
| `clickup_update_document_page` | false | true | yes | other tools |
| `clickup_list_document_page_attachments` | true | false | no (38 chars) | other tools |
| `clickup_download_document_page_attachment` | true | false | no (41 chars) | other tools |
| `clickup_create_folder` | false | false | yes | other tools |
| `clickup_get_folder` | true | false | yes | read |
| `clickup_update_folder` | false | true | yes | other tools |
| `clickup_create_list` | false | false | yes | other tools |
| `clickup_create_list_in_folder` | false | false | yes | other tools |
| `clickup_get_list` | true | false | yes | read |
| `clickup_update_list` | false | true | yes | other tools |
| `clickup_get_workspace_members` | true | false | yes | read |
| `clickup_find_member_by_name` | true | false | yes | read |
| `clickup_resolve_assignees` | true | false | yes | read |
| `clickup_create_reminder` | false | false | yes | other tools |
| `clickup_search_reminders` | true | false | yes | other tools |
| `clickup_update_reminder` | false | false | yes | other tools |
| `clickup_create_space_tag` | false | false | yes | update |
| `clickup_add_tag_to_task` | false | false | yes | update |
| `clickup_remove_tag_from_task` | false | true | yes | update |
| `clickup_add_task_dependency` | false | false | yes | update |
| `clickup_remove_task_dependency` | false | true | yes | update |
| `clickup_add_task_link` | false | false | yes | update |
| `clickup_remove_task_link` | false | true | yes | update |
| `clickup_create_task` | false | false | yes | create |
| `clickup_get_task` | true | false | yes | read |
| `clickup_filter_tasks` | true | false | yes | read |
| `clickup_update_task` | false | true | yes | update |
| `clickup_delete_task` | false | true | yes | delete |
| `clickup_move_task` | false | true | yes | update |
| `clickup_add_task_to_list` | false | false | yes | update |
| `clickup_remove_task_from_list` | false | true | yes | update |
| `clickup_merge_tasks` | false | true | yes | delete |
| `clickup_start_time_tracking` | false | false | yes | other tools |
| `clickup_stop_time_tracking` | false | false | yes | other tools |
| `clickup_add_time_entry` | false | false | yes | other tools |
| `clickup_get_current_time_entry` | true | false | yes | other tools |
| `clickup_get_time_entries` | true | false | yes | other tools |
| `clickup_get_task_time_in_status` | true | false | no (31 chars) | read |
| `clickup_get_bulk_tasks_time_in_status` | true | false | no (37 chars) | read |
| `clickup_get_user` | true | false | yes | read |
| `clickup_execute_operator` | false | true | yes | other tools |
| `clickup_get_operators` | true | false | yes | other tools |
| `clickup_get_schema` | true | false | yes | read |
| `clickup_search` | true | false | yes | read |
| `clickup_get_workspace_hierarchy` | true | false | no (31 chars) | read |
| `clickup_get_list_location` | true | false | yes | read |

### How the capabilities are drawn

| Capability | Label | Marked as changing things | Why these tools |
|---|---|---|---|
| `read` | Read tickets | no | Every read-only tool that reads a task, a list, a folder or the people and fields a task refers to, including the poll's `clickup_filter_tasks` and the draft-time lookup `clickup_get_list` (so a member that can "read tickets" can run what the poll runs). |
| `comment` | Comment on tickets | yes | Reading comments, and creating or editing one. Deleting a comment is in `delete`, not here. |
| `update` | Change a ticket's status or fields | yes | `clickup_update_task`, moving a task, its list membership, tags, dependencies and links. |
| `create` | Create tickets | yes | `clickup_create_task` only. |
| `delete` | Delete or merge tickets, or delete comments | yes | Every tool that removes a task or a comment (a merge removes a task into another). |
| `chat` | Read and send chat messages | yes | The chat tools: they post to people outside the ticket. Reading is in it too, so one tick does not split a conversation. |

Tools left as **other tools** on purpose: documents, folders and lists (creating and changing the structure, not a ticket), reminders, time tracking, attachments, `clickup_execute_operator` (`openWorldHint: true`, destructive) and `clickup_get_operators`. The owner can still grant one of them by name on the raw list; no capability tick does.

**Not decided by the worker, for the owner:** whether `clickup_get_task_comments` and `clickup_get_threaded_comments` (reads) belong with "Comment on tickets" or with "Read tickets" (a member that reads tickets but must not see comments would need them apart), and whether the chat reads should be a separate capability from the chat writes.

## Jira

Jira is the owner's work account and is never connected or called from here, so Jira's capability list is **authored, not recorded**: the names follow Atlassian's Rovo MCP supported-tools page (the same source as `searchJiraIssuesUsingJql`, [item 07](../OPEN_QUESTIONS.md)), and are NEEDS VERIFICATION in [`docs/OPEN_QUESTIONS.md`](../OPEN_QUESTIONS.md). The capabilities are `read`, `comment`, `update` and `create`; Jira has no `delete` or `chat` capability because no such tool is documented. A name Atlassian's server does not list is simply never answered, and a tool it lists that no capability names is "Other tools": a wrong guess shrinks the list, it never widens a grant.

## Validation 1

The static checks, run at the head that holds the app half of this item (the worktree of subtask 4, with the kernel half and the Team inspector half already merged into it), on 2026-11-14, macOS, Node v24.11.1. The summaries are what each command printed; nothing is paraphrased upward.

```bash
cd kernel && npm ci && npm test
cd app && npm ci && npm run typecheck && npm test
cd app && npm run build && npx playwright test e2e/approvals.spec.ts e2e/team.spec.ts e2e/chat-charter-card.spec.ts --workers=1
bash scripts/check-docs.sh
```

```text
kernel   npm test:  Test Files  137 passed | 2 skipped (139)   Tests  4692 passed | 16 skipped (4708)
app      typecheck: tsc -p tsconfig.json && tsc -p tsconfig.node.json: exit 0
app      npm test:  Test Files  106 passed (106)              Tests  3336 passed (3336)
e2e      approvals.spec.ts + team.spec.ts + chat-charter-card.spec.ts (one run, --workers=1):  36 passed
check-docs: OK
```

What the e2e run covers for this item, beyond the specs that were already there:

- `app/e2e/approvals.spec.ts`, "item 21b": a held create of a ticket-working member (Ticket Runner) shows the readiness line "Ticket Runner can't read ClickUp tickets yet: it has no ClickUp access"; Choose access opens the capability list with nothing ticked and no raw tool name showing; ticking Read tickets and Allow once posts exactly one approve whose body is `{"decision":"once","owner_grant":{"kind":"clickup","tools":["clickup_get_task","clickup_filter_tasks"]}}`; approving the same held create without a tick posts `{"decision":"once"}` only.
- `app/e2e/team.spec.ts`, "phase 8 item 21b": the owner reads a member's permissions as jobs and grants ClickUp by capability, with no raw tool name above the collapsed section (subtask 3's spec).

Not run here: the kernel's own `owner_grant` path against a real ClickUp connection (the kernel suite pins it against stored tool lists, and the e2e uses the fixture kernel), and the packaged app (that is Validation 2).

## Validation 2

**Owner-closed after the PR opens.** The worker's part is this list of steps. The owner (or Claude, driving the app at the owner's request) runs them against the PR head built and running, with ClickUp connected, and records the observed output and the verdict below. Nothing here is a result, and the verdict line is written only by whoever performs the walk.

1. Build the PR head and run it as in [phase 8's setup step 8](phase-8-exit-runbook.md#setup): the kernel installed as the launchd service and the packaged app opened from Finder. Record `git rev-parse HEAD`, the service's pid and `sw_vers -productVersion`. In Integrations, check ClickUp is connected.
2. In Wright's thread, ask Wright for a crew member that works ClickUp tickets in the Loomwright Studio list. On the held card, check: the duty's source is ClickUp; a readiness row says the member can't read ClickUp tickets yet because it has no ClickUp access; Choose access opens the capability list in words ("Read tickets", "Comment on tickets", and so on) with nothing ticked; and no raw tool name shows anywhere above "Kernel tool names, as enforced" (Show full details).
3. Tick "Read tickets" and "Comment on tickets", and press Create. Check the member is created and holds exactly those two capabilities' tools (Team, or `studio agents show <id>`), and that Wright's next message does not name the ClickUp access as open.
4. Open the member in Team. Check PERMISSIONS reads as job labels with the raw names collapsed under "Kernel tool names, as enforced", and CONNECTORS shows ClickUp with those two capabilities granted and the rest not granted, "changes things" marked on Comment, and no "Ticket access still open" under Duties.
5. Ask Wright for a second such member and press Create without ticking anything. Check the card (before approving), the Team inspector ("Ticket access still open" under Duties) and Wright's next message each name the missing ClickUp access as the owner's step, and that nothing was granted.
6. Draft a ClickUp ticket playbook for the first member and dry-run it. Check it reads the list's open task tagged `studio-sandbox` (title and `clickup:<id>` ref in the preview, no `mcp_tool_error`).
7. Optional: in Approvals, repeat step 5's held card and confirm the same Choose access row is there, and that the A shortcut stands down while a checkbox has focus (the Allow once button decides).

Record, for each step, the observed output and a screenshot path; paste the dry run's output of step 6 in a fenced block.

### The walk

Run on 2026-11-14 between 16:55 and 17:03 local time (macOS 26.6.2, Node v24.11.1) by Claude, driving the app at the owner's request. Both the kernel and the app were built from this PR's head `503d915b`: `npm run build` then `service install` (launchd service, pid 88851), and `npm run package`, opened through LaunchServices with `open`. ClickUp connection row 1 is `connected`. Screenshots are in [`phase-8-21b-v2/`](phase-8-21b-v2/).

- **Step 1: PASS.** As above.
- **Step 2: FAIL (one check).** Wright drafted `ticket-triage-21b` (approval 37). The card has the readiness row "Ticket Triage 21b can't read ClickUp tickets yet: it has no ClickUp access (only you can grant it)" with Choose access, which opens the capabilities in words with nothing ticked ([1-card-choose-access.jpg](phase-8-21b-v2/1-card-choose-access.jpg)). But below them, in plain view, the card lists 21 raw tool names under "Other tools · no capability covers these" (`clickup_attach_task_file`, `clickup_create_document`, … `clickup_get_operators`), and the card has no "Kernel tool names, as enforced" fold above them ([2-card-other-tools-raw-names.jpg](phase-8-21b-v2/2-card-other-tools-raw-names.jpg)). This is a conflict inside the requirement: AC10 says an uncovered tool "appears under Other tools by name … and is never hidden", while this step says no raw name above the fold. The live ClickUp server has 21 such tools, so the conflict is not an edge case. The card also flags "duty 1 not covered (needs Hand tickets to /automate…)": Wright tagged the duty `jobs: ["automate_tickets"]` for a read-and-comment duty.
- **Step 3: PASS.** Ticked Read tickets and Comment on tickets, pressed Create. `studio agents show ticket-triage-21b`: `connectors.clickup` holds 17 tools, 12 of Read's 15 (the other 3 are not usable on this connection; `clickup_get_workspace_hierarchy` is dropped by design, `clickup-tasks.ts:174`) and all 5 of Comment's. The kernel's note: "The owner granted ClickUp access with this approval. The owner chose to proceed with these still open: duty 1 is not covered (needs Hand tickets to /automate)" ([3-created-kernel-note.jpg](phase-8-21b-v2/3-created-kernel-note.jpg)); Wright's next message did not name ClickUp access as open.
- **Step 4: PASS.** PERMISSIONS reads "No kernel jobs granted." with "Kernel tool names, as enforced" collapsed; CONNECTORS reads "ClickUp 17 of 58 tools granted", Read and Comment granted, the rest not granted, "changes things" on Comment; no "Ticket access still open" ([4-inspector-connectors.jpg](phase-8-21b-v2/4-inspector-connectors.jpg)). The same 21-name "Other tools" list shows here too.
- **Step 5: FAIL.** Wright drafted `ticket-triage-21b-two` (approval 38) for the same kind of duty, but this time wrote it with `jobs: []` and no `source` (approval 37's had `source: "clickup"`). The kernel's readiness then reads "Covered: duty 1 with no tool (it needs no kernel tool)" and names no ClickUp access ([5-second-card-covered.jpg](phase-8-21b-v2/5-second-card-covered.jpg)). Created with nothing ticked: `connectors: none`, and the inspector shows no "Ticket access still open" ([5-second-inspector-no-open-access.jpg](phase-8-21b-v2/5-second-inspector-no-open-access.jpg)). Only Wright's own next message named the missing ClickUp access ([5-wright-names-step.jpg](phase-8-21b-v2/5-wright-names-step.jpg)). Cause: the tracker-access check runs only when the model tags the duty's `source`, so the kernel's verdict depends on a field the model may leave out.
- **Step 6: PASS.** Without being asked, Wright drafted playbook 10 for `ticket-triage-21b` and dry-ran it (run 189). It read the list's tagged task with no `mcp_tool_error`; its review session used 124,277 tokens and drafted no comment.
- **Step 7:** not run.

Also seen: Wright drafted a playbook (11) for the second member although asked not to, and did not dry-run it. Both playbooks are drafts; a draft's trigger does not fire (playbook 9's trigger has been on since 2026-11-13 with only `dry_run` rows).

```text
playbook_runs id 189: kind dry_run, status done, playbook 10 version 1, session 150, tokens 124277
  poll.spec: {"source":"clickup.tasks","filters":{"list":"901422761392","tags":["studio-sandbox"]},"interval_seconds":900}
  poll.items:
    ref      clickup:86bd2djuq
    title    Add a README to studio-sandbox
    would    run
  poll.reviewed: clickup:86bd2djuq; drafts: []; no preview_incomplete, no mcp_tool_error
```

Verdict: FAIL for Validation 2 (steps 2 and 5)
