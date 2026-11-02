// The `github.pulls` poll source (phase 8 item 01 moved it here from
// `../poll.ts`, with no change in behaviour): list each repo's open pull
// requests through the GitHub client, in spec order, one after the other.
// `../poll.ts` dispatches to this module by `spec.source` and applies the
// kernel's `MAX_POLL_ITEMS` bound to what it returns.
//
// Imports: type-only from `../../integrations/types.js` and the loop helpers,
// so the `studio` CLI's module graph is unchanged.
import type { GitHubClient, GitHubPullSummary, PollSpec, SourceItem } from "../../integrations/types.js";
import { clip, errorMessage } from "../../loop/internal.js";

/** What a source's fetch came to before the cap: every item found, or the first repo's failure. */
export type SourceFetch =
  | { readonly ok: true; readonly items: readonly SourceItem[] }
  | { readonly ok: false; readonly error: "rate_limited"; readonly repo: string; readonly resets_at: string }
  | { readonly ok: false; readonly error: "http_error" | "unreachable" | "client_error"; readonly repo: string; readonly status?: number; readonly message?: string };

/** Whether pull `p` passes `filters` in the kernel (the client's filtering is not the only one). The listing is open pulls only. */
function matches(p: GitHubPullSummary, filters: PollSpec["filters"]): boolean {
  if (filters.state !== undefined && filters.state !== "open") return false;
  if (filters.draft !== undefined && p.draft !== filters.draft) return false;
  if (filters.author !== undefined && p.author !== filters.author) return false;
  return true;
}

/** A listed pull the kernel can name: a positive whole number and a head SHA. Anything else from the source is dropped. */
function isNameable(p: unknown): p is GitHubPullSummary {
  const q = p as Partial<GitHubPullSummary> | null;
  return typeof q === "object" && q !== null && Number.isSafeInteger(q.number) && (q.number as number) > 0 && typeof q.head_sha === "string" && q.head_sha !== "";
}

function itemOf(repo: string, p: GitHubPullSummary): SourceItem {
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  return { ref: `github:${repo}#${p.number}`, revision: p.head_sha, title: text(p.title), url: text(p.url), updated_at: text(p.updated_at) };
}

/**
 * The `github.pulls` fetch: each repo once, in spec order, one after the
 * other. The first failure stops it (nothing is queued for the instant); a
 * client that throws, or answers data that is not a list, is a `client_error`.
 * Items are repos in spec order, pulls by ascending number, uncapped.
 */
export async function fetchGithubPulls(github: GitHubClient, spec: PollSpec): Promise<SourceFetch> {
  const items: SourceItem[] = [];
  for (const repo of spec.repos) {
    let res: Awaited<ReturnType<GitHubClient["listOpenPulls"]>>;
    try {
      res = await github.listOpenPulls(repo, spec.filters);
    } catch (err) {
      return { ok: false, error: "client_error", repo, message: clip(errorMessage(err), 500) };
    }
    if (!res.ok) {
      if (res.error === "rate_limited") return { ok: false, error: "rate_limited", repo, resets_at: res.resets_at };
      return res.error === "http_error" ? { ok: false, error: "http_error", repo, status: res.status } : { ok: false, error: "unreachable", repo };
    }
    if (!Array.isArray(res.data)) return { ok: false, error: "client_error", repo, message: "the listing is not a list" };
    const seen = new Set<number>();
    const pulls = (res.data as readonly unknown[]).filter(isNameable).filter((p) => matches(p, spec.filters));
    for (const p of [...pulls].sort((a, b) => a.number - b.number)) {
      if (seen.has(p.number)) continue;
      seen.add(p.number);
      items.push(itemOf(repo, p));
    }
  }
  return { ok: true, items };
}
