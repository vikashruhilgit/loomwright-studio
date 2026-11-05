// The `github.issues` poll source (phase 8 item 05): list each repo's issues
// through the GitHub client, in spec order, one after the other. A pull
// request is never an item: GitHub's issues listing includes them, and the
// client drops them before they reach this module. `../poll.ts` dispatches
// here by `spec.source` and applies the kernel's `MAX_POLL_ITEMS` bound to what
// it returns.
//
// Mechanism only (invariant 1): there is no default filter, interval or dedupe
// key. The spec's `state`, `labels` and `assignee` go to GitHub as given (the
// client sends them), and the owner's dedupe key decides what counts as "already
// done". The failure mapping is `github.pulls`' (`SourceFetch`, imported).
//
// An item is `{ref: github:<owner>/<repo>#<number>, revision: <updated_at>,
// title, url, updated_at, text: <body>, author}`. `title`, `text` and `author`
// are author-controlled: untrusted data, wrapped wherever they reach a model.
//
// Imports: type-only from `../../integrations/types.js`, `./github-pulls.js` and
// the loop helpers, so the `studio` CLI's module graph is unchanged.
import type { GitHubClient, GitHubIssueFilters, GitHubIssueSummary, GithubPollSpec, SourceItem } from "../../integrations/types.js";
import { clip, errorMessage } from "../../loop/internal.js";
import type { SourceFetch } from "./github-pulls.js";

/** A listed issue the kernel can name: a positive whole number and a revision (`updated_at`). Anything else from the source is dropped. */
function isNameable(i: unknown): i is GitHubIssueSummary {
  const q = i as Partial<GitHubIssueSummary> | null;
  return typeof q === "object" && q !== null && Number.isSafeInteger(q.number) && (q.number as number) > 0 && typeof q.updated_at === "string" && q.updated_at !== "";
}

function itemOf(repo: string, i: GitHubIssueSummary): SourceItem {
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  return { ref: `github:${repo}#${i.number}`, revision: i.updated_at, title: text(i.title), url: text(i.url), updated_at: i.updated_at, text: text(i.body), author: text(i.author) };
}

/** The slice of the spec's filters an issue listing takes (`state`, `labels`, `assignee`), each only when the spec names it. */
function filtersOf(spec: GithubPollSpec): GitHubIssueFilters {
  const { state, labels, assignee } = spec.filters;
  return { ...(state === undefined ? {} : { state }), ...(labels === undefined ? {} : { labels }), ...(assignee === undefined ? {} : { assignee }) };
}

/**
 * The `github.issues` fetch: each repo once, in spec order, one after the
 * other. The first failure stops it (nothing is queued for the instant); a
 * client that throws, or answers data that is not a list, is a `client_error`.
 * Items are repos in spec order, issues by ascending number, uncapped.
 */
export async function fetchGithubIssues(github: GitHubClient, spec: GithubPollSpec): Promise<SourceFetch> {
  const items: SourceItem[] = [];
  for (const repo of spec.repos) {
    let res: Awaited<ReturnType<GitHubClient["listIssues"]>>;
    try {
      res = await github.listIssues(repo, filtersOf(spec));
    } catch (err) {
      return { ok: false, error: "client_error", repo, message: clip(errorMessage(err), 500) };
    }
    if (!res.ok) {
      if (res.error === "rate_limited") return { ok: false, error: "rate_limited", repo, resets_at: res.resets_at };
      return res.error === "http_error" ? { ok: false, error: "http_error", repo, status: res.status } : { ok: false, error: "unreachable", repo };
    }
    if (!Array.isArray(res.data)) return { ok: false, error: "client_error", repo, message: "the listing is not a list" };
    const seen = new Set<number>();
    const issues = (res.data as readonly unknown[]).filter(isNameable);
    for (const i of [...issues].sort((a, b) => a.number - b.number)) {
      if (seen.has(i.number)) continue;
      seen.add(i.number);
      items.push(itemOf(repo, i));
    }
  }
  return { ok: true, items };
}
