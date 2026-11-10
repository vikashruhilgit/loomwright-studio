# Supervisor Job: Wright drafts charters that cover the work, without the owner naming a tool (phase 8 item 16)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-09-144621/L4
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-16/2026-11-09-160016-wright-drafts-charters-that-cover-the-work.md
- **Base commit:** 04b78822f367ea988e77004bdc17349752b46ce4

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest) and the React app; no new stack. |
| 2 | Dependency Availability | GO | No new dependency: zod, the feature seam and the existing approval rail are enough. |
| 3 | Architecture Fit | GO | The feature seam (`mergeContributions`) already sees every registered tool; `kernel_agent_update` already exists for charter changes (requirement §Problem). Mechanism only (invariant 1). |
| 4 | Scope vs Supervisor Capability | CAUTION | About 40 files across kernel and app: over the `context-bound` bound, so 3 subtasks. |
| 5 | Hard Blockers | CAUTION | A playbook naming its jobs needs a column, so migration 023; another lane may also add a migration 023 (renumber on rebase). Several needed files are outside the requirement's Touches (recorded in `## Scope widening`). |

**Overall Verdict:** CAUTION

## Task
**Goal:** The kernel publishes a catalogue of the kernel tools a crew session can be granted (one plain purpose line and one job per tool, generated from the registered tools), Wright drafts charters from it, the charter approval card shows granted kernel tools grouped by job in plain language ahead of the raw `enforced:` names, and a playbook drafted, dry-run or enabled for a crew member that lacks tools its jobs need is caught with a plain-language gap and an exact `kernel_agent_update` proposal, before it is enabled.

**Problem Statement:**
The owner needs to approve a working crew member from plain words, because no user can be expected to know or paste kernel tool names (owner decision 2026-11-09).
Currently Wright drafts charters blind (the `kernel_agent_create` description names no tools), nothing checks a playbook against its member's `tool_policy`, and the approval card lists raw `mcp__kernel__…` names. In the phase 8 live run (setup step 6) this produced a developer with only the four read-only `kernel_github_pr_*` tools, discovered only as refused calls.
Success looks like: a held charter card that lists jobs in plain words; a playbook that cannot be enabled for a member lacking its jobs until a held `kernel_agent_update` closes the gap or the owner enables it anyway (recorded).

