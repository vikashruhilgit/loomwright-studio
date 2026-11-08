# Automate

Part of [Phase 8 features](../ARCHITECTURE.md#phase-8-features). **A stub.** Phase 8 item 01 (the foundation) ships the seam and this page; the later items fill the seam and replace the "will" sentences below with what they built. Nothing on this page runs yet.

## What exists today

- **The feature.** `kernel/src/automate/index.ts` exports `automateContribution`, registered after `gui` as the eleventh and last contribution. Its three parts, `runner`, `tracker` and `routing`, are empty: no tool, route, subcommand, handler or due work.
- **The table.** Migration 20 creates `pr_tracks` (see the [data model](../ARCHITECTURE.md#data-model)). Nothing writes to it yet.
- **The contract.** `app/src/api/contract.ts` declares the `PrTrack` and `PrOwnerKind` types (`automate_live` / `automate_parked` / `owner` / `other`). No route uses them yet.

Like every feature module, nothing it loads may import the Agent SDK, the session manager or `kernel.ts` as a value, because the `studio` CLI loads it.

## What the later items will fill

Each bullet is an owner decision from the phase 8 session of 2026-11-02, not a description of built code.

- **The runner.** A playbook run starts one kernel-owned SDK session with Loomwright loaded in host mode, running `/automate … --inline-phases` (D40), so Stop and Kill, the budget, the cap and the approval gate all apply (invariant 2). No `--parallel`: its lanes spawn `claude -p` outside the kernel. The runner runs `/automate` in safe mode, which parks a ready PR `awaiting_merge`. It reads Loomwright's run files for state and never works around `/automate`'s single-drain ownership (invariant 4). Probe p15 showed `--inline-phases` reaching a PR in an SDK session started with kernel-like options (2026-11-05). The `AskUserQuestion` path was not exercised, so that part stays unverified ([OPEN_QUESTIONS](../OPEN_QUESTIONS.md#technical-verify-dont-assume)).
- **The tracker.** The `pr_tracks` rows follow a PR through its states: head sha, approvals against what the repo requires ([repo policy](repo-policy.md)), CI, the ticket it came from and its run file.
- **Owner-aware routing.** The kernel tells a playbook who owns a PR, and a fix never starts a second drain:
  - a live `/automate` run: leave it to that run's drain;
  - a parked `/automate` item: its fix-now or `/review-pr <pr>`;
  - not from `/automate`, authored by the owner or the App: `/review-pr <pr>` in a kernel session (it heals and never merges);
  - authored by someone else: reply or answer only, and never push to their branch (a fix is suggested in the reply).
- **Comments and reviewers.** The kernel adds GitHub write tools (reply to a comment or thread, re-request reviewers, comment) and a poll source for new PR comments. Wright authors the triage playbook from a sentence: an agent reads each comment as untrusted data (invariant 3) and classifies it fix, reply or answer. Nothing is preinstalled (D3).
- **Polling and dedupe.** The kernel ships no default (invariant 1). Wright's draft proposes defaults (tickets dedupe on the ticket id, so one PR per ticket; comments on the comment id plus its edit time; a poll every 5 minutes; normal priority) and the owner changes any of them before enabling.
- **The merge.** The kernel never merges. A merge happens only when the owner's opt-in "merge when ready" playbook has Loomwright merge one parked item through its own `--auto-merge` gate ([repo policy](repo-policy.md), D40). The invocation is `/loomwright:automate --merge-parked <run_id>` (Loomwright 17.34.2 or later): probe p14 merged a parked item with it on 2026-11-08 with no manual step, after a no on 17.31.0. It merges only through `gate-eval`, closes the item out and stops, without starting a drain or the next item. On a branch with no required reviews, 17.34.0 parks `review_decision_unreadable` (fixed in 17.34.1), and 17.34.1 parks `rules_gate_dirty_tree` on a `.gitignore` line Loomwright itself writes (fixed in 17.34.2) ([OPEN_QUESTIONS](../OPEN_QUESTIONS.md#technical-verify-dont-assume)).
