# Phase 5 exit: the owner's live run

Phase 5 is done when this holds in the running system ([`docs/ROADMAP.md`](../ROADMAP.md), phase 5 row): everything in phases 2-4 can be done from the app, with nothing typed in a terminal. The owner decided on 2026-10-20 that the criterion starts after setup: the token and the service install stay in the terminal, and they are listed under [Setup](#setup), outside the criterion.

The deterministic half is in CI: `app/e2e/phase-5-exit.spec.ts` drives the built app with Playwright against a real kernel started in-process, with stand-in sessions, one injected clock and a stub notifier, and checks every step's effect in the kernel's store. This runbook is the live half: the packaged `Loomwright Studio.app`, the kernel installed as a launchd agent, a real Wright and a real crew member, on this Mac. Phase 4's live run is the precedent ([runbook](phase-4-exit-runbook.md), [evidence](phase-4-exit-live-2026-10-20.json)).

The owner decides when this runs. It uses the owner's subscription, launchd service and screen. The owner runs it, or has an agent run it while watching the screen ([D33](../DECISIONS.md)). Either way, every decision in the app (approve, deny, Create, Stop, Kill, the kill switch's confirm) is the owner's, every `owner` field below holds only what the owner reports seeing, and the evidence file's `run_by` says who ran it.

## What this run does to the machine

Read this before starting.

- **It writes into your real store, through the app.** Everything below lands in `~/.loomwright-studio/studio.db` (or `$STUDIO_DATA_DIR`): two reminders (triggers) Wright registers, one fired with its notification and one recorded missed while paused; a playbook Wright drafts, which you set, approve and run once; a crew member Wright drafts and you create, with its `config/agents/<id>.json` and `memory/<id>/`; the sessions all of this starts, two of which you stop and kill; a pause and its release; a kill-switch engagement and its release; and the approvals you decide.
- **Wright's model changes.** Flow 6 sets it in Team, which rewrites `config/agents/wright.json`. The harness records the model it found at the start (`wright_model_at_start`) so you can set it back in cleanup.
- **The kill switch stops every running session**, yours included, not only the run's. Flow 5 engages it last, after flows 1-4. Release it from the menu bar straight after.
- **A throwaway repo appears in your temp folder** for the reviewer in flow 3 (setup step 6). The reviewer's push is denied before it runs, so its bare remote is never written. You remove the folder after the run.
- **Real notifications appear**: the reminder's, and one for each held approval (the enable in flow 2, the create and the comment in flow 3).
- **Sessions spend tokens** on your subscription: Wright's sessions for each Chat request (the reminders, the draft, the dry run, the enable, the charter), the dry run's own session, the run now's session, the reviewer's two sessions, and the two long sessions you stop and kill.
- **The harness only reads.** It opens the store read-only and reads `wright.json` as a file. It never calls the `studio` CLI, never posts to the API, never decides an approval, and its cleanup writes nothing: it lists what the run left on, and you turn those off in the app.

## Setup

Setup is excluded from the criterion: these steps are typed in a terminal, before the run starts. Run from the repo root, with this PR's branch checked out. From the moment the harness prints that the run has started (step 7), nothing more is typed in a terminal until it ends.

1. **The subscription token, in your own terminal ([D27](../DECISIONS.md)).** Skip this when an earlier phase's run already stored it: `security find-generic-password -s loomwright-studio-oauth >/dev/null && echo stored`. Otherwise:

   ```bash
   claude setup-token
   security add-generic-password -a loomwright-studio -s loomwright-studio-oauth -w
   ```

   `security` asks for the token; paste the whole token (check that a narrow terminal did not cut it). These are the commands the app itself shows when the kernel is not installed ([the app](../architecture/app.md)). Studio never runs a login flow of its own.

2. **Build the kernel and install (or reinstall) the service.** The service runs an install copy under `<dataDir>/app/`, not the checkout (D31), so reinstall after every build you want it to run.

   ```bash
   cd kernel && npm ci && npm run build && cd ..
   node kernel/dist/cli/index.js service install
   launchctl print gui/$(id -u)/com.loomwright.studio.kernel | grep -E 'state|pid|last exit code'
   node kernel/dist/cli/index.js status
   ```

   Record: the commit (`git rev-parse HEAD`), the pid `service install` printed, and that `status` answered.

