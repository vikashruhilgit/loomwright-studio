// The carry check (phase 8 item 27b): at a handover, whether each earlier
// backlog item's ticket is still one its playbooks would hand over. The 23i rule
// (`./tickets-to-items.ts`) keeps an earlier line while no run has taken it;
// this module adds the question that rule never asked: is the ticket still open,
// and does the playbook's own filter still list it?
//
// Mechanism only (invariant 1): the kernel sets no filter. It re-runs the
// playbooks' own `poll` triggers of the ticket's source through the same fetch a
// due poll makes (`fetchPollItems`), so the filter is the owner's policy as
// stored. The source comes from the item's link:
//   https://github.com/<o>/<r>/issues/<n>  → every `github.issues` poll whose repos include <o>/<r> (case-insensitive)
//   https://app.clickup.com/t/<id>         → every `clickup.tasks` poll
// The relevant triggers are the polls that can fire: `triggers` rows of kind
// `poll` that are on (`enabled = 1`) and linked to a playbook whose status is
// `enabled`, the same two conditions a due poll is gated on (`../triggers/poll.ts`).
// A poll that is off, or whose playbook is a draft or disabled, hands nothing
// over, so its filter says nothing about whether a ticket is still wanted: a
// ticket only such polls list is `unverified` (the owner's ruling on 27b's review,
// 2026-11-26). Each relevant trigger is fetched at most once per call. A ticket
// counts as listed when an item's `url` equals the link, or its `ref` equals `github:<o>/<r>#<n>`
// (case-insensitive) / `clickup:<id>`.
//
// The verdict, per candidate:
//   - any listing has the ticket                                        → `keep`
//   - no link, a link of another form, no relevant trigger, a source whose
//     connection is not open (no fetch), a fetch that failed, a stored spec
//     that can't be read, or a listing that may be incomplete without a match
//                                                                       → `unverified`
//   - otherwise, GitHub: `ticket_closed` when one closed-state listing of the
//     repo (`listIssues(repo, {state: "closed"})`) holds the number, else
//     `filter_no_longer_matches` (a probe that fails, too: the ticket is proven
//     off every filter, only the label is weaker); ClickUp: `filter_no_longer_matches`.
// It fails toward keeping work: nothing it can't prove gone is dropped. A
// listing "may be incomplete" when it was cut (`found > items.length`), it
// holds `MAX_POLL_ITEMS` or more, or the source said another page follows
// (`more`, ClickUp's `has_more`): the fetch reads one page only, and the
// kernel's own tag check can leave that page with far fewer usable tasks than
// the server sent. A ClickUp answer that says nothing of `has_more` is read as
// complete (the live tool always answers it).
//
// It reads only: no write, no event. It never throws for a source (a client
// that throws is a failed fetch). Ticket data is never read as instructions:
// only refs and URLs are compared.
//
// Imports: the triggers feature's poll module, the MCP connector gate and ticket
// reader, the repo-policy client, types and this feature's files: the MCP SDK
// client may load in this graph, the Agent SDK never.
import { mcpConnectorGate } from "../integrations/mcp/connector.js";
import { createMcpTicketReader } from "../integrations/mcp/trackers.js";
import type { McpTicketReader } from "../integrations/mcp/trackers.js";
import { createRepoPolicyClient } from "../integrations/github/repo-policy.js";
import type { GitHubClient, PollSpec } from "../integrations/types.js";
import type { Store } from "../store/store.js";
import { MAX_POLL_ITEMS, fetchPollItems, githubConnectorState, parsePollSpec } from "../triggers/poll.js";
import type { Fetched } from "../triggers/poll.js";
import type { CarryCandidate, CarryVerdict } from "./tickets-to-items.js";

/** Why a handover stopped carrying an earlier item (closed here, defined once). */
export const CARRY_DROP_REASONS = Object.freeze(["ticket_closed", "filter_no_longer_matches", "run_retired"] as const);

/** One of `CARRY_DROP_REASONS`. */
export type CarryDropReason = (typeof CARRY_DROP_REASONS)[number];

