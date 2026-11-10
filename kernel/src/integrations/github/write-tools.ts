// The `integrations` feature's GitHub write tools (phase 8, item 05): four
// kernel tools a write-granted agent answers a pull request through, each
// `requiresConnector: "github"` and `requiresConnectorLevel: "write"` (offered
// only to a session whose agent holds `github: write`, `toolsForConnectors`):
//   - `kernel_github_pr_reply`             reply in a review comment's thread;
//   - `kernel_github_pr_comment`           a comment on a pull request's conversation;
//   - `kernel_github_issue_comment`        a comment on an issue;
//   - `kernel_github_pr_request_reviewers` ask for (or re-request) reviews.
//
// None of them sends on the first call. The session gate (`classifyToolCall`)
// answers `outward` for each by name, so a live session holds the call as an
// approval (it runs only on the owner's allow, when the agent repeats the same
// call), a draft-mode playbook records it as a draft and sends nothing, and an
// agent whose `never` list names the tool's category (`gh_pr_comment_reply`,
// `gh_pr_comment`, `gh_issue_comment`, `gh_pr_request_reviewers`) is denied
// `agent_boundary` (`kernel/src/sessions/policy.ts`). A handler that runs
// therefore runs on an allow.
//
// A body is model output: it is sent exactly as given and never interpreted.
// The result text is kernel values only (the new comment's numeric id and
// `html_url`, or the pull request's number), never text from GitHub's answer.
//
// Order inside every handler is the read tools' (`tools.ts`): the connector is
// checked (`connector_missing`), then the repo against the connector's
// reachable set (`repo_not_reachable`), then exactly one client write. Both
// refusals happen before any request, and the failure codes are the read
// tools' closed `GITHUB_TOOL_REFUSALS` (no new code). The client sends a write
// only with an App installation credential: with the owner's token (PAT) it
// sends nothing and answers `unreachable`, which is `github_unreachable` here.
//
// That credential is never the shared holder's full-permission token (D39: the
// App holds every repository permission at write). Each write builds its own
// client over a token down-scoped to the one target repo and the one permission
// its endpoint needs (`createScopedGitHubClient`, `WRITE_PERMISSIONS`), minted
// for that call and never held. A mint that fails, or answers more than a
// session token may hold (`scope_exceeded`), is no token: nothing is sent and
// the call is `github_unreachable`. The read tools and polls keep the holder.
//
// `tools.ts` composes these into `githubToolsPart` and this file reuses its
// `requireReach`, `dataOf`, `refusal` and `repoShape`, so the two import each
// other. That is safe because nothing runs at import on either side: `tools.ts`
// builds the part's tools on first read (a getter), and the factory below reads
// the other file's helpers only when it is called (`kernel/test/
// integrations-github-write-tools.test.ts` loads each file first in turn).
// Keep it so: no module-level value here that the factory needs.
//
// The `studio` CLI loads it, so it imports only types, the feature seam, the
// client and the connector's row reader: never the Agent SDK, the session
// manager or `kernel.ts` (`kernel/test/feature-seams.test.ts` pins the
// registry's module graph).
import { z } from "zod";
import { defineTool } from "../../features/contribution.js";
import type { ContributedTool, ContributedToolContext } from "../../features/contribution.js";
import type { GitHubClient } from "../types.js";
import { GITHUB_MAX_COMMENT_CHARS, GITHUB_MAX_REVIEWERS, NAME_SEGMENT } from "./client.js";
import type { InstallationTokenScope } from "./client.js";
import { createScopedGitHubClient } from "./connector.js";
import { dataOf, repoShape, requireReach } from "./tools.js";
import type { GitHubToolsDeps } from "./tools.js";

/**
 * The one permission each write's endpoint needs, all within
 * `SESSION_TOKEN_PERMISSIONS`. A pull request's conversation comment goes
 * through the issues endpoint, which GitHub accepts with Pull requests write.
 */
export const WRITE_PERMISSIONS = Object.freeze({
  kernel_github_pr_reply: Object.freeze({ pull_requests: "write" }),
  kernel_github_pr_comment: Object.freeze({ pull_requests: "write" }),
  kernel_github_issue_comment: Object.freeze({ issues: "write" }),
  kernel_github_pr_request_reviewers: Object.freeze({ pull_requests: "write" }),
} as const satisfies Record<string, Readonly<Record<string, string>>>);

export interface GitHubWriteToolsDeps extends GitHubToolsDeps {
  /** The client one write goes through, over a token down-scoped to `scope`. Default: `createScopedGitHubClient(scope)`. A given `client` wins over it. */
  readonly scopedClient?: (scope: InstallationTokenScope) => GitHubClient;
}

