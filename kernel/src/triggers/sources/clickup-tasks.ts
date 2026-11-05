// The `clickup.tasks` poll source (phase 8 item 07): the ClickUp half of the
// ticket sources. A poll is scoped by exactly one of its `list` or `space`
// filters (so it names no workspace), and may add `status`, `assignee` and
// `tags`. `../poll.ts` calls `checkClickupFilters` when it parses a spec and
// `fetchClickupTasks` when one fires, and applies `MAX_POLL_ITEMS` to what it
// returns.
//
// Mechanism only (invariant 1): there is no default filter, interval or dedupe
// key. The filters go to the server as the tool takes them (`list_ids` or
// `space_ids`, and `statuses`, `assignees`, `tags` as arrays), and the kernel
// applies the tag filter again on the parsed tasks, whatever the server
// answered (as `github.pulls` re-applies its filters): a task must carry every
// tag the spec names, compared case-insensitively (ClickUp keeps tag names
// lower-case).
//
// ClickUp's real tool name and response shape are NEEDS VERIFICATION
// (`docs/architecture/mcp-connectors.md`): the tool name is data in
// `MCP_TRACKERS`, checked against the connection's own tool list before any
// call, and the parse is loose (a task is `{id, name, description, status, tags,
// url, date_updated}`; an entry that is off-shape is dropped).
//
// An item is `{ref: clickup:<task id>, revision: <updated>, title: <name>, url:
// <the task's own url>, updated_at: <updated>, text: <description>, status:
// <status name>}`. The id matches `CLICKUP_TASK_ID` (the ref is printed raw in a
// prompt frame, so an id that could carry words is dropped). `title`, `text` and
// `status` are the server's text: untrusted data, wrapped wherever they reach a
// model. A task with no usable id or updated time is dropped.
//
// Failures are `client_error` with the tracker scope (`clickup:list/<id>` or
// `clickup:space/<id>`) as `repo` and a fixed code as `message`
// (`tracker-shared.ts`).
//
// Imports: as `jira-issues.ts`.
import { MCP_TRACKERS } from "../../integrations/mcp/trackers.js";
import type { McpTicketReader } from "../../integrations/mcp/trackers.js";
import type { ClickupPollSpec, SourceItem } from "../../integrations/types.js";
import type { Store } from "../../store/store.js";
import { TriggerError } from "../fire-shared.js";
import type { SourceFetch } from "./github-pulls.js";
import { listFilter, objectOf, orderItems, readTickets, statusOf, textFilter, textOf, updatedOf, urlOf } from "./tracker-shared.js";

/** A ClickUp task id: letters, digits, `_` and `-` (custom task ids carry a prefix and a hyphen). */
export const CLICKUP_TASK_ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * `filters` (already known to hold only ClickUp's keys) as a
 * `ClickupPollSpec`'s filters, or `invalid_spec`: exactly one of `list` or
 * `space` (a string of 1-200 characters); optional `status`, `assignee`
 * (strings) and `tags` (a non-empty array of strings).
 */
export function checkClickupFilters(filters: Record<string, unknown>): ClickupPollSpec["filters"] {
  const list = textFilter(filters, "list");
  const space = textFilter(filters, "space");
  if ((list === undefined) === (space === undefined)) {
    throw new TriggerError("invalid_spec", "a clickup.tasks poll takes exactly one of filters.list or filters.space");
  }
  const status = textFilter(filters, "status");
  const assignee = textFilter(filters, "assignee");
  const tags = listFilter(filters, "tags");
  return {
    ...(list === undefined ? {} : { list }),
    ...(space === undefined ? {} : { space }),
    ...(status === undefined ? {} : { status }),
    ...(tags === undefined ? {} : { tags }),
    ...(assignee === undefined ? {} : { assignee }),
  };
}

/** The tracker scope of a poll: `clickup:list/<id>` or `clickup:space/<id>`. */
function scopeOf(filters: ClickupPollSpec["filters"]): string {
  return filters.list !== undefined ? `clickup:list/${filters.list}` : `clickup:space/${filters.space ?? ""}`;
}

/** The tool's arguments for a poll's filters, as the pinned fixture's tool takes them. */
function argsOf(filters: ClickupPollSpec["filters"]): Record<string, unknown> {
  return {
    ...(filters.list === undefined ? {} : { list_ids: [filters.list] }),
    ...(filters.space === undefined ? {} : { space_ids: [filters.space] }),
    ...(filters.status === undefined ? {} : { statuses: [filters.status] }),
    ...(filters.assignee === undefined ? {} : { assignees: [filters.assignee] }),
    ...(filters.tags === undefined ? {} : { tags: [...filters.tags] }),
  };
}

/** The lower-cased tag names a task carries: strings, or objects with a `name`. */
function tagsOf(task: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const tags = task["tags"];
  if (!Array.isArray(tags)) return out;
  for (const tag of tags as unknown[]) {
    const name = typeof tag === "string" ? tag : objectOf(tag)?.["name"];
    if (typeof name === "string") out.add(name.toLowerCase());
  }
  return out;
}

/** The item of a listed task, or `undefined` when it has no usable id or updated time, or lacks a tag the spec names. */
function itemOf(filters: ClickupPollSpec["filters"], entry: unknown): SourceItem | undefined {
  const task = objectOf(entry);
  if (task === undefined) return undefined;
  const id = task["id"];
  if (typeof id !== "string" || !CLICKUP_TASK_ID.test(id)) return undefined;
  const updated = updatedOf(task["date_updated"] ?? task["updated_at"]);
  if (updated === undefined) return undefined;
  if (filters.tags !== undefined) {
    const carried = tagsOf(task);
    if (!filters.tags.every((tag) => carried.has(tag.toLowerCase()))) return undefined;
  }
  const status = statusOf(task["status"]);
  return {
    ref: `clickup:${id}`,
    revision: updated,
    title: textOf(task["name"]),
    url: urlOf(task["url"]),
    updated_at: updated,
    text: textOf(task["description"] ?? task["text_content"]),
    ...(status === undefined ? {} : { status }),
  };
}

/**
 * The `clickup.tasks` fetch: one call of the definition's task-listing tool
 * through `tickets` with the poll's filters, then the kernel's own tag check on
 * what came back. Items are ordered by updated time, then ref, an id listed
 * twice kept once, uncapped here (`../poll.ts` caps them). A failure stops the fetch.
 */
export async function fetchClickupTasks(tickets: McpTicketReader, store: Store, spec: ClickupPollSpec): Promise<SourceFetch> {
  const read = await readTickets(tickets, store, "clickup", MCP_TRACKERS.clickup.tool, argsOf(spec.filters), "tasks", scopeOf(spec.filters));
  if (!read.ok) return read;
  const items: SourceItem[] = [];
  for (const entry of read.entries) {
    const item = itemOf(spec.filters, entry);
    if (item !== undefined) items.push(item);
  }
  return { ok: true, items: orderItems(items) };
}
