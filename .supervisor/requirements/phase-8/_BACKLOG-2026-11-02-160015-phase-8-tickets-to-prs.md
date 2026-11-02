# Phase 8: acceptance test 2, tickets → PRs → merge by repo policy, through Loomwright /automate. Plan doc (an index, not an implementable item)

## Status: ready (index document — nothing to implement)

## Why now
Phases 0–7 are done; phase 7 closed 2026-11-02 (PR #215, `docs/evidence/phase-7-exit-live-2026-11-02.json`). ROADMAP phase 8: "Acceptance test 2: tickets → PRs → 2 approvals, run through Loomwright `/automate`". Done when: "A PR is tracked through its states; comments are triaged (fix / reply / answer); reviewers are re-requested; merge only through the gated path". Item 01 rewords the last clause per the owner: "merges once the repo's approval policy is met, only through the gated path".

What doesn't exist yet (checked 2026-11-02, `main` `a0db691`, Loomwright 17.26.0):
- **Write access:** the GitHub App is read-only (D36); `live` playbooks are refused (`live_mode_not_in_phase_6`); sessions get no GitHub token, and a `github`-granted agent may not run `gh`.
- **Tickets and comments:** a poll lists only `github.pulls`; `CONNECTOR_KINDS` is `["github"]`; nothing connects Jira or ClickUp.
- **Merging:** there is no repo merge policy, and nothing starts `/automate` or reads its run state.
- **Loomwright's limits:** it neither triages human comments nor re-requests reviewers, and its `--auto-merge` gate needs enforceable branch protection (or `--trust-unprotected`).
- **The live repo:** `vikashruhilgit/studio-sandbox` is private, empty, has no CI, and GitHub refuses it branch protection on Free (403).

## Owner decisions

Recorded 2026-11-02 in the phase 8 product-owner session (eight rounds of AskUserQuestion). The binding block is copied verbatim into every item. In brief:
- **Trackers.** GitHub Issues, Jira and ClickUp, each its own optional connector. Jira and ClickUp are hosted MCP servers connected by OAuth 2.1. Jira is the owner's work account: stub only, never live. ClickUp is personal.
- **GitHub access.** The App holds every permission. Sessions get a down-scoped token (PRs, Contents, Issues, Checks), injected only into live sessions whose agent has a write grant. Outward writes still go through the existing gate plus per-playbook Always.
- **Merging.** Each repo has a merge policy (Solo / Approve in Studio / N GitHub reviews); a playbook may only be stricter. Studio detects the repo's state and proposes a policy that the owner accepts in one click. A repo that can't be protected says so and offers trust-unprotected. `/automate` runs in safe mode, and an opt-in "merge when ready" playbook has **Loomwright's gate** merge the item. **Invariant 4 is kept.**
- **Running `/automate`.** It runs in a kernel session with `--inline-phases`, never `--parallel`.
- **Comments.** Triage and re-request are kernel tools plus a playbook Wright authors. Routing knows who owns a PR, and a fix never starts a second drain.
- **Defaults.** Poll and dedupe settings are proposed by Wright and set by the owner.
- **Design.** One phase 8 mockup comes first (D9).
- **Live run.** On studio-sandbox: made public, with a CI-required setup step and the full loop under two policies.

## Checklist
- [ ] .supervisor/requirements/phase-8/2026-11-02-160001-phase-8-foundation-decisions-contract-seams-and-probes.md
- [ ] .supervisor/requirements/phase-8/2026-11-02-160002-the-phase-8-mockup.md
- [ ] .supervisor/requirements/phase-8/2026-11-02-160003-github-app-every-permission-and-down-scoped-session-tokens.md
- [ ] .supervisor/requirements/phase-8/2026-11-02-160004-live-mode-and-github-write-in-sessions.md
- [ ] .supervisor/requirements/phase-8/2026-11-02-160005-github-write-tools-and-the-issue-and-comment-poll-sources.md
- [ ] .supervisor/requirements/phase-8/2026-11-02-160006-mcp-connector-mechanism-with-oauth.md
- [ ] .supervisor/requirements/phase-8/2026-11-02-160008-repo-merge-policy-detect-and-propose.md
- [ ] .supervisor/requirements/phase-8/2026-11-02-160007-jira-and-clickup-connectors-and-ticket-sources.md
- [ ] .supervisor/requirements/phase-8/2026-11-02-160009-automate-runner-tickets-to-prs-and-merge-when-ready.md
- [ ] .supervisor/requirements/phase-8/2026-11-02-160013-playbook-live-mode-and-the-merge-approval-card.md
- [ ] .supervisor/requirements/phase-8/2026-11-02-160010-pr-tracker-and-owner-aware-comment-routing.md
- [ ] .supervisor/requirements/phase-8/2026-11-02-160012-integrations-jira-clickup-connect-app-upgrade-and-repo-policy-card.md
- [ ] .supervisor/requirements/phase-8/2026-11-02-160011-tasks-card-ticket-pr-approvals-ci-and-triage.md
- [ ] .supervisor/requirements/phase-8/2026-11-02-160014-phase-8-exit-check-and-live-run-on-studio-sandbox.md

## Order
| Item | Delivers | Depends on |
|---|---|---|
| 01 | D38–D40, ROADMAP reword, closed-set growth with refusals, poll source-adapter seam, migration 020, `automate` feature + empty parts, app contract `p8-item-NN`, ARCHITECTURE/UI notes, probes p14 (merge one parked item via LW's gate) and p15 (`/automate --inline-phases` in an SDK session) | none |
| 02 | `phase-8.html` mockup + DESIGN.md section (the D9 gate) | none |
| 03 | App with every permission, `needs_permissions` upgrade state, down-scoped `mintSessionToken` | 01 |
| 04 | `live` mode, the `github: write` grant, token injection into live sessions, `gh` allowed there; `merge_blocked` unchanged | 01 |
| 05 | GitHub write tools (reply, comment, issue comment, request reviewers) through the gate; `github.issues` and `github.pr_comments` poll sources | 01 |
| 06 | Generic MCP connector: OAuth 2.1 + PKCE loopback consent, Keychain tokens, per-agent tool grants, non-read-only tools held | 01 |
| 08 | Repo merge policy: detection, proposal, owner routes, `policyMet`, trust-unprotected, playbook-only-stricter | 01 |
| 07 | Jira (stub only) and ClickUp definitions; `jira.issues` and `clickup.tasks` poll sources | 06 |
| 09 | `kernel_automate_run` (tickets → items → `/automate --inline-phases`, safe mode, single drain) and `kernel_automate_merge_item` (policy check, Approve-in-Studio card, LW gate merge) | 04, 08 |
| 13 | App: playbook `mode` live in the policy editor; Approvals merge card | 02, 04 |
| 10 | PR tracker (`pr_tracks`, task links, approvals n/N, CI, owner kind, `merged_by_gate`), `kernel_pr_route`, `kernel_pr_fix`, `GET /tasks` fields | 05, 09 |
| 12 | App: Jira and ClickUp connect, App permission upgrade, repo policy card | 02, 03, 07, 08 |
| 11 | App: Tasks ticket → PR card and history | 02, 10 |
| 14 | Exit: `phase-8-exit.spec.ts`, runbook, live run on studio-sandbox, evidence, ROADMAP ✓ | 11, 12, 13 |

## Run
Checked with `automate-helpers.sh plan-waves .supervisor/requirements/phase-8 --max 7 --explain` on 2026-11-02 (Loomwright 17.26.0). `--lint` passes for all 14 items.

```
wave 1: 01 02
wave 2: 03 04 05 06 08
wave 3: 07 09 13
wave 4: 10 12
wave 5: 11
wave 6: 14
```

Every wait is a dependency; no two items in a wave share a file. Shaped by file:
- **Each kernel item** owns its own sub-files: `integrations/github/*` split between 03 (App setup, token) and 05 (client, write tools); `integrations/mcp/*` between 06 (mechanism) and 07 (definitions); `triggers/sources/<source>.ts` one file per source; `automate/*` between 09 (runner) and 10 (tracker, routing).
- **Each app item** owns one screen folder.
- **`docs/architecture/triggers.md`** belongs to 05 only (07 documents its sources in `mcp-connectors.md`).
- **Hotspots, all owned by item 01:** `app/src/api/contract.ts` with `console-contract.test.ts`, `kernel/src/features/index.ts` with `feature-seams.test.ts`, `kernel/src/integrations/types.ts`, `kernel/src/triggers/poll.ts`, `kernel/src/sessions/policy.ts`, migrations, `app/e2e/fixture-kernel.ts`, and DECISIONS / ROADMAP / ARCHITECTURE / UI. Item 02 alone owns `docs/DESIGN.md`.

`right-size` reads 13 items `ok` and 02 `small` (3 files). 02 stays its own item: its merge is the owner's D9 approval, kept apart from code, as in phases 6 and 7. 14 stays on its own, as the owner's live run (like phase 7's items 10, 19 and 28).

**Item 01's probe p14 can block the merge flow.** If Loomwright has no supported way to merge one parked item through its gate, 01 reports it, and 09 and 14 wait on a Loomwright change (that repo). The rest proceeds.

Runs (safe mode throughout; no `--auto-merge` on this repo's own runs):
1. `/automate --backlog .supervisor/requirements/phase-8/_BACKLOG-2026-11-02-160015-phase-8-tickets-to-prs.md --parallel 2 --cheap --limit 2`: wave 1 (01, 02). 02's merge is the D9 approval. Read p14 and p15's answers in OPEN_QUESTIONS before going on.
2. The same command with `--parallel 5 --cheap --limit 11`: waves 2–5 (03–13). Done items are skipped. The app items 11–13 carry polish-gate screenshots the owner reviews. Narrow `--parallel` if the review load is too high.
3. Item 14 with the live run (D33/D35): the same command with `--cheap` once 01–13 are merged, or walked interactively as phase 7's item 28 was.

Rules for every run:
- Branch mode is on (`loomwright-meta`): push these items with `meta-sync.sh push --paths-from` before a lane reads them.
- A lane that needs a file outside its Touches, or a new npm dependency (for example an MCP client SDK in item 06), stops and says so.
- New findings join this plan doc as new items.

**Companions rule proposed with this plan** (`.agent/companions.json`, in a separate PR from a worktree branch; not written here):
- `kernel/src/automate/index.ts` → `kernel/test/phase-8-foundation.test.ts`.

## Considered and not queued
- **Jira and ClickUp via REST and a pasted API token:** not chosen (hosted MCP with OAuth). ClickUp's official MCP takes no API key.
- **Ticket write-back** (moving ticket status, commenting the PR link on Jira or ClickUp): not chosen in phase 8.
- **A Studio-side approvals count** ("Studio counts"): not chosen. GitHub's `reviewDecision` and the repo policy decide.
- **A kernel merge tool:** rejected. It would supersede invariant 4; the owner chose "Playbook triggers LW's gate".
- **A merge audit with alert and auto-pause:** not chosen. The owner redirected to the playbook-triggers-gate flow. `merged_by_gate` is recorded and shown only (item 10).
- **`--parallel` lanes from Studio:** not chosen, because lanes spawn `claude -p` outside the kernel.
- **A kernel-supervised `claude -p` child, or the owner running `/automate` with Studio only watching:** not chosen.
- **Pushing fixes to other people's PRs:** not chosen. They get reply or answer only.
- **A Studio builder agent pushing fixes directly:** not chosen, because it could race `/automate`'s drain.
- **"Apply on GitHub" for branch protection** (Administration: write): not chosen. Studio links to GitHub instead.
- **Live Jira:** not chosen (the owner's work account). Stub only.

## Revisit when
- **p14 answers no:** propose the Loomwright change (single-item gate merge) in that repo, then resume 09 and 14.
- **The owner has a personal Jira site:** its live check moves from `not_exercised`.
- **Phase 9:** Slack, Calendar and Mail on the MCP connector mechanism (item 06); Hooks.
- **Commercial readiness:** a shared public GitHub App and its permissions; the "every permission" choice is reviewed.
- **ClickUp's MCP server leaves beta, or Atlassian changes its endpoint again:** re-check item 07's definitions.
