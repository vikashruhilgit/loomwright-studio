# 23u — Defects a review found in PR #292 (auth switch, reply to a run, required checks)

## Status: merged (PR #294, `9603f84e`, 2026-11-19); live exit check 1 passed, check 2 not run (see "Live check")

Each defect was reproduced by a failing test first. The review drain on #294 found a ninth: a resume in place recorded the run's source session version, not the resumed session's own pair (`7dcf5421`, three tests, two failed first). The kernel was reinstalled from `9603f84e` at 03:16 UTC.

**Why.** On 2026-11-19 the owner asked whether the merged PR #292 was properly built. A separate reviewer read the diff without my conclusions and found eight defects. I re-read each one in the code. None caused harm in the 2026-11-18 run, and none can cause a bad merge (GitHub still enforces protection). Per the rule from 22b, each one became a fix only after a test failed on the merged code.

## The defects, and what changed

1. **The required-checks list the kernel wrote went stale** (`loomwright/required-checks.ts`).
   - **Was:** any `required_checks` already in `.supervisor/config.json` counted as the owner's, including the kernel's own earlier write, so re-detecting changed protection never reached the run.
   - **Now:** the kernel's own list is the one its last `run_required_checks` event for that checkout recorded as `written`. That list follows the detection: rewritten when the detected list changes, removed (`removed`, with an audit sentence) when the detection says the branch is unprotected or requires no checks.
   - A list the owner edited is still left alone. A detection that can't say (none, unreadable) changes nothing. An unchanged list writes and records nothing.
   - The write still runs before admission. With the list following the detection, a refused launch leaves only the current list, which the next launch would write anyway.
   - **Tests:** `required-checks.test.ts` (refresh, removal, unchanged, owner edit).
2. **A failed API key save lost the old key** (`gui/settings.ts`).
   - **Was:** the Keychain item was deleted before the add, so a failed add, or a silent one caught by the read-back, left no key. The app said "Nothing was stored".
   - **Now:** the old key is read first and put back on any failure. The answer says `previous_key: kept | removed | none`, and the app's words follow it.
   - **Tests:** `gui-settings-auth.test.ts` (throwing add, silent add, failed restore, no old key); `ProviderChoice.test.tsx`.
3. **A deferred auth switch looked like a restart and stayed hidden** (`gui/settings.ts`, `kernel.ts`, `ProviderChoice.tsx`).
   - **Was:** a session admitted in the 250 ms gap stopped the restart, but the app kept saying "restarting". The pending choice was not visible and could not be undone, and it applied at some later unrelated start.
   - **Now:** `GET /settings` reports `pending_provider`. Settings shows it with a "Keep the …" button, which records the provider in use. The screen reads the settings again 5 s after a `restarting` answer.
   - **Tests:** `gui-settings-auth.test.ts`, `ProviderChoice.test.tsx`, `model.test.ts`.
4. **A second reply could drop the first** (`gui/paused-runs.ts`).
   - **Was:** a queued reply (a pending `continue`) did not block anything. A second reply or a Resume ran first, and the first reply was then skipped as superseded.
   - **Now:** a pending continuation of the run blocks both: the new block `continuation_queued`, and the card hides the reply box.
   - **Tests:** `automate-resume.test.ts`, `ParkedRunCard.test.tsx`.
5. **A resumed run recorded the new playbook version but ran on the old model** (`automate/launch.ts`).
   - **Now:** the version and its model are one pair. A newer enabled version runs on its own snapshot's model (`playbooks/runs.ts` `versionModelOf`).
   - The source session's pair is kept when the snapshot names no model, or when a resume in place would need another model (a resume can't change it).
   - **Tests:** `automate-resume.test.ts`; `automate-launch-routes.test.ts` fixtures now carry the v1 snapshot that production writes.
6. **The restart's re-check was check-then-act, and its timer could throw** (`kernel.ts`, `gui/settings.ts`).
   - **Now:** `AuthControl.restart` closes admission first (refusal reason `restarting`, retried after 30 s), counts the running sessions, and either stops the kernel or opens admission again and reports the count. The timer body is wrapped, so a stopping kernel is never an uncaught exception.
   - **Tests:** `kernel-daemon.test.ts`, "the D42 auth-switch restart, as the kernel wires it" (real kernel, over HTTP).
7. **The daemon's restart wiring was tested only by matching source text.**
   - **Now:** the wiring is `daemonStartOptions` in `daemon-exit.ts`, tested by what it does: one stop, then exit 1; a second request is a no-op; a request before the kernel exists still exits 1; nothing is wired by hand.
   - **Not done:** a built-daemon end-to-end switch. A full start reads the real Keychain, which tests must never do.
8. **The superseded check compared raw checkout strings** (`automate/run-sessions.ts` `runKeyOf`).
   - **Now:** resolved, as `latestRunSessionOf` compares them.
   - **Tests:** `run-sessions.test.ts`.

## Honest limits
- Defect 5's fallback keeps the old pair when an enabled version has no snapshot model. Production writes a snapshot at every version, so this should not happen, but if it did, "always" on that run's calls would be refused as not the current version (the 2026-11-18 approval 62 case).

## Exit check
- Kernel and app suites green on the branch.
- After merge and reinstall:
  - a switch made while a session runs shows as pending in Settings, and Keep withdraws it;
  - re-detecting a repo after a protection change updates the checkout's `required_checks` on the next run launch.

## Live check (2026-11-19, kernel from `9603f84e`)
1. **Passed: a switch made while a session runs shows as pending, and Keep withdraws it.**
   - Staged by timing a queued Wright message and `PUT /settings/auth-provider` (api-key → subscription-token) just before a loop tick. Session 246 started on the API key 114 ms after the request, and the kernel recorded `auth_provider_restart_deferred {to: subscription-token, running: 1}` and did not restart.
   - `GET /settings` then answered `pending_provider: subscription-token` with the API key in use. The owner's screenshot shows the note and "Keep the Anthropic API key" in the app.
   - Keep (`PUT` naming the in-use provider) answered 200 `restarting: false`. The pid stayed the same, `pending_provider` went back to null, and `auth.json` reads `api-key` again.
2. **Not run: `required_checks` follows a protection change.** The hand-over runs only at a run session launch. On studio-sandbox that needs a new issue (#17 and #18 are deduped), a full `/automate` run through the owner's approval, and a real PR. The owner has not chosen to run it. The sandbox checkout's file holds the kernel's own `["ci"]` (written 2026-11-18 15:40), which the old code mislabelled `already_set` on every later launch.

## Found during the live check
- **The subscription token is rejected while Settings shows it "ok".** One race attempt missed, so the kernel restarted onto the subscription token, and session 245 ended `failed:auth` 30 s after init. The health check only shows a Keychain item exists. The kernel was put back on the API key at once.
- **Keep records no event.** Withdrawing the choice changes `auth.json` but writes no `auth_provider_*` event, so the audit's last auth entry is the deferral.
- **The pending note's layout squeezed the sentence into the 112px label column.** Fixed in PR #295 (two rows, e2e test that failed first).
- **The Settings window scrolled past its content.** The workspaces live region (`position: absolute`, no positioned ancestor) grew the document to 1,204px in a 760px window. Fixed by making the shell panes positioned (branch `fix/window-scrolls-past-content`, e2e test that failed first).
