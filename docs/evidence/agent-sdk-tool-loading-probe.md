# Evidence: how a kernel session gets its kernel MCP tools (`ENABLE_TOOL_SEARCH`)

The owner's live phase 2 exit run of 2026-10-15 ([evidence](phase-2-exit-live-2026-10-15.json)) failed because, in every Wright session, the Agent SDK offered the kernel's MCP tools only through its `ToolSearch` meta-tool. The kernel's PreToolUse gate (`decideToolUse`) allows exact policy names only, and Wright's proposed policy does not list `ToolSearch`, so the load was denied and Wright could call none of its kernel tools. The owner chose to turn the SDK's tool deferral off on every kernel launch (approach (b)), with a gate exception for `ToolSearch` alone (approach (a)) only as a fallback. This page records the probe that decided between them, run by the worker before the fix was written, and the live test run after it.

**Result: approach (b) works.** With `ENABLE_TOOL_SEARCH=false` in the env the kernel passes to `query()`, the CLI did not offer `ToolSearch` at all, offered every kernel tool directly, and the session called `mcp__kernel__kernel_trigger_register` on its first try. The gate is unchanged, and fallback (a) was not used.

## 1. The setting, read off the bundled CLI

**Run by the worker, 2026-10-15, macOS 26.6.2 (25G83), Node v24.11.1, `@anthropic-ai/claude-agent-sdk` 0.3.284** (the version pinned in `kernel/package.json`; `node -p "require('./node_modules/@anthropic-ai/claude-agent-sdk/package.json').version"` printed `0.3.284`).

`ENABLE_TOOL_SEARCH` is not in the SDK's TypeScript types. The bundled CLI binary names it:

```bash
cd kernel && strings node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude | grep -n "ENABLE_TOOL_SEARCH"
```

The relevant lines of the output (lines of minified code clipped):

```text
271205:, ENABLE_TOOL_SEARCH=
271208: is not a first-party Anthropic host. Set ENABLE_TOOL_SEARCH=true (or auto / auto:N) if your proxy forwards tool_reference blocks.
271211:Invalid ENABLE_TOOL_SEARCH value "
304530:- **Claude API, Vertex AI, Bedrock, or Bedrock Mantle with no custom base URL**: not needed. The app leaves Claude Code's experimental betas on there, as terminal Claude Code does, so tool search is on by default (on Vertex AI, for Claude 4.5 and newer models). To turn it off in Code, Cowork, and Chat, set `ENABLE_TOOL_SEARCH` to `false` in the `env` block of OS-level Claude Code managed se
```

So tool search is on by default on the Claude API, `false` is the documented off value, and `true`, `auto` and `auto:N` are the other values. That text is the CLI's own documentation, not a result. Section 2 is the result.

## 2. The probe: four kernel sessions, with and without the setting

The probe used the kernel's own launch path, unchanged: the code at base commit `95d3156` (before the fix), a `SessionManager` with the subscription token from the Keychain (`selectAuthProvider(SUBSCRIPTION_TOKEN_ID, { store })`), and the kernel MCP server attached the way `kernel/src/kernel.ts` attaches it (`createKernelMcpServer({ store, sessions: manager, sessionId }, tools)` through the `mcpServers` factory, `tools` merged from `SHIPPED_CONTRIBUTIONS`). That gives `settingSources: []`, the local Loomwright plugin, streaming input and the kernel's PreToolUse gate. Every session ran under Wright's proposed policy, unchanged (`PROPOSED_ALLOWED_TOOLS`, no Bash prefixes), with `permissionMode: "default"`, model `claude-haiku-4-5`, a fresh store, and a cwd from `mkdtempSync(join(tmpdir(), …))` (never under `~/Documents`, D31). The prompt was:

```text
You are Wright. The user says: remind me at 17:00 today to check X. Use your kernel trigger tool to register a once trigger with action notify. Then reply DONE.
```

The setting went into the manager's `baseEnv`. The subscription provider keeps every non-credential variable, so it reached `options.env` as passed to `query()`. The probe read it back from those options (`ENABLE_TOOL_SEARCH`: absent in the runs without it, `"false"` in the run with it). The probe was a throwaway vitest file in the session's scratch dir, run from `kernel/` as `PROBE_KERNEL=$PWD PROBE_OUT=<file> [PROBE_TOOL_SEARCH=false] npx vitest run --dir <scratch dir>`. It was not committed; this page is the record. For each run it recorded the `system/init` tool list, the tool calls in the assistant messages, and the store's `tool_decision` events and `triggers` rows.

Four sessions ran, in this order:

| Run | `ENABLE_TOOL_SEARCH` in `options.env` | Tools offered (`system/init`) | Tool calls, in order | Trigger registered | Reply |
|---|---|---|---|---|---|
| 0 | absent | not recorded | not recorded | not recorded | not recorded |
| A1 | absent | 44, `ToolSearch` among them | `ToolSearch`, then `mcp__kernel__kernel_trigger_register` ×5 | yes (one row) | `DONE` |
| B | `false` | 43, no `ToolSearch` | `mcp__kernel__kernel_trigger_register` ×1 | yes (one row) | `DONE` |
| A2 | absent | 44, `ToolSearch` among them | `ToolSearch` ×2, `Skill` ×2 | no | says it lacks permission |

