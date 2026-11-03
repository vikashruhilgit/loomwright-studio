# Repo policy

Part of [Phase 8 features](../ARCHITECTURE.md#phase-8-features). **A stub.** Phase 8 item 01 (the foundation) ships the seam and this page; item 08 fills the seam and replaces the "will" sentences below with what it built. Nothing on this page runs yet. The decision is [D40](../DECISIONS.md).

## What exists today

- **The part.** The integrations feature has an empty `repo-policy` part (`kernel/src/integrations/index.ts`), placed before the `github-app-routes` part, which stays last. It contributes no tool, route, subcommand, handler or due work.
- **The table.** Migration 20 creates `repo_policies`: repo, policy kind, required reviews, trust_unprotected, detected JSON, set by and set at (see the [data model](../ARCHITECTURE.md#data-model)). Nothing writes to it yet. The policy kinds are closed in code, not by SQL.
- **The contract.** `app/src/api/contract.ts` declares `RepoPolicyKind` (`solo` / `studio_approval` / `reviews`), `RepoPolicy`, `RepoPoliciesResponse` and `RepoPolicySetBody`, and lists three routes with origin `p8-item-08`: `GET /repos/policy`, `POST /repos/policy/:owner/:repo/detect` and `POST /repos/policy/:owner/:repo`. None is served yet, and `kernel/test/console-contract.test.ts` pins them as not served.

## What item 08 and the merge items will fill

Each bullet is an owner decision from the phase 8 session of 2026-11-02, recorded in D40, not a description of built code.

- **A policy per repo, set by the user.** Solo (merges when CI and Loomwright's review pass, with no human approval), Approve in Studio (an approval card), or N GitHub reviews (enforced by branch protection; Wright suggests 2 for a team repo). The kernel ships the mechanism and no number (invariant 1).
- **A playbook may only be stricter.** It can ask for more than its repo's policy, never less.
- **No policy, no merge.** A repo with no policy never merges: its PRs park until the owner sets one.
- **Detect and propose.** When a repo is first used, Studio reads its real state (branch protection's required reviews and checks, who can push) and proposes a policy card the owner accepts or changes in one click. Studio never changes GitHub's branch protection itself; where protection is missing, the card shows what to set and a link.
- **Where GitHub cannot enforce protection** (a private repo on GitHub Free), the card says so and offers making the repo public or upgrading, "Trust this repo unprotected", or safe mode. Trusting is an explicit per-repo click, recorded, and passed to Loomwright as `--trust-unprotected`, which waives its condition 4 only and never the high-risk park. None is ever picked silently.
- **The merge flow.** `/automate` runs in safe mode and parks a ready PR `awaiting_merge` ([automate](automate.md)). An opt-in "merge when ready" playbook, which the owner creates, checks the repo's policy and then has Loomwright merge that one item through its own `--auto-merge` gate (all seven conditions still run), and `/automate` does the rest itself.

## What stays fixed

The kernel never merges (invariant 4). `gh pr merge` stays `merge_blocked` in every session, and the only merge is Loomwright's single sanctioned `--auto-merge` gate. Whether Loomwright can merge one parked item through that gate is unverified: probe p14 ([OPEN_QUESTIONS](../OPEN_QUESTIONS.md#technical-verify-dont-assume)). A "no" blocks the merge items until a Loomwright change lands in that repo.
