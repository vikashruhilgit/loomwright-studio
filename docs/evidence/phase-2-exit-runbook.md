# Phase 2 exit: the owner's live run

Phase 2 is done when two things hold in the running system ([`docs/ROADMAP.md`](../ROADMAP.md), phase 2 row):

1. `studio ask "remind me at 5pm to check X"`: Wright creates the trigger itself and it fires at 5pm.
2. A Loomwright version change produces a "new features" note.

Both are already proven deterministically in CI by `kernel/test/phase-2-exit.test.ts` (a stand-in Wright, a fake clock and a stub notifier). This runbook is the live half: a real Wright model, the kernel installed as a launchd agent, real notifications on this Mac. Phase 1's live run is the precedent ([evidence](phase-1-exit-live-2026-10-06.json)).

The owner decides when this runs. It uses the owner's subscription, launchd service and screen. The owner runs it, or has an agent run it while watching the screen ([D33](../DECISIONS.md)). Either way, every `owner` field below holds only what the owner reports seeing, and the evidence file's `run_by` says who ran it.

## What this run does to the machine

Read this before starting.

- **Reminders go into your real store.** Steps 1, 2, 3 and 5 ask Wright for reminders on the installed service, so Wright creates real `once` triggers in `~/.loomwright-studio/studio.db` (or `$STUDIO_DATA_DIR`). The step 2 trigger is yours, and it is spent once it fires.
- **The harness touches only its own triggers.** Each harness reminder's text is `check X <tag>`, with a tag unique to the run and the step: `phase2-exit-<run>-step1`, `-step3` and `-step5`. The harness prints the run tag (`phase2-exit-<run>`) at the start and the end. A trigger counts as the harness's only when its owning agent is `wright` and one of two things holds:
  1. **Session provenance (the kernel's record).** The kernel recorded its `trigger_registered` event under the session of a Wright `ask` message whose text, the harness's own input as the kernel keeps it in `brain_messages`, contains the tag. Every `studio ask` runs its own session, so this holds even when Wright leaves the tag out of the reminder it stores.
  2. **The tag in the trigger's own text.** This is the fallback, matched case-insensitively.

  When each step ends, the harness reads those triggers again. This catches one Wright registered after `studio ask` stopped waiting, or from a parked ask whose session started later (an ask has no session until it starts, so it matches nothing before then). It then turns off each one that is still on with `studio triggers off <id>`. After the last step it does the same for the run tag. It never writes to a trigger that is already off: a reminder that already fired (a spent `once`) or the one step 3 turned off. An owner off of such a row would record you as turning off a trigger you never touched, so the harness lists it in the summary's `cleanup` as `skipped` (`already_spent` or `already_off`) instead. A re-read that fails is listed as `reread_failed`, with no write. It never turns off any other trigger: one another agent registers during the run, your step 2 trigger (its ask is your own, untagged, in its own session), or one Wright created from a session the harness didn't start and without the tag. It lists those under `other_new_triggers` in the summary (id, owner, kind; not the text) and leaves them as they are. The harness never schedules a reminder at 17:00 local (when the next minute it would pick is 17:00, it takes 17:01), so its turn-offs cannot block your step 2 reminder even if Wright drops the tag. (The kernel refuses a new Wright reminder that matches one you turned off in time, text and owner; a harness reminder stored without its tag reads `check X` like yours, but never at your minute.) Its notifications show the tag when Wright kept it, so you can tell them from yours.
- **Step 5 kills your running kernel.** The harness reads the kernel's pid from `api.json`, checks it against `launchctl print`, and sends `kill -9` to that pid only. launchd then restarts the kernel. The harness never stops, uninstalls or reinstalls the service.
- **Real notifications appear.** Steps 1 and 5 each post one, step 2 posts yours at 17:00 local, and step 4 posts one more from a kernel the harness starts itself, under a temp dir that is deleted afterwards. Step 3 posts none.
- **Wright sessions spend tokens** on your subscription: four `studio ask` calls in total (three from the harness, one from you in step 2).

Afterwards, check that nothing is left behind:

```bash
launchctl print gui/$(id -u)/com.loomwright.studio.kernel | grep -E 'state|pid'   # the service, still running
node kernel/dist/cli/index.js triggers --all | grep -i -A1 'phase2-exit-<run>'      # the harness's tagged triggers (the run tag it printed) are off
ps -axo pid,command | grep -v grep | grep -E 'vitest|phase-2-exit'                  # no harness process left
```

The `grep` sees only triggers whose text kept the tag. The summary's `cleanup` list covers every trigger the harness counted as its own up to its end, tagged or not. Act in two cases. A tagged trigger is still `on`: Wright created it after the harness ended (a `studio ask` that came back parked and ran later). Or the `cleanup` list has a `reread_failed` entry: the harness could not read the store, so it wrote nothing for that tag or trigger. Check the row with `studio triggers --all`, turn it off with `studio triggers off <id>` only if it is still on, and note it in the evidence file's `cleanup`.

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

3. **Set Wright's model.** If `~/.loomwright-studio/config/agents/wright.json` does not exist yet, a first `node kernel/dist/cli/index.js ask "hi"` creates it with `"model": null` and exits 2. Set `"model"` to the model you choose (for example `"claude-haiku-4-5"`). While the file is open, read the proposed `tool_policy`: it must list `mcp__kernel__kernel_trigger_register`, or Wright can't create a trigger. Record the model you set.

4. **Check the notifier.** `ls -l /opt/homebrew/bin/terminal-notifier /usr/local/bin/terminal-notifier`. Without terminal-notifier, notifications still appear (through osascript) but have no click action, and their rows say `unsupported`. Record which is present.

In the commands below, `studio` means `node kernel/dist/cli/index.js`, run from the repo root.

## Step 1: a reminder 3 minutes ahead (harness and owner)

The harness's step 1 runs `studio ask "remind me at <HH:MM> to check X phase2-exit-<run>-step1" --timeout 120`, with `<HH:MM>` the next whole local minute at least 3 minutes ahead, or the minute after it when that is 17:00 (your step 2 minute). It refuses to start a step whose minute would fall after midnight. It records Wright's reply, the one Wright trigger that is the harness's for the step's tag by the rule above (with `by_session` and `by_tag` saying which part matched, and its `studio triggers --all --json` entry), any other trigger that appeared meanwhile (`other_new_triggers`, untouched), and the notification row at that minute. It passes when exactly one such trigger exists, it is for that minute, and exactly one notification row exists for it, `delivered`, with deep link `loomwright-studio://notifications/<id>`. If Wright stored the reminder without the tag, the session rule still selects it (`by_tag` 0) and cleanup still handles it.

Start the harness (it runs steps 1, 3, 5 and 4 in that order, and takes about 20 minutes):

```bash
cd kernel && STUDIO_LIVE=1 npx vitest run test/phase-2-exit-live.test.ts
```

It prints `phase-2-exit-live summary: <path>` at the start and at the end. The summary is rewritten after every step, so it survives a failed step.

What only you can see, at the reminder's minute:

- Did the notification appear? Its title and body?
- Click it. Did Terminal open and run `studio notifications show <id>`? Paste what Terminal printed.
- Any permission prompt (notifications, Automation for Terminal), and what you chose.

## Step 2: the literal sentence, at 17:00 (owner only)

Run this before 16:59 local time on the day of the run:

```bash
studio ask "remind me at 5pm to check X"
studio triggers
```

Your text is the plain `check X`, with no tag, so the harness never selects or turns off this trigger. Record Wright's reply and the trigger row (`next fire` must be today 17:00 local). At 17:00, record whether the notification appeared, and run `studio notifications` to record its row (status and deep link).

## Step 3: a reminder turned off before its time (harness)

The harness's step 3 asks for a third reminder, its minute picked as in step 1 (tag `phase2-exit-<run>-step3`), checks that the step's trigger is on (the step fails without writing if it is not), runs `studio triggers off <id>` on it at once, and waits past the reminder's minute plus 90 seconds. It passes when no notification and no `trigger_fired` event exist for that trigger, and its row says `enabled 0`, turned off by `owner`, never fired. Record whether any notification appeared on screen at that minute (none should).

## Step 4: a Loomwright version change (harness, with your consent)

There are two ways to do this step. Record which one you used.

- **The fixture switch (the default).** The harness's step 4 reads the active Loomwright's real `capabilities.json` (read-only), writes two temp installs from it (A: the contract as it is; B: the same contract with `plugin_version` `<version>-phase2-exit-test`, one command added and one skill removed) and a temp `installed_plugins.json`. It starts its own kernel under a temp data dir, pointed at that file, and switches the file from A to B. It passes when exactly one note file exists under that kernel's `memory/shared/loomwright-updates/`, with exactly one `kernel:loomwright_version` notification, `delivered`, and a check a minute later adds neither. Your real `~/.claude/plugins/installed_plugins.json` and your service are not touched. Running the harness is your consent to this switch; write it into the evidence file (`"owner_consent"`).
- **A real Loomwright update during the run.** If Loomwright updates while the service runs, the service writes the note under `~/.loomwright-studio/memory/shared/loomwright-updates/` and posts one notification. Record the note's file name and first lines, and the row from `studio notifications`.

What only you can see: the step 4 notification appeared (title "Loomwright `<from>` → `<to>`"). Don't click it: its data dir is deleted when the step ends, so the click has nothing to show.

## Step 5: `kill -9` before a reminder's time (harness)

The harness's step 5 asks for a reminder at least 3 minutes ahead, picked as in step 1 (tag `phase2-exit-<run>-step5`) and then sends `kill -9` to the service's kernel, after checking that `api.json` and `launchctl print` name the same pid. It waits for launchd to restart the kernel (a new pid that answers `studio status`; launchd's `ThrottleInterval` is 60 seconds) and then waits for the reminder. It passes when the restart came before the reminder's minute, and the reminder fired exactly once: one notification row and one `trigger_fired` event, still one after 15 more seconds. Record whether exactly one notification appeared on screen.

## If a step fails

Record it as failed, with what you saw, in the evidence file. Don't patch the code in this PR. Each fix becomes a new item in `.supervisor/requirements/phase-2/`. Phase 2 stays not done, and this PR unmerged, until a rerun passes all five steps. Phase 1's first live run failed the same way and was rerun.

## The evidence file

Commit `docs/evidence/phase-2-exit-live-<YYYY-MM-DD>.json` on this PR's branch, in the same commit as the `docs/ROADMAP.md` change (below). Copy the machine-observed values from the harness summary; type your own observations into the `owner` fields. Never paste env, a token or a path to a credential.

```json
{
  "test": "phase-2-exit-live",
  "date": "YYYY-MM-DD",
  "commit": "<git rev-parse HEAD that the service was installed from>",
  "dirty_worktree": false,
  "machine": { "macos": "<sw_vers -productVersion>", "node": "<node --version>", "notifier": "terminal-notifier <version> | osascript only" },
  "wright_model": "<the model in config/agents/wright.json>",
  "harness_summary": "<the summary path; its content is copied into the steps below>",
  "steps": {
    "1_reminder_fires": {
      "outcome": "passed | failed",
      "harness": { "reminder": {}, "ask": {}, "triggers_created": [], "other_new_triggers": [], "studio_triggers_entry": {}, "notifications": [], "fired_late_ms": 0, "trigger_events": {} },
      "owner": { "notification_appeared": true, "title_and_body": "", "click_opened_terminal": true, "terminal_output": "", "prompts": "" },
      "findings": []
    },
    "2_literal_5pm": {
      "outcome": "passed | failed",
      "owner": { "reply": "", "trigger_row": "", "notification_appeared_at_17_00": true, "notification_row": "" },
      "findings": []
    },
    "3_reminder_off": {
      "outcome": "passed | failed",
      "harness": { "reminder": {}, "ask": {}, "triggers_created": [], "other_new_triggers": [], "off": {}, "notifications": [], "trigger_events": {}, "trigger_row": {} },
      "owner": { "nothing_appeared": true },
      "findings": []
    },
    "4_version_change": {
      "outcome": "passed | failed",
      "mode": "fixture_switch | real_update",
      "owner_consent": "<for the fixture switch: who consented and when>",
      "harness": { "contract": {}, "note_files": [], "note_first_lines": [], "notifications": [], "seen_versions": [] },
      "owner": { "notification_appeared": true },
      "findings": []
    },
    "5_kill_9_restart": {
      "outcome": "passed | failed",
      "harness": { "reminder": {}, "ask": {}, "triggers_created": [], "other_new_triggers": [], "before_kill": {}, "killed": {}, "restarted": {}, "notifications": [], "trigger_events": {}, "fired_late_ms": 0 },
      "owner": { "exactly_one_notification_appeared": true },
      "findings": []
    }
  },
  "run_tag": "<the summary's run_tag>",
  "cleanup": "<the summary's cleanup list, and the result of the three checks under 'What this run does to the machine'>"
}
```

A failed step keeps `"outcome": "failed"` and its `findings` (what was seen, and the new item's file name).

## Marking phase 2 done

Only when all five steps passed, in the same commit as the evidence file:

- `docs/ROADMAP.md`, phase 2 row: add **Done `<date>`** and the evidence file's path to the first cell, and a ✓ at the end of its "Done when" cell, in the phase 1 row's shape.
- Run `bash scripts/check-docs.sh` (it must pass), and put the evidence path in the PR body.

The PR merges only after that commit.