- **Run 0** session ran (about 18 s), but the probe's own read of the `triggers` table failed (`SqliteError: no such column: spec`, a wrong column name in the probe) before anything was written. Nothing from it is claimed.
- **Run A1** store's `tool_decision` rows (session 1):

  ```text
  3 {"tool":"ToolSearch","decision":"deny","reason":"tool_not_allowed"}
  4 {"tool":"mcp__kernel__kernel_trigger_register","decision":"allow","reason":"tool_allowed"}
  5 {"tool":"mcp__kernel__kernel_trigger_register","decision":"allow","reason":"tool_allowed"}
  6 {"tool":"mcp__kernel__kernel_trigger_register","decision":"allow","reason":"tool_allowed"}
  7 {"tool":"mcp__kernel__kernel_trigger_register","decision":"allow","reason":"tool_allowed"}
  8 {"tool":"mcp__kernel__kernel_trigger_register","decision":"allow","reason":"tool_allowed"}
  ```

  Trigger row: `once`, `{"at":"2026-10-15T17:00:00Z"}`, `notify`, `created_by` `agent`. The tool results were not captured in this run, so why it called the tool five times is not known. After `ToolSearch` was denied, the model called the tool by name without loading it, and the CLI ran those calls.
- **Run B** store's `tool_decision` rows (session 1):

  ```text
  3 {"tool":"mcp__kernel__kernel_trigger_register","decision":"allow","reason":"tool_allowed"}
  ```

  The tool's result was `{"id":1,"next_fire_at":"2026-10-16T00:00:00.000Z"}`. Trigger row: `once`, `{"at":"2026-10-15T17:00:00-07:00"}`, `notify`, `created_by` `agent`. (The model picked the `-07:00` offset itself; the time zone is the prompt's problem, not this probe's.)
- **Run A2** (a repeat of A1 that also captured tool results) store's `tool_decision` rows (session 1):

  ```text
  3 {"tool":"ToolSearch","decision":"deny","reason":"tool_not_allowed"}
  4 {"tool":"ToolSearch","decision":"deny","reason":"tool_not_allowed"}
  5 {"tool":"Skill","decision":"deny","reason":"tool_not_allowed"}
  ```

  The tool results were `PreToolUse:ToolSearch hook error: tool_not_allowed` (twice), `<tool_use_error>Unknown skill: loomwright:schedule</tool_use_error>` for the first `Skill` call, and `PreToolUse:Skill hook error: tool_not_allowed` for the second. No trigger was registered, and the reply began `I don't have the necessary permissions to access the kernel trigger tools…`. This is the owner's 2026-10-15 failure, reproduced.

Read off it:

- **With deferral on (the default), the session's first move is `ToolSearch`.** It was in both runs where the setting was absent, and the gate denied it each time. Whether the session then reaches its tool is up to the model. In A1 it called the tool by name anyway and got through. In A2 it gave up, exactly as Wright did in the owner's run. A session that works only when the model guesses is broken.
- **With `ENABLE_TOOL_SEARCH=false`, `ToolSearch` is not offered at all.** The only difference between the two tool lists is `ToolSearch` (44 against 43), and the session called the kernel tool directly, with valid input, on its first try. The policy needs no meta-tool, and the gate decides every call by its exact name, as before.
- **So the kernel ships approach (b)** (section 4). No gate exception was added, and `ToolSearch` stays denied under Wright's policy (`tool_not_allowed`), pinned in `kernel/test/sessions-policy.test.ts`.
- **Seen in passing, not part of this item:** the first `Skill` call in A2 produced no `tool_decision`. The CLI rejected its input (`Unknown skill`) before the PreToolUse hook ran, so nothing ran, but nothing was recorded either. The gate records only the calls that reach it.

## 3. Tool count (risk note)

With deferral off, every offered tool's schema is in the session's context on every turn. Run B's session was offered 43 tools:

- **12 kernel tools:** `mcp__kernel__kernel_approval_request`, `…_loomwright_capabilities`, `…_notify`, `…_request_stop`, `…_schedule_wakeup`, `…_task_create`, `…_task_get`, `…_task_list`, `…_task_update`, `…_trigger_list`, `…_trigger_register`, `…_trigger_remove`.
- **31 built in to the CLI:** `Task, Artifact, ArtifactComments, ArtifactData, Bash, CronCreate, CronDelete, CronList, DesignSync, Edit, EnterWorktree, ExitWorktree, ListAgents, Monitor, NotebookEdit, PushNotification, Read, RemoteTrigger, ReportFindings, ScheduleWakeup, SendMessage, Skill, TaskCreate, TaskGet, TaskList, TaskStop, TaskUpdate, WebFetch, WebSearch, Workflow, Write`.

