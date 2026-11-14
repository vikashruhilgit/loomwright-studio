// The `clickup.tasks` poll source (phase 8 item 07): the ClickUp half of the
// ticket sources. A poll is scoped by exactly one of its `list` or `space`
// filters (so it names no workspace), and may add `status`, `assignee` and
// `tags`. `../poll.ts` calls `checkClickupFilters` when it parses a spec and
// `fetchClickupTasks` when one fires, and applies `MAX_POLL_ITEMS` to what it
// returns.
//
// Mechanism only (invariant 1): there is no default filter, interval or dedupe
// key. The filters go to the server as the tool takes them (`list_ids` or
// `space_ids`, and `statuses`, `assignees`, `tags` as arrays of strings), and
// the kernel applies the tag filter again on the parsed tasks, whatever the
// server answered (as `github.pulls` re-applies its filters): a task must carry
// every tag the spec names, compared case-insensitively (ClickUp keeps tag
// names lower-case).
//
// The tool is `clickup_filter_tasks`, read from the live server on 2026-11-13
// (`docs/evidence/phase-8-20g-clickup-reader.md`): its name is data in
// `MCP_TRACKERS`, checked against the connection's own tool list before any
// call. It answers `{tasks: [{id, custom_id, name, status, url, priority,
// assignees, tags, due_date, date_updated, date_closed, list}], count, page,
// has_more, next_page}`: `status` is a string, `tags` are `{name}` objects,
// `date_updated` is epoch milliseconds as a string, and a listed task carries
// no body. An entry that is off-shape is dropped.
//
// An item is `{ref: clickup:<task id>, revision: <updated>, title: <name>, url:
// <the task's own url>, updated_at: <updated>, status: <status name>}`, with no
// `text` (the listing has none). The id matches `CLICKUP_TASK_ID` (the ref is
// printed raw in a prompt frame, so an id that could carry words is dropped).
// `title` and `status` are the server's text: untrusted data, wrapped wherever
// they reach a model. A task with no usable id or updated time is dropped.
//
// Failures are `client_error` with the tracker scope (`clickup:list/<id>` or
// `clickup:space/<id>`) as `repo` and a fixed code as `message`
// (`tracker-shared.ts`).
//
// `list` and `space` hold ClickUp IDs, digits only (`CLICKUP_SCOPE_ID`): the
// tool's `list_ids` and `space_ids` take nothing else, and a name sent there
// fails `mcp_tool_error` (`docs/evidence/phase-8-21a-clickup-list-by-name.md`).
// The parser refuses any other value, naming the filter. A name the owner gave
// at draft time is turned into an ID once, by `resolveClickupNames`, which
// `kernel_playbook_create` / `_update` call before the spec is stored, so a
// stored spec always holds IDs.
//
// Imports: as `jira-issues.ts`.
import { MCP_TICKET_FAILURES, MCP_TRACKERS } from "../../integrations/mcp/trackers.js";
import type { McpTicketReader } from "../../integrations/mcp/trackers.js";
import type { ClickupPollSpec, SourceItem } from "../../integrations/types.js";
import type { Store } from "../../store/store.js";
import { TriggerError } from "../fire-shared.js";
import type { SourceFetch } from "./github-pulls.js";
import { MAX_TICKET_FILTER_LENGTH, listFilter, objectOf, orderItems, readTickets, statusOf, textFilter, textOf, updatedOf, urlOf } from "./tracker-shared.js";

/** A ClickUp task id: letters, digits, `_` and `-` (custom task ids carry a prefix and a hyphen). */
export const CLICKUP_TASK_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** A ClickUp list or space id: digits only (read from the live server 2026-11-13: it rejects any other `list_ids` value, and every id it answered was digits). */
export const CLICKUP_SCOPE_ID = /^[0-9]{1,30}$/;

/** `filters.<key>` must hold an ID: `invalid_spec` naming the filter and the value it holds, quoted and cut to the filter's bound. */
function requireScopeId(key: "list" | "space", value: string | undefined): void {
  if (value === undefined || CLICKUP_SCOPE_ID.test(value)) return;
  throw new TriggerError(
    "invalid_spec",
    `poll filter filters.${key} must be a ClickUp ${key} ID (digits only), but it holds ${JSON.stringify(value.slice(0, MAX_TICKET_FILTER_LENGTH))}; a name is turned into an ID when the playbook is drafted or updated`,
  );
}

/**
 * `filters` (already known to hold only ClickUp's keys) as a
 * `ClickupPollSpec`'s filters, or `invalid_spec`: exactly one of `list` or
 * `space` (a ClickUp ID: digits only); optional `status`, `assignee`
 * (strings) and `tags` (a non-empty array of strings).
 */
