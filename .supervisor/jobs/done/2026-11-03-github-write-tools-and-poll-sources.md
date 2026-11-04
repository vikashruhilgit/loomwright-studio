# Supervisor Job: GitHub write tools, and the github.issues and github.pr_comments poll sources

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-02-150636/L5
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8/2026-11-02-160005-github-write-tools-and-the-issue-and-comment-poll-sources.md
- **Base commit:** 20684c8f514a95d31860b0fdde4008d9fb1575d5

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel with vitest; the client already sends allowlisted POSTs through one `sendRequest`, and the tools use `defineTool` + zod. |
| 2 | Dependency Availability | GO | No new dependency: Node `fetch`, zod and the existing fakes (`FakeGitHubClient`). |
| 3 | Architecture Fit | GO | The never categories `gh_pr_request_reviewers` / `gh_pr_comment_reply` already exist (item 01), the gate already holds/drafts/denies any `outward` rail class, and `POLL_SOURCES` already names both sources. |
| 4 | Scope vs Supervisor Capability | CAUTION | About 26 files (the requirement's 11 Touches plus 15 more the owner approved on 2026-11-03), so it is over one worker's context: split `context-bound` into 2 sequential subtasks. |
| 5 | Hard Blockers | GO | None. Every test uses fakes. Nothing reaches GitHub, the Keychain or `vendsy/*`. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Give write-granted agents four approval-gated GitHub write tools (reply in a review thread, comment on a PR, comment on an issue, re-request reviewers), and let a playbook poll `github.issues` and `github.pr_comments`, with every item's author-controlled text wrapped as untrusted data.

**Problem Statement:**
The owner needs the kernel to write to GitHub and to poll issues and new PR comments, because Wright's ticket-to-PR and comment-triage playbooks (ROADMAP phase 8) need both.
Currently the kernel's GitHub tools are read-only (`kernel_github_pr_get` / `_diff` / `_files` / `_comments`), and `parsePollSpec` refuses every source but `github.pulls` (`poll_source_not_built`). So no playbook can answer a comment, re-request a reviewer or start from an issue.
Success looks like this: each write is held for approval (or recorded as a draft in draft mode, or denied `agent_boundary` by `never`) and is sent only on the owner's allow. Both sources poll through the existing dedupe, with no default filter, interval or key (invariant 1).

**Owner-approved Touches extension (2026-11-03, Launch Pad question "Touches" → "Extend Touches (Recommended)").** The requirement's Touches plus exactly these files. Nothing outside the combined list is changed; a worker that finds it needs another file stops and says so:
`kernel/src/integrations/types.ts`, `kernel/src/sessions/policy.ts`, `kernel/src/triggers/poll.ts`, `kernel/src/playbooks/items.ts`, `kernel/src/features/contribution.ts`, `kernel/src/integrations/tool-filter.ts`, `kernel/src/kernel.ts`, `kernel/test/fixtures/github-fake.ts`, `kernel/test/triggers-poll.test.ts`, `kernel/test/phase-8-foundation.test.ts`, `kernel/test/sessions-policy.test.ts`, `kernel/test/integrations-foundation.test.ts`, `kernel/test/tools-sdk-list.test.ts`, `docs/architecture/approvals.md`, `docs/ARCHITECTURE.md`.

### Design (binding for the workers)

1. **Client (`client.ts`).** Four write methods, each sent through the existing `sendRequest`, and only with an App installation credential (`provider.method === "app"`). The token (PAT) path stays read-only (owner decision: `token_write_scoped` unchanged), so a PAT credential answers `unreachable` and sends nothing:
   - `replyToReviewComment(repo, pull, commentId, body)` → `POST /repos/{o}/{r}/pulls/{n}/comments/{id}/replies`
   - `createPullComment(repo, pull, body)` → `POST /repos/{o}/{r}/issues/{n}/comments`
   - `createIssueComment(repo, issue, body)` → `POST /repos/{o}/{r}/issues/{n}/comments`
   - `requestReviewers(repo, pull, reviewers)` → `POST /repos/{o}/{r}/pulls/{n}/requested_reviewers` with body `{"reviewers": [...]}`

   `GITHUB_ALLOWED_NON_GET` gains exactly these three request shapes (the two comment methods share one endpoint), all `POST` and none a PUT, PATCH or DELETE. The shape type is generalised to more than one variable segment, and `isAllowedGitHubRequest` stays the single authority. Each answer returns only kernel values: the new comment's numeric id and `html_url`, or the PR number for a reviewer request. The same 401-renew-once rule as `get` applies.
   Two read listings feed the sources:
   - `listIssues(repo, filters)` → `GET /repos/{o}/{r}/issues` with `state`, `labels` and `assignee` passed as given. Entries carrying a `pull_request` key are dropped, because GitHub's issues listing includes PRs.
   - `listOpenPullComments(repo)` → for each open PR, its issue comments, its review comments and its reviews. Each entry is `{kind: "issue_comment"|"review_comment"|"review", id, pr, author, body, url, updated_at}`. A review has no `updated_at`, so its `submitted_at` is used.
2. **Types (`types.ts`).** `GitHubClient` gains the six methods. Add the types `GitHubCommentResult`, `GitHubIssueSummary` (`number`, `title`, `body`, `author`, `labels`, `url`, `updated_at`) and `GitHubPrComment`. `PollSpec.source` widens to `"github.pulls" | "github.issues" | "github.pr_comments"`, and `PollSpec.filters` gains `labels?: readonly string[]` and `assignee?: string`. `SourceItem` gains the optional fields `text` (the issue or comment body: untrusted), `author`, `kind` and `pr`.
3. **Write tools (`write-tools.ts`, CREATE).** `kernel_github_pr_reply(repo, pr, comment_id, body)`, `kernel_github_pr_comment(repo, pr, body)`, `kernel_github_issue_comment(repo, issue, body)` and `kernel_github_pr_request_reviewers(repo, pr, reviewers[])`. Each is `requiresConnector: "github"` and the new `requiresConnectorLevel: "write"`. The body is a zod string of at most 65 536 characters, and each reviewer login uses the client's name characters (1–100 reviewers). Each handler reuses `tools.ts`'s `requireReach`, `dataOf`, `refusal` and `repoShape`, which are exported from there, never copied. The result text is kernel values only. The four are built in `createGitHubWriteTools()` and composed into `githubToolsPart.tools` after the four read tools. Bodies are model output: they are sent as given and never interpreted.
4. **Gate (`policy.ts`).** `classifyToolCall` answers `outward` for the four full names (`mcp__kernel__kernel_github_pr_reply`, …). The action is the name without `mcp__kernel__`, and the payload is `{tool, input, cwd}`, as for an always-held tool. `neverCategoriesOf` maps `kernel_github_pr_reply`→`gh_pr_comment_reply`, `kernel_github_pr_comment`→`gh_pr_comment`, `kernel_github_issue_comment`→`gh_issue_comment` and `kernel_github_pr_request_reviewers`→`gh_pr_request_reviewers`. The four names are NOT added to `ALWAYS_HELD_TOOLS` and NOT to `KERNEL_APPLIED_ACTIONS`, so the owner's per-playbook "always" may cover them. An approved-once call is repeated by the agent, and the repeat consumes the grant and runs the handler. `manager.ts`, `draft-mode.ts` and `dry-run.ts` are unchanged: their existing `outward` branches give the boundary deny, the draft row (`draftPayloadOf` kind `input`), the dry-run would-do and the hold. The policy.ts comment saying the two categories have "no matcher yet" is rewritten to name the tools.
5. **Write level (`contribution.ts`, `tool-filter.ts`, `kernel.ts`).** `ContributedTool` gains an optional `requiresConnectorLevel?: "write"`. `toolsForConnectors(tools, connectors, githubWrite = false)` drops a write-level tool unless `githubWrite` is true. `kernel.ts`'s `mcpServers` factory passes `githubWriteFor(dataDir)(agent)` (false with no agent or on a throw). The level is the agent's grant (`connectors: {github: "write"}`), not the playbook's mode, so a draft playbook's write-granted agent lists the tools and its calls become drafts (AC 2).
6. **Sources (one file each, CREATE).**
   - `sources/github-issues.ts`: `fetchGithubIssues`. The ref is `github:<owner>/<repo>#<number>`, the revision is `updated_at`, `title` is the issue title and `text` is its body.
   - `sources/github-pr-comments.ts`: `fetchGithubPrComments`. The ref is `github:<owner>/<repo>#<pr>:<kind>:<comment id>`, so the three GitHub id spaces never collide; the comment id is the item id, as the requirement says. The revision is `updated_at` (`submitted_at` for a review), and the item carries `pr`, `author`, `kind` and `text`.

   Both reuse `SourceFetch` from `sources/github-pulls.ts` (imported, not redefined) and keep its failure mapping. Neither has a default filter, interval or dedupe key.
7. **Poll (`poll.ts`).** `parsePollSpec` accepts `github.issues` and `github.pr_comments`, and still refuses `jira.issues` and `clickup.tasks` `poll_source_not_built`. Filter keys are checked per source: `github.pulls` takes `state`, `draft` and `author` (unchanged); `github.issues` takes `state`, `labels` (a non-empty array of 1–200-character strings) and `assignee`; `github.pr_comments` takes none, so any key is `poll_filter_unknown`. `POLL_FILTER_KEYS` stays the union, because `playbooks/drafts.ts` joins it as text. `fetchPollItems` dispatches by `spec.source`, and `MAX_POLL_ITEMS` still caps.
8. **Items (`items.ts`).** `GITHUB_ITEM_REF` also accepts the comment ref `#<n>:(issue_comment|review_comment|review):<id>`. `runItemOf` accepts the optional `text`, `author`, `kind` and `pr`. `itemPromptBlock` renders `author`, `kind`, `pr` and `text` (`text` cut to a new bounded `MAX_ITEM_TEXT_PROMPT_CHARS`) INSIDE the one `wrapUntrusted(ref, …)` block. Nothing author-controlled goes outside it.
9. **Dry run (`dry-run-poll.ts`).** The preview lists the new sources' items exactly as it lists pulls, through `fetchPollItems`. `wrapPollForModel` also wraps an item's `text` when one is present.

## Acceptance Criteria
- [ ] 1. Given a live session whose agent holds `github: write`, when it calls `kernel_github_pr_request_reviewers`, then the call is held as an approval whose action is `kernel_github_pr_request_reviewers` and whose payload names the repo, the PR and the reviewers. Once the owner allows it once and the agent repeats the call, the fake client receives exactly one `requestReviewers(repo, pr, reviewers)` with those values.
- [ ] 2. Given a draft playbook's session whose agent holds `github: write`, when it calls `kernel_github_pr_reply`, then one `draft_outputs` row is recorded, the hook denies with `draft_mode`, and the fake client receives no request.
- [ ] 3. Given an agent whose `never` list holds `gh_pr_request_reviewers`, when it calls `kernel_github_pr_request_reviewers`, then the call is denied `agent_boundary`: no approval is written and no request is sent. The same holds for each of the other three tools against its own category.
- [ ] 4. Given a `github.pr_comments` poll whose playbook's dedupe key names `item.id` and `item.revision`, when a comment's `updated_at` changes between two polls, then it fires once more; when the comment is unchanged, the second poll skips it (`poll_item_skipped`).
- [ ] 5. Given a `github.issues` item whose body contains an instruction, when its run's prompt is built (`itemPromptBlock`) and when the dry run shows it to the model (`wrapPollForModel`), then the body appears only inside the item's `<untrusted-data source="github:…">` block.
- [ ] 6. Given an agent with the `github` grant but not `github: write`, when its session's kernel tool list is built, then it lists the four read tools and none of the four write tools. With `github: write` it lists all eight.
- [ ] 7. Given the client, then `GITHUB_ALLOWED_NON_GET` is exactly the mint, the manifest conversion and the three write shapes, each pinned in `integrations-github-client.test.ts`. A write method called with a PAT credential sends nothing and answers `unreachable`.
- [ ] 8. Given a poll spec naming `jira.issues` or `clickup.tasks`, then it is still refused `poll_source_not_built`. A `github.issues` spec with `labels`/`assignee` parses, and a `github.pr_comments` spec with any filter key is refused `poll_filter_unknown`.
- [ ] 9. Given `cd kernel && npm ci && npm run typecheck && npm test` and `bash scripts/check-docs.sh`, then both pass. `docs/architecture/github-tools.md` documents the four write tools, `docs/architecture/triggers.md` documents both sources and links `mcp-connectors.md` for `jira.issues` and `clickup.tasks`, and `docs/architecture/approvals.md` names the tools under their categories.

## File Impact Map

| Path (lines at base) | Action | Subtask | Confidence | Home / why |
|---|---|---|---|---|
| `kernel/src/integrations/github/client.ts` (789) | MODIFY | 1 | HIGH | (789: the single authority for what may be sent, `isAllowedGitHubRequest` + `sendRequest`, which the writes must go through, so they append here) |
| `kernel/src/integrations/github/write-tools.ts` | CREATE | 1 | HIGH | new responsibility: the four write tools |
| `kernel/src/integrations/github/tools.ts` (194) | MODIFY | 1 | HIGH | export `requireReach`/`dataOf`/`refusal`/`repoShape` for reuse; compose the write tools into `githubToolsPart` |
| `kernel/src/integrations/types.ts` (322) | MODIFY | 1 | HIGH | client interface, issue/comment types, `PollSpec`, `SourceItem` |
| `kernel/src/sessions/policy.ts` (1129) | MODIFY | 1 | HIGH | (1129: the single authority for the rail's classes and `neverCategoriesOf`; the new outward names must sit beside `ALWAYS_HELD_TOOLS` in `classifyToolCall`) |
| `kernel/src/features/contribution.ts` (651) | MODIFY | 1 | HIGH | (651: the single declaration of `ContributedTool`; one optional field) |
| `kernel/src/integrations/tool-filter.ts` (19) | MODIFY | 1 | HIGH | the write-level filter |
| `kernel/src/kernel.ts` (430) | MODIFY | 1 | HIGH | pass the agent's write grant to `toolsForConnectors` |
| `kernel/test/fixtures/github-fake.ts` (116) | MODIFY | 1 | HIGH | the fake implements the six new methods and records writes |
| `kernel/test/integrations-github-client.test.ts` (1126) | MODIFY | 1 | HIGH | (1126: the existing allowlist pin, `GITHUB_ALLOWED_NON_GET.map`, lives here; new write/listing cases append beside it) |
| `kernel/test/integrations-github-write-tools.test.ts` | CREATE | 1 | HIGH | ACs 1, 2, 3, 6 |
| `kernel/test/sessions-policy.test.ts` (491) | MODIFY | 1 | HIGH | drop `NO_MATCHER_YET`; label rows for the four tools |
| `kernel/test/integrations-foundation.test.ts` (905) | MODIFY | 1 | HIGH | (905: extend its existing merged-tool-names pin only) |
| `kernel/test/tools-sdk-list.test.ts` (372) | MODIFY | 1 | MEDIUM | add the four tools to its per-tool map |
| `kernel/test/triggers-poll.test.ts` (815) | MODIFY | 1, 2 | HIGH | (815: existing file) subtask 1: `HookedClient` implements the six methods (typecheck); subtask 2: the `github.issues` "another source" case becomes a valid spec |
| `docs/architecture/github-tools.md` (48) | MODIFY | 1 | HIGH | the write tools |
| `docs/architecture/approvals.md` (262) | MODIFY | 1 | HIGH | the category table names the tools |
| `kernel/src/triggers/sources/github-issues.ts` | CREATE | 2 | HIGH | new source |
| `kernel/src/triggers/sources/github-pr-comments.ts` | CREATE | 2 | HIGH | new source |
| `kernel/src/triggers/poll.ts` (555) | MODIFY | 2 | HIGH | (555: the single home of `parsePollSpec`/`fetchPollItems`; per-source filter check + dispatch only, the fetches live in the two CREATEs) |
| `kernel/src/playbooks/items.ts` (228) | MODIFY | 2 | HIGH | ref shape, optional fields, prompt block |
| `kernel/src/playbooks/dry-run-poll.ts` (351) | MODIFY | 2 | MEDIUM | wrap `text` for the model |
| `kernel/test/triggers-poll-github-sources.test.ts` | CREATE | 2 | HIGH | ACs 4, 5, 8 |
| `kernel/test/phase-8-foundation.test.ts` (539) | MODIFY | 2 | HIGH | (539: the refused-sources loop narrows to `jira.issues`, `clickup.tasks`) |
| `docs/architecture/triggers.md` (171) | MODIFY | 2 | HIGH | the two sources + the `mcp-connectors.md` line |
| `docs/ARCHITECTURE.md` (322) | MODIFY | 2 | HIGH | the stale "refused until its item lands" / "matchers come with the item" sentence |

**Total estimated files:** 21 modify + 5 create. No helper is copied: `SourceFetch` is imported from `sources/github-pulls.ts`, and the tool helpers are exported from `tools.ts`.

## Touched-file invariants

> Grounded at base `20684c8f514a95d31860b0fdde4008d9fb1575d5`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/integrations/github/client.ts`**: keep: every request goes through one `sendRequest` with `redirect: "manual"` and the check `if (!isAllowedGitHubRequest(method, url)) return { kind: "failure", failure: UNREACHABLE };`, and a GET stays allowed by `if (method === "GET") return true;`. Keep the fail-closed `const UNREACHABLE: GitHubFailure = Object.freeze({ ok: false, error: "unreachable", rateLimit: null });` and "nothing here logs". Reuse: the renew-once rule `if (!unauthorized || s.renewed || s.provider.renew === undefined) return first;` (a write's own 401 path follows it), plus `repoPath` and `isPullNumber` for every path part. Pinned by: `kernel/test/integrations-github-client.test.ts` `expect(GITHUB_ALLOWED_NON_GET.map((a) => [a.method, a.prefix, a.suffix])).toEqual([`. That pin must be rewritten to the generalised shape and must still list the mint and conversion first.
- **`kernel/src/integrations/github/tools.ts`**: keep: the read tools' order and names, the check order (connector → reach → one client call) `function requireReach(store: Store, repo: string): void {`, and every author text inside `return wrapUntrusted(sourceOf(args.repo, args.number), inner);`. Keep the closed `GITHUB_TOOL_REFUSALS` `"connector_missing", "repo_not_reachable", "rate_limited", "github_http_error", "github_unreachable"` (the write tools reuse it, no new code). Mirror: the module imports only types, the feature seam, the wrapper, the client and the connector's row reader (`kernel/test/feature-seams.test.ts`), and `write-tools.ts` follows the same import rule.
- **`kernel/src/integrations/types.ts`**: keep: `export interface GitHubClient {` is implemented by the real client, `FakeGitHubClient` and `HookedClient`, and all three gain the six methods in subtask 1, so typecheck stays green between subtasks. `readonly source: "github.pulls";` widens to the three GitHub sources only, never `jira.issues` or `clickup.tasks`.
- **`kernel/src/sessions/policy.ts`**: keep: `export const ALWAYS_HELD_TOOLS: readonly string[] = Object.freeze([` is unchanged (an "always" grant must be able to cover the write tools). Keep `NEVER_CATEGORIES` order and contents, pinned by `kernel/test/phase-8-foundation.test.ts` `expect(NEVER_CATEGORIES.slice(at, at + 4)).toEqual(["gh_pr_close", "gh_pr_request_reviewers", "gh_pr_comment_reply", "gh_issue_create"]);`. Reuse: the always-held branch's payload shape `{ tool: toolName, input: toolInput, cwd: payloadCwd }`. Pinned by: `kernel/test/sessions-policy.test.ts` `const NO_MATCHER_YET = ["gh_pr_request_reviewers", "gh_pr_comment_reply"];`, which goes away once both are reached.
- **`kernel/src/features/contribution.ts`**: keep: `readonly requiresConnector?: ConnectorKind;` and the zod-only/type-only import rule in its header. The new field is optional, so every existing tool is unchanged.
- **`kernel/src/integrations/tool-filter.ts`**: keep: `return tools.filter((t) => t.requiresConnector === undefined || connectors.includes(t.requiresConnector));` semantics for tools without a level (it only narrows), and type-only imports.
- **`kernel/src/kernel.ts`**: keep: `githubWriteFor: githubWriteFor(dataDir),` as the one reader of the write grant, reused for the tool list. `toolsForConnectors(contributions.tools, connectors)` gains the third argument only. A throw while reading the grant lists no write tool (fail closed).
- **`kernel/src/triggers/poll.ts`**: keep: `export const MAX_POLL_ITEMS = 100;` applied after dispatch, and `poll_interval_below_floor` / `invalid_spec` / `poll_filter_unknown` codes unchanged. The refusal text `poll_source_not_built:` stays for `jira.issues` and `clickup.tasks`. Mirror: `kernel/src/playbooks/drafts.ts` joins `POLL_FILTER_KEYS` as text, so keep it exported as the union.
- **`kernel/src/playbooks/items.ts`**: keep: a ref that fails `GITHUB_ITEM_REF` is refused, never wrapped (the ref prints raw outside the wrapper). `MAX_ITEM_REF_CHARS = 512` stays. Every author field goes inside `wrapUntrusted(ref, fields)`. The module's import list is unchanged (CLI loads it).
- **`kernel/src/playbooks/dry-run-poll.ts`**: keep: read-only, writing no queue row or event. `items: poll.items.map((i) => ({ ...i, title: wrapUntrusted(i.ref, i.title) })),` still wraps the title. The stored `result_json` keeps raw text.
- **`kernel/test/fixtures/github-fake.ts`**: keep: `export class FakeGitHubClient implements GitHubClient {` records every call (`#answer`) and never reaches the network. The write methods are recorded the same way so tests can assert "exactly that request" and "nothing sent".
- **`kernel/test/triggers-poll.test.ts`, `kernel/test/phase-8-foundation.test.ts`, `kernel/test/integrations-foundation.test.ts`, `kernel/test/tools-sdk-list.test.ts`**: keep every other case. Change only `class HookedClient implements GitHubClient {`, `[spec({ source: "github.issues" }), undefined],`, `for (const source of ["github.issues", "github.pr_comments", "jira.issues", "clickup.tasks"]) {`, `expect(merged.tools.map((t) => t.name)).toEqual(["kernel_github_pr_get", "kernel_github_pr_diff", "kernel_github_pr_files", "kernel_github_pr_comments"]);` and the `kernel_github_pr_comments: [],` map entry's neighbours.

## Closed enumerations touched

> Sibling grep at base `20684c8`: `grep -rnF 'kernel_github_pr_comments' kernel/src kernel/test docs app/src` → hits in 14 files. `grep -rnF 'POLL_FILTER_KEYS' kernel/src kernel/test app/src docs` → 4 hits in 3 files.

- **The four write tool names** (sibling: `kernel_github_pr_comments`). They must be named in:
  - `kernel/test/integrations-foundation.test.ts`: the merged tool-names pin. Extend.
  - `kernel/test/tools-sdk-list.test.ts`: the per-tool map. Extend.
  - `kernel/src/sessions/policy.ts`: `classifyToolCall` / `neverCategoriesOf`. Extend (Design 4).
  - `kernel/src/integrations/github/tools.ts`: `githubToolsPart.tools`. Extend (composition).
  - `docs/architecture/github-tools.md`, `docs/architecture/approvals.md`. Extend.
  - `kernel/src/sessions/dry-run.ts` `DRY_RUN_GITHUB_READ_TOOLS`: no change, because a dry run must never list a write tool as read-only.
  - `kernel/src/sessions/draft-mode.ts` `GITHUB_CLI_DENY_REASON`, `kernel/src/brain/templates.ts`, `docs/architecture/brain.md`, `docs/architecture/draft-mode.md`: no change. They name the read tools as text for reading.
  - `kernel/test/phase-6-exit.test.ts`, `kernel/test/playbooks-dry-run-poll.test.ts`, `kernel/test/sessions-dry-run-draft.test.ts`, `kernel/test/brain.test.ts`, `kernel/test/draft-mode.test.ts`, `kernel/test/integrations-github-tools.test.ts`: no change. They are read-tool lists by design.
- **Filter keys `labels`, `assignee`** (sibling: `author`). They must be named in:
  - `kernel/src/triggers/poll.ts`: `POLL_FILTER_KEYS` (the union) plus the new per-source key sets. Extend.
  - `kernel/src/integrations/types.ts`: `PollSpec.filters`. Extend.
  - `kernel/src/playbooks/drafts.ts`: joins `POLL_FILTER_KEYS` at runtime. No change, because it reads the constant.
  - `kernel/src/triggers/index.ts`: re-export only. No change.
  - `docs/architecture/triggers.md`: the filters line. Extend.
- **Item ref kinds `issue_comment`, `review_comment`, `review`** (new). They must be named in `kernel/src/playbooks/items.ts` `GITHUB_ITEM_REF`, `kernel/src/triggers/sources/github-pr-comments.ts`, `kernel/src/integrations/types.ts` (`GitHubPrComment.kind`) and `docs/architecture/triggers.md`.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/integrations-github-client.test.ts`: the rewritten `GITHUB_ALLOWED_NON_GET` pin | remove the requested-reviewers shape from the `GITHUB_ALLOWED_NON_GET` array in `kernel/src/integrations/github/client.ts` (pin must go red) |
| `kernel/test/integrations-github-client.test.ts`: a write with a PAT credential sends nothing | drop the `provider.method === "app"` check from the write path in `kernel/src/integrations/github/client.ts` |
| `kernel/test/integrations-github-write-tools.test.ts`: AC 1 held then sent once | remove the four names from the outward branch of `classifyToolCall` in `kernel/src/sessions/policy.ts` (the call would run unheld) |
| `kernel/test/integrations-github-write-tools.test.ts`: AC 3 `agent_boundary` | delete the `kernel_github_pr_request_reviewers` → `gh_pr_request_reviewers` mapping in `neverCategoriesOf` in `kernel/src/sessions/policy.ts` |
| `kernel/test/integrations-github-write-tools.test.ts`: AC 6 write tools not listed without the grant | make `toolsForConnectors` in `kernel/src/integrations/tool-filter.ts` ignore `requiresConnectorLevel` |
| `kernel/test/triggers-poll-github-sources.test.ts`: AC 4 edited comment fires again | set the pr-comments item's `revision` to the comment id instead of `updated_at` in `kernel/src/triggers/sources/github-pr-comments.ts` |
| `kernel/test/triggers-poll-github-sources.test.ts`: AC 5 body wrapped | render `text` outside `wrapUntrusted(ref, fields)` in `itemPromptBlock` in `kernel/src/playbooks/items.ts` |
| `kernel/test/triggers-poll-github-sources.test.ts`: issues listing drops PRs | delete the `pull_request` filter in `listIssues` in `kernel/src/integrations/github/client.ts` (or the source) |
| `kernel/test/phase-8-foundation.test.ts`: `jira.issues` / `clickup.tasks` still refused | delete the `poll_source_not_built` throw in `kernel/src/triggers/poll.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Client writes + listings, types, write tools, gate mapping, write-level listing | 1, 2, 3, 6, 7, 9 (its docs) | 15 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | `github.issues` + `github.pr_comments` sources, poll dispatch, item ref/text, dry run | 4, 5, 8, 9 (its docs) | 7 modify, 3 create | `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |

### Subtask Contracts

```yaml
# Subtask 1 — write tools (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/src/integrations/github/write-tools.ts"}
  - {kind: "symbol", path: "kernel/src/integrations/github/write-tools.ts", name: "createGitHubWriteTools"}
  - {kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "requestReviewers"}
  - {kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "listIssues"}
  - {kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "listOpenPullComments"}
  - {kind: "type", path: "kernel/src/integrations/types.ts", name: "GitHubIssueSummary"}
  - {kind: "type", path: "kernel/src/integrations/types.ts", name: "GitHubPrComment"}
  - {kind: "symbol", path: "kernel/src/features/contribution.ts", name: "requiresConnectorLevel"}
  - {kind: "file", path: "kernel/test/integrations-github-write-tools.test.ts"}
requires: []
lanes:
  - "kernel/src/integrations/github/client.ts"
  - "kernel/src/integrations/github/write-tools.ts"
  - "kernel/src/integrations/github/tools.ts"
  - "kernel/src/integrations/types.ts"
  - "kernel/src/sessions/policy.ts"
  - "kernel/src/features/contribution.ts"
  - "kernel/src/integrations/tool-filter.ts"
  - "kernel/src/kernel.ts"
  - "kernel/test/fixtures/github-fake.ts"
  - "kernel/test/integrations-github-client.test.ts"
  - "kernel/test/integrations-github-write-tools.test.ts"
  - "kernel/test/sessions-policy.test.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/test/tools-sdk-list.test.ts"
  - "kernel/test/triggers-poll.test.ts"
  - "docs/architecture/github-tools.md"
  - "docs/architecture/approvals.md"
external_requires: []

# Subtask 2 — poll sources (BLOCKED by #1)
provides:
  - {kind: "file", path: "kernel/src/triggers/sources/github-issues.ts"}
  - {kind: "symbol", path: "kernel/src/triggers/sources/github-issues.ts", name: "fetchGithubIssues"}
  - {kind: "file", path: "kernel/src/triggers/sources/github-pr-comments.ts"}
  - {kind: "symbol", path: "kernel/src/triggers/sources/github-pr-comments.ts", name: "fetchGithubPrComments"}
  - {kind: "symbol", path: "kernel/src/playbooks/items.ts", name: "MAX_ITEM_TEXT_PROMPT_CHARS"}
  - {kind: "file", path: "kernel/test/triggers-poll-github-sources.test.ts"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "listIssues"}
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "listOpenPullComments"}
  - {from: "1", kind: "type", path: "kernel/src/integrations/types.ts", name: "GitHubIssueSummary"}
  - {from: "1", kind: "type", path: "kernel/src/integrations/types.ts", name: "GitHubPrComment"}
lanes:
  - "kernel/src/triggers/sources/github-issues.ts"
  - "kernel/src/triggers/sources/github-pr-comments.ts"
  - "kernel/src/triggers/poll.ts"
  - "kernel/src/playbooks/items.ts"
  - "kernel/src/playbooks/dry-run-poll.ts"
  - "kernel/test/triggers-poll-github-sources.test.ts"
  - "kernel/test/triggers-poll.test.ts"
  - "kernel/test/phase-8-foundation.test.ts"
  - "docs/architecture/triggers.md"
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
| Subtask 1 | Subtask 2 | `kernel/test/triggers-poll.test.ts` | YES (already ordered: 2 requires 1) |

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
| Feasibility (Phase 2.5): about 26 files, over one worker's context | MEDIUM | Split `context-bound` into 2 sequential subtasks; subtask 1 owns every `types.ts` change so subtask 2 never edits it. |
| Owner rule: "Nothing is patched outside an item's Touches" | HIGH | The combined Touches list is in `## Task`. A worker that needs any other file (e.g. `manager.ts`, `draft-mode.ts`, `dry-run.ts`, `runs.ts`) stops and says so. Design 4 is chosen so those files stay unchanged. |
| A write tool added to `ALWAYS_HELD_TOOLS` would make an "always" grant impossible, and adding it to `KERNEL_APPLIED_ACTIONS` needs a synchronous applier that can't await a POST | HIGH | Design 4: rail `outward` by name, neither set. AC 1 asserts the hold-then-repeat path. |
| A write tool listed without the write grant, or a write sent with the PAT | HIGH | ACs 6 and 7, each with a pin mutation. The token path stays read-only (owner decision). |
| GitHub's issues listing includes PRs; reviews have no `updated_at`; the three comment id spaces collide | MEDIUM | Design 1 drops `pull_request` entries. A review's revision is `submitted_at`. The ref namespaces the kind (`#<pr>:<kind>:<id>`). |
| Per-kind "Always for this playbook" grants: the approvals store matches a grant on the exact payload, so an always grant covers one exact call, not every call of a kind | MEDIUM | Out of this item's scope (no AC needs it). Recorded so the per-kind grant item knows the write tools' payload is `{tool, input, cwd}`. |
| Prior churn (postmortem ledger): `kernel.ts` (18), `policy.ts` (8), `tools.ts` (4), `poll.ts` (4), `client.ts` (3); recurring `self_heal_churn` / `drain_churn` | MEDIUM | Keep the policy.ts and kernel.ts diffs minimal and pinned. Run the full `npm test` before hand-back, not only the new files. |
| Author-controlled text (issue body, comment body, logins) reaching the prompt raw | HIGH | Invariant 3. AC 5 covers both `itemPromptBlock` and `wrapPollForModel`. The ref regex refuses anything that could carry words. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-03-github-write-tools-and-poll-sources.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-03T11:44:56Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/222
- **Branch:** feature/github-write-tools-and-poll-sources
- **Files changed:** 28
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Four App-only, approval-gated GitHub write tools (outward, never-categories, listed only with github: write) and the github.issues / github.pr_comments poll sources with author text only inside wrapUntrusted. Owner extended Touches by two test files on 2026-11-03. Integrated review PASS (all 9 ACs addressed, 9 pin mutations red by hand, 4 LOW findings dismissed). CI green; full suite 3636 passed.

## Not verified
- **Real GitHub write endpoints** — fakes only, nothing may reach GitHub (subtask 1)
- **A live model calling a write tool through the SDK** — only the gate hook and the handler driven, over fakes (subtask 1)
- **Real GitHub issues and comments listings** — FakeGitHubClient or injected fetch only (subtask 2)
