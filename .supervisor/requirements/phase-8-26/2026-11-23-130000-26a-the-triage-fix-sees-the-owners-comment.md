# 26a — The triage fix sees the owner's comment

**As the** owner,
**I want** the kernel-started `/loomwright:review-pr` fix to receive the one `fix:` comment I wrote,
**so that** a comment like `fix: rename ping to pong` produces that change on the PR, instead of a review session that never sees it.

## Why
Item 25f Part B (25e), probed 2026-11-21 on Loomwright 18.1.2 ([evidence](../../../docs/evidence/phase-8-25e-triage-fix-probe.md)): `kernel_pr_route` answers `automate_fix` / `review_pr` and the kernel starts `/loomwright:review-pr <url>`. That prompt carries no comment, and the command's default loop reads none (`comment reached: no`, on both routes). Walk step 3 can therefore show only the route and the session, never the rename. The probe weighed two options. `--until-mergeable` read the comment channel but did not turn the owner's comment into a finding, and it would add a second drain beside a parked `/automate` item. The other option was the kernel passing the comment.

## Owner decisions
- 2026-11-23: "Kernel passes comment" (25e option 2): the kernel carries the one owner-authored comment, wrapped as untrusted data, into the fix session's prompt (owner, Claude Code session, after the 25e evidence).
- 2026-11-23: D45 is amended through the PR that builds Part B, as D45 itself was: the owner approves the new D-row text in that PR before merge. Part A records no decision.

## Part A — probe first (a stop gate)
Loomwright's `/review-pr` has no input for a comment. The fix acts on it only if the prompt's text leads the session there. Before any kernel change, find out whether it does.

- [ ] Given a PR on `vikashruhilgit/studio-sandbox` whose branch has `ping.js`, and an owner comment `fix: rename ping to pong` on it, when a session is started with the exact prompt Part B would build (`/loomwright:review-pr <url>`, then the kernel's fixed instruction line, then the comment inside the kernel's `wrapUntrusted` block), then record whether the session commits the rename to the PR's branch. Also record which Loomwright step made the change (fix worker, drain, or the main thread), and which tool calls the `review_pr` run policy would deny.
- [ ] The probe runs under `REVIEW_PR_RUN_POLICY` as the kernel would launch it (through the session manager, or an SDK session given that policy), on the owner's personal sandbox repo only, and never against a `vendsy/*` repository.
- [ ] The result goes into `docs/evidence/phase-8-26a-comment-probe.md`: date, Loomwright version, prompt as sent, outcome, and each denial.
- [ ] **Stop gate:** if the rename is not committed, Part B is not built. The evidence names what blocked it, and the item parks for the owner. No widening of the run policy is made to get past a denial; a denial is a finding.

## Part B — build (only after Part A commits the rename)
- [ ] Given `kernel_pr_route` called with `repo`, `pr` and a new optional `comment` (`{ kind: "issue_comment" | "review_comment" | "review", id: number }`), when it answers `automate_fix` or `review_pr` and queues the fix, then the kernel reads that comment fresh from GitHub (never the model's copy or paraphrase). The comment must be on that PR and of that kind; otherwise nothing extra is carried, and the answer says why (`comment_not_found`).
- [ ] Given that comment, when its author is not the owner's own GitHub identity (`identityOf`), then nothing is carried (`comment_not_owner`). The App's and anyone else's comments never reach the prompt.
- [ ] Given an owner comment, when the kernel queues the run, then the payload holds the comment's kind, id and url, never its body. At launch the kernel re-reads the comment, re-checks the author, and builds the prompt: `/loomwright:review-pr <url>`, the kernel's fixed instruction line, then the body inside `wrapUntrusted("github pr comment <url>", body)`, bounded (a body over the bound is cut with a marker, and the cut is recorded on the launch).
- [ ] Given a comment that was edited or deleted between the route and the launch, when the launch re-reads it, then the launch uses what it reads now. A deleted comment launches the plain prompt and records `comment_gone`.
- [ ] Given no `comment` argument, when the fix is queued, then the prompt stays exactly `/loomwright:review-pr <url>`. A `merge_parked`, `backlog` or `resume` prompt never changes.
- [ ] The tool's description tells the triage session to pass the comment it triaged as `fix`, and that its text is data.
- [ ] The run policy is unchanged: no new tool, script or prefix.
- [ ] `docs/DECISIONS.md` gets the D45 amendment as a new D-row (text approved by the owner in the PR), and `docs/architecture/automate.md` §"the kernel-launched run" describes the new prompt shape.
- [ ] The runbook's walk step 3 expects the rename commit on PR A's fix branch and no longer says "not a `ping` → `pong` rename". [the 25e evidence](../../../docs/evidence/phase-8-25e-triage-fix-probe.md) links to 26a's result.

## Non-goals
- `--until-mergeable` for the fix (ruled out by 25e).
- A re-drain path for a parked PR after a fix (`head_sha_moved` stays Loomwright's; the runbook's 25f follow-up).
- More than one comment per fix, or comments from anyone but the owner.
- Changing what the triage session decides (fix / reply / answer stays its call).

## Priority: MVP
Blocks walk step 3's fix (the phase 8 exit walk).

### Assumptions
- Defect evidence: observed. 25e probed the real routes with the real `EventLoop` (`comment reached: no`) and ran the 18.1.2 drain with a stub `gh`. See `docs/evidence/phase-8-25e-triage-fix-probe.md`.
- `GitHubClient.listPullComments` returns issue comments, review comments and reviews with `id`, `author`, `body` and `url` (`kernel/src/integrations/types.ts` `GitHubPrComment`). A single-comment read may need a new client method.
- The owner's GitHub identity is what `identityOf(ctx.store)` returns, the same one `ownerOf` uses for `owner_kind`.

### Risks
- Part A may show the session ignores the wrapped comment, or acts on it outside the fix worker. The stop gate handles that.
- Prompt injection: the comment is the owner's, but its text still passes through a model. The instruction line is the kernel's, the body is wrapped and defused (`wrapUntrusted`), and the run policy is unchanged, so a comment can ask for nothing the policy would not already allow.

## Validation (must pass before merge)
1. **Running system, Part A:** the evidence file shows the probe's outcome with the session id and events.
2. **Static, kernel suite:** `cd kernel && npm test`. Tests cover the author check, the fresh re-read at launch, an edit and a deletion between route and launch, the bound, the unchanged prompt without a comment, and the payload carrying no body.
3. **Static, conformance:** `npx vitest run test/loomwright-conformance.test.ts` stays green; `bash scripts/check-docs.sh` passes.
4. **Running system, next live walk:** step 3's fix session commits the rename on PR A's fix branch.

## Depends on
none

## Touches
kernel/src/automate/routing.ts
kernel/src/automate/launch.ts
kernel/src/integrations/github/client.ts
kernel/src/integrations/types.ts
kernel/test/automate-routing.test.ts
kernel/test/automate-launch.test.ts
docs/evidence/phase-8-26a-comment-probe.md
docs/evidence/phase-8-exit-runbook.md
docs/evidence/phase-8-25e-triage-fix-probe.md
docs/architecture/automate.md
docs/DECISIONS.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-24T06:07:43Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/311 (merge d790c93c)
- **Stamped by:** the owner (2026-11-24), by hand: the run's driver never recorded #311
