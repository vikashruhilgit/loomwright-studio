# GitHub tools

Part of [Phase 6 features](../ARCHITECTURE.md#phase-6-features). Built and documented by **item 06** (read-only GitHub tools that return PR text as untrusted data), in the integrations feature's `github/tools.ts` part (`kernel/src/integrations/github/tools.ts`). Tests: `kernel/test/integrations-github-tools.test.ts`. Phase 8 item 05 adds four approval-gated [write tools](#the-write-tools) in `github/write-tools.ts`, tested in `kernel/test/integrations-github-write-tools.test.ts`.

**Routes:** none. **Contract types:** none: the tools are kernel MCP tools, which the app never calls.

Four read tools let a reviewing agent read a pull request. Everything a PR's author controls reaches the model inside one `<untrusted-data>` block, because an instruction planted in a PR body, comment or diff is data, never instructions (invariant 3). They are read-only: `tools.ts` calls only the client's `getPull`, `getPullDiff`, `listPullFiles` and `listPullComments`, which send GETs. Reading uses Studio's own token, which the client reads from the Keychain only when a request runs. The [write tools](#the-write-tools) are separate, in `write-tools.ts`.

## Who gets them

Each read tool is defined with `requiresConnector: "github"`, so the per-agent tool filter (`toolsForConnectors` in `kernel/src/integrations/tool-filter.ts`, applied where `kernel/src/kernel.ts` builds each launch's `kernel` server) lists it only in sessions of an agent whose enforced settings (`config/agents/<id>.json`) carry `connectors: ["github"]` (or the write form, `{"github": "write"}`). A session never lists an ungranted tool, so it can't call one. Which agents get the grant is the owner's policy (invariant 1), and no agent holds it by default. The four [write tools](#the-write-tools) also need the write level.

## The tools

Every tool takes `repo` (`<owner>/<name>`) and `number` (the PR number, a positive integer). Bad input is an error result before anything else runs. `source` below is the wrapper's `source` attribute.

| Tool | Extra input | Returns | `source` |
|---|---|---|---|
| `kernel_github_pr_get` | none | the title, author, state, draft flag, base and head branch names, head SHA, labels, URL, update time and the description | `github:<owner>/<repo>#<n>` |
| `kernel_github_pr_diff` | `max_bytes?` | the unified diff, cut at the bound | `github:<owner>/<repo>#<n>:diff` |
| `kernel_github_pr_files` | none | one line per changed file: status, added and deleted line counts, path | `github:<owner>/<repo>#<n>:files` |
| `kernel_github_pr_comments` | none | the conversation's comments, then the review comments on files, each with its author, time and (for a review comment) file path | `github:<owner>/<repo>#<n>:comments` |

## The write tools

Four more tools write to GitHub (`createGitHubWriteTools` in `kernel/src/integrations/github/write-tools.ts`, composed into the same part after the four read tools, so a merged list reads the four read tools and then these):

| Tool | Input | Sends | What it posts |
|---|---|---|---|
| `kernel_github_pr_reply` | `repo`, `pr`, `comment_id`, `body` | `POST /repos/{o}/{r}/pulls/{pr}/comments/{comment_id}/replies` | a reply in a review comment's thread |
| `kernel_github_pr_comment` | `repo`, `pr`, `body` | `POST /repos/{o}/{r}/issues/{pr}/comments` | a comment on the pull request's conversation (GitHub treats a pull request as an issue here) |
| `kernel_github_issue_comment` | `repo`, `issue`, `body` | `POST /repos/{o}/{r}/issues/{issue}/comments` | a comment on an issue |
| `kernel_github_pr_request_reviewers` | `repo`, `pr`, `reviewers` (1 to 100 logins) | `POST /repos/{o}/{r}/pulls/{pr}/requested_reviewers` | a review request, or a re-request |

`body` is a string of 1 to 65,536 characters; a reviewer login uses GitHub's name characters (`A-Z a-z 0-9 _ . -`, 1 to 100 of them). A body is model output: it is sent exactly as given and never interpreted, and a result never repeats it. A result is kernel values only: the new comment's numeric id and `html_url`, or the pull request's number with how many reviewers were asked.

**Who gets them.** Each tool is `requiresConnector: "github"` and `requiresConnectorLevel: "write"`: `toolsForConnectors(tools, connectors, githubWrite)` lists it only when the agent holds the GitHub grant **and** `githubWrite` is true, which `kernel.ts` reads from the agent's enforced settings with the same reader as the session manager (`connectors: {"github": "write"}`; no agent, or a throw, is false). The level is the agent's grant, not the playbook's mode: a draft playbook's write-granted agent lists the tools, and its calls become drafts. An agent with the plain `github` grant lists the four read tools and none of these.

**How a call is decided.** None of them sends on the first call. The session gate reads each by name as an outward call ([approvals](approvals.md), step 8): in a live session it is held as an approval whose action is the tool name and whose payload names the repo, the number and the body or reviewers; when the owner allows it once and the agent repeats the call, the repeat consumes the grant and the handler makes the one request. In a draft playbook the call is recorded as a draft and denied `draft_mode`, and an agent whose `never` list names the tool's category is denied `agent_boundary` with no approval written:

| Tool | `never` category |
|---|---|
| `kernel_github_pr_reply` | `gh_pr_comment_reply` |
| `kernel_github_pr_comment` | `gh_pr_comment` |
| `kernel_github_issue_comment` | `gh_issue_comment` |
| `kernel_github_pr_request_reviewers` | `gh_pr_request_reviewers` |

**The credential.** A write is sent only with a GitHub App installation credential. The owner's token (PAT) stays read-only (the connector refuses a write-scoped token, `token_write_scoped`), so a write made with it sends nothing and answers `github_unreachable`. The App credential a write uses is never the shared holder's full-permission installation token (the App holds every repository permission at write, D39), which the read tools and polls keep using: each write mints its own token, down-scoped to the one target repository (`repositories: [<name>]`) and the one permission its endpoint needs (`pull_requests: write` for a reply, a pull request comment and a reviewer request; `issues: write` for an issue comment), within the session token's ceiling (`SESSION_TOKEN_PERMISSIONS`). The token is used for that one call and never held or cached (`createScopedGitHubClient` in `kernel/src/integrations/github/connector.ts`, `WRITE_PERMISSIONS` in `write-tools.ts`). A mint that fails, or that reports more than the ceiling (`scope_exceeded`), is no token: nothing is sent and the call answers `github_unreachable`. The client allows exactly these three POST shapes beside the App's mint and manifest conversion (`GITHUB_ALLOWED_NON_GET` in `kernel/src/integrations/github/client.ts`, pinned in `kernel/test/integrations-github-client.test.ts`), never a PUT, PATCH or DELETE, and a write follows the read path's rule of one renewal and one retry on a 401.

**Refusals and failures** are the read tools' fixed codes, in the same order: `connector_missing`, then `repo_not_reachable`, both before any request, then `rate_limited`, `github_http_error` or `github_unreachable` from the one write. A bad input (an empty or over-long body, a number of 0, a reviewer list outside 1 to 100, a login with a space or a slash) is an error result before the handler runs.

## The wrapping

A success is one string: a line saying the text came from `source`, not from the owner, and is data, never instructions; then `<untrusted-data source="...">`, the text, and `</untrusted-data>`. It is the same wrapper every kernel-built prompt uses (`wrapUntrusted` in `kernel/src/brain/context.ts`), so any `<untrusted-data` or `</untrusted-data` inside the text is defused (`&lt;/untrusted-data>`) and can't close the block. Ordinary code characters (`a < b`, `Array<string>`, `<div>`) are untouched.

Inside the block: every author-controlled field, that is the title, description, logins, branch names, labels, file paths, comment bodies and the diff. Outside it: the data line, the tags, and the diff's truncation note (below), all built by the kernel. The server JSON-encodes the string like every contributed tool's result, so the model reads the block inside a JSON string.

Wrapping makes the text safer for the model, not safe. The hard guards are elsewhere: the read-only token ([integrations](integrations.md)), the approval gate for the write tools, and item 07's `gh` deny and draft mode.

## The diff bound

`max_bytes` defaults to 256 KiB (`GITHUB_PR_DIFF_DEFAULT_MAX_BYTES`) and is lowered to the client's own ceiling, `GITHUB_DEFAULT_MAX_BODY_BYTES` (4 MiB), when it asks for more. The client cuts the diff at the bound (in bytes, so a multibyte character at the cut can read as a replacement character) and reports whether it did. A cut diff is followed, after the closing tag, by `[kernel note: the diff was cut at <bound> bytes; the rest of it is not shown]`. An uncut diff has no note.

## Refusals and failures

Each is an error result whose message starts with a fixed code, then kernel values only (the validated repo, a status, `resets_at`), never text from GitHub or from the PR (`GITHUB_TOOL_REFUSALS`). The first two happen before any request, in this order:

- **`connector_missing`**: no GitHub connector, or its status is not `connected`, `expiring` or `needs_permissions` (`disconnected`, `rejected`, `expired`). The message names the status.
- **`repo_not_reachable`**: the repo is not among the repos the connector reaches (`reachable_repos`, matched case-insensitively, as the [poll trigger](triggers.md#poll-triggers) does). A connector with no readable list reaches nothing.
- **`rate_limited`**: GitHub's rate limit is spent. The message carries `resets_at`; the tool does not retry, so the agent decides whether to wait.
- **`github_http_error`**: GitHub answered another non-success status, named in the message (`404` for a PR that doesn't exist).
- **`github_unreachable`**: no usable answer: no token, a network error or timeout, a body over the client's bound, or a body that is not the shape GitHub documents.

## Why not `gh`

Today GitHub is reachable in a session only through `gh` in Bash, whose output arrives as a raw tool result: the kernel wraps owner-external text only in prompts it builds, never in tool results. These tools are the path that marks a PR's text as data. Item 07's GitHub CLI deny removes `gh` from granted sessions, so their PR text arrives only through these tools ([draft mode](draft-mode.md#deny-order)). A session without the grant may still run `gh` through the owner's stored login, an open question ([open questions](../OPEN_QUESTIONS.md#technical-verify-dont-assume)).
