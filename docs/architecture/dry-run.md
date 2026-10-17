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

The report is held in memory only, per handle; nothing is persisted, so it never spans a kernel restart. Storing a playbook's dry-run result is the playbook half's job ([below](#a-playbooks-dry-run)).

## Tokens count against limits

A dry run is not free: the budget meter observes a dry-run session's messages exactly as any session's, so its tokens are recorded in `budget` and count against the agent's daily token limit like any session's ([budget](budget.md)). The report's `usage` is advisory; the meter stays the accounting source.

## Resume

A dry run only narrows, so a session that **started** as a dry run stays one on every resume, whatever the resume's `dryRun` says. A dry-run start writes one `session_dry_run` event (payload `{}`) in the same transaction as its row, and a resume reads it back. `resumeSession(id, { …, dryRun: true })` of a session that started as a real run makes that resume a dry run; it writes no event, so a later resume without `dryRun` is a real run again.

## A playbook's dry run

The playbook half (phase 3 item 07). Code: `kernel/src/playbooks/dry-run.ts`. Tests: `kernel/test/playbooks-dry-run.test.ts`. Enabling a playbook needs one of these first ([playbooks](playbooks.md#enabling)): the enable is held only when the current version has a `done` dry run, and when the owner approves it, the kernel enables the playbook itself in that decision, re-checking that the dry run is still of the current version. The enable's handler, Wright's retry, is a defence path only: after the kernel enabled the playbook, a retry is refused before the hold, because the playbook is no longer a `draft`.

**`kernel_playbook_dry_run(id, idempotency_key)`** runs a draft playbook's current version once, as a fire would, in a dry-run session, and returns what it would do. Its input is untrusted data, and every refusal is an error result naming the cause (`invalid_input` unless said otherwise), never a throw through the SDK. In order:

1. The playbook is not the caller's (`not_found`, `not_owner`), the owner turned it off (`owner_off`), it is already `enabled` (change it to make a new draft version), or it is `disabled`.
2. **The playbook has no model**: refused, naming the playbook's `model`, before Wright's settings are read and before any session. The kernel never picks a model ([brain](brain.md)), and Wright's own model never stands in for the playbook's.
3. **Wright's settings** (`readWrightSettings`): a file that cannot start a session (`model_unset`, `settings_invalid`) is its own refusal, naming `wright.json`.
4. A kernel composition that gives tools no `startSession` is refused, naming it.

Then the session: `startSession({ agent: <the owning agent>, prompt: <the current version's intent, verbatim>, model: <the playbook's model>, permissionMode, policy, cwd: <Wright's memory dir>, dryRun: true, playbook: id, playbookVersion: version })`, with the permission mode and tool policy from Wright's settings, exactly as [the brain](brain.md) starts Wright. The tool waits for the session to end (`done` and the report).

**Exactly once per key.** The session starts inside a work step keyed `kernel_playbook_dry_run:session-<id>:<idempotency_key>`: a repeat in the same session returns the stored result and starts no second session, but only when that result is a dry run of the same playbook and the playbook is still at the version it dry-ran. A key is scoped to the session, not to a playbook: a same-key call for another playbook is refused naming the playbook the key dry-ran (`idempotency_key already used in this session for the dry run of playbook <a>; use a new key to dry-run playbook <b>`), never a version, and a same-key call for a playbook that no longer exists is refused too. After an edit (a new version) a same-key call is refused, naming both versions (`idempotency_key already used in this session for the dry run of version <a>; playbook <id> is now at version <b>: use a new key`), so an old version's summary is never returned as the new version's; no session starts and nothing is written. A same-key repeat at the same version replays, even after the playbook was enabled at it. Starting the session is the step's first effect. A refusal before it, or an admission refusal from `startSession` (budget or cap), releases the step, so it leaves nothing behind and the same key can run once the cause is fixed. Any other failure after that point fails the step (`failed:error`), and a new key is needed.

**The run row.** Only after `startSession` succeeded, one `playbook_runs` row: `kind = 'dry_run'`, `status = 'running'`, `session_id`, `version`, `started_at`. When the session ends, the same row gets `status` `done` (the session ended `completed`) or `failed` (any other ending), `ended_at`, `tokens` and `result_json`, written by this run's own outcome whatever else touched the row meanwhile. The `playbook_runs.status` values a dry run uses are `running`, `done` and `failed`; item 08 owns the closed list for every kind ([playbook runs](playbook-runs.md)). The row's `dedupe_key` column stays null: a preview is never a fire, so nothing that checks fired keys can count it.

```
result_json = { would_do, next_fires, dedupe_key, final_text, usage }
```

- `would_do`: the report's would-do entries ([above](#the-would-do-entry)).
- `next_fires`: the linked trigger's next fires after the end of the run, UTC: a `cron` spec gives three successive `nextCronFire` instants; a `once` spec gives its instant when it is in the future, else none; no trigger, none. It reads the spec only, so a trigger someone turned off still shows its schedule.
- `dedupe_key`: a **preview** of what the playbook's `dedupe_key_spec` gives for the first next fire: each field as `<field>=<value>`, joined with `|`, in the spec's order, from `playbook.id`, `playbook.version`, `trigger.id`, `trigger.scheduled_at` (that fire's UTC instant) and `date` (that fire's local date: in the cron's zone, or at a `once` spec's own offset). Null with no spec or no next fire. What a fire actually skips is item 08's check, not this.
- `final_text`, `usage`: the report's.

`tokens` is the input, output, cache-write and cache-read tokens summed over the report's `usage` models (thinking tokens are already inside the output). They count against limits like any session's: the budget meter, not this number, is the accounting source ([above](#tokens-count-against-limits)).

One `playbook_dry_run` audit event `{playbook_id, version, run_id, status, tokens, would_do: <count>}`, linked to the calling session. The tool returns `{run_id, playbook, version, status, would_do, next_fires, dedupe_key, tokens, summary}`, and rewrites the playbook's mirror (a failed write is a `mirror_error` field, the run stays stored).

**The summary** is one paragraph, the same text in the tool result, the mirror and the enable approval's display: the run and version, whether it completed, the tokens, what it would do (at most ten entries, each input cut to 160 characters, then how many more), the next fires (UTC) and the dedupe-key preview. The would-do inputs are the model's text, copied as data: the mirror renders the summary as one inert code span, and `studio approvals` escapes and indents every line of it ([approvals](approvals.md#the-pre-hold-check)).

**Which dry run counts.** `latestDryRun(store, playbook, version)` reads the newest row of that version that ended `done`. A `running` or `failed` row never counts as a dry run.

**Stale rows.** A kernel restart (`kill -9`) in the middle of a dry run leaves its row `running` while its session is no longer live. Every call for that playbook, before its work step (so a repeat with the same key clears them too), first marks `failed` (with `ended_at`) each `running` dry-run row whose session row is gone or not `starting` / `running`. The crashed step itself is left `started` and becomes `failed:interrupted` on a repeat with its key, as for any step ([the event loop](../ARCHITECTURE.md#main-loop)).

**The mirror line.** `Last dry run: <summary>` for the newest `done` dry run of the current version; `Last dry run: No dry run of version <n> yet.` when only earlier versions have one (an edit made a new version); `Last dry run: No dry run yet.` when there is none.

**Recursion.** Inside a dry-run session, `kernel_playbook_dry_run` is itself "would do" (`*_dry_run` above), so a dry run never starts another.

**The honest limit: a tool-call timeout.** The tool blocks Wright's turn for the whole dry-run session. The installed SDK's types say an in-process MCP tool call is bounded by a per-server `timeout` or the `MCP_TOOL_TIMEOUT` variable, "effectively unbounded by default"; the kernel sets neither, and no probe has run (NEEDS VERIFICATION, [open questions](../OPEN_QUESTIONS.md#technical-verify-dont-assume)). If a timeout does fire, Wright sees a tool error while the dry run goes on: its row still lands `done`, and a repeat with the same key returns the stored result (or, while it still runs in this kernel, waits for it).
