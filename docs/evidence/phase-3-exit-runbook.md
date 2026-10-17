# Phase 3 exit: the owner's live run

Phase 3 is done when this holds in the running system ([`docs/ROADMAP.md`](../ROADMAP.md), phase 3 row): a plain-English request becomes a stored playbook whose dry-run output is shown before it's enabled; dedupe key, priority and model come from the user, with Wright only proposing defaults.

It is already proven deterministically in CI by `kernel/test/phase-3-exit.test.ts` (a stand-in Wright, one injected clock, a stub notifier, no model). That test also covers two things this live run does not: an "always" grant for a playbook's outward call, and the playbook's daily token limit parking its next fire. This runbook is the live half: a real Wright model, the kernel installed as a launchd agent, real notifications on this Mac. Phase 2's live run is the precedent ([runbook](phase-2-exit-runbook.md), [evidence](phase-2-exit-live-2026-10-16.json)).

The owner decides when this runs. It uses the owner's subscription, launchd service and screen. The owner runs it, or has an agent run it while watching the screen ([D33](../DECISIONS.md)). Either way, every `owner` field below holds only what the owner reports seeing, and the evidence file's `run_by` says who ran it. The enable approval in step 4 is always the owner's decision: an agent running the check may type `studio approve` only after the owner has read the approval and said to approve it, and the evidence file records who typed it.

## What this run does to the machine

Read this before starting.

