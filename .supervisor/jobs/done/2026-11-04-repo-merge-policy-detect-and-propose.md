# Supervisor Job: Repo merge policy — detect, propose, one-click accept (phase 8 item 08)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-02-150636/L7
- **CLAUDE.md:** ✓ Found (fresh — phases and paths it names exist)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (the source requirement is under the gitignored `.supervisor/`, so its provenance cannot be checked in git)
- **Source requirement:** .supervisor/requirements/phase-8/2026-11-02-160008-repo-merge-policy-detect-and-propose.md
- **Base commit:** c3e766a0a2821db7fd45822d82d501bca0b8a38c

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest, better-sqlite3) and React app; nothing new needed |
| 2 | Dependency Availability | GO | Only GitHub REST GETs (`isAllowedGitHubRequest` allows every GET); no new package |
| 3 | Architecture Fit | GO | The seams already exist: the empty `repoPolicyPart`, the `repo_policies` table (migration 20), contract types and the three `p8-item-08` routes |
| 4 | Scope vs Supervisor Capability | CAUTION | About 40 files (kernel, app fixtures, docs), so `context-bound` → 2 subtasks |
| 5 | Hard Blockers | CAUTION | The requirement's Touches missed the files `merge_requirement`'s storage forces. The owner chose "Extend Touches" (Launch Pad, 2026-11-04); see `## Touches extension (owner-approved)` |

**Overall Verdict:** CAUTION

## Task
**Goal:** Each repo carries a merge policy (Solo, Approve in Studio, or N GitHub reviews). The kernel detects it from GitHub's real state and proposes it, and the owner sets it through owner-only routes. `policyMet` answers whether a PR at a head SHA meets it, and a playbook's own `merge_requirement` may only be stricter.

**Problem Statement:**
The owner needs each repo to carry its own merge policy, proposed from the repo's real state and accepted in one click, so that a solo repo can merge automatically and a team repo waits for its reviews, without configuring each playbook.
Currently nothing in the kernel records how a repo's PRs may merge. `repoPolicyPart` is empty, nothing writes `repo_policies`, and the three `p8-item-08` routes are declared in the contract but not served. Items 09 and 10 cannot decide whether to ask Loomwright's gate to merge, and repos where GitHub can't enforce protection (studio-sandbox: private on GitHub Free, 403) have no path.
Success looks like this: detection and a proposal for every reached repo, owner routes that set a policy, a `policyMet` that items 09 and 10 can call, and an enable that refuses a playbook looser than its repo. All of it is tested against the GitHub fake, with no kernel code merging anything (invariant 4).

### Design decisions this brief fixes (worker follows; each is grounded below)
1. **Narrow reader interface, not `GitHubClient`.** The new reads go on a new `GitHubRepoPolicyReads` interface in `kernel/src/integrations/types.ts`. `createGitHubClient` returns `GitHubClient & GitHubRepoPolicyReads`, and `FakeGitHubClient` implements both. `GitHubClient` itself is unchanged, so `kernel/test/triggers-poll.test.ts`'s `class HookedClient implements GitHubClient` still compiles; the owner was told this on 2026-11-04. Reads (all GET; the `GITHUB_ALLOWED_NON_GET` list stays unchanged):
   - `getRepoInfo(repo)`: `GET /repos/{r}` → `{default_branch, private}`.
   - `getBranchProtection(repo, branch)`: `GET /repos/{r}/branches/{b}/protection` → `{required_approving_review_count: number|null, required_checks: string[]}`. A 403 or 404 arrives as `http_error` with its status, as `sendRequest` already returns it.
   - `listPushCollaborators(repo)`: `GET /repos/{r}/collaborators?permission=push`, paged by the existing `getPages` → logins.
   - `getPullMergeState(repo, number)`: the pull's current head SHA, plus approvals counted as distinct reviewers whose latest review is `APPROVED` with `commit_id` equal to the head. A latest `CHANGES_REQUESTED` sets `changes_requested: true`. CI comes from the head's combined status and check runs: `green` (every check finished `success`/`neutral`/`skipped` and the combined state is `success`, or there are no statuses), `pending`, `failing` or `none` (no check runs and no statuses at all).

   Every read answers `unreachable()` for a bad repo path and never throws, like its siblings.
2. **Detection** (`kernel/src/integrations/github/repo-policy.ts`, `detectRepoPolicy(store, repo, deps)`):
   - It reads the repo info, the default branch's protection and the push collaborators.
   - It records `protection` as `protected`, `unprotected` (404), `protection_unavailable` (403) or `unreadable` (anything else), with `required_reviews`, `required_checks`, `pushers`, `default_branch`, `private` and `read_at`.
   - It upserts `repo_policies.detected_json` and never touches `policy_kind`, `required_reviews`, `trust_unprotected`, `set_by` or `set_at` on an existing row.
   - **A detected repo with no policy** is stored with `policy_kind = 'unset'`, because `policy_kind` is `NOT NULL` (migration 20) and detection needs a row to live on. `unset` is closed in code beside the three kinds (`REPO_POLICY_ROW_KINDS = ["unset", "solo", "studio_approval", "reviews"]`) and always reads as `kind: null` and `no_policy`, the same as no row. The 020 migration and its comment are not edited (append-only).
3. **Proposal** (`proposeRepoPolicy(detection)`, pure). It returns `{kind, required_reviews, choices}`, or `null` when nothing applies:
   - `protection_unavailable` → `{kind: null, required_reviews: null, choices: ["make_public_or_upgrade", "trust_unprotected", "safe_mode"]}`, none picked.
   - `required_reviews ≥ 1` → `reviews` with N from GitHub (checked first).
   - Only the repo owner (the `<owner>` of `<owner>/<repo>`) can push and `required_checks` is non-empty → `solo`.
   - `unprotected` with any other pusher → `studio_approval`.
   - Anything else (unreadable, unprotected solo, protected with no checks and no reviews) → `null`.

   The kernel never applies it.