/** What the check reads its sources through. Every default is built only when a fetch needs it. */
export interface CarryCheckDeps {
  /** The GitHub client. Default: `createRepoPolicyClient()`, only while the `github` connector is usable. `undefined`: none (`unverified`). */
  readonly github?: () => GitHubClient | undefined;
  /** The ticket reader a tracker poll calls its server through. Default: the kernel's real one. */
  readonly tickets?: McpTicketReader;
}

/** A GitHub issue page. */
const GITHUB_ISSUE_LINK = /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})\/issues\/([1-9][0-9]{0,9})$/;

/** A ClickUp task page by its id (the id as `CLICKUP_TASK_ID` reads it). */
const CLICKUP_TASK_LINK = /^https:\/\/app\.clickup\.com\/t\/([A-Za-z0-9_-]{1,100})$/;

/** The ticket a link names. */
type Ticket = { readonly kind: "github"; readonly repo: string; readonly number: number; readonly ref: string } | { readonly kind: "clickup"; readonly ref: string };

function ticketOf(link: string | null): Ticket | undefined {
  if (link === null) return undefined;
  const gh = GITHUB_ISSUE_LINK.exec(link);
  if (gh !== null) {
    const repo = `${gh[1] as string}/${gh[2] as string}`;
    if (repo.split("/").some((part) => part === "." || part === "..")) return undefined;
    return { kind: "github", repo, number: Number(gh[3]), ref: `github:${repo}#${gh[3] as string}`.toLowerCase() };
  }
  const cu = CLICKUP_TASK_LINK.exec(link);
  if (cu !== null) return { kind: "clickup", ref: `clickup:${cu[1] as string}` };
  return undefined;
}

/** A poll that can fire (on, of an enabled playbook): its parsed spec, or `undefined` when the stored spec can't be read. */
interface PollTrigger {
  readonly id: number;
  readonly spec: PollSpec | undefined;
}

function pollTriggers(store: Store): PollTrigger[] {
  const rows = store
    .prepare<[], { id: number; spec_json: string }>("SELECT t.id, t.spec_json FROM triggers t JOIN playbooks p ON p.slug = t.playbook WHERE t.kind = 'poll' AND t.enabled = 1 AND p.status = 'enabled' ORDER BY t.id")
    .all();
  return rows.map((r) => {
    try {
      return { id: r.id, spec: parsePollSpec(r.spec_json) };
    } catch {
      return { id: r.id, spec: undefined };
    }
  });
}

/** Whether `trigger` lists the source `ticket` comes from. */
function relevant(trigger: PollTrigger, ticket: Ticket): boolean {
  const spec = trigger.spec;
  if (spec === undefined) return false;
  if (ticket.kind === "clickup") return spec.source === "clickup.tasks";
  return spec.source === "github.issues" && spec.repos.some((repo) => repo.toLowerCase() === ticket.repo.toLowerCase());
}

/** One listing as the check reads it: the items, or a failure (a fetch that failed, or a source that could not be asked). */
type Listing = { readonly ok: true; readonly fetched: Extract<Fetched, { ok: true }> } | { readonly ok: false };

/**
 * The verdict for each candidate, keyed by its item file name. Reads only, and
 * never throws for a source: a failure is `unverified` (see the header).
 */
