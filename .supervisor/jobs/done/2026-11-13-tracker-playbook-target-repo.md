# Supervisor Job: A ClickUp or Jira ticket playbook names its target repository

## Environment
- **Project:** loomwright-studio (lane checkout `automate-2026-11-12-180247/L6`)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-20/2026-11-12-170445-h-a-tracker-ticket-playbook-names-its-target-repository.md
- **Base commit:** 9ea7801a563bdb6ea320ff8da1d978fd53d26ce3

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel, vitest, better-sqlite3 migrations; no new dependency |
| 2 | Dependency Availability | GO | Everything needed is in the repo: `isRepoName` (`kernel/src/integrations/github/repo-policy.ts`), `githubConnectorState` (`kernel/src/triggers/poll.ts`), the migration pattern of 21/23, `playbookRepos` (`kernel/src/sessions/github-session-auth.ts`) |
| 3 | Architecture Fit | GO | A nullable playbook column stored with the version snapshot, the same shape as `jobs_json` (migration 23); the enable refusal sits beside `playbook_looser_than_repo`, before the hold and on the apply |
| 4 | Scope vs Supervisor Capability | CAUTION | 19 modify + 3 create: past the 12-file bound, so split `context-bound` into the kernel mechanism and the exit walks/runbook |
| 5 | Hard Blockers | CAUTION | Needs files outside the requirement's Touches: the token's repos are read in `kernel/src/sessions/github-session-auth.ts` (`playbookRepos`), the enable refusal lives in `kernel/src/playbooks/enable.ts`, the column needs migration 25 and bumps of seven migration-order pins, and AC2 names the runbook and both exit walks. Recorded under `## Scope widening` for the coordinator |

**Overall Verdict:** CAUTION

## Task
**Goal:** Give a playbook one owner-visible `target_repo` field (`owner/name`) that a ClickUp or Jira ticket playbook must carry before it can be enabled, and mint its live sessions' GitHub token for that repository.

**Problem Statement:**
The owner needs a ClickUp ticket playbook to know which repository its PRs go to, because a `clickup.tasks` poll names no repository and the session token is minted only for the repos of the playbook's linked poll (`playbookRepos`), so its runs are refused `github_token_unavailable: no_repos`.
Currently, the runbook's workaround (link a switched-off `github.pulls` poll that names the repo, then register the ClickUp poll second) cannot be built through Wright: the kernel allows one poll per playbook, and Wright's ClickUp poll replaced the PR poll (phase 8 exit live run, 2026-11-12, sessions 125, 126, 129).
Success looks like a ClickUp ticket playbook drafted by Wright with `target_repo: vikashruhilgit/studio-sandbox` whose live session gets a token for that repo, and an enable that is refused up front, in plain words, when the field is missing or names a repo the GitHub App does not reach.

## Design decisions
- decision: where a playbook's target repository is stored (T2: new module `kernel/src/store/migrations/025_playbook_target_repo.ts`)
  chosen: a nullable `playbooks.target_repo TEXT` column (migration 25), a change field like `jobs` (no `*_set_by`), copied into every version snapshot by the existing `JSON.stringify(row)`
  rejected: repos in the tracker poll spec — `parsePollSpec` gives a `jira.issues`/`clickup.tasks` spec no `repos` and the poll's repo list means "what to watch", not "where PRs go"; blast radius: it changes the poll contract and `checkPollSpec`'s tracker branch
  rejected: a second poll per playbook — a requirement non-goal ("More than one poll per playbook")
  rejected: a policy field with `target_repo_set_by` — it is not a tunable policy the owner overrides per run but a fact of the playbook, like `jobs` (migration 23 precedent, "A change field like `name` and `intent`, not a policy field: it has no `*_set_by` column")
  evidence: `kernel/src/store/migrations/023_playbook_jobs.ts` (`if (existing.all(table).includes(column)) continue;`); `kernel/src/playbooks/store.ts` (`JSON.stringify(row)` in the version insert); `kernel/src/triggers/poll.ts` (`a \`jira.issues\` or \`clickup.tasks\` spec takes no \`repos\``)
  revisit when: a playbook needs PRs in more than one repository
  status: confirmed