/** The four write tools over `deps` (`maxDiffBytes` is a read tool's and is ignored). Nothing is read or requested until a handler runs. */
export function createGitHubWriteTools(deps: GitHubWriteToolsDeps = {}): readonly ContributedTool[] {
  /** The checks every handler starts with (connector, then reach), then a client over a token for `repo` and `tool`'s permission only. */
  const open = (ctx: ContributedToolContext, repo: string, tool: keyof typeof WRITE_PERMISSIONS): GitHubClient => {
    requireReach(ctx.store, repo);
    if (deps.client !== undefined) return deps.client();
    // `repoShape` has passed, so `repo` is `<owner>/<name>`; the mint takes the name alone.
    const scope: InstallationTokenScope = { repositories: [repo.slice(repo.indexOf("/") + 1)], permissions: WRITE_PERMISSIONS[tool] };
    return (deps.scopedClient ?? createScopedGitHubClient)(scope);
  };

  const body = z
    .string()
    .min(1)
    .max(GITHUB_MAX_COMMENT_CHARS)
    .describe(`The comment text, 1 to ${GITHUB_MAX_COMMENT_CHARS} characters; it is posted exactly as given.`);
  const pr = z.number().int().positive().describe("The pull request number.");

  const prReply = defineTool({
    name: "kernel_github_pr_reply",
    job: "triage_pr_comments",
    description:
      "Reply in one review comment's thread on a pull request on GitHub. The kernel holds the call for the owner's approval (or saves it as a draft in a draft playbook) and posts nothing until the owner allows it; if it is approved, run exactly the same call again, once.",
    shape: { repo: repoShape, pr, comment_id: z.number().int().positive().describe("The id of the review comment to reply to."), body },
    requiresConnector: "github",
    requiresConnectorLevel: "write",
    async handler(args, ctx) {
      const made = dataOf(await open(ctx, args.repo, "kernel_github_pr_reply").replyToReviewComment(args.repo, args.pr, args.comment_id, args.body));
      return `posted reply ${made.id} in the thread of review comment ${args.comment_id} on ${args.repo}#${args.pr}: ${made.url}`;
    },
  });

  const prComment = defineTool({
    name: "kernel_github_pr_comment",
    job: "triage_pr_comments",
    description:
      "Comment on a pull request's conversation on GitHub. The kernel holds the call for the owner's approval (or saves it as a draft in a draft playbook) and posts nothing until the owner allows it; if it is approved, run exactly the same call again, once.",
    shape: { repo: repoShape, pr, body },
    requiresConnector: "github",
    requiresConnectorLevel: "write",
    async handler(args, ctx) {
      const made = dataOf(await open(ctx, args.repo, "kernel_github_pr_comment").createPullComment(args.repo, args.pr, args.body));
      return `posted comment ${made.id} on ${args.repo}#${args.pr}: ${made.url}`;
    },
  });

  const issueComment = defineTool({
    name: "kernel_github_issue_comment",
    job: "comment_on_issues",
    description:
      "Comment on an issue on GitHub. The kernel holds the call for the owner's approval (or saves it as a draft in a draft playbook) and posts nothing until the owner allows it; if it is approved, run exactly the same call again, once.",
    shape: { repo: repoShape, issue: z.number().int().positive().describe("The issue number."), body },
    requiresConnector: "github",
    requiresConnectorLevel: "write",
    async handler(args, ctx) {
      const made = dataOf(await open(ctx, args.repo, "kernel_github_issue_comment").createIssueComment(args.repo, args.issue, args.body));
      return `posted comment ${made.id} on ${args.repo}#${args.issue}: ${made.url}`;
    },
  });

  const requestReviewers = defineTool({
    name: "kernel_github_pr_request_reviewers",
    job: "triage_pr_comments",
    description:
      "Ask for, or re-request, reviews on a pull request on GitHub from the named users. The kernel holds the call for the owner's approval (or saves it as a draft in a draft playbook) and requests nothing until the owner allows it; if it is approved, run exactly the same call again, once.",
    shape: {
      repo: repoShape,
      pr,
      reviewers: z
        .array(z.string().regex(NAME_SEGMENT))
        .min(1)
        .max(GITHUB_MAX_REVIEWERS)
        .describe(`The GitHub logins to request a review from, 1 to ${GITHUB_MAX_REVIEWERS}.`),
    },
    requiresConnector: "github",
    requiresConnectorLevel: "write",
    async handler(args, ctx) {
      const made = dataOf(await open(ctx, args.repo, "kernel_github_pr_request_reviewers").requestReviewers(args.repo, args.pr, args.reviewers));
      return `requested ${args.reviewers.length} reviewer${args.reviewers.length === 1 ? "" : "s"} on ${args.repo}#${made.pull}`;
    },
  });

  return Object.freeze([prReply, prComment, issueComment, requestReviewers]);
}