### Design (decided here; the Supervisor keeps it unless a test proves it wrong)
- **Job on the tool, purpose from the description (one source).** `ContributedTool` (`kernel/src/features/contribution.ts`) gains an optional `job` field naming one id from a closed job vocabulary `TOOL_JOBS` (id → plain label) defined in a new CLI-safe module `kernel/src/features/catalogue.ts`. Every shipped contributed tool declares its `job` beside its `name`; phase 1 tools map to `general` (AC6). The purpose line is derived from the tool's registered description (`purposeOf`): its first sentence, except that a leading `Read-only.` sentence (as in `kernel_automate_state`, `kernel_automate_merge_check` and `kernel_pr_route` at base) is skipped and the next sentence is used with ` (read only)` appended, so no card line reads only "Read-only." (the mockup's `const JOBS` shows real purposes). Descriptions are not rewritten. `mergeContributions` refuses a `job` outside `TOOL_JOBS` (`InvalidContributionError`). Proxied MCP connector tools (`kernel/src/integrations/mcp/tools.ts`) are connector grants, not catalogue entries (AC8); they keep no `job`.
- **The four walk jobs use the mockup's labels exactly** (`docs/design/mockups/chat-threads.html`, `const JOBS`): `automate_tickets` "Hand tickets to /automate" (`kernel_automate_prepare`, `kernel_automate_state`); `triage_pr_comments` "Triage PR comments" (`kernel_pr_route`, `kernel_github_pr_reply`, `kernel_github_pr_comment`, `kernel_github_pr_request_reviewers`); `ask_for_merge` "Ask for a merge" (`kernel_automate_merge_check`, `kernel_merge_approval_request`); `read_pr` "Read a PR" (`kernel_github_pr_get`, `kernel_github_pr_files`, `kernel_github_pr_diff`, `kernel_github_pr_comments`). Every other tool gets a plain job of its own feature (for example `comment_on_issues`, `manage_playbooks`, `manage_schedules`, `manage_crew`) or `general`.
- **Phase 1 descriptions move to a CLI-safe leaf** `kernel/src/tools/phase1-descriptions.ts` (the `descriptions` record now in `kernel/src/tools/server.ts`), so the catalogue and the tool server read one source.
- **Drafting context = the tool description.** `kernelToolDefinitions` / `heldToolCheckOf` in `server.ts` build the catalogue from the composition's own contributed list (phase 1 + every contributed tool) and append its text (jobs, tools, purposes) to the descriptions of `kernel_agent_create`, `kernel_agent_update`, `kernel_playbook_create` and `kernel_playbook_update`. If building it throws, the appended text says the catalogue is unavailable and tells Wright to say it can't see the kernel's tools and draft no tool list (AC9). The same catalogue is put on `ContributedToolContext` (`catalogue?`) so `beforeHold`, handlers and the fit check read it without importing `server.ts` or the feature registry (no module-load cycle; the CLI never loads the Agent SDK).
- **Playbooks name their jobs.** Migration `023_playbook_jobs` adds one column, `playbooks.jobs_json` (TEXT, null = none named); `kernel_playbook_create` / `_update` take optional `jobs` (ids from `TOOL_JOBS`, Wright's proposal from the owner's words, never from ticket or PR text); a jobs change makes a new version like any other field. `jobs` is a **change field like `name` and `intent`, not a policy field**: it joins `PLAYBOOK_CHANGE_FIELDS` (`kernel/src/playbooks/store.ts`), never `PLAYBOOK_POLICY_FIELDS`, so it has no `*_set_by` column, `studio playbooks set` does not take it, and the app's policy surfaces (`app/src/api/contract.ts`, `PlaybookPolicy.tsx`) are unchanged. The owner changes a playbook's jobs by asking Wright, like its intent.
- **Triage and reading comments.** Following the mockup, `kernel_github_pr_comments` is in `read_pr`, not `triage_pr_comments`. The catalogue text tells Wright that triaging PR comments also needs `read_pr` to read them; a playbook that names only `triage_pr_comments` is not flagged for a member lacking `kernel_github_pr_comments` (the declared-jobs limit, said in `docs/architecture/playbooks.md`).
- **The fit check** (new `kernel/src/playbooks/fit.ts`): for a crew member's playbook, missing = the tools of the playbook's jobs that the member's `tool_policy.allowedTools` does not allow (as `mcp__kernel__<name>`). It returns plain lines ("This playbook needs Ask for a merge; Mason doesn't have it."), `proposed_update` = the exact `kernel_agent_update` arguments (`id`, `changes.tool_policy` = current `allowedTools` plus exactly the missing tools, current `allowedBashPrefixes` unchanged, `expected_sha256` of the settings file), and `owner_steps` for connector grants the jobs' tools need (`requiresConnector` / `requiresConnectorLevel`) or the trigger's poll source needs, read through the leaf `kernel/src/agents/settings.ts` reader (never `kernel.ts`); a connector grant is never in `proposed_update` (AC8). Inputs are only the playbook's stored jobs, the catalogue and the member's settings file: no intent, ticket or PR text (AC10).
- **Where it runs:** the result of `kernel_playbook_create` / `_update` (crew member's playbook) and `kernel_playbook_dry_run` carries `fit`; their descriptions tell Wright to pass `fit.proposed_update` to `kernel_agent_update` in the same turn and to tell the owner the missing job in plain words. `kernel_playbook_enable` refuses `charter_gap` before the hold (and again in `enableApproved`) while a gap is open, unless the call sets `enable_anyway: true`; then the held display states the open gap and that the owner is enabling anyway, so the owner's approval records the choice (AC4).
- **The card (AC3, D9).** `createHead` and the update display in `kernel/src/agents/charter-tools.ts` put the granted kernel tools grouped by job, each with its purpose line, ahead of the `enforced:` line; non-kernel tools and Bash prefixes stay as today; the raw `enforced:` line stays, beneath. The head (plain lines included) must still fit `MAX_APPROVAL_DISPLAY` or the hold refuses, as today. The app's Approvals card renders the plain block first and the raw lines in a `<details>` "Kernel tool names, as enforced" (the mockup's `rawHTML`).

