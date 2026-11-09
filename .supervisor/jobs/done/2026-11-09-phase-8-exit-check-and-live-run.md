# Supervisor Job: Phase 8 exit check — the CI walk, the live harness and the runbook for studio-sandbox

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-02-150636/L15
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8/2026-11-02-160014-phase-8-exit-check-and-live-run-on-studio-sandbox.md
- **Base commit:** 90b5939a4829eeaee3dc425c447adb3047a6c0dd

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TS, vitest (kernel), Playwright Electron (app). No new dependency. |
| 2 | Dependency Availability | GO | Every fake exists: `kernel/test/fixtures/github-fake.ts`, `kernel/test/fixtures/mcp-fake.ts`, `kernel/test/fixtures/mcp-trackers/clickup-tools.json`, `kernel/test/fixtures/loomwright-run-files/` (live/parked/done/escalated), `kernel/test/session-fakes.ts`. Items 11, 12, 13 are merged (PRs #244, #234, #228). |
| 3 | Architecture Fit | GO | Same shape as phases 5 and 6: an app e2e that runs a real `startKernel` in the Playwright worker (`app/e2e/phase-5-exit.spec.ts`), a kernel in-process test (`kernel/test/phase-6-exit.test.ts`), a `STUDIO_LIVE=1` read-only harness (`kernel/test/phase-6-exit-live.test.ts`) and a runbook (`docs/evidence/phase-7-exit-runbook.md`). |
| 4 | Scope vs Supervisor Capability | CAUTION | About 3,000 new lines across two packages, so it is split `context-bound` into 3 subtasks. The live run itself needs the owner (D33, D35) and real tokens, so it is not part of this PR; this PR ships what the run uses. |
| 5 | Hard Blockers | CAUTION | The shipped contributions use real clients: the tracker uses `createRepoPolicyClient()`, the write tools use `createScopedGitHubClient`, and the triggers due work calls `firePollTriggers(store, github, now())` with the default `createMcpTicketReader()`. A walk on `SHIPPED_CONTRIBUTIONS` would reach the real Keychain and GitHub. Every one of these parts has a deps factory, so a test can compose its own contributions with the fakes, as phase 5 does (`contributions: exitContributions(clock)`). No kernel `src/` change is needed. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Ship phase 8's exit check: a CI walk of acceptance test 2 (app and kernel, both against fakes), the opt-in live harness and the owner's runbook for the live run on `vikashruhilgit/studio-sandbox`. Mark nothing done until a live run passes.

**Problem Statement:**
The owner needs acceptance test 2 run end to end, in CI against fakes and live on the throwaway repo, because phase 8 is marked done only on a live run in the running system (ROADMAP). In that run, tickets become PRs, comments are triaged, a reviewer is re-requested, and each merge goes through Loomwright's gate under its repo's policy.
Today, items 01 to 13 ship the mechanisms one at a time, each tested alone. Nothing walks them together, and no runbook or harness exists for the live run.
Success means three things. CI runs one walk that proves the whole loop on fakes. The owner has a runbook and a read-only harness to prove the same loop live. ROADMAP's phase 8 ✓ can land only in the close commit, after a passing run.

**Out of this PR (owner-run, later):** the live run itself, and the close commit that adds the evidence JSON, ROADMAP's ✓ and the checked OPEN_QUESTIONS entry, all at once. Any mismatch the run finds becomes a new phase 8 item. Nothing is patched here (requirement Non-goals).

## Acceptance Criteria
- [ ] **AC1 (CI walk, app).** Given CI (`cd app && npm ci && npm run build && npm run e2e`), when `app/e2e/phase-8-exit.spec.ts` runs, it does so in this setup:
  - the built app, launched only through `launchApp` (`app/e2e/electron-harness.ts`);
  - a real kernel started in-process with `startKernel` (phase 5's pattern);
  - contributions composed from the factories over the fakes: the fake GitHub (`kernel/test/fixtures/github-fake.ts`) and a fake ClickUp MCP ticket reader (`createMcpTicketReader({ serverFor, keychain })` over `kernel/test/fixtures/mcp-fake.ts` and a fake Keychain);
  - stand-in `/automate` and `/review-pr` sessions (`kernel/test/session-fakes.ts`) that write the recorded run files from `kernel/test/fixtures/loomwright-run-files/`;
  - one injected clock.

  Then it passes, and each step's effect is asserted from the kernel's store (and the fake's recorded calls), not only from the screen:
  - (a) one GitHub issue and one ClickUp task become two ticket tasks, each linked to its own PR in `pr_tracks` (PR A, PR B);
  - (b) three comments on PR A are routed: PR A is a parked `/automate` item, so `kernel_pr_route` answers `automate_fix` and the fix runs `/loomwright:review-pr <pr url>` in the triage playbook's own stand-in session, never a second drain; the question gets an answer and the remark a reply. The check reads the fake's recorded `replyToReviewComment` or `createPullComment` calls, made through the `kernel_github_pr_reply` or `kernel_github_pr_comment` tool;
  - (c) the owner is re-requested as reviewer: the fake records a `requestReviewers` call, made through `kernel_github_pr_request_reviewers`;
  - (d) PR A merges under **Solo** through the merge-when-ready path (`kernel_automate_merge_check` answers `go`), and PR B merges under **Approve in Studio**, after the owner approves its merge card for PR B's head in the app. Both have `pr_tracks.merged_by_gate = 1`, and the fake records no merge call from the kernel;
  - (e) a stand-in session's `gh pr merge` is denied `merge_blocked`, as its recorded `tool_decision` shows;
  - (f) the Tasks screen shows each ticket's PR, approvals and CI at each step.
- [ ] **AC2 (CI walk, kernel).** Given `cd kernel && npm ci && npm run typecheck && npm test`, when `kernel/test/phase-8-exit.test.ts` runs, it walks the same steps (a)–(e) on the kernel alone. That means contributions composed over the same fakes, stand-in sessions and one clock, as `kernel/test/phase-6-exit.test.ts` does for phase 6. It passes, and every assertion reads the store or the fake's recorded calls. It also checks that no call reached the real Keychain or the network: a guard fails the test on any `security` exec or any fetch to a host other than 127.0.0.1.
- [ ] **AC3 (live harness).** Given the live run, when `cd kernel && STUDIO_LIVE=1 npx vitest run test/phase-8-exit-live.test.ts` runs, it opens the store read-only. It writes nothing, calls no CLI, posts to no API route and decides no approval. It then checks three things:
  - each tracked PR's states appear in order;
  - each merge has `merged_by_gate` true;
  - the store records no kernel merge call: no `gh pr merge` was allowed, and every merge attempt was denied `merge_blocked`.

  Without `STUDIO_LIVE`, its exported checkers run in CI against canned stores, with at least one passing and one failing case per check, as `kernel/test/phase-6-exit-live.test.ts` does.
- [ ] **AC4 (evidence shape).** Given the runbook, `docs/evidence/phase-8-exit-runbook.md` names the evidence file `docs/evidence/phase-8-exit-live-<YYYY-MM-DD>.json` but does not link it. It names the file's shape: `run_by`, then each click the agent made, recorded as "the agent, on the owner's word" (D35). The `owner` fields hold only what the owner reports seeing, and `jira` is `not_exercised`. `kernel/test/phase-8-exit-live.test.ts` exports a checker for that shape, tested in CI. It rejects an agent click without the D35 wording and any `jira` value other than `not_exercised`.
- [ ] **AC5 (runbook).** Given `docs/evidence/phase-8-exit-runbook.md`, it follows phase 7's runbook shape: what the run does to the machine, Setup, the walk, Who clicks, Screenshots, the evidence file and Close.
  - **Setup** names the owner's clicks before the run: seed studio-sandbox with a tiny project and one `ci` workflow; the owner flips it public; protection on `main` requires `ci`; the owner accepts the App's new permissions; the owner connects personal ClickUp; one crew member is created from a charter the owner approves, with the GitHub `write` grant and the ClickUp read tools; the repo's detected policy card proposes Solo and the owner accepts it.
  - **The walk** covers the requirement's Scope 2 steps: tickets, triage, PR A under Solo, PR B under Approve in Studio, the merge block and Tasks throughout. Jira is `not_exercised`.
  - **Screenshots** stay outside the repo unless the owner approves each one.
  - **Scope:** it never names `vendsy/*` or any Tray system as a target.
- [ ] **AC6 (close only on a pass).** Given this PR, `docs/ROADMAP.md`'s phase 8 row gets no ✓. `docs/OPEN_QUESTIONS.md` gets one open `- [ ]` entry, "Phase 8 exit: live run (item 14, owner)". It names the runbook, the harness, the evidence file to come, and the single close commit (evidence JSON, ROADMAP ✓ and that entry checked, together, and never before a passing run). A CI-run test in `kernel/test/phase-8-exit-live.test.ts` fails when ROADMAP's phase 8 row carries `✓` and no `docs/evidence/phase-8-exit-live-*.json` exists.
- [ ] **AC7 (gates).** `bash scripts/check-docs.sh` passes. The Validation commands all pass: `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`, then `cd kernel && npm ci && npm run typecheck && npm test`. The new spec contains no `electron.launch` and no `new BrowserWindow` (house rule; `app/scripts/hidden-windows.test.ts`).

## House Rules
> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

## File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel-walk | — | `kernel/test/phase-8-exit.test.ts` | HIGH |
| app-walk | — | `app/e2e/phase-8-exit.spec.ts`, `app/e2e/fixtures/phase-8-exit.ts` | HIGH |
| live | `docs/OPEN_QUESTIONS.md` (249 — a new open entry appended under "Technical: verify, don't assume", beside the other phase 8 entries) | `kernel/test/phase-8-exit-live.test.ts`, `docs/evidence/phase-8-exit-runbook.md` | HIGH |

**Module layout:** every new responsibility gets a CREATE home. The kernel walk is `kernel/test/phase-8-exit.test.ts`. The app walk's spec is `app/e2e/phase-8-exit.spec.ts`, and its canned data and contribution composition are in `app/e2e/fixtures/phase-8-exit.ts` (phase 6 and 7's `fixtures/phase-N-exit.ts` split). The live checkers and their CI cases are in `kernel/test/phase-8-exit-live.test.ts`, as in phase 6. No helper is copied: the walks reuse `kernel/test/session-fakes.ts`, `kernel/test/notifier-stub.ts`, `kernel/test/fixtures/github-fake.ts`, `kernel/test/fixtures/mcp-fake.ts` and `kernel/test/fixtures/loomwright-run-files/harness.ts` as they are. They are imported, never re-implemented, and none of them is edited.

**In Touches, deliberately unchanged:**
- **`app/e2e/fixture-kernel.ts`** (375). The requirement lists it because "the in-process kernel walk needs the fake GitHub and fake MCP wired in". But the in-process pattern (`app/e2e/phase-5-exit.spec.ts`: `startKernel` in the Playwright worker with `contributions:`) never goes through the fixture kernel, which is a fake loopback API with canned data. So the fakes are wired through the spec's composed contributions, and `fixture-kernel.ts` stays as it is. 37 e2e files import it. It is in no subtask's lanes. If a worker finds it must change, the worker stops and reports why, and does not edit it.
- **`docs/ROADMAP.md`.** It changes only in the later close commit (AC6).

## Touched-file invariants

> Grounded at base `90b5939a4829eeaee3dc425c447adb3047a6c0dd`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`docs/OPEN_QUESTIONS.md`** (Subtask 3):
  - **Keep:** the three probe entries stay in order, each opening with its own marker phrase (`probe p14.`, `probe p15.`, `probe p16.`). The new open `- [ ] **Phase 8 exit: live run (item 14, owner).**` entry goes after the last phase 8 entry ("Phase 8 items 06 and 07: the MCP connector's…"), directly before `## Deferred decisions`. So it sits after `probe p16.` and inside `## Technical: verify, don't assume`.
  - **Never** write the text `probe p14.`, `probe p15.` or `probe p16.` (with the trailing period) inside the new entry. Refer to them as "p14", "p15" and "p16".
  - **Reuse:** the file's own entry shape: a bold headline ending in a period, then `  - **…:**` sub-bullets, as the "Phase 7 exit: live run (item 10, owner)" entry does.
  - **Pinned by:** `kernel/test/automate-runner.test.ts`, which cuts the file at `text.indexOf("probe p15.")` and `text.indexOf("probe p16.")` and expects `does it reach an open PR: yes` in the p15 slice. A new entry placed between the probes, or quoting a marker, would cut the slices wrongly.
  - **Links:** each relative link in the entry must resolve, or `scripts/check-docs.sh` fails (`links to '$target' which does not exist`). So it links `evidence/phase-8-exit-runbook.md`, and names the future `phase-8-exit-live-<date>.json` in backticks, never as a link.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel in-process walk (`phase-8-exit.test.ts`) | AC2, AC7 (kernel half) | 0 modify, 1 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | App e2e walk on a real in-process kernel | AC1, AC7 (app half, house rule) | 0 modify, 2 create | `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |
| 3 | Live harness, runbook and the open OPEN_QUESTIONS entry | AC3, AC4, AC5, AC6, AC7 (check-docs) | 1 modify, 2 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

**Shared walk (subtasks 1 and 2 must agree on it; each writes its own copy of the data, as phase 6's kernel test and app spec did):**
- **Tickets:** GitHub issue `#11` and ClickUp task `cu-1` on `vikashruhilgit/studio-sandbox` become PR A `#21` and PR B `#22`.
- **Comments on PR A:** `fix: rename ping to pong`, `question: why exit 0?` and `remark: nice`.
- **The rest:** one re-request of the owner; PR A under Solo; PR B under Approve in Studio; a direct `gh pr merge` from one stand-in session.

All fixture values: no real account or token.

**Composing the kernel without real clients (both walks):**
- Build the contributions from `SHIPPED_CONTRIBUTIONS`, replacing three of them:
  - `automate`: `automateContributionOf` over parts built from `createAutomateRunnerTools({ client })`, `createTrackerDueWork({ client })` and `createRoutingTools({ client })`;
  - `integrations`: `integrationsContributionOf` over all seven `INTEGRATIONS_PARTS`, in their order (`github-connector`, `github-routes`, `github-tools`, `drafts`, `mcp`, `repo-policy`, `github-app-routes`, pinned by `kernel/test/integrations-foundation.test.ts`):
    - `github-tools` is rebuilt over the fake, from `createGitHubTools({ client })` and `createGitHubWriteTools({ client })`;
    - `repo-policy` is rebuilt over the fake, from `repoPolicyRoutes({ client })`;
    - the other five keep their shipped part. The walk seeds the GitHub connector row and the ClickUp MCP row directly in the store, so no connect, renew or App mint call runs. A shipped part's due work that would read the real Keychain must find no due row. AC2's guard proves it: any `security` exec fails the test, and the failure names the part, so the fix is a fake-deps rebuild of that part, never a `src/` patch;
  - `triggers`: a triggers contribution whose due work runs `fireDueTriggers(store, now())`, then `firePollTriggers(store, github, now(), fakeTicketReader)`.
- Wrap the result in `stubNotifierContributions`, as phase 5 does.
- If any part offers no deps seam, stop and report it (scope widening), and never patch `kernel/src/` (requirement: "Nothing is patched outside an item's Touches").

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/test/phase-8-exit.test.ts"}
requires: []
lanes:
  - "kernel/test/phase-8-exit.test.ts"
external_requires:
  - "vitest (kernel devDependency, present)"
```

```yaml
# Subtask 2
provides:
  - {kind: "file", path: "app/e2e/phase-8-exit.spec.ts"}
  - {kind: "file", path: "app/e2e/fixtures/phase-8-exit.ts"}
requires: []
lanes:
  - "app/e2e/phase-8-exit.spec.ts"
  - "app/e2e/fixtures/phase-8-exit.ts"
external_requires:
  - "@playwright/test Electron runner under xvfb (CI app job, present)"
  - "kernel/ npm ci in the app job (already installed by .github/workflows/ci.yml for phase-5-exit.spec.ts)"
```

```yaml
# Subtask 3
provides:
  - {kind: "file", path: "kernel/test/phase-8-exit-live.test.ts"}
  - {kind: "file", path: "docs/evidence/phase-8-exit-runbook.md"}
  - {kind: "symbol", path: "docs/OPEN_QUESTIONS.md", name: "Phase 8 exit: live run (item 14, owner)"}
requires: []
lanes:
  - "kernel/test/phase-8-exit-live.test.ts"
  - "docs/evidence/phase-8-exit-runbook.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires:
  - "The owner's live run on vikashruhilgit/studio-sandbox (later, not this PR)"
```

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/phase-8-exit.test.ts` — step (e), `gh pr merge` denied `merge_blocked` | delete `if (forms[0] === "merge") return { kind: "deny", reason: "merge_blocked" };` in `kernel/src/sessions/policy.ts` |
| `kernel/test/phase-8-exit.test.ts` — step (b), the fix on parked PR A routes `automate_fix` (never a second drain) | flip `route: "automate_fix",` → `route: "review_pr",` in `kernel/src/automate/routing.ts` |
| `kernel/test/phase-8-exit.test.ts` — step (d), PR A's merge check answers `go` under Solo | flip `return { answer: "go", run_id: parked.run_id` → `return { answer: "wait", run_id: parked.run_id` in `kernel/src/automate/merge-check.ts` |
| `kernel/test/phase-8-exit.test.ts` — step (d), `merged_by_gate = 1` after each merge | flip `const gate = obs.merged_by_gate ? 1 : 0;` → `const gate = 0;` in `kernel/src/automate/tracker.ts` |
| `kernel/test/phase-8-exit.test.ts` — step (c), the owner re-requested (`requestReviewers` recorded) | delete `name: "kernel_github_pr_request_reviewers",` in `kernel/src/integrations/github/write-tools.ts` |
| `kernel/test/phase-8-exit.test.ts` — step (a), two ticket tasks each linked to its PR in `pr_tracks` | flip `const gate = obs.merged_by_gate ? 1 : 0;` → `const gate = 1;` in `kernel/src/automate/tracker.ts` (the step (a) assertion that each newly linked PR has `merged_by_gate = 0` goes red) |
| `kernel/test/phase-8-exit.test.ts` — step (a), each ticket task linked to its PR (`pr_tracks.ticket_ref`) | flip `const ticket = obs.ticket ?? row?.ticket_ref ?? null;` → `const ticket = null;` in `kernel/src/automate/tracker.ts` |
| `kernel/test/phase-8-exit.test.ts` — step (b), the reply recorded (`replyToReviewComment`) | delete `name: "kernel_github_pr_reply",` in `kernel/src/integrations/github/write-tools.ts` |
| `kernel/test/phase-8-exit.test.ts` — step (b), the answer recorded (`createPullComment`) | delete `name: "kernel_github_pr_comment",` in `kernel/src/integrations/github/write-tools.ts` |
| `app/e2e/phase-8-exit.spec.ts` — AC1 (a), two ticket tasks linked in `pr_tracks` | flip `const ticket = obs.ticket ?? row?.ticket_ref ?? null;` → `const ticket = null;` in `kernel/src/automate/tracker.ts` |
| `app/e2e/phase-8-exit.spec.ts` — AC1 (b), the fix routed `automate_fix` | flip `route: "automate_fix",` → `route: "review_pr",` in `kernel/src/automate/routing.ts` |
| `app/e2e/phase-8-exit.spec.ts` — AC1 (b), the reply and the answer recorded | delete `name: "kernel_github_pr_reply",` in `kernel/src/integrations/github/write-tools.ts` (and, separately, delete `name: "kernel_github_pr_comment",` in the same file) |
| `app/e2e/phase-8-exit.spec.ts` — AC1 (c), the owner re-requested | delete `name: "kernel_github_pr_request_reviewers",` in `kernel/src/integrations/github/write-tools.ts` |
| `app/e2e/phase-8-exit.spec.ts` — AC1 (f), Tasks shows the merge by the gate | delete `if (ticket.merged_by_gate) facts.push({ label: "Merged", text: BY_GATE });` in `app/src/screens/tasks/TicketPrCard.tsx` |
| `app/e2e/phase-8-exit.spec.ts` — AC1 (e), the merge denied `merge_blocked` | delete `if (forms[0] === "merge") return { kind: "deny", reason: "merge_blocked" };` in `kernel/src/sessions/policy.ts` |
| `app/e2e/phase-8-exit.spec.ts` — AC1 (d), PR A's merge check answers `go` | flip `return { answer: "go", run_id: parked.run_id` → `return { answer: "wait", run_id: parked.run_id` in `kernel/src/automate/merge-check.ts` |
| `kernel/test/phase-8-exit.test.ts` — AC2's Keychain/network guard | the guard's red case is a canned call inside the test (one `security` exec through the guard, expected to throw). It protects against a future default, so there is no current code line to mutate. Stated per the rule |
| `kernel/test/phase-8-exit-live.test.ts` — AC3's three live checkers and AC4's evidence-shape checker | each checker's red case is a canned store or a canned evidence object (out-of-order states; `merged_by_gate = 0`; an allowed `gh pr merge`; an agent click without "the agent, on the owner's word"; `jira: "exercised"`), as in phase 6's harness. They check data, not kernel code |
| `kernel/test/phase-8-exit-live.test.ts` — the ROADMAP close guard (AC6) | flip `only through the gated path |` → `only through the gated path ✓ |` in `docs/ROADMAP.md` (no `phase-8-exit-live-*.json` exists, so the guard goes red) |

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
Subtask 2 (independent)
Subtask 3 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |
| Subtask 1 | Subtask 3 | none | NO |
| Subtask 2 | Subtask 3 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2, Subtask 3 (parallel)
- **Recommended workers:** 3
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/playwright-e2e/SKILL.md` |
| 3 | `skills/unit-testing/SKILL.md` |

**Precedents to read first:**
- **Subtask 1:** `kernel/test/phase-6-exit.test.ts`, `kernel/test/automate-runner.test.ts`, `kernel/test/automate-merge-check.test.ts`, `kernel/test/automate-routing.test.ts`, `kernel/test/integrations-mcp-trackers.test.ts`.
- **Subtask 2:** `app/e2e/phase-5-exit.spec.ts` (the real in-process kernel, clock, token and `STUDIO_DATA_DIR` wiring), `app/e2e/integrations-phase-8.spec.ts` and the Tasks or merge-card specs from items 11 and 13.
- **Subtask 3:** `kernel/test/phase-6-exit-live.test.ts` (`withDb` read-only, the run-start mark, exported checkers tested in CI) and `docs/evidence/phase-7-exit-runbook.md` (its shape).

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| A walk built on `SHIPPED_CONTRIBUTIONS` reaches the real Keychain or GitHub. The tracker uses `createRepoPolicyClient()`, the write tools use `createScopedGitHubClient`, and the triggers due work uses the default `createMcpTicketReader()`. (source: Feasibility (Phase 2.5)) | HIGH | Compose the contributions from the factories with the fakes (Subtask Structure note). AC2's guard fails on any `security` exec or non-loopback fetch. A part without a seam is a stop-and-report, never a `kernel/src/` patch. |
| Scope is large. About 3,000 new lines; phase 5's spec is 786 lines, phase 6's kernel test 813 and its live harness 2,441. (source: Feasibility (Phase 2.5)) | MEDIUM | Split `context-bound` into three independent subtasks with no shared file. |
| The live run needs the owner, real subscription tokens (several `/automate` sessions, a shared weekly cap, D17) and a public flip of studio-sandbox. (source: Feasibility (Phase 2.5)) | MEDIUM | This PR ships only the harness and runbook. The runbook makes the owner check the repo's content before the flip, names every click before the run and states the token cost up front. |
| A premature close: ROADMAP ✓ or a checked OPEN_QUESTIONS entry lands before a passing live run. | MEDIUM | AC6's CI guard, plus an open `- [ ]` entry only. |
| The two walks drift apart: one asserts a route or state the other doesn't. | LOW | Both use the shared walk values above. The reviewer checks that steps (a)–(e) match. |
| The `AskUserQuestion` path inside a kernel-started `/automate` session was not exercised by probe p15 (OPEN_QUESTIONS p15 result). | LOW | Stand-in sessions cover CI. The runbook notes that the live run may raise a gate, which the owner answers in Approvals. A failure there becomes a new item. |

## Configuration
- **Workers:** 3
- **Mode:** parallel
- **Estimated batches:** 1
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-09-phase-8-exit-check-and-live-run.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-09T10:20:58Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/246
- **Branch:** feature/phase-8-exit-check-and-live-run
- **Files changed:** 6
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unknown (no_driver_handover)
- **Summary:** All 3 subtasks merged: the kernel walk, the app e2e walk, and the live harness with its runbook and OPEN_QUESTIONS entry. Integrated gates on 5500db8 were green: check-docs OK, 4138 kernel tests, 337 app e2e tests. Phase 4.5 ran three rounds. Every review was PASS, but each raised one MEDIUM at the fix floor, so each got a fix: 619a769 (runbook preconditions, merge matcher too narrow), fb9fc23 (matcher too wide, so it became a word-level mirror of the rail), 7f601ef (the rail's fail-closed spellings). The round-3 fix was never re-reviewed. The supervisor re-ran its tests: 143 passed. Two kernel gaps block the live run and are candidates for new items: startKernel wires no sessionTokenMint, and a ClickUp poll names no repos (no_repos). Worker 2 hit its 100-turn limit once and was resumed via SendMessage. The Execute Manager checkpointed with workers in flight, so the driver parked, and FINALIZE ran on the legacy --continue path in the same session.

## Not verified
- **A STUDIO_LIVE=1 run against a real installed service and store** — needs the owner's live run on studio-sandbox (D33, D35); only the guard and missing-store paths were run (subtask 3)
- **The runbook commands (gh repo edit, the branch protection PUT, the ci workflow seed)** — they write to the owner's GitHub repo, so were not run (subtask 3)
- **The tool_decision and pr_state_changed payload shapes against a real run** — checked against kernel/src and the fakes only (subtask 3)
- **A live kernel with a real session-token mint and a ClickUp-fed playbook** — startKernel wires no sessionTokenMint and a ClickUp poll names no repo; the walk supplies both (subtask 1)
- **Real GitHub App token minting and the real ClickUp poll-to-session path** — needs the owner's live run (subtask 2)
