# Supervisor Job: /automate runner tools — tickets to PRs in the playbook's own session, and "merge when ready" through Loomwright's gate (phase 8 item 09)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-02-150636/L12
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (source requirement is gitignored under `.supervisor/*`, so its provenance is not in git; it is the `/automate` run's queue item)
- **Source requirement:** .supervisor/requirements/phase-8/2026-11-02-160009-automate-runner-tickets-to-prs-and-merge-when-ready.md
- **Base commit:** b2ac1e4ff885e2983648cc7fd307efa6bee24712

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest + zod in `kernel/`; every new tool uses the existing `defineTool` / `ContributedTool` seam (`kernel/src/features/contribution.ts`). No new dependency. |
| 2 | Dependency Availability | GO | Gate met: `docs/OPEN_QUESTIONS.md` records p14 (yes, Loomwright 17.34.2, `/loomwright:automate --merge-parked <run_id>`) and p15 (yes, reached an open PR with `--inline-phases`). Items 04 (live + github write) and 08 (repo policy, `policyMet`, `MERGE_APPROVAL_ACTION`) are merged on `main`. |
| 3 | Architecture Fit | GO | The automate feature's empty `runnerPart` (`kernel/src/automate/index.ts`) is the seam this item fills; held tools go through `ALWAYS_HELD_TOOLS` + `beforeHold`; connector gating through `requiresConnector` / `requiresConnectorLevel: "write"` (`toolsForConnectors`). |
| 4 | Scope vs Supervisor Capability | CAUTION | ~22 files changed across GitHub reads and the automate feature: over the 12-file context bound, so two subtasks (`context-bound`). |
| 5 | Hard Blockers | CAUTION | (a) Two paths outside the requirement's Touches are needed (`docs/architecture/brain.md`, pinned verbatim to `ROLE_TEMPLATE` by `kernel/test/brain.test.ts`; and the evidence file for the `getPages` decision) — recorded under `## Scope widening`. (b) `--merge-parked` inside a kernel-started SDK session in host mode is untested (p14 ran in a terminal session only); this item only builds and tests the kernel tools with fixtures, so it does not block the build. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Fill the automate feature's `runner` part with four kernel tools a live playbook's own session uses to hand tickets to Loomwright's `/automate` and to have Loomwright merge one parked PR through its own gate once the repo's policy is met, and fix the two `policyMet` read bugs item 08 left (deleted-reviewer collapse, nested merge-approval payload), plus decide `getPages` truncation.

**Problem Statement:**
The owner needs a live playbook session to turn tickets into `/automate` requirement items and, for an opt-in "merge when ready" playbook, to learn when Loomwright may merge a parked PR, because the kernel today has no way to write ticket items, read Loomwright's run state, or check a merge against the repo's policy.
Currently `runnerPart` is empty, `policyMet` can read `changes_requested: false` when two deleted accounts reviewed (both keyed `ghost`), and a merge approval filed through the rail (`{tool, input, cwd}`) never satisfies `hasMergeApproval`, which reads only top-level `repo`/`pr`/`head_sha` — so "Allow once" on a Studio-approval repo would silently never merge.
Success looks like: the four tools exist, are listed only to write-granted agents and refuse draft-playbook sessions, `kernel_automate_merge_check` answers `go` only with p14's exact invocation when every condition holds, the kernel calls no merge API, and the two read bugs are pinned by tests.

## Acceptance Criteria
- [ ] AC1 — Given p14 or p15 has no recorded answer in `docs/OPEN_QUESTIONS.md`, then the item stops at Launch Pad and builds nothing. (Gate already checked at Launch Pad: both are recorded as of base `b2ac1e4`; the worker re-confirms both entries are still `Result` lines before building.)
- [ ] AC2 — Given a live playbook session calling `kernel_automate_prepare(repo, tickets[])` with two fake tickets, when it runs, then two requirement items and one `_BACKLOG` exist under the checkout's `.supervisor/requirements/studio/`, each item carries the ticket's title, link and dedupe ref with its body quoted as untrusted data (fenced/quoted, never as instructions), and the answer's invocation is `/automate --backlog <path> --inline-phases` with no `--auto-merge` and no `--parallel`; with no workspace for the repo it is refused `no_workspace`. Pinned in `kernel/test/automate-runner.test.ts`.
- [ ] AC3 — Given a fixture run file showing a live run (`kernel/test/fixtures/loomwright-run-files/`), then `kernel_automate_state` answers `live` with its run id and `kernel_automate_merge_check` answers `wait`; a parked fixture answers `parked` (items with reason and PR) and an empty checkout `idle`. Run files are found by their `# Automate Run:` title, never "the last `.md`" (p15's sidecar trap). Pinned in `kernel/test/automate-runner.test.ts` and `kernel/test/automate-merge-check.test.ts`.
- [ ] AC4 — Given a parked `awaiting_merge` item at the PR's current head on a Solo repo with CI green and no live run, then `kernel_automate_merge_check` answers `go` with p14's invocation `/loomwright:automate --merge-parked <run_id>` (plus `--trust-unprotected` only when `loomwrightMergeFlags` returns it), and no file under `kernel/src/automate/` calls a merge API (a test scans the module sources for `/merge` endpoints and `gh pr merge`). Pinned in `kernel/test/automate-merge-check.test.ts`.
- [ ] AC5 — Given an Approve in Studio repo, then `kernel_merge_approval_request(repo, pr, head_sha, ci, ready_at)` is held (in `ALWAYS_HELD_TOOLS`, never covered by an "always" grant) with the head SHA in its payload and display; the tool's input (so the filed `payload.input`) carries `ci` and `ready_at` under the app's `MERGE_PAYLOAD_KEYS` names (`app/src/screens/approvals/subject.ts`: `ci`, `ready_at`; optionally `policy`), the agent supplies them. `beforeHold` keeps its contract (synchronous, reads the store only, `kernel/src/features/contribution.ts`): it validates the shape and builds the display (repo, PR, head SHA, the claimed CI state and READY time) and never reads the run file. `ci` is shown as the agent's claim; `merge_check` re-reads CI through `policyMet`. The `ready_at` check lives in `merge_check`: when it finds the approved merge approval at the head, it compares `payload.input.ready_at` with the parked item's `ready_at` in the run file and answers `wait` on a mismatch. `hasMergeApproval` still matches on repo / pr / head_sha only. Once approved, `merge_check` answers `go` for that head and `wait` (head moved) after a new push. Pinned in `kernel/test/automate-merge-check.test.ts` and `kernel/test/sessions-policy.test.ts`.
- [ ] AC5b — Given a Solo repo and a calling playbook whose `merge_requirement` (`playbooks.merge_requirement`, migration 21) is `studio_approval`, then `merge_check` passes that requirement to `policyMet` (its `playbookRequirement` argument) and answers `wait` (`awaiting_owner_approval`) until an approved merge approval exists at that head, then `go` — a playbook may only ask for more, never less. The calling playbook is the session's (`ctx.sessions.getSession(ctx.sessionId).playbook`). Pinned in `kernel/test/automate-merge-check.test.ts`.
- [ ] AC5c — Given `merge-check.ts`, then it takes `PolicyMetDeps` with an optional `client?: () => GitHubRepoPolicyReads`. Production wiring (the tool) passes none, so `policyMet` uses its own default `createRepoPolicyClient()` (the stored credential), the same way `detectRepoPolicy` does. It never reads `ContributedToolContext.github`, which is typed `GitHubClient` without the repo-policy reads, and `contribution.ts` is not edited. Every test in `kernel/test/automate-merge-check.test.ts` injects `FakeGitHubClient` (`kernel/test/fixtures/github-fake.ts`, which implements both interfaces), and one test pins that `createRepoPolicyClient` is never reached (it is mocked to throw). A GitHub read failure answers `wait`/`park` with reason `unreadable`, never `go` (`policyMet` already does this).
- [ ] AC6 — Given no repo policy, then `merge_check` answers `park` with reason `no_policy`. Pinned in `kernel/test/automate-merge-check.test.ts`.
- [ ] AC7 — Given a session of a draft playbook, or of an agent without `github: write`, then the four tools are not listed (`requiresConnector: "github"`, `requiresConnectorLevel: "write"`) or are refused by the handler (draft / non-playbook / dry-run session). Pinned in `kernel/test/automate-runner.test.ts`.
- [ ] AC8 — Given two reviews with `user: null` on one PR, the earlier `CHANGES_REQUESTED` and the later `APPROVED`, then `getPullMergeState` answers `changes_requested: true` and `policyMet` answers `met: false`; `loginOf` still reads a deleted author as `ghost` elsewhere (existing pins unchanged). Pinned in `kernel/test/integrations-github-client.test.ts` and `kernel/test/integrations-github-repo-policy.test.ts`.
- [ ] AC9 — Given a merge approval filed through the real `kernel_merge_approval_request` path (the rail's `classifyToolCall` payload, not a hand-built row) and approved, then `policyMet` answers `met: true` for that repo, PR and head on a `studio_approval` repo, and `met: false` after a new push. Pinned in `kernel/test/automate-merge-check.test.ts` (it needs the tool and the held entry).
- [ ] AC10 — Given the `getPages` truncation question (Scope 8), then a committed evidence file `docs/evidence/phase-8-item-09-getpages-truncation.md` records the decision (fail closed for `getPullMergeState`, or why it can stay), the code it checked and the reason, and the PR body links to it; a fail-closed choice has a test in `kernel/test/integrations-github-client.test.ts`.
- [ ] AC11 — Given Scope 9's shape question, then a committed evidence file `docs/evidence/phase-8-item-09-merge-approval-shape.md` records which payload shape the rail files for `mcp__kernel__kernel_merge_approval_request` (quoting `classifyToolCall`'s `payload: { tool: toolName, input: toolInput, cwd: payloadCwd }`) and the reason `hasMergeApproval` reads that shape (and only that shape), and the PR body links to it.
- [ ] AC12 — Given Wright's role template, then `ROLE_TEMPLATE` (`kernel/src/brain/templates.ts`) names the four tools and the two playbook shapes they serve (tickets → `/automate`; merge when ready), nothing is preinstalled, and `docs/architecture/brain.md`'s `role-template` block equals it verbatim (`brain.test.ts` AC9 pin).
- [ ] AC13 — Given the docs, then `docs/architecture/automate.md` describes the runner tools and the merge check as built (replacing the runner/merge "will" bullets), `docs/architecture/approvals.md` describes the merge approval (always held, a record only, stale after a push) and lists it in every `ALWAYS_HELD_TOOLS` enumeration, and `bash scripts/check-docs.sh` passes.
- [ ] AC14 — Validation: `cd kernel && npm ci && npm run typecheck && npm test` and `bash scripts/check-docs.sh` pass.

## Scope widening
- docs/architecture/brain.md
- docs/evidence/phase-8-item-09-getpages-truncation.md
- docs/evidence/phase-8-item-09-merge-approval-shape.md
- accepted: LP-SCOPE 2026-11-08

## Touched-file invariants

> Grounded at base `b2ac1e4ff885e2983648cc7fd307efa6bee24712`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/integrations/github/client.ts`** — keep: `loginOf` itself unchanged for every author reader (`return v === null || v === undefined ? "ghost" : str(record(v)["login"]);`); change only the review keying in `getPullMergeState` (`latest.set(rev.login, rev)`) so each `user: null` review gets its own entry; keep "a change request from anyone still blocks" and "Only a trusted reviewer's approval counts"; keep `getPages`' behaviour for its other callers (`listReachableRepos`, collaborators) unless the evidence file gives the reason; keep "A failed page fails the listing". reuse: `GITHUB_DEFAULT_MAX_PAGES`, `unreachable()`. pinned by: `kernel/test/integrations-github-client.test.ts` (`a deleted author (user null) reads as ghost`, `getPullMergeState: the head, the approvals AT the head`).
- **`kernel/src/integrations/github/repo-policy.ts`** — keep: `export const MERGE_APPROVAL_ACTION = "kernel_merge_approval_request";` (the rail strips `mcp__kernel__` to make the action); `WHERE action = ? AND status = 'approved'`; the `json_valid(payload_json)` guard; `policyMet` "Never throws" and every `notMet` reason. mirror: the rail's payload in `kernel/src/sessions/policy.ts` (`payload: { tool: toolName, input: toolInput, cwd: payloadCwd }`) — read `$.input.repo` / `$.input.pr` / `$.input.head_sha` (and require `$.tool` = `mcp__kernel__kernel_merge_approval_request`), only that shape; the app's reader `kernelFields` in `app/src/screens/approvals/subject.ts` already falls back to `payload.input` (outside Touches: do not edit it; its comment "reads only the payload's top level" goes stale — note it in the PR body as a follow-up). pinned by: `kernel/test/integrations-github-repo-policy.test.ts` (`AC5: studio_approval is met only by an approved kernel_merge_approval_request`, whose hand-built top-level rows must move to the nested shape).
- **`kernel/src/sessions/policy.ts`** — keep: `export const ALWAYS_HELD_TOOLS: readonly string[] = Object.freeze([` order (append `"mcp__kernel__kernel_merge_approval_request"` last); `if (forms[0] === "merge") return { kind: "deny", reason: "merge_blocked" };` untouched; do NOT add the tool to `GITHUB_WRITE_TOOLS` or to `KERNEL_APPLIED_ACTIONS` (the approval is a record only; the agent's repeat after approval just answers recorded). pinned by: `kernel/test/sessions-policy.test.ts` (`expect(ALWAYS_HELD_TOOLS).toEqual([`); `app/src/screens/approvals/kernel-mirror.test.ts` pins `KERNEL_APPLIED_ACTIONS` (must stay three names).
- **`kernel/src/automate/index.ts`** — keep: "never the Agent SDK, the session manager or `kernel.ts`" (pinned by `kernel/test/feature-seams.test.ts`'s module-graph check). The new modules (`runner.ts`, `run-state.ts`, `tickets-to-items.ts`, `merge-check.ts`) follow that rule and may import `../integrations/github/repo-policy.js` (already in the registry's graph through `integrations/index.ts`) plus node `fs`/`path`; update index.ts's header comment ("it imports only types, the feature seam, the console's part merge and its own parts") to say so, and rewrite both stale runner comments (the header's "`runner` runs `/automate` as a kernel-managed session" and the `runnerPart` docstring "runs `/automate` as a kernel-managed session") to the 2026-11-03 decision: the runner's tools help the playbook's own session hand tickets to `/automate` and check a merge, and no tool starts a session; `AUTOMATE_PARTS` order `runner`, `tracker`, `routing`; `tracker` and `routing` stay empty. pinned by: `kernel/test/phase-8-foundation.test.ts` (`all empty`) — change it to expect the runner's four tools and the other two parts empty.
- **`kernel/src/brain/templates.ts`** — keep: `ROLE_TEMPLATE` is shown verbatim in `docs/architecture/brain.md` between `<!-- role-template:start -->` and `<!-- role-template:end -->` (`kernel/test/brain.test.ts`: `shows role.md's first-run template verbatim (doc == templates.ts)`); existing GitHub tool names stay (`kernel_github_pr_get`, … pinned at `brain.test.ts`); no playbook preinstalled (D3).
- **`kernel/test/tools-sdk-list.test.ts`** — keep: `CLOSED_VALUE_SETS` keys equal every shipped kernel tool name (`expect(Object.keys(CLOSED_VALUE_SETS).sort()).toEqual([...kernelToolNames(SHIPPED)].sort());`) — add one entry per new tool.

## Closed enumerations touched

> Sibling grep at base `b2ac1e4`: `grep -rnF 'kernel_agent_update' --exclude=CHANGELOG.md --exclude-dir=node_modules --exclude-dir=.supervisor .` (held-tool sibling) and `grep -rnF 'kernel_github_pr_request_reviewers' …` (newest tool-name sibling) → hits in kernel/src, kernel/test, app/src, docs.

- **`mcp__kernel__kernel_merge_approval_request`** (sibling: `mcp__kernel__kernel_agent_update`) — must be named in:
  - `kernel/src/sessions/policy.ts` — `ALWAYS_HELD_TOOLS` — extend.
  - `kernel/test/sessions-policy.test.ts` — `expect(ALWAYS_HELD_TOOLS).toEqual([` — extend.
  - `docs/architecture/approvals.md` — the three `ALWAYS_HELD_TOOLS` enumerations (the `never` paragraph, the `heldToolCheck` paragraph, the `always`-grant rule 5) — extend.
  - `kernel/src/approvals/store.ts` `KERNEL_APPLIED_ACTIONS` and `app/src/screens/approvals/kernel-mirror.ts` — no change: the merge approval is a record, not a kernel-applied action.
  - `kernel/src/sessions/policy.ts` `GITHUB_WRITE_TOOLS`, `NEVER_CATEGORIES` — no change: it is always held, so no `never` category and no "always" grant.
- **`kernel_automate_prepare`, `kernel_automate_state`, `kernel_automate_merge_check`, `kernel_merge_approval_request`** (sibling: `kernel_github_pr_request_reviewers`) — must be named in:
  - `kernel/test/tools-sdk-list.test.ts` — `CLOSED_VALUE_SETS` — extend.
  - `kernel/test/phase-8-foundation.test.ts` — the runner part's tool list — extend.
  - `kernel/test/integrations-foundation.test.ts` — no change: it lists the integrations feature's tools, not the automate feature's.
  - `docs/ARCHITECTURE.md`, `docs/architecture/github-tools.md` — no change: they describe the integrations tools; the automate tools are documented in `docs/architecture/automate.md`.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/integrations-github-client.test.ts` — two `user: null` reviews, CHANGES_REQUESTED then APPROVED → `changes_requested: true` | restore `latest.set(rev.login, rev)` as the only keying in `kernel/src/integrations/github/client.ts` |
| `kernel/test/integrations-github-repo-policy.test.ts` — the same reviews → `policyMet` `met: false` | same mutation as above |
| `kernel/test/integrations-github-client.test.ts` — `getPages` cap reached on reviews/check-runs → `getPullMergeState` not ok (only if fail-closed is chosen) | delete the truncation check line added to `getPullMergeState` / `getPages` in `kernel/src/integrations/github/client.ts` |
| `kernel/test/automate-merge-check.test.ts` — approval filed via the real tool path → `policyMet` `met: true` | flip `'$.input.repo'` → `'$.repo'` in `kernel/src/integrations/github/repo-policy.ts` |
| `kernel/test/sessions-policy.test.ts` — `ALWAYS_HELD_TOOLS` includes the merge approval tool | delete `"mcp__kernel__kernel_merge_approval_request",` in `kernel/src/sessions/policy.ts` |
| `kernel/test/automate-merge-check.test.ts` — Solo + live run → `wait` | delete the live-run check line in `kernel/src/automate/merge-check.ts` |
| `kernel/test/automate-merge-check.test.ts` — no policy → `park: no_policy` | flip `"no_policy"` → `"unreadable"` in `kernel/src/automate/merge-check.ts`'s reason mapping |
| `kernel/test/automate-merge-check.test.ts` — approved approval whose `ready_at` differs from the run file's → `wait` | delete the `ready_at` comparison line in `kernel/src/automate/merge-check.ts` |
| `kernel/test/automate-merge-check.test.ts` — Solo repo + playbook `studio_approval` → `wait` until approved | delete the `playbookRequirement` argument passed to `policyMet` in `kernel/src/automate/merge-check.ts` |
| `kernel/test/automate-runner.test.ts` — prepare's invocation has `--inline-phases`, no `--auto-merge` | delete the `--inline-phases` token in `kernel/src/automate/tickets-to-items.ts` |
| `kernel/test/automate-runner.test.ts` — draft playbook session refused | delete the live-mode check line in `kernel/src/automate/runner.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | GitHub merge-state reads: deleted-reviewer fix, `getPages` decision, `hasMergeApproval` reads the filed shape | AC8, AC10, AC11 (shape reader + its existing pins), AC14 | 4 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | Automate runner tools, held merge approval, Wright guidance, docs | AC1, AC2, AC3, AC4, AC5, AC5b, AC5c, AC6, AC7, AC9, AC12, AC13, AC14 | 10 modify, ~11 create (4 src, 2 tests, ~5 fixture files) | `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "getPullMergeState"}
  - {kind: "symbol", path: "kernel/src/integrations/github/repo-policy.ts", name: "hasMergeApproval"}
  - {kind: "file", path: "docs/evidence/phase-8-item-09-getpages-truncation.md"}
  - {kind: "file", path: "docs/evidence/phase-8-item-09-merge-approval-shape.md"}
requires: []
lanes:
  - "kernel/src/integrations/github/client.ts"
  - "kernel/src/integrations/github/repo-policy.ts"
  - "kernel/test/integrations-github-client.test.ts"
  - "kernel/test/integrations-github-repo-policy.test.ts"
  - "docs/evidence/phase-8-item-09-getpages-truncation.md"
  - "docs/evidence/phase-8-item-09-merge-approval-shape.md"
external_requires: []

# Subtask 2
provides:
  - {kind: "file", path: "kernel/src/automate/runner.ts"}
  - {kind: "file", path: "kernel/src/automate/run-state.ts"}
  - {kind: "file", path: "kernel/src/automate/tickets-to-items.ts"}
  - {kind: "file", path: "kernel/src/automate/merge-check.ts"}
  - {kind: "symbol", path: "kernel/src/automate/index.ts", name: "runnerPart"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "mcp__kernel__kernel_merge_approval_request"}
  - {kind: "symbol", path: "kernel/src/brain/templates.ts", name: "kernel_automate_merge_check"}
  - {kind: "file", path: "kernel/test/automate-runner.test.ts"}
  - {kind: "file", path: "kernel/test/automate-merge-check.test.ts"}
  - {kind: "file", path: "kernel/test/fixtures/loomwright-run-files/README.md"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/github/repo-policy.ts", name: "hasMergeApproval"}
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "getPullMergeState"}
lanes:
  - "kernel/src/automate/index.ts"
  - "kernel/src/automate/runner.ts"
  - "kernel/src/automate/run-state.ts"
  - "kernel/src/automate/tickets-to-items.ts"
  - "kernel/src/automate/merge-check.ts"
  - "kernel/src/sessions/policy.ts"
  - "kernel/src/brain/templates.ts"
  - "kernel/test/automate-runner.test.ts"
  - "kernel/test/automate-merge-check.test.ts"
  - "kernel/test/fixtures/loomwright-run-files/**"
  - "kernel/test/phase-8-foundation.test.ts"
  - "kernel/test/tools-sdk-list.test.ts"
  - "kernel/test/brain.test.ts"
  - "kernel/test/sessions-policy.test.ts"
  - "docs/architecture/automate.md"
  - "docs/architecture/approvals.md"
  - "docs/architecture/brain.md"
external_requires:
  - "Loomwright >= 17.34.2 for `/loomwright:automate --merge-parked <run_id>` (p14); only named in the tool's answer, never run by the kernel"
```

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| github-reads (1) | `kernel/src/integrations/github/client.ts` (1139 — the bug lives in `getPullMergeState`; fix in place, no new responsibility), `kernel/src/integrations/github/repo-policy.ts` (485), `kernel/test/integrations-github-client.test.ts` (1876 — pins sit beside the existing `getPullMergeState` tests, the single home for that function's pins), `kernel/test/integrations-github-repo-policy.test.ts` (617 — beside the existing `policyMet` AC5 pins) | `docs/evidence/phase-8-item-09-getpages-truncation.md`, `docs/evidence/phase-8-item-09-merge-approval-shape.md` | HIGH |
| automate-runner (2) | `kernel/src/automate/index.ts` (51), `kernel/src/sessions/policy.ts` (1183 — one entry appended to `ALWAYS_HELD_TOOLS`, the single authority for that set), `kernel/src/brain/templates.ts` (130), `kernel/test/phase-8-foundation.test.ts` (681 — the foundation pin itself changes), `kernel/test/tools-sdk-list.test.ts` (376), `kernel/test/brain.test.ts` (1280 — only if a new needle is added beside the existing GitHub-tool needle; the single home for template pins), `kernel/test/sessions-policy.test.ts` (546 — the existing `ALWAYS_HELD_TOOLS` pin), `docs/architecture/automate.md`, `docs/architecture/approvals.md`, `docs/architecture/brain.md` | `kernel/src/automate/runner.ts` (the four tools + the filled `runnerPart`), `kernel/src/automate/run-state.ts` (Loomwright run files + `run.lock` reader), `kernel/src/automate/tickets-to-items.ts` (requirement items + `_BACKLOG` writer), `kernel/src/automate/merge-check.ts` (go/wait/park decision), `kernel/test/automate-runner.test.ts`, `kernel/test/automate-merge-check.test.ts`, `kernel/test/fixtures/loomwright-run-files/` (live, parked, done run files + a `run.lock/meta`, with a README) | HIGH (src), MEDIUM (exact fixture shape) |

Module layout: each new responsibility has its own CREATE module (`run-state.ts`, `tickets-to-items.ts`, `merge-check.ts`, tool wiring in `runner.ts`); `index.ts` only imports `runnerPart` from `runner.ts`. Reuse, never copy: `policyMet` and `loomwrightMergeFlags` (`repo-policy.ts`) for the policy and flags; `isRepoName` for repo validation; `toolsForConnectors` gating via `requiresConnector` / `requiresConnectorLevel`; `beforeHold` for the held tool's display/refusal.

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | YES (requires: AC9's real-path pin needs subtask 1's `hasMergeApproval` reading the nested shape) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): over the 12-file context bound | MEDIUM | Split in two by the `requires` edge; subtask 1 is small and lands first. |
| Feasibility (Phase 2.5): three paths outside the item's Touches (`docs/architecture/brain.md`, two `docs/evidence/` files) | MEDIUM | Recorded in `## Scope widening` as `pending-coordinator` (parallel lane); brain.md is forced by `brain.test.ts`'s verbatim pin, the evidence files by the evidence rule. Nothing else outside Touches is edited; the stale comment in `app/src/screens/approvals/subject.ts` is a PR-body follow-up, not an edit. |
| Feasibility (Phase 2.5): `--merge-parked` inside a kernel-started SDK session (host mode) is untested; p15 left the `AskUserQuestion` path unexercised; the kernel wires no token minter yet (a live write session is refused `github_token_unavailable`) | MEDIUM | This item builds and tests the kernel tools with fixtures and fakes only; record these in `docs/architecture/automate.md` as known limits (OPEN_QUESTIONS already carries them). No live run here (item 14). |
| The kernel can't force the session's flags (`--inline-phases`, no `--auto-merge`) | MEDIUM | `merge_check` plus Loomwright's own gate are the guard; state it in `automate.md` as a known limit, per the requirement's Risks. |
| Run-state source: Loomwright run files live in the checkout's `.supervisor/automate/` (p15 read them there) and the lock at `.supervisor/run.lock/meta` (`run-lock.sh`); run names changed in 17.34.2 (no `automate-` prefix) | MEDIUM | Identify run files by the `# Automate Run:` title and read `## Status`, item lines (`status: awaiting_merge`, `pr:`), `ready_sha` — never by filename prefix or "last `.md`"; unreadable ⇒ answer `park`/`wait` with a reason, never `go` (fail closed). |
| `ContributedToolContext.github` is `GitHubClient` only (no `getPullMergeState`) and absent in the daemon; `policyMet`'s default client reads the real Keychain | MEDIUM | AC5c: production passes no client, so `policyMet` uses `createRepoPolicyClient()` (the item 08 path, which works in the daemon); tests always inject `FakeGitHubClient` and pin that the default is never reached; a failed read ⇒ `unreadable`, never `go`. |
| `getPages` change could alter other callers (`listReachableRepos`, collaborators) | MEDIUM | Scope a fail-closed choice to `getPullMergeState`'s two listings (or give the reason in the evidence file for a shared change). |
| Ticket bodies are untrusted (invariant 3) | MEDIUM | Quote bodies in a fenced block marked untrusted data; validate titles/links/dedupe refs as data; never interpolate into the invocation. Writes only under the agent's workspace checkout, outside protected folders (D31); refuse `no_workspace`. |
| Invariant 4: the kernel never merges | HIGH | No GitHub merge endpoint and no `gh pr merge` in `kernel/src/automate/`; `merge_blocked` untouched; a test scans the sources. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-09-automate-runner-tickets-prs-merge-ready.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-08T20:05:31Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/237
- **Branch:** feature/automate-runner-tickets-prs-merge-ready
- **Files changed:** 31
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Four automate runner tools (prepare, state, merge_check, merge_approval_request — the last always held), the deleted-reviewer and nested-approval-shape fixes, getPages fail-closed for merge state, ROLE_TEMPLATE and docs. Phase 4.5: 3 review rounds, 2 fix iterations (link/policy control and bidi characters, deleted-account approval cap); 4 LOW findings dismissed below the MEDIUM floor (PR comment). Drain not dispatched: .auto_review is false.

## Not verified
- **The real kernel_merge_approval_request rail path into hasMergeApproval** — subtask 1 pinned the shape with hand-built rows; covered by subtask 2's AC9 test (subtask 1)
- **docs/architecture/repo-policy.md line 64 and the app subject.ts kernelFields comment** — stale wording, outside lanes; follow-up (subtask 1)
- **The four runner tools in a real kernel-started SDK session** — fixtures and FakeGitHubClient only; host-mode --merge-parked untested per p14 (subtask 2)