- decision: where the target-repo rule lives (T2: new module `kernel/src/playbooks/target-repo.ts`)
  chosen: a new playbooks-feature module holding `checkTargetRepo` (shape) and `targetRepoRefusal` (the `no_target_repo` / `target_repo_not_reachable` rule) that REUSES the existing exported helpers: `isRepoName` from `kernel/src/integrations/github/repo-policy.ts` for the shape, and `githubConnectorState` from `kernel/src/triggers/poll.ts` (its `usable` flag and lower-cased `reachable` set) for the reach test. No new repo-name or reach helper is written and `poll.ts` is not modified
  rejected: inline in `kernel/src/playbooks/store.ts` — blast radius: 824 lines, already past the module-layout threshold
  rejected: inline in `kernel/src/playbooks/enable.ts` — blast radius: 566 lines, past the threshold, and `store.ts` needs the shape check too, so it would import from `enable.ts`
  rejected: `requireReach` (`kernel/src/integrations/github/tools.ts`) for the reach test — it throws a plain `Error` carrying the GitHub tools' own codes (`connector_missing` / `repo_not_reachable`), so the enable would have to parse a message string to map it to `EnableRefused("target_repo_not_reachable", …)`; `githubConnectorState` returns the same facts as values (reversibility: the refusal stays enable's own)
  rejected: extracting a new `isRepoName` from `poll.ts`'s `checkRepos` — it would be a third exported copy beside `repo-policy.ts`'s and `console/workspaces.ts`'s
  evidence: `kernel/src/integrations/github/repo-policy.ts` `export function isRepoName(repo: unknown): repo is string {` (also imported by `automate/runner.ts` and `automate/routing.ts`); `kernel/src/triggers/poll.ts` `export function githubConnectorState(store: Store): ConnectorState {`; `kernel/src/integrations/github/tools.ts` `export function requireReach(store: Store, repo: string): void {`; `kernel/src/playbooks/enable.ts` already imports from `../integrations/github/repo-policy.js` (`import { getRepoPolicy } from`), so no new import boundary is crossed
  revisit when: a second playbook field needs repo reach checks, so the module grows into a general playbook-repo module
  status: confirmed

## Acceptance Criteria
1. - [ ] Given a playbook created or updated with `target_repo: "owner/name"`, when Wright drafts it through `kernel_playbook_create` / `kernel_playbook_update`, then the row stores it in `playbooks.target_repo` (migration 25), it is in the new version's snapshot, `formatPlaybook` shows a `target repo:` line, and the mirror file shows a `- Target repo:` line (a playbook with no target repo keeps its mirror byte for byte); a malformed value (not `owner/name`, or a `.`/`..` part) is refused `invalid_input` naming `target_repo`, and `none` clears it on update.
2. - [ ] Given a live, write-granted session of a playbook whose `target_repo` is set, when its token is minted, then `playbookRepos` returns the target repo (together with any repos its linked GitHub poll names, deduplicated), so a `clickup.tasks` playbook with a target repo is no longer refused `no_repos`.
3. - [ ] Given a playbook whose linked poll is `clickup.tasks` or `jira.issues` and whose `target_repo` is null, when `kernel_playbook_enable` is called, then it is refused `no_target_repo` with a plain sentence telling Wright to set the target repository, before any hold (no approval written) and again in `enableApproved`, also when the call sets `enable_anyway: true`, and the playbook stays a draft.
4. - [ ] Given a playbook whose `target_repo` the GitHub connector does not reach (no usable `github` connector row, or the repo is not in its `reachable_repos_json`), when its enable is requested, then it is refused `target_repo_not_reachable` naming the repo, before the hold and again in `enableApproved`.
5. - [ ] Given the field, then `docs/evidence/phase-8-exit-runbook.md` "Known preconditions" and walk step 1, `kernel/test/phase-8-exit.test.ts` and `app/e2e/phase-8-exit.spec.ts` give the ClickUp ticket playbook a single `clickup.tasks` poll and `target_repo`, the two-poll workaround (the switched-off `github.pulls` poll / the `github.issues` label stand-in) and its comments are removed, and both walks still pass.
6. - [ ] Given the change, then `cd kernel && npm test` passes, and `docs/architecture/playbooks.md` (field list, enable checks) and `docs/architecture/approvals.md` (refusal table and list) name `target_repo`, `no_target_repo` and `target_repo_not_reachable`.

