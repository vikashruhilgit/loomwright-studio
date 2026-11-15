# Phase 8 item 22a: wave 1 of item 21 walked live on the merged `main`

Requirement: `.supervisor/requirements/phase-8-22/2026-11-14-230550-a-wave-1-of-phase-8-21-walked-live-on-the-merged-main.md`. This file is the record of the walk. Nothing below is written from the code: every block is output that was observed, and a step that was not run says so.

## Setup (21b Validation 2, step 1)

| Item | Observed |
|---|---|
| Walked commit | `1949901eede7ba7e3d00c4be23f4b0c8e187b67b` (`main`, merge of PR #280), working tree clean |
| `sw_vers -productVersion` | `26.6.2` (Node `v24.11.1`) |
| Kernel | `npm ci`, `npm run build`, then `node dist/cli/index.js service install`: "installed and loaded: kernel 0.0.0 (pid 1229) running from `/Users/<name>/.loomwright-studio/app/0.0.0`" |
| Service pid | `1229` (`launchctl list`, and `studio status`: "kernel 0.0.0, pid 1229, up 25s") |
| App | `npm run package` (exit 0), `release/mac-arm64/Loomwright Studio.app`, opened through LaunchServices with `open` (process running) |
| ClickUp | `mcp_connections` row 1: `clickup`, `connected` (and `GET /connectors` lists its capabilities) |

Before installing over the running service, the plist and the store were read: the service was the previous walk's kernel (started 2026-11-14 17:44 from `.../app/0.0.0/dist/daemon.js`), no session or run was in flight (`sessions` had no `running`/`starting` row, no `playbook_runs` row `running`), and the sibling automate lanes were not walking (lane 1 was in its Supervisor phase, lane 3 had parked). Nothing was clobbered.

How the steps were driven: the app's window did not take input from this session, so the walk used the kernel's own surfaces: `studio ask` (Wright's thread), `studio agents`, `studio playbooks`, the loopback API with the owner's Keychain token (the same `POST /approvals/:id/approve` the app's card posts), and `sqlite3 -readonly` on the store. The app was running against the same kernel but the screens (held card, Team inspector) were **not looked at**; see "Not verified".

## AC1: 21b Validation 2 steps 1, 3, 4, 6

### Step 1: PASS

See Setup. The service and the app were built from `1949901e`; ClickUp is connected.

### Step 2 (context for step 3; not one of the four steps)

`studio ask` ("create a crew member Wright Walk 22a One ... duty's tracker is ClickUp ... no kernel jobs ... no playbook") produced approval 41, a `kernel_agent_create` held for the owner. `studio approvals` showed the readiness block the card is built from:

```text
#41  pending  agent wright  session 157
  action:  kernel_agent_create
    Create crew member wright-walk-22a-one ("Wright Walk 22a One", turtle crew-teal), proposed by Wright
    readiness: checked by the kernel before you see it
      covered: duty 1 with no tool (it needs no kernel tool): Read ClickUp tickets in the Loomwright Studio list and comment on them.
      flagged: duty 1: Wright Walk 22a One can't read ClickUp tickets yet: it has no ClickUp access (only you can grant it)
    enforced: never: git_push, ... ; tools: Read; bash prefixes: none
```

### Step 3: PASS

"Read tickets" and "Comment on tickets" were ticked by posting what the card posts: `POST /approvals/41/approve` with `{"decision":"once","owner_grant":{"kind":"clickup","tools":[<the 12 tools of Read tickets>, <the 5 of Comment on tickets>]}}`, the two capabilities' tool lists exactly as `GET /connectors` returned them for the live connection (12 of Read's 15 are usable on this connection; Comment's 5). Answer `200`, approval `approved`. `studio agents show wright-walk-22a-one`, the `connectors` block of its settings file:

```text
"connectors": {
  "clickup": [
    "clickup_filter_tasks", "clickup_get_task", "clickup_search", "clickup_get_list",
    "clickup_get_folder", "clickup_get_list_location", "clickup_get_custom_fields",
    "clickup_get_workspace_members", "clickup_find_member_by_name", "clickup_resolve_assignees",
    "clickup_get_user", "clickup_get_schema",
    "clickup_get_task_comments", "clickup_get_threaded_comments", "clickup_create_comment",
    "clickup_create_task_comment", "clickup_update_comment"
  ]
}
```

That is 17 tools: Read tickets (12) and Comment on tickets (5), nothing else, and `allowedTools` is `["Read"]`. The recorded grant (the file was rebuilt after the commit from this record, the path 21b's later commits changed):

```text
events 23670 agent_created, 23671 agent_settings_set, 23673 approval_decided   (all 2026-11-15T02:21:12.856Z)
23671 agent_settings_set kernel {"id":"wright-walk-22a-one","field":"connectors","old":null,
  "new":{"clickup":[ ...the same 17 tools... ]},"by":"owner","approval_id":41}
```

The kernel's note to Wright and Wright's next message (`studio messages --agent wright`, #131), which does not name ClickUp access as open:

```text
kernel: approved approval 41: kernel_agent_create. The kernel created crew member wright-walk-22a-one
  (Wright Walk 22a One) on approval 41. The owner granted ClickUp access with this approval. ...
Wright: You approved it, so Wright Walk 22a One now exists. You also gave it ClickUp access with that
  approval, so it can read tickets in the Loomwright Studio list. As you asked, I haven't drafted a
  playbook or started any runs. ...
```

### Step 4: PASS on the kernel's side; the Team screen was not looked at

`GET /agents/wright-walk-22a-one` (what the inspector reads): `connectors: ["clickup"]`, `settings_error: null`, and

```text
tracker_access: [{"duty":"Read ClickUp tickets in the Loomwright Studio list and comment on them.",
  "source":"clickup","status":"granted","line":"Wright Walk 22a One can read ClickUp tickets"}]
```

`status: granted` is what makes the inspector show no "Ticket access still open" under Duties. The PERMISSIONS and CONNECTORS panels (job labels, "Kernel tool names, as enforced" collapsed, "changes things" on Comment) are drawn by the app from this data; the screen itself was not observed, so that part of step 4 is **not verified** here.

### Step 6: PASS for the poll preview; the review session could not read the ticket's body (finding, see below)

Playbook 15 (draft, member One, a ClickUp poll of list `901422761392` tagged `studio-sandbox`, no jobs; model set by the owner to `claude-sonnet-5-5`) was dry-run once through `studio ask`:

```text
playbook_runs id 193: kind dry_run, status done, playbook 15 version 2, session 171, tokens 123645
  2026-11-15T02:30:31.426Z -> 2026-11-15T02:31:00.853Z
  poll.items: clickup:86bd2djuq  "Add a README to studio-sandbox"  would run
  poll.reviewed: clickup:86bd2djuq; drafts: []; no preview_incomplete, no mcp_tool_error
  fit: status no_jobs, owner_steps []
```

The title and the `clickup:<id>` ref are in the preview and there is no `mcp_tool_error`, which is what step 6 asks. Also seen, and not what step 6 asks: the review session of run 193 (a member that holds Read tickets and Comment on tickets) says "I couldn't read the task, so this note covers only the title and metadata. The ClickUp read call was blocked (`tool_not_allowed`)". Session 171's output has the call `mcp__kernel__kernel_mcp_r_clickup_clickup_get_task` and the decision `deny`, reason `tool_not_allowed`. A dry-run session allows only its fixed read-only set (`docs/architecture/dry-run.md`: "a tool of any other MCP server never counts"), so no dry-run review session reads a ClickUp ticket's body, granted or not. Run 189 (the 21b walk) shows the same text. This is outside the requirement and is not changed here; it is named for the owner in "Findings".

## AC2: the settings file removed, then the next crew message

Before (the file as left by step 3, sha-256 prefix `81bc2b6c1b6c`; its `connectors` block is the one above). The file was moved aside, and:

```text
$ studio agents show wright-walk-22a-one
wright-walk-22a-one "Wright Walk 22a One" turtle crew-teal: active; settings settings_missing; ...
  settings error: settings_missing: .../config/agents/wright-walk-22a-one.json: no settings file for agent "wright-walk-22a-one" (the kernel never creates one for a crew member)
$ studio ask --agent wright-walk-22a-one "Reply with the single word ok. ..."
studio: wright-walk-22a-one has no settings file: .../wright-walk-22a-one.json; nothing was queued     (exit 1)
```

The owner's direct message is refused `409 settings_missing` and nothing runs, so it does not heal the file. That is the documented behaviour (`docs/architecture/brain.md`: "`POST /ask` only reads ... a message reaching the handler through the queue has its file re-created from the charter first (`ensureAgentFiles`)"), not a regression of this wave. The path that does reach the handler is a message from another agent, so Wright was asked to delegate one ("Delegate one short message to wright-walk-22a-one ..."):

```text
Wright: The message to wright-walk-22a-one is queued (queue id 301), so nothing refused it.
brain_messages 133: wright-walk-22a-one, from agent:wright, depth 1, status replied, session 160
$ ls -la config/agents/wright-walk-22a-one.json
-rw-------  1 <name>  staff  1234 Nov 15 07:52 .../wright-walk-22a-one.json
$ cmp  config/agents/wright-walk-22a-one.json  <the removed file>
(no output: byte-identical)
```

After: `studio agents show wright-walk-22a-one` reads `active`, model `claude-sonnet-4-5`, and the `connectors` block is the same 17 `clickup` tools; `GET /agents/wright-walk-22a-one` again gives `connectors: ["clickup"]`, `settings_error: null` and `tracker_access[0].status: granted` (the inspector's data; the screen itself was not looked at). **AC2: PASS** (the file came back byte-identical with the grant, through the queue path).

## AC3: 21e's setup, then the GitHub grant and a new dry run (21e AC5)

Setup, a 21e-shaped member: `wright-walk-22a-two` (created by the owner from a charter file: one duty `{jobs: ["automate_tickets"], source: "clickup"}`), ClickUp Read tickets granted with `studio agents set ... connectors clickup:<12 tools>`, no GitHub grant, a draft playbook 13 (ClickUp poll, list `901422761392`, tag `studio-sandbox`, interval 900, drafted by Wright from the owner's words; model set to `claude-sonnet-5-5` by the owner). `studio ask` "Dry-run playbook 13 once" gave run 190:

```text
playbook_runs id 190: kind dry_run, status done, playbook 13 version 2, session_id (none), tokens 0
  2026-11-15T02:25:21.781Z -> 2026-11-15T02:25:21.781Z
  poll.items: clickup:86bd2djuq  "Add a README to studio-sandbox"  would run
  poll.reviewed: null
  poll.preview_incomplete: {"reason":"owner_step_open","fix":"Wright Walk 22a Two needs GitHub write access for Hand tickets to /automate; only you can grant it: Team -> Wright Walk 22a Two's inspector."}
  refused: Hand tickets to /automate (a copy of a repo to work in)
  fit: agent wright-walk-22a-two, jobs automate_tickets, status gap, owner_steps [the GitHub write step above]
```

The owner's grant: `studio agents set wright-walk-22a-two connectors github:write` (the route the Team screen uses), then `studio ask` "Dry-run playbook 13 once more (a new dry run, new key)":

```text
$ studio agents set wright-walk-22a-two connectors github:write
... connectors set to github:write clickup:<the 12 tools> (was clickup:<the 12 tools>)
playbook_runs id 191: kind dry_run, status done, playbook 13 version 2, session 165, tokens 128356
  2026-11-15T02:26:12.719Z -> 2026-11-15T02:26:45.320Z
  poll.items: clickup:86bd2djuq  "Add a README to studio-sandbox"  would run
  poll.reviewed: clickup:86bd2djuq; drafts: []; no preview_incomplete
  would_do: mcp__kernel__kernel_automate_state {"repo":"vikashruhilgit/studio-sandbox"}  would run (dry_run)
  refused: Hand tickets to /automate (a copy of a repo to work in)
  fit: status gap, owner_steps []     (the grant closed the owner step; the workspace gap is not closable by a grant)
```

The summary's one claim about the enable, as Wright quoted it from the run's summary: "A dry run never reaches them, but a real run would be refused: Hand tickets to /automate (a copy of a repo to work in). The enable is refused (charter_gap) unless the owner enables it anyway." (the `charter_gap` claim is stated once). **AC3: PASS**: the review ran after the grant, 128,356 tokens (run 187 in the 21e walk: about 100k).

## AC4: a member whose only duty is `source: "clickup"`, `jobs: []`, no ClickUp grant; a no-jobs ClickUp poll playbook

Setup: `wright-walk-22a-three` (created by the owner from a charter file: duty `{jobs: [], source: "clickup"}`, `tool_policy` `Read, Glob, Grep`), no `connectors`; `GET /agents/wright-walk-22a-three` `tracker_access`: `status: no_access`, "Wright Walk 22a Three can't read ClickUp tickets yet: it has no ClickUp access". Playbook 14 (draft, ClickUp poll of the same list and tag, interval 900, no jobs; Wright's first draft passed `jobs: []`, the kernel refused it, and Wright left the field out; model set to `claude-sonnet-5-5` by the owner). `studio ask` "Dry-run playbook 14 once" gave run 192:

```text
playbook_runs id 192: kind dry_run, status done, playbook 14 version 2, session 168, tokens 50752
  2026-11-15T02:28:31.034Z -> 2026-11-15T02:29:01.615Z
  poll.items: clickup:86bd2djuq  "Add a README to studio-sandbox"  would run
  poll.reviewed: clickup:86bd2djuq; drafts: []; no preview_incomplete
  fit: {"agent":"wright-walk-22a-three","jobs":[],"status":"no_jobs","lines":["This playbook names no jobs, so Wright Walk 22a Three's tools were not checked against it."],"missing":[],"refused_calls":[],"owner_steps":[]}
  final_text: "**Triage note: clickup:86bd2djuq, "Add a README to studio-sandbox"** I couldn't open the full ClickUp
    task. I have no ClickUp read tool in this session, so this note uses only the polled fields: title,
    status (to do) and revision (2026-11-12). I haven't seen a description or acceptance criteria. ..."
Summary (Wright's word-for-word quote): Dry run 192 of version 2 completed, 50752 tokens; it would do nothing that
  acts. Next fires (UTC): none. Dedupe key for the next fire (preview): none. The poll found 1 ClickUp task:
  1 would run, 0 would skip: clickup:86bd2djuq would run. It reviewed clickup:86bd2djuq in a draft-only session;
  it drafted nothing.
```

**AC4: FAIL at `1949901e`.** A review session started (session 168) for a member that has no ClickUp grant and could not read the ticket, it used 50,752 tokens, and the summary names no owner step: the `no_jobs` fit has `owner_steps: []`, so `ownerStepsOf` (`kernel/src/playbooks/dry-run.ts`) lets the review run. This is the case the brief read from the code; it is now observed. The fix follows this commit (AC6 order): the failing observation is committed here first.

## Evidence state at the end of the pre-fix walk

Observed so far: step 1, 3, 4 (kernel side), 6, AC2, AC3 PASS; AC4 FAIL. AC5 (the grant of Read tickets to member Three and a new dry run) is walked at the fixed head, once, so the review session it runs is not spent twice.

Test members and playbooks created by the walk (to be turned off at the end; Studio has no delete): members `wright-walk-22a-one`, `wright-walk-22a-two`, `wright-walk-22a-three`; playbooks 13, 14, 15 (all `draft`).

## The fix (after the failing observation above was committed as `52e605a6`)

Commit `a0aaa8ef`: `pollGrantOwnerSteps` in `kernel/src/playbooks/fit.ts` (the poll source's own read grant through `grantNeeds`, `holdsConnector` and `ownerStep`, never a second wording), used by `ownerStepsOf` in `kernel/src/playbooks/dry-run.ts` for a `no_jobs` fit only. `playbookFit` still returns `no_jobs` with `owner_steps: []` (its pin in `playbooks-fit.test.ts` is green) and `enable.ts` is untouched. No new `preview_incomplete` reason. `docs/architecture/dry-run.md` says so.

Test: `kernel/test/playbooks-dry-run-poll.test.ts`, inside the 21e describe block, a nested describe with three cases over a real store and the shipped catalogue: AC4 (a member whose only duty is `source: "clickup"`, `jobs: []`, no grant; a throwing session starter is never called; items listed; `reviewed` null; `preview_incomplete` `{owner_step_open, fix}`; row `done`, `session_id` NULL, `tokens` 0; stored `final_text` null; the summary shows none of `owner_step_open`, `charter_gap`, `mcp__`, `kernel_`), AC5 (after the grant a new key runs the review) and a member that already holds the access (the review runs). The ClickUp fixtures of the AC9 describe (`CLICKUP_SPEC`, `task`, `listTool`, `reader`) moved to module scope to be reused, and a hoisted `vi.mock` of `createMcpTicketReader` lets a test point the dry-run tool's ticket reader at a stand-in (no override set: the real reader, as before).

Pin mutation, done by hand: in `ownerStepsOf`, `if (fit.status === "no_jobs") return pollGrantOwnerSteps(store, row);` replaced by `return [];` (the base behaviour). Result: 2 failed, 51 passed: the AC4 and AC5 cases fail with "kernel_playbook_dry_run: no session may start" (the throwing starter was called). Restored; 53 passed.

## Re-walk at the fixed head `a0aaa8eff7ada2cae5335045a6206477c3cecbb3`

Kernel rebuilt (`npm run build`), `service install` (pid 78687; the install copy's `dist/playbooks/dry-run.js` carries `pollGrantOwnerSteps`), app repackaged (`npm run package`, exit 0).

### AC4 re-walk: PASS

Same member (`wright-walk-22a-three`, no ClickUp grant) and playbook 14, `studio ask` "Dry-run playbook 14 once ...":

```text
playbook_runs id 194: kind dry_run, status done, playbook 14 version 2, session_id (none), tokens 0
  2026-11-15T02:35:52.644Z -> 2026-11-15T02:35:52.644Z
  poll.items: clickup:86bd2djuq  "Add a README to studio-sandbox"  would run
  poll.reviewed: null
  poll.preview_incomplete: {"reason":"owner_step_open","fix":"Wright Walk 22a Three needs ClickUp access for watching ClickUp; only you can grant it: Team -> Wright Walk 22a Three's inspector."}
  final_text null, usage {}
  fit: status no_jobs, owner_steps []   (unchanged)
Summary (Wright's word-for-word quote): Dry run 194 of version 2 completed, 0 tokens; it would do nothing that acts.
  Next fires (UTC): none. Dedupe key for the next fire (preview): none. The poll found 1 ClickUp task: 1 would run,
  0 would skip: clickup:86bd2djuq would run. The review was skipped, and no session started, until the owner takes
  this step: Wright Walk 22a Three needs ClickUp access for watching ClickUp; only you can grant it: Team ->
  Wright Walk 22a Three's inspector. This dry run still counts toward the enable; a real run would be refused until then.
```

`sessions` for that member: still 1 (session 168 from the failing run); the re-walk started none. Wright's reply named the missing ClickUp access as the owner's step in Team and said no session started.

### AC5: PASS

The owner's grant, `studio agents set wright-walk-22a-three connectors clickup:<the 12 tools of Read tickets>`, then `studio ask` "Dry-run playbook 14 once more (a new dry run, new key)":

```text
playbook_runs id 195: kind dry_run, status done, playbook 14 version 2, session 174, tokens 116437
  2026-11-15T02:36:37.735Z -> 2026-11-15T02:37:06.988Z
  poll.items: clickup:86bd2djuq  "Add a README to studio-sandbox"  would run
  poll.reviewed: clickup:86bd2djuq; drafts: []; no preview_incomplete
```

The review ran as for any member with access (run 191, 128,356 tokens; run 193, 123,645).

## Static validation

```text
cd kernel && npm ci && npm test   (final head a0aaa8ef, plus this evidence commit)
  Test Files  137 passed | 2 skipped (139)   Tests  4739 passed | 16 skipped (4755)
bash scripts/check-docs.sh
  check-docs: OK
```

The suite was not run before the fix, so no before/after count is claimed; no existing test was edited, and the three new cases are the only additions to the 21e block.

## Clean-up: test members and playbooks the walk created

Turned off (Studio has no delete): members `wright-walk-22a-one`, `wright-walk-22a-two`, `wright-walk-22a-three` (`studio agents off`, all `off`); playbooks 13, 14, 15 (`studio playbooks off`, all `disabled`). Their three poll triggers (22, 23, 24) belong to disabled playbooks; no `playbook_runs` row appeared after run 195. Wright's thread also holds the walk's messages. Approval 41 is the one approval the walk made.

## Not verified

- **The Team inspector and the held card were not looked at.** The app's window did not take input from this session. One attempt to bring it forward and press the Team shortcut sent the keystroke to another application that was in front instead, so GUI driving was stopped. Step 2's card, step 4's PERMISSIONS and CONNECTORS panels, "no Ticket access still open" under Duties, and AC2's "the inspector shows the same capabilities granted" are read from the kernel data the screens draw from (`GET /agents/:id` `connectors`, `settings_error`, `tracker_access`; `GET /connectors` capabilities), not from the screens. Step 3's tick was posted as the card posts it, not clicked.
- The app was rebuilt and opened, but the repackaged build was not opened after the fix (the fix is kernel-only).
- AC2's "next crew message" from the owner is refused `settings_missing` by design (see AC2); the file was healed through the queue path (a message from Wright).

## Findings (outside this item's scope, not changed)

1. A dry-run review session cannot read a ClickUp ticket's body for any member, granted or not: its fixed read-only set does not include a ClickUp tool (runs 189, 193 and 195: `tool_not_allowed`). So the review's output for a ClickUp poll is built from the poll's title and status only. The AC4 fix removes the waste for a member with no access; it does not make the review read the ticket. Whether that is wanted is the owner's call.
2. The 21b step 6 wording ("reads the list's open task ... no `mcp_tool_error`") is met by the poll preview; the review session's own read is denied, as in finding 1.

## Verdict

No pass verdict line is written. Every kernel-side check passed at the final head (steps 1, 3, 6, AC2, AC3, AC4 re-walk, AC5, static validation), but the screens named under "Not verified" were not observed, and the brief's rule is that a step that could not be run is recorded and no verdict is written for it. Whoever looks at the Team inspector and the held card on the running app can add the verdict line.
