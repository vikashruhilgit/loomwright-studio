// The `jira.issues` poll source (phase 8 item 07): the Jira half of the ticket
// sources. A poll names its Atlassian `site` in its filters (the owner's choice,
// per poll; the connection row does not record it) and the kernel sends it as
// Atlassian's `cloudId`, so a poll is one tool call. `../poll.ts` calls
// `checkJiraFilters` when it parses a spec and `fetchJiraIssues` when one fires,
// and applies `MAX_POLL_ITEMS` to what it returns.
//
// Mechanism only (invariant 1): there is no default filter, interval or dedupe
// key. The kernel builds the JQL from the closed filter set only, never from
// text the owner types as a query: each value is double-quoted with `\` and `"`
// escaped (the JQL-injection rule), conditions are joined with `AND`, and the
// query ends `ORDER BY updated ASC`. With no optional filter it is that
// ordering alone, which is valid JQL scoped by the site.
//
// An item is `{ref: jira:<site>/<KEY>, revision: <updated>, title: <summary>,
// url: https://<site>/browse/<KEY>, updated_at: <updated>, text: <description>,
// status: <status name>}`. The key matches `JIRA_KEY` (it is printed raw in a
// prompt frame, so a key that could carry words is dropped). The site is the
// poll's own, and the url is built by the kernel from the site and key. A
// description that is not a string (Atlassian's ADF object) becomes its JSON
// text; the prompt clips it. `title`, `text` and `status` are the server's text:
// untrusted data, wrapped wherever they reach a model. An issue with no usable
// key or updated time is dropped.
//
// Failures are `client_error` with the tracker scope `jira:<site>` as `repo` and
// a fixed code as `message` (`tracker-shared.ts`): `connector_missing |
// connector_expired | tool_unavailable | keychain_failed | mcp_unauthorized |
// mcp_timeout | mcp_unreachable | mcp_protocol | mcp_tool_error`.
//
// Imports: type-only from `../../integrations/*`, `./github-pulls.js` and the
// store, `MCP_TRACKERS` (data) from `../../integrations/mcp/trackers.js`, and
// `TriggerError` and the shared helpers; never the Agent SDK.
import { MCP_TRACKERS } from "../../integrations/mcp/trackers.js";
import type { McpTicketReader } from "../../integrations/mcp/trackers.js";
import type { JiraPollSpec, SourceItem } from "../../integrations/types.js";
import type { Store } from "../../store/store.js";
import { TriggerError } from "../fire-shared.js";
import type { SourceFetch } from "./github-pulls.js";
import { listFilter, objectOf, orderItems, readTickets, statusOf, textFilter, textOf, updatedOf } from "./tracker-shared.js";

/** An Atlassian cloud site: `<name>.atlassian.net`, lower-case. */
export const JIRA_SITE = /^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/;

/** A Jira issue key: `<PROJECT>-<number>`, the project key upper-case letters, digits and underscores starting with a letter. */
export const JIRA_KEY = /^[A-Z][A-Z0-9_]{0,99}-[1-9][0-9]{0,9}$/;

/** The issue fields the search asks for: the ones an item shows. */
const FIELDS = ["summary", "description", "status", "updated"] as const;

/**
 * `filters` (already known to hold only Jira's keys) as a `JiraPollSpec`'s
 * filters, or `invalid_spec`: a required `site` matching `JIRA_SITE`; optional
 * `project`, `status`, `assignee` (strings of 1-200 characters) and `labels` (a
 * non-empty array of such strings).
 */
export function checkJiraFilters(filters: Record<string, unknown>): JiraPollSpec["filters"] {
  const site = filters["site"];
  if (typeof site !== "string" || !JIRA_SITE.test(site)) {
    throw new TriggerError("invalid_spec", "a jira.issues poll's filters.site must be an Atlassian site like acme.atlassian.net (lower-case letters, digits and hyphens)");
  }
  const project = textFilter(filters, "project");
  const status = textFilter(filters, "status");
  const assignee = textFilter(filters, "assignee");
  const labels = listFilter(filters, "labels");
  return {
    site,
    ...(project === undefined ? {} : { project }),
    ...(status === undefined ? {} : { status }),
    ...(labels === undefined ? {} : { labels }),
    ...(assignee === undefined ? {} : { assignee }),
  };
}

/** `value` as a JQL string literal: double-quoted, `\` and `"` escaped, a line break or other control character written as an escape. */
function quoted(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `"${escaped}"`;
}

/** The JQL of a poll's filters: `project`, `status`, one `labels` condition per label, `assignee`, joined with `AND`, then `ORDER BY updated ASC`. `site` is not a condition. */
export function jiraJql(filters: JiraPollSpec["filters"]): string {
  const conditions: string[] = [];
  if (filters.project !== undefined) conditions.push(`project = ${quoted(filters.project)}`);
  if (filters.status !== undefined) conditions.push(`status = ${quoted(filters.status)}`);
  for (const label of filters.labels ?? []) conditions.push(`labels = ${quoted(label)}`);
  if (filters.assignee !== undefined) conditions.push(`assignee = ${quoted(filters.assignee)}`);
  return conditions.length === 0 ? "ORDER BY updated ASC" : `${conditions.join(" AND ")} ORDER BY updated ASC`;
}

/** The item of a listed issue, or `undefined` when it has no usable key or updated time. */
function itemOf(site: string, entry: unknown): SourceItem | undefined {
  const issue = objectOf(entry);
  if (issue === undefined) return undefined;
  const key = issue["key"];
  if (typeof key !== "string" || !JIRA_KEY.test(key)) return undefined;
  const fields = objectOf(issue["fields"]);
  if (fields === undefined) return undefined;
  const updated = updatedOf(fields["updated"]);
  if (updated === undefined) return undefined;
  const status = statusOf(fields["status"]);
  return {
    ref: `jira:${site}/${key}`,
    revision: updated,
    title: textOf(fields["summary"]),
    url: `https://${site}/browse/${key}`,
    updated_at: updated,
    text: textOf(fields["description"]),
    ...(status === undefined ? {} : { status }),
  };
}

/**
 * The `jira.issues` fetch: one `searchJiraIssuesUsingJql` call through
 * `tickets` with `cloudId: <site>`, the kernel-built JQL and at most `limit`
 * results. Items are ordered by updated time, then ref, a key listed twice kept
 * once, uncapped here (`../poll.ts` caps them). A failure stops the fetch.
 */
export async function fetchJiraIssues(tickets: McpTicketReader, store: Store, spec: JiraPollSpec, limit: number): Promise<SourceFetch> {
  const site = spec.filters.site;
  const read = await readTickets(
    tickets,
    store,
    "jira",
    MCP_TRACKERS.jira.tool,
    { cloudId: site, jql: jiraJql(spec.filters), fields: [...FIELDS], maxResults: limit },
    "issues",
    `jira:${site}`,
  );
  if (!read.ok) return read;
  const items: SourceItem[] = [];
  for (const entry of read.entries) {
    const item = itemOf(site, entry);
    if (item !== undefined) items.push(item);
  }
  return { ok: true, items: orderItems(items) };
}
