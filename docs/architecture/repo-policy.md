# Repo policy

Part of [Phase 8 features](../ARCHITECTURE.md#phase-8-features). Phase 8 item 08 built it: each repo carries a merge policy (Solo, Approve in Studio, or N GitHub reviews) that the kernel detects from GitHub's real state and proposes, the owner sets through owner-only routes, and `policyMet` checks for one pull request at one head SHA. The decision is [D40](../DECISIONS.md). Nothing here merges anything (invariant 4): items 09 and 10 call `policyMet` to decide whether to ask Loomwright's own `--auto-merge` gate.

## What is built

- **The part.** The integrations feature's `repo-policy` part (`kernel/src/integrations/github/repo-policy-routes.ts`, placed before the `github-app-routes` part, which stays last) contributes the three owner routes below. It contributes **no agent tool** (`tools` is frozen empty), no subcommand, handler or due work, so no session can set or change a policy (invariant 3). The logic is `kernel/src/integrations/github/repo-policy.ts`.
- **The table.** Migration 20's `repo_policies` holds one row per repo: policy kind, required reviews, `trust_unprotected`, `detected_json`, `set_by` and `set_at` (see the [data model](../ARCHITECTURE.md#data-model)). `policy_kind` is NOT NULL, and detection needs a row to live on while the owner has set nothing, so a detected repo with no policy holds the kind `unset`. `unset` is closed in code beside the three kinds (`REPO_POLICY_ROW_KINDS`) and always reads as `kind: null` and `no_policy`, exactly like no row. Migration 20 is not edited (migrations are append-only).
- **The GitHub reads.** Four GETs on a separate interface, `GitHubRepoPolicyReads` (`kernel/src/integrations/types.ts`), so `GitHubClient` is unchanged. `createGitHubClient` implements both, and the test fake does too. Every read answers a typed failure and never throws.

  | Read | GitHub request | Answer |
  |---|---|---|
  | `getRepoInfo` | `GET /repos/{r}` | `default_branch`, `private` |
  | `getBranchProtection` | `GET /repos/{r}/branches/{b}/protection` | required approving reviews (null with no review rule) and required check names; a 403 or 404 arrives as `http_error` with its status |
  | `listPushCollaborators` | `GET /repos/{r}/collaborators?permission=push` (paged) | logins |
  | `getPullMergeState` | the pull, its reviews, the head's combined status and check runs | `head_sha`, `approvals`, `changes_requested`, `ci` |

  `approvals` counts distinct reviewers whose latest deciding review (approved, changes requested or dismissed; a comment or a pending review does not undo an approval) is an approval made on the **current head SHA**, so a stale approval never counts. `changes_requested` is set by any reviewer whose latest deciding review requests changes, on any commit. `ci` is `green` (every check run finished `success`, `neutral` or `skipped`, and the combined status is `success` or there are no statuses), `pending`, `failing`, or `none` (no check runs and no statuses at all).

## Detect

`POST /repos/policy/:owner/:repo/detect` reads the repo's default branch, its protection and its push collaborators now, and records `detected_json`:

| Field | Meaning |
|---|---|
| `protection` | `protected`, `unprotected` (GitHub answered 404), `protection_unavailable` (403 on a private repo: a private repo on GitHub Free cannot be protected, studio-sandbox's case; a 403 on a public repo is a token without administration:read and records `unreadable`, so no proposal) or `unreadable` (anything else, including a repo that cannot be read) |
| `required_reviews`, `required_checks` | from the protection; empty when it was not read |
| `pushers` | the push collaborators' logins, `null` when GitHub would not say |
| `default_branch`, `private`, `read_at` | from the repo read |

Detection writes only `detected_json`: a row that has a policy keeps its kind, required reviews, `trust_unprotected`, `set_by` and `set_at` untouched. Detection never picks a policy. A 404 can also mean the token may not read protection at all, so `unprotected` is what GitHub said, not a guarantee; it only changes a suggestion, never a policy.

## Propose

`proposeRepoPolicy(detection)` is pure and returns `{kind, required_reviews}` (plus `choices` where noted), or `null` when nothing applies. The first rule that fits wins:

1. `protection_unavailable`: `{kind: null, required_reviews: null, choices: ["make_public_or_upgrade", "trust_unprotected", "safe_mode"]}`. None is picked.
2. Protection requires N approving reviews, N at least 1: `reviews` with that N. The number comes from GitHub; the kernel ships none (invariant 1).
3. Protection requires status checks, and the only push collaborator is the repo's owner (the `<owner>` of `<owner>/<repo>`, compared case-insensitively): `solo`. An organisation's repo has no user named like its owner, so it never proposes `solo`; a misfit only changes a suggestion.
4. Unprotected, and someone other than the owner can push: `studio_approval`.
5. Anything else (unreadable, unprotected and solo, protected with no checks and no reviews): `null`.

The kernel never applies a proposal. The owner accepts it, changes it or ignores it; "proposed by Wright" in the app is a label for a value taken straight from the proposal. The app shows `proposal` beside the set policy.

## Set (owner only)

`POST /repos/policy/:owner/:repo` takes `{kind, required?, trust_unprotected?}`:

- `kind` is one of `solo`, `studio_approval`, `reviews`.
- `reviews` needs `required` as a whole number of at least 1; the other kinds refuse `required`.
- `trust_unprotected` is an optional boolean; omitted, it leaves the recorded choice as it was.
- Any other key, or a body that is not an object, is 400 `invalid_body` and changes nothing. A path segment that is not a GitHub name is 400 `invalid_repo`.

It writes `set_by = 'owner'` and `set_at` = now, which is the record of who trusted a repo and when. `GET /repos/policy` answers `{repos}`: the union of the GitHub connector's reachable repos and every stored row, each with its set policy, `detected` and `proposal`. It reads the store only and makes no GitHub call, so a repo is detected when the owner (or the app on the owner's behalf) calls `detect` for it.

## Is the policy met

`policyMet(repo, pr, head_sha, deps, playbookRequirement?)` answers `{met: true}` or `{met: false, reason}`. It re-reads GitHub on every call (no cache) and never throws.

| Policy | Met when |
|---|---|
| none (no row, or `unset`) | never: `no_policy`, and GitHub is not called. A repo with no policy never merges; its PRs park until the owner sets one |
| `solo` | CI is `green` (otherwise `ci_not_green`) |
| `studio_approval` | an `approvals` row with `action = 'kernel_merge_approval_request'` (`MERGE_APPROVAL_ACTION`, which item 09 files), `status = 'approved'` and a payload whose `repo`, `pr` and `head_sha` match (otherwise `awaiting_owner_approval`) |
| `reviews` | approvals at the head are at least the repo's N and nothing requests changes (otherwise `changes_requested` or `reviews_short`) |

The other reasons: `head_moved` (GitHub's head is not `head_sha`, checked before anything else), and `unreadable` (GitHub could not be read, the stored policy cannot be read as a policy, or the playbook requirement is not valid). `reviews` and `solo` do not look at each other's conditions: Loomwright's gate re-checks CI, `reviewDecision` and every other condition before any merge.

**A playbook may only be stricter.** `playbookRequirement` is the playbook's `merge_requirement` and adds to the repo's policy, never subtracts: `studio_approval` adds the approval check, and `reviews:N` raises the approvals needed to max(N, the repo's N).

`loomwrightMergeFlags(store, repo)` answers `["--trust-unprotected"]` when the owner recorded `trust_unprotected` for the repo, else `[]`. Item 09 passes it to Loomwright, which waives its protection condition only, never the high-risk park. Trusting is an explicit per-repo choice, never picked silently.

## The playbook's merge requirement

`merge_requirement` is a playbook policy field after `mode`: `none`, `studio_approval` or `reviews:<N>` (N of 1 or more), with no default (null until set), owner-locked like the other fields, and not clearable once set. Wright may propose it in a draft; the owner sets it. A playbook is looser than its repo when its requirement is `reviews:N` and the repo's policy is `reviews` with more than N. Its repos are the `repos` of its linked poll trigger. The enable is refused `playbook_looser_than_repo`, both before anything is held for the owner and, if the repo's policy was raised after the enable was held, when the owner approves it (`apply_refused`). See [playbooks](playbooks.md) and [approvals](approvals.md).

## Honest limits

- **Fake-tested only.** The four reads and their request shapes are tested against a fake `fetch` and `FakeGitHubClient`; no live GitHub call has verified the response shapes (the shape follows GitHub's documented REST API).
- **Approvals are REST-derived.** `reviewDecision` is GraphQL, which the client does not send, so approvals are counted from the reviews at the head SHA. That is conservative (a stale approval never counts) and Loomwright's gate still re-checks `reviewDecision`, which is `null` on an unprotected branch, so the count itself must not be gameable: only an approval whose `author_association` is OWNER, MEMBER or COLLABORATOR counts (anyone can post an approval on a public repo, but GitHub counts only write-access reviewers); a missing or unknown association does not count. A `CHANGES_REQUESTED` from any reviewer still sets `changes_requested`: an outsider can hold a merge, never release one. Limit: `COLLABORATOR` includes read-only collaborators, which the reviews API does not distinguish from write access.
- **A 403 is ambiguous.** `protection_unavailable` needs the repo to read as private; a private repo read with a token lacking administration:read also answers 403 and still reads `protection_unavailable`.
- **Safe mode has no storage.** It is offered as a `choice` only, and choosing it stores nothing: the repo stays `unset` and its PRs park. [DESIGN.md](../DESIGN.md) records the open point.
- **Team number.** The kernel ships no number for a team repo; N comes from GitHub's protection, or Wright proposes one in a draft for the owner to change.
- **Names are matched as written.** GitHub treats `Owner/Repo` case-insensitively; the kernel does not fold case, so a policy is found only under the name it was set with (a miss reads as `no_policy`, which fails closed).
- **Credentials.** The default client uses the stored GitHub credential (the PAT, else the App's installation token). Reading protection and collaborators may need more access than reading pull requests; where GitHub refuses, detection records `unprotected`, `protection_unavailable` or `unreadable` as above.

## What stays fixed

The kernel never merges (invariant 4). `gh pr merge` stays `merge_blocked` in every session, and the only merge is Loomwright's single sanctioned `--auto-merge` gate. Probe p14 answered yes on Loomwright 17.34.2 (2026-11-08), with no manual step: `/loomwright:automate --merge-parked <run_id>` merges one parked item through that gate ([OPEN_QUESTIONS](../OPEN_QUESTIONS.md#technical-verify-dont-assume)). It ran on a repo with `ci` required and no required reviews, the Solo shape, so the gate read an empty review decision as "no review required" (fixed in 17.34.1) and exercised condition 4. `--trust-unprotected` on a private repo was not run.