4. **Owner routes** (`kernel/src/integrations/github/repo-policy-routes.ts`, served by `repoPolicyPart` in `index.ts`):
   - `GET /repos/policy` → `{repos: RepoPolicy[]}`. Its repos are the union of the GitHub connector's reachable repos and the `repo_policies` rows, each with `detected`, `proposal` and its set policy.
   - `POST /repos/policy/:owner/:repo/detect` → the `RepoPolicy` after a fresh detection. A path segment failing `NAME_SEGMENT` answers 400 `invalid_repo`.
   - `POST /repos/policy/:owner/:repo` with `{kind, required?, trust_unprotected?}`:
     - `kind` must be one of the closed `RepoPolicyKind`s.
     - `reviews` needs `required` as a whole number ≥ 1; the other kinds refuse `required`.
     - `trust_unprotected` is an optional boolean.

     It writes `set_by = 'owner'` and `set_at = now` (who trusted it and when, Scope 5).

   Every handler catches everything and answers a typed error, like `github/routes.ts`'s `total`. **No agent tool** is added: `repoPolicyPart.tools` stays `[]`.
5. **`policyMet(repo, pr, head_sha, deps, playbookRequirement?)`** → `{met: true}` or `{met: false, reason}`, with `reason` one of `no_policy | head_moved | ci_not_green | awaiting_owner_approval | reviews_short | changes_requested | unreadable`. It re-reads GitHub on every call (no cache). When GitHub's head ≠ `head_sha`, the answer is `head_moved`.
   - **Solo:** met when CI is `green`.
   - **`studio_approval`:** met when an `approvals` row has `action = 'kernel_merge_approval_request'` (exported as `MERGE_APPROVAL_ACTION` for item 09), `status = 'approved'`, and a payload whose `repo`, `pr` and `head_sha` match.
   - **`reviews`:** met when approvals at the head are ≥ `required_reviews` and nothing requests changes.
   - **`playbookRequirement`** adds its own condition on top: `studio_approval` adds the approval check, and `reviews:N` adds max(N, repo N).

   The repo's `trust_unprotected` is exposed as `loomwrightMergeFlags(store, repo)` → `["--trust-unprotected"]` or `[]`, for item 09 only.