export async function verifyCarried(store: Store, candidates: readonly CarryCandidate[], deps: CarryCheckDeps = {}): Promise<Map<string, CarryVerdict>> {
  const verdicts = new Map<string, CarryVerdict>();
  if (candidates.length === 0) return verdicts;
  const triggers = pollTriggers(store);
  // A poll whose stored spec can't be read might list any ticket: nothing is proven gone while one exists.
  const unreadable = triggers.some((t) => t.spec === undefined);

  let tickets: McpTicketReader | undefined;
  let github: { client: GitHubClient | undefined } | undefined;
  const githubClient = (): GitHubClient | undefined => {
    if (github === undefined) {
      let client: GitHubClient | undefined;
      try {
        client = !githubConnectorState(store).usable ? undefined : deps.github !== undefined ? deps.github() : createRepoPolicyClient();
      } catch {
        client = undefined;
      }
      github = { client };
    }
    return github.client;
  };

  const listings = new Map<number, Promise<Listing>>();
  const listing = (trigger: PollTrigger & { spec: PollSpec }): Promise<Listing> => {
    let pending = listings.get(trigger.id);
    if (pending === undefined) {
      pending = fetchListing(store, trigger.spec, githubClient, () => (tickets ??= deps.tickets ?? createMcpTicketReader()));
      listings.set(trigger.id, pending);
    }
    return pending;
  };

  const probes = new Map<string, Promise<ReadonlySet<number> | undefined>>();
  const closedIn = (repo: string): Promise<ReadonlySet<number> | undefined> => {
    const key = repo.toLowerCase();
    let pending = probes.get(key);
    if (pending === undefined) {
      pending = closedNumbers(githubClient(), repo);
      probes.set(key, pending);
    }
    return pending;
  };

  for (const candidate of candidates) {
    verdicts.set(candidate.name, await verdictOf(candidate, triggers, unreadable, listing, closedIn));
  }
  return verdicts;
}

async function verdictOf(
  candidate: CarryCandidate,
  triggers: readonly PollTrigger[],
  unreadable: boolean,
  listing: (trigger: PollTrigger & { spec: PollSpec }) => Promise<Listing>,
  closedIn: (repo: string) => Promise<ReadonlySet<number> | undefined>,
): Promise<CarryVerdict> {
  const ticket = ticketOf(candidate.link);
  if (ticket === undefined) return "unverified";
  const sources = triggers.filter((t): t is PollTrigger & { spec: PollSpec } => relevant(t, ticket));
  if (sources.length === 0) return "unverified";
  let failed = false;
  let incomplete = false;
  for (const trigger of sources) {
    const read = await listing(trigger);
    if (!read.ok) {
      failed = true;
      continue;
    }
    if (read.fetched.items.some((item) => item.url === candidate.link || item.ref.toLowerCase() === ticket.ref.toLowerCase())) return "keep";
    if (read.fetched.more === true || read.fetched.found > read.fetched.items.length || read.fetched.found >= MAX_POLL_ITEMS) incomplete = true;
  }
  if (failed) return "unverified";
  if (incomplete || unreadable) return "unverified";
  if (ticket.kind === "clickup") return "filter_no_longer_matches";
  const closed = await closedIn(ticket.repo);
  return closed?.has(ticket.number) === true ? "ticket_closed" : "filter_no_longer_matches";
}

/** One poll's listing through `fetchPollItems`, gated on its source's connection first (a closed one is a failure with no fetch). Never throws. */
async function fetchListing(store: Store, spec: PollSpec, github: () => GitHubClient | undefined, tickets: () => McpTicketReader): Promise<Listing> {
  try {
    let client: GitHubClient | undefined;
    if (spec.source === "clickup.tasks" || spec.source === "jira.issues") {
      if (mcpConnectorGate(store, spec.source === "clickup.tasks" ? "clickup" : "jira").kind !== "open") return { ok: false };
    } else {
      client = github();
      if (client === undefined) return { ok: false };
    }
    const fetched = await fetchPollItems(client, spec, tickets(), store);
    return fetched.ok ? { ok: true, fetched } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** The numbers of `repo`'s closed issues, or `undefined` when they can't be read. Never throws. */
async function closedNumbers(client: GitHubClient | undefined, repo: string): Promise<ReadonlySet<number> | undefined> {
  if (client === undefined) return undefined;
  try {
    const res = await client.listIssues(repo, { state: "closed" });
    if (!res.ok || !Array.isArray(res.data)) return undefined;
    return new Set((res.data as readonly { number?: unknown }[]).map((i) => i.number).filter((n): n is number => typeof n === "number"));
  } catch {
    return undefined;
  }
}
