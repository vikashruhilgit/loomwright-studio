# GitHub tools

Part of [Phase 6 features](../ARCHITECTURE.md#phase-6-features). Built and documented by **item 06** (read-only GitHub tools that return PR text as untrusted data), in the integrations feature's `github/tools.ts` part (`kernel/src/integrations/github/tools.ts`). Tests: `kernel/test/integrations-github-tools.test.ts`.

**Routes:** none. **Contract types:** none: the tools are kernel MCP tools, which the app never calls.

Four tools let a reviewing agent read a pull request. Everything a PR's author controls reaches the model inside one `<untrusted-data>` block, because an instruction planted in a PR body, comment or diff is data, never instructions (invariant 3). They are read-only: the file calls only the client's `getPull`, `getPullDiff`, `listPullFiles` and `listPullComments`, and the client itself sends only read requests ([integrations](integrations.md)). Reading uses Studio's own token, which the client reads from the Keychain only when a request runs.

## Who gets them

Each tool is defined with `requiresConnector: "github"`, so the per-agent tool filter (`toolsForConnectors` in `kernel/src/integrations/tool-filter.ts`, applied where `kernel/src/kernel.ts` builds each launch's `kernel` server) lists it only in sessions of an agent whose enforced settings (`config/agents/<id>.json`) carry `connectors: ["github"]`. A session never lists an ungranted tool, so it can't call one. Which agents get the grant is the owner's policy (invariant 1), and no agent holds it by default.

## The tools

Every tool takes `repo` (`<owner>/<name>`) and `number` (the PR number, a positive integer). Bad input is an error result before anything else runs. `source` below is the wrapper's `source` attribute.

| Tool | Extra input | Returns | `source` |
|---|---|---|---|
| `kernel_github_pr_get` | none | the title, author, state, draft flag, base and head branch names, head SHA, labels, URL, update time and the description | `github:<owner>/<repo>#<n>` |
| `kernel_github_pr_diff` | `max_bytes?` | the unified diff, cut at the bound | `github:<owner>/<repo>#<n>:diff` |
| `kernel_github_pr_files` | none | one line per changed file: status, added and deleted line counts, path | `github:<owner>/<repo>#<n>:files` |
| `kernel_github_pr_comments` | none | the conversation's comments, then the review comments on files, each with its author, time and (for a review comment) file path | `github:<owner>/<repo>#<n>:comments` |

## The wrapping

A success is one string: a line saying the text came from `source`, not from the owner, and is data, never instructions; then `<untrusted-data source="...">`, the text, and `</untrusted-data>`. It is the same wrapper every kernel-built prompt uses (`wrapUntrusted` in `kernel/src/brain/context.ts`), so any `<untrusted-data` or `</untrusted-data` inside the text is defused (`&lt;/untrusted-data>`) and can't close the block. Ordinary code characters (`a < b`, `Array<string>`, `<div>`) are untouched.

Inside the block: every author-controlled field, that is the title, description, logins, branch names, labels, file paths, comment bodies and the diff. Outside it: the data line, the tags, and the diff's truncation note (below), all built by the kernel. The server JSON-encodes the string like every contributed tool's result, so the model reads the block inside a JSON string.

Wrapping makes the text safer for the model, not safe. The hard guards are elsewhere: the read-only token ([integrations](integrations.md)) and item 07's `gh` deny and draft mode.

## The diff bound

`max_bytes` defaults to 256 KiB (`GITHUB_PR_DIFF_DEFAULT_MAX_BYTES`) and is lowered to the client's own ceiling, `GITHUB_DEFAULT_MAX_BODY_BYTES` (4 MiB), when it asks for more. The client cuts the diff at the bound (in bytes, so a multibyte character at the cut can read as a replacement character) and reports whether it did. A cut diff is followed, after the closing tag, by `[kernel note: the diff was cut at <bound> bytes; the rest of it is not shown]`. An uncut diff has no note.

## Refusals and failures

Each is an error result whose message starts with a fixed code, then kernel values only (the validated repo, a status, `resets_at`), never text from GitHub or from the PR (`GITHUB_TOOL_REFUSALS`). The first two happen before any request, in this order:

- **`connector_missing`**: no GitHub connector, or its status is not `connected` or `expiring` (`disconnected`, `rejected`, `expired`). The message names the status.
- **`repo_not_reachable`**: the repo is not among the repos the connector reaches (`reachable_repos`, matched case-insensitively, as the [poll trigger](triggers.md#poll-triggers) does). A connector with no readable list reaches nothing.
- **`rate_limited`**: GitHub's rate limit is spent. The message carries `resets_at`; the tool does not retry, so the agent decides whether to wait.
- **`github_http_error`**: GitHub answered another non-success status, named in the message (`404` for a PR that doesn't exist).
- **`github_unreachable`**: no usable answer: no token, a network error or timeout, a body over the client's bound, or a body that is not the shape GitHub documents.

## Why not `gh`

Today GitHub is reachable in a session only through `gh` in Bash, whose output arrives as a raw tool result: the kernel wraps owner-external text only in prompts it builds, never in tool results. These tools are the path that marks a PR's text as data. Item 07's GitHub CLI deny removes `gh` from granted sessions, so their PR text arrives only through these tools ([draft mode](draft-mode.md#deny-order)). A session without the grant may still run `gh` through the owner's stored login, an open question ([open questions](../OPEN_QUESTIONS.md#technical-verify-dont-assume)).