6. **`merge_requirement`** is a new playbook policy field, appended after `mode` in `PLAYBOOK_POLICY_FIELDS`.
   - **Storage:** migration 021 adds the TEXT columns `merge_requirement` and `merge_requirement_set_by`.
   - **Values:** `none`, `studio_approval` or `reviews:<N>` (N ≥ 1), closed in `playbooks/types.ts` as `MERGE_REQUIREMENT_KINDS`. The kernel ships no default (null until set).
   - **Clearing:** like `priority` and `mode`, it cannot be cleared once set, because `none` is a value here, not `CLEAR_VALUE`.
   - **Who sets it:** Wright may propose it in a draft; the owner sets it, and it is owner-locked like the other fields.
   - **The looser rule:** a playbook is looser than its repo when its requirement is `reviews:N` and that repo's policy is `reviews` with `required_reviews > N`. Its repos are the `repos` of its linked poll trigger (`linkedTriggerOf`). The enable is refused `playbook_looser_than_repo` both at the tool's pre-hold check (nothing held) and in `enableApproved` (the approval's `apply_refused`).
   - **App:** `READ_ONLY_POLICY_FIELDS` becomes `["mode", "merge_requirement"]`, and a `mergeRequirementPolicyRow(playbook)` row helper shows it (not set / value / provenance). Item 13 makes it editable.

## Acceptance Criteria
- [ ] AC1: Given the fake GitHub answers `getBranchProtection` with `http_error` 403 for a private repo, when the owner calls `POST /repos/policy/o/r/detect`, then `detected_json` records `protection: "protection_unavailable"`, and the answer's `proposal` is `{kind: null, required_reviews: null, choices: ["make_public_or_upgrade", "trust_unprotected", "safe_mode"]}` with no policy set (`kind: null`).
- [ ] AC2: Given protection requiring 2 approving reviews, when detection runs, then the proposal is `{kind: "reviews", required_reviews: 2}`. Given protection requiring check `ci` and only the repo owner as a push collaborator, then it is `{kind: "solo"}`. Given a 404 (unprotected) and another pusher, then it is `{kind: "studio_approval"}`. No case writes `policy_kind` other than `unset`.
- [ ] AC3: Given no `repo_policies` row (or a row with `policy_kind = 'unset'`), when `policyMet("o/r", 7, sha)` runs, then it answers `{met: false, reason: "no_policy"}` and makes no GitHub call.
- [ ] AC4: Given a `reviews` policy with `required_reviews: 2` and the fake reporting 1 approval at head `A`, then `policyMet(…, "A")` is `{met: false, reason: "reviews_short"}`. At 2 approvals it is `{met: true}`. After the fake's head moves to `B` (approvals at `B`: 0), `policyMet(…, "A")` answers `head_moved` and `policyMet(…, "B")` answers `reviews_short`. The fake records a fresh `getPullMergeState` call each time (no cache).
- [ ] AC5: Given a `solo` policy, `policyMet` is met only when CI is `green` (`pending`, `failing` and `none` → `ci_not_green`). Given `studio_approval`, it is met only when an approved `kernel_merge_approval_request` approval exists for that repo, PR and head SHA (a different head → `awaiting_owner_approval`).
- [ ] AC6: Given `POST /repos/policy/o/r` with `{kind: "reviews", required: 2}`, then the row reads `reviews`, 2, `set_by: "owner"` and `set_at` = now. `{kind: "reviews"}` without `required`, `{kind: "solo", required: 1}` and `{kind: "other"}` each answer 400 and change nothing. `{kind: "studio_approval", trust_unprotected: true}` is recorded, and `loomwrightMergeFlags(store, "o/r")` answers `["--trust-unprotected"]` (another repo: `[]`).
- [ ] AC7: Given a playbook with `merge_requirement` `reviews:1` whose poll trigger names `o/r`, and `o/r`'s policy is `reviews` with 2, when its enable is requested, then the tool refuses `playbook_looser_than_repo` with nothing held. When the repo's policy is raised to 2 after the enable was held, `enableApproved` refuses with `apply_refused: "playbook_looser_than_repo"` and the playbook stays draft. `reviews:2`, `reviews:3`, `studio_approval` and `none` are not refused.
- [ ] AC8: Given an agent session (the merged shipped contributions' tool list), then no tool's name or description sets or changes a repo policy. `repoPolicyPart.tools` is `[]`, and the three routes are served only as owner routes.
- [ ] AC9: Given `PLAYBOOK_POLICY_FIELDS` ending `"mode", "merge_requirement"`, then the app's `READ_ONLY_POLICY_FIELDS` is `["mode", "merge_requirement"]`. `console-contract.test.ts`'s combined-list pin (`expect([...edited, ...shown]).toEqual([...PLAYBOOK_POLICY_FIELDS]);`) passes unchanged, its `shown` pin (`expect(shown).toEqual(["mode"]);`) becomes `["mode", "merge_requirement"]`, and `PlaybookPolicy.test.tsx` shows the `mergeRequirementPolicyRow`: "not set" when null, and the value with "proposed" / "set by owner" provenance.
- [ ] AC10: Given `studio playbooks set <id> merge_requirement reviews:2` (and the `set` route), then it is stored with `merge_requirement_set_by: "owner"`. `reviews:0`, `reviews:x`, `other` and `none`-as-clear on a set value are refused `invalid_input` naming the field, and a later agent edit of it is refused like the other owner-locked fields.
- [ ] AC11: Given the shipped composition, then `console-contract.test.ts` pins all three `p8-item-08` routes as served, `phase-8-foundation.test.ts` pins `repoPolicyPart` with exactly those three routes and no due work, and `docs/architecture/repo-policy.md` says what is built (no "will" sentences left for item 08's scope).
- [ ] AC12: Validation passes: `cd kernel && npm ci && npm run typecheck && npm test`, `cd app && npm ci && npm run typecheck && npm test`, `bash scripts/check-docs.sh`.

## Touches extension (owner-approved)

The owner chose **"Extend Touches (Recommended)"** at Launch Pad on 2026-11-04, when told that `merge_requirement` (Scope 4b) needs a stored column and that this forces files outside the requirement's Touches. Approved by name: a new migration 021 file, `kernel/src/store/migrations/index.ts`, `kernel/test/store.test.ts`, `kernel/src/playbooks/mirror.ts`, `docs/ARCHITECTURE.md`, and the app test fixtures that build a `PlaybookListing` (`app/src/screens/chat/testkit.tsx`, `app/src/screens/chat/cards.test.tsx`, `app/src/screens/playbooks/model.test.ts`, `app/src/screens/playbooks/PlaybooksScreen.test.tsx`, `app/src/screens/schedules/SchedulesScreen.test.tsx`, `app/src/screens/schedules/AllHistory.test.tsx`, `app/src/screens/approvals/ApprovalsScreen.test.tsx`, `app/src/screens/budget/BudgetScreen.test.tsx`). The same class also covers the typed e2e fixtures that build a `PlaybookListing`, because `app/tsconfig.node.json` includes `e2e` in `npm run typecheck`: `app/e2e/fixtures/chat.ts`, `app/e2e/fixtures/schedules.ts`, `app/e2e/fixtures/budget.ts` and `app/e2e/fixtures/playbooks.ts`.

**Found after the owner's answer, in the same class (each a pin or closed list the approved migration or refusal forces; listed here so nothing is patched silently):**
- Migration-list pins (the approved migration 021 forces each):
  - `kernel/test/integrations-github-app-migration.test.ts`: the at(-1/-2/-3) and length-20 checks at lines 60–63, and `.at(-1)` as `[20, "phase_8_foundation"]` twice.
  - `kernel/test/integrations-github-declared.test.ts`: `expect(migrations.at(-3)).toBe(connectorPermissionsSource);` and `Array.from({ length: 20 }, (_, i) => i + 1)`.
  - `kernel/test/phase-8-foundation.test.ts`: `expect(migrations.at(-1)).toBe(phase8Foundation)`, the length-20 list, and `.at(-1)).toEqual([20, "phase_8_foundation"])`. This file is already in the requirement's Touches.
- `docs/architecture/approvals.md`: its `apply_refused` table lists every enable refusal. A worker that finds any other file it must edit **stops and says so**; it does not patch it.

Not edited: `kernel/test/triggers-poll.test.ts` (design decision 1 avoids it), `kernel/src/integrations/github/connector.ts`, `kernel/src/store/migrations/020_phase_8_foundation.ts` (append-only), and the app screens (`PlaybookEdit.tsx`, `cards.tsx`, `PlaybooksScreen.tsx`; widening `KernelPolicyField` is type-compatible there, and item 13 wires editing).

## Touched-file invariants

> Grounded at base `c3e766a0a2821db7fd45822d82d501bca0b8a38c`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/integrations/github/client.ts`**
  - keep: the GET-only rule `if (method === "GET") return true;`, and `GITHUB_ALLOWED_NON_GET` with exactly its five entries (`MINT_REQUEST`, `CONVERT_REQUEST`, `REPLY_REQUEST`, `COMMENT_REQUEST`, `REVIEWERS_REQUEST`). Keep never-throw: a bad repo returns `unreachable()` (`if (r === undefined) return unreachable();`).
  - reuse: `repoPath(repo)`, `getPages(...)` and `begin()` (one session per walk, as `listOpenPullComments` does: `// One session for the whole walk`).
  - mirror: the `http_error` with `status`, which `sendRequest` produces (`failure: limited ?? { ok: false, error: "http_error", status: res.status, rateLimit }`). Detection maps 403/404 from it.
  - pinned by: `kernel/test/integrations-github-client.test.ts` (`const METHODS:`, which stays the nine `GitHubClient` reads).
- **`kernel/src/integrations/types.ts`**
  - keep: `export interface GitHubClient {` with exactly its current members (adding one breaks `kernel/test/triggers-poll.test.ts`'s `class HookedClient implements GitHubClient`, outside this brief).
  - The new `GitHubRepoPolicyReads` is a separate exported interface, re-exported from `integrations/index.ts`'s type list.
- **`kernel/src/integrations/index.ts`**
  - keep: the part order `githubConnectorPart, githubRoutesPart, githubToolsPart, draftsPart, mcpPart, repoPolicyPart, githubAppRoutesPart`, with `githubAppRoutesPart` last (`githubAppRoutesPart` stays last). The CLI-safe import rule: never the Agent SDK, `sessions/manager` or `kernel.js`.
  - `repoPolicyPart` moves to `github/repo-policy-routes.ts` (built like `githubRoutesPart`: `name: "repo-policy"`, `tools: Object.freeze([])`) and is re-exported from here. Update the header comment's "`repo-policy` … is defined here because it has no files of its own yet".
  - pinned by: `kernel/test/integrations-foundation.test.ts` (`"mcp", "repo-policy", "github-app-routes"`) and `kernel/test/phase-8-foundation.test.ts` (`expect(repoPolicyPart.routes).toEqual([]);`, which flips to the three routes).
- **`kernel/test/fixtures/github-fake.ts`**
  - keep: "Answers are copies" (`structuredClone(data())`) and every call recorded in `calls`.
  - mirror: `export type GitHubCallName = keyof GitHubClient;` widens to `keyof (GitHubClient & GitHubRepoPolicyReads)`, so `failures` can fail a new read.
  - The canned data gains per-repo protection (or failure status), pushers, repo info and per-pull merge state, and the merge state must be mutable mid-test (AC4's head move).
- **`kernel/src/playbooks/store.ts`**
  - keep: `const POLICY_COLUMNS` (one value column and one set-by column per field), `checkPolicyValue`'s `allowClear` owner/agent split, and `CLEAR_VALUE`.
  - extend `parseOwnerPolicyValue` and `checkPolicyValue` with a `case "merge_requirement"`, and the create INSERT column list (`token_limit_per_day, token_limit_set_by,`).
  - pinned by: `kernel/test/playbooks-drafts.test.ts` (`'studio playbooks set: unknown field "nope" (one of dedupe_key, priority, model, token_limit, mode)\n'`, which gains `, merge_requirement`).
- **`kernel/src/playbooks/drafts.ts`**
  - keep: Wright only proposes (`every policy value you give (dedupe_key, priority, model, token_limit, mode) is a proposal the owner can change`; extend the list).
  - reuse: the zod field pattern (`token_limit: z.number().int().positive().optional(),`).
  - extend: the summary line pattern (`  token limit per day: ${policyText(`).
- **`kernel/src/playbooks/enable.ts`**
  - keep: the closed union `readonly reason: "not_found" | "crew_cannot_draft" | "not_owner" | "turned_off_by_owner" | "not_draft" | "version_changed" | "no_dry_run";` (extend it).
  - The pre-hold check returns `{ refuse: … }` with "(nothing was held for the owner)", as `refuse: \`${ENABLE_TOOL_NAME}: a dry run of version` does.
  - extend: the mapping `if (err.reason === "version_changed" || err.reason === "no_dry_run")` gives the new reason its own `PlaybookError` / `invalid` text, and `enableDisplay` gains a `valueLine("merge_requirement", …)`.
- **`kernel/src/playbooks/mirror.ts`**
  - keep: one policy line per field (`policyLine("Mode", row.mode, row.mode_set_by),`); add `policyLine("Merge requirement", …)` after it.
- **`kernel/src/store/migrations/index.ts`**
  - keep: "Append only; never edit a shipped one."; append the 021 migration after `phase8Foundation`.
  - The migration adds only nullable TEXT columns with no SQL CHECK and no trigger (`Creates no SQL trigger: the integrity check refuses any trigger the kernel does not list.`).
- **`app/src/api/contract.ts`**
  - keep: `export type RepoPolicyKind = "solo" | "studio_approval" | "reviews";` byte-for-byte (pinned by `kernel/test/phase-8-foundation.test.ts`'s `toContain`), and the three `{ method: …, path: "/repos/policy…", origin: "p8-item-08" }` entries.
  - add: `RepoPolicy.proposal` and its `RepoPolicyProposal` type, plus `Playbook.merge_requirement` / `merge_requirement_set_by` (required, `string | null`).
- **`app/src/components/PlaybookPolicy/PlaybookPolicy.tsx`**
  - keep: `export const POLICY_FIELDS = ["dedupe_key", "priority", "model", "token_limit"] as const;` unchanged (Chat's card edits exactly these).
  - change: `READ_ONLY_POLICY_FIELDS` to `["mode", "merge_requirement"]`.
  - reuse: `modePolicyRow`'s shape and `provenance`.
  - pinned by: `kernel/test/console-contract.test.ts`: `expect([...edited, ...shown]).toEqual([...PLAYBOOK_POLICY_FIELDS]);` (unchanged), and `expect(shown).toEqual(["mode"]);` (Subtask 2 extends it to `["mode", "merge_requirement"]`).
- **`app/e2e/fixtures/playbooks.ts`**: its fake kernel's `parsed` field check (`field must be one of dedupe_key, priority, model, token_limit, mode`) is left as is (no change). The e2e fake keeps refusing an edit of a read-only field, and item 13 makes it editable. Only `playbookRow`'s defaults gain the two contract fields (null).
- **Migration-list pins (Subtask 2, all extend to migration 21):**
  - `kernel/test/store.test.ts`: `[20, "phase_8_foundation"],` in the full list; `.at(-1)` at its three re-run checks (`expect(rerun.appliedMigrations().map((m) => [m.version, m.name]).at(-1)).toEqual([20, "phase_8_foundation"]);`); and `expect(err.knownVersion).toBe(20)`.
  - `kernel/test/integrations-foundation.test.ts`: the at(-3/-2/-1) checks around `expect([phase8Foundation.version, phase8Foundation.name]).toEqual([20, "phase_8_foundation"]);`, and every `.at(-1)).toEqual([20, "phase_8_foundation"])`. Its v16 upgrade test's `const added: Record<string, string[]> = { playbooks: ["mode", "mode_set_by"]` gains the two migration 21 columns.
  - `kernel/test/integrations-github-app-migration.test.ts`, `kernel/test/integrations-github-declared.test.ts` and `kernel/test/phase-8-foundation.test.ts`: the lines listed in `## Touches extension (owner-approved)`.
- **`kernel/src/playbooks/types.ts`**
  - keep: the module is types and closed lists only, with no runtime import beyond `import type` ("Types only, plus the lists"); the CLI loads it.
  - add `MERGE_REQUIREMENT_KINDS` beside its sibling closed list `export const PLAYBOOK_MODES = Object.freeze(["draft", "live"] as const);`, in the same `Object.freeze([...] as const)` form with its derived type.
  - consumed by: `kernel/src/playbooks/store.ts` (`checkPolicyValue`'s new case and `parseOwnerPolicyValue`) and `kernel/src/playbooks/enable.ts` (the looser check).
- **`app/src/components/PlaybookPolicy/PlaybookPolicy.test.tsx`**: `expect(READ_ONLY_POLICY_FIELDS).toEqual(["mode"]);` becomes `["mode", "merge_requirement"]`.
- **`docs/ARCHITECTURE.md`**: Subtask 2 updates the `repo_policies` data-model row (``| `repo_policies` | the merge policy the owner set per repo``). The policy kind list gains `unset` (detected, no policy), and "empty until phase 8 item 08" is dropped. It also adds migration 21 and `playbooks.merge_requirement` / `merge_requirement_set_by`.
- **`kernel/test/playbooks-drafts.test.ts`**: the exact mirror Policy listing (the lines after `Mode`) gains the `Merge requirement` line `mirror.ts` adds.
- **Test pins edited as their pinned behaviour changes, not as new tests:**
  - `kernel/test/console-contract.test.ts`: `expect(servedBy("p8-item-08")).toEqual([]);` becomes the three routes, plus the `it(` titles.
  - `kernel/test/integrations-foundation.test.ts`: the routes list gains `"integrations GET /repos/policy"` and the two POSTs; the file list gains `"github/repo-policy-routes.ts", "github/repo-policy.ts"`; `expect(columnsOf(store, "playbooks").slice(-2)).toEqual(["mode", "mode_set_by"]);` is re-anchored so it still asserts migration 17's two columns.
  - `kernel/test/store.test.ts`: `const PLAYBOOKS_COLUMNS` and `[20, "phase_8_foundation"],`.
  - `kernel/test/integrations-github-app-migration.test.ts`: `.toEqual([20, "phase_8_foundation"])` becomes the 021 tuple.

## Closed enumerations touched

> Sibling grep at base `c3e766a`: `grep -rnF '"token_limit"' kernel/src kernel/test app/src docs` → 22 hits in 10 files. `grep -rnF 'no_dry_run' kernel/src app/src docs kernel/test` → 9 hits in 4 files.

- **`merge_requirement`** (sibling: `token_limit`), which must be named in:
  - `kernel/src/playbooks/store.ts`: `PLAYBOOK_POLICY_FIELDS` (`["dedupe_key", "priority", "model", "token_limit", "mode"]`), `POLICY_COLUMNS`, the `checkPolicyValue` switch (`case "token_limit":`), `parseOwnerPolicyValue`, and the create INSERT. Extend.
  - `kernel/src/playbooks/enable.ts`: `enableDisplay`'s `valueLine("token_limit", …)` list. Extend.
  - `kernel/src/playbooks/drafts.ts`: the zod schema, the tool description's field list and the CLI summary lines. Extend.
  - `kernel/src/playbooks/mirror.ts`: the policy lines. Extend.
  - `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx`: `READ_ONLY_POLICY_FIELDS`. Extend.
  - `kernel/test/playbooks-drafts.test.ts`: the unknown-field message's list. Extend.
  - `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx` `POLICY_FIELDS` and `app/src/screens/playbooks/PlaybookEdit.tsx` `settable(...)`: no change, because they are the editable subset and this field is read-only until item 13.
  - `app/src/screens/chat/cards.test.tsx` and `app/src/screens/playbooks/PlaybooksScreen.test.tsx` `token_limit` hits: no change, because they exercise the editable rows only (the fixtures in these files still gain the two contract fields).
  - `kernel/test/phase-3-exit.test.ts`: no change, a CLI `set token_limit` call.
- **`playbook_looser_than_repo`** (sibling: `no_dry_run`), which must be named in:
  - `kernel/src/playbooks/enable.ts`: the `EnableRefused["reason"]` union. Extend.
  - `docs/architecture/approvals.md`: the `apply_refused` table (`| \`no_dry_run\` |`) and the list sentence (`` `version_changed`, `no_dry_run` and the playbook case of `not_found` are the enable's``). Extend.
  - `docs/architecture/playbooks.md`: the numbered enable checks (`7. the current version has a \`done\` dry run (\`no_dry_run\`).`). Extend with an 8th.
  - `kernel/test/approvals.test.ts`: no change, because it uses `no_dry_run` as sample data only.
- **Migration 021** (sibling: `phase8Foundation`), which must be named in:
  - `kernel/src/store/migrations/index.ts`: the `migrations` array. Extend.
  - `kernel/test/store.test.ts`, `kernel/test/integrations-foundation.test.ts`, `kernel/test/integrations-github-app-migration.test.ts`, `kernel/test/integrations-github-declared.test.ts` and `kernel/test/phase-8-foundation.test.ts`: `migrations.at(-N)`, `length: 20` and `[20, "phase_8_foundation"]` pins. Extend each, by the grep `grep -rnE 'migrations\.at\(|length: 20|\[20, "phase_8_foundation"\]|knownVersion\)\.toBe\(20' kernel/test`.
- **New closed sets with no sibling:**
  - `REPO_POLICY_ROW_KINDS` (`unset` plus the three kinds), `MERGE_REQUIREMENT_KINDS` and the `policyMet` reasons: all in their new modules or `playbooks/types.ts`.
  - The detection `protection` values and the proposal `choices`: in `repo-policy.ts` and mirrored in `app/src/api/contract.ts`.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/integrations-github-repo-policy.test.ts` — AC1 choices on 403 | flip `"protection_unavailable"` → `"unreadable"` in `kernel/src/integrations/github/repo-policy.ts` |
| `kernel/test/integrations-github-repo-policy.test.ts` — AC3 no_policy | flip `"unset"` → `"solo"` in `kernel/src/integrations/github/repo-policy.ts`'s `no_policy` guard |
| `kernel/test/integrations-github-repo-policy.test.ts` — AC4 head_moved re-read | delete the `head_moved` return line in `kernel/src/integrations/github/repo-policy.ts` |
| `kernel/test/integrations-github-repo-policy.test.ts` — AC8 no agent tool | flip `tools: Object.freeze([])` → `tools: Object.freeze([repoPolicySetTool])` in `kernel/src/integrations/github/repo-policy-routes.ts` (reviewer applies by hand) |
| `kernel/test/playbooks-foundation.test.ts` — AC7 looser refusal | delete the `playbook_looser_than_repo` throw line in `kernel/src/playbooks/enable.ts` |
| `kernel/test/console-contract.test.ts` — editor field pin | flip `["mode", "merge_requirement"]` → `["mode"]` in `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx` |
| `app/src/components/PlaybookPolicy/PlaybookPolicy.test.tsx` — `READ_ONLY_POLICY_FIELDS` pin | flip `["mode", "merge_requirement"]` → `["mode"]` in `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx` |
| `kernel/test/console-contract.test.ts` — item 08 routes served | delete `routes: repoPolicyRoutes(),` in `kernel/src/integrations/github/repo-policy-routes.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | GitHub reads, detection, proposal, `policyMet` and the owner routes | AC1, AC2, AC3, AC4, AC5, AC6, AC8, AC11, AC12 | 10 modify, 3 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | Playbook `merge_requirement` field, migration 021, `playbook_looser_than_repo` and the app editor row | AC7, AC9, AC10, AC12 | 33 modify, 1 create | `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| 1 github-reads | `kernel/src/integrations/github/client.ts` (972: the single owner of `sendRequest`/`getPages` and the request allowlist; the four reads must use its private helpers), `kernel/src/integrations/types.ts` (393), `kernel/test/fixtures/github-fake.ts` (166), `kernel/test/integrations-github-client.test.ts` (1607: its `client()`/`json()` fetch harness is the one place request URLs and status mapping are pinned; the reads' tests reuse it rather than copy it) | — | HIGH |
| 1 repo-policy | `kernel/src/integrations/index.ts` (123), `app/src/api/contract.ts` (1612: the single app↔kernel contract; adds `RepoPolicyProposal` beside `RepoPolicy`), `kernel/test/console-contract.test.ts` (313), `kernel/test/phase-8-foundation.test.ts` (655: pin edit only, no new responsibility), `kernel/test/integrations-foundation.test.ts` (921: pin edit only), `docs/architecture/repo-policy.md` (24) | `kernel/src/integrations/github/repo-policy.ts` (detection, proposal, `policyMet`, `getRepoPolicy`, `loomwrightMergeFlags`), `kernel/src/integrations/github/repo-policy-routes.ts` (the three routes and `repoPolicyPart`), `kernel/test/integrations-github-repo-policy.test.ts` | HIGH |
| 2 storage | `kernel/src/store/migrations/index.ts` (47), `kernel/test/store.test.ts` (2167: pin edit only), `kernel/test/integrations-github-app-migration.test.ts` (148: pin edit only), `kernel/test/integrations-github-declared.test.ts` (694: pin edit only, no new responsibility), `kernel/test/phase-8-foundation.test.ts` (655: pin edit only), `kernel/test/console-contract.test.ts` (313: the `shown` pin), `kernel/test/integrations-foundation.test.ts` (921: pin edit only), `docs/ARCHITECTURE.md` (322) | `kernel/src/store/migrations/021_playbook_merge_requirement.ts` | HIGH |
| 2 playbooks | `kernel/src/playbooks/types.ts` (71), `kernel/src/playbooks/store.ts` (745: `POLICY_COLUMNS`/`checkPolicyValue` are the single authority for policy fields), `kernel/src/playbooks/drafts.ts` (774: the single authority for Wright's draft fields), `kernel/src/playbooks/enable.ts` (441), `kernel/src/playbooks/mirror.ts` (218), `kernel/test/playbooks-drafts.test.ts` (904: pin edit and the set-path cases beside their siblings), `kernel/test/playbooks-foundation.test.ts` (309: home of AC7's and AC10's new tests), `docs/architecture/playbooks.md` (127), `docs/architecture/approvals.md` (267) | — | HIGH |
| 2 app | `app/src/api/contract.ts` (1612: as above), `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx` (251), `app/src/components/PlaybookPolicy/PlaybookPolicy.test.tsx` (233), `app/src/screens/chat/testkit.tsx` (295), `app/src/screens/chat/cards.test.tsx` (715), `app/src/screens/playbooks/model.test.ts` (408), `app/src/screens/playbooks/PlaybooksScreen.test.tsx` (881), `app/src/screens/schedules/SchedulesScreen.test.tsx` (962), `app/src/screens/schedules/AllHistory.test.tsx` (478), `app/src/screens/approvals/ApprovalsScreen.test.tsx` (969), `app/src/screens/budget/BudgetScreen.test.tsx` (1125), `app/e2e/fixtures/chat.ts` (338), `app/e2e/fixtures/schedules.ts` (338), `app/e2e/fixtures/budget.ts` (343), `app/e2e/fixtures/playbooks.ts` (433). The large fixtures are fixture-field edits only. | — | MEDIUM (the exact fixture set is whatever `npm run typecheck` names once the contract fields are required; the list is the `grep -rln token_limit_set_by app/src` hits) |

### File Overlap Detection

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| Subtask 1 | Subtask 2 | `app/src/api/contract.ts`, `kernel/test/integrations-foundation.test.ts`, `kernel/test/phase-8-foundation.test.ts`, `kernel/test/console-contract.test.ts` | YES (2 requires 1) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/integrations/github/repo-policy.ts"}
  - {kind: "symbol", path: "kernel/src/integrations/github/repo-policy.ts", name: "detectRepoPolicy"}
  - {kind: "symbol", path: "kernel/src/integrations/github/repo-policy.ts", name: "proposeRepoPolicy"}
  - {kind: "symbol", path: "kernel/src/integrations/github/repo-policy.ts", name: "policyMet"}
  - {kind: "symbol", path: "kernel/src/integrations/github/repo-policy.ts", name: "getRepoPolicy"}
  - {kind: "symbol", path: "kernel/src/integrations/github/repo-policy.ts", name: "loomwrightMergeFlags"}
  - {kind: "symbol", path: "kernel/src/integrations/github/repo-policy.ts", name: "MERGE_APPROVAL_ACTION"}
  - {kind: "file", path: "kernel/src/integrations/github/repo-policy-routes.ts"}
  - {kind: "symbol", path: "kernel/src/integrations/github/repo-policy-routes.ts", name: "repoPolicyPart"}
  - {kind: "type", path: "kernel/src/integrations/types.ts", name: "GitHubRepoPolicyReads"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "RepoPolicyProposal"}
  - {kind: "file", path: "kernel/test/integrations-github-repo-policy.test.ts"}
requires: []
lanes:
  - "kernel/src/integrations/github/client.ts"
  - "kernel/src/integrations/github/repo-policy.ts"
  - "kernel/src/integrations/github/repo-policy-routes.ts"
  - "kernel/src/integrations/types.ts"
  - "kernel/src/integrations/index.ts"
  - "kernel/test/fixtures/github-fake.ts"
  - "kernel/test/integrations-github-client.test.ts"
  - "kernel/test/integrations-github-repo-policy.test.ts"
  - "kernel/test/console-contract.test.ts"
  - "kernel/test/phase-8-foundation.test.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "app/src/api/contract.ts"
  - "docs/architecture/repo-policy.md"
external_requires:
  - "GitHub REST: GET /repos/{o}/{r}, /branches/{b}/protection, /collaborators?permission=push, /pulls/{n}, /pulls/{n}/reviews, /commits/{sha}/status, /commits/{sha}/check-runs (fake-tested only; no live call)"

# Subtask 2
provides:
  - {kind: "file", path: "kernel/src/store/migrations/021_playbook_merge_requirement.ts"}
  - {kind: "symbol", path: "kernel/src/playbooks/store.ts", name: "PLAYBOOK_POLICY_FIELDS"}
  - {kind: "symbol", path: "kernel/src/playbooks/types.ts", name: "MERGE_REQUIREMENT_KINDS"}
  - {kind: "symbol", path: "kernel/src/playbooks/enable.ts", name: "EnableRefused"}
  - {kind: "symbol", path: "app/src/components/PlaybookPolicy/PlaybookPolicy.tsx", name: "mergeRequirementPolicyRow"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/github/repo-policy.ts", name: "getRepoPolicy"}
lanes:
  - "kernel/src/store/migrations/021_playbook_merge_requirement.ts"
  - "kernel/src/store/migrations/index.ts"
  - "kernel/src/playbooks/types.ts"
  - "kernel/src/playbooks/store.ts"
  - "kernel/src/playbooks/drafts.ts"
  - "kernel/src/playbooks/enable.ts"
  - "kernel/src/playbooks/mirror.ts"
  - "kernel/test/store.test.ts"
  - "kernel/test/integrations-github-app-migration.test.ts"
  - "kernel/test/integrations-github-declared.test.ts"
  - "kernel/test/phase-8-foundation.test.ts"
  - "kernel/test/console-contract.test.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/test/playbooks-drafts.test.ts"
  - "kernel/test/playbooks-foundation.test.ts"
  - "app/src/api/contract.ts"
  - "app/src/components/PlaybookPolicy/PlaybookPolicy.tsx"
  - "app/src/components/PlaybookPolicy/PlaybookPolicy.test.tsx"
  - "app/src/screens/chat/testkit.tsx"
  - "app/src/screens/chat/cards.test.tsx"
  - "app/src/screens/playbooks/model.test.ts"
  - "app/src/screens/playbooks/PlaybooksScreen.test.tsx"
  - "app/src/screens/schedules/SchedulesScreen.test.tsx"
  - "app/src/screens/schedules/AllHistory.test.tsx"
  - "app/src/screens/approvals/ApprovalsScreen.test.tsx"
  - "app/src/screens/budget/BudgetScreen.test.tsx"
  - "app/e2e/fixtures/chat.ts"
  - "app/e2e/fixtures/schedules.ts"
  - "app/e2e/fixtures/budget.ts"
  - "app/e2e/fixtures/playbooks.ts"
  - "docs/architecture/playbooks.md"
  - "docs/architecture/approvals.md"
  - "docs/ARCHITECTURE.md"
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
| Subtask 1 | Subtask 2 | `app/src/api/contract.ts`, `kernel/test/integrations-foundation.test.ts`, `kernel/test/phase-8-foundation.test.ts`, `kernel/test/console-contract.test.ts` | YES |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1: its enable check reads `getRepoPolicy`, and it re-verifies Subtask 1's `RepoPolicyProposal` in `contract.ts` still resolves after its own edit)
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
| Feasibility (Phase 2.5): the requirement's Touches omitted the storage files for `merge_requirement` | HIGH | Owner approved "Extend Touches" (2026-11-04). The approved and later-found files are listed in `## Touches extension (owner-approved)`; any further file means stop and say so, never patch |
| Feasibility (Phase 2.5): the change is context-bound (~40 files) | MEDIUM | Split into 2 serial subtasks; the app fixture edits are mechanical field additions |
| `policy_kind` is `NOT NULL`, so a detected-but-unset repo needs a sentinel `unset` row | MEDIUM | `unset` is closed in code and always reads `kind: null` / `no_policy`; documented in `repo-policy.md` and the ARCHITECTURE data model row. The evidence README's "No policy: no row" line becomes "no row, or `unset`" in `repo-policy.md` only |
| Owner open point 2 (DESIGN.md: safe mode has no storage) is still open | MEDIUM | Safe mode is offered as a proposal `choice` only, and choosing it stores nothing (the repo stays `unset`: PRs park). No safe-mode storage is invented; item 12 / the owner decide |
| Owner open point 7 ("2" for a team repo) is still open | LOW | Follow the binding requirement: N comes from GitHub, and the kernel ships no number (invariant 1). Noted in `repo-policy.md` as Wright's to propose in a draft |
| Owner open point 4 (visibility, role words) | LOW | `private` is recorded in `detected_json` anyway (from `GET /repos/{r}`); collaborator role words are not added |
| "Only the owner can push" has no owner login in the kernel for an App token | MEDIUM | Defined as the push collaborators being exactly the repo's `<owner>` segment; stated in the doc and tested; a misfit only changes a suggestion, never a policy |
| `reviewDecision` is GraphQL (`POST /graphql` is not in the allowlist) | MEDIUM | REST-derived approvals counted at the head SHA only (conservative: stale approvals never count); Loomwright's gate still re-checks `reviewDecision` (conditions 3 and 4) before any merge |
| `studio_approval` depends on item 09's `kernel_merge_approval_request` approval shape | MEDIUM | Export `MERGE_APPROVAL_ACTION` and match payload `repo`, `pr`, `head_sha` (item 09 Scope 4 names exactly these); tests insert the approval row directly |
| The repo-policy default client composes `createGitHubClient` + `resolveGitHubTokenProvider` + `githubAppTokens` itself (`connector.ts`'s `createResolvingGitHubClient` is typed `GitHubClient` and is out of scope) | LOW | Same holder as the shipped default path; tests inject the fake; a comment names `createResolvingGitHubClient` as the twin |
| A new route set accidentally exposed as an agent tool | HIGH | AC8 test plus a pin mutation; `repoPolicyPart.tools` frozen `[]` |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-04-repo-merge-policy-detect-and-propose.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-05T03:03:39Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/226
- **Branch:** feature/repo-merge-policy-detect-and-propose
- **Files changed:** 42
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Repo merge policy: detection from GitHub (GET-only GitHubRepoPolicyReads), a pure proposal the kernel never applies, three owner-only /repos/policy routes (no agent tool), policyMet with closed reasons and no cache, loomwrightMergeFlags; playbook merge_requirement (migration 021, owner-locked, no default) with playbook_looser_than_repo refused pre-hold and at apply; app read-only policy row. Heal fixed: outsider approvals counted (now OWNER/MEMBER/COLLABORATOR only), any 403 read as protection_unavailable (now private repos only), and a duplicated merge_requirement parser. 4 LOW findings dismissed (marker comment on the PR). Owner approved two extra pin edits (integrations-github-connector.test.ts, phase-6-exit.test.ts) on 2026-11-05. The pin-mutation runner was unsupported here (all rows unverified); rows 1–8 were applied by hand and all held.

## Not verified
- **GitHub REST response shapes for the four new reads** — fake fetch and FakeGitHubClient only, no live call (subtask 1)
- **Playwright e2e specs with the two new fixture fields** — npm run typecheck covers the fixtures; e2e specs not run (subtask 2)
- **Full SessionManager gate path for the looser refusal** — covered through heldToolCheckOf and approvalApplierOf only (subtask 2)
- **An editable merge_requirement row in the app** — out of scope; item 13 wires editing (subtask 2)
