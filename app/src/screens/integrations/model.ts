// Integrations' view model (phase 6 item 11): the GitHub connector row turned
// into the mockup's designed states (`docs/design/mockups/integrations.html`:
// `S.base` none / connected / expiring / expired / unreachable), the words the
// list row and the detail pane show, and the kernel's refusals to the token
// route turned into the sheet's copy. Plain TypeScript: no React, no DOM.
//
// Every string from the kernel or GitHub (`account_login`, permission names,
// repo names, a refusal's `message`) is untrusted data (invariant 3): nothing
// here builds markup, and the components render each value as a React text
// child. The pasted token is not in this file at all: it never leaves
// `ConnectSheet.tsx`'s submit handler and the one call in `actions.ts`.
import type { ApiError, ApiResult, Connector, ConnectorStatus, ConnectorsResponse, RosterEntry } from "../../api/contract";
import { githubGranted, orderRoster, outcomeOf } from "../team/model";

/** The ids the unit tests and the e2e spec target; the screen sets no other test id. */
export const INTEGRATIONS_TEST_IDS = {
  screen: "screen-integrations",
  list: "integrations-list",
  listRow: "integrations-row-github",
  listMeta: "integrations-row-meta",
  listDot: "integrations-row-dot",
  count: "integrations-count",
  band: "integrations-band",
  readError: "integrations-read-error",
  notice: "integrations-notice",
  loading: "integrations-loading",
  empty: "integrations-empty",
  emptyConnect: "integrations-connect",
  detail: "integrations-detail",
  detailHeader: "integrations-detail-header",
  replace: "integrations-replace",
  disconnect: "integrations-disconnect",
  status: "integrations-status",
  account: "integrations-account",
  expires: "integrations-expires",
  inBand: "integrations-in-band",
  permissions: "integrations-permissions",
  repos: "integrations-repos",
  reposHeading: "integrations-repos-heading",
  refresh: "integrations-refresh",
  agents: "integrations-agents",
  agentCard: "integrations-agent",
  agentsNote: "integrations-agents-note",
  sheet: "integrations-sheet",
  sheetToken: "integrations-token",
  sheetDeclare: "integrations-sheet-declare",
  sheetConnect: "integrations-sheet-connect",
  sheetCancel: "integrations-sheet-cancel",
  sheetError: "integrations-sheet-error",
  sheetStatus: "integrations-sheet-status",
  sheetPage: "integrations-token-page",
} as const;

// ---- One call's answer ------------------------------------------------------------------------

/**
 * The bridge's answer, kept apart where this screen must tell them apart:
 * `unreachable` (status 0 with a `connection`: the kernel could not be asked,
 * which is never "not connected"), `refused` (the kernel answered no, with its
 * whole body for `write_permissions`) and `failed` (the IPC call itself failed).
 */
export type Reply<R> =
  | { readonly kind: "ok"; readonly status: number; readonly body: R }
  | { readonly kind: "unreachable"; readonly message: string }
  | { readonly kind: "refused"; readonly status: number; readonly error: string; readonly message: string | undefined; readonly body: ApiError }
  | { readonly kind: "failed"; readonly message: string };

/** Team's wording for a call that did not answer ok (a failed IPC call, or the kernel not reachable). */
function unansweredText(result: ApiResult<unknown> | undefined): string {
  const said = outcomeOf(result);
  return said.ok ? "" : said.message;
}

/** `result` as a `Reply`; `undefined` is a failed IPC call. The wording is Team's `outcomeOf`, not a second copy. */
export function replyOf<R>(result: ApiResult<R> | undefined): Reply<R> {
  if (result === undefined) return { kind: "failed", message: unansweredText(undefined) };
  if (result.ok) return { kind: "ok", status: result.status, body: result.body };
  if ("connection" in result) return { kind: "unreachable", message: unansweredText(result) };
  const body: ApiError = typeof result.body === "object" && result.body !== null ? result.body : { error: `HTTP ${result.status}` };
  const error = typeof body.error === "string" && body.error !== "" ? body.error : `HTTP ${result.status}`;
  const message = typeof body.message === "string" && body.message !== "" ? body.message : undefined;
  return { kind: "refused", status: result.status, error, message, body };
}

/** A non-ok reply in words: the kernel's `message` if it sent one, else its error code. */
export function replyText(reply: Exclude<Reply<unknown>, { readonly kind: "ok" }>): string {
  if (reply.kind === "refused") return reply.message ?? reply.error;
  return reply.message;
}

// ---- Status to designed state -----------------------------------------------------------------

/** The mockup's `S.base`: `none` (no token in use) or a token's state. `unreachable` is the read's phase, not a row state. */
export type DesignedState = "none" | "connected" | "expiring" | "expired";