- **A playbook goes into your real store.** Step 1 asks Wright for a playbook on the installed service, so Wright creates a real draft in `~/.loomwright-studio/studio.db` (or `$STUDIO_DATA_DIR`), with its linked `cron` trigger and its mirror file `memory/playbooks/<slug>.md`. The playbook is named with a tag unique to the run, `phase3-exit-<run>`; the harness prints it at the start and the end. Steps 2 to 4 change it to `enabled`, and cleanup turns it off.
- **The harness sets three policy values as you.** Step 2 runs `studio playbooks set` for the model (the one in your `wright.json`), priority `high` and dedupe key `date`, so they are stored as set by `owner`. Running the harness is your choice of these values.
- **The harness touches only its own playbooks.** A playbook counts as the harness's only when its owning agent is `wright` and one of two things holds:
  1. **Session provenance (the kernel's record).** The kernel recorded its `playbook_created` event under the session of a Wright `ask` message whose text, the harness's own input as the kernel keeps it in `brain_messages`, contains the run tag. Every `studio ask` runs its own session, so this holds even when Wright leaves the tag out of the playbook it stores.
  2. **The tag in the playbook's own name, intent or slug.** This is the fallback, matched case-insensitively.

  When the run ends, the harness reads those playbooks again. This catches one Wright created after `studio ask` stopped waiting. It then turns off each one that is not already off with `studio playbooks off <id>`. It never writes to a playbook that is already off: an owner off of it would record you as turning off a playbook you never touched (and make an agent's off final), so the harness lists it in the summary's `cleanup` as `skipped` (`already_off`, with who turned it off) instead. A re-read that fails is listed as `reread_failed`, with no write. It never turns off any other playbook: it lists those under `other_new_playbooks` in the summary (id, owner, status; not the text) and leaves them as they are. The harness never decides an approval and never stops, uninstalls or reinstalls the service.
- **What cleanup leaves in place.** Each harness playbook's cleanup entry lists, under `left_as_is`, its linked trigger and any enable approval still pending:
  - The linked trigger stays on. With its playbook off it starts no work, but each day at the playbook's two minutes the kernel records a `trigger_missed` event (reason `playbook_not_enabled`). To stop that, run `studio triggers off <trigger id>` yourself.
  - The mirror file stays, showing the playbook as `disabled`.
  - An enable approval still pending (left by a failed run) stays in `studio approvals`. Deny it with `studio deny <id>` if you like.
- **Real notifications appear.** One for the enable approval in step 3 (`Approval <id>: kernel_playbook_enable`), and one from the playbook's own run at its first minute (step 5). None should appear at the second minute (step 6).
- **Wright sessions spend tokens** on your subscription: five sessions in total (the two `studio ask` calls, the dry run, the session your approval starts, and the playbook's one run).

Afterwards, check that nothing else is left behind:

```bash
launchctl print gui/$(id -u)/com.loomwright.studio.kernel | grep -E 'state|pid'   # the service, still running
node kernel/dist/cli/index.js playbooks list --all | grep -i 'phase3-exit-<run>'   # the harness's playbook (the run tag it printed) is disabled
node kernel/dist/cli/index.js approvals                                            # no pending kernel_playbook_enable for that playbook
ps -axo pid,command | grep -v grep | grep -E 'vitest|phase-3-exit'                 # no harness process left
```

The `grep` sees only playbooks whose name or slug kept the tag. The summary's `cleanup` list covers every playbook the harness counted as its own up to its end, tagged or not. Act in two cases. A tagged playbook is still `draft` or `enabled`: Wright created it after the harness ended (a `studio ask` that came back parked and ran later). Or the `cleanup` list has a `reread_failed` entry: the harness could not read the store, so it wrote nothing for that playbook. Check the row with `studio playbooks list --all`, turn it off with `studio playbooks off <id>` only if it is not already off, and note it in the evidence file's `cleanup`.

## Setup

Run from the repo root, with this PR's branch checked out.

1. **Build the kernel.**

   ```bash
   cd kernel && npm ci && npm run build && cd ..
   ```

2. **Install (or reinstall) the service from this build.** The service runs an install copy under `<dataDir>/app/`, not the checkout (D31), so reinstall after every build you want it to run.

   ```bash
   node kernel/dist/cli/index.js service install
   launchctl print gui/$(id -u)/com.loomwright.studio.kernel | grep -E 'state|pid|last exit code'
   node kernel/dist/cli/index.js status
   ```

   Record: the commit (`git rev-parse HEAD`), the pid `service install` printed, and that `status` answered.

3. **Set Wright's model and tool policy** in `~/.loomwright-studio/config/agents/wright.json`.
   - **No file yet:** a first `node kernel/dist/cli/index.js ask "hi"` creates it with `"model": null` and exits 2. Its proposed `tool_policy` already lists the six playbook tools.
   - **A file from phase 1 or 2:** the kernel creates this file only when it is absent and never rewrites it, so its `tool_policy` is still the one it had. Add these six names to `tool_policy.allowedTools`:

     ```text
     mcp__kernel__kernel_playbook_create
     mcp__kernel__kernel_playbook_update
     mcp__kernel__kernel_playbook_list
     mcp__kernel__kernel_playbook_disable
     mcp__kernel__kernel_playbook_dry_run
     mcp__kernel__kernel_playbook_enable
     ```

     Keep `mcp__kernel__kernel_notify` in the list: the playbook's run sends a notification with it.

   Set `"model"` to the model you choose (for example `"claude-haiku-4-5"`). The harness also sets it as the playbook's model. Before it starts, the harness checks that the model is set and that all six names are listed, and it stops naming what is missing otherwise. Record the model you set, and whether you added the six names.

   `memory/wright/role.md` is also written only once, so one from phase 1 or 2 does not list the playbook tools in its "How you act" list. That list guides Wright; it grants nothing (the tool policy does). You may add the `playbooks:` line from a fresh `role.md` (shown in [the brain page](../architecture/brain.md)). Record whether you did.

4. **Check the notifier.** `ls -l /opt/homebrew/bin/terminal-notifier /usr/local/bin/terminal-notifier`. Without terminal-notifier, notifications still appear (through osascript) but have no click action, and their rows say `unsupported`. Record which is present.

5. **Open a second terminal** at the repo root. The harness runs in the first; you read and decide the approval in the second.

In the commands below, `studio` means `node kernel/dist/cli/index.js`, run from the repo root.

## Running it

Start the harness by 23:39 local time (both of the playbook's minutes must fall on today's date, which is its dedupe key). It runs steps 1 to 6 in order and takes about 30 minutes:

```bash
cd kernel && STUDIO_LIVE=1 npx vitest run test/phase-3-exit-live.test.ts
```

It prints `phase-3-exit-live summary: <path>` at the start and at the end. The summary is rewritten after every step, so it survives a failed step. A failed step stops the run; the cleanup still runs.

The harness picks two local minutes in one hour: the first is the next whole minute at least 15 minutes ahead, the second is 5 minutes later. When the second would cross into the next hour, both move to that hour's first minutes. The 15 minutes leave room for steps 1 to 4, your approval included. The summary records them under `fire_minutes`.

The checks read the stored rows (`playbooks`, `playbook_runs`, `approvals`, the queue, `sessions`, events), never Wright's reply: a real model may phrase or schedule the playbook differently from the request, and the rows say what it actually did.

### Step 1: a plain-English request becomes a draft (harness)

The harness runs `studio ask 'Create a playbook named "phase3-exit-<run>": every day at <HH:MM> and at <HH:MM> (<your zone> time), send me a notification titled "phase3-exit-<run>" that says the playbook ran. Only draft it for now: don't dry-run it or ask me to enable it yet.' --timeout 120`. It records Wright's reply, the one playbook that is the harness's by the rule above (with `by_session` and `by_tag` saying which part matched), its row, its linked trigger, its mirror file's first lines and `studio playbooks show <id>`, and any other playbook that appeared meanwhile (`other_new_playbooks`, untouched). If Wright dry-ran it or asked to enable it anyway, that is recorded under `early`. It passes when `studio ask` answered, exactly one such playbook exists, it is a `draft`, its trigger is a `cron` trigger whose next fire is the first minute, and its mirror file exists.

What only you can see: open the mirror file (`~/.loomwright-studio/memory/playbooks/<slug>.md`; the slug is in the summary). Do the values Wright proposed read as `(proposed)`?

### Step 2: your values (harness, as you)

The harness runs `studio playbooks set <id> model <your wright.json model>`, `… priority high` and `… dedupe_key date`. Each set makes a new version, so they come before the dry run. It passes when each set exits 0 and the row is a `draft` with those three values, each set by `owner`.

### Step 3: the dry run, shown (harness)

The harness runs `studio ask 'Dry-run the playbook "phase3-exit-<run>" (id <id>) now, then ask me to enable it.' --timeout 600`. The dry run is a whole session inside Wright's tool call, so the reply can take minutes. Whether or not the reply comes in time, the harness then waits for two rows: a `done` dry run of the current version, and a new `kernel_playbook_enable` approval held for that version. It records both, the approval's `studio approvals` entry and the mirror's `Last dry run:` line. It passes when the approval's display and the mirror both show that dry run (`Dry run <run id> of version <n> completed, …`) and the playbook is still a `draft`. It then prints `approve the enable: studio approve <id> once`.

What only you can see:

- Did the approval notification appear?
- In the second terminal, run `studio approvals`. Paste what it shows for that approval: the playbook, its schedule, each value with `(proposed)` or `(set by owner)`, and the `dry run:` line. This is what you decide on.

### Step 4: you approve the enable (owner)

In the second terminal, before the first minute:

```bash
studio approve <id> once
```

Use the id the harness printed. The decision reaches Wright as a new message, and Wright's retry in that new session enables the playbook. The harness waits until the playbook is `enabled`. It passes when the approval was decided `once` by `owner`, exactly one `playbook_enabled` event names that approval, and the playbook was enabled before the first minute. It records every enable approval for the playbook.

The retry must repeat the held call exactly (the same playbook id and idempotency key), because your one-shot approval lets only that call through. The message that starts Wright's new session names only the approval and the action, so whether a real Wright repeats the call exactly has not been tested live ([open questions](../OPEN_QUESTIONS.md)). If a second enable approval for the same playbook appears instead of the playbook being enabled, don't approve it: the step fails, and the second approval is the finding.

Record: who typed the command (you, or the agent on your word) and when.

### Step 5: it fires at its minute (harness and owner)

At the first minute the linked trigger fires and queues the playbook's message; Wright runs the playbook's intent in its own session. The harness waits for the run to end. It passes when the first queued message is for the first minute at priority `high`, the run is `done` at the enabled version with a dedupe key, its session ran as `wright` on the playbook's model and version, and the run ended before the second minute (only a `done` run with the same key makes the next one a duplicate). It records the run, the queue rows, the session, the trigger's events and Wright's notifications since the first minute.

What only you can see, at the first minute:

- Did the playbook's notification appear? Its title and body?

### Step 6: the second minute is skipped (harness and owner)

At the second minute the trigger fires again, with the same dedupe key (the date). The harness waits for the second run, then 15 seconds more. It passes when there are exactly two `fire` runs, the second for the second minute, `skipped_duplicate` with no session and the first run's dedupe key, and no session ran for the playbook other than the first run's and the dry run's.

What only you can see: no notification appeared at the second minute.

## If a step fails

Record it as failed, with what you saw, in the evidence file. Don't patch the code in this PR. Each fix becomes a new item in `.supervisor/requirements/phase-3/`. Phase 3 stays not done until a rerun passes all six steps. Phase 1's and phase 2's first live runs failed the same way and were rerun.

## The evidence file

Commit `docs/evidence/phase-3-exit-live-<YYYY-MM-DD>.json`, in the same commit as the `docs/ROADMAP.md` change (below). It has phase 2's shape plus `run_by` ([D33](../DECISIONS.md)). Copy the machine-observed values from the harness summary; type your own observations into the `owner` fields. Never paste env, a token or a path to a credential.

```json
{
  "test": "phase-3-exit-live",
  "date": "YYYY-MM-DD",
  "run_by": "<the owner, or which agent at the owner's request with the owner watching (D33)>",
  "commit": "<git rev-parse HEAD that the service was installed from>",
  "dirty_worktree": false,
  "machine": { "macos": "<sw_vers -productVersion>", "node": "<node --version>", "notifier": "terminal-notifier <version> | osascript only" },
  "wright_model": "<the model in config/agents/wright.json>",
  "wright_settings": { "added_playbook_tools": true, "role_md_lists_playbook_tools": false },
  "harness_summary": "<the summary path; its content is copied into the steps below>",
  "fire_minutes": "<the summary's fire_minutes>",
  "steps": {
    "1_draft": {
      "outcome": "passed | failed",
      "harness": { "ask": {}, "playbooks_created": [], "other_new_playbooks": [], "row": {}, "trigger": {}, "mirror": {}, "studio_playbooks_show": {}, "early": {} },
      "owner": { "mirror_read": "" },
      "findings": []
    },
    "2_owner_sets": {
      "outcome": "passed | failed",
      "harness": { "sets": [], "row": {} },
      "findings": []
    },
    "3_dry_run_and_enable_request": {
      "outcome": "passed | failed",
      "harness": { "version": 0, "ask": {}, "dry_run": {}, "approval": {}, "enable_approvals": [], "studio_approvals_entry": {}, "mirror_last_dry_run": "" },
      "owner": { "approval_notification_appeared": true, "studio_approvals_output": "" },
      "findings": []
    },
    "4_owner_approves": {
      "outcome": "passed | failed",
      "harness": { "approval_id": 0, "enabled_at": "", "row": {}, "enable_approvals": [], "approval_decided": [], "approval_used": [], "playbook_enabled": [] },
      "owner": { "approved_by": "<the owner | the agent, on the owner's word>", "approved_at": "" },
      "findings": []
    },
    "5_fires_at_its_minute": {
      "outcome": "passed | failed",
      "harness": { "run": {}, "queue": [], "session": {}, "trigger": {}, "trigger_events": {}, "notifications": [], "fired_late_ms": 0 },
      "owner": { "notification_appeared": true, "title_and_body": "" },
      "findings": []
    },
    "6_second_minute_skipped": {
      "outcome": "passed | failed",
      "harness": { "fire_runs": [], "queue": [], "playbook_sessions": [], "trigger": {}, "trigger_events": {}, "notifications_since_second": [], "event_kinds": {} },
      "owner": { "nothing_appeared": true },
      "findings": []
    }
  },
  "run_tag": "<the summary's run_tag>",
  "cleanup": "<the summary's cleanup list, what you did about what it left in place, and the result of the four checks under 'What this run does to the machine'>"
}
```

A failed step keeps `"outcome": "failed"` and its `findings` (what was seen, and the new item's file name). It may also carry a `store_evidence` block: values read from the store (events, approvals, sessions, queued messages) that the harness summary did not capture, which D33 allows. Each value names where it was read from.

## Marking phase 3 done

Only when all six steps passed, in the same commit as the evidence file:

- `docs/ROADMAP.md`, phase 3 row: add **Done `<date>`** and the evidence file's path to the first cell, and a ✓ at the end of its "Done when" cell, in the phase 1 row's shape.
- Run `bash scripts/check-docs.sh` (it must pass), and put the evidence path in the PR body.