## Scope widening
- kernel/src/playbooks/enable.ts
- kernel/src/playbooks/mirror.ts
- kernel/src/playbooks/target-repo.ts
- kernel/src/sessions/github-session-auth.ts
- kernel/src/store/migrations/index.ts
- kernel/src/store/migrations/025_playbook_target_repo.ts
- kernel/test/playbooks-target-repo.test.ts
- kernel/test/store.test.ts
- kernel/test/brain-threads.test.ts
- kernel/test/console-workspaces.test.ts
- kernel/test/integrations-foundation.test.ts
- kernel/test/integrations-github-app-migration.test.ts
- kernel/test/integrations-github-declared.test.ts
- kernel/test/phase-8-foundation.test.ts
- kernel/test/phase-8-exit.test.ts
- app/e2e/phase-8-exit.spec.ts
- docs/architecture/approvals.md
- docs/evidence/phase-8-exit-runbook.md
- accepted: LP-SCOPE 2026-11-13

## File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| store + migration | `kernel/src/playbooks/store.ts` (824 — the single authority for playbook rows: column, `PlaybookRow`, create/update wiring only; the check lives in `target-repo.ts`), `kernel/src/store/migrations/index.ts` (55) | `kernel/src/store/migrations/025_playbook_target_repo.ts` | HIGH |
| target-repo rule | — (reuses `isRepoName` from `kernel/src/integrations/github/repo-policy.ts` and `githubConnectorState` from `kernel/src/triggers/poll.ts`, both unchanged) | `kernel/src/playbooks/target-repo.ts` (new home: `checkTargetRepo`, `targetRepoRefusal`) | HIGH |
| enable | `kernel/src/playbooks/enable.ts` (566 — two reason values and one call beside `looserThanRepo` at its two call sites; the rule itself lives in `target-repo.ts`) | — | HIGH |
| token | `kernel/src/sessions/github-session-auth.ts` (348) | — | HIGH |
| drafting + display | `kernel/src/playbooks/drafts.ts` (826 — the tool schema and `formatPlaybook` are the single authority for the tool shape and display: one zod key per tool, one display line, description text), `kernel/src/playbooks/mirror.ts` (238) | — | HIGH |
| tests | `kernel/test/playbooks-drafts-poll.test.ts` (207), migration-order pin bumps 24 → 25 (pins only, no new responsibility): `kernel/test/store.test.ts` (2287), `kernel/test/brain-threads.test.ts` (815), `kernel/test/console-workspaces.test.ts` (437), `kernel/test/integrations-foundation.test.ts` (941), `kernel/test/integrations-github-app-migration.test.ts` (156), `kernel/test/integrations-github-declared.test.ts` (694), `kernel/test/phase-8-foundation.test.ts` (715) | `kernel/test/playbooks-target-repo.test.ts` (new home for every new behaviour test: migration 25, refusals, token repos) | HIGH (pins: MEDIUM — the worker re-greps `saved_workspaces` / `length: 24` after adding 25) |
| docs | `docs/architecture/playbooks.md` (149), `docs/architecture/approvals.md` (291) | — | HIGH |
| exit walks (subtask 2) | `kernel/test/phase-8-exit.test.ts` (999 — replaces the existing two-poll block in place), `app/e2e/phase-8-exit.spec.ts` (896 — replaces the existing stand-in block in place), `docs/evidence/phase-8-exit-runbook.md` (190) | — | HIGH |

**Total estimated files:** 19 modify + 3 create