/**
 * Each row status's designed state. A `rejected` row (the kernel writes one
 * after a refused first connect) and a `disconnected` one have no token in
 * use: both are the empty state, `rejected` with the refused note in the list row.
 */
export const STATE_OF_STATUS: Readonly<Record<ConnectorStatus, DesignedState>> = Object.freeze({
  connected: "connected",
  expiring: "expiring",
  expired: "expired",
  rejected: "none",
  disconnected: "none",
});

/** The GitHub row of a `GET /connectors` answer, if the kernel has one. */
export function githubRow(answer: ConnectorsResponse | undefined): Connector | undefined {
  return answer?.connectors.find((c) => c.kind === "github");
}

/** What the screen has read so far: the newest answer, and the newest answer that was `ok` (kept while a later one fails). */
export interface ConnectorsRead {
  readonly latest: Reply<ConnectorsResponse> | undefined;
  readonly lastOk: ConnectorsResponse | undefined;
}

export type Phase = "loading" | "ready" | "unreachable" | "error";

export interface IntegrationsView {
  readonly phase: Phase;
  /** The designed state of the row shown (from the last `ok` answer): `none` with no row, or a dead one. */
  readonly state: DesignedState;
  /** The row behind a token state, for the detail pane; `undefined` in `none`. */
  readonly row: Connector | undefined;
  /** The last token the kernel saw was refused (`rejected` row). */
  readonly refused: boolean;
  /** Why the latest read failed, for `unreachable` and `error`. */
  readonly message: string | undefined;
}

/**
 * The view of `read`. A status 0 answer is `unreachable` (the last good row
 * stays, read-only; with none, "status unknown"), never `none`; a refused one
 * is `error`; neither drops the last good answer.
 */
export function viewOf(read: ConnectorsRead): IntegrationsView {
  const row = githubRow(read.lastOk);
  const state: DesignedState = row === undefined ? "none" : STATE_OF_STATUS[row.status];
  const shown = { state, row: state === "none" ? undefined : row, refused: row?.status === "rejected" };
  const { latest } = read;
  if (latest === undefined) return { phase: "loading", ...shown, message: undefined };
  if (latest.kind === "ok") return { phase: "ready", ...shown, message: undefined };
  if (latest.kind === "unreachable") return { phase: "unreachable", ...shown, message: latest.message };
  return { phase: "error", ...shown, message: replyText(latest) };
}

/** Whether a token is in use (connected, expiring or expired): Replace token and Disconnect exist. */
export function hasToken(view: IntegrationsView): boolean {
  return view.state !== "none";
}

/** The kernel cannot be asked right now: every write is disabled. */
export function isOffline(view: IntegrationsView): boolean {
  return view.phase === "unreachable";
}

// ---- Dates ------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function dateOf(iso: string | null | undefined): Date | undefined {
  if (iso === null || iso === undefined) return undefined;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Whole days from `now` to the expiry, rounded up (23 h left is 1 day); negative once past. */
export function daysLeft(expiresAt: string | null, now: Date): number | undefined {
  const at = dateOf(expiresAt);
  if (at === undefined) return undefined;
  return Math.ceil((at.getTime() - now.getTime()) / DAY_MS);
}

export interface ExpiryView {
  /** "23 Jan 2027" (UTC date), or "No expiry" when GitHub reported none. */
  readonly date: string;
  /** "88 days left", "expired 2 days ago"; `undefined` with no expiry. */
  readonly left: string | undefined;
  readonly badge: "renew soon" | "expired" | undefined;
}

/** The Expires line for a token state. */
export function expiryOf(expiresAt: string | null, state: DesignedState, now: Date): ExpiryView {
  const at = dateOf(expiresAt);
  const badge = state === "expiring" ? "renew soon" : state === "expired" ? "expired" : undefined;
  if (at === undefined) return { date: "No expiry", left: undefined, badge };
  const date = `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()] ?? ""} ${at.getUTCFullYear()}`;
  const ms = at.getTime() - now.getTime();
  if (ms > 0) return { date, left: `${plural(Math.ceil(ms / DAY_MS), "day", "days")} left`, badge };
  const ago = Math.floor(-ms / DAY_MS);
  return { date, left: ago === 0 ? "expired today" : `expired ${plural(ago, "day", "days")} ago`, badge };
}

/** "today 14:02" for a time on `now`'s day, else "24 Oct 09:12" (local time); "never" with no time. */
export function whenText(iso: string | null, now: Date): string {
  const at = dateOf(iso);
  if (at === undefined) return "never";
  const clock = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return sameDay ? `today ${clock}` : `${at.getDate()} ${MONTHS[at.getMonth()] ?? ""} ${clock}`;
}

// ---- The list row ------------------------------------------------------------------------------

export type RowDot = "ok" | "waiting" | "danger" | "idle" | "working" | "none";