export function checkClickupFilters(filters: Record<string, unknown>): ClickupPollSpec["filters"] {
  const list = textFilter(filters, "list");
  const space = textFilter(filters, "space");
  if ((list === undefined) === (space === undefined)) {
    throw new TriggerError("invalid_spec", "a clickup.tasks poll takes exactly one of filters.list or filters.space");
  }
  requireScopeId("list", list);
  requireScopeId("space", space);
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

/** The tool's arguments for a poll's filters, under the argument names `clickup_filter_tasks` declares in its input schema. */
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
  const updated = updatedOf(task["date_updated"]);
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

// ---- A name given at draft time, turned into an ID -----------------------------

/** A refusal: `invalid_spec`, in the kernel's own words (never the server's text), for the tool result to carry. */
const refusal = (message: string): TriggerError => new TriggerError("invalid_spec", message);

/** Names compare ignoring case and surrounding whitespace, as ClickUp's own `list_name` match does. */
const normalised = (name: string): string => name.trim().toLowerCase();

/**
 * The ID of the ClickUp `key` called `name`, or a `TriggerError("invalid_spec")` naming the filter and the name.
 *
 * Only a list has a lookup (`MCP_TRACKERS.clickup.lookup.list`, `clickup_get_list` with `list_name`; probed
 * 2026-11-13). The server's one tool that lists spaces, `clickup_get_workspace_hierarchy`, is dropped at
 * connect because its proxy name is too long, so a space name is refused with no call (`tool_unavailable`).
 * `clickup_get_list` answers ONE list: an exact name (ignoring case and padding) gives that list, a name
 * nothing has is `is_error` (the reader sees only `mcp_tool_error`, and keeps no text), and when several
 * lists share a name the server returns the first without saying so. The kernel cannot count same-named lists
 * through this tool, so it can refuse "several" only when the server does (it does not): that is recorded in
 * `docs/evidence/phase-8-21a-clickup-list-by-name.md` and `docs/OPEN_QUESTIONS.md`. The answer's own name must
 * match the asked name, so a looser match is never taken for the list.
 */
async function lookupScopeId(tickets: McpTicketReader, store: Store, key: "list" | "space", name: string): Promise<string> {
  const tool = MCP_TRACKERS.clickup.lookup?.[key];
  const shown = `filters.${key} ${JSON.stringify(name)}`;
  const failed = (code: string, why = ""): TriggerError => refusal(`${shown} could not be looked up: ${code}.${why}`);
  const ask = `Tell the owner and ask which ${key} they mean; do not guess.`;
  if (tool === undefined) {
    throw failed("tool_unavailable", ` ClickUp gives the kernel no tool to look a ${key} up by name, so a ${key} name cannot be turned into an ID. ${ask}`);
  }

  let answered;
  try {
    answered = await tickets.call(store, "clickup", tool, { list_name: name });
  } catch {
    throw failed("mcp_protocol");
  }
  if (!answered.ok) {
    // Only a code of the closed set reaches the message, whatever a reader answers.
    const code = (MCP_TICKET_FAILURES as readonly unknown[]).includes(answered.error) ? answered.error : "client_error";
    if (code === "mcp_tool_error") {
      // ClickUp answers a list name nothing has as a tool error; the kernel keeps no server text, so this is also what any other refusal looks like.
      throw failed(code, ` ClickUp answers this way for a name that no list has (0 matches), and the kernel keeps no server text to tell that from any other refusal. ${ask}`);
    }
    throw failed(code, code === "tool_unavailable" ? ` The clickup connector's tool list lacks ${tool}; reconnect ClickUp in Integrations so the list is read again.` : "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(answered.text);
  } catch {
    throw failed("mcp_protocol");
  }
  const list = objectOf(parsed);
  const id = list?.["id"];
  const returned = list?.["name"];
  if (typeof id !== "string" || !CLICKUP_SCOPE_ID.test(id) || typeof returned !== "string") throw failed("mcp_protocol");
  // The answer is one list: it must be the one asked for, never a looser match (the server's name is compared, never quoted).
  if (normalised(returned) !== normalised(name)) throw refusal(`${shown} matches no ClickUp ${key} (0 matches). ${ask}`);
  return id;
}

/**
 * `specText` (a poll trigger's JSON text, as `storeTrigger` makes it) with a
 * `clickup.tasks` poll's `filters.list` or `filters.space` turned from a name
 * into the ID of the list or space of that name: one lookup call
 * (`MCP_TRACKERS.clickup.lookup`) through `tickets`, with the owner's sign-in,
 * never inside a session. A value that is already an ID makes no call, and
 * nothing else in the text changes. Text that is not a `clickup.tasks` poll with
 * exactly one string `list` or `space` comes back as it is (the spec's own check
 * refuses it).
 *
 * Throws `TriggerError("invalid_spec")` naming the filter and the name when no
 * list matches, when the answer is another list, when a space name is given (no
 * tool looks one up) and when the lookup fails (a fixed `MCP_TICKET_FAILURES`
 * code, never the server's text). Reads only.
 */
export async function resolveClickupNames(tickets: McpTicketReader, store: Store, specText: string): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(specText);
  } catch {
    return specText;
  }
  const spec = objectOf(parsed);
  const filters = objectOf(spec?.["filters"]);
  if (spec === undefined || filters === undefined || spec["source"] !== "clickup.tasks") return specText;
  if ((filters["list"] === undefined) === (filters["space"] === undefined)) return specText;
  const key = filters["list"] !== undefined ? "list" : "space";
  const value = filters[key];
  if (typeof value !== "string" || value === "" || value.length > MAX_TICKET_FILTER_LENGTH || CLICKUP_SCOPE_ID.test(value)) return specText;
  const id = await lookupScopeId(tickets, store, key, value);
  return JSON.stringify({ ...spec, filters: { ...filters, [key]: id } });
}
