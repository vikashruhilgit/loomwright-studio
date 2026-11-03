// The `github.pr_comments` poll source (phase 8 item 05): for each repo, every
// conversation comment, review comment and review on its open pull requests,
// through the GitHub client, in spec order, one after the other. `../poll.ts`
// dispatches here by `spec.source` and applies the kernel's `MAX_POLL_ITEMS`
// bound to what it returns.
//
// Mechanism only (invariant 1): there is no default filter, interval or dedupe
// key, and the source takes no filter at all. The kernel does not skip a comment
// by its author (the owner's own, or the bot's) or by its age: what counts as
// "already done" is the playbook's dedupe key. The failure mapping is
// `github.pulls`' (`SourceFetch`, imported).
//
// An item is `{ref: github:<owner>/<repo>#<pr>:<kind>:<comment id>, revision:
// <updated_at>, title, url, updated_at, text: <body>, author, kind, pr}`. The
// three kinds (`issue_comment`, `review_comment`, `review`) are three GitHub id
// spaces, so the ref names the kind and two comments never share a ref. The
// revision is the comment's `updated_at` (a review's `submitted_at`, which the
// client already put in `updated_at`), so an edited comment is a new revision of
// the same item. `text` and `author` are author-controlled: untrusted data,
// wrapped wherever they reach a model. `title` is the kernel's own label for the
// kind and the pull request, never a comment's text.
//
// Imports: type-only from `../../integrations/types.js`, `./github-pulls.js` and
// the loop helpers, so the `studio` CLI's module graph is unchanged.
import type { GitHubClient, GitHubPrComment, PollSpec, SourceItem } from "../../integrations/types.js";
import { clip, errorMessage } from "../../loop/internal.js";
import type { SourceFetch } from "./github-pulls.js";

/** The comment kinds, in the order a pull request's items are listed. */
const KIND_ORDER: readonly GitHubPrComment["kind"][] = ["issue_comment", "review_comment", "review"];

/** A listed comment the kernel can name: a known kind, positive whole numbers for its id and pull request, and a revision (`updated_at`). Anything else from the source is dropped. */
function isNameable(c: unknown): c is GitHubPrComment {
  const q = c as Partial<GitHubPrComment> | null;
  return (
    typeof q === "object" &&
    q !== null &&
    (KIND_ORDER as readonly unknown[]).includes(q.kind) &&
    Number.isSafeInteger(q.id) &&
    (q.id as number) > 0 &&
    Number.isSafeInteger(q.pr) &&
    (q.pr as number) > 0 &&
    typeof q.updated_at === "string" &&
    q.updated_at !== ""
  );
}

function itemOf(repo: string, c: GitHubPrComment): SourceItem {
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    ref: `github:${repo}#${c.pr}:${c.kind}:${c.id}`,
    revision: c.updated_at,
    title: `${c.kind} on ${repo}#${c.pr}`,
    url: text(c.url),
    updated_at: c.updated_at,
    text: text(c.body),
    author: text(c.author),
    kind: c.kind,
    pr: c.pr,
  };
}

/**
 * The `github.pr_comments` fetch: each repo once, in spec order, one after the
 * other. The first failure stops it (nothing is queued for the instant); a
 * client that throws, or answers data that is not a list, is a `client_error`.
 * Items are repos in spec order, then pull requests by ascending number, then
 * kind (conversation comments, review comments, reviews), then comment id
 * ascending, uncapped. A comment listed twice is one item.
 */
export async function fetchGithubPrComments(github: GitHubClient, spec: PollSpec): Promise<SourceFetch> {
  const items: SourceItem[] = [];
  for (const repo of spec.repos) {
    let res: Awaited<ReturnType<GitHubClient["listOpenPullComments"]>>;
    try {
      res = await github.listOpenPullComments(repo);
    } catch (err) {
      return { ok: false, error: "client_error", repo, message: clip(errorMessage(err), 500) };
    }
    if (!res.ok) {
      if (res.error === "rate_limited") return { ok: false, error: "rate_limited", repo, resets_at: res.resets_at };
      return res.error === "http_error" ? { ok: false, error: "http_error", repo, status: res.status } : { ok: false, error: "unreachable", repo };
    }
    if (!Array.isArray(res.data)) return { ok: false, error: "client_error", repo, message: "the listing is not a list" };
    const seen = new Set<string>();
    const comments = (res.data as readonly unknown[]).filter(isNameable);
    const ordered = [...comments].sort((a, b) => a.pr - b.pr || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id - b.id);
    for (const c of ordered) {
      const key = `${c.pr}:${c.kind}:${c.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(itemOf(repo, c));
    }
  }
  return { ok: true, items };
}