The Loomwright plugin added no tool of its own to the list; its skills and commands are reached through `Skill`. Being offered a tool is not being allowed to use it: Wright's policy allows the 12 kernel tools and `Read` (`Glob` and `Grep`, which the policy also lists, were not offered by this CLI), and the gate denies every other call (`tool_not_allowed`). The cost is context on each turn. With deferral on, the kernel tools' schemas would have stayed out until loaded.

## 4. The fix, and what pins it

`SessionManager.#launch` builds the one `Options` object for a start and for every resume attempt. Its `env` is now `{ ...config.env, ENABLE_TOOL_SEARCH: "false" }` (`TOOL_DEFERRAL_OFF` in `kernel/src/sessions/kernel-env.ts`). It is spread last, after the auth provider's env and the Loomwright host switch, so a variable inherited from the daemon's environment cannot turn deferral back on. The auth provider still sees the base env without it. The name is kernel-owned: a contract whose `host_switch.env` or `state_dir_env` names it is refused (`loomwright_contract`, `contract_invalid`) at contract validation and again at every launch, because the kernel's value would otherwise silently replace the switch's (host mode off, or a relative state dir `false` in the repo). Pinned by:

- `kernel/test/sessions-tool-loading.test.ts`: the exact launch env of a start and a resume; the same with `ENABLE_TOOL_SEARCH=true` inherited in `baseEnv`; and a contract whose `host_switch.env` or `state_dir_env` is `ENABLE_TOOL_SEARCH` refused at a start (no row, nothing spawned) and at a resume (nothing launched, the row left `interrupted`).
- `kernel/test/loomwright-adapter.test.ts` and `kernel/test/sessions.test.ts`: contract validation and `hostSwitchCollision` refuse the name.
- `kernel/test/sessions.test.ts`: the six exact launch-env assertions now include the entry.
- `kernel/test/sessions-policy.test.ts`: `ToolSearch` (and `toolsearch`, `ToolSearchX`, `Toolbox`) denied with `tool_not_allowed` under `PROPOSED_ALLOWED_TOOLS`.
- `kernel/test/sessions-live.test.ts` (opt-in): a real session under Wright's proposed policy, with the kernel server attached, sets a reminder; the test asserts a `once` `notify` trigger owned by `wright`, an allowed `mcp__kernel__kernel_trigger_register` decision, and no `ToolSearch` `tool_decision` for the session.

Each deterministic pin was checked against the matching mutation of the code: dropping the entry, setting it only on a start, or spreading it before the inherited env, and an allow for `ToolSearch` in the gate. Each made its pins fail.

## 5. The live test, after the fix

**Run by the worker, 2026-10-15, on the owner's subscription token, at the working tree of this change (base `95d3156` plus the fix).** It ran three times:

1. `cd kernel && STUDIO_LIVE=1 npx vitest run test/sessions-live.test.ts`, before the test printed diagnostics. The `touch gated.txt` case passed. The kernel-tool case failed: the session recorded **no `tool_decision` at all**. No `ToolSearch` decision appeared, but no kernel tool call did either. The output:

   ```text
    FAIL  test/sessions-live.test.ts > live session (STUDIO_LIVE=1) > under Wright's proposed policy, a session sets a reminder through its kernel tool, with no ToolSearch decision
   AssertionError: expected [] to deep equally contain { …(3) }

   - Expected:
   {
     "decision": "allow",
     "reason": "tool_allowed",
     "tool": "mcp__kernel__kernel_trigger_register",
   }

   + Received:
   []

    Test Files  1 failed (1)
         Tests  1 failed | 1 passed (2)
   ```

   Why the model made no gated call is not known: that version of the test did not capture the reply or the tool calls. One possible reading is that it called the tool with input the CLI rejected before the hook, as the `Skill` call did in run A2, but this was not observed. The test now puts the status, the tool calls, the decisions and the start of the reply in every assertion message, so a failure explains itself.
2. `cd kernel && STUDIO_LIVE=1 npx vitest run test/sessions-live.test.ts -t "proposed policy"` (the kernel-tool case only, with diagnostics): passed (`Tests  1 passed | 1 skipped (2)`).
3. The full command again, on the test as committed:

```text
$ cd kernel && STUDIO_LIVE=1 npx vitest run test/sessions-live.test.ts

 RUN  v5.0.3 /Users/vikashruhil/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-15-153327/L1/kernel


 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  21:34:44
   Duration  30.54s (tests 99%, transform 1%)
```

## 6. Limits

- **Probed on `claude-haiku-4-5` only.** The owner's failing run used `claude-sonnet-5-5`. The CLI's text names `ENABLE_TOOL_SEARCH=false` as the off switch with no per-model condition, but no Sonnet session was run here. The owner's phase 2 exit rerun, with Wright on his chosen model, is the check.
- **The live test depends on the model's choices.** One of its three runs failed with no gated call at all (section 5). A pass shows the path works, not that every session will take it.
- **`ENABLE_TOOL_SEARCH` is undocumented in the SDK's types.** A later SDK may rename or drop it. The deterministic tests catch the kernel no longer setting it, and the live test's `ToolSearch` assertion catches the SDK ignoring it.
