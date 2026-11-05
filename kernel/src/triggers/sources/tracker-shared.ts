// What the two ticket poll sources share (phase 8 item 07): `jira-issues.ts`
// and `clickup-tasks.ts` check their filters the same way, read the tracker
// through the kernel's `McpTicketReader` the same way, fail with the same fixed
// shape, and order their items the same way. One home, so neither file copies
// the other.
//
// The server's answer is untrusted data (invariant 3): it is parsed loosely and
// bounded, an entry without a usable key, id or updated time is dropped (never
// guessed), and a failure is only a fixed code, never the server's text and
// never a credential. Title, text, status and url are the server's text; they
// reach a model only inside `items.ts`'s one `wrapUntrusted` block.
//
// Imports: type-only from `../../integrations/*` and `./github-pulls.js`, plus
// `TriggerError` from `../fire-shared.js` (the leaf `poll.ts` imports too), so
// the `studio` CLI's module graph is unchanged.
import type { McpTicketReader, McpTicketResult } from "../../integrations/mcp/trackers.js";
import type { McpKind } from "../../integrations/mcp/rows.js";
import type { SourceItem } from "../../integrations/types.js";
import type { Store } from "../../store/store.js";
import { TriggerError } from "../fire-shared.js";
import type { SourceFetch } from "./github-pulls.js";

/** Longest filter string (each text filter, and each entry of a list filter). */
export const MAX_TICKET_FILTER_LENGTH = 200;

/** C0 and C1 control characters (DEL included). */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_ALL = /[\u0000-\u001f\u007f-\u009f]/g;

/** The longest `updated_at` a payload item may carry (`items.ts`' `MAX_ITEM_UPDATED_AT_CHARS`). */
const MAX_UPDATED_CHARS = 64;
/** The longest URL a payload item may carry (`items.ts`' `MAX_ITEM_URL_CHARS`). */
const MAX_URL_CHARS = 2_000;
/** The longest status a payload item may carry. */
const MAX_STATUS_CHARS = 200;

/** Filter `key` as a string of 1-200 characters, or `undefined` when the spec does not name it. Throws `invalid_spec` for any other value. */
export function textFilter(filters: Record<string, unknown>, key: string): string | undefined {
  const v = filters[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v === "" || v.length > MAX_TICKET_FILTER_LENGTH) {
    throw new TriggerError("invalid_spec", `poll filter ${key} must be a string of 1-${MAX_TICKET_FILTER_LENGTH} characters`);
  }
  return v;
}

/** Filter `key` as a non-empty array of such strings, or `undefined` when the spec does not name it. Throws `invalid_spec` for any other value. */
export function listFilter(filters: Record<string, unknown>, key: string): string[] | undefined {
  const v = filters[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length === 0 || v.some((e) => typeof e !== "string" || e === "" || e.length > MAX_TICKET_FILTER_LENGTH)) {
    throw new TriggerError("invalid_spec", `poll filter ${key} must be a non-empty array of strings of 1-${MAX_TICKET_FILTER_LENGTH} characters`);
  }
  return [...(v as string[])];
}

/** A tracker failure: `client_error` (an existing closed code) with the tracker scope as `repo` and only a fixed code as `message`. */
export function failure(scope: string, code: string): Extract<SourceFetch, { ok: false }> {
  return { ok: false, error: "client_error", repo: scope, message: code };
}

/** The entries of the tool's answer, or the failure to give back. */
export type TicketRead = { readonly ok: true; readonly entries: readonly unknown[] } | Extract<SourceFetch, { ok: false }>;

/**
 * Call `tool` of the `kind` connector and read `arrayKey` (or a bare array)
 * out of the JSON text it answers. A reader that fails or throws, an answer
 * that is not JSON, or one with no such array is a fixed-code failure naming
 * `scope`.
 */
export async function readTickets(
  tickets: McpTicketReader,
  store: Store,
  kind: McpKind,
  tool: string,
  args: Record<string, unknown>,
  arrayKey: string,
  scope: string,
): Promise<TicketRead> {
  let answered: McpTicketResult;
  try {
    answered = await tickets.call(store, kind, tool, args);
  } catch {
    return failure(scope, "mcp_protocol");
  }
  if (!answered.ok) return failure(scope, answered.error);
  let parsed: unknown;
  try {
    parsed = JSON.parse(answered.text);
  } catch {
    return failure(scope, "mcp_protocol");
  }
  const list = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)[arrayKey] : undefined;
  if (!Array.isArray(list)) return failure(scope, "mcp_protocol");
  return { ok: true, entries: list };
}

/** A plain object, else `undefined`. */
export function objectOf(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** A text field of the server's: a string as it is, nothing as `""`, anything else (such as Atlassian's ADF description object) as its JSON text. */
export function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === undefined || v === null) return "";
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
}

/** A status name: a string, or an object's `status` / `name`; control characters removed, at most 200 characters. Absent when there is none. */
export function statusOf(v: unknown): string | undefined {
  const o = objectOf(v);
  const raw = typeof v === "string" ? v : o === undefined ? undefined : typeof o["status"] === "string" ? o["status"] : typeof o["name"] === "string" ? o["name"] : undefined;
  if (raw === undefined) return undefined;
  const clean = raw.replace(CONTROL_ALL, " ").trim().slice(0, MAX_STATUS_CHARS);
  return clean === "" ? undefined : clean;
}

/**
 * A ticket's updated time as the string that is both its `revision` and its
 * `updated_at`: a non-empty string of at most 64 characters with no control
 * character, a digits-only string or a number read as epoch milliseconds (as
 * ClickUp sends it) and shown as ISO-8601. Anything else is `undefined`: the
 * entry is dropped, never given a guessed time.
 */
export function updatedOf(v: unknown): string | undefined {
  const epoch = (ms: number): string | undefined => {
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
  };
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? epoch(v) : undefined;
  if (typeof v !== "string" || v === "" || v.length > MAX_UPDATED_CHARS || CONTROL.test(v)) return undefined;
  return /^[0-9]{9,16}$/.test(v) ? epoch(Number(v)) : v;
}

/** The server's own link, kept only when it is a plain `http(s)` address within the payload's bounds; otherwise `""`. */
export function urlOf(v: unknown): string {
  return typeof v === "string" && v.length <= MAX_URL_CHARS && /^https?:\/\/[^\s]+$/.test(v) && !CONTROL.test(v) ? v : "";
}

function timeKey(updatedAt: string): number {
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

/** `items` by updated time, then ref, with a ref listed twice kept once (the first in that order). */
export function orderItems(items: readonly SourceItem[]): SourceItem[] {
  const sorted = [...items].sort((a, b) => timeKey(a.updated_at) - timeKey(b.updated_at) || (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : 0) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  const seen = new Set<string>();
  const out: SourceItem[] = [];
  for (const item of sorted) {
    if (seen.has(item.ref)) continue;
    seen.add(item.ref);
    out.push(item);
  }
  return out;
}
