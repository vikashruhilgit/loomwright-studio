# Phase 8 item 21e: a poll playbook's dry run names the owner's missing grant instead of running a review that cannot act

A dry run of a crew member's ticket playbook whose member lacks a connector grant (for example GitHub write for "Hand tickets to /automate") started a review session of about 100k tokens that could not use the jobs' tools. Its `final_text` blamed missing tools, a non-git directory and raw tool names, and the owner read that as the cause. The kernel already knew the real cause before the session: `playbookFit` (`kernel/src/playbooks/fit.ts`) puts it in `fit.owner_steps`. This item makes the kernel decide, before any session (invariant 2: the kernel, not the model, decides whether a session starts).

What changed:

- `kernel/src/playbooks/dry-run-poll.ts`: a new `poll.preview_incomplete.reason`, `owner_step_open`, in `PREVIEW_INCOMPLETE_REASONS`; a pure `withOwnerStepOpen` that keeps the poll's items, reviews nothing and carries each owner step verbatim as `fix`; and a summary branch that lists the items, then says the review was skipped until the owner takes the step (it does not say a real run parks, which is false here).
- `kernel/src/playbooks/dry-run.ts`: the fit is read once per run (never throws); after `previewPoll` picks an item, a non-empty `fit.owner_steps` stores the run through the existing no-session path (`done`, `session_id` NULL, 0 tokens) with the `fit` beside the poll; a run whose session does run stores the `fit` beside `final_text`; the tool description names `owner_step_open`.
- `docs/architecture/dry-run.md`: the reasons table and the paragraphs on incomplete previews say `owner_step_open` is decided after the fetch, keeps its items, and a real run is refused rather than parked.

## Validation 1: the kernel suite and the docs check

Run from this worktree after the change (base `02244df1`):

```bash
cd kernel && npm ci && npm test
bash scripts/check-docs.sh
```

