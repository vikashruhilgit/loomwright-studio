# Probe 14: can Loomwright merge one parked `awaiting_merge` item through its `--auto-merge` gate?

Phase 8 item 01, **owner-run** (or the agent on the owner's word, with the owner watching: D33, D35). **Run 2026-11-05: the answer was no on Loomwright 17.31.0.** This file is the procedure only; the result is in `docs/OPEN_QUESTIONS.md` ("Phase 8: probe p14").

## The claim under test

D40's merge flow: `/automate` runs in safe mode and parks a ready PR `awaiting_merge`. An opt-in "merge when ready" playbook then has **Loomwright merge that one item through its own `--auto-merge` gate** (all seven conditions still run), and `/automate` reconciles and finishes the item itself. The kernel never merges (invariant 4).

**The question:** on `studio-sandbox`, does re-entering `/automate` for one parked item with `--auto-merge` merge it through the gate and check it off? Record the exact invocation that did it, or that no supported entry point exists and Loomwright needs a change.

What the installed docs suggest, read 2026-11-02 against Loomwright 17.26.0 and **not** a run: `/automate`'s `--auto-merge` executes `gh pr merge --squash` at the GATE of a drain, and `--resume` on an item whose PR is still open leaves it `awaiting_merge` until the PR is merged (`skills/automate-loop/resume.md`). So a "no" is a real possibility. Do not assume either answer.

## Rules

- **Target: only `vikashruhilgit/studio-sandbox`**, the owner's personal throwaway repo. Never `vendsy/*`, never any Tray system.
- **The PR is merged on purpose, by Loomwright's gate only.** Never run `gh pr merge` yourself, and never edit the run file by hand to make the item look done: either would invalidate the answer. The owner names the merge before the run (D35).
- **It spends real tokens** on the owner's subscription: one full `/automate` item (run 1), then the merge re-entry (run 2). Measure it from the session's usage; do not estimate it.
- Run it in an ordinary terminal Claude Code session in a clone of the sandbox, with Loomwright installed as a plugin. (Whether `/automate` runs inside an Agent SDK session the kernel starts is the other probe, p15.)

## Setup (once)

1. Record the Loomwright version: `jq -r .version ~/.claude/plugins/cache/atelier/loomwright/*/.claude-plugin/plugin.json`, and which one the session uses (`/plugin`).
2. A clone of `studio-sandbox` outside `~/Documents`, `~/Desktop`, `~/Downloads` and iCloud Drive (D31), clean, on `main`. It needs a `ci` workflow that passes on a trivial change.
3. **Branch protection.** Loomwright's gate condition 4 wants enforceable protection on the base branch. `studio-sandbox` is private on GitHub Free, where GitHub refused protection (403, checked 2026-11-02). Either make it public and require `ci` on `main` (the owner's chosen setup for the exit run), or run with `--trust-unprotected` and **record that condition 4 was waived, so this run did not exercise it**.
4. Two small stories as `.md` files in one folder, e.g. `stories/01-add-greeting.md` and `stories/02-add-farewell.md`, each a one-line, low-risk code change (nothing under `.github/`, no auth or secrets path), committed and pushed. Two, so you can see whether the merge re-entry starts the second item unasked.

## Run 1: park one item (safe mode, no `--auto-merge`)

In the clone, in a Claude Code session:

```
/loomwright:automate --folder stories --limit 1
```

(Use the command name `/plugin` or `/help` shows for `automate` if it differs.) Answer the questions it asks. **Done when** the item is parked: the run file (`.supervisor/automate/<run>.md`) shows `## Status: paused`, the item `awaiting_merge` with a `pr:` URL, the PR is open, and CI is green. Record the run id, the run file name, the PR number and the file's `## Status`, `- item:` and `pause_reason:` lines. If the item does not park (it escalates, fails, or parks for another reason), record that and stop: the probe did not get a parked item, so it did not answer.

## Run 2: re-enter for that one item with the gate

Try the supported, documented forms in this order, **one at a time**, recording each one's exact command line, what it did and its last lines of output. Stop at the first that merges.

1. `/loomwright:automate --resume <run_id> --auto-merge` (add `--trust-unprotected` only if setup step 3 chose it).
2. Any other entry point the installed docs name for merging one parked item (search `commands/automate.md` and `skills/automate-loop/modes-and-merge-gate.md` and `resume.md` for it; record what you found and tried).

Do not use a form the docs do not document, and do not combine steps by hand.

## What to observe, and the answer

The answer is **yes** only if all of these hold for one invocation:

1. **It merged through the gate.** The PR reads `MERGED` (`gh pr view <n> --repo vikashruhilgit/studio-sandbox --json state,mergedAt,mergedBy`), and the session shows the gate evaluating its conditions and then running the merge itself. You ran no `gh pr merge`.
2. **It reconciled and finished the item.** The run file's item is checked off (`- [x]`) with the merge recorded, and the run's `closeout` ran (its cleanup, stamp and check-off, as Loomwright does after a human merge).
3. **It started no other drain.** No second session, lane or fix run was started, and item 2 was **not** started unless the invocation asked for it (record whether it was).
4. **It needed no hand edit** of the run file, the PR or the repo between run 1 and run 2.

The answer is **no** if no documented invocation merged the item, if the gate parked it (record the `PARK: <reason>`; a high-risk park or a failed condition is a finding, not an error: say which), or if it merged only after a step in the list above was broken. A "no" with a stated reason, for example "`--resume` reconciles an open PR to `awaiting_merge` and never re-runs the gate", is a complete answer.

## What to record in `docs/OPEN_QUESTIONS.md`

The run date; the answer (yes / no); the Loomwright version; the exact invocation that merged the item, or "no supported entry point"; whether condition 4 was exercised (protection) or waived (`--trust-unprotected`); the run file lines before and after; the PR number; and anything the gate parked on.

**If the answer is no, stop and report it to the owner.** The merge flow then needs a Loomwright change, in that repo, and phase 8 items 09 and 14 wait on it. Do not work around it in Studio (invariant 4).

## Cleanup

Delete the sandbox's leftover branches (`gh api -X DELETE repos/vikashruhilgit/studio-sandbox/git/refs/heads/<branch>` or `git push origin --delete <branch>`), and leave or revert the merged commit on `main`; the repo is a throwaway. Remove the local clone when done.