## Acceptance Criteria
- [ ] **AC1.** Given the kernel is running, when the catalogue is read, then every tool a crew session can be granted (phase 1 and every shipped contributed tool) appears exactly once, with a job and a non-empty purpose that is never just `Read-only.` (a tool whose description opens `Read-only.` gets its next sentence plus ` (read only)`). A test enumerates the registered tools (`PHASE1_TOOL_NAMES` plus `mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools`) and fails on any tool missing from the catalogue or lacking a purpose or job.
- [ ] **AC2.** Given Wright is asked to draft a charter, when its drafting context is assembled, then the catalogue (jobs, tools, purposes) is in it. A test pins the catalogue text in the descriptions `kernelToolDefinitions` publishes for `kernel_agent_create`, `kernel_agent_update` and `kernel_playbook_create`.
- [ ] **AC3.** Given a held charter create or update, when the owner opens its approval card, then the granted kernel tools are shown grouped by job with their purpose lines, ahead of any `mcp__kernel__…` name, and the raw `enforced:` line is still shown beneath. Kernel test on the display text (`kernel/test/agents-charter-tools.test.ts`), plus an app test on the rendered card (plain job text before the raw names; raw names inside the "Kernel tool names, as enforced" disclosure). Non-kernel tools and Bash prefixes are shown as today.
- [ ] **AC4.** Given a crew member whose `tool_policy` lacks a tool a playbook's jobs need, when Wright drafts (create or update) or dry-runs that playbook for it, then the result names the missing job in plain words and carries a `proposed_update` that, passed to `kernel_agent_update`, is held for the owner and adds exactly the missing tools. `kernel_playbook_enable` for that member is refused `charter_gap` until the gap is closed, unless the call sets `enable_anyway: true`, whose held display records that the owner is enabling with the gap open.
- [ ] **AC5.** Given the phase 8 walk's four playbooks (GitHub tickets and ClickUp tickets naming `automate_tickets`, Triage naming `triage_pr_comments`, Merge when ready naming `ask_for_merge`) and a member holding only the four read-only `kernel_github_pr_*` tools, when the fit check runs, then it names exactly the walk charter's (`MASON_TOOLS`, `kernel/test/phase-8-exit.test.ts`) tools the member lacks. Given the walk charter, it names none. The test reads `phase-8-exit.test.ts` as text and fails if its `MASON_TOOLS` list and the test's copy differ.
- [ ] **AC6.** Given a tool with no feature job (a phase 1 tool such as `kernel_task_list`), when the catalogue is built, then the tool still appears, under the `general` job, never dropped.
- [ ] **AC7.** Given the owner approved a charter with fewer jobs than a playbook later needs, when Wright drafts that playbook, then AC4's flow closes the gap through `kernel_agent_update`: no member is recreated and no file is hand-edited.
- [ ] **AC8.** Given a connector grant the jobs' tools or the trigger's poll source need (GitHub write, ClickUp), when the fit check runs, then the grant is not in `proposed_update`; the result names it as the owner's step on Team → the member's inspector, in plain words.
- [ ] **AC9.** Given a catalogue build that fails, when Wright's drafting tools are listed, then their descriptions say the kernel's tool catalogue is unavailable and tell Wright to say it can't see the kernel's tools and to draft no tool list; the card falls back to the raw names with a plain note, never a guessed grouping.
- [ ] **AC10.** Given a playbook whose intent, or a polled ticket or PR comment, names a kernel tool, when the fit check runs, then that text adds no tool to `proposed_update`: only the playbook's stored jobs, the catalogue and the member's settings feed it.
- [ ] **AC11 (Validation evidence).** Given the suites pass, then a committed evidence file `docs/evidence/wright-drafts-charters.md` contains the Validation 1 commands with their pass counts, the catalogue text for the walk's four jobs and AC5's fit output for the read-only member, and states that Validation 2 (the owner's live sentence in the packaged app) is pending the owner; the PR body links to it. It never writes a `Verdict:` line for Validation 2.

## Scope widening
- kernel/src/features/catalogue.ts
- kernel/src/tools/phase1-descriptions.ts
- kernel/src/approvals/tool.ts
- kernel/src/agents/delegate.ts
- kernel/src/triggers/tools.ts
- kernel/src/notifications/tool.ts
- kernel/src/loomwright/capabilities.ts
- kernel/src/automate/runner.ts
- kernel/src/automate/routing.ts
- kernel/src/integrations/github/tools.ts
- kernel/src/integrations/github/write-tools.ts
- kernel/test/tool-catalogue.test.ts
- kernel/src/store/migrations/023_playbook_jobs.ts
- kernel/src/store/migrations/index.ts
- kernel/test/store.test.ts
- kernel/test/phase-8-foundation.test.ts
- kernel/test/integrations-github-app-migration.test.ts
- kernel/test/brain-threads.test.ts
- kernel/test/integrations-foundation.test.ts
- docs/architecture/brain.md
- kernel/src/playbooks/store.ts
- kernel/src/playbooks/mirror.ts
- kernel/src/playbooks/fit.ts
- kernel/test/playbooks-fit.test.ts
- docs/architecture/approvals.md
- docs/evidence/wright-drafts-charters.md
- app/src/screens/approvals/CharterDisplay.tsx
- app/src/screens/approvals/CharterDisplay.test.tsx
- app/src/screens/approvals/ApprovalsScreen.tsx
- accepted: LP-SCOPE 2026-11-10

## Touched-file invariants

> Grounded at base `04b78822f367ea988e77004bdc17349752b46ce4`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/features/contribution.ts`** — keep: the CLI-safe import rule (`never the Agent SDK, the session manager or`) and the tool-name check `const TOOL_NAME = /^kernel_[a-z0-9_]{1,64}$/;`; keep refusal-not-override (`ContributionConflictError`); reuse: `InvalidContributionError` for a bad `job`, `defineTool` unchanged in signature; pinned by: `kernel/test/feature-seams.test.ts` (module graph).
- **`kernel/src/features/catalogue.ts`, `kernel/src/tools/phase1-descriptions.ts` (create)** — keep: CLI-safe like the feature seam (`kernel/src/features/contribution.ts`: `imports only zod and type-level kernel modules`); never import `../tools/server.js`, `../kernel.js` or the Agent SDK.
- **`kernel/src/tools/server.ts`** — keep: `export const KERNEL_TOOL_NAMES = PHASE1_TOOL_NAMES;` and `const descriptions: Record<KernelToolName, string>` typing (move the record, keep the type); `export function heldToolCheckOf(` keeps running `beforeHold` with `contextOf(sessionId)`; mirror: `assertKernelToolsList` / `listKernelTools` must still list every tool (a longer description must not break the SDK serialiser); pinned by: `kernel/test/kernel-tools.test.ts`, `kernel/test/tools-sdk-list.test.ts`.
- **`kernel/src/agents/charter-tools.ts`** — keep: `function enforcedLine(never: readonly string[]` builds the raw line from the PARSED charter only, byte-identical when there is no grant; keep the head-fit refusal `displayFitRefusal("the display's enforced, limits and workspaces lines", createHead(checked.charter))` covering the new plain lines too; keep `return { display: createDisplay(checked.charter) };`; keep the CLI-safe import list in its header; pinned by: `kernel/test/agents-charter-tools.test.ts` (`const ENFORCED = 'enforced: never:` and `expect(head[1]).toBe(`), `kernel/test/drafts-are-records.test.ts` (`kernel_agent_create's description carries the sentence`).
- **`kernel/src/agents/index.ts`** — keep: every part merged through `AGENT_PARTS`; add no import of the feature registry.
- **`kernel/src/playbooks/drafts.ts`, `dry-run.ts`, `enable.ts`** — keep: `refuseCrewDrafting` first on every Wright tool; the drafts↔dry-run call-time-only cycle (`A cycle by design`); enable's closed reason union (`"no_dry_run" | "playbook_looser_than_repo"`) and `throw new EnableRefused("no_dry_run"`; every check in `beforeHold` repeated in `enableApproved`; pinned by: `kernel/test/playbooks-drafts.test.ts`, `kernel/test/playbooks-dry-run.test.ts`, `kernel/test/playbooks-foundation.test.ts`, `kernel/test/drafts-are-records.test.ts`.
- **`kernel/src/playbooks/store.ts`, `mirror.ts`** — keep: `export const PLAYBOOK_POLICY_FIELDS` unchanged (`jobs` joins `PLAYBOOK_CHANGE_FIELDS` only) and the `*_set_by` setter rule; every change in one transaction then the mirror rewritten; the mirror's inert rendering (`Inert rendering (invariant 3)`).
- **`kernel/src/store/migrations/index.ts`** — keep: append-only ordering after `import { threadContinuity } from "./022_thread_continuity.js";`; pinned by: `kernel/test/store.test.ts` (`[22, "thread_continuity"]`).
- **Tool-defining files** (`approvals/tool.ts`, `agents/delegate.ts`, `triggers/tools.ts`, `notifications/tool.ts`, `loomwright/capabilities.ts`, `automate/runner.ts`, `automate/routing.ts`, `integrations/github/tools.ts`, `integrations/github/write-tools.ts`) — change only by adding `job:` beside `name:` in each `defineTool({`; leave descriptions unchanged (the card line comes from `purposeOf`, which skips a leading `Read-only.` sentence: `"Read-only. Whether Loomwright may merge one parked pull request now.` in `automate/runner.ts`); keep `requiresConnector` / `requiresConnectorLevel` as they are.
- **`kernel/src/brain/templates.ts`** — keep: the tool list line `- crew: kernel_agent_create, kernel_agent_update, kernel_agent_list, kernel_agent_message`; add the rule that Wright names jobs to the owner, never tool names; mirror: `docs/architecture/brain.md`'s `<!-- role-template:start -->` … `<!-- role-template:end -->` block must equal `ROLE_TEMPLATE` byte for byte (edit both together); pinned by: `kernel/test/brain.test.ts` (`toBe(ROLE_TEMPLATE)`).
- **`app/src/screens/approvals/ApprovalsScreen.tsx`, `subject.ts`** — keep: every untrusted field through `printable` (`{printable(a.display, true)}`) and `data-testid="approval-display"`; `export function approvalSubject(a: Approval)` unchanged; pinned by: `app/src/screens/approvals/ApprovalsScreen.test.tsx`, `subject.test.ts`.

## Closed enumerations touched

> Sibling grep at base `04b78822f367ea988e77004bdc17349752b46ce4`: `grep -rnF 'no_dry_run' --exclude-dir=node_modules --exclude-dir=.supervisor --exclude=CHANGELOG.md .` → 9 hits in 5 files.

- **`charter_gap`** (sibling: `no_dry_run`) — must be named in:
  - `kernel/src/playbooks/enable.ts` — the `EnableRefused` reason union (`"no_dry_run" | "playbook_looser_than_repo"`) and its refusal mapping — extend.
  - `docs/architecture/approvals.md` — the apply-refusal table row (`| \`no_dry_run\` |`) and the refusal list (`` `version_changed`, `no_dry_run`, `playbook_looser_than_repo` ``) — extend.
  - `docs/architecture/playbooks.md` — the numbered enable checks (`the current version has a \`done\` dry run (\`no_dry_run\`)`) — extend.
  - `kernel/test/approvals.test.ts` — a fixture's `apply_refused: "no_dry_run"` — no change: a sample value, not a closed list.
- **`playbook_jobs`** (migration; sibling: `thread_continuity`) — must be named in:
  - `kernel/src/store/migrations/index.ts` — the ordered migration list — extend.
  - `kernel/test/store.test.ts` — the applied-migrations pins (`[22, "thread_continuity"]`, `knownVersion).toBe(22)`) — extend to 23.
  - `kernel/test/phase-8-foundation.test.ts` — "last migration" pins (`.at(-1)).toEqual([22, "thread`, lines 642 and 685) and the test title at 632 — extend to 23.
  - `kernel/test/integrations-github-app-migration.test.ts` — last-migration pins (lines 90, 135) and the title at 60 — extend to 23.
  - `kernel/test/brain-threads.test.ts` — the last-migration pin (line 251) — extend to 23; its `[threadContinuity.version, threadContinuity.name]` identity pin (234) — no change: it names migration 22 itself, not the last one.
  - `kernel/test/integrations-foundation.test.ts` — last-migration pins (336, 414, 464), the title at 319 and the comment at 430 — extend to 23; its identity pin (331) — no change.

- **`jobs`** (playbook change field; sibling: `intent`, and the policy list `PLAYBOOK_POLICY_FIELDS` checked by `grep -rn "PLAYBOOK_POLICY_FIELDS\|PLAYBOOK_CHANGE_FIELDS" kernel/src kernel/test app/src docs` → 22 hits in 8 files) — must be named in:
  - `kernel/src/playbooks/store.ts` — `export const PLAYBOOK_CHANGE_FIELDS = ["name", "intent", "trigger", ...PLAYBOOK_POLICY_FIELDS] as const;` (and the "at least one of" check that reads it) — extend with `"jobs"`.
  - `kernel/src/playbooks/store.ts` — `export const PLAYBOOK_POLICY_FIELDS = [...]` and its readers (`setPolicy`, the setter loop) — no change: `jobs` is not an owner-set policy value and has no `*_set_by`.
  - `kernel/src/playbooks/drafts.ts` — `studio playbooks set`'s field check (`PLAYBOOK_POLICY_FIELDS.join(", ")`) — no change, same reason.
  - `kernel/src/playbooks/index.ts` — re-exports of both lists — no change: a re-export, not a list.
  - `app/src/screens/chat/cards.tsx`, `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx` — mirror the policy list only — no change: `jobs` is not a policy field.
  - `kernel/test/console-contract.test.ts` — pins the app's policy rows equal `PLAYBOOK_POLICY_FIELDS` in order — no change: that list is unchanged, so the pin stays green.
  - `docs/ARCHITECTURE.md`, `docs/evidence/gui-v2-mockup/README.md` — prose naming the policy list — no change.

> Sibling grep for the migration: `grep -rnF 'thread_continuity' kernel/test` → 25 hits in 5 files (`store.test.ts` and the four rows above; the `import { threadContinuity }` lines are no change).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/tool-catalogue.test.ts` — AC1 every registered tool has a job | delete `job: "triage_pr_comments",` in `kernel/src/automate/routing.ts` |
| `kernel/test/tool-catalogue.test.ts` — AC1 no purpose is just `Read-only.` | make `purposeOf` return the first sentence unconditionally in `kernel/src/features/catalogue.ts` |
| `kernel/test/tool-catalogue.test.ts` — AC6 phase 1 tools under `general` | remove the phase 1 tools from the catalogue build in `kernel/src/features/catalogue.ts` (they must fail as missing, not silently pass) |
| `kernel/test/tool-catalogue.test.ts` — AC2 catalogue in drafting descriptions | drop the catalogue append for `kernel_agent_create` in `kernel/src/tools/server.ts` |
| `kernel/test/tool-catalogue.test.ts` — AC9 unavailable catalogue says so | make the catalogue build failure append nothing in `kernel/src/tools/server.ts` |
| `kernel/test/agents-charter-tools.test.ts` — AC3 job lines ahead of `enforced:` | move the job lines after the `enforcedLine(...)` call in `createHead` in `kernel/src/agents/charter-tools.ts` |
| `kernel/test/playbooks-fit.test.ts` — AC5 walk gap is exactly the walk charter's missing tools | flip `job: "automate_tickets",` → `job: "read_pr",` in `kernel/src/automate/runner.ts` |
| `kernel/test/playbooks-fit.test.ts` — AC4 enable refused `charter_gap` | delete the `charter_gap` throw in `enableApproved` / `beforeHold` in `kernel/src/playbooks/enable.ts` |
| `kernel/test/playbooks-fit.test.ts` — AC8 connector never proposed | add the connector to `proposed_update.changes` in `kernel/src/playbooks/fit.ts` |
| `kernel/test/playbooks-fit.test.ts` — AC10 intent adds nothing | read tool names from the playbook's `intent` in `kernel/src/playbooks/fit.ts` |
| `app/src/screens/approvals/CharterDisplay.test.tsx` — AC3 rendered order | render the raw lines before the plain block in `app/src/screens/approvals/CharterDisplay.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Tool catalogue, job declarations, drafting context and the charter display text (kernel) | AC1, AC2, AC3 (kernel half), AC6, AC9 | 20 modify, 3 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Playbook jobs, the fit check, `charter_gap` on enable, docs and evidence (kernel) | AC4, AC5, AC7, AC8, AC10, AC11 | 15 modify, 4 create | `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |
| 3 | The charter card in plain language (app) | AC3 (app half) | 3 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md` | BLOCKED (by #1) |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| 1 catalogue | `kernel/src/features/contribution.ts` (657 — the single authority for the tool shape; the catalogue itself lives in the new module), `kernel/src/tools/server.ts` (637 — the one place descriptions are published; the record moves out), `kernel/src/agents/charter-tools.ts` (859 — `createHead` / update display only; grouping lines come from `catalogue.ts`), `kernel/src/agents/index.ts` (208), `kernel/src/brain/templates.ts` (189), `kernel/src/approvals/tool.ts` (82), `kernel/src/agents/delegate.ts` (240), `kernel/src/triggers/tools.ts` (101), `kernel/src/notifications/tool.ts` (50), `kernel/src/loomwright/capabilities.ts` (108), `kernel/src/automate/runner.ts` (245), `kernel/src/automate/routing.ts` (241), `kernel/src/integrations/github/tools.ts` (206), `kernel/src/integrations/github/write-tools.ts` (157), `kernel/src/playbooks/drafts.ts` (785 — `job:` lines only in subtask 1), `kernel/src/playbooks/dry-run.ts` (585 — `job:` line only), `kernel/src/playbooks/enable.ts` (486 — `job:` line only), `kernel/test/agents-charter-tools.test.ts` (896 — AC3 kernel pins beside the existing display pins), `docs/architecture/agents.md` (317), `docs/architecture/brain.md` (346 — the role-template mirror of `ROLE_TEMPLATE`) | `kernel/src/features/catalogue.ts` (TOOL_JOBS, buildToolCatalogue, purposeOf, catalogue text and job-grouped display lines), `kernel/src/tools/phase1-descriptions.ts`, `kernel/test/tool-catalogue.test.ts` | HIGH |
| 2 fit | `kernel/src/store/migrations/index.ts` (51), `kernel/test/store.test.ts` (2225 — migration pins only, one-line edits), `kernel/test/phase-8-foundation.test.ts` (711), `kernel/test/integrations-github-app-migration.test.ts` (152), `kernel/test/brain-threads.test.ts` (810), `kernel/test/integrations-foundation.test.ts` (933) (each: last-migration pins only, one-line edits), `kernel/src/playbooks/store.ts` (772 — jobs column read/write beside the other policy fields), `kernel/src/playbooks/mirror.ts` (219), `kernel/src/playbooks/drafts.ts` (785 — `jobs` arg and `fit` in the result; the check lives in `fit.ts`), `kernel/src/playbooks/dry-run.ts` (585 — `fit` in the result), `kernel/src/playbooks/enable.ts` (486), `kernel/test/playbooks-dry-run.test.ts` (1088 — one `fit` case beside the dry-run result pins; the rest go in the new test), `docs/architecture/playbooks.md` (129), `docs/architecture/approvals.md` (280), `docs/evidence/phase-8-exit-runbook.md` (187) | `kernel/src/store/migrations/023_playbook_jobs.ts`, `kernel/src/playbooks/fit.ts`, `kernel/test/playbooks-fit.test.ts`, `docs/evidence/wright-drafts-charters.md` | HIGH |
| 3 app | `app/src/screens/approvals/ApprovalsScreen.tsx` (1037 — a few lines to render the new component for the three kernel-applied charter tools), `app/src/screens/approvals/subject.ts` (179 — pure `charterDisplayParts(display)` split) | `app/src/screens/approvals/CharterDisplay.tsx`, `app/src/screens/approvals/CharterDisplay.test.tsx` | MEDIUM |

`app/src/screens/approvals/subject.test.ts` (134) is modified too (the split's unit test): counted in subtask 3's lanes.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/features/catalogue.ts"}
  - {kind: "symbol", path: "kernel/src/features/catalogue.ts", name: "TOOL_JOBS"}
  - {kind: "symbol", path: "kernel/src/features/catalogue.ts", name: "buildToolCatalogue"}
  - {kind: "type", path: "kernel/src/features/catalogue.ts", name: "ToolCatalogue"}
  - {kind: "file", path: "kernel/src/tools/phase1-descriptions.ts"}
  - {kind: "symbol", path: "kernel/src/features/contribution.ts", name: "job"}
  - {kind: "symbol", path: "kernel/src/features/contribution.ts", name: "catalogue"}
  - {kind: "symbol", path: "kernel/src/agents/charter-tools.ts", name: "createDisplay"}
  - {kind: "file", path: "kernel/test/tool-catalogue.test.ts"}
requires: []
lanes:
  - "kernel/src/features/contribution.ts"
  - "kernel/src/features/catalogue.ts"
  - "kernel/src/tools/server.ts"
  - "kernel/src/tools/phase1-descriptions.ts"
  - "kernel/src/agents/charter-tools.ts"
  - "kernel/src/agents/index.ts"
  - "kernel/src/brain/templates.ts"
  - "kernel/src/approvals/tool.ts"
  - "kernel/src/agents/delegate.ts"
  - "kernel/src/triggers/tools.ts"
  - "kernel/src/notifications/tool.ts"
  - "kernel/src/loomwright/capabilities.ts"
  - "kernel/src/automate/runner.ts"
  - "kernel/src/automate/routing.ts"
  - "kernel/src/integrations/github/tools.ts"
  - "kernel/src/integrations/github/write-tools.ts"
  - "kernel/src/playbooks/drafts.ts"
  - "kernel/src/playbooks/dry-run.ts"
  - "kernel/src/playbooks/enable.ts"
  - "kernel/test/agents-charter-tools.test.ts"
  - "kernel/test/tool-catalogue.test.ts"
  - "docs/architecture/agents.md"
  - "docs/architecture/brain.md"
external_requires: []

# Subtask 2
provides:
  - {kind: "file", path: "kernel/src/store/migrations/023_playbook_jobs.ts"}
  - {kind: "file", path: "kernel/src/playbooks/fit.ts"}
  - {kind: "symbol", path: "kernel/src/playbooks/fit.ts", name: "playbookFit"}
  - {kind: "symbol", path: "kernel/src/playbooks/enable.ts", name: "charter_gap"}
  - {kind: "file", path: "kernel/test/playbooks-fit.test.ts"}
  - {kind: "file", path: "docs/evidence/wright-drafts-charters.md"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/features/catalogue.ts", name: "buildToolCatalogue"}
  - {from: "1", kind: "type", path: "kernel/src/features/catalogue.ts", name: "ToolCatalogue"}
  - {from: "1", kind: "symbol", path: "kernel/src/features/contribution.ts", name: "catalogue"}
lanes:
  - "kernel/src/store/migrations/023_playbook_jobs.ts"
  - "kernel/src/store/migrations/index.ts"
  - "kernel/test/store.test.ts"
  - "kernel/test/phase-8-foundation.test.ts"
  - "kernel/test/integrations-github-app-migration.test.ts"
  - "kernel/test/brain-threads.test.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/src/playbooks/store.ts"
  - "kernel/src/playbooks/mirror.ts"
  - "kernel/src/playbooks/fit.ts"
  - "kernel/src/playbooks/drafts.ts"
  - "kernel/src/playbooks/dry-run.ts"
  - "kernel/src/playbooks/enable.ts"
  - "kernel/test/playbooks-fit.test.ts"
  - "kernel/test/playbooks-dry-run.test.ts"
  - "docs/architecture/playbooks.md"
  - "docs/architecture/approvals.md"
  - "docs/evidence/phase-8-exit-runbook.md"
  - "docs/evidence/wright-drafts-charters.md"
external_requires: []

# Subtask 3
provides:
  - {kind: "file", path: "app/src/screens/approvals/CharterDisplay.tsx"}
  - {kind: "symbol", path: "app/src/screens/approvals/CharterDisplay.tsx", name: "CharterDisplay"}
  - {kind: "symbol", path: "app/src/screens/approvals/subject.ts", name: "charterDisplayParts"}
  - {kind: "file", path: "app/src/screens/approvals/CharterDisplay.test.tsx"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/agents/charter-tools.ts", name: "createDisplay"}
lanes:
  - "app/src/screens/approvals/CharterDisplay.tsx"
  - "app/src/screens/approvals/CharterDisplay.test.tsx"
  - "app/src/screens/approvals/ApprovalsScreen.tsx"
  - "app/src/screens/approvals/subject.ts"
  - "app/src/screens/approvals/subject.test.ts"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
Subtask 1 ──→ Subtask 3
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | `kernel/src/playbooks/drafts.ts`, `dry-run.ts`, `enable.ts` (subtask 1 adds only `job:` lines) | YES (2 requires 1) |
| Subtask 1 | Subtask 3 | none | YES (3 requires 1's display format) |
| Subtask 2 | Subtask 3 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2, Subtask 3 (parallel — disjoint lanes, kernel playbooks vs app)
- **Recommended workers:** 2
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md` |
| 3 | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/test/phase-8-exit.test.ts:148` | yes | HOLDS | `const MASON_TOOLS = [` | tip 34 minutes ago, fetched <1h |
| `kernel/src/agents/charter-tools.ts:306` | yes | HOLDS | `"Ask the owner to create a crew member from a charter you draft from the owner's words: {id, …` (no tool catalogue) | tip 34 minutes ago, fetched <1h |
| `kernel/src/agents/charter-tools.ts:187` | yes | HOLDS | `function enforcedLine(never: readonly string[], allowedTools: readonly string[], …` | tip 34 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Scope: about 40 files across kernel and app (Feasibility (Phase 2.5)) | MEDIUM | Three subtasks split `context-bound`; subtask 1's edits to the nine tool-defining files are one `job:` line each. |
| Migration 023 collides with another lane's migration 023 (Feasibility (Phase 2.5)) | MEDIUM | Rebase on `main` before PR; renumber the file, its `index.ts` entry and every last-migration pin (`grep -rnF 'thread_continuity' kernel/test`: `store.test.ts`, `phase-8-foundation.test.ts`, `integrations-github-app-migration.test.ts`, `brain-threads.test.ts`, `integrations-foundation.test.ts`) together. |
| Paths outside the requirement's Touches (Feasibility (Phase 2.5)) | MEDIUM | Recorded in `## Scope widening` as `pending-coordinator`; each is a mechanical home the requirement's own design needs (the `job` field on every tool, the migration, the app card component). |
| Catalogue text makes the four drafting descriptions long; the SDK's bundled serialiser has failed on unusual shapes before (`tools/list` emptied) | MEDIUM | Keep the appended text plain prose (no new schema); `kernel/test/tools-sdk-list.test.ts` and `assertKernelToolsList` must stay green. |
| Job-grouped lines push a charter display head past `MAX_APPROVAL_DISPLAY` | MEDIUM | The head-fit refusal covers the new lines (invariant above); add a test where a long charter still refuses rather than cuts. |
| The fit check uses declared jobs, so a playbook whose jobs Wright under-declares passes the check yet hits a refusal mid-run (requirement Risks) | MEDIUM | Jobs are shown on the playbook mirror and the enable card; the dry run's own refusals still surface as today. Say this limit in `docs/architecture/playbooks.md`. The mockup's "Wright's dry run … refused them" copy is not built here; the enable card states the declared-jobs gap. |
| Module-load cycle: the catalogue needs every contribution, and the agents and playbooks parts are contributions | HIGH | The catalogue reaches tools only through `ContributedToolContext.catalogue` built by `server.ts` at composition; `catalogue.ts` never imports `features/index.ts`; `feature-seams.test.ts` stays green. |
| Prior churn on `contribution.ts` (12), `drafts.ts` (10), `server.ts` (8), `charter-tools.ts` (6), `enable.ts` (5) — Prior churn (postmortem ledger) | MEDIUM | Recurring classes `self_heal_churn` and `drain_churn`: keep each subtask's diff inside its lanes and run the full kernel suite before hand-back. |
| Validation 2 needs the owner's live run (a real model's job choice is not CI-pinnable) | LOW | AC11's evidence file states Validation 2 is pending the owner; no `Verdict:` line is written for it. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-10-wright-drafts-charters-cover-the-work.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-10T08:55:14Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/254
- **Branch:** feature/wright-drafts-charters-cover-the-work
- **Files changed:** 48
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unknown (no_driver_handover)
- **Summary:** All 3 subtasks merged (catalogue + job declarations + drafting context + charter display; playbook jobs, fit check, migration 023, charter_gap on enable, docs and evidence; app charter card). Phase 4.5 fixed a HIGH display-limit regression (iteration 1), a floor pin gap, doc drift and the adds/keeps card (iteration 2), and a second floor pin gap plus a gains-tools mark (iteration 3). The final fix 24ad1582 was not LLM re-reviewed; kernel 4322 passed / 16 skipped, app 3059 passed at that head. Resumed with --continue; the children check was skipped after verifying the prior session's worker settled in its own log.

## Not verified
- **Validation 2: the owner's live sentence in the packaged app** — needs the owner and a real model (subtask 2)
- **e2e charter card with job lines** — only a scratch Playwright probe, not pinned (subtask 3)
- **dark theme rendering of the new card** — probe captured the default theme only (subtask 3)
