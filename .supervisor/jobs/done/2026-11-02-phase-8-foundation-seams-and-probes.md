# Supervisor Job: Phase 8 foundation: decisions D38–D40, closed sets refused until their items land, the poll source-adapter seam, migration 020, the empty `automate` feature, the p8 contract, architecture stubs and the p14/p15 probes

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-02-150636/L1
- **CLAUDE.md:** ✓ Found (stale: one line, "The next step is phase 1 (the kernel)", which this brief fixes)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (CLAUDE.md "next step" line is stale; in scope)
- **Source requirement:** .supervisor/requirements/phase-8/2026-11-02-160001-phase-8-foundation-decisions-contract-seams-and-probes.md
- **Base commit:** a0db691c37f6d9c4a1af60266987c6d1d33585ec

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest, zod, better-sqlite3), React/Electron app, bash docs gate. Nothing new is needed |
| 2 | Dependency Availability | GO | No new dependency. The probes use the existing `probes/package.json` (Agent SDK), like p1–p13 |
| 3 | Architecture Fit | GO | Repeats the phase 6 (PR #142) and phase 7 (PR #177) foundation pattern: closed sets grow and are refused, empty feature parts, contract routes with a not-yet-served origin, docs stubs |
| 4 | Scope vs Supervisor Capability | CAUTION | 37 files: the requirement's 27 Touches plus 10 the owner approved adding on 2026-11-02 over three answers, the final list confirmed by a real kernel and app test run (see Risk Assessment). Split into 3 subtasks of 11, 13 and 15 files (`context-bound`; the two kernel subtasks are mostly one-line re-pins, well under 800 changed lines each) |
| 5 | Hard Blockers | CAUTION | Probes p14/p15 need live runs on studio-sandbox, which the owner consents to (D33). Owner's decision 2026-11-02: write them now and run them after merge (AC 5 below) |

**Overall Verdict:** CAUTION

## Task
**Goal:** Lay phase 8's foundation: record D38–D40, grow the closed sets with each new value refused by a named code until its item lands, add the poll source-adapter seam (`github.pulls` moved with no behaviour change), migration 020, an empty `automate` feature plus the empty integrations parts `mcp` and `repo-policy`, every phase 8 route and shape in the app contract as `p8-item-NN`, the architecture stubs, and the p14/p15 probe files with their OPEN_QUESTIONS entries.

**Problem Statement:**
The owner needs phase 8's decisions, contract and kernel seams in place, so that each later phase 8 item (02–14) edits only its own module and nothing rests on an unverified assumption.
Currently (main `a0db691`): `CONNECTOR_KINDS` is `["github"]`, `POLL_SOURCES` is `["github.pulls"]`, `live` mode is refused `live_mode_not_in_phase_6`, the GitHub grant has no write level, no kernel feature runs `/automate`, no repo merge policy exists, and claims (a) and (b) (requirement §Problem) are unverified.
Success looks like: every later item adds one file or fills one empty part, every new value is refused by name until then, and both probes are ready to run, with their OPEN_QUESTIONS entries waiting for results.

**Owner decisions:** the requirement's §"Owner decisions (2026-11-02, binding)" are binding and are not restated here. The worker reads them from the source requirement. Two more were made at Launch Pad on 2026-11-02:
1. **Touches extended:** the 10 files named in `## Touches extension` below may be edited, and only as described there. Every other file outside the requirement's Touches list plus these 10 stays untouched; a lane that needs one stops and says so.
2. **Probes are written now and run after merge:** this PR adds both probe files and their OPEN_QUESTIONS entries, unticked and marked "not yet run", each with its exact invocation. The owner (or the agent on the owner's word, D33) runs them after merge. Item 09 stays blocked until p14 has run and returned yes.

**Launch Pad design calls (not owner decisions; record them in the PR body):**
- **The new never categories are accepted, not refused.** `never` only narrows what a session may do, so a category with no matcher yet denies nothing extra and widens nothing. Refusing them would break `app/e2e/phase-5-exit.spec.ts:105`, which builds a real charter's `never` from every kernel `gh_*` category, and that file is outside every lane. The requirement's ACs do not ask for their refusal (scope 3's "refused until its item lands" is met by the other three sets).
- **The GitHub write grant's input shape** is the object form items 04 and 06 plan: `connectors: {github: "write"}` in an agent's settings file. In phase 8 item 01 the object form is refused: `github: "write"` gives `github_write_not_built`, and a `jira` or `clickup` key, or a `"jira"`/`"clickup"` array entry, gives `connector_not_built`. The existing array form `connectors: ["github"]` reads exactly as today. Refusals reuse the existing variants (`settings_invalid` with `field: "connectors"` in `settings.ts`, `charter_invalid` with `field: "connectors"` in `charter-files.ts`), and each message contains the code. No new `AgentSettingsRefusal` or `CharterRefusal` variant is added, so the out-of-lane `.error` switches (`kernel/src/kernel.ts`, `kernel/src/brain/handler.ts`, `brain/settings.ts`, `brain/routes.ts`) are unchanged.

### Touches extension (owner-approved 2026-11-02, in three answers; 10 files; mechanical only)

> **Evidence:** Launch Pad applied the closed-set, migration, feature and contract changes to a throwaway copy of `a0db691` and ran the real suites: kernel `tsc` clean and 3277 tests; app `tsc` clean and 2805 tests. Every failing test was in a lane file, in this list, or in the pre-existing SchedulesScreen set (Risk Assessment). The app's Playwright e2e was not run.
- `kernel/src/agents/charter-files.ts`: add `jira` and `clickup` entries to `CONNECTOR_LABELS` (a `Record<ConnectorKind, string>`, so typecheck fails without them), and refuse a charter's `connectors` naming `jira`/`clickup` with `connector_not_built`, as `settings.ts` does.
- `kernel/test/gui-foundation.test.ts`: `gui` is no longer last. Re-pin :15 `toHaveLength(10)` to 11, keep :16 `.slice(8, 10)`, re-pin :18 and :20 so `gui` is tenth and `automate` is last.
- `kernel/test/sessions-policy.test.ts`: the exact `NEVER_CATEGORIES` list gains the 2 new values.
- `app/src/screens/team/model.ts`: its `NEVER_CATEGORIES` mirror gains the same 2 values in the same order (`app/src/screens/team/team.test.tsx` compares it with the kernel's list and is NOT edited).
- `kernel/test/agents-charter-connectors.test.ts`: `expect(CONNECTOR_KINDS).toEqual(["github"])` becomes the 3-kind list.
- `kernel/test/store.test.ts`: the latest migration becomes `[20, "phase_8_foundation"]`, and the table list and migration list gain migration 20's tables.
- `kernel/test/integrations-foundation.test.ts`: subtask 2 re-pins `expect(CONNECTOR_KINDS).toEqual(["github"]);` (:141) to the 3-kind list; subtask 3 then re-pins the `INTEGRATIONS_PARTS` names (:162) with `mcp` and `repo-policy` before `github-app-routes`, and the "migration 19 last" pins (:293-304, :381, :428) to "19 sits below 20" / `[20, "phase_8_foundation"]`.
- `kernel/test/integrations-github-app-migration.test.ts`: the "appended last" pins (:57-61: `migrations.at(-1)` becomes `at(-2)`, `migrations.at(-2)` for 18 becomes `at(-3)`, `length: 19` becomes `length: 20`; :84, :128 become `[20, "phase_8_foundation"]`). Keep the test's point: 19 directly follows 18, and the list is contiguous from 1.
- `kernel/test/integrations-github-declared.test.ts`: :217 `expect(migrations.at(-2)).toBe(connectorPermissionsSource);` becomes `at(-3)`, and :219 `length: 19` becomes `length: 20` (subtask 3).
- `kernel/test/phase-4-exit.test.ts`: :388 `expect(MASON_NEVER).toEqual([...])` gains `gh_pr_request_reviewers` and `gh_pr_comment_reply` in `NEVER_CATEGORIES` order, because mason's list is derived from the kernel list (subtask 2).

## Acceptance Criteria
- [ ] AC1. Given `docs/DECISIONS.md`, when read, then rows D38 (MCP connectors with OAuth 2.1), D39 (the App's permissions and down-scoped session tokens; supersedes D36's "Read-only still" for the App only; the token path keeps `token_write_scoped`) and D40 (the per-repo merge policy and the merge flow) exist; each names exactly what it supersedes; D40 states that the kernel never merges (it restates invariant 4); and `bash scripts/check-docs.sh` passes (decision numbers unique). `CLAUDE.md`'s "The next step is phase 1 (the kernel)" line is corrected, and ROADMAP's phase 8 done-when reads exactly "A PR is tracked through its states; comments are triaged (fix / reply / answer); reviewers are re-requested; merges once the repo's approval policy is met, only through the gated path".
- [ ] AC2. Given each of these, when it is set or used, then it is refused with its named code and nothing is written: a playbook `mode: live` (`live_mode_not_in_phase_6`, unchanged on every path); a poll spec whose source is `github.issues`, `github.pr_comments`, `jira.issues` or `clickup.tasks` (refused in `parsePollSpec` with the existing `invalid_spec` code and a message starting `poll_source_not_built:`, so creation, Wright's drafts and the dry run all refuse it, and `triggers-poll.test.ts`'s "another source" case, which uses `github.issues`, stays green unedited); a `jira` or `clickup` connector grant in an agent's settings file or charter (`connector_not_built`, as `settings_invalid` / `charter_invalid` with `field: "connectors"`); `connectors: {github: "write"}` in an agent's settings file (`github_write_not_built`, as `settings_invalid` with `field: "connectors"`); and `connectors: ["github"]` still reads ok, unchanged. `CONNECTOR_KINDS` is `["github", "jira", "clickup"]`, `POLL_SOURCES` lists `github.pulls` and the four new sources, and `NEVER_CATEGORIES` gains `gh_pr_request_reviewers` and `gh_pr_comment_reply` (accepted, see the design calls above). All of this is pinned in `kernel/test/phase-8-foundation.test.ts`.
- [ ] AC3. Given `github.pulls` polls, when `kernel/src/triggers/poll.ts` dispatches fetches by source to `kernel/src/triggers/sources/<source>.ts`, then the `github.pulls` fetch (`fetchPollItems`' per-repo loop, `matches`, `isNameable`, `itemOf`) lives in `kernel/src/triggers/sources/github-pulls.ts`, `poll.ts` keeps exporting `fetchPollItems` (re-exported by `triggers/index.ts`) with the same signature, and every existing poll test passes unmodified (`triggers-poll.test.ts`, `playbooks-drafts-poll.test.ts`, `playbooks-dry-run-poll*.test.ts`, `phase-6-exit.test.ts`; none is in any lane).
- [ ] AC4. Given `app/src/api/contract.ts`, when read by `kernel/test/console-contract.test.ts`, then exactly the 7 phase 8 routes listed under `## Subtask Structure` are listed with origins `p8-item-03`, `p8-item-06` and `p8-item-08` (`RouteOrigin` gains these 3), the contract declares the new shapes those routes use (`GitHubAppUpgradeResponse`; `McpConnectionKind`, `McpConnection`, `McpConnectResponse`; `RepoPolicyKind` = `solo` | `studio_approval` | `reviews`, `RepoPolicy`, `RepoPoliciesResponse`, `RepoPolicySetBody`) plus the `PrTrack` and `PrOwnerKind` (`automate_live` | `automate_parked` | `owner` | `other`) types items 10/11 use, each declared only and changing no existing type except `ConnectorKind`, the test's literal list and a new "phase 8's routes as not yet served" case pin each by origin, and the `isExisting` predicate treats `p8-item-NN` as not served, so none counts as served. Every p8 route is GET or POST (so `app/src/api/contract.test.ts`'s "PUT only on `/memory/file`" pin holds without being edited), and each p8 GET route has a default empty answer in `app/e2e/fixture-kernel.ts`.
- [ ] AC5. Given probes p14 and p15, when the PR merges, then `probes/p14-loomwright-merge-one-parked-item.md` and `probes/p15-automate-inline-in-sdk-session.mjs` exist, and `docs/OPEN_QUESTIONS.md` has one unticked entry per probe marked "not yet run" that gives the probe's file, the exact invocation, what to record (run date, answer, Loomwright version), and the rule that a "no" on p14 is reported to the owner and blocks items 09 and 14 until a Loomwright change lands. No result is invented: the entries hold no date and no answer.
- [ ] AC6. Given the kernel's feature registry, when `SHIPPED_CONTRIBUTIONS` loads, then an `automate` contribution (`kernel/src/automate/index.ts`: empty parts `runner`, `tracker`, `routing`, merged like `gui`'s) is registered after `gui`, and `INTEGRATIONS_PARTS` gains empty `mcp` and `repo-policy` parts inserted before `githubAppRoutesPart` (so `integrations-github-app-contract.test.ts`'s `INTEGRATIONS_PARTS.at(-1)` pin holds, unedited). `feature-seams.test.ts` and `gui-foundation.test.ts` pin the new order, and the CLI-import rule (no Agent SDK, no session manager, no `kernel.ts`) still holds.
- [ ] AC7. Given migration 020 (`phase_8_foundation`), when the store opens, then tables `repo_policies`, `pr_tracks` and `mcp_connections` exist with the columns the requirement's scope 5 lists. There is no SQL CHECK and no SQL trigger, the value sets are closed in code, and the migration is safe to re-run (`CREATE TABLE IF NOT EXISTS`). `store.test.ts` and `phase-8-foundation.test.ts` pin it.
- [ ] AC8. Given `docs/ARCHITECTURE.md`, when read, then a "Phase 8 features" section links `docs/architecture/automate.md`, `repo-policy.md` and `mcp-connectors.md` (one stub page each, stating what the later items will fill), and `docs/UI.md` has a note on phase 8's Tasks card and Integrations. `bash scripts/check-docs.sh` passes.
- [ ] AC9. Validation passes: `cd kernel && npm ci && npm run typecheck && npm test`; `cd app && npm ci && npm run typecheck && npm test && npm run build`; `bash scripts/check-docs.sh`.

## Touched-file invariants

> Grounded at base `a0db691c37f6d9c4a1af60266987c6d1d33585ec`. Every worker re-checks the entries for the files in its lanes before handing back.

- **`kernel/src/triggers/poll.ts`** (585): keep `export const POLL_SOURCES = ["github.pulls"] as const;` as the one closed source list (extend it in place); keep `parsePollSpec`'s check order (shape, unknown field, source, repos, filters, interval, then `poll_interval_below_floor`), adding the refusal right after the membership check through the existing `const invalid = (why: string): TriggerError => new TriggerError("invalid_spec", why);` helper, with the message starting `poll_source_not_built:` (no new `TriggerErrorCode`; `kernel/src/triggers/fire-shared.ts` is not edited); keep `export async function fetchPollItems(github: GitHubClient, spec: PollSpec): Promise<Fetched>` (same signature; it now dispatches to the source module); keep `MAX_POLL_ITEMS` and the result shape `{ ok: true, items: items.slice(0, MAX_POLL_ITEMS), found: items.length }`. Mirror: `kernel/src/triggers/index.ts`'s `export { MAX_POLL_ITEMS, POLL_FILTER_KEYS, POLL_SOURCES, fetchPollItems,` and `kernel/src/playbooks/drafts.ts`'s `source: z.enum(POLL_SOURCES),` (not edited: the refusal lives in `parsePollSpec`). Pinned by: `kernel/test/triggers-poll.test.ts`, `kernel/test/playbooks-drafts-poll.test.ts` (unedited; AC3).
- **`kernel/src/sessions/policy.ts`** (1124; the only authority for the never list, so the change appends in place): keep `export const NEVER_CATEGORIES = Object.freeze([` frozen, and add the 2 values after the `gh_pr_*` group, before `gh_issue_create`, so that `neverCategoriesOf`'s `NEVER_CATEGORIES.filter((c) => c === \`gh_pr_${sub}\`)` keeps working; do not change `GH_PR_OUTWARD` or the rail's label tables (later items add the matcher). Mirror: `app/src/screens/team/model.ts`'s `/** Mirrors the kernel's \`NEVER_CATEGORIES\`` list, in the same order. Pinned by: `kernel/test/sessions-policy.test.ts` (`is the closed, frozen list of never categories`), `app/src/screens/team/team.test.tsx` (`the never-category list equals the kernel's NEVER_CATEGORIES`).
- **`kernel/src/integrations/types.ts`** (319): keep `export const CONNECTOR_KINDS = Object.freeze(["github"] as const);` as `Object.freeze`d and extend it in place; keep `readonly source: "github.pulls";` in the parsed `PollSpec` (only `github.pulls` parses until its items land). Pinned by: `kernel/test/agents-charter-connectors.test.ts` (`expect(CONNECTOR_KINDS).toEqual(`).
- **`kernel/src/integrations/index.ts`** (106): keep `INTEGRATIONS_PARTS` `Object.freeze`d and keep `githubAppRoutesPart` last; the new `mcp` and `repo-policy` parts are empty and claim no handler kind (`the github parts are filled and claim no handler kind, so it does not throw`). Pinned by: `kernel/test/integrations-github-app-contract.test.ts` (`expect(INTEGRATIONS_PARTS.at(-1)).toBe(githubAppRoutesPart)`, unedited).
- **`kernel/src/features/index.ts`** (68): keep the header rule `nor anything it loads may import the Agent SDK, the session manager or` `kernel.ts`; append `automateContribution` after `guiContribution` in `SHIPPED_CONTRIBUTIONS`, and add "then phase 8's `automate`" to the header comment. Pinned by: `kernel/test/feature-seams.test.ts`, `kernel/test/gui-foundation.test.ts` (`expect(SHIPPED_CONTRIBUTIONS.at(-1)).toBe(guiContribution)`, which this PR re-pins to automate), `kernel/test/console-foundation.test.ts` (`SHIPPED_CONTRIBUTIONS[8]?.name).toBe("integrations")`, unedited; indexes 0–9 do not move).
- **`kernel/src/store/migrations/index.ts`** (45): `Append only; never edit a shipped one.`; append the migration 020 export after `connectorApp,`. Reuse migration 019's idempotent style (`Safe to re-run`; it `Creates no SQL trigger: the integrity check refuses any trigger the kernel does not list`). Pinned by: `kernel/test/store.test.ts` (`[19, "connector_app"]`, re-pinned to 20).
- **`kernel/src/playbooks/store.ts`** (731): keep `if (value === "live") throw new PlaybookError("live_mode_not_in_phase_6",` exactly as it is (the code name is pinned by tests outside every lane: `kernel/test/integrations-foundation.test.ts`, `playbooks-drafts.test.ts`, `playbooks-drafts-poll.test.ts`, and `app/e2e/fixtures/playbooks.ts`). At most a doc comment noting that phase 8 item 04 lifts it. Renaming the code is out of scope.
- **`kernel/src/agents/settings.ts`** (271): keep `connectors: z.array(z.enum(CONNECTOR_KINDS)).optional(),` for the array form and the strict `crewSchema` ("a misspelt enforced setting ... is refused, never read as ok and silently not applied"); the object form and the jira/clickup kinds are refused as the design calls above fix them (reusing `readonly error: "settings_invalid"`), never silently dropped. Do not add an `AgentSettingsRefusal` variant.
- **`kernel/src/agents/charter-files.ts`** (566): keep `const CONNECTOR_LABELS: Record<ConnectorKind, string> = { github: "GitHub" };` exhaustive (add `jira: "Jira"`, `clickup: "ClickUp"`), keep `.max(CONNECTOR_KINDS.length)`, and refuse through the existing `const invalid = (field: string, message: string): CharterRefusal =>` helper (no new variant).
- **`kernel/test/integrations-foundation.test.ts`, `kernel/test/integrations-github-app-migration.test.ts`, `kernel/test/integrations-github-declared.test.ts`, `kernel/test/phase-4-exit.test.ts`**: re-pin values only (`expect(CONNECTOR_KINDS).toEqual(["github"]);`, `expect(INTEGRATIONS_PARTS.map((p) => p.name)).toEqual(`, `expect(migrations.at(-1)).toBe(connectorApp);`, `[19, "connector_app"]`). Keep each test's intent: 19's own columns are still asserted, 19 still directly follows 18, and mason still holds every PR/issue write but the comment.
- **`kernel/test/sessions-policy.test.ts`**: besides the exact list (:141), the case `maps every outward label the rail emits ... every category is` covered (:209) fails, because the 2 new categories have no rail label yet. Exempt exactly those 2 by name, with a comment saying item 05 adds their matcher. Never weaken the check for any other category.
- **`kernel/test/console-contract.test.ts`** (279): keep `const isExisting = (entry: ContractEntry): boolean => !/^(p[67]-)?item-\d{2}$/.test(entry.origin);` as the single predicate, widened to `p[678]-`; keep `expect(unserved).toEqual([]);`; add a `p8` "not yet served" case beside `lists phase 7's twelve routes as not yet served`.
- **`app/src/api/contract.ts`** (1491; the single authority for the app contract): add each `"p8-item-NN"` to `RouteOrigin` (beside `| "p7-item-08"`) and the p8 routes after `{ method: "GET", path: "/settings", origin: "p7-item-08" },`; `export type ConnectorKind = "github";` gains `jira | clickup`. Mirror: `app/src/api/contract.test.ts` (`expect(["GET", "POST", "PUT"]).toContain(route.method);` and `["PUT /memory/file p7-item-06"]`), unedited, so p8 adds no PUT; the path regex `/^(\/(:?[a-z][a-z0-9-]*))+$/` holds.
- **`app/e2e/fixture-kernel.ts`** (370): keep the defaults map keyed `"<METHOD> <path>"` as in `CONTRACT_ROUTES` (`"GET /tasks": () => ({ status: 200,`); add one empty default per p8 GET route.

## Closed enumerations touched

> Sibling greps at base `a0db691` (`--exclude-dir={node_modules,.supervisor,.git,evidence}`):
> `grep -rnF 'gh_pr_close'` → 12 hits in 7 files; `grep -rnF 'github.pulls'` → 30 hits in 15 files; `grep -rnF 'p7-item-08'` → 5 hits in 3 files; `CONNECTOR_KINDS` consumers via `grep -rn CONNECTOR_KINDS kernel/src app/src`.

- **`gh_pr_request_reviewers`, `gh_pr_comment_reply`** (sibling: `gh_pr_close`). Must be named in:
  - `kernel/src/sessions/policy.ts`: `NEVER_CATEGORIES`. Extend.
  - `app/src/screens/team/model.ts`: the mirror `NEVER_CATEGORIES`. Extend.
  - `kernel/test/sessions-policy.test.ts`: the exact-list pin. Extend.
  - `docs/architecture/agents.md`, `docs/architecture/approvals.md`: no change. These are prose about existing categories; item 05 documents the new ones when it adds their matcher.
  - `kernel/test/phase-4-exit.test.ts:388`: extend. Mason's list is derived from `NEVER_CATEGORIES` and pinned to a literal (the prototype run proved it fails).
  - `kernel/test/sessions-policy.test.ts:209` (every category covered by a rail label): exempt the 2 by name (invariants above).
  - `app/e2e/fixtures/team.ts` `MASON_NEVER`: no change. It is a literal subset.
- **`github.issues`, `github.pr_comments`, `jira.issues`, `clickup.tasks`** (sibling: `github.pulls`). Must be named in:
  - `kernel/src/triggers/poll.ts`: `POLL_SOURCES`. Extend (each refused `poll_source_not_built` in `parsePollSpec`).
  - `kernel/src/playbooks/drafts.ts` `z.enum(POLL_SOURCES)`: no change, it derives from the constant.
  - `kernel/src/integrations/types.ts` `readonly source: "github.pulls";`: no change. It is the parsed spec, and only `github.pulls` parses.
  - `kernel/src/playbooks/items.ts` comment, `docs/architecture/triggers.md`, app fixtures and tests: no change. These are a parsed-source example and prose, not a closed list of sources.
- **`jira`, `clickup`** (sibling: CONNECTOR_KINDS `github`). Must be named in:
  - `kernel/src/integrations/types.ts`: `CONNECTOR_KINDS`. Extend.
  - `kernel/src/agents/charter-files.ts`: `CONNECTOR_LABELS` (exhaustive `Record`). Extend.
  - `app/src/api/contract.ts`: `export type ConnectorKind = "github";`. Extend.
  - `kernel/test/agents-charter-connectors.test.ts`: the exact-list pin. Extend.
  - `kernel/src/sessions/manager.ts`, `kernel/src/agents/settings.ts`, `charter-files.ts` zod enums: no change, they derive from the constant (settings.ts and charter-files.ts gain the refusal instead).
  - `kernel/src/agents/roster.ts` `connectors must be github or none`: no change. `set` keeps refusing every other value until item 06.
- **`poll_source_not_built`, `connector_not_built`, `github_write_not_built`**: no closed list. They are message text under the existing `invalid_spec` (`TriggerErrorCode`, `kernel/src/triggers/fire-shared.ts`: no change) and the existing `settings_invalid` / `charter_invalid` variants (`AgentSettingsRefusal`, `kernel/src/agents/settings.ts`; `CharterRefusal`, `charter-files.ts`). No change to those unions, so `kernel/src/kernel.ts`, `kernel/src/brain/handler.ts`, `brain/settings.ts` and `brain/routes.ts` are untouched.
- **`phase_8_foundation`, migration 20** (sibling: `connector_app`; `grep -rlF 'connector_app' kernel/test` → 3 files, plus `grep -rnE 'length: 19|migrations\.at\(-' kernel/test` → `integrations-github-declared.test.ts`; confirmed by the prototype run). Must be named in: `kernel/test/store.test.ts`, `kernel/test/integrations-foundation.test.ts`, `kernel/test/integrations-github-app-migration.test.ts` and `kernel/test/integrations-github-declared.test.ts`. Extend (re-pin the latest migration).
- **`automate` contribution, parts `mcp`/`repo-policy`** (siblings: `"gui"`, `"github-app-routes"`). Must be named in: `kernel/test/feature-seams.test.ts` (:123, :125, :489 contributor lists) and `kernel/test/gui-foundation.test.ts`. Extend. Also `kernel/test/integrations-foundation.test.ts:162` (parts names). Extend. `kernel/test/integrations-github-app-contract.test.ts` (`INTEGRATIONS_PARTS.at(-1)`): no change, because the parts are inserted before it.
- **`p8-item-NN` origins** (sibling: `p7-item-08`). Must be named in:
  - `app/src/api/contract.ts` `RouteOrigin` and `CONTRACT_ROUTES`. Extend.
  - `kernel/test/console-contract.test.ts`: the literal list and `isExisting`. Extend.
  - `docs/ARCHITECTURE.md`: the new "Phase 8 features" section names them. Extend.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/sessions-policy.test.ts`, never-list pin | delete `"gh_pr_request_reviewers",` in `kernel/src/sessions/policy.ts` |
| `kernel/test/agents-charter-connectors.test.ts`, CONNECTOR_KINDS pin | flip `"github", "jira", "clickup"` → `"github", "jira"` in `kernel/src/integrations/types.ts` |
| `kernel/test/gui-foundation.test.ts`, automate-last pin | delete `automateContribution,` in `kernel/src/features/index.ts` |
| `kernel/test/store.test.ts`, latest-migration pin | delete `phase8Foundation,` in `kernel/src/store/migrations/index.ts` |
| `kernel/test/phase-8-foundation.test.ts`, poll-source refusal | delete `poll_source_not_built` in `kernel/src/triggers/poll.ts` (the throw line; the worker keeps that literal on exactly one line of poll.ts) |
| `kernel/test/console-contract.test.ts`, p8 not-yet-served case | flip `origin: "p8-item-03"` → `origin: "github-app"` in `app/src/api/contract.ts` (the `/connectors/github/app/upgrade` route then claims to be served and is not) |
| `kernel/test/integrations-foundation.test.ts`, parts-names pin | delete the `mcp` part entry from `INTEGRATIONS_PARTS` in `kernel/src/integrations/index.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Docs: decisions, ROADMAP, ARCHITECTURE/UI, architecture stubs, probes and OPEN_QUESTIONS | AC1, AC5, AC8, AC9 (check-docs) | 6 modify, 5 create | `skills/quality-checklist/SKILL.md` | LAUNCHABLE |
| 2 | Kernel closed sets and refusals, the poll source-adapter seam, and their pins | AC2, AC3, AC9 (kernel + app) | 11 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 3 | `automate` feature, integrations parts, migration 020, the p8 app contract and their pins | AC4, AC6, AC7, AC9 (kernel + app) | 13 modify, 2 create | `skills/unit-testing/SKILL.md` | BLOCKED (by #2) |

**Shared names every subtask uses exactly** (fixed here so docs and code agree): refusal codes `poll_source_not_built`, `connector_not_built`, `github_write_not_built`, `live_mode_not_in_phase_6` (unchanged); never categories `gh_pr_request_reviewers`, `gh_pr_comment_reply`; migration `020_phase_8_foundation` (`version: 20`, `name: "phase_8_foundation"`); tables `repo_policies`, `pr_tracks`, `mcp_connections`; feature `automate` with parts `runner`, `tracker`, `routing`; integrations parts `mcp`, `repo-policy`. p8 routes (each GET or POST; origin = the item that serves it): `GET /connectors/github/app/upgrade` (p8-item-03); `POST /connectors/mcp/:kind/connect`, `POST /connectors/mcp/:kind/connect/cancel`, `POST /connectors/mcp/:kind/disconnect` (p8-item-06); `GET /repos/policy`, `POST /repos/policy/:owner/:repo/detect`, `POST /repos/policy/:owner/:repo` (p8-item-08). These 7 are the full set (a grep of every phase 8 sibling requirement finds no other new route); a later item that needs another adds it itself; subtask 1's ARCHITECTURE section names the origins `p8-item-03/06/08` and links the contract rather than restating every route.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "docs/DECISIONS.md", name: "D38"}
  - {kind: "symbol", path: "docs/DECISIONS.md", name: "D39"}
  - {kind: "symbol", path: "docs/DECISIONS.md", name: "D40"}
  - {kind: "symbol", path: "docs/ARCHITECTURE.md", name: "Phase 8 features"}
  - {kind: "file", path: "docs/architecture/automate.md"}
  - {kind: "file", path: "docs/architecture/repo-policy.md"}
  - {kind: "file", path: "docs/architecture/mcp-connectors.md"}
  - {kind: "file", path: "probes/p14-loomwright-merge-one-parked-item.md"}
  - {kind: "file", path: "probes/p15-automate-inline-in-sdk-session.mjs"}
  - {kind: "symbol", path: "docs/OPEN_QUESTIONS.md", name: "p14"}
  - {kind: "symbol", path: "docs/OPEN_QUESTIONS.md", name: "p15"}
requires: []
lanes:
  - "CLAUDE.md"
  - "docs/DECISIONS.md"
  - "docs/ROADMAP.md"
  - "docs/ARCHITECTURE.md"
  - "docs/UI.md"
  - "docs/OPEN_QUESTIONS.md"
  - "docs/architecture/automate.md"
  - "docs/architecture/repo-policy.md"
  - "docs/architecture/mcp-connectors.md"
  - "probes/p14-loomwright-merge-one-parked-item.md"
  - "probes/p15-automate-inline-in-sdk-session.mjs"
external_requires:
  - "Probe runs on studio-sandbox are the owner's, after merge (D33); not run by this subtask"

# Subtask 2
provides:
  - {kind: "file", path: "kernel/src/triggers/sources/github-pulls.ts"}
  - {kind: "symbol", path: "kernel/src/triggers/poll.ts", name: "poll_source_not_built"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "gh_pr_request_reviewers"}
  - {kind: "symbol", path: "kernel/src/integrations/types.ts", name: "clickup"}
  - {kind: "symbol", path: "kernel/src/agents/settings.ts", name: "github_write_not_built"}
  - {kind: "file", path: "kernel/test/phase-8-foundation.test.ts"}
requires: []
lanes:
  - "kernel/src/integrations/types.ts"
  - "kernel/src/triggers/poll.ts"
  - "kernel/src/triggers/sources/github-pulls.ts"
  - "kernel/src/sessions/policy.ts"
  - "kernel/src/playbooks/store.ts"
  - "kernel/src/agents/settings.ts"
  - "kernel/src/agents/charter-files.ts"
  - "kernel/test/phase-8-foundation.test.ts"
  - "kernel/test/sessions-policy.test.ts"
  - "kernel/test/agents-charter-connectors.test.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/test/phase-4-exit.test.ts"
  - "app/src/screens/team/model.ts"
external_requires: []

# Subtask 3
provides:
  - {kind: "file", path: "kernel/src/automate/index.ts"}
  - {kind: "symbol", path: "kernel/src/features/index.ts", name: "automateContribution"}
  - {kind: "file", path: "kernel/src/store/migrations/020_phase_8_foundation.ts"}
  - {kind: "symbol", path: "kernel/src/store/migrations/index.ts", name: "phase8Foundation"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "p8-item-08"}
  - {kind: "symbol", path: "kernel/test/phase-8-foundation.test.ts", name: "phase_8_foundation"}
requires:
  - {from: "2", kind: "file", path: "kernel/test/phase-8-foundation.test.ts"}
  - {from: "2", kind: "symbol", path: "kernel/src/integrations/types.ts", name: "clickup"}
lanes:
  - "kernel/src/integrations/index.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/test/integrations-github-app-migration.test.ts"
  - "kernel/test/integrations-github-declared.test.ts"
  - "kernel/src/automate/index.ts"
  - "kernel/src/features/index.ts"
  - "kernel/src/store/migrations/020_phase_8_foundation.ts"
  - "kernel/src/store/migrations/index.ts"
  - "kernel/test/phase-8-foundation.test.ts"
  - "kernel/test/console-contract.test.ts"
  - "kernel/test/feature-seams.test.ts"
  - "kernel/test/gui-foundation.test.ts"
  - "kernel/test/store.test.ts"
  - "app/src/api/contract.ts"
  - "app/e2e/fixture-kernel.ts"
external_requires: []
```

### File Impact Map (module layout)

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| docs (S1) | `CLAUDE.md` (37), `docs/DECISIONS.md` (43), `docs/ROADMAP.md` (18), `docs/ARCHITECTURE.md` (297), `docs/UI.md` (64), `docs/OPEN_QUESTIONS.md` (171) | `docs/architecture/automate.md`, `docs/architecture/repo-policy.md`, `docs/architecture/mcp-connectors.md`, `probes/p14-loomwright-merge-one-parked-item.md`, `probes/p15-automate-inline-in-sdk-session.mjs` | HIGH |
| closed sets (S2) | `kernel/src/integrations/types.ts` (319), `kernel/src/sessions/policy.ts` (1124: the single authority for never categories), `kernel/src/agents/settings.ts` (271), `kernel/src/agents/charter-files.ts` (566: exhaustive label record, one line), `kernel/src/playbooks/store.ts` (731: comment at most) | — | HIGH (settings write-level shape: MEDIUM) |
| poll seam (S2) | `kernel/src/triggers/poll.ts` (585: shrinks; the github.pulls fetch moves out) | `kernel/src/triggers/sources/github-pulls.ts` (home of the github.pulls fetch) | HIGH |
| features + store (S3) | `kernel/src/integrations/index.ts` (106), `kernel/src/features/index.ts` (68), `kernel/src/store/migrations/index.ts` (45) | `kernel/src/automate/index.ts` (home of the automate feature and its 3 empty parts; the integrations parts `mcp`/`repo-policy` are defined inline in `integrations/index.ts`, because the requirement's Touches give them no files of their own), `kernel/src/store/migrations/020_phase_8_foundation.ts` | HIGH |
| contract (S3; `model.ts` is S2) | `app/src/api/contract.ts` (1491: the single authority for the app contract), `app/e2e/fixture-kernel.ts` (370), `app/src/screens/team/model.ts` (533: mirror list, 2 lines) | — | HIGH |
| tests (S2: sessions-policy, agents-charter-connectors, creates phase-8-foundation; S3: console-contract, feature-seams, gui-foundation, store, appends to phase-8-foundation) | `kernel/test/console-contract.test.ts` (279), `kernel/test/feature-seams.test.ts` (1150: the existing seam pin home), `kernel/test/gui-foundation.test.ts` (63), `kernel/test/sessions-policy.test.ts` (one list, 2 lines), `kernel/test/agents-charter-connectors.test.ts` (267), `kernel/test/store.test.ts` (2163: the single migration pin home, values only), `kernel/test/integrations-foundation.test.ts` (S2 then S3, values only), `kernel/test/integrations-github-app-migration.test.ts` (115, S3, values only), `kernel/test/integrations-github-declared.test.ts` (S3, 2 values), `kernel/test/phase-4-exit.test.ts` (S2, 1 literal) | `kernel/test/phase-8-foundation.test.ts` (home of every new phase 8 pin) | HIGH |

**Total estimated files:** 28 modify + 9 create = 37.

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
Subtask 2 ──→ Subtask 3   (3 appends to 2's phase-8-foundation.test.ts and integrations-foundation.test.ts edits; sequential sharing, legal)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (docs/probes vs kernel/app) | NO |
| Subtask 1 | Subtask 3 | none | NO |
| Subtask 2 | Subtask 3 | `kernel/test/phase-8-foundation.test.ts` (2 creates it, 3 appends), `kernel/test/integrations-foundation.test.ts` (2 re-pins :141, 3 re-pins :162 and the migration pins); 3 must keep 2's edits | YES (3 after 2) |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel; both have empty `requires` and share only the fixed names above)
- **Batch 2:** Subtask 3 (after Subtask 2)
- **Recommended workers:** 2
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/quality-checklist/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 3 | `skills/unit-testing/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/integrations/types.ts:16` | yes | HOLDS | `export const CONNECTOR_KINDS = Object.freeze(["github"] as const);` | tip 2 hours ago, fetched <1h |
| `kernel/src/triggers/poll.ts:63` | yes | HOLDS (moved to 64) | `export const POLL_SOURCES = ["github.pulls"] as const;` | tip 2 hours ago, fetched <1h |
| `kernel/src/playbooks/store.ts:68` | yes | HOLDS | `export type PlaybookErrorCode = ... \| "live_mode_not_in_phase_6";` | tip 2 hours ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Source: Feasibility (Phase 2.5). The requirement's Touches list omitted 10 files that pin the closed sets exactly or must typecheck against them | MEDIUM | Owner approved extending Touches by exactly those 10 (2026-11-02, Launch Pad, in three answers), and a prototype run of the real kernel and app suites confirmed the list; `## Touches extension` limits each to a mechanical edit. Any other file a worker finds it needs: stop and report, never patch |
| Source: Feasibility (Phase 2.5). p14/p15 cannot be run by an unattended worker (D33) | MEDIUM | Owner's decision: written now, run after merge; the OPEN_QUESTIONS entries stay unticked with no invented result; item 09 is gated on p14 = yes |
| p14 may show Loomwright has no single-item merge entry point (requirement §Risks) | HIGH (for items 09, 14) | Outside this PR. The p14 entry states the stop-and-report rule; a "no" means a Loomwright change in that repo first |
| Renaming `live_mode_not_in_phase_6` would break pins in 4 files outside every lane | MEDIUM | Kept unchanged (Touched-file invariants: `playbooks/store.ts`); item 04 lifts it |
| A p8 PUT route would break `app/src/api/contract.test.ts` (outside every lane) | LOW | Every p8 route is GET or POST (AC4) |
| Appending integrations parts after `githubAppRoutesPart` breaks `integrations-github-app-contract.test.ts` | LOW | Insert before it (AC6) |
| The poll move silently changes behaviour (order, dedupe, cap of 100) | MEDIUM | Move the code verbatim; existing poll tests stay unedited and must pass (AC3) |
| Brief shape, docs-vs-code name drift between parallel subtasks | LOW | Shared names fixed in `## Subtask Structure`; Phase 4.5 integrated review checks they agree. Subtask 3 re-runs the whole `phase-8-foundation.test.ts` after appending, so subtask 2's pins still pass |
| The app's Team picker will offer the 2 new never categories before their matchers land (they render from the mirrored list) | LOW | Harmless: `never` only narrows. Item 05 adds the matchers. `app/e2e/phase-5-exit.spec.ts` keeps passing because they are accepted |
| Pre-existing: 3 tests in `app/src/screens/schedules/SchedulesScreen.test.tsx` ("the upcoming timeline") fail locally on unmodified `a0db691` (clock/timezone dependent; CI was green on that commit at 13:00Z) | MEDIUM | Not this item's. Workers must not edit that file. Judge AC9's app `npm test` by CI, or locally by "no failure except those 3, which also fail on base"; report them in the PR body as a follow-up |
| The app's Playwright e2e (e.g. `app/e2e/phase-5-exit.spec.ts`, `app/e2e/team.spec.ts`) was not run in the prototype | LOW | The CI `app` job runs it. Accepting (not refusing) the new never categories keeps phase-5-exit's derived charter valid. A lane that finds an e2e file needing a change stops and reports |
| Probe p15 spends tokens and opens a real PR when the owner runs it | LOW | The probe file states the cost, the target repo (studio-sandbox only, never `vendsy/*` or Tray), and its cleanup |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-02-phase-8-foundation-seams-and-probes.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-02T16:48:32Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/216
- **Branch:** feature/phase-8-foundation-seams-and-probes
- **Files changed:** 37
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** 3/3 subtasks merged (docs + probes; kernel closed sets/refusals + poll seam; automate feature, migration 020, p8 contract). Phase 4.5 round 1 PASS with 2 MEDIUM doc drifts fixed in 101de11; round 2 PASS. Kernel tsc + 3295 tests and check-docs green locally; app suites and Playwright e2e left to CI. Probes p14/p15 written, not run.

## Not verified
- **Playwright e2e (app/e2e/*)** — not run locally; CI app job runs it (subtasks 2, 3)
- **Probes p14/p15** — written, not run; owner runs after merge per D33 (subtask 1)
- **App npm test/typecheck/build on integrated branch** — worker-reported green except 3 pre-existing SchedulesScreen failures; not re-run by Supervisor (subtasks 2, 3)
