# Dry runs

A dry-run session can read but never act, and it reports what it would have done (phase 3 item 03, ROADMAP phase 3 exit, D3, invariants 2 and 3). This page covers the mechanism, the session half. Code: `kernel/src/sessions/dry-run.ts` (the read-only sets and the classifier, pure, no I/O) and the kernel's `PreToolUse` gate in `kernel/src/sessions/manager.ts`. Tests: `kernel/test/sessions-dry-run.test.ts`.

A caller starts one with `startSession({ …, dryRun: true })`, or resumes one with `resumeSession(id, { …, dryRun: true })`. A given `dryRun` must be a boolean (`invalid_params` otherwise, before any row or spawn); `false` or absent is a real run, and a real run's decisions, events and reasons are exactly what they were before dry runs existed.

A dry run only **narrows** the session's policy and the fixed rail ([approvals](approvals.md#the-rail)). It never widens either, never skips the rail, and never reaches the approval gate. The read-only sets below are part of the fixed safety kernel: they are code, not settings, and no policy, playbook or agent can change them (invariant 3).

## What a dry-run session may run

**Tools, by name, whatever their input** (`DRY_RUN_READ_ONLY_TOOLS`): `Read`, `Glob`, `Grep` and `mcp__kernel__kernel_loomwright_capabilities`.

**The kernel's own list/get tools**: any `mcp__kernel__kernel_<name>_list` or `mcp__kernel__kernel_<name>_get`, where `<name>` is one or more lower-case alphanumeric words joined by single underscores. Today that is `kernel_task_list`, `kernel_task_get` and `kernel_trigger_list`, and later `kernel_playbook_list`. The whole name must match, so no other suffix counts, and a tool of any other MCP server never counts.

Everything else is "would do", for example `Write`, `Edit`, `NotebookEdit`, `WebFetch`, `WebSearch`, `Task`, `kernel_notify`, `kernel_approval_request`, `kernel_schedule_wakeup`, `kernel_request_stop`, and every `*_create`, `*_update`, `*_register`, `*_remove`, `*_disable`, `*_enable` and `*_dry_run` kernel tool. So a dry run never writes through a `kernel_*` tool that changes state.

**Bash commands** (`DRY_RUN_READ_ONLY_BASH`): a command the policy allows whose **first shell word** is exactly one of:

| Program | Why it is safe |
|---|---|
| `cat`, `head`, `tail` | print a file's contents |
| `ls`, `wc`, `pwd` | print names, counts, the current directory |
| `grep` | prints matching lines |
| `echo` | prints its arguments |

None of them can write a file, send anything or run another program through its own arguments. The match is exact and case-sensitive, with no path: `/bin/cat`, `./ls` and `CAT` are not in the set, and neither is `FOO=1 cat` or `{cat,rm}`. The policy's shell-metacharacter deny still applies first (no `>`, `|`, `;`, `$`, …, so `echo hi > file` never reaches the set), and the rail still applies too: `cat ~/.claude/settings.json` is held as outward (so it is a "would do"), and a `cat` of a kernel file is denied `protected_kernel_path`.

Deliberately out, each because it can write, send or run another program:

| Program | Why it is out |
|---|---|
| `git` | aliases, `-c`, hooks and `push` |
| `gh` | any write subcommand (`pr comment`, `api -X POST`, …) |
| `find` | `-exec`, `-delete` |
| `xargs`, `env` | run another program |
| `sed` | `w`, `e` and `-i` |
| `awk` | `system()` and redirection |
| `sort` | `-o` writes a file |
| `uniq` | an output file operand |
| `tee` | writes files |
| `rg` | `--pre` runs a program |
| `npm`, `npx`, `node` | run scripts |
| `sh`, `bash` | run anything |
| `curl` | sends requests and writes files |
| `date` | `-s` (or a date operand) sets the clock |
| `touch` | creates files |

## The decision order

For every call, the gate first decides exactly as for a real run, then narrows:

1. **The policy denies** (`decideToolUse`): denied with the policy's reason, as today. Not a would-do entry, because the real run would not do it either.
2. **The rail denies** (protected kernel path, the merge block, an unreadable or too-large Bash command): denied with the rail's reason, as today. Not a would-do entry.
3. **The rail answers outward**: denied with reason `dry_run`, and recorded as a would-do entry with `would: "held"` and the rail's approval action (for example `gh pr comment`). The approval path is never entered, so no approval row is written and no one-shot grant is consumed, even one that matches the call exactly.
4. **The rail answers ordinary**: a read-only call (above) runs as today. Anything else is denied with reason `dry_run` and recorded with `would: "run"`.

Every call still records exactly one `tool_decision` event, and a dry-run deny records `reason: "dry_run"` (with the Bash command, truncated to 500 characters, as for any call). The gate still fails closed: any throw while deciding, including a failure to build the would-do entry, denies with `kernel_gate_error`; a `dry_run` deny whose `tool_decision` event cannot be written becomes `kernel_gate_error` as well. A would-do entry is kept only once its deny was recorded.

`dry_run` is a gate-only reason, like `kernel_gate_error`: it is not yet in the public `ToolDecisionReason` union in `kernel/src/sessions/policy.ts`.

The model sees `permissionDecision: "deny"` with a fixed text that starts with `dry_run`. It says the call was recorded as something the session would do and did not run, and to carry on with the rest of the plan. The text never includes the call's input.

## The would-do entry

```
{ tool, input_summary, would: "run" | "held", reason: "dry_run", action? }
```

- `tool`: the tool name.
- `input_summary`: the Bash command, or the tool's input as JSON, truncated to 500 characters (`DRY_RUN_INPUT_SUMMARY_CHARS`, the same bound as the `tool_decision` event's command). It is the model's untrusted input, kept as data: never executed or interpolated, and the kernel adds nothing to it.
- `would`: `held` when a real run would have held the call for the owner's approval, `run` when it would have run it.
- `action`: for `held`, the rail's approval action.

## The report

`SessionHandle.dryRun` is a `Promise<DryRunReport | null>`. It settles when `done` settles, never rejects, and is `null` for a real run. A dry-run session's report is:

- `wouldDo`: every would-do entry, in call order, from every launch attempt of this `startSession`/`resumeSession` call. A resume's report starts empty: entries from before a kernel restart survive only as `tool_decision` events with reason `dry_run`;
- `finalText`: the same text `SessionHandle.result` resolves to (`null` unless the session ended `completed` with a successful result);
- `usage`: the **last** `result` message's `modelUsage`, normalised per model the way the budget meter reads it (`UsageTotals`: input, output, cache-write, cache-read and thinking tokens, and the SDK's cost estimate). It is the SDK session's cumulative total, so successive results are never added together. Empty when no result came.

The report is held in memory only, per handle; nothing is persisted, so it never spans a kernel restart. Storing a playbook's dry-run result is the playbook half's job (`playbook_runs.result`, [playbook runs](playbook-runs.md)).

## Tokens count against limits

A dry run is not free: the budget meter observes a dry-run session's messages exactly as any session's, so its tokens are recorded in `budget` and count against the agent's daily token limit like any session's ([budget](budget.md)). The report's `usage` is advisory; the meter stays the accounting source.

## Resume

A dry run only narrows, so a session that **started** as a dry run stays one on every resume, whatever the resume's `dryRun` says. A dry-run start writes one `session_dry_run` event (payload `{}`) in the same transaction as its row, and a resume reads it back. `resumeSession(id, { …, dryRun: true })` of a session that started as a real run makes that resume a dry run; it writes no event, so a later resume without `dryRun` is a real run again.

The playbook half (running a playbook's dry run, storing and showing its result) is added by item 07.