/** The list row's dot and words for each designed state (the mockup's `rowMeta`). */
export function rowMeta(view: IntegrationsView, connecting: boolean, now: Date): { readonly dot: RowDot; readonly text: string } {
  if (connecting) return { dot: "working", text: "connecting · checking the token with GitHub" };
  if (view.phase === "loading") return { dot: "idle", text: "checking…" };
  if (view.phase === "unreachable") return { dot: "none", text: "status unknown · kernel unreachable" };
  const { row } = view;
  if (view.state === "none") {
    if (view.phase === "error") return { dot: "none", text: "status unknown" };
    return { dot: "idle", text: view.refused ? "not connected · the last token was refused" : "not connected" };
  }
  const who = row?.account_login ? ` · ${row.account_login}` : "";
  if (view.state === "connected") return { dot: "ok", text: `connected${who}` };
  if (view.state === "expired") return { dot: "danger", text: `expired${who}` };
  const days = daysLeft(row?.expires_at ?? null, now);
  return { dot: "waiting", text: `${days === undefined ? "expiring" : `expiring in ${plural(Math.max(days, 0), "day", "days")}`}${who}` };
}

// ---- Permissions ---------------------------------------------------------------------------------

/** "pull_requests" -> "Pull requests". The key is GitHub's: only its separators and first letter change. */
export function permissionLabel(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced === "" ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** GitHub's level as reported; `read` is the mockup's "Read-only". */
export function levelLabel(level: string): string {
  return level === "read" ? "Read-only" : level;
}

export interface PermissionLine {
  readonly label: string;
  readonly level: string;
}

/** A row's permissions, in the order the kernel sent them. */
export function permissionLines(permissions: Readonly<Record<string, string>> | null): PermissionLine[] {
  if (permissions === null) return [];
  return Object.entries(permissions).map(([key, level]) => ({ label: permissionLabel(key), level: levelLabel(String(level)) }));
}

// ---- Refusals of the token route --------------------------------------------------------------------

/** What the Connect sheet shows after the kernel refuses (or cannot take) a token. */
export type Refusal =
  | { readonly kind: "invalid" }
  | { readonly kind: "write"; readonly drops: readonly string[] }
  /** `token_permissions_unknown`: the sheet's own copy, which points at the confirmation box. */
  | { readonly kind: "permissions_unknown" }
  | { readonly kind: "other"; readonly text: string };

/** "Pull requests: write → set to Read-only": one line per write permission, with GitHub's level as reported. */
export function dropLine(permission: string, level: string): string {
  return `${permissionLabel(permission)}: ${level} → set to Read-only`;
}

/**
 * The write permissions a `token_write_scoped` body names. Read defensively
 * from the open keys of `ApiError`: anything that is not a `{permission, level}`
 * pair of strings is skipped.
 */
export function writePermissionsOf(body: ApiError): string[] {
  const listed = body.write_permissions;
  if (!Array.isArray(listed)) return [];
  const lines: string[] = [];
  for (const item of listed as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const { permission, level } = item as { readonly permission?: unknown; readonly level?: unknown };
    if (typeof permission === "string" && typeof level === "string") lines.push(dropLine(permission, level));
  }
  return lines;
}

/** The sheet's copy for a non-ok answer of `POST /connectors/github/token`. */
export function refusalOf(reply: Exclude<Reply<unknown>, { readonly kind: "ok" }>): Refusal {
  if (reply.kind === "refused" && reply.error === "token_invalid") return { kind: "invalid" };
  if (reply.kind === "refused" && reply.error === "token_write_scoped") return { kind: "write", drops: writePermissionsOf(reply.body) };
  if (reply.kind === "refused" && reply.error === "token_permissions_unknown") return { kind: "permissions_unknown" };
  return { kind: "other", text: replyText(reply) };
}

// ---- Agents ------------------------------------------------------------------------------------------

/** The agents the roster says hold GitHub (`githubGranted(agent) === true`), Wright first; an unreported grant is not a grant. */
export function grantedAgents(roster: readonly RosterEntry[]): RosterEntry[] {
  return orderRoster(roster).filter((agent) => githubGranted(agent) === true);
}

/** The agents the roster says hold no GitHub; one whose grant the roster did not report is in neither list. */
export function ungrantedAgents(roster: readonly RosterEntry[]): RosterEntry[] {
  return orderRoster(roster).filter((agent) => githubGranted(agent) === false);
}

/** "Mason and Pim don't have it." / "Mason doesn't have it." / `undefined` when every reported agent holds it. */
export function ungrantedNote(roster: readonly RosterEntry[]): string | undefined {
  const names = ungrantedAgents(roster).map((a) => a.display_name);
  if (names.length === 0) return undefined;
  const list = names.length === 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
  return `${list} ${names.length === 1 ? "doesn't" : "don't"} have it.`;
}