| Check | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm test` (vitest run) | 137 test files passed, 2 skipped; 4621 tests passed, 16 skipped, 0 failed |
| `npx tsc -p tsconfig.json` | exit 0 |
| `bash scripts/check-docs.sh` | `check-docs: OK`, exit 0 |

New pins (all in the two test files named in the brief):

- `kernel/test/playbooks-dry-run-poll-unit.test.ts`, `describe("owner_step_open")`: the closed list; `withOwnerStepOpen` keeps items and joins steps verbatim; `previewPoll` never returns the reason itself; `pollOf` keeps a stored one with its items; `formatPollSummary` lists items, names the step, says the review was skipped and shows none of `owner_step_open`, `charter_gap`, `mcp__`, `kernel_`; the other four reasons keep the `a real run parks` sentence; the tool description names `owner_step_open` and `fit.owner_steps`.
- `kernel/test/playbooks-dry-run-poll.test.ts`, `describe("a crew member's poll playbook with an owner step open: owner_step_open (21e AC1-AC7)")`, over a real store, `createAgent` crew member, the shipped catalogue and `FakeGitHubClient`: AC1 to AC3 (a session starter that throws is never called; items listed; row `done`, `session_id` NULL, `tokens` 0; `result_json` carries `poll` and `fit`; audit event `tokens: 0`; `latestDryRun` re-reads the same summary), AC4 (refused calls only: the review runs), AC5 (after the grant a new key runs the review), AC6 (Wright-owned, `unchecked`, and earlier reasons keep their own), AC7 (`fit` stored beside `final_text`).
- Pin check done by hand: replacing the `ownerSteps.length > 0` test in `dry-run.ts` with `false` fails the AC1 to AC3 and AC5 cases; the change was reverted.

## Validation 2: the packaged app

This is a running-system step the worker could not perform: it needs the packaged Loomwright Studio app with the kernel installed from this PR's head, a ClickUp connection and a crew member. The procedure below was written by the worker; the run under it was done afterwards.

Procedure:

1. Install the kernel from the PR head into the packaged app and restart the daemon.
2. In Team, give a crew member (for example Ticket Runner) ClickUp read access and the `automate_tickets` job's tools, but no GitHub write access.
3. Ask Wright for a playbook for that member that watches a ClickUp list and hands tickets to /automate; keep it a draft.
4. Ask Wright to dry-run it.
5. Expect: the preview lists the ClickUp task(s) with `would run` verdicts; no review session starts; the run shows 0 tokens (Activity or `studio playbooks`); Wright's reply names the GitHub write access as the owner's step in Team → the member's inspector, without a raw tool name or a reason token; the stored run's `result_json` holds `poll.preview_incomplete.reason = "owner_step_open"` and the `fit`.
6. Grant the access in Team, dry-run again with a new key, and expect a review session to run as before.

Results:

Run on 2026-11-14 at 12:45 local time (macOS 26.6.2, Node v24.11.1) by Claude, at the owner's request. Both the kernel and the app were built from this PR's head `516a90a2`: `npm run build` then `service install` (launchd service, pid 74277; the install copy's `dist/playbooks/dry-run.js` and `dry-run-poll.js` carry `owner_step_open`), and `npm run package`, opened through LaunchServices with `open`.

- **Steps 2 and 3:** already in place from item 21a's walk, so nothing was changed. Ticket Runner (`ticket-runner-20c`) is active, holds the ClickUp grant `clickup_filter_tasks` and no GitHub grant; its draft playbook 9 polls list `901422761392` tagged `studio-sandbox`.
- **Step 4:** the dry run was asked of Wright in Wright's thread through `studio ask` ("Dry-run playbook 9 … and tell me what it found."), not typed in the app's composer; the app was open on the same kernel.
- **Step 5:** dry run 188 listed the one task as `would run`, started no session (`session_id` empty), stored `tokens` 0 and `status` done, with `poll.preview_incomplete.reason` `owner_step_open`, its plain-words `fix`, and the `fit`. Wright's reply named the GitHub write access as the owner's step in Team → Ticket Runner's inspector, said the run stopped before planning, and showed no raw tool name or reason token. The merge job's two D44 refused calls are still named, as AC4 expects (`closable: false`, not counted as an owner step).
- **Step 6 (AC5):** not run. It needs a GitHub write grant on Ticket Runner, the owner's settings change, and a full review session (about 100k tokens in run 187). AC5 is covered by the unit tests in Validation 1.

```text
playbook_runs id 188: kind dry_run, status done, playbook 9 version 2, session_id (none), tokens 0,
  2026-11-14T07:15:42.399Z -> 2026-11-14T07:15:42.399Z
  poll.items:
    ref      clickup:86bd2djuq
    title    Add a README to studio-sandbox
    would    run
    dedupe   {"playbook.id":9,"item.id":"clickup:86bd2djuq"}
  poll.preview_incomplete:
    reason   owner_step_open
    fix      Ticket Runner needs GitHub write access for Hand tickets to /automate; only you can grant it: Team → Ticket Runner's inspector.
  final_text null, usage {}
  refused: Ask for a merge (run shell commands); Ask for a merge (work with pull requests on GitHub)
  fit: agent ticket-runner-20c, jobs automate_tickets + ask_for_merge, status gap

Wright's reply (studio ask), first lines:
  I ran the dry run of playbook 9 (run 188, version 2). It finished but only got partway: it found the
  ticket and stopped before planning any work or writing any drafts, so it used 0 tokens.
  - One ClickUp ticket in the playbook's list with the `studio-sandbox` tag: `clickup:86bd2djuq`,
    titled "Add a README to studio-sandbox". A real run would pick it up; nothing would be skipped as already done.
  - It stopped there because Ticket Runner doesn't have GitHub write access yet. Only you can grant
    that: Team → Ticket Runner's inspector.
```

Verdict: PASS for Validation 2