### File Overlap Detection

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| Subtask 1 | Subtask 2 | none (subtask 2 uses subtask 1's `target_repo` field and refusals) | YES — dependency, not overlap |

## House Rules
> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

## Touched-file invariants

> Grounded at base `9ea7801a563bdb6ea320ff8da1d978fd53d26ce3`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/playbooks/store.ts`** — keep: the change-field list is closed and drives the "at least one" check: `PLAYBOOK_CHANGE_FIELDS = ["name", "intent", "jobs", "trigger", ...PLAYBOOK_POLICY_FIELDS]` (add `target_repo` here, NOT to `PLAYBOOK_POLICY_FIELDS`, so it gets no `*_set_by`); an update writes a column only when it changes, as `if (jobs !== undefined && jobs !== row.jobs_json) {` does, so an unchanged re-save makes no new version; reuse: the version snapshot is the whole row (`JSON.stringify(row)`), so no snapshot code changes; validation errors are `PlaybookError` `invalid_input` via `invalid(`.
- **`kernel/src/store/migrations/index.ts`** + new `025_playbook_target_repo.ts` — mirror migration 23 exactly: idempotent `ALTER TABLE` guarded by `if (existing.all(table).includes(column)) continue;`, nullable with no default and no backfill (invariant 1), no SQL trigger ("the integrity check refuses any trigger the kernel does not list"); register after `import { playbookJobs } from "./023_playbook_jobs.js";` and the saved_workspaces import. Pinned by these, all in Subtask 1's lanes, and all updated in ONE pass:
  (a) last-migration pins move to 25: `appliedMigrations().map((m) => [m.version, m.name]).at(-1)).toEqual([24, "saved_workspaces"])` → `[25, "playbook_target_repo"]`, `Array.from({ length: 24 }, (_, i) => i + 1)` → `length: 25`, `migrations.at(-1)).toBe(savedWorkspaces)` → `toBe(playbookTargetRepo)` (brain-threads, phase-8-foundation, integrations-github-app-migration, store, console-workspaces, integrations-foundation), and `migrations.at(-2)).toBe(playbookJobs)` → `at(-3)`, with `at(-2)` becoming `toBe(savedWorkspaces)`, in ALL five files that carry it: `kernel/test/store.test.ts`, `kernel/test/brain-threads.test.ts`, `kernel/test/integrations-github-app-migration.test.ts`, `kernel/test/integrations-foundation.test.ts`, `kernel/test/phase-8-foundation.test.ts`;
  (b) the playbooks column-list pins gain `target_repo` at the end: `PLAYBOOKS_COLUMNS` in `kernel/test/store.test.ts` (and the `[...before, ...NEW, "jobs_json"]` / `[...before, "jobs_json"]` lists there), and the `.slice(-5)` list and `added.playbooks` in `kernel/test/integrations-foundation.test.ts`;
  (c) migration 24's OWN identity pins stay unchanged: `[savedWorkspaces.version, savedWorkspaces.name]).toEqual([24, "saved_workspaces"])` (console-workspaces, integrations-foundation) must NOT move to 25 — only their "the last migration" test titles/descriptions change.
  The worker re-greps `saved_workspaces`, `length: 24`, `toBe(savedWorkspaces)`, `toBe(playbookJobs)` and `"jobs_json"` under `kernel/test` after adding 25.
- **`kernel/src/integrations/github/repo-policy.ts`** and **`kernel/src/triggers/poll.ts`** (read-only reuse, NOT modified) — reuse: `export function isRepoName(repo: unknown): repo is string {` for the shape check and `export function githubConnectorState(store: Store): ConnectorState {` for reach (compare `repo.toLowerCase()` against its `reachable` set, as `checkPollSpec` does with `connector.reachable.has(repo.toLowerCase())`; an unusable connector reads as not reachable). Neither file changes.
- **`kernel/src/playbooks/enable.ts`** — keep: the refusal runs at BOTH places `looserThanRepo` runs (`const looser = looserThanRepo(ctx.store, row);` in `beforeHold`, and `const looser = looserThanRepo(store, row);` in `enableApproved`), so nothing is held when the refusal applies, and an owner change after the hold is still caught; the closed reason union `readonly reason: "not_found" | ` … `| "charter_gap";` and `playbookErrorOf`'s mapping (wrapped by `asPlaybookError`) (`if (err.reason === "charter_gap") return invalid(`) both gain the two new reasons as `invalid_input` with the reason as message prefix; `enable_anyway` must NOT skip the new refusals (it is scoped to `charter_gap`).
- **`kernel/src/sessions/github-session-auth.ts`** — keep: `if (repos.length === 0) return "no_repos";` (a playbook with neither a target repo nor a GitHub poll is still refused `no_repos`); `playbookRepos` stays raw SQL over `playbooks`/`triggers` and filters with `REPO_SHAPE`; repos are deduplicated (`[...new Set(`); pinned by: `kernel/test/sessions-github-session-auth.test.ts` (`["no_repos", "no_repos"]`), which must stay green unchanged.
- **`kernel/src/playbooks/drafts.ts`** — keep: every tool input is a bounded zod shape (`merge_requirement: z.string().max(40).optional(),`); the update description lists every change field ("changes gives any of name, intent, jobs, trigger") — add `target_repo`; `formatPlaybook` prints one line per field (`merge requirement: ${policyText(`); untrusted ticket/PR text never sets the field (the description says it comes from the owner's words, as `jobs` does: "chosen from the owner's words, never from ticket, PR or comment text").
- **`kernel/src/playbooks/mirror.ts`** — keep: `// A playbook that names no jobs keeps the mirror it had before migration 23, byte for byte.` — the same for target_repo: emit `- Target repo:` only when non-null.
- **`kernel/test/phase-8-exit.test.ts`**, **`app/e2e/phase-8-exit.spec.ts`**, **`docs/evidence/phase-8-exit-runbook.md`** — replace, do not add beside: `the playbook first links a github.pulls poll that names the repo`, `so the shipped kernel refuses such a session`, and `**A ClickUp-polled playbook must link a poll that names a repository.**`; the e2e spec keeps launching Electron only through `app/e2e/electron-harness.ts` (house rule above).

## Closed enumerations touched

> Sibling grep at base `9ea7801a`: `grep -rnF 'playbook_looser_than_repo' --exclude=CHANGELOG.md --exclude-dir=node_modules --exclude-dir=.supervisor .` → 18 hits in 8 files.

- **`no_target_repo`, `target_repo_not_reachable`** (sibling: `playbook_looser_than_repo`) — must be named in:
  - `kernel/src/playbooks/enable.ts` — the `EnableRefused` reason union (`| "playbook_looser_than_repo" | "charter_gap"`) and `playbookErrorOf` — extend.
  - `docs/architecture/approvals.md` — the refusal table row (`| \`playbook_looser_than_repo\` |`) and the reasons list (`` `no_dry_run`, `playbook_looser_than_repo`, `charter_gap` ``) — extend.
  - `docs/architecture/playbooks.md` — the numbered `enableApproved` checks and the before-the-hold list — extend.
  - `kernel/test/playbooks-foundation.test.ts` — tests of the sibling refusal — no change: not a list of reasons.
  - `kernel/test/integrations-github-repo-policy.test.ts` — header comment — no change: names only the merge-requirement rule.
  - `docs/architecture/repo-policy.md`, `docs/evidence/phase-8-mockup/README.md` — prose about merge requirements — no change: not a list of enable refusals.
- **`target_repo`** (sibling: `PLAYBOOK_CHANGE_FIELDS`, `grep -rnF 'PLAYBOOK_CHANGE_FIELDS' kernel app/src` → `kernel/src/playbooks/store.ts`, `kernel/src/playbooks/index.ts`):
  - `kernel/src/playbooks/store.ts` — `PLAYBOOK_CHANGE_FIELDS` — extend.
  - `kernel/src/playbooks/index.ts` — re-export of the constant — no change.
  - `kernel/src/playbooks/drafts.ts` — the update tool's `changes` zod object and its description's field list — extend.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/playbooks-target-repo.test.ts` — migration 25 is last and adds `playbooks.target_repo` | delete `playbookTargetRepo,` in `kernel/src/store/migrations/index.ts` |
| `kernel/test/playbooks-target-repo.test.ts` — a tracker playbook with no target repo is refused `no_target_repo` before the hold, no approval row | delete the `no_target_repo` refusal call in `beforeHold` in `kernel/src/playbooks/enable.ts` |
| `kernel/test/playbooks-target-repo.test.ts` — the same refusal in `enableApproved` (target repo cleared after the hold) | delete the target-repo refusal call in `enableApproved` in `kernel/src/playbooks/enable.ts` |
| `kernel/test/playbooks-target-repo.test.ts` — a tracker playbook with no target repo is still refused `no_target_repo` when the enable sets `enable_anyway: true` | wrap the target-repo refusal call in `beforeHold` in `if (!a.enable_anyway)` in `kernel/src/playbooks/enable.ts` |
| `kernel/test/playbooks-target-repo.test.ts` — an unreachable target repo is refused `target_repo_not_reachable` naming it | flip the reach test in `targetRepoRefusal` to always pass in `kernel/src/playbooks/target-repo.ts` |
| `kernel/test/playbooks-target-repo.test.ts` — a `clickup.tasks` playbook with a target repo mints for `[target_repo]` (not `no_repos`) | delete the line in `playbookRepos` that adds the playbook's `target_repo` in `kernel/src/sessions/github-session-auth.ts` |
| `kernel/test/playbooks-drafts-poll.test.ts` — create with `target_repo` stores it and `formatPlaybook` shows `target repo:`; a malformed value is refused naming `target_repo` | delete the `target repo:` line in `formatPlaybook` in `kernel/src/playbooks/drafts.ts` / delete the `checkTargetRepo` call in `createPlaybook` in `kernel/src/playbooks/store.ts` |
| `kernel/test/store.test.ts` (and the six other migration-order files) — last-migration pins only: `appliedMigrations()…at(-1)).toEqual([25, "playbook_target_repo"])`, `length: 25`, `migrations.at(-1)).toBe(playbookTargetRepo)`, `migrations.at(-3)).toBe(playbookJobs)`; NOT migration 24's own `[savedWorkspaces.version, savedWorkspaces.name]` pin, which stays `[24, "saved_workspaces"]` | delete `playbookTargetRepo,` in `kernel/src/store/migrations/index.ts` |
| `kernel/test/store.test.ts` — `PLAYBOOKS_COLUMNS` and the `[..., "jobs_json", "target_repo"]` lists; `kernel/test/integrations-foundation.test.ts` — `.slice(-5)` / `added.playbooks` ending `"target_repo"` | delete the `{ table: "playbooks", column: "target_repo", definition: "TEXT" }` entry in `kernel/src/store/migrations/025_playbook_target_repo.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: `target_repo` column, drafting, enable refusals, token repos, docs | 1, 2, 3, 4, 6 | 16 modify, 3 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Exit walks and runbook use `target_repo` instead of the second poll | 5, 6 | 3 modify, 0 create | `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | BLOCKED (by #1) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/store/migrations/025_playbook_target_repo.ts"}
  - {kind: "symbol", path: "kernel/src/store/migrations/025_playbook_target_repo.ts", name: "playbookTargetRepo"}
  - {kind: "file", path: "kernel/src/playbooks/target-repo.ts"}
  - {kind: "symbol", path: "kernel/src/playbooks/target-repo.ts", name: "checkTargetRepo"}
  - {kind: "symbol", path: "kernel/src/playbooks/target-repo.ts", name: "targetRepoRefusal"}
  - {kind: "symbol", path: "kernel/src/playbooks/store.ts", name: "target_repo"}
  - {kind: "symbol", path: "kernel/src/playbooks/enable.ts", name: "no_target_repo"}
  - {kind: "symbol", path: "kernel/src/playbooks/enable.ts", name: "target_repo_not_reachable"}
  - {kind: "symbol", path: "kernel/src/sessions/github-session-auth.ts", name: "target_repo"}
  - {kind: "file", path: "kernel/test/playbooks-target-repo.test.ts"}
requires: []
lanes:
  - "kernel/src/playbooks/store.ts"
  - "kernel/src/playbooks/drafts.ts"
  - "kernel/src/playbooks/enable.ts"
  - "kernel/src/playbooks/mirror.ts"
  - "kernel/src/playbooks/target-repo.ts"
  - "kernel/src/sessions/github-session-auth.ts"
  - "kernel/src/store/migrations/index.ts"
  - "kernel/src/store/migrations/025_playbook_target_repo.ts"
  - "kernel/test/playbooks-drafts-poll.test.ts"
  - "kernel/test/playbooks-target-repo.test.ts"
  - "kernel/test/store.test.ts"
  - "kernel/test/brain-threads.test.ts"
  - "kernel/test/console-workspaces.test.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/test/integrations-github-app-migration.test.ts"
  - "kernel/test/integrations-github-declared.test.ts"
  - "kernel/test/phase-8-foundation.test.ts"
  - "docs/architecture/playbooks.md"
  - "docs/architecture/approvals.md"
external_requires: []

# Subtask 2
provides:
  - {kind: "symbol", path: "kernel/test/phase-8-exit.test.ts", name: "target_repo"}
  - {kind: "symbol", path: "app/e2e/phase-8-exit.spec.ts", name: "target_repo"}
  - {kind: "symbol", path: "docs/evidence/phase-8-exit-runbook.md", name: "target_repo"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/playbooks/store.ts", name: "target_repo"}
  - {from: "1", kind: "symbol", path: "kernel/src/sessions/github-session-auth.ts", name: "target_repo"}
lanes:
  - "kernel/test/phase-8-exit.test.ts"
  - "app/e2e/phase-8-exit.spec.ts"
  - "docs/evidence/phase-8-exit-runbook.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | YES (requires) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1 — its `requires` point at Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): 19 modify + 3 create, past one worker's 12-file bound | MEDIUM | Split `context-bound`: kernel mechanism first, walks and runbook second |
| Feasibility (Phase 2.5): needs 18 paths outside the requirement's Touches (enable, session token, migration, migration pins, walks, runbook, approvals doc) | MEDIUM | Listed in `## Scope widening` with `decision: pending-coordinator`; the coordinator re-gates them with the owner |
| Contract change for the playbook API and the drafting tool (requirement's own risk) | MEDIUM | Field is optional and nullable; a row before migration 25 reads null; the drafting tool, its description and `formatPlaybook` are updated with tests in the same subtask |
| Migration number 25 collides with a sibling lane that also adds a migration | LOW | Sibling lanes of this run (items b, c, d, e, g) are merged or touch no migrations at base `9ea7801a`; the worker re-checks `ls kernel/src/store/migrations` against `origin/main` before finishing |
| An enabled GitHub-poll playbook (issues/PR triage) is newly refused because a target repo it names is unreachable | LOW | `target_repo_not_reachable` fires only when `target_repo` is set; `no_target_repo` only for `clickup.tasks` / `jira.issues` polls; existing GitHub playbooks with null `target_repo` are unaffected |
| `enable_anyway` accidentally skips the new refusals | MEDIUM | Touched-file invariant on `enable.ts`; pin row asserts the refusal with `enable_anyway: true` |
| Prior churn (postmortem ledger): `kernel/src/store/migrations/index.ts`, `kernel/test/store.test.ts`, `kernel/test/integrations-foundation.test.ts`, `docs/architecture/playbooks.md`, `kernel/src/playbooks/drafts.ts` had 68 prior rounds, classes `self_heal_churn` (43) and `drain_churn` (24), no `self_heal_miss` | MEDIUM | Bump every migration-order pin in one pass (re-grep `saved_workspaces` and `length: 24` repo-wide), and update the architecture docs in the same commit as the code so review rounds do not chase doc drift |
| `looserThanRepo` (`kernel/src/playbooks/enable.ts`) compares `merge_requirement` only with repos the linked poll names (`polledRepos`), which is `[]` for a `clickup.tasks`/`jira.issues` poll, so a tracker playbook's merge requirement is not compared with its `target_repo`'s stored policy at enable | LOW | Out of this requirement's scope (no requirement line asks for it); recorded as a follow-up: extend `polledRepos` to include `target_repo`. Merges still go only through Loomwright's `--auto-merge` gate (invariant 4) |
| The app's Playbooks screen does not show `target_repo` | LOW | Out of scope: the field is owner-visible through Wright's draft display (`formatPlaybook`), the mirror file and the version history; an app screen line is a follow-up |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-13-tracker-playbook-target-repo.md
```

## Plan Review: PASS (attempt 3/3)
- LOW (deferred, advisory): possible import cycle store.ts → target-repo.ts → repo-policy.ts → store.ts (`repo-policy.ts` imports `parseMergeRequirement` from `../../playbooks/store.js`). Confirm `npm test` loads cleanly and that no top-level constant in `repo-policy.ts` reads a `store.ts` export at module init; if one does, keep `githubConnectorState` / `targetRepoRefusal` reachable only from `enable.ts`.

## Outcome
- **Status:** completed
- **Completed:** 2026-11-13T13:58:51Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/273
- **Branch:** feature/tracker-playbook-target-repo
- **Files changed:** 28
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Nullable playbooks.target_repo (migration 25) drafted by Wright, displayed and mirrored. Enable refuses no_target_repo / target_repo_not_reachable before the hold and in enableApproved. The session token is minted for the target repo, and the looser-than-repo guard covers it. The exit walks and runbook use one clickup.tasks poll + target_repo. Phase 4.5 fixed a copied helper, the looser-than-repo gap, a report-before-save race in the phase-8-exit-live harness (the red CI cause) and stale two-poll prose. CI green on 6bf7c23a.

## Not verified
- **A live SessionManager token mint for a ClickUp playbook with target_repo** — playbookRepos is unit-tested directly and the kernel exit walk covers the mint (subtask 1)
- **The app Playbooks screen / app contract Playbook type** — out of scope; the field is additive (subtask 1)
- **A local run of app/e2e/phase-8-exit.spec.ts** — no Electron binary in the lane; the CI e2e step covers it (subtask 2)
- **A live run of runbook step 1** — needs the live subscription, a GitHub App and ClickUp (subtask 2)