3. **Wright's model and tool policy** in `~/.loomwright-studio/config/agents/wright.json`. Wright needs a model and, in `tool_policy.allowedTools`, the trigger, playbook and crew tools the earlier phases added: a file from before phase 3 or 4 lacks some, since the kernel never rewrites it. The lists to add are in [phase 3's runbook](phase-3-exit-runbook.md) (setup step 3, the six playbook tools) and [phase 4's](phase-4-exit-runbook.md) (setup step 3, the four crew tools); `mcp__kernel__kernel_trigger_register` and `mcp__kernel__kernel_notify` come from phase 2's proposed policy. Record the model and whether you added any names. Flow 6 then changes the model from the app.

4. **Check the notifier.** `ls -l /opt/homebrew/bin/terminal-notifier /usr/local/bin/terminal-notifier`. Without terminal-notifier, notifications still appear (through osascript) but have no click action, and their rows say `unsupported`. Record which is present.

5. **Package the app.**

   ```bash
   cd app && npm ci && npm run package && cd ..
   ```

   The output is `app/release/mac-arm64/Loomwright Studio.app`, ad-hoc signed, never published or notarised ([package evidence](phase-5-foundation-package.md)). Don't open it yet. Record the commit it was built from.

6. **Make the reviewer's throwaway repo**, outside every macOS-protected folder (D31, so never under `~/Documents`), with one commit its bare `origin` has and one it does not:

   ```bash
   R="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/studio-phase5-exit-XXXXXX")" && pwd -P)"
   git init --bare --quiet "$R/remote.git"
   git init --quiet -b main "$R/repo"
   git -C "$R/repo" commit --quiet --allow-empty -m "initial commit"
   git -C "$R/repo" remote add origin "$R/remote.git"
   git -C "$R/repo" push --quiet origin main
   git -C "$R/repo" commit --quiet --allow-empty -m "unpushed commit"
   git --git-dir "$R/remote.git" rev-parse refs/heads/main   # the remote's main: record it
   echo "$R/repo"                                            # the reviewer's workspace in flow 3
   ```

   Check `command -v gh`: with `gh` on the machine a real reviewer tries the comment in flow 3. The comment is held before it runs, so no GitHub is used.

7. **Start the harness** in a terminal at the repo root. It only reads; from here on, every step is in the app.

   ```bash
   cd kernel && STUDIO_LIVE=1 npx vitest run test/phase-5-exit-live.test.ts
   ```

   It checks that the service is running under launchd and that `api.json` names its pid, records the run start (the highest event, approval, session, playbook-run and notification ids, and Wright's model), and prints `phase-5-exit-live summary: <path>` and `do the six flows in Loomwright Studio.app now`. Only what happens after the run start counts. It then re-reads the store every five seconds and prints a line each time a flow's outcome changes. It waits up to 90 minutes (`STUDIO_LIVE_WAIT_MIN=<minutes>`, 1 to 240, changes that), and ends as soon as all six flows pass.

8. **Open `Loomwright Studio.app` from Finder or the Dock** (from `app/release/mac-arm64/`, or after dragging it to the Dock). Never from a terminal.

## The six flows, in the app only

Do them in this order. Each one is done with clicks, typing in the app, the ⌘K palette and the menu-bar icon. The harness checks each flow's effects in the store (rows, events and decisions, never a reply's text: a real model may phrase things differently) and records it as `pass`, `fail` (the flow started but an effect is missing or wrong) or `not_exercised` (nothing of it happened since the run start). A flow you do not do is `not_exercised` and **fails the run**; nothing passes silently. If a flow fails, you may redo it in the app while the harness is still waiting, never in a terminal.

In the requests below, `<date>` is today's date as `MMDD` (for example `1023`), so the run's own playbook and crew member are easy to tell apart in cleanup.

### Flow 1: a reminder (phase 2)

In Chat, ask Wright: `Remind me in 3 minutes to stretch my legs.` Wright answers in its thread; no trigger card shows yet (the app draws nothing for a trigger before it fires). Wait until past its time: it fires, the notification appears on screen, and Wright's thread shows a one-line `Trigger <id> fired (notify)` card. The full trigger card, with On and Off, does not show for it: the app draws that card only for a trigger `GET /triggers` lists, which is enabled triggers only, and a fired one-time reminder is spent. Then click the notification: the app comes forward on Wright's thread, the thread the notification names. The app has no list of notifications, so there is no row of it to look for in the app. Without terminal-notifier (setup step 4) the notification has no click action; record that instead.

The harness passes it when a trigger Wright registered (an agent trigger with no playbook) has a `trigger_fired` event, the instant's work step is recorded `fired`, and the notification row the fire names exists in the store with that trigger as its source. It records the notification's `delivery_status`.

What only you can see: did the one-line "fired" card show in Wright's thread, did the notification appear on screen, and did clicking it open the app on Wright's thread?

### Flow 2: a playbook, its priority, its dry run, its enable, and run now (phase 3)

1. In Chat, ask Wright: `Draft a playbook named "phase5 exit <date>" that every day at 09:00 UTC sends me a one-line notification saying good morning. Don't enable it yet.` Its draft card shows in Chat.
2. On the card, **Set priority** to `high`.
3. In Chat, ask Wright: `Dry run the playbook "phase5 exit <date>", then ask me to enable it.` The dry run is shown, and the enable is held for you.
4. In **Approvals**, read the held `kernel_playbook_enable` and press **Allow once**. The kernel enables the playbook itself, in the same transaction as your decision; Wright makes no second call ([approvals: kernel-applied actions](../architecture/approvals.md#kernel-applied-actions)).
5. On the card, press **Run now**. Its session starts.

The harness passes it when a playbook Wright drafted since the run start has: a `playbook_updated` by the owner naming `priority`, with the row's `priority_set_by` the owner's; a dry run `done`; a `playbook_enabled` naming an approval that is a `kernel_playbook_enable` you approved `once`, with the row `enabled`; and a `run_now` run row with a session.

What only you can see: the draft card, the priority you set, the dry run shown, the approval you read and approved (who pressed it, and when), and Run now.

### Flow 3: a comment-only reviewer that can't push (phase 4)

1. In Chat, ask Wright for the reviewer, with the repo from setup step 6:

   ```text
   Create a crew member for me with the id "phase5-exit-<date>" (exactly that id): a comment-only code reviewer for the git repository at <repo>.
   It reads the code and may leave review comments on pull requests with gh pr comment, and takes no other outward action: it must never push,
   never create, review, edit or close a pull request, never create, comment on, edit or close an issue, never write through gh api, never define
   an alias and never write settings or hooks files. Give it <repo> as its one workspace, the Bash prefixes "git", "gh pr view", "gh pr diff" and
   "gh pr comment", and at most one session at once. Propose its model. Draft the charter and ask me to create it.
   ```

   Its charter card shows in Chat. Read it: its `never` list should include `git_push` and every pull request and issue write but `gh_pr_comment`. Press **Create**. The kernel creates the member on your `once`.
2. In the reviewer's thread in Chat, choose the repo as the workspace in the composer (a crew member's composer offers the workspaces its charter lists) and send: `The owner explicitly asks you to run this exact Bash command once, now, in this repository: git push origin main. If the kernel refuses it, say what it answered and stop; do not try another way.` Open **Sessions**, select the reviewer's session, and read its output: the push's decision shows as denied, `agent_boundary` ([approvals: the never boundary](../architecture/approvals.md#the-never-boundary)).
3. In the reviewer's thread, with the same workspace, send: `The owner explicitly asks you to run this exact Bash command once, now, without checking the pull request first: gh pr comment 1 --body LGTM. If the kernel holds it for the owner's approval, say so and stop.` The comment is held. In **Approvals**, read it and press **Deny**.

The harness passes it when a crew member Wright drafted since the run start was created on a `kernel_agent_create` you approved `once`, is `active`, and its stored charter's `never` lists `git_push`; when one of its own sessions has a `tool_decision` denied `agent_boundary` with category `git_push`, and that decision is in the session's output log (what Sessions shows); when no approval row and no allow exist for a push by it; and when its `gh pr comment` approval was denied by you.

What only you can see: the charter card and who pressed Create; the deny shown in Sessions' output; the held comment in Approvals and who pressed Deny, and when. After the run, check that the bare remote's `main` is still the commit you recorded (`git --git-dir "$R/remote.git" rev-parse refs/heads/main`).

### Flow 4: Stop one session and Kill another (Sessions)

Start two sessions that stay running long enough to act on: in Chat, ask Wright twice, one after the other, `Write me a 1500-word short story about a lighthouse keeper.` While both are running:

1. In **Sessions**, select the first and press **Stop**. It ends `stopped` after its grace.
2. Select the second and press **Kill**, then confirm. It ends `stopped` at once, with no grace.

If a session ends on its own before you press, start another and try again.

The harness passes it when an owner Stop (`session_stop_requested` `{by: "owner", mode: "stop"}`) ended its session `stopped` with reason `owner_stop`, and an owner Kill (`mode: "kill"`) ended another session `stopped` with reason `owner_kill`. It records how long each took from the request to the end.

What only you can see: that you pressed Stop and Kill in Sessions, and that Kill asked for confirmation first.

### Flow 5: Pause all, a missed reminder, Resume, then the kill switch (menu bar)

1. In Chat, ask Wright: `Remind me in 3 minutes to drink some water.` No card shows for it: the app draws a trigger's card only once it fires, and this one never does.
2. Before it is due, open the menu-bar icon and choose **Pause all**.
3. Wait until past its time. It does not fire: the kernel records the instant `missed_paused`.
4. From the menu bar, choose **Resume** (or **Unpause**, which the tray shows in place of Pause all while paused). The pause clears.
5. From the menu bar, choose **Kill switch…** and confirm. Every running session stops and nothing new starts.
6. From the menu bar, choose **Resume** again, which releases the kill switch.

The harness passes it when a pause came from the app (`pause_engaged` with `via: "api"`; a `studio pause` would say `cli`, and fails the flow), a trigger instant inside it was recorded `missed_paused` (a `trigger_missed`, reason `paused`) and never fired, that same pause was released from the app (a miss in one pause and a release of another do not count), and a `kill_switch_engaged` event was recorded. It records the kill switch's release, which cleanup also lists if it is missing.

What only you can see: that each of these was the menu-bar item, that the kill switch asked for confirmation, and that the reminder's notification did not appear.

### Flow 6: set Wright's model (Team)

In **Team**, select Wright and, in its inspector, set its model to another model you choose. The kernel rewrites `wright.json`.

The harness passes it when an `agent_settings_set` for `wright`, field `model`, by the owner, was recorded since the run start, and `wright.json`'s model is the one it names.

What only you can see: that you set it in Team's inspector, and which model you chose.

## When the harness ends

It ends as soon as all six flows pass, or at its deadline, and prints the summary path again. The summary (mode `0600`, under `tmpdir()`, any `sk-ant-…` string redacted, your home dir written as `~`, never env) is rewritten after every change, so it survives an early stop. The run passes only when all six flows pass.

## Cleanup

Touch only the run's own playbook, triggers and crew member. The summary's `cleanup.left_for_the_owner` lists what the run left on: its playbooks not off, its triggers still on, its crew member still active, any approval still pending since the run start, and whether a pause or the kill switch is still engaged. All of it is done in the app:

- **The playbook** `phase5 exit <date>`: press **Turn off** on its card.
- **The triggers:** a spent reminder is already off; turn off any of the run's triggers the list still names with **Off** on its card. A trigger has a card in Chat only after it has fired, so a trigger still on that never fired has none; if the list names one, record it in the evidence file's `cleanup` as a finding (the app gap in [OPEN_QUESTIONS](../OPEN_QUESTIONS.md)) rather than turning it off in a terminal. The playbook's own trigger never starts work while the playbook is off.
- **The crew member** `phase5-exit-<date>`: in Team, select it and press **Turn off**. Turning a member off never deletes its memory, so its row (now off), its settings file and its `memory/<id>/` folder stay, and its id is never reused.
- **Anything pending** from the run: deny it in Approvals.
- **A pause or the kill switch still engaged:** **Resume** from the menu bar.
- **Wright's model:** set it back to `wright_model_at_start` in Team, if you want the old one.

Nothing else is touched. After the run, remove the throwaway repo (`rm -rf "$R"`, the folder from setup step 6, and only that one), and note in the evidence file's `cleanup` what you did about each item.

## If a flow fails

Record it as failed (or `not_exercised`), with what you saw, in the evidence file. Don't patch the code in this PR. Each fix becomes a new item in `.supervisor/requirements/phase-5/`. Phase 5 stays not done until a rerun passes. The first live runs of phases 1 to 4 failed the same way and were rerun.

## The evidence file

Commit `docs/evidence/phase-5-exit-live-<YYYY-MM-DD>.json` after a passing run, in the same commit as the `docs/ROADMAP.md` change (below). It has phase 4's shape, `run_by` included ([D33](../DECISIONS.md)). Copy the machine-observed values from the harness summary; type your own observations into the `owner` fields. Never paste env, a token or a path to a credential.

```json
{
  "test": "phase-5-exit-live",
  "date": "YYYY-MM-DD",
  "result": "passed | failed — <one line>",
  "run_by": "<the owner, or which agent at the owner's request with the owner watching (D33)>",
  "commit": "<git rev-parse HEAD that the service and the app were built from>",
  "dirty_worktree": false,
  "machine": { "macos": "<sw_vers -productVersion>", "node": "<node --version>", "gh": "<gh --version, first line | not installed>", "notifier": "terminal-notifier | osascript" },
  "wright_model_at_start": "<the summary's wright_model_at_start>",
  "service": "<the summary's service>",
  "app": { "bundle": "app/release/mac-arm64/Loomwright Studio.app", "opened_from": "Finder | Dock", "harness": "<the summary's app>" },
  "harness_summary": "<the summary path; its content is copied into the steps below>",
  "run_start": "<the summary's run_start>",
  "owner": { "nothing_typed_in_a_terminal_after_setup": true, "app_opened_from": "Finder | Dock", "notes": "" },
  "steps": {
    "1_reminder_fires": {
      "outcome": "pass | fail | not_exercised",
      "harness": { "registered": [], "fires": [], "misses": [], "passing_fire": 0 },
      "owner": { "asked_in_chat": true, "fired_card_seen_in_chat": true, "notification_appeared_on_screen": true, "notification_click_opened_thread": true },
      "findings": []
    },
    "2_playbook_priority_enable_run": {
      "outcome": "pass | fail | not_exercised",
      "harness": { "created": [], "playbooks": [], "passing_playbook": 0 },
      "owner": { "draft_card_seen_in_chat": true, "priority_set_from_card": "high", "dry_run_seen": true, "approved_in_approvals_by": "<the owner | the agent, on the owner's word>", "approved_at": "", "run_now_pressed": true },
      "findings": []
    },
    "3_reviewer_cannot_push": {
      "outcome": "pass | fail | not_exercised",
      "harness": { "created": [], "members": [], "passing_member": "" },
      "owner": { "charter_card_seen": true, "create_pressed_by": "<the owner | the agent, on the owner's word>", "push_deny_seen_in_sessions_output": true, "comment_held_seen_in_approvals": true, "denied_by": "<the owner | the agent, on the owner's word>", "denied_at": "", "remote_main_unchanged": true },
      "findings": []
    },
    "4_sessions_stop_and_kill": {
      "outcome": "pass | fail | not_exercised",
      "harness": { "requests": [], "passing_stop": 0, "passing_kill": 0 },
      "owner": { "stop_pressed_in_sessions": true, "kill_confirm_shown": true, "kill_confirmed": true },
      "findings": []
    },
    "5_menu_bar_pause_and_kill_switch": {
      "outcome": "pass | fail | not_exercised",
      "harness": { "pause_events": [], "kill_switch_events": [], "pause_windows": [], "kill_switch_engaged_at": [], "passing_pause": 0 },
      "owner": { "pause_all_from_tray": true, "resume_from_tray": true, "kill_switch_from_tray": true, "kill_switch_confirm_shown": true, "resumed_after_kill_switch": true },
      "findings": []
    },
    "6_team_sets_wright_model": {
      "outcome": "pass | fail | not_exercised",
      "harness": { "model_at_start": "", "sets": [], "wright_json_model": "", "wright_json_error": null },
      "owner": { "set_in_team_inspector": true, "model_chosen": "" },
      "findings": []
    }
  },
  "cleanup": "<the summary's cleanup.left_for_the_owner, what you did about each item in the app, and the throwaway repo's removal>"
}
```

The `owner` keys are the ones the harness summary leaves null; `remote_main_unchanged` is the one you add, from the check after flow 3. A failed flow keeps `"outcome": "fail"` (or `"not_exercised"`) and its `findings` (what was seen, and the new item's file name). It may also carry a `store_evidence` block: values read from the store that the harness summary did not capture, which D33 allows. Each value names where it was read from.

## Marking phase 5 done

Only when all six flows passed, in the same commit as the evidence file:

- `docs/ROADMAP.md`, phase 5 row: add **Done `<date>`** and the evidence file's path to the first cell, and a ✓ at the end of its "Done when" cell, in the earlier rows' shape.
- Run `bash scripts/check-docs.sh` (it must pass), and put the evidence path in the PR body.
