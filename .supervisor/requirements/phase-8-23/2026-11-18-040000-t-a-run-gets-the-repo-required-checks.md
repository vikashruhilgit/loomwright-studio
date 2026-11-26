# 23t — A kernel run's review drain gets the repo's required checks

## Status: built, merged in PR #292 (2026-11-19); the kernel-written list now follows the detection (23u); live check pending

**Why.** On 2026-11-18, the cheer.sh item reached PR 20 on `vikashruhilgit/studio-sandbox` through the full process:
- Launch Pad, the Supervisor, FINALIZE and Phase 4.5 all ran;
- `/automate` recorded the PR;
- the owned `/review-pr --until-mergeable` drain started.

The drain then ended `ESCALATED required_checks_unavailable`, and the run parked `escalated`. The repo's `main` does require `ci` (branch protection, verified with `gh api`).

The drain runs inside the kernel session. That session's GitHub token is the down-scoped one: D39 gives `pull_requests`, `contents`, `issues` and `checks`, never `administration`. Reading branch protection needs `administration`, so the drain could never read the list, and it fails closed by design.

Studio already knew the list. The repo policy's detection (`repo_policies.detected_json`, read with the App's own token, item 08) records `required_checks: ["ci"]`.

**Built.** Before a run session starts, `loomwright/required-checks.ts` (`handRequiredChecks`) writes the detected list as `required_checks` into the checkout's `.supervisor/config.json`. That's Loomwright's documented input, read only when protection can't be read.
- **Only GitHub's protection as detected:** it writes only for `protection: protected` with a non-empty list of well-formed names, never a kernel default (invariant 1).
- **Never overrides the owner:** a `required_checks` the kernel did not write is left alone, and every other key is kept. Its own earlier list follows the detection (23u).
- **Never dirties the repo:** it writes only when git ignores the file in that checkout (`gitIgnores`, run through `run-state-checkout.ts`, the one file under `src/loomwright/` that runs git). Otherwise it skips with `not_ignored`.
- **Recorded:** each hand-over or skip is a `run_required_checks` event with an audit sentence. Skips for no detection, unprotected, or no checks write nothing.
- **Called from:** `automate/launch.ts`, right before the session starts, after every refusal check.

**Rejected:** giving session tokens `administration: read`. That reverses D39's "never administration" and widens every session's token to fix one read.

**Honest limits.**
- The detection is as fresh as its `read_at` (here 2026-11-12). After changing protection on GitHub, re-detect the repo in Studio.
- Not yet seen live: whether a Resume of the parked `escalated` item re-runs the drain, or whether Loomwright treats it as needing the owner, is Loomwright's resume rule.

**Tests.**
- `kernel/test/required-checks.test.ts` uses real temporary git checkouts.
- `kernel/test/automate-resume.test.ts`, "a run launch hands the repo's detected required checks to the drain".

**Exit check.** A kernel run on a protected repo whose drain previously ended `required_checks_unavailable` reaches READY, or a real check verdict, with no hand edits.
