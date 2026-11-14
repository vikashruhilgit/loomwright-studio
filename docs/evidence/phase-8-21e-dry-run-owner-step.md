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

## Validation 2: the packaged app (owner-run, not yet walked)

This is a running-system step the worker cannot perform: it needs the packaged Loomwright Studio app with the kernel installed from this PR's head, a ClickUp connection and a crew member. It is left as a procedure to complete.

Procedure:

1. Install the kernel from the PR head into the packaged app and restart the daemon.
2. In Team, give a crew member (for example Ticket Runner) ClickUp read access and the `automate_tickets` job's tools, but no GitHub write access.
3. Ask Wright for a playbook for that member that watches a ClickUp list and hands tickets to /automate; keep it a draft.
4. Ask Wright to dry-run it.
5. Expect: the preview lists the ClickUp task(s) with `would run` verdicts; no review session starts; the run shows 0 tokens (Activity or `studio playbooks`); Wright's reply names the GitHub write access as the owner's step in Team → the member's inspector, without a raw tool name or a reason token; the stored run's `result_json` holds `poll.preview_incomplete.reason = "owner_step_open"` and the `fit`.
6. Grant the access in Team, dry-run again with a new key, and expect a review session to run as before.

Results: pending the owner's walk.

Verdict: PENDING (owner-run)
