# Phase 8 item 09 evidence: `getPages` truncation and `getPullMergeState`

**Question (Scope 8):** `getPages` stops at `maxPages` (default `GITHUB_DEFAULT_MAX_PAGES` = 10, 100 items a page) and returns what it has read as a success. Can `getPullMergeState` keep that, or must it fail closed?

**Decision: fail closed for `getPullMergeState`; every other `getPages` caller keeps its behaviour.**

## The code checked

Base `b2ac1e4`, `kernel/src/integrations/github/client.ts`:

- `getPages` loops `for (let page = 1; page <= maxPages; page++)` and breaks on a short page (`pageItems.length < PER_PAGE`). When the loop ends at the cap with the last page still full, the rest of the listing is not read, and the answer is `{ ok: true, data: items }`, indistinguishable from a complete listing.
- `getPullMergeState` makes two paged reads with it: the pull's **reviews** and the head's **check runs**. Its answer (`approvals`, `changes_requested`, `ci`) feeds `policyMet`, which gates a merge (`reviews` and `solo` repos, and `reviews:N` playbooks).
- The other `getPages` callers are listings shown to or chosen by the owner: `listReachableRepos`, `listOpenPulls`, `listPullFiles`, `listPullComments`, `listIssues`, `listOpenPullComments`, and `listPushCollaborators` (detection's display hint `pushers`).

## The reason

GitHub lists reviews oldest first, and `getPullMergeState` keeps each reviewer's **latest** deciding review. A pull request with more than `maxPages * 100` reviews (a long-running PR, or one an outsider floods with `COMMENTED` reviews) would have its newest reviews cut off. Then:

- a later `CHANGES_REQUESTED` is never seen, so `changes_requested` reads `false` where GitHub would block: the merge check answers met when it should not (fails open);
- a later dismissal or approval is never seen either, so `approvals` is wrong in both directions.

The same holds for check runs: a failing run beyond the cap reads as `green`.

Both are the unsafe direction for a gate. The cost of failing closed is only that a PR with 1000+ reviews or check runs is answered `unreadable` (`policyMet`: `met: false`, the owner decides by hand). That is rare and safe, so the read refuses instead of guessing.

A short list is acceptable for the display listings (a repo picker or a diff view that shows the first 1000 entries decides nothing), so they keep the cap's old behaviour. `listPushCollaborators` also keeps it: `pushers` only informs the `solo` suggestion in detection, and the owner confirms the policy; a policy is never derived from it alone at merge time.

## The change

`getPages` takes an optional `failClosed` flag. When set and the loop used all `maxPages` pages with the last one full, it answers `unreachable()` (the same failure as any unreadable page). `getPullMergeState` passes it for the reviews and for the check runs. A full last page counts as truncated even when it is exactly the end of the listing: the next page is not read to find out, so a listing of exactly `maxPages * 100` items is also refused (fail closed, one extra page would cost a request per read).

## The pins

`kernel/test/integrations-github-client.test.ts`, `getPullMergeState fails closed when reviews or check runs reach the page cap`:

- reviews at `maxPages: 2` with a full last page: `unreachable`; a short page at the cap, or a full page below it: read;
- check runs at `maxPages: 2` with a full last page: `unreachable`;
- `listPushCollaborators` at the same cap still returns the 200 items it read.

Mutation check: deleting the `if (failClosed && truncated) return unreachable();` line fails the first two tests.
