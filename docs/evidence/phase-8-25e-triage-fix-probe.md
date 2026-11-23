# Phase 8 item 25e (Part B of 25f): does the kernel-started triage fix act on the `fix:` comment?

**Answer: no.** The fix session the kernel starts is never given the comment, and the Loomwright command it runs never reads it.

```
comment reached: no — commands/review-pr.md:40 (Loomwright 18.1.2): "Without `--until-mergeable` the behavior above is byte-for-byte the existing diff-only loop (AC7). It reads no external state, …"
```

Probed 2026-11-21 on Loomwright 18.1.2 (`~/.claude/plugins/installed_plugins.json`: `loomwright@atelier` 18.1.2, commit `882ae1a`). Nothing in [D45](../DECISIONS.md) or `kernel/src/automate/launch.ts` changed. The amendment proposed below is the owner's to decide.

## What was run

All of it is in [`kernel/test/phase-8-triage-fix-probe.test.ts`](../../kernel/test/phase-8-triage-fix-probe.test.ts), which runs in `cd kernel && npm test`. The kernel half runs everywhere. The Loomwright half needs an 18.1.2 install and skips with a named reason when there is none (GitHub Actions has none).

1. **The kernel's route and launch.** A PR parked `awaiting_merge` by a paused `/automate` run, with the owner's comment `fix: rename ping to pong` on it (a `FakeGitHubClient`). A live, write-granted playbook session calls the real `kernel_pr_route`, which answers `automate_fix`. The real `handleAutomateRun` then runs through the real `EventLoop` with a recording `EventSessions`, using the scaffolding of `kernel/test/automate-launch-routes.test.ts`. A second case checks the runbook's new walk, where triage runs on PR A after its merge.
2. **Loomwright's command for that exact prompt.** The installed `commands/review-pr.md`, read at the cited line, and its "What This Does" step list.
3. **For contrast, the `--until-mergeable` drain.** `scripts/review-heal-next-step.sh <pr> --start drain --required-checks name:ci --no-auto-postmortem` ran once against a scratch git repo under `tmpdir()`, with `HOME` sandboxed and a stub `gh` (first on PATH and named by `LOOMWRIGHT_GH_BIN`) that returns the comment on the PR's issue-comment channel and fails any call it has no row for. The default loop never calls this driver. It is driven only to show what the `--until-mergeable` amendment would change.

## What was seen

**The kernel (step 1).**

| What | Observed |
|---|---|
| Route | `automate_fix`, `owner_kind: automate_parked`, `run: started_by_kernel` |
| Queued event | `{agent, automate_run: {kind: "review_pr", repo, pr, checkout, playbook, playbook_version, task, source_session}}`, with no comment or PR text |
| Prompt | exactly `/loomwright:review-pr <url>` (`/loomwright:review-pr https://github.com/o/r/pull/7`), no flag |
| Policy | `REVIEW_PR_RUN_POLICY` (plus the crew member's `never` list) |
| cwd | the crew member's checkout |
| Where the comment's text appears | nowhere: not the prompt, the queued event, the route's answer, the store's `events` or `event_queue`, or any file under the checkout's `.supervisor/` (run files and sidecars) |
| Triage on PR A after its merge (the new walk) | `review_pr`, `owner_kind: owner` (the App authored it, and its item is `done`, so no run parks it), the same prompt, and the comment again reaches nowhere |

**Loomwright 18.1.2 (step 2).** With no `--until-mergeable`, `/review-pr` runs the default diff-only loop: `gh pr view <pr-url> --json headRefName`, check out the branch, a `code-reviewer` over the PR-branch diff, a fix worker for its findings, a push. Its only comment call writes one (`gh pr comment` on `NEEDS_HUMAN`), and nothing reads the PR's comments: `commands/review-pr.md:30-40`, and line 40 states it. The comment is lost.

**The `--until-mergeable` drain (step 3).** The drain does request the channel the comment is on (`gh api --method GET repos/<owner>/<repo>/issues/31/comments?per_page=100`). On a PR with no bot review, its next instruction was still `{"do":"spawn","step":"fallback","what":"fallback review"}`, the earned `no_review_lens_posted` fallback (a `code-reviewer` over the diff). It printed no `validate findings` spawn, so the owner's comment did not become a finding. The command file describes the drain as one that "validate-then-fixes bot findings" (`commands/review-pr.md:18`). A human owner's `fix:` comment is read but not acted on in this probe.

## Proposed D45 amendment (for the owner to decide)

The comment is lost, so the triage fix as D45 words it cannot do what the walk's triage step (step 3 since item 25f's reorder) asks. Two options:

1. **`--until-mergeable`** (`/loomwright:review-pr <url> --until-mergeable`). This alone is **not enough**, going by step 3: the drain reads the comment channel but did not turn the owner's comment into a finding. It also changes what the session does (a full drain: required checks, all channels, its own round bound), and it would be a second drain beside a parked `/automate` item, which Loomwright's single-drain rule exists to prevent.
2. **The kernel passes the comment.** The triage session already reads the comment and decides "fix". The kernel could carry that one comment's text, wrapped as untrusted data (an `EXTERNAL_TEXT`-style envelope, invariant 3) and only when the owner's identity authored it, into the fix session's prompt after `/loomwright:review-pr <url>`. This is the smallest change that makes the fix see what it is fixing. Loomwright's default loop has no input for it, though, so the fix worker would act on it only if the prompt says to. A probe of that shape is the next step if the owner picks this option.

Until the owner decides, the walk's triage step expects the fix route and the kernel-started session (what the harness and the store can show), not a `ping` → `pong` rename. The runbook says so ([step 3](phase-8-exit-runbook.md#the-walk)).

**What followed (item 26a, 2026-11-23).** The owner chose option 2. Item 26a probed that prompt shape live first: a session given `/loomwright:review-pr <url>`, the kernel's instruction line and the owner's comment wrapped as data committed the rename on the PR's branch, with no run-policy change, and the rail held its push for approval. The change came from a subagent of the session's main thread, not Loomwright's fix worker ([`phase-8-26a-comment-probe.md`](phase-8-26a-comment-probe.md)). The kernel now carries the owner's one triaged comment into the fix's prompt, proposed as [D49](../DECISIONS.md) for the owner to approve in the 26a PR, and the runbook's step 3 expects the rename. The record above is unchanged.

## Honest limits

- No real `/review-pr` session ran (no model, no SDK). Step 2 is the installed command's text, which the session follows.
- Step 3 ran one drain call on stubbed reads, with no bot review on the PR. A PR with bot findings goes through `validate findings`, which was not exercised, and how the drain treats a human comment beside bot findings was not probed.
- The kernel half uses the real route, loop and launch code over a fake GitHub client and a recording session manager, not a live service.
